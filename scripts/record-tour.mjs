// Records a silent tour of the running app (npm run dev, http://localhost:3000) in a local Chrome over the DevTools protocol: real mouse
// events, a drawn cursor and click ripples. Long waits are marked so assemble-tour.mjs can speed them up.
//
//   node scripts/record-tour.mjs <a video with speech in it> [outDir]
//
// The video is chosen as a file, so no path of this computer shows in the picture. It runs the silence and filler cut, then the AI
// shorts picker (that one calls the AI service once and costs a little). Set CHROME_PATH if Chrome is not in its usual place.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const [videoArg, outArg] = process.argv.slice(2);
if (!videoArg) throw new Error("usage: node scripts/record-tour.mjs <video> [outDir]");
const OUT = path.resolve(outArg ?? "tour-work");
const VIDEO = path.resolve(videoArg);
const BASE = "http://localhost:3000";
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9336;
const W = 1280;
const H = 720;

const framesDir = path.join(OUT, "frames");
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

const profile = mkdtempSync(path.join(tmpdir(), "tour-"));
const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--force-color-profile=srgb", "--no-first-run", `--window-size=${W},${H}`, "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageSocket() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const p = list.find((t) => t.type === "page");
      if (p) return p.webSocketDebuggerUrl;
    } catch {}
    await sleep(200);
  }
  throw new Error("Chrome did not start");
}

const ws = new WebSocket(await pageSocket());
await new Promise((r) => (ws.onopen = r));
let id = 0;
const waiting = new Map();
const frames = []; // { n, t }
let frameN = 0;
let recording = false;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && waiting.has(d.id)) {
    const { res, rej } = waiting.get(d.id);
    waiting.delete(d.id);
    if (d.error) rej(new Error(d.error.message));
    else res(d.result);
  } else if (d.method === "Page.screencastFrame") {
    const t = Date.now() / 1000;
    send("Page.screencastFrameAck", { sessionId: d.params.sessionId }).catch(() => {});
    if (!recording) return;
    const n = frameN++;
    writeFileSync(path.join(framesDir, `f${String(n).padStart(6, "0")}.jpg`), Buffer.from(d.params.data, "base64"));
    frames.push({ n, t });
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    waiting.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "evaluate failed");
  return r.result.value;
};

const marks = []; // { from, to, speed } in epoch seconds
let markStart = null;
const fastStart = () => (markStart = Date.now() / 1000);
const fastEnd = (speed) => {
  marks.push({ from: markStart, to: Date.now() / 1000, speed });
  markStart = null;
};

