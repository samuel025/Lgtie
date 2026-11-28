// AgreementRegistryV3 on the site: a person with ONLY a passkey proposes an agreement by signature, someone else submits it, the other side accepts, and the
// passkey owner opens a case, all on the contracts that scripts/deploy-v7.sh really deploys (to a fork of X Layer). Also: withdrawing by signature, and
// that older agreements and cases stay reachable.
// Needs: site on http://localhost:8090, `anvil --fork-url https://rpc.xlayer.tech --port 8547 --auto-impersonate --silent`, puppeteer-core, foundry, Chrome.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { execSync } from "node:child_process";
const SITE = process.env.SITE || "/home/samuel/Documents/tiebreak", BASE = "http://localhost:8090/index.html", ANVIL = "http://127.0.0.1:8547";
const sh = c => execSync(c, {encoding: "utf8", cwd: SITE, env: {...process.env, ETH_RPC_URL: ANVIL}}).trim();
const rpc = async (method, params) => (await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params})})).json());
const send = (from, to, sig, ...args) => sh(`cast send ${to} "${sig}" ${args.map(a => `"${a}"`).join(" ")} --from ${from} --unlocked --rpc-url ${ANVIL} --gas-limit 8000000 >/dev/null`);
const read = (to, sig, ...args) => sh(`cast call ${to} "${sig}" ${args.map(a => `"${a}"`).join(" ")} --rpc-url ${ANVIL}`).split(" ")[0];
const OWNER = "0x0aE117C07A277D74D9326eb4e33013439dC68fD5", BUSINESS = "0x7e57000000000000000000000000000000000d11", RELAYER = "0x7e57000000000000000000000000000000000e11", REVIEWER = "0x7e57000000000000000000000000000000000f11";
for (const a of [OWNER, BUSINESS, RELAYER]) { await rpc("anvil_setBalance", [a, "0x56bc75e2d63100000"]); await rpc("anvil_impersonateAccount", [a]); }
// ---- the real deploy script, on the fork, with the per-case fee at zero so no dollar token is needed
const CFGT = "/tmp/lgtie-v7-config.js"; fs.writeFileSync(CFGT, fs.readFileSync(SITE + "/site/config.js", "utf8").replace(/\n\s*v[78]: \{[^}]*\},[^\n]*/g, ""));
const dep = sh(`CASE_FEE=0 DEPLOYER=${OWNER} RPC_URL=${ANVIL} CONFIG=${CFGT} SIGNER_ARGS="--unlocked --from ${OWNER}" scripts/deploy-v7.sh deploy 2>&1 | tail -3`);
const AG3 = /AgreementRegistryV3:\s+(0x[0-9a-fA-F]{40})/.exec(dep)[1], CASES = /TiebreakCaseV6 \(2nd\):\s+(0x[0-9a-fA-F]{40})/.exec(dep)[1];
const cfgText = fs.readFileSync(CFGT, "utf8"), PK = /v4: \{passkeys: "(0x[0-9a-fA-F]{40})"/.exec(cfgText)[1], cfg = cfgText.replace("https://rpc.xlayer.tech", ANVIL);
const words = async (to, sig, ...args) => { const r = (await rpc("eth_call", [{to, data: sh(`cast calldata "${sig}" ${args.join(" ")}`)}, "latest"])).result.slice(2); return k => BigInt("0x" + r.slice(k * 64, k * 64 + 64)); };

const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), errs = [];
let fails = 0; const ok = (n, c, x = "") => { console.log((c ? "ok   " : "FAIL ") + n + (c ? "" : " " + String(x).slice(0, 500))); if (!c) fails++; };
const w = ms => new Promise(r => setTimeout(r, ms));
const T = (p, sel) => p.$eval(sel, e => e.innerText).catch(() => "");
async function until(fn, ms = 40000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await w(400); } return false; }
async function newPage(acct) {
  const p = await b.newPage(); await p.setViewport({width: 1200, height: 1500}); p.on("pageerror", e => errs.push(e.message));
  await p.setRequestInterception(true); p.on("request", r => { if (r.url().endsWith("/config.js")) r.respond({status: 200, contentType: "application/javascript", body: cfg}); else r.continue(); });
  await p.evaluateOnNewDocument((ANVIL, acct) => { try { localStorage.setItem("lgtie.lang", "en"); localStorage.setItem("acct", acct); localStorage.setItem("lgtie.inboxRelays", "[]"); } catch (e) {}
    window.ethereum = {request: async ({method, params}) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [localStorage.getItem("acct")];
      if (method === "eth_chainId") return "0xc4"; if (method === "wallet_switchEthereumChain") return null;
      if (method === "eth_sendTransaction") { const r = await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params: [{...params[0], gas: "0x2000000"}]})})).json(); if (r.error) throw new Error(r.error.message); return r.result; }
      throw new Error("unsupported " + method); }}; }, ANVIL, acct);
  return p;
}
// Maya has only a passkey: a virtual authenticator stands in for her phone
const maya = await newPage(""); const cdp = await maya.target().createCDPSession(); await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {options: {protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true}});
const mayaGo = async hash => { await maya.goto(BASE + "?" + Date.now() + hash); await w(900); };
const submit = async link => { const r = await newPage(RELAYER); await r.goto(link); const good = await until(async () => !(await r.$eval("#go", e => e.disabled).catch(() => true))); if (good) { await r.click("#go"); await until(async () => /Submitted/.test(await T(r, "#done"))); } const out = await T(r, "main"); await r.close(); return {good, out}; };

