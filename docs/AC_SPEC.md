# Dream Home — Animal Crossing spec catalog

全78項目、全採用（TTT決定 2026-09-23）。各項目のIDは採択カタログと対応。
実装はフェーズ分け。各機能は `games/dream-home/<module>.js` の自己登録モジュール
（`DH.register("name", mod)`）として実装する。衝突回避のため **モジュールは自分の
ファイルだけを編集** し、`index.html` には `<script>` タグ1行のみ追加する。

## Module contract (core.js)

- `init(state)` / `start(state)` / `update(dt,state)` — host/solo only sim
- `drawGround(ctx,camX,camY,state)` / `collectDraws(draws,camX,camY)` / `drawOverlay(...)`
- `interactables(p)` → `[{label,x,y,action}]`
- `serialize()` → plain JSON / `deserialize(d)` — save bus key `mods.<name>` + net snapshot
- `remoteAction(name,args)` — whitelist guest-triggered actions
- `offline(offMin)` → `[summary parts]` (optional; decay/progress while away)
- Items: `DH.items.def(id, {name,ico,cat,price,stack})`, pockets: `DH.inv.add/remove/count`
- Coins = bells (`state.coins`). Save: `DH.save.now()` (auto-wired, host only)

## Waves

### Wave 1 — daily AC loop foundations (in flight)
- `forage.js` — B-1,B-2,B-3,B-4,B-9,B-10,B-11,B-12,B-13,B-15
- `critters.js` — B-5,B-6,B-7 + J-2 critterpedia
- `tools.js` — C-1..C-5 durability/tiers/pockets UI/tool ring/expansion
- `econ.js` — E-1,E-2,E-3,E-6,E-7,E-8,E-9 (shop/turnips/ATM/catalog/recycle/merchants)
- `craft.js` — D-1..D-5 recipes/workbench/customize/cooking/stamina
- `home.js` — F-1..F-8 loans/expansion/wallpaper/storage/exterior/rooms/HHA/album

### Wave 2 — living world
- `env.js` — A-3..A-6 weather/meteor/aurora/moon + A-5 shop hours
- `villagers.js` — H-1..H-10 personalities/friendship/gifts/requests/birthdays/letters/move-in/dialogue/reactions/HHA-jobs
- `museum.js` — J-1..J-6 donations/critterpedia-museum/catalogs/art-fakes/milestones/album
- `island.js` — G-1..G-6 bridges/inclines/moving/terraces/public works/rating/ordinances
- `events.js` — L-1..L-5 seasonal events/tournaments/countdown/first-days/anniversary
- `npcs.js` — M-1..M-4 guide NPC/visitors/cafe/trips

### Wave 3 — polish & meta
- `music.js` — K-1..K-6
- `fashion.js` — I-1..I-5
- `memories.js` — P-2 camera + J-6 album + P-3 markers
- `phone.js` — P-1 phone UI + P-4 sleep-save + P-6 tutorial
- `visits.js` — N-1..N-6 + O-5
- `pocket.js` — O-1..O-4,O-6 request cycle/craft wait/amenities/rotation/garden events
- `miles.js` — E-4,E-5 (achievements currency + island tours)
- misc — A-1,A-2 deepening, P-5 arrival/departure flow

## Standing rules for implementers
1. Never break `dreamhome-save` forward compat — only additive fields.
2. English UI; pixel-art, phone-first; portrait+landscape fullscreen.
3. Every feature must work solo AND online (host-authoritative; guests remoteAction).
4. Each module file documents its contract header like existing modules.
5. Verify: `python3 -m http.server 8080` + Playwright iPhone viewport, zero console errors.
