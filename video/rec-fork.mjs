// Records the two scenes that need a real customer and reviewer flow: "nowallet" and "reviewer". These run in the TEST ENVIRONMENT
// (a fork of X Layer on anvil :8547, test wallets, a Chrome virtual passkey, a local relay) and are labelled as such on screen.
// Every action is timed to the sentence it illustrates, at normal speed. Setup (agreement, case, business answers) happens off camera.
// Needs: anvil forking X Layer on 127.0.0.1:8547, forge, the site served at http://localhost:8090, puppeteer-core and ws installed.
import fs from "node:fs"; import { execFileSync } from "node:child_process";
import { launch, scene, timeline, dead, sleep, label, scrollTo, scrollToEl, clickOn, pointAt, moveTo, spot, typeIn, boxOf, restoreCursor } from "./lib.mjs";
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
const hashNav = async (addr, hash) => { await page.evaluate((a, h) => { localStorage.setItem("acct", a); location.hash = h; }, addr, hash); await sleep(500); await restoreCursor(page); };
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

// ----- scene "nowallet": the customer answers with a fingerprint, the inbox, evidence, the optional helper -----
if (want("nowallet")) {
  await as("", "#mine"); await click("#find"); need(await until(async () => !!(await page.$('[data-act="answer"]'))), "answer form");
  await page.evaluate(() => document.querySelectorAll("#cs .qs .yn").forEach((g, i) => g.querySelector(`button[data-v="${i === 4 ? 0 : 1}"]`).click()));   // her answers are chosen; the signing is on camera
  await page.evaluate(() => document.querySelector("#cs h3").scrollIntoView({ block: "start" })); await page.evaluate(() => scrollBy(0, -70)); await sleep(500); await moveTo(page, 560, 300, 10);
  await scene(page, "nowallet", tl, async ({ at, S }) => {
    await at(0.2); await spot(page, "#cs .card", 2400, { pad: 8, scroll: false }); await moveTo(page, 420, 190, 1300);                                 // Customers do not need a crypto wallet.
    await at(S[1].t0 + 0.1); await scrollToEl(page, '[data-act="answer"]', 1000, 0, 0.55); await clickOn(page, '[data-act="answer"]', 1000);   // They approve with the fingerprint or face scan...
    await dead(() => until(async () => /Sent to the other side's inbox/.test(await T("#inboxst")), 15000)); await spot(page, "#packbox", 1700, { pad: 8 });
    await at(S[2].t0 - 0.3); await hashNav(BUSINESS, "#inbox"); await clickOn(page, "#ibc", 600);                                                    // That lands in the business's inbox...
    await dead(() => until(async () => !!(await page.$("[data-go]")), 15000)); await spot(page, ".card[data-k]", 1600, { pad: 10 });
    await at(S[2].t0 + 1.9); await clickOn(page, "[data-go]", 600); await sleep(400);             // ... where one click submits it.
    await at(S[3].t0 - 0.2); await hashNav("", "#mine"); await clickOn(page, "#find", 550); await dead(() => until(async () => !!(await page.$('[data-act="evidence"]')), 15000));   // Evidence works the same way.
    await at(S[4].t0 - 0.2); await clickOn(page, '[data-act="evidence"]', 600); await (await page.$("#evf")).uploadFile("/tmp/lgtie-video-photo.txt");   // A photo, or a written note...
    await spot(page, ".evbox", 1800, { pad: 8 }); await typeIn(page, "#evn", "Photo of the receipt", 38); await clickOn(page, "#evgo", 500);
    await dead(() => until(async () => /Sent to the other side's inbox/.test(await T("#inboxst")), 15000)); await spot(page, "#packbox", 1400, { pad: 8 });
    await at(S[5].t0 - 0.3); await hashNav("", "#for-business"); await sleep(400); await spot(page, ".paths .path", 2200, { nth: 5, pad: 10 }); await pointAt(page, ".paths .path", 1100, 5, 0.5, 0.55);   // And an optional helper can ping Slack for you.
  });
}

// ----- scene "reviewer": side A and side B, written reasons, the decision -----
if (want("reviewer")) {
  if (!want("nowallet")) {   // the case needs the customer's answers in; do it off camera
    await as("", "#mine"); await click("#find"); need(await until(async () => !!(await page.$('[data-act="answer"]'))), "answer form");
    await page.evaluate(() => document.querySelectorAll("#cs .qs .yn").forEach((g, i) => g.querySelector(`button[data-v="${i === 4 ? 0 : 1}"]`).click())); await click('[data-act="answer"]');
    need(await until(async () => /Sent to the other side's inbox/.test(await T("#inboxst"))), "answers sent");
    await as(BUSINESS, "#inbox"); await click("#ibc").catch(() => {}); need(await until(async () => !!(await page.$("[data-go]"))), "answers in inbox"); await click("[data-go]"); need(await until(async () => /Submitted/.test(await T("#ibs"))), "answers submitted");
  }
  await as(REVIEWER, "#pk/case/1/decide"); need(await until(async () => !!(await page.$("#rv-one")), 25000), "decision form"); await page.evaluate(() => scrollTo(0, 0)); await sleep(500); await moveTo(page, 560, 300, 10);
  await scene(page, "reviewer", tl, async ({ at, S }) => {
    await at(0.2); await spot(page, ".card thead", 2800, { pad: 10, scroll: false }); await pointAt(page, ".card thead th:nth-child(2)", 1100, 0, 0.5, 0.5);    // side A and side B instead of names
    await at(2.1); await scrollToEl(page, "#ans", 900, 0, 0.12);
    await at(2.9); await clickOn(page, '#ans .yn button[data-v="1"]', 600);
    await at(3.7); await typeIn(page, "#rv-one", "Report shows no excluded cause", 30);                                                                 // ... has to write down their reasons
    await at(5.1); await clickOn(page, "#rv-full", 500); await page.type("#rv-full", "No excluded cause appears in the report.", { delay: 10 });
    await at(6.1); await clickOn(page, "#rv-coi", 500); await clickOn(page, "#send", 500);
    await dead(() => until(async () => /Decided/.test(await T("main")), 40000)); await sleep(500);
    await page.evaluate(() => { const r = document.querySelector(".res"); r && r.scrollIntoView({ block: "center", behavior: "smooth" }); }); await sleep(1100); await spot(page, ".res", 2000, { pad: 10, scroll: false });   // Those show on the case, and on the receipt.
  });
}
await browser.close(); await relay.close();
