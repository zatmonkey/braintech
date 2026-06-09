-- Braintech IG content calendar — 30-day v1 seed
--
-- Mapping:
--  - Mon = Stat / Problem Awareness (carousel, simplified to single hero card)
--  - Tue = Rule of the Week (quote-style single image)
--  - Wed = "What kids learn instead" (educational, single image)
--  - Thu = Engagement prompt (comment-driving)
--  - Fri = Brand / Founder / "First Quiet Evening" testimonial
--  - Sat/Sun = skip (stories rest day)
--
-- Source research: see docs/marketing-plan.md.
--
-- The first 3 days (Jun 10-12) are covered by the existing one-shot
-- routines (Assets 4, 2-baked, 3-baked). Calendar starts Fri Jun 13.

-- Idempotency: clear any existing rows in the window we're seeding so
-- re-running doesn't ON-CONFLICT-explode if columns shift.
DELETE FROM content_calendar WHERE scheduled_for BETWEEN '2026-06-13' AND '2026-07-10';

-- ============================================================
-- WEEK 1 — Jun 13 → Jun 19
-- ============================================================

INSERT INTO content_calendar (scheduled_for, theme, asset_url, caption, media_type, aspect_ratio, prompt) VALUES
('2026-06-13', 'brand_founder',
 'https://getbraintech.com/hero-mum-kitchen.webp',
 'Three Sunday afternoons in a row, the same fight. "Just one more episode." "Just five more minutes." "But Liam''s mom said yes."

I''m a tech person. So I figured I''d write something to handle it.

Braintech is a little box that sits between our home internet and our Wi-Fi. We text it the rules. It does the saying-no.

Last Sunday was the first quiet one I can remember.

Drop your email for 10% off when we ship. Link in bio.

#parenting #screentime #parentingtips #digitalwellness #parentsofinstagram #momlife #dadlife',
 'IMAGE', '16:9', NULL),

('2026-06-16', 'problem_awareness', NULL,
 'A few numbers we keep coming back to.

→ Teen depression rates doubled between 2011 and 2021.
→ 273: median phone notifications a teen gets in a day.
→ 60–90 minutes: nightly sleep kids lose when their phone is in their bedroom.
→ 23 minutes: time the brain needs to recover from one interruption.

We''re not anti-screen. We''re anti this exact pattern.

Sources: Twenge (2023), Common Sense Media (2023), AAP Sleep Review (2024), Gloria Mark / UC Irvine. Save this. Send it to the parent who said "I can''t fight this" last week.

Link in bio if you want the household tool we built around the research.

#screentime #parentingtips #digitalwellness #anxiousgeneration #parentsofinstagram #raisingkids',
 'IMAGE', '1:1',
 'Editorial-style overhead photograph, 1:1 square. A clean warm-toned wooden table from directly above. A handwritten note on a single piece of cream paper centered, with one bold stat in ink. Soft natural morning light. A small notebook, a fountain pen, and a ceramic coffee mug just visible at the edges. Premium quiet aesthetic à la Lovevery educational posts. Lots of negative space at top and bottom for text overlay.'),

('2026-06-17', 'rule_of_the_week', NULL,
 '🟠 Rule of the Week #1:

"No Roblox until 20 minutes of reading + a one-sentence summary in our family group chat."

Three things this does at once:

1. Stops the negotiation. The device says no — not you.
2. Gives the screen value. It''s earned, not entitled.
3. Builds a tiny ritual. The summary is the win, not the screen.

One text — "no Roblox until 20 min reading + summary" — and Braintech enforces it across every device on your home Wi-Fi until it''s done.

What rule would yours be? Drop it in the comments.

#parenting #screentime #ruleoftheweek #parentingtips #momlife #dadlife',
 'IMAGE', '1:1',
 'Editorial photograph, 1:1 square. Close-up of an iPhone screen resting on a warm cream wooden kitchen counter. The phone shows an iMessage conversation — one outgoing blue text bubble visible (parent''s rule). Natural morning light. The Braintech device — small matte-black box with glowing orange brain icon — sits in soft focus behind the phone. Eucalyptus sprig and ceramic mug in frame. Premium warm-parent aesthetic à la Bobbie / Lalo. Negative space below the phone.'),

