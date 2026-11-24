#!/usr/bin/env node
// LGtie bridge: an OPTIONAL, self-hosted helper that a business can run. LGtie itself runs no server; this script is yours.
//
//  1. Listens on public Nostr relays for signed passkey actions that customers addressed to your wallet (the same messages the #inbox page shows).
//  2. Posts a notice to your webhook (Slack, Discord, Zapier, Make or any URL that accepts JSON).
//  3. Optionally submits each action for you with a relayer key you provide (a small gas balance only), so nobody has to open #inbox.
//  4. Optionally tells reviewers, by webhook, when a case is waiting for their decision, with a link that opens the decision form.
//
// Safety: it only ever sends to the three LGtie passkey contracts on the configured chain, simulates every action first (an invalid or already used
// action costs nothing), submits at most DAILY_CAP actions per UTC day, and never holds anything but the gas you put in the relayer key.
// Configuration is by environment variables; see bridge/README.md.
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
import { ethers } from "ethers";
const N = createRequire(import.meta.url)("../site/nostr.js");

const env = (k, d) => (process.env[k] === undefined || process.env[k] === "" ? d : process.env[k]);
const cfg = {
  rpc: env("RPC_URL", "https://rpc.xlayer.tech"), chainId: Number(env("CHAIN_ID", "196")),
  relays: env("RELAYS", "") ? env("RELAYS", "").split(",").map(s => s.trim()).filter(Boolean) : N.DEFAULT_RELAYS,
  listen: env("LISTEN_ADDRESS", ""), key: env("RELAYER_PRIVATE_KEY", ""),
  webhook: env("WEBHOOK_URL", ""), format: env("WEBHOOK_FORMAT", "json"),
  reviewerHooks: Object.fromEntries(env("REVIEWER_HOOKS", "").split(",").map(s => s.trim()).filter(Boolean).map(s => { const i = s.indexOf("="); return [s.slice(0, i).toLowerCase(), s.slice(i + 1)]; })),
  publicUrl: env("PUBLIC_URL", "https://lgtie.vercel.app/").replace(/#.*$/, ""),
  dailyCap: Number(env("DAILY_CAP", "25")), pollSeconds: Number(env("POLL_SECONDS", "60")), sinceHours: Number(env("SINCE_HOURS", "72")),
  state: env("STATE_FILE", "./bridge-state.json"), health: Number(env("HEALTH_PORT", "0")),
  passkeys: env("PASSKEYS", "0xC3c0E2Fa6D8452A14063c01DC50159487E78522E"), agreements: env("AGREEMENTS", "0x802995325A576b69175DCE24e8D643553C9ba2ed"), cases: env("CASES", "0x178bB4ddC548F3456bD5AE2de7Abe67A8DCb02d0"),
};
if (!/^0x[0-9a-fA-F]{40}$/.test(cfg.listen)) { console.error("Set LISTEN_ADDRESS to the wallet address your customers' actions are addressed to (0x…)."); process.exit(1); }
const log = (...a) => console.log(new Date().toISOString(), ...a);

const provider = new ethers.JsonRpcProvider(cfg.rpc, cfg.chainId, { staticNetwork: true });
const wallet = cfg.key ? new ethers.Wallet(cfg.key, provider) : null;
const ALLOWED = [cfg.passkeys, cfg.agreements, cfg.cases].map(a => a.toLowerCase());
const passkeysIface = new ethers.Interface(["function nonceOf(uint256) view returns (uint256)"]);
const PARTY = "(address wallet,uint256 passkey)";
const casesC = new ethers.Contract(cfg.cases, ["function count() view returns (uint256)", `function get(uint256) view returns ((uint256 ruleSetId,${PARTY} filer,${PARTY} decider,address reviewer,address filerOperator,address deciderOperator,bytes32 evidenceHash,uint256 agreementId,uint64 openedAt,uint64 answerBy,uint32 reviewWindow,uint64 reviewBy,uint64 filerAnswers,uint64 deciderAnswers,bool filerIn,bool deciderIn,uint64 disputed,uint64 finalAnswers,uint8 result,bool filerOkReviewer,bool deciderOkReviewer,bool reviewerAcked,uint8 status))`], provider);

// ----- state (so a restart does not repeat notices or submissions) -----
let state = { seen: {}, done: {}, rev: {}, submitted: {} };
try { state = { ...state, ...JSON.parse(fs.readFileSync(cfg.state, "utf8")) }; } catch (e) {}
const save = () => { try { fs.mkdirSync(path.dirname(path.resolve(cfg.state)), { recursive: true }); fs.writeFileSync(cfg.state, JSON.stringify(state)); } catch (e) { log("could not save state:", e.message); } };
const today = () => new Date().toISOString().slice(0, 10);

// ----- webhooks -----
async function post(url, event, text, extra = {}) {
  if (!url) return;
  const body = cfg.format === "slack" ? { text } : cfg.format === "discord" ? { content: text } : { event, text, at: new Date().toISOString(), ...extra };
  try { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) log("webhook answered", r.status); }
  catch (e) { log("webhook failed:", e.message); }
}
const notify = (event, text, extra) => post(cfg.webhook, event, text, extra);

