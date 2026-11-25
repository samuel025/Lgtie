// Named reviewers: a reviewer signs a profile with their wallet, publishes it to a relay, and others see the name next to the address.
// Uses a real wallet signature (made with foundry's `cast wallet sign` for a well-known test key), a local Nostr relay and a fake public page,
// so it needs no fork and spends nothing. It reads X Layer mainnet only for the reviewer's case list (read-only).
// Needs: the site on http://localhost:8090, puppeteer-core and ws installed next to this file, and `cast`.
import puppeteer from "puppeteer-core";
import fs from "node:fs"; import { execFileSync } from "node:child_process";
import { startRelay } from "./nostr-relay.mjs";
const BASE = process.env.BASE || "http://localhost:8090/index.html", CAST = process.env.CAST || (process.env.HOME + "/.foundry/bin/cast");
const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d", ACCT = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8", OTHER = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";
const PAGE = "https://reviewer.example/amina";
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : " " + (x ?? ""))); };
const w = ms => new Promise(r => setTimeout(r, ms));
const relay = startRelay(8099), RELAYS = ["ws://127.0.0.1:8099"];
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]});
let pageText = "nothing here yet";   // what the fake public page says
async function newPage(account) {
  const p = await b.newPage(); await p.setViewport({width: 1280, height: 1000}); const errs = []; p.on("pageerror", e => errs.push(e.message)); p.errs = errs;
  await p.exposeFunction("castSign", hex => execFileSync(CAST, ["wallet", "sign", "--private-key", PK, hex], {encoding: "utf8"}).trim());
  await p.setRequestInterception(true);
  p.on("request", r => { if (r.url() === PAGE) r.respond({status: 200, contentType: "text/html", headers: {"access-control-allow-origin": "*"}, body: pageText}); else r.continue(); });
  await p.evaluateOnNewDocument((acct, relays) => {
    localStorage.setItem("lgtie.inboxRelays", JSON.stringify(relays)); localStorage.setItem("lgtie.lang", "en");
    window.ethereum = {request: async ({method, params}) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [acct]; if (method === "eth_chainId") return "0xc4";
      if (method === "personal_sign") return window.castSign(params[0]); throw new Error("unsupported " + method); }};
  }, account, RELAYS);
  return p;
}
const T = (p, sel) => p.$eval(sel, e => e.innerText).catch(() => "");
const until = async (f, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f().catch(() => false)) return true; await w(250); } return false; };

// ---- 1. the reviewer sets up a profile ----
const a = await newPage(ACCT);
await a.goto(BASE + "#reviewer/" + ACCT); await a.waitForSelector("#rid-me", {timeout: 30000});
ok("a reviewer with no profile is shown as 'address only'", await until(async () => /address only/.test(await T(a, "#rid-view"))), await T(a, "#rid-view"));
await a.click("#rid-me"); await a.waitForSelector("#rid-sign");
await a.type("#rid-name", "Amina Yusuf"); await a.type("#rid-role", "independent assessor"); await a.type("#rid-spec", "Used electronics"); await a.type("#rid-fee", "US$10 per disputed question"); await a.type("#rid-url", "http://insecure.example");
await a.click("#rid-sign");
ok("a page address that is not https is refused", /https/.test(await T(a, "#rid-m2")), await T(a, "#rid-m2"));
await a.$eval("#rid-url", e => e.value = ""); await a.type("#rid-url", PAGE); await a.click("#rid-sign");
ok("signing with the wallet gives a profile code", await until(async () => /^lgtie-reviewer1\./.test(await a.$eval("#rid-code", e => e.value).catch(() => ""))), await T(a, "#rid-m2"));
const code = await a.$eval("#rid-code", e => e.value);
await a.click("#rid-chk");
ok("a page without the code is reported as missing the proof", await until(async () => /does not show the proof/.test(await T(a, "#rid-m4"))), await T(a, "#rid-m4"));
pageText = "<p>Hi, I am Amina. My LGtie reviewer profile: " + code + "</p>"; await a.click("#rid-chk");
ok("once the code is on the page, it is confirmed", await until(async () => /public page confirms it/.test(await T(a, "#rid-m4"))), await T(a, "#rid-m4"));
await a.click("#rid-pub");
ok("publishing reaches the relay", await until(async () => /Published to 1 relay/.test(await T(a, "#rid-m3"))), await T(a, "#rid-m3"));
ok("the card now shows the name, the page and a signed badge", await until(async () => { const t = await T(a, "#rid-view"); return /Amina Yusuf/.test(t) && /independent assessor/.test(t) && /signed by this wallet/.test(t); }), await T(a, "#rid-view"));
ok("it also shows the specialty and the fee, and says LGtie holds no money", /Specialty: Used electronics/.test(await T(a, "#rid-view")) && /Fee: US\$10 per disputed question/.test(await T(a, "#rid-view")) && /LGtie holds no money/.test(await T(a, "#rid-view")), await T(a, "#rid-view"));
ok("and the page check passes on the card", await until(async () => /public page confirms it/.test(await T(a, "#rid-pg"))), await T(a, "#rid-pg"));
if (process.env.SHOTS) { await a.addStyleTag({content: "header{display:none!important}"}); const card = await a.$("#ridcard"); if (card) await card.screenshot({path: process.env.SHOTS + "/reviewer-profile.png"}); }   // set SHOTS=/some/dir to save a screenshot

