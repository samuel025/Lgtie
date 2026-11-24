// Records the scenes that use the LIVE site (https://lgtie.vercel.app): problem, rules, case, users, close, as a normal 1366x768 browser window.
// The story is Maya (the customer) and Acme (the business). Every part of the screen that matters gets a short plain-language callout, and
// each section starts with a title card. Actions are timed to the sentence they illustrate; the assembly makes the voice wait for the screen.
import fs from "node:fs";
import { launch, scene, timeline, dead, sleep, label, scrollTo, scrollToEl, clickOn, pointAt, moveTo, spot, callout, calloutAt, titleCard, waitText, boxOf, restoreCursor, navFade } from "./lib.mjs";
const BASE = "https://lgtie.vercel.app/", tl = timeline(), only = process.argv[2] ? process.argv[2].split(",") : null, want = id => !only || only.includes(id);
const { browser, page } = await launch();
// the home page circuit changes its own answers every few seconds; hold it still so it matches the narration
await page.evaluateOnNewDocument(() => { const si = window.setInterval.bind(window); window.setInterval = (f, ms, ...a) => ms === 3600 ? 0 : si(f, ms, ...a); });
const open = async hash => { await page.goto(BASE + "?" + Date.now() + hash, { waitUntil: "domcontentloaded" }); await sleep(1500); };

// 1. The problem, told as a story on cards, then the product.
if (want("problem")) {
  await open(""); await sleep(2500); await label(page, ""); await page.evaluate(() => scrollTo(0, 0)); await moveTo(page, 700, 420, 10);
  await scene(page, "problem", tl, async ({ at, beat, S }) => {
    await beat(0, 0.0); await titleCard(page, "The problem", "Maya buys a laptop from Acme.<br>It breaks.", 3500);
    await beat(1, 0.0); await titleCard(page, "Maya says", "&ldquo;The warranty covers it.&rdquo;", 2000);
    await beat(2, 0.0); await titleCard(page, "Acme says", "&ldquo;It does not.&rdquo;", 1500);
    await beat(3, 0.0); await titleCard(page, "Today", "Acme&rsquo;s own process decides.", 2800);
    await beat(4, 0.2); await label(page, "Live on X Layer"); await calloutAt(page, 60, 320, "LGtie: <b>rules both sides can see first</b>", { side: "r", ms: 2500, w: 40, h: 150 });
  });
}

// 2. The rules, published first.
if (want("rules")) {
  await open(""); await sleep(2500); await label(page, "Live on X Layer"); await page.evaluate(() => scrollTo(0, 0)); await moveTo(page, 330, 300, 10);
  await scene(page, "rules", tl, async ({ at, beat, S }) => {
    await at(0.2); await titleCard(page, "1 &middot; The rules", "Acme publishes its rules first", 2000);
    await beat(0, 0.2); await spot(page, ".vqs", 4400, { pad: 10, scroll: false }); await callout(page, ".vqs", "<b>Seven yes or no questions</b>: Acme's warranty rules", { side: "l", ms: 4400, scroll: false, maxW: 320 }); await pointAt(page, ".vqs", 1300, 0, 0.3, 0.4);
    await beat(1, 0.2); await spot(page, ".vsvg", 5800, { pad: 8, scroll: false }); await callout(page, ".vsvg", "They run as a <b>small circuit on X Layer</b>. Nobody can quietly change them.", { side: "l", ms: 5800, scroll: false, maxW: 330 }); await pointAt(page, ".vsvg", 1400, 0, 0.5, 0.5);
    await beat(2, -0.3); await clickOn(page, ".vq", 1100, 2);
    await beat(2, 1.0); await spot(page, ".vres", 2300, { pad: 8, scroll: false }); await callout(page, ".vres", "The <b>result and the reason</b> change instantly", { side: "l", ms: 2300, scroll: false, maxW: 320 });
    await beat(3, 0.1); await scrollTo(page, 120, 700); await callout(page, ".vnote a", "Anyone can re-run it, <b>for free</b>", { side: "t", ms: 1700, scroll: false, maxW: 300 }); await pointAt(page, ".vnote a", 900, 0, 0.5, 0.5);
  });
}

