// #auto/<rule set number>: a publisher chooses which questions the chain answers, reviews them, and writes them once; everyone else only reads them.
// Runs on a fork of X Layer where FactSpecRegistry really is deployed, with a stand-in wallet that signs as the impersonated publisher.
// Needs: site on http://localhost:8090, `anvil --fork-url https://rpc.xlayer.tech --port 8547 --auto-impersonate --silent`, puppeteer-core, foundry.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { execSync } from "node:child_process";
const SITE = process.env.SITE || "/home/samuel/Documents/tiebreak", BASE = "http://localhost:8090/index.html", ANVIL = "http://127.0.0.1:8547", CFGP = SITE + "/site/config.js";
const cfg0 = fs.readFileSync(CFGP, "utf8"), FC = /v6: \{[^}]*facts: "(0x[0-9a-fA-F]{40})"/.exec(cfg0), REG = /registry: "(0x[0-9a-fA-F]{40})"/.exec(cfg0), PROC = /processor: "(0x[0-9a-fA-F]{40})"/.exec(cfg0);
if (!FC) { console.log("SKIP the repo config has no v6 line"); process.exit(0); }
const FACTS = FC[1];
const sh = c => execSync(c, {encoding: "utf8", cwd: SITE}).trim();
const rpc = async (method, params) => (await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params})})).json());
const send = (from, to, sig, ...args) => sh(`cast send ${to} "${sig}" ${args.map(a => `"${a}"`).join(" ")} --from ${from} --unlocked --rpc-url ${ANVIL} --gas-limit 8000000 >/dev/null`);
const read = (to, sig, ...args) => sh(`cast call ${to} "${sig}" ${args.map(a => `"${a}"`).join(" ")} --rpc-url ${ANVIL}`);
const PUB = "0x00000000000000000000000000000000000a1301", OTHER = "0x00000000000000000000000000000000000a1302";
for (const a of [PUB, OTHER]) { await rpc("anvil_setBalance", [a, "0x56bc75e2d63100000"]); await rpc("anvil_impersonateAccount", [a]); }
// a fresh rule set for the publisher, on the real processor, using the circuit of rule set #1 (the warranty rules: 7 questions)
const circuit = BigInt("0x" + (await rpc("eth_call", [{to: REG[1], data: sh('cast calldata "get(uint256)" 1')}, "latest"])).result.slice(2).slice(3 * 64, 4 * 64));
const publish = name => { send(PUB, REG[1], "publish(address,uint256,uint8,uint8,bytes32,uint256,string)", PROC[1], circuit.toString(), "7", "2", "0x" + "cd".repeat(32), "0", name); return read(REG[1], "count()(uint256)").split(" ")[0]; };
const RS = publish("Auto test 1"), RS2 = publish("Auto test 2");

const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), errs = [];
let fails = 0; const ok = (n, c, x = "") => { console.log((c ? "ok   " : "FAIL ") + n + (c ? "" : " " + String(x).slice(0, 500))); if (!c) fails++; };
const w = ms => new Promise(r => setTimeout(r, ms));
const cfg = cfg0.replace("https://rpc.xlayer.tech", ANVIL);
async function newPage(acct) {
  const p = await b.newPage(); await p.setViewport({width: 1280, height: 1400}); p.on("pageerror", e => errs.push(e.message));
  await p.setRequestInterception(true); p.on("request", r => { if (r.url().endsWith("/config.js")) r.respond({status: 200, contentType: "application/javascript", body: cfg}); else r.continue(); });
  await p.evaluateOnNewDocument((ANVIL, acct) => { try { localStorage.setItem("lgtie.lang", "en"); localStorage.setItem("acct", acct); } catch (e) {}
    window.ethereum = {request: async ({method, params}) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [localStorage.getItem("acct")];
      if (method === "eth_chainId") return "0xc4"; if (method === "wallet_switchEthereumChain") return null;
      if (method === "eth_sendTransaction") { const r = await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params: [{...params[0], gas: "0x2000000"}]})})).json(); if (r.error) throw new Error(r.error.message); return r.result; }
      throw new Error("unsupported " + method); }}; }, ANVIL, acct);
  return p;
}
const T = (pg, sel) => pg.$eval(sel, e => e.innerText).catch(() => "");
async function until(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await w(400); } return false; }
const setVal = (p, sel, v) => p.$eval(sel, (e, v) => { e.value = v; e.dispatchEvent(new Event("input")); e.dispatchEvent(new Event("change")); }, v);

// ---- a visitor with no wallet sees that nothing is automatic, and that only the publisher can change it
const v = await newPage(OTHER); await v.goto(BASE + "#auto/" + RS);
ok("a visitor sees that no question is answered by the chain, and who can change that", await until(async () => { const t = await T(v, "main"); return /No question of this rule set is answered by the chain/.test(t) && new RegExp(PUB.slice(0, 10), "i").test(t); }), await T(v, "main"));
await v.click("#ac-conn"); await w(2500);
ok("connecting a wallet that is not the publisher still shows no editor", !(await v.$("#ac-q")), await T(v, "main"));

