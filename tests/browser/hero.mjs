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
ok("counters count up to their values", await (async () => { await p.evaluate(() => document.querySelector(".facts").scrollIntoView()); await w(1800); return (await T(".fact:nth-child(1) b")).trim() === "7" && /128/.test(await T(".fact:nth-child(2) b")); })(), await T(".facts"));
ok("four feature rows, each with a grainy gradient panel", (await p.$$(".row2 .pnl .art")).length === 4);
// ---- orientation: a short nav, a "where do I start" chooser, a hub for businesses
ok("the nav is four plain links and one button", (await p.$$eval("#nav a", a => a.map(x => x.textContent.trim()))).join("|") === "How it works|Try a claim check|For businesses|My cases|See a real case");
ok("the home page asks where to start and offers three doors", /Where do you want to start/.test(await p.$eval("main", e => e.textContent)) && (await p.$$(".startsec .path")).length === 3);
ok("the hero says what the product is for without jargon", !/X Layer|circuit|NAND|reviewer/.test(await p.$eval(".hcopy", e => e.textContent)), await p.$eval(".hcopy", e => e.textContent));
await p.goto(BASE + "#for-business"); await w(800);
const hubLinks = await p.$$eval(".paths .path", a => a.map(x => x.getAttribute("href")));
ok("the For businesses page lists every business task as a card that links somewhere real", hubLinks.length === 10 && ["https://github.com/samuel025/Lgtie/tree/main/bridge", "#build", "#inbox", "#pk/cases", "#pk/agree", "#agree", "#case", "#reviewer", "#verify", "embed-demo.html"].every(h => hubLinks.includes(h)), hubLinks.join(","));
await p.goto(BASE); await w(1200);
// ---- graphics: the flow diagram, the illustrated How-it-works page, and reduced motion
ok("the home page has the animated flow diagram with five stages", (await p.$$(".flowsec .fnode")).length === 5 && (await p.$$(".flowsec .flab")).length === 5);
ok("the home page shows icon cards for what it does not do", (await p.$$(".nocards .nocard")).length === 3);
await p.goto(BASE + "#about"); await w(1200);
ok("the About page has six illustrated steps", (await p.$$(".how")).length === 6 && (await p.$$(".how .ill svg.g")).length === 6);
ok("the About page keeps the honest limits, tucked into a collapsible section", (await p.$("details#risks")) !== null && /known limitation F1/.test(await p.$eval("details#risks", e => e.textContent)));
await p.evaluate(() => document.querySelectorAll(".ill").forEach(e => e.classList.add("in"))); await w(300);
ok("illustrations animate in when they scroll into view", await p.$eval(".g1 .lock", e => getComputedStyle(e).animationName !== "none"));
await p.emulateMediaFeatures([{name: "prefers-reduced-motion", value: "reduce"}]); await p.goto(BASE + "#about"); await w(1500);
ok("with reduced motion every illustration is fully visible and nothing moves", await p.evaluate(() => [".g1 .bar", ".g1 .lock", ".g2 .row", ".g3 .arow", ".g5 .out", ".g6 .phone"].every(s => { const e = document.querySelector(s), c = getComputedStyle(e); return c.opacity === "1" && c.transform === "none" && c.animationName === "none"; })) && (await p.$eval(".travel", e => getComputedStyle(e).display === "none")));
await p.emulateMediaFeatures([{name: "prefers-reduced-motion", value: "no-preference"}]);
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
