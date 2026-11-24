// Records the two scenes that need a real customer and reviewer flow: "nowallet" and "reviewer". These run in the TEST ENVIRONMENT
// (a fork of X Layer on anvil :8547, test wallets, a Chrome virtual passkey, a local relay) and are labelled as such on screen.
// Needs: anvil forking X Layer on 127.0.0.1:8547, forge, the site served at http://localhost:8090, puppeteer-core and ws installed.
// Setup (agreement, case, business answers) happens off camera; only the interesting parts are recorded.
import fs from "node:fs"; import { execFileSync } from "node:child_process";
import { launch, record, sleep, label, scrollTo, clickOn, clickAt, moveTo, typeIn, waitText } from "./lib.mjs";
const { startRelay } = await import(process.env.RELAY_MODULE || "../nostr-relay.mjs");
const OUT = "out/clips"; fs.mkdirSync(OUT, { recursive: true });
const durations = fs.existsSync(OUT + "/durations.json") ? JSON.parse(fs.readFileSync(OUT + "/durations.json", "utf8")) : {};
const REPO = process.env.REPO || "/home/samuel/Documents/tiebreak";
const BASE = "http://localhost:8090/index.html", ANVIL = "http://127.0.0.1:8547", CFGP = REPO + "/site/config.js", REG = "0x25E87D367316038a2d3B6A4fe3d58AA453D4c219";
const BUSINESS = "0x7e57000000000000000000000000000000000d01", REVIEWER = "0x7e57000000000000000000000000000000000e01", DEPLOYER = "0x7e57000000000000000000000000000000000dd1";
const arpc = async (m, p) => { const r = await (await fetch(ANVIL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: m, params: p }) })).json(); if (r.error) throw new Error(JSON.stringify(r.error)); return r.result; };
for (const a of [BUSINESS, REVIEWER, DEPLOYER]) { await arpc("anvil_setBalance", [a, "0x56bc75e2d63100000"]); await arpc("anvil_impersonateAccount", [a]); }
const forge = args => execFileSync("forge", args, { cwd: REPO + "/contracts", encoding: "utf8" });
const create = (name, ...args) => /Deployed to: (0x[0-9a-fA-F]{40})/.exec(forge(["create", name, "--rpc-url", ANVIL, "--unlocked", "--from", DEPLOYER, "--broadcast", ...(args.length ? ["--constructor-args", ...args] : [])]))[1];
const PK = create("src/PasskeyRegistry.sol:PasskeyRegistry"), AG = create("src/AgreementRegistryV2.sol:AgreementRegistryV2", REG, PK), CS = create("src/TiebreakCaseV4.sol:TiebreakCaseV4", REG, AG, PK, "0x9e2849c04a513fe64db07521cbe52d078d905c0e");
console.log("contracts on the fork:", PK, AG, CS);
const relay = startRelay(8099), RELAYS = ["ws://127.0.0.1:8099"];

const { browser, page } = await launch();
page.on("console", m => { if (m.type() === "error") console.log("PAGE ERROR:", m.text().slice(0, 600)); });
const cfg = fs.readFileSync(CFGP, "utf8").replace("https://rpc.xlayer.tech", ANVIL).replace(/v4: \{[^}]*\}/, `v4: {passkeys: "${PK}", agreements: "${AG}", cases: "${CS}"}`);
await page.setRequestInterception(true);
page.on("request", r => { if (r.url().endsWith("/config.js")) r.respond({ status: 200, contentType: "application/javascript", body: cfg }); else r.continue(); });
await page.evaluateOnNewDocument(ANVIL => { window.ethereum = { request: async ({ method, params }) => {
  if (method === "eth_requestAccounts" || method === "eth_accounts") return [localStorage.getItem("acct")];
  if (method === "eth_chainId") return "0xc4"; if (method === "wallet_switchEthereumChain") return null;
  if (method === "eth_sendTransaction") { const r = await (await fetch(ANVIL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [{ ...params[0], gas: "0x2000000" }] }) })).json(); if (r.error) { console.error("TX REJECTED", JSON.stringify(r.error), JSON.stringify(Object.fromEntries(Object.entries(params[0]).map(([k, v]) => [k, typeof v === "string" ? v.length + ":" + (v.length > 70 ? v.slice(0, 20) + "…" + v.slice(-10) : v) : v])))); throw new Error(r.error.message); } return r.result; }
  throw new Error("unsupported " + method); } }; }, ANVIL);
const cdp = await page.target().createCDPSession(); await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
const TEST = "Test environment: a fork of X Layer, test wallets, a virtual passkey";
const as = async (addr, hash) => { if (!page.url().startsWith("http://localhost:8090")) await page.goto(BASE); await page.evaluate((a, r) => { localStorage.setItem("acct", a); localStorage.setItem("lgtie.inboxRelays", JSON.stringify(r)); }, addr, RELAYS).catch(() => {}); await page.goto(BASE + "?" + Date.now() + hash); await sleep(900); await label(page, TEST, true); };
const T = sel => page.$eval(sel, e => e.innerText).catch(() => "");
const until = async (fn, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250); } return false; };
const click = sel => page.click(sel);
const need = (c, m) => { if (!c) throw new Error("setup failed: " + m); };
await page.goto(BASE); await page.evaluate(() => localStorage.setItem("acct", ""));

