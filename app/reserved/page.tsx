import type { Metadata } from "next";
import Link from "next/link";
import { getStripe, SHIP_DATE } from "@/app/lib/stripe";
import { getSql, ensureSmsSchema } from "@/app/lib/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "You're locked in — Braintech",
  robots: { index: false, follow: false },
};

type SearchParams = Promise<{ session_id?: string }>;

async function confirmAndRecord(sessionId: string): Promise<{
  paid: boolean;
  email?: string;
}> {
  const stripe = getStripe();
  if (!stripe) return { paid: false };
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const paid = session.payment_status === "paid";
    const email = (
      session.customer_email ??
      session.customer_details?.email ??
      session.metadata?.email ??
      ""
    )
      .trim()
      .toLowerCase();

    // Fallback in case the webhook hasn't landed yet.
    if (paid && email) {
      const sql = getSql();
      if (sql) {
        try {
          await ensureSmsSchema(sql);
          await sql`
            UPDATE leads SET
              deposit_paid = TRUE,
              deposit_amount = COALESCE(${session.amount_total ?? null}, deposit_amount),
              deposit_at = COALESCE(deposit_at, NOW()),
              stripe_session_id = ${session.id},
              updated_at = NOW()
            WHERE email = ${email};
          `;
        } catch {
          /* webhook will reconcile */
        }
      }
    }
    return { paid, email };
  } catch {
    return { paid: false };
  }
}

export default async function ReservedPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const { session_id } = await searchParams;
  const result = session_id ? await confirmAndRecord(session_id) : { paid: false };

  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-20">
      <div className="w-full max-w-lg rounded-2xl border border-[var(--color-rule)] bg-white p-8 text-center shadow-[0_1px_0_rgba(0,0,0,0.04)] sm:p-12">
        {result.paid ? (
          <>
            <div className="mx-auto grid size-14 place-items-center rounded-full bg-[var(--color-accent)]/15 text-[var(--color-accent)]">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className="size-7">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h1 className="serif mt-6 text-4xl tracking-[-0.02em]">
              Your device is locked in.
            </h1>
            <p className="mt-4 text-lg text-[var(--color-ink-soft)]">
              You&apos;re one of the first 1,000 founding members. Your $50
              deposit is applied toward your $249/yr membership and is fully
              refundable.
            </p>
            <div className="mt-6 rounded-xl border border-[var(--color-rule)] bg-[var(--color-cream)] p-5 text-left text-sm">
              <Row label="Reservation" value="Founding device #1 of 1,000" />
              <Row label="Deposit" value="$50 (refundable)" />
              <Row label="Ships" value={`Worldwide · ${SHIP_DATE}`} />
              {result.email ? <Row label="Confirmation to" value={result.email} /> : null}
            </div>
            <p className="mt-6 text-sm text-[var(--color-ink-soft)]">
              We&apos;ll text you to finish setup and confirm shipping before
              your batch ships. Talk soon!
            </p>
          </>
        ) : (
          <>
            <h1 className="serif text-3xl tracking-[-0.02em]">
              We couldn&apos;t confirm that payment.
            </h1>
            <p className="mt-4 text-[var(--color-ink-soft)]">
              If you completed checkout, your spot is safe — you&apos;ll get a
              confirmation shortly. Otherwise you can try again from the
              waitlist.
            </p>
          </>
        )}
        <Link
          href="/"
          className="mt-8 inline-flex items-center justify-center rounded-lg bg-[var(--color-ink)] px-6 py-3 text-base font-medium text-[var(--color-cream)] transition hover:bg-[var(--color-accent)]"
        >
          Back to braintech
        </Link>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--color-rule)] py-2 last:border-0">
      <span className="text-[var(--color-ink-soft)]">{label}</span>
      <span className="font-medium text-[var(--color-ink)]">{value}</span>
    </div>
  );
}
