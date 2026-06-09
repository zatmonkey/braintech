# Braintech Organic Content Plan — v1 (30 days)

This is the playbook that drives `content_calendar`. It's editable at
[`/app/calendar`](/app/calendar) for any email in `ADMIN_EMAILS`
(default: `alex@ksso.net`).

## The strategy in one paragraph

Braintech is a $249/yr SMS-controlled router-level parental-control device.
The audience — US parents 28-55, anxious about screens, tired of being
the bad guy — has been beaten over the head with fear-bait content for
years. **The winning organic move is to be the calm, research-backed,
practical voice.** We don't sell the device; we sell the household
practice. The device is the implicit answer to every post.

Hero verbal property: **"Screen time without the fight. Peace of mind, by text."**

Two phrases we want to own outright (use them every week so they stick):

1. **"Rule of the Week"** — recurring Tuesday post format: one real
   text rule + why it works + invite to comment.
2. **"The first quiet evening"** — recurring testimonial framing for the
   exact emotional moment Braintech delivers.

## Four pillars

| Pillar | Weekly weight | Why |
|---|---|---|
| **Problem Awareness** (research-backed stats) | 30% | Establishes credibility. Cite sources. Never doom-without-hope. |
| **Testimonials & Rule of the Week** | 25% | Social proof + concrete utility. The text bubble is the hero visual. |
| **Educational** ("what kids learn instead") | 20% | We don't want to be anti-screen. We want to be a guide to BETTER screens. |
| **Engagement prompts** | 15% | Comment-driving. Builds the small early community. |
| **Brand / Founder voice** | 10% | Humanizes. Founder-as-honest-parent is the highest-trust register in this category (Aro / ScreenStrong / Bobbie all do this). |

## Weekly template

| Day | Post | Pillar | Format priority |
|---|---|---|---|
| Mon | Stat of the week | Problem Awareness | Single-image stat card (becomes a carousel once we ship that surface) |
| Tue | Rule of the Week | Testimonial / Rule | Quote-style single image, text-bubble visual |
| Wed | What kids learn instead | Educational | Short reel ideally; v1 single image |
| Thu | Reply prompt | Engagement | Question + comment bait |
| Fri | Founder / first quiet evening | Brand | Founder voice OR testimonial |
| Sat, Sun | (stories only — rest day for feed) | — | Reshare best comments, polls |

## Cadence rationale

5 feed posts/week. Sources: Lovevery (61% video share, publicly stated)
+ Buffer/Sprout 2026 benchmark reports (3–4 reels + 2 carousels + 1
stat-static recommended). For a 2-follower account in weeks 1–8 the goal
is **format consistency, not virality** — chase recognizability before
reach. Don't post 12 times a week; post 5 you can defend.

## What stays out

- **Fear-bait.** Bark uses it well at 80k followers, but it burns trust
  at our size.
- **"Founding member" / "first 1,000" framing.** Tested → rejected by
  our user, see [[braintech-positioning]] memory.
- **Built-in-Australia or other false-provenance claims.** US-based founder.
- **The 8-second goldfish attention-span stat.** It's debunked (and never
  came from Microsoft). Use "23 minutes to recover from each
  interruption" — Gloria Mark, UC Irvine — instead.

## 30-day calendar at a glance

Jun 10-12 already covered by the existing one-shot routines (Assets 4,
2-baked, 3-baked). Cron routine starts publishing from the calendar on
Fri Jun 13.

```
Wk 1   Mon              Tue               Wed                Thu                Fri
Jun 13                                                                          Founder origin
Jun 16-19 Stat #1       Rule #1: Roblox   3 docs kids        "One rule you      —
                        after reading     finish             wish your phone…"

Wk 2 Jun 23-27
       Stat #2          Rule #2: YouTube  Khan Academy as    "Reply with the    Founder BTS:
       (273 notifs)     off 90m before    only app           rule that saved    "exact text I
                        bed                                  your dinner"       sent tonight"

Wk 3 Jun 30 – Jul 4
       Stat #3          Rule #3: Snap     5 TED-Eds          "Tag a parent      Before/after
       ("screen time    after dishwasher  under 6 min        friend stuck"      Tuesday
       wrong metric")
                                                                                7/4: First quiet
                                                                                evening quote

Wk 4 Jul 7-10
       Stat #4          Rule #4: Wi-Fi    "What our beta     "Drop your         —
       (Haidt's 4       pauses at         kids do in the     weirdest text
       norms)           dinner            90m after"         rule"
```

## KPIs to watch (weekly)

| Metric | Healthy range (weeks 1-4) | Source |
|---|---|---|
| Account followers | +5-15/wk organic | IG insights |
| Save rate on stat posts | >2% | IG insights |
| Comment count on engagement Thursdays | 5-15 per post | IG |
| Click-through to bio link from posts | 1-3% of impressions | bio URL UTM in landing |
| `/api/waitlist` leads attributed to organic IG (utm_source=ig_organic) | 1-3/week | DB |

If the engagement Thursdays consistently get >20 comments, that's the
break-out signal. Lean into them.

## Sources

The research foundation for every stat in the calendar:

- **Common Sense Media** — *Census 2025 (Zero to Eight)*; *Constant Companion 2023*; *Census: Tweens & Teens*
- **U.S. Surgeon General** — Social Media and Youth Mental Health Advisory (May 2023)
- **CDC** — YRBS 2023 / MMWR 2024 supplement
- **Jean Twenge** — *Generations* (2023)
- **Jonathan Haidt** — *The Anxious Generation* (2024)
- **Hirsh-Pasek et al.** — "How Educational Are Educational Apps?" PMC 2022
- **Chang et al.** — PNAS 2015 (e-reader melatonin study)
- **Peter Gray** — *The Decline of Play*, Journal of Pediatrics 2023
- **Renaissance Learning** — *What Kids Are Reading* (2017–2024)
- **Gloria Mark** — UC Irvine, attention-recovery research

## Phase 2 (after week 4)

If conversion to bio link holds up, Phase 2 expands:

1. **Add CAROUSEL_ALBUM support** to the cron routine (currently single-image only).
2. **Add REELS support** with video gen via Higgsfield Marketing Studio.
3. **Add cross-post to FB Page** (we already have `pages_manage_posts` scope).
4. **Build a "Rules That Work" library page** on getbraintech.com using
   the calendar entries themselves as content. Each Tuesday post becomes
   a row on the public library. Drives SEO + a reason to come back.
5. **Founder reel series** if any Friday founder post breaks past 50
   plays/likes — lean into that format.
6. **Influencer outreach** to the smaller niche creators (Lulu DePlus,
   Raising Wireless and Thriving, etc.) — gift them a device, ask
   nothing, see who posts.

## How to operate this

- **Daily**: nothing. The 9am PT cron routine reads today's row and posts.
- **Weekly (Sunday review)**: open [`/app/calendar`](/app/calendar), check that the
  upcoming 7 days have asset URLs filled in (the row card shows a yellow
  "needs asset" badge if not). Generate any missing assets via Higgsfield
  CLI, host at `/public/ig/calendar-YYYY-MM-DD.jpg`, paste the URL into
  the row.
- **Monthly**: review what posted, what landed, what didn't. Edit the
  template for the next 30 days.
