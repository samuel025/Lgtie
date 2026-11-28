// TiebreakCaseV6 on the site: cases open on the live V6 contract, its extra fields do not shift the status, older contracts stay reachable,
// and the pricing page tells earlier subscribers to subscribe again. Runs on a fork of X Layer where the V6 contracts really are deployed.
// Needs: site on http://localhost:8090, `anvil --fork-url https://rpc.xlayer.tech --port 8547 --auto-impersonate --silent`, puppeteer-core, foundry.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { execSync } from "node:child_process";
const SITE = process.env.SITE || "/home/samuel/Documents/tiebreak", BASE = "http://localhost:8090/index.html", ANVIL = "http://127.0.0.1:8547", CFGP = SITE + "/site/config.js";
const cfg0 = fs.readFileSync(CFGP, "utf8"), V6 = /v6: \{[^}]*cases: "(0x[0-9a-fA-F]{40})"/.exec(cfg0), BL = /v6: \{billing: "(0x[0-9a-fA-F]{40})"/.exec(cfg0), FC = /v6: \{[^}]*facts: "(0x[0-9a-fA-F]{40})"/.exec(cfg0);
if (!V6 || !BL || !FC) { console.log("SKIP the repo config has no v6 line"); process.exit(0); }
const CASES = V6[1], BILLING = BL[1], FACTS = FC[1], AG = /v4: \{[^}]*agreements: "(0x[0-9a-fA-F]{40})"/.exec(cfg0)[1], REG = /registry: "(0x[0-9a-fA-F]{40})"/.exec(cfg0)[1];
const sh = c => execSync(c, {encoding: "utf8", cwd: SITE}).trim();
const rpc = async (method, params) => (await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params})})).json());
const send = (from, to, sig, ...args) => sh(`cast send ${to} "${sig}" ${args.map(a => `"${a}"`).join(" ")} --from ${from} --unlocked --rpc-url ${ANVIL} --gas-limit 8000000 >/dev/null`);
const read = (to, sig, ...args) => sh(`cast call ${to} "${sig}" ${args.map(a => `"${a}"`).join(" ")} --rpc-url ${ANVIL}`);
const BIZ = "0x00000000000000000000000000000000000b1201", CUST = "0x00000000000000000000000000000000000c1202", REVIEWER = "0x00000000000000000000000000000000000d1203";
const OWNER = read(BILLING, "owner()(address)"), PUBLISHER = read(REG, "get(uint256)((address,address,uint256,uint8,uint8,bytes32,uint256,uint64,string))", 1).replace(/^\(/, "").split(",")[0].trim();
for (const a of [BIZ, CUST, OWNER, PUBLISHER]) { await rpc("anvil_setBalance", [a, "0x56bc75e2d63100000"]); await rpc("anvil_impersonateAccount", [a]); }
// the fee is set to zero on the fork only, so no dollar token is needed; billing itself is covered by billing.mjs
send(OWNER, BILLING, "setCaseFee(uint256)", "0");
// the rule set's publisher marks Q1 as answered by the chain (the case must be opened before a far-off date), then the agreement is made
const SPEC = "[(2,0,0,0,0,4102444800,0x0000000000000000000000000000000000000000,0,0,0x)]";
try { send(PUBLISHER, FACTS, "set(uint256,(uint8,uint8,uint8,uint8,uint32,uint64,address,uint8,uint256,bytes)[])", "1", SPEC); } catch (e) { if (!/already set/.test(String(e.stderr || e.message))) throw e; }   // a re-run on the same fork finds it already written
const D = 3 * 86400; send(BIZ, AG, "propose((address,uint256),uint256,bytes32,address,uint32,uint32)", `(${CUST},0)`, "1", "0x" + "ab".repeat(32), REVIEWER, D, D);
const AID = read(AG, "count()(uint256)").split(" ")[0]; send(CUST, AG, "accept(uint256)", AID);
send(BIZ, CASES, "openFromAgreement(uint256,bytes32)", AID, "0x" + "00".repeat(32));
const CID = read(CASES, "count()(uint256)").split(" ")[0];

const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), errs = [];
let fails = 0; const ok = (n, c, x = "") => { console.log((c ? "ok   " : "FAIL ") + n + (c ? "" : " " + String(x).slice(0, 400))); if (!c) fails++; };
const w = ms => new Promise(r => setTimeout(r, ms));
const cfg = cfg0.replace("https://rpc.xlayer.tech", ANVIL).replace(/\n\s*v7: \{[^}]*\},[^\n]*/, "");   // this story is the V6 era, so the later v7 line is dropped
const p = await b.newPage(); await p.setViewport({width: 1280, height: 1000}); p.on("pageerror", e => errs.push(e.message));
await p.setRequestInterception(true); p.on("request", r => { if (r.url().endsWith("/config.js")) r.respond({status: 200, contentType: "application/javascript", body: cfg}); else r.continue(); });
await p.evaluateOnNewDocument(() => { try { localStorage.setItem("lgtie.lang", "en"); } catch (e) {} });
const T = (pg, sel) => pg.$eval(sel, e => e.innerText).catch(() => "");
const go = async h => { await p.goto("about:blank"); await p.goto(BASE + h); };   // a clean load, so a slow render from the previous page cannot overwrite this one
async function until(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await w(400); } return false; }

