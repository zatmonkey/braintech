/**
 * Set a group's `kind` (and optional `person_name` / `age`). Used by:
 *   - dashboard inline kind picker on the group toolbar
 *   - Bri's set_group_kind tool
 *
 * Body: { group_id, kind: 'kid' | 'adult' | null, person_name?, age? }
 *   - kind=null clears the kind back to "unset"
 *   - person_name and age are optional; if omitted, existing values stay
 */
import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { verifySession, sessionCookie } from "@/app/lib/auth";
import {
  getSql,
  ensureDeviceSchema,
  ensureAccountSchema,
} from "@/app/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const store = await cookies();
  const email = verifySession(store.get(sessionCookie.name)?.value);
  if (!email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: {
    group_id?: string;
    kind?: "kid" | "adult" | null;
    person_name?: string | null;
    age?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const group_id = String(body.group_id ?? "").trim();
  if (!/^grp_[a-f0-9]{6,}$/.test(group_id)) {
    return NextResponse.json({ error: "bad group_id" }, { status: 400 });
  }
  if (body.kind !== null && body.kind !== "kid" && body.kind !== "adult") {
    return NextResponse.json(
      { error: "kind must be 'kid' | 'adult' | null" },
      { status: 400 },
    );
  }
  const personName =
    typeof body.person_name === "string" ? body.person_name.trim().slice(0, 64) : null;
  const ageRaw =
    body.age === null || body.age === undefined ? null : Math.floor(Number(body.age));
  const age = ageRaw !== null && Number.isFinite(ageRaw) && ageRaw > 0 ? ageRaw : null;

  const sql = getSql();
  if (!sql) return NextResponse.json({ error: "db unavailable" }, { status: 503 });
  await ensureDeviceSchema(sql);
  await ensureAccountSchema(sql);

  // Ownership check.
  const owned = (await sql`
    SELECT 1 FROM account_groups
    WHERE owner_email = ${email} AND group_id = ${group_id} LIMIT 1;
  `) as { 1: number }[];
  if (owned.length === 0) {
    return NextResponse.json({ error: "not your group" }, { status: 404 });
  }

  // COALESCE on the optional fields so a partial update doesn't clobber
  // existing values — pass null to keep current, pass an explicit value
  // to overwrite.
  await sql`
    UPDATE account_groups
       SET kind        = ${body.kind ?? null},
           person_name = COALESCE(${personName}, person_name),
           age         = COALESCE(${age}, age),
           updated_at  = NOW()
     WHERE owner_email = ${email} AND group_id = ${group_id};
  `;
  return NextResponse.json({ ok: true });
}
