/* NEON CITY — missions: FIXER marker → random job → objective → payout.
   Types: delivery, taxi, rampage, getaway, race, codate (duo only).
   Host-authoritative: guests draw markers but skip sim (net.isGuest). */
(function () {
  const NC = window.NC;
  const U = NC.util;

  let fixer = null;            // {x,y} permanent job marker
  let cur = null;              // active mission {id,type,step,markers,timer,targets,payout,data}
  let thugs = [];              // rampage entities (own array)
  let taxiPed = null;          // waiting fare entity
  let lastType = null;
  let nextId = 1;

  const guest = () => NC.net && NC.net.isGuest && NC.net.isGuest();

  // ---------- helpers ----------
  function roadFarFrom(x, y, minD, tries = 50) {
    let best = null, bd = 0;
    for (let i = 0; i < tries; i++) {
      const r = NC.world.randomRoad();
      const d = U.dist(x, y, r.x, r.y);
      if (d > minD) return r;
      if (d > bd) { bd = d; best = r; }
    }
    return best || NC.world.randomRoad();
  }
  function mkMarker(x, y, ico, col, r) {
    return { x: Math.round(x), y: Math.round(y), ico, col, r: r || 30 };
  }
  function playerAt(m, needCar) {
    for (const p of NC.state.players) {
      if (p.dead || p.busted) continue;
      if (needCar && !p.inCar) continue;
      if (U.dist(p.x, p.y, m.x, m.y) < (m.r || 30)) return p;
    }
    return null;
  }
  function allPlayersAt(m) {
    for (const p of NC.state.players) {
      if (p.dead || p.busted) return false;
      if (U.dist(p.x, p.y, m.x, m.y) >= (m.r || 30)) return false;
    }
    return true;
  }
  function mkThug(x, y) {
    return { x, y, hp: 45, dir: "down", angle: 0, step: 0, shootT: U.rand(0.5, 1.4), dead: false, flash: 0 };
  }
  function mkPed(x, y) {
    return { x, y, char: "ped", dir: "down", step: 0, dead: false, hidden: false, missionPed: true };
  }
  function liveThugs() { return thugs.filter((t) => !t.dead); }

  // ---------- mission control ----------
  function pool() {
    const s = NC.state;
    const list = ["delivery", "rampage"];
    if (NC.cars) list.push("taxi", "race");
    if (NC.people && NC.people.raiseWanted) list.push("getaway");
    if (s.players.length > 1) list.push("codate");
    return list;
  }

  function begin(p, forceType) {
    const s = NC.state;
    if (!p || p.dead || p.busted) return false;
    if (cur) { NC.toast("Finish the current job first", 1600); return false; }
    if (p.missionCD > 0) return false;
    const types = pool();
    let type = forceType && types.includes(forceType) ? forceType : null;
    if (!type) {
      const fresh = types.filter((t) => t !== lastType);
      type = U.pick(fresh.length ? fresh : types);
    }
    lastType = type;
    p.missionCD = 2;
    const id = nextId++;
    cur = { id, type, step: 0, markers: [], timer: null, targets: [], payout: 0, data: { pi: s.players.indexOf(p) } };
    thugs = [];
    taxiPed = null;

    if (type === "delivery") {
      const a = roadFarFrom(p.x, p.y, 500);
      const b = roadFarFrom(a.x, a.y, 800);
      cur.markers = [mkMarker(a.x, a.y, "📦", "#facc15", 32)];
      cur.data.drop = { x: b.x, y: b.y };
      cur.timer = 75;
      cur.payout = 300 + U.randi(0, 200);
      NC.toast("DELIVERY — grab the package 📦", 2400);
    } else if (type === "taxi") {
      const a = roadFarFrom(p.x, p.y, 350);
      const b = roadFarFrom(a.x, a.y, 700);
      taxiPed = mkPed(a.x + 10, a.y + 6);
      cur.markers = [mkMarker(a.x, a.y, "🚕", "#facc15", 34)];
      cur.data.drop = { x: b.x, y: b.y };
      cur.data.fare = 200 + Math.round(U.dist(a.x, a.y, b.x, b.y) * 0.15);
      NC.toast("TAXI — pick up the fare (drive up close) 🚕", 2400);
    } else if (type === "rampage") {
      for (let i = 0; i < 6; i++) {
        let placed = null;
        for (let k = 0; k < 10 && !placed; k++) {
          const a = U.rand(0, Math.PI * 2), r = U.rand(240, 420);
          const x = U.clamp(p.x + Math.cos(a) * r, 20, NC.world.W - 20);
          const y = U.clamp(p.y + Math.sin(a) * r, 20, NC.world.H - 20);
          if (!NC.world.solidAt(x, y, 10)) placed = { x, y };
        }
        thugs.push(mkThug(placed ? placed.x : p.x + i * 18, placed ? placed.y : p.y));
      }
      cur.timer = 90;
      cur.payout = 600;
      cur.targets = thugs; // live refs (respawned fresh on deserialize)
      NC.toast("RAMPAGE — waste the thugs 🔥", 2400);
    } else if (type === "getaway") {
      NC.people.raiseWanted(p, 4);
      cur.payout = 800;
      cur.data.zeroT = 0;
      NC.toast("GETAWAY — lose the heat! 🚨", 2400);
    } else if (type === "race") {
      let from = { x: p.x, y: p.y };
      for (let i = 0; i < 5; i++) {
        const r = roadFarFrom(from.x, from.y, 420);
        cur.targets.push({ x: r.x, y: r.y });
        from = r;
      }
      cur.markers = [mkMarker(cur.targets[0].x, cur.targets[0].y, "🏁", "#22d3ee", 38)];
      cur.timer = 60;
      cur.payout = 400;
      NC.toast("RACE — 5 checkpoints, bring a car! 🏁", 2400);
    } else if (type === "codate") {
      const a = roadFarFrom(p.x, p.y, 300);
      const b = roadFarFrom(a.x, a.y, 600);
      cur.markers = [mkMarker(a.x, a.y, "💗", "#ff2d95", 34)];
      cur.data.drop = { x: b.x, y: b.y };
      cur.data.waitT = null;
      cur.data.first = -1;
      cur.payout = 700;
      NC.toast("COUPLE HEIST — meet your partner 💗", 2600);
    }
    return true;
  }

  function fail(msg) {
    NC.toast(msg || "MISSION FAILED", 2200);
    clearMission();
  }
  function complete(p, amt) {
    payout(p, amt == null ? cur.payout : amt);
    clearMission();
  }
  function clearMission() {
    const s = NC.state;
    if (s) for (const pl of s.players) pl.missionCD = Math.max(pl.missionCD, 3);
    cur = null; thugs = []; taxiPed = null;
  }
  function payout(p, amt) {
    if (!p) p = NC.state.players[cur ? cur.data.pi : 0] || NC.state.players[0];
    p.money += amt;
    NC.toast(`MISSION PASSED +$${amt}`, 2400);
  }

  // ---------- per-type update (host only) ----------
  function tick(dt, s) {
    if (cur.timer != null) {
      cur.timer -= dt;
      if (cur.timer <= 0) return fail();
    }
    for (const p of s.players) if (p.dead) return fail("MISSION FAILED — you died");
    const t = cur.type;

    if (t === "delivery") {
      const hit = playerAt(cur.markers[0]);
      if (!hit) return;
      if (cur.step === 0) {
        cur.step = 1;
        cur.markers = [mkMarker(cur.data.drop.x, cur.data.drop.y, "🏁", "#22d3ee", 34)];
        NC.toast("Package secured — deliver it!", 1800);
      } else complete(hit);
    } else if (t === "taxi") {
      if (cur.step === 0) {
        if (!taxiPed || taxiPed.hidden) return;
        for (const p of s.players) {
          if (p.dead || !p.inCar) continue;
          if (U.dist(p.x, p.y, taxiPed.x, taxiPed.y) < 22) {
            taxiPed.hidden = true;
            cur.step = 1;
            cur.markers = [mkMarker(cur.data.drop.x, cur.data.drop.y, "🏁", "#22d3ee", 34)];
            NC.toast("Fare aboard — drive!", 1800);
            break;
          }
        }
      } else {
        for (const p of s.players)
          if (p.inCar && p.inCar.dead) return fail("MISSION FAILED — the fare is toast");
        const hit = playerAt(cur.markers[0]);
        if (hit) complete(hit, cur.data.fare);
      }
    } else if (t === "rampage") {
      updateThugs(dt, s);
      cur.data.alive = liveThugs().length;
      if (cur.data.alive === 0) complete(s.players[cur.data.pi] || s.players[0]);
    } else if (t === "getaway") {
      const p = s.players[cur.data.pi] || s.players[0];
      if (p.busted) return fail("MISSION FAILED — BUSTED");
      cur.data.zeroT = (p.stars === 0) ? cur.data.zeroT + dt : 0;
      if (cur.data.zeroT >= 2) complete(p);
    } else if (t === "race") {
      const hit = playerAt(cur.markers[0], true);
      if (!hit) return;
      cur.step++;
      if (cur.step >= cur.targets.length) {
        complete(hit, cur.payout + Math.max(0, Math.ceil(cur.timer)) * 8);
      } else {
        const n = cur.targets[cur.step];
        cur.markers = [mkMarker(n.x, n.y, "🏁", "#22d3ee", 38)];
        NC.toast(`CHECKPOINT ${cur.step}/${cur.targets.length}`, 1200);
      }
    } else if (t === "codate") {
      if (cur.step === 0) {
        const m = cur.markers[0];
        const inside = s.players.map((p) => !p.dead && !p.busted && U.dist(p.x, p.y, m.x, m.y) < m.r);
        const n = inside.filter(Boolean).length;
        if (n >= s.players.length) {
          cur.step = 1;
          cur.markers = [mkMarker(cur.data.drop.x, cur.data.drop.y, "💰", "#22d3ee", 36)];
          NC.toast("Together! Now deliver the loot 💗", 2000);
        } else if (n === 1) {
          if (cur.data.waitT == null) { cur.data.waitT = 10; cur.data.first = inside.indexOf(true); }
          cur.data.waitT -= dt;
          if (cur.data.waitT <= 0) {
            cur.data.waitT = null;
            NC.toast("Too slow — get there together!", 1800);
          }
        } else cur.data.waitT = null;
      } else if (allPlayersAt(cur.markers[0])) {
        for (const p of s.players) p.money += cur.payout;
        NC.toast(`COUPLE HEIST PASSED +$${cur.payout} each 💗`, 2600);
        clearMission();
      }
    }
  }

  function updateThugs(dt, s) {
    for (const t of thugs) {
      if (t.dead) continue;
      t.flash = Math.max(0, t.flash - dt);
      let tgt = null, bd = 1e9;
      for (const p of s.players) {
        if (p.dead || p.busted) continue;
        const d = U.dist(t.x, t.y, p.x, p.y);
        if (d < bd) { bd = d; tgt = p; }
      }
      if (!tgt) continue;
      const a = U.angTo(t.x, t.y, tgt.x, tgt.y);
      t.angle = a;
      t.dir = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? (Math.cos(a) > 0 ? "right" : "left") : (Math.sin(a) > 0 ? "down" : "up");
      if (bd > 34) {
        const sp = 120;
        const nx = t.x + Math.cos(a) * sp * dt, ny = t.y + Math.sin(a) * sp * dt;
        if (!NC.world.solidAt(nx, t.y, 9)) t.x = nx;
        if (!NC.world.solidAt(t.x, ny, 9)) t.y = ny;
        t.step = (t.step + dt * 3) % 1;
      }
      t.shootT -= dt;
      if (t.shootT <= 0) {
        if (NC.combat && NC.combat.fire && bd < 300) {
          NC.combat.fire(t, t.x, t.y, a, "pistol");
          t.shootT = U.rand(1.0, 1.7);
        } else if (bd < 30) {
          tgt.hp -= 9;
          tgt.flash = 0.35;
          NC.shake(4);
          t.shootT = 0.9;
        } else t.shootT = 0.4;
      }
    }
    // player damage → thugs: bullet scan + fist heuristic
    if (NC.combat && NC.combat.bullets) {
      for (const b of NC.combat.bullets) {
        if (b.dead) continue;
        if (b.shooter && b.shooter.hp !== undefined && thugs.includes(b.shooter)) continue;
        for (const t of thugs) {
          if (t.dead) continue;
          if (U.dist(b.x, b.y, t.x, t.y) < 13) {
            b.dead = true;
            hurtThug(t, b.dmg || 25);
            break;
          }
        }
      }
    }
    for (const p of s.players) {
      if (p.dead || p.weapon !== "fist" || p.iatk < 0.44) continue;
      for (const t of thugs) {
        if (!t.dead && U.dist(p.x, p.y, t.x, t.y) < 32) hurtThug(t, 18);
      }
    }
  }
  function hurtThug(t, dmg) {
    t.hp -= dmg;
    t.flash = 0.25;
    if (t.hp <= 0 && !t.dead) {
      t.dead = true;
      if (NC.people && NC.people.bountyDrop) NC.people.bountyDrop(t.x, t.y);
      NC.toast(`Thug down — ${liveThugs().length} left`, 1100);
    }
  }

  // ---------- module contract ----------
  NC.register("missions", {
    init(state) {
      // FIXER: sidewalk edge of the block containing map center (deterministic)
      const w = NC.world;
      const P = w.PITCH, R = w.ROAD, B = P - R;
      const bx = Math.floor((w.W / 2) / P), by = Math.floor((w.H / 2) / P);
      const ox = R + bx * P, oy = R + by * P;
      const cands = [
        { x: ox + 6, y: oy + B / 2 }, { x: ox + B - 6, y: oy + B / 2 },
        { x: ox + B / 2, y: oy + 6 }, { x: ox + B / 2, y: oy + B - 6 },
      ];
      fixer = cands.find((c) => !w.solidAt(c.x, c.y, 6)) || w.randomSidewalk();
      cur = null; thugs = []; taxiPed = null; lastType = null;
    },
    start() {
      cur = null; thugs = []; taxiPed = null;
    },
    update(dt, state) {
      if (guest()) {
        // local only: ask host to start a job when A is pressed at the fixer
        const me = NC.me && NC.me();
        if (me && NC.input.aEdge && !me.inCar && cur === null &&
            U.dist(me.x, me.y, fixer.x, fixer.y) < 34 && NC.net.act) {
          NC.net.act("mission-start", { pi: state.players.indexOf(me) });
        }
        if (cur && cur.timer != null) cur.timer -= dt; // cosmetic countdown
        return;
      }
      if (cur) tick(dt, state);
    },
    interactables() {
      if (!fixer) return [];
      return [{ x: fixer.x, y: fixer.y, r: 30, label: "Job", cb: (p) => begin(p) }];
    },
    collectDraws(draws) {
      const t = performance.now() / 1000;
      // FIXER spot — always visible
      draws.push({
        y: fixer.y,
        fn: (ctx) => {
          NC.sprites.drawMarker(ctx, fixer.x, fixer.y, "#facc15", t);
          ctx.font = "bold 9px monospace";
          ctx.textAlign = "center";
          ctx.fillStyle = "#facc15";
          ctx.fillText("FIXER", fixer.x, fixer.y - 40 - Math.sin(t * 3) * 3);
          NC.sprites.drawChar(ctx, fixer.x, fixer.y + 14, "ped", "down", 0, { name: null });
        },
      });
      if (cur) {
        for (const m of cur.markers) {
          draws.push({
            y: m.y,
            fn: (ctx) => {
              NC.sprites.drawMarker(ctx, m.x, m.y, m.col, t);
              ctx.font = "11px monospace";
              ctx.textAlign = "center";
              ctx.fillText(m.ico, m.x, m.y - 40);
            },
          });
        }
      }
      if (taxiPed && !taxiPed.hidden && !taxiPed.dead) {
        draws.push({
          y: taxiPed.y + 16,
          fn: (ctx) => NC.sprites.drawChar(ctx, taxiPed.x, taxiPed.y, "ped", taxiPed.dir, taxiPed.step, { name: "FARE", nameCol: "#facc15" }),
        });
      }
      for (const th of thugs) {
        if (th.dead) continue;
        draws.push({
          y: th.y + 16,
          fn: (ctx) => {
            NC.sprites.drawChar(ctx, th.x, th.y, "thug", th.dir, th.step, { weapon: "pistol" });
            // hp pip
            ctx.fillStyle = "#0a0a12";
            ctx.fillRect(th.x - 9, th.y - 24, 18, 3);
            ctx.fillStyle = "#f97316";
            ctx.fillRect(th.x - 9, th.y - 24, 18 * U.clamp(th.hp / 45, 0, 1), 3);
            if (th.flash > 0) {
              ctx.globalAlpha = th.flash * 2;
              ctx.fillStyle = "#fff";
              ctx.fillRect(th.x - 12, th.y - 18, 24, 36);
              ctx.globalAlpha = 1;
            }
          },
        });
      }
    },
    drawHUD(ctx) {
      if (NC.hud || !cur) return; // hud module owns objective text when present
      const obj = NC.missions.current();
      if (!obj) return;
      ctx.font = "bold 12px monospace";
      ctx.textAlign = "center";
      const w = ctx.measureText(obj).width + 20;
      ctx.fillStyle = "rgba(10,10,22,0.8)";
      ctx.fillRect(NC.vw / 2 - w / 2, 14, w, 20);
      ctx.strokeStyle = "#facc1566";
      ctx.strokeRect(NC.vw / 2 - w / 2, 14, w, 20);
      ctx.fillStyle = "#facc15";
      ctx.fillText(obj, NC.vw / 2, 28);
    },
    // public API
    begin, payout, fail,
    _dbg() { return { cur, thugs, taxiPed, fixer }; },
    current() {
      if (!cur) return null;
      const t = cur.type, tm = cur.timer != null ? ` — ${Math.max(0, Math.ceil(cur.timer))}s` : "";
      if (t === "delivery") return (cur.step === 0 ? "Pick up the package" : "Deliver the package") + tm;
      if (t === "taxi") return cur.step === 0 ? "Pick up the fare (drive close)" : "Drop off the fare";
      if (t === "rampage") return `Waste the thugs — ${liveThugs().length} left${tm}`;
      if (t === "getaway") return "Lose the heat! Stay free";
      if (t === "race") return `Checkpoint ${cur.step + 1}/${cur.targets.length}${tm} — stay in the car`;
      if (t === "codate") return cur.step === 0 ? "Couple heist — both stand in the marker" : "Deliver the loot together";
      return null;
    },
    markers() {
      const list = [{ x: fixer.x, y: fixer.y, ico: "💼" }];
      if (cur) for (const m of cur.markers) list.push({ x: m.x, y: m.y, ico: m.ico });
      return list;
    },
    remoteAction(name, args) {
      if (name !== "mission-start") return false;
      if (guest()) return false; // only host starts missions
      const s = NC.state;
      const pi = args && args.pi != null ? args.pi : (s.players.length > 1 ? 1 : 0);
      const p = s.players[pi];
      if (p && U.dist(p.x, p.y, fixer.x, fixer.y) < 90) begin(p);
      return true;
    },
    serialize() {
      return {
        fx: fixer.x, fy: fixer.y, lastType,
        cur: cur ? {
          id: cur.id, type: cur.type, step: cur.step, timer: cur.timer,
          payout: cur.payout,
          markers: cur.markers.map((m) => ({ x: m.x, y: m.y, ico: m.ico, col: m.col, r: m.r })),
          targets: cur.targets.map((t2) => ({ x: t2.x, y: t2.y })),
          data: cur.data,
        } : null,
        thugs: liveThugs().map((t2) => ({ x: Math.round(t2.x), y: Math.round(t2.y), hp: t2.hp })),
        ped: taxiPed && !taxiPed.dead ? { x: Math.round(taxiPed.x), y: Math.round(taxiPed.y), hidden: !!taxiPed.hidden } : null,
      };
    },
    deserialize(s) {
      if (!s) return;
      if (s.fx != null) fixer = { x: s.fx, y: s.fy };
      lastType = s.lastType || null;
      cur = s.cur || null;
      if (cur && cur.type === "rampage") cur.targets = []; // live refs rebuilt below
      thugs = (s.thugs || []).map((t2) => {
        const e = mkThug(t2.x, t2.y); e.hp = t2.hp; return e;
      });
      if (cur && cur.type === "rampage") cur.targets = thugs;
      taxiPed = s.ped ? mkPed(s.ped.x, s.ped.y) : null;
      if (taxiPed && s.ped.hidden) taxiPed.hidden = true;
    },
  });
})();
