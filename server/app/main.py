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

# lobbies: game -> {"host": ws|None, "guest": ws|None, "created": ts}
# First person to open a game becomes host (P1); second becomes guest (P2).
lobbies = {}
TTL = 30 * 60


def lobby(game):
    l = lobbies.get(game)
    if l is None or time.time() - l["created"] > TTL:
        l = {"host": None, "guest": None, "created": time.time()}
        lobbies[game] = l
    return l


@app.get("/health")
def health():
    return {"ok": True, "games": len(lobbies)}


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket, game: str = "", role: str = ""):
    await ws.accept()
    game = (game or "default")[:64]
    want = role if role in ("host", "guest") else None
    l = lobby(game)

    if want and l[want] is None:
        me = want
    elif l["host"] is None:
        me = "host"
    elif l["guest"] is None:
        me = "guest"
    else:
        await ws.send_text('{"type":"error","msg":"room_full"}')
        await ws.close()
        return
    role = me
    other = "guest" if me == "host" else "host"
    l[me] = ws
    peer = l.get(other)
    if peer is not None:
        try:
            await peer.send_text('{"type":"peer_joined"}')
        except Exception:
            pass

    await ws.send_text(f'{{"type":"joined","role":"{role}"}}')

    try:
        while True:
            msg = await ws.receive_text()
            peer = l.get(other)
            if peer is not None:
                try:
                    await peer.send_text(msg)
                except Exception:
                    pass
    except WebSocketDisconnect:
        pass
    finally:
        if l.get(me) is ws:
            l[me] = None
            l["created"] = time.time()  # keep lobby alive for rejoins
            peer = l.get(other)
            if peer is not None:
                try:
                    await peer.send_text('{"type":"peer_left"}')
                except Exception:
                    pass
            elif l["host"] is None and l["guest"] is None:
                lobbies.pop(game, None)
