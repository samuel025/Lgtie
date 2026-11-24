// Records the scenes that use the LIVE site (https://lgtie.vercel.app): problem, rules, case, users, close.
// Every action is timed to the sentence it illustrates (see lib.mjs `scene`), at normal speed. One Chrome, one clip at a time.
// Run from a folder where puppeteer-core is installed and out/ holds scenes.json + sentences.json (see video/README.md).
import fs from "node:fs";
import { launch, scene, timeline, dead, sleep, label, scrollTo, scrollToEl, clickOn, pointAt, moveTo, spot, waitText, boxOf, restoreCursor } from "./lib.mjs";
const BASE = "https://lgtie.vercel.app/", tl = timeline(), only = process.argv[2] ? process.argv[2].split(",") : null, want = id => !only || only.includes(id);
const { browser, page } = await launch();
// the home page circuit changes its own answers every few seconds; hold it still so it matches the narration
await page.evaluateOnNewDocument(() => { const si = window.setInterval.bind(window); window.setInterval = (f, ms, ...a) => ms === 3600 ? 0 : si(f, ms, ...a); });
const open = async hash => { await page.goto(BASE + "?" + Date.now() + hash, { waitUntil: "domcontentloaded" }); await sleep(1500); };

// 1. The problem: the home page, calm, with a slow scroll through the story.
if (want("problem")) {
  await open(""); await sleep(2500); await label(page, "Live on X Layer"); await page.evaluate(() => scrollTo(0, 0)); await moveTo(page, 250, 200, 10);
  await scene(page, "problem", tl, async ({ at, S }) => {
    await at(0.3); await moveTo(page, 300, 250, 1600);                 // Imagine you buy a laptop...
    await at(S[3].t0); await moveTo(page, 600, 330, 1500); await at(S[3].t0 + 1.4); await scrollTo(page, 330, 5200);   // Today, the rules live inside the business's own process...
    await at(S[4].t0 - 0.2); await scrollTo(page, 0, 1700);                                                 // LGtie is built to fix that.
    await at(S[4].t0 + 0.8); await spot(page, "h1", 1700, { pad: 14 });
  });
}

// 2. The rules: point at the questions, the circuit, tap an answer, and the free check.
if (want("rules")) {
  await open(""); await sleep(2500); await label(page, "Live on X Layer"); await page.evaluate(() => scrollTo(0, 0)); await moveTo(page, 300, 250, 10);
  await scene(page, "rules", tl, async ({ at, S }) => {
    await at(S[1].t0 + 0.2); await spot(page, ".vqs", 4800, { pad: 12, scroll: false }); await pointAt(page, ".vqs", 1200, 0, 0.3, 0.35);   // as simple yes or no questions
    await at(S[2].t0 + 0.2); await spot(page, ".vsvg", 7000, { pad: 8, scroll: false }); await pointAt(page, ".vsvg", 1300, 0, 0.5, 0.5);      // a small circuit on X Layer
    await at(S[3].t0 - 0.2); await scrollTo(page, 150, 1200);                                                                                       // Tap an answer...
    await clickOn(page, ".vq", 900, 2);
    await at(S[4].t0 + 0.1); await scrollTo(page, 340, 800); await spot(page, ".vnote a", 2000, { pad: 10, scroll: false }); await pointAt(page, ".vnote a", 900, 0, 0.5, 0.5); // Anyone can check it, for free.
  });
}

