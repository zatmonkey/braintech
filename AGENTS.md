<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Next 16 gotchas verified in this codebase

- **`middleware.ts` was renamed to `proxy.ts`.** Lives at project root, same shape (`export function proxy(req: NextRequest)`, `export const config = { matcher: [...] }`). Recognized by build as `ƒ Proxy (Middleware)`.
- **`cookies()` and `headers()` are async** — `const store = await cookies()`. Component must be `async`.
- **Route handlers**: `app/api/.../route.ts` exports `GET`, `POST`, etc. Use `runtime = "nodejs"` for anything touching `crypto`, the Neon SDK, or Stripe.
- Before changing anything in `app/`, check `node_modules/next/dist/docs/01-app/` for the current API.

## Project architecture

**Variation rotation + sticky-cookie A/B.** `app/variations.ts` is the source of truth — 7 entries, `mode: "waitlist" | "buyNow"`. `proxy.ts` assigns `bt_var` cookie (random 0..N-1) on first visit; `?variation=N` overrides + pins; returning visitors stay sticky for 30 days. `page.tsx` reads the cookie via `cookies()`. Keep `proxy.ts` `TOTAL_VARIATIONS` in sync when adding variations.

**Localized pricing.** `app/lib/pricing.ts` is the **only** source of currency/amount. Hand-tuned marketing prices per currency (charm-priced, not live FX). 8 currencies supported (USD/AUD/NZD/GBP/EUR/CAD/SGD/JPY). `proxy.ts` stamps `bt_geo` cookie from `x-vercel-ip-country` (also accepts `?country=AU` for previews). `/api/checkout` is the server-side authority — **never trust client-supplied prices**. Env-var overrides: `BT_PRICE_<CURRENCY>_<DEPOSIT|PURCHASE>` (major units, e.g. `BT_PRICE_AUD_DEPOSIT=89`).

**Meta Pixel + Conversions API (full duplex with browser↔server dedup).** Browser events fire `fbq("track", EVENT, params, {eventID})`. Server fires the same event via CAPI with `event_id` matching the browser's `eventID`. Meta dedupes in its 7-day window. Helper: `app/lib/meta-capi.ts` (`sendCapiLead`, `sendCapiPurchase`, `sendCapiCancel`, `readMetaCookies`). PII (em/ph/country) is SHA256-hashed before send. `_fbc` is set by `proxy.ts` from `?fbclid=` in the URL; `_fbp` is set by Pixel JS — both flow into every CAPI fire via `readMetaCookies()`. Stripe webhook reads `fbc`/`fbp` from session metadata (stashed at `/api/checkout` time) because it's server-to-server.

**Event id conventions.** Stripe `session.id` for Purchase + CheckoutCancelled (matches across browser and server). Client-generated UUID prefixed `wl_` for waitlist Lead. `chat_<sessionId>` for chat-captured Leads.

**Stripe checkout flavors.** `mode: "deposit"` (refundable spot-lock) vs `mode: "purchase"` (full annual membership, buy-now variation). Both flow through one `/api/checkout` handler; webhook reads `session.metadata.mode`. Cancel URL is `/?reserve=cancelled#waitlist` — `CancelTracker` client component detects it, fires browser + CAPI `CheckoutCancelled`, then `history.replaceState` strips the param.

**Stripe metadata is the cross-boundary bus.** Every Stripe session carries: `email`, `phone`, `variation`, `mode`, `country`, `currency`, `fbc`, `fbp`. The webhook reads these to (a) write the lead row with full attribution and (b) fire the deduplicated CAPI Purchase.

**`btnet` CLI (`scripts/btnet`).** The day-to-day admin tool. Auth via `bt_session` cookie cached at `~/.cache/btnet.cookies`. Subcommands: `state`, `clients`, `chat`, `rules`, `router`, `variations [--currency=AUD]`, `ads [period]`, `test`. Adds new ones by appending a `cmd_<name>()` bash function + case branch in `main()`. Reads `scripts/btnet.env` (gitignored) for router/Meta creds.

## Things that have been tried and don't work

- **Don't `curl | bash` installers.** The auto-mode classifier blocks pipe-to-shell. Download the tarball, then run the install script.
- **Don't deploy `ADMIN_TOKEN` style backdoors to prod.** Classifier blocks. Use proper session auth (`bt_session` + HMAC).
- **Don't auto-mutate live Meta ads via API.** Live spend — too easy to misconfigure. Give the user exact UI click-paths instead.
- **Don't use the Google Analytics Admin API for `ksso.net` accounts.** Workspace OAuth policy blocks `analytics.edit` even with the app trusted. See `~/.claude/projects/-home-alex-braintech/memory/braintech-ga-admin-blocked.md`. Use the GA4 web UI or BigQuery export instead.

## Where things live

```
app/page.tsx               Landing page; reads variation + pricing + cookies()
app/layout.tsx             GA + Pixel init; passes variation as gtag user_property
app/variations.ts          7 variation definitions (eyebrow/headline/cta/mode)
app/lib/pricing.ts         Per-currency marketing prices + env overrides
app/lib/meta-capi.ts       CAPI helpers + readMetaCookies
app/lib/checkout-stash.ts  sessionStorage for cancel-detection on the way back from Stripe
app/lib/db.ts              All schema + Neon SQL helpers
app/hero-waitlist.tsx      Above-the-fold form (waitlist/buyNow modes + success→Stripe upsell)
app/pricing-choice.tsx     Two-card toggle (waitlist vs lockIn) wrapping WaitlistForm
app/waitlist-form.tsx      Pricing-section form (3 modes: deposit/lockIn/purchase)
app/cancel-tracker.tsx     Mounts on /; fires CheckoutCancelled when ?reserve=cancelled
app/variation-tracker.tsx  POSTs view to /api/variation/track once per session
app/founding-stats.tsx     Counter + toasts + meter
app/reserved/page.tsx      Stripe success page; resolves session, fires Purchase
proxy.ts                   bt_var rotation + bt_geo + _fbc capture
scripts/btnet              Bash CLI
```

## Env vars (Vercel prod)

```
DATABASE_URL, DATABASE_URL_UNPOOLED          Neon
SESSION_SECRET                                bt_session HMAC
STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
NEXT_PUBLIC_GA_ID                             G-H7VWV8B608
META_ADS_TOKEN                                long-lived FB user token (60-day, refresh)
META_AD_ACCOUNT_ID                            2091976748021131
META_CAPI_TEST_CODE                           (only when explicitly testing in Events Manager)
META_PIXEL_TOKEN                              (optional, narrower scope than ADS_TOKEN; falls back to ADS_TOKEN)
TWILIO_*, ANTHROPIC_API_KEY, RESEND_API_KEY   See braintech-deploy memory
BT_PRICE_<CUR>_<DEPOSIT|PURCHASE>             Optional price override (major units)
```

## Loud rule

If the user has been running ads or live commerce, treat any change to `/api/checkout`, `/api/stripe/webhook`, `app/lib/pricing.ts`, `app/lib/meta-capi.ts`, or `proxy.ts` as production-critical. Type-check + `next build` BEFORE deploy. Smoketest the changed path after deploy (`btnet variations`, the curl smoke tests in `/tmp` for waitlist/checkout/cancel).
