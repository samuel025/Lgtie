import puppeteer from "puppeteer-core"; import fs from "node:fs"; import {execFileSync} from "node:child_process";
const BASE = "http://localhost:8090/index.html", ANVIL = "http://127.0.0.1:8547", CFGP = "/home/samuel/Documents/tiebreak/site/config.js", REG = "0x25E87D367316038a2d3B6A4fe3d58AA453D4c219";
const FILER = "0x7e57000000000000000000000000000000000f01", DEC = "0x7e57000000000000000000000000000000000d01", REV = "0x7e57000000000000000000000000000000000e01", REV2 = "0x7e57000000000000000000000000000000000e02", OTHER = "0x7e57000000000000000000000000000000000a01", DEPLOYER = "0x7e57000000000000000000000000000000000ddd";
const arpc = async (m, p) => { const r = await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method: m, params: p})})).json(); if (r.error) throw new Error(JSON.stringify(r.error)); return r.result; };
for (const a of [FILER, DEC, REV, REV2, OTHER, DEPLOYER]) { await arpc("anvil_setBalance", [a, "0x56bc75e2d63100000"]); await arpc("anvil_impersonateAccount", [a]); }
// deploy TiebreakCaseV2 on the fork against the real registry
const out = execFileSync("forge", ["create", "src/TiebreakCaseV2.sol:TiebreakCaseV2", "--rpc-url", ANVIL, "--unlocked", "--from", DEPLOYER, "--broadcast", "--constructor-args", REG], {cwd: "/home/samuel/Documents/tiebreak/contracts", encoding: "utf8"});
const V2 = /Deployed to: (0x[0-9a-fA-F]{40})/.exec(out)[1]; console.log("TiebreakCaseV2 on the fork:", V2);
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push("pageerror: " + e.message));
let fails = 0; const ok = (n, c, x = "") => { console.log((c ? "ok   " : "FAIL ") + n + (c ? "" : " " + String(x).slice(0, 300))); if (!c) fails++; };
const T = sel => p.$eval(sel, e => e.innerText).catch(() => ""), w = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 25000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await w(300); } return false; }
await p.setRequestInterception(true);
p.on("request", r => { if (r.url().endsWith("/config.js")) r.respond({status: 200, contentType: "application/javascript", body: fs.readFileSync(CFGP, "utf8").replace("https://rpc.xlayer.tech", ANVIL).replace(/caseContract: "0x0+"/, `caseContract: "${V2}"`)}); else r.continue(); });
await p.evaluateOnNewDocument(ANVIL => { window.ethereum = {request: async ({method, params}) => {
  if (method === "eth_requestAccounts" || method === "eth_accounts") return [localStorage.getItem("acct")];
  if (method === "eth_chainId") return "0xc4"; if (method === "wallet_switchEthereumChain") return null;
  if (method === "eth_sendTransaction") { const r = await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params: [{...params[0], gas: "0x2000000"}]})})).json(); if (r.error) throw new Error(r.error.message); return r.result; }
  throw new Error("unsupported " + method); }}; }, ANVIL);
