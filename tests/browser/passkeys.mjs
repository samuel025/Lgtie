// End to end: a customer with NO wallet settles a dispute with a passkey. Real pages, a Chrome virtual authenticator for the passkey, simulated wallets
// for the business, the relayer and the reviewer, and PasskeyRegistry + AgreementRegistryV2 + TiebreakCaseV4 deployed on a fork of X Layer (anvil on 8547).
// Needs: anvil forking X Layer on 127.0.0.1:8547, `forge`, Chrome, and the site served at http://localhost:8090.
import puppeteer from "puppeteer-core"; import fs from "node:fs"; import crypto from "node:crypto"; import {execFileSync} from "node:child_process";
const BASE = "http://localhost:8090/index.html", ANVIL = "http://127.0.0.1:8547", CFGP = "/home/samuel/Documents/tiebreak/site/config.js", REG = "0x25E87D367316038a2d3B6A4fe3d58AA453D4c219", PROC = "0x9e2849c04a513fe64db07521cbe52d078d905c0e";
const BUSINESS = "0x7e57000000000000000000000000000000000d01", REVIEWER = "0x7e57000000000000000000000000000000000e01", RELAYER = "0x7e57000000000000000000000000000000000c01", DEPLOYER = "0x7e57000000000000000000000000000000000dd1";
const arpc = async (m, p) => { const r = await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method: m, params: p})})).json(); if (r.error) throw new Error(JSON.stringify(r.error)); return r.result; };
for (const a of [BUSINESS, REVIEWER, RELAYER, DEPLOYER]) { await arpc("anvil_setBalance", [a, "0x56bc75e2d63100000"]); await arpc("anvil_impersonateAccount", [a]); }
const forge = args => execFileSync("forge", args, {cwd: "/home/samuel/Documents/tiebreak/contracts", encoding: "utf8"});
const create = (name, ...args) => /Deployed to: (0x[0-9a-fA-F]{40})/.exec(forge(["create", name, "--rpc-url", ANVIL, "--unlocked", "--from", DEPLOYER, "--broadcast", ...(args.length ? ["--constructor-args", ...args] : [])]))[1];
// USE_DEPLOYED=1 runs the same story against the contracts already deployed on mainnet (they exist on the fork); otherwise it deploys fresh copies.
const dep = process.env.USE_DEPLOYED ? /v4: \{passkeys: "(0x[0-9a-fA-F]{40})", agreements: "(0x[0-9a-fA-F]{40})", cases: "(0x[0-9a-fA-F]{40})"/.exec(fs.readFileSync(CFGP, "utf8")) : null;
const PK = dep ? dep[1] : create("src/PasskeyRegistry.sol:PasskeyRegistry"), AG = dep ? dep[2] : create("src/AgreementRegistryV2.sol:AgreementRegistryV2", REG, PK), CS = dep ? dep[3] : create("src/TiebreakCaseV4.sol:TiebreakCaseV4", REG, AG, PK, PROC);
console.log("PasskeyRegistry", PK, "| AgreementRegistryV2", AG, "| TiebreakCaseV4", CS, "on the fork");
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), p = await b.newPage();
const errs = []; p.on("pageerror", e => errs.push("pageerror: " + e.message));
let fails = 0; const ok = (n, c, x = "") => { console.log((c ? "ok   " : "FAIL ") + n + (c ? "" : " " + String(x).slice(0, 400))); if (!c) fails++; };
const T = sel => p.$eval(sel, e => e.innerText).catch(() => ""), w = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 30000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await w(300); } return false; }
const cfg = fs.readFileSync(CFGP, "utf8").replace("https://rpc.xlayer.tech", ANVIL).replace(/v4: \{[^}]*\}/, `v4: {passkeys: "${PK}", agreements: "${AG}", cases: "${CS}"}`);
await p.setRequestInterception(true);
p.on("request", r => { if (r.url().endsWith("/config.js")) r.respond({status: 200, contentType: "application/javascript", body: cfg}); else r.continue(); });
await p.evaluateOnNewDocument(ANVIL => { window.ethereum = {request: async ({method, params}) => {
  if (method === "eth_requestAccounts" || method === "eth_accounts") return [localStorage.getItem("acct")];
  if (method === "eth_chainId") return "0xc4"; if (method === "wallet_switchEthereumChain") return null;
  if (method === "eth_sendTransaction") { const r = await (await fetch(ANVIL, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params: [{...params[0], gas: "0x2000000"}]})})).json(); if (r.error) throw new Error(r.error.message); return r.result; }
  throw new Error("unsupported " + method); }}; }, ANVIL);
