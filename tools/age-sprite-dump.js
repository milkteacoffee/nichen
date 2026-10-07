/* 导出 heroAgeStage 三档精灵的**真实位图**到文件，便于逐像素核对。
   用法：node tools/age-sprite-dump.js [输出目录]
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, '..', '_shots');
const PORT = 9347;
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
    ws.onerror = (e) => reject(new Error('WS 错误'));
    ws.onopen = () => resolve({ send(method, params) { const mid = ++id; return new Promise((res, rej) => { pending.set(mid, { res, rej }); ws.send(JSON.stringify({ id: mid, method, params: params || {} })); }); }, close() { try { ws.close(); } catch (e) {} } });
  });
}

const DRIVER = `(async function () {
  var G = window.G, out = {};
  var t0 = Date.now();
  while (!G.Assets.ready && Date.now() - t0 < 10000) await new Promise(function (r) { setTimeout(r, 50); });
  out.K = G.Art.K; out.MAP_SCALE = G.Sprites.MAP_SCALE;
  out.dumps = [];
  [6, 10, 16].forEach(function (age) {
    var s = G.Sprites.heroAgeStage(age, 'down', 0);
    var w = s.width, h = s.height;
    var d = s.getContext('2d').getImageData(0, 0, w, h).data;
    var minY = h, maxY = -1, minX = w, maxX = -1;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 10) { if (y < minY) minY = y; if (y > maxY) maxY = y; if (x < minX) minX = x; if (x > maxX) maxX = x; }
    }
    out.dumps.push({ age: age, w: w, h: h, minX: minX, maxX: maxX, minY: minY, maxY: maxY, dataURL: s.toDataURL ? s.toDataURL('image/png') : null });
  });
  return JSON.stringify(out);
})()`;

(async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-dump-'));
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
    if (r.exceptionDetails) throw new Error('抛错：' + JSON.stringify(r.exceptionDetails.exception));
    const rep = JSON.parse(r.result.value);
    console.log('Art.K=' + rep.K + '  MAP_SCALE=' + rep.MAP_SCALE);
    rep.dumps.forEach(function (d) {
      console.log('  ' + String(d.age).padStart(2) + ' 岁: 画布 ' + d.w + '×' + d.h
        + '  内容 x ' + d.minX + '..' + d.maxX + '  y ' + d.minY + '..' + d.maxY
        + '  (高 ' + (d.maxY - d.minY + 1) + ', 底距 ' + (d.h - 1 - d.maxY) + ')');
      if (d.dataURL) {
        const b64 = d.dataURL.split(',')[1];
        const f = path.join(OUT, 'age_' + d.age + '_sprite.png');
        fs.writeFileSync(f, Buffer.from(b64, 'base64'));
      }
    });
    console.log('  已导出 sprite 位图到 ' + OUT);
  } catch (e) { console.error('失败：' + e.message); process.exitCode = 1; }
  finally { if (client) client.close(); chrome.kill(); await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
})();
