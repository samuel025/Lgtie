import puppeteer from "puppeteer-core"; import fs from "node:fs";
const BASE = "http://localhost:8090/index.html", ANVIL = "http://127.0.0.1:8547", CFGP = "/home/samuel/Documents/tiebreak/site/config.js";
const A1 = "0x7e57000000000000000000000000000000001001", A2 = "0x7e57000000000000000000000000000000001002", A3 = "0x7e57000000000000000000000000000000001003", A4 = "0x7e57000000000000000000000000000000001004";
const arpc = async (m, p) => { const r = await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method: m, params: p})})).json(); if (r.error) throw new Error(JSON.stringify(r.error)); return r.result; };
const fund = async (a, wei) => { await arpc("anvil_setBalance", [a, wei]); await arpc("anvil_impersonateAccount", [a]); };
await fund(A1, "0x56bc75e2d63100000"); await fund(A2, "0x56bc75e2d63100000"); await fund(A3, "0x56bc75e2d63100000"); await fund(A4, "0x" + (300000000000000n).toString(16)); // A4 has only 0.0003 OKB
const call = (to, data) => arpc("eth_call", [{to, data}, "latest"]);
const regCount = async () => Number(BigInt(await call("0x25E87D367316038a2d3B6A4fe3d58AA453D4c219", "0x06661abd")));
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), p = await b.newPage();
await p.evaluateOnNewDocument(() => { try { localStorage.setItem("lgtie.lang", "en"); } catch (e) {} });   // the tests read English text; the app defaults to Chinese
const errs = []; p.on("pageerror", e => errs.push(e.message));
let fails = 0; const ok = (n, c, x = "") => { console.log((c ? "ok   " : "FAIL ") + n + (c ? "" : " " + String(x).slice(0, 400))); if (!c) fails++; };
const go = async n => { await p.evaluate(n => document.querySelector(`[data-step-btn="${n}"]`).click(), n); await w(350); };
const T = sel => p.$eval(sel, e => e.textContent).catch(() => ""), w = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await w(400); } return false; }
await p.setRequestInterception(true);
p.on("request", r => { if (r.url().endsWith("/config.js")) r.respond({status: 200, contentType: "application/javascript", body: fs.readFileSync(CFGP, "utf8").replace("https://rpc.xlayer.tech", ANVIL)}); else r.continue(); });
await p.evaluateOnNewDocument(ANVIL => {
  window.ethereum = {request: async ({method, params}) => {
    const acct = localStorage.getItem("acct");
    if (method === "eth_requestAccounts" || method === "eth_accounts") return [acct];
    if (method === "eth_chainId") return "0xc4"; if (method === "wallet_switchEthereumChain") return null;
    if (method === "eth_sendTransaction") { if (localStorage.getItem("reject")) { const e = new Error("User rejected the request."); e.code = 4001; throw e; }
      const r = await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params: [{...params[0], gas: "0x2000000"}]})})).json(); if (r.error) throw new Error(r.error.message); return r.result; }
    throw new Error("unsupported " + method); }};
}, ANVIL);
const asUser = async (addr, extra = {}) => { await p.goto(BASE); await p.evaluate((a, e) => { localStorage.clear(); localStorage.setItem("acct", a); for (const k in e) localStorage.setItem(k, e[k]); }, addr, extra); };
const SMALL = `name: Return check
about: Can you return it?
question: Is it unused? | Photo
question: Is it within 30 days? | Receipt date
question: Is the original box present? | Photo
result: Refuse
result: Accept
rule: Q1=no -> Refuse : It must be unused.
rule: Q2=no -> Refuse : The 30 days are over.
rule: Q3=no -> Refuse : The box is needed.
default: Accept : Return accepted.
`;
const setText = async txt => { await p.click("#tabt"); await w(300); await p.$eval("#src", (e, v) => { e.value = v; e.dispatchEvent(new Event("input", {bubbles: true})); }, txt); await w(700); };
// ---- 1. small checker, wallet with zero NAND: claims free NAND, tapes out, registers
const n0 = await regCount();
await asUser(A1); await p.goto(BASE + "#build"); await w(700); await setText(SMALL);
ok("publish button is offered", !!(await p.$("#pubgo")) && /up to four transactions/.test(await T("#out")));
await go(4); await p.click("#pubgo");
ok("publish succeeds", await until(async () => /Published on X Layer/.test(await T("#out"))), await T("#pubmsg") || await T("#out"));
const outTxt = await T("#out"), circuitId = Number(/Circuit #(\d+)/.exec(outTxt)[1]), rsId = Number(/rule set #(\d+)/.exec(outTxt)[1]);
ok("registry gained one rule set with the new id", (await regCount()) === n0 + 1 && rsId === n0 + 1, `${await regCount()} vs ${n0 + 1}, rs ${rsId}`);
// NAND comes from the free faucet claim when it is available, otherwise it is bought (mint): both are correct, so accept either
ok("the transaction list includes getting NAND (claim or mint), tapeout, register", /(claim|mint)/.test(outTxt) && /tapeout/.test(outTxt) && /register/.test(outTxt), outTxt.slice(-400));
const link = await p.$eval(".note.ok-note a.btn", a => a.href);
// ---- 2. open the published link as a customer: banner + on-chain confirmation
await asUser(A2); await p.goto(link); await w(1500);
ok("published link shows the rules match the registry", /match rules #\d+ published on X Layer/.test(await T("main")), (await T("main")).slice(0, 300));
await p.evaluate(() => document.querySelectorAll(".q").forEach(d => d.querySelector('button[data-v="1"]').click()));
ok("customer result is Accept and confirmed by the processor", await until(async () => /Confirmed on the public network/.test(await T("#vbadge"))) && /Accept/.test(await T(".res .big")), await T(".res"));
await p.evaluate(() => document.querySelectorAll(".q")[1].querySelector('button[data-v="0"]').click());
ok("a no on question 2 gives Refuse with the reason", await until(async () => /Refuse/.test(await T(".res .big"))) && /30 days/.test(await T(".res .why")), await T(".res"));
// ---- 3. tampered rules under the same rule set id are flagged
const b64 = s => Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
await p.goto(BASE + "#check/c=" + b64(SMALL.replace("Return accepted.", "Return accepted!").replace("30 days", "60 days").replace("within 30 days", "within 60 days")) + "/rs=" + rsId); await w(1500);
ok("changed rules are flagged as not matching", /do not<\/b> match|do not match/.test(await p.$eval("main", e => e.innerText + e.innerHTML)) && /only a preview|not.*match/i.test(await T("main")), (await T("main")).slice(0, 300));
// ---- 4. bigger checker needs more than the 40 free NAND: mints the rest
const BOUNTY = await p.evaluate(() => window.TB.TEMPLATES.bounty);
await asUser(A3); await p.goto(BASE + "#build"); await w(700); await go(1); await p.click("[data-t=bounty]"); await w(900);
ok("bounty needs more than 40 gates and says it will buy NAND", /needs 4\d NAND/.test(await T("#out")), (await T("#out")).slice(0, 300));
await go(4); await p.click("#pubgo");
ok("bounty publish succeeds (claim + mint + tapeout + register)", await until(async () => /Published on X Layer/.test(await T("#out")), 90000), await T("#pubmsg") || await T("#out"));
ok("mint step happened", /mint/.test(await T("#out")), (await T("#out")).slice(0, 300));
// ---- 5. cancelled in the wallet
await asUser(A1, {reject: "1"}); await p.goto(BASE + "#build"); await w(700); await setText(SMALL.replace("Return check", "Return check two"));
await go(4); await p.click("#pubgo");
ok("cancelling shows a friendly message and nothing is lost", await until(async () => /You cancelled in the wallet/.test(await T("#pubmsg"))) && !!(await p.$("#pubgo")), await T("#pubmsg"));
// ---- 6. not enough OKB
await asUser(A4); await p.goto(BASE + "#build"); await w(700); await setText(SMALL.replace("Return check", "Return check three"));
await go(4); await p.click("#pubgo");
ok("a wallet with too little OKB is told the amount needed", await until(async () => /needed for the fees/.test(await T("#pubmsg"))), await T("#pubmsg"));
ok("no page errors", errs.length === 0, errs.join(" | "));
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
