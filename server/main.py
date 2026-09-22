import asyncio
import random
import string
import time

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# rooms: code -> {"host": ws|None, "guest": ws|None, "created": ts, "game": str}
rooms = {}
ROOM_TTL = 30 * 60  # 30 min


def new_code():
    while True:
        c = "".join(random.choices(string.ascii_uppercase + string.digits, k=4))
        if c not in rooms:
            return c


def sweep():
    now = time.time()
    for c in [c for c, r in rooms.items() if now - r["created"] > ROOM_TTL]:
        del rooms[c]


@app.get("/health")
def health():
    return {"ok": True, "rooms": len(rooms)}


async def relay(ws: WebSocket, room, me, other):
    """Forward messages from `me` to `other` role's socket."""
    try:
        while True:
            msg = await ws.receive_text()
            peer = room.get(other)
            if peer is not None:
                try:
                    await peer.send_text(msg)
                except Exception:
                    pass
    except WebSocketDisconnect:
        pass
    finally:
        if room.get(me) is ws:
            room[me] = None
        peer = room.get(other)
        if peer is not None:
            try:
                await peer.send_text('{"type":"peer_left"}')
            except Exception:
                pass


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket, room: str = "", role: str = "", game: str = ""):
    await ws.accept()
    sweep()
    room = room.upper().strip()
    role = role if role in ("host", "guest") else ""
    if role == "host":
        code = room or new_code()
        rooms[code] = {"host": ws, "guest": None, "created": time.time(), "game": game}
        await ws.send_text(f'{{"type":"room","code":"{code}"}}')
    else:  # guest
        r = rooms.get(room)
        if r is None or r.get("host") is None:
            await ws.send_text('{"type":"error","msg":"room_not_found"}')
            await ws.close()
            return
        if r.get("guest") is not None:
            await ws.send_text('{"type":"error","msg":"room_full"}')
            await ws.close()
            return
        r["guest"] = ws
        await ws.send_text(f'{{"type":"room","code":"{room}"}}')
        try:
            await r["host"].send_text('{"type":"peer_joined"}')
        except Exception:
            pass
        code = room

    r = rooms.get(code)
    if r is None:
        await ws.close()
        return
    await relay(ws, r, role, "guest" if role == "host" else "host")
    r = rooms.get(code)
    if r is not None and r.get("host") is None and r.get("guest") is None:
        del rooms[code]
