// Records the two scenes that need a real customer and reviewer flow: "nowallet" and "reviewer". These run in the TEST ENVIRONMENT
// (a fork of X Layer on anvil :8547, test wallets, a Chrome virtual passkey, a local relay) and are labelled as such on screen.
// Every action is timed to the sentence it illustrates, at normal speed. Setup (agreement, case, business answers) happens off camera.
// Needs: anvil forking X Layer on 127.0.0.1:8547, forge, the site served at http://localhost:8090, puppeteer-core and ws installed.
import fs from "node:fs"; import { execFileSync } from "node:child_process";
import { launch, scene, timeline, dead, sleep, label, scrollTo, scrollToEl, clickOn, pointAt, moveTo, spot, callout, calloutAt, titleCard, deviceSheet, typeIn, boxOf, restoreCursor, navFade } from "./lib.mjs";
const { startRelay } = await import(process.env.RELAY_MODULE || "../nostr-relay.mjs");
const REPO = process.env.REPO || "/home/samuel/Documents/tiebreak", tl = timeline(), only = process.argv[2] ? process.argv[2].split(",") : null, want = id => !only || only.includes(id);
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
page.on("console", m => { if (m.type() === "error") console.log("PAGE ERROR:", m.text().slice(0, 400)); });
const cfg = fs.readFileSync(CFGP, "utf8").replace("https://rpc.xlayer.tech", ANVIL).replace(/v4: \{[^}]*\}/, `v4: {passkeys: "${PK}", agreements: "${AG}", cases: "${CS}"}`);
await page.setRequestInterception(true);
page.on("request", r => { if (r.url().endsWith("/config.js")) r.respond({ status: 200, contentType: "application/javascript", body: cfg }); else r.continue(); });
await page.evaluateOnNewDocument(ANVIL => { window.ethereum = { request: async ({ method, params }) => {
  if (method === "eth_requestAccounts" || method === "eth_accounts") return [localStorage.getItem("acct")];
  if (method === "eth_chainId") return "0xc4"; if (method === "wallet_switchEthereumChain") return null;
  if (method === "eth_sendTransaction") { const r = await (await fetch(ANVIL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [{ ...params[0], gas: "0x2000000" }] }) })).json(); if (r.error) { console.error("TX REJECTED", JSON.stringify(r.error)); throw new Error(r.error.message); } return r.result; }
  throw new Error("unsupported " + method); } }; }, ANVIL);
const cdp = await page.target().createCDPSession(); await cdp.send("WebAuthn.enable");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
const TEST = "Test environment: a fork of X Layer, test wallets, a virtual passkey";
const as = async (addr, hash) => { if (!page.url().startsWith("http://localhost:8090")) await page.goto(BASE); await page.evaluate((a, r) => { localStorage.setItem("acct", a); localStorage.setItem("lgtie.inboxRelays", JSON.stringify(r)); }, addr, RELAYS).catch(() => {}); await page.goto(BASE + "?" + Date.now() + hash); await sleep(900); await label(page, TEST, true); };
// change role and page without reloading (so nothing flashes on camera)
const hashNav = async (addr, hash) => { await page.evaluate((a, h) => { localStorage.setItem("acct", a); location.hash = h; }, addr, hash); await sleep(220); await restoreCursor(page); };
const T = sel => page.$eval(sel, e => e.innerText).catch(() => "");
const until = async (fn, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(200); } return false; };
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

