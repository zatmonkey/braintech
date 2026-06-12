/**
 * Local-network self-registration for /mine.
 *
 * When a device on the home LAN visits brain.local (/mine) and isn't
 * yet attached to a kid/adult group, the page shows a one-time form
 * asking who's using this device + what to call it. This endpoint
 * commits the decision:
 *   - upserts client_labels.name (the device label)
 *   - inserts client_group_memberships (the person ownership)
 *   - optionally creates a new account_groups row first
 *
 * Auth model: same as the rest of /mine — anyone on the home network
 * with a MAC the agent has seen can self-register. There is no
 * password layer; physical access to the LAN is the trust boundary.
 *
 * Hard guard: a MAC already attached to a kid/adult group can NOT
 * self-register again — this is one-shot. Parents can move/edit on
 * the dashboard.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import {
  getSql,
  ensureDeviceSchema,
  ensureAccountSchema,
  ensureDefaultGroup,
} from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  mac?: string;
  label?: string;
  // Exactly one of these two should be set.
  existing_group_id?: string;
  new_group?: { person_name?: string; kind?: "kid" | "adult" };
};

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid JSON" }, { status: 400 });
  }

  const mac = (body.mac ?? "").toLowerCase().trim();
  if (!/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/.test(mac)) {
    return NextResponse.json({ ok: false, reason: "bad mac" }, { status: 400 });
  }
  const label = (body.label ?? "").trim().slice(0, 64);
  if (!label) {
    return NextResponse.json(
      { ok: false, reason: "label required (what should we call this device?)" },
      { status: 400 },
    );
  }

  const sql = getSql();
  if (!sql) return NextResponse.json({ ok: false, reason: "unavailable" }, { status: 503 });
  await ensureDeviceSchema(sql);
  await ensureAccountSchema(sql);

  // 1) Resolve the owner from the MAC's last-seen row.
  const owners = (await sql`
    SELECT owner_email FROM client_last_seen
    WHERE mac = ${mac}
    ORDER BY last_seen DESC LIMIT 1;
  `) as { owner_email: string }[];
  if (owners.length === 0) {
    return NextResponse.json(
      { ok: false, reason: "this device isn't recognised on the network yet — give it a minute" },
      { status: 404 },
    );
  }
  const owner = owners[0].owner_email;

  // 2) Hard guard: already attached to any person group → refuse.
  // ("Person group" = any non-default group; default 'All devices'
  // isn't a person, so being a member of it doesn't count.)
  const already = (await sql`
    SELECT g.group_id
    FROM client_group_memberships cgm
    JOIN account_groups g
      ON g.group_id = cgm.group_id AND g.owner_email = cgm.owner_email
    WHERE cgm.owner_email = ${owner}
      AND cgm.mac = ${mac}
      AND g.is_default = FALSE
    LIMIT 1;
  `) as { group_id: string }[];
  if (already.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        reason: "this device is already attached to a person — ask a parent to move it on the dashboard",
      },
      { status: 409 },
    );
  }

  // 3) Resolve the target group_id — either an existing kid/adult
  // group or a newly created one.
  let groupId: string;
  if (body.existing_group_id) {
    const id = String(body.existing_group_id).trim();
    const ok = (await sql`
      SELECT 1 FROM account_groups
      WHERE owner_email = ${owner}
        AND group_id = ${id}
        AND is_default = FALSE
      LIMIT 1;
    `) as { 1: number }[];
    if (ok.length === 0) {
      return NextResponse.json(
        { ok: false, reason: "that group doesn't exist for this household" },
        { status: 400 },
      );
    }
    groupId = id;
  } else if (body.new_group?.person_name) {
    const personName = String(body.new_group.person_name).trim().slice(0, 64);
    const kind: "kid" | "adult" =
      body.new_group.kind === "adult" ? "adult" : "kid";
    if (personName.length < 1) {
      return NextResponse.json(
        { ok: false, reason: "person name required" },
        { status: 400 },
      );
    }
    // Make sure the default 'All devices' group exists first so the
    // account is in a sane state, then create the new person group.
    await ensureDefaultGroup(sql, owner);
    groupId = `grp_${randomBytes(4).toString("hex")}`;
    await sql`
      INSERT INTO account_groups (group_id, owner_email, name, kind, person_name, is_default)
      VALUES (${groupId}, ${owner}, ${personName}, ${kind}, ${personName}, FALSE);
    `;
  } else {
    return NextResponse.json(
      { ok: false, reason: "pass either existing_group_id or new_group.person_name" },
      { status: 400 },
    );
  }

  // 4) Apply the writes. Idempotent on conflict.
  await sql`
    INSERT INTO client_group_memberships (owner_email, mac, group_id)
    VALUES (${owner}, ${mac}, ${groupId})
    ON CONFLICT (owner_email, mac, group_id) DO NOTHING;
  `;
  await sql`
    INSERT INTO client_labels (owner_email, mac, name, group_id)
    VALUES (${owner}, ${mac}, ${label}, ${groupId})
    ON CONFLICT (owner_email, mac) DO UPDATE SET
      name      = EXCLUDED.name,
      group_id  = EXCLUDED.group_id;
  `;

  return NextResponse.json({ ok: true, group_id: groupId });
}
