#!/usr/bin/env python3
"""NEON CITY 3D — automated playtest/QA suite.

Drives the real game in Chrome via CDP (attach to the running browser).
Serves the repo root on :8080 and hits games/neon-city-3d/index.html?play=1.

Usage:
    python3 -m http.server 8080        # from repo root, if not already running
    python3 games/neon-city-3d/tests/qa.py

Screenshots land in tests/shots/. Exits nonzero if any test fails.
"""
import json, os, sys, time, math
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.path.join(HERE, "shots")
os.makedirs(SHOTS, exist_ok=True)

BASE = "http://localhost:8080/games/neon-city-3d/index.html?play=1"
CDP = os.environ.get("CDP_URL", "http://localhost:29229")

RESULTS = []
def report(name, ok, detail=""):
    RESULTS.append((name, ok, detail))
    print(("PASS" if ok else "FAIL") + f"  {name}" + (f"  — {detail}" if detail else ""), flush=True)

def shot(page, name):
    page.screenshot(path=os.path.join(SHOTS, name))

def js(page, expr):
    return page.evaluate(f"() => ({expr})")

def touch(cdp, typ, points):
    cdp.send("Input.dispatchTouchEvent", {"type": typ, "touchPoints": points})

def touch_hold(cdp, x, y, secs, tid=1):
    touch(cdp, "touchStart", [{"x": x, "y": y, "id": tid}])
    time.sleep(secs)
    touch(cdp, "touchEnd", [])

def touch_drag(cdp, x0, y0, x1, y1, steps=8, hold=0.5, tid=1):
    touch(cdp, "touchStart", [{"x": x0, "y": y0, "id": tid}])
    for i in range(1, steps + 1):
        touch(cdp, "touchMove", [{"x": x0 + (x1 - x0) * i / steps, "y": y0 + (y1 - y0) * i / steps, "id": tid}])
        time.sleep(0.03)
    time.sleep(hold)
    return tid

def btn_point(page, sel):
    bb = page.locator(sel).bounding_box()
    return bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2

def clear_wanted(page):
    """Reset stars and remove spawned cops/pcars between tests."""
    js(page, """(() => {
      for (const p of NC.state.players) if (p) { p.stars = 0; p._wantedT = 0; }
      for (const c of NC.people.cops) NC.scene.remove(c.mesh);
      NC.people.cops.length = 0;
      for (const c of NC.people.pcars) { c.dead = true; c.group.visible = false; }
      NC.people.pcars.length = 0;
      return 1;
    })()""")

def wait_nc(page, timeout=15000):
    page.wait_for_function("window.NC && NC._mods && NC.state && NC.state.started", timeout=timeout)