await send("Page.enable");
await send("DOM.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });

const OVERLAY = `(() => {
  if (window.__cur) return true;
  const st = document.createElement('style');
  st.textContent = 'nextjs-portal{display:none!important}';
  document.documentElement.appendChild(st);
  const c = document.createElement('div');
  c.style.cssText = 'position:fixed;left:0;top:0;width:24px;height:24px;z-index:2147483647;pointer-events:none;transition:transform .6s cubic-bezier(.4,0,.2,1);transform:translate(640px,380px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))';
  c.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M3 2l7 18 2.5-7.5L20 10z" fill="#14130f" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  document.documentElement.appendChild(c);
  window.__cur = c;
  window.__moveCur = (x, y) => { c.style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
  window.__ripple = (x, y) => {
    const r = document.createElement('div');
    r.style.cssText = 'position:fixed;left:' + (x - 20) + 'px;top:' + (y - 20) + 'px;width:40px;height:40px;border-radius:50%;border:3px solid #f2c200;z-index:2147483646;pointer-events:none;opacity:.95;transition:transform .5s ease-out,opacity .5s ease-out';
    document.documentElement.appendChild(r);
    requestAnimationFrame(() => { r.style.transform = 'scale(1.9)'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 700);
  };
  window.__setSelect = (el, v) => { Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('change', { bubbles: true })); };
  return true;
})()`;

const btn = (t) => `[...document.querySelectorAll('button')].find(b => b.textContent.includes(${JSON.stringify(t)}) && !b.closest('[hidden]'))`;
const anchor = (t) => `[...document.querySelectorAll('a')].find(a => a.textContent.includes(${JSON.stringify(t)}) && a.offsetParent)`;

async function where(expr) {
  const p = await evaluate(`(() => { const el = ${expr}; if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  if (!p) throw new Error("not found: " + expr.slice(0, 90));
  return p;
}
const mouse = (type, p, extra = {}) => send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1, ...extra });
async function click(expr, after = 800) {
  const p = await where(expr);
  await evaluate(`__moveCur(${p.x}, ${p.y})`);
  await sleep(750);
  await mouse("mouseMoved", p, { button: "none", clickCount: 0 });
  await sleep(250);
  await evaluate(`__ripple(${p.x}, ${p.y})`);
  await mouse("mousePressed", p);
  await mouse("mouseReleased", p);
  await sleep(after);
}
async function waitText(re, ms, every = 500) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await evaluate(`new RegExp(${JSON.stringify(re)}).test(document.body.innerText)`)) return true;
    await sleep(every);
  }
  throw new Error("timeout waiting for " + re);
}
const scroll = (y) => evaluate(`window.scrollBy({ top: ${y}, behavior: 'smooth' })`);

try {
  await send("Page.navigate", { url: BASE + "/" });
  await sleep(2500);
  await evaluate(OVERLAY);
  recording = true;
  await send("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await sleep(1500);

  // 1. the front page, then in
  await click(anchor("지금 시작하기"), 1800);
  await evaluate(OVERLAY);

  // 2. pick a task
  await click(btn("무음·군말 자르기"), 900);
  await click(btn("다음: 영상 올리기"), 1000);

  // 3. the video: chosen as a file (so no path of this computer is shown)
  const doc = await send("DOM.getDocument", { depth: -1 });
  const inp = await send("DOM.querySelector", { nodeId: doc.root.nodeId, selector: "#step-source input[type=file]" });
  await send("DOM.setFileInputFiles", { nodeId: inp.nodeId, files: [VIDEO] });
  await sleep(1200);
  const sel = await where("document.querySelector('#step-source select')");
  await evaluate(`__moveCur(${sel.x}, ${sel.y})`);
  await sleep(800);
  await evaluate(`__ripple(${sel.x}, ${sel.y}); __setSelect(document.querySelector('#step-source select'), 'own_footage')`);
  await sleep(700);
  await click("document.querySelector('#step-source input[type=checkbox]')", 900);
  await click(btn("다음: 꾸미기"), 1100);

  // 4. how it looks: pick a caption style
  await click("[...document.querySelectorAll('button[aria-pressed]')].filter(b => !b.closest('[hidden]') && b.querySelector('img'))[1]", 1300);
  await click(btn("다음: 만들기"), 1000);

  // 5. run: silences and filler words
  await click("[...document.querySelectorAll('input[type=checkbox]')].filter(c => !c.closest('[hidden]')).find(c => c.parentElement.innerText.includes('군말 찾기'))", 700);
  await click(btn("소리 분석하기"), 400);
  fastStart();
  await waitText("줄어듦", 240000);
  fastEnd(9);
  await sleep(1200);
  await scroll(420);
  await sleep(1800);
  await scroll(-420);
  await sleep(900);
  await click(btn("이 컷으로 영상 만들기"), 300);
  fastStart();
  await evaluate("new Promise(r => { const t = setInterval(() => { const v = [...document.querySelectorAll('video')].filter(e => !e.closest('[hidden]')).pop(); if (v && v.duration) { clearInterval(t); r(true); } }, 300); })");
  fastEnd(4);
  await evaluate("(() => { const v = [...document.querySelectorAll('video')].filter(e => !e.closest('[hidden]')).pop(); v.scrollIntoView({ block: 'center', behavior: 'smooth' }); v.muted = true; v.play(); })()");
  await sleep(4200);

  // 6. a second task: the AI picks the shorts
  await evaluate("window.scrollTo({ top: 0, behavior: 'smooth' })");
  await sleep(900);
  await click("[...document.querySelectorAll('nav button, ol button, button')].find(b => b.textContent.trim().includes('작업 고르기') && !b.closest('[hidden]'))", 900);
  await click(btn("긴 영상에서 쇼츠 뽑기"), 800);
  await click(btn("다음: 영상 올리기"), 700);
  await click(btn("다음: 꾸미기"), 700);
  await click(btn("다음: 만들기"), 900);
  const topic = "[...document.querySelectorAll('input:not([type=checkbox])')].filter(i => !i.closest('[hidden]')).find(i => i.closest('label')?.innerText.includes('주제'))";
  await click(topic, 300);
  await send("Input.insertText", { text: "집에서 커피 내리기" });
  await sleep(900);
  await click(btn("쇼츠 구간 찾기"), 400);
  fastStart();
  await waitText("추천 쇼츠", 300000);
  fastEnd(10);
  await sleep(1300);
  await scroll(520);
  await sleep(2000);
  await scroll(-520);
  await sleep(700);
  await click(btn("이 구간으로 쇼츠 만들기"), 300);
  fastStart();
  await evaluate("new Promise(r => { const t = setInterval(() => { const vs = [...document.querySelectorAll('video')].filter(e => !e.closest('[hidden]')); const v = vs[vs.length - 1]; if (v && v.duration) { clearInterval(t); r(true); } }, 300); })");
  fastEnd(4);
  await evaluate("(() => { const vs = [...document.querySelectorAll('video')].filter(e => !e.closest('[hidden]')); const v = vs[vs.length - 1]; v.scrollIntoView({ block: 'center', behavior: 'smooth' }); v.muted = true; v.play(); })()");
  await sleep(4500);
} finally {
  recording = false;
  try { await send("Page.stopScreencast"); } catch {}
  writeFileSync(path.join(OUT, "frames.json"), JSON.stringify({ frames, marks }));
  ws.close();
  chrome.kill();
  console.log("frames:", frames.length, "marks:", marks.length);
}
