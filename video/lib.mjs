// Shared helpers for recording the demo video with puppeteer. Light on purpose: one headless Chrome, rendered as a normal 1366x768 browser window and captured at
// 1280x720, like a real screen recording, 24 fps.
// What is here: a large visible cursor with a halo and click ripples, an orange "spotlight" that highlights what is being talked about,
// a label pill, smooth scrolling, and a timeline so every action waits for the sentence it illustrates (no speeding up).
import puppeteer from "puppeteer-core"; import fs from "node:fs";
// every cursor move, scroll, click and typing delay is multiplied by PACE (1 = the slow first cut, 0.7 = brisk)
export const PACE = 0.9;
export const W = 1366, H = 768, SCALE = 1280 / 1366, sleep = ms => new Promise(r => setTimeout(r, ms));
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
#__lbl{position:fixed;left:16px;top:66px;z-index:2147483645;background:rgba(17,17,17,.9);color:#fff;font:500 13px system-ui,sans-serif;padding:7px 13px;border-radius:999px;pointer-events:none;letter-spacing:.01em;display:none}
#__lbl i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;background:#3ddc84}#__lbl.test i{background:#ffb020}
.__spot{position:absolute;z-index:2147483644;pointer-events:none;border:3px solid #ff5b2e;border-radius:14px;box-shadow:0 0 0 5px rgba(255,91,46,.18),0 0 22px 2px rgba(255,91,46,.35);opacity:0;transition:opacity .4s ease}
.__spot.on{opacity:1}`;
      document.documentElement.appendChild(st);
      const c = document.createElement("div"); c.id = "__cur"; c.innerHTML = `<div class="halo"></div><svg width="30" height="34" viewBox="0 0 30 34"><path d="M4 3 L4 27 L10.5 21.2 L15.2 31 L20 28.8 L15.4 19.2 L23.8 18.9 Z" fill="#ff5b2e" stroke="#fff" stroke-width="2.6" stroke-linejoin="round"/></svg>`; document.documentElement.appendChild(c);
      const l = document.createElement("div"); l.id = "__lbl"; document.documentElement.appendChild(l);
      addEventListener("mousemove", e => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
      addEventListener("mousedown", e => { c.classList.add("dn"); const r = document.createElement("div"); r.className = "__rip"; r.style.left = e.clientX + "px"; r.style.top = e.clientY + "px"; document.documentElement.appendChild(r); setTimeout(() => r.remove(), 800); }, true);
      addEventListener("mouseup", () => c.classList.remove("dn"), true);
      const st2 = document.createElement("style");
      st2.textContent = `.__co{position:absolute;z-index:2147483643;max-width:360px;background:#111;color:#fff;font:500 21px/1.3 system-ui,-apple-system,"Segoe UI",sans-serif;padding:13px 18px;border-radius:14px;border-left:6px solid #ff5b2e;box-shadow:0 10px 30px rgba(0,0,0,.35);pointer-events:none;opacity:0;transform:translateY(6px);transition:opacity .4s ease,transform .4s ease}
.__co.on{opacity:1;transform:none}.__co b{color:#ff9a7a;font-weight:600}
.__co:after{content:"";position:absolute;width:14px;height:14px;background:#111;transform:rotate(45deg)}
.__co.r:after{left:-9px;top:var(--ay,50%);margin-top:-7px;border-left:6px solid #ff5b2e;border-bottom:6px solid #ff5b2e;background:#111;transform:rotate(45deg);left:-12px}
.__co.l:after{right:-7px;top:var(--ay,50%);margin-top:-7px}
.__co.t:after{bottom:-7px;left:var(--ax,50%);margin-left:-7px}
.__co.b:after{top:-7px;left:var(--ax,50%);margin-left:-7px}
.__card{position:fixed;inset:0;z-index:2147483646;background:#f2f1ed;display:flex;flex-direction:column;justify-content:center;padding:0 130px;box-sizing:border-box;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;opacity:0;transition:opacity .45s ease;pointer-events:none}
.__card.on{opacity:1}.__card .k{font:600 24px system-ui,sans-serif;letter-spacing:.14em;color:#ff5b2e;margin-bottom:18px;text-transform:uppercase}.__card .t{font-size:70px;line-height:1.08;letter-spacing:-.03em;color:#000;max-width:1000px}
.__sheet{position:fixed;inset:0;z-index:2147483642;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .35s ease;pointer-events:none}
.__sheet.on{opacity:1}.__sheet .c{width:470px;background:#fff;border-radius:30px;padding:34px 34px 26px;text-align:center;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;box-shadow:0 24px 60px rgba(0,0,0,.45)}
.__sheet .ic{width:116px;height:116px;margin:0 auto 18px;border-radius:50%;background:#f2f1ed;display:grid;place-items:center;animation:__pulse 1.3s ease-in-out infinite}
.__sheet.ok .ic{background:#dff6e6;animation:none}.__sheet h4{font-size:27px;font-weight:600;margin:0 0 6px;color:#111}.__sheet p{font-size:18px;color:#555;margin:0 0 14px}.__sheet small{display:block;font-size:14px;color:#888;border-top:1px solid #eee;padding-top:12px}
.__spot.dim{box-shadow:0 0 0 9999px rgba(0,0,0,.30),0 0 22px 2px rgba(255,91,46,.45)}`;
      document.documentElement.appendChild(st2);
      window.__callout = (r, text, side, ms, maxW) => { const d = document.createElement("div"); d.className = "__co " + side; d.innerHTML = text; if (maxW) d.style.maxWidth = maxW + "px"; document.documentElement.appendChild(d);
        const bw = d.offsetWidth, bh = d.offsetHeight, sx = scrollX, sy = scrollY, vw = innerWidth; let x, y;
        if (side === "r") { x = r.x + r.width + 20; y = r.y + r.height / 2 - bh / 2; } else if (side === "l") { x = r.x - bw - 20; y = r.y + r.height / 2 - bh / 2; } else if (side === "b") { x = r.x + r.width / 2 - bw / 2; y = r.y + r.height + 18; } else { x = r.x + r.width / 2 - bw / 2; y = r.y - bh - 18; }
        const cx = Math.max(10, Math.min(vw - bw - 10, x)), cy = Math.min(innerHeight - bh - 12, Math.max(70, y));
        d.style.left = cx + sx + "px"; d.style.top = cy + sy + "px";
        if (side === "r" || side === "l") d.style.setProperty("--ay", Math.max(16, Math.min(bh - 16, r.y + r.height / 2 - cy)) + "px"); else d.style.setProperty("--ax", Math.max(18, Math.min(bw - 18, r.x + r.width / 2 - cx)) + "px");
        requestAnimationFrame(() => d.classList.add("on")); setTimeout(() => { d.classList.remove("on"); setTimeout(() => d.remove(), 450); }, ms); };
      window.__card = (kicker, title, ms) => { const d = document.createElement("div"); d.className = "__card"; d.innerHTML = `<div class="k">${kicker}</div><div class="t">${title}</div>`; document.documentElement.appendChild(d); requestAnimationFrame(() => d.classList.add("on")); setTimeout(() => { d.classList.remove("on"); setTimeout(() => d.remove(), 500); }, ms); };
      window.__sheet = ms => { const d = document.createElement("div"); d.className = "__sheet"; d.innerHTML = `<div class="c"><div class="ic"><svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="#ff5b2e" stroke-width="3.2" stroke-linecap="round"><path d="M32 8c-11 0-19 8-19 19v8"/><path d="M32 16c-7 0-12 5-12 12v10c0 5-2 8-5 11"/><path d="M32 24c-3 0-5 2-5 5v9c0 8-3 12-7 16"/><path d="M39 29v9c0 7-2 12-5 16"/><path d="M47 24v14c0 5-1 9-3 13"/><path d="M45 19c-3-6-8-9-13-9"/></svg></div><h4>Touch the fingerprint sensor</h4><p>or look at the screen. The same prompt that unlocks the phone.</p><small>Illustration of the device prompt. The test setup has no sensor, so it approves by itself.</small></div>`; document.documentElement.appendChild(d); requestAnimationFrame(() => d.classList.add("on"));
        setTimeout(() => { d.classList.add("ok"); d.querySelector("h4").textContent = "Signed"; d.querySelector("p").textContent = "These exact answers can no longer be changed."; d.querySelector("svg").outerHTML = '<svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="#1f9d55" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 34l12 12 22-26"/></svg>'; }, ms * 0.58);
        setTimeout(() => { d.classList.remove("on"); setTimeout(() => d.remove(), 400); }, ms); };
      window.__spot = (r, ms, pad, dim) => { const d = document.createElement("div"); d.className = "__spot" + (dim ? " dim" : ""); d.style.left = r.x + scrollX - pad + "px"; d.style.top = r.y + scrollY - pad + "px"; d.style.width = r.width + 2 * pad + "px"; d.style.height = r.height + 2 * pad + "px"; document.documentElement.appendChild(d); requestAnimationFrame(() => d.classList.add("on")); setTimeout(() => { d.classList.remove("on"); setTimeout(() => d.remove(), 400); }, ms); };
    };
    if (document.readyState === "loading") addEventListener("DOMContentLoaded", add); else add();
  });
  return { browser, page };
}
export const label = (page, text, test = false) => page.evaluate((t, test) => { const l = document.getElementById("__lbl"); if (!l) return; if (!t) { l.style.display = "none"; return; } l.className = test ? "test" : ""; l.innerHTML = "<i></i>" + t; l.style.display = "block"; }, text, test);

// ----- the cursor -----
let mx = 560, my = 300;
export async function moveTo(page, x, y, ms = 900) { ms = ms * PACE; const steps = Math.max(10, Math.round(ms / 16)); for (let i = 1; i <= steps; i++) { const t = i / steps, e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; await page.mouse.move(mx + (x - mx) * e, my + (y - my) * e); await sleep(ms / steps); } mx = x; my = y; }
export const restoreCursor = async page => { await page.mouse.move(mx, my); await sleep(60); await page.mouse.move(mx + 1, my + 1); };
const needsScroll = e => { const r = e.getBoundingClientRect(); return r.top < 70 || r.bottom > innerHeight - 24; };
export async function boxOf(page, sel, nth = 0, scroll = true) { const hs = await page.$$(sel); const h = hs[nth]; if (!h) throw new Error("no element " + sel + "[" + nth + "]"); if (scroll && await h.evaluate(needsScroll)) await h.evaluate(e => e.scrollIntoView({ block: "center", behavior: "instant" })); const b = await h.boundingBox(); return { h, ...b }; }
export async function pointAt(page, sel, ms = 900, nth = 0, fx = 0.5, fy = 0.5) { const b = await boxOf(page, sel, nth); await moveTo(page, b.x + b.width * fx, b.y + b.height * fy, ms); return b; }
// moves the visible cursor to the element, then clicks it where it is NOW (the layout can shift while the cursor travels)
export async function clickOn(page, sel, ms = 900, nth = 0) { const b = await pointAt(page, sel, ms, nth); await sleep(200 * PACE); const now = await b.h.boundingBox(); if (now && (Math.abs(now.x - b.x) > 3 || Math.abs(now.y - b.y) > 3)) { await moveTo(page, now.x + now.width / 2, now.y + now.height / 2, 250); } await b.h.click({ delay: 90 }); await sleep(250 * PACE); return b; }
export async function typeIn(page, sel, text, perChar = 55) { await clickOn(page, sel, 520); await page.type(sel, text, { delay: perChar * PACE }); }
// highlight an element (does not wait): everything else dims for `ms`
export async function spot(page, sel, ms = 3000, { nth = 0, pad = 10, scroll = true, dim = false } = {}) { const hs = await page.$$(sel); const h = hs[nth]; if (!h) return null; if (scroll && await h.evaluate(needsScroll)) await h.evaluate(e => e.scrollIntoView({ block: "center", behavior: "instant" })); const b = await h.boundingBox(); await page.evaluate((r, ms, pad, dim) => window.__spot && window.__spot(r, ms, pad, dim), { x: b.x, y: b.y, width: b.width, height: b.height }, ms, pad, dim); return b; }
// a speech-bubble with an arrow pointing at an element (side: where the bubble sits: r, l, t, b). Does not wait.
export async function callout(page, sel, text, { side = "r", ms = 3500, nth = 0, scroll = true, maxW = 0 } = {}) { const hs = await page.$$(sel); const h = hs[nth]; if (!h) return null; if (scroll && await h.evaluate(needsScroll)) await h.evaluate(e => e.scrollIntoView({ block: "center", behavior: "instant" })); const b = await h.boundingBox(); await page.evaluate((r, t, side, ms, w) => window.__callout && window.__callout(r, t, side, ms, w), { x: b.x, y: b.y, width: b.width, height: b.height }, text, side, ms, maxW); return b; }
// a callout at an exact spot of the page (x, y in viewport pixels) with no target element
export async function calloutAt(page, x, y, text, { side = "r", ms = 3500, w = 40, h = 40, maxW = 0 } = {}) { await page.evaluate((r, t, side, ms, mw) => window.__callout && window.__callout(r, t, side, ms, mw), { x, y, width: w, height: h }, text, side, ms, maxW); }
// a full-screen title card (kicker + title) that fades in and out; does not wait
export const titleCard = (page, kicker, title, ms = 2000) => page.evaluate((k, t, ms) => window.__card && window.__card(k, t, ms), kicker, title, ms);
// an illustration of the device's fingerprint prompt, ending in "Signed"; does not wait
export const deviceSheet = (page, ms = 2800) => page.evaluate(ms => window.__sheet && window.__sheet(ms), ms);
export async function scrollTo(page, y, ms = 2500) { ms = ms * PACE; await page.evaluate((y, ms) => new Promise(res => { const y0 = scrollY, t0 = performance.now(); const f = n => { const t = Math.min(1, (n - t0) / ms), e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; scrollTo(0, y0 + (y - y0) * e); t < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); }), y, ms); }
export async function scrollToEl(page, sel, ms = 2500, nth = 0, align = 0.38) { const y = await page.evaluate((sel, nth, align) => { const e = document.querySelectorAll(sel)[nth]; if (!e) return null; const r = e.getBoundingClientRect(); return Math.max(0, scrollY + r.top - innerHeight * align); }, sel, nth, align); if (y !== null) await scrollTo(page, y, ms); }
// change page with a short fade so the viewer can follow what happened
export async function navFade(page, fn) { await page.evaluate(() => { document.body.style.transition = "opacity .22s ease"; document.body.style.opacity = "0.12"; }); await sleep(240); await fn(); await sleep(140); await page.evaluate(() => { document.body.style.opacity = "1"; }); await sleep(420); }
export async function waitText(page, re, ms = 30000, sel = "body") { const t = Date.now(); while (Date.now() - t < ms) { const s = await page.$eval(sel, e => e.innerText).catch(() => ""); if (re.test(s)) return true; await sleep(250); } return false; }

// ----- the timeline: when each sentence is spoken, relative to the start of its scene -----
export const TAIL = 1.2;   // each scene is on screen `lead` seconds (see narration.json) before the narrator speaks about it, so a title card can show first
export function timeline(dir = "out") {
  const sc = JSON.parse(fs.readFileSync(dir + "/scenes.json", "utf8")), se = JSON.parse(fs.readFileSync(dir + "/sentences.json", "utf8")), nar = JSON.parse(fs.readFileSync(new URL("./narration.json", import.meta.url), "utf8")).scenes;
  const lead = nar.map(n => n.lead ?? 0.6), norm = s => s.split(/\s+/).join(" ").toLowerCase(), starts = [0, ...sc.slice(1).map(s => s.start)], out = {}, audioEnd = se[se.length - 1].end + 0.3;
  sc.forEach((s, i) => {
    const D = i < sc.length - 1 ? starts[i + 1] - starts[i] + lead[i] - lead[i + 1] : audioEnd - starts[i] + lead[i] + TAIL;
    out[s.id] = { D, lead: lead[i], S: se.filter(x => x.start >= starts[i] - 1e-6 && (i === sc.length - 1 || x.start < starts[i + 1] - 1e-6) && norm(nar[i].text).includes(norm(x.text).slice(0, 30))).map(x => ({ t0: x.start - starts[i] + lead[i], t1: x.end - starts[i] + lead[i], text: x.text })) };
  });
  return out;
}
// Records one scene for exactly as long as its narration. fn gets {at, S, D}: `await at(t)` waits until t seconds into the scene.
let _t0 = 0, _marks = [], _cut = 0;   // _cut: seconds of waiting the assembly will remove so far
// Wrap any real waiting (a transaction, a page load) in dead(): the assembly cuts it out of the video, keeping half a second of it.
export async function dead(fn) { const a = (Date.now() - _t0) / 1000; const r = await fn(); const b = (Date.now() - _t0) / 1000; _marks.push([+a.toFixed(2), +b.toFixed(2)]); if (b - a > 0.9) _cut += b - a - 0.7; return r; }
export async function scene(page, id, tl, fn, outDir = "out/clips") {
  const T = tl[id]; if (!T) throw new Error("no scene " + id); fs.mkdirSync(outDir, { recursive: true });
  console.log("recording", id, "for", T.D.toFixed(1), "s");
  const rec = await page.record({ path: `${outDir}/${id}.mp4`, maxWidth: 1280, maxHeight: 720, fps: 24 }); const t0 = Date.now(); _t0 = t0; _marks = []; _cut = 0;
  // Beats are scheduled on the narration timeline. If an action takes longer than planned, everything after it moves back by the same amount
  // (`shift`), and the assembly makes the voice wait that long too, so the screen and the voice stay in step however long an action takes.
  let shift = 0;
  const at = async t => { const target = t + shift, wait = target * 1000 - (Date.now() - t0 - _cut * 1000); if (wait > 0) await sleep(wait); const late = (Date.now() - t0) / 1000 - _cut - target; if (late > 0.15) { shift += late; if (late > 0.6) console.log(`   beat at ${t.toFixed(1)}s: screen was ${late.toFixed(1)}s behind, voice will wait`); } return late; };
  const beats = {}; const beat = async (i, off = 0) => { await at(T.S[i].t0 + off); if (off <= 1.2 && !(i in beats)) beats[i] = +shift.toFixed(2); };
  try { await fn({ at, beat, S: T.S, D: T.D }); await at(T.D); beats.end = +shift.toFixed(2); } finally { await rec.stop(); }
  { const bf = outDir + "/beats.json", bk = fs.existsSync(bf) ? JSON.parse(fs.readFileSync(bf, "utf8")) : {}; bk[id] = beats; fs.writeFileSync(bf, JSON.stringify(bk)); }
  const mf = outDir + "/marks.json", mk = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, "utf8")) : {}; mk[id] = _marks; fs.writeFileSync(mf, JSON.stringify(mk));
  const secs = (Date.now() - t0) / 1000, f = outDir + "/durations.json", d = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {}; d[id] = +secs.toFixed(1); fs.writeFileSync(f, JSON.stringify(d, null, 1)); console.log("  ", id, secs.toFixed(1), "s");
}
