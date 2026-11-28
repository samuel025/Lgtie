// Agreement cards, the whole story, on the contracts scripts/deploy-v8.sh really deploys (to a fork of X Layer), with two separate "phones" (separate browser
// storage, each with its own virtual passkey): Samuel sends a deal link, Amina signs, Samuel signs, nothing goes on-chain; later a wallet holder records the card,
// Amina opens a case, both answer, they disagree, and with no reviewer named in advance they agree one by passkey signatures and the reviewer decides.
// Needs: site on http://localhost:8090, `anvil --fork-url https://rpc.xlayer.tech --port 8547 --auto-impersonate --silent`, puppeteer-core, foundry, Chrome.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import { execSync } from "node:child_process";
const SITE = process.env.SITE || "/home/samuel/Documents/tiebreak", BASE = "http://localhost:8090/index.html", ANVIL = "http://127.0.0.1:8547";
const sh = c => execSync(c, {encoding: "utf8", cwd: SITE, env: {...process.env, ETH_RPC_URL: ANVIL}}).trim();
const rpc = async (method, params) => (await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params})})).json());
const send = (from, to, sig, ...args) => sh(`cast send ${to} "${sig}" ${args.map(a => `"${a}"`).join(" ")} --from ${from} --unlocked --rpc-url ${ANVIL} --gas-limit 8000000 >/dev/null`);
const read = (to, sig, ...args) => sh(`cast call ${to} "${sig}" ${args.map(a => `"${a}"`).join(" ")} --rpc-url ${ANVIL}`).split(" ")[0];
const OWNER = "0x0aE117C07A277D74D9326eb4e33013439dC68fD5", RELAYER = "0x7e57000000000000000000000000000000000e21", REVIEWER = "0x7e57000000000000000000000000000000000f21";
for (const a of [OWNER, RELAYER, REVIEWER]) { await rpc("anvil_setBalance", [a, "0x56bc75e2d63100000"]); await rpc("anvil_impersonateAccount", [a]); }
// ---- the real deploy script on the fork, with the per-case fee at zero so no dollar token is needed
const CFGT = "/tmp/lgtie-v8-config.js"; fs.writeFileSync(CFGT, fs.readFileSync(SITE + "/site/config.js", "utf8").replace(/\n\s*v8: \{[^}]*\},[^\n]*/g, ""));
const dep = sh(`CASE_FEE=0 DEPLOYER=${OWNER} RPC_URL=${ANVIL} CONFIG=${CFGT} SIGNER_ARGS="--unlocked --from ${OWNER}" scripts/deploy-v8.sh deploy 2>&1 | tail -4`);
const AG4 = /AgreementRegistryV4:\s+(0x[0-9a-fA-F]{40})/.exec(dep)[1], CASES = /TiebreakCaseV7:\s+(0x[0-9a-fA-F]{40})/.exec(dep)[1], cfg = fs.readFileSync(CFGT, "utf8").replace("https://rpc.xlayer.tech", ANVIL);
const words = async (to, sig, ...args) => { const r = (await rpc("eth_call", [{to, data: sh(`cast calldata "${sig}" ${args.join(" ")}`)}, "latest"])).result.slice(2); return k => BigInt("0x" + r.slice(k * 64, k * 64 + 64)); };

