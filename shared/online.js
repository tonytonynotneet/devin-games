/* devin-games online relay client.
   Host creates a room (4-char code), guest joins with the code.
   Messages are JSON strings relayed verbatim between the two peers.
   Usage:
     const net = await DGOnline.host("snake-battle");      // -> {code}
     const net = await DGOnline.join("snake-battle", "AB12");
     net.send({type:"input", ...});  net.onmessage = data => {...};
     net.onpeer = joined => {...};   // guest joined / peer left
*/
(function () {
  // Production relay. For local testing override via `?ws=ws://localhost:8765/ws`
  // URL param or `localStorage.DG_WS`.
  const WS_URL =
    new URLSearchParams(location.search).get("ws") ||
    (window.localStorage && localStorage.getItem("DG_WS")) ||
    "wss://devin-games-relay.fly.dev/ws";

  function connect(params) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL + "?" + params);
      const net = {
        ws,
        code: null,
        send(obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); },
        onmessage: null,   // (dataObj) => {}
        onpeer: null,      // (true=joined / false=left) => {}
        close() { try { ws.close(); } catch (e) {} },
      };
      ws.onmessage = e => {
        let d;
        try { d = JSON.parse(e.data); } catch (err) { return; }
        if (d.type === "room") { net.code = d.code; resolve(net); }
        else if (d.type === "error") { reject(new Error(d.msg)); }
        else if (d.type === "peer_joined") { net.onpeer && net.onpeer(true); }
        else if (d.type === "peer_left") { net.onpeer && net.onpeer(false); }
        else { net.onmessage && net.onmessage(d); }
      };
      ws.onerror = () => reject(new Error("connect_failed"));
      setTimeout(() => { if (net.code === null) reject(new Error("timeout")); }, 8000);
    });
  }

  window.DGOnline = {
    host(game) { return connect(`role=host&game=${encodeURIComponent(game)}`); },
    join(game, code) { return connect(`role=guest&game=${encodeURIComponent(game)}&room=${encodeURIComponent(code)}`); },
  };
})();
