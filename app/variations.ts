export type Variation = {
  id: string;
  eyebrow: string;
  headlineTop: string;
  headlineAccent: string;
  subhead: string;
  // The default hero CTA — for waitlist variations this is the
  // "join the (free) queue" button. variations.ts:5
  cta: string;
  // What the form actually does. Most variations submit an email and then
  // upsell the deposit; the "buyNow" variation skips the queue and goes
  // straight to the $249/yr Stripe checkout — no waitlist, no deposit.
  mode: "waitlist" | "buyNow";
};

// Copy convention: lead with "Next 1,000 ship Sept 1" — concrete, near-term,
// and nobody wants to be "first". Don't mention price above the fold.

export const VARIATIONS: Variation[] = [
  {
    id: "0",
    eyebrow: "Next 1,000 devices ship September 1",
    headlineTop: "Your kid wants TikTok.",
    headlineAccent: "Make them earn it.",
    subhead:
      "A small device plugs between your router and your Wi-Fi. You text it like a friend. It turns every screen in your house into something your kid has to earn. Drop your email — we'll let you know when the next batch is ready.",
    cta: "Join the waitlist — free →",
    mode: "waitlist",
  },
  {
    id: "1",
    eyebrow: "Next 1,000 ship September 1",
    headlineTop: "Make your kids",
    headlineAccent: "smart again.",
    subhead:
      "Text-message parental control that turns screen time into learning time. The defense against brainrot you wish you'd had. Free to join — we email you when the next batch is ready.",
    cta: "Join the waitlist — free →",
    mode: "waitlist",
  },
  {
    id: "2",
    eyebrow: "Next 1,000 households · ships September 1",
    headlineTop: "The ultimate defense",
    headlineAccent: "against brainrot.",
    subhead:
      "One tiny box between your router and your Wi-Fi. Text the rules in plain English. Your kid earns TikTok by watching a TED talk. Drop your email — we'll let you know when the next batch is ready.",
    cta: "Join the waitlist — free →",
    mode: "waitlist",
  },
  {
    id: "3",
    eyebrow: "Next 1,000 devices ship September 1",
    headlineTop: "Parental controls that",
    headlineAccent: "make your kids smarter.",
    subhead:
      "Control every screen in your home by text message. Turn screen time into earned learning time. No app for your kid to delete. Drop your email — we email when devices are ready.",
    cta: "Join the waitlist — free →",
    mode: "waitlist",
  },
  {
    id: "4",
    eyebrow: "Next 1,000 devices ship September 1",
    headlineTop: "Stop fighting about screens.",
    headlineAccent: "Make them earn them.",
    subhead:
      "Text a rule. We enforce it. Your kid finishes a Khan Academy problem before YouTube. Reads 20 minutes before Roblox. You stay the good parent. We email you the moment the next batch is ready.",
    cta: "Join the waitlist — free →",
    mode: "waitlist",
  },
  {
    // Mirrors the IG ad copy ("Simplify parental controls / peace of mind").
    // This is the variation paid social traffic should land on. proxy.ts
    // pins fbclid visitors here.
    id: "5",
    eyebrow: "Next 1,000 devices ship September 1",
    headlineTop: "Simplify parental controls.",
    headlineAccent: "Peace of mind, by text.",
    subhead:
      "Manage every screen in your home with simple text commands. No apps for your kids to delete. No dashboards to babysit. Drop your email — we'll let you know when the next batch is ready.",
    cta: "Join the waitlist — free →",
    mode: "waitlist",
  },
  {
    // Direct-buy variation: no waitlist, no deposit. Full $249/yr membership
    // upfront, device ships in the next batch. For visitors who already
    // know they want it.
    id: "6",
    eyebrow: "Ships September 1 · device included",
    headlineTop: "Skip the waitlist.",
    headlineAccent: "Get it on day one.",
    subhead:
      "$249 for your first year — device included, ships worldwide September 1. No queue, no deposit, no waiting. Just text it the rules and let your kid earn their screens back.",
    cta: "Buy now — $249/yr →",
    mode: "buyNow",
  },
];

export function getVariation(raw: string | string[] | undefined): Variation {
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id) return VARIATIONS[0];
  const found = VARIATIONS.find((v) => v.id === id);
  return found ?? VARIATIONS[0];
}