const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), errs = [];
let fails = 0; const ok = (n, c, x = "") => { console.log((c ? "ok   " : "FAIL ") + n + (c ? "" : " " + String(x).slice(0, 500))); if (!c) fails++; };
const w = ms => new Promise(r => setTimeout(r, ms));
const T = (p, sel) => p.$eval(sel, e => e.innerText).catch(() => "");
async function until(fn, ms = 40000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await w(400); } return false; }
async function newPage(ctx, acct, authenticator) {
  const p = await ctx.newPage(); await p.setViewport({width: 1200, height: 1600}); p.on("pageerror", e => errs.push(e.message));
  await p.setRequestInterception(true); p.on("request", r => { if (r.url().endsWith("/config.js")) r.respond({status: 200, contentType: "application/javascript", body: cfg}); else r.continue(); });
  await p.evaluateOnNewDocument((ANVIL, acct) => { try { localStorage.setItem("lgtie.lang", "en"); localStorage.setItem("acct", acct); localStorage.setItem("lgtie.inboxRelays", "[]"); } catch (e) {}
    window.ethereum = {request: async ({method, params}) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [localStorage.getItem("acct")];
      if (method === "eth_chainId") return "0xc4"; if (method === "wallet_switchEthereumChain") return null;
      if (method === "eth_sendTransaction") { const r = await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params: [{...params[0], gas: "0x2000000"}]})})).json(); if (r.error) throw new Error(r.error.message); return r.result; }
      throw new Error("unsupported " + method); }}; }, ANVIL, acct);
  if (authenticator) { const cdp = await p.target().createCDPSession(); await cdp.send("WebAuthn.enable"); await cdp.send("WebAuthn.addVirtualAuthenticator", {options: {protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true}}); }
  return p;
}
const phone = async () => { const ctx = await b.createBrowserContext(); return {ctx, p: await newPage(ctx, "", true)}; };
const go = async (p, hash) => { await p.goto("about:blank"); await p.goto(BASE + "?" + Date.now() + hash); };
const click = (p, sel) => p.evaluate(s => document.querySelector(s).click(), sel);   // a DOM click: a mouse click can stall right after a navigation in this browser build
const wallet = async (hash, acct = RELAYER) => { const ctx = await b.createBrowserContext(), p = await newPage(ctx, acct, false); await p.goto(BASE + "?" + Date.now() + hash); return p; };
const submit = async link => { const r = await wallet(link.slice(link.indexOf("#"))); const good = await until(async () => !(await r.$eval("#go", e => e.disabled).catch(() => true))); if (good) { await click(r, "#go"); await until(async () => /Submitted/.test(await T(r, "#done"))); } const out = await T(r, "main"); await r.close(); return out; };
const answers = (p, noIdx) => p.evaluate(n => document.querySelectorAll("#cs .qs .yn").forEach((g, i) => g.querySelector(`button[data-v="${i === n ? 0 : 1}"]`).click()), noIdx ?? -1);

const S = await phone(), A = await phone(), STRANGER = await phone();
// ---- 1. Samuel makes a deal link as a signed card: a passkey on his phone, no wallet
await go(S.p, "#deal/warranty");
ok("with the card contracts live, the deal page offers signed cards (ticked by default)", await until(async () => !!(await S.p.$("#dl-card"))) && await S.p.$eval("#dl-card", e => e.checked));
await S.p.$eval("#dl-a", e => { e.value = "Samuel"; e.dispatchEvent(new Event("input")); }); await S.p.$eval("#dl-b", e => { e.value = "Amina"; e.dispatchEvent(new Event("input")); }); await S.p.$eval("#dl-w", e => { e.value = "Laptop repair"; e.dispatchEvent(new Event("input")); });
ok("it first asks him to make a passkey on his phone", await until(async () => !!(await S.p.$("#dl-mk"))), await T(S.p, "#dl-out"));
await click(S.p, "#dl-mk");
ok("then it gives him the message and link", await until(async () => !!(await S.p.$("#dl-msg"))), await T(S.p, "#dl-out"));
const dealLink = (await S.p.$eval("#dl-msg", e => e.value)).split("\n").pop(), payload = dealLink.split("#")[1], dealObj = JSON.parse(Buffer.from(payload, "base64url").toString());
ok("the link carries his public passkey code and nothing secret", /^lgtie1\./.test(dealObj.k) && dealObj.t === "warranty" && !/private/.test(JSON.stringify(dealObj)));