('2026-06-18', 'educational', NULL,
 'Wednesdays we share what kids actually love watching when the algorithm isn''t picking it.

Three documentaries parents in our beta group reported their kids sitting through the whole way, no negotiation:

→ My Octopus Teacher (Netflix, 85 min) — even the squeamish ones get hooked.
→ A Plastic Ocean (Netflix, 100 min) — turned one beta kid into a household recycling crusader.
→ Won''t You Be My Neighbor (HBO Max, 95 min) — the Mr. Rogers documentary; even teens watched all the way through.

Save for Friday family movie night.

Reply: what''s YOUR kid surprisingly sat through? We''ll share the best ones next week.

#documentary #familymovienight #parenting #screentime #raisingkids',
 'IMAGE', '1:1',
 'Editorial photograph, 1:1 square. A child around 8 years old, side profile only (no face), curled up in a soft armchair watching something on a tablet propped on a stack of hardback books. Warm evening lamp light. Cozy blanket, a glass of milk on a side table. The mood is engaged learning — the kind of stillness scrolling never produces. Premium domestic warm aesthetic. Cream and amber palette.'),

('2026-06-19', 'engagement', NULL,
 'Honest question for the parents in this feed:

What''s the ONE text rule you wish your phone could enforce on your kid''s screens?

Not the "no screens ever" dream. The specific rule you''d send if there was a device that listened.

Drop it in the comments. We''re collecting them into a "Rules That Work" carousel next month. The best one wins a free Braintech device when we ship.

#parenting #screentimerules #parentingtips #momlife #dadlife',
 'IMAGE', '1:1',
 'Editorial photograph, 1:1 square. A small notebook open on a warm wooden kitchen counter. A handwritten list of bullet points on the page — text is intentionally too small to read, just the suggestion of rules. A fountain pen resting on the notebook, a half-full coffee mug, soft morning light. Cream and amber palette. Premium calm aesthetic. Lots of negative space.'),

-- ============================================================
-- WEEK 2 — Jun 20 → Jun 26
-- ============================================================

('2026-06-20', 'brand_founder', NULL,
 'The exact text I sent tonight:

"All YouTube off in 30 min. Reading after that."

Dinner happened on time. The negotiation didn''t.

Braintech is just the thing in the middle that listens. The rule is yours. The kids are yours. We just stop being the one who has to enforce it ten times a night.

#parenting #screentime #parentingtips #momlife #dadlife',
 'IMAGE', '1:1',
 'Editorial photograph, 1:1 square. A close-up of a parent''s hand holding an iPhone, screen showing an iMessage thread with one outgoing rule visible. The phone is held at a kitchen counter angle. Warm evening light. The Braintech device — small matte-black box with glowing orange brain — visible on a wooden shelf in soft focus background. Eucalyptus, a ceramic mug. Premium warm-parent aesthetic.'),

('2026-06-23', 'problem_awareness', NULL,
 'Each notification interrupts attention. Studies put recovery cost at 23 minutes per interruption (Gloria Mark, UC Irvine).

The median teen gets 273 of those per day (Common Sense Media, 2023). 1 in 5 teens get more than 500.

That''s a kid whose attention is being redirected every 3.5 waking minutes.

We say "kids can''t focus" like it''s personal. It''s structural.

Saving this for the next school newsletter? Tag a teacher.

#anxiousgeneration #screentime #parenting #attentionspan #digitalwellness',
 'IMAGE', '1:1',
 'Editorial overhead photograph, 1:1 square. A phone face-down on a warm wood kitchen table. Around it, signs of an interrupted moment — a half-eaten breakfast plate, an open book, a coffee mug. Morning light. Premium thoughtful aesthetic. Cream and amber palette. Negative space at top.'),

