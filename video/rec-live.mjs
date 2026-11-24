// Records the scenes that use the LIVE site (https://lgtie.vercel.app): problem, rules, case, users, close. One Chrome, one clip at a time.
// Output: out/clips/<scene>.mp4 and out/clips/durations.json. Run from a folder where puppeteer-core is installed (see video/README.md).
import fs from "node:fs";
import { launch, record, sleep, label, scrollTo, clickOn, clickAt, moveTo, waitText, center } from "./lib.mjs";
const OUT = "out/clips"; fs.mkdirSync(OUT, { recursive: true });
const BASE = "https://lgtie.vercel.app/", durations = fs.existsSync(OUT + "/durations.json") ? JSON.parse(fs.readFileSync(OUT + "/durations.json", "utf8")) : {};
const only = process.argv[2] ? process.argv[2].split(",") : null;
const { browser, page } = await launch();
const open = async hash => { await page.goto(BASE + "?" + Date.now() + hash, { waitUntil: "domcontentloaded" }); await sleep(1500); };
const hash = async h => { await page.evaluate(h => { location.hash = h; }, h); await sleep(800); };
const clip = async (id, fn) => { if (only && !only.includes(id)) return; console.log("recording", id); const rec = await record(page, `${OUT}/${id}.mp4`); await fn(); durations[id] = +(await rec.stop()).toFixed(1); console.log(" ", id, durations[id], "s"); fs.writeFileSync(OUT + "/durations.json", JSON.stringify(durations, null, 1)); };
const yn = async (i, v) => { const h = (await page.$$(".yn"))[i]; const b = await h.$(`button[data-v="${v}"]`); await b.evaluate(e => e.scrollIntoView({ block: "center", behavior: "instant" })); const r = await b.boundingBox(); await clickAt(page, r.x + r.width / 2, r.y + r.height / 2, 420, 220); };

// 1. The problem: the home page, then a gentle scroll through the story.
await open(""); await sleep(2500); await label(page, "Live on X Layer");
await clip("problem", async () => {
  await sleep(1500); await moveTo(page, 930, 430, 1800); await sleep(2500);
  await scrollTo(page, 640, 3200); await sleep(3000); await scrollTo(page, 1300, 3200); await sleep(2500);
});

// 2. The rules: tap answers on the live circuit, then the claim checker.
await open(""); await sleep(2500); await label(page, "Live on X Layer"); await page.evaluate(() => scrollTo(0, 0));
await clip("rules", async () => {
  await sleep(1000);
  const pill = async i => { const h = (await page.$$(".vq"))[i]; const r = await h.boundingBox(); await clickAt(page, r.x + r.width / 2, r.y + r.height / 2, 600, 1500); };
  await pill(2); await pill(2);
  await clickOn(page, 'nav a[href="#check/warranty"]', 700, 1200); await sleep(600);
  for (const i of [0, 1, 2, 3, 4, 5, 6]) await yn(i, i === 2 ? 0 : 1);
  await page.evaluate(() => { const r = document.querySelector(".res"); r && r.scrollIntoView({ block: "center", behavior: "smooth" }); }); await sleep(2600);
});

// 3. A real case, then its receipt.
await open("#case/1"); await waitText(page, /Decided/, 40000); await sleep(1500); await label(page, "Live on X Layer: a real case, run by the builder");
await clip("case", async () => {
  await sleep(1000); await scrollTo(page, 420, 2200);
  const rows = await page.$$(".card tbody tr"); if (rows[0]) { const r = await rows[0].boundingBox(); if (r) await moveTo(page, r.x + r.width * 0.55, r.y + r.height / 2, 800); }
  await sleep(2400); await scrollTo(page, 1100, 2400); await sleep(2000); await scrollTo(page, 2000, 2400); await sleep(1200);
  await clickOn(page, 'a[href="#receipt/1"]', 800, 1000); await waitText(page, /Result receipt/, 20000); await sleep(900);
  await scrollTo(page, 420, 2200); await sleep(2000); await scrollTo(page, 1300, 2400); await sleep(1400);
});

// 4. Who it is for: the business page.
await open("#for-business"); await sleep(2200); await label(page, "Live on X Layer");
await clip("users", async () => {
  await sleep(1200); await scrollTo(page, 140, 1200);
  for (const i of [0, 1, 4, 5]) { const h = (await page.$$(".paths .path"))[i]; if (!h) continue; await h.evaluate(e => e.scrollIntoView({ block: "center", behavior: "instant" })); const r = await h.boundingBox(); await moveTo(page, r.x + r.width * 0.5, r.y + r.height * 0.55, 800); await sleep(1250); }
  await scrollTo(page, 600, 1800); await sleep(1200);
});

// 5. The end card.
await label(page, "");
await page.setContent(`<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#f2f1ed;color:#000;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}main{height:100%;display:flex;flex-direction:column;justify-content:center;padding:0 110px;box-sizing:border-box}h1{font-weight:400;font-size:132px;letter-spacing:-.04em;margin:0 0 14px;animation:u .9s ease both}p{font-size:36px;line-height:1.3;margin:0 0 34px;max-width:900px;animation:u .9s .35s ease both}.url{display:inline-block;background:#000;color:#fff;padding:16px 30px;border-radius:999px;font-size:30px;animation:u .9s .8s ease both;align-self:flex-start}small{display:block;margin-top:40px;font-size:22px;color:#737373;animation:u .9s 1.2s ease both}@keyframes u{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}</style><main><h1>LGtie</h1><p>Settle disputes fairly, with rules everyone can see first.</p><span class="url">lgtie.vercel.app</span><small>Live on X Layer · built with TapeOut circuits · unaudited prototype</small></main>`);
await clip("close", async () => { await sleep(16800); });
await browser.close();