// ---- 2. a different person, on a fresh browser profile, sees the name from the relay ----
const ctx = await b.createBrowserContext(); const c = await ctx.newPage(); await c.setViewport({width: 1280, height: 1000});
await c.setRequestInterception(true); c.on("request", r => { if (r.url() === PAGE) r.respond({status: 200, contentType: "text/html", headers: {"access-control-allow-origin": "*"}, body: pageText}); else r.continue(); });
await c.evaluateOnNewDocument(relays => { localStorage.setItem("lgtie.inboxRelays", JSON.stringify(relays)); localStorage.setItem("lgtie.lang", "en"); }, RELAYS);
await c.goto(BASE + "#reviewer/" + ACCT);
ok("a stranger's browser finds the signed profile through the relay", await until(async () => /Amina Yusuf/.test(await T(c, "#rid-view"))), await T(c, "#rid-view"));
ok("and sees the specialty and the fee too", /Specialty: Used electronics/.test(await T(c, "#rid-view")) && /US\$10 per disputed question/.test(await T(c, "#rid-view")), await T(c, "#rid-view"));
ok("it shows a note that this proves the wallet and page share an owner, not honesty", /does not show that the person is honest/.test(await T(c, "#rid-view")));
await c.goto(BASE + "#reviewer/" + OTHER);
ok("another address still shows 'address only'", await until(async () => /address only/.test(await T(c, "#rid-view"))), await T(c, "#rid-view"));

// ---- 3. the profile code can only be used with the right reviewer address ----
await c.goto(BASE + "#agree"); await c.waitForSelector("#rvp", {timeout: 30000});
await c.type("#rv", OTHER); await c.type("#rvp", code);
ok("the agreement form refuses a profile that belongs to a different reviewer address", await until(async () => /different wallet/.test(await T(c, "#rvpmsg"))), await T(c, "#rvpmsg"));
await c.$eval("#rv", e => { e.value = ""; e.dispatchEvent(new Event("input")); }); await c.type("#rv", ACCT);
ok("with the right address, the identity line is added to the terms", await until(async () => /Reviewer identity: Amina Yusuf, independent assessor, specialty Used electronics, fee US\$10 per disputed question, https:\/\/reviewer\.example\/amina/.test(await T(c, "#rvpmsg"))), await T(c, "#rvpmsg"));
await c.$eval("#rvp", e => { e.value = "lgtie-reviewer1.garbage"; e.dispatchEvent(new Event("input")); });
ok("a garbage profile code is explained, not accepted", await until(async () => /could not be read/.test(await T(c, "#rvpmsg"))), await T(c, "#rvpmsg"));

// ---- 4. the wrong wallet cannot sign for this address ----
const d = await newPage(OTHER);
await d.goto(BASE + "#reviewer/" + ACCT); await d.waitForSelector("#rid-me", {timeout: 30000}); await d.click("#rid-me");
ok("connecting a different wallet is refused with an explanation", await until(async () => /not 0x7099/.test((await T(d, "#rid-msg")).replace("…", ""))) || /not/.test(await T(d, "#rid-msg")), await T(d, "#rid-msg"));

ok("no page errors", a.errs.length + d.errs.length === 0, [...a.errs, ...d.errs].join(" | "));
await b.close(); await relay.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