const as = async (addr, hash) => { await p.evaluate(a => localStorage.setItem("acct", a), addr).catch(() => {}); await p.goto(BASE + "?" + Date.now() + hash); await w(600); };
const connect = async () => { const c = await p.$("#cw"); if (c) { await c.click(); await w(800); } };
const answerAll = async (kind, noIdx) => { await p.evaluate((k, n) => document.querySelectorAll(`[data-form="${k}"] .yn`).forEach(g => g.querySelector(`button[data-v="${Number(g.dataset.i) === n ? 0 : 1}"]`).click()), kind, noIdx ?? -1); await p.click(`[data-send="${kind}"]`); };
const openCase = async (rev, aw = "7", rw = "7") => { await as(FILER, "#case"); await p.type("#dec", DEC); await p.type("#rev", rev); await p.select("#aw", aw); await p.select("#rw", rw); await p.click("#open"); await until(async () => /^#case\/\d+$/.test(await p.evaluate(() => location.hash))); return await p.evaluate(() => location.hash); };
await p.goto(BASE); await p.evaluate(() => localStorage.setItem("acct", ""));
// ---- A. reviewer consent, dispute, decision
const hA = await openCase(REV); const idA = hA.split("/")[1];
await until(async () => /Waiting for answers/.test(await T("main")));
ok("new case shows the proposed reviewer needs the decider's acceptance", /filer accepted ✓, decider not yet/.test(await T("main")), (await T("main")).slice(0, 400));
ok("the case shows when answers are due", /Answers due by/.test(await T("main")));
await p.waitForSelector('[data-form="filer"]'); await answerAll("filer"); await until(async () => /Nothing for your wallet|Answers due/.test(await T("main")) && (await p.$$eval("tbody tr td:nth-child(2)", e => e.every(x => x.innerText === "Yes"))));
await as(DEC, hA); await connect(); await p.waitForSelector('[data-form="decider"]'); await answerAll("decider", 4);
ok("a dispute waits for the reviewer", await until(async () => /Waiting for the reviewer/.test(await T("main"))), (await T("main")).slice(0, 300));
await as(REV, hA); await connect(); await until(async () => /Both sides have to accept you/.test(await T("main")));
ok("the reviewer cannot decide before the decider accepts", /Both sides have to accept you as the reviewer/.test(await T("main")) && !(await p.$('[data-form="review"]')));
await as(DEC, hA); await connect(); await until(async () => !!(await p.$("#acc"))); await p.click("#acc");
ok("the decider accepts the reviewer", await until(async () => /filer accepted ✓, decider accepted ✓/.test(await T("main"))), (await T("main")).slice(0, 300));
await as(REV, hA); await connect(); await p.waitForSelector('[data-form="review"]');
ok("reviewer form shows only the disputed question", (await p.$$('[data-form="review"] .yn')).length === 1);
await p.evaluate(() => document.querySelector('[data-form="review"] .yn button[data-v="0"]').click()); await p.click('[data-send="review"]');
ok("the case is decided: Not covered", await until(async () => /Decided/.test(await T("main"))) && /Not covered/.test(await T(".res .big")), await T("main"));
await until(async () => /Re-run just now|different result|Could not/.test(await T("#rp")));
ok("replay matches", /same result/.test(await T("#rp")), await T("#rp"));
const verdict = await arpc("eth_call", [{to: V2, data: "0xd3dc1fdf" + BigInt(idA).toString(16).padStart(64, "0")}, "latest"]); ok("another contract can read the verdict (final, result 0)", BigInt("0x" + verdict.slice(2, 66)) === 1n && BigInt("0x" + verdict.slice(66, 130)) === 0n, verdict);
// ---- B. the decider proposes a different reviewer; the filer must accept
const hB = await openCase(REV); await as(DEC, hB); await connect(); await until(async () => !!(await p.$("#prop")));
await p.type("#newrev", REV2); await p.click("#prop");
ok("a counter-proposal replaces the reviewer and resets acceptance", await until(async () => /0x7e57…0e02: filer not yet, decider accepted ✓/.test(await T("main"))), (await T("main")).slice(0, 400));
await as(FILER, hB); await connect(); await until(async () => !!(await p.$("#acc"))); await p.click("#acc");
ok("the filer accepts the new reviewer", await until(async () => /filer accepted ✓, decider accepted ✓/.test(await T("main"))));
await as(OTHER, hB); await connect(); ok("a stranger cannot change the reviewer", await until(async () => /Only the filer and the decider can change the reviewer/.test(await T("main"))));
// ---- C. nobody answers: the case can be closed after the deadline, nobody wins
const hC = await openCase(REV, "1", "1"); await arpc("evm_increaseTime", [2 * 86400]); await arpc("evm_mine", []);
await as(OTHER, hC); await connect(); await until(async () => !!(await p.$("#closeit")));
ok("after the deadline anyone is offered to close the case", /That time has passed/.test(await T("main")) && !!(await p.$("#closeit")));
await p.click("#closeit");
ok("the case ends as No decision", await until(async () => /No decision/.test(await T(".res .big"))) && /answers were not all in on time/.test(await T(".res .why")), await T("main"));
// ---- D. the reviewer never answers
const hD = await openCase(REV, "3", "1"); await as(FILER, hD); await connect(); await p.waitForSelector('[data-form="filer"]'); await answerAll("filer");
await until(async () => /Nothing for your wallet|Answers due/.test(await T("main"))); await as(DEC, hD); await connect(); await p.waitForSelector('[data-form="decider"]'); await answerAll("decider", 4);
await until(async () => /Waiting for the reviewer/.test(await T("main"))); await arpc("evm_increaseTime", [2 * 86400]); await arpc("evm_mine", []);
await as(OTHER, hD); await connect(); await until(async () => !!(await p.$("#closeit"))); await p.click("#closeit");
ok("a ghosted reviewer ends the case with no decision", await until(async () => /No decision/.test(await T(".res .big"))) && /reviewer did not decide in time/.test(await T(".res .why")), await T("main"));
const v2 = await arpc("eth_call", [{to: V2, data: "0xd3dc1fdf" + BigInt(hD.split("/")[1]).toString(16).padStart(64, "0")}, "latest"]); ok("an expired case has no final verdict", BigInt("0x" + v2.slice(2, 66)) === 0n);
ok("no page errors", errs.length === 0, errs.join(" | "));
await p.screenshot({path: "/tmp/tb-case2.png", fullPage: true});
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
