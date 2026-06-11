/**
 * Server-side IG/FB publisher for the content_calendar.
 *
 * Why this exists: the daily routine (claude.ai/code/routines) runs in a
 * cloud sandbox whose outbound network policy blocks graph.facebook.com.
 * So the routine collapses to one POST to this endpoint, and all Meta
 * Graph API calls happen here on Vercel where outbound is unrestricted.
 *
 * Bonus: the Meta access token lives in env (META_PUBLISH_TOKEN) instead
 * of being baked into the routine prompt in plaintext.
 *
 * Auth: shared `?key=CONTENT_CALENDAR_SECRET` like the rest of the
 * /api/content/* endpoints.
 *
 * Body: { date: "YYYY-MM-DD" | "today" }
 *
 * Behaviour mirrors the old bash flow exactly: IMAGE / STORIES /
 * CAROUSEL_ALBUM / REELS, with Reels status polling, the 2207051
 * "action blocked" false-positive workaround via a verification listing,
 * optional FB cross-post for IMAGE, then idempotent posted_at stamping.
 */
import { NextResponse } from "next/server";
import { getSql, ensureContentSchema } from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Reels processing can take up to ~2min before status_code=FINISHED.
// Budget = polling + slack. Vercel Fluid Compute default ceiling is 300s.
export const maxDuration = 300;

const GRAPH_V = "v22.0";
const GRAPH = `https://graph.facebook.com/${GRAPH_V}`;
const IG_USER_ID = process.env.META_IG_USER_ID ?? "17841427253470591";
const FB_PAGE_ID = process.env.META_PAGE_ID ?? "1053020717904265";

function authed(req: Request): boolean {
  const secret = process.env.CONTENT_CALENDAR_SECRET;
  if (!secret) return false;
  const url = new URL(req.url);
  const provided =
    url.searchParams.get("key") ?? req.headers.get("x-content-key");
  return provided === secret;
}

type Row = {
  scheduled_for: string;
  theme: string | null;
  prompt: string | null;
  asset_url: string | null;
  caption: string | null;
  media_type: string;
  aspect_ratio: string | null;
  posted_at: string | null;
  permalink: string | null;
  children_urls: string[] | null;
  cross_post_fb: boolean;
};

type GraphErr = { message?: string; code?: number; error_subcode?: number };
type GraphResp = { id?: string; error?: GraphErr; [k: string]: unknown };

function form(params: Record<string, string>): URLSearchParams {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) u.append(k, v);
  return u;
}

async function graphPost(
  path: string,
  params: Record<string, string>,
): Promise<GraphResp> {
  const r = await fetch(`${GRAPH}${path}`, {
    method: "POST",
    body: form(params),
  });
  return (await r.json()) as GraphResp;
}

async function graphGet(
  path: string,
  params: Record<string, string>,
): Promise<GraphResp> {
  const r = await fetch(`${GRAPH}${path}?${form(params).toString()}`);
  return (await r.json()) as GraphResp;
}

// Meta sometimes returns error.error_subcode = 2207051 ("action is blocked")
// even when the post actually went through. The verification listing of
// recent media is the authoritative source. Returns the permalink + id
// of the most-recent media if its asset/caption matches our expectation,
// else null.
async function verifyFreshMedia(
  token: string,
  expect: { caption?: string | null; sinceMs: number; storiesOnly?: boolean },
): Promise<{ id: string; permalink: string | null } | null> {
  const path = expect.storiesOnly
    ? `/${IG_USER_ID}/stories`
    : `/${IG_USER_ID}/media`;
  const resp = (await graphGet(path, {
    fields: "id,permalink,timestamp,caption,media_type",
    limit: "3",
    access_token: token,
  })) as {
    data?: Array<{
      id: string;
      permalink?: string;
      timestamp?: string;
      caption?: string;
    }>;
  };
  const list = resp.data ?? [];
  for (const item of list) {
    const ts = item.timestamp ? Date.parse(item.timestamp) : 0;
    // Anything created in the last 10 minutes counts as "ours".
    if (Date.now() - ts > 10 * 60 * 1000) continue;
    if (expect.caption) {
      // First ~40 chars of caption is enough to disambiguate.
      const want = expect.caption.slice(0, 40).trim();
      const got = (item.caption ?? "").slice(0, 40).trim();
      if (want && got && want !== got) continue;
    }
    if (ts >= expect.sinceMs - 60_000) {
      return { id: item.id, permalink: item.permalink ?? null };
    }
  }
  return null;
}

type PublishOutcome = {
  ok: boolean;
  media_id: string | null;
  permalink: string | null;
  error: string | null;
};

