// End to end test of the optional LGtie bridge (bridge/lgtie-bridge.mjs): notify-only mode, auto-submit, reviewer pings, garbage ignored, daily cap.
// Real pages, a Chrome virtual authenticator, a local Nostr relay, a local webhook receiver and the V4 contracts on a fork of X Layer (anvil on 8547).
// Needs: anvil forking X Layer on 127.0.0.1:8547, forge, Chrome, the site served at http://localhost:8090, and `npm install` inside bridge/.
import puppeteer from "puppeteer-core"; import fs from "node:fs"; import crypto from "node:crypto"; import {execFileSync} from "node:child_process"; import {startRelay} from "./nostr-relay.mjs"; import http from "node:http"; import {spawn} from "node:child_process"; import {createRequire} from "node:module";
const relay = startRelay(8099); let RELAYS = ["ws://127.0.0.1:8099"];   // a local Nostr relay stands in for the public ones
const BASE = "http://localhost:8090/index.html", ANVIL = "http://127.0.0.1:8547", CFGP = "/home/samuel/Documents/tiebreak/site/config.js", REG = "0x25E87D367316038a2d3B6A4fe3d58AA453D4c219", PROC = "0x9e2849c04a513fe64db07521cbe52d078d905c0e";
const BUSINESS = "0x7e57000000000000000000000000000000000d01", REVIEWER = "0x7e57000000000000000000000000000000000e01", RELAYER = "0x7e57000000000000000000000000000000000c01", DEPLOYER = "0x7e57000000000000000000000000000000000dd1";
const arpc = async (m, p) => { const r = await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method: m, params: p})})).json(); if (r.error) throw new Error(JSON.stringify(r.error)); return r.result; };
for (const a of [BUSINESS, REVIEWER, RELAYER, DEPLOYER]) { await arpc("anvil_setBalance", [a, "0x56bc75e2d63100000"]); await arpc("anvil_impersonateAccount", [a]); }
const forge = args => execFileSync("forge", args, {cwd: "/home/samuel/Documents/tiebreak/contracts", encoding: "utf8"});
const create = (name, ...args) => /Deployed to: (0x[0-9a-fA-F]{40})/.exec(forge(["create", name, "--rpc-url", ANVIL, "--unlocked", "--from", DEPLOYER, "--broadcast", ...(args.length ? ["--constructor-args", ...args] : [])]))[1];
// USE_DEPLOYED=1 runs the same story against the contracts already deployed on mainnet (they exist on the fork); otherwise it deploys fresh copies.
const dep = process.env.USE_DEPLOYED ? /v4: \{passkeys: "(0x[0-9a-fA-F]{40})", agreements: "(0x[0-9a-fA-F]{40})", cases: "(0x[0-9a-fA-F]{40})"/.exec(fs.readFileSync(CFGP, "utf8")) : null;
const PK = dep ? dep[1] : create("src/PasskeyRegistry.sol:PasskeyRegistry"), AG = dep ? dep[2] : create("src/AgreementRegistryV2.sol:AgreementRegistryV2", REG, PK), CS = dep ? dep[3] : create("src/TiebreakCaseV4.sol:TiebreakCaseV4", REG, AG, PK, PROC);
console.log("PasskeyRegistry", PK, "| AgreementRegistryV2", AG, "| TiebreakCaseV4", CS, "on the fork");
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push("pageerror: " + e.message));
let fails = 0; const ok = (n, c, x = "") => { console.log((c ? "ok   " : "FAIL ") + n + (c ? "" : " " + String(x).slice(0, 400))); if (!c) fails++; };
const shot = async n => { if (process.env.SHOTS) { fs.mkdirSync(process.env.SHOTS, {recursive: true}); await w(1500); await p.screenshot({path: process.env.SHOTS + "/" + n + ".png", fullPage: true}); } };   // SHOTS=/some/dir saves screenshots
const T = sel => p.$eval(sel, e => e.innerText).catch(() => ""), w = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await w(300); } return false; }
const cfg = fs.readFileSync(CFGP, "utf8").replace("https://rpc.xlayer.tech", ANVIL).replace(/v4: \{[^}]*\}/, `v4: {passkeys: "${PK}", agreements: "${AG}", cases: "${CS}"}`);
await p.setRequestInterception(true);
p.on("request", r => { if (r.url().endsWith("/config.js")) r.respond({status: 200, contentType: "application/javascript", body: cfg}); else r.continue(); });
await p.evaluateOnNewDocument(ANVIL => { window.ethereum = {request: async ({method, params}) => {
  if (method === "eth_requestAccounts" || method === "eth_accounts") return [localStorage.getItem("acct")];
  if (method === "eth_chainId") return "0xc4"; if (method === "wallet_switchEthereumChain") return null;
  if (method === "eth_sendTransaction") { const r = await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params: [{...params[0], gas: "0x2000000"}]})})).json(); if (r.error) throw new Error(r.error.message); return r.result; }
  throw new Error("unsupported " + method); }}; }, ANVIL);
