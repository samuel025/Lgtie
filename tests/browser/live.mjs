// Smoke test of the DEPLOYED site (default https://lgtie.vercel.app/). Read-only: no wallet is injected and nothing is written to the chain.
// Checks the home page and the real mainnet case card, the receipt, the checker with on-chain confirmation and the claim pack, the passkey
// flow on the real domain (a Chrome virtual authenticator), and a true cross-site frame: a page on another origin embedding the live site.
//   node live.mjs            or   LIVE_URL=https://example.vercel.app/ node live.mjs
import puppeteer from "puppeteer-core"; import fs from "node:fs"; import http from "node:http";
const LIVE = (process.env.LIVE_URL || "https://lgtie.vercel.app/").replace(/\/?$/, "/"), HOST = new URL(LIVE).hostname;
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
let fails = 0; const ok = (n, c, x = "") => { console.log((c ? "ok   " : "FAIL ") + n + (c ? "" : " " + String(x).slice(0, 300))); if (!c) fails++; };
const w = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await w(300); } return false; }

// headers and files
const head = await fetch(LIVE, {method: "HEAD"}); ok("the site answers publicly (no login wall)", head.status === 200, head.status);
ok("pages may be framed by other sites (embedding is a feature)", !head.headers.get("x-frame-options") && !/frame-ancestors/.test(head.headers.get("content-security-policy") || ""), head.headers.get("x-frame-options") + " " + head.headers.get("content-security-policy"));
for (const f of ["embed.js", "embed-demo.html"]) ok(f + " is served", (await fetch(LIVE + f)).status === 200);

const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), p = await b.newPage(); await p.setViewport({width: 1280, height: 900});
const errs = []; p.on("pageerror", e => errs.push(e.message));
const T = sel => p.$eval(sel, e => e.innerText).catch(() => "");
const cdp = await p.target().createCDPSession(); await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {options: {protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true}});

await p.goto(LIVE); await w(1500);
ok("home headline is the dispute-layer pitch", /settle only what they disagree on/.test(await T("h1")), await T("h1"));
ok("the nav links to the passkey pages", !!(await p.$('nav a[href="#mine"]')));
ok("the home page reads the real mainnet case and shows it decided", await until(async () => /Covered/.test(await T("#realcase")) && /Decided/.test(await T("#realcase"))), await T("#realcase"));
ok("the home page has the no-wallet row", /Customers approve with their fingerprint or face/.test(await p.$eval("main", e => e.textContent)));
await p.goto(LIVE + "#receipt/1");
ok("the receipt for the real case loads and the rules re-run on mainnet", await until(async () => /same result/.test(await T("#rp")), 40000), await T("#rp"));
await p.goto(LIVE + "#check/warranty"); await w(800);
await p.evaluate(() => document.querySelectorAll(".q").forEach(d => d.querySelector('button[data-v="1"]').click()));
ok("the checker answers Covered and the TapeOut processor confirms it", await until(async () => /Covered/.test(await T(".res .big")) && /Confirmed by the TapeOut processor/.test(await T("#vbadge")), 40000), await T("#vbadge"));
ok("the claim pack is produced for the live site", await until(async () => /LGTIE CLAIM PACK/.test(await p.$eval("#packtxt", e => e.textContent)) && new RegExp("Re-run these answers: " + LIVE.replace(/[.\/]/g, "\\$&") + "#check").test(await p.$eval("#packtxt", e => e.textContent))), await p.$eval("#packtxt", e => e.textContent).catch(() => ""));
await p.goto(LIVE + "#about"); ok("the About page explains passkeys", /Customers without a wallet/.test(await p.$eval("main", e => e.textContent)));
await p.goto(LIVE + "#build"); ok("the builder loads", await until(async () => /Publish your policy as a checker/.test(await T("h1"))));
await p.goto(LIVE + "#relay/not-a-real-link"); ok("a garbage relay link is refused", await until(async () => /damaged|will not be sent/.test(await T("main"))), await T("main"));

// the passkey flow on the real domain: the passkey is tied to this exact address
await p.goto(LIVE + "#join"); await p.waitForSelector("#mk", {timeout: 20000}); await p.click("#mk");
ok("a passkey is created on the live domain and gives a claim code", await until(async () => /^lgtie1\./.test(await p.$eval("#claim", e => e.value).catch(() => ""))), await T("main"));
const claim = await p.$eval("#claim", e => e.value).catch(() => ""), parsed = claim ? JSON.parse(Buffer.from(claim.slice(7).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()) : {};
ok("the claim code is bound to the live hostname (a passkey made elsewhere would not work here)", parsed.id === HOST, JSON.stringify(parsed.id));
await p.goto(LIVE + "#mine"); await p.waitForSelector("#find", {timeout: 20000}); await p.click("#find");
ok("an unregistered passkey finds no account (a read of the deployed contracts on mainnet)", await until(async () => /No account is registered for this passkey/.test(await T("#list")), 40000), await T("#fm") + await T("#list"));
await p.goto(LIVE + "#pk/agree"); ok("the business invite page loads against the deployed contracts", await until(async () => /Invite a customer who has no wallet/.test(await T("h1"))));

// a true cross-site frame: a page on another origin embeds the LIVE site
const demoHtml = fs.readFileSync("/home/samuel/Documents/tiebreak/site/embed-demo.html", "utf8").replaceAll('src="embed.js"', `src="${LIVE}embed.js"`);
const demo = http.createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end(demoHtml); }).listen(8095, "127.0.0.1");
const p2 = await b.newPage(); await p2.setViewport({width: 1100, height: 1400}); const errs2 = []; p2.on("pageerror", e => errs2.push(e.message));
const c2 = await p2.target().createCDPSession(); await c2.send("WebAuthn.enable");
await c2.send("WebAuthn.addVirtualAuthenticator", {options: {protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true}});
await p2.goto("http://127.0.0.1:8095/");
const frame = async part => { for (let i = 0; i < 80; i++) { const f = p2.frames().find(f => f.url().includes(part)); if (f) return f; await w(250); } return null; };
const join = await frame("#embed/join");
ok("the live join page loads inside a page on another site", !!join && join.url().startsWith(LIVE), join && join.url());
await join.waitForSelector("#mk", {timeout: 25000}); await join.click("#mk");
ok("a passkey is created inside that cross-site frame, on the live domain", await until(async () => /^lgtie1\./.test(await join.$eval("#claim", e => e.value).catch(() => ""))), await join.$eval("main", e => e.innerText).catch(() => ""));
ok("the other site receives the claim code by checked message", await until(async () => /Maya Okoye/.test(await p2.$eval("#claims", e => e.innerText)) && !(await p2.$eval("#saved", e => e.hidden))), await p2.$eval("#claims", e => e.innerText).catch(() => ""));
const link = await p2.$eval("#claims a.btn", a => a.href).catch(() => ""); ok("its invite link points at the live site", link.startsWith(LIVE + "index.html#pk/agree/lgtie1.") || link.startsWith(LIVE + "#pk/agree/lgtie1."), link.slice(0, 100));
demo.close();
ok("no page errors", errs.length === 0 && errs2.length === 0, errs.concat(errs2).join(" | "));
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
