import puppeteer from "puppeteer-core"; import fs from "node:fs"; import crypto from "node:crypto"; import {execFileSync} from "node:child_process";
const BASE = "http://localhost:8090/index.html", ANVIL = "http://127.0.0.1:8547", CFGP = "/home/samuel/Documents/tiebreak/site/config.js", REG = "0x25E87D367316038a2d3B6A4fe3d58AA453D4c219", DEPLOYED_BY = "0x0aE117C07A277D74D9326eb4e33013439dC68fD5";
const BUYER = "0x7e57000000000000000000000000000000000f01", SHOP = "0x7e57000000000000000000000000000000000d01", REV = "0x7e57000000000000000000000000000000000e01", REV2 = "0x7e57000000000000000000000000000000000e02", HELPER = "0x7e57000000000000000000000000000000000b01", OTHER = "0x7e57000000000000000000000000000000000a01", DEPLOYER = "0x7e57000000000000000000000000000000000ddd";
const arpc = async (m, p) => { const r = await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method: m, params: p})})).json(); if (r.error) throw new Error(JSON.stringify(r.error)); return r.result; };
for (const a of [BUYER, SHOP, REV, REV2, HELPER, OTHER, DEPLOYER]) { await arpc("anvil_setBalance", [a, "0x56bc75e2d63100000"]); await arpc("anvil_impersonateAccount", [a]); }
const forge = args => execFileSync("forge", args, {cwd: "/home/samuel/Documents/tiebreak/contracts", encoding: "utf8"});
const AG = /Deployed to: (0x[0-9a-fA-F]{40})/.exec(forge(["create", "src/AgreementRegistry.sol:AgreementRegistry", "--rpc-url", ANVIL, "--unlocked", "--from", DEPLOYER, "--broadcast", "--constructor-args", REG]))[1];
const V3 = /Deployed to: (0x[0-9a-fA-F]{40})/.exec(forge(["create", "src/TiebreakCaseV3.sol:TiebreakCaseV3", "--rpc-url", ANVIL, "--unlocked", "--from", DEPLOYER, "--broadcast", "--constructor-args", REG, AG]))[1];
console.log("AgreementRegistry", AG, "| TiebreakCaseV3", V3, "on the fork");
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push("pageerror: " + e.message));
let fails = 0; const ok = (n, c, x = "") => { console.log((c ? "ok   " : "FAIL ") + n + (c ? "" : " " + String(x).slice(0, 300))); if (!c) fails++; };
const T = sel => p.$eval(sel, e => e.innerText).catch(() => ""), w = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 25000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await w(300); } return false; }
await p.setRequestInterception(true);
p.on("request", r => { if (r.url().endsWith("/config.js")) r.respond({status: 200, contentType: "application/javascript", body: fs.readFileSync(CFGP, "utf8").replace("https://rpc.xlayer.tech", ANVIL).replace(/agreements: "0x[0-9a-fA-F]{40}"/, `agreements: "${AG}"`).replace(/caseContract: "0x[0-9a-fA-F]{40}"/, `caseContract: "${V3}"`)}); else r.continue(); });
await p.evaluateOnNewDocument(ANVIL => { window.ethereum = {request: async ({method, params}) => {
  if (method === "eth_requestAccounts" || method === "eth_accounts") return [localStorage.getItem("acct")];
  if (method === "eth_chainId") return "0xc4"; if (method === "wallet_switchEthereumChain") return null;
  if (method === "eth_sendTransaction") { const r = await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params: [{...params[0], gas: "0x2000000"}]})})).json(); if (r.error) throw new Error(r.error.message); return r.result; }
  throw new Error("unsupported " + method); }}; }, ANVIL);
const as = async (addr, hash) => { await p.evaluate(a => localStorage.setItem("acct", a), addr).catch(() => {}); await p.goto(BASE + "?" + Date.now() + hash); await w(700); };
const connect = async () => { const c = await p.$("#cw"); if (c) { await c.click(); await w(900); } };
const answerAll = async (kind, noIdx) => { await p.evaluate((k, n) => document.querySelectorAll(`[data-form="${k}"] .yn`).forEach(g => g.querySelector(`button[data-v="${Number(g.dataset.i) === n ? 0 : 1}"]`).click()), kind, noIdx ?? -1); await p.click(`[data-send="${kind}"]`); };
await p.goto(BASE); await p.evaluate(() => localStorage.setItem("acct", ""));
const TERMS = "Acme Laptops sales terms, version 1: the warranty rules published as LGtie rule set 1 apply.";