// ----- off camera: a passkey, an agreement, a case with the business's answers in -----
await as("", "#join"); await click("#mk"); need(await until(async () => /^lgtie1\./.test(await page.$eval("#claim", e => e.value).catch(() => ""))), "claim");
const claim = await page.$eval("#claim", e => e.value);
await as(BUSINESS, "#pk/agree"); await page.type("#cc", claim); await page.type("#rv", REVIEWER); await page.type("#terms", "Acme Laptops sales terms v1"); await click("#go");
need(await until(async () => /^#pk\/agreement\/1$/.test(await page.evaluate(() => location.hash))), "propose");
await as("", "#mine"); await click("#find"); need(await until(async () => !!(await page.$('[data-act="accept"]'))), "accept button"); await click('[data-act="accept"]');
need(await until(async () => /Sent to the other side's inbox/.test(await T("#inboxst"))), "accept sent");
await as(BUSINESS, "#inbox"); await click("#ibc").catch(() => {}); need(await until(async () => !!(await page.$("[data-go]"))), "inbox item"); await click("[data-go]"); need(await until(async () => /Submitted/.test(await T("#ibs"))), "accept submitted");
await as(BUSINESS, "#pk/agreement/1"); await click("#acts button"); need(await until(async () => /^#pk\/case\/1$/.test(await page.evaluate(() => location.hash))), "open case"); await sleep(900);
await page.evaluate(() => { const b = [...document.querySelectorAll("#wacts button")].find(x => x.textContent.trim().startsWith("Answer the questions")); b && b.click(); }); await sleep(400);
await page.evaluate(() => document.querySelectorAll("#ans .yn").forEach(g => g.querySelector('button[data-v="1"]').click())); await click("#send");
need(await until(async () => /Waiting for answers/.test(await T("main"))), "business answers");
fs.writeFileSync("/tmp/lgtie-video-photo.txt", "photo of the receipt");

const clip = async (id, fn) => { if (process.env.ONLY && process.env.ONLY !== id) { await fn(); return; } console.log("recording", id); const rec = await record(page, `${OUT}/${id}.mp4`); await fn(); durations[id] = +(await rec.stop()).toFixed(1); console.log(" ", id, durations[id], "s"); fs.writeFileSync(OUT + "/durations.json", JSON.stringify(durations, null, 1)); };
const yn = async (i, v) => { const h = (await page.$$("#cs .qs .yn"))[i]; const b = await h.$(`button[data-v="${v}"]`); await b.evaluate(e => e.scrollIntoView({ block: "center", behavior: "instant" })); const r = await b.boundingBox(); await clickAt(page, r.x + r.width / 2, r.y + r.height / 2, 380, 180); };

// ----- on camera: scene "nowallet" -----
await as("", "#mine"); await sleep(400);
await clip("nowallet", async () => {
  // 1. the customer finds her case and answers; her fingerprint signs the exact answers (the virtual passkey approves instantly)
  await clickOn(page, "#find", 600, 1200); await until(async () => !!(await page.$('[data-act="answer"]')), 15000); await sleep(500);
  for (let i = 0; i < 7; i++) await yn(i, i === 4 ? 0 : 1);
  await clickOn(page, '[data-act="answer"]', 500, 300); await until(async () => /Sent to the other side's inbox/.test(await T("#inboxst")), 20000); await sleep(1400);
  // 2. the business's inbox: one click submits it
  await as(BUSINESS, "#inbox"); await clickOn(page, "#ibc", 500, 400); await until(async () => !!(await page.$("[data-go]")), 20000); await sleep(600);
  await clickOn(page, "[data-go]", 700, 300); await until(async () => /Submitted/.test(await T("#ibs")), 20000); await sleep(900);
  // 3. evidence: a file becomes a fingerprint, nothing is uploaded
  await as("", "#mine"); await clickOn(page, "#find", 500, 900); await until(async () => !!(await page.$('[data-act="evidence"]')), 15000);
  await clickOn(page, '[data-act="evidence"]', 600, 500); await (await page.$("#evf")).uploadFile("/tmp/lgtie-video-photo.txt"); await sleep(500);
  await typeIn(page, "#evn", "Photo of the receipt", 40); await clickOn(page, "#evgo", 500, 300); await until(async () => /Sent to the other side's inbox/.test(await T("#inboxst")), 20000); await sleep(1100);
  // 4. the optional helper
  await label(page, ""); await page.goto("https://lgtie.vercel.app/?" + Date.now() + "#for-business", { waitUntil: "domcontentloaded" }); await sleep(1700); await label(page, "Live on X Layer");
  await scrollTo(page, 160, 900); const cards = await page.$$(".paths .path"); const bc = cards[5]; if (bc) { await bc.evaluate(e => e.scrollIntoView({ block: "center", behavior: "instant" })); const r = await bc.boundingBox(); await moveTo(page, r.x + r.width / 2, r.y + r.height / 2, 800); } await sleep(1200);
});

// ----- on camera: scene "reviewer" -----
await as(REVIEWER, "#pk/case/1/decide"); await until(async () => !!(await page.$("#rv-one")), 25000); await sleep(600);
await clip("reviewer", async () => {
  await sleep(700); const h = (await page.$$("#ans .yn"))[0]; await h.evaluate(e => e.scrollIntoView({ block: "center", behavior: "instant" })); const b = await h.$('button[data-v="1"]'); const r = await b.boundingBox(); await clickAt(page, r.x + r.width / 2, r.y + r.height / 2, 600, 300);
  await typeIn(page, "#rv-one", "Report shows no excluded cause", 22);
  await clickOn(page, "#rv-full", 450, 150); await page.type("#rv-full", "The repair centre report shows no excluded cause, so I answered yes. I could not verify who wrote the report.", { delay: 8 });
  await clickOn(page, "#rv-coi", 450, 350); await clickOn(page, "#send", 500, 300);
  await until(async () => /Decided/.test(await T("main")), 30000); await sleep(700); await page.evaluate(() => { const r = document.querySelector(".res"); r && r.scrollIntoView({ block: "center", behavior: "smooth" }); }); await sleep(3200);
});
await browser.close(); await relay.close();