def main():
    pw = sync_playwright().start()
    browser = pw.chromium.connect_over_cdp(CDP)
    ctx = browser.new_context(viewport={"width": 844, "height": 390},
                              has_touch=True, is_mobile=True,
                              device_scale_factor=2)
    page = ctx.new_page()
    cdp = ctx.new_cdp_session(page)
    pageerrors, conerrors = [], []
    page.on("pageerror", lambda e: pageerrors.append(str(e)))
    page.on("console", lambda m: conerrors.append(m.text) if m.type == "error" else None)

    # ============ BOOT ============
    page.goto(BASE)
    wait_nc(page)
    time.sleep(10)  # soak for pageerrors
    info = js(page, """{
      n: NC._mods.length, mods: NC._mods.map(m => m._name),
      peds: NC.people.peds.length, cars: NC.car.list.length,
      cops: NC.people.cops.length, pcars: NC.people.pcars.length,
      solids: NC.city.solids.length, pickups: NC.combat.pickups.length,
      hp: NC.me().hp, started: NC.state.started }""")
    real_con = [e for e in conerrors if "favicon" not in e and "404" not in e]
    report("boot: no pageerrors (10s soak)", not pageerrors, "; ".join(pageerrors[:3]))
    report("boot: no console errors", not real_con, "; ".join(real_con[:3]))
    report("boot: 13 modules loaded", info["n"] == 13, f"got {info['n']}: {info['mods']}")
    report("boot: peds=26 cars=40", info["peds"] == 26 and info["cars"] == 40,
           f"peds={info['peds']} cars={info['cars']}")
    report("boot: city+pickups built", info["solids"] > 50 and info["pickups"] == 14,
           f"solids={info['solids']} pickups={info['pickups']}")
    shot(page, "01-boot.png")

    # ============ MOVE (touch joystick) ============
    p0 = js(page, "{x:NC.me().x, z:NC.me().z}")
    tid = touch_drag(cdp, 180, 300, 180, 240, hold=1.0)  # push stick up
    ring_on = js(page, "document.getElementById('joy-ring').classList.contains('on')")
    joy = js(page, "{mag:NC.input.joy.mag, x:NC.input.joy.x, y:NC.input.joy.y}")
    shot(page, "02-joystick.png")
    touch(cdp, "touchEnd", [])
    time.sleep(0.3)
    p1 = js(page, "{x:NC.me().x, z:NC.me().z}")
    moved = math.hypot(p1["x"] - p0["x"], p1["z"] - p0["z"])
    report("move: touch joystick shows ring", ring_on)
    report("move: joystick registers input", joy["mag"] > 0.3 and joy["y"] < -0.3, f"joy={joy}")
    report("move: pawn moved", moved > 2, f"moved {moved:.1f}m")

    # keyboard move
    p0 = p1
    page.keyboard.down("w"); time.sleep(0.9); page.keyboard.up("w")
    p1 = js(page, "{x:NC.me().x, z:NC.me().z}")
    moved = math.hypot(p1["x"] - p0["x"], p1["z"] - p0["z"])
    report("move: WASD moves pawn", moved > 2, f"moved {moved:.1f}m")

    # ============ CAMERA ============
    yaw0 = js(page, "NC.camera.yaw")
    tid = touch_drag(cdp, 700, 200, 580, 200, hold=0.4, tid=2)  # right-half drag
    touch(cdp, "touchEnd", [])
    yaw1 = js(page, "NC.camera.yaw")
    report("camera: touch drag orbits", abs(yaw1 - yaw0) > 0.05, f"yaw {yaw0:.2f}->{yaw1:.2f}")
    page.keyboard.down("ArrowRight"); time.sleep(0.6); page.keyboard.up("ArrowRight")
    yaw2 = js(page, "NC.camera.yaw")
    report("camera: arrow keys orbit", abs(yaw2 - yaw1) > 0.05, f"yaw {yaw1:.2f}->{yaw2:.2f}")

    # ============ CAR ============
    js(page, """(() => {
      const me = NC.me();
      const c = NC.car.nearestCar(me.x, me.z, 1e9);
      // park the player right beside the car's door
      me.x = c.x + Math.sin(c.yaw + Math.PI/2) * 2.0;
      me.z = c.z + Math.cos(c.yaw + Math.PI/2) * 2.0;
      me.mesh.position.set(me.x, 0, me.z);
      window.__carIdx = NC.car.list.indexOf(c);
      return true;
    })()""")
    page.keyboard.press("e"); time.sleep(0.4)
    inc = js(page, "{incar: !!NC.me().inCar, k: NC.me().inCar ? NC.me().inCar.kind : null}")
    report("car: tryEnter works", inc["incar"], str(inc))
    c0 = js(page, "{x:NC.me().inCar.x, z:NC.me().inCar.z}")
    page.keyboard.down("w"); time.sleep(1.4); page.keyboard.up("w")
    c1 = js(page, "{x:NC.me().inCar.x, z:NC.me().inCar.z, sp:NC.me().inCar.speed}")
    dm = math.hypot(c1["x"] - c0["x"], c1["z"] - c0["z"])
    report("car: drives with stick", dm > 3, f"moved {dm:.1f}m")
    shot(page, "03-driving.png")
    page.keyboard.press("e"); time.sleep(0.4)
    ex = js(page, """{out: !NC.me().inCar, px:NC.me().x, pz:NC.me().z,
      carx: NC.car.list[window.__carIdx].x, carz: NC.car.list[window.__carIdx].z,
      driver: !!NC.car.list[window.__carIdx].driver,
      inside: NC.city.solidAt(NC.me().x, NC.me().z, 0.5)}""")
    beside = math.hypot(ex["px"] - ex["carx"], ex["pz"] - ex["carz"])
    report("car: tryExit beside car", ex["out"] and 1 < beside < 4.5, f"dist={beside:.1f}")
    report("car: exit point not inside solid", not ex["inside"])
    report("car: driver cleared on exit", not ex["driver"])

    # ============ EDGE: enter/exit spam ============
    js(page, """(() => {
      const me = NC.me();
      const c = NC.car.nearestCar(me.x, me.z, 1e9);
      me.x = c.x + Math.sin(c.yaw + Math.PI/2) * 2.0;
      me.z = c.z + Math.cos(c.yaw + Math.PI/2) * 2.0;
      return true;
    })()""")
    for _ in range(8):
        page.keyboard.press("e"); time.sleep(0.22)
    st = js(page, """{incar: !!NC.me().inCar,
      stale: NC.car.list.some(c => c.driver && !NC.state.players.includes(c.driver)),
      me_driver: NC.car.list.some(c => c.driver === NC.me())}""")
    consistent = st["incar"] == st["me_driver"]
    report("edge: rapid enter/exit consistent", consistent and not st["stale"], str(st))

    # ============ EDGE: drive into building ============
    js(page, """(() => {
      const me = NC.me();
      // find a building whose southern approach is clear (not city edge, not another solid)
      let s = null, sx = 0, sz = 0;
      for (const b of NC.city.solids) {
        const z0 = b.z - b.hd - 8;
        if (Math.abs(b.x) > NC.city.EXT / 2 - 10 || Math.abs(z0) > NC.city.EXT / 2 - 10) continue;
        if (!NC.city.solidAt(b.x, z0, 1.2) && !NC.city.solidAt(b.x, z0 + 4, 1.2)) { s = b; sx = b.x; sz = z0; break; }
      }
      const c = NC.car.spawn('civic', sx, sz, 0); // yaw 0 = +z, toward the building
      me.x = c.x + 2.2; me.z = c.z; me.mesh.position.set(me.x, 0, me.z);
      window.__crashIdx = NC.car.list.indexOf(c);
      window.__solid = s;
      return !!s;
    })()""")
    page.keyboard.press("e"); time.sleep(0.3)
    page.keyboard.down("w"); time.sleep(2.2); page.keyboard.up("w")
    cr = js(page, """(() => {
      const c = NC.car.list[window.__crashIdx];
      const s = window.__solid;
      return {x: c.x, z: c.z,
        inside: NC.city.solidAt(c.x, c.z, 0.9),
        deepIn: Math.abs(c.x - s.x) < s.hw - 1 && Math.abs(c.z - s.z) < s.hd - 1};
    })()""")
    report("edge: car bounces off building (no clip)", not cr["inside"] and not cr["deepIn"],
           f"car at {cr['x']:.0f},{cr['z']:.0f}")
    page.keyboard.press("e"); time.sleep(0.3)  # back on foot

    # ============ COMBAT ============
    clear_wanted(page)
    js(page, """(() => {
      const me = NC.me();
      // stand on a clear N-S road, facing +z
      me.x = NC.city.ROAD_X[4]; me.z = 0; me.yaw = 0;
      me.mesh.position.set(me.x, 0, me.z);
      me.ammo.pistol = 50; me.weapons.pistol = true; me.weapon = 'pistol';
      // pin a ped dead ahead along aim
      const e = NC.people.peds.find(e => !e.dead);
      e.x = me.x + Math.sin(me.yaw) * 4; e.z = me.z + Math.cos(me.yaw) * 4;
      e.tx = e.x; e.tz = e.z; e.wait = 999; e.hp = 30;
      window.__ped = e;
      return true;
    })()""")
    x, y = btn_point(page, "#btn-b")
    touch(cdp, "touchStart", [{"x": x, "y": y, "id": 3}])
    time.sleep(1.2)
    shot(page, "04-combat.png")
    bullets = js(page, "NC.combat.bullets.length")
    bheld = js(page, "NC.input.b")
    touch(cdp, "touchEnd", [])
    time.sleep(0.5)
    cmb = js(page, "{dead: window.__ped.dead, stars: NC.me().stars, ammo: NC.me().ammo.pistol}")
    report("combat: B button held fires", bheld and cmb["ammo"] < 50, f"b={bheld} ammo={cmb['ammo']}")
    report("combat: bullets spawned", bullets > 0 or cmb["dead"] or cmb["ammo"] < 50)
    report("combat: ped died near aim", cmb["dead"])
    report("combat: stars rose", cmb["stars"] > 0, f"stars={cmb['stars']}")

    # ============ WANTED / BUSTED ============
    clear_wanted(page)  # remove leftover cops from the combat phase
    js(page, """(() => {
      NC.me().hp = 10000;                       // survive the mob while we measure
      NC.people.raiseWanted(NC.me(), 4);
      return 1;
    })()""")
    time.sleep(0.6)
    w0 = js(page, "{cops: NC.people.cops.length, pcars: NC.people.pcars.length, stars: NC.me().stars}")
    report("wanted: stars=4+ raised", w0["stars"] >= 4, f"stars={w0['stars']}")
    report("wanted: cops+pcars spawned", w0["cops"] >= 6 and w0["pcars"] >= 2, f"cops={w0['cops']} pcars={w0['pcars']}")
    # verify pursuit: cop distance shrinks or already engaged
    d0 = js(page, "Math.min(...NC.people.cops.map(c => Math.hypot(c.x-NC.me().x, c.z-NC.me().z)))")
    time.sleep(1.5)
    d1 = js(page, "Math.min(...NC.people.cops.map(c => Math.hypot(c.x-NC.me().x, c.z-NC.me().z)))")
    report("wanted: cops chase player", d1 < d0 or d1 <= 3, f"dist {d0:.0f}->{d1:.0f}")
    # teleport next to a cop → bust timer
    money0 = js(page, "NC.state.money")
    js(page, """(() => {
      const me = NC.me();
      const c = NC.people.cops.filter(c=>!c.dead)[0];
      me.x = c.x + 1.2; me.z = c.z; me.mesh.position.set(me.x,0,me.z);
      return 1;
    })()""")
    busted = False
    for _ in range(40):
        if js(page, "document.getElementById('ovl').classList.contains('on') && document.getElementById('ovl-txt').textContent === 'BUSTED'"):
            busted = True; break
        time.sleep(0.2)
    report("wanted: BUSTED overlay on arrest", busted)
    shot(page, "05-busted.png")
    time.sleep(3.2)  # overlay clears + respawn
    w1 = js(page, """{stars: NC.me().stars, money: NC.state.money,
      ovl: document.getElementById('ovl').classList.contains('on'),
      pd: Math.hypot(NC.me().x - NC.city.police.x, NC.me().z - NC.city.police.z),
      busted: NC.me().busted, dead: NC.me().dead,
      weapons: Object.keys(NC.me().weapons).join(',')}""")
    report("wanted: respawn at police + stars 0", w1["stars"] == 0 and w1["pd"] < 30 and not w1["busted"],
           f"pd={w1['pd']:.0f} stars={w1['stars']}")
    report("wanted: $400 penalty + guns lost", w1["money"] == max(0, money0 - min(money0, 400)) and w1["weapons"] == "fist",
           f"money {money0}->{w1['money']} weapons={w1['weapons']}")

    # ============ WASTED ============
    js(page, "(() => { NC.state.money = 500; NC.combat.applyPlayerDamage(NC.me(), 999); return 1; })()")
    time.sleep(0.4)
    wasted = js(page, "document.getElementById('ovl').classList.contains('on') && document.getElementById('ovl-txt').textContent === 'WASTED'")
    report("wasted: WASTED overlay on death", wasted)
    shot(page, "06-wasted.png")
    time.sleep(3.0)
    w2 = js(page, """{hp: NC.me().hp, dead: NC.me().dead, money: NC.state.money,
      hd: Math.hypot(NC.me().x - NC.city.hospital.x, NC.me().z - NC.city.hospital.z)}""")
    report("wasted: hospital respawn + hp 100", w2["hp"] == 100 and not w2["dead"] and w2["hd"] < 30,
           f"hd={w2['hd']:.0f} hp={w2['hp']}")
    report("wasted: $200 penalty", w2["money"] == 300, f"money={w2['money']}")

    # ============ MISSION ============
    m0 = js(page, "NC.state.money")
    js(page, "(() => { NC.missions.begin(NC.me(), 'delivery'); return 1; })()")
    time.sleep(0.4)
    ms = js(page, "{cur: !!NC.missions.cur, n: NC.missions.markers().length, meshes: NC.missions._markerMeshes.length}")
    report("mission: delivery starts + beacon marker", ms["cur"] and ms["n"] == 1 and ms["meshes"] >= 1, str(ms))
    # teleport to pickup marker → step flips to drop
    js(page, """(() => {
      const m = NC.missions.cur.markers[0]; const me = NC.me();
      me.x = m.x; me.z = m.z; me.mesh.position.set(me.x,0,me.z); return 1; })()""")
    time.sleep(0.5)
    shot(page, "07-mission-beacon.png")
    js(page, """(() => {
      const m = NC.missions.cur.markers[0]; const me = NC.me();
      me.x = m.x; me.z = m.z; me.mesh.position.set(me.x,0,me.z); return 1; })()""")
    time.sleep(0.5)
    m1 = js(page, "{cur: NC.missions.cur ? NC.missions.cur.type : null, money: NC.state.money}")
    report("mission: teleport through markers pays out", m1["cur"] is None and m1["money"] > m0,
           f"money {m0}->{m1['money']}")

    # ============ SAVE ============
    js(page, "(() => { NC.state.money = 7777; NC.save.now(); return 1; })()")
    page.reload(); wait_nc(page)
    sv = js(page, "{money: NC.state.money, raw: !!localStorage.getItem('neon3d-save')}")
    report("save: money persists across reload", sv["money"] == 7777, f"money={sv['money']}")

    # ============ PORTRAIT ============
    ctx2 = browser.new_context(viewport={"width": 390, "height": 844},
                               has_touch=True, is_mobile=True, device_scale_factor=2)
    page2 = ctx2.new_page()
    pe2 = []
    page2.on("pageerror", lambda e: pe2.append(str(e)))
    page2.goto(BASE); wait_nc(page2)
    time.sleep(5)
    pv = js(page2, """{cvw: document.getElementById('cv3d').width,
      btns: (() => { const r = document.getElementById('btns').getBoundingClientRect();
        return {x:r.x, y:r.y, w:r.width, h:r.height}; })(),
      vw: innerWidth, vh: innerHeight,
      overflowX: document.documentElement.scrollWidth > innerWidth}""")
    report("portrait: renders without pageerrors", not pe2, "; ".join(pe2[:3]))
    report("portrait: buttons visible on-screen", pv["btns"]["w"] > 0 and pv["btns"]["x"] + pv["btns"]["w"] <= pv["vw"] + 1,
           f"btns={pv['btns']} vw={pv['vw']}")
    # joystick works in portrait too
    cdp2 = ctx2.new_cdp_session(page2)
    q0 = js(page2, "{x:NC.me().x, z:NC.me().z}")
    touch_drag(cdp2, 120, 700, 120, 640, hold=0.8)
    touch(cdp2, "touchEnd", [])
    q1 = js(page2, "{x:NC.me().x, z:NC.me().z}")
    pmoved = math.hypot(q1["x"] - q0["x"], q1["z"] - q0["z"])
    report("portrait: touch joystick moves pawn", pmoved > 1, f"moved {pmoved:.1f}m")
    shot(page2, "08-portrait.png")
    page2.close(); ctx2.close()

    # ============ summary ============
    fails = [r for r in RESULTS if not r[1]]
    print(f"\n{'='*50}\n{len(RESULTS)-len(fails)}/{len(RESULTS)} passed")
    if fails:
        print("FAILED:", ", ".join(r[0] for r in fails))
        sys.exit(1)

if __name__ == "__main__":
    main()
