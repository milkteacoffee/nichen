/* 入世成长演出三拍**真实截图**（6/10/16 岁）。
   为什么不用 shot.js：shot.js 顺序执行全部 step，前面的过场（cutscene DOM 层）
   会盖在画布上，拍到的是过场而不是演出。这里独立起浏览器、直接进演出拍三张。

   用法：node tools/age-stage-shot.js [输出目录]
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', '_shots');
const PORT = 9346;
const URL = process.env.PROBE_URL || 'http://127.0.0.1:8173/index.html';
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find((p) => fs.existsSync(p));
if (!CHROME) { console.error('找不到 Chrome/Edge'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function httpJson(p) {
  const r = await fetch('http://127.0.0.1:' + PORT + p);
  return r.json();
}
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    };
    ws.onerror = (e) => reject(new Error('WebSocket 错误: ' + (e.message || '')));
    ws.onopen = () => resolve({
      send(method, params) {
        const mid = ++id;
        return new Promise((res, rej) => {
          pending.set(mid, { res, rej });
          ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
        });
      },
      close() { try { ws.close(); } catch (e) {} }
    });
  });
}

/* 进入演出并停在指定拍的 60% 处（人物完全显出、走帧已开始、光柱仍亮）。 */
function driverFor(stage) {
  return `(async function () {
    var G = window.G;
    var t0 = Date.now();
    while (!G.Assets.ready && Date.now() - t0 < 10000) await new Promise(function (r) { setTimeout(r, 50); });
    /* 关掉任何可能存在的过场 DOM 层 */
    try { if (G.Cutscene && G.Cutscene.dom) G.Cutscene.dom.style.display = 'none'; } catch (e) {}
    G.game.save = null;
    if (G.game.sceneName !== 'reincarnation') G.game.changeScene('reincarnation');
    await new Promise(function (r) { setTimeout(r, 250); });
    var R = G.game.scene;
    R.step = 'grow'; R.grow = ${stage}; R.growT = (R.GROW_DUR || 1) * 0.6; R._growSkip = false;
    if (R._buildButtons) R._buildButtons();
    /* 走几帧让光柱/影/进度点都进入稳态 */
    for (var i = 0; i < 6; i++) { R.update(0.01); R.render(G.game.ctx); }
    return JSON.stringify({
      ok: true, scene: G.game.sceneName, step: R.step, grow: R.grow,
      age: [6, 10, 16][R.grow],
      hasAsset: G.Sprites.ageStageHasAsset ? G.Sprites.ageStageHasAsset([6,10,16][R.grow]) : null
    });
  })()`;
}

(async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-ageshot-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--hide-scrollbars', '--window-size=1280,720', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  let client;
  try {
    let ver = null;
    for (let i = 0; i < 60; i++) {
      try { ver = await httpJson('/json/version'); break; } catch (e) { await sleep(250); }
    }
    if (!ver) throw new Error('CDP 端口未就绪');
    const target = await httpJson('/json/list');
    const page = target.find((t) => t.type === 'page');
    client = await connect(page.webSocketDebuggerUrl);
    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Page.navigate', { url: URL });
    await sleep(2500);

    const names = ['6y', '10y', '16y'];
    for (let st = 0; st < 3; st++) {
      const r = await client.send('Runtime.evaluate', {
        expression: driverFor(st), awaitPromise: true, returnByValue: true
      });
      if (r.exceptionDetails) throw new Error('驱动抛错：' + JSON.stringify(r.exceptionDetails.exception));
      const rep = JSON.parse(r.result.value);
      const shot = await client.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, '71_grow_' + names[st] + '.png');
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log('  ✓ ' + names[st] + '（' + rep.age + ' 岁）素材=' + (rep.hasAsset ? '✅' : '— 程序化')
        + '  → ' + path.basename(file));
    }
  } catch (e) {
    console.error('失败：' + e.message);
    process.exitCode = 1;
  } finally {
    if (client) client.close();
    chrome.kill();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
})();
