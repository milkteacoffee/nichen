/* 真实帧率与绘制耗时探针（headless Chrome + CDP）。
   测三件事：
   ① 各场景的**渲染耗时**（render() 单独计时，排除 rAF 节流）
   ② 实际 **rAF 帧率**（headless 默认可能被节流到 60，需开 --disable-frame-rate-limit）
   ③ 超采样倍率 S 与画布尺寸

   用法：node tools/perf-probe.js
*/
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const PORT = 9355;
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

const SAVE = `{
  life: 1, worldSeed: 12345, world: G.Data.generateWorld(12345, true),
  linggen: { elems: ['木'], coef: { '木': 1.2 } }, talents: [], skills: {}, skillEquip: [],
  items: {}, stone: 500, qi: 1200, po: 30, globalLevel: 200, age: 30,
  wildKills: 99, side: {}, visited: {}, quest: { step: 'm1done', flags: {} },
  chestsOpened: [], pos: null, hp: 900, map: 'town'
}`;

/* 测某场景：先 render() 计时 N 次，再跑 rAF 测实际帧率。 */
function driver(sceneName, n) {
  return `(async function () {
    var G = window.G;
    var t0 = Date.now();
    while (!G.Assets.ready && Date.now() - t0 < 12000) await new Promise(function (r) { setTimeout(r, 50); });
    try { if (G.Cutscene && G.Cutscene.dom) G.Cutscene.dom.style.display = 'none'; } catch (e) {}
    G.game.meta = { past: [], progress: { worlds: { ling: true, xian: true, dao: true } }, hellCleared: {}, titles: [], perfusion: {}, achieve: {} };
    G.game.save = ${SAVE};
    (G.Data.StoryEvents.list || []).forEach(function (e) { G.game.save.quest.flags['se_' + e.id] = true; });
    G.game.changeScene('${sceneName}', { toSpawn: true });
    await new Promise(function (r) { setTimeout(r, 400); });
    var sc = G.game.scene;
    sc.clearOverlay && sc.clearOverlay();
    if (G.Story && G.Story._cur) G.Story._cur = null;
    for (var k = 0; k < 30; k++) { if (sc.update) sc.update(0.016); }
    /* ①b 分段计时：找热点 */
    var seg={};
    (function(){
      var origRender=sc.render.bind(sc);
      var names=['_drawGround','_drawShade','_drawPortal','_drawStructure','_drawPlayer','_drawVeil','_drawLight','_drawAmbient','_drawGather'];
      names.forEach(function(n){
        if(typeof sc[n]!=='function'){seg[n]='-';return;}
        var orig=sc[n].bind(sc);
        sc[n]=function(){var t=performance.now();var r=orig.apply(null,arguments);seg[n]=(seg[n]||0)+(performance.now()-t);return r;};
      });
      for(var w=0;w<60;w++){sc.update(0.016);origRender(G.game.ctx);}   /* 预热：把首帧烘焙摊掉 */
      names.forEach(function(n){seg[n]=0;});
      for(var i=0;i<30;i++){sc.update(0.016);origRender(G.game.ctx);}
      names.forEach(function(n){if(typeof seg[n]==='number')seg[n]=+(seg[n]/30).toFixed(2);});
    })();
    /* ① render 单独计时（排除 rAF 节流） */
    var t1 = performance.now();
    for (var i = 0; i < ${n}; i++) { sc.update(0.016); sc.render(G.game.ctx); }
    var drawMs = (performance.now() - t1) / ${n};
    /* ② 实际 rAF 帧率（跑 1.2 秒） */
    var frames = 0, t2 = performance.now(), last = t2, worst = 0;
    await new Promise(function (done) {
      function tick() {
        var now = performance.now();
        var d = now - last; last = now;
        if (frames > 0 && d > worst) worst = d;
        frames++;
        sc.update(0.016); sc.render(G.game.ctx);
        if (now - t2 >= 2500) { done(); return; }
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    var fps = frames / ((performance.now() - t2) / 1000);
    return JSON.stringify({
      scene: '${sceneName}', drawMs: +drawMs.toFixed(2), fps: +fps.toFixed(1),
      worstMs: +worst.toFixed(2), S: G.game.S,
      cw: G.game.canvas.width, ch: G.game.canvas.height,
      targetFps: G.game.targetFps, seg: seg
    });
  })()`;
}

(async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-perf-'));
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox',
    '--hide-scrollbars', '--window-size=1920,1080', '--remote-debugging-port=' + PORT,
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
    /* 模拟真实窗口：触发 resize（探针默认没触发，S 会停在下限 2） */
    const rz = await client.send('Runtime.evaluate', {
      expression: "JSON.stringify({S:G.game.S,w:G.game.canvas.width,h:G.game.canvas.height,dpr:window.devicePixelRatio,iw:window.innerWidth})",
      returnByValue: true
    });
    console.log('  窗口/倍率初始: ' + rz.result.value);
    await client.send('Runtime.evaluate', { expression: 'window.dispatchEvent(new Event("resize"))' });
    await sleep(400);

    console.log('场景           绘制ms   rAF帧率  最差帧ms  倍率S   画布');
    for (const sc of ['town', 'field', 'cave', 'fan5', 'ling1', 'xian1', 'dao1', 'battle', 'title']) {
      const r = await client.send('Runtime.evaluate', { expression: driver(sc, 40), awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) { console.log('  ✗ ' + sc + ' 抛错：' + JSON.stringify((r.exceptionDetails.exception || {}).description || r.exceptionDetails)); continue; }
      const rep = JSON.parse(r.result.value);
      if(rep.seg)console.log('     seg: '+JSON.stringify(rep.seg));
      console.log('     S='+rep.S+'/'+rep.MIN_S+'-'+rep.MAX_S+'  绘制EMA='+rep.drawEma+'ms');
      console.log('  ' + rep.scene.padEnd(12) + String(rep.drawMs).padStart(6) + '   '
        + String(rep.fps).padStart(6) + '   ' + String(rep.worstMs).padStart(7) + '   '
        + String(rep.S).padStart(3) + '   ' + rep.cw + '×' + rep.ch);
    }
    console.log('');
    console.log('注：headless 的 rAF 通常被节流；drawMs 才是真实的"渲染预算占用"。');
  } catch (e) { console.error('失败：' + e.message); process.exitCode = 1; }
  finally { if (client) client.close(); chrome.kill(); await sleep(300); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }
})();