// ---- the publisher
const p = await newPage(PUB); await p.goto(BASE + "#auto/" + RS);
ok("before connecting, the publisher also sees the read-only page with a connect button", await until(async () => !!(await p.$("#ac-conn"))));
await p.click("#ac-conn");
ok("the publisher's wallet gets the editor with a warning that it is once only", await until(async () => !!(await p.$("#ac-q"))) && /cannot be changed afterwards/.test(await T(p, "main")), await T(p, "main"));
ok("one row per question", (await p.$$("#ac-q tbody tr")).length === 7);
await p.click("#ac-review");
ok("reviewing with nothing chosen writes nothing and says so", /Choose at least one question/.test(await T(p, "#ac-out")), await T(p, "#ac-out"));
await p.select("tr[data-i='0'] .ac-k", "1"); await setVal(p, "tr[data-i='0'] .ac-hrs", "48");
await p.select("tr[data-i='2'] .ac-k", "3"); await setVal(p, "tr[data-i='2'] .ac-tgt", "0x12"); await setVal(p, "tr[data-i='2'] .ac-data", "0x70a08231");
await p.click("#ac-review");
ok("a bad contract address is refused before anything is sent", /contract address/.test(await T(p, "#ac-out")), await T(p, "#ac-out"));
await setVal(p, "tr[data-i='2'] .ac-tgt", "0x779Ded0c9e1022225f8E0630b35a9b54bE713736"); await setVal(p, "tr[data-i='2'] .ac-data", "0x70a08231" + "00".repeat(12) + PUB.slice(2)); await setVal(p, "tr[data-i='2'] .ac-thr", "5");
await p.select("tr[data-i='4'] .ac-k", "2"); await setVal(p, "tr[data-i='4'] .ac-date", "2030-01-01T00:00");
await p.click("#ac-review");
const rev = await T(p, "#ac-out");
ok("the review lists each question in plain words and warns it is permanent", /This is what will be written/.test(rev) && /within 2 days/.test(rev) && /at least 5/.test(rev) && /opened by/i.test(rev) && /cannot be changed or removed/.test(rev), rev);
ok("the write button stays off until the box is ticked", await p.$eval("#ac-go", e => e.disabled));
ok("nothing has been written yet", read(FACTS, "setAt(uint256)(uint64)", RS).split(" ")[0] === "0");
await p.click("#ac-ok"); await p.click("#ac-go");
ok("after writing, the page shows the three automatic questions as read-only", await until(async () => { const t = await T(p, "main"); return /Written/.test(t) && /Answered by the chain/.test(t) && /within 2 days/.test(t) && !(await p.$("#ac-q")); }), await T(p, "main"));
ok("the chain really holds the spec, written by the publisher", read(FACTS, "setAt(uint256)(uint64)", RS).split(" ")[0] !== "0");
ok("it cannot be written a second time (the contract refuses, even for the publisher)", (() => { try { sh(`cast call ${FACTS} "set(uint256,(uint8,uint8,uint8,uint8,uint32,uint64,address,uint8,uint256,bytes)[])" ${RS} "[(2,0,0,0,0,4102444800,0x0000000000000000000000000000000000000000,0,0,0x)]" --from ${PUB} --rpc-url ${ANVIL} 2>&1`); return false; } catch (e) { return /already set/.test(String(e.stdout || "") + String(e.stderr || "") + String(e.message)); } })());
await p.goto("about:blank"); await p.goto(BASE + "#auto/" + RS);
ok("a reload shows the same read-only list with no editor, even for the publisher", await until(async () => { const t = await T(p, "main"); return /Answered by the chain/.test(t) && /Written/.test(t); }) && !(await p.$("#ac-q")));
const v2 = await newPage(OTHER); await v2.goto(BASE + "#auto/" + RS);
ok("any visitor can read it", await until(async () => /within 2 days/.test(await T(v2, "main"))), await T(v2, "main"));

// ---- a rule set that does not exist
const q = await newPage(OTHER); await q.goto(BASE + "#auto/999999");
ok("an unknown rule set says so", await until(async () => /does not exist/.test(await T(q, "main"))), await T(q, "main"));
// ---- the rules history links to it
const h = await newPage(OTHER); await h.goto(BASE + "#rules/" + RS2);
ok("the rules history offers a link to the automatic questions", await until(async () => !!(await h.$(`a[href="#auto/${RS2}"]`))), await T(h, "main"));
ok("no page errors", errs.length === 0, errs.join(" | "));
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