// ---- 1. Maya creates a passkey; a wallet registers it (anyone can)
await mayaGo("#join"); await maya.click("#mk");
ok("Maya gets a claim code", await until(async () => /^lgtie1\./.test(await maya.$eval("#claim", e => e.value).catch(() => ""))));
const claim = await maya.$eval("#claim", e => e.value), kk = await maya.evaluate(c => { const k = window.TB_PASSKEYS.parseClaim(c); return {h: String(k.handleHash), x: String(k.x), y: String(k.y), rp: String(k.rpIdHash)}; }, claim);
send(BUSINESS, PK, "create(bytes32,(uint256,uint256,bytes32))", kk.h, `(${kk.x},${kk.y},${kk.rp})`);
const ACCT = Number(read(PK, "count()(uint256)")); ok("her passkey is registered as an account", ACCT >= 1, ACCT);

// ---- 2. she proposes with her passkey (no wallet), for a wallet on the other side
await mayaGo("#mine"); await maya.click("#find");
ok("the page confirms her passkey controls the account", await until(async () => /is controlled by your passkey/.test(await T(maya, "#fm"))), await T(maya, "#fm"));
ok("with the V3 registry live she is offered 'Propose an agreement with my passkey'", await until(async () => !!(await maya.$("#propcard"))), await T(maya, "#list"));
const propose = async (note) => { await maya.$eval("#pp-cp", (e, v) => { e.value = v; }, BUSINESS); await maya.$eval("#pp-rv", (e, v) => { e.value = v; }, REVIEWER); await maya.$eval("#pp-terms", (e, v) => { e.value = v; }, note); await maya.click("#pp-go"); return until(async () => !!(await maya.$("#pp-out #cplink"))); };
ok("a bad counterparty is refused with a plain message before any signing", await (async () => { await maya.$eval("#pp-cp", e => { e.value = "nonsense"; }); await maya.click("#pp-go"); return until(async () => /wallet address \(0x…\) or their passkey account number/.test(await T(maya, "#pp-msg"))); })(), await T(maya, "#pp-msg"));
ok("she signs a proposal and gets a link for someone to submit", await propose("Sale of a used laptop, ₦250,000"), await T(maya, "#pp-msg"));
const link1 = await maya.$eval("#pp-out #cplink", e => e.dataset.link);
ok("nothing is on-chain yet: signing alone sends nothing", read(AG3, "count()(uint256)") === "0");

// ---- 3. a wallet holder (any wallet) submits it and pays the fee
const s1 = await submit(link1);
ok("the relay page checks it would succeed and submits it", s1.good && /Submitted/.test(s1.out), s1.out);
ok("the agreement is on the V3 registry with Maya's passkey account as proposer and no wallet", read(AG3, "count()(uint256)") === "1" && (await words(AG3, "get(uint256)", 1))(0) === 0n && (await words(AG3, "get(uint256)", 1))(1) === BigInt(ACCT));
const again = await submit(link1);
ok("the same link cannot be submitted twice: the page warns it would fail, and nothing new lands on-chain", /This would fail right now/.test(again.out) && read(AG3, "count()(uint256)") === "1", again.out);