const cdp = await p.target().createCDPSession(); await cdp.send("WebAuthn.enable");
const authn = async () => (await cdp.send("WebAuthn.addVirtualAuthenticator", {options: {protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true}})).authenticatorId;
const mayaDevice = await authn();
const as = async (addr, hash) => { await p.evaluate((a, r) => { localStorage.setItem("acct", a); localStorage.setItem("lgtie.inboxRelays", JSON.stringify(r)); }, addr, RELAYS).catch(() => {}); await p.goto(BASE + "?" + Date.now() + hash); await w(900); };
const clickText = (sel, text) => p.evaluate((s, t) => { const b = [...document.querySelectorAll(s)].find(x => x.textContent.trim().startsWith(t)); if (!b) return false; b.click(); return true; }, sel, text);
await p.goto(BASE); await p.evaluate(() => localStorage.setItem("acct", ""));
const answers = async (noIdx) => p.evaluate(n => document.querySelectorAll("#ans .yn, .card .qs .yn").forEach((g, i) => g.querySelector(`button[data-v="${(g.dataset.i ?? i) == n ? 0 : 1}"]`).click()), noIdx ?? -1);

// ---- 1. Maya creates a passkey and gets a claim code. No wallet is involved.

const N = createRequire(import.meta.url)("/home/samuel/Documents/tiebreak/site/nostr.js");
// ---- a webhook receiver and the bridge process
const HOOKS = []; const hookSrv = http.createServer((q, r) => { let d = ""; q.on("data", c => d += c); q.on("end", () => { try { HOOKS.push({path: q.url, body: JSON.parse(d)}); } catch (e) {} r.end("ok"); }); }).listen(8097, "127.0.0.1");
const hooks = path => HOOKS.filter(h => h.path === path).map(h => h.body);
const hookWait = (path, re, ms = 45000) => until(async () => hooks(path).some(b => re.test(b.text)), ms);
const BRIDGE = process.env.BRIDGE_PATH || "/home/samuel/Documents/tiebreak/bridge/lgtie-bridge.mjs", STATE = "/tmp/lgtie-bridge-test-state.json", PIDF = "/tmp/lgtie-bridge-test.pid";
fs.rmSync(STATE, {force: true});
const DEVKEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", DEVADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
await arpc("anvil_setBalance", [DEVADDR, "0x56bc75e2d63100000"]);
let proc = null, out = "";
const startBridge = async extra => { out = ""; proc = spawn(process.execPath, [BRIDGE], {env: {...process.env, LISTEN_ADDRESS: BUSINESS, RPC_URL: ANVIL, CHAIN_ID: "196", RELAYS: "ws://127.0.0.1:8099", PASSKEYS: PK, AGREEMENTS: AG, CASES: CS, WEBHOOK_URL: "http://127.0.0.1:8097/biz", REVIEWER_HOOKS: REVIEWER + "=http://127.0.0.1:8097/reviewer", PUBLIC_URL: BASE, POLL_SECONDS: "2", STATE_FILE: STATE, ...extra}}); fs.writeFileSync(PIDF, String(proc.pid)); proc.stdout.on("data", d => out += d); proc.stderr.on("data", d => out += d); return until(async () => /relays connected: 1\/1/.test(out), 20000); };
const stopBridge = async () => { if (proc) { const e = new Promise(r => proc.once("exit", r)); proc.kill("SIGTERM"); await e; proc = null; fs.rmSync(PIDF, {force: true}); } };
const b64u = o => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// ---- 1. Maya has a passkey; the business proposes an agreement.
await as("", "#join"); await p.click("#mk");
await until(async () => /^lgtie1\./.test(await p.$eval("#claim", e => e.value).catch(() => "")));
const claim = await p.$eval("#claim", e => e.value);
await as(BUSINESS, "#pk/agree"); await p.type("#cc", claim); await p.type("#rv", REVIEWER); await p.type("#terms", "Acme Laptops sales terms v1"); await p.click("#go");
ok("the business registers the customer and proposes", await until(async () => /^#pk\/agreement\/1$/.test(await p.evaluate(() => location.hash))), await T("#msg"));

// ---- A. Notify-only mode: no relayer key. The bridge tells the webhook; the business still submits from #inbox.
ok("the bridge starts and connects to the relay (notify-only)", await startBridge({}), out);
ok("it says it is notify-only", /notify only/.test(out), out);
await as("", "#mine"); await p.click("#find"); await until(async () => !!(await p.$('[data-act="accept"]'))); await p.click('[data-act="accept"]');
ok("Maya signs the acceptance and her phone posts it", await until(async () => /Sent to the other side's inbox/.test(await T("#inboxst"))), await T("#packbox"));
ok("the webhook is told, with a link to the inbox", await hookWait("/biz", /A customer signed: Accept agreement #1\. Open .*#inbox/), JSON.stringify(hooks("/biz")));
await as(BUSINESS, "#pk/agreement/1");
ok("without a relayer key nothing was submitted for her", /waiting for the customer/i.test(await T("main")) && !/In force since/.test(await T("main")), await T("main"));
await as(BUSINESS, "#inbox"); await p.click("#ibc").catch(() => {});
ok("the inbox page still works as the fallback", await until(async () => /Waiting for you \(1\)/.test(await T("#ibl"))), await T("#ibl"));
await p.click("[data-go]"); ok("the business submits from the inbox", await until(async () => /Submitted/.test(await T("#ibs"))), await T("#ibs"));
// garbage addressed to the business is ignored
const before = hooks("/biz").length, ev1 = await N.makeEvent(BUSINESS, {note: "not an action"}), ev2 = await N.makeEvent(BUSINESS, {v: 1, pack: b64u({v: 1, to: "0x000000000000000000000000000000000000dEaD", data: "0x00", chainId: 196, summary: "evil"})}), ev3 = await N.makeEvent(BUSINESS, {v: 1, pack: b64u({v: 1, to: CS, data: "0x00", chainId: 1, summary: "wrong chain"})});
for (const e of [ev1, ev2, ev3]) await N.publish(["ws://127.0.0.1:8099"], e);
await w(3500);
ok("messages that are not valid LGtie actions are ignored (no webhook, no submission)", hooks("/biz").length === before && /ignored a message/.test(out), out + JSON.stringify(hooks("/biz").slice(before)));

// ---- B. Auto-submit mode: a relayer key. A restart must not repeat anything.
await stopBridge(); ok("the bridge restarts with a relayer key", await startBridge({RELAYER_PRIVATE_KEY: DEVKEY}), out);
ok("it says auto-submit is on", /auto-submit ON/.test(out), out);
await w(2500);
ok("a restart does not repeat the earlier notice", hooks("/biz").filter(b => /Accept agreement #1/.test(b.text)).length === 1, JSON.stringify(hooks("/biz")));
await as(BUSINESS, "#pk/agreement/1"); await p.click("#acts button");
await until(async () => /^#pk\/case\/1$/.test(await p.evaluate(() => location.hash)));
await w(800); await clickText("#wacts button", "Answer the questions"); await w(300); await answers(-1); await p.click("#send");
ok("the business answers with its wallet", await until(async () => /Waiting for answers/.test(await T("main")) && /Yes/.test(await T("tbody"))), await T("main"));
fs.writeFileSync("/tmp/lgtie-bridge-doc.txt", "receipt for the purchase");
await as("", "#mine"); await p.click("#find"); await until(async () => !!(await p.$('[data-act="answer"]')));
await p.evaluate(() => document.querySelectorAll("#cs .qs .yn").forEach((g, i) => g.querySelector(`button[data-v="${i === 4 ? 0 : 1}"]`).click()));
await p.click('[data-act="answer"]'); await until(async () => /Sent to the other side's inbox/.test(await T("#inboxst")));
// and, without waiting, a second signed action (evidence): it must still go through in order, whether or not the first has landed yet
await p.click('[data-act="evidence"]'); await p.type("#evn", "Receipt for the purchase"); await (await p.$("#evf")).uploadFile("/tmp/lgtie-bridge-doc.txt"); await p.click("#evgo");
ok("Maya signs evidence right behind her answers", await until(async () => /Evidence for case #1: Receipt for the purchase/.test(await T("#packbox"))), await T("#cs"));
ok("the bridge submits her answers for her", await hookWait("/biz", /Submitted for you: Answers for case #1/), JSON.stringify(hooks("/biz")) + out);
ok("then her evidence, in order", await hookWait("/biz", /Submitted for you: Evidence for case #1: Receipt for the purchase/), JSON.stringify(hooks("/biz")) + out);
await as(BUSINESS, "#pk/case/1");
ok("the case is waiting for the reviewer with question 5 disputed, and the evidence is recorded, with nobody opening the inbox", await until(async () => /Waiting for the reviewer/.test(await T("main")) && /Disputed/.test(await T("tbody")) && /Receipt for the purchase/.test(await T("main"))), await T("main"));
ok("the reviewer's webhook is told, with a link that opens the decision form", await hookWait("/reviewer", /Case #1 is waiting for your decision.*#pk\/case\/1\/decide/), JSON.stringify(hooks("/reviewer")) + out);
await w(5000);
ok("the reviewer is told once, not on every check", hooks("/reviewer").length === 1, JSON.stringify(hooks("/reviewer")));

// ---- C. The daily cap: a held action is announced, stays off-chain, and the inbox still has it.
await stopBridge(); ok("the bridge restarts with a daily cap of zero", await startBridge({RELAYER_PRIVATE_KEY: DEVKEY, DAILY_CAP: "0"}), out);
fs.writeFileSync("/tmp/lgtie-bridge-doc2.txt", "warranty card");
await as("", "#mine"); await p.click("#find"); await until(async () => !!(await p.$('[data-act="evidence"]'))); await p.click('[data-act="evidence"]');
await p.type("#evn", "Warranty card"); await (await p.$("#evf")).uploadFile("/tmp/lgtie-bridge-doc2.txt"); await p.click("#evgo");
ok("the bridge announces that the daily cap is holding the action", await hookWait("/biz", /Daily submission cap \(0\) reached\. Holding: Evidence for case #1: Warranty card/), JSON.stringify(hooks("/biz").slice(-3)) + out);
await as(BUSINESS, "#pk/case/1"); await w(1200);
ok("the held action is not on-chain", !/Warranty card/.test(await T("main")), await T("main"));
await as(BUSINESS, "#inbox"); await p.click("#ibc").catch(() => {});
ok("and the business can still submit it from the inbox", await until(async () => /Waiting for you \(1\)/.test(await T("#ibl")) && /Warranty card/.test(await T("#ibl"))), await T("#ibl"));

await stopBridge(); hookSrv.close(); await b.close();
console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
