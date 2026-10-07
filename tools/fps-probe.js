/* 真实帧率与画质探针 —— **走真实 game.loop**（不绕过计时）。
   `_autoQuality` 只在 `loop()` 里跑；直接调 `sc.render` 测不到它的行为。
   本探针让游戏自己跑，只做观察与记录。

   用法：
     node tools/fps-probe.js                       # 默认场景，4 秒
     node tools/fps-probe.js town,field 5
   env：
     UNLOCK_FPS=1   解锁 rAF 帧率上限（测"我们自己的天花板"；默认受屏幕刷新率限制）
     FIX_S=4        固定倍率（测各档画质/性能对比）
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 9357;
const SCENES = process.argv[2] ? process.argv[2].split(',') : ['town', 'field', 'fan5', 'battle'];
const DUR = process.argv[3] ? +process.argv[3] : 4;
const FIX_S = process.env.FIX_S ? +process.env.FIX_S : 0;
const URL = process.env.PROBE_URL || 'http://127.0.0.1:8173/index.html';
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].find((p) => fs.existsSync(p));
if (!CHROME) { console.error('找不到 Chrome/Edge'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function httpJson(p) { const r = await fetch('http://127.0.0.1:' + PORT + p); return r.json(); }
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0; const pending = new Map();
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id); pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      }
    };
    ws.onerror = (e) => reject(new Error('WebSocket 错误: ' + (e.message || '')));
    ws.onopen = () => resolve({
      send(method, params) {
        const mid = ++id;
        return new Promise((res, rej) => { pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); });
      },
      close() { try { ws.close(); } catch (e) {} }
    });
  });
}

function driver(sceneName) {
  return `(async function () {
    var G = window.G;
    var t0 = Date.now();
    while (!G.Assets.ready && Date.now() - t0 < 12000) await new Promise(function (r) { setTimeout(r, 50); });
    try { if (G.Cutscene && G.Cutscene.dom) G.Cutscene.dom.style.display = 'none'; } catch (e) {}
    G.game.meta = { past: [], progress: { worlds: { ling: true, xian: true, dao: true } }, hellCleared: {}, titles: [], perfusion: {}, achieve: {} };
    G.game.save = {
      life: 1, worldSeed: 12345, world: G.Data.generateWorld(12345, true),
      linggen: { elems: ['木'], coef: { '木': 1.2 } }, talents: [], skills: {}, skillEquip: [],
      items: {}, stone: 500, qi: 1200, po: 30, globalLevel: 200, age: 30,
      wildKills: 99, side: {}, visited: {}, quest: { step: 'm1done', flags: {} },
      chestsOpened: [], pos: null, hp: 900, map: 'town'
    };
    (G.Data.StoryEvents.list || []).forEach(function (e) { G.game.save.quest.flags['se_' + e.id] = true; });
    G.game.changeScene('${sceneName}', { toSpawn: true });
    await new Promise(function (r) { setTimeout(r, 300); });
    var sc = G.game.scene;
    sc.clearOverlay && sc.clearOverlay();
    if (G.Story && G.Story._cur) G.Story._cur = null;
    ${FIX_S ? `G.game.MIN_S = ${FIX_S}; G.game.MAX_S = ${FIX_S}; G.game._setS(${FIX_S});` : ''}
    /* 走真实 rAF，只记录 —— 让 game.loop 自己跑 _autoQuality */
    var frames = 0, t1 = performance.now(), worst = 0, last = t1, sHist = [];
    await new Promise(function (done) {
      function tick() {
        requestAnimationFrame(tick);
        var now = performance.now();
        var d = now - last; last = now;
        if (frames > 2 && d > worst) worst = d;
        frames++;
        if (frames % 30 === 0) sHist.push(G.game.S);
        if (now - t1 >= ${DUR * 1000}) done();
      }
      requestAnimationFrame(tick);
    });
    var el = (performance.now() - t1) / 1000;
    return JSON.stringify({
      scene: '${sceneName}', fps: +(frames / el).toFixed(1),
      worstMs: +worst.toFixed(1), S: G.game.S, MIN_S: G.game.MIN_S, MAX_S: G.game.MAX_S,
      drawEma: +(G.game._drawMsEma * 1000).toFixed(2),
      cw: G.game.canvas.width, sHist: sHist.slice(0, 8).join('>')
    });
  })()`;
}

(async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-fps-'));
  const args = ['--headless=new', '--no-sandbox', '--hide-scrollbars',
    '--window-size=1920,1080', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, 'about:blank'];
  if (process.env.UNLOCK_FPS) args.push('--disable-frame-rate-limit', '--disable-gpu-vsync');
  const chrome = spawn(CHROME, args, { stdio: 'ignore' });
  let client;
  try {
    let ver = null;
    for (let i = 0; i < 60; i++) { try { ver = await httpJson('/json/version'); break; } catch (e) { await sleep(250); } }
    if (!ver) throw new Error('CDP 未就绪');
    const list = await httpJson('/json/list');
    const page = list.find((t) => t.type === 'page');
    client = await connect(page.webSocketDebuggerUrl);
    await client.send('Page.enable'); await client.send('Runtime.enable');
    await client.send('Page.navigate', { url: URL });
    await sleep(2500);
    await client.send('Runtime.evaluate', { expression: 'window.dispatchEvent(new Event("resize"))' });
    await sleep(400);

    console.log('（' + (process.env.UNLOCK_FPS ? '已解锁帧率上限' : '默认 rAF') 
      + (FIX_S ? ' / 固定 S=' + FIX_S : '') + '，跑 ' + DUR + 's）');
    console.log('场景          FPS   最差帧  绘制EMA  倍率S  画布        S轨迹');
    for (const sc of SCENES) {
      const r = await client.send('Runtime.evaluate', { expression: driver(sc), awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) { console.log('  ✗ ' + sc + ': ' + JSON.stringify((r.exceptionDetails.exception || {}).description || r.exceptionDetails)); continue; }
      const rep = JSON.parse(r.result.value);
      console.log('  ' + rep.scene.padEnd(10) + String(rep.fps).padStart(6) + '  '
        + String(rep.worstMs).padStart(6) + '  ' + String(rep.drawEma).padStart(7) + 'ms  '
        + String(rep.S).padStart(4) + '  ' + (rep.cw + 'px').padEnd(10) + ' ' + rep.sHist);
    }
  } catch (e) { console.error('失败：' + e.message); process.exitCode = 1; }
  finally { if (client) client.close(); chrome.kill(); await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
})();
