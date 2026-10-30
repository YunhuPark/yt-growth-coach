// Takes the real screenshots shown on the landing page (public/shots/*.webp) from the running app, using a local Chrome over the
// DevTools protocol (Node's built-in WebSocket, so no extra packages). Run the dev server first (npm run dev), then:
//
//   node scripts/capture-shots.mjs <a video file with some pauses in its sound> [outDir]
//
// A test video that works: ffmpeg -f lavfi -i "color=c=0x2a3a4a:s=1280x720:r=25:d=20" -f lavfi -i "sine=frequency=220:duration=20" //   -af "volume='if(lt(mod(t,4),2.2),0.5,0)':eval=frame" -shortest -pix_fmt yuv420p talk.mp4
// Set BEAT_VIDEO to a video with music of a steady beat (a drum loop from ffmpeg is enough) to also take the beat tool's screen.
// Set CHROME_PATH if Chrome is not in its usual place on Windows. Use a video you own: it shows in the screenshots only as a file name.
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const [videoPath, outDirArg] = process.argv.slice(2);
const outDir = outDirArg ?? "public/shots";
if (!videoPath) throw new Error("usage: node scripts/capture-shots.mjs <video> [outDir]");
const beatVideo = process.env.BEAT_VIDEO;
const CHROME = process.env.CHROME_PATH ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PORT = 9333;
const profile = mkdtempSync(path.join(tmpdir(), "cap-"));
mkdirSync(outDir, { recursive: true });

const chrome = spawn(CHROME, ["--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--hide-scrollbars", "--force-color-profile=srgb", "--no-first-run", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pageSocket() {
  for (let i = 0; i < 50; i++) {
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
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && waiting.has(d.id)) {
    const { res, rej } = waiting.get(d.id);
    waiting.delete(d.id);
    if (d.error) rej(new Error(d.error.message));
    else res(d.result);
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

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 2, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });

const goto = async (url) => {
  await send("Page.navigate", { url });
  await sleep(2500);
};
const HELPERS = `
  window.__click = (t) => { const b = [...document.querySelectorAll('button')].find(b => b.textContent.includes(t) && !b.closest('[hidden]')); if (!b) throw new Error('no button: ' + t); b.click(); };
  window.__setInput = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })); };
  window.__setSelect = (el, text) => { const o = [...el.options].find(o => o.textContent.includes(text)); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, o.value); el.dispatchEvent(new Event('change', { bubbles: true })); };
  document.querySelector('nextjs-portal')?.remove();
  document.querySelector('header.sticky')?.style.setProperty('display', 'none');
  true`;

/** Saves a webp of the box `top..top+height` (page coordinates), as wide as the main column. */
const shot = async (name, rect) => {
  const r = await send("Page.captureScreenshot", { format: "webp", quality: 88, captureBeyondViewport: true, clip: { ...rect, scale: 1 } });
  const file = path.join(outDir, `${name}.webp`);
  writeFileSync(file, Buffer.from(r.data, "base64"));
  console.log(name, Buffer.from(r.data, "base64").length, "bytes", JSON.stringify(rect));
};
const boxOf = (js) => evaluate(`(() => { const el = ${js}; const r = el.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height }; })()`);

try {
  await goto("http://localhost:3000/edit");
  await evaluate(HELPERS);

  // 1. choosing a task
  await evaluate(`__click('무음·군말 자르기'); true`);
  await sleep(400);
  const main = await boxOf(`document.querySelector('main')`);
  const cards = await boxOf(`document.querySelector('main section:not([hidden]) .grid')`);
  await shot("task", { x: main.x, y: main.y, width: main.width, height: cards.y + cards.height - main.y + 8 });

  // 2. video, then the finishing options
  await evaluate(`__click('다음: 영상 올리기'); true`);
  await sleep(500);
  await evaluate(`document.querySelector('#step-source details summary').click(); true`);
  await sleep(300);
  await evaluate(`__setInput(document.querySelector('#step-source input[placeholder]'), ${JSON.stringify(videoPath)}); true`);
  await evaluate(`__setSelect(document.querySelector('#step-source select'), '직접 촬영'); true`);
  await sleep(200);
  await evaluate(`document.querySelector('#step-source input[type=checkbox]').click(); true`);
  await sleep(500);
  await evaluate(`__click('다음: 꾸미기'); true`);
  await sleep(1200);
  const mainB = await boxOf(`document.querySelector('main')`);
  const first = await boxOf(`document.querySelector('main section:not([hidden]) .card')`);
  await shot("style", { x: mainB.x, y: mainB.y, width: mainB.width, height: first.y + first.height - mainB.y + 8 });

  // 3. a real result: the sound of the test video analysed on this computer
  await evaluate(`__click('다음: 만들기'); true`);
  await sleep(700);
  await evaluate(`__click('소리 분석하기'); true`);
  for (let i = 0; i < 200; i++) {
    await sleep(500);
    if (await evaluate(`document.body.innerText.includes('줄어듦')`)) break;
  }
  await sleep(500);
  const result = await boxOf(`[...document.querySelectorAll('p')].find(p => p.textContent.startsWith('원본 ')).closest('[class*="rounded"]')`);
  await shot("cut", { x: result.x, y: result.y, width: result.width, height: Math.min(result.height, 640) });

  // 4. the beat tool, with the beats of the music found on this computer
  if (beatVideo) {
    await goto("http://localhost:3000/edit");
    await evaluate(HELPERS);
    await evaluate(`__click('박자에 맞춰 효과 넣기'); true`);
    await sleep(400);
    await evaluate(`__click('다음: 영상 올리기'); true`);
    await sleep(500);
    await evaluate(`document.querySelector('#step-source details summary').click(); true`);
    await sleep(300);
    await evaluate(`__setInput(document.querySelector('#step-source input[placeholder]'), ${JSON.stringify(beatVideo)}); true`);
    await evaluate(`__setSelect(document.querySelector('#step-source select'), '직접 촬영'); true`);
    await sleep(200);
    await evaluate(`document.querySelector('#step-source input[type=checkbox]').click(); true`);
    await sleep(500);
    await evaluate(`__click('다음: 꾸미기'); true`);
    await sleep(800);
    await evaluate(`__click('다음: 만들기'); true`);
    await sleep(700);
    await evaluate(`__click('박자 찾기'); true`);
    for (let i = 0; i < 120; i++) {
      await sleep(500);
      if (await evaluate(`document.body.innerText.includes('BPM')`)) break;
    }
    await sleep(500);
    const card = await boxOf(`document.querySelector('main section:not([hidden]) .card')`);
    await shot("beats", { x: card.x, y: card.y, width: card.width, height: Math.min(card.height, 1100) });
  }
} finally {
  ws.close();
  chrome.kill();
}
