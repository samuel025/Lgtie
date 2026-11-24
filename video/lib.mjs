// Shared helpers for recording the demo video with puppeteer. Light on purpose: one headless Chrome, rendered at 1120x630 and captured at
// 1280x720 (so everything on screen is 1.14x bigger and easy to read), 24 fps.
// What is here: a large visible cursor with a halo and click ripples, an orange "spotlight" that highlights what is being talked about,
// a label pill, smooth scrolling, and a timeline so every action waits for the sentence it illustrates (no speeding up).
import puppeteer from "puppeteer-core"; import fs from "node:fs";
export const W = 1120, H = 630, SCALE = 1280 / 1120, sleep = ms => new Promise(r => setTimeout(r, ms));
export async function launch(extraArgs = []) {
  const exe = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
  const browser = await puppeteer.launch({ executablePath: exe, args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-extensions", "--disable-background-networking", `--window-size=${W},${H}`, ...extraArgs] });
  const page = await browser.newPage(); await page.setViewport({ width: W, height: H, deviceScaleFactor: SCALE });
  await page.evaluateOnNewDocument(() => {
    const add = () => {
      if (document.getElementById("__cur")) return;
      const st = document.createElement("style");
      st.textContent = `#__cur{position:fixed;left:-60px;top:-60px;width:0;height:0;pointer-events:none;z-index:2147483647}
#__cur .halo{position:absolute;left:-27px;top:-27px;width:54px;height:54px;border-radius:50%;border:3px solid rgba(255,91,46,.6);background:rgba(255,91,46,.14);animation:__pulse 1.6s ease-in-out infinite}
#__cur svg{position:absolute;left:-3px;top:-2px;filter:drop-shadow(0 3px 5px rgba(0,0,0,.45))}
#__cur.dn .halo{background:rgba(255,91,46,.4)}
.__rip{position:fixed;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;border:4px solid #ff5b2e;pointer-events:none;z-index:2147483646;animation:__rip .7s ease-out forwards}
@keyframes __pulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.18);opacity:.75}}
@keyframes __rip{from{transform:scale(.4);opacity:1}to{transform:scale(3.2);opacity:0}}
#__lbl{position:fixed;left:14px;top:60px;z-index:2147483645;background:rgba(17,17,17,.9);color:#fff;font:500 12px system-ui,sans-serif;padding:7px 12px;border-radius:999px;pointer-events:none;letter-spacing:.01em;display:none}
#__lbl i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;background:#3ddc84}#__lbl.test i{background:#ffb020}
.__spot{position:absolute;z-index:2147483644;pointer-events:none;border:4px solid #ff5b2e;border-radius:16px;box-shadow:0 0 0 9999px rgba(0,0,0,.34),0 0 24px 4px rgba(255,91,46,.55);opacity:0;transition:opacity .35s ease}
.__spot.on{opacity:1}`;
      document.documentElement.appendChild(st);
      const c = document.createElement("div"); c.id = "__cur"; c.innerHTML = `<div class="halo"></div><svg width="30" height="34" viewBox="0 0 30 34"><path d="M4 3 L4 27 L10.5 21.2 L15.2 31 L20 28.8 L15.4 19.2 L23.8 18.9 Z" fill="#ff5b2e" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/></svg>`; document.documentElement.appendChild(c);
      const l = document.createElement("div"); l.id = "__lbl"; document.documentElement.appendChild(l);
      addEventListener("mousemove", e => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
      addEventListener("mousedown", e => { c.classList.add("dn"); const r = document.createElement("div"); r.className = "__rip"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px"; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 800); }, true);
      addEventListener("mouseup", () => c.classList.remove("dn"), true);
      window.__spot = (r, ms, pad) => { const d = document.createElement("div"); d.className = "__spot"; d.style.left = r.x + scrollX - pad + "px"; d.style.top = r.y + scrollY - pad + "px"; d.style.width = r.width + 2 * pad + "px"; d.style.height = r.height + 2 * pad + "px"; document.documentElement.appendChild(d); requestAnimationFrame(() => d.classList.add("on")); setTimeout(() => { d.classList.remove("on"); setTimeout(() => d.remove(), 400); }, ms); };
    };
    if (document.readyState === "loading") addEventListener("DOMContentLoaded", add); else add();
  });
  return { browser, page };
}
export const label = (page, text, test = false) => page.evaluate((t, test) => { const l = document.getElementById("__lbl"); if (!l) return; if (!t) { l.style.display = "none"; return; } l.className = test ? "test" : ""; l.innerHTML = "<i></i>" + t; l.style.display = "block"; }, text, test);

// ----- the cursor -----
let mx = 560, my = 300;
export async function moveTo(page, x, y, ms = 900) { const steps = Math.max(10, Math.round(ms / 16)); for (let i = 1; i <= steps; i++) { const t = i / steps, e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; await page.mouse.move(mx + (x - mx) * e, my + (y - my) * e); await sleep(ms / steps); } mx = x; my = y; }
export const restoreCursor = async page => { await page.mouse.move(mx, my); await sleep(60); await page.mouse.move(mx + 1, my + 1); };
const needsScroll = e => { const r = e.getBoundingClientRect(); return r.top < 70 || r.bottom > innerHeight - 24; };
export async function boxOf(page, sel, nth = 0, scroll = true) { const hs = await page.$$(sel); const h = hs[nth]; if (!h) throw new Error("no element " + sel + "[" + nth + "]"); if (scroll && await h.evaluate(needsScroll)) await h.evaluate(e => e.scrollIntoView({ block: "center", behavior: "instant" })); const b = await h.boundingBox(); return { h, ...b }; }
export async function pointAt(page, sel, ms = 900, nth = 0, fx = 0.5, fy = 0.5) { const b = await boxOf(page, sel, nth); await moveTo(page, b.x + b.width * fx, b.y + b.height * fy, ms); return b; }
// moves the visible cursor to the element, then clicks it where it is NOW (the layout can shift while the cursor travels)
export async function clickOn(page, sel, ms = 900, nth = 0) { const b = await pointAt(page, sel, ms, nth); await sleep(200); const now = await b.h.boundingBox(); if (now && (Math.abs(now.x - b.x) > 3 || Math.abs(now.y - b.y) > 3)) { await moveTo(page, now.x + now.width / 2, now.y + now.height / 2, 250); } await b.h.click({ delay: 90 }); await sleep(250); return b; }
export async function typeIn(page, sel, text, perChar = 55) { await clickOn(page, sel, 520); await page.type(sel, text, { delay: perChar }); }
// highlight an element (does not wait): everything else dims for `ms`
export async function spot(page, sel, ms = 3000, { nth = 0, pad = 10, scroll = true } = {}) { const hs = await page.$$(sel); const h = hs[nth]; if (!h) return null; if (scroll && await h.evaluate(needsScroll)) await h.evaluate(e => e.scrollIntoView({ block: "center", behavior: "instant" })); const b = await h.boundingBox(); await page.evaluate((r, ms, pad) => window.__spot && window.__spot(r, ms, pad), { x: b.x, y: b.y, width: b.width, height: b.height }, ms, pad); return b; }
export async function scrollTo(page, y, ms = 2500) { await page.evaluate((y, ms) => new Promise(res => { const y0 = scrollY, t0 = performance.now(); const f = n => { const t = Math.min(1, (n - t0) / ms), e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; scrollTo(0, y0 + (y - y0) * e); t < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); }), y, ms); }
export async function scrollToEl(page, sel, ms = 2500, nth = 0, align = 0.38) { const y = await page.evaluate((sel, nth, align) => { const e = document.querySelectorAll(sel)[nth]; if (!e) return null; const r = e.getBoundingClientRect(); return Math.max(0, scrollY + r.top - innerHeight * align); }, sel, nth, align); if (y !== null) await scrollTo(page, y, ms); }
export async function waitText(page, re, ms = 30000, sel = "body") { const t = Date.now(); while (Date.now() - t < ms) { const s = await page.$eval(sel, e => e.innerText).catch(() => ""); if (re.test(s)) return true; await sleep(250); } return false; }

// ----- the timeline: when each sentence is spoken, relative to the start of its scene -----
export function timeline(dir = "out") {
  const sc = JSON.parse(fs.readFileSync(dir + "/scenes.json", "utf8")), se = JSON.parse(fs.readFileSync(dir + "/sentences.json", "utf8")), nar = JSON.parse(fs.readFileSync(new URL("./narration.json", import.meta.url), "utf8")).scenes;
  const norm = s => s.split(/\s+/).join(" ").toLowerCase(), starts = [0, ...sc.slice(1).map(s => s.start)], ends = [...starts.slice(1), se[se.length - 1].end + 1.2], out = {};
  sc.forEach((s, i) => { const D = ends[i] - starts[i]; out[s.id] = { D, S: se.filter(x => x.start >= starts[i] - 1e-6 && x.start < ends[i] - 1e-6 && norm(nar[i].text).includes(norm(x.text).slice(0, 30))).map(x => ({ t0: Math.max(0, x.start - starts[i]), t1: x.end - starts[i], text: x.text })) }; });
  return out;
}
// Records one scene for exactly as long as its narration. fn gets {at, S, D}: `await at(t)` waits until t seconds into the scene.
let _t0 = 0, _marks = [];
// Wrap any real waiting (a transaction, a page load) in dead(): the assembly cuts it out of the video, keeping half a second of it.
export async function dead(fn) { const a = (Date.now() - _t0) / 1000; const r = await fn(); _marks.push([+a.toFixed(2), +((Date.now() - _t0) / 1000).toFixed(2)]); return r; }
export async function scene(page, id, tl, fn, outDir = "out/clips") {
  const T = tl[id]; if (!T) throw new Error("no scene " + id); fs.mkdirSync(outDir, { recursive: true });
  console.log("recording", id, "for", T.D.toFixed(1), "s");
  const rec = await page.record({ path: `${outDir}/${id}.mp4`, maxWidth: 1280, maxHeight: 720, fps: 24 }); const t0 = Date.now(); _t0 = t0; _marks = [];
  const at = async t => { const wait = t * 1000 - (Date.now() - t0); if (wait > 0) await sleep(wait); const late = (Date.now() - t0) / 1000 - t; if (late > 0.5) console.log(`   beat at ${t.toFixed(1)}s started ${late.toFixed(1)}s late`); return late; };
  try { await fn({ at, S: T.S, D: T.D }); await at(T.D); } finally { await rec.stop(); }
  const mf = outDir + "/marks.json", mk = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, "utf8")) : {}; mk[id] = _marks; fs.writeFileSync(mf, JSON.stringify(mk));
  const secs = (Date.now() - t0) / 1000, f = outDir + "/durations.json", d = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {}; d[id] = +secs.toFixed(1); fs.writeFileSync(f, JSON.stringify(d, null, 1)); console.log("  ", id, secs.toFixed(1), "s");
}
