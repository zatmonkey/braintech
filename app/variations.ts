export type Variation = {
  id: string;
  eyebrow: string;
  headlineTop: string;
  headlineAccent: string;
  subhead: string;
  cta: string;
};

export const VARIATIONS: Variation[] = [
  {
    id: "0",
    eyebrow: "First batch — 1,000 devices",
    headlineTop: "Your kid wants TikTok.",
    headlineAccent: "Make them earn it.",
    subhead:
      "A small device plugs between your router and your Wi-Fi. You text it like a friend. It turns every screen in your house into something your kid has to earn.",
    cta: "Reserve a founding device →",
  },
  {
    id: "1",
    eyebrow: "First 1,000 founding members",
    headlineTop: "Make your kids",
    headlineAccent: "smart again.",
    subhead:
      "Text-message parental control that turns screen time into learning time. The defense against brainrot you wish you'd had.",
    cta: "Claim a founding device →",
  },
  {
    id: "2",
    eyebrow: "Limited to 1,000 households",
    headlineTop: "The ultimate defense",
    headlineAccent: "against brainrot.",
    subhead:
      "One tiny box between your router and your Wi-Fi. Text the rules in plain English. Your kid earns TikTok by watching a TED talk.",
    cta: "Reserve a founding device →",
  },
  {
    id: "3",
    eyebrow: "First batch — 1,000 devices",
    headlineTop: "Parental controls that",
    headlineAccent: "make your kids smarter.",
    subhead:
      "Control every screen in your home by text message. Turn screen time into earned learning time. No app for your kid to delete.",
    cta: "Join the waitlist →",
  },
  {
    id: "4",
    eyebrow: "Founding members — 1,000 devices",
    headlineTop: "Stop fighting about screens.",
    headlineAccent: "Make them earn them.",
    subhead:
      "Text a rule. We enforce it. Your kid finishes a Khan Academy problem before YouTube. Reads 20 minutes before Roblox. You stay the good parent.",
    cta: "Reserve your spot →",
  },
];

export function getVariation(raw: string | string[] | undefined): Variation {
  const id = Array.isArray(raw) ? raw[0] : raw;
  if (!id) return VARIATIONS[0];
  const found = VARIATIONS.find((v) => v.id === id);
  return found ?? VARIATIONS[0];
}
