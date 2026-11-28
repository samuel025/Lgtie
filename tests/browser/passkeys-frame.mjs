// Passkeys inside a frame on ANOTHER website. A fictional Acme page is served from 127.0.0.1:8094 and embeds LGtie (localhost:8090) with
// <script src=".../embed.js" data-flow="join|mine">. Checks that creating and using a passkey works in a cross-site frame, that the host page receives the
// claim code through a checked postMessage, and that the business can invite from a prefilled link. Needs anvil on 8547, forge, Chrome, the site on 8090.
import puppeteer from "puppeteer-core"; import fs from "node:fs"; import http from "node:http"; import {execFileSync} from "node:child_process";
const SITE = "http://localhost:8090/", DEMO = "http://127.0.0.1:8094/", ANVIL = "http://127.0.0.1:8547", SITEDIR = "/home/samuel/Documents/tiebreak/site", CFGP = SITEDIR + "/config.js";
const REG = "0x25E87D367316038a2d3B6A4fe3d58AA453D4c219", PROC = "0x9e2849c04a513fe64db07521cbe52d078d905c0e", BUSINESS = "0x7e57000000000000000000000000000000000d01", REVIEWER = "0x7e57000000000000000000000000000000000e01", DEPLOYER = "0x7e57000000000000000000000000000000000dd1";
const arpc = async (m, p) => { const r = await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method: m, params: p})})).json(); if (r.error) throw new Error(JSON.stringify(r.error)); return r.result; };
for (const a of [BUSINESS, REVIEWER, DEPLOYER]) { await arpc("anvil_setBalance", [a, "0x56bc75e2d63100000"]); await arpc("anvil_impersonateAccount", [a]); }
const forge = args => execFileSync("forge", args, {cwd: "/home/samuel/Documents/tiebreak/contracts", encoding: "utf8"});
const create = (name, ...args) => /Deployed to: (0x[0-9a-fA-F]{40})/.exec(forge(["create", name, "--rpc-url", ANVIL, "--unlocked", "--from", DEPLOYER, "--broadcast", ...(args.length ? ["--constructor-args", ...args] : [])]))[1];
// USE_DEPLOYED=1 runs the same story against the contracts already deployed on mainnet (they exist on the fork); otherwise it deploys fresh copies.
const dep = process.env.USE_DEPLOYED ? /v4: \{passkeys: "(0x[0-9a-fA-F]{40})", agreements: "(0x[0-9a-fA-F]{40})", cases: "(0x[0-9a-fA-F]{40})"/.exec(fs.readFileSync(CFGP, "utf8")) : null;
const PK = dep ? dep[1] : create("src/PasskeyRegistry.sol:PasskeyRegistry"), AG = dep ? dep[2] : create("src/AgreementRegistryV2.sol:AgreementRegistryV2", REG, PK), CS = dep ? dep[3] : create("src/TiebreakCaseV4.sol:TiebreakCaseV4", REG, AG, PK, PROC);
// The fictional Acme site, on its own origin: the real embed-demo page, pointed at LGtie's embed script by absolute address.
const demoHtml = fs.readFileSync(SITEDIR + "/embed-demo.html", "utf8").replaceAll('src="embed.js"', `src="${SITE}embed.js"`);
const demo = http.createServer((q, r) => { r.setHeader("content-type", "text/html"); r.end(demoHtml); }).listen(8094, "127.0.0.1");
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), p = await b.newPage(); await p.setViewport({width: 1100, height: 1400});
await p.evaluateOnNewDocument(() => { try { localStorage.setItem("lgtie.lang", "en"); } catch (e) {} });   // the tests read English text; the app defaults to Chinese
const errs = []; p.on("pageerror", e => errs.push("pageerror: " + e.message));
let fails = 0; const ok = (n, c, x = "") => { console.log((c ? "ok   " : "FAIL ") + n + (c ? "" : " " + String(x).slice(0, 400))); if (!c) fails++; };
const w = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn().catch(() => false)) return true; await w(300); } return false; }
const cfg = fs.readFileSync(CFGP, "utf8").replace("https://rpc.xlayer.tech", ANVIL).replace(/v4: \{[^}]*\}/, `v4: {passkeys: "${PK}", agreements: "${AG}", cases: "${CS}"}`).replace(/\n\s*v[567]: \{[^}]*\},[^\n]*/g, "");   // this story tests the V4 contracts it deploys, so the later (billing and V6) lines are dropped
await p.setRequestInterception(true);
p.on("request", r => { if (r.url().endsWith("/config.js")) r.respond({status: 200, contentType: "application/javascript", headers: {"access-control-allow-origin": "*"}, body: cfg}); else r.continue(); });
await p.evaluateOnNewDocument(ANVIL => { window.ethereum = {request: async ({method, params}) => {
  if (method === "eth_requestAccounts" || method === "eth_accounts") return [localStorage.getItem("acct")];
  if (method === "eth_chainId") return "0xc4"; if (method === "wallet_switchEthereumChain") return null;
  if (method === "eth_sendTransaction") { const r = await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params: [{...params[0], gas: "0x2000000"}]})})).json(); if (r.error) throw new Error(r.error.message); return r.result; }
  throw new Error("unsupported " + method); }}; }, ANVIL);
