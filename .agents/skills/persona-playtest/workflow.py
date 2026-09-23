# Persona playtest workflow for devin-games / Dream Home.
# 5 parallel persona playtesters -> commander triage (auto-approve) -> implementer -> merge.
# Run via run_workflow(script_path=".agents/skills/persona-playtest/workflow.py").
import asyncio
import json

REPO = "tonytonynotneet/devin-games"
GAME = "Dream Home — a cozy couple/family house sim for koto & zuza"
BASE = "https://devin-games-qoqquqcr.devinapps.com/games/dream-home/index.html?play=1"
KOTO_URL = BASE + "&as=koto"
ZUZA_URL = BASE + "&as=zuza"

PERSONAS = [
    ("zuza", "You are zuza, the girlfriend this game was made for. You care about: is it romantic, does it feel like building a life together, are the couple features (hugging, hearts, dates) delightful. You play on a phone."),
    ("casual", "You are a casual smartphone gamer with little patience. You care about: can I understand what to do in 10 seconds, do controls respond instantly, is there any frustrating dead-end or confusing UI."),
    ("kid", "You are a curious 8-year-old who mashes buttons randomly, opens every menu, tries weird gestures, rotates the phone mid-game. Your job is to find crashes, softlocks, and broken states."),
    ("critic", "You are a hardcore game critic. You care about: depth, progression, economy balance, whether the tamagotchi/season/care systems create meaningful choices, and what would make it more addictive."),
    ("grandma", "You are someone's grandmother who has never played a video game. You care about: is the text readable, are buttons obvious, is anything overwhelming, would you understand how to feed a cat."),
]

PLAYTEST_SCHEMA = {
    "type": "object",
    "properties": {
        "persona": {"type": "string"},
        "bugs": {"type": "array", "items": {"type": "string"}},
        "ideas": {"type": "array", "items": {"type": "string"}},
        "fun_score": {"type": "integer"},
        "notes": {"type": "string"},
    },
    "required": ["bugs", "ideas", "fun_score", "notes"],
}

TRIAGE_SCHEMA = {
    "type": "object",
    "properties": {
        "approved": {"type": "array", "items": {"type": "string"}},
        "rejected": {"type": "array", "items": {"type": "string"}},
        "rationale": {"type": "string"},
    },
    "required": ["approved", "rationale"],
}

IMPL_SCHEMA = {
    "type": "object",
    "properties": {
        "branch": {"type": "string"},
        "summary": {"type": "string"},
        "done": {"type": "boolean"},
    },
    "required": ["branch", "summary", "done"],
}

MERGE_SCHEMA = {
    "type": "object",
    "properties": {
        "merged": {"type": "boolean"},
        "summary": {"type": "string"},
    },
    "required": ["merged", "summary"],
}


def persona_prompt(pid, desc):
    return (
        f"{desc}\n\n"
        f"Playtest '{GAME}' on the live site. Open these URLs in an iPhone-13-emulated mobile browser "
        f"(portrait AND landscape): koto link {KOTO_URL} and zuza link {ZUZA_URL}.\n"
        "Actually interact with the game: drag on the left half of the screen to move, tap the A button to act, "
        "open the ❓ help, visit the shop/garden/barn/animals/court/sauna areas. If you cannot drive the live UI, "
        "still review the code in the repo (games/dream-home/) and reason about the experience.\n"
        "Report ONLY concrete, actionable findings. bugs = reproducible defects. ideas = specific improvements that "
        "would make it more fun or deepen the couple bond. fun_score = 1-10 for YOUR persona. notes = one line."
    )


async def main():
    await register_workflow({
        "name": "dream-home-persona-playtest",
        "description": "5 personas playtest Dream Home -> commander triages & approves -> implementer ships",
        "product": "devin-games / Dream Home",
        "soft_time_limit_minutes": 25,
        "phases": [
            {"title": "playtest", "detail": "5 personas playtest the live game in parallel",
             "count": len(PERSONAS), "labels": [p for p, _ in PERSONAS]},
            {"title": "triage", "detail": "commander dedupes, prioritizes, auto-approves top items", "count": 1},
            {"title": "implement", "detail": "implement approved items on a branch", "count": 1},
            {"title": "merge", "detail": "verify + merge to main", "count": 1},
        ],
    })

    async def playtest(pid, desc):
        return await agent(persona_prompt(pid, desc), phase="playtest", label=pid,
                           schema=PLAYTEST_SCHEMA, repos=[REPO])

    log("playtest phase: 5 personas starting")
    reports = await parallel([lambda p=pid, d=desc: playtest(p, d) for pid, desc in PERSONAS])
    reports = [r for r in reports if r]
    log(f"playtest done: {len(reports)} reports")

    triage = await agent(
        "You are the commander of an hourly autonomous improvement loop for "
        f"'{GAME}' (repo {REPO}). Below are playtest reports from 5 personas. "
        "Dedupe the bugs, judge each idea's fun-per-effort value for a couple's "
        "house sim, and auto-approve AT MOST 3 items total (bugs first, then the "
        "highest-value idea). Reject anything risky, vague, or huge. "
        "approved/rejected items = one-line actionable strings.\n\n"
        "REPORTS:\n" + json.dumps(reports, ensure_ascii=False, sort_keys=True),
        phase="triage", label="commander", schema=TRIAGE_SCHEMA, repos=[REPO])
    log("triage: " + json.dumps(triage, ensure_ascii=False))

    if not triage["approved"]:
        log("nothing approved — workflow ends")
        return

    impl = await agent(
        f"In repo {REPO}, implement these approved changes for Dream Home "
        "(games/dream-home/):\n" + json.dumps(triage["approved"], ensure_ascii=False)
        + "\n\nRules: minimal focused edits; follow existing code conventions; do NOT "
        "break existing save data (localStorage 'dreamhome-save') or the module "
        "contract (init/start/update/interactables/collectDraws/drawGround/"
        "drawOverlay/serialize/deserialize/remoteAction). Verify by serving the game "
        "and loading it in a phone-emulated browser with zero console errors. Commit "
        "and push to a NEW branch named devin/auto-<unix timestamp>, do NOT merge to "
        "main, do NOT open a PR. Report branch + summary + done.",
        phase="implement", label="implementer", schema=IMPL_SCHEMA, repos=[REPO],
        mode="ultra", soft_time_limit_minutes=40)
    log(f"implement: {impl['branch']} — {impl['summary']}")

    if not impl.get("done"):
        log("implementer reported not done — skipping merge")
        return

    merge = await agent(
        f"In repo {REPO}: fetch and merge branch {impl['branch']} into main "
        f"(git fetch origin {impl['branch']} && git merge --no-ff origin/{impl['branch']} or equivalent). "
        "First verify the merged game still works: serve it, load Dream Home on a "
        "phone-emulated browser, confirm zero console errors and the game starts. "
        "Then push main. Report merged + one-line summary.",
        phase="merge", label="merge-verify", schema=MERGE_SCHEMA, repos=[REPO])
    log(f"merge: {merge['merged']} — {merge['summary']}")


asyncio.run(main())
