/* 真实浏览器截图：arc1 对话（晚晴立绘）——核验"风景式立绘"在对话框里的实际观感。
   用法：node tools/arc-portrait-shot.js [输出目录]
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', '_shots');
const PORT = 9348;
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

/* 走**真实降世流程**进 arc1（手造存档容易漏字段，比如 arc.step）：
   difficulty → reincarnation → 入世（第 1 世强制 arc1）→ arc 场景。 */
const DRIVER = `(async function () {
  var G = window.G, out = { log: [] };
  var t0 = Date.now();
  while (!G.Assets.ready && Date.now() - t0 < 10000) await new Promise(function (r) { setTimeout(r, 50); });
  try { if (G.Cutscene && G.Cutscene.dom) G.Cutscene.dom.style.display = 'none'; } catch (e) {}

  /* 清空 meta，保证第 1 世（强制 arc1） */
  G.game.meta = { past: [], progress: {}, hellCleared: {}, titles: [], perfusion: {}, achieve: {} };
  G.game.save = null;

  G.game.changeScene('difficulty');
  await new Promise(function (r) { setTimeout(r, 60); });
  if (G.game.scene && G.game.scene._choose) G.game.scene._choose('normal');
  await new Promise(function (r) { setTimeout(r, 200); });

  var r = G.game.scene;
  if (G.game.sceneName !== 'reincarnation') { out.err = '未进 reincarnation，实为 ' + G.game.sceneName; return JSON.stringify(out); }
  r.rollLinggen();
  r.drawTalents();
  r.step = 'talent'; r._buildButtons();
  var eb = r.buttons.filter(function (b) { return /入世|择命途/.test(b.label || ''); })[0]
    || r.buttons[r.buttons.length - 1];
  eb.onClick();
  /* ⚠️ 实测：第 1 世**仍会出 arcpath 选择**（"择命途"），
     玩家点「天道命定 · 白鹿礁」才进 arc1。选它。 */
  if (r.step === 'arcpath') {
    var ab = r.buttons.filter(function (b) { return /天道命定/.test(b.label || ''); })[0];
    if (!ab) return JSON.stringify({ err: 'arcpath 缺「天道命定」按钮' });
    out.picked = ab.label;
    ab.onClick();
  }
  var g2 = 0;
  while (r.step === 'grow' && g2++ < 12) r.update((r.GROW_DUR || 2) + 0.01);
  await new Promise(function (res) { setTimeout(res, 300); });
  out.afterBirth = G.game.sceneName;

  /* 现在应在 arc 场景；推进对话直到出现有立绘的角色（wanqing/jiang） */
  var sc = G.game.scene;
  out.sceneOK = !!sc;
  for (var i = 0; i < 60; i++) {
    var ln = sc.line;
    var pid = ln && ln.pid;
    if (i < 6 || pid) out.log.push('i' + i + ':' + pid);
    if (pid === 'wanqing' || pid === 'jiang' || pid === 'xuanjizi') break;
    if (sc.onTap) sc.onTap({ x: 240, y: 200 });
    await new Promise(function (res) { setTimeout(res, 25); });
  }
  /* 让打字机走完，立绘完整显示 */
  for (var k = 0; k < 60; k++) { if (sc.update) sc.update(0.05); }
  if (sc.render) sc.render(G.game.ctx);
  var ln2 = sc.line;
  out.finalPid = ln2 && ln2.pid;
  out.hasPortrait = !!(G.Assets.img && out.finalPid && G.Assets.img('portrait.' + out.finalPid));
  return JSON.stringify(out);
})()`;

(async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-arcshot-'));
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
    const r = await client.send('Runtime.evaluate', { expression: DRIVER, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('抛错：' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    const rep = JSON.parse(r.result.value);
    console.log('  场景OK=' + rep.sceneOK + '  最终 pid=' + rep.finalPid + '  立绘命中=' + (rep.hasPortrait ? '✅' : '❌'));
    console.log('  err=' + (rep.err||'-') + ' afterBirth=' + rep.afterBirth);
    console.log('  轨迹：' + JSON.stringify(rep.log));
    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(OUT, 'arc_portrait.png');
    fs.writeFileSync(f, Buffer.from(shot.data, 'base64'));
    console.log('  截图 → ' + f);
  } catch (e) { console.error('失败：' + e.message); process.exitCode = 1; }
  finally { if (client) client.close(); chrome.kill(); await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
})();