// ----- reading a relay pack (the same format the site produces) -----
const b64u = s => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
function parsePack(pack) {
  let o; try { o = JSON.parse(b64u(pack)); } catch { return null; }
  const ok = o && o.v === 1 && /^0x[0-9a-fA-F]{40}$/.test(o.to || "") && /^0x[0-9a-f]+$/.test(o.data || "") && o.chainId === cfg.chainId && ALLOWED.includes(o.to.toLowerCase());
  return ok ? o : null;
}

// ----- one action: check order, simulate, submit -----
const pending = new Map();          // key -> {pack, o, at, tries}
async function attempt(key) {
  const it = pending.get(key); if (!it) return;
  const o = it.o, age = Date.now() / 1000 - it.at;
  if (age > 26 * 3600) { pending.delete(key); state.done[key] = "expired"; save(); await notify("failed", `A signed action expired before it could be submitted: ${o.summary || "action"}.`, { summary: o.summary }); return; }
  try {
    if (Number.isInteger(o.n) && Number.isInteger(o.a)) {
      const chainNonce = Number(ethers.AbiCoder.defaultAbiCoder().decode(["uint256"], await provider.call({ to: cfg.passkeys, data: passkeysIface.encodeFunctionData("nonceOf", [o.a]) }))[0]);
      if (o.n < chainNonce) { pending.delete(key); state.done[key] = "already-used"; save(); return; }   // someone already submitted it
      if (o.n > chainNonce) return;                                                                    // an earlier action from this customer has to go first; retry later
    }
    await provider.call({ from: wallet.address, to: o.to, data: o.data });                              // simulate: fails if invalid, expired or already used
  } catch (e) { pending.delete(key); state.done[key] = "rejected"; save(); log("rejected by simulation:", (e.shortMessage || e.message).slice(0, 120)); await notify("failed", `A signed action was not submitted (it would fail on-chain): ${o.summary || "action"}.`, { summary: o.summary }); return; }
  state.submitted[today()] = state.submitted[today()] || 0;
  if (state.submitted[today()] >= cfg.dailyCap) { log("daily cap reached; holding", key.slice(0, 10)); if (!it.capped) { it.capped = true; await notify("failed", `Daily submission cap (${cfg.dailyCap}) reached. Holding: ${o.summary || "action"}. Open ${cfg.publicUrl}#inbox to submit it yourself.`, { summary: o.summary }); } return; }
  try {
    const tx = await wallet.sendTransaction({ to: o.to, data: o.data }); const rc = await tx.wait(1);
    state.submitted[today()]++; pending.delete(key); state.done[key] = "submitted"; save();
    log("submitted", o.summary, tx.hash);
    await notify("submitted", `Submitted for you: ${o.summary || "a signed action"}. Transaction ${tx.hash}`, { summary: o.summary, tx: tx.hash, block: rc.blockNumber });
  } catch (e) { log("send failed:", (e.shortMessage || e.message).slice(0, 160)); it.tries = (it.tries || 0) + 1; if (it.tries >= 5) { pending.delete(key); state.done[key] = "send-failed"; save(); await notify("failed", `Could not send: ${o.summary || "action"} (${(e.shortMessage || e.message).slice(0, 100)}).`, { summary: o.summary }); } }
}
async function retryPending() { const keys = [...pending.keys()].sort((x, y) => (pending.get(x).o.n ?? 0) - (pending.get(y).o.n ?? 0)); for (const k of keys) await attempt(k); }

