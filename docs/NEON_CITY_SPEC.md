# NEON CITY — spec (GTA-style, faithful to the YouTube reference)

A top-down 2D open-world crime game (the same viewpoint as the original GTA 1/2 —
the most faithful interpretation of "GTA" that runs great on phones) set in a
neon cyberpunk city, starring koto & zuza. 2-player co-op in the SAME city via
the permanent `?play=1&as=koto|zuza` links (PeerJS, host-authoritative).

## Spec checklist (from the video: "AI makes GTA6")
- [ ] Open city: grid of streets, blocks of buildings, neon signs, props
- [ ] On-foot movement (8-dir), camera follows player
- [ ] Cars: parked + driving traffic, press A near a car to steal/enter, drive it
      (accel/brake/reverse/steer), exit anywhere, cars damage & explode
- [ ] Pedestrians: wandering, flee from gunshots/cars, die → drop money
- [ ] Wanted system: crime → stars (0-6), cops chase on foot + cop cars, they
      shoot you; escape/cooldown removes stars; BUSTED when caught
- [ ] Combat: punch + guns (pistol/SMG/shotgun), bullets hit peds/cops/cars/
      players, HP, damage numbers, screen shake
- [ ] Death → "WASTED" overlay → respawn at hospital, lose some money
- [ ] BUSTED → respawn at police station, lose weapons money
- [ ] Missions: marker → objective → payout (taxi, delivery, rampage, getaway)
- [ ] Money counter, weapon pickups/buy
- [ ] Minimap + HUD (stars, money, hp), toasts, pause menu
- [ ] Solo AND 2-player co-op online (host-authoritative, guests send inputs)

## Characters (cyberpunk anime redesign of koto & zuza — ONLY allowed change)
- koto: black bowl-cut (neon-cyan streak), black techwear jacket w/ cyan neon
  trim, glowing silver chain, holo-watch. Portrait: anime cyberpunk style.
- zuza: very long dark-brown hair (magenta/purple neon highlights), black
  sunglasses, black techwear outfit w/ purple neon trim. Portrait: anime
  cyberpunk style.

## Module contract — same bus as dream-home but `NC` namespace
Files live in `games/neon-city/`. Every module file ends with
`NC.register("<name>", NC.<name>)` and creates ONLY its own file plus ONE
`<script>` tag in index.html (insert immediately after the line
`<script src="sprites.js"></script>`).

`NC.register(name, mod)` → `NC._mods` array; game.js calls, for each mod that
defines it, in load order:
- `init(state)`        once at boot (before start)
- `start(state)`       when a run begins
- `update(dt, state)`  every frame (host only on guests' screens guests DO run
                       update but only for cosmetic/self state — see net rules)
- `drawUnder(ctx, cam)`  ground/world layer (before entities)
- `collectDraws(draws)`  push {y, fn} — depth-sorted entity layer
- `drawOver(ctx, cam)`   over-entities effects layer
- `drawHUD(ctx, state)`  screen-space UI (no camera transform)
- `interactables(state)` array of {x,y,r,label,cb} for A-button prompts
- `serialize()` / `deserialize(s)` save+net snapshots (JSON-plain only)
- `remoteAction(name, args)` guest→host action handler
- `offline(offMin)`     optional catch-up summary

### Shared state (NC.state)
```
{
  running, playSolo, day, timeMin,
  players: [ { char:"koto"|"zuza", x,y, dir, angle, step, hp, maxHp,
               money, wanted, stars, inCar:null|carRef, weapon:"fist"|"pistol"
               |"smg"|"shotgun", ammo, dead, busted, sprint } ],
  cam: {x,y,zoom},
  city: {w,h,tile},         // world.js
  inv?, mods save slots
}
```

### Cross-module APIs (define EXACTLY these)
- `NC.world`: `solidAt(x,y,r)`, `roadAt(x,y)`, `onRoad(x,y)`, `randomRoad()`,
  `randomSidewalk()`, `hospital`, `policeStation`, `buildings[]`, `W`, `H`,
  `minimapColors(ctx)`; `blockAt(x,y)`
- `NC.cars`: `list` [{x,y,angle,speed,type,color,driver,hp,dead,engine}],
  `nearestCar(x,y,r)`, `tryEnter(p)` (A near car → steal; cop car raises
  wanted), `tryExit(p)`, `damage(car,dmg)` (hp→0 = explode), `carAt(x,y,r)`
- `NC.people`: `peds`, `cops` [{x,y,hp,state,...}], `damage(ent,dmg,byPlayer)`,
  `kill`, `raiseWanted(p,stars)`, `wantedTick(p,dt)` (decay when unseen),
  `busted(p)`, `bountyDrop(x,y)`
- `NC.combat`: `fire(shooter,x,y,angle,weapon)` (spawn bullet; weapon defs:
  fist( melee arc ), pistol, smg, shotgun), `bullets[]`, `hitTest(b)`,
  `explode(x,y,r)`, `melee(shooter)`; applies damage via people/cars/player
- `NC.missions`: `current()` objective text|null, `markers[]` {x,y,ico},
  `payout(p,amt)`
- `NC.hud`: `toast(msg,ms)`, `wasted(p)`, `busted(p)`, `shake(amt)`
- `NC.player`: `spawnPlayer(p)` after wasted/busted
- `NC.net` (if present): `isGuest()`, `send(type,data)`

### Input (core.js exposes `NC.input`)
- `joy`: {x,y,mag,active} left-half analog stick → on foot = move dir; in car =
  steer(x)+throttle(-y forward, +y brake/reverse)
- `btnA` edge-pressed: context action (enter/exit car, talk, mission marker)
- `btnB` held: attack (fist melee or shoot current weapon)
- `btnC` edge: cycle weapon (fist→pistol→smg→shotgun if owned)
- HUD draws the buttons; core routes touches (left half = joystick, buttons
  right side). Buttons exposed as `input.a`,`input.b`,`input.c` booleans +
  `input.aEdge`/`input.cEdge` edge flags (consumed each frame by game.js).

### Net rules
- Host runs ALL update() for world/AI; serializes {state, mods} ~10Hz; guests
  deserialize, draw locally, send input via remoteAction.
- Guest's own player object is authority-lite: guest sends inputs; host applies
  them to players[1] inside update; guests still run update() locally ONLY for
  cosmetic interpolation — keep player-facing code host-safe by checking
  `NC.net && NC.net.isGuest()`.

## Style / perf rules
- Neon cyberpunk palette: asphalt #101018, sidewalk #1a1a26, neon pink
  #ff2d95, cyan #22d3ee, purple #a855f7, yellow #facc15. Dark ambience, sign
  glow via shadowBlur ONLY on signs/minimap (perf), not per-entity.
- World ~ 3200x2400 px. Streets on a 400px grid (2-tile roads 96px wide).
- Phone-first: fullscreen, portrait+landscape, joystick left / buttons right,
  safe-area, `?play=1` skips title, `&as=` fixes role, solo works offline.
- English UI text. Emoji OK. No external libs besides PeerJS CDN.
- localStorage key `neoncity-save` (additive-forward-compatible).

## File ownership (children must not touch others' files)
- core.js sprites.js world.js player.js game.js index.html style.css → parent
- cars.js people.js combat.js missions.js hud.js net.js → one child each
