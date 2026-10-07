/* 真实浏览器截图：地图面板的四界页签（v0.94.0）。
   为什么独立成脚本：`shot.js` 顺序执行全部步骤，跑在前面的截图太耗时（实测超时）。
   做法：起浏览器 → 造"只解锁凡界"的存档 → 开地图面板 → 截图。
   再补一张"已解锁灵界"的，确认置灰/高亮两种状态都对。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', '_shots');
const PORT = 9349;
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
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    };
    ws.onerror = () => reject(new Error('WS 错误'));
    ws.onopen = () => resolve({ send(method, params) { const mid = ++id; return new Promise((res, rej) => { pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); }); }, close() { try { ws.close(); } catch (e) {} } });
  });
}

/* 造存档 → 开地图面板。`unlock` 决定解锁到哪一界。 */
function driver(unlock) {
  return `(async function () {
    var G = window.G;
    var t0 = Date.now();
    while (!G.Assets.ready && Date.now() - t0 < 10000) await new Promise(function (r) { setTimeout(r, 50); });
    try { if (G.Cutscene && G.Cutscene.dom) G.Cutscene.dom.style.display = 'none'; } catch (e) {}
    var pr = { worlds: {} };
    ${unlock === 'ling' ? "pr.worlds.ling = true;" : ''}
    G.game.meta = { past: [], progress: pr, hellCleared: {}, titles: [], perfusion: {}, achieve: {} };
    var sv = {
      life: 1, worldSeed: 12345, world: G.Data.generateWorld(12345, true),
      linggen: { elems: ['木'], coef: { '木': 1.2 } }, talents: [], skills: {}, skillEquip: [],
      items: {}, stone: 500, qi: 1200, po: 30, globalLevel: 60, age: 20,
      visited: {}, quest: { step: 'm1done', flags: {} },
      scene: 'town', map: 'town', pos: null, hp: 300
    };
    G.game.save = sv;
    G.game.changeScene('town', { toSpawn: true });
    await new Promise(function (r) { setTimeout(r, 300); });
    G.game.toasts.length = 0; G.game.lootFeed.length = 0;
    G.Overlays.openPanel(G.game.scene, 'map');
    await new Promise(function (r) { setTimeout(r, 250); });
    var sc = G.game.scene;
    for (var k = 0; k < 60; k++) { if (sc.update) sc.update(0.03); }
    if (sc.render) sc.render(G.game.ctx);
    /* 报告四界页签的可见/可点状态 */
    var out = { tabs: [] };
    (G.Overlays.WORLD_ORDER || ['fan','ling','xian','dao']).forEach(function (w) {
      var g = G.Overlays.worldGate(G.game.meta, w);
      out.tabs.push(w + ':' + (g.show ? (g.ok ? '可点' : '置灰') : '隐藏'));
    });
    return JSON.stringify(out);
  })()`;
}

/* v0.97.0：切到指定界并停住 —— 证明"未解锁也能看内容"。
   ⚠️ 关键：存档的 meta.progress.worlds **全空**（什么都没解锁），
      所以 ling/xian/dao 三界都是"能看不能去"的真实状态。 */
function viewDriver(w) {
  return `(async function () {
    var G = window.G;
    var t0 = Date.now();
    while (!G.Assets.ready && Date.now() - t0 < 10000) await new Promise(function (r) { setTimeout(r, 50); });
    try { if (G.Cutscene && G.Cutscene.dom) G.Cutscene.dom.style.display = 'none'; } catch (e) {}
    /* 全未解锁：四界都"能看"，只有凡界"能去" */
    G.game.meta = { past: [], progress: { worlds: {} }, hellCleared: {}, titles: [], perfusion: {}, achieve: {} };
    var sv = {
      life: 1, worldSeed: 12345, world: G.Data.generateWorld(12345, true),
      linggen: { elems: ['木'], coef: { '木': 1.2 } }, talents: [], skills: {}, skillEquip: [],
      items: {}, stone: 500, qi: 1200, po: 30, globalLevel: 60, age: 20,
      visited: {}, quest: { step: 'm1done', flags: {} },
      chestsOpened: [], scene: 'town', map: 'town', pos: null, hp: 300
    };
    G.game.save = sv;
    G.game.changeScene('town', { toSpawn: true });
    await new Promise(function (r) { setTimeout(r, 300); });
    var sc = G.game.scene;
    sc.mapZoom = 1; sc.mapPan = { x: 0, y: 0 };
    sc.mapWorld = '${w}';
    G.Overlays.openPanel(sc, 'map', true);
    G.game.toasts.length = 0; G.game.lootFeed.length = 0;
    for (var k = 0; k < 60; k++) { if (sc.update) sc.update(0.03); }
    if (sc.render) sc.render(G.game.ctx);
    var g = G.Overlays.worldGate(G.game.meta, sc.mapWorld);
    return JSON.stringify({ world: sc.mapWorld, n: (G.Data.regions.of(sc.mapWorld) || []).length, ok: g.ok });
  })()`;
}

(async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-mapshot-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--window-size=1280,720', '--remote-debugging-port=' + PORT, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
  let client;
  try {
    let ver = null;
    for (let i = 0; i < 60; i++) { try { ver = await httpJson('/json/version'); break; } catch (e) { await sleep(250); } }
    if (!ver) throw new Error('CDP 未就绪');
    const target = await httpJson('/json/list');
    const page = target.find((t) => t.type === 'page');
    client = await connect(page.webSocketDebuggerUrl);
    await client.send('Page.enable'); await client.send('Runtime.enable');
    await client.send('Page.navigate', { url: URL });
    await sleep(2500);

    const jobs = [['fan', '36_panel_map'], ['ling', '36c_panel_map_ling']];
    for (const [unlock, name] of jobs) {
      const r = await client.send('Runtime.evaluate', { expression: driver(unlock), awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('驱动抛错：' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
      const rep = JSON.parse(r.result.value);
      const shot = await client.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(shot.data, 'base64'));
      console.log('  ✓ ' + name + '（解锁到 ' + unlock + '）四界页签：' + rep.tabs.join('  '));
    }
    /* v0.97.0：**四界各拍一张**，证明"未解锁也能看内容"（用户口径
       「把地图全部能展示看到，但是无法过去」）。
       ⚠️ 未解锁的界（ling/xian/dao）只能"看"，所以要注意：它们的地图内容
          应完整画出（区域节点都在），只是压了一层暗纱 + 底部提示"尚未现世"。 */
    const viewJobs = ['fan', 'ling', 'xian', 'dao'];
    for (let vi = 0; vi < viewJobs.length; vi++) {
      const w = viewJobs[vi];
      const r = await client.send('Runtime.evaluate', {
        expression: viewDriver(w), awaitPromise: true, returnByValue: true
      });
      if (r.exceptionDetails) throw new Error('视图驱动抛错：' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
      const rep = JSON.parse(r.result.value);
      const shot = await client.send('Page.captureScreenshot', { format: 'png' });
      const nm = '36w_view_' + w;
      fs.writeFileSync(path.join(OUT, nm + '.png'), Buffer.from(shot.data, 'base64'));
      console.log('  ✓ ' + nm + ' 显示界=' + rep.world + '(' + rep.n + '区) ok=' + rep.ok);
    }
  } catch (e) { console.error('失败：' + e.message); process.exitCode = 1; }
  finally { if (client) client.close(); chrome.kill(); await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
})();
