// Records the scenes that use the LIVE site (https://lgtie.vercel.app): problem, rules, case, users, close, as a normal 1366x768 browser window.
// Every action is timed to the sentence it illustrates (see lib.mjs `scene`), at normal speed, with a fade on every change of page.
// Run from a folder where puppeteer-core is installed and out/ holds scenes.json + sentences.json (see video/README.md).
import fs from "node:fs";
import { launch, scene, timeline, dead, sleep, label, scrollTo, scrollToEl, clickOn, pointAt, moveTo, spot, waitText, boxOf, restoreCursor, navFade } from "./lib.mjs";
const BASE = "https://lgtie.vercel.app/", tl = timeline(), only = process.argv[2] ? process.argv[2].split(",") : null, want = id => !only || only.includes(id);
const { browser, page } = await launch();
// the home page circuit changes its own answers every few seconds; hold it still so it matches the narration
await page.evaluateOnNewDocument(() => { const si = window.setInterval.bind(window); window.setInterval = (f, ms, ...a) => ms === 3600 ? 0 : si(f, ms, ...a); });
const open = async hash => { await page.goto(BASE + "?" + Date.now() + hash, { waitUntil: "domcontentloaded" }); await sleep(1500); };

// 1. The problem: the home page, calm. A slow scroll while the problem is described.
if (want("problem")) {
  await open(""); await sleep(2500); await label(page, "Live on X Layer"); await page.evaluate(() => scrollTo(0, 0)); await moveTo(page, 330, 300, 10);
  await scene(page, "problem", tl, async ({ at, beat, S }) => {
    await beat(0, 0.8); await moveTo(page, 420, 380, 2200);                                  // Imagine you buy a laptop, and it breaks.
    await beat(3, 0.3); await scrollTo(page, 260, 5200);                                      // Today, the rules live inside the business's own process...
    await beat(4, -0.2); await scrollTo(page, 0, 1500);                                        // LGtie is built to fix that.
    await beat(4, 0.9); await spot(page, "h1", 1800, { pad: 12, scroll: false });
  });
}

// 2. The rules: the questions, the circuit, tap an answer, the free check.
if (want("rules")) {
  await open(""); await sleep(2500); await label(page, "Live on X Layer"); await page.evaluate(() => scrollTo(0, 0)); await moveTo(page, 330, 300, 10);
  await scene(page, "rules", tl, async ({ at, beat, S }) => {
    await beat(1, 0.2); await spot(page, ".vqs", 4400, { pad: 10, scroll: false }); await pointAt(page, ".vqs", 1300, 0, 0.3, 0.4);   // as simple yes or no questions
    await beat(2, 0.3); await spot(page, ".vsvg", 7000, { pad: 8, scroll: false }); await pointAt(page, ".vsvg", 1400, 0, 0.5, 0.5);      // a small circuit on X Layer
    await beat(3, -0.2); await clickOn(page, ".vq", 1100, 2);                                                                              // Tap an answer...
    await beat(3, 1.2); await spot(page, ".vres", 1900, { pad: 8, scroll: false });
    await beat(4, 0.2); await scrollTo(page, 120, 700); await spot(page, ".vnote a", 1800, { pad: 8, scroll: false }); await pointAt(page, ".vnote a", 900, 0, 0.5, 0.5);   // Anyone can check it, for free.
  });
}