('2026-06-24', 'rule_of_the_week', NULL,
 '🟠 Rule of the Week #2:

"YouTube off 90 minutes before bedtime."

The bedtime sleep research is brutal: children experience roughly twice the melatonin suppression of adults from screen light (Chang et al., PNAS 2015).

90 minutes is the magic window. Enough time for melatonin to come back online before lights out.

You don''t need a lecture. You need the Wi-Fi to listen.

One text: "no YouTube after 8pm on weeknights." Done.

What''s your bedtime rule? Comment below.

#sleephygiene #parenting #screentime #ruleoftheweek #parentingtips',
 'IMAGE', '1:1',
 'Editorial photograph, 1:1 square. An iPhone screen close-up showing an iMessage thread, one outgoing rule visible. Evening warm lamp light. The phone rests on a warm wooden bedside table with a hardback book, a glass of water, a small linen-shaded lamp. Premium calm aesthetic. Soft amber and cream palette.'),

('2026-06-25', 'educational', NULL,
 'Khan Academy is a phenomenal teacher.

It''s also one app in a sea of 10,000.

What if you could make it the ONLY app that opens between 4 and 5pm on a school day?

That''s the actual Braintech rule — "no apps for Maya 4–5pm except Khan Academy." Every other app stops loading. Khan Academy doesn''t.

20 minutes of math, then Roblox unlocks.

You didn''t have to fight. The router did the picking.

#khanacademy #parenting #screentime #educationaltech #learning',
 'IMAGE', '1:1',
 'Editorial photograph, 1:1 square. A kid (around 10, side profile, no full face) at a warm wood kitchen table working on a laptop, a notebook with math problems next to it, a glass of water. Soft late-afternoon light from a window. Cozy domestic scene. The mood is "focused, not zoned out." Premium warm aesthetic. Cream and amber.'),

('2026-06-26', 'engagement', NULL,
 'Reply with the rule that saved your dinner.

We mean it. Whatever you say to your kids about phones at the table — that one. The funny one. The one your husband rolled his eyes at and then loved.

We''ll feature the best ones in our Friday post. Anonymously if you want.

The point: most parents are figuring this out alone. Let''s not.

#parenting #screentime #familydinner #parentsofinstagram #parentingtips',
 'IMAGE', '1:1',
 'Editorial photograph, 1:1 square. A warm wooden dining table with three or four plates of food, hands of multiple people just visible holding forks (no full faces). Soft evening pendant light. Phones nowhere in frame. Family in the act of eating together. Premium domestic aesthetic. Warm amber palette.'),

-- ============================================================
-- WEEK 3 — Jun 27 → Jul 3
-- ============================================================

('2026-06-27', 'brand_founder', NULL,
 'Same kid. Same Tuesday. One text rule changed.

Before Braintech: 7pm, third hour of Roblox, dinner getting cold, the daily fight.

After: 7pm, same kid, reading. He texted ME when 20 minutes were up so the Wi-Fi would unlock his game.

Same week. Same kid. The device is just a translator — your house rule, in a language the network understands.

10% off when we ship. Drop your email — link in bio.

#parenting #beforeandafter #screentime #parentingtips #momlife #dadlife',
 'IMAGE', '1:1',
 'Editorial photograph, 1:1 square. Split-screen-style composition (left half darker, right half warmer). Left half: phone glow on a kid''s face in a slouched couch position, screen reflected in their eyes. Right half: the same kid (no clear face), sitting upright at a kitchen table with an open book, warm evening light. The contrast is mood, not text. Premium cinematic aesthetic.'),

