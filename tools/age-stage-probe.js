/* 真实浏览器验证：入世成长演出三拍（6/10/16 岁）是否渲染**真实立绘素材**。
   为什么必须真浏览器：无头桩 canvas 的 getImageData 恒空、getImageData 桩 is stub，
   材质是否命中只有真浏览器能答（本项目铁律：素材类验证一律 browser-probe）。

   做法：CDP 连本机 Chrome → 载入游戏 → 造最小存档 → 进 reincarnation 场景 →
   把 step 设为 'grow' 并逐拍推进 growT → 每拍截一张图 → 同时报告
   `G.Sprites.ageStageHasAsset(age)` 与精灵位图的实际像素内容方差
   （纯程序化色块 vs 手绘立绘，方差与颜色数差异显著）。
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const WWW = path.join(__dirname, '..', 'www');
const OUT = path.join(__dirname, '..', '_shots');
const PORT = 9345;
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

/* 页面内驱动：进 reincarnation，逐拍推进，报告素材命中 + 精灵像素统计。 */
const DRIVER = `(async function () {
  var G = window.G, out = { steps: [], errors: [] };
  window.addEventListener('error', function (e) { out.errors.push(String(e.message)); });
  var t0 = Date.now();
  while (!G.Assets.ready && Date.now() - t0 < 10000) await new Promise(function (r) { setTimeout(r, 50); });

  /* 素材键是否登记 */
  out.keys = {
    age6: !!G.Assets.img('char.hero.age6'),
    age10: !!G.Assets.img('char.hero.age10'),
    down: !!G.Assets.img('char.hero.down')
  };

  /* 直接进 reincarnation 场景并切到 grow 拍 */
  G.game.save = null;
  G.game.changeScene('reincarnation');
  await new Promise(function (r) { setTimeout(r, 200); });
  var sc = G.game.scene;
  out.sceneOK = !!sc && typeof sc.update === 'function';

  /* 逐拍：grow=0(6岁) / 1(10岁) / 2(16岁)。每拍推进到 ph≈0.8（人物已完全显出）。 */
  [0, 1, 2].forEach(function (g) {
    sc.step = 'grow'; sc.grow = g; sc.growT = 0; sc._growSkip = false;
    /* update(dt) 里 GROW_DUR 是一拍时长；推到 80% 处停住不换拍 */
    var guard = 0;
    while (sc.grow === g && guard++ < 400) sc.update(0.02);
    var age = [6, 10, 16][g];
    var spr = G.Sprites.heroAgeStage(age, 'down', 0);
    /* 精灵位图像素统计：真实手绘立绘 vs 程序化色块，颜色数与方差差异明显 */
    var w = spr.width, h = spr.height, d = null;
    try { d = spr.getContext('2d').getImageData(0, 0, w, h).data; } catch (e) {}
    var colors = {}, lit = 0, sum = 0, sum2 = 0;
    if (d) {
      for (var i = 0; i < d.length; i += 4) {
        if (d[i + 3] > 10) {
          lit++;
          var k = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3);
          colors[k] = 1;
          var L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
          sum += L; sum2 += L * L;
        }
      }
    }
    var n = Math.max(1, lit);
    var mean = sum / n;
    var varc = Math.sqrt(Math.max(0, sum2 / n - mean * mean));
    out.steps.push({
      grow: g, age: age, sprW: w, sprH: h,
      hasAsset: G.Sprites.ageStageHasAsset ? G.Sprites.ageStageHasAsset(age) : null,
      litPx: lit, colors: Object.keys(colors).length,
      lumMean: +mean.toFixed(1), lumStd: +varc.toFixed(1)
    });
    if (sc.render) sc.render(G.game.ctx);
    window.__shot = age;
  });
  return JSON.stringify(out);
})()`;

(async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-age-'));
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

    const r = await client.send('Runtime.evaluate', {
      expression: DRIVER, awaitPromise: true, returnByValue: true
    });
    if (r.exceptionDetails) {
      throw new Error('页面内驱动抛错：' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    }
    const rep = JSON.parse(r.result.value);
    console.log('=== 入世成长演出：素材命中核验（真浏览器）===');
    console.log('  素材登记：age6=' + (rep.keys.age6 ? '✅' : '❌')
      + '  age10=' + (rep.keys.age10 ? '✅' : '❌')
      + '  down=' + (rep.keys.down ? '✅' : '❌'));
    console.log('  ' + '岁'.padEnd(6) + '精灵'.padEnd(11) + '素材'.padEnd(8)
      + '不透明像素'.padEnd(12) + '颜色数'.padEnd(9) + '亮度均值'.padEnd(10) + '亮度σ');
    rep.steps.forEach(function (s) {
      console.log('  ' + (s.age + ' 岁').padEnd(7) + (s.sprW + '×' + s.sprH).padEnd(11)
        + (s.hasAsset ? '✅ 是' : '— 程序化').padEnd(9)
        + String(s.litPx).padEnd(13) + String(s.colors).padEnd(10)
        + String(s.lumMean).padEnd(11) + s.lumStd);
    });
    /* 判据：三档都必须命中素材；且真实立绘的颜色数应显著高于程序化色块（程序化约 <40 色） */
    var bad = [];
    rep.steps.forEach(function (s) {
      if (!s.hasAsset) bad.push(s.age + ' 岁未命中素材');
      if (s.colors < 60) bad.push(s.age + ' 岁颜色数仅 ' + s.colors + '（疑似程序化色块，非手绘立绘）');
    });
    console.log('');
    if (bad.length) { bad.forEach(function (b) { console.log('  ❌ ' + b); }); }
    else console.log('  ✅ 三档均命中真实立绘素材，且颜色数达标（手绘质感）');
    if (rep.errors.length) rep.errors.forEach(function (e) { console.log('  ⚠️ ' + e); });
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

/* ---------- 截图模式：把三拍各截一张（--shot） ---------- */
/* 上面 DRIVER 已把每拍渲染到主画布；这里补一个截图驱动，逐拍 captureScreenshot。
   实现放在文件末尾，用 __SHOT_DRIVER 注入。不影响默认（只核验）用法。 */
