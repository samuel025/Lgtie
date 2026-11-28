// Revenue, end to end on a fork of X Layer: deploys a mock dollar token and then the contracts with the real deploy script (LGtieBilling and
// TiebreakCaseV5), and drives the pricing page and the "open a dispute" button in a real browser with a test wallet. Nothing touches mainnet.
// Needs: the site on http://localhost:8090, puppeteer-core, Foundry (anvil, forge, cast), and a fork running:
//   anvil --fork-url https://rpc.xlayer.tech --port 8547 --auto-impersonate --silent
import puppeteer from "puppeteer-core"; import fs from "node:fs"; import {execSync} from "node:child_process";
const BASE = "http://localhost:8090/index.html", ANVIL = "http://127.0.0.1:8547", SITE = "/home/samuel/Documents/tiebreak";
const A = n => "0x7e5700000000000000000000000000000000" + String(n).padStart(4, "0");
const [OWNER, SUB, PLAIN, CUST, REVIEWER, TREASURY, BROKE] = [A(2001), A(2002), A(2003), A(2004), A(2005), A(2006), A(2007)];
const arpc = async (m, p) => { const r = await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method: m, params: p})})).json(); if (r.error) throw new Error(JSON.stringify(r.error)); return r.result; };
for (const a of [OWNER, SUB, PLAIN, CUST, REVIEWER, BROKE]) { await arpc("anvil_setBalance", [a, "0x56bc75e2d63100000"]); await arpc("anvil_impersonateAccount", [a]); }
const sh = c => execSync(c, {encoding: "utf8", cwd: SITE, env: {...process.env, ETH_RPC_URL: ANVIL}}).trim();
const send = (from, to, sig, ...args) => sh(`cast send ${to} "${sig}" ${args.map(a => `"${a}"`).join(" ")} --from ${from} --unlocked --rpc-url ${ANVIL} --gas-limit 8000000 >/dev/null`);
const read = (to, sig, ...args) => sh(`cast call ${to} "${sig}" ${args.map(a => `"${a}"`).join(" ")} --rpc-url ${ANVIL}`).split(" ")[0];
// ---- set up: a mock dollar token, then the same deploy script that is used for mainnet
const TOKEN = /Deployed to: (0x[0-9a-fA-F]{40})/.exec(sh(`cd contracts && forge create test/MockUSD.sol:MockUSD --from ${OWNER} --unlocked --broadcast --rpc-url ${ANVIL} 2>&1`))[1];
const CFG = "/tmp/lgtie-billing-config.js"; fs.writeFileSync(CFG, fs.readFileSync(SITE + "/site/config.js", "utf8").replace(/\n\s*v[67]: \{[^}]*\},[^\n]*/g, ""));   // this story tests the V5 flow it deploys, so the repo's live v6 and v7 lines are dropped
const dep = sh(`TOKEN=${TOKEN} TREASURY=${TREASURY} DEPLOYER=${OWNER} RPC_URL=${ANVIL} CONFIG=${CFG} SIGNER_ARGS="--unlocked --from ${OWNER}" scripts/deploy-v5.sh deploy 2>&1 | tail -3`);
const BILLING = /LGtieBilling:\s+(0x[0-9a-fA-F]{40})/.exec(dep)[1], CASES = /TiebreakCaseV5:\s+(0x[0-9a-fA-F]{40})/.exec(dep)[1];
const AG = /v4: \{[^}]*agreements: "(0x[0-9a-fA-F]{40})"/.exec(fs.readFileSync(CFG, "utf8"))[1];
const bal = a => BigInt(read(TOKEN, "balanceOf(address)(uint256)", a));
for (const a of [SUB, PLAIN, CUST]) send(OWNER, TOKEN, "mint(address,uint256)", a, "1000000000");
// agreements under rule set #1: SUB is the business of one, PLAIN of the other; CUST is the customer in both
const D = 3 * 86400, PROPOSE = "propose((address,uint256),uint256,bytes32,address,uint32,uint32)";
const mkAgreement = (biz, salt) => { send(biz, AG, PROPOSE, `(${CUST},0)`, "1", "0x" + salt.repeat(32), REVIEWER, D, D); const id = read(AG, "count()(uint256)"); send(CUST, AG, "accept(uint256)", id); return Number(id); };
const AG_SUB = mkAgreement(SUB, "11"), AG_PLAIN = mkAgreement(PLAIN, "22"), AG_BROKE = mkAgreement(BROKE, "33");