const cdp = await p.target().createCDPSession(); await cdp.send("WebAuthn.enable");
const authn = async () => (await cdp.send("WebAuthn.addVirtualAuthenticator", {options: {protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true}})).authenticatorId;
const mayaDevice = await authn();
const as = async (addr, hash) => { await p.evaluate(a => localStorage.setItem("acct", a), addr).catch(() => {}); await p.goto(BASE + "?" + Date.now() + hash); await w(900); };
const clickText = (sel, text) => p.evaluate((s, t) => { const b = [...document.querySelectorAll(s)].find(x => x.textContent.trim().startsWith(t)); if (!b) return false; b.click(); return true; }, sel, text);
await p.goto(BASE); await p.evaluate(() => localStorage.setItem("acct", ""));
const answers = async (noIdx) => p.evaluate(n => document.querySelectorAll("#ans .yn, .card .qs .yn").forEach((g, i) => g.querySelector(`button[data-v="${(g.dataset.i ?? i) == n ? 0 : 1}"]`).click()), noIdx ?? -1);

// ---- 1. Maya creates a passkey and gets a claim code. No wallet is involved.
await as("", "#join"); await p.click("#mk");
ok("Maya gets a claim code after creating a passkey", await until(async () => /^lgtie1\./.test(await p.$eval("#claim", e => e.value).catch(() => ""))), await T("main"));
const claim = await p.$eval("#claim", e => e.value);
ok("the page shows a short read-back code for a phone or chat check", /Read-back code/.test(await T("main")));

