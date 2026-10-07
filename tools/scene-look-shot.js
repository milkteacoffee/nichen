/* 多场景观感**真实截图**（独立会话，避免 scene 单例复用）。

   为什么另写一个：`shot.js` 顺序执行全部 step 会超时；而上一版
   `region-look-shot.js` 用同一个页面连切三张图，结果三张拍成同一个场景
   —— 场景是**单例**，`changeScene` 复用同一个对象，切图后
   `mapZoom/mapPan/相机` 等外部状态还留着旧场景的。

   这里**每张图重新导航一次**（`Page.navigate`），保证是全新会话。

   用法：node tools/scene-look-shot.js [输出目录] [区域id...]
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', '_shots');
const REGIONS = process.argv.slice(3).length ? process.argv.slice(3)
  : ['fan5', 'fan1', 'fan2', 'ling1', 'xian1'];
const PORT = 9351;
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

/* 造一个"已到后期但当前区域刚进"的存档，站到出生点，渲染一帧。 */
function driverFor(rid) {
  return `(async function () {
    var G = window.G;
    var t0 = Date.now();
    while (!G.Assets.ready && Date.now() - t0 < 12000) await new Promise(function (r) { setTimeout(r, 50); });
    try { if (G.Cutscene && G.Cutscene.dom) G.Cutscene.dom.style.display = 'none'; } catch (e) {}
    var sv = {
      life: 1, worldSeed: 12345, world: G.Data.generateWorld(12345, true),
      linggen: { elems: ['木'], coef: { '木': 1.2 } }, talents: [],
      skills: {}, skillEquip: [], items: {}, stone: 500, qi: 1200, po: 30,
      globalLevel: 200, maxGlobalLevel: 200, age: 30, wildKills: 999,
      side: {}, visited: {}, quest: { step: 'm1done', flags: {} }, pos: null, hp: 900,
      chestsOpened: [], dungeonSlot: 1, beasts: {}
    };
    sv.visited['${rid}'] = true;
    /* ⚠️ 机缘事件每帧由 pendingFor 重触发，清 overlay 治不了本 ——
       必须把它的**数据源**（save.quest.flags['se_<id>']）全标为已看过。 */
    (G.Data.StoryEvents.list || []).forEach(function (e) { sv.quest.flags['se_' + e.id] = true; });
    G.game.save = sv;
    G.game.meta = { past: [], progress: { worlds: { ling: true, xian: true } } };
    var isMap = !!(G.Data.maps['${rid}'] && G.Data.maps['${rid}'].w);
    if (isMap) {
      G.game.changeScene('${rid}', { toSpawn: true });
    } else {
      G.game.changeScene('${rid}', { toSpawn: true });
    }
    await new Promise(function (r) { setTimeout(r, 500); });
    var sc = G.game.scene, m = sc.map;
    if (!sv.pos) sv.pos = (m && m.spawn) ? { x: m.spawn.x, y: m.spawn.y } : { x: 5, y: 5 };
    sc.clearOverlay && sc.clearOverlay();
    if (G.Story && G.Story._cur) G.Story._cur = null;
    if (sc._storyEv) sc._storyEv = null;
    G.game.toasts && (G.game.toasts.length = 0);
    G.game.lootFeed && (G.game.lootFeed.length = 0);
    for (var k = 0; k < 40; k++) { if (sc.update) sc.update(0.03); }
    sc.clearOverlay && sc.clearOverlay();
    if (G.Story && G.Story._cur) G.Story._cur = null;
    sc.render(G.game.ctx);
    return JSON.stringify({
      region: '${rid}', scene: G.game.sceneName,
      decor: (m && m.decor ? m.decor.length : (m && m.md && m.md.decor ? m.md.decor.length : 0)),
      trees: (m && m.trees ? m.trees.length : 0),
      structures: (m && m.md && m.md.structures ? m.md.structures.length : 0),
      overlay: sc.overlay || null
    });
  })()`;
}

(async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-sceneshot-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--hide-scrollbars', '--window-size=1440,816', '--remote-debugging-port=' + PORT,
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

    for (let i = 0; i < REGIONS.length; i++) {
      const rid = REGIONS[i];
      /* ⚠️ 每张图重新导航 → 全新会话（场景是单例，连切会串状态） */
      await client.send('Page.navigate', { url: URL });
      await sleep(2200);
      const r = await client.send('Runtime.evaluate', {
        expression: driverFor(rid), awaitPromise: true, returnByValue: true
      });
      if (r.exceptionDetails) {
        console.log('  ✗ ' + rid + ' 驱动抛错：' + JSON.stringify(r.exceptionDetails.exception));
        continue;
      }
      const rep = JSON.parse(r.result.value);
      const shot = await client.send('Page.captureScreenshot', { format: 'png' });
      const file = path.join(OUT, 'look_' + rid + '.png');
      fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
      console.log('  ✓ ' + rid.padEnd(8) + ' 场景=' + String(rep.scene).padEnd(10)
        + ' 装饰=' + rep.decor + ' 建筑=' + rep.structures
        + ' overlay=' + rep.overlay + ' → ' + path.basename(file));
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
