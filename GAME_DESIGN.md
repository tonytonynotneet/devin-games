# Dream Home — Design Pillars

The north star for every change to `games/dream-home/`. If a proposal doesn't
serve at least one pillar, it doesn't ship.

## Fantasy

> koto と zuza が、ふたりの理想の家と家族を一緒に育てる。
> A cozy house-and-family sim the couple plays TOGETHER to deepen their bond.

## Pillars

1. **Togetherness over mechanics** — the point is playing together. Any
   feature is judged first by "does this create a shared moment between the
   two?" (hugging, dates, co-decorating, raising kids/pets together), not by
   solo depth. Solo play must always feel like waiting-for-the-other, never
   the real game.
2. **Care is the heartbeat** — the world runs on attention: pets, kids,
   garden, sauna, rink. Neglect shows (☹️, wilting, low spirit); caring is
   rewarded visibly and emotionally. Tamagotchi-style decay keeps the home
   alive while they're away.
3. **Effort = love made visible** — coins/decor/harvests exist to be spent ON
   each other: gifts, date spots, home upgrades they chose together. Reward
   loops should end in couple moments, not just numbers.
4. **Phone-first, zero friction** — one URL per person, instant start, works
   in portrait AND landscape fullscreen, one-thumb joystick. No logins, no
   room codes, no menus between them and play.
5. **Readable at a glance** — a grandma should understand the screen in 10
   seconds: what am I, what needs care, what do I press next. Prefer
   iconography and in-world cues over text walls.

## Hard constraints (never break)

- koto look: black bowl-cut bangs, black tee, silver chain, watch.
- zuza look: very long dark-brown hair, black sunglasses, black outfit.
- Household: golden retriever ×1, cats ×3, chickens ×3, sheep ×2, cows ×2,
  children ×9, koto, zuza.
- English game UI. Free public static site. `dreamhome-save` fields are
  append-only (never rename/remove).
- Module contract: init/start/update/interactables/collectDraws/drawGround/
  drawOverlay/serialize/deserialize/remoteAction.

## Data sources, in priority order

1. Real play logs + 💌 notes from koto & zuza (see analytics below).
2. The weekly design review (curates the idea backlog against these pillars).
3. The hourly QA loop (bug-hunt personas — they FIND bugs, they don't design).