('2026-06-30', 'problem_awareness', NULL,
 '"Screen time" is the wrong number to count.

A 30-minute coding game and a 30-minute YouTube Shorts binge aren''t the same thing. Only passive consumption is consistently linked to worse outcomes — attention, language, mood (JAMA Pediatrics 2023 meta-analysis, 232 studies).

The right question isn''t "how many hours."

It''s "what was happening in those hours?"

Save this for the parent who got told their kid uses too much "screen time" — the metric is misleading.

#parenting #screentime #digitalwellness #commonsensemedia #parentingtips',
 'IMAGE', '1:1',
 'Editorial photograph, 1:1 square. A wooden kitchen counter with two phones side by side. One shows an open puzzle/learning app interface (calm UI). The other shows a video grid with motion-blurred scrolling. Warm morning light from a window. Premium considered aesthetic. The image suggests "two different things" without text. Cream and amber palette.'),

('2026-07-01', 'rule_of_the_week', NULL,
 '🟠 Rule of the Week #3:

"Snap unlocks after the dishwasher is loaded."

The genius of this one (from a beta dad in Ohio): the kid does the chore willingly because the consequence is immediate and bypass-proof.

He texts "kitchen clean" from his own phone. Braintech checks the photo (yes, you can text it photos). Snap turns on for 30 minutes.

No nagging. No "did you do it." A clean kitchen and a kid on his terms.

What''s a chore rule that worked at your house? Drop it below.

#chores #parenting #screentime #ruleoftheweek #raisingkids',
 'IMAGE', '1:1',
 'Editorial photograph, 1:1 square. A young teen''s hands (no face) loading a dishwasher in a warm kitchen, phone in pocket visible. Soft afternoon light. The Braintech device with glowing orange brain on the counter in soft focus. Premium domestic aesthetic. Cream and amber palette.'),

('2026-07-02', 'educational', NULL,
 '5 TED-Ed videos under 6 minutes our beta kids actually finished:

→ "How tall can a tree grow?" (4:55) — they argued about this at dinner for a week.
→ "What if all the world''s food was vegetarian?" (4:10) — sparked a multi-day cooking project.
→ "Why do we feel nostalgia?" (4:34) — 11-year-old quoted it in a school paper.
→ "The chemistry of cookies" (4:30) — turned into actual baking on Sunday.
→ "Why is yawning contagious?" (3:46) — the dinner-table classic.

Common thread: short enough that "I''ll watch one" is true. Real enough that they remember it a month later.

Save for Sunday morning kitchen time.

#tededucation #parenting #learning #educationalcontent #screentime',
 'IMAGE', '1:1',
 'Editorial photograph, 1:1 square. A kid (around 10, side profile, no face) at a warm wooden kitchen counter watching a tablet propped against a stack of cookbooks, eating cereal, sunlight from a window. The screen glow is warm not blue. Premium domestic aesthetic — engaged learning, not zoned out.'),

('2026-07-03', 'engagement', NULL,
 'Tag a parent friend who said "I can''t fight the screen-time war anymore" this week.

This isn''t a sales pitch — it''s a "you''re not alone" tag. We''re building a small, sane community around households where the screen-time fight doesn''t happen anymore.

We''ll DM your friend a small welcome guide (no spam, just three rules to try this week).

#parenting #parentsofinstagram #screentime #raisingkids #parentingtips #parentingcommunity',
 'IMAGE', '1:1',
 'Editorial photograph, 1:1 square. Two coffee mugs on a warm wooden table, hands of two adults barely visible holding them, soft morning light from a window. The mood is "honest conversation between friends." Premium warm aesthetic. Cream and amber palette.'),

-- ============================================================
-- WEEK 4 — Jul 4 → Jul 10
-- ============================================================

('2026-07-04', 'brand_founder', NULL,
 '"First quiet evening I can remember. My husband actually noticed."

That''s a real quote from a mom in our beta — week 6.

It''s also the entire reason Braintech exists.

We''re not promising your kid will love reading. We''re promising the device says no first, so you don''t have to.

Drop your email for 10% off when we ship — link in bio.

#firstquietevening #parenting #screentime #realtestimonial #parentingtips',
 'IMAGE', '1:1',
 'Editorial photograph, 1:1 square. A parent in soft focus background, sitting in a warm-lit living room with a book in their lap, soft evening light. A child barely visible in foreground also reading. The Braintech device — small matte-black box with glowing orange brain — on a shelf in the background. Premium cinematic warm aesthetic. Mood: relief, settled.'),