async function onEvent(ev) {
  let msg; try { msg = JSON.parse(ev.content); } catch { return; }
  if (!msg || typeof msg.pack !== "string") return;
  const o = parsePack(msg.pack); if (!o) { log("ignored a message that is not a valid LGtie action"); return; }
  const key = ethers.id(msg.pack); if (state.seen[key] || pending.has(key)) return;
  state.seen[key] = ev.created_at; save();
  log("received:", o.summary);
  if (!wallet) { await notify("signed", `A customer signed: ${o.summary || "an action"}. Open ${cfg.publicUrl}#inbox to review and submit it.`, { summary: o.summary, url: cfg.publicUrl + "#inbox" }); return; }
  await notify("signed", `A customer signed: ${o.summary || "an action"}. Submitting it for you.`, { summary: o.summary });
  pending.set(key, { pack: msg.pack, o, at: ev.created_at, tries: 0 }); await attempt(key);
}

// ----- reviewers: tell them when a case is waiting -----
async function checkReviewers() {
  const hooks = cfg.reviewerHooks; if (!Object.keys(hooks).length) return;
  try {
    const n = Number(await casesC.count());
    for (let id = n; id >= Math.max(1, n - 60); id--) {
      const c = await casesC.get(id); const rv = c.reviewer.toLowerCase();
      if (Number(c.status) !== 1 || !hooks[rv]) continue;
      const k = "case" + id + ":" + c.reviewBy; if (state.rev[k]) continue;
      state.rev[k] = 1; save();
      const url = `${cfg.publicUrl}#pk/case/${id}/decide`;
      await post(hooks[rv], "review_needed", `Case #${id} is waiting for your decision as the neutral reviewer. You decide only the questions the two sides disagree on, and you have until ${new Date(Number(c.reviewBy) * 1000).toUTCString()}. Open ${url}`, { caseId: id, url, reviewBy: Number(c.reviewBy) });
      log("told reviewer about case", id);
    }
  } catch (e) { log("reviewer check failed:", (e.shortMessage || e.message).slice(0, 120)); }
}

// ----- run -----
log(`LGtie bridge: listening for ${cfg.listen} on ${cfg.relays.length} relays; ${wallet ? "auto-submit ON (relayer " + wallet.address + ")" : "notify only (no RELAYER_PRIVATE_KEY)"}; webhook ${cfg.webhook ? "set" : "not set"}.`);
const since = () => Math.floor(Date.now() / 1000) - cfg.sinceHours * 3600;
let stop = N.listen(cfg.relays, N.filterFor(cfg.listen, since()), ev => onEvent(ev).catch(e => log("error:", e.message)), s => log(`relays connected: ${s.open}/${s.total}`));
// relays drop connections now and then; re-subscribe every 10 minutes (seen actions are remembered, so nothing repeats)
const resub = setInterval(() => { stop(); stop = N.listen(cfg.relays, N.filterFor(cfg.listen, since()), ev => onEvent(ev).catch(e => log("error:", e.message))); }, 10 * 60 * 1000);
const tick = setInterval(() => { retryPending().catch(() => {}); checkReviewers().catch(() => {}); }, cfg.pollSeconds * 1000);
checkReviewers().catch(() => {});
let server = null;
if (cfg.health) server = http.createServer((q, r) => { r.setHeader("content-type", "application/json"); r.end(JSON.stringify({ ok: true, pending: pending.size, submittedToday: state.submitted[today()] || 0 })); }).listen(cfg.health, "127.0.0.1");
const bye = () => { clearInterval(resub); clearInterval(tick); stop(); if (server) server.close(); save(); process.exit(0); };
process.on("SIGINT", bye); process.on("SIGTERM", bye);