const cdp = await p.target().createCDPSession(); await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", {options: {protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true}});
const frameOf = async part => { for (let i = 0; i < 60; i++) { const f = p.frames().find(f => f.url().includes(part)); if (f) return f; await w(250); } return null; };

// ---- Acme's page, with LGtie embedded from another origin.
await p.goto(DEMO + "?" + Date.now());
const join = await frameOf("#embed/join");
ok("the join frame loads from LGtie's own origin, not Acme's", !!join && join.url().startsWith(SITE) && !p.url().startsWith(SITE), join && join.url());
await join.waitForSelector("#mk", {timeout: 20000}); await w(800);
// a cold frame can swallow the first click (the virtual authenticator attaches asynchronously), so retry once like a patient user would
const hasClaim = async () => /^lgtie1\./.test(await join.$eval("#claim", e => e.value).catch(() => ""));
await join.click("#mk"); if (!(await until(hasClaim, 9000))) await join.click("#mk");
ok("the passkey is created inside the cross-site frame", await until(hasClaim), await join.$eval("main", e => e.innerText).catch(() => ""));
ok("Acme's page receives the claim code through a checked postMessage and stores it", await until(async () => /Maya Okoye/.test(await p.$eval("#claims", e => e.innerText)) && !(await p.$eval("#saved", e => e.hidden))), await p.$eval("#claims", e => e.innerText));
const invite = await p.$eval('#claims a.btn', a => a.href);
ok("Acme staff get a ready invite link that carries the claim code", /#pk\/agree\/lgtie1\./.test(invite) && invite.startsWith(SITE), invite);
ok("the frame resized itself to its content", (await p.$eval('iframe[src*="#embed/join"]', f => f.getBoundingClientRect().height)) > 150);

// ---- The business follows that link, with a wallet, and invites the customer. The claim code arrives prefilled.
await p.goto(SITE + "?" + Date.now()); await p.evaluate(a => localStorage.setItem("acct", a), BUSINESS);
await p.goto(invite.replace("index.html", "index.html?" + Date.now()));
ok("the claim code is prefilled from the link", await until(async () => /^lgtie1\./.test(await p.$eval("#cc", e => e.value))));
await p.type("#rv", REVIEWER); await p.click("#go");
ok("the business registers the passkey and proposes the agreement", await until(async () => /^#pk\/agreement\/1$/.test(await p.evaluate(() => location.hash))), await p.$eval("#msg", e => e.innerText).catch(() => ""));

// ---- Back on Acme's page: the customer's own view, in the frame, using the passkey cross-site.
await p.goto(DEMO + "?" + Date.now());
const mine = await frameOf("#embed/mine"); await mine.waitForSelector("#find", {timeout: 20000});
await p.evaluate(() => document.querySelector('iframe[src*="#embed/mine"]').scrollIntoView());
await mine.click("#find");
ok("her passkey finds her account inside the frame and the page proves she controls it", await until(async () => /controlled by your passkey/.test(await mine.$eval("#fm", e => e.innerText))), await mine.$eval("#fm", e => e.innerText).catch(() => ""));
ok("she sees her agreement and can sign the acceptance in the frame", await until(async () => !!(await mine.$('[data-act="accept"]'))));
await mine.click('[data-act="accept"]');
ok("signing works in the frame and produces a link to hand to someone with a wallet", await until(async () => !!(await mine.$("#cplink"))), await mine.$eval("#list", e => e.innerText).catch(() => ""));

// ---- A frame on another site can only ask for a claim; messages from the wrong sender are ignored.
await p.evaluate(() => window.postMessage({lgtie: "passkey-claim", claim: "lgtie1.FORGEDFORGEDFORGEDFORGEDFORGED"}, "*"));
await w(400);
ok("a forged claim message from the page itself is ignored (only the LGtie frame is trusted)", !/FORGED/.test(await p.$eval("#claims", e => e.innerText)));
ok("no page errors", errs.length === 0, errs.join(" | "));
demo.close(); await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