// ---- 2. The business registers her passkey and proposes an agreement.
await as(BUSINESS, "#pk/agree"); await p.type("#cc", claim); await p.type("#rv", REVIEWER); await p.type("#terms", "Acme Laptops sales terms v1");
await p.click("#go");
ok("the business registers the customer and lands on the agreement", await until(async () => /^#pk\/agreement\/1$/.test(await p.evaluate(() => location.hash))), await T("#msg"));
await w(800);
ok("the agreement shows a passkey customer and waits for her", /passkey account #1/.test(await T("main")) && /waiting for the customer/i.test(await T("main")), await T("main"));

// ---- 3. Maya finds her agreement with her passkey, and the page proves the account is hers.
await as("", "#mine"); await p.click("#find");
ok("the page confirms her passkey controls the account", await until(async () => /Account #1 is controlled by your passkey/.test(await T("#fm"))), await T("#fm"));
ok("she sees the agreement waiting for her", await until(async () => /Agreement #1/.test(await T("#ags"))) && !!(await p.$('[data-act="accept"]')), await T("#list"));
await p.click('[data-act="accept"]');
ok("she signs the acceptance and gets a link to send", await until(async () => !!(await p.$("#cplink"))), await T("#ags"));
const acceptLink = await p.$eval("#cplink", e => e.dataset.link);
ok("the link is a relay pack, not a secret", /#relay\/[A-Za-z0-9_-]+$/.test(acceptLink));

// ---- 4. Somebody with a wallet submits it. It costs her nothing.
await as(RELAYER, "#relay/" + acceptLink.split("#relay/")[1]);
ok("the relayer sees what would happen and that it would succeed", await until(async () => /would succeed/.test(await T("#sim"))), await T("#sim"));
await p.click("#go");
ok("the relayer submits it", await until(async () => /Submitted/.test(await T("#done"))), await T("#rm") + await T("#done"));
await as(BUSINESS, "#pk/agreement/1");
ok("the agreement is now in force", /In force since/.test(await T("main")), await T("main"));
await p.click("#acts button"); // open a dispute under the agreement
ok("the business opens a case under it", await until(async () => /^#pk\/case\/1$/.test(await p.evaluate(() => location.hash))), await T("#amsg"));
await w(800);

// ---- 5. Both sides answer. The business uses its wallet; Maya signs.
ok("the case page shows the passkey customer as a side", /passkey account #1/.test(await T("main")));
await clickText("#wacts button", "Answer as a wallet party"); await w(300); await answers(-1); await p.click("#send");
ok("the business's answers are recorded", await until(async () => /Waiting for answers/.test(await T("main")) && /Yes/.test(await T("tbody"))), await T("main"));
await as("", "#mine"); await p.click("#find"); await until(async () => /controlled by your passkey/.test(await T("#fm")));
await until(async () => !!(await p.$('[data-act="answer"]')));
await p.evaluate(() => document.querySelectorAll("#cs .qs .yn").forEach((g, i) => g.querySelector(`button[data-v="${i === 4 ? 0 : 1}"]`).click()));
await p.click('[data-act="answer"]');
ok("she signs her answers (a different one on question 5) and gets a link", await until(async () => !!(await p.$("#cs #cplink"))), await T("#cs"));
const answerLink = await p.$eval("#cs #cplink", e => e.dataset.link);

// ---- 6. Attacks on the relay link before anyone submits it.
const pack = answerLink.split("#relay/")[1], obj = JSON.parse(Buffer.from(pack.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
const b64u = o => Buffer.from(JSON.stringify(o)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
await as(RELAYER, "#relay/" + b64u({...obj, to: "0x000000000000000000000000000000000000dEaD"}));
ok("a link pointing at some other contract is refused", /will not be sent/.test(await T("main")), await T("main"));
await as(RELAYER, "#relay/" + b64u({...obj, chainId: 1}));
ok("a link for another chain is refused", /will not be sent/.test(await T("main")), await T("main"));
const ansAt = 2 + 8 + 64 + 64 + 62, flipped = obj.data.slice(0, ansAt) + (parseInt(obj.data.slice(ansAt, ansAt + 2), 16) ^ 1).toString(16).padStart(2, "0") + obj.data.slice(ansAt + 2);   // change the signed answers word
await as(RELAYER, "#relay/" + b64u({...obj, data: flipped}));
ok("a link whose signed answers were altered is shown as failing", await until(async () => /would fail/.test(await T("#sim"))), await T("#sim"));

// ---- 7. The real submission; the case goes to the reviewer because question 5 differs.
await as(RELAYER, "#relay/" + pack); await until(async () => /would succeed/.test(await T("#sim"))); await p.click("#go");
ok("the relayer submits her signed answers", await until(async () => /Submitted/.test(await T("#done"))), await T("#rm") + await T("#done"));
await as(RELAYER, "#relay/" + pack);
ok("submitting the same signed answers again fails (no replay)", await until(async () => /would fail/.test(await T("#sim"))), await T("#sim"));
await as(REVIEWER, "#pk/cases"); ok("the passkey list page links to the agreement and the case", await until(async () => !!(await p.$('a[href="#pk/case/1"]')) && !!(await p.$('a[href="#pk/agreement/1"]'))), await T("main"));
await as(REVIEWER, "#case"); ok("the normal case page points to the passkey list", !!(await p.$('a[href="#pk/cases"]')));
await as(REVIEWER, "#pk/case/1");
ok("the case now waits for the reviewer and question 5 is disputed", /Waiting for the reviewer/.test(await T("main")) && /Disputed/.test(await T("tbody")), await T("main"));
await clickText("#wacts button", "I am the reviewer: decide"); await w(1500);
ok("the reviewer sees Side A and Side B instead of the parties", /names are hidden/.test(await T("main")) && /Side A opened the case/.test(await T("main")) && !(await p.$$eval("main tbody th, main .small", e => e.some(x => /Opened by/.test(x.innerText)))), await T("main"));
ok("the decision form opened by itself after connecting", !!(await p.$("#rv-one")));
await p.evaluate(() => document.querySelectorAll("#ans .yn").forEach(g => g.querySelector('button[data-v="1"]').click())); await p.click("#send");
ok("a decision without reasons is refused", await until(async () => /one-line reason/.test(await T("#cmsg"))), await T("#cmsg"));
await p.type("#rv-one", "Report shows no excluded cause"); await p.type("#rv-full", "The repair centre report shows no excluded cause, so I answered yes to the disputed question. I could not verify who wrote the report."); await p.click("#send");
ok("a decision without the conflict declaration is refused", await until(async () => /conflict of interest/.test(await T("#cmsg"))), await T("#cmsg"));
await p.click("#rv-coi"); await p.click("#send");
ok("the reviewer decides only the disputed question and the real circuit gives the result", await until(async () => /Covered/.test(await T(".res .big"))), await T("main"));

ok("the reviewer's reason is recorded on the passkey case page", await until(async () => /Report shows no excluded cause/.test(await T("#rvreasons")) && /Reviewer's reason/.test(await T(".res"))), await T("main"));
const stHref = await p.$eval("#stmtdl", a => a.href).catch(() => ""), stText = decodeURIComponent(stHref.split(",").slice(1).join(",")), stHash = "0x" + crypto.createHash("sha256").update(stText, "utf8").digest("hex");
ok("the recorded fingerprint is the SHA-256 of the reviewer's statement", /LGTIE REVIEWER STATEMENT/.test(stText) && (await T("#rvreasons")).includes(stHash.slice(0, 18)), stHash + " " + await T("#rvreasons"));
// ---- 8. The other attacks, with a second customer ("Sam") on a new device.
await cdp.send("WebAuthn.removeVirtualAuthenticator", {authenticatorId: mayaDevice}); await authn();
await p.evaluate(() => localStorage.removeItem("lgtie.passkey"));
await as("", "#join"); await p.click("#mk");
await until(async () => /^lgtie1\./.test(await p.$eval("#claim", e => e.value).catch(() => "")));
const claim2 = await p.$eval("#claim", e => e.value);
await as("", "#mine"); await p.click("#find");
ok("a passkey nobody has registered finds no account", await until(async () => /No account is registered for this passkey/.test(await T("#list"))), await T("#fm") + await T("#list"));
const parsed = JSON.parse(Buffer.from(claim2.slice(7).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
const ev = crypto.generateKeyPairSync("ec", {namedCurve: "prime256v1"}).publicKey.export({format: "jwk"}), hx = s => "0x" + Buffer.from(s, "base64url").toString("hex");
const forged = "lgtie1." + b64u({x: hx(ev.x), y: hx(ev.y), rp: parsed.rp, h: parsed.h, id: "localhost"});   // Sam's handle, but someone else's key
await as(BUSINESS, "#pk/agree"); await p.type("#cc", forged); await p.type("#rv", REVIEWER); await p.click("#go");
ok("a dishonest business can register an account under Sam's handle with its own key (the chain cannot stop that)", await until(async () => /^#pk\/agreement\/2$/.test(await p.evaluate(() => location.hash))), await T("#msg"));
await as("", "#mine"); await p.click("#find");
ok("Sam's page warns him not to use that account, because his passkey does not control it", await until(async () => /Do not use this account/.test(await T("#list"))), await T("#fm") + await T("#list"));
await as(BUSINESS, "#pk/agree"); await p.type("#cc", claim2); await p.type("#rv", REVIEWER); await p.click("#go");
ok("registering Sam's real claim afterwards is refused, because the handle is taken by a different key", await until(async () => /already registered to a different key/.test(await T("#msg"))), await T("#msg"));
ok("no page errors", errs.length === 0, errs.join(" | "));
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
