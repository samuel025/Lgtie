// Languages: Chinese is the default, English is one click away, the choice is remembered, and dynamic text (results, dates, numbers, placeholders) is translated.
// Reads X Layer mainnet (read-only) for the real case #1. Needs the site on http://localhost:8090 and puppeteer-core.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:8090/index.html";
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : " " + (x ?? ""))); };
const w = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), p = await b.newPage(); await p.setViewport({width: 1280, height: 900});
const errs = []; p.on("pageerror", e => errs.push(e.message));
const T = sel => p.$eval(sel, e => e.innerText).catch(() => "");
const until = async (f, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await f().catch(() => false)) return true; await w(250); } return false; };
const CJK = /[一-鿿]/;

await p.goto(BASE); await w(1500);   // a fresh browser profile: nothing stored
ok("the default language is Chinese", await p.evaluate(() => document.documentElement.lang) === "zh-CN");
ok("the headline is in Chinese", /用人人都能先看到的规则/.test(await T("h1")), await T("h1"));
ok("the navigation is in Chinese", /运作方式/.test(await T("#nav")) && /我的案件/.test(await T("#nav")), await T("#nav"));
ok("the page title is in Chinese", CJK.test(await p.title()), await p.title());
ok("the language switch is there, with 中文 selected", await p.$$eval(".langsw button", bs => bs.map(x => x.textContent + ":" + x.getAttribute("aria-pressed")).join(",")) === "中文:true,EN:false");

// the checker: a result and its reason change language too
await p.goto(BASE + "#check/warranty"); await w(1500);
ok("the checker's questions are in Chinese", /产品是否已登记/.test(await T("main")), (await T("main")).slice(0, 200));
for (const g of await p.$$(".yn")) { const y = await g.$('button[data-v="1"]'); if (y) await y.click(); }
ok("a result appears in Chinese after answering", await until(async () => /予以保修/.test(await T("main")) || /保修的所有条件均已满足/.test(await T("main"))), (await T("main")).slice(-300));
ok("the counter uses a Chinese pattern", /已回答 7 \/ 7 题/.test(await T("main")), (await T("main")).match(/已回答[^\n]*/)?.[0]);

// a real case read from X Layer: statuses, numbers and dates
await p.goto(BASE + "#case/1");
ok("the case title and status are translated", await until(async () => /案件 #1：保修理赔/.test(await T("main")) && /已裁决/.test(await T("main"))), (await T("main")).slice(0, 200));
ok("the table headings are translated", /发起案件的一方/.test(await T("main")) && /有争议/.test(await T("main")));
await p.goto(BASE + "#agreement/1");
ok("agreement dates use the Chinese format", await until(async () => /自 \d{4}年\d{1,2}月\d{1,2}日.*起生效/.test(await T("main"))), (await T("main")).match(/In force[^\n]*|自[^\n]*/)?.[0]);
ok("and its time limits read in Chinese", /7 天作答，之后 7 天供审核人裁决/.test(await T("main")), (await T("main")).match(/[^\n]*作答[^\n]*/)?.[0]);
await p.goto(BASE + "#agree"); await w(1500);
ok("form placeholders are translated", (await p.$$eval("textarea", ts => ts.map(t => t.placeholder))).some(x => /粘贴协议文本/.test(x)));

// the switch: English, remembered, and back
await p.click('.langsw button[lang="en"]'); await w(1500);
ok("switching to English reloads in English", await p.evaluate(() => document.documentElement.lang) === "en" && /Agree on the rules/.test(await T("h1")), await T("h1"));
ok("the choice is remembered on this device", await p.evaluate(() => localStorage.getItem("lgtie.lang")) === "en");
await p.reload(); await w(1200);
ok("and survives a reload", /Agree on the rules before there is a dispute/.test(await T("h1")), await T("h1"));
ok("English pages contain no Chinese", !CJK.test(await T("main")));
await p.goto(BASE + "?lang=zh#about"); await w(1500);
ok("?lang=zh switches back and keeps the page", /运作方式/.test(await T("main")) || /运作方式/.test(await T("h1")), await T("h1"));
await p.click('.langsw button[lang="en"]'); await w(1200); await p.click('.langsw button[lang="zh"]'); await w(1500);
ok("the 中文 button switches back to Chinese", await p.evaluate(() => document.documentElement.lang) === "zh-CN");
ok("no page errors", errs.length === 0, errs.join(" | "));
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
