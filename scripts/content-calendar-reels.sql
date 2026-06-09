-- Flip the four Wednesday "what kids learn instead" entries from single
-- IMAGE posts to vertical REELS (per the marketing plan — Buffer 2026
-- benchmarks have Reels at 3-4x the reach of single images for accounts
-- under 10k followers).
--
-- The cron routine (trig_01VYWV6JEyWU1i6CiCvyU1k2) is wired to handle
-- REELS: if asset_url is empty + prompt is set, it calls Higgsfield's
-- generate_video MCP tool, then publishes to IG with media_type=REELS
-- and share_to_feed=true. Captions ARE kept on Reels (unlike Stories).
--
-- Higgsfield prompt style for video differs from images:
--   - explicit aspect ratio (9:16 vertical)
--   - explicit duration hint (~15s) so the output fits IG Reels' window
--   - motion description (camera move, subject action, time-lapse, etc.)
--   - editorial b-roll voice, not text-overlay style — captions handle text

UPDATE content_calendar SET
  media_type = 'REELS',
  aspect_ratio = '9:16',
  prompt = 'Editorial cinematic vertical reel, 9:16, ~15 seconds, photorealistic. Slow handheld push-in on a child around 8 (side profile only, no full face) sitting cross-legged on a warm-lit living room rug at golden hour, watching a nature documentary on a tablet propped on a stack of hardback books. Reflected colors of ocean / coral on the child''s face. Subtle motion: child gently shifting, the documentary footage flickering on screen. A second cut briefly shows a parent in soft-focus background smiling. Bobbie / Lalo aesthetic — warm cream, amber, soft sage. Premium domestic. No text overlays, no logos.',
  updated_at = NOW()
WHERE scheduled_for = '2026-06-18';

UPDATE content_calendar SET
  media_type = 'REELS',
  aspect_ratio = '9:16',
  prompt = 'Editorial cinematic vertical reel, 9:16, ~15 seconds, photorealistic. A kid around 10 (back of head + hands only) at a warm wooden kitchen counter working through a Khan Academy math problem on a tablet, pencil on a notebook beside it, late-afternoon side light from a window. The shot pulls slowly out to show a parent''s hand placing a glass of milk down beside them without interrupting. Cozy, focused, quiet — the opposite of TikTok scroll energy. Bobbie / Lalo aesthetic. Warm amber + cream palette. No text overlays.',
  updated_at = NOW()
WHERE scheduled_for = '2026-06-25';

UPDATE content_calendar SET
  media_type = 'REELS',
  aspect_ratio = '9:16',
  prompt = 'Editorial cinematic vertical reel, 9:16, ~15 seconds, photorealistic. A child around 10 (side profile only, no full face) sitting on a warm cream sofa, totally absorbed watching a short animated TED-Ed video on a tablet. Camera slowly pushes in on the child''s reflection in the screen showing animated educational illustrations. A second beat: child laughs aloud or eyes widen. Soft afternoon window light, eucalyptus plant in soft focus. Bobbie / Lalo aesthetic — warm cream, amber, sage. Premium domestic. No text overlays.',
  updated_at = NOW()
WHERE scheduled_for = '2026-07-02';

UPDATE content_calendar SET
  media_type = 'REELS',
  aspect_ratio = '9:16',
  prompt = 'Editorial cinematic vertical reel, 9:16, ~20 seconds, photorealistic. Time-lapse montage of one child (around 11, side profile or back of head only — no full face) cycling through four post-Wi-Fi-shutoff activities in their warm cream domestic environment: (1) sprawled on the floor with a sketchbook and colored pencils, (2) sitting on a kitchen stool reading a hardback book, (3) running outside through the back door into warm afternoon light, (4) helping cook at the counter with a parent in soft focus. Each beat ~4 seconds, smooth cuts. The feeling is "boredom became motion." Bobbie / Lalo aesthetic. Warm amber + cream palette. No text overlays.',
  updated_at = NOW()
WHERE scheduled_for = '2026-07-09';

SELECT scheduled_for, theme, media_type, aspect_ratio,
       LENGTH(prompt) AS prompt_len, LENGTH(caption) AS caption_len
FROM content_calendar
WHERE theme = 'educational'
ORDER BY scheduled_for;
