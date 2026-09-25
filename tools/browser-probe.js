/* 真实浏览器探针（CDP 版）：用本机 Chrome 打开游戏，跑真实加载流程 + 真实点击，
   把诊断结果取回来，并出一张真实渲染的截图。
   为什么必须有这个工具：smoke.js / shot.js / zoom.js 用的都是桩 canvas + 桩 fetch，
   「素材到底有没有加载成功」在桩环境里**永远测不出来**（fetch 被桩成 reject，
   manifest 永远失败，素材路径根本跑不到）。只有真浏览器能回答。
   用法：node tools/browser-probe.js [场景] [输出目录]
        场景 ∈ town | field | town_home | battle | charpanel | perf   （默认 town）
        charpanel = 进镇后打开角色面板并截图（验证立绘框不裁切）
        perf     = 在真实浏览器里逐阶段量渲染耗时（冷启动/稳态/rAF）
   依赖：本机 Chrome/Edge。Node 22 自带 WebSocket，无需额外依赖。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const WWW = path.join(__dirname, '..', 'www');
const SCENE = process.argv[2] || 'town';
const OUT = process.argv[3] ? path.resolve(process.argv[3]) : path.join(__dirname, '..', '_shots');
/* 窗口尺寸决定超采样倍率 S：1280x720 → S=3；1920x1080 → S=4（1080p 全屏的实况）。
   测性能务必两种都跑，S=4 时画布与地面层都要大 78%，是真正的 worst case。 */
