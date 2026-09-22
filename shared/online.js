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

  // Per-player links use PeerJS (free public broker, no backend needed):
  // koto always hosts as peer id "dg-<game>-koto"; zuza connects to it.
  function connectPeer(game, want) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
      const net = {
        ws: null, role: want, _conn: null, _peer: null,
        send(obj) { const c = net._conn; if (c && c.open) { try { c.send(obj); } catch (e) {} } },
        onmessage: null,
        onpeer: null,
        close() { try { net._peer && net._peer.destroy(); } catch (e) {} },
      };
      const wire = conn => {
        net._conn = conn;
        conn.on("data", d => { try { net.onmessage && net.onmessage(d); } catch (e) {} });
        conn.on("close", () => { net.onpeer && net.onpeer(false); });
      };
      if (want === "host") {
        let tries = 0;
        const mkPeer = () => {
          if (settled) return;
          const peer = (net._peer = new Peer("dg-" + game + "-koto"));
          peer.on("open", () => done(resolve, net));
          peer.on("connection", conn => {
            wire(conn);
            conn.on("open", () => net.onpeer && net.onpeer(true));
          });
          peer.on("error", e => {
            // stale ghost registration on the public broker — retry a few times
            if (e.type === "unavailable-id" && ++tries < 6) setTimeout(mkPeer, 10000);
            else if (e.type === "unavailable-id") done(reject, new Error("host_taken"));
          });
        };
        mkPeer();
      } else {
        const peer = (net._peer = new Peer());
        let tries = 0;
        const tryConn = () => {
          if (settled || peer.destroyed) return;
          const conn = peer.connect("dg-" + game + "-koto", { reliable: true });
          wire(conn);
          conn.on("open", () => { net.onpeer && net.onpeer(true); done(resolve, net); });
        };
        peer.on("open", tryConn);
        peer.on("error", e => {
          if (e.type === "peer-unavailable") {
            if (++tries < 100) setTimeout(tryConn, 3000); // wait for koto to come online
            else done(reject, new Error("no_host"));
          } else if (!settled) done(reject, e);
        });
      }
      setTimeout(() => done(reject, new Error("timeout")), 60000);
    });
  }

  window.DGOnline = {
    connect(game, want) {
      if ((want === "host" || want === "guest") && window.Peer) return connectPeer(game, want);
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
