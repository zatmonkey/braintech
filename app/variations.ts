export type Variation = {
  id: string;
  eyebrow: string;
  headlineTop: string;
  headlineAccent: string;
  subhead: string;
  // Hero CTA copy for the email-capture button (the "Get 10% off" flow).
  cta: string;
};

// Phase 4 copy rules:
//  - No "founding", "first 1,000", "next 1,000", "join the waitlist", or
//    "ships September 1" framing — visitors found this confusing and
//    "founding" reads as risky to AU mum-target. Ship date stays in fine
//    print + FAQ only.
//  - One funnel: email → 10% off discount → buy the device. Subscription
//    starts when the device ships (mentioned once in fine print).
//  - Permission / relief framing, not control / fight / earn / brainrot.
//  - Australian English ("mum") where the variation is AU-targeted.

export const VARIATIONS: Variation[] = [
  {
    id: "0",
    eyebrow: "Screen time without the fight",
    headlineTop: "Get dinner back.",
    headlineAccent: "Text your way there.",
    subhead:
      "A small device plugs between your router and your Wi-Fi. You text it the rules — bedtime, homework first, no Roblox until reading. It quietly looks after every screen in the house. Drop your email and we'll send you 10% off your device.",
    cta: "Get 10% off →",
  },
  {
    id: "1",
    eyebrow: "A calmer house, by text",
    headlineTop: "The screen-time fight",
    headlineAccent: "doesn't have to be yours.",
    subhead:
      "Plug one little box between your router and your Wi-Fi. Text it your house rules. It handles every screen — phones, iPads, the lot — so you don't have to be the bad guy. Email = 10% off when you order.",
    cta: "Get 10% off →",
  },
  {
    id: "2",
    eyebrow: "Made for parents, not IT people",
    headlineTop: "If you can plug in a lamp,",
    headlineAccent: "you can run this.",
    subhead:
      "One tiny box between your router and your Wi-Fi. Text the rules in plain English. The kids' devices keep working — just on your terms. Drop your email for 10% off.",
    cta: "Get 10% off →",
  },
  {
    id: "3",
    eyebrow: "Screen time, the easy way",
    headlineTop: "Parents who'd rather",
    headlineAccent: "not fight about screens.",
    subhead:
      "Manage every screen in your home by text message. No apps for the kids to delete, no dashboards to babysit. We'll email you a 10% off code when you drop your address.",
    cta: "Get 10% off →",
  },
  {
    id: "4",
    eyebrow: "Take the evening back",
    headlineTop: "Stop fighting about screens.",
    headlineAccent: "Get peace of mind back.",
    subhead:
      "Text a rule — \"no YouTube until 20 minutes of reading\" — and it just happens. You stay the good parent, the device does the saying-no. Email us and we'll knock 10% off.",
    cta: "Get 10% off →",
  },
  {
    // Continues the UGC ad story: "For two years, I was losing him to a
    // screen..." → "Stop losing them to the screen." This is the variation
    // paid social traffic should land on. proxy.ts pins fbclid visitors
    // here AND /start hard-pins to it.
    id: "5",
    eyebrow: "For parents who'd rather not fight",
    headlineTop: "Stop losing them",
    headlineAccent: "to the screen.",
    subhead:
      "One small box. Text it your rules. Your kid earns TikTok, YouTube and Roblox by learning — a Khan Academy lesson, a TED talk, 20 minutes of reading. No app on their phone to delete.",
    cta: "Get 10% off your founding spot →",
  },
  {
    id: "6",
    eyebrow: "Skip the email step",
    headlineTop: "Already sold?",
    headlineAccent: "Order yours now.",
    subhead:
      "Get the device, set it up in 90 seconds, and text your way to calmer evenings. Your subscription starts the day your device ships.",
    cta: "Order yours →",
  },
];

export function getVariation(raw: string | string[] | undefined): Variation {
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id) return VARIATIONS[0];
  const found = VARIATIONS.find((v) => v.id === id);
  return found ?? VARIATIONS[0];
}