const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), errs = [];
let fails = 0; const ok = (n, c, x = "") => { console.log((c ? "ok   " : "FAIL ") + n + (c ? "" : " " + String(x).slice(0, 400))); if (!c) fails++; };
const w = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await w(400); } return false; }
async function page(lang = "en", cfg = CFG) {
  const p = await b.newPage(); await p.setViewport({width: 1280, height: 1000}); p.on("pageerror", e => errs.push(e.message));
  await p.evaluateOnNewDocument(l => { try { localStorage.setItem("lgtie.lang", l); } catch (e) {} }, lang);
  await p.setRequestInterception(true);
  p.on("request", r => { if (r.url().endsWith("/config.js")) r.respond({status: 200, contentType: "application/javascript", body: fs.readFileSync(cfg, "utf8").replace("https://rpc.xlayer.tech", ANVIL)}); else r.continue(); });
  await p.evaluateOnNewDocument(ANVIL => {
    window.ethereum = {request: async ({method, params}) => {
      const acct = localStorage.getItem("acct"); window.__sent = window.__sent || [];
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [acct];
      if (method === "eth_chainId") return "0xc4"; if (method === "wallet_switchEthereumChain") return null;
      if (method === "eth_sendTransaction") { window.__sent.push(params[0].data.slice(0, 10)); const r = await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params: [{...params[0], gas: "0x2000000"}]})})).json(); if (r.error) throw new Error(r.error.message); return r.result; }
      throw new Error("unsupported " + method); }};
  }, ANVIL);
  return p;
}
const asUser = async (p, addr, hash) => { await p.goto(BASE); await p.evaluate(a => { localStorage.setItem("acct", a); }, addr); await p.goto(BASE + hash); await p.evaluate(() => { window.__sent = []; }); };
const T = (p, sel) => p.$eval(sel, e => e.innerText).catch(() => "");
const sent = p => p.evaluate(() => window.__sent);

// ---- the pricing page
const p = await page();
await p.goto(BASE + "#pricing");
ok("the pricing page shows the live prices from the contract", await until(async () => { const t = await T(p, "main"); return /Pay as you go/.test(t) && /3 USDT/.test(t) && /29 USDT/.test(t) && /290 USDT/.test(t) && /99 USDT/.test(t) && /50 cases a month/.test(t) && /300 cases a month/.test(t); }), (await T(p, "main")).slice(0, 400));
ok("it does not say payments are undeployed", !/not deployed on X Layer yet/.test(await T(p, "main")));
ok("it shows where the money goes (the treasury)", (await T(p, "main")).toLowerCase().includes(TREASURY.toLowerCase()));
ok("it states the hard caps and that the contract holds nothing", /never above caps/.test(await T(p, "main")) && /holds exactly nothing/.test(await T(p, "main")));
ok("the footer and the More menu link to it", (await p.$$eval("a", as => as.map(a => a.getAttribute("href")))).filter(h => h === "#pricing").length >= 2);

// ---- subscribing
await asUser(p, SUB, "#pricing");
await until(async () => !!(await p.$('[data-sub="1"][data-y="0"]')));
const t0 = await bal(TREASURY);
await p.click("#seeplan"); ok("before subscribing: no active plan", await until(async () => /No active plan/.test(await T(p, "#minebody"))), await T(p, "#minebody"));
await p.click('[data-sub="1"][data-y="0"]');
ok("subscribing pays in two steps (allow, then pay) and shows the plan", await until(async () => /Business/.test(await T(p, "#minebody")) && /Paid/.test(await T(p, "#minebody"))), await T(p, "#minebody"));
ok("two transactions were sent: approve then subscribe", JSON.stringify(await sent(p)) === JSON.stringify(["0x095ea7b3", "0x6e178d64"]), JSON.stringify(await sent(p)));
ok("the treasury received exactly 29 USDT and neither contract holds any", (await bal(TREASURY)) - t0 === 29000000n && (await bal(BILLING)) === 0n && (await bal(CASES)) === 0n);
ok("the plan shows 50 cases left", /\b50\s+left/.test(await T(p, "#minebody")), await T(p, "#minebody"));