// ----- scene "nowallet": Maya answers with her fingerprint, Acme's inbox, evidence, the optional helper -----
const ROLE = r => label(page, r + " (test environment)", true);
const ansClick = async (i, v, ms = 450) => { const g = (await page.$$("#cs .qs .yn"))[i]; const b = await g.$(`button[data-v="${v}"]`); await b.evaluate(e => { const r = e.getBoundingClientRect(); if (r.top < 90 || r.bottom > innerHeight - 40) e.scrollIntoView({ block: "center", behavior: "instant" }); }); const r = await b.boundingBox(); await moveTo(page, r.x + r.width / 2, r.y + r.height / 2, ms); await sleep(110); await b.click({ delay: 70 }); await sleep(150); };
if (want("nowallet")) {
  await as("", "#mine"); await click("#find"); need(await until(async () => !!(await page.$('[data-act="answer"]'))), "answer form");
  await page.evaluate(() => scrollTo(0, 0)); await sleep(500); await ROLE("Maya's phone: My cases"); await moveTo(page, 683, 420, 10);
  await scene(page, "nowallet", tl, async ({ at, beat, S }) => {
    await at(0.2); await titleCard(page, "2 &middot; Maya, without a wallet", "She answers with her fingerprint", 2000);
    await beat(0, 0.3); await callout(page, "#find", "<b>No wallet.</b> No seed phrase. Nothing to install.", { side: "b", ms: 2300, scroll: false, maxW: 340 }); await pointAt(page, "#find", 1000, 0, 0.5, 0.5);
    await beat(1, 0.0); await scrollToEl(page, "#cs h3", 900, 0, 0.16); await callout(page, "#cs h3", "<b>Maya's case</b>: the same seven questions", { side: "r", ms: 2400, scroll: false, maxW: 330 });
    for (let i = 0; i < 7; i++) await ansClick(i, i === 4 ? 0 : 1, 420);
    await callout(page, "#cs .qs .yn", "<b>Here she says No.</b> Acme said Yes.", { side: "r", ms: 2200, nth: 4, maxW: 280 }); await sleep(1500);
    await beat(2, 0.0); await scrollToEl(page, '[data-act="answer"]', 900, 0, 0.5); await callout(page, '[data-act="answer"]', "She signs with her <b>fingerprint or face</b>", { side: "r", ms: 1800, scroll: false, maxW: 300 }); await pointAt(page, '[data-act="answer"]', 900);
    await sleep(900); await (await page.$('[data-act="answer"]')).click({ delay: 90 }); await deviceSheet(page, 3200); await sleep(3300);
    await dead(() => until(async () => /Sent to the other side's inbox/.test(await T("#inboxst")), 15000));
    await beat(3, 0.0); await spot(page, "#packbox", 3400, { pad: 8 }); await callout(page, "#packbox", "<b>Signed.</b> These exact answers can no longer be changed", { side: "t", ms: 3400, maxW: 360 });
    await beat(4, 0.1); await callout(page, "#packbox", "<b>Not on the blockchain yet</b>", { side: "b", ms: 1700, scroll: false, maxW: 300 });
    await beat(5, 0.1); await callout(page, "#inboxst", "Sent to <b>Acme's inbox</b>", { side: "b", ms: 1700, scroll: false, maxW: 300 });
    await beat(6, -0.4); await navFade(page, async () => { await hashNav(BUSINESS, "#inbox"); await ROLE("Acme's side: Inbox"); await moveTo(page, 683, 420, 10); });
    await callout(page, "#ibc", "<b>Acme</b> connects its wallet", { side: "b", ms: 1800, scroll: false, maxW: 300 }); await clickOn(page, "#ibc", 900);
    await dead(() => until(async () => !!(await page.$("[data-go]")), 15000));
    await beat(6, 1.8); await spot(page, ".card[data-k]", 2700, { pad: 10 }); await callout(page, ".card[data-k]", "<b>Maya's signed answers</b>, waiting", { side: "t", ms: 2700, maxW: 320 });
    await beat(7, 0.0); await callout(page, "[data-go]", "One click. <b>Acme pays</b> the tiny network fee, not Maya", { side: "b", ms: 3300, scroll: false, maxW: 340 }); await pointAt(page, "[data-go]", 900);
    await beat(7, 2.4); await clickOn(page, "[data-go]", 500); await sleep(700);
    await beat(8, -0.3); await navFade(page, async () => { await hashNav("", "#mine"); await ROLE("Maya's phone: My cases"); await moveTo(page, 683, 420, 10); });
    await clickOn(page, "#find", 700); await dead(() => until(async () => !!(await page.$('[data-act="evidence"]')), 15000));
    await callout(page, '[data-act="evidence"]', "She can add <b>evidence</b> too", { side: "l", ms: 1900, maxW: 280 });
    await beat(9, 0.0); await clickOn(page, '[data-act="evidence"]', 800); await (await page.$("#evf")).uploadFile("/tmp/lgtie-video-photo.txt");
    await callout(page, "#evdrop", "A photo of her receipt. It <b>stays on her device</b>.", { side: "r", ms: 2600, maxW: 300 });
    await typeIn(page, "#evn", "Photo of the receipt", 55); await callout(page, "#evn", "A short public note", { side: "b", ms: 1500, scroll: false, maxW: 260 });
    await clickOn(page, "#evgo", 700); await dead(() => until(async () => /Sent to the other side's inbox/.test(await T("#inboxst")), 15000));
    await callout(page, "#packbox", "Only a <b>fingerprint</b> is recorded. Nothing is uploaded.", { side: "t", ms: 3000, maxW: 340 });
    await beat(10, -0.3); await navFade(page, async () => { await hashNav("", "#for-business"); await ROLE("Acme's page"); await moveTo(page, 683, 420, 10); });
    await beat(10, 1.2); await spot(page, ".paths .path", 3300, { nth: 5, pad: 10 }); await callout(page, ".paths .path", "Optional: a helper that <b>pings Slack</b> and submits for Acme", { side: "b", ms: 3300, nth: 5, maxW: 330 }); await pointAt(page, ".paths .path", 1100, 5, 0.5, 0.5);
  });
}

// ----- scene "reviewer": side A and side B, written reasons, the decision -----
if (want("reviewer")) {
  if (!want("nowallet")) {   // the case needs Maya's answers in; do it off camera
    await as("", "#mine"); await click("#find"); need(await until(async () => !!(await page.$('[data-act="answer"]'))), "answer form");
    await page.evaluate(() => document.querySelectorAll("#cs .qs .yn").forEach((g, i) => g.querySelector(`button[data-v="${i === 4 ? 0 : 1}"]`).click())); await click('[data-act="answer"]');
    need(await until(async () => /Sent to the other side's inbox/.test(await T("#inboxst"))), "answers sent");
    await as(BUSINESS, "#inbox"); await click("#ibc").catch(() => {}); need(await until(async () => !!(await page.$("[data-go]"))), "answers in inbox"); await click("[data-go]"); need(await until(async () => /Submitted/.test(await T("#ibs"))), "answers submitted");
  }
  await as(REVIEWER, "#pk/case/1/decide"); need(await until(async () => !!(await page.$("#rv-one")), 25000), "decision form"); await page.evaluate(() => scrollTo(0, 0)); await sleep(500); await ROLE("Neutral reviewer: decision"); await moveTo(page, 683, 420, 10);
  await scene(page, "reviewer", tl, async ({ at, beat, S }) => {
    await at(0.2); await titleCard(page, "3 &middot; The neutral reviewer", "Decides only what they disagree on", 2000);
    await beat(0, 0.3); await spot(page, ".card thead", 3800, { pad: 8, scroll: false }); await callout(page, ".card thead", "<b>Side A</b> and <b>Side B</b>. No names, to reduce bias.", { side: "b", ms: 3800, scroll: false, maxW: 380 }); await pointAt(page, ".card thead th:nth-child(2)", 1200, 0, 0.5, 0.5);
    await beat(1, -0.6); await scrollToEl(page, "#ans", 1000, 0, 0.12);
    await beat(1, 0.5); await clickOn(page, '#ans .yn button[data-v="1"]', 800); await callout(page, '#ans .yn button[data-v="1"]', "The reviewer answers <b>only the disputed question</b>", { side: "r", ms: 2200, scroll: false, maxW: 330 });
    await beat(1, 2.2); await callout(page, ".rvfields h4", "<b>Reasons are required</b>", { side: "r", ms: 2200, scroll: false, maxW: 260 }); await typeIn(page, "#rv-one", "Report shows no excluded cause", 36);
    await clickOn(page, "#rv-full", 600); await page.type("#rv-full", "No excluded cause appears in the report.", { delay: 12 });
    await callout(page, "#rv-coi", "And a declaration of <b>no conflict of interest</b>", { side: "t", ms: 2000, scroll: false, maxW: 320 }); await clickOn(page, "#rv-coi", 600); await clickOn(page, "#send", 600);
    await dead(() => until(async () => /Decided/.test(await T("main")), 40000)); await sleep(400);
    await beat(2, 0.0); await page.evaluate(() => { const r = document.querySelector(".res"); r && r.scrollIntoView({ block: "center", behavior: "smooth" }); }); await sleep(1100); await spot(page, ".res", 3600, { pad: 10, scroll: false }); await callout(page, ".res", "The <b>reviewer's reason</b> is shown with the result", { side: "t", ms: 3600, scroll: false, maxW: 340 });
  });
}
await browser.close(); await relay.close();