// ---- 2. Amina taps it and signs, on her own phone
await go(A.p, "#d/" + payload);
ok("Amina sees the deal and one button to agree", await until(async () => /Samuel wants to agree the rules first/.test(await T(A.p, "main")) && /no fee/.test(await T(A.p, "#dd-agree"))), await T(A.p, "main"));
await click(A.p, "#dd-go");
ok("one tap signs the card and gives her a reply to send", await until(async () => /I have signed/.test(await A.p.$eval("#dd-msg", e => e.value).catch(() => ""))), await T(A.p, "#dd-out"));
const reply = await A.p.$eval("#dd-msg", e => e.value), replyLink = reply.split(": ").pop();
ok("the reply is a card link and says nothing goes on X Layer unless there is a dispute", /#card\/[A-Za-z0-9_-]+$/.test(replyLink) && /Nothing is recorded on X Layer unless there is a dispute/.test(await T(A.p, "#dd-out")));
ok("nothing is on-chain: no wallet, no fee", read(AG4, "count()(uint256)") === "0");

// ---- 3. Samuel signs second; a stranger cannot take his place
const st = STRANGER.p; await go(st, replyLink.slice(replyLink.indexOf("#")));
ok("someone else opening the link sees it is waiting for Samuel and cannot sign", await until(async () => /waiting for Samuel to sign/.test(await T(st, "main"))) && !(await st.$("#cd-sign")), await T(st, "main"));
await go(S.p, replyLink.slice(replyLink.indexOf("#")));
ok("Samuel sees Amina's signature checked, and his own turn", await until(async () => /Your turn/.test(await T(S.p, "main")) && !!(await S.p.$("#cd-sign"))), await T(S.p, "main"));
ok("her signature shows as valid", /Amina[\s\S]*Signed/.test(await T(S.p, "main")));
await click(S.p, "#cd-sign");
ok("he signs and gets the finished card to send back", await until(async () => /our agreement is signed/.test(await S.p.$eval("#cd-msgbox", e => e.value).catch(() => ""))), await T(S.p, "main"));
const finalLink = (await S.p.$eval("#cd-msgbox", e => e.value)).split(": ").pop();
ok("still nothing on-chain", read(AG4, "count()(uint256)") === "0");

// ---- 4. Amina opens the finished card; tampering is caught
await go(A.p, finalLink.slice(finalLink.indexOf("#")));
ok("Amina sees 'Signed by both' and that nothing needs to be recorded yet", await until(async () => /Signed by both/.test(await T(A.p, "main")) && /Nothing is on X Layer yet/.test(await T(A.p, "main"))), await T(A.p, "main"));
const blob = finalLink.split("#card/")[1], card = JSON.parse(Buffer.from(blob, "base64url").toString()); card.t.s = "0x" + "11".repeat(32);
const tp = STRANGER.p; await go(tp, "#card/" + Buffer.from(JSON.stringify(card)).toString("base64url"));
ok("a card whose terms were changed after signing is rejected", await until(async () => /did not check out/.test(await T(tp, "main"))), await T(tp, "main"));
await go(A.p, "#cards");
ok("the finished card is saved on her phone", await until(async () => /Laptop repair/.test(await T(A.p, "main")) && /Not recorded/.test(await T(A.p, "main"))), await T(A.p, "main"));

// ---- 5. something goes wrong: a wallet holder records it
const rec = await wallet(finalLink.slice(finalLink.indexOf("#")));
ok("anyone with a wallet can record the card", await until(async () => !!(await rec.$("#cd-rec"))), await T(rec, "main"));
await click(rec, "#cd-rec");
ok("it is recorded as agreement #1, already in force", await until(async () => /agreement #1/.test(await T(rec, "main"))), await T(rec, "main"));
await rec.close();
const ag = await words(AG4, "get(uint256)", 1);
ok("on-chain it is an agreement between two new passkey accounts with no wallets, accepted at once, with no reviewer", ag(0) === 0n && ag(1) > 0n && ag(2) === 0n && ag(3) > 0n && ag(10) > 0n && ag(6) === 0n);
ok("the same card cannot be recorded twice", await (async () => { const r2 = await wallet(finalLink.slice(finalLink.indexOf("#"))); const good = await until(async () => /recorded on X Layer as/.test(await T(r2, "main"))); await r2.close(); return good; })());

// ---- 6. Amina opens a case by passkey; someone else submits it
await go(A.p, "#mine"); await click(A.p, "#find");
ok("her passkey finds the agreement", await until(async () => /Agreement #1/.test(await T(A.p, "#ags")) && !!(await A.p.$('[data-act="open"]'))), await T(A.p, "#list"));
ok("it says no reviewer is named yet", /No reviewer is named yet/.test(await T(A.p, "#ags")));
await click(A.p, '[data-act="open"]');
ok("she signs the opening of a case", await until(async () => !!(await A.p.$("#ags .act #cplink"))), await T(A.p, "#ags"));
await submit(await A.p.$eval("#ags .act #cplink", e => e.dataset.link));
ok("the case is open on the new case contract, with no reviewer and nobody approved", read(CASES, "count()(uint256)") === "1" && (await words(CASES, "get(uint256)", 1))(5) === 0n);

// ---- 7. both answer, and disagree about one question
await go(A.p, "#mine"); await click(A.p, "#find"); await until(async () => !!(await A.p.$("#cs .qs .yn")));
await answers(A.p); await click(A.p, '#cs [data-act="answer"]');
ok("Amina signs her answers", await until(async () => !!(await A.p.$("#cs .act #cplink"))), await T(A.p, "#cs"));
await submit(await A.p.$eval("#cs .act #cplink", e => e.dataset.link));
await go(S.p, "#mine"); await click(S.p, "#find"); await until(async () => !!(await S.p.$("#cs .qs .yn")));
await answers(S.p, 4); await click(S.p, '#cs [data-act="answer"]');
ok("Samuel signs his, answering one question differently", await until(async () => !!(await S.p.$("#cs .act #cplink"))), await T(S.p, "#cs"));
await submit(await S.p.$eval("#cs .act #cplink", e => e.dataset.link));
ok("the case now waits for a reviewer and nobody can decide yet", (await words(CASES, "get(uint256)", 1))(27) === 1n, [(await words(CASES, "get(uint256)", 1))(27)]);

// ---- 8. they agree a reviewer after the dispute started, by passkey signatures
await go(A.p, "#mine"); await click(A.p, "#find");
ok("Amina's case shows that no reviewer is agreed yet and lets her propose one", await until(async () => /None yet\. If you and the other side answer any question differently/.test(await T(A.p, "#cs")) && !!(await A.p.$("#cs .rv-in"))), await T(A.p, "#cs"));
ok("the reviewer box offers the directory", !!(await A.p.$("#cs [data-dirpick]")));
await A.p.$eval("#cs .rv-in", (e, v) => { e.value = v; }, REVIEWER); await click(A.p, '#cs [data-rv="propose"]');
ok("she signs the proposal", await until(async () => !!(await A.p.$("#cs .rv-out #cplink"))), await T(A.p, "#cs"));
await submit(await A.p.$eval("#cs .rv-out #cplink", e => e.dataset.link));
const c2 = await words(CASES, "get(uint256)", 1);
ok("the reviewer is on the case and only Amina has approved", (c2(5) & ((1n << 160n) - 1n)) === BigInt(REVIEWER) && c2(21) === 1n && c2(22) === 0n, [c2(5), c2(21), c2(22)]);
ok("the reviewer cannot decide yet", await (async () => { try { sh(`cast call ${CASES} "review(uint256,uint64)" 1 127 --from ${REVIEWER} --rpc-url ${ANVIL} 2>&1`); return false; } catch (e) { return /not accepted by both/.test(String(e.stdout || "") + String(e.stderr || "") + e.message); } })());
await go(S.p, "#mine"); await click(S.p, "#find");
ok("Samuel is asked to approve that reviewer", await until(async () => /proposed/.test(await T(S.p, "#cs")) && !!(await S.p.$('#cs [data-rv="approve"]'))), await T(S.p, "#cs"));
ok("with a reviewer proposed it shows who they are, what the chain shows about them, and how the fee works (paid directly, not enforced)", await until(async () => /About 0x/.test(await T(S.p, "#cs .rv-info")) && /address only/.test(await T(S.p, "#cs .rv-info")) && /Agree who pays and how before the reviewer starts/.test(await T(S.p, "#cs .rv-info")) && /LGtie cannot enforce it/.test(await T(S.p, "#cs .rv-info"))), await T(S.p, "#cs .rv-info"));
await click(S.p, '#cs [data-rv="approve"]');
ok("he signs the approval", await until(async () => !!(await S.p.$("#cs .rv-out #cplink"))), await T(S.p, "#cs"));
await submit(await S.p.$eval("#cs .rv-out #cplink", e => e.dataset.link));
const c3 = await words(CASES, "get(uint256)", 1);
ok("both sides have approved the reviewer", c3(21) === 1n && c3(22) === 1n);

// ---- 9. the reviewer decides and the case is final
send(REVIEWER, CASES, "review(uint256,uint64)", "1", "127");
const c4 = await words(CASES, "get(uint256)", 1);
ok("the reviewer's answer on the disputed question settles the case", c4(27) === 2n && c4(19) === 127n, [c4(27), c4(19)]);
await go(A.p, "#pk/case/1");
ok("the public case page shows it decided", await until(async () => /Decided/.test(await T(A.p, "main"))), await T(A.p, "main"));
ok("no page errors", errs.length === 0, errs.join(" | "));
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