// ---- opening a case: a subscribed business pays nothing, an unsubscribed one pays the case fee
const caseCount = () => Number(read(CASES, "count()(uint256)"));
async function openCase(who, agId) {
  const q = await page(); await asUser(q, who, "#pk/agreement/" + agId);
  await until(async () => /Open a dispute under this agreement/.test(await T(q, "#acts")));
  const before = caseCount(), tb = await bal(TREASURY), wb = await bal(who);
  await q.evaluate(() => [...document.querySelectorAll("#acts button")].find(b => /Open a dispute/.test(b.textContent)).click());
  const done = await until(async () => /#pk\/case\//.test(await q.evaluate(() => location.hash)));
  const s = await sent(q); await q.close();
  return {done, cases: caseCount() - before, paid: String((await bal(TREASURY)) - tb), spent: String(wb - (await bal(who))), sent: s};
}
const o1 = await openCase(SUB, AG_SUB);
ok("a subscribed business opens a case and pays nothing, with one transaction (no approval)", o1.done && o1.cases === 1 && o1.paid === "0" && o1.spent === "0" && o1.sent.length === 1, JSON.stringify(o1));
const o2 = await openCase(PLAIN, AG_PLAIN);
ok("an unsubscribed business allows 3 USDT, then opens the case and pays it to the treasury", o2.done && o2.cases === 1 && o2.paid === "3000000" && o2.spent === "3000000" && o2.sent.length === 2 && o2.sent[0] === "0x095ea7b3", JSON.stringify(o2));
ok("nothing is held after either case", (await bal(BILLING)) === 0n && (await bal(CASES)) === 0n);
const o3 = await openCase(CUST, AG_PLAIN);
ok("a customer under an unsubscribed business is not blocked: they pay the fee themselves", o3.done && o3.cases === 1 && o3.paid === "3000000" && o3.spent === "3000000", JSON.stringify(o3));
const o4 = await openCase(CUST, AG_SUB);
ok("a customer under a subscribed business pays nothing", o4.done && o4.cases === 1 && o4.paid === "0" && o4.spent === "0", JSON.stringify(o4));
const q5 = await page(); await asUser(q5, BROKE, "#pk/agreement/" + AG_BROKE); await until(async () => /Open a dispute/.test(await T(q5, "#acts")));
const n0 = caseCount(); await q5.evaluate(() => [...document.querySelectorAll("#acts button")].find(b => /Open a dispute/.test(b.textContent)).click());
ok("a wallet with no USDT is told what it needs, and no case is opened", await until(async () => /You need 3 USDT/.test(await T(q5, "#amsg"))) && caseCount() === n0, await T(q5, "#amsg"));

// ---- a signed "open a dispute" action that someone submits for a passkey customer (the inbox and the relay page): the fee is made payable first
const q6 = await page(); await asUser(q6, PLAIN, "#pricing"); await until(async () => !!(await q6.$("#seeplan")));
const signedOpen = (id) => q6.evaluate(id => { const K = window.TB_PK; return K.hex(K.call("openFromAgreementSigned", ["uint256", "bytes32", "bool", K.SIGAUTH], [id, "0x" + "0".repeat(64), true, [0n, 0n, 0, ["0x", "{}", 0, 0, 0n, 0n]]])); }, id);
const allowance = () => BigInt(read(TOKEN, "allowance(address,address)(uint256)", PLAIN, BILLING));
ok("(precondition) the business has no allowance left", allowance() === 0n);
await q6.evaluate(async (to, data) => { await window.TB_BILLING.before({to, data}); }, CASES, await signedOpen(AG_PLAIN));
ok("a signed open submitted for a customer makes the fee payable first (one approval of 3 USDT)", JSON.stringify(await sent(q6)) === JSON.stringify(["0x095ea7b3"]) && allowance() === 3000000n, JSON.stringify(await sent(q6)) + " " + allowance());
await q6.evaluate(() => { window.__sent = []; }); await arpc("anvil_setBalance", [SUB, "0x56bc75e2d63100000"]);
await asUser(q6, SUB, "#pricing"); await until(async () => !!(await q6.$("#seeplan")));
await q6.evaluate(async (to, data) => { await window.TB_BILLING.before({to, data}); }, CASES, await signedOpen(AG_SUB));
ok("but nothing when the business's subscription covers it", (await sent(q6)).length === 0, JSON.stringify(await sent(q6)));
await q6.evaluate(async (to) => { await window.TB_BILLING.before({to, data: "0x99467e00" + "0".repeat(64)}); }, CASES);
ok("and nothing for actions that do not open a case", (await sent(q6)).length === 0);

// ---- Chinese
const z = await page("zh"); await z.goto(BASE + "#pricing");
ok("the pricing page is in Chinese", await until(async () => { const t = await T(z, "main"); return /价格/.test(t) && /按次付费/.test(t) && /商家版/.test(t) && /每月，或每年 290 USDT/.test(t) && /每月 300 个案件，无案件费用/.test(t); }), (await T(z, "main")).slice(0, 500));

// ---- before deployment: the repo's own config has no revenue contracts, so the page shows planned prices and nothing is charged
const m = await b.newPage(); m.on("pageerror", e => errs.push(e.message)); await m.evaluateOnNewDocument(() => localStorage.setItem("lgtie.lang", "en")); await m.goto(BASE + "#pricing");
const live = /v[567]:/.test(fs.readFileSync(SITE + "/site/config.js", "utf8"));
ok(live ? "(the repo config has revenue contracts: skipping the not-deployed check)" : "with no revenue contracts deployed the page shows planned prices, says nothing is charged and offers no subscribe button",
  live || await until(async () => /not deployed on X Layer yet/.test(await T(m, "main")) && /Not on sale yet/.test(await T(m, "main")) && !(await m.$("[data-sub]"))), (await T(m, "main")).slice(0, 300));

ok("no page errors", errs.length === 0, errs.join(" | "));
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