async function publishImageOrStories(
  token: string,
  row: Row,
): Promise<PublishOutcome> {
  if (!row.asset_url) {
    return { ok: false, media_id: null, permalink: null, error: "no asset_url" };
  }
  const isStories = row.media_type === "STORIES";
  const startedAt = Date.now();
  const containerParams: Record<string, string> = {
    image_url: row.asset_url,
    access_token: token,
  };
  if (isStories) containerParams.media_type = "STORIES";
  if (!isStories && row.caption) containerParams.caption = row.caption;
  const created = await graphPost(`/${IG_USER_ID}/media`, containerParams);
  if (!created.id) {
    return {
      ok: false,
      media_id: null,
      permalink: null,
      error: `container failed: ${JSON.stringify(created.error ?? created)}`,
    };
  }
  await new Promise((r) => setTimeout(r, 6000));
  const pub = await graphPost(`/${IG_USER_ID}/media_publish`, {
    creation_id: created.id,
    access_token: token,
  });
  // Honor the verification fallback: if Meta returned 2207051, check the
  // listing — the post may actually be live.
  if (pub.error && pub.error.error_subcode !== 2207051) {
    return {
      ok: false,
      media_id: null,
      permalink: null,
      error: `publish failed: ${JSON.stringify(pub.error)}`,
    };
  }
  await new Promise((r) => setTimeout(r, 4000));
  const verified = await verifyFreshMedia(token, {
    caption: isStories ? null : row.caption,
    sinceMs: startedAt,
    storiesOnly: isStories,
  });
  if (!verified) {
    if (pub.id) {
      return { ok: true, media_id: pub.id, permalink: null, error: null };
    }
    return {
      ok: false,
      media_id: null,
      permalink: null,
      error: `publish ambiguous (no verification): ${JSON.stringify(pub)}`,
    };
  }
  return { ok: true, media_id: verified.id, permalink: verified.permalink, error: null };
}

async function publishCarousel(
  token: string,
  row: Row,
): Promise<PublishOutcome> {
  const children = (row.children_urls ?? []).filter((u) => typeof u === "string");
  if (children.length < 2 || children.length > 10) {
    return {
      ok: false,
      media_id: null,
      permalink: null,
      error: `carousel needs 2..10 children, got ${children.length}`,
    };
  }
  const startedAt = Date.now();
  const childIds: string[] = [];
  for (const url of children) {
    const c = await graphPost(`/${IG_USER_ID}/media`, {
      image_url: url,
      is_carousel_item: "true",
      access_token: token,
    });
    if (!c.id) {
      return {
        ok: false,
        media_id: null,
        permalink: null,
        error: `child container failed: ${JSON.stringify(c.error ?? c)}`,
      };
    }
    childIds.push(c.id);
  }
  const parentParams: Record<string, string> = {
    media_type: "CAROUSEL",
    children: childIds.join(","),
    access_token: token,
  };
  if (row.caption) parentParams.caption = row.caption;
  const parent = await graphPost(`/${IG_USER_ID}/media`, parentParams);
  if (!parent.id) {
    return {
      ok: false,
      media_id: null,
      permalink: null,
      error: `parent container failed: ${JSON.stringify(parent.error ?? parent)}`,
    };
  }
  await new Promise((r) => setTimeout(r, 8000));
  const pub = await graphPost(`/${IG_USER_ID}/media_publish`, {
    creation_id: parent.id,
    access_token: token,
  });
  if (pub.error && pub.error.error_subcode !== 2207051) {
    return {
      ok: false,
      media_id: null,
      permalink: null,
      error: `publish failed: ${JSON.stringify(pub.error)}`,
    };
  }
  await new Promise((r) => setTimeout(r, 4000));
  const verified = await verifyFreshMedia(token, {
    caption: row.caption,
    sinceMs: startedAt,
  });
  if (!verified && pub.id) {
    return { ok: true, media_id: pub.id, permalink: null, error: null };
  }
  if (!verified) {
    return {
      ok: false,
      media_id: null,
      permalink: null,
      error: `publish ambiguous: ${JSON.stringify(pub)}`,
    };
  }
  return { ok: true, media_id: verified.id, permalink: verified.permalink, error: null };
}

async function publishReels(token: string, row: Row): Promise<PublishOutcome> {
  if (!row.asset_url) {
    return { ok: false, media_id: null, permalink: null, error: "no asset_url (reels)" };
  }
  const startedAt = Date.now();
  const containerParams: Record<string, string> = {
    video_url: row.asset_url,
    media_type: "REELS",
    share_to_feed: "true",
    access_token: token,
  };
  if (row.caption) containerParams.caption = row.caption;
  const created = await graphPost(`/${IG_USER_ID}/media`, containerParams);
  if (!created.id) {
    return {
      ok: false,
      media_id: null,
      permalink: null,
      error: `reels container failed: ${JSON.stringify(created.error ?? created)}`,
    };
  }
  // Poll status_code until FINISHED. Budget = 5 minutes (30 × 10s).
  let finished = false;
  let lastStatus = "";
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    const s = (await graphGet(`/${created.id}`, {
      fields: "status_code,status",
      access_token: token,
    })) as { status_code?: string; status?: string };
    lastStatus = s.status_code ?? "";
    if (lastStatus === "FINISHED") {
      finished = true;
      break;
    }
    if (lastStatus === "ERROR") break;
  }
  if (!finished) {
    return {
      ok: false,
      media_id: null,
      permalink: null,
      error: `reels processing not finished: last status_code=${lastStatus}`,
    };
  }
  const pub = await graphPost(`/${IG_USER_ID}/media_publish`, {
    creation_id: created.id,
    access_token: token,
  });
  if (pub.error && pub.error.error_subcode !== 2207051) {
    return {
      ok: false,
      media_id: null,
      permalink: null,
      error: `publish failed: ${JSON.stringify(pub.error)}`,
    };
  }
  await new Promise((r) => setTimeout(r, 4000));
  const verified = await verifyFreshMedia(token, {
    caption: row.caption,
    sinceMs: startedAt,
  });
  if (!verified && pub.id) {
    return { ok: true, media_id: pub.id, permalink: null, error: null };
  }
  if (!verified) {
    return {
      ok: false,
      media_id: null,
      permalink: null,
      error: `publish ambiguous: ${JSON.stringify(pub)}`,
    };
  }
  return { ok: true, media_id: verified.id, permalink: verified.permalink, error: null };
}

