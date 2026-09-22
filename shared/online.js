/* devin-games online relay client — auto-pairing, no room codes.
   The first person to open a game becomes host (P1); the second becomes guest (P2).
   Messages are JSON strings relayed verbatim between the two peers.
   Usage:
     const net = await DGOnline.connect("snake-battle");
     net.role               // "host" | "guest"
     net.send({type:"input", ...});
     net.onmessage = data => {...};
     net.onpeer = joined => {...};   // true = opponent connected / false = left
*/
(function () {
  // Production relay. For local testing override via `?ws=ws://localhost:8765/ws`
  // URL param or `localStorage.DG_WS`.
  const WS_URL =
    new URLSearchParams(location.search).get("ws") ||
    (window.localStorage && localStorage.getItem("DG_WS")) ||
    "wss://devin-games-relay.fly.dev/ws";

  window.DGOnline = {
    connect(game, want) {
      return new Promise((resolve, reject) => {
        let url = WS_URL + "?game=" + encodeURIComponent(game);
        if (want === "host" || want === "guest") url += "&role=" + want;
        const ws = new WebSocket(url);
        const net = {
          ws,
          role: null,
          send(obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); },
          onmessage: null,   // (dataObj) => {}
          onpeer: null,      // (true=joined / false=left) => {}
          close() { try { ws.close(); } catch (e) {} },
        };
        ws.onmessage = e => {
          let d;
          try { d = JSON.parse(e.data); } catch (err) { return; }
          if (d.type === "joined") { net.role = d.role; resolve(net); }
          else if (d.type === "error") { reject(new Error(d.msg)); }
          else if (d.type === "peer_joined") { net.onpeer && net.onpeer(true); }
          else if (d.type === "peer_left") { net.onpeer && net.onpeer(false); }
          else { net.onmessage && net.onmessage(d); }
        };
        ws.onerror = () => reject(new Error("connect_failed"));
        ws.onclose = () => { if (net.role === null) reject(new Error("closed")); };
        setTimeout(() => { if (net.role === null) reject(new Error("timeout")); }, 8000);
      });
    },
  };
})();