// 3. A real case, then its receipt.
if (want("case")) {
  await open("#case/1"); await waitText(page, /Decided/, 45000); await sleep(1500); await label(page, "Live on X Layer: a real case, run by the builder"); await page.evaluate(() => scrollTo(0, 0)); await moveTo(page, 480, 150, 10);
  await scene(page, "case", tl, async ({ at, S }) => {
    await at(0.5); await spot(page, ".card thead", 3600, { pad: 10, scroll: false }); await pointAt(page, ".card thead th:nth-child(2)", 1200, 0, 0.5, 0.5);   // both sides answer the same questions
    await at(S[1].t0 + 0.2); const b0 = await boxOf(page, ".card tbody tr:nth-child(2) .badge"); await moveTo(page, b0.x + b0.width / 2, b0.y + b0.height / 2, 900);   // where they match
    await moveTo(page, b0.x + b0.width / 2, b0.y + b0.height / 2 + 150, 1400);
    await at(S[2].t0 + 0.1); await scrollTo(page, 0, 600); await spot(page, ".card tbody tr:nth-child(1)", 4200, { pad: 8, scroll: false }); await pointAt(page, ".card tbody tr:nth-child(1) .badge", 1000, 0, 0.5, 0.5);   // only the disagreement goes to the reviewer
    await at(S[2].t0 + 4.5); await scrollToEl(page, "h3", 1200, 0, 0.3);                                                                                 // ... agreed in advance
    await at(S[3].t0 + 0.2); await scrollTo(page, 0, 1500);                                                                                          // This is a real case on X Layer
    await at(S[4].t0 + 0.2); await spot(page, ".card tbody", 4600, { pad: 6, scroll: false });                                                      // Six answers matched, one did not...
    await moveTo(page, 600, 300, 1500); await at(S[4].t0 + 2.6); await pointAt(page, ".card tbody tr:nth-child(1) .badge", 1300, 0, 0.5, 0.5);
    await at(S[5].t0 + 0.2); await scrollToEl(page, ".res", 1800, 0, 0.3); await spot(page, ".res", 2400, { pad: 10, scroll: false });                // The result is covered...
    await at(S[5].t0 + 1.4); await clickOn(page, 'a[href="#receipt/1"]', 900);                                                                      // ... the receipt shows exactly how it was reached
    await dead(() => waitText(page, /Result receipt/, 20000));
    await at(S[6].t0 + 0.5); await restoreCursor(page); await scrollTo(page, 330, 3200);                                                         // I ran this case myself...
  });
}

// 4. Who it is for: the business page.
if (want("users")) {
  await open("#for-business"); await sleep(2400); await label(page, "Live on X Layer"); await page.evaluate(() => scrollTo(0, 0)); await moveTo(page, 300, 250, 10);
  await scene(page, "users", tl, async ({ at, S }) => {
    await at(S[1].t0 + 0.2); await spot(page, ".paths .path", 2200, { nth: 3, pad: 10, scroll: false }); await pointAt(page, ".paths .path", 1100, 3, 0.5, 0.5);   // warranty claims, refunds, or bug bounties
    await at(S[1].t0 + 2.2); await spot(page, ".paths .path", 2200, { nth: 0, pad: 10, scroll: false }); await pointAt(page, ".paths .path", 1000, 0, 0.5, 0.5);
    await at(S[2].t0 + 0.2); await moveTo(page, 700, 380, 1200);                                                                                      // How could it earn money?
    await at(S[3].t0); await label(page, "Pricing is a guess, not validated with real customers");                                                   // Maybe a small fee ...
  });
}

// 5. The end card, with the honest limits appearing as they are spoken.
if (want("close")) {
  await label(page, "");
  await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#f2f1ed;color:#000;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}main{height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 70px;box-sizing:border-box}h1{font-weight:400;font-size:88px;letter-spacing:-.04em;margin:0 0 6px;animation:u .9s ease both}p.t{font-size:23px;margin:0 0 26px;color:#333;animation:u .9s .3s ease both}ul{list-style:none;padding:0;margin:0 0 28px}li{font-size:21px;line-height:1.35;margin:0 0 9px;padding-left:26px;position:relative;opacity:0;animation:u .8s ease forwards}li:before{content:"";position:absolute;left:0;top:.5em;width:10px;height:10px;border-radius:50%;background:#ff5b2e}li.ok:before{background:#000}.url{display:inline-block;background:#000;color:#fff;padding:12px 24px;border-radius:999px;font-size:24px;align-self:flex-start;opacity:0;animation:u .9s 11.2s ease forwards}@keyframes u{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}</style><main><h1>LGtie</h1><p class="t">Settle disputes fairly, with rules everyone can see first.</p><ul><li style="animation-delay:.8s">It cannot tell whether an answer is true.</li><li style="animation-delay:3s">A reviewer can still be wrong.</li><li style="animation-delay:5.1s">The contracts are unaudited.</li><li class="ok" style="animation-delay:7.6s">The rules are clear, and anyone can re-check the result.</li></ul><span class="url">lgtie.vercel.app</span></main>`);
  await scene(page, "close", tl, async ({ at }) => { await at(0.4); });
}
await browser.close();