async function crossPostFB(
  userToken: string,
  row: Row,
): Promise<{ ok: boolean; error: string | null }> {
  if (!row.asset_url || !row.caption) {
    return { ok: false, error: "fb cross-post needs asset_url + caption" };
  }
  // Page Access Token has to be derived from the user token. Fetch the
  // Page's access_token from /me/accounts.
  const accounts = (await graphGet(`/me/accounts`, {
    access_token: userToken,
  })) as { data?: Array<{ id: string; access_token?: string }> };
  const page = (accounts.data ?? []).find((a) => a.id === FB_PAGE_ID);
  if (!page?.access_token) {
    return { ok: false, error: "no page access_token in /me/accounts" };
  }
  const r = await graphPost(`/${FB_PAGE_ID}/photos`, {
    url: row.asset_url,
    message: row.caption,
    access_token: page.access_token,
  });
  if (r.error) {
    return { ok: false, error: `fb photo post failed: ${JSON.stringify(r.error)}` };
  }
  return { ok: true, error: null };
}

export async function POST(req: Request) {
  if (!authed(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { date?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const token = process.env.META_PUBLISH_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "META_PUBLISH_TOKEN not configured" },
      { status: 503 },
    );
  }

  const rawDate = (body.date ?? "today").trim();
  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "db unavailable" }, { status: 503 });
  await ensureContentSchema(sql);

  const rows = (await (rawDate === "today"
    ? sql`
        SELECT scheduled_for, theme, prompt, asset_url, caption,
               media_type, aspect_ratio, posted_at, permalink,
               children_urls, cross_post_fb
        FROM content_calendar
        WHERE scheduled_for = CURRENT_DATE
        LIMIT 1;
      `
    : /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
      ? sql`
          SELECT scheduled_for, theme, prompt, asset_url, caption,
                 media_type, aspect_ratio, posted_at, permalink,
                 children_urls, cross_post_fb
          FROM content_calendar
          WHERE scheduled_for = ${rawDate}::date
          LIMIT 1;
        `
      : Promise.resolve([] as Row[]))) as Row[];

  if (rows.length === 0) {
    return NextResponse.json({ error: "no content for date" }, { status: 404 });
  }
  const row = rows[0];
  if (row.posted_at) {
    return NextResponse.json({
      ok: false,
      reason: "already posted",
      permalink: row.permalink,
    });
  }

  // Normalize date string for the mark step (DB returns ISO timestamp).
  const dateStr = new Date(row.scheduled_for).toISOString().slice(0, 10);

  let outcome: PublishOutcome;
  switch (row.media_type) {
    case "IMAGE":
    case "STORIES":
      outcome = await publishImageOrStories(token, row);
      break;
    case "CAROUSEL_ALBUM":
      outcome = await publishCarousel(token, row);
      break;
    case "REELS":
      outcome = await publishReels(token, row);
      break;
    default:
      outcome = {
        ok: false,
        media_id: null,
        permalink: null,
        error: `unknown media_type: ${row.media_type}`,
      };
  }

  let fbResult: { ok: boolean; error: string | null } | null = null;
  if (outcome.ok && row.cross_post_fb && row.media_type === "IMAGE") {
    try {
      fbResult = await crossPostFB(token, row);
    } catch (e) {
      fbResult = { ok: false, error: (e as Error).message };
    }
  }

  // Mirror /api/content/mark-posted: only stamp posted_at on success.
  const errMsg = outcome.ok ? null : outcome.error;
  await sql`
    UPDATE content_calendar SET
      posted_at     = CASE WHEN ${errMsg}::text IS NULL THEN NOW() ELSE posted_at END,
      permalink     = COALESCE(${outcome.permalink}, permalink),
      ig_media_id   = COALESCE(${outcome.media_id}, ig_media_id),
      error_message = ${errMsg},
      updated_at    = NOW()
    WHERE scheduled_for = ${dateStr}::date;
  `;

  return NextResponse.json({
    ok: outcome.ok,
    date: dateStr,
    media_type: row.media_type,
    permalink: outcome.permalink,
    ig_media_id: outcome.media_id,
    error: outcome.error,
    fb_cross_post: fbResult,
  });
}
