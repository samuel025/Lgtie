// Shared helpers for recording the demo video with puppeteer: a visible cursor, a label pill, smooth scrolling, human-paced clicks and typing.
// Kept light on purpose: one headless Chrome, 1280x720, 24 fps.
import puppeteer from "puppeteer-core"; import fs from "node:fs";
export const W = 1280, H = 720, sleep = ms => new Promise(r => setTimeout(r, ms));
export async function launch(extraArgs = []) {
  const exe = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(p => fs.existsSync(p));
  const browser = await puppeteer.launch({ executablePath: exe, args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--disable-extensions", "--disable-background-networking", `--window-size=${W},${H}`, ...extraArgs] });
  const page = await browser.newPage(); await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => {
    // a visible cursor with a click ripple, and a small label pill
    const add = () => {
      if (document.getElementById("__cur")) return;
      const st = document.createElement("style");
      st.textContent = "#__cur{position:fixed;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;background:rgba(255,91,46,.28);border:2px solid #ff5b2e;pointer-events:none;z-index:2147483647;transition:transform .12s ease-out, background .12s}#__cur.dn{transform:scale(.7)!important;background:rgba(255,91,46,.7)}#__lbl{position:fixed;left:18px;top:76px;z-index:2147483646;background:rgba(17,17,17,.88);color:#fff;font:500 14px system-ui,sans-serif;padding:8px 14px;border-radius:999px;pointer-events:none;letter-spacing:.01em;display:none}#__lbl i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;background:#3ddc84}#__lbl.test i{background:#ffb020}";
      document.documentElement.appendChild(st);
      const c = document.createElement("div"); c.id = "__cur"; document.documentElement.appendChild(c);
      const l = document.createElement("div"); l.id = "__lbl"; document.documentElement.appendChild(l);
      addEventListener("mousemove", e => { c.style.left = e.clientX + "px"; c.style.top = e.clientY + "px"; }, true);
      addEventListener("mousedown", () => c.classList.add("dn"), true); addEventListener("mouseup", () => c.classList.remove("dn"), true);
    };
    if (document.readyState === "loading") addEventListener("DOMContentLoaded", add); else add();
  });
  return { browser, page };
}
export const label = (page, text, test = false) => page.evaluate((t, test) => { const l = document.getElementById("__lbl"); if (!l) return; if (!t) { l.style.display = "none"; return; } l.className = test ? "test" : ""; l.innerHTML = "<i></i>" + t; l.style.display = "block"; }, text, test);
let mx = 640, my = 360;
export async function moveTo(page, x, y, ms = 650) { const steps = Math.max(8, Math.round(ms / 16)); for (let i = 1; i <= steps; i++) { const t = i / steps, e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; await page.mouse.move(mx + (x - mx) * e, my + (y - my) * e); await sleep(ms / steps); } mx = x; my = y; }
export async function center(page, sel) { const h = await page.$(sel); if (!h) throw new Error("no element " + sel); await h.evaluate(e => e.scrollIntoView({ block: "center", behavior: "instant" })); const b = await h.boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; }
export async function clickOn(page, sel, ms = 650, after = 300) { const { x, y } = await center(page, sel); await moveTo(page, x, y, ms); await sleep(120); await page.mouse.down(); await sleep(70); await page.mouse.up(); await sleep(after); }
export async function clickAt(page, x, y, ms = 650, after = 300) { await moveTo(page, x, y, ms); await sleep(120); await page.mouse.down(); await sleep(70); await page.mouse.up(); await sleep(after); }
export async function typeIn(page, sel, text, perChar = 45) { await clickOn(page, sel, 500, 150); await page.type(sel, text, { delay: perChar }); }
export async function scrollTo(page, y, ms = 1800) { await page.evaluate((y, ms) => new Promise(res => { const y0 = scrollY, t0 = performance.now(); const f = n => { const t = Math.min(1, (n - t0) / ms), e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; scrollTo(0, y0 + (y - y0) * e); t < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); }), y, ms); }
export async function waitText(page, re, ms = 30000, sel = "body") { const t = Date.now(); while (Date.now() - t < ms) { const s = await page.$eval(sel, e => e.innerText).catch(() => ""); if (re.test(s)) return true; await sleep(250); } return false; }
export async function record(page, path) { const rec = await page.record({ path, maxWidth: W, maxHeight: H, fps: 24 }); const t0 = Date.now(); return { stop: async () => { await rec.stop(); return (Date.now() - t0) / 1000; } }; }
