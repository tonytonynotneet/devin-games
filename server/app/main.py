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
async def ws_endpoint(ws: WebSocket, game: str = ""):
    await ws.accept()
    game = (game or "default")[:64]
    l = lobby(game)

    if l["host"] is None:
        role, me, other = "host", "host", "guest"
        l["host"] = ws
    elif l["guest"] is None:
        role, me, other = "guest", "guest", "host"
        l["guest"] = ws
        try:
            await l["host"].send_text('{"type":"peer_joined"}')
        except Exception:
            pass
    else:
        await ws.send_text('{"type":"error","msg":"room_full"}')
        await ws.close()
        return

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