('2026-07-07', 'problem_awareness', NULL,
 'Jonathan Haidt has been writing about "The Anxious Generation" for a year. His four norms for the household:

1. No smartphones before high school.
2. No social media before 16.
3. Phone-free schools.
4. More unstructured free play.

Three of those are decisions you and your kids navigate without us. One of them — the in-home enforcement — is what Braintech literally is.

Read the book (we''ll link in stories). Then talk to your spouse about which of the four you''re ready to commit to this summer.

#anxiousgeneration #jonathanhaidt #parenting #screentime #parentingtips',
 'IMAGE', '1:1',
 'Editorial overhead photograph, 1:1 square. A hardback copy of "The Anxious Generation" by Jonathan Haidt on a warm wooden table, next to a coffee mug and a small notebook with a pen across it. Morning light from the side. Premium considered aesthetic. Cream and amber palette. Wait — that image is hard to get with AI generation. Alternative: A close-up of a parent reading a book in a warm kitchen, side view, no face. Coffee mug, notebook on the side.'),

('2026-07-08', 'rule_of_the_week', NULL,
 '🟠 Rule of the Week #4:

"Wi-Fi to the kids'' devices pauses at dinner. Resumes when my husband texts ''plates cleared.''"

This one is the bedrock rule in our beta households. Why it works:

→ It''s not "no phones at the table" (which they''ll bypass with cellular). It''s the kids'' devices, all of them, off the network.
→ It''s tied to a family-side action (plates cleared) — they''re part of the unlock.
→ It''s ritual, not punishment.

What''s your dinner rule? Comment below.

#familydinner #parenting #screentime #ruleoftheweek #parentingtips',
 'IMAGE', '1:1',
 'Editorial photograph, 1:1 square. A warm wooden family dinner table, three or four plates with food, hands of multiple people just visible holding forks (no faces). Soft warm pendant light. No phones visible anywhere in frame. Premium domestic aesthetic. Amber and cream palette.'),

('2026-07-09', 'educational', NULL,
 'What our beta kids actually do in the 90 minutes after Wi-Fi shuts off:

→ 38% of parents reported their kid picked up a book within 20 minutes.
→ 29% reported the kids started cooking, drawing, or another hands-on project.
→ 22% reported them going outside.
→ 11% reported the kids being annoyed for the first week, then adjusting.

The pattern: nothing replaces the dopamine of short-form video instantly. But kids find something within a week. That''s the bet.

#parenting #screenfree #raisingkids #boredomisthegateway',
 'IMAGE', '1:1',
 'Editorial photograph, 1:1 square. A kid (around 11, no face) on a warm wood kitchen floor sprawled with a sketchbook and colored pencils, a half-eaten apple next to them. Soft afternoon light. The mood is "I''m bored — okay, now I''m drawing." Premium domestic aesthetic. Cream and amber palette.'),

('2026-07-10', 'engagement', NULL,
 'Drop your weirdest, most specific text rule in the comments.

The one that makes other parents go "wait, that''s actually clever."

Stuff like: "Discord works for the gaming session we agreed on — not the four-hour version." Or: "30 minutes outside = 30 minutes of screen. He runs."

The 5 best ones become our August content. Credit + free device to anyone whose rule we feature.

#parenting #screentimerules #parentingtips #momlife #dadlife',
 'IMAGE', '1:1',
 'Editorial photograph, 1:1 square. Same notebook-on-warm-counter aesthetic as the Week 1 engagement post but with new handwritten content. A notebook with a list of family rules (text is intentionally suggestive, not readable), a pen, a coffee mug, soft window light. Premium calm aesthetic.');
