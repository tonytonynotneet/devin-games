---
name: testing-devin-games
description: How to functionally test the 2-player local-versus HTML canvas games in this repo (serve, fonts, dual-keyboard input, touch emulation, console checks).
---

# Testing devin-games 2-player HTML games

The repo is pure static HTML/JS — no build. Serve it and drive Chrome on :29229 CDP.

## Serve & render

- `python3 -m http.server 8080` at repo root → portal `http://localhost:8080/index.html`, games at `games/<dir>/` (trailing slash needed).
- **CJK + emoji fonts may be missing**: Japanese text and emoji (e.g. ☹️) render as tofu. Fix once per machine: `sudo apt-get update && sudo apt-get install -y fonts-noto-cjk fonts-noto-color-emoji`, then **fully restart Chrome** (fontconfig is cached per process; page reload alone is not enough). Relaunch with the identical arg list — recover it first via `cat /proc/<chrome-pid>/cmdline`.

## Driving BOTH players' controls

- The computer `key`/`hold_key` actions only press one key at a time. For simultaneous or diagonal input (two players, or Up+Right together), send raw X events from shell: `xdotool keydown w; xdotool keydown a; sleep 0.5; xdotool keyup w; xdotool keyup a` (display `:0` works; xdotool is at /opt/.devin/package/custom_binaries/xdotool).
- Take a screenshot between commands — you cannot see positions while a script runs.

## Touch controls verification

- Games detect touch via `navigator.maxTouchPoints>0`, `'ontouchstart' in window`, `matchMedia('(pointer: coarse)')`, a first `touchstart` event, a `?touch` URL param (sumo), or a 📱 toggle button (sumo). Detection runs at load — reload after enabling emulation.
- On Chrome 137, `Emulation.setTouchEmulationEnabled` did **not** reliably set `navigator.maxTouchPoints`. What works:
  - `Input.dispatchTouchEvent` (CDP) — a real touchstart flips `body.is-touch` / `body.touch` on pages that listen for it.
  - `Emulation.setEmitTouchEventsForMouse {enabled:true, configuration:'mobile'}` — converts real mouse events into touch events, so `left_click_drag`/`mouse_down`-hold-move produces genuine touch drags (enables canvas split-drag control in air-hockey).
  - CDP emulation overrides are **scoped to the websocket session** — keep the websocket connected while interacting or the override reverts when the script exits.
- Reusable scripts live at `/home/ubuntu/cdp_touch.py` (eval/touch toggles), `cdp_touch_hold.py` (holds emulation session open), `cdp_touch_tap.py` (dispatched tap), `cdp_console.py` (Runtime+Log error monitor). Recreate them if the box was reset.

## Mobile play-test — MANDATORY before reporting a game works

A page loading is NOT a working game. For every game change, verify with an emulated phone (Playwright `p.devices["iPhone 13"]`, landscape viewport ~844x390, `has_touch`) that a real human action produces a real in-game effect:

- Open the deployed/localhost URL, tap through start/char-select/GO screens, then **press a touch control and assert movement**: md5-diff `canvas.screenshot()` before vs after holding a direction button for ~1s (hold via CDP `Input.dispatchTouchEvent` touchStart→wait→touchEnd; quick `page.touchscreen.tap` is too short for held-movement checks).
- Do the same for the action button (jump/fire/thrust) — jump shows as a canvas diff; for taps also check state where possible.
- Check BOTH orientations: portrait must show the `#rotate-overlay`, landscape must hide it and render the game.
- **Input-key mapping audit**: if a game has `data-k`/`data-key` touch buttons, grep the JS for the input-state fields it actually reads (e.g. `k.l`, `k.r`, `k.j`) and confirm the `data-*` values match — a wrong name writes to a dead property and the button silently does nothing (this exact bug shipped in super-koto: `data-k="left"` vs `k.l`).
- Zero `pageerror`/`console.error` (except the favicon 404).

## Console-error checking

- The `browser_console` tool only returns your own script's output, not page logs. Use a CDP monitor: `Runtime.enable` + `Log.enable`, reload the page, collect `consoleAPICalled`/`exceptionThrown`/`Log.entryAdded` for N seconds.
- Expect a benign `Failed to load resource ... 404` for `/favicon.ico` on every page — the repo ships no favicon.

## Useful mechanics for reaching end states fast

- Air-hockey: mallets chase touch points; pin-push the puck toward a goal. Goals reset positions to center each serve.
- Snake-battle: snakes spawn mid-row facing each other → unsteered they head-on-collide = draw every round. Turn one snake into a wall (e.g. spam `Up` for P2) to force wins.
- Sumo: hold direction + spam the 突っ張り key to push the opponent out; first to 3.
- Tank-battle: own ricochets are lethal after ~160ms — rotating while spamming fire inside the spawn pocket self-kills reliably for instant round wins.
- Basketball: charge shot sweet zone ≈ hold action key ~0.53s (780ms full charge, green zone at 0.64–0.74). Or just play out the 90s clock while ahead.