// 3. A real case, then its receipt.
if (want("case")) {
  await open("#case/1"); await waitText(page, /Decided/, 45000); await sleep(1500); await label(page, "Live on X Layer: a real case, run by the builder"); await page.evaluate(() => scrollTo(0, 0)); await moveTo(page, 560, 190, 10);
  await scene(page, "case", tl, async ({ at, beat, S }) => {
    await at(0.2); await titleCard(page, "2 &middot; The dispute", "Maya and Acme answer the same questions", 2000);
    await beat(0, 0.3); await spot(page, ".card thead", 3400, { pad: 8, scroll: false }); await callout(page, ".card thead", "<b>Maya's answers</b> (left) and <b>Acme's answers</b> (right)", { side: "b", ms: 3400, scroll: false, maxW: 380 }); await pointAt(page, ".card thead th:nth-child(2)", 1100, 0, 0.5, 0.5);
    await beat(1, 0.1); const b0 = await boxOf(page, ".card tbody tr:nth-child(2) .badge"); await moveTo(page, b0.x + b0.width / 2, b0.y + b0.height / 2, 900); await callout(page, ".card tbody tr:nth-child(2) .badge", "<b>Same answer</b> from both, so it is settled", { side: "r", ms: 2200, scroll: false }); await moveTo(page, b0.x + b0.width / 2, b0.y + b0.height / 2 + 140, 1300);
    await beat(2, 0.2); await spot(page, ".card tbody tr:nth-child(1)", 3200, { pad: 6, scroll: false }); await callout(page, ".card tbody tr:nth-child(1) .badge", "<b>Different answers.</b> Only this one goes to the reviewer", { side: "b", ms: 3200, scroll: false, maxW: 340 }); await pointAt(page, ".card tbody tr:nth-child(1) .badge", 1000, 0, 0.5, 0.5);
    await beat(2, 3.6); await scrollToEl(page, "h3", 1200, 0, 0.3); await callout(page, "h3", "A <b>neutral reviewer</b> both sides accepted in advance", { side: "r", ms: 2300, scroll: false, maxW: 330 });
    await beat(3, 0.0); await scrollTo(page, 0, 1300);
    await beat(4, 0.2); await callout(page, "h1", "A <b>real case on X Layer</b>, played by the builder: a demonstration", { side: "b", ms: 3000, scroll: false, maxW: 420 });
    await beat(5, -0.4); await scrollToEl(page, ".res", 1200, 0, 0.3); await callout(page, ".res", "<b>Covered</b>: the result", { side: "t", ms: 1500, scroll: false });
    const rb = await pointAt(page, 'a[href="#receipt/1"]', 900);
    await beat(5, 0.4); await navFade(page, async () => { await rb.h.click({ delay: 90 }); await dead(() => waitText(page, /Result receipt/, 25000)); });
    await beat(6, 0.1); await spot(page, ".rt", 3600, { pad: 6, nth: 0 }); await callout(page, ".rt", "<b>Who said what</b>, and who settled each question", { side: "t", ms: 3600, scroll: false, maxW: 360 }); await moveTo(page, 700, 470, 1500);
    await beat(6, 3.0); await scrollTo(page, 330, 1700); await callout(page, ".rver", "The rules, <b>re-run live</b> on X Layer", { side: "t", ms: 1800, scroll: false });
  });
}

// 4. Who it is for: the business page.
if (want("users")) {
  await open("#for-business"); await sleep(2400); await label(page, "Live on X Layer: business page"); await page.evaluate(() => scrollTo(0, 0)); await moveTo(page, 420, 380, 10);
  await scene(page, "users", tl, async ({ at, beat, S }) => {
    await beat(1, 0.2); await spot(page, ".paths .path", 2200, { nth: 3, pad: 8, scroll: false }); await pointAt(page, ".paths .path", 1200, 3, 0.5, 0.5);
    await beat(1, 2.6); await spot(page, ".paths .path", 1700, { nth: 0, pad: 8, scroll: false }); await pointAt(page, ".paths .path", 1100, 0, 0.5, 0.5);
    await beat(2, 0.1); await titleCard(page, "Proposed model", "A small fee for each reviewed decision, or for a permanent receipt", 4800);
  });
}

// 5. The end card, with the points appearing as they are spoken.
if (want("close")) {
  await label(page, "");
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#f2f1ed;color:#000;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}main{height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 120px;box-sizing:border-box}h1{font-weight:400;font-size:120px;letter-spacing:-.04em;margin:0 0 8px;animation:u .9s ease both}p.t{font-size:30px;margin:0 0 34px;color:#333;animation:u .9s .3s ease both}ul{list-style:none;padding:0;margin:0 0 34px}li{font-size:28px;line-height:1.35;margin:0 0 12px;padding-left:32px;position:relative;opacity:0;animation:u .8s ease forwards}li:before{content:"";position:absolute;left:0;top:.5em;width:12px;height:12px;border-radius:50%;background:#ff5b2e}li.ok:before{background:#000}.url{display:inline-block;background:#000;color:#fff;padding:14px 30px;border-radius:999px;font-size:30px;align-self:flex-start;opacity:0;animation:u .9s 10.4s ease forwards}@keyframes u{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}</style><main><h1>LGtie</h1><p class="t">Settle disputes fairly, with rules everyone can see first.</p><ul><li style="animation-delay:1s">It cannot tell whether an answer is true.</li><li style="animation-delay:3.6s">A reviewer can still be wrong.</li><li class="ok" style="animation-delay:5.9s">The rules are clear, and anyone can re-check the result.</li></ul><span class="url">lgtie.vercel.app</span></main>`);
  await scene(page, "close", tl, async ({ at }) => { await at(0.5); });
}
await browser.close();