ok("the case really opened on the V6 contract", Number(CID) >= 1);
await p.goto(BASE + "#pk/case/" + CID);
ok("the case page reads a V6 case and shows it as waiting for answers (the status is not shifted by the new fields)", await until(async () => { const t = await T(p, "main"); return new RegExp("Case #" + CID).test(t) && /Waiting for answers/.test(t); }), await T(p, "main"));
ok("Q1 is shown as answered by the chain, with the explanation, before anyone has answered", await until(async () => { const t = await T(p, "main"); return /Answered by the chain: Yes/.test(t) && /Neither side can answer or dispute them/.test(t); }), await T(p, "main"));
send(BIZ, CASES, "submit(uint256,bool,uint64)", CID, "true", "127"); send(CUST, CASES, "submit(uint256,bool,uint64)", CID, "false", "127");
await p.reload();
ok("after both sides answer, the page shows it as decided", await until(async () => /Decided/.test(await T(p, "main"))), await T(p, "main"));
ok("the decided case still shows the chain's answer for Q1 and 'Agreed' for the questions the sides answered alike", /Answered by the chain: Yes/.test(await T(p, "main")) && /Agreed/.test(await T(p, "main")), await T(p, "main"));
const raw = (await rpc("eth_call", [{to: CASES, data: sh('cast calldata "get(uint256)" ' + CID)}, "latest"])).result.slice(2), word = k => BigInt("0x" + raw.slice(k * 64, k * 64 + 64));
ok("the case records that the chain answered Q1 (autoMask 1, autoBits 1) and the reviewer was not needed (status Final)", word(24) === 1n && word(25) === 1n && word(27) === 2n, [word(24), word(25), word(27)].join(","));
await go("#pk/v5case/1");
ok("an older V5 case address still routes without errors", await until(async () => /Case #1|does not exist/.test(await T(p, "main"))), await T(p, "main"));
await go("#pk/v4case/1");
ok("an older V4 case address still routes without errors", await until(async () => /Case #1|does not exist/.test(await T(p, "main"))), await T(p, "main"));
await go("#pricing");
ok("the pricing page reads the V6 billing contract and tells earlier subscribers to subscribe again", await until(async () => { const t = await T(p, "main"); return /3 USDT|0 USDT/.test(t) && /subscribe again here/.test(t) && /Subscribe monthly/.test(t); }), (await T(p, "main")).slice(0, 400));
await go("#pk/agreement/" + AID);
ok("the agreement page lists the V6 case", await until(async () => new RegExp("Case #" + CID).test(await T(p, "main"))), await T(p, "main"));
ok("no page errors", errs.length === 0, errs.join(" | "));
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
