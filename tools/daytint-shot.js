/* 昼夜色温 + 体积雾的**真实截图**（同一场景、不同时辰各一张）。
   用法：node tools/daytint-shot.js [输出目录]
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', '_shots');
const PORT = 9361;
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

/* 进指定场景，把游戏时间设到指定小时，渲染一帧。 */
function driver(sceneName, hour) {
  return `(async function () {
    var G = window.G;
    var t0 = Date.now();
    while (!G.Assets.ready && Date.now() - t0 < 12000) await new Promise(function (r) { setTimeout(r, 50); });
    try { if (G.Cutscene && G.Cutscene.dom) G.Cutscene.dom.style.display = 'none'; } catch (e) {}
    G.game.meta = { past: [], progress: { worlds: { ling: true, xian: true } }, hellCleared: {}, titles: [], perfusion: {}, achieve: {} };
    G.game.save = {
      life: 1, worldSeed: 12345, world: G.Data.generateWorld(12345, true),
      linggen: { elems: ['木'], coef: { '木': 1.2 } }, talents: [], skills: {}, skillEquip: [],
      items: {}, stone: 500, qi: 1200, po: 30, globalLevel: 200, age: 30,
      wildKills: 99, side: {}, visited: {}, quest: { step: 'm1done', flags: {} },
      chestsOpened: [], pos: null, hp: 900, map: 'town'
    };
    (G.Data.StoryEvents.list || []).forEach(function (e) { G.game.save.quest.flags['se_' + e.id] = true; });
    G.game.changeScene('${sceneName}', { toSpawn: true });
    await new Promise(function (r) { setTimeout(r, 400); });
    var sc = G.game.scene;
    sc.clearOverlay && sc.clearOverlay();
    if (G.Story && G.Story._cur) G.Story._cur = null;
    /* 把游戏时间推到指定小时（gt 是分钟总数） */
    var MIN = G.Time.MIN_PER_HOUR || 60, MIND = G.Time.MIN_PER_DAY || 1440;
    G.game.save.gt = ${hour} * MIN + 3 * MIND;      /* 第 3 天 + hour 点，避开月初边界 */
    G.game._fogOn = true;                            /* 截图时强制开氛围层 */
    for (var k = 0; k < 30; k++) { if (sc.update) sc.update(0.03); }
    sc.render(G.game.ctx);
    var t = G.game.dayTint();
    return JSON.stringify({ scene: '${sceneName}', hour: ${hour},
      tint: t, cal: G.Time.cal(G.game.save).h, fogOn: G.game._fogOn });
  })()`;
}

(async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-daytint-'));
  const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--hide-scrollbars',
    '--window-size=1280,720', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
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

    /* 城镇：日出 / 正午 / 黄昏 / 子夜 */
    const jobs = [['town', 7, '60_daytint_dawn'], ['town', 12, '60_daytint_noon'],
      ['town', 18, '60_daytint_dusk'], ['town', 0, '60_daytint_night']];
    for (const [scn, h, name] of jobs) {
      const r = await client.send('Runtime.evaluate', {
        expression: driver(scn, h), awaitPromise: true, returnByValue: true
      });
      if (r.exceptionDetails) { console.log('  ✗ ' + name + '：' + JSON.stringify((r.exceptionDetails.exception || {}).description || r.exceptionDetails)); continue; }
      const rep = JSON.parse(r.result.value);
      const shot = await client.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(shot.data, 'base64'));
      console.log('  ✓ ' + name + '  gt→' + rep.hour + ' 时(cal=' + rep.cal + ')  '
        + 'RGBA=' + rep.tint.map((n) => (typeof n === 'number' ? n.toFixed(2) : n)).join(','));
    }
  } catch (e) { console.error('失败：' + e.message); process.exitCode = 1; }
  finally { if (client) client.close(); chrome.kill(); await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
})();
