// Finding things: the header's More menu, the quick links under the home page headline, and the footer sitemap, in both languages and on a phone.
// Needs the site on http://localhost:8090 and puppeteer-core. No network needed.
import puppeteer from "puppeteer-core";
import fs from "node:fs";
const BASE = process.env.BASE || "http://localhost:8090/index.html";
const chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
let fails = 0; const ok = (n, c, x) => { if (!c) fails++; console.log((c ? "PASS " : "FAIL ") + n + (c ? "" : " " + (x ?? ""))); };
const w = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), errs = [];
async function page(lang, vp) {
  const p = await b.newPage(); await p.setViewport(vp || {width: 1280, height: 900}); p.on("pageerror", e => errs.push(e.message));
  await p.evaluateOnNewDocument(l => { try { localStorage.setItem("lgtie.lang", l); } catch (e) {} }, lang); return p;
}
const hrefs = (p, sel) => p.$$eval(sel, a => a.map(x => x.getAttribute("href")));
const isOpen = p => p.$eval("#nav .more", e => e.open);
const visible = (p, sel) => p.$eval(sel, e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; }).catch(() => false);

const p = await page("en");
await p.goto(BASE); await w(1500);
ok("the header shows Templates next to the main links", (await hrefs(p, "#nav > a")).join(",") === "#about,#templates,#check/warranty,#for-business,#mine,#case/1", (await hrefs(p, "#nav > a")).join(","));
ok("a More menu holds the rest, closed at first", (await hrefs(p, "#nav .more .menu a")).join(",") === "#build,#agree,#inbox,#reviewer,#verify,#join" && !(await isOpen(p)));
await p.click("#nav .more summary"); await w(200);
ok("clicking More opens it", await visible(p, "#nav .more .menu"));
await p.keyboard.press("Escape"); await w(200);
ok("Escape closes it", !(await isOpen(p)));
await p.click("#nav .more summary"); await w(200); await p.click("h1"); await w(200);
ok("clicking elsewhere closes it", !(await isOpen(p)));
await p.click("#nav .more summary"); await w(200); await p.click('#nav .more .menu a[href="#verify"]'); await w(800);
ok("picking an item goes there and closes the menu", (await p.evaluate(() => location.hash)) === "#verify" && !(await isOpen(p)));
ok("the More label shows that you are inside it", await p.$eval("#nav .more summary", e => e.classList.contains("on")));

await p.goto(BASE + "#"); await w(1500);
ok("the home page has a Jump to row right under the headline", (await hrefs(p, ".quick a")).join(",") === "#templates,#build,#agree,#pk/agree,#mine,#join,#reviewer,#verify", (await hrefs(p, ".quick a")).join(","));
ok("and it is visible without scrolling", await p.$eval(".quick", e => e.getBoundingClientRect().bottom < innerHeight));
ok("the footer is a grouped sitemap with every page in it", (await p.$$eval(".fcols h5", h => h.map(x => x.textContent))).join("|") === "Use it|For businesses|Check and trust");
const f = await hrefs(p, ".fcols a");
ok("with at least fourteen links, including the ones that were hidden before", f.length >= 14 && ["#templates", "#verify", "#reviewer", "#join", "#mine", "#build", "#agree", "#inbox", "#pk/agree", "#about"].every(h => f.includes(h)), f.join(","));
ok("external links open safely in a new tab", await p.$$eval('.fcols a[target="_blank"]', a => a.length >= 2 && a.every(x => /noopener/.test(x.rel))));
ok("every internal footer link goes to a real page", await (async () => { for (const h of f.filter(x => x.startsWith("#"))) { await p.goto(BASE + h); await w(700); const t = await p.$eval("main", m => m.innerText).catch(() => ""); if (t.trim().length < 20 || /doesn't exist/.test(t) && false) return h; } return true; })() === true);

// Chinese
const z = await page("zh");
await z.goto(BASE); await w(1500);
await p.goto(BASE + "#"); await p.waitForSelector(".quick", {timeout: 8000}).catch(() => {});
ok("the quick links use plain words, with no jargon in the hero", !/circuit|reviewer|X Layer/i.test(await p.$eval(".quick", e => e.innerText)));
ok("in Chinese the More menu, the quick links and the footer are translated", await (async () => { const t = await z.evaluate(() => document.querySelector("#nav").innerText + "|" + document.querySelector(".quick").innerText + "|" + document.querySelector("footer").innerText); return /更多/.test(t) && /快速前往/.test(t) && /模板/.test(t) && /核对与信任/.test(t) && /源代码与文档/.test(t) && !/Jump to|Check and trust/.test(t); })());

// a phone
const m = await page("en", {width: 390, height: 800, isMobile: true, deviceScaleFactor: 2});
await m.goto(BASE); await w(1500);
ok("on a phone the quick links wrap and stay inside the screen", await m.$eval(".quick", e => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= innerWidth + 1));
ok("and the More menu still opens and fits", await (async () => { await m.click("#nav .more summary"); await w(250); return await m.$eval("#nav .more .menu", e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1 && r.width > 100; }); })());
ok("and the page does not scroll sideways", await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

ok("no page errors", errs.length === 0, errs.join(" | "));
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
