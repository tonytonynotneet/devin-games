---
name: persona-playtest
description: Autonomous improvement loop for devin-games — 5 persona playtesters run in parallel against the live site, a commander triages/auto-approves findings, an implementer ships them, a verifier merges. Run hourly or on demand via run_workflow.
---

# Persona playtest workflow

Runs the autonomous "play → triage → approve → implement → merge" loop for
Dream Home (devin-games). No human approval needed for code changes; deploying
the static site still requires the user's deploy approval.

## How to run

Invoke `run_workflow` with
`script_path` = `<repo root>/.agents/skills/persona-playtest/workflow.py`
and `workflow_name` = `"dream-home-persona-playtest"`.

## What it does

1. **playtest** — 5 separate-VM agents in parallel, each with a fixed persona
   (zuza/girlfriend, casual phone gamer, destructive kid, hardcore critic,
   non-gamer grandma). Each opens the live koto/zuza links on a phone-emulated
   browser and reports bugs, fun-improvement ideas, and a fun score.
2. **triage** — one commander agent dedupes reports and auto-approves at most
   3 items (bugs first, then highest fun-per-effort idea).
3. **implement** — one agent implements the approved items on
   `devin/auto-<ts>` and verifies zero console errors in a phone-emulated load.
4. **merge** — one agent merges the branch to main after a smoke check and pushes.

Deploy to devinapps.com remains user-gated: to publish, run the deploy tool
from a session the user approves.
