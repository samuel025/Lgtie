// A minimal in-memory Nostr relay (NIP-01: EVENT, REQ, CLOSE) for tests. Needs the `ws` package (installed next to puppeteer-core).
// startRelay(port, {drop}) -> {close(), events, size()}; `drop: true` makes it accept nothing (to test the failure path).
import { WebSocketServer } from "ws";
export function startRelay(port, opts = {}) {
  const events = [], subs = new Set();
  const matches = (f, e) => (!f.kinds || f.kinds.includes(e.kind)) && (!f.since || e.created_at >= f.since) && Object.keys(f).filter(k => k[0] === "#").every(k => e.tags.some(t => t[0] === k.slice(1) && f[k].includes(t[1])));
  const wss = new WebSocketServer({ port, host: "127.0.0.1" });
  wss.on("connection", ws => {
    const mine = new Map();
    ws.on("message", raw => {
      let m; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m[0] === "EVENT") { if (opts.drop) return; events.push(m[1]); ws.send(JSON.stringify(["OK", m[1].id, true, ""])); for (const s of subs) if (s.f && matches(s.f, m[1])) s.ws.send(JSON.stringify(["EVENT", s.id, m[1]])); }
      if (m[0] === "REQ") { const s = { ws, id: m[1], f: m[2] }; subs.add(s); mine.set(m[1], s); events.filter(e => matches(m[2], e)).forEach(e => ws.send(JSON.stringify(["EVENT", m[1], e]))); ws.send(JSON.stringify(["EOSE", m[1]])); }
      if (m[0] === "CLOSE") { const s = mine.get(m[1]); if (s) subs.delete(s); }
    });
    ws.on("close", () => mine.forEach(s => subs.delete(s)));
  });
  return { events, size: () => events.length, close: () => new Promise(r => { wss.clients.forEach(c => c.terminate()); wss.close(r); }) };
}
