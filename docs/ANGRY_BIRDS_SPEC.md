# ANGRY BIRDS — "KOTO & ZUZA FLING" spec

Faithful recreation of the Angry Birds build in https://www.youtube.com/watch?v=yRtXAcD5EfY
(slingshot physics puzzle). Only the character design changes: birds are koto & zuza
(same couple style as NEON CITY). Vanilla JS + canvas, no build, phone-first.

## Spec (from video)

- Slingshot: drag bird back, release to launch. Floaty feel = low gravity + high
  initial speed. Smoke trail on flying bird.
- 4 bird types (in queue, use in order):
  1. koto (red-role): standard.
  2. koto-dash (yellow-role): tap mid-flight -> forward dash.
  3. zuza (blue-role): tap mid-flight -> splits into 3.
  4. zuza-bomb (black-role): tap -> big shockwave explosion (wide area, moderate power).
     Also auto-explodes on first hard impact.
- Blocks: ice < wood < stone by density. Restitution ~0 -> tilt in place, don't fly
  sideways. Each block: destruction threshold (impulse barrier subtracted from damage)
  + durability (hp). 3 visual crack stages. Debris particles on destroy.
- Pigs: green circles, some helmeted (tougher). Die from hard impacts / debris / falls.
- Score: pigs 5000, blocks 500-1000, leftover birds +10000 each. 1-3 stars per level.
- Levels: several; structures of wood/ice/stone, multiple pigs.
- Camera: level wider than screen -> horizontal pan; follows bird mid-flight;
  parallax background (far layers slower).
- Debug tuning panel (?debug=1): sliders for gravity, bird speed, block
  threshold/durability, explosion power (mirrors the video's tuning stage).
- Duo: ?duo=1 alternates turns labeled koto/zuza; solo default.
- Save: angrybirds-save {unlocked, stars{}}.

## Files

- index.html / style.css — title + fullscreen canvas + HUD
- physics.js — impulse rigid-body engine: circles + convex polys, warm-started
  contacts, friction/restitution, sleeping islands
- levels.js — level defs (blocks, pigs, bird queue, star thresholds)
- sprites.js — all drawing: birds (4 variants), pigs, cracked blocks, slingshot,
  parallax bg
- game.js — loop, input, camera, scoring, win/lose, save
- audio.js — WebAudio sfx