const WIN = process.env.WIN || '1280,720';
const PORT = 9333;
const URL = 'http://127.0.0.1:8173/index.html';

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].find((p) => fs.existsSync(p));
if (!CHROME) { console.error('找不到 Chrome/Edge'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(p) {
  const r = await fetch('http://127.0.0.1:' + PORT + p);
  return r.json();
}

/* ---------- 性能驱动：在**真实浏览器**里逐阶段量渲染耗时 ----------
   为什么不能只看 bench-frame.js：那个用的是 @napi-rs/canvas 软件光栅器，
   和浏览器里走 GPU 加速的 Canvas2D 完全不是一回事（数值能差好几倍，
   而且"哪一步最贵"的排序也可能不一样）。卡顿是玩家在浏览器里感受到的，
   就得在浏览器里量。 */
const PERF_DRIVER = `(async function () {
  var G = window.G, errs = [];
  var t0 = Date.now();
  while (!G.Assets.ready && Date.now() - t0 < 10000) await new Promise(function (r) { setTimeout(r, 50); });

  var save = {
    life: 1, worldSeed: 12345, world: G.Data.generateWorld(12345, true),
    origin: 'test', originFx: { a: .05, h: .05 },
    linggen: { elems: ['木'], coef: { 木: 1.2 }, kind: '单灵根', stoneBonus: 0 },
    talents: [], skills: { 缠藤指: { lv: 2 } }, skillEquip: ['缠藤指'],
    items: { 回春丹: 3 }, stone: 500, qi: 1200, po: 30,
    globalLevel: 5, maxGlobalLevel: 5, age: 16, watch: 0, whispers: 0, escapeLeft: 3,
    quest: { step: 'free', flags: {} }, scene: 'town', map: 'town', pos: null,
    chestsOpened: [], bossKilled: false, chronicle: [], _ageTick: 0, hp: 200
  };
  G.game.save = save;

  var SCENES = ['town', 'field', 'cave', 'town_home', 'town_shop', 'town_market', 'field_temple'];
  var STAGES = ['_drawGroundLayer', '_drawShade', '_drawStructure', '_drawDecor', '_drawFurn',
    '_drawPlayer', '_drawVeil', '_drawIndoor', '_drawChest', '_drawBoss',
    '_drawInteractHint', '_drawMark', '_drawHint', '_drawHUD'];

  var out = [];
  for (var si = 0; si < SCENES.length; si++) {
    var name = SCENES[si];
    save.pos = null;

    /* ---- 冷启动：清掉全部美术缓存，量"刚进图那一帧"的烘焙开销 ----
       玩家说的"进图卡一下"就是这一项。热态再快也掩盖不掉它。 */
    /* 地面整图层挂在场景对象上（场景是单例），不清掉的话冷启动就量不到烘焙开销 */
    SCENES.forEach(function (n) {
      if (G.scenes[n]) { G.scenes[n]._groundLayer = null; G.scenes[n]._groundKey = null; }
    });
    G.Art.clear(); G.Sprites.clear(); G.UI.clearCache();
    G.game.changeScene(name, { toSpawn: true });
    var sc = G.game.scene, ctx = G.game.ctx;
    var coldMs = -1;
    try {
      var t1 = performance.now();
      sc.render(ctx);
      coldMs = performance.now() - t1;
    } catch (e) { errs.push(name + ' 冷启动: ' + e.message); }

    /* ---- 冷启动 B：只作废地面层，纹理已经由 A 烘好了 ----
       这才是玩家从标题界面进图的真实开销（warmup 已把地面纹理预热完）。 */
    var cold2Ms = -1, bakeMs = -1;
    try {
      sc._groundLayer = null; sc._groundKey = null;
      var t3 = performance.now();
      sc.render(ctx);
      cold2Ms = performance.now() - t3;
      /* 单量"地面分块烘焙"本身：整帧里其余部分是装饰/建筑等别的首次开销 */
      sc._groundLayer = null; sc._groundKey = null;
      var tb = performance.now();
      sc._drawGroundLayer(ctx, sc._camX(), sc._camY());
      bakeMs = performance.now() - tb;
    } catch (e) { errs.push(name + ' 冷启动B: ' + e.message); }

    /* ---- 热态：预热 20 帧（把首次烘焙排除掉）后逐阶段计时 ---- */
    for (var w = 0; w < 20; w++) { try { sc.render(ctx); } catch (e) { break; } }

    var acc = {}, orig = {};
    STAGES.forEach(function (n) {
      if (typeof sc[n] !== 'function') return;
      acc[n] = 0; orig[n] = sc[n];
      sc[n] = function () {
        var a = performance.now();
        var r = orig[n].apply(this, arguments);
        acc[n] += performance.now() - a;
        return r;
      };
    });

    var N = 60, hotMs = -1;
    try {
      var t2 = performance.now();
      for (var i = 0; i < N; i++) { if (sc.update) sc.update(1 / 60); sc.render(ctx); }
      hotMs = (performance.now() - t2) / N;
    } catch (e) { errs.push(name + ' 热态: ' + e.message); }
    STAGES.forEach(function (n) { if (orig[n]) sc[n] = orig[n]; });

    var stages = {};
    Object.keys(acc).forEach(function (n) { stages[n] = +(acc[n] / N).toFixed(3); });

    /* ---- 真实 rAF 帧间隔：这就是玩家实际看到的流畅度 ---- */
    var raf = await new Promise(function (resolve) {
      var arr = [], last = performance.now(), cnt = 0;
      function tick(now) {
        arr.push(now - last); last = now; cnt++;
        if (cnt < 40) requestAnimationFrame(tick); else resolve(arr);
      }
      requestAnimationFrame(tick);
    });
    raf.sort(function (a, b) { return a - b; });

    out.push({
      scene: name, cold: +coldMs.toFixed(1), cold2: +cold2Ms.toFixed(1), bake: +bakeMs.toFixed(1), hot: +hotMs.toFixed(2),
      rafP50: +(raf[Math.floor(raf.length / 2)] || 0).toFixed(1),
      rafP95: +(raf[Math.floor(raf.length * 0.95)] || 0).toFixed(1),
      stages: stages
    });
  }
  return JSON.stringify({ S: G.game.S, K: G.Art.K, scenes: out, errs: errs });
})()`;

/* ---------- 地面等价性验证：老画法与新画法逐像素比对 ----------
   地面从"逐格取子块"改成"按周期平铺 + 只补路格"是纯性能优化，
   画面必须**逐像素完全一致**。这个模式把两种画法各烘一份出来做 diff，
   是唯一能证明优化没把地面画坏的办法（肉眼可看不出 1 像素的接缝错位）。 */
const GROUND_DRIVER = `(async function () {
  var G = window.G;
  var t0 = Date.now();
  while (!G.Assets.ready && Date.now() - t0 < 10000) await new Promise(function (r) { setTimeout(r, 50); });

  var save = {
    life: 1, worldSeed: 12345, world: G.Data.generateWorld(12345, true),
    origin: 'test', originFx: { a: .05, h: .05 },
    linggen: { elems: ['木'], coef: { 木: 1.2 }, kind: '单灵根', stoneBonus: 0 },
    talents: [], skills: { 缠藤指: { lv: 2 } }, skillEquip: ['缠藤指'],
    items: {}, stone: 500, qi: 1200, po: 30,
    globalLevel: 5, maxGlobalLevel: 5, age: 16, watch: 0, whispers: 0, escapeLeft: 3,
    quest: { step: 'free', flags: {} }, scene: 'town', map: 'town', pos: null,
    chestsOpened: [], bossKilled: false, chronicle: [], _ageTick: 0, hp: 200
  };
  G.game.save = save;

  var out = [];
  ['town', 'field', 'cave', 'town_home', 'town_market'].forEach(function (name) {
    save.pos = null;
    G.game.changeScene(name, { toSpawn: true });
    var sc = G.game.scene, m = sc.map, K = G.Art.K, pal = G.game.save.world.pal;
    var w = m.w * 16, h = m.h * 16, TS = G.Art.GROUND_TS;

    /* A) 新画法：引擎当前用的（周期平铺 + 路格补画） */
    sc._groundLayer = null; sc._groundKey = null;
    sc._ensureGround();
    var A = sc._groundLayer;

    /* B) 老画法：逐格从大纹理取子块（优化前的写法） */
    var c = document.createElement('canvas');
    c.width = Math.round(w * K); c.height = Math.round(h * K);
    var g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.setTransform(K, 0, 0, K, 0, 0);
    for (var ty = 0; ty < m.h; ty++) {
      for (var tx = 0; tx < m.w; tx++) {
        if (m.ground[ty][tx].t === 'path') { sc._drawPathTile(g, tx, ty); continue; }
        var sx = ((tx * 16) % TS + TS) % TS;
        var sy = ((ty * 16) % TS + TS) % TS;
        G.Art.groundBlit(g, sc._baseType(), pal, sx, sy, tx * 16, ty * 16);
      }
    }

    /* 逐像素比对 */
    var da = A.getContext('2d').getImageData(0, 0, A.width, A.height).data;
    var db = g.getImageData(0, 0, c.width, c.height).data;
    var diff = 0, maxd = 0, n = Math.min(da.length, db.length);
    for (var i = 0; i < n; i += 4) {
      var d0 = Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1])
        + Math.abs(da[i + 2] - db[i + 2]) + Math.abs(da[i + 3] - db[i + 3]);
      if (d0 > 0) { diff++; if (d0 > maxd) maxd = d0; }
    }
    out.push({
      scene: name, size: A.width + '×' + A.height,
      pixels: n / 4, diff: diff, maxDelta: maxd,
      sameSize: (A.width === c.width && A.height === c.height)
    });
  });
  return JSON.stringify({ K: G.Art.K, scenes: out });
})()`;

/* ---------- 消融驱动：真禁用某一步，再看真实帧间隔变了多少 ----------
   为什么不用"逐阶段计时"：Chrome 的 Canvas2D 是**延迟渲染**的，drawImage 只是把命令
   塞进 display list，真正的光栅化发生在 flush 时。所以给每个 _draw* 包一层计时，
   时间会被记到"恰好触发 flush 的那一步"头上 —— 归因完全是错的
   （曾把地面层的开销全记到 _drawDecor 上，得出完全相反的结论）。
   消融没有这个问题：直接把那一步换成空函数，比较真实 rAF 帧间隔的**差值**。 */
const ABLATE_DRIVER = `(async function () {
  var G = window.G;
  var t0 = Date.now();
  while (!G.Assets.ready && Date.now() - t0 < 10000) await new Promise(function (r) { setTimeout(r, 50); });

  var save = {
    life: 1, worldSeed: 12345, world: G.Data.generateWorld(12345, true),
    origin: 'test', originFx: { a: .05, h: .05 },
    linggen: { elems: ['木'], coef: { 木: 1.2 }, kind: '单灵根', stoneBonus: 0 },
    talents: [], skills: { 缠藤指: { lv: 2 } }, skillEquip: ['缠藤指'],
    items: { 回春丹: 3 }, stone: 500, qi: 1200, po: 30,
    globalLevel: 5, maxGlobalLevel: 5, age: 16, watch: 0, whispers: 0, escapeLeft: 3,
    quest: { step: 'free', flags: {} }, scene: 'town', map: 'town', pos: null,
    chestsOpened: [], bossKilled: false, chronicle: [], _ageTick: 0, hp: 200
  };
  G.game.save = save;

  var SCENES = ['town', 'field', 'cave', 'town_home', 'town_shop', 'town_market', 'field_temple'];
  var TARGETS = ['_drawGroundLayer', '_drawShade', '_drawStructure', '_drawDecor', '_drawFurn',
    '_drawPlayer', '_drawVeil', '_drawIndoor', '_drawChest', '_drawBoss',
    '_drawInteractHint', '_drawMark', '_drawHint', '_drawHUD'];

  /* 采样 70 帧、丢掉前 15 帧（换场景后的烘焙与预热都在这几帧里），
     剩下的取中位数 —— headless 环境下单次 rAF 抖动很大，少采会得出假结论。 */
  function rafMed(n) {
    return new Promise(function (resolve) {
      var arr = [], last = performance.now(), cnt = 0;
      function tick(now) {
        cnt++;
        if (cnt > 15) arr.push(now - last);
        last = now;
        if (cnt < n) { requestAnimationFrame(tick); return; }
        arr.sort(function (a, b) { return a - b; });
        resolve(+arr[Math.floor(arr.length / 2)].toFixed(1));
      }
      requestAnimationFrame(tick);
    });
  }

  var out = [];
  for (var si = 0; si < SCENES.length; si++) {
    var name = SCENES[si];
    save.pos = null;
    G.game.changeScene(name, { toSpawn: true });
    var sc = G.game.scene;
    await new Promise(function (r) { setTimeout(r, 200); });

    var counts = {
      decor: (sc.map.decor || []).length,
      structures: ((sc.map.md || {}).structures || []).length,
      furn: ((sc.map.md || {}).furn || []).length
    };
    var base = await rafMed(70);
    var abl = {};
    for (var ti = 0; ti < TARGETS.length; ti++) {
      var t = TARGETS[ti];
      if (typeof sc[t] !== 'function') continue;
      var orig = sc[t];
      sc[t] = function () {};
      var v = await rafMed(55);
      sc[t] = orig;
      /* 正数 = 禁用它之后帧间隔变短了 = 它确实在吃时间 */
      abl[t] = +(base - v).toFixed(1);
    }
    out.push({ scene: name, counts: counts, base: base, abl: abl });
  }
  return JSON.stringify({ S: G.game.S, K: G.Art.K, scenes: out });
})()`;

/* ---------- CDP 极简客户端 ---------- */
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

/* ---------- 驱动表达式：在页面里跑，返回诊断报告 ---------- */
const DRIVER = `(async function () {
  var G = window.G, log = [], errors = [];
  window.addEventListener('error', function (e) { errors.push('onerror: ' + (e.message || e.error)); });
  var oe = console.error, ow = console.warn;
  console.error = function () { errors.push('console.error: ' + [].join.call(arguments, ' ')); oe.apply(console, arguments); };
  console.warn = function () { log.push('console.warn: ' + [].join.call(arguments, ' ')); ow.apply(console, arguments); };

  /* 等素材层收尾（ready 或超时） */
  var t0 = Date.now();
  while (!G.Assets.ready && Date.now() - t0 < 10000) await new Promise(function (r) { setTimeout(r, 50); });
  var waitedMs = Date.now() - t0;

  var keys = Object.keys(G.Assets.images);
  var probeKeys = ['char.hero.down.0', 'char.hero.up.0', 'char.hero.left.0', 'char.hero.right.0',
                   'battle.hero', 'battle.enemy.wolf'];
  var assets = {};
  probeKeys.forEach(function (k) { assets[k] = !!G.Assets.img(k); });

  /* ---- 真实点击链：标题「开始」→ 转世 → 入世进镇 ---- */
  var clicked = [];
  function clickBtn(scene, re) {
    var b = (scene.buttons || []).filter(function (x) { return re.test(x.label || ''); })[0];
    if (!b) return false;
    b.onClick({ x: b.x + 2, y: b.y + 2 });
    clicked.push(re.source);
    return true;
  }
  function frames(n) { for (var i = 0; i < n; i++) { var q = window.__raf; } }

  /* 造一份存档直接进场景（点击链太长，诊断用直接进；真实点击在下面单独验一次标题页） */
  var save = {
    life: 1, worldSeed: 12345, world: G.Data.generateWorld(12345, true),
    origin: 'test', originFx: { a: .05, h: .05 },
    linggen: { elems: ['木'], coef: { 木: 1.2 }, kind: '单灵根', stoneBonus: 0 },
    talents: [], skills: { 缠藤指: { lv: 2 } }, skillEquip: ['缠藤指'],
    items: { 回春丹: 3 }, stone: 500, qi: 1200, po: 30,
    globalLevel: 5, maxGlobalLevel: 5, age: 16, watch: 0, whispers: 0, escapeLeft: 3,
    quest: { step: 'free', flags: {} }, scene: 'town', map: 'town', pos: null,
    chestsOpened: [], bossKilled: false, chronicle: [], _ageTick: 0, hp: 200
  };
  G.game.save = save;

  var sceneName = ${JSON.stringify(SCENE)};
  var wantChar = sceneName === 'charpanel';
  if (wantChar) sceneName = 'town';
  G.game.changeScene(sceneName, { toSpawn: true });
  await new Promise(function (r) { setTimeout(r, 200); });

  var frames4 = {};
  ['down', 'up', 'left', 'right'].forEach(function (d) {
    frames4[d] = { asset: !!G.Assets.img('char.hero.' + d + '.0') };
  });
  var heroW = G.Sprites.heroFrames().down[0].width;
  var heroH = G.Sprites.heroFrames().down[0].height;

  /* 走四向并各渲染一帧，确保四个方向都真的被画过 */
  var sc = G.game.scene;
  ['down', 'left', 'up', 'right'].forEach(function (d) {
    sc.dir = d; sc.frame = 1;
    if (sc.render) sc.render(G.game.ctx);
  });

  /* 战斗立绘也渲染一帧 */
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('赤炎狼', 6, '苍鬃狼'), mapId: 'field' });
  await new Promise(function (r) { setTimeout(r, 120); });
  if (G.game.scene.render) G.game.scene.render(G.game.ctx);

  /* 回到目标场景并停在朝下的走帧上，方便截图对比 */
  G.game.changeScene(sceneName, { toSpawn: true });
  await new Promise(function (r) { setTimeout(r, 200); });
  if (wantChar) {
    /* 角色面板：验证立绘框是否完整展示角色（不被裁切） */
    G.Overlays.openChar(G.game.scene);
    await new Promise(function (r) { setTimeout(r, 120); });
  }
  if (G.game.scene.render) { G.game.scene.dir = 'down'; G.game.scene.frame = 1; G.game.scene.render(G.game.ctx); }

  /* 站桩 NPC：在真浏览器里确认"画得出来 + 说得上话"。
     无头桩环境里 NPC 也能跑，但素材层与真实 Canvas 的差异只有这里能看出来。 */
  var npcInfo = { count: 0, marks: [], talked: false };
  var scN = G.game.scene;
  if (scN.map && (scN.map.npcs || []).length) {
    npcInfo.count = scN.map.npcs.length;
    scN.map.npcs.forEach(function (n) {
      npcInfo.marks.push(n.id + ':' + (scN.npcMarkOf(n) || '-'));
    });
    var n0 = scN.map.npcs[0];
    var ndirs = [[0, 1, 'up'], [0, -1, 'down'], [1, 0, 'left'], [-1, 0, 'right']];
    for (var di = 0; di < ndirs.length && !npcInfo.talked; di++) {
      var npx = n0.x + ndirs[di][0], npy = n0.y + ndirs[di][1];
      if (npx < 0 || npy < 0 || npx >= scN.map.w || npy >= scN.map.h) continue;
      if (scN.map.solid[npy][npx]) continue;
      G.game.save.pos = { x: npx, y: npy };
      scN.dir = ndirs[di][2];
      scN._interact();
      npcInfo.talked = !!scN.overlay;
    }
    /* 把对话覆盖层真的画一遍（含立绘），有异常会被页面错误钩子抓到 */
    if (scN.render) scN.render(G.game.ctx);
  }

  /* 立绘框像素体检：量出框内"有内容"的包围盒。
     被裁切时内容会顶死四边（bbox 贴 0 和 74）；完整展示时四周应留有留白。
     同时输出一张 ASCII 缩略图，肉眼/文本都能判断角色是否完整。 */
  var ink = null, ascii = null;
  if (wantChar) {
    var S = G.game.S;
    var bx = 67, by = 49, bw = 74, bh = 74;          /* 立绘框（逻辑坐标） */
    var d = G.game.ctx.getImageData(bx * S, by * S, bw * S, bh * S).data;
    var minX = 1e9, minY = 1e9, maxX = -1, maxY = -1, lit = 0;
    var lum = [];
    for (var py = 0; py < bh * S; py++) {
      lum[py] = [];
      for (var px = 0; px < bw * S; px++) {
        var i = (py * bw * S + px) * 4;
        var L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        lum[py][px] = L;
      }
    }
    /* 背景基准必须逐行取：面板底色本身是纵向渐变，
       用左上角一格当全局基准会把整块背景都算成"内容"，包围盒必然顶死四边。
       角色居中、两侧留白，所以取每行左右边缘的均值当该行基准最稳。 */
    for (var py2 = 0; py2 < bh * S; py2++) {
      var bgL = (lum[py2][0] + lum[py2][bw * S - 1]) / 2;
      for (var px2 = 0; px2 < bw * S; px2++) {
        if (Math.abs(lum[py2][px2] - bgL) > 22) {
          lit++;
          if (px2 < minX) minX = px2;
          if (px2 > maxX) maxX = px2;
          if (py2 < minY) minY = py2;
          if (py2 > maxY) maxY = py2;
        }
      }
    }
    if (maxX >= 0) {
      ink = {
        x: +(minX / S).toFixed(1), y: +(minY / S).toFixed(1),
        r: +((maxX + 1) / S).toFixed(1), b: +((maxY + 1) / S).toFixed(1),
        coverage: +(lit / (bw * bh * S * S) * 100).toFixed(1),
        /* 半身立绘本来就该顶到左右与下沿（肩与胸），所以"贴边"不再是问题；
           真正要防的是**头顶被切**：内容贴到框上沿说明头被裁了。 */
        headroom: +(minY / S).toFixed(1),
        topClipped: minY <= 1
      };
    }
    /* ASCII 缩略图：24×24，用亮度分档 */
    var N = 24, ramp = ' .:-=+*#%@';
    ascii = [];
    for (var ay = 0; ay < N; ay++) {
      var row = '';
      for (var ax = 0; ax < N; ax++) {
        var s0 = 0, n0 = 0;
        for (var sy = Math.floor(ay * bh * S / N); sy < Math.floor((ay + 1) * bh * S / N); sy++)
          for (var sx = Math.floor(ax * bw * S / N); sx < Math.floor((ax + 1) * bw * S / N); sx++) {
            s0 += lum[sy][sx]; n0++;
          }
        var v = (s0 / Math.max(1, n0) - 8) / 90;
        row += ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(v * (ramp.length - 1))))];
      }
      ascii.push(row);
    }
  }

  return JSON.stringify({
    ink: ink, ascii: ascii,
    waitedMs: waitedMs,
    manifestKeys: Object.keys(G.Assets.manifest || {}).length,
    registeredImages: keys.length,
    manifestSource: (window.G && G.AssetManifest) ? 'script(manifest.js)' : 'fetch(manifest.json)',
    portrait: !!G.Assets.img('portrait.luchen'),
    battleHero: (function () { var b = G.Sprites.beast('hero'); return { w: b.width, h: b.height }; })(),
    assets: assets,
    frames: frames4,
    heroSprite: { w: heroW, h: heroH },
    spriteK: G.Art.K, gameS: G.game.S,
    npc: npcInfo,
    errors: errors, notes: log
  });
})()`;

(async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-probe-'));
  const chrome = spawn(CHROME, [
    /* 默认 --disable-gpu（软件光栅）是刻意的保守档：数值稳定、可跨机比较，
       但比真实浏览器慢不少。加 GPU=1 可切到 GPU 加速档看真实余量。 */
    '--headless=new', (process.env.GPU ? '--use-gl=angle' : '--disable-gpu'),
    '--no-sandbox', '--hide-scrollbars',
    '--window-size=' + WIN, '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, 'about:blank'
  ], { stdio: 'ignore' });

  let client;
  try {
    /* 等 CDP 端口就绪 */
    let ver = null;
    for (let i = 0; i < 60; i++) {
      try { ver = await httpJson('/json/version'); break; } catch (e) { await sleep(250); }
    }
    if (!ver) throw new Error('Chrome CDP 端口未就绪');

    const target = await httpJson('/json/list');
    const page = target.find((t) => t.type === 'page');
    client = await connect(page.webSocketDebuggerUrl);

    await client.send('Page.enable');
    await client.send('Runtime.enable');
    await client.send('Page.navigate', { url: URL });
    await sleep(2500);   /* 等脚本加载 + 首帧 */

    const isPerf = SCENE === 'perf';
    const isAblate = SCENE === 'ablate';
    const isGround = SCENE === 'ground';
    const r = await client.send('Runtime.evaluate', {
      expression: isPerf ? PERF_DRIVER : (isAblate ? ABLATE_DRIVER : (isGround ? GROUND_DRIVER : DRIVER)),
      awaitPromise: true, returnByValue: true
    });
    if (r.exceptionDetails) {
      throw new Error('页面内驱动抛错：' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    }
    const report = JSON.parse(r.result.value);
    const pad = (s, n) => String(s).padEnd(n);

    if (isPerf) {
      console.log('=== 真实浏览器渲染性能（S=' + report.S + '  K=' + report.K + '）===');
      console.log('  cold  = 连地面纹理一起重烘（最坏：轮回换世界，调色板变了）');
      console.log('  cold2 = 只烘地面层（玩家从标题进图的真实开销，纹理已预热）');
      console.log('  rAF   = 真实帧间隔（玩家看到的流畅度）—— 这是唯一可信的指标');
      console.log('  注意：下面"各阶段 ms"只作参考，Chrome 是延迟渲染，归因不准，');
      console.log('        要看真实开销请用 ablate 模式。');
      console.log('');
      console.log('  ' + pad('场景', 14) + pad('cold', 9) + pad('cold2', 9) + pad('烘焙', 9)
        + pad('每帧', 9) + pad('rAF p50', 9) + pad('rAF p95', 9));
      for (const s of report.scenes) {
        /* 每帧 = update+render 的 60 帧平均（同步量，不受合成器影响）。
           > 16.7ms 就是跑不满 60fps 的硬证据，比 rAF 分位更稳。 */
        const flag = s.cold2 > 33 ? '  ⚠️ 进图顿挫' : (s.hot > 16.7 ? '  ⚠️ 稳态掉帧' : '');
        console.log('  ' + pad(s.scene, 14) + pad(s.cold + ' ms', 9) + pad(s.cold2 + ' ms', 9) + pad(s.bake + ' ms', 9)
          + pad(s.hot + ' ms', 9) + pad(s.rafP50 + ' ms', 9) + pad(s.rafP95 + ' ms', 9) + flag);
      }
      console.log('');
      for (const s of report.scenes) {
        const st = Object.keys(s.stages)
          .map((k) => [k, s.stages[k]])
          .filter((p) => p[1] >= 0.02)
          .sort((a, b) => b[1] - a[1]);
        if (!st.length) continue;
        console.log('  ' + s.scene + '（每帧各阶段 ms）：');
        st.forEach((p) => console.log('    ' + pad(p[0], 20) + pad(p[1], 8)
          + '  ' + '█'.repeat(Math.max(1, Math.round(p[1] * 4)))));
      }
      if (report.errs.length) {
        console.log('  ⚠️ 错误：');
        report.errs.forEach((e) => console.log('    - ' + e));
      }
      return;
    }

    if (isGround) {
      console.log('=== 地面渲染等价性验证（K=' + report.K + '）===');
      console.log('  老画法（逐格取子块） vs 新画法（周期平铺 + 只补路格）');
      console.log('');
      for (const s of report.scenes) {
        const ok = s.sameSize && s.diff === 0;
        console.log('  ' + pad(s.scene, 14) + pad(s.size, 14)
          + pad(s.pixels + ' 像素', 14)
          + (ok ? '✅ 逐像素完全一致' : ('❌ 有 ' + s.diff + ' 个像素不同（最大差 ' + s.maxDelta + '）')));
      }
      return;
    }

    if (isAblate) {
      console.log('=== 真实浏览器消融分析（S=' + report.S + '  K=' + report.K + '）===');
      console.log('  数字 = 禁用该步骤后 rAF 帧间隔缩短了多少 ms（越大越该优化）');
      console.log('');
      for (const s of report.scenes) {
        const items = Object.keys(s.abl)
          .map((k) => [k, s.abl[k]])
          .filter((p) => p[1] >= 0.5)
          .sort((a, b) => b[1] - a[1]);
        console.log('  ' + s.scene + '   基准帧间隔 ' + s.base + ' ms   '
          + '(装饰 ' + s.counts.decor + ' · 建筑 ' + s.counts.structures
          + ' · 家具 ' + s.counts.furn + ')');
        if (!items.length) { console.log('    没有单项超过 0.5ms'); continue; }
        items.forEach((p) => console.log('    ' + pad(p[0], 20) + pad('-' + p[1] + ' ms', 12)
          + '█'.repeat(Math.max(1, Math.round(p[1] * 2)))));
        console.log('');
      }
      return;
    }

    console.log('=== 真实浏览器诊断（' + SCENE + '）===');
    console.log('  素材层 ready 耗时   ' + report.waitedMs + ' ms');
    console.log('  manifest 键数       ' + report.manifestKeys + '（来源：' + report.manifestSource + '）');
    console.log('  已登记图片          ' + report.registeredImages);
    console.log('  角色立绘素材        ' + (report.portrait ? '✅ portrait.luchen' : '— 无，走程序化立绘')
      + '（battle.hero 位图 ' + report.battleHero.w + '×' + report.battleHero.h + '）');
    console.log('  超采样 S=' + report.gameS + '  美术 K=' + report.spriteK +
      (report.gameS === report.spriteK ? '  ✅ 一致' : '  ❌ 不一致（素材会被放大）'));
    console.log('  主角精灵位图        ' + report.heroSprite.w + '×' + report.heroSprite.h +
      '（应 = 28×42 × K = ' + (28 * report.spriteK) + '×' + (42 * report.spriteK) + '）');
    console.log('  素材命中：');
    Object.keys(report.assets).forEach(function (k) {
      console.log('    ' + (report.assets[k] ? '✅' : '❌') + ' ' + k);
    });
    console.log('  四向帧来源：');
    Object.keys(report.frames).forEach(function (d) {
      console.log('    ' + (report.frames[d].asset ? '✅ 素材' : '❌ 程序化兜底') + '  char.hero.' + d);
    });
    if (report.npc && report.npc.count) {
      console.log('  站桩 NPC            ' + report.npc.count + ' 个 · 头顶标记 '
        + report.npc.marks.join(' '));
      console.log('  ' + (report.npc.talked
        ? '✅ 对话覆盖层已打开（立绘 + 台词渲染无异常）'
        : '❌ 交互没有打开对话覆盖层'));
    }
    if (report.errors.length) {
      console.log('  ⚠️ 页面错误 (' + report.errors.length + ')：');
      report.errors.forEach((e) => console.log('    - ' + e));
    } else console.log('  页面错误：无');
    if (report.notes.length) {
      console.log('  ⚠️ 警告 (' + report.notes.length + ')：');
      report.notes.forEach((e) => console.log('    - ' + e));
    }
    if (report.registeredImages === 0) {
      console.log('  ❌ 一张素材都没登记 —— manifest 没加载到，全部走程序化画面');
    }
    if (report.ink) {
      var k = report.ink;
      console.log('  立绘框内容包围盒    x ' + k.x + '..' + k.r + '  y ' + k.y + '..' + k.b
        + '（框内 0..74）占 ' + k.coverage + '%');
      /* 半身立绘顶到左右/下沿是正常的（肩与胸），只有头顶被切才算裁切 */
      console.log('  ' + (k.topClipped
        ? '⚠️ 内容顶到框上沿 —— 头顶被裁，立绘可能仍偏大'
        : '✅ 头顶留白 ' + k.headroom + 'px —— 头部完整（肩部顶到左右/下沿属正常半身构图）'));
      if (report.ascii) {
        console.log('  立绘框 ASCII 缩略图：');
        report.ascii.forEach((l) => console.log('    |' + l + '|'));
      }
    }

    /* 真实截图 */
    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(OUT, 'browser_' + SCENE + '.png');
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
    console.log('  截图 → ' + file);
  } catch (e) {
    console.error('探针失败：' + e.message);
    process.exitCode = 1;
  } finally {
    if (client) client.close();
    chrome.kill();
    await sleep(300);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  }
})();
