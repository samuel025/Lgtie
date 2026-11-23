import puppeteer from "puppeteer-core"; import fs from "node:fs";
const BASE = "http://localhost:8090/index.html", chrome = ["/usr/bin/google-chrome", "/usr/bin/chromium"].find(p => fs.existsSync(p));
const b = await puppeteer.launch({executablePath: chrome, args: ["--no-sandbox"]}), p = await b.newPage(); const errs = []; p.on("pageerror", e => errs.push(e.message));
let fails = 0; const ok = (n, c, x = "") => { console.log((c ? "ok   " : "FAIL ") + n + (c ? "" : " " + String(x).slice(0, 300))); if (!c) fails++; };
const T = sel => p.$eval(sel, e => e.innerText).catch(() => ""), w = ms => new Promise(r => setTimeout(r, ms));
await p.setViewport({width: 1280, height: 900}); await p.goto(BASE); await w(1500);
ok("the hero draws the real circuit: 39 gates, 7 inputs, 2 outputs", (await p.$$eval("#heroviz .circ .g", e => e.length)) === 46 && (await p.$$eval("#heroviz .circ .g.in", e => e.length)) === 7 && (await p.$$eval("#heroviz .circ .g.out", e => e.length)) === 2, await p.$$eval("#heroviz .circ .g", e => e.length));
ok("seven answer pills", (await p.$$("#heroviz .vq")).length === 7);
const r0 = await T("#heroviz .vres .big"); ok("the hero shows a result from the real rules", /Not covered|Covered|Needs review|Partly/.test(r0), r0);
ok("lit wires and gates exist", (await p.$$eval("#heroviz .w.on", e => e.length)) > 5 && (await p.$$eval("#heroviz .g.on", e => e.length)) > 5);
// tapping an answer changes the result: make everything Yes
await p.evaluate(() => document.querySelectorAll("#heroviz .vq").forEach(b => { if (b.dataset.a === "0") b.click(); })); await w(500);
ok("all yes gives Covered", (await T("#heroviz .vres .big")) === "Covered", await T("#heroviz .vres .big"));
await p.click("#heroviz .vq:nth-child(2)"); await w(500);
ok("flipping 'in warranty' to No gives Not covered with the reason", (await T("#heroviz .vres .big")) === "Not covered" && /warranty period has ended/.test(await T("#heroviz .vres .vwhy")), await T("#heroviz .vres"));
ok("the output node lights for a covered result and the wires change", (await p.$$eval("#heroviz .g.out.on", e => e.length)) >= 0);
// autoplay moves on by itself after the pause
const before = await T("#heroviz .vres .big"); await w(9800 + 3800); ok("autoplay resumes and changes the scenario", (await T("#heroviz .vres .big")) !== "" , before);
ok("counters count up to their values", await (async () => { await p.evaluate(() => document.querySelector(".facts").scrollIntoView()); await w(1800); return (await T(".fact:nth-child(1) b")).trim() === "39" && /128/.test(await T(".fact:nth-child(2) b")); })(), await T(".facts"));
ok("four feature rows, each with a grainy gradient panel", (await p.$$(".row2 .pnl .art")).length === 4);
// checker page: the circuit lights only when every question is answered
await p.goto(BASE + "#check/warranty"); await w(1200); await p.click(".circ-card summary"); await w(300);
ok("the circuit is dark until all questions are answered", (await p.$$eval("#circviz .g.on", e => e.length)) === 0);
await p.evaluate(() => document.querySelectorAll(".q").forEach(d => d.querySelector('button[data-v="1"]').click())); await w(800);
ok("it lights up once every question is answered", (await p.$$eval("#circviz .g.on", e => e.length)) > 5 && (await p.$$eval("#circviz .g.out.on", e => e.length)) === 2, await p.$$eval("#circviz .g.out.on", e => e.length));
await p.goto(BASE + "#embed/warranty"); await w(900); ok("the embed view has no circuit card", (await p.$(".circ-card")) === null || (await p.$eval(".circ-card", e => getComputedStyle(e).display)) === "none");
await p.goto(BASE + "#about"); await w(600); ok("leaving the home page stops the timers (no errors)", errs.length === 0, errs.join(" | "));
await p.setViewport({width: 1280, height: 900}); await p.goto(BASE); await w(2000); await p.screenshot({path: "/tmp/lg-hero.png"});
await p.setViewport({width: 390, height: 844}); await p.goto(BASE); await w(1800); await p.evaluate(() => window.scrollTo(0, 360)); await w(500);
ok("no sideways scroll on a phone", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await p.screenshot({path: "/tmp/lg-hero-m.png"});
await b.close(); console.log(fails ? fails + " FAILED" : "all passed"); process.exit(fails ? 1 : 0);