// ---- A. an agreement before any dispute
await as(SHOP, "#agree"); await p.type("#cp", BUYER); await p.type("#rv", REV); await p.type("#terms", TERMS); await p.click("#prop");
ok("proposing an agreement opens its page", await until(async () => /^#agreement\/\d+$/.test(await p.evaluate(() => location.hash))), await T("#msg"));
const hAg = await p.evaluate(() => location.hash), agId = hAg.split("/")[1];
await until(async () => /Proposed, waiting for the other party/.test(await T("main")));
ok("a new agreement waits for the other party and shows its terms fingerprint", /Proposed, waiting/.test(await T("main")) && /0x[0-9a-f]{64}/.test(await T("main")), (await T("main")).slice(0, 300));
ok("the proposer gets a ready-to-send invitation with the link and the other party\'s address", /#agreement\/\d+/.test(await p.$eval("#invtxt", e => e.value).catch(() => "")) && /0x[0-9a-fA-F]{40}/.test(await p.$eval("#invtxt", e => e.value).catch(() => "")) && !!(await p.$("#invcp")), await p.$eval("#invtxt", e => e.value).catch(() => ""));
await p.type("#tt", TERMS); await until(async () => /matches the agreed terms/.test(await T("#tm")));
ok("the exact terms text is recognised", /✓ This text matches/.test(await T("#tm")), await T("#tm"));
await p.$eval("#tt", e => { e.value = e.value + " (changed)"; e.dispatchEvent(new Event("input", {bubbles: true})); }); await until(async () => /does not match/.test(await T("#tm")));
ok("changed terms text is flagged", /does not match the agreed terms/.test(await T("#tm")));
await as(OTHER, hAg); await connect(); await until(async () => /Nothing for your wallet/.test(await T("main")));
ok("a stranger cannot accept or withdraw", /Nothing for your wallet to do/.test(await T("main")) && !(await p.$("#acc")));
await as(BUYER, hAg); await connect(); await until(async () => !!(await p.$("#acc"))); await p.click("#acc");
ok("the other party accepts and it is in force", await until(async () => /In force since/.test(await T("main"))), (await T("main")).slice(0, 200));
ok("an accepted agreement offers no withdrawal and says it cannot change", !(await p.$("#wd")) && /can't be changed or withdrawn/.test(await T("main")));
// ---- B. a case under the agreement: reviewer agreed in advance
await p.click("#odp"); ok("opening a dispute under the agreement leads to the case", await until(async () => /^#case\/\d+$/.test(await p.evaluate(() => location.hash))), await T("#am"));
const hC = await p.evaluate(() => location.hash); await until(async () => /Waiting for answers/.test(await T("main")));
ok("the case shows its agreement and an advance-agreed reviewer", new RegExp(`Agreement #${agId}`).test(await T("main")) && /Agreed in advance under the agreement/.test(await T("main")) && /opener accepted ✓, other side accepted ✓/.test(await T("main")), (await T("main")).slice(0, 400));
ok("the filer sees only their own answer form, never the decider's", !!(await p.$('[data-form="filer"]')) && !(await p.$('[data-form="decider"]')));
// ---- C. evidence: a real file is hashed in the browser
const file = "/tmp/lgtie-evidence.bin"; fs.writeFileSync(file, "photo bytes of the damaged unit"); const want = crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
await p.select("#evq", "4"); await (await p.$("#evf")).uploadFile(file); await until(async () => /Fingerprint 0x/.test(await T("#evh")));
ok("the page shows the file's fingerprint without uploading it", (await T("#evh")).includes(want.slice(0, 12)), await T("#evh"));
ok("the note is not pre-filled with the file name", (await p.$eval("#evn", e => e.value)) === "");
ok("the form says nothing is uploaded", /not uploaded anywhere/.test(await T("#evform")));
await p.type("#evn", "lgtie-evidence.bin");
await p.click("#evgo");
ok("the evidence fingerprint is recorded against question 5", await until(async () => (await T("main")).includes(want.slice(0, 10)) && /lgtie-evidence\.bin/.test(await T("main"))), (await T("main")).slice(0, 500));
ok("the question row shows an evidence badge", /1 evidence/.test(await T("tbody")));
// ---- C2. check a file you were sent against the recorded fingerprint (hashed in the browser)
await (await p.$("#dzf")).uploadFile(file); await until(async () => /Same file as recorded/.test(await T("#dzr")));
ok("dropping the same file says it matches the recorded fingerprint", /Same file as recorded/.test(await T("#dzr")) && /not that it is genuine/.test(await T("#dzr")), await T("#dzr"));
ok("the matching evidence row is highlighted", (await p.$$eval("tr.evrow.match", e => e.length)) === 1);
const other = "/tmp/lgtie-other.bin"; fs.writeFileSync(other, "a different file"); await (await p.$("#dzf")).uploadFile(other); await until(async () => /No match/.test(await T("#dzr")));
ok("dropping a different file says there is no match and highlights nothing", /No match/.test(await T("#dzr")) && (await p.$$eval("tr.evrow.match", e => e.length)) === 0, await T("#dzr"));
ok("the case page offers an invitation to the other side", !!(await p.$("[data-invite]")) && /#case\/\d+/.test(await p.$eval("#invtxt", e => e.value).catch(() => "")), await p.$eval("#invtxt", e => e.value).catch(() => ""));
await as(OTHER, hC); await connect(); ok("a stranger cannot add evidence", !(await p.$("#evf")));
// ---- D. dispute and a reviewer who needs no acceptance step
await as(BUYER, hC); await connect(); await p.waitForSelector('[data-form="filer"]'); await answerAll("filer");
await until(async () => /Nothing for your wallet/.test(await T("main")));
await as(SHOP, hC); await connect(); await p.waitForSelector('[data-form="decider"]'); await answerAll("decider", 4);
ok("a dispute waits for the reviewer", await until(async () => /Waiting for the reviewer/.test(await T("main"))));
await as(REV, hC); await connect(); await p.waitForSelector('[data-form="review"]');
ok("the agreed reviewer can decide at once, and sees only the disputed question", (await p.$$('[data-form="review"] .yn')).length === 1 && !!(await p.$("#evf")));
await p.evaluate(() => document.querySelector('[data-form="review"] .yn button[data-v="0"]').click()); await p.click('[data-send="review"]');
ok("the case is decided: Not covered", await until(async () => /Decided/.test(await T("main"))) && /Not covered/.test(await T(".res .big")), await T("main"));
await until(async () => /Re-run just now|different result|Could not/.test(await T("#rp")));
ok("replay matches", /same result/.test(await T("#rp")), await T("#rp"));
// ---- E. helpers act only for the side that named them
await as(BUYER, "#case"); await p.type("#dec", SHOP); await p.type("#rev", REV2); await p.click("#open"); await until(async () => /^#case\/\d+$/.test(await p.evaluate(() => location.hash)));
const hD = await p.evaluate(() => location.hash); await until(async () => /Waiting for answers/.test(await T("main")));
await p.type("#hop", HELPER); await p.click("#hset"); ok("the filer names a helper", await until(async () => new RegExp("Current helper: 0x7e57…0b01").test(await T("main"))), await T("#hmsg"));
await as(HELPER, hD); await connect(); await until(async () => !!(await p.$('[data-form="filer"]')));
ok("the filer's helper can answer for the filer only", !!(await p.$('[data-form="filer"]')) && !(await p.$('[data-form="decider"]')));
await answerAll("filer"); ok("the helper's answer is recorded for the filer", await until(async () => (await p.$$eval("tbody tr td:nth-child(2)", e => e.every(x => x.innerText === "Yes")))));
// ---- F. nobody wins by default
await as(BUYER, "#case"); await p.type("#dec", SHOP); await p.type("#rev", REV2); await p.select("#aw", "1"); await p.click("#open"); await until(async () => /^#case\/\d+$/.test(await p.evaluate(() => location.hash)) && (await p.evaluate(() => location.hash)) !== hD);
const hE = await p.evaluate(() => location.hash); await arpc("evm_increaseTime", [2 * 86400]); await arpc("evm_mine", []);
await as(OTHER, hE); await connect(); await until(async () => !!(await p.$("#closeit"))); await p.click("#closeit");
ok("a case nobody answers ends as No decision", await until(async () => /No decision/.test(await T(".res .big"))), await T("main"));
// ---- G. records read from the chain
await as(OTHER, "#reviewer/" + REV); await until(async () => /\d+ cases?/.test(await T(".stats")));
ok("the reviewer record shows one decided case", /1 case/.test(await T(".stats")) && /1 decided/.test(await T(".stats")), await T(".stats"));
await as(OTHER, "#business/" + DEPLOYED_BY); await until(async () => /published/.test(await T(".stats")));
ok("a business record lists the rule set it published and says it is the first version", /1 rule set published/.test(await T(".stats")) && /Warranty claims/.test(await T("main")) && /first version/.test(await T("main")), await T("main"));
await as(OTHER, "#business/" + SHOP); await until(async () => /case/.test(await T(".stats")));
ok("the shop's record counts its cases as decider", /\d+ cases? as decider/.test(await T(".stats")) && /1 of 1 decided needed a reviewer/.test(await T(".stats")), await T(".stats"));
ok("no page errors", errs.length === 0, errs.join(" | "));
await p.screenshot({path: "/tmp/tb-case3.png", fullPage: true});
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