// 3. A real case, then its receipt.
if (want("case")) {
  await open("#case/1"); await waitText(page, /Decided/, 45000); await sleep(1500); await label(page, "Live on X Layer: a real case, run by the builder"); await page.evaluate(() => scrollTo(0, 0)); await moveTo(page, 560, 190, 10);
  await scene(page, "case", tl, async ({ at, beat, S }) => {
    await beat(0, 0.3); await spot(page, ".card thead", 3200, { pad: 8, scroll: false }); await pointAt(page, ".card thead th:nth-child(2)", 1100, 0, 0.5, 0.5);   // both sides answer the same questions
    await beat(1, 0.1); const b0 = await boxOf(page, ".card tbody tr:nth-child(2) .badge"); await moveTo(page, b0.x + b0.width / 2, b0.y + b0.height / 2, 900); await moveTo(page, b0.x + b0.width / 2, b0.y + b0.height / 2 + 150, 1300);   // where they match, it is settled
    await beat(2, 0.3); await spot(page, ".card tbody tr:nth-child(1)", 4300, { pad: 6, scroll: false }); await pointAt(page, ".card tbody tr:nth-child(1) .badge", 1000, 0, 0.5, 0.5);   // only the disagreement goes to the reviewer
    await beat(2, 4.9); await scrollToEl(page, "h3", 1300, 0, 0.3);                                                                          // ... agreed in advance
    await beat(3, 0.2); await scrollTo(page, 0, 1300);                                                                                       // This is a real case on X Layer.
    await beat(4, 0.3); await spot(page, ".card tbody", 4400, { pad: 6, scroll: false }); await moveTo(page, 640, 360, 1500); await beat(4, 2.8); await pointAt(page, ".card tbody tr:nth-child(1) .badge", 1200, 0, 0.5, 0.5);   // Six answers matched, and one did not...
    await beat(5, 0.0); await scrollToEl(page, ".res", 1300, 0, 0.3); await spot(page, ".res", 2000, { pad: 8, scroll: false });            // The result is covered.
    await beat(6, -1.0); const rb = await pointAt(page, 'a[href="#receipt/1"]', 900);                                                       // Now, the receipt.
    await beat(6, 0.2); await navFade(page, async () => { await rb.h.click({ delay: 90 }); await dead(() => waitText(page, /Result receipt/, 25000)); });
    await beat(7, 0.3); await spot(page, ".rt", 4800, { pad: 6, nth: 0 }); await moveTo(page, 700, 460, 1500);                                 // It shows who said what, who settled each question...
    await beat(8, 0.2); await scrollTo(page, 420, 3600);                                                                                    // I ran this case myself...
  });
}

// 4. Who it is for: the business page.
if (want("users")) {
  await open("#for-business"); await sleep(2400); await label(page, "Live on X Layer: business page"); await page.evaluate(() => scrollTo(0, 0)); await moveTo(page, 420, 380, 10);
  await scene(page, "users", tl, async ({ at, beat, S }) => {
    await beat(1, 0.2); await spot(page, ".paths .path", 2300, { nth: 3, pad: 8, scroll: false }); await pointAt(page, ".paths .path", 1200, 3, 0.5, 0.5);   // warranty claims, refunds, or bug bounties
    await beat(1, 2.9); await spot(page, ".paths .path", 2000, { nth: 0, pad: 8, scroll: false }); await pointAt(page, ".paths .path", 1100, 0, 0.5, 0.5);
    await beat(2, 0.1); await label(page, "Proposed revenue model: a small fee for each reviewed decision, or a permanent receipt"); await moveTo(page, 760, 520, 1600);   // The proposed model...
  });
}

// 5. The end card, with the points appearing as they are spoken.
if (want("close")) {
  await label(page, "");
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#f2f1ed;color:#000;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}main{height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 120px;box-sizing:border-box}h1{font-weight:400;font-size:120px;letter-spacing:-.04em;margin:0 0 8px;animation:u .9s ease both}p.t{font-size:30px;margin:0 0 34px;color:#333;animation:u .9s .3s ease both}ul{list-style:none;padding:0;margin:0 0 34px}li{font-size:28px;line-height:1.35;margin:0 0 12px;padding-left:32px;position:relative;opacity:0;animation:u .8s ease forwards}li:before{content:"";position:absolute;left:0;top:.5em;width:12px;height:12px;border-radius:50%;background:#ff5b2e}li.ok:before{background:#000}.url{display:inline-block;background:#000;color:#fff;padding:14px 30px;border-radius:999px;font-size:30px;align-self:flex-start;opacity:0;animation:u .9s 10.6s ease forwards}@keyframes u{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}</style><main><h1>LGtie</h1><p class="t">Settle disputes fairly, with rules everyone can see first.</p><ul><li style="animation-delay:.9s">It cannot tell whether an answer is true.</li><li style="animation-delay:3.5s">A reviewer can still be wrong.</li><li class="ok" style="animation-delay:5.8s">The rules are clear, and anyone can re-check the result.</li></ul><span class="url">lgtie.vercel.app</span></main>`);
  await scene(page, "close", tl, async ({ at }) => { await at(0.5); });
}
await browser.close();
