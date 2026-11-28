// Rules history: the page for a rule set's versions, read from the real registry on X Layer (read-only). A multi-version chain, a replacement and a forged
// replacement are covered by publish.mjs on a fork; this checks the real page, its links from the rest of the site, and Chinese.
// Needs the site on http://localhost:8090 and puppeteer-core.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:8090/index.html";
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : " " + (x ?? ""))); };
const w = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), errs = [];
async function page(lang) {
  const p = await b.newPage(); await p.setViewport({width: 1280, height: 1000}); p.on("pageerror", e => errs.push(lang + ": " + e.message));
  await p.evaluateOnNewDocument(l => { try { localStorage.setItem("lgtie.lang", l); } catch (e) {} }, lang); return p;
}
const T = (p, sel) => p.$eval(sel, e => e.innerText).catch(() => "");
const until = async (f, ms = 50000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f().catch(() => false)) return true; await w(300); } return false; };

const e = await page("en");
await e.goto(BASE + "#rules");
ok("the index lists the published rule sets with a link to each one's history", await until(async () => /Published rule sets/.test(await T(e, "main")) && /#1 Warranty claims/.test(await T(e, "main")) && (await e.$$('a[href="#rules/1"]')).length >= 1), (await T(e, "main")).slice(0, 300));
ok("and says every rule set is permanent and agreements keep the version they accepted", /permanent/.test(await T(e, "main")) && /agreements keep the version they accepted/.test(await T(e, "main")));

await e.goto(BASE + "#rules/1");
ok("the page for rule set #1 shows its single version, newest, with where you are", await until(async () => /1 version published by/.test(await T(e, "main")) && /Version 1 · rule set #1/.test(await T(e, "#v1")) && /Newest/.test(await T(e, "#v1")) && /You are here/.test(await T(e, "#v1"))), (await T(e, "main")).slice(0, 300));
ok("it shows the publisher, the date, the circuit and the rules fingerprint the registry records", /0x0ae1…8fd5/.test(await T(e, "#v1")) && /#13 on X Layer/.test(await T(e, "#v1")) && /0x8405bd9c448d70732a3f16a36d918e084177811f84b0bf32f5b38c6c818b411c/.test(await T(e, "#v1")) && /(Nov|Dec) \d+, 2026/.test(await T(e, "#v1")), await T(e, "#v1"));
ok("the first version says it replaces nothing and nothing has replaced it yet", /nothing: the first version/.test(await T(e, "#v1")) && /nothing yet/.test(await T(e, "#v1")));
ok("it states that agreements keep the version they accepted and that the chain cannot be forged", /Agreements keep the version they accepted/.test(await T(e, "main")) && /A newer version never changes it/.test(await T(e, "main")) && /cannot be forged by someone else/.test(await T(e, "main")));
ok("it counts the real agreements and cases that use this version (wallet and passkey)", await until(async () => { const m = /(\d+) agreements? and (\d+) cases? use this version/.exec(await T(e, "#v1")); return !!m && Number(m[1]) >= 2 && Number(m[2]) >= 4; }), await T(e, "#v1"));
ok("it links to the checker for the rules it knows", await e.$eval('#v1 a[href^="#check/"]', a => a.getAttribute("href")) === "#check/warranty");
ok("it links to the automatic questions of each version", await e.$eval('#v1 a[href^="#auto/"]', a => a.getAttribute("href")) === "#auto/1");
ok("the fingerprint shown is the one the checker computes for the published warranty rules", await e.evaluate(async () => { const c = TB.canonical(TB.parse(TB.TEMPLATES.warranty).policy), h = "0x" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(c)))].map(x => x.toString(16).padStart(2, "0")).join(""); return document.querySelector("#v1").innerText.includes(h); }));

// links from the rest of the site
await e.goto(BASE + "#agreement/1");
ok("the agreement page links its rule set to the history", await until(async () => !!(await e.$('a[href="#rules/1"]'))) && /\(rules #1\)/.test(await T(e, "main")));
await e.$eval('a[href="#rules/1"]', a => { a.scrollIntoView({block: "center", behavior: "instant"}); a.click(); }); await w(600);
ok("and the link opens it", (await e.evaluate(() => location.hash)) === "#rules/1");
await e.goto(BASE + "#pk/agreement/1");
ok("the passkey agreement page links to it too", await until(async () => !!(await e.$('a[href="#rules/1"]'))));
await e.goto(BASE + "#business/0x0ae117c07a277d74d9326eb4e33013439dc68fd5");
ok("the business record links each rule set to its history", await until(async () => !!(await e.$('a[href="#rules/1"]'))));
await e.goto(BASE + "#check/warranty"); await w(1500);
for (let i = 0; i < 7; i++) { const g = (await e.$$(".yn"))[i], btn = await g.$('button[data-v="1"]'); await btn.evaluate(x => x.scrollIntoView({block: "center", behavior: "instant"})); await w(100); await btn.click(); }
await e.evaluate(() => { const d = [...document.querySelectorAll("details")].find(x => /Check this result yourself/.test(x.innerText)); if (d) d.open = true; });
ok("the published checker page links to the version history", await until(async () => !!(await e.$('details a[href="#rules/1"]'))), "no link");
ok("the footer links to the published rule sets", (await e.$$eval(".fcols a", as => as.map(a => a.getAttribute("href")))).includes("#rules"));
await e.goto(BASE + "#rules/99999");
ok("a rule set that does not exist is explained, with a way back", await until(async () => /doesn't exist/.test(await T(e, "main")) && !!(await e.$('main a[href="#rules"]'))), await T(e, "main"));

// Chinese
const z = await page("zh");
await z.goto(BASE + "#rules/1");
ok("in Chinese the history page is translated", await until(async () => /规则历史/.test(await T(z, "main")) && /版本 1 · 规则集 #1/.test(await T(z, "#v1")) && /最新/.test(await T(z, "#v1")) && /当前位置/.test(await T(z, "#v1"))), (await T(z, "main")).slice(0, 300));
ok("and its table, notes and counts are in Chinese", /发布者/.test(await T(z, "#v1")) && /无：这是首个版本/.test(await T(z, "#v1")) && /协议沿用它们当初接受的版本/.test(await T(z, "main")) && await until(async () => /\d+\s*份协议和\s*\d+\s*个案件使用这个版本/.test(await T(z, "#v1"))), await T(z, "#v1"));
await z.goto(BASE + "#rules");
ok("and the index too", await until(async () => /已发布的规则集/.test(await T(z, "main")) && /首个版本/.test(await T(z, "main")) && /历史/.test(await T(z, "main"))), (await T(z, "main")).slice(0, 300));

ok("no page errors", errs.length === 0, errs.join(" | "));
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