// ---- 4. the other side (a wallet) accepts
send(BUSINESS, AG3, "accept(uint256)", "1");
await mayaGo("#mine"); await maya.click("#find");
ok("Maya sees the agreement in force, proposed by 'you'", await until(async () => /Agreement #1/.test(await T(maya, "#ags")) && /In force/.test(await T(maya, "#ags")) && /Proposed by you/.test(await T(maya, "#ags"))), await T(maya, "#ags"));
ok("the public agreement page names the passkey account as proposer", await (async () => { const v = await newPage(""); await v.goto(BASE + "#pk/agreement/1"); const good = await until(async () => /Proposed by\s+passkey account #/.test(await T(v, "main"))); await v.close(); return good; })());

// ---- 5. she opens a dispute by signature; someone else submits
await maya.click('[data-act="open"]');
ok("she signs the opening of a case", await until(async () => !!(await maya.$("#ags .act #cplink"))), await T(maya, "#ags"));
const link2 = await maya.$eval("#ags .act #cplink", e => e.dataset.link), s2 = await submit(link2);
ok("the case is opened on the second TiebreakCaseV6, with Maya's passkey as the filer", s2.good && read(CASES, "count()(uint256)") === "1" && (await words(CASES, "get(uint256)", 1))(2) === BigInt(ACCT), s2.out);
const pg = await newPage(""); await pg.goto(BASE + "#pk/case/1");
ok("the case page reads it", await until(async () => /Case #1/.test(await T(pg, "main")) && /Waiting for answers/.test(await T(pg, "main"))), await T(pg, "main"));
await pg.close();

// ---- 6. withdrawing a proposal by signature
await mayaGo("#mine"); await maya.click("#find"); await until(async () => !!(await maya.$("#propcard")));
ok("she signs a second proposal", await propose("A deal she will withdraw"));
const s3 = await submit(await maya.$eval("#pp-out #cplink", e => e.dataset.link));
ok("it is on-chain as agreement #2, waiting", s3.good && read(AG3, "count()(uint256)") === "2" && read(AG3, "inForce(uint256)(bool)", 2) === "false");
await mayaGo("#mine"); await maya.click("#find");
ok("she sees 'Withdraw this proposal' on it", await until(async () => !!(await maya.$('[data-act="withdraw"]'))), await T(maya, "#ags"));
await maya.click('[data-act="withdraw"]');
ok("she signs the withdrawal", await until(async () => !!(await maya.$("#ags .act #cplink"))), await T(maya, "#ags"));
const s4 = await submit(await maya.$eval("#ags .act #cplink", e => e.dataset.link));
ok("the proposal is cancelled on-chain", s4.good && (await words(AG3, "get(uint256)", 2))(11) === 1n, s4.out);

// ---- 7. older contracts stay reachable
const old = await newPage(""); await old.goto(BASE + "#pk/v2agreement/1");
ok("an agreement on the older registry still opens at #pk/v2agreement/1", await until(async () => /Agreement #1/.test(await T(old, "main"))), await T(old, "main"));
await old.goto(BASE + "#pk/v6case/1"); await old.reload();
ok("an older case address still routes without breaking", await until(async () => /Case #1|does not exist/.test(await T(old, "main"))), await T(old, "main"));
const all = await newPage(""); await all.goto(BASE + "#pk/cases");
ok("the all-cases page lists the new agreements and the earlier ones", await until(async () => /Agreement #2/.test(await T(all, "main")) && /earlier contract/.test(await T(all, "main"))), await T(all, "main"));
const pr = await newPage(""); await pr.goto(BASE + "#pricing");
ok("the pricing page uses the newest billing contract and mentions the earlier ones", await until(async () => /subscribe again here/.test(await T(pr, "main"))), (await T(pr, "main")).slice(0, 300));
ok("no page errors", errs.length === 0, errs.join(" | "));
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
