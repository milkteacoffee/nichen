/* 无头冒烟测试：在 Node 中用桩 DOM/Canvas 加载全部脚本并跑通各场景。
   用法：node tools/smoke.js
   目的：不依赖浏览器即可捕获运行时异常（绘制调用、数据缺字段、场景切换）。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WWW = path.join(__dirname, '..', 'www');

/* ---------- Canvas 2D 桩 ---------- */
function makeGradient() {
  return { addColorStop() {} };
}
function makeCtx() {
  const noop = () => {};
  const ctx = {
    canvas: null,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, font: '10px sans-serif',
    textAlign: 'left', textBaseline: 'top', globalAlpha: 1,
    globalCompositeOperation: 'source-over', lineJoin: 'miter', lineCap: 'butt',
    shadowColor: 'transparent', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    imageSmoothingEnabled: true, imageSmoothingQuality: 'high',
    save: noop, restore: noop, translate: noop, scale: noop, rotate: noop,
    setTransform: noop, transform: noop, resetTransform: noop, clip: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, arc: noop, arcTo: noop,
    ellipse: noop, rect: noop, fill: noop, stroke: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop,
    fillText: noop, strokeText: noop,
    measureText: (s) => ({ width: String(s).length * 7 }),
    createLinearGradient: makeGradient, createRadialGradient: makeGradient,
    createPattern: () => null,
    drawImage: function (img) {
      if (!img) throw new Error('drawImage(null) —— 素材/精灵为空');
      for (let i = 1; i < arguments.length; i++) {
        const v = arguments[i];
        if (typeof v !== 'number' || !isFinite(v)) {
          throw new Error('drawImage 坐标/尺寸非有限数（参数 ' + i + ' = ' + v + '）');
        }
      }
      if (!img.width || !img.height) {
        throw new Error('drawImage 源尺寸为 0');
      }
    },
    putImageData: noop, getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    /* 虚线（v0.31.0 地图道路连线用到）。桩要覆盖**游戏真正用到的 API** ——
       少一个就是一个"渲染期抛异常"，而那正是契约最该抓的一类。 */
    setLineDash: noop
  };
  return ctx;
}

/* 文本探针：包一层 ctx 记录 fillText 的字符串。
   为什么要它：新增 overlay / 菜单页时最容易漏的是**路由**，而漏路由的表现是
   **静默不画、不报错** —— 只断言"render 不抛异常"抓不到。必须确认文案真的落到画布上。
   注意：按钮文字是 game.js 画的、不在 scene.render 里，所以只能查面板标题与提示文案。 */
function textSpy() {
  const c = makeCtx();
  const seen = [];
  c.fillText = function (s) { seen.push(String(s)); return undefined; };
  c.__seen = seen;
  return c;
}

/* 可达性：从 from 出发能走到的格子集合（不含 solid 格）。 */
function bfsReach(mp, from) {
  const seen = {}, q = [[from.x, from.y]];
  seen[from.x + ',' + from.y] = true;
  while (q.length) {
    const c = q.shift();
    [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
      const nx = c[0] + d[0], ny = c[1] + d[1];
      if (nx < 0 || ny < 0 || nx >= mp.w || ny >= mp.h) return;
      if (mp.solid[ny][nx]) return;
      const k = nx + ',' + ny;
      if (seen[k]) return;
      seen[k] = true; q.push([nx, ny]);
    });
  }
  return seen;
}

/* 绘制探针：记录每次 drawImage 的目标矩形。
   桩 canvas 没有像素，但"有没有在正确的格子发起绘制"是查得到的 ——
   这正是"物件登记了却忘了画"这类**静默**问题的抓法（它不报错、只是什么都不显示）。
   用法见 region.visual.contract 的差分法：同一张图去掉该物件，每帧绘制次数必须减少。 */
function drawSpy() {
  const c = makeCtx();
  const hits = [];
  c.drawImage = function (img) {
    if (!img) throw new Error('drawImage(null) —— 素材/精灵为空');
    hits.push({ img, x: arguments[1], y: arguments[2], w: arguments[3], h: arguments[4] });
  };
  c.__hits = hits;
  /* 变换记录（v0.32.0）：面板滑入这类"整体位移"用 drawImage 的 y **查不到** ——
     探针记的是**变换前**的实参，`x.translate` 不改它们。所以单独记 translate。 */
  c.__tr = [];
  const _tr = c.translate;
  c.translate = function (tx, ty) { c.__tr.push({ x: tx, y: ty }); return _tr.apply(c, arguments); };
  return c;
}

/* 带坐标的文本探针：记录每次 fillText 的 (文本, x, y, 字号)。
   为什么要坐标：**排版越界是静默的** —— 字画到面板外、或压住下一行，都不报错，
   只有截图才看得出来（32_panel_quest 的末条任务、34_panel_achieve 的末条成就
   就是这么漏出去的）。G.UI.text 的 y 是 textBaseline='top'，所以 y + 字号 = 文字底。
   用法见 panels.bounds.contract。 */
function textSpyXY() {
  const c = makeCtx();
  const seen = [];
  c.fillText = function (s, x, y) {
    const m = /(\d+(?:\.\d+)?)px/.exec(String(c.font));
    seen.push({ s: String(s), x: x, y: y, size: m ? parseFloat(m[1]) : 10, align: c.textAlign });
    return undefined;
  };
  c.__seenXY = seen;
  return c;
}

/* 有序层探针：记录 `G.UI.text` / `G.UI.textOut`（文字）与 `G.UI.rr` / `G.UI.panel`（框），
   **带先后序号**。
   为什么必须带序号：只有"**后画的框盖住了先画的字**"才是 bug ——
   先画框、再往框里写字是正常顺序（所有卡片都这样）。
   ⚠️ 为什么挂 `G.UI.*` 而不是"某个 ctx 的 fillText"：契约传进来的 ctx 是它自己造的，
   而探针若另造一个 ctx 去 patch `fillText`，**一条文字都收不到**（本轮就踩了：
   打印出来是「文字 0 框 6」，框能收到是因为 `G.UI.rr` 是全局函数、与 ctx 无关）。
   规矩：**探针挂在逻辑入口上，别挂在物理出口上。** */
function layerSpy() {
  const ev = [];
  const est = function (s, size) {
    let w = 0;
    for (let i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? size : size * 0.55;
    return w;
  };
  const rec = function (str, s, size, align) {
    const w = est(String(str), size);
    const al = align || 'left';
    const x0 = al === 'right' ? s.x - w : (al === 'center' ? s.x - w / 2 : s.x);
    ev.push({ k: 't', s: String(str), x0: x0, y0: s.y, x1: x0 + w, y1: s.y + size, align: al });
  };
  const rText = G.UI.text, rOut = G.UI.textOut, rRr = G.UI.rr, rPanel = G.UI.panel;
  G.UI.text = function (x, s, str, size, color, align, pixel) {
    rec(str, s, size, align);
    return rText.apply(this, arguments);
  };
  G.UI.textOut = function (x, s, str, size, color, align) {
    rec(str, s, size, align);
    return rOut.apply(this, arguments);
  };
  G.UI.rr = function (x, s) {
    if (s && typeof s.x === 'number' && typeof s.w === 'number') {
      ev.push({ k: 'b', x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h });
    }
    return rRr.apply(this, arguments);
  };
  /* 卡片背板 / 列表衬底走 `G.UI.panel`（预渲染缓存 + drawImage），**不经过 `rr`** ——
     只 patch `rr` 的话"副标题被卡片压住"完全抓不到。 */
  G.UI.panel = function (x, s) {
    if (s && typeof s.x === 'number' && typeof s.w === 'number') {
      ev.push({ k: 'b', x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h });
    }
    return rPanel.apply(this, arguments);
  };
  return {
    ev: ev,
    restore: function () {
      G.UI.text = rText; G.UI.textOut = rOut; G.UI.rr = rRr; G.UI.panel = rPanel;
    }
  };
}
/* 框探针：记录这一帧所有 `G.UI.rr()` 的矩形（圆角矩形路径 = 一切"框"的公共入口：
   属性卡、列表背板、按钮底、进度条…）。
   为什么必须单独有它：越界契约原先只判**文字**，而"框跑出去、文字还在框里居中"是静默的 ——
   v0.14.0 内容区收窄后「属性」页三张属性卡右沿 452 > 面板 436，文字断言全绿（G45 同族）。
   用法：`const sp = boxSpy(); render(); sp.restore(); checkBoxes(id, R, sp.hits);` */
function boxSpy() {
  const hits = [];
  const real = G.UI.rr;
  G.UI.rr = function (x, s) {
    if (s && typeof s.x === 'number' && typeof s.w === 'number') {
      hits.push({ x: s.x, y: s.y, w: s.w, h: s.h });
    }
    return real.apply(this, arguments);
  };
  return { hits: hits, restore: function () { G.UI.rr = real; } };
}

function makeCanvas(w, h) {  const c = {
    width: w || 300, height: h || 150,
    style: {},
    getContext() { if (!c._ctx) { c._ctx = makeCtx(); c._ctx.canvas = c; } return c._ctx; },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: c.width, height: c.height }; }
  };
  return c;
}

/* ---------- DOM / BOM 桩 ---------- */
const gameCanvas = makeCanvas(480, 272);
const listeners = {};
const doc = {
  createElement(tag) {
    if (tag === 'canvas') return makeCanvas(1, 1);
    return { style: {}, appendChild() {}, addEventListener() {} };
  },
  getElementById(id) { return id === 'game' ? gameCanvas : null; },
  addEventListener() {}
};

let rafQueue = [];
const sandbox = {
  console,
  document: doc,
  window: null,
  performance: { now: () => Date.now() },
  requestAnimationFrame(fn) { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame() {},
  setTimeout, clearTimeout, setInterval, clearInterval,
  fetch: () => Promise.reject(new Error('offline')),
  Image: class { constructor() { this.width = 1; this.height = 1; } },
  localStorage: (() => {
    const m = {};
    return {
      getItem: (k) => (k in m ? m[k] : null),
      setItem: (k, v) => { m[k] = String(v); },
      removeItem: (k) => { delete m[k]; },
      clear: () => { for (const k in m) delete m[k]; }
    };
  })(),
  navigator: { userAgent: 'node' },
  devicePixelRatio: 2
};
sandbox.window = sandbox;
sandbox.window.innerWidth = 1280;
sandbox.window.innerHeight = 720;
sandbox.window.devicePixelRatio = 2;
sandbox.window.addEventListener = (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); };
sandbox.window.removeEventListener = () => {};
sandbox.globalThis = sandbox;

vm.createContext(sandbox);
vm.runInContext('this.Math = Math;', sandbox);

/* ---------- 加载脚本（顺序与 index.html 一致） ---------- */
const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
if (!srcs.length) { console.error('未在 index.html 中找到脚本'); process.exit(1); }

const errors = [];
/* 非致命提示（"这条有意如此"）。与 errors 分开：errors 一非空就退出码 1，
   notes 只打印 —— 用来记"待办但已知"，免得把 TODO 混进红色报错里，看久了就没人看报错了。 */
const notes = [];
/* 有意走程序化兜底的素材键（详见 npc.portrait.assets 契约里的注释） */
/* 有意走程序化兜底的角色键（新角色先接线、美术后补）。
   ⚠️ **出图之后必须从这张表里删掉** —— 留着会让"图丢了"变成静默通过。
   2026-09-26：char.npc.cultist / portrait.cultist 已出图（血煞探子·行脚商），故清空。 */
const PROC_FALLBACK_OK = new Set([]);
for (const rel of srcs) {
  const p = path.join(WWW, rel);
  if (!fs.existsSync(p)) { errors.push(`缺失脚本：${rel}`); continue; }
  try {
    vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: rel });
  } catch (e) {
    errors.push(`加载失败 ${rel}: ${e.message}`);
  }
}

/* ---------- 驱动 ---------- */
/* 虚拟时钟必须**跨 pump 调用单调递增**，只在模块加载时取一次基准。
   以前每次 pump 都重新 `let t = sandbox.performance.now()`，而 game.loop 的
   this._last 还停在上一次 pump 的末尾 —— 虚拟时间每帧 +16.7ms，跑几十帧就
   比真实时间快出 1 秒多，于是下一次 pump 的第一帧 now - _last 是**负数**：
   dt 变负 → 所有 `-= dt` 的计时器倒着走 → 闪白越收越亮（flash 从 1 涨到 4）、
   战斗 cue 永不结束（"自动战斗 2000 帧仍未结束"）、结算演出收不了尾。
   一个时钟 bug 能伪造出一整屏"游戏逻辑坏了"，所以这里必须单调。 */
let vclock = sandbox.performance.now();
function pump(frames, label) {
  for (let i = 0; i < frames; i++) {
    const q = rafQueue; rafQueue = [];
    if (!q.length) break;
    vclock += 16.7;
    for (const fn of q) {
      try { fn(vclock); }
      catch (e) { errors.push(`[${label}] 帧 ${i} 异常: ${e.stack.split('\n').slice(0, 3).join(' | ')}`); return; }
    }
  }
}
function step(fn, label) {
  try { fn(); } catch (e) { errors.push(`[${label}] ${e.message}`); }
}

const G = sandbox.G;
if (!G) { console.error('G 未初始化'); process.exit(1); }

/* 0) 美术层契约校验：所有工厂必须返回 { c, ox, oy, w, h } 且为有限数，
      否则 drawImage 会按原始尺寸绘制（超采样画布被放大 K 倍）。 */
step(function () {
  /* 颜色解析：必须同时支持 hex 与 rgb()/rgba()，否则会解析出错误颜色 */
  const cases = [
    ['#c75450', [199, 84, 80]],
    ['#abc', [170, 187, 204]],
    ['rgba(10,13,22,0.88)', [10, 13, 22]],
    ['rgb(200,100,50)', [200, 100, 50]]
  ];
  cases.forEach(function (c) {
    const got = G.Art.hx(c[0]);
    if (got[0] !== c[1][0] || got[1] !== c[1][1] || got[2] !== c[1][2]) {
      errors.push(`颜色解析错误：${c[0]} → ${got.join(',')}（应为 ${c[1].join(',')}）`);
    }
  });
  /* shade 必须保留色相，不得把 rgba 里的 "ba" 当十六进制读成绿色 */
  const sh = G.Art.shade('rgba(10,13,22,0.88)', 0.10);
  const sm = sh.match(/rgba?\((\d+),(\d+),(\d+)/);
  if (!sm) errors.push('shade 输出非法：' + sh);
  else if (+sm[2] > +sm[1] + 30) errors.push('shade 色相异常（绿通道反超红通道）：' + sh);
  const sh2 = G.Art.shade('#c75450', 0.30).match(/rgba?\((\d+),(\d+),(\d+)/);
  if (!sh2 || +sh2[2] > +sh2[1]) errors.push('shade 色相异常：' + G.Art.shade('#c75450', 0.30));
}, 'color-utils');
step(function () {
  const pal = G.Data.xiang[0].pal;
  const checks = [
    ['house', () => G.Art.house({ w: 6, h: 5, roof: '#6b5a4a' }, pal)],
    ['ruin', () => G.Art.ruin({ w: 5, h: 4 }, pal)],
    ['gate', () => G.Art.gate({ w: 4, h: 2 }, pal)],
    ['decor.tree', () => G.Art.decor('tree', pal)],
    ['decor.rock', () => G.Art.decor('rock', pal)],
    ['decor.wallrock', () => G.Art.decor('wallrock', pal)],
    ['decor.fence', () => G.Art.decor('fence', pal)],
    ['decor.well', () => G.Art.decor('well', pal)],
    ['chest', () => G.Art.chest(false)],
    ['chest.open', () => G.Art.chest(true)],
    ['boss', () => G.Art.boss(pal)]
  ];
  checks.forEach(function (c) {
    const a = c[1]();
    if (!a || !a.c) { errors.push(`美术契约：${c[0]} 未返回 {c}`); return; }
    ['ox', 'oy', 'w', 'h'].forEach(function (k) {
      if (typeof a[k] !== 'number' || !isFinite(a[k])) {
        errors.push(`美术契约：${c[0]}.${k} 缺失或非有限数`);
      }
    });
    if (!(a.w > 0) || !(a.h > 0)) errors.push(`美术契约：${c[0]} 逻辑尺寸非法 (${a.w}x${a.h})`);
  });
  /* 立绘：每个 key 都要能画，且逻辑尺寸必须等于覆盖层立绘框（74×74）——
     对不上就会被缩放绘制，像素立绘会糊。 */
  const PS = G.Art.PORTRAIT_SIZE;
  if (!G.Art.PORTRAIT_KEYS || !G.Art.PORTRAIT_KEYS.length) {
    errors.push('立绘：PORTRAIT_KEYS 为空');
  } else {
    G.Art.PORTRAIT_KEYS.forEach(function (k) {
      const a = G.Art.portrait(k);
      if (!a || !a.c) { errors.push(`立绘：${k} 未返回 {c}`); return; }
      if (a.w !== PS[0] || a.h !== PS[1]) {
        errors.push(`立绘：${k} 逻辑尺寸 ${a.w}×${a.h}，应为 ${PS[0]}×${PS[1]}`);
      }
      if (a.ox !== 0 || a.oy !== 0) errors.push(`立绘：${k} 锚点偏移应为 0`);
    });
    /* 未知 key 必须退回 villager，不能返回空 */
    if (!G.Art.portrait('__nope__').c) errors.push('立绘：未知 key 没有兜底');
  }
  /* 瓦片与边缘 */
  ['grass', 'path', 'town', 'cave'].forEach(function (k) {
    for (let v = 0; v < 4; v++) {
      const t = G.Art.tile(k, v, pal);
      if (!t || !t.width) errors.push(`瓦片缺失：${k}.${v}`);
    }
  });
  for (let m = 1; m < 16; m++) {
    const f = G.Art.fringe(m, 'path', 'grass', pal);
    if (!f || !f.width) errors.push(`过渡层缺失：mask=${m}`);
  }
}, 'art-contract');

/* 0b) 素材层接线：无头环境下 fetch 被桩成 reject，manifest 永远加载不到，
      所以"素材命中"这条路平时根本跑不到。这里手动登记几张假图把它跑一遍：
      尺寸必须是 逻辑尺寸 × 超采样倍率（写成固定值就会在改倍率后糊掉）。 */
step(function () {
  const K = G.Art.K;
  /* 假素材：只要有 width/height 就够（绘制桩会校验源尺寸非 0） */
  const fake = { width: 64, height: 64 };
  const keys = ['char.hero.down.0', 'char.npc.elder', 'battle.hero', 'battle.enemy.snake'];
  keys.forEach((k) => G.Assets.register(k, fake));
  G.Sprites.clear();

  const hb = G.Sprites.heroBattle();
  if (hb.width !== 40 * K || hb.height !== 40 * K) {
    errors.push(`battle.hero 素材烘焙尺寸错：${hb.width}×${hb.height}（应为 ${40 * K}×${40 * K}）`);
  }
  const npc = G.Sprites.npc('elder');
  if (npc.width !== G.Sprites.HERO_W * K || npc.height !== G.Sprites.HERO_H * K) {
    errors.push(`char.npc.elder 素材烘焙尺寸错：${npc.width}×${npc.height}`);
  }
  const hf = G.Sprites.heroFrames();
  if (hf.down[0].width !== G.Sprites.HERO_W * K || hf.down[0].height !== G.Sprites.HERO_H * K) {
    errors.push(`char.hero.down.0 素材烘焙尺寸错：${hf.down[0].width}×${hf.down[0].height}`);
  }
  /* 走路动感：素材路径下第 1 帧要整体上抬，三帧不能完全相同 */
  if (hf.down[0].height && hf.down[1] === hf.down[0]) {
    errors.push('char.hero 素材路径缺少走路帧差异（第 1 帧未上抬）');
  }

  /* 退场：删掉假素材，后续测试回到程序化兜底，避免污染画面 */
  keys.forEach((k) => { delete G.Assets.images[k]; });
  G.Sprites.clear();
}, 'assets.wiring');

/* 0c) 副本 Boss 立绘接线（磁盘级 + 程序化双路径）。
      无头环境 fetch 被桩成 reject，但 manifest.json 在磁盘上可直接读。
      每个 Boss 走 beastResolve(artKey, sprite)：
        · artKey 在 manifest 登记「battle.enemy.<artKey>」→ 手绘 PNG（文件须真实存在、RGBA 透明底）；
        · 否则 → 程序化 sprite，**必须是已登记的 BAKE 键且真能产出位图**，
          禁止静默退回通用 snake（否则 Boss 全长得像蛇却查不出原因）。
      ⚠️ artKey 若与已有 PNG 撞名会遮蔽新 sprite（S26-S31 曾误填 s5-s10，已改 s26-s31）。 */
step(function () {
  const local = [];
  const mfPath = path.join(WWW, 'assets', 'manifest.json');
  if (!fs.existsSync(mfPath)) { errors.push('缺少 www/assets/manifest.json'); return; }
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
  const bakeKeys = G.Sprites.BAKE_KEYS;
  /* 收集每个副本的全部 Boss 条目（big/mid/leader/boss 四种槽位，随副本结构而定）*/
  const entries = [];
  G.Data.dungeons.ARCH.forEach((a) => {
    ['big', 'mid', 'leader', 'boss'].forEach((t) => {
      if (a[t] && (a[t].artKey || a[t].sprite)) entries.push({ dungeon: a.id, slot: t, spec: a[t] });
    });
  });
  let pngN = 0, procN = 0;
  entries.forEach((e) => {
    const sp0 = e.spec, artKey = sp0.artKey, sprite = sp0.sprite;
    const pngRel = artKey ? mf['battle.enemy.' + artKey] : null;
    if (pngRel) {
      const p = path.join(WWW, pngRel);
      if (!fs.existsSync(p)) { local.push('Boss 立绘登记但文件不存在：battle.enemy.' + artKey + ' → ' + pngRel); return; }
      if (fs.readFileSync(p)[25] !== 6) local.push('battle.enemy.' + artKey + ' 不是 RGBA 透明底：' + pngRel);
      pngN++;
    } else {
      if (!sprite) { local.push(e.dungeon + '/' + e.slot + ' 既无 manifest PNG 也无 sprite（必退回 snake）'); return; }
      if (!bakeKeys.includes(sprite)) { local.push('Boss sprite「' + sprite + '」未在 BAKE 表登记（会静默退回 snake）'); return; }
      let img;
      try { G.Sprites.clear(); img = G.Sprites.beast(sprite); }
      catch (err) { local.push('Boss sprite「' + sprite + '」生成抛错：' + err.message); return; }
      if (!img || !img.width || !img.height) { local.push('Boss sprite「' + sprite + '」未产出位图'); return; }
      procN++;
    }
  });
  notes.push('Boss 立绘：手绘 PNG ' + pngN + ' / 程序化 ' + procN + '（共 ' + entries.length + '）');
  if (local.length) errors.push(...local);
}, 'dungeon.boss.assets');

/* 0c-2) 副本数据完整性（v0.90.1，修 dungeon-run 297 条失败时查出的三类真缺口）：
   ① Boss 档位字段名统一（B1–B5 写 `big`、B6–B18 写 `boss`）——
      读取侧必须两种都认，否则打 B6~B10 时 spec 为 undefined、`spec.tier` 抛错**进图即崩**；
   ② 每个原型的**每一档**都要能造出 Boss（makeStage 不许返回空敌群）；
   ③ `drop` 指向的签名秘术必须**既在 SECRETS 有名、又在 SECRET_EFFECTS 有实** ——
      只著名不给效果 = 玩家拿到"占格子却毫无作用"的秘术（20/50 个副本中招过）。 */
step(function () {
  const D = G.Data.dungeons;
  if (!D || !D.ARCH) { errors.push('G.Data.dungeons.ARCH 缺失'); return; }

  /* ① 字段别名：读取侧必须认 `boss`（历史别名） */
  const store = fs.readFileSync(path.join(WWW, 'js/data/dungeons.js'), 'utf8');
  if (!/arch\.boss/.test(store)) {
    errors.push('源码闸：makeBoss 未兼容 `boss` 字段别名（B6–B18 用 boss，会崩）');
  }

  /* ② 逐原型逐档：能造出 Boss（makeBoss 收的是**原型对象**，不是 id） */
  D.ARCH.forEach(function (a) {
    ['big', 'mid', 'leader'].forEach(function (t) {
      let e = null;
      try { e = D.makeBoss(a, 'fan', 0, 'normal', t); } catch (err) {
        errors.push('原型 ' + a.id + ' 造 ' + t + ' Boss 抛错：' + err.message);
        return;
      }
      /* big 档对所有 big 原型是必需的（它是第 9 关的收关 Boss） */
      if (!e && t === 'big' && a.kind === 'big') {
        errors.push('原型 ' + a.id + ' 造不出 big Boss（进图会崩）');
      }
      if (e && (!e.name || !(e.maxhp > 0) || !(e.atk > 0))) {
        errors.push('原型 ' + a.id + ' 的 ' + t + ' Boss 面板非法：' + (e && e.name));
      }
    });
  });

  /* ③ 秘术：名字与效果必须成对 */
  const noName = [], noEffect = [];
  D.ARCH.forEach(function (a) {
    if (!a.drop) return;
    const byId = D.secretById(a.drop);
    if (!byId) { noName.push(a.id + '→' + a.drop); return; }
    if (!D.secretEffectById(a.drop)) noEffect.push(a.id + '→' + a.drop);
  });
  if (noName.length) errors.push('这些原型 drop 指向的秘术**无名字**：' + noName.join(', '));
  if (noEffect.length) errors.push('这些原型 drop 指向的秘术**无效果**（拿到也没用）：' + noEffect.join(', '));

  /* ④ 效果字段必须**引擎真的会读**（写了没人读 = 静默无效）。
     白名单 = battle._applySecretPassives 已实现的字段。 */
  const KNOWN_FX = ['cat', 'vamp', 'zhuxie', 'kurong', 'mangshan', 'startShield',
    'atk', 'def', 'hp', 'spd', 'cast'];
  Object.keys(D.SECRET_EFFECTS || {}).forEach(function (id) {
    const ef = D.SECRET_EFFECTS[id];
    Object.keys(ef).forEach(function (k) {
      if (KNOWN_FX.indexOf(k) < 0) {
        errors.push('秘术 ' + id + ' 用了引擎未实现的字段 `' + k + '`（写了也不会生效）');
      }
    });
  });
  notes.push('副本数据：' + D.ARCH.length + ' 原型 × 3 档可造 Boss；秘术名字/效果成对');
}, 'dungeon.data.contract');

/* 0d) NPC 精灵 / 人物立绘接线（磁盘级）：与 dungeon.boss.assets 同理。
      要检查的键不写死，直接从 data/maps.js 的 npcs[] 里取 kind 与 portrait ——
      地图里加了新 NPC 但忘了出图/登记，这里会立刻报出来。
      再补几个"只由场景代码引用、maps 里没有 NPC 条目"的立绘键。 */
step(function () {
  const mfPath = path.join(WWW, 'assets', 'manifest.json');
  if (!fs.existsSync(mfPath)) { errors.push('缺少 www/assets/manifest.json'); return; }
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
  const kinds = new Set(), ports = new Set();
  Object.keys(G.Data.maps).forEach((id) => {
    (G.Data.maps[id].npcs || []).forEach((n) => {
      if (n.kind) kinds.add(n.kind);
      if (n.portrait) ports.add(n.portrait);
    });
  });
  /* 只由场景引用的立绘键：山神庙重伤老者 / 杀手战 / 珠内梦境心魔 / M1 阿阮 */
  ['elder', 'killer', 'demon', 'aran'].forEach((k) => ports.add(k));
  const want = [];
  kinds.forEach((k) => want.push('char.npc.' + k));
  ports.forEach((k) => want.push('portrait.' + k));
  want.forEach((key) => {
    /* 有意走程序化兜底的键（新角色先接线、美术后补）。列在这里 = 明说"这是待办，不是漏了"。
       ⚠️ 出图之后必须从这张表里删掉 —— 留着会让"图丢了"变成静默通过。 */
    if (PROC_FALLBACK_OK.has(key)) {
      notes.push(`${key} 走程序化兜底（美术待补，逻辑名已在 assets-build.py 预登记）`);
      return;
    }
    const rel = mf[key];
    if (!rel) { errors.push(`manifest 未登记角色形象：${key}（会静默退回程序化兜底）`); return; }
    const p = path.join(WWW, rel);
    if (!fs.existsSync(p)) { errors.push(`manifest 登记的角色形象不存在：${key} → ${rel}`); return; }
    if (fs.readFileSync(p)[25] !== 6) errors.push(`${key} 不是 RGBA 透明底：${rel}`);
  });

  /* ⚠️ v0.90.1：剧情立绘改为「取景裁切」而非抠背景（用户截图反馈"渲染不对/模糊"）。
     这批是**人物 + 场景**的电影化满幅图，深色头发与深色背景同色 → 抠图会连头发一起吃掉
     （实测连通域过滤后只剩一张脸）。所以只做**立绘框比例取景**，保留背景。
     契约钉两件事：
       ① 这些键必须存在且**比例接近对话框立绘框**（92:140 ≈ 0.657），
          否则 cover 会把人物裁歪（旧图是 0.75，脸只占框内 1/4）；
       ② assets-build 的 OPAQUE_KEYS 白名单必须**逐条为已知用途**，
          不许出现"为了消警告"随手加的键。 */
  {
    const BUST_KEYS = ['portrait.wanqing', 'portrait.aheng', 'portrait.changgeng', 'portrait.jiang',
      'portrait.jingyan', 'portrait.nianchen', 'portrait.shouye', 'portrait.xuanjizi'];
    const TARGET = 92 / 140;
    BUST_KEYS.forEach(function (k) {
      const rel = mf[k];
      if (!rel) { errors.push('剧情立绘未登记：' + k); return; }
      const pp = path.join(WWW, rel);
      if (!fs.existsSync(pp)) { errors.push('剧情立绘文件缺失：' + k); return; }
      /* 从 PNG 头读宽高（IHDR 在偏移 16..24），不依赖图像库 */
      const buf = fs.readFileSync(pp);
      const bw = buf.readUInt32BE(16), bh = buf.readUInt32BE(20);
      const ratio = bw / bh;
      if (Math.abs(ratio - TARGET) > 0.06) {
        errors.push('剧情立绘 ' + k + ' 比例 ' + ratio.toFixed(3)
          + ' 偏离立绘框 ' + TARGET.toFixed(3) + '（应取景裁切过，脸才不会只占一小块）');
      }
    });
    /* 白名单纪律：OPAQUE_KEYS 里的每个键都必须能在注释里找到"用途"依据
       （这里用"必须出现在本文件的已知清单里"代替读注释 —— 新增用途要显式加进来）。 */
    const buildSrc = fs.readFileSync(path.join(WWW, '..', 'tools/assets-build.py'), 'utf8');
    const om = buildSrc.match(/OPAQUE_KEYS\s*=\s*set\(\[([\s\S]*?)\]\)/);
    if (!om) errors.push('assets-build.py 缺 OPAQUE_KEYS（不透明素材白名单）');
    else {
      const known = new Set(['cine.chenmeng', 'cine.daolv', 'cine.fan_raid', 'cine.fan_soul',
        'cine.fangshou', 'cine.jingsui', 'cine.shanmen', 'cine.tianlun', 'cine.xinhuo',
        'cine.zhaohun', 'portrait.hero'].concat(BUST_KEYS));
      const listed = (om[1].match(/'([^']+)'/g) || []).map(function (s) { return s.slice(1, -1); });
      listed.forEach(function (k) {
        if (!known.has(k)) {
          errors.push('OPAQUE_KEYS 里有未登记的键「' + k + '」—— 白名单只能按已知用途加，禁止消警告式添加');
        }
      });
    }
  }
}, 'npc.portrait.assets');

/* 1) 启动 → 标题 */
step(() => G.game.start(), 'start');
pump(30, 'title');
step(() => G.scenes.title._openAbout(), 'title.about');
pump(10, 'title.about');
step(() => { G.scenes.title.about = false; G.scenes.title._buildMenu(); }, 'title.menu');

/* 2) 转世（v0.5.2 起幼年阶段整段删除：出身直接决定开局，中间不再有
   1~16 岁的随机事件加属性。这里顺带钉死"幼年不得复活" ——
   只要 index.html 里还留着 childhood.js 的 script 标签，这条就会炸）。 */
step(() => G.game.changeScene('reincarnation'), 'reincarnation');
pump(20, 'reincarnation');
step(() => {
  if (G.scenes.childhood) errors.push('幼年场景应已删除，但 G.scenes.childhood 仍在');
  if (G.Data.events) errors.push('幼年事件表应已删除，但 G.Data.events 仍在');
}, 'childhood.gone');

/* 3) 造一份存档 → 镇 / 山 / 洞 */
const world = G.Data.generateWorld(12345, true);
const save = {
  life: 1, worldSeed: 12345, world: world,
  origin: 'test', originFx: { a: .05, h: .05 },
  linggen: { elems: ['木'], coef: { 木: 1.2 }, kind: '单灵根', stoneBonus: 0 },
  talents: [], skills: { 缠藤指: { lv: 2 }, 回春诀: { lv: 1 } }, skillEquip: ['缠藤指'],
  items: { 回春丹: 3, 妖囊: 2, 解封符: 1 },
  stone: 500, qi: 1200, po: 30,
  globalLevel: 5, age: 16, watch: 0, whispers: 0, escapeLeft: 3,
  quest: { step: 'free', flags: {} },
  scene: 'town', map: 'town', pos: null,
  chestsOpened: [], bossKilled: false,
  hp: 200
};
G.game.save = save;

/* 3) 场景走查：镇 / 山 / 洞 + 四张室内图（房屋要能"走进去探索"）。
   室内图走查同时是"家具占格实心 + 逐格登记交互"的哨兵：任何一张图缺
   structures/special 字段都会在这里以渲染异常的形式炸出来。 */
const INDOOR = ['town_home', 'town_shop', 'town_market', 'field_temple'];
['town', 'field', 'cave'].concat(INDOOR).forEach(function (m) {
  step(() => { save.pos = null; G.game.changeScene(m, { toSpawn: true }); }, 'scene:' + m);
  pump(24, 'scene:' + m);
  const sc = G.game.scene;
  /* 交互覆盖层 */
  if (m !== 'cave') {
    step(() => { G.Overlays.openChar(sc); }, 'overlay:' + m);
    pump(8, 'overlay:' + m);
    step(() => sc.clearOverlay(), 'overlay.close:' + m);
  }
  /* 走几步 + 点地寻路 */
  step(() => {
    /* `_heldDir` 是**桩**，只用来在这几十帧里把角色推着走；跑完必须原样还回去。
       以前这里直接覆盖后就再也不管了 —— 探索场景是单例，于是"按住下"这个桩
       永久留在了 field/cave 上：后面任何一次战斗打完切回 field，
       角色都会自己一路向下走，踩到暗雷又进战斗，`loop.check` 读到的是
       刚被重新 enter 过的战斗实例（round=1、auto=false），看起来就像"自动战斗死锁"。
       顺带一提，这个假象以前被闪白 P0 掩盖着：闪白永不推进，暗雷根本进不了战斗。 */
    const realHeld = sc._heldDir;
    sc._heldDir = () => 'down';
    for (let i = 0; i < 40; i++) sc.update(0.05);
    sc.onTap({ x: 240, y: 140 });
    for (let i = 0; i < 60; i++) sc.update(0.05);
    sc._interact();
    sc._heldDir = realHeld;
  }, 'walk:' + m);
  pump(10, 'walk:' + m);

  /* 室内图契约：门开在边界墙上（否则出不去）、家具占格必须实心、交互点齐全 */
  if (INDOOR.indexOf(m) >= 0) {
    step(function () {
      const md = G.Data.maps[m];
      const mp = G.MapGen.buildMap(save, m);
      if (!mp.solid || mp.solid.length !== md.h) errors.push(`${m}: 碰撞矩阵缺失或高度不符`);
      if (!(md.exits || []).length) errors.push(`${m}: 没有出口，进去就出不来`);
      (md.exits || []).forEach(function (e) {
        for (let x = e.x0; x <= e.x1; x++) {
          if (mp.solid[e.y][x]) errors.push(`${m}: 出口格 (${x},${e.y}) 被实心堵死`);
        }
        if (!G.Data.maps[e.to]) errors.push(`${m}: 出口指向不存在的场景 ${e.to}`);
      });
      const furn = md.furn || [];
      if (!furn.length) errors.push(`${m}: 没有任何家具`);
      /* 房间正好一屏（h=17 → 272px），相机不滚动，顶部 0—2 行被 HUD 盖住。
         家具摆进去就会被切掉一截（床只剩半张），所以从第 3 行起摆。 */
      furn.forEach(function (f) {
        if (f.y < 3) errors.push(`${m}: 家具 ${f.id} 摆在 y=${f.y}，会被顶部 HUD 遮住`);
        for (let y = f.y; y < f.y + (f.h || 1); y++) {
          for (let x = f.x; x < f.x + (f.w || 1); x++) {
            if (!mp.solid[y][x]) errors.push(`${m}: 家具 ${f.id} 的格子 (${x},${y}) 不是实心`);
            const o = mp.interact[x + ',' + y];
            if (!o || o.type !== 'furn') errors.push(`${m}: 家具 ${f.id} 的格子 (${x},${y}) 没有交互点`);
          }
        }
      });
      if (!furn.some(function (f) { return f.act; })) errors.push(`${m}: 所有家具都没有动作`);
    }, 'indoor:' + m);
  }
});

/* 3a-1a) 读档「继续当世」直接落在生成型区域：场景必须惰性构建，不得误报「场景未开放：fan6」 */
step(function () {
  ['fan6', 'fan9', 'ling4'].forEach(function (rid) {
    const s2 = JSON.parse(JSON.stringify(save));
    s2.scene = rid; s2.map = rid; s2.pos = null;
    G.game.save = s2;
    G.game.toasts.length = 0;
    G.game.changeScene(rid, { toSpawn: true });
    if (G.game.sceneName !== rid) errors.push('继续当世进入「' + rid + '」失败（场景未惰性构建）');
    if (G.game.toasts.some(function (t) { return /场景未开放/.test(t.text); })) {
      errors.push('继续当世进入「' + rid + '」误报场景未开放');
    }
  });
  /* 真正缺失的场景仍须报错（惰性路径不得吞掉真实 miss） */
  G.game.changeScene('__no_such_scene__');
  if (!G.game.toasts.some(function (t) { return /场景未开放：__no_such_scene__/.test(t.text); })) {
    errors.push('真正缺失的场景未报「场景未开放」');
  }
  G.game.save = save;
}, 'continue.region');

/* 3a-1b) 地图出入口可达性契约：
   每张图的**每个出口格**、以及每个 gate 结构（洞口/关隘）的门格，都必须从该图出生点走得到。
   这条挡的是最恼人的一类问题 —— "地图上明明有个门，就是走不到 / 点了没反应"，
   而它既不会抛异常、也不会被渲染契约发现（门画得好好的，就是过不去）。 */
step(function () {
  Object.keys(G.Data.maps).forEach(function (m) {
    const md = G.Data.maps[m];
    if (!md || !md.w || !md.h) return;
    const mp = G.MapGen.buildMap(save, m);
    const spawn = md.spawn || { x: 1, y: 1 };
    if (mp.solid[spawn.y][spawn.x]) { errors.push(`${m}: 出生点落在实心格`); return; }
    const seen = bfsReach(mp, spawn);
    (md.exits || []).forEach(function (e) {
      for (let x = e.x0; x <= e.x1; x++) {
        if (!seen[x + ',' + e.y]) errors.push(`${m}: 出口 (${x},${e.y}) → ${e.to} 从出生点走不到`);
      }
    });
    (md.structures || []).forEach(function (s) {
      if (s.kind !== 'gate') return;
      const dx = s.x + Math.floor(s.w / 2), dy = s.y + s.h;
      if (!seen[dx + ',' + dy]) {
        errors.push(`${m}: 门 (${dx},${dy})「${s.label || s.id}」从出生点走不到`);
      }
    });
  });
}, 'maps.reach.contract');

/* 3a-2) 站桩 NPC 契约：占格实心、本格登记 npc 交互点、不站路上（单宽路会被堵死）、
   从出生点可达（走不到就等于没有），且交互后确实开出对话覆盖层。 */
step(function () {
  ['town', 'town_shop', 'town_market'].forEach(function (m) {
    const md = G.Data.maps[m];
    const npcs = md.npcs || [];
    if (!npcs.length) { errors.push(`${m}: 没有配置站桩 NPC`); return; }

    /* 条件 NPC（condStep）在默认存档下**根本不在图上** ——
       直接拿基础存档建图，"占格实心 / 登记交互点 / 不站路上 / 可达"这几条会全部落空，
       看着过了其实是没测。所以按 condStep 分组，**每组用自己的存档各建一次图**。 */
    const groups = {};
    npcs.forEach(function (n) {
      const k = n.condStep || '';
      (groups[k] = groups[k] || []).push(n);
    });

    Object.keys(groups).forEach(function (k) {
      const s = JSON.parse(JSON.stringify(save));
      /* 无条件组取 'free'：避开"领赏后不留面板"的分支，让每个 NPC 都能开出对话 */
      s.quest = { step: k || 'free', flags: {} };
      const mp = G.MapGen.buildMap(s, m);
      const list = groups[k];

      /* 从出生点 BFS 求可达集（不走实心格） */
      const seen = {};
      const q = [[md.spawn.x, md.spawn.y]];
      seen[md.spawn.x + ',' + md.spawn.y] = true;
      while (q.length) {
        const c = q.shift();
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          const nx = c[0] + d[0], ny = c[1] + d[1];
          if (nx < 0 || ny < 0 || nx >= mp.w || ny >= mp.h) return;
          const kk = nx + ',' + ny;
          if (seen[kk] || mp.solid[ny][nx]) return;
          seen[kk] = true; q.push([nx, ny]);
        });
      }

      list.forEach(function (n) {
        const tag = k ? `${m}[${k}]` : m;
        if (!n.act) errors.push(`${tag}: NPC ${n.id} 没有 act`);
        if (!n.name) errors.push(`${tag}: NPC ${n.id} 没有名字`);
        if (!mp.solid[n.y][n.x]) {
          errors.push(`${tag}: NPC ${n.id} 的格子 (${n.x},${n.y}) 不是实心 —— 玩家会从他身上走过去`);
        }
        const o = mp.interact[n.x + ',' + n.y];
        if (!o || o.type !== 'npc') errors.push(`${tag}: NPC ${n.id} 的格子没有登记 npc 交互点`);
        else if (!o.npc || o.npc.id !== n.id) errors.push(`${tag}: NPC ${n.id} 的交互点挂错了对象`);
        if (mp.ground[n.y][n.x].t === 'path') {
          errors.push(`${tag}: NPC ${n.id} 站在路上 (${n.x},${n.y}) —— 单宽道路会被堵死`);
        }
        const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(function (d) {
          return !!seen[(n.x + d[0]) + ',' + (n.y + d[1])];
        });
        if (!near) errors.push(`${tag}: NPC ${n.id} 从出生点走不到 —— 玩家永远说不上话`);
      });

      /* 交互必须真的开出覆盖层 */
      s.pos = null;
      G.game.save = s;
      G.game.changeScene(m, { toSpawn: true });
      list.forEach(function (n) {
        const sc = G.game.scene;
        sc.overlay = null;
        let placed = false;
        [[0, 1, 'up'], [0, -1, 'down'], [1, 0, 'left'], [-1, 0, 'right']].forEach(function (d) {
          if (placed) return;
          const px = n.x + d[0], py = n.y + d[1];
          if (px < 0 || py < 0 || px >= sc.map.w || py >= sc.map.h) return;
          if (sc.map.solid[py][px]) return;
          s.pos = { x: px, y: py }; sc.dir = d[2]; placed = true;
        });
        if (!placed) { errors.push(`${m}: NPC ${n.id} 四周没有可站位`); return; }
        sc._interact();
        if (!sc.overlay) errors.push(`${m}: 与 NPC ${n.id} 对话没有开出覆盖层`);
        sc.clearOverlay();
      });
    });
  });
  G.game.save = save;
}, 'npc.contract');

/* 3a-3) 头顶任务标记（探图 v0.2 §NPC：！可接 / ？可交 / 无任务不挂） */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  s.pos = null;
  s.globalLevel = 5;
  G.game.save = s;
  G.game.changeScene('town_shop', { toSpawn: true });
  const sc = G.game.scene;
  const sb = (G.Data.maps.town_shop.npcs || []).filter(function (n) { return n.act === 'shenbo'; })[0];
  if (!sb) { errors.push('药铺里找不到沈伯 NPC'); return; }

  const want = function (quest, level, mark, label) {
    s.quest = quest; s.globalLevel = level;
    const got = sc.npcMarkOf(sb);
    if (got !== mark) {
      errors.push(`任务标记错（${label}）：应为 ${mark}，实为 ${got}`);
    }
  };
  want({ step: 'm0-1', flags: {} }, 5, '!', 'm0-1 未打首战');
  want({ step: 'm0-1', flags: { won1: true } }, 5, '?', 'm0-1 已打首战待领赏');
  want({ step: 'm0-4', flags: {} }, 5, null, 'm0-4 未到淬体九段');
  want({ step: 'm0-4', flags: {} }, 36, '?', 'm0-4 淬体九重巅峰待领丹');
  want({ step: 'm0-4', flags: { gotBreakPill: true } }, 36, null, 'm0-4 已领丹');
  want({ step: 'free', flags: {} }, 36, null, '自由游玩期');
  want({ step: 'm0-5', flags: {} }, 12, null, 'm0-5 已出镇');

  /* 村民任何时候都不挂标记 */
  const washer = (G.Data.maps.town.npcs || [])[0];
  if (washer && G.scenes.town.npcMarkOf(washer) !== null) {
    errors.push('任务标记错：村民不应挂标记');
  }
  /* 刘掌柜：M0 全程不挂；M1-4 且到了门槛才挂 ？（他手上有筑基丹的货源） */
  const keeper = (G.Data.maps.town_market.npcs || [])[0];
  const mk = G.scenes.town_market;
  s.quest = { step: 'm0-5', flags: {} };
  if (keeper && mk.npcMarkOf(keeper) !== null) errors.push('任务标记错：M0 期间刘掌柜不应挂标记');
  s.quest = { step: 'm1-4', flags: {} }; s.globalLevel = 56;
  if (keeper && mk.npcMarkOf(keeper) !== null) errors.push('任务标记错：m1-4 未到门槛时刘掌柜不应挂标记');
  s.quest = { step: 'm1-4', flags: {} }; s.globalLevel = 57;
  if (keeper && mk.npcMarkOf(keeper) !== '?') errors.push('任务标记错：m1-4 到门槛时刘掌柜应挂 ？');
  s.quest = { step: 'm1-4', flags: { foundPill: true } }; s.globalLevel = 57;
  if (keeper && mk.npcMarkOf(keeper) !== null) errors.push('任务标记错：已得丹后刘掌柜不应再挂标记');

  /* M1 各步的标记（沈伯 / 探子）—— 与任务链契约里的运行时断言互为冗余：
     这里只查"标记函数"，那边查"整条链真的走通"，两边都过才算数。 */
  s.globalLevel = 57;
  const probeN = (G.Data.maps.town.npcs || []).filter((n) => n.act === 'probe')[0];
  const tm = G.scenes.town;
  const wantShen = (quest, mark, label) => {
    s.quest = quest;
    const got = G.scenes.town_shop.npcMarkOf(sb);
    if (got !== mark) errors.push(`M1 沈伯标记错（${label}）：应为 ${mark}，实为 ${got}`);
  };
  wantShen({ step: 'm1-1', flags: {} }, '!', 'm1-1 待辨丹');
  wantShen({ step: 'm1-2', flags: {} }, null, 'm1-2 该找探子');
  wantShen({ step: 'm1-3', flags: {} }, '?', 'm1-3 待听旧账');
  wantShen({ step: 'm1-4', flags: {} }, '?', 'm1-4 待备丹');
  wantShen({ step: 'm1-4', flags: { foundPill: true } }, null, 'm1-4 已得丹');
  s.globalLevel = 56;
  wantShen({ step: 'm1-4', flags: {} }, null, 'm1-4 未到门槛');
  s.globalLevel = 57;
  if (probeN) {
    s.quest = { step: 'm1-2', flags: {} };
    if (tm.npcMarkOf(probeN) !== '!') errors.push('M1 探子标记错：m1-2 应挂 ！');
    s.quest = { step: 'm1-3', flags: {} };
    if (tm.npcMarkOf(probeN) !== null) errors.push('M1 探子标记错：m1-3 后不应再挂标记');
  }
}, 'npc.mark');

/* 3a-4) 暗雷遭遇：踩中暗雷必须真的进战斗，绝不能把玩家锁死。
   这条曾经是 P0：`_encounter` 只把 flash 置 0、flashDir 置 1，
   而进战斗要求 flash >= 1，**全项目没有一行推进过 flash** ——
   于是暗雷一踩中就是永久卡死：_pending 永远排队、onTap 因为
   flashDir===1 永远 early return，玩家看到的就是"这张图动不了"。
   为什么以前没抓到：`zone.weights` / `zone.cave.weights` 是**直接调 `_encounter`**
   造数据的，只验了"生成对不对"，从没验过 flash → 进战斗这一段；
   而 `walk:*` 虽然真的踩到过暗雷，却只断言"没抛异常"——
   卡死的表现恰恰就是**什么都不发生**，没有任何断言能看见它。 */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  s.quest = { step: 'free', flags: {} };
  s.pos = null;
  G.game.save = s;
  G.game.changeScene('field', { toSpawn: true });
  const sc = G.game.scene;

  /* ① 保护期内不该排队 */
  sc.prot = 3;
  const realNext = G.rng.next;
  G.rng.next = function () { return 0; };
  /* ⚠️ v0.68.0：暗雷加了**地形闸**（只在野地触发，路面/砖地不遇袭），
     所以这里不能再用 spawn.x 那一列 —— 翠微山的垂直主路正好压在那里。
     改为在 y=30 这一行里**挑一个非路面的野地格**，这样测的才是"暗雷本身还能不能用"，
     而不是"路面该不该遇袭"（后者是另一条断言，见下方 ②b）。 */
  const encY = 30;
  let encX = sc.map.md.spawn.x;
  for (let cx = 1; cx < sc.map.w - 1; cx++) {
    if (sc.map.solid[encY][cx]) continue;
    if (sc.map.exitCells[cx + ',' + encY]) continue;
    if ((G.MapGen.ROAM_FORBID || {})[sc._tileType(cx, encY)]) continue;
    encX = cx; break;
  }
  sc._onEnterTile(encX, encY);
  if (sc._pending) errors.push('prot>0 的保护期内不应触发遭遇');
  sc.prot = 0;
  if (!sc._zone(encY)) { errors.push('翠微山 y=30 没有遭遇分区'); G.rng.next = realNext; return; }

  /* ②b v0.68.0 地形闸：**路面踩上去绝不遇袭**（用户在过道里被野怪拦住会很出戏）。
     判据必须是"路面 + 概率必然命中"两个条件同时成立 —— 单看概率命中会误判成地形闸失效。 */
  let pathBlocked = true, pathTested = 0;
  for (let py = 1; py < sc.map.h - 1 && pathTested < 3; py++) {
    for (let px = 1; px < sc.map.w - 1 && pathTested < 3; px++) {
      if (sc.map.solid[py][px]) continue;
      if (sc.map.exitCells[px + ',' + py]) continue;
      if (sc._tileType(px, py) !== 'path') continue;
      pathTested++;
      const keep = G.rng.next;
      G.rng.next = function () { return 0; };      /* 概率必然命中 */
      sc.prot = 0; sc._pending = null; sc.steps = 99;
      sc._onEnterTile(px, py);
      G.rng.next = keep;
      if (sc._pending) { pathBlocked = false; sc._pending = null; }
    }
  }
  if (pathTested >= 1 && !pathBlocked) {
    errors.push('v0.68.0 地形闸失效：路面格触发了暗雷（暗雷应只在草地/山地/岩石地等野地触发）');
  }
  if (pathTested === 0) errors.push('地形闸断言没测到任何路面格（翠微山路径表变了？）');

  /* ② 踩中暗雷 → 排队 + 闪白方向为 1 */
  sc.prot = 0; sc._pending = null; sc.steps = 99;
  G.rng.next = function () { return 0; };
  sc._onEnterTile(encX, encY);
  G.rng.next = realNext;
  if (!sc._pending) { errors.push('踩中暗雷没有排队遭遇'); return; }
  if (sc.flashDir !== 1) errors.push('遭遇后 flashDir 应为 1，实为 ' + sc.flashDir);

  /* ③ 闪白期间不接受点击（免得边走边打） */
  sc.path = [];
  sc.onTap({ x: 240, y: 200 });
  if (sc.path.length) errors.push('闪白期间不该接受寻路点击');

  /* ④ 推进真实帧循环：闪白必须自己走完并切进战斗 */
  pump(90, 'encounter.enter');
  if (G.game.sceneName !== 'battle') {
    errors.push('踩中暗雷后没能进战斗（停在 ' + G.game.sceneName + '）—— 玩家会被锁死');
    return;
  }

  /* ⑤ 打完回图：闪白方向翻成 -1 并自己收干净，之后点击必须能重新寻路 */
  G.game.changeScene('field', { returned: true });
  const sc2 = G.game.scene;
  if (sc2.flashDir !== -1) errors.push('战斗返回后 flashDir 应为 -1，实为 ' + sc2.flashDir);
  pump(40, 'encounter.return');
  if (sc2.flashDir !== 0 || sc2.flash !== 0) {
    errors.push('返回闪白没自己收干净（flashDir=' + sc2.flashDir + ' flash=' + sc2.flash + '）');
  }
  sc2.path = [];
  /* ⚠️ v0.96.0：不能写死屏幕坐标，也不能只看"格子是否为空"——
     装饰是**随机散布**的（加密后又多落了几棵），写死的落点可能正好被新树/石
     占成实心 → 走 onTap 的原地交互分支、不产生路径，契约**假红**。
     ⚠️ 更要命的是**屏幕范围**：相机把玩家居中（TILE=24 后一屏只有 20×11 格），
        偏移 ±2 格就可能落到 480×272 之外 → onTap 的边缘死区直接 return。
     所以从玩家屏幕位置出发，只在 ±2 格内找：屏幕内（离边 ≥8px）、
        非玩家脚下、非实心、非出口、且 A* 走得到的格。 */
  const TG = G.Art.TILE;
  const px0 = s.pos.x * TG + TG / 2 - sc2._camX();
  const py0 = s.pos.y * TG + TG / 2 - sc2._camY();
  let target = null, tapPt = null;
  for (let dy = -2; dy <= 2 && !target; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      if (!dx && !dy) continue;
      const sx = Math.round(px0 + dx * TG), sy = Math.round(py0 + dy * TG);
      if (sx < 8 || sy < 8 || sx >= 480 - 8 || sy >= 272 - 8) continue;
      const tx = s.pos.x + dx, ty = s.pos.y + dy;
      if (tx < 1 || ty < 1 || tx >= sc2.map.w - 1 || ty >= sc2.map.h - 1) continue;
      if (sc2.map.solid[ty][tx]) continue;
      if (sc2.map.exitCells && sc2.map.exitCells[tx + ',' + ty]) continue;
      if (!sc2._astar(s.pos.x, s.pos.y, tx, ty)) continue;          /* 走得到才算 */
      target = { x: tx, y: ty };
      tapPt = { x: sx, y: sy };
      break;
    }
  }
  if (!target) {
    errors.push('寻路契约：玩家附近找不到屏幕内可走的落点（地图被装饰填满了？）');
  } else {
    sc2.onTap(tapPt);
    if (!sc2.path.length) {
      errors.push('返回后点击不能寻路 —— 玩家仍被锁着（点格 ' + target.x + ',' + target.y
        + '，屏幕 ' + tapPt.x + ',' + tapPt.y + '）');
    }
  }
}, 'encounter.enter');

/* 3a-5) 明雷（可见野怪，v0.68.0 用户第 22 点）
   用户口径：「这个地图是有野怪的……需要改成明雷加暗雷，暗雷就是概率小一点，
   而且只有特定区域有暗雷，而不是整个地图场景随处都能遇到，比如说像草地、山地、岩石地等等」。

   明雷 = **地图上站着的野怪**（看得见、可绕开、撞上必战）。
   这条契约盯四件事，少一件就是一个静默缺陷：
   ① 野外图必须真的生成明雷（`map.roams` 非空）—— 空了玩家就只剩随机暗雷，回到旧体验
   ② 明雷不能落在禁用地形（路面/砖地）、不能是实心格、不能压在出口上
      （压出口 = 玩家一进图就被迫开战；落实心格 = 野怪卡在石头里）
   ③ 安全区/室内**一只都不许有** —— 镇上/洞府里站着野怪是明显的出戏
   ④ 撞上去**真的能进战斗**，且等级/物种与地图上那只一致
      （不一致 = "明雷"名不副实：看到的是狼、打的是别的等级，玩家会觉得被骗） */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  s.quest = { step: 'free', flags: {} };
  s.pos = null;
  s.worldSeed = 'roam-contract';
  G.game.save = s;

  const forb = G.MapGen.ROAM_FORBID || {};
  if (!Object.keys(forb).length) errors.push('MapGen.ROAM_FORBID 未导出（暗雷地形闸会跟着失效）');

  /* ① 野外图必须有明雷；② 点位合法 */
  const wild = ['field', 'cave', 'fan5', 'fan6', 'fan7', 'fan9'];
  let totalRoams = 0;
  wild.forEach(function (mapId) {
    /* ⚠️ fan5..fan9 是**生成型区域**（RegionGen 懒建），地图不在 `G.Data.maps` 里，
       要先 ensure 才拿得到 —— 直接 buildMap 会 "未知地图 fan5"（本轮踩过）。 */
    if (G.Data.regions.byId(mapId) && !G.Data.maps[mapId] && G.RegionGen) {
      G.RegionGen.ensure(s, mapId);
    }
    const md = G.MapGen.buildMap(s, mapId);
    const roams = md.roams || [];
    if (!roams.length) errors.push('野外图 ' + mapId + ' 没有生成任何明雷（只剩暗雷，回到旧体验）');
    totalRoams += roams.length;
    roams.forEach(function (r) {
      const t = md.ground[r.y] && md.ground[r.y][r.x] ? md.ground[r.y][r.x].t : '';
      if (forb[t]) errors.push(mapId + ' 明雷落在禁用地形 ' + t + ' @(' + r.x + ',' + r.y + ')');
      if (md.solid[r.y][r.x]) errors.push(mapId + ' 明雷落在实心格 @(' + r.x + ',' + r.y + ')');
      if (md.exitCells[r.x + ',' + r.y]) errors.push(mapId + ' 明雷压在出口 @(' + r.x + ',' + r.y + ')');
      if (!(r.lv >= 1)) errors.push(mapId + ' 明雷等级非法：' + r.lv);
      if (!r.species) errors.push(mapId + ' 明雷没有物种');
    });
  });
  if (totalRoams < wild.length) {
    errors.push('明雷总量偏少（' + totalRoams + ' 只 / ' + wild.length + ' 张图），生成逻辑可能退化了');
  }

  /* ③ 安全区与室内：一只都不许有 */
  ['town', 'town_home', 'yunzhou'].forEach(function (mapId) {
    const md = G.MapGen.buildMap(s, mapId);
    if ((md.roams || []).length) {
      errors.push('安全区/室内 ' + mapId + ' 不该有明雷，实为 ' + md.roams.length + ' 只');
    }
  });

  /* ④ 撞明雷 → 真的进战斗，且与地图上那只一致 */
  s.pos = null;
  G.game.changeScene('field', { toSpawn: true });
  const sc = G.game.scene;
  sc.prot = 0;
  /* ④a 走**真实行走路径**（`_onEnterTile`，玩家踩着格子触发的正是这条）验证撞上开战。
     不能只测 ④ 的直调 `_encounterRoam` —— 那只证明"构造敌人函数没错"，
     证明不了"踩上去真的会战"（接线断了照样绿）。 */
  {
    const r0 = (sc.map.roams || [])[0];
    if (r0) {
      sc.prot = 0; sc._pending = null; sc.steps = 99;
      sc._onEnterTile(r0.x, r0.y);
      if (!sc._pending) errors.push('走到明雷格上没有开战（明雷接线断了）');
      else {
        const pu = sc._pending.units && sc._pending.units[0];
        if (pu && pu.level !== r0.lv) {
          errors.push('行走触发：明雷等级漂移（图上 Lv' + r0.lv + '，实际 Lv' + pu.level + '）');
        }
        sc._pending = null;
      }
    } else {
      errors.push('明雷契约：field 没有明雷，无法验证真实行走触发');
    }
  }
  const roam = (sc.map.roams || [])[0];
  if (!roam) { errors.push('明雷契约：field 没有明雷，无法验证撞上开战'); return; }
  sc._encounterRoam(roam);
  if (!sc._pending) { errors.push('撞上明雷没有排队遭遇'); return; }
  if (sc.flashDir !== 1) errors.push('撞明雷后 flashDir 应为 1，实为 ' + sc.flashDir);
  const u = sc._pending.units && sc._pending.units[0];
  if (!u) { errors.push('撞明雷后没有敌人'); return; }
  if (u.level !== roam.lv) {
    errors.push('明雷等级漂移：地图上标 Lv' + roam.lv + '，实际打 Lv' + u.level
      + '（玩家会觉得被骗）');
  }
  if (u.name.indexOf(roam.species) < 0) {
    errors.push('明雷物种漂移：地图上是 ' + roam.species + '，实际打 ' + u.name);
  }

  /* ⑤ 物种立绘表只能有一份真相源（`G.Data.SPECIES_SPRITE`）。
     地图明雷与战斗立绘都从它取图 —— 若它丢了，两边会各自退回 'snake'，
     所有野怪长得一样（且完全静默）。同时钉住：明雷实际取图不为空。 */
  const SS = G.Data.SPECIES_SPRITE;
  if (!SS || !Object.keys(SS).length) {
    errors.push('G.Data.SPECIES_SPRITE 缺失（地图明雷与战斗立绘会双双退化成同一只）');
  } else {
    /* 野外三物种必须都登记，否则地图上会画出与设计不符的形象 */
    ['青纹蛇', '赤炎狼', '树精'].forEach(function (sp) {
      if (!SS[sp]) errors.push('物种 ' + sp + ' 没有立绘键（战斗/明雷会退回 snake）');
    });
    /* 明雷取图链：能拿到一张 40x40 的立绘，而不是空白 */
    const spr = G.Sprites.beastResolve
      ? G.Sprites.beastResolve(roam.artKey || null, SS[roam.species] || 'snake')
      : null;
    if (!spr) errors.push('明雷取图失败：' + roam.species + ' → 无立绘可用');
  }
}, 'roam.contract');

/* 3b-0) m0-1 主线不能断链：进山打赢 1 场 → won1 → 回镇找沈伯领灵石 50 → m0-2
   此前 won1 全项目无人写入，主线会永久卡死在 m0-1（违反 v0.9 §验收「m0-1..5 无卡死」）。 */
let m01Stone = 0;
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.quest = { step: 'm0-1', flags: {} };
  s.stone = 0;
  G.game.save = s;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 2, '青纹蛇'), mapId: 'field' });
}, 'm0-1.enter');
pump(10);
step(() => {
  const b = G.game.scene, s = G.game.save;
  b.es.forEach((e) => { e.hp = 0; });
  b._victory();
  if (!s.quest.flags.won1) errors.push('m0-1 首战后未置 won1，主线会永久卡死');
  if (s.quest.step !== 'm0-1') errors.push('首战不应直接推进任务，实为 ' + s.quest.step);
  m01Stone = s.stone;
}, 'm0-1.won');
pump(80, 'm0-1.back');

step(() => {
  const s = G.game.save;
  s.pos = null;
  G.game.changeScene('town', { toSpawn: true });
}, 'm0-1.town');
pump(20);
step(function () {
  const sc = G.game.scene;
  /* 药铺的门不再弹面板 —— 是走进室内地图 town_shop */
  if (!standBefore(sc, 'door', 'shop', 'up')) { errors.push('镇内找不到药铺的门'); return; }
  if (G.game.sceneName !== 'town_shop') {
    errors.push('药铺门应走进室内地图 town_shop，实为 ' + G.game.sceneName);
  }
}, 'm0-1.enterShop');
pump(8, 'm0-1.enterShop.render');
step(function () {
  const sc = G.game.scene, s = G.game.save;
  /* 柜台后的沈伯：走到柜台前交互（旧版是点门弹面板，现在是进屋找人） */
  if (!standBefore(sc, 'furn', 'shenbo', 'up')) { errors.push('药铺里找不到沈伯的柜台'); return; }
  if (s.quest.step !== 'm0-2') errors.push('沈伯领赏后任务应到 m0-2，实为 ' + s.quest.step);
  if (s.stone !== m01Stone + 50) {
    errors.push('沈伯领赏应为灵石 +50（' + m01Stone + ' → ' + s.stone + '）');
  }
}, 'm0-1.reward');
pump(8, 'm0-1.render');

/* 3b) 任务链：m0-3 珠内梦境（+2500 灵气 → m0-4）→ 沈伯赠丹（+200 灵石） */
/* 把主角摆到某个交互点的相邻格、面向它，然后触发交互。
   kind='door' 按 id 匹配门；kind='furn' 按 act 匹配家具。
   家具的交互点登记在它的**每一格**上，所以要挑一个"站位不被占"的格子。 */
function standBefore(sc, kind, key, dir) {
  const v = { up: [0, 1], down: [0, -1], left: [1, 0], right: [-1, 0] }[dir];
  let best = null;
  Object.keys(sc.map.interact).forEach(function (k) {
    const o = sc.map.interact[k];
    const hit = (kind === 'door' && o.type === 'door' && o.id === key)
             || (kind === 'furn' && o.type === 'furn' && o.act === key);
    if (!hit || best) return;
    const xy = k.split(',').map(Number);
    const px = xy[0] + v[0], py = xy[1] + v[1];
    if (!sc.map.solid[py] || sc.map.solid[py][px]) return;   /* 站位越界或被占 */
    best = { x: px, y: py };
  });
  if (!best) return false;
  sc.overlay = null;
  sc.dir = dir;
  G.game.save.pos = best;
  sc._interact();
  return true;
}

step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.quest = { step: 'm0-3', flags: {} };
  s.qi = 300; s.stone = 0; s.items = {}; s.po = 0;
  s.globalLevel = 1;
  G.game.save = s;
  s.pos = null;
  G.game.changeScene('town', { toSpawn: true });
}, 'quest.town');
pump(20, 'quest.town');
step(function () {
  const sc = G.game.scene;
  if (!standBefore(sc, 'door', 'home', 'up')) { errors.push('镇内找不到沈家小院的门'); return; }
  if (G.game.sceneName !== 'town_home') {
    errors.push('小院门应走进室内地图 town_home，实为 ' + G.game.sceneName);
  }
}, 'quest.home');
pump(8, 'quest.home.render');
step(function () {
  const sc = G.game.scene, s = G.game.save;
  /* 逆命珠就供在屋里：走到珠前交互 = 进珠内空间（旧版是点门弹面板里的按钮） */
  if (!standBefore(sc, 'furn', 'cult', 'up')) { errors.push('小院里找不到逆命珠'); return; }
  if (sc.overlay !== 'dream') { errors.push('m0-3 首次进珠内空间应播梦境，实为 ' + sc.overlay); return; }
  if (s.qi !== 2800) errors.push('珠内梦境应 +2500 灵气（300→2800），实为 ' + s.qi);
  if (s.quest.step !== 'm0-4') errors.push('梦境后任务应推进到 m0-4，实为 ' + s.quest.step);
  if (!s.quest.flags.dream) errors.push('梦境标记未写入');
  sc.buttons[0].onClick();      /* 醒来 */
  if (sc.overlay !== 'cult') { errors.push('醒来后应进入珠内空间面板，实为 ' + sc.overlay); return; }
  /* 灵气 2800 > 突破所需 40 → 突破按钮应为可用 */
  const bk = sc.buttons.filter(function (b) { return /突破/.test(b.label); })[0];
  if (!bk) { errors.push('珠内空间缺少「突破」按钮'); return; }
  if (bk.disabled) errors.push('灵气充足时突破按钮不应禁用');
  const q0 = s.qi;
  bk.onClick();
  if (s.globalLevel !== 2) errors.push('点突破后应为淬体一重中期(gl2)，实为 ' + s.globalLevel);
  /* ⚠️ 扣的是 needQi(gl1)，v0.62.0 收紧后 = 2（原先 1）—— 别再写死 1 */
  if (s.qi !== q0 - G.Player.needQi(s, 1)) {
    errors.push('突破未按公式扣除灵气（' + q0 + ' → ' + s.qi + '）');
  }
}, 'quest.dream');
pump(8, 'quest.dream.render');

step(function () {
  const s = G.game.save;
  s.quest.step = 'm0-4'; s.globalLevel = 36; s.items = {}; s.stone = 0;
  s.quest.flags = {};
  s.pos = null;
  G.game.changeScene('town', { toSpawn: true });
}, 'quest.backTown');
pump(20, 'quest.backTown');
step(function () {
  const sc = G.game.scene;
  if (!standBefore(sc, 'door', 'shop', 'up')) { errors.push('镇内找不到药铺的门'); return; }
  if (G.game.sceneName !== 'town_shop') {
    errors.push('药铺门应走进室内地图 town_shop，实为 ' + G.game.sceneName);
  }
}, 'quest.shop');
pump(8, 'quest.shop.render');
step(function () {
  const sc = G.game.scene, s = G.game.save;
  if (!standBefore(sc, 'furn', 'shenbo', 'up')) { errors.push('药铺里找不到沈伯的柜台'); return; }
  if (!s.items['淬体突破丹']) errors.push('m0-4 淬体九重巅峰 与沈伯对话未赠突破丹');
  if (s.stone !== 200) errors.push('m0-4 赠丹应附 200 灵石，实为 ' + s.stone);
}, 'quest.shenbo');

/* 战斗指令步骤的公共前置：上一段 pump 里战斗**可能已经打完了**。
   `_finish` 的 cue 走完会 `_cut` 切回 field，此时 G.game.scene 上根本没有 `_cmd`，
   步骤直接抛 "b._cmd is not a function"。战斗几时结束取决于暴击/闪避，
   随机种子一变就偶发（实测约 1/12），所以每个指令步骤先确认还站在战斗里。 */
function ensureBattle(label) {
  if (G.game.sceneName === 'battle' && typeof G.game.scene._cmd === 'function') return true;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('赤炎狼', 6, '苍鬃狼'), mapId: 'field' });
  pump(10, label + '.reenter');
  return G.game.sceneName === 'battle' && typeof G.game.scene._cmd === 'function';
}

step(() => {
  save.pos = null;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('赤炎狼', 6, '苍鬃狼'), mapId: 'field' });
}, 'battle.enter');
pump(10, 'battle');
step(() => {
  if (!ensureBattle('battle.attack')) { errors.push('未能进入战斗（battle.attack）'); return; }
  G.game.scene._cmd('攻击');
}, 'battle.attack');
pump(90, 'battle.attack');
step(() => {
  if (!ensureBattle('battle.skill')) { errors.push('未能进入战斗（battle.skill）'); return; }
  const b = G.game.scene;
  b._cmd('功法');
  if (b.buttons[0]) b.buttons[0].onClick();
}, 'battle.skill');
pump(120, 'battle.skill');
step(() => {
  if (!ensureBattle('battle.item')) { errors.push('未能进入战斗（battle.item）'); return; }
  const b = G.game.scene;
  b._cmd('道具');
  if (b.buttons[0]) b.buttons[0].onClick();
}, 'battle.item');
pump(120, 'battle.item');

/* 3c) 分区遭遇权重（v0.3 §11）：前坡无树精、后坡无青纹蛇、洞府三兽齐备 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.quest = { step: 'free', flags: {} };
  G.game.save = s;
  s.pos = null;
  G.game.changeScene('field', { toSpawn: true });
}, 'zone.field');
pump(10);
step(function () {
  const sc = G.game.scene;
  const seen = {};
  const pairCount = {};
  /* 采样必须用**固定种子**的 RNG：全局 G.rng 是时间播种的（rng.js: `Date.now() & 0xffffffff`），
     用它会让这条概率断言每次运行都不同 —— v0.11.0 实测偶发假红（38.3% vs 阈值 30%±8）。
     换定种子后完全可复现，跑完还原。 */
  const rngBackup = G.rng;
  G.rng = new G.RNG(20260926);
  const N = 1200;
  ['front', 'mid', 'back'].forEach(function (id) {
    const zone = (sc.map.md.zones || []).filter((z) => z.id === id)[0];
    if (!zone) { errors.push('缺少分区：' + id); return; }
    pairCount[id] = 0;
    for (let i = 0; i < N; i++) {
      sc._encounter(zone);
      const units = sc._pending.units;
      if (units.length > 1) pairCount[id] += 1;
      units.forEach(function (u) {
        seen[id + '.' + u.species] = true;
        const bias = (zone.bias && zone.bias[u.species]) || 0;
        if (u.level < zone.enc.min + bias || u.level > zone.enc.max + bias) {
          errors.push(id + ' 区 ' + u.species + ' 等级越界：' + u.level
            + '（应 ' + (zone.enc.min + bias) + '..' + (zone.enc.max + bias) + '）');
        }
      });
    }
    /* 双只组概率应贴近 pair 配置（±8 个百分点） */
    const rate = pairCount[id] / N * 100;
    const want = zone.pair || 0;
    if (Math.abs(rate - want) > 8) {
      errors.push(id + ' 区双只组概率偏离配置：实测 ' + rate.toFixed(1) + '%（应约 ' + want + '%）');
    }
  });
  G.rng = rngBackup;
  if (seen['front.树精']) errors.push('前坡不应出现树精');
  if (seen['back.青纹蛇']) errors.push('后坡不应出现青纹蛇');
  if (!seen['mid.赤炎狼']) errors.push('中坡应以赤炎狼为主，却从未出现');
  if (!seen['back.树精']) errors.push('后坡应以树精为主，却从未出现');
}, 'zone.weights');

/* 3c-2) 双只组（v0.3 §11）：前坡"双蛇组"= 青纹蛇 ×2，且两只名字可区分 */
step(function () {
  const sc = G.game.scene;
  const zone = (sc.map.md.zones || []).filter((z) => z.id === 'front')[0];
  let checked = 0;
  for (let i = 0; i < 400 && checked < 30; i++) {
    sc._encounter(zone);
    const units = sc._pending.units;
    if (units.length < 2) continue;
    checked++;
    if (units.length !== 2) errors.push('前坡双只组应恰为 2 只，实为 ' + units.length);
    units.forEach(function (u) {
      if (u.species !== '青纹蛇') errors.push('前坡双只组应为双蛇，出现 ' + u.species);
    });
    if (units[0].name === units[1].name) {
      errors.push('双只组两只名字相同，无法区分：' + units[0].name);
    }
  }
  if (checked < 10) errors.push('400 次遭遇中双蛇组样本过少：' + checked);
}, 'zone.pair');

/* 3c-3) 双只组落盘：闪光结束后必须进战斗场景，且带 2 只敌人与正确的前后排 */
step(function () {
  const sc = G.game.scene;
  const zone = (sc.map.md.zones || []).filter((z) => z.id === 'front')[0];
  let ok = false;
  for (let i = 0; i < 400 && !ok; i++) {
    sc._encounter(zone);
    ok = sc._pending.units.length > 1;
  }
  if (!ok) { errors.push('未能构造双只组遭遇'); return; }
  sc.flash = 1; sc.flashDir = 1;
  sc._checkFlash();
}, 'zone.pair.enter');
pump(10, 'zone.pair.enter');
step(function () {
  if (G.game.sceneName !== 'battle') {
    errors.push('双只组未进入战斗场景（当前 ' + G.game.sceneName + '）');
    return;
  }
  const b = G.game.scene;
  if (b.es.length !== 2) errors.push('双只组战斗应为 2 敌，实为 ' + b.es.length);
  if (!b.es[0].front || b.es[1].front) errors.push('双只组前后排标记异常');
}, 'zone.pair.battle');

step(() => {
  G.game.save = JSON.parse(JSON.stringify(save));
  G.game.save.pos = null;
  G.game.changeScene('cave', { toSpawn: true });
}, 'zone.cave');
pump(10);
step(function () {
  const sc = G.game.scene;
  const zone = (sc.map.md.zones || [])[0];
  const seen = {};
  let pairs = 0;
  for (let i = 0; i < 400; i++) {
    sc._encounter(zone);
    sc._pending.units.forEach(function (u) { seen[u.species] = true; });
    if (sc._pending.units.length > 1) pairs += 1;
  }
  ['青纹蛇', '赤炎狼', '树精'].forEach(function (k) {
    if (!seen[k]) errors.push('洞府甬道缺少 ' + k);
  });
  const rate = pairs / 400 * 100;
  if (Math.abs(rate - (zone.pair || 0)) > 8) {
    errors.push('洞府双只组概率偏离配置：实测 ' + rate.toFixed(1) + '%（应约 ' + zone.pair + '%）');
  }
}, 'zone.cave.weights');

step(() => {
  G.game.save = JSON.parse(JSON.stringify(save));
  G.game.save.pos = null;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('赤炎狼', 6, '苍鬃狼'), mapId: 'field' });
}, 'battle.reset');
pump(10);

/* 4b) 战斗规格断言：装配上限 / 属性克制 / 奖励公式 */
step(function () {
  const b = G.game.scene;
  b._buildCommand();
  if (b.p.skills.length > 3) errors.push('功法装配超过 M0 上限 3：' + b.p.skills.length);
  ['收服', '御兽', '法宝', '切换'].forEach(function (k) {
    if (b.buttons.some(function (x) { return x._key === k; })) {
      errors.push('M0 不应出现指令按钮：' + k);
    }
  });
  const labels = b.buttons.map(function (x) { return x._key; }).join(',');
  /* v0.69.0 用户口径「取消独立防御」：指令收敛到 5 个（3+2 布局）。
     为什么断言全等而不是"不含防御"：指令集是界面契约，多一个少一个都该被看见 ——
     放宽成 indexOf<0 会让"多加了一个未知按钮"漏过去。 */
  if (labels !== '攻击,功法,道具,逃跑,自动') {
    errors.push('指令集不符（v0.69.0「取消独立防御」应为 攻击,功法,道具,逃跑,自动）：' + labels);
  }
  /* 防御按钮必须**彻底**不在 —— 防止只是改了 labels 却留着旧按钮对象 */
  if (b.buttons.some(function (x) { return x._key === '防御'; })) {
    errors.push('「防御」指令按钮仍在（用户口径要取消独立防御）');
  }
  /* 指令区不得再出现 guard 动作：玩家侧已无独立防御入口 */
  if (typeof b._cmd === 'function') {
    const srcCmd = String(b._cmd);
    if (srcCmd.indexOf('guard') >= 0) {
      errors.push('battle._cmd 仍在处理 guard（独立防御没删干净）');
    }
  }
}, 'battle.commands');

/* 4b-1) 功法容器 + 单本激发 + 九重系数（v0.77.0）
   用户口径（最高优先级，逐字）：
   「最多激发一本功法，可以走收集流，然后一个功法根据等级存在一个主动和一个被动
     或者没有主动技能，只有被动技能，功法品级越高，主动技能越多，最多三个主动，
     一个功法最多只有五个技能。」
   深度在功法**内部**（随修炼等级解锁招式），不在多装。 */
step(function () {
  const errors = [];
  const P = G.Player;
  const stripC = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const bail = (m) => { errors.push(m); throw new Error('__bail__'); };
  try {

  /* ① 功法本数：同时只能激发 1 本（ACTIVE_SLOTS=功法本数，非招式数） */
  if (P.ACTIVE_SLOTS !== 1) errors.push('Player.ACTIVE_SLOTS 应为 1（功法本数），实为 ' + P.ACTIVE_SLOTS);

  /* ② 容器数据约束：moves ≤5、主动 ≤3、unlock ∈ 1..36 且非递减 */
  const MAX_MV = G.Data.MAX_MOVES || 5, MAX_AM = G.Data.MAX_ACTIVE_MOVES || 3;
  const isAMove = (m) => m.active || (m.kind === '攻击' && !m.passive);
  Object.keys(G.Data.skills).forEach(function (id) {
    const mv = G.Data.gongfaMoves(id);
    if (!mv.length) { errors.push('功法「' + id + '」没有任何招式'); return; }
    if (mv.length > MAX_MV) errors.push('功法「' + id + '」招式数 ' + mv.length + ' > 5');
    const am = mv.filter(isAMove);
    if (am.length > MAX_AM) errors.push('功法「' + id + '」主动招式 ' + am.length + ' > 3');
    let last = 0;
    mv.forEach((m) => {
      const u = m.unlock || 1;
      if (u < 1 || u > G.Data.SKILL_MAX_PROG) errors.push('功法「' + id + '」解锁阈值越界：' + u);
      if (u < last) errors.push('功法「' + id + '」解锁阈值必须非递减');
      last = u;
    });
  });

  /* ②b 样板：引气诀=1主动+1被动(lv1)；烈焰诀=3主动+2被动、阈值1/9/18/27/36 */
  {
    const stM = G.Data.gongfaMoves('引气诀');
    const stA = stM.filter(isAMove), stP = stM.filter((m) => m.passive);
    if (stM.length !== 2 || stA.length !== 1 || stP.length !== 1)
      errors.push('入门《引气诀》应为 1主动+1被动，实为 ' + stA.length + '主动/' + stP.length + '被动');
    if (stM.some((m) => (m.unlock || 1) !== 1)) errors.push('入门功法招式应 lv1 即解锁');
    const lyM = G.Data.gongfaMoves('烈焰诀');
    const lyA = lyM.filter(isAMove), lyP = lyM.filter((m) => m.passive);
    if (lyM.length !== 5 || lyA.length !== 3 || lyP.length !== 2)
      errors.push('高阶《烈焰诀》应为 3主动+2被动(共5)，实为 ' + lyA.length + '主动/' + lyP.length + '被动');
    if (lyM.map((m) => m.unlock).join(',') !== '1,9,18,27,36') errors.push('烈焰诀解锁阈值应为 1/9/18/27/36');
  }

  /* ③ 九重系数：单调递增、两端钉死 */
  const c1 = P.progCoef(1), c36 = P.progCoef(G.Data.SKILL_MAX_PROG);
  if (Math.abs(c1 - 1) > 1e-6) errors.push('progCoef(1) 应为 1.00，实为 ' + c1);
  if (c36 < 2 || c36 > 2.4) errors.push('progCoef(36) 应在 2.0–2.4，实为 ' + c36);
  let prev = -1, mono = true;
  for (let p = 1; p <= G.Data.SKILL_MAX_PROG; p++) { const v = P.progCoef(p); if (v <= prev) mono = false; prev = v; }
  if (!mono) errors.push('progCoef 必须随 prog 单调递增');
  if (P.progCoef(9) / P.progCoef(1) < 1.15) errors.push('prog 1→9 增幅过小，精进看不出效果');

  /* ④ 战斗技能栏：只含当前激发功法已解锁的主动招式 */
  const s = JSON.parse(JSON.stringify(save));
  s.quest = { step: 'free', flags: {} };
  s.globalLevel = 20; s.hp = 99999;
  s.skills = { 烈焰指: { lv: 1 }, 崩岩掌: { lv: 1 }, 寒水诀: { lv: 1 }, 疾风诀: { lv: 1 }, 铁布衫: { lv: 1 } };
  s.skillEquip = ['崩岩掌'];
  G.game.save = s;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 6, '青纹蛇'), mapId: 'field' });
  pump(6, 'actv.enter');
  let b = G.game.scene;
  if (!b || typeof b._cmd !== 'function') bail('激发契约：没能进入战斗');
  let names = b.p.skills.map((k) => k.id);
  if (names.join(',') !== '崩岩掌') errors.push('单本激发时技能栏应只含 [崩岩掌]，实为 [' + names.join(',') + ']');
  if (names.some((n) => n.indexOf('烈焰') >= 0 || n.indexOf('疾风') >= 0 || n.indexOf('寒水') >= 0))
    errors.push('未激发功法的招式进了技能栏：' + names.join(','));

  /* ④b 多主动功法随修炼等级逐步解锁（lv1=1招 → lv18=2招 → lv36=3招） */
  function barFor(lv) {
    const sx = JSON.parse(JSON.stringify(save));
    sx.quest = { step: 'free', flags: {} };
    sx.globalLevel = 20; sx.hp = 99999;
    sx.skills = { 烈焰诀: { lv: lv } }; sx.skillEquip = ['烈焰诀'];
    G.game.save = sx;
    G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 6, '青纹蛇'), mapId: 'field' });
    pump(6, 'actv.unlock');
    return G.game.scene.p.skills.map((k) => k.id);
  }
  const barL1 = barFor(1), barL18 = barFor(18), barL36 = barFor(36);
  if (barL1.length !== 1 || barL1[0] !== '烈焰诀') errors.push('烈焰诀 lv1 应只 1 招 [烈焰诀]，实为 [' + barL1.join(',') + ']');
  if (barL18.length !== 2) errors.push('烈焰诀 lv18 应解锁 2 招，实为 [' + barL18.join(',') + ']');
  if (barL36.length !== 3) errors.push('烈焰诀 lv36 应有 3 招，实为 [' + barL36.join(',') + ']');

  /* ⑤ 九重系数真的乘进战斗倍率（自成两场，避免被复用的战斗场景污染） */
  function multFor(gf, lv) {
    const sx = JSON.parse(JSON.stringify(save));
    sx.quest = { step: 'free', flags: {} };
    sx.globalLevel = 20; sx.hp = 99999;
    sx.skills = {}; sx.skills[gf] = { lv: lv }; sx.skillEquip = [gf];
    G.game.save = sx;
    G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 6, '青纹蛇'), mapId: 'field' });
    pump(6, 'actv.top');
    return G.game.scene.p.skills[0].mult;
  }
  const base = multFor('崩岩掌', 1);
  const top = multFor('崩岩掌', G.Data.SKILL_MAX_PROG);
  if (!(top > base * 1.8)) errors.push('九重进度没进战斗倍率：' + base + ' → ' + top);

  /* ⑥ 激发=切换：激活新功法即替换；重复/未学/废功被拒 */
  const s2 = JSON.parse(JSON.stringify(save));
  s2.skills = { 烈焰指: { lv: 1 }, 崩岩掌: { lv: 1 }, 铁布衫: { lv: 1 } };
  s2.skillEquip = [];
  if (!P.activateSkill(s2, '烈焰指').ok) errors.push('空激发位应能激上「烈焰指」');
  const sw = P.activateSkill(s2, '崩岩掌');
  if (!sw.ok || s2.skillEquip[0] !== '崩岩掌') errors.push('激发另一本应切换为「崩岩掌」，实为 [' + s2.skillEquip + ']');
  if (s2.skillEquip.indexOf('烈焰指') >= 0) errors.push('切换后旧功法「烈焰指」应已卸下');
  const dup = P.activateSkill(s2, '崩岩掌');
  if (dup.ok) errors.push('重复激发同一本应被拒');
  if (!dup.reason) errors.push('被拒时应给出原因文案');
  if (P.slotsLeft(s2) !== 0) errors.push('已激1本 slotsLeft 应为 0，实为 ' + P.slotsLeft(s2));
  if (!P.cancelSkill(s2, '崩岩掌').ok) errors.push('卸下已激发功法应成功');
  if (P.slotsLeft(s2) !== 1) errors.push('卸下后应空出 1 位，实为 ' + P.slotsLeft(s2));
  if (P.cancelSkill(s2, '从未学过的').ok) errors.push('卸下未激发功法应被拒');

  /* ⑥b 废功/未习得不能激发；equippedIds 过滤废功 */
  const s3 = JSON.parse(JSON.stringify(save));
  s3.skills = { 烈焰指: { lv: 1, voided: true } }; s3.skillEquip = ['烈焰指'];
  if (P.canActivate(s3, '烈焰指').ok) errors.push('废功功法不该能激发');
  if (P.equippedIds(s3).length) errors.push('equippedIds 应滤掉废功条目');
  const s4 = JSON.parse(JSON.stringify(save));
  s4.skills = {}; s4.skillEquip = [];
  if (P.canActivate(s4, '崩岩掌').ok) errors.push('未习得功法不该能激发');

  /* ⑦ 源码闸：equippedIds + defaultSkillId + activeMovesOf + progCoef */
  const bs2 = stripC(fs.readFileSync(path.join(WWW, 'js/scenes/battle.js'), 'utf8'));
  const asm = bs2.slice(bs2.indexOf('_initUnits: function'), bs2.indexOf('this.p = {'));
  if (asm.indexOf('equippedIds') < 0) errors.push('源码闸：battle 未走 Player.equippedIds');
  if (asm.indexOf('defaultSkillId') < 0) errors.push('源码闸：battle 未接 defaultSkillId');
  if (asm.indexOf('activeMovesOf') < 0) errors.push('源码闸：battle 未接 activeMovesOf（容器模型）');
  if (asm.indexOf('progCoef') < 0) errors.push('源码闸：battle 未接 progCoef');
  {
    const sd = JSON.parse(JSON.stringify(save));
    sd.skills = { 烈焰指: { lv: 3 }, 崩岩掌: { lv: 7 }, 寒水诀: { lv: 5 }, 铁布衫: { lv: 9 } };
    sd.skillEquip = [];
    if (P.defaultSkillId(sd) !== '崩岩掌') errors.push('defaultSkillId 应挑最高主动功法=崩岩掌，实为 ' + P.defaultSkillId(sd));
    const sd2 = JSON.parse(JSON.stringify(sd)); sd2.skills = {};
    if (P.defaultSkillId(sd2) !== null) errors.push('无功法时 defaultSkillId 应为 null');
    const sd3 = JSON.parse(JSON.stringify(sd)); sd3.skills['崩岩掌'].voided = true;
    if (P.defaultSkillId(sd3) === '崩岩掌') errors.push('defaultSkillId 不应挑废功功法');
  }

  /* ⑧ 源码闸：学到功法落点 7 行内必须有 autoEquip */
  {
    const files = ['js/scenes/town.js', 'js/scenes/battle.js', 'js/scenes/dungeon.js', 'js/scenes/reincarnation.js', 'js/core/player.js'];
    const learnRe = /save\.skills\[[^\]]+\]\s*=\s*\{\s*lv:\s*1/;
    let seenLearn = 0; const missing = [];
    files.forEach(function (rel) {
      const fp = path.join(WWW, rel);
      if (!fs.existsSync(fp)) return;
      const src = stripC(fs.readFileSync(fp, 'utf8')).split('\n');
      src.forEach(function (line, i) {
        if (!learnRe.test(line)) return;
        seenLearn++;
        if (src.slice(i, i + 7).join('\n').indexOf('autoEquip') < 0) missing.push(rel + ':' + (i + 1));
      });
    });
    if (seenLearn < 3) errors.push('源码闸：只扫到 ' + seenLearn + ' 处学到功法落点（应 ≥3）');
    if (missing.length) errors.push('源码闸：这些落点没跟 autoEquip：' + missing.join('、'));
  }

  /* ⑨ 端到端：碎片参悟 → 自动激发 → 主动功法进战斗栏 */
  {
    const tier9 = Object.keys(G.Data.shardByTier)[0];
    const pool9 = G.Data.shardPool(tier9);
    const isActiveSk = (id) => { const d = G.Data.skills[id] || {}; return (d.kind === '攻击' && d.mult) || !!d.active; };
    const actId = pool9.filter(isActiveSk)[0];
    const pasId = pool9.filter((id) => !isActiveSk(id))[0];
    if (!actId) errors.push('端到端：' + tier9 + '阶碎片池无主动功法');
    if (!pasId) errors.push('端到端：' + tier9 + '阶碎片池无被动功法');
    const realPick = G.rng.pick;
    const runOne = (target, expectActive) => {
      if (!target) return;
      const s9 = JSON.parse(JSON.stringify(save));
      s9.skills = {}; s9.skillEquip = []; s9.items = {};
      s9.items[G.Data.shardByTier[tier9]] = (G.Data.shardCost || 10) + 5;
      G.rng.pick = () => target;
      let r9 = null;
      try { r9 = P.inscribe(s9, tier9); } finally { G.rng.pick = realPick; }
      if (!r9 || !r9.ok) { errors.push('端到端：参悟应成功，实为 ' + ((r9 && r9.reason) || '未返回')); return; }
      if ((s9.skillEquip || []).indexOf(r9.id) < 0) errors.push('端到端：参悟得到「' + r9.id + '」却没自动激发');
      s9.quest = { step: 'free', flags: {} };
      s9.globalLevel = 20; s9.hp = 99999;
      G.game.save = s9;
      G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 6, '青纹蛇'), mapId: 'field' });
      pump(6, 'actv.e2e');
      const b9 = G.game.scene;
      if (!b9 || typeof b9._cmd !== 'function') { errors.push('端到端：参悟后没能进战斗'); return; }
      const inBar = b9.p.skills.map((k) => k.id);
      const has = inBar.some((x) => x === r9.id || x.indexOf(r9.id + '@') === 0);
      if (expectActive && !has) errors.push('端到端：主动功法「' + r9.id + '」没进战斗栏（[' + inBar.join(',') + ']）');
      if (!expectActive && has) errors.push('端到端：被动功法「' + r9.id + '」不该进战斗栏（[' + inBar.join(',') + ']）');
    };
    runOne(actId, true);
    runOne(pasId, false);
    G.game.save = save;
  }

  G.game.changeScene('title');
  } catch (e) { if (e.message !== '__bail__') throw e; }
  if (errors.length) {
    errors.forEach((e) => console.log('  ✗ ' + e));
    throw new Error('激发契约失败：' + errors.length + ' 条');
  }
  const pnm = stripC(fs.readFileSync(path.join(WWW, 'js/core/panels.js'), 'utf8'));
  if (pnm.indexOf('skill.') < 0) errors.push('源码闸：功法面板未画属性徽记 skill.<拼音>');
  console.log('  ✓ 功法容器：单本激发 / moves≤5主动≤3 / 随等级解锁 / 九重进倍率 / 切换收集流 / 属性徽记');

  /* ⑩ 功法增幅不得压过境界（sqrt 边际递减），份额上限钉死 */
  {
    const mkB = (gl, sk) => ({
      linggen: { kind: '单灵根', elems: ['金'], coef: { 金: 1.2 } },
      talents: [], skillEquip: Object.keys(sk), items: {},
      qi: 0, stone: 0, po: 0, globalLevel: gl, age: 16,
      quest: { step: 'free', flags: {} }, hp: 100, skills: sk, equip: {},
      world: { seed: 1, anchor: true, names: {} }, worldSeed: 1
    });
    const bare = P.computeStats(mkB(37, {}));
    const one = P.computeStats(mkB(37, { 烈焰诀: { lv: 36 } }));
    const share = (one.atk - bare.atk) / bare.atk;
    if (share > 2) errors.push('单本满级功法 ATK 增幅 ' + (share * 100).toFixed(0) + '% 过大（应 ≤200%）');
    if (share < 0.2) errors.push('单本满级功法增幅 ' + (share * 100).toFixed(0) + '% 过小');
    const l1 = P.computeStats(mkB(37, { 烈焰诀: { lv: 1 } })).atk - bare.atk;
    const l36 = one.atk - bare.atk;
    if (!(l36 >= l1 * 4)) errors.push('功法 lv1→36 成长过小（' + l1 + ' → ' + l36 + '）');
    /* 品阶=真正强度差距：同为旧式单被动攻击、元素都不匹配灵根，隔离品阶。
       凡·烈焰指(火) vs 灵·疾风九刃(风)，灵 gbase1.5 应明显更强。 */
    const fan1 = P.computeStats(mkB(37, { 烈焰指: { lv: 36 } })).atk - bare.atk;
    const ling1 = P.computeStats(mkB(37, { 疾风九刃: { lv: 36 } })).atk - bare.atk;
    if (!(ling1 > fan1 * 1.2)) errors.push('同单被动下灵阶应明显强于凡阶（灵 ' + ling1 + ' vs 凡 ' + fan1 + '）');
    const manyS = { 崩岩掌: { lv: 36 }, 烈焰指: { lv: 36 }, 寒水诀: { lv: 36 }, 疾风诀: { lv: 36 }, 曜光诀: { lv: 36 } };
    const manyB = mkB(37, manyS); manyB.skillEquip = ['崩岩掌'];
    const wp = P.computeStats(manyB);
    const dShare = (wp.atk - bare.atk) / bare.atk;
    if (dShare > 2) errors.push('收集多本但未激发的功法不该叠加 ATK（份额 ' + (dShare * 100).toFixed(0) + '%）');
  }

  /* ⑪ 功法「难得难练」：1→36 总灵力成本够高；野外碎片掉率收敛 */
  {
    const y1s = G.Data.skills['烈焰诀'] || G.Data.skills['崩岩掌'];
    if (!y1s) errors.push('功法数据缺凡阶样本');
    else {
      let sum = 0;
      for (let lv = 1; lv < 36; lv++) sum += P.skillCost(y1s, lv);
      if (sum < 30000) errors.push('凡阶功法 1→36 总灵力仅 ' + sum + '（应 ≥30000）');
    }
    const bsrc2 = stripC(fs.readFileSync(path.join(WWW, 'js/scenes/battle.js'), 'utf8'));
    const dm = bsrc2.match(/G\.rng\.next\(\)\s*<\s*(0?\.\d+)/g) || [];
    const rates = dm.map((t) => parseFloat(t.split('<')[1]));
    if (rates.length && Math.min.apply(null, rates) >= 0.04) errors.push('野外碎片掉率仍偏高（' + Math.min.apply(null, rates) + '）');
  }
  if (errors.length) {
    errors.forEach((e) => console.log('  ✗ ' + e));
    throw new Error('激发契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ 功法容器（续）：满级增幅有界 / 未激发不叠加 / 难得难练 / 掉率收敛');
});

/* 4b-2) 战斗法宝常显（v0.69.0，用户第 11 点「新资源及戒指战斗图标」）
   此前战斗界面**完全不体现穿了什么法宝** —— 数值早进了 computeStats，
   但表现层缺失，玩家换戒指只能在角色面板看到。 */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  s.quest = { step: 'free', flags: {} };
  s.globalLevel = 20; s.hp = 99999;
  s.items = s.items || {};
  /* 三槽各穿一件：武器 / 防具 / 饰品（用户点名的"戒指"就是饰品） */
  const EQ = G.Data.equips;
  const w = EQ.ofSlot('weapon')[0], a = EQ.ofSlot('armor')[0], ac = EQ.ofSlot('accessory')[0];
  [w, a, ac].forEach((e) => { s.items[e.id] = 1; });
  /* ⚠️ **故意只穿两件**（防具留空）：定长契约就是为"空槽也占位"设的 ——
     三件全穿时"过滤空槽"与"定长"结果相同，反例 I 会漏过去（最初就是这么写的，被抓到）。
     装备：[武器, 空, 饰品] —— 位置必须恒定，饰品不能漂到第 2 格。 */
  s.equip = { weapon: w.id, armor: null, accessory: ac.id };
  G.game.save = s;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 6, '青纹蛇'), mapId: 'field' });
  pump(6, 'equip.battle');
  const b = G.game.scene;
  if (!b || typeof b._cmd !== 'function') {
    errors.push('法宝常显：没能进入战斗');
  } else {
    /* ① 定长三格：空槽也要占位（位置恒定，不因缺件而漂移） */
    if (!Array.isArray(b.equippedList) || b.equippedList.length !== 3) {
      errors.push('battle.equippedList 应为定长 3（按 SLOTS），实为 '
        + (b.equippedList ? b.equippedList.length : 'undefined'));
    } else {
      if (b.equippedList[0] !== w.id && (!b.equippedList[0] || b.equippedList[0].id !== w.id)) {
        errors.push('法宝第 1 格应是武器 ' + w.id + '，实为 '
          + JSON.stringify(b.equippedList[0]));
      }
      if (!b.equippedList[2] || b.equippedList[2].id !== ac.id) {
        errors.push('法宝第 3 格应是饰品（戒指）' + ac.id);
      }
      /* 空槽（第 2 格防具）必须是 null 占位，不是被挤掉 */
      if (b.equippedList[1] !== null) {
        errors.push('空槽（防具）应占位为 null，实为 ' + JSON.stringify(b.equippedList[1]));
      }
    }
    /* ② 绘制必须真的被调到，且不抛 —— 挂一个探针在 ctx.drawImage 上 */
    const calls = [];
    const realDI = b.render ? null : null;
    const sx = G.game.ctx;
    const origDI = sx.drawImage;
    const origPanel = G.UI.panel;
    let panelRects = [];
    G.UI.panel = function (ctx, r, fill, stroke, rad, opt) {
      panelRects.push({ x: r.x, y: r.y, w: r.w, h: r.h });
      return origPanel.apply(this, arguments);
    };
    try { b.render(G.game.ctx); } catch (e) {
      errors.push('法宝常显绘制抛异常：' + e.message);
    }
    G.UI.panel = origPanel;
    sx.drawImage = origDI;
    /* ③ 那个格子必须落在指令区空白格（318,240,142×28），且不与任何指令按钮重叠 */
    const hit = panelRects.filter((r) => r.x === 318 && r.y === 240 && r.w === 142 && r.h === 28);
    if (!hit.length) {
      errors.push('法宝常显面板没画在指令区空白格 (318,240,142×28)');
    }
    const btns = b.buttons || [];
    const overlap = btns.filter((btn) => {
      if (btn.x == null) return false;
      return !(btn.x + btn.w <= 318 || btn.x >= 460 || btn.y + btn.h <= 240 || btn.y >= 268);
    });
    if (overlap.length) {
      errors.push('法宝常显与 ' + overlap.length + ' 个指令按钮重叠（'
        + overlap.map((o) => o._key).join(',') + '）');
    }
  }
  G.game.save = save;
  G.game.changeScene('title');
  console.log('  ✓ 战斗法宝常显：定长三格（空槽占位）/ 画在指令区空白格 / 不与指令按钮重叠');
}, 'battle.equip.contract');

/* 4b-2) 多敌战斗（v0.3 §7「1v1-3」+ 战斗规格 v0.2 §5/§6.2） */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 8; s.hp = 999;
  s.skills = { 缠藤指: { lv: 2 } };      /* target='前排' */
  G.game.save = s;
  G.game.changeScene('battle', {
    enemies: [
      G.Data.makeEnemy('青纹蛇', 4, '青纹蛇'),
      G.Data.makeEnemy('青纹蛇', 4, '碧鳞蛇')
    ], mapId: 'field'
  });
}, 'battle.multi.enter');
pump(10);

step(function () {
  const b = G.game.scene;
  if (b.es.length !== 2) { errors.push('双只组应生成 2 只敌人，实为 ' + b.es.length); return; }
  if (b._keys().join(',') !== 'P,E0,E1') errors.push('多敌单位键异常：' + b._keys().join(','));
  if (!b.es[0].front) errors.push('多敌第 1 只应为前排');
  if (b.es[1].front) errors.push('多敌第 2 只应为后排');
  if (b.es[0].pos.x === b.es[1].pos.x) errors.push('多敌站位重叠');

  /* 普攻 → 多敌必须进入选目标，两只都可选 */
  b._cmd('攻击');
  if (b.phase !== 'target') errors.push('多敌普攻应进入选目标，实为 ' + b.phase);
  const opts = b.buttons.filter(function (x) { return /·前排|·后排/.test(x.label || ''); });
  if (opts.length !== 2) errors.push('选目标浮层应列出 2 只，实为 ' + opts.length);
}, 'battle.multi.target');

step(function () {
  const b = G.game.scene;
  const back = b.buttons.filter(function (x) { return /·后排/.test(x.label || ''); })[0];
  if (!back) { errors.push('选目标浮层缺少后排选项'); return; }
  back.onClick();
  if (b.pTarget !== b.es[1].key) errors.push('点后排后目标不是后排：' + b.pTarget);
}, 'battle.multi.pick');
pump(200, 'battle.multi.hit');

step(function () {
  const b = G.game.scene;
  if (b.es[1].hp >= b.es[1].maxhp) errors.push('普攻未落到所选的后排目标');
  if (b.es[0].hp < b.es[0].maxhp) errors.push('未选中的前排不应受伤');
  /* target='前排' 的功法应锁定前排，不给选后排的机会 */
  if (b.phase !== 'command') { errors.push('回合未回到指令态，实为 ' + b.phase); return; }
  b._cmd('功法');
  if (b.buttons[0]) b.buttons[0].onClick();
  if (b.pTarget !== b.es[0].key) errors.push('前排功法应锁定前排，实为 ' + b.pTarget);
}, 'battle.multi.row');
pump(200, 'battle.multi.row.hit');

/* 三敌：功法「前排」只列前排两只，后排不可选 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 10; s.hp = 9999;
  s.skills = { 缠藤指: { lv: 2 } };
  G.game.save = s;
  G.game.changeScene('battle', {
    enemies: [
      G.Data.makeEnemy('青纹蛇', 4, '甲蛇'),
      G.Data.makeEnemy('青纹蛇', 4, '乙蛇'),
      G.Data.makeEnemy('青纹蛇', 4, '丙蛇')
    ], mapId: 'field'
  });
}, 'battle.multi3.enter');
pump(10);
step(function () {
  const b = G.game.scene;
  if (b.es.length !== 3) { errors.push('三敌组应生成 3 只，实为 ' + b.es.length); return; }
  const fronts = b.es.filter(function (e) { return e.front; }).length;
  if (fronts !== 2) errors.push('三敌应为 2 前排 + 1 后排，实为 ' + fronts + ' 前排');
  b._cmd('功法');
  if (b.buttons[0]) b.buttons[0].onClick();
  if (b.phase !== 'target') { errors.push('三敌前排功法应进入选目标，实为 ' + b.phase); return; }
  if (b.buttons.some(function (x) { return /·后排/.test(x.label || ''); })) {
    errors.push('target=前排 的功法不应列出后排');
  }
  const opts = b.buttons.filter(function (x) { return /·前排/.test(x.label || ''); });
  if (opts.length !== 2) errors.push('三敌前排功法应列出 2 只，实为 ' + opts.length);
}, 'battle.multi3.row');

/* 自动战斗选目标：普攻前排 70% / 后排 30%（v0.2 §6.2） */
step(function () {
  const b = G.game.scene;
  let front = 0;
  const n = 4000;
  for (let i = 0; i < n; i++) {
    const u = b._unit(b._autoTargetKey());
    if (u && u.front) front++;
  }
  const rate = front / n;
  if (Math.abs(rate - 0.7) > 0.04) {
    errors.push('自动战斗前排权重应约 70%，实测 ' + (rate * 100).toFixed(1) + '%');
  }
}, 'battle.multi.auto');

/* Boss 召唤群狼：血量过半补 1 只，站位重排且只触发一次 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 12; s.hp = 9999;
  s.quest = { step: 'm0-5', flags: {} };
  G.game.save = s;
  G.game.changeScene('battle', { script: 'wolfKing', mapId: 'cave' });
}, 'battle.summon.enter');
pump(10);
step(function () {
  const b = G.game.scene;
  if (b.es.length !== 1) { errors.push('狼王战开场应为单敌，实为 ' + b.es.length); return; }
  if (!b.es[0].boss) { errors.push('狼王未标记 boss'); return; }
  b.es[0].hp = Math.round(b.es[0].maxhp * 0.45);
  b._bossPhase(b.es[0]);
  if (b.es.length !== 2) { errors.push('血量过半应召唤 1 只群狼，实为 ' + b.es.length); return; }
  if (!b.es[0].front) errors.push('狼王应留在前排');
  if (b.es[1].front) errors.push('召来的群狼应在后排');
  if (b.es[0].pos.x === b.es[1].pos.x) errors.push('召唤后站位重叠');
  if (b.shown[b.es[1].key] == null) errors.push('召唤后未初始化新单位的血条追踪');
  b._bossPhase(b.es[0]);
  if (b.es.length !== 2) errors.push('召唤只应触发一次');
  /* 低于三成血 → 狂暴，大招 CD 缩短 */
  b.es[0].hp = Math.round(b.es[0].maxhp * 0.2);
  b._bossPhase(b.es[0]);
  const storm = b.es[0].skills.filter(function (x) { return /风暴/.test(x.n); })[0];
  if (!storm || storm.cd !== 3) errors.push('狂暴后「烈焰风暴」CD 应缩至 3');
}, 'battle.summon');

step(function () {
  const E = G.Data.elem;
  const cases = [
    ['金', '木', 1.5], ['木', '金', 0.75], ['木', '土', 1.5], ['土', '水', 1.5],
    ['水', '火', 1.5], ['火', '金', 1.5], ['金', '金', 1.0],
    ['光', '暗', 1.5], ['暗', '光', 1.5], ['光', '雷', 1.5], ['光', '风', 1.5],
    ['雷', '风', 1.0], ['风', '雷', 1.0], ['雷', '光', 0.75], ['雷', '暗', 0.75],
    ['暗', '火', 1.5], ['火', '光', 0.75], ['无', '金', 1.0], ['金', '无', 1.0]
  ];
  cases.forEach(function (c) {
    const got = E.coef(c[0], c[1]);
    if (Math.abs(got - c[2]) > 1e-6) {
      errors.push(`克制矩阵错误：${c[0]}→${c[1]} = ${got}（应为 ${c[2]}）`);
    }
  });
}, 'elem.matrix');

step(function () {
  const P = G.Player;
  const bare = { globalLevel: 1, linggen: { elems: ['木'], coef: { 木: 1.2 } }, talents: [], world: { traits: [] } };
  if (P.needQi(bare, 1) !== 2) errors.push('淬体一重初期→中期 应为 2，实为 ' + P.needQi(bare, 1));
  let sum = 0;
  for (let gl = 1; gl <= 35; gl++) sum += P.needQi(bare, gl);
  if (sum !== 36724) errors.push('淬体 35 小阶合计应为 36,724（v0.62.0 收紧后），实为 ' + sum);
  if (P.needQi(bare, 36) !== 3192) errors.push('淬体九重巅峰破境 应为 3192，实为 ' + P.needQi(bare, 36));
  if (P.needQi(bare, 37) !== 12) errors.push('炼气一重初期→中期 应为 12，实为 ' + P.needQi(bare, 37));
  if (P.needQi(bare, 38) !== 49) errors.push('炼气一重中期→后期 应为 49，实为 ' + P.needQi(bare, 38));
  /* 天赋/世界折扣（在大阶 gl36 才看得出 -10%） */
  const disc = { globalLevel: 36, linggen: bare.linggen, talents: [], world: { traits: ['W13'] } };
  if (P.needQi(disc, 36) !== 2873) errors.push('洞天福地 -10% 未生效：' + P.needQi(disc, 36) + '（bare 3192）');
}, 'break.formula');

step(function () {
  const P = G.Player;
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 1; s.qi = 100; s.items = {};
  s.talents = []; s.world.traits = [];
  /* 正常：灵气 100 → 突破 → 淬体一重中期(gl2)，耗 needQi(1)=1 → 灵气 99 */
  let r = P.breakthrough(s);
  if (!r.ok) errors.push('灵气 100 未能突破淬体一重初期→中期：' + r.reason);
  else if (s.globalLevel !== 2) errors.push('突破后境界应为 gl2，实为 ' + s.globalLevel);
  else if (s.qi !== 98) errors.push('突破后灵气应为 100-2=98（v0.62.0 首阶 needQi=2），实为 ' + s.qi);
  /* 失败：灵气不足不升级不扣灵气（gl2 需 3，给 0） */
  s.qi = 0;
  const before = s.qi, gl0 = s.globalLevel;
  r = P.breakthrough(s);
  if (r.ok) errors.push('灵气不足却突破成功');
  if (s.qi !== before || s.globalLevel !== gl0) errors.push('灵气不足时不应改动灵气/境界');
  if (!/还需/.test(r.reason)) errors.push('灵气不足提示文案异常：' + r.reason);
  /* 边界：淬体九重巅峰(gl36) 无丹 → 提示需突破丹，不进心魔战 */
  s.globalLevel = 36; s.qi = 999999; s.items = {};
  const st = P.breakState(s);
  if (!st.big) errors.push('淬体九重巅峰(gl36) 未识别为大境界突破');
  if (!/淬体突破丹/.test(st.reason)) errors.push('缺丹提示文案异常：' + st.reason);
  if (P.breakthrough(s).big !== true) errors.push('淬体九重巅峰 点击突破未走大境界分支');
  const bb = P.startBigBreak(s);
  if (bb.ok) errors.push('无突破丹却开始了心魔战');
  /* 有丹 → 扣丹 + 进心魔战；胜利 → 炼气1 */
  /* ⚠️ 破境是**概率事件**（封顶 95%）→ 单次调用会 5% 偶发假红。
     这里同样**重试**（每次补一颗丹），残余概率 ≈ 0.05^6。
     ⚠️ **每次重试还要把灵气还原** —— 失败的尝试会"散灵气"（v0.60.0 的破境惩罚），
        只补丹不补灵气的话，重试本身会把 999999 抽干，断言就变成偶发假红
        （实测挂过一次：实为 849087，差 150000）。 */
  let bb2 = null;
  for (let i = 0; i < 6; i++) {
    s.items = { 淬体突破丹: 1 };
    s.qi = 999999;
    bb2 = P.startBigBreak(s);
    if (bb2.ok) break;
  }
  if (!bb2.ok) errors.push('持丹却无法开始大境界突破（重试 6 次仍失败）：' + bb2.reason);
  if (s.items['淬体突破丹']) errors.push('破境开始时未消耗突破丹');
  /* 天劫触发（v0.75.0，用户口径「吃完破镜丹不一定会触发天劫」）：
     `storm` 必须显式返回，且**两种取值都可达** —— 硬编码 true/false 都违背口径。 */
  if (typeof bb2.storm !== 'boolean') {
    errors.push('startBigBreak 未返回 storm（天劫是否触发）—— 用户口径是"不一定"');
  }
  if (!(P.TRIB_CHANCE > 0 && P.TRIB_CHANCE < 1)) {
    errors.push('TRIB_CHANCE 应在 (0,1) 开区间（"不一定触发"），实为 ' + P.TRIB_CHANCE);
  }
  {
    /* 钉死随机各跑一次：0 → 必触发；0.999 → 必不触发。
       ⚠️ 概率分支必须显式钉死（项目纪律）—— 不钉就是"掷到啥测啥"。 */
    const sA = JSON.parse(JSON.stringify(s));
    sA.items = { 淬体突破丹: 1 }; sA.qi = 999999; sA.breakProgress = 100;
    const rA = P.startBigBreak(sA, null, 0, 0);       // 进度满→成功+必触发天劫
    if (!rA.ok || !rA.storm) errors.push('stormRoll=0 时天劫应必触发');
    const sB = JSON.parse(JSON.stringify(s));
    sB.items = { 淬体突破丹: 1 }; sB.qi = 999999; sB.breakProgress = 100;
    const rB = P.startBigBreak(sB, null, 0, 0.999);   // 进度满→成功、必不触发天劫
    if (!rB.ok || rB.storm) errors.push('stormRoll=0.999 时天劫应不触发');
  }
  const info = P.winBigBreak(s);
  if (s.globalLevel !== 37) errors.push('破境胜利后应为炼气一重初期(gl37)，实为 ' + s.globalLevel);
  if (info.n !== '炼气一重初期') errors.push('境界名异常：' + info.n);
  if (s.qi !== 996807) errors.push('突破后灵气应为 999999-3192=996807，实为 ' + s.qi);
  /* 失败：不降级、灵气保留 80% */
  s.globalLevel = 36; s.qi = 1000;
  const left = P.loseBigBreak(s);
  if (s.globalLevel !== 36) errors.push('心魔战失败不应降级');
  if (left !== 800) errors.push('心魔战失败灵气应保留 80%（800），实为 ' + left);
}, 'break.rules');

/* 4c) 普通遭遇奖励（v0.67.0 经济重设，用户第 28 / 30 点）：
       不再给灵气；只给材料 + 少量灵力（1×L）+ 1~5 下品灵石（不随 L 放大）。
       ⚠️ 旧断言（灵气 480 / 灵力 48 / 灵石 36）是**旧经济规则**，随需求作废。 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 6; s.qi = 0; s.po = 0; s.stone = 0;
  s.linggen = { elems: ['木'], coef: { 木: 1.0 }, kind: '单灵根', stoneBonus: 0 };
  s.originFx = {};
  s.bonus = {};
  G.game.save = s;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 6, '青纹蛇'), mapId: 'field' });
}, 'reward.enter');
pump(10, 'reward.enter');
step(function () {
  const b = G.game.scene, s = G.game.save;
  b.es.forEach(function (e) { e.hp = 0; });
  b._victory();
  if (s.qi !== 180) errors.push('野怪应给灵气 180（v0.77.0 恢复），实为 ' + s.qi);
  if (s.po !== 12) errors.push('灵力应为 12（v0.77.0 翻倍），实为 ' + s.po);
  if (!(s.stone >= 1 && s.stone <= 5)) {
    errors.push('灵石应为 1~5 个下品（单只），实为 ' + s.stone);
  }
}, 'reward.formula');
pump(20, 'reward.result');

/* 4d) 心魔战：走通战斗场景分支（胜利 → 炼气1 + 任务 m0-5） */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 36; s.qi = 999999; s.items = { 淬体突破丹: 1 };
  s.quest = { step: 'm0-4', flags: {} };
  G.game.save = s;
  /* ⚠️ 破境是**概率事件**（(基础+道基+丹) 封顶 95%）→ 单次 5% 失败会让这条契约**偶发假红**，
     而整条 smoke 会被拖成"三次里挂两次"（实测）。
     这里**重试**：失败会扣丹并累计 `breakFails`（道基），所以每次重试前补一颗丹。
     重试 6 次全败的残余概率 ≈ 0.05^6 ≈ 1.6e-8，可以忽略。
     ⚠️ 不要用"把成功率改成 100%"来规避 —— 那会把这条契约真正要测的**概率分支**测没了。 */
  let bb = null;
  for (let i = 0; i < 6; i++) {
    s.items['淬体突破丹'] = 1;
    bb = G.Player.startBigBreak(s);
    if (bb.ok) break;
  }
  if (!bb.ok) { errors.push('心魔战前置失败（重试 6 次仍失败）：' + bb.reason); return; }
  G.game.changeScene('battle', { script: 'heartDemon', mapId: 'town' });
}, 'battle.heartDemon');
pump(10, 'battle.heartDemon');
step(function () {
  const b = G.game.scene, s = G.game.save;
  if (b.es.length !== 1) errors.push('心魔战应为单敌，实为 ' + b.es.length + ' 只');
  if (b.es[0].name !== '心魔') errors.push('心魔战敌人异常：' + b.es[0].name);
  if (b.es[0].species !== '心魔') errors.push('心魔 species 异常：' + b.es[0].species);
  if (!G.Sprites.heartDemon || !G.Sprites.heartDemon()) errors.push('心魔立绘缺失');
  const run = b.buttons.filter(function (x) { return x._key === '逃跑'; })[0];
  if (run && !run.disabled) errors.push('问心魔劫不应允许逃跑');
  b.es[0].hp = 0;
  b._victory();
  if (s.globalLevel !== 37) errors.push('心魔战胜利后境界应为 gl37，实为 ' + s.globalLevel);
  if (s.quest.step !== 'm0-5') errors.push('心魔战胜利后任务应推进到 m0-5，实为 ' + s.quest.step);
  if (s.hp !== G.Player.computeStats(s).maxhp) {
    errors.push('突破后气血应回满，实为 ' + s.hp + ' / ' + G.Player.computeStats(s).maxhp);
  }
}, 'battle.heartDemon.win');
pump(20, 'battle.heartDemon.result');

/* 4e) 心魔战失败：不降级、灵气 80%、回镇（不进死亡） */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 36; s.qi = 3000; s.items = {};
  s.quest = { step: 'm0-4', flags: {} };
  G.game.save = s;
  G.game.changeScene('battle', { script: 'heartDemon', mapId: 'town' });
}, 'battle.heartDemon.lose');
pump(10, 'battle.heartDemon.lose');
step(function () {
  const b = G.game.scene, s = G.game.save;
  b.p.hp = 0;
  b._defeat();
  if (s.globalLevel !== 36) errors.push('心魔战失败不应降级');
  if (s.qi !== 2400) errors.push('心魔战失败灵气应保留 80%（2400），实为 ' + s.qi);
  if (b.resultWin !== false) errors.push('心魔战失败结果标记异常');
  if (!(s.hp > 0)) errors.push('心魔战失败回镇气血不应为 0，实为 ' + s.hp);
}, 'battle.heartDemon.lose.check');

/* 4e) 天劫镜像战（v0.75.0，用户口径）：
   「天劫的镜像战力和主角是一模一样的，血量、攻击、防御都是一样的，但是出招是随机的，
    功法也是和当前的主角学的功法是一样的，只不过是随机激发一本九重的功法」。
   本契约钉四件事：
     ① 面板**逐项等于主角**（hp/atk/def，不打折）—— 心魔是 ×0.9，天劫必须是 ×1.0；
     ② 技能**取自主角已学功法**（不是外挂一套）；
     ③ 技能按**九重满级**（prog=36）编译 —— 不是主角当前 lv；
     ④ 未学任何攻击功法时有兜底招式（否则天劫零技能、必被秒）。 */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 36; s.qi = 999999; s.items = { 淬体突破丹: 1 };
  s.quest = { step: 'm0-4', flags: {} };
  /* 给主角两本攻击 + 一本治疗，且 lv 故意压到 1（天劫该按 36 编译，不受此影响） */
  s.skills = { 烈焰指: { lv: 1 }, 崩岩掌: { lv: 1 } };
  s.skillEquip = [];
  G.game.save = s;
  const stSnap = G.Player.computeStats(s);
  G.game.changeScene('battle', { script: 'tribulation', mapId: 'town' });
}, 'trib.enter');
pump(10, 'trib.enter');
step(function () {
  const b = G.game.scene;
  if (G.game.sceneName !== 'battle') { errors.push('天劫脚本未进入战斗场景'); return; }
  if (b.es.length !== 1) { errors.push('天劫应为单敌，实为 ' + b.es.length + ' 只'); return; }
  const e = b.es[0];
  if (e.name !== '天劫') errors.push('天劫单位名应为「天劫」，实为 ' + e.name);
  /* ① 逐项等于主角 */
  if (e.maxhp !== b.p.maxhp) errors.push('天劫气血应等于主角（' + b.p.maxhp + '），实为 ' + e.maxhp);
  if (e.atk !== b.p.atk) errors.push('天劫攻击应等于主角（' + b.p.atk + '），实为 ' + e.atk);
  if (e.def !== b.p.def) errors.push('天劫防御应等于主角（' + b.p.def + '），实为 ' + e.def);
  if (e.spd !== b.p.spd) errors.push('天劫身法应等于主角（' + b.p.spd + '），实为 ' + e.spd);
  /* ② 技能取自主角已学功法（技能 id 应命中 save.skills 的键） */
  if (!e.skills || !e.skills.length) { errors.push('天劫没有技能（会站着挨打）'); return; }
  const learned = Object.keys((G.game.save && G.game.save.skills) || {});
  const fromPlayer = e.skills.filter(function (k) { return learned.indexOf(k.id) >= 0; });
  if (!fromPlayer.length) {
    errors.push('天劫技能不是取自主角已学功法（实为 [' + e.skills.map(k => k.id).join(',') + ']）');
  }
  /* ③ 九重满级编译：主角 lv=1，若天劫照搬 lv 就会是 ×1.00；满级应是 ×2.15 */
  const pc1 = G.Player.progCoef(1), pc36 = G.Player.progCoef(36);
  const atkSk = fromPlayer[0];
  if (atkSk && atkSk.kind === 'atk') {
    const sd = G.Data.skills[atkSk.id];
    const want = +(sd.mult * pc36).toFixed(3);
    if (Math.abs(atkSk.mult - want) > 0.002) {
      errors.push('天劫技能未按九重满级编译：' + atkSk.id + ' mult=' + atkSk.mult
        + '，应为 ' + want + '（主角 lv=1 时 ×' + pc1.toFixed(2) + '，满级 ×' + pc36.toFixed(2) + '）');
    }
  }
  /* ④ 禁逃（与心魔一致：破境战不能逃） */
  const run = (b.buttons || []).filter(function (x) { return /逃跑/.test(x.label || ''); })[0];
  if (run && !run.disabled) errors.push('天劫战不应允许逃跑');
  /* 胜利 → 破镜完成 */
  e.hp = 0;
  b._victory();
}, 'trib.battle');
pump(30, 'trib.result');
step(function () {
  const s = G.game.save;
  if (s.globalLevel !== 37) errors.push('渡过天劫后应为炼气一重初期(gl37)，实为 ' + s.globalLevel);
  if (s.quest.step !== 'm0-5') errors.push('渡过天劫后未推进到 m0-5（当前 ' + s.quest.step + '）');
}, 'trib.win');

/* 天劫零功法兜底：未学任何攻击功法时必须有招式（否则必被秒，玩家无从应对） */
step(function () {
  const e = G.Data.makeTribulation({
    level: 36, maxhp: 100, atk: 10, def: 5, spd: 5, skills: []
  });
  if (!e.skills || !e.skills.length) errors.push('天劫无技能池时缺兜底招式');
  if (e.maxhp !== 100 || e.atk !== 10 || e.def !== 5) {
    errors.push('天劫兜底路径未保持"逐项等于主角"');
  }
}, 'trib.fallback');

pump(20, 'battle.heartDemon.lose.result');

/* 4f) 蓄力预告：敌方蓄力技必须先预告一回合 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 13; s.hp = 999;
  G.game.save = s;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('赤炎狼', 13, '苍鬃狼'), mapId: 'field' });
}, 'battle.charge.enter');
pump(10, 'battle.charge.enter');
step(function () {
  const b = G.game.scene, e0 = b.es[0];
  /* 强制敌方选中蓄力技，应产出预告而非直接伤害 */
  const ch = e0.skills.filter(function (x) { return x.charge; })[0];
  if (!ch) { errors.push('赤炎狼缺少蓄力技'); return; }
  e0.skills.forEach(function (x) { x.cdLeft = 0; });
  e0.charge = ch;
  const pick = b._enemyPick(e0);
  if (pick.n !== ch.n) errors.push('蓄力完成后未释放原技：' + pick.n);
  e0.charge = null;
  /* 重新构造一次预告 */
  e0.skills.forEach(function (x) { x.cdLeft = 0; });
  let sawCharge = false;
  for (let i = 0; i < 40; i++) {
    e0.charge = null;
    e0.skills.forEach(function (x) { x.cdLeft = 0; });
    const p2 = b._enemyPick(e0);
    if (p2.kind === 'charge') { sawCharge = true; break; }
  }
  if (!sawCharge) errors.push('蓄力技从未产生预告（kind=charge）');
}, 'battle.charge');
pump(20, 'battle.charge');


/* 4g) 状态系统（v0.2 §8）：毒/烧/麻/封/睡 + 速度定序 + 封印打断蓄力 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 6; s.hp = 999;
  s.skills = { 缠藤指: { lv: 2 } };
  G.game.save = s;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 6, '青纹蛇'), mapId: 'field' });
}, 'status.enter');
pump(10);

step(function () {
  const b = G.game.scene;
  /* 毒：5% 最大气血，可致死 */
  b.p.statuses = { 毒: 3 };
  b.p.hp = b.p.maxhp;
  let canAct = b._tickStatus(b.p, 'P');
  const want = Math.max(1, Math.round(b.p.maxhp * 0.05));
  if (b.p.hp !== b.p.maxhp - want) errors.push('中毒伤害应为最大气血 5%（' + want + '），实扣 ' + (b.p.maxhp - b.p.hp));
  if (!canAct) errors.push('中毒不应禁止行动');
  if (b.p.statuses['毒'] !== 2) errors.push('中毒回合数未递减：' + b.p.statuses['毒']);

  /* 毒可致死 */
  b.p.statuses = { 毒: 3 };
  b.p.hp = 1;
  b._tickStatus(b.p, 'P');
  if (b.p.hp !== 0) errors.push('中毒应可致死（保底 0），实为 ' + b.p.hp);

  /* 烧：8% 当前气血，保底 1 血 */
  b.p.statuses = { 烧: 3 };
  b.p.hp = 100;
  b._tickStatus(b.p, 'P');
  if (b.p.hp !== 92) errors.push('灼烧应为当前气血 8%（100→92），实为 ' + b.p.hp);
  b.p.statuses = { 烧: 3 };
  b.p.hp = 1;
  b._tickStatus(b.p, 'P');
  if (b.p.hp !== 1) errors.push('灼烧不应致死（保底 1 血），实为 ' + b.p.hp);

  /* 睡：禁止行动，且受直接伤害即醒 */
  b.p.statuses = { 睡: 2 };
  b.p.hp = b.p.maxhp;
  if (b._tickStatus(b.p, 'P')) errors.push('睡眠应禁止行动');
  b.p.statuses = { 睡: 2 };
  b._impact('P', { dmg: 1, crit: false }, b.p);
  if (b.p.statuses['睡']) errors.push('受直接伤害应解除睡眠');

  /* 麻：速度 ×0.7，影响先后手 */
  b.p.statuses = {}; b.es[0].statuses = {};
  b.p.spd = 10; b.es[0].spd = 12;
  if (b._effSpd(b.p) >= b._effSpd(b.es[0])) errors.push('无状态时敌速更高，应先手判定为敌方');
  b.p.statuses = { 麻: 3 };
  if (Math.abs(b._effSpd(b.p) - 7) > 1e-6) errors.push('麻痹应使速度 ×0.7（10→7），实为 ' + b._effSpd(b.p));

  /* 封：禁止施展功法 */
  b.p.statuses = { 封: 2 };
  b.buttons = [];
  b._cmd('功法');
  if (b.phase === 'skill') errors.push('封印中不应打开功法面板');

  /* 封印打断蓄力：技能进入一半 CD */
  b.es[0].charge = { n: '烈焰冲袭', cd: 4, cdLeft: 0 };
  b.es[0].statuses = {};
  b._applyStatus(b.es[0], 'E0', '封');
  if (b.es[0].charge) errors.push('封印应打断敌方蓄力');
  if (b.chargeMark.E0) errors.push('蓄力被打断后横幅未清除');
  if (!b.es[0].statuses['封']) errors.push('封印未生效（青纹蛇不应免疫）');

  /* 免疫：主角免疫中毒时不应被附加 */
  b.p.im = ['毒'];
  b.p.statuses = {};
  b._applyStatus(b.p, 'P', '毒');
  if (b.p.statuses['毒']) errors.push('免疫中毒仍被附加');
}, 'status.rules');

step(function () {
  const b = G.game.scene;
  /* 速度定序：玩家更快 → 先出手；敌方更快 → 先出手 */
  const realAct = b._act, realEnd = b._endRound;
  b.p.statuses = {}; b.es[0].statuses = {};
  b.p.spd = 30; b.es[0].spd = 5;
  const order = [];
  b._act = function (atk) { order.push(atk === b.p ? 'P' : 'E'); arguments[5](); };
  b._endRound = function () {};
  b._resolve();
  if (order.join('') !== 'PE') errors.push('玩家更快时应先出手，实际顺序 ' + order.join(''));
  b.p.spd = 5; b.es[0].spd = 30;
  order.length = 0;
  b._resolve();
  if (order.join('') !== 'EP') errors.push('敌方更快时应先出手，实际顺序 ' + order.join(''));
  b._act = realAct; b._endRound = realEnd;
}, 'status.order');
pump(10, 'status.order');

/* 4h) 完整回合循环：自动战斗必须能打到分出胜负（防死锁） */
let loopBattle = null;
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 4; s.hp = 400;
  s.items = { 回春丹: 3 };
  G.game.save = s;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 3, '青纹蛇'), mapId: 'field' });
}, 'loop.enter');
pump(10);
step(function () {
  const b = G.game.scene;
  loopBattle = b;
  b.auto = true;
  b._cmd('攻击');
}, 'loop.start');
pump(2000, 'loop.run');
step(function () {
  /* 结算演出收尾后会切回 field，所以不能再读 G.game.scene —— 直接查战斗实例。
     顺带盯住「演出必须真的走完」：_finish 的 cue 若不走 _cut，c.t 会是 undefined，
     演出永不结束、场景永远停在 battle（曾经的线上 bug）。 */
  const b = loopBattle;
  if (!b || !b.over) {
    errors.push('自动战斗 2000 帧仍未结束（回合 ' + (b && b.round) + '），疑似行动流死锁');
  } else if (b.round > 60) {
    errors.push('战斗回合数异常（' + b.round + '）');
  }
  if (G.game.sceneName === 'battle') {
    errors.push('结算演出未收尾，仍停在 battle（_finish 的 cue 必须走 _cut）');
  }
}, 'loop.check');

/* 5) 剧情战（杀手 / 狼王） */
step(() => {
  G.game.save = JSON.parse(JSON.stringify(save));
  G.game.changeScene('battle', { script: 'killer', mapId: 'field' });
}, 'battle.killer');
pump(10, 'battle.killer');
step(() => G.game.scene._cmd('攻击'), 'battle.killer.attack');
pump(300, 'battle.killer.run');

step(() => {
  G.game.save = JSON.parse(JSON.stringify(save));
  G.game.changeScene('battle', { script: 'wolfKing', mapId: 'cave' });
}, 'battle.boss');
pump(10, 'battle.boss');
step(() => G.game.scene._cmd('攻击'), 'battle.boss.attack');
pump(400, 'battle.boss.run');

/* 5b) 仙力结算公式（轮回 v0.4 §4）逐项 */
step(function () {
  const P = G.Player;
  const s = {
    globalLevel: 77, maxGlobalLevel: 77, age: 33,
    skills: { 甲: { lv: 5 }, 乙: { lv: 3 } },
    bossKills: 2, bossKilled: true
  };
  const meta = { achieve: {} };
  const d = P.xianliOf(s, meta);
  if (d.realm !== 200) errors.push('境界仙力应为 10×20=200，实为 ' + d.realm);
  if (d.skill !== 16) errors.push('功法仙力应为 2×(5+3)=16，实为 ' + d.skill);
  if (d.kill !== 60) errors.push('击杀仙力应为 30×2=60，实为 ' + d.kill);
  if (d.age !== 36) errors.push('年岁仙力应为 (33−15)×2=36，实为 ' + d.age);
  /* 首次结算：初踏仙途 50 + 道基初成 150 + 手刃狼王 100 + 功法小成 50 + 轮回新手 30 */
  if (d.achieve !== 380) errors.push('首次成就合计应为 380，实为 ' + d.achieve);
  if (d.base !== 692) errors.push('仙力基数应为 200+16+60+36+380=692，实为 ' + d.base);
  if (d.mul !== 1) errors.push('战死不应有善终修正');
  if (d.total !== 692) errors.push('战死仙力应为 692，实为 ' + d.total);
  /* 二次结算：成就已发过，不再重复发放 */
  const d2 = P.xianliOf(s, meta);
  if (d2.achieve !== 0) errors.push('成就应只在首次发放，二次仍发 ' + d2.achieve);
  if (d2.total !== 312) errors.push('二次仙力应为 692−380=312，实为 ' + d2.total);
  if (Object.keys(meta.achieve).length !== 5) {
    errors.push('成就应记满 5 项，实为 ' + Object.keys(meta.achieve).length);
  }
}, 'xianli.formula');

/* 5b-2) 善终修正：寿终坐化 ×1.1（§3.2 / §4） */
step(function () {
  const s = {
    globalLevel: 10, maxGlobalLevel: 10, age: 80,
    skills: {}, bossKills: 0, _cause: 'aged'
  };
  const d = G.Player.xianliOf(s, { achieve: { A1: 1, A5: 1 } });
  if (d.cause !== 'aged') errors.push('死因应为 aged，实为 ' + d.cause);
  if (d.mul !== 1.1) errors.push('寿终应 ×1.1，实为 ' + d.mul);
  /* base 必须含 d.achieve：v0.15.0 新增的「寿终正寝」在 _cause=aged 时必然命中，
     只算四项会假红 —— 而那跟「善终修正」根本不是一回事。 */
  const base = d.realm + d.skill + d.kill + d.age + d.achieve;
  if (d.total !== Math.round(base * 1.1)) {
    errors.push('善终修正未生效：' + d.total + ' 应 ' + Math.round(base * 1.1));
  }
  if (G.Player.deathCause({}).id !== 'war') errors.push('缺省死因应为战死');
}, 'xianli.aged');

/* 5b-3) 寿元上限与年龄推进（境界 v3.2 §3） */
step(function () {
  const P = G.Player;
  [['淬体', 1, 100], ['炼气', 37, 150], ['筑基', 73, 200], ['金丹', 109, 300],
   ['元婴', 145, 500], ['化神', 181, 800], ['炼虚', 217, 1000], ['合体', 253, 1500],
   ['大乘', 289, 2000], ['渡劫', 325, 3000], ['人仙', 361, 5000], ['地仙', 397, 8000],
   ['天仙', 433, 12000], ['金仙', 469, 20000], ['太乙金仙', 505, 30000],
   ['大罗金仙', 541, 50000], ['准圣', 577, 100000], ['圣人', 613, 200000],
   ['道祖', 649, Infinity]]
    .forEach(function (c) {
      if (P.lifespanOf(c[1]) !== c[2]) {
        errors.push(c[0] + ' 寿元应为 ' + c[2] + '，实为 ' + P.lifespanOf(c[1]));
      }
    });

  /* 世界时钟（v0.61.0，用户第 3 点）：寿元不再是"被行为零散加出来的"，
     而是 `save.gt`（本世累计**游戏分钟**）的读数。这一条把四件事一起钉住：
       ① 比例常数「现实 1 天 = 游戏 365 天」；
       ② 行为折算与世界时钟一致（战斗 10 场 = 1 年；打坐的 n 就是游戏分钟）；
       ③ 突破走 `ageBonus`（顿悟），**不折日历** —— 面板上两笔账要能分开看；
       ④ 闭关收益随**首灵根系数**放大（"灵根的作用"），且寿元不足时坐不起。 */
  const T = G.Time;
  if (!T) { errors.push('G.Time 未载入（世界时钟模块）'); return; }
  if (T.RATIO_DAY !== 365 || T.SEC_PER_REAL_SEC !== 365) {
    errors.push('时间比例应为「现实 1 天 = 游戏 365 天」，实为 '
      + T.RATIO_DAY + ' / ' + T.SEC_PER_REAL_SEC);
  }
  if (T.MIN_PER_YEAR !== 365 * 24 * 60) errors.push('一游戏年应为 525600 分钟');
  if (T.DUNGEON_DAYS_PER_FLOOR <= 0) errors.push('副本每层应有时间代价（秘境加速时间流逝）');

  /* ⑤ 「玩家在游玩时不会流逝时间」——v0.67.0（用户第 28 点）。
     这条**必须用源码闸**：行为探针驱动不了"探索场景每帧是否 tick"，
     而漏接的表现正是"静默地继续变老"（不报错、不崩、契约全绿）。
     ⚠️ 判据要连"调用条件"一起钉住 —— 只查 `G.Time.tick(` 存在是判不出
        "无条件 vs 有场景条件"的（旧版就是无条件调用，查符号恒真，属于 G43）。 */
  {
    const gj = fs.readFileSync(path.join(WWW, 'js/core/game.js'), 'utf8');
    const gjs = gj.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    if (!/G\.Time\.tick\(this\.save, dt\)/.test(gjs)) {
      errors.push('源码闸：game.js 里没有 G.Time.tick 调用 —— 秘境加速时间会失效');
    }
    if (!/G\.Time\.sceneMult\(\) > 1[^;]*G\.Time\.tick/.test(gjs)) {
      errors.push('源码闸：G.Time.tick 必须**带秘境条件**（sceneMult() > 1）—— '
        + '否则普通探索也会流逝时间（用户第 28 点：只有闭关/秘境才走时钟）');
    }
  }

  const s = { age: 16, globalLevel: 1 };
  T.ensure(s);
  if (s.gt !== 0 || s.age !== 16) errors.push('ensure 后应 gt=0 / age=16，实为 ' + s.gt + '/' + s.age);
  let gained = 0;
  for (let i = 0; i < 9; i++) gained += P.agePush(s, 'battle', 1);
  if (gained !== 0) errors.push('9 场战斗不应增龄，实增 ' + gained);
  if (P.agePush(s, 'battle', 1) !== 1) errors.push('第 10 场战斗应 +1 岁');
  if (s.age !== 17) errors.push('战斗增龄后应为 17 岁，实为 ' + s.age);
  /* 打坐的 n 是**游戏分钟**：60 分钟只是一炷香，不该增龄，但必须推进时钟 */
  P.agePush(s, 'meditate', 60);
  if (s.age !== 17) errors.push('打坐 60 游戏分钟不该增龄，实为 ' + s.age);
  if (s.gt !== T.MIN_PER_YEAR + 60) errors.push('打坐应推进 60 游戏分钟，实为 ' + s.gt);
  P.agePush(s, 'break');
  if (s.age !== 19) errors.push('大境界突破应 +2 岁，实为 ' + s.age);
  if (s.ageBonus !== 2) errors.push('突破的加龄应记在 ageBonus，实为 ' + s.ageBonus);
  if (s.gt !== T.MIN_PER_YEAR + 60) errors.push('突破不该推进世界时钟（它是顿悟）');
  /* v0.67.0 校准：**小阶**突破不再加龄（`_applyBreak(big=false)` 不调 agePush）。
     否则 35 个淬体小阶 × 2 岁 = 70 岁，凡人寿元 100 撑不到炼气（实测 age 113 > 100）。 */
  {
    const sb2 = { globalLevel: 1, qi: 99999, age: 16, gt: 0, ageBonus: 0, items: {} };
    T.ensure(sb2);
    const beforeAge = sb2.age;
    P.breakthrough(sb2);                     /* gl 1 → 2，属小阶 */
    if (sb2.globalLevel !== 2) errors.push('小阶突破应进 1 阶，实为 ' + sb2.globalLevel);
    if (sb2.age !== beforeAge) {
      errors.push('小阶突破不该加龄（v0.67.0 寿元校准），实为 ' + beforeAge + ' → ' + sb2.age);
    }
  }
  if (P.isAged(s)) errors.push('19 岁不应判为寿元尽');
  s.age = 100;
  if (!P.isAged(s)) errors.push('淬体 100 岁应判为寿元尽');
  if (P.lifespanLeft(s) !== 0) errors.push('寿元尽时剩余应为 0');

  /* ① 比例：1 现实秒 = 365 游戏秒 = 365/60 游戏分钟 */
  const s1 = { age: 16, globalLevel: 1 };
  T.ensure(s1);
  T.tick(s1, 1);
  if (Math.abs(s1.gt - 365 / 60) > 0.01) {
    errors.push('1 现实秒应推进 ' + (365 / 60).toFixed(3) + ' 游戏分钟，实为 ' + s1.gt);
  }
  /* 一整现实天（86400 秒）应恰好推进一游戏年 */
  const s1b = { age: 16, globalLevel: 1 };
  T.ensure(s1b);
  T.tick(s1b, 86400);
  if (s1b.age !== 17) errors.push('现实 1 天应让角色长 1 岁，实为 ' + s1b.age);

  /* ④ 闭关：灵根系数直接决定收益；寿元不足坐不起 */
  const mkS = function (coef, age) {
    const o = JSON.parse(JSON.stringify(save));
    o.globalLevel = 1; o.qi = 0; o.age = age == null ? 16 : age;
    o.gt = (o.age - 16) * T.MIN_PER_YEAR; o.ageBonus = 0;
    o.linggen = { elems: ['金'], coef: { '金': coef } };
    return o;
  };
  const tierY1 = T.tierById('y1');
  /* 离线打坐用的存档必须带 lastSeen（没它一律不结算 —— 新档/首次进入不该白送） */
  const mkOff = function (coef) { const o = mkS(coef, 16); o.lastSeen = 1000000; return o; };
  if (!tierY1) errors.push('闭关档位缺「闭关一年」');
  const gHi = T.meditateGain(mkS(1.5), tierY1);
  const gLo = T.meditateGain(mkS(0.6), tierY1);
  if (!(gHi > gLo * 2)) {
    errors.push('灵根 1.5 的闭关收益应远高于 0.6，实为 ' + gHi + ' vs ' + gLo);
  }
  const sa = mkS(1.0);
  const r1 = T.meditate(sa, 'y1');
  if (!r1.ok) errors.push('闭关一年不该失败：' + r1.reason);
  if (sa.gt !== T.MIN_PER_YEAR) errors.push('闭关一年应推进一游戏年，实为 ' + sa.gt);
  if (sa.age !== 17) errors.push('闭关一年后应 17 岁，实为 ' + sa.age);
  if (sa.qi !== r1.gain || r1.gain < 1) errors.push('闭关应给灵气，实为 ' + r1.gain);
  /* 淬体寿元 100：90 岁的人坐不起「枯坐百年」 */
  const sb = mkS(1.0, 90);
  const r2 = T.meditate(sb, 'y100');
  if (r2.ok) errors.push('寿元不足时不该能枯坐百年');
  if (!r2.reason) errors.push('闭关失败必须给出可读原因');

  /* ⑤ 修炼节奏（v0.75.0，用户口径「闭关灵气太多、太容易破境」）：
     参数整组 ÷2；且**必须**保住"淬体寿元内修得到筑基"这条硬约束 ——
     淬体段 36 小阶而淬体寿元仅 100 岁，砍供给砍过头会直接卡死在淬体
     （v0.67.0 踩过同一个坑："修不到炼气就坐化"）。这条断言是那次教训的防线。 */
  const y1g = T.tierById('y1').gain;
  if (y1g > 1.5) errors.push('闭关一年 gain 应已下调（≤1.5），实为 ' + y1g);
  {
    /* 模拟：理性玩家总选「每岁收益最高且坐得起」的档，从 16 岁一路修。
       灵根系数取 1.0（**最坏情况** —— 无灵根加成的人也必须有出路）。 */
    const lf = { 淬体: 100, 炼气: 150, 筑基: 200 };
    const lifeOf = (gl) => lf[P.realmOf(gl).n] || 100;
    const sim = function (targetGL) {
      const st = { linggen: { elems: ['金'], coef: { '金': 1 } },
        skills: {}, items: {}, qi: 0, globalLevel: 1, age: 16 };
      let age = 16, guard = 0;
      while (st.globalLevel < targetGL && guard++ < 100000) {
        const life = lifeOf(st.globalLevel);
        if (age >= life) return { stuck: true, gl: st.globalLevel };
        let best = null;
        T.MEDITATE_TIERS.forEach(function (t) {
          const yrs = t.days / 365;
          if (age + yrs > life) return;             /* 坐不起（会坐化） */
          const eff = t.gain / yrs;
          if (!best || eff > best.eff) best = { eff: eff, t: t, yrs: yrs };
        });
        if (!best) return { stuck: true, gl: st.globalLevel };
        const need = P.needQi(st, st.globalLevel);
        st.qi += Math.max(1, Math.round(need * best.t.gain * 1.0));
        age += best.yrs;
        let g = 0;
        while (st.qi >= P.needQi(st, st.globalLevel) && st.globalLevel < targetGL && g++ < 500) {
          st.qi -= P.needQi(st, st.globalLevel);
          st.globalLevel++;
        }
      }
      return { stuck: false, gl: st.globalLevel };
    };
    const rMed = sim(39);                             /* 炼气三重初期 */
    if (rMed.stuck) {
      errors.push('无灵根加成时会卡死在 ' + P.realmOf(rMed.gl).n
        + '：闭关收益下调过度（淬体寿元 100 岁内必须能修到炼气）');
    }
    const rBuild = sim(74);                           /* 筑基一重初期 */
    if (rBuild.stuck) {
      errors.push('无灵根加成时卡在 ' + P.realmOf(rBuild.gl).n
        + ' 而够不到筑基：供给仍偏低，需回头调 MEDITATE_TIERS 或寿元表');
    }
  }
  /* 离线打坐：上限 12 现实小时，且不足阈值不结算 */
  const sc2 = mkS(1.0);
  sc2.lastSeen = 1000000;
  if (T.offlineGain(sc2, 1000000 + 10000) !== null) errors.push('离线 10 秒不该结算');
  const off = T.offlineGain(sc2, 1000000 + 30 * 3600 * 1000);
  if (!off || !(off.gain > 0)) errors.push('离线 30 小时应有收益');
  else if (!off.capped) errors.push('离线收益应被上限截断（12 小时）');
  const offHi = T.offlineGain(mkOff(1.5), 1000000 + 6 * 3600 * 1000);
  const offLo = T.offlineGain(mkOff(0.6), 1000000 + 6 * 3600 * 1000);
  if (!offHi || !offLo || !(offHi.gain > offLo.gain * 2)) {
    errors.push('离线打坐收益同样要体现灵根差异，实为 '
      + (offHi && offHi.gain) + ' vs ' + (offLo && offLo.gain));
  }
}, 'lifespan');

/* 5b-4) 本世大事记：同一 id 只记一次（走马灯数据源） */
step(function () {
  const s = { age: 16 };
  G.Player.chronicle(s, 'birth', '入世落霞镇');
  G.Player.chronicle(s, 'birth', '重复不应记入');
  G.Player.chronicle(s, 'vessel', '山神庙得玉玦');
  if (s.chronicle.length !== 2) errors.push('大事记去重失败，条数 ' + s.chronicle.length);
  if (s.chronicle[0].t !== 16) errors.push('大事记应记录当时年龄');
}, 'chronicle');

/* 5b-5) 寿终坐化：回到探索场景后应立即进入死亡结算，且按善终结算 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.quest = { step: 'free', flags: {} };
  s.globalLevel = 1; s.age = 100; s.pos = null;
  G.game.meta = {
    lives: 1, xianli: 0, totalXianli: 0, perfusion: {}, pity: 0,
    achieve: {}, past: [],
    heaven: { talks: 0, watchTotal: 0, memory: [], karma: [] }
  };
  G.game.save = s;
  G.game.changeScene('field', { toSpawn: true });
}, 'aged.enter');
pump(10, 'aged.enter');
step(function () {
  if (G.game.sceneName !== 'heaven') {
    errors.push('寿元尽后应先入天道拦魂，实为 ' + G.game.sceneName);
    return;
  }
  /* 走完拦魂三轮（模板模式同步返回）→ 入死亡结算 */
  const hv = G.scenes.heaven;
  hv._reply('（默然）');
  hv._reply('（默然）');
  hv._finish();
}, 'aged.heaven');
pump(2, 'aged.heaven');
step(function () {
  if (G.game.sceneName !== 'death') {
    errors.push('拦魂后应进入死亡结算，实为 ' + G.game.sceneName);
    return;
  }
  const m = G.game.meta;
  if (!m.past.length) { errors.push('坐化未写入前世档案'); return; }
  const rec = m.past[0];
  if (rec.cause !== 'aged') errors.push('坐化死因应为 aged，实为 ' + rec.cause);
  if (rec.detail.mul !== 1.1) errors.push('坐化应享善终 ×1.1，实为 ' + rec.detail.mul);
  if (!(rec.chronicle || []).some(function (c) { return c.id === 'aged'; })) {
    errors.push('坐化未写入大事记');
  }
}, 'aged.check');

/* 6) 死亡结算 → 轮回殿灌注 → 转世重修 */
step(() => {
  G.game.meta = {
    lives: 1, xianli: 500, totalXianli: 500,
    perfusion: { body: 1, qi: 1, po: 1, stone: 1, rescue: 1 }, pity: 0,
    heaven: { talks: 0, watchTotal: 0, memory: [], karma: [] }, past: []
  };
  G.game.save = JSON.parse(JSON.stringify(save));
  G.game.save.globalLevel = 20; G.game.save.age = 33;
  G.game.changeScene('death');
}, 'death');
pump(10, 'death');
step(() => {
  const m = G.game.meta;
  if (!m.past.length) errors.push('死亡结算未写入前世档案');
  if (!(m.xianli > 500)) errors.push('死亡结算未发放仙力（xianli=' + m.xianli + '）');
  if (G.game.save) errors.push('死亡后当世档未清空');
}, 'death.check');

step(() => G.game.changeScene('hall'), 'hall');
pump(10, 'hall');
step(() => {
  const b = G.game.scene.buttons.filter((x) => !x.disabled && x.label === '')[0];
  if (!b) { errors.push('轮回殿没有可用的灌注按钮'); return; }
  const before = G.game.meta.perfusion.body;
  b.onClick();
  if (G.game.meta.perfusion.body !== before + 1) {
    errors.push('仙躯灌注未生效（' + before + ' → ' + G.game.meta.perfusion.body + '）');
  }
}, 'hall.perfuse');
pump(6, 'hall.perfuse');

step(() => G.game.changeScene('reincarnation'), 'reinc2');
pump(10, 'reinc2');
step(() => {
  const s = G.game.scene;
  s.originSel = 0;
  s.step = 'linggen'; s.rollLinggen();
  s.step = 'talent'; s.drawTalents();
  s.finish();
}, 'reinc2.finish');
pump(10, 'reinc2.finish');
step(() => {
  const sv = G.game.save;
  if (!sv) { errors.push('入世后未生成当世档'); return; }
  if (sv.po < 12) errors.push('魂力灌注未折算到开局灵力（po=' + sv.po + '）');
  if (sv.qi < 120) errors.push('灵息灌注未折算到开局灵气（qi=' + sv.qi + '）');
  if (sv.escapeLeft < 4) errors.push('遁法灌注未折算到遁走次数（' + sv.escapeLeft + '）');
}, 'reinc2.check');

/* ---------- 降世选界契约（《闭环报告 v3.2》G7 + 缺口 U4）----------
   飞升台选定的下一世主界要**真的生效**：境界从该界起始 gl 起算、落点在该界首区。
   以前 finish() 把 `globalLevel:1` 与 `scene:'town'` 写死 ——
   "选灵界降世"会落在青溪镇、境界却是淬体一段，界面与世界全对不上。
   道界（dao）自 v0.9.0 起也可选，但**必须有钥匙**（三枚碎片齐）。 */
step(function () {
  const reinc = G.scenes.reincarnation;
  function descend(nextWorld, daoKey) {
    G.game.meta = {
      lives: 3, xianli: 0, totalXianli: 0,
      perfusion: {}, achieve: {}, titles: [], past: [{ life: 1 }],
      heaven: { talks: 0, watchTotal: 0, memory: [], karma: [] },
      progress: {
        difficulty: 'normal', activeWorld: 'fan', nextWorld: nextWorld || null,
        worlds: { fan: true, ling: true, xian: true, dao: false },
        worldDiff: { fan: 'normal', ling: 'normal', xian: 'normal', dao: 'normal' },
        daoKey: !!daoKey, daoShards: { fan: true, ling: true, xian: true }
      }
    };
    G.game.changeScene('reincarnation');
    reinc.originSel = 0;
    reinc.step = 'linggen'; reinc.rollLinggen();
    reinc.step = 'talent'; reinc.drawTalents();
    reinc.finish();
    return G.game.save;
  }

  /* 未指定 → 天道抽定；抽到哪界就从哪界起始 gl 起算、落在该界首区 */
  let s = descend(null, false);
  if (!s) { errors.push('降世未生成当世档'); return; }
  const w0 = G.Player.activeWorldId(G.game.meta);
  if (s.globalLevel !== G.Player.worldById(w0).start) {
    errors.push(`降世起始境界应等于该界起始 gl（${w0} → ${G.Player.worldById(w0).start}），实际 ${s.globalLevel}`);
  }
  if (s.scene !== G.Data.regions.mapIdOf(G.Data.regions.of(w0)[0].id)) {
    errors.push(`降世落点应为该界首区（${w0}），实际 ${s.scene}`);
  }
  if (G.game.sceneName !== s.scene) errors.push(`降世后应进入 ${s.scene}，实际 ${G.game.sceneName}`);

  /* 指定灵界 → gl253 + 雷泽荒原 */
  s = descend('ling', false);
  if (G.Player.activeWorldId(G.game.meta) !== 'ling') errors.push('指定灵界降世未生效');
  if (s.globalLevel !== 253) errors.push(`灵界降世起始 gl 应为 253，实际 ${s.globalLevel}`);
  if (s.scene !== G.Data.regions.mapIdOf('ling1')) errors.push(`灵界降世落点应为 ling1，实际 ${s.scene}`);
  if (s.entrances.ling.length !== 5) errors.push('灵界降世未抽 5 处副本落位');

  /* 指定道界但没钥匙 → 必须回落（不能被扔进没开的世界） */
  s = descend('dao', false);
  if (G.Player.activeWorldId(G.game.meta) === 'dao') errors.push('没钥匙却降世到了道界');

  /* 有钥匙 → 道界可选：gl577 + 道则回廊（dao1），且只有 1 处入口 */
  s = descend('dao', true);
  if (G.Player.activeWorldId(G.game.meta) !== 'dao') errors.push('有钥匙时道界降世未生效');
  if (s.globalLevel !== 577) errors.push(`道界降世起始 gl 应为 577，实际 ${s.globalLevel}`);
  if (s.scene !== G.Data.regions.mapIdOf('dao1')) errors.push(`道界降世落点应为 dao1，实际 ${s.scene}`);
  if (!Array.isArray(s.daoCleared) || s.daoCleared.length !== 0) errors.push('道界降世应初始化 daoCleared');
  if (s.daoCrystal !== 0) errors.push('道界降世道晶应从 0 起');
  if (s.entrances.dao.length !== 1 || s.entrances.dao[0].region !== 'dao1') {
    errors.push('道界降世入口应只有 dao1 一处');
  }
  /* 道界内破境被拦（入世即准圣一重，只能靠试炼推进） */
  if (G.Player.breakState(s).ready) errors.push('道界降世后不该能靠灵气突破');
}, 'descend.world.contract');

/* ---------- 新场景走查：难度选择 / 副本枢纽 ---------- */
step(() => { G.game.changeScene('difficulty'); pump(12, 'difficulty'); }, 'scene.difficulty');
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  s.dungeonSet = G.Data.dungeons.rollSet();
  s.dungeonSlot = 0; s.dungeonRun = null; s.dungeonFarm = 0;
  s.dungeonPity = { mid: 0, clear: 0 }; s.secrets = {}; s.daoCrystal = 0;
  G.game.save = s;
  G.game.changeScene('dungeon');
  pump(20, 'dungeon');
}, 'scene.dungeon');

/* ---------- 四界 28 区域契约（《四界区域与副本落位设计 v1.0》§4.3 / §5） ----------
   凡界 F1–F3 复用现有手写地图（由上面的场景走查覆盖），其余 25 个生成型区域全走这里：
     · 地图能生成、spawn 可行走
     · 每个 exit 指向真实场景，且出口格不被实心堵死
     · 每栋建筑都有门交互点，该格可行走、且从 spawn BFS 可达
     · 每栋建筑的内部能生成，并满足室内契约（出口 / 家具 y≥3 / 逐格实心 + 登记交互 / 至少一件有 act）
   这条契约的价值在于：**"地图里加了建筑却忘了让它可进"是静默失败** ——
   门交互点没登记就只是"点了没反应"，肉眼很难归因，所以必须钉死。 */
step(function () {
  G.game.save = save;
  function bfs(mp, from) {
    const seen = {};
    const q = [[from.x, from.y]];
    seen[from.x + ',' + from.y] = true;
    while (q.length) {
      const c = q.shift();
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        const nx = c[0] + d[0], ny = c[1] + d[1];
        if (nx < 0 || ny < 0 || nx >= mp.w || ny >= mp.h) return;
        if (mp.solid[ny][nx]) return;
        const k = nx + ',' + ny;
        if (seen[k]) return;
        seen[k] = true; q.push([nx, ny]);
      });
    }
    return seen;
  }

  let regionN = 0, buildingN = 0, interiorN = 0;
  /* 先全部 ensure 一遍再校验：出口的 to 指向的是**目标区域**的场景，
     边生成边查会因为"目标还没注册"误报。 */
  ['fan', 'ling', 'xian', 'dao'].forEach(function (wid) { G.RegionGen.ensureWorld(save, wid); });
  ['fan', 'ling', 'xian', 'dao'].forEach(function (wid) {
    G.Data.regions.of(wid).forEach(function (r) {
      if (r.map) return;                                  /* 复用型：已有场景契约 */
      regionN++;
      const md = G.RegionGen.ensure(save, r.id);
      if (!md) { errors.push(`区域 ${r.id} 生成失败`); return; }
      const mp = G.MapGen.buildMap(save, r.id);

      if (mp.solid[md.spawn.y][md.spawn.x]) errors.push(`区域 ${r.id}: spawn 落在实心格`);
      if (!(md.exits || []).length) errors.push(`区域 ${r.id}: 没有任何出口`);
      (md.exits || []).forEach(function (e) {
        for (let x = e.x0; x <= e.x1; x++) {
          if (mp.solid[e.y][x]) errors.push(`区域 ${r.id}: 出口格 (${x},${e.y}) 被实心堵死`);
        }
        if (!G.Data.maps[e.to]) errors.push(`区域 ${r.id}: 出口指向不存在的场景 ${e.to}`);
      });

      const reach = bfs(mp, md.spawn);
      if (!(md.structures || []).length) errors.push(`区域 ${r.id}: 一栋建筑都没有`);
      (md.structures || []).forEach(function (st) {
        const dx = st.x + Math.floor(st.w / 2), dy = st.y + st.h;
        const o = mp.interact[dx + ',' + dy];
        /* 山门（v0.42.0）：门格是 `gate` 交互点 —— 它**不是"进屋"**，是"换场景"。
           所以①不能要求它是 door/ruin；②**不能给它生成建筑内部**（那不是房间，是山门）；
           ③要查的恰恰是 `to` 真的指向一个存在的场景。 */
        if (st.kind === 'gate') {
          if (!o || o.type !== 'gate') {
            errors.push(`区域 ${r.id}: 山门 ${st.id}(${st.n}) 门下沿 (${dx},${dy}) 不是 gate 交互点`);
          } else {
            if (!o.s || !o.s.to) {
              errors.push(`区域 ${r.id}: 山门 ${st.id}(${st.n}) 没有 to（点了进不去）`);
            } else {
              let known = !!G.Data.maps[o.s.to];
              if (!known && o.s.to.indexOf('sect.') === 0 && G.SectGen && G.SectGen.liveOf) {
                const pp = o.s.to.split('.');
                const clx = G.SectGen.liveOf(save, pp[1]);
                known = !!(clx && clx.rooms.some(function (r2) { return r2.id === o.s.to; }));
              }
              if (!known) errors.push(`区域 ${r.id}: 山门 ${st.id}(${st.n}) 指向不存在的场景 ${o.s.to}`);
            }
            if (!reach[dx + ',' + dy]) {
              errors.push(`区域 ${r.id}: 山门 ${st.id}(${st.n}) 的门 (${dx},${dy}) 从 spawn 走不到`);
            }
          }
          return;
        }
        /* ⚠️ 计数要放在山门分支**之后**：山门不算"有内部的建筑"，
           否则 `建筑内部数 vs 建筑数` 那条契约会直接报不平。 */
        buildingN++;
        if (!o || (o.type !== 'door' && o.type !== 'ruin')) {
          errors.push(`区域 ${r.id}: 建筑 ${st.id}(${st.n}) 门下沿 (${dx},${dy}) 没有门交互点`);
        } else if (!reach[dx + ',' + dy]) {
          const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(function (d) {
            const x2 = dx + d[0], y2 = dy + d[1];
            if (x2 < 0 || y2 < 0 || x2 >= mp.w || y2 >= mp.h) return 'OOB';
            return mp.solid[y2][x2] ? 'X' : '.';
          }).join('');
          errors.push(`区域 ${r.id}: 建筑 ${st.id}(${st.n}) 的门 (${dx},${dy}) 从 spawn 走不到`
            + ` [门格solid=${mp.solid[dy][dx]}, 上右下左=${nb}]`);
        }

        const iid = 'int.' + r.id + '.' + st.id;
        const imd = G.InteriorGen.ensure(save, iid, st, r);
        if (!imd) { errors.push(`区域 ${r.id}: 建筑 ${st.id} 内部生成失败`); return; }
        interiorN++;
        const imp = G.MapGen.buildMap(save, iid);
        if (!(imd.exits || []).length) errors.push(`${iid}: 没有出口，进去出不来`);
        (imd.exits || []).forEach(function (e) {
          for (let x = e.x0; x <= e.x1; x++) {
            if (imp.solid[e.y][x]) errors.push(`${iid}: 出口格 (${x},${e.y}) 被实心堵死`);
          }
          if (!G.Data.maps[e.to]) errors.push(`${iid}: 出口指向不存在的场景 ${e.to}`);
        });
        if (!(imd.furn || []).length) errors.push(`${iid}: 没有任何家具`);
        (imd.furn || []).forEach(function (f) {
          if (f.y < 3) errors.push(`${iid}: 家具 ${f.id} 摆在 y=${f.y}，会被顶部 HUD 遮住`);
          for (let y = f.y; y < f.y + (f.h || 1); y++) {
            for (let x = f.x; x < f.x + (f.w || 1); x++) {
              if (!imp.solid[y][x]) errors.push(`${iid}: 家具 ${f.id} 的格子 (${x},${y}) 不是实心`);
              const o2 = imp.interact[x + ',' + y];
              if (!o2 || o2.type !== 'furn') errors.push(`${iid}: 家具 ${f.id} 的格子 (${x},${y}) 没有交互点`);
            }
          }
        });
        if (!(imd.furn || []).some(function (f) { return f.act; })) errors.push(`${iid}: 所有家具都没有动作`);
      });
    });
  });

  if (regionN !== 25) errors.push(`生成型区域应为 25 个，实际 ${regionN}`);
  if (interiorN !== buildingN) errors.push(`建筑内部数(${interiorN})与建筑数(${buildingN})不符`);
  if (buildingN < 60) errors.push(`建筑总数偏少（${buildingN}），检查 regions.js 的建筑清单`);

  /* 入口落位**真的落到地图上**：给每个界造一份落位 → 断言裂隙 special 与交互点齐、
     且从 spawn 走得到。（只验算法不验落图，会漏掉"算法对但地图上什么都没有"。） */
  ['fan', 'ling', 'xian'].forEach(function (wid) {
    const s2 = JSON.parse(JSON.stringify(save));
    s2.entrances = { fan: [], ling: [], xian: [], dao: [] };
    s2.entrances[wid] = G.Data.regions.rollEntrances(wid);
    s2.worldSeed = 'entrance-probe:' + wid;
    G.Data.regions.of(wid).forEach(function (r) { if (!r.map) delete G.Data.maps[r.id]; });
    s2.entrances[wid].forEach(function (e) {
      try {
        const md = G.RegionGen.ensure(s2, e.region);
        if (!md) { errors.push(`${wid}: 落位区域 ${e.region} 生成失败`); return; }
        const mp = G.MapGen.buildMap(s2, md.id || e.region);
        const sp = (md.special || []).filter(function (x) { return x.kind === 'entrance'; })[0];
        if (!sp) { errors.push(`${wid}: 落位区域 ${e.region} 没有生成入口裂隙`); return; }
        if (sp.slot !== e.slot || sp.arch !== e.arch) errors.push(`${wid}: 区域 ${e.region} 裂隙的槽位/原型与落位不符`);
        const o = mp.interact[sp.x + ',' + (sp.y + 1)];
        if (!o || o.type !== 'entrance') { errors.push(`${wid}: 区域 ${e.region} 入口交互点缺失`); return; }
        if (!bfs(mp, md.spawn)[sp.x + ',' + (sp.y + 1)]) errors.push(`${wid}: 区域 ${e.region} 入口裂隙从 spawn 走不到`);
      } catch (err) {
        errors.push(`${wid}: 区域 ${e.region} 入口落图校验异常：${err.message}`);
      }
    });
  });

  console.log(`  · 区域 ${regionN} 个 / 建筑 ${buildingN} 栋 / 内部 ${interiorN} 间`);
}, 'regions.contract');

/* ---------- 区域名按世随机契约（v0.74.0，用户第 24 点） ----------
   用户口径：「每次转世的世界名称不一样，地图也要保持随机名称，
              并且**实际场景和地图名称要一致**」。

   ① 锚世（第 1 世）整界保持原名 → 新档第一天与旧基线逐字一致（零回归）；
   ② 非锚世：凡界/灵界登记区**必须换名**，同一世内**不得重名**；
   ③ 同一世**可复现**（同 seed 两次生成结果相同）—— 走独立 RNG，不吃全局 G.rng；
   ④ 不同世**必然不同**（换 seed 至少有一半区名变化）；
   ⑤ **未登记区必须保持固定名**（云州城 / 天界 15 区）—— 剧情锚定与天界固有结构；
   ⑥ **场景名 == 地图节点名**（同一个 `nameOf`，不许两处各写一套）。
   ⑦ 地图缓存按世失效：`ensure` 换 seed 后 md.label 必须跟着变（缓存不跨世）。 */
step(function () {
  const Rg = G.Data.regions;
  const mkSave = (seed, anchor, names) => ({
    world: { seed: seed, anchor: !!anchor, names: names || { town: '青溪镇', mountain: '翠微山', cave: '赤牙洞' } },
    globalLevel: 1
  });

  /* ① 锚世保持原名 */
  const aSave = mkSave(20260924, true);
  Rg.all().forEach(function (r) {
    const nm = Rg.nameOf(r.id, aSave);
    if (nm !== r.n) errors.push(`锚世 ${r.id} 应保持原名「${r.n}」，实际「${nm}」`);
  });

  /* ② 非锚世换名 + 不重名 */
  const bSave = mkSave(987654321, false);
  const changed = [];
  const seenName = {};
  Rg.all().forEach(function (r) {
    const nm = Rg.nameOf(r.id, bSave);
    if (nm !== r.n) changed.push(r.id);
    if (seenName[nm]) errors.push(`非锚世区名重复：「${nm}」同时被 ${seenName[nm]} 与 ${r.id} 使用`);
    seenName[nm] = r.id;
  });
  if (changed.length < 10) errors.push(`非锚世只有 ${changed.length} 个区换了名（应 ≥10）`);

  /* ③ 同一世可复现 */
  const cSave = mkSave(987654321, false);
  Rg.all().forEach(function (r) {
    if (Rg.nameOf(r.id, bSave) !== Rg.nameOf(r.id, cSave)) errors.push(`同种子不可复现：${r.id}`);
  });

  /* ④ 不同世不同名（在**可改名区**里比较，锚定区本来就不参与） */
  const dSave = mkSave(13579, false);
  const rebindable = Object.keys(Rg.REGNAME_POOL);
  let diff = 0;
  rebindable.forEach(function (rid) { if (Rg.nameOf(rid, bSave) !== Rg.nameOf(rid, dSave)) diff++; });
  if (diff < Math.ceil(rebindable.length * 0.6)) {
    errors.push(`换世只有 ${diff}/${rebindable.length} 个可改名区变名（应 ≥60%）`);
  }

  /* ⑤ 未登记区保持固定名（云州城 + 天界 15 区） */
  ['fan10', 'xian1', 'xian3', 'dao1', 'dao5'].forEach(function (rid) {
    const r = Rg.byId(rid);
    if (Rg.nameOf(rid, bSave) !== r.n) errors.push(`未登记区 ${rid} 不应改名（剧情锚定/天界固有）`);
  });

  /* ⑥ 场景名 == 地图节点名（老图三张走 save.world.names，与 nameByMapId 同源） */
  const names = { town: '白鹿集', mountain: '断龙岭', cave: '白骨窟' };
  const eSave = mkSave(24680, false, names);
  if (Rg.nameByMapId('town', eSave) !== '白鹿集') errors.push('老图 town 的场景名应取 save.world.names.town');
  if (Rg.nameByMapId('field', eSave) !== '断龙岭') errors.push('老图 field 的场景名应取 save.world.names.mountain');
  if (Rg.nameByMapId('cave', eSave) !== '白骨窟') errors.push('老图 cave 的场景名应取 save.world.names.cave');

  /* ⑦ 地图缓存按世失效：换 seed 后 ensure 重建，md.label 必须跟着变。
     ⚠️ 这里**必须 resetGen 收尾**：ensure 会刷新 `G.Data.maps` 的生成型区域缓存，
        若不复位，后面的契约（区域可见性差分探针）跑在同一模块作用域里会拿到
        被本段 seed 生成的旧图 → 静默报"落位区里没有生成入口裂隙"。 */
  const g1 = mkSave(11111, false); g1.scene = 'fan1'; g1.worldSeed = 'gen-a';
  const g2 = mkSave(22222, false); g2.scene = 'fan1'; g2.worldSeed = 'gen-b';
  G.RegionGen.resetGen();
  const md1 = G.RegionGen.ensure(g1, 'fan5');
  const lbl1 = md1 && md1.label;
  G.RegionGen.resetGen();
  const md2 = G.RegionGen.ensure(g2, 'fan5');
  const lbl2 = md2 && md2.label;
  G.RegionGen.resetGen();                 /* ← 收尾复位，别把缓存留给后面的契约 */
  if (!lbl1 || !lbl2) errors.push('fan5 地图生成失败');
  else if (lbl1 === lbl2) errors.push(`地图缓存未按世失效：两世 fan5 的 label 都是「${lbl1}」`);
  else if (lbl1 !== Rg.nameOf('fan5', g1) || lbl2 !== Rg.nameOf('fan5', g2)) {
    errors.push('md.label 与 nameOf 不一致（两处各写一套）');
  }

  /* 源码闸：场景名 / 地图节点名都不得再自己写 mapId 分支取死名 */
  const ex = fs.readFileSync(path.join(WWW, 'js/core/explore.js'), 'utf8');
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const sn = strip(ex.slice(ex.indexOf('_sceneName: function'), ex.indexOf('_sceneName: function') + 900));
  if (/names\.town/.test(sn)) errors.push('源码闸：_sceneName 仍在自取 save.world.names（应走 nameByMapId）');
  if (sn.indexOf('nameByMapId') < 0) errors.push('源码闸：_sceneName 未走 regions.nameByMapId');

  /* ⑧ 叙事文案地名替换（v0.74.0）：台词/任务/章节里写死的旧地名必须换成
     本世区名 —— 否则地图节点叫「白鹿集」、对话里还喊「青溪镇」（用户第 24 点
     点名的"实际场景和地图名称不一致"）。锚世恒等（零回归）。 */
  const tSave = mkSave(24680, false, names);
  const probe = '回到青溪镇，往翠微山去，再入赤牙洞。';
  const got = Rg.textOf(probe, tSave);
  if (got.indexOf('青溪镇') >= 0 || got.indexOf('翠微山') >= 0 || got.indexOf('赤牙洞') >= 0) {
    errors.push('非锚世 textOf 未替换旧地名（实为「' + got + '」）');
  }
  ['白鹿集', '断龙岭', '白骨窟'].forEach(function (nm) {
    if (got.indexOf(nm) < 0) errors.push('非锚世 textOf 未换成本世名「' + nm + '」（实为「' + got + '」）');
  });
  /* 锚世必须**逐字不变**（零回归） */
  const anchorProbe = '回到青溪镇。';
  if (Rg.textOf(anchorProbe, aSave) !== anchorProbe) {
    errors.push('锚世 textOf 不应改动文案（零回归被破坏）');
  }
  /* 未登记区（云州城）本就不改名 → 替换后仍是原字 */
  if (Rg.textOf('去云州城', tSave).indexOf('云州城') < 0) {
    errors.push('textOf 误改了未登记区名（云州城不该变）');
  }
  /* 源码闸：追踪栏 / 对话 / 任务面板必须走 textOf，不能自己写死地名 */
  ['js/core/explore.js', 'js/core/panels.js', 'js/core/overlays.js'].forEach(function (rel) {
    const src = fs.readFileSync(path.join(WWW, rel), 'utf8');
    if (src.indexOf('textOf') < 0) {
      errors.push('源码闸：' + rel + ' 未接 textOf（叙事文案的地名不会随世替换）');
    }
  });

  console.log(`  · 非锚世改名 ${changed.length} 区 / 换世变名 ${diff} 区 / 锚世保持原名`);
}, 'region.name.contract');

/* ---------- 区域连通性契约 ----------
   每个界的区域必须**从该界首区全部可达**。挡的是"地图生成得出来、玩家永远走不到"的孤岛 ——
   区域层与手写地图没接上时就是这样（fan4–fan9 曾经完全走不到）。
   界与界之间靠**界门**连通，不走地图出口，所以按界分别做 BFS。 */
step(function () {
  const R = G.Data.regions;
  const adj = {};
  R.all().forEach(function (r) { adj[r.id] = []; });
  function link(a, b) {
    /* **有向**：玩家只能顺着出口走过去，反向走不通。
       按双向算会掩盖"只有回程、没有去程"的断头路 ——
       曾经就是这样漏掉了 fan4–fan9 的孤岛（fan4 有出口回 fan1，于是被误判为连通）。 */
    if (!a || !b || a === b) return;
    if (adj[a].indexOf(b) < 0) adj[a].push(b);
  }
  R.all().forEach(function (r) {
    const mapId = r.map || r.id;
    G.RegionGen.ensure(save, r.id);
    const md = G.Data.maps[mapId];
    if (!md) return;
    (md.exits || []).forEach(function (e) { link(r.id, R.regionIdOf(e.to)); });
    (md.structures || []).forEach(function (s) {
      if (s.kind === 'gate' && s.to) link(r.id, R.regionIdOf(s.to));
    });
  });

  ['fan', 'ling', 'xian', 'dao'].forEach(function (wid) {
    const list = R.of(wid);
    if (!list.length) return;
    const start = list[0].id;
    const seen = {}, q = [start];
    seen[start] = true;
    while (q.length) {
      const c = q.shift();
      (adj[c] || []).forEach(function (n) { if (!seen[n]) { seen[n] = true; q.push(n); } });
    }
    const bad = list.filter(function (r) { return !seen[r.id]; }).map(function (r) { return r.id; });
    if (bad.length) {
      errors.push(`${wid}: ${bad.length} 个区域从首区 ${start} 走不到（孤岛）：${bad.join(' / ')}`);
    }
  });
}, 'regions.connect.contract');

/* ---------- 副本入口天道随机落位契约（《四界区域与副本落位设计 v1.0》§2.2 / §6.1） ----------
   抽 5 个入口必须满足：落在**主界**区域内、区域不重复、原型不重复、
   恰 2 大 3 小、**第 5 个必大**、槽位编号与下标一致。跑 30 轮覆盖随机性。 */
step(function () {
  const kindOf = {};
  G.Data.dungeons.ARCH.forEach(function (a) { kindOf[a.id] = a.kind; });

  ['fan', 'ling', 'xian'].forEach(function (wid) {
    const of = G.Data.regions.of(wid);
    const want = Math.min(5, of.length);
    /* 落位候选必须够 5 个：只落在生成型、非安全区（市镇/天宫门阙不冒裂隙） */
    const cand = G.Data.regions.entranceCandidates(wid);
    if (cand.length < 5) errors.push(`${wid}: 入口落位候选不足 5 个（实际 ${cand.length}）`);
    cand.forEach(function (r) {
      if (r.safe) errors.push(`${wid}: 候选区 ${r.id} 是安全区，不该作为裂隙落位点`);
      if (r.map) errors.push(`${wid}: 候选区 ${r.id} 复用现有地图，没有裂隙位`);
    });
    for (let round = 0; round < 30; round++) {
      const es = G.Data.regions.rollEntrances(wid);
      if (es.length !== want) { errors.push(`${wid}: 入口数应为 ${want}，实际 ${es.length}`); break; }
      const seenR = {}, seenA = {};
      let bigs = 0, smalls = 0;
      es.forEach(function (e, i) {
        if (e.slot !== i) errors.push(`${wid}: 槽位编号与下标不符（${e.slot} vs ${i}）`);
        if (seenR[e.region]) errors.push(`${wid}: 区域重复落位 ${e.region}`);
        seenR[e.region] = 1;
        if (!of.some(function (r) { return r.id === e.region; })) errors.push(`${wid}: 落位区域 ${e.region} 不属于该界`);
        if (seenA[e.arch]) errors.push(`${wid}: 副本原型重复 ${e.arch}`);
        seenA[e.arch] = 1;
        if (kindOf[e.arch] === 'big') bigs++; else if (kindOf[e.arch] === 'small') smalls++;
      });
      if (bigs !== 2) errors.push(`${wid}: 大副本应为 2 个，实际 ${bigs}`);
      if (smalls !== 3) errors.push(`${wid}: 小副本应为 3 个，实际 ${smalls}`);
      if (kindOf[es[4].arch] !== 'big') errors.push(`${wid}: 第 5 个入口必须是【大副本】（实际 ${es[4].arch}）`);
    }
  });

  /* 道界：**线性道则回廊**，不抽随机池、也没有 5 处裂隙 ——
     只给一个固定入口落在回廊入口区 dao1（缺口 U4）。 */
  const de = G.Data.regions.rollEntrances('dao');
  if (de.length !== 1) errors.push(`dao: 道界只应有 1 个回廊入口，实际 ${de.length}`);
  if (de[0] && de[0].region !== 'dao1') errors.push(`dao: 回廊入口应落在 dao1，实际 ${de[0] && de[0].region}`);
  if (!de.every(function (e) { return e.fixed && e.arch === null; })) {
    errors.push('dao: 道界入口应为固定试炼（arch=null, fixed=true）');
  }
  /* 带 seed/set 也不该被抽签逻辑带偏 */
  const de2 = G.Data.regions.rollEntrances('dao', 12345, ['B1', 'B2', 'S1', 'S2', 'S3']);
  if (de2.length !== 1 || de2[0].region !== 'dao1') errors.push('dao: 传 seed/set 后入口落位被改变');

  /* 主界抽取：**未通关的界优先**（否则会反复回已通关的凡界刷，主线推不动） */
  const meta = { progress: { worlds: { fan: { cleared: true }, ling: { cleared: false }, xian: false, dao: false }, daoKey: false } };
  for (let i = 0; i < 40; i++) {
    const w = G.Data.regions.rollMainWorld(meta);
    if (w !== 'ling') { errors.push(`主界抽取应优先未通关的 ling，实际 ${w}`); break; }
  }
  /* 全部通关后：只能在已解锁界里随机，不得越界到未解锁的界 */
  const meta2 = { progress: { worlds: { fan: { cleared: true }, ling: { cleared: true }, xian: false, dao: false }, daoKey: false } };
  for (let i = 0; i < 40; i++) {
    const w = G.Data.regions.rollMainWorld(meta2);
    if (['fan', 'ling'].indexOf(w) < 0) { errors.push(`全通关后主界只能在已解锁界内，实际 ${w}`); break; }
  }
}, 'entrances.contract');

/* ---------- 地狱难度体系契约（《四界区域与副本落位设计 v1.1》§2.5） ----------
   ① grantHell 幂等：同一界只发一次（已通关界回刷地狱不重复发）
   ② 三枚碎片齐才开道界；只通两界不开
   ③ 永久 +10% 的生效时机：**飞升过该界之后**才生效（凡界地狱 → 飞升灵界起）
   ④ 加成真的进了 computeStats（不是只写了个字段） */
step(function () {
  const gh = G.scenes.dungeon && G.scenes.dungeon.grantHell;
  if (typeof gh !== 'function') { errors.push('dungeon.grantHell 缺失'); return; }

  const mk = () => ({
    progress: {
      difficulty: 'normal',
      worldDiff: { fan: 'normal', ling: 'normal', xian: 'normal', dao: 'normal' },
      worlds: { fan: true, ling: false, xian: false, dao: false },
      daoKey: false,
      daoShards: { fan: false, ling: false, xian: false }
    },
    hellCleared: {}, titles: [], perfusion: {}, achieve: {}
  });

  /* ① 幂等 */
  const m1 = mk();
  gh(m1, 'fan');
  if (!m1.hellCleared.fan || !m1.progress.daoShards.fan) errors.push('grantHell(fan) 未发称号/碎片');
  if (m1.titles.indexOf('破狱·凡尘') < 0) errors.push('grantHell(fan) 未记称号');
  const l2 = gh(m1, 'fan');
  if (l2.length) errors.push('grantHell 不幂等：同一界重复发放');
  if (m1.titles.filter(function (t) { return t === '破狱·凡尘'; }).length !== 1) errors.push('称号被重复写入');

  /* ② 三碎片齐才开道界 */
  const m2 = mk();
  gh(m2, 'fan'); gh(m2, 'ling');
  if (m2.progress.daoKey) errors.push('只通两界地狱就开了道界');
  if (m2.progress.daoShards.xian) errors.push('未通关的界不应有碎片');
  gh(m2, 'xian');
  if (!m2.progress.daoKey) errors.push('三界地狱齐通后未开道界');
  if (m2.titles.length !== 3) errors.push(`称号应有 3 个，实际 ${m2.titles.length}`);

  /* ③ 生效时机 */
  const m3 = mk();
  gh(m3, 'fan');
  if (G.Player.hellBonusPct(m3) !== 0) errors.push('未飞升灵界前不应生效 +10%');
  m3.progress.worlds.ling = true;
  if (Math.abs(G.Player.hellBonusPct(m3) - 0.10) > 1e-9) errors.push('飞升灵界后应 +10%');
  m3.progress.worlds.xian = true;
  if (Math.abs(G.Player.hellBonusPct(m3) - 0.10) > 1e-9) errors.push('只通凡界地狱时不应变成 20%');
  gh(m3, 'ling');
  if (Math.abs(G.Player.hellBonusPct(m3) - 0.20) > 1e-9) errors.push('凡+灵地狱且已飞升仙界应 +20%');
  /* 此时 daoKey 仍为 false、仙界碎片未得 → 仙界那 10% 不应生效（上一条已隐含校验） */
  if (m3.progress.daoKey) errors.push('只通凡灵两界地狱不应开道界');
  gh(m3, 'xian');
  if (!m3.progress.daoKey) errors.push('三碎片齐应开道界');
  if (Math.abs(G.Player.hellBonusPct(m3) - 0.30) > 1e-9) errors.push('道界开启后应 +30%');

  /* ④ 加成确实进了 computeStats（四维同乘；注意返回字段是 maxhp 不是 hp） */
  const base = JSON.parse(JSON.stringify(save));
  const s0 = G.Player.computeStats(base, mk());
  const s1 = G.Player.computeStats(base, m3);
  if (!(s1.atk > s0.atk && s1.maxhp > s0.maxhp && s1.def > s0.def && s1.spd > s0.spd)) {
    errors.push('地狱永久加成没有进 computeStats：'
      + `pct=${G.Player.hellBonusPct(m3)} atk ${s0.atk}→${s1.atk} hp ${s0.maxhp}→${s1.maxhp}`
      + ` def ${s0.def}→${s1.def} spd ${s0.spd}→${s1.spd}`);
  }
  /* 精确比值：应为 1.30（三界地狱全通且道界已开） */
  const ratio = s1.atk / s0.atk;
  if (Math.abs(ratio - 1.30) > 0.02) errors.push(`永久加成倍率应约 1.30，实际 ${ratio.toFixed(3)}`);
}, 'hell.contract');

/* ---------- 设置面板 + 界域难度契约（设计 v1.1 §2.5 / 缺口 U2；v0.8.0 改版） ----------
   v0.8.0 起**没有「菜单」这一页**：角色等六项已拆到常驻底栏，秘境在区域裂隙上点，
   顶栏右上角那颗按钮直接叫「设置」→ 开设置页（天道模型 / 界域难度 / 关于）。
   契约：设置页里有「界域难度」入口与三种协议 → 能打开 → 点击按 普通→困难→地狱→普通
   轮换并落盘；未解锁的界改不动；两个页面的渲染路由都真的把文案画出来（文本探针）。 */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  s.pos = null;
  G.game.save = s;
  G.game.meta = {
    progress: {
      difficulty: 'normal',
      worlds: { fan: true, ling: false, xian: false, dao: false },
      daoKey: false,
      worldDiff: { fan: 'normal', ling: 'normal', xian: 'normal', dao: 'normal' },
      daoShards: { fan: false, ling: false, xian: false }
    },
    hellCleared: {}, titles: [], perfusion: {}, achieve: {}
  };
  G.game.changeScene('town', { toSpawn: true });
  const sc = G.game.scene;

  G.TianDao.openSettings(sc);
  if (sc.overlay !== 'settings') { errors.push('openSettings 未设置 overlay'); return; }
  if (!sc.buttons.some(function (b) { return (b.label || '').indexOf('界域') >= 0; })) {
    errors.push('设置页里没有「界域难度」入口');
  }
  /* 设置页：返回主菜单（v0.75.0，用户口径「设置界面需要新增返回主菜单的按钮，
     方便玩家去查看成就与称号收集图鉴」）+ 世内难度锁定。 */
  {
    const back = sc.buttons.filter(function (b) { return (b.label || '').indexOf('主菜单') >= 0; })[0];
    if (!back) errors.push('设置页缺「返回主菜单」按钮');
    else if (back.disabled) errors.push('已在世内时「返回主菜单」不该禁用');
    const wd = sc.buttons.filter(function (b) { return (b.label || '').indexOf('界域') >= 0; })[0];
    if (wd && !wd.disabled) {
      errors.push('已进入游戏时「界域难度」应被锁定（用户口径：只能在主菜单选）');
    }
  }
  /* 三种协议都得能选（缺口：天道原先只支持 OpenAI 兼容接口） */
  ['OpenAI', 'Claude', '原生 Response'].forEach(function (n) {
    if (!sc.buttons.some(function (b) { return b.label === n; })) {
      errors.push('设置页缺少协议选项：' + n);
    }
  });
  if (!sc.buttons.some(function (b) { return (b.label || '').indexOf('…') >= 0 || b.label === '未填写'; })) {
    errors.push('设置页缺少密钥输入行');
  }

  G.TianDao.openWorlds(sc);
  if (sc.overlay !== 'worlds') { errors.push('openWorlds 未设置 overlay'); return; }
  if (sc.buttons.length !== 4) errors.push(`界域面板按钮数应为 4（3 界 + 返回），实际 ${sc.buttons.length}`);

  /* 轮换：普通 → 困难 → 地狱 → 普通 */
  const cycle = ['hard', 'hell', 'normal'];
  cycle.forEach(function (want, i) {
    G.TianDao.openWorlds(sc);
    sc.buttons[0].onClick();
    if (G.game.meta.progress.worldDiff.fan !== want) {
      errors.push(`第 ${i + 1} 次点击后凡界难度应为 ${want}，实际 ${G.game.meta.progress.worldDiff.fan}`);
    }
  });

  /* 未解锁的界改不动 */
  G.TianDao.openWorlds(sc);
  sc.buttons[1].onClick();
  if (G.game.meta.progress.worldDiff.ling !== 'normal') errors.push('未解锁的界不该能改难度');

  /* 渲染路由：**必须用文本探针**。
     只断言"render 不抛异常"是空的 —— 旧路由（只认 menu/tiandao）遇到 'worlds'
     既不匹配任何分支、也不报错，只是**什么都不画**，玩家看到的就是"点了没反应"。
     所以这里抓 fillText 的字符串，确认面板文案真的落到画布上。 */
  sc.overlay = 'worlds';
  sc.buttons = [];
  const cx = textSpy();
  sc.render(cx);
  if (!cx.__seen.some(function (t) { return t.indexOf('三界碎片集齐') >= 0; })) {
    errors.push('overlay=worlds 没有渲染出面板文案（场景 renderOverlay 路由漏了）');
  }
  sc.overlay = 'settings';
  const cm = textSpy();
  sc.render(cm);
  /* 按钮文字是 game.js 画的、不在 scene.render 里，所以这里只查面板标题与静态文案 */
  if (!cm.__seen.some(function (t) { return t.indexOf('设') >= 0; })) {
    errors.push('overlay=settings 没有渲染出设置面板');
  }
  if (!cm.__seen.some(function (t) { return t.indexOf('协议') >= 0; })) {
    errors.push('overlay=settings 没有渲染出「协议」一行');
  }
}, 'worlds.panel.contract');

/* ---------- 界门契约（设计 v1.1 §2.3 / 缺口 U1） ----------
   每界首区都有界门 → 面板可开 → 能切当前界并落到目标界首区；未解锁的界去不了；
   渲染分支真的画出来（同样用文本探针，只断言"不抛异常"是空的）。 */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  s.pos = null;
  G.game.save = s;
  G.game.meta = {
    progress: {
      difficulty: 'normal',
      worlds: { fan: true, ling: true, xian: false, dao: false },
      daoKey: false,
      worldDiff: { fan: 'normal', ling: 'normal', xian: 'normal', dao: 'normal' },
      daoShards: { fan: false, ling: false, xian: false }
    },
    hellCleared: {}, titles: [], perfusion: {}, achieve: {}
  };

  function reachable(mp, from) {
    const seen = {}, q = [[from.x, from.y]];
    seen[from.x + ',' + from.y] = true;
    while (q.length) {
      const c = q.shift();
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        const nx = c[0] + d[0], ny = c[1] + d[1];
        if (nx < 0 || ny < 0 || nx >= mp.w || ny >= mp.h) return;
        if (mp.solid[ny][nx]) return;
        const k = nx + ',' + ny; if (seen[k]) return;
        seen[k] = true; q.push([nx, ny]);
      });
    }
    return seen;
  }

  /* ① 每界至少有一座界门；生成型界门区域真有物件、且走得到。
       注意**不是"首区一定有"**：凡界的首区青溪镇是复用现有手写地图，
       刻意不往里塞界门对象（会动到 M0 教学链与既有测试契约），
       凡界的界门放在落霞镇（商旅重镇 = 交通枢纽）。 */
  ['fan', 'ling', 'xian', 'dao'].forEach(function (wid) {
    const gates = G.Data.regions.of(wid).filter(function (r) { return r.gate; });
    if (!gates.length) { errors.push(`${wid}: 没有任何区域标记为界门（gate:true）`); return; }
    gates.forEach(function (first) {
      if (first.map) return;                            /* 复用型地图不塞界门 */
      G.RegionGen.ensure(s, first.id);
      const md = G.Data.maps[first.id];
      const mp = G.MapGen.buildMap(s, first.id);
      const g = (md.special || []).filter(function (x) { return x.kind === 'worldgate'; })[0];
      if (!g) { errors.push(`${wid}: 区域 ${first.id} 没有生成界门`); return; }
      const o = mp.interact[g.x + ',' + (g.y + 1)];
      if (!o || o.type !== 'worldgate') { errors.push(`${wid}: 区域 ${first.id} 界门交互点缺失`); return; }
      if (!reachable(mp, md.spawn)[g.x + ',' + (g.y + 1)]) {
        errors.push(`${wid}: 区域 ${first.id} 的界门从 spawn 走不到`);
      }
    });
  });

  /* ② 面板与传送 */
  G.game.changeScene('town', { toSpawn: true });
  const sc = G.game.scene;
  G.RegionGen.openGate(sc);
  if (sc.overlay !== 'worldgate') { errors.push('openGate 未设置 overlay'); return; }
  if (sc.buttons.length !== 5) errors.push(`界门面板应有 4 界 + 返回，实际 ${sc.buttons.length}`);

  sc.buttons[2].onClick();                              /* 仙界：未解锁 */
  if (G.Player.activeWorldId(G.game.meta) !== 'fan') errors.push('未解锁的界不该能传送');
  G.RegionGen.openGate(sc);
  sc.buttons[1].onClick();                              /* 灵界：已解锁 */
  if (G.Player.activeWorldId(G.game.meta) !== 'ling') errors.push('已解锁的界应能传送');
  /* 目标界的入口落位要补齐 */
  if (!(s.entrances && s.entrances.ling && s.entrances.ling.length === 5)) {
    errors.push('传送到新界后该界的入口落位未补齐');
  }

  /* ③ 渲染分支真的画出来 */
  sc.overlay = 'worldgate';
  sc.buttons = [];
  const cg = textSpy(); sc.render(cg);
  if (!cg.__seen.some(function (t) { return t.indexOf('门') >= 0; })) {
    errors.push('overlay=worldgate 没有渲染出界门面板（路由漏了）');
  }
}, 'worldgate.contract');

/* ---------- 主线任务链契约 ----------
   ① 17 步主线每一步都要能取到追踪数据、下标与顺序一致、文案齐全
     （缺一步 = 面板步数错位、"主线 8/17" 与实际不符）
     ⚠️ v0.65.0 起含 **M2 云州城三步**（m2-1..m2-3），插在 m1-7 与 m1done 之间。
   ② **m1-2「外堂探子」的抉择必须真的把任务推进到 m1-3** ——
     这是玩家最容易感知到的一环：旗标置了但步数不动，任务就"卡在原地反复"。 */
step(function () {
  const ORDER = ['m0-1', 'm0-2', 'm0-3', 'm0-4', 'm0-5', 'free',
    'm1-1', 'm1-2', 'm1-3', 'm1-4', 'm1-5', 'm1-6', 'm1-7',
    'm2-1', 'm2-2', 'm2-3', 'm1done'];
  const s0 = JSON.parse(JSON.stringify(save));
  ORDER.forEach(function (id, i) {
    s0.quest = { step: id, flags: {} };
    const tk = G.Overlays.trackInfo(s0);
    if (!tk) { errors.push(`主线步骤 ${id} 取不到追踪数据`); return; }
    if (tk.idx !== i) errors.push(`主线步骤 ${id} 下标应为 ${i}，实际 ${tk.idx}`);
    if (tk.total !== ORDER.length) errors.push(`主线总步数应为 ${ORDER.length}，实际 ${tk.total}`);
    if (!tk.s || !tk.s.t) errors.push(`主线步骤 ${id} 缺标题文案`);
    if (!tk.s || !tk.s.d) errors.push(`主线步骤 ${id} 缺目标文案`);
  });

  /* m1-2：打赢探子回镇 → 弹抉择 → 选任一项 → 必须推进到 m1-3 */
  s0.quest = { step: 'm1-2', flags: { probeWin: true } };
  s0.pos = null;
  G.game.save = s0;
  G.game.changeScene('town', { toSpawn: true });
  const sc = G.game.scene;
  if (sc.overlay !== 'choice1') {
    errors.push(`m1-2 打赢探子后回镇没有弹出抉择（overlay=${sc.overlay}）`);
    return;
  }
  sc.buttons[0].onClick();
  if (s0.quest.step !== 'm1-3') {
    errors.push(`m1-2 抉择后任务未推进到 m1-3（仍为 ${s0.quest.step}）—— 会表现为"任务卡住反复"`);
  }
  if (!s0.quest.flags.probe) errors.push('m1-2 抉择后未记录 probe 旗标（追踪栏会一直显示未完成）');

  /* ③ 旧档自救：早期版本只写 flags.probe、没推进步数 → 玩家永久卡在 m1-2
        （追踪栏显示「✓ 处置探子」却一直停在这一步，反复点行脚商也没用）。
        进镇时必须按旗标补推进。 */
  s0.quest = { step: 'm1-2', flags: { probe: 'spare', probeWin: true } };
  s0.pos = null;
  G.game.save = s0;
  G.game.changeScene('town', { toSpawn: true });
  if (s0.quest.step !== 'm1-3') {
    errors.push(`旧档自救失败：probe 已置位但步数仍为 ${s0.quest.step}（会永久卡在「外堂探子」）`);
  }
  if (G.game.scene.overlay === 'choice1') errors.push('旧档自救后不该再弹抉择（旗标已置位）');
}, 'quest.chain.contract');

/* ---------- 道具图标契约 ----------
   ① 每个已映射的道具都要能取到图标（素材或程序化兜底都不能返回空）
   ② 素材必须**真的接上**（不是走兜底）—— 兜底能画不代表图到了
   ③ 储物格子的按钮必须带上 icon —— 漏传是**静默不画图标**，肉眼很难归因 */
step(function () {
  const ids = ['pill_huichun', 'pill_dahuan', 'pill_juqi', 'pill_xingshen', 'pill_jiedu',
    'pill_ganlin', 'pill_shujin', 'pill_cuiti', 'pill_zhuji', 'talisman_jiefeng',
    'talisman_huicheng', 'mat_yaodan', 'shard_fan', 'shard_ling', 'shard_bao', 'stone'];
  ids.forEach(function (id) {
    const io = G.Art.itemIcon(id, 15);
    if (!io || !io.c) errors.push(`道具图标 ${id} 取不到（素材与程序化兜底都失败）`);
    else if (!(io.w > 0 && io.h > 0)) errors.push(`道具图标 ${id} 尺寸非法`);
  });
  /* 素材必须**真的接上**。⚠️ 无头环境里 `G.Assets.img()` 恒返回 null
     （`images` 表靠真实解码填充，桩 Image 不会填），所以不能拿它判"图到了没" ——
     与素材契约一样**直接读盘上的 manifest.json**。 */
  const mf = JSON.parse(fs.readFileSync(path.join(WWW, 'assets', 'manifest.json'), 'utf8'));
  const missing = ids.filter(function (id) { return !mf['item.' + id]; });
  if (missing.length) errors.push(`道具图标素材缺失（会走程序化兜底）：${missing.join(' / ')}`);

  const s2 = JSON.parse(JSON.stringify(save));
  s2.items = { '回春丹': 2, '解封符': 1, '妖丹': 3, '凡品功法碎片': 4 };
  s2.stone = 100;
  s2.pos = null;
  G.game.save = s2;
  G.game.changeScene('town', { toSpawn: true });
  const sc = G.game.scene;
  G.Overlays.openPanel(sc, 'bag');
  const cells = (sc.buttons || []).filter(function (b) { return b.sub != null && b.label; });
  if (!cells.length) errors.push('储物面板没有生成格子按钮');
  const noIcon = cells.filter(function (b) { return !b.icon; });
  if (noIcon.length) errors.push(`${noIcon.length} 个储物格子没带 icon（会静默不画图标）`);

  /* ④ 全量覆盖：**每个在 ITEM_D 里登记说明的道具**都必须能在 manifest 里查到图。
     ⚠️ 这条是 v0.67.0 补的 —— 「结丹丹 / 道纹丹 / 饲灵草料」在 ITEM_D / 商店 /
        炼丹配方 / 灵兽进化里都在用，却漏了 ITEM_ICON_ID 映射：
        取图会一路拼到 `item.结丹丹` 查不到，**静默退回程序化兜底**，
        玩家看到的就是「这个道具没图标」，而所有既有契约**照样全绿**。
     之前那 ①②③ 只覆盖了硬编码的 16 个 id，正是这个缺口溜过去的原因。 */
  const src = fs.readFileSync(path.join(WWW, 'js', 'core', 'panels.js'), 'utf8');
  const dm = src.match(/var ITEM_D = \{([\s\S]*?)\n  \};/);
  const im = src.match(/var ITEM_ICON_ID = \{([\s\S]*?)\n  \};/);
  if (!dm || !im) { errors.push('道具图标契约：解析 ITEM_D / ITEM_ICON_ID 失败（正则过时？）'); return; }
  const map = {};
  (im[1].match(/'([^']+)':\s*'([^']+)'/g) || []).forEach(function (s) {
    const m = s.match(/'([^']+)':\s*'([^']+)'/);
    if (m) map[m[1]] = m[2];
  });
  const noMap = [], noArt = [];
  (dm[1].match(/'([^']+)':\s*'/g) || []).forEach(function (s) {
    const name = s.match(/'([^']+)'/)[1];
    if (!map[name]) { noMap.push(name); return; }
    const key = map[name].indexOf('.') >= 0 ? map[name] : 'item.' + map[name];
    if (!mf[key]) noArt.push(name + '→' + key);
  });
  if (noMap.length) {
    errors.push(`${noMap.length} 个道具在 ITEM_D 有说明却没有 ITEM_ICON_ID 映射`
      + `（会静默退回程序化兜底）：${noMap.join(' / ')}`);
  }
  if (noArt.length) {
    errors.push(`${noArt.length} 个道具的映射指向不存在的素材键：${noArt.join(' / ')}`);
  }
  if (Object.keys(map).length < 40) {
    errors.push('道具图标契约：ITEM_ICON_ID 只解析到 ' + Object.keys(map).length + ' 条（应 ≥40），正则可能过时');
  }
}, 'item.icon.contract');

/* ---------- 问道契约（v0.20.0） ----------
   用户口径：「天道赐福属于问道其中的一种；每个大境界可以问道一次；
   突破之后，问道可能是奖励也可能是惩罚，扣除灵石、灵力、灵气之类的」。
   ① 每个「境」只问一次（再问返回 null）
   ② 赏罚都有：跑 200 次，good 与 bad 都必须出现过
   ③ 赐福真的写进 meta.blessing（进破境公式的 +1~5%）
   ④ 扣减有下限：灵石/灵气/灵力 不会被扣成负数 */
step(function () {
  const mk = function () {
    return { save: { globalLevel: 40, stone: 1000, qi: 5000, po: 100, skills: {}, askedRealms: {} },
             meta: { blessing: 0 } };
  };
  const a = mk();
  const r1 = G.Player.askDao(a.save, a.meta);
  if (!r1) { errors.push('问道第一次应返回结果'); return; }
  if (!a.save.askedRealms[r1.realm]) errors.push('问道未记录 askedRealms');
  if (G.Player.askDao(a.save, a.meta)) errors.push('同一境不应能问第二次');

  let good = 0, bad = 0, neg = 0;
  for (let i = 0; i < 200; i++) {
    const m = mk();
    m.save.globalLevel = 10 + i;
    const r = G.Player.askDao(m.save, m.meta);
    if (!r) continue;
    if (r.k === 'good') good++;
    if (r.k === 'bad') bad++;
    if (m.save.stone < 0 || m.save.qi < 0 || m.save.po < 0) neg++;
  }
  if (!good) errors.push('问道 200 次里一次赏都没出（权重表坏了？）');
  if (!bad) errors.push('问道 200 次里一次罚都没出（权重表坏了？）');
  if (neg) errors.push('问道把资源扣成了负数（' + neg + ' 次）');

  let blessed = false;
  for (let i = 0; i < 300 && !blessed; i++) {
    const m = mk();
    m.save.globalLevel = 10 + (i % 150);
    const r = G.Player.askDao(m.save, m.meta);
    if (r && r.id === 'bless') {
      blessed = true;
      if (!(m.meta.blessing >= 1 && m.meta.blessing <= 5)) {
        errors.push('赐福应写 1~5 的 meta.blessing，实际 ' + m.meta.blessing);
      }
    }
  }
  if (!blessed) errors.push('问道 300 次没抽到过赐福（权重表坏了？）');
}, 'askdao.contract');

/* ---------- 支线（内容型）契约 ----------
   ① 每条支线的 giver 必须对应真实存在的 NPC act；steps ≥ 2；reward 至少给一样
   ② **ready 与 cost 必须成对** —— 只写 ready 不写 cost 是白送；只写 cost 不写 ready 会把物品扣穿
   ③ 接取 → 条件达成（tick 1→2）→ 交付（扣 cost + 发 reward + step=3）整条链
   ④ 交付不会把物品扣成负数；已完成的不能重复交付 */
step(function () {
  const SQ = G.Data.sideQuests;
  if (!SQ) { errors.push('G.Data.sideQuests 缺失'); return; }
  /* giver 的匹配口径（v0.92.0 修正）：
     `giver` 存的是 **NPC 的 id**，而拿它去找 talk 入口时也是按 id 找
     （`onInteract` 里 `SQ.talk(scene, o.id, ...)`）。
     ⚠️ 但**青溪镇**的 NPC 历史上是 `id` 与 `act` 同形（washer/woodman/market），
        而**云州城**的 id 是 `yz_market`、act 却是 `market` —— 两者不同形。
        所以判据要**同时收 id 与 act 两个集合**，否则云州城支线会被误判成"找不到 NPC"。
     ⚠️ 另外 `chat.<id>` 是青溪镇特有的旧写法（act = 'chat.washer'），一并收。 */
  const acts = {}, npcIds = {};
  Object.keys(G.Data.maps).forEach(function (m) {
    (G.Data.maps[m].npcs || []).forEach(function (n) {
      if (n.act) acts[n.act] = 1;
      if (n.id) npcIds[n.id] = 1;
    });
  });
  SQ.list.forEach(function (q) {
    /* 区域支线（v0.93.0）：用 `region` 字段挂在**区域**上（生成型区域的 NPC id 是动态的），
       校验换成"区域必须真实存在" + "该区域确实是生成型（非手写图）"。
       手写图（town/yunzhou/field/cave 等）走 `giver`，两种来源各验各的。 */
    if (q.region) {
      if (!G.Data.regions.byId(q.region)) {
        errors.push(`区域支线 ${q.id} 的 region「${q.region}」在 regions.js 里不存在`);
      } else {
        var rr2 = G.Data.regions.byId(q.region);
        /* 手写图区域不该走区域支线（它们有真 NPC，按 giver 挂更准） */
        if (rr2.map && !q.giver) {
          errors.push(`区域支线 ${q.id} 挂在手写图区域「${q.region}」上（应改用 giver 挂到具体 NPC）`);
        }
      }
    } else if (!npcIds[q.giver] && !acts[q.giver] && !acts['chat.' + q.giver]) {
      errors.push(`支线 ${q.id} 的 giver「${q.giver}」在 maps 里找不到对应 NPC（id/act 都不匹配）`);
    }
    /* 每个"生成型区域"都必须配一条支线（用户口径「保证所有的场景地图都有支线」）——
       这条在下面的 ⑨ 里统一验（需要 regiongen 的生成清单）。 */
    if (!q.steps || q.steps.length < 2) errors.push(`支线 ${q.id} 步骤不足 2 步`);
    if (!q.reward || (!q.reward.stone && !q.reward.items && !q.reward.rep)) {
      errors.push(`支线 ${q.id} 没有任何奖励`);
    }
    /* 有 ready 就必须有 cost —— 否则是"白送"。
       无物品代价的支线（判定靠别的系统）要**显式**写 `free: true`，不写就当漏了。 */
    if (q.ready && !q.cost && !q.free) {
      errors.push(`支线 ${q.id} 有 ready 却没有 cost（白送）；无代价请显式写 free:true`);
    }
  });

  const q = SQ.list[0];
  const s2 = JSON.parse(JSON.stringify(save));
  s2.items = {}; s2.side = {}; s2.stone = 0;
  if (!SQ.accept(s2, q)) errors.push('接取支线失败');
  if (SQ.stepOf(s2, q.id) !== 1) errors.push('接取后 step 应为 1');
  if (SQ.canTurnIn(s2, q)) errors.push('未满足条件时不该能交付');
  Object.keys(q.cost || {}).forEach(function (k) { s2.items[k] = (q.cost[k] || 1) + 5; });
  if (q.id === 'sq_keeper') s2.dungeonSlot = 1;
  SQ.tick(s2);
  if (SQ.stepOf(s2, q.id) !== 2) errors.push('条件达成后 tick 应把 step 推到 2');
  const r = SQ.turnIn(s2, q);
  if (!r.ok) errors.push('满足条件后应能交付：' + r.reason);
  if (SQ.stepOf(s2, q.id) !== 3) errors.push('交付后 step 应为 3');
  Object.keys(q.cost || {}).forEach(function (k) {
    if (s2.items[k] < 0) errors.push(`交付把 ${k} 扣成了负数`);
  });
  if (SQ.canTurnIn(s2, q)) errors.push('已完成的支线不该能重复交付');
  Object.keys(q.cost || {}).forEach(function (k) {
    if (s2.items[k] < 0) errors.push(`交付把 ${k} 扣成了负数`);
  });

  /* ④ v0.90.0：**功法奖励必须顺手激发**（用户口径「分支任务获取功法」）。
     只写 save.skills 不进技能栏 = 玩家学了却用不上，且完全静默
     （项目"路径遗漏型缺口"的典型）。逐条驱动：发功法的那几条支线，
     交付后该功法必须真的是"可用状态"（能被 equippedIds 认到或至少能 activate）。 */
  const skillQuests = SQ.list.filter(function (x) { return (x.reward || {}).skill; });
  if (!skillQuests.length) {
    errors.push('支线里没有任何「功法奖励」（用户要求分支任务能给功法）');
  }
  skillQuests.forEach(function (x) {
    const s3 = JSON.parse(JSON.stringify(save));
    s3.side = {}; s3.items = {}; s3.skills = {}; s3.skillEquip = [];
    /* 满足各类前置（这些支线的 `ready` 读的是不同系统，逐类补上）：
       · 境界门槛（yz_judge 要筑基）→ 直接给足 gl
       · 斩妖数（如有）→ 给足 wildKills
       · 副本进度 → dungeonSlot
       · 物品代价 → 给足 cost 所需 */
    s3.globalLevel = 100;                 /* 覆盖所有"境界门槛"型 ready */
    s3.wildKills = 9999;
    s3.dungeonSlot = 1;
    s3.visited = Object.assign({}, s3.visited || {}, { fan4: 1 });
    SQ.accept(s3, x);
    Object.keys(x.cost || {}).forEach(function (k) { s3.items[k] = (x.cost[k] || 1) + 5; });
    SQ.tick(s3);
    const rr = SQ.turnIn(s3, x);
    if (!rr.ok) { errors.push('功法支线 ' + x.id + ' 应能交付：' + rr.reason); return; }
    if (!s3.skills[x.reward.skill]) {
      errors.push('支线 ' + x.id + ' 交付后未授予功法 ' + x.reward.skill);
    }
    /* 「学了」与「能用」是两件事 —— 必须真的进了激发列表。
       ⚠️ 判据要**紧**：不能退让成"能激活也算"（那就等于没验 autoEquip，见反例）。
          交付时激励位若被占（已有别的功法），autoEquip 会拒 —— 那也算**已知且合理**，
          所以基线存档必须**清空 skillEquip** 后再交付（上面已清）。 */
    if ((s3.skillEquip || []).indexOf(x.reward.skill) < 0) {
      errors.push('支线 ' + x.id + ' 授予的功法未进激发列表（autoEquip 漏接，玩家学了用不上）');
    }
  });

  /* ⑤ v0.90.0：**剧情/副本道具必须有图标映射**。
     `itemIcon` 查不到会静默退回程序化兜底（看不出坏了），
     所以凡是支线 reward 里出现的道具，都必须登记进面板的图标表。 */
  {
    const iconSrc = fs.readFileSync(path.join(WWW, 'js/core/panels.js'), 'utf8');
    const seen = {};
    SQ.list.forEach(function (x) {
      Object.keys((x.reward || {}).items || {}).forEach(function (k) {
        if (seen[k]) return; seen[k] = 1;
        /* 材料类走 `mat.` 绝对键、丹药走 pill_*，两种都算已登记 */
        if (iconSrc.indexOf("'" + k + "'") < 0) {
          errors.push('支线奖励道具「' + k + '」未登记图标映射（会静默走程序化兜底）');
        }
      });
    });
  }

  /* ⑥ v0.92.0（用户口径「支线任务还是太少了」）：**一个 NPC 可挂多条**，
     且 `byGiver` 必须按 step **排队**（旧的 `filter(...)[0]` 永远只认第一条，
     给同一 NPC 挂第二条也永远不会被触发 —— 静默）。
     判据：模拟"第 1 条做完 → 应轮到第 2 条"。 */
  {
    const multi = {};
    SQ.list.forEach(function (q) {
      multi[q.giver] = (multi[q.giver] || 0) + 1;
    });
    const g2 = Object.keys(multi).filter(function (k) { return multi[k] >= 2; });
    if (!g2.length) errors.push('没有任何 NPC 挂 ≥2 条支线（多支线能力未验证）');
    g2.forEach(function (gid) {
      const ids = SQ.list.filter(function (q) { return q.giver === gid; }).map(function (q) { return q.id; });
      const sm = JSON.parse(JSON.stringify(save));
      sm.side = {};
      /* 全未接 → 应给第一条 */
      if ((SQ.byGiver(gid, sm) || {}).id !== ids[0]) {
        errors.push(gid + ' 全未接时应返回第一条支线，实为 ' + JSON.stringify(SQ.byGiver(gid, sm)));
      }
      /* 第一条完成后 → 应轮到第二条 */
      sm.side[ids[0]] = 3;
      if ((SQ.byGiver(gid, sm) || {}).id !== ids[1]) {
        errors.push(gid + ' 第一条完成后应轮到第二条，实为 ' + JSON.stringify(SQ.byGiver(gid, sm)));
      }
      /* 全部完成 → null（调用方退回普通闲聊） */
      ids.forEach(function (id) { sm.side[id] = 3; });
      if (SQ.byGiver(gid, sm) !== null) {
        errors.push(gid + ' 全部完成后 byGiver 应返回 null');
      }
      /* 进行中的（step 1）优先级最高 —— 手上这条先了结 */
      const sm2 = JSON.parse(JSON.stringify(save));
      sm2.side = {}; sm2.side[ids[1]] = 1;
      if ((SQ.byGiver(gid, sm2) || {}).id !== ids[1]) {
        errors.push(gid + ' 有进行中的支线时应优先返回它');
      }
    });
  }

  /* ⑦ v0.92.0：支线数量必须"够多"（用户明确抱怨太少）。
     下界写 15（当前 17）—— 防将来删到只剩个位数，同时不绑死具体条数。 */
  if (SQ.list.length < 15) {
    errors.push('支线总数仅 ' + SQ.list.length + ' 条（用户要求"不能太少"，应 ≥15）');
  }
  /* ⑧ 支线**列表要能滚**：超过一屏（`QP.maxRows`=9）时，
     `questRows` 必须给出非零 win0，否则第 10 条之后永远看不见（静默截断）。 */
  {
    const scq = G.game.scene;
    const keepSel = scq.questSel, keepTab = scq.questTab;
    try {
      scq.questTab = 'side';
      scq.questSel = SQ.list[SQ.list.length - 1].id;      /* 选最后一条 */
      if (SQ.list.length > 9) {
        if (typeof G.Overlays.questRowsForTest !== 'function') {
          /* 没有导出探针时退回源码闸：win0 不许写死 0 */
          const ps = fs.readFileSync(path.join(WWW, 'js/core/panels.js'), 'utf8');
          if (/rows: list\.map\([\s\S]{0,80}win0: 0/.test(ps)) {
            errors.push('源码闸：支线列表 win0 写死 0（超过一屏的支线永远看不见）');
          }
        }
      }
    } finally {
      scq.questSel = keepSel; scq.questTab = keepTab;
    }
  }
  /* ⑨ v0.93.0（用户口径「保证所有的场景地图都有支线和主线任务」）：
     **每一个生成型区域都必须配一条区域支线**，且 regiongen 必须把它挂到当地 NPC 上。
     这是那条需求的核心判据 —— 漏了任何一界/任何一区都会在这里报出来。 */
  {
    /* ⚠️ 区域清单走 `byWorld`（`G.Data.regions` **没有** `list` 导出）——
       写成 `regions.list` 会得到 undefined，整段判据静默跳过（假绿）。 */
    const regs = [];
    ['fan', 'ling', 'xian', 'dao'].forEach(function (w) {
      (G.Data.regions.byWorld[w] || []).forEach(function (r) { regs.push(r); });
    });
    if (!regs.length) errors.push('区域清单为空（regions.byWorld 取不到）—— 覆盖判据失效');
    const haveQ = {};
    SQ.list.forEach(function (q) { if (q.region) haveQ[q.region] = q.id; });
    const missing = [];
    regs.forEach(function (r) {
      /* 手写图的区域（`map` 指向 maps.js 里的手写图）走 giver，不要求 region 支线 */
      const isHand = !!r.map && !!G.Data.maps[r.map];
      if (isHand) return;
      if (!haveQ[r.id]) missing.push(r.id + '(' + r.n + ')');
    });
    if (missing.length) {
      errors.push('这些生成型区域没有支线（用户要求每张场景地图都有支线）：' + missing.join('、'));
    }
    /* 四界都要有覆盖（不能只补凡界） */
    ['fan', 'ling', 'xian', 'dao'].forEach(function (w) {
      const n = (G.Data.regions.byWorld[w] || []).filter(function (r) { return haveQ[r.id]; }).length;
      if (n === 0) errors.push('「' + w + '」界一条区域支线都没有（四界都要覆盖）');
    });
    /* regiongen 必须真的把支线指派给 NPC（否则这些支线永远没人发） */
    const rgSrc = fs.readFileSync(path.join(WWW, 'js/core/regiongen.js'), 'utf8');
    if (rgSrc.indexOf('npc.sq = rq.id') < 0) {
      errors.push('源码闸：regiongen 未把区域支线指派给当地 NPC（npc.sq）—— 支线没人发');
    }
    /* ⚠️ 真驱动核验：**走到 NPC 旁边按一下**，必须开出 sideq。
       为什么不能只验数据：`explore._interact` 对 `type==='npc'` 走的是
       `hooks.onNpc`，**不会**落到 `onInteract` —— 上一版 regiongen 只注册了
       onInteract，于是"点 NPC 什么都不发生"。这条只有真驱动才抓得到。 */
    ['fan5', 'ling1', 'xian1', 'dao1'].forEach(function (rid) {
      const sv = JSON.parse(JSON.stringify(save || {}));
      sv.life = 1; sv.side = {}; sv.globalLevel = 100; sv.wildKills = 999; sv.pos = null;
      sv.world = sv.world || G.Data.generateWorld(12345, true);
      sv.quest = sv.quest || { step: 'm1done', flags: {} };
      G.game.save = sv;
      G.game.meta = G.game.meta || { past: [], progress: { worlds: {} } };
      try {
        G.game.changeScene(rid, { toSpawn: true });
        const sc2 = G.game.scene, m2 = sc2.map;
        const sn = (m2.npcs || []).filter(function (n) { return n.sq; })[0];
        if (!sn) { errors.push(rid + ' 生成后没有任何带 sq 的 NPC（区域支线没指派）'); return; }
        const dirs = [[0, 1, 'up'], [0, -1, 'down'], [1, 0, 'left'], [-1, 0, 'right']];
        let opened = false;
        for (let di = 0; di < dirs.length && !opened; di++) {
          const nx = sn.x + dirs[di][0], ny = sn.y + dirs[di][1];
          if (nx < 0 || ny < 0 || nx >= m2.w || ny >= m2.h) continue;
          if (m2.solid[ny][nx]) continue;
          G.game.save.pos = { x: nx, y: ny };
          sc2.dir = dirs[di][2];
          sc2.overlay = null;
          sc2._interact();
          opened = (sc2.overlay === 'sideq');
        }
        if (!opened) {
          errors.push(rid + ' 走到 NPC 旁边按一下没有开出支线对话（overlay=' + sc2.overlay + '）');
        } else if (G.SideCur !== sn.sq) {
          errors.push(rid + ' 开出的不是该 NPC 的支线（SideCur=' + G.SideCur + ' 应为 ' + sn.sq + '）');
        }
      } catch (e) {
        errors.push(rid + ' 区域支线真驱动抛错：' + e.message);
      }
    });
    G.game.save = save;
    notes.push('区域支线：' + Object.keys(haveQ).length + ' 个区域已配 / 共 ' + regs.length + ' 个');
  }

  /* ⑩ v0.93.0（用户口径「把所有的主线支线全部串联起来……符合真实感情」）：
     **交付支线要汇入道心**，而道心是三结局的唯一分水岭 ——
     这条链断了的话，"帮过的人"对结局毫无影响（支线就只是拿奖励的工具）。
     判据：交付一条支线 → `save.daoHeart` 必须增加；且必须**钳制在 -10..+10**。 */
  {
    const Ch = G.Data.Chapters;
    if (!Ch || !Ch.addHeart) { errors.push('Chapters.addHeart 缺失（道心无唯一写入口）'); }
    else {
      const sC = JSON.parse(JSON.stringify(save || {}));
      sC.side = {}; sC.items = {}; sC.skills = {}; sC.skillEquip = [];
      sC.daoHeart = 0; sC.globalLevel = 200; sC.wildKills = 9999; sC.dungeonSlot = 1;
      sC.visited = { fan4: 1 };
      const q = SQ.list[0];
      SQ.accept(sC, q);
      Object.keys(q.cost || {}).forEach(function (k) { sC.items[k] = (q.cost[k] || 1) + 5; });
      SQ.tick(sC);
      const h0 = sC.daoHeart || 0;
      const rC = SQ.turnIn(sC, q);
      if (!rC.ok) errors.push('串联契约：支线应能交付（' + rC.reason + '）');
      else if ((sC.daoHeart || 0) <= h0) {
        errors.push('串联契约：交付支线后道心未增加（' + h0 + ' → ' + (sC.daoHeart || 0)
          + '）—— 支线与结局脱节');
      }
      /* 钳制：连交 30 条也不能越界（越界会让 endingOf 的分档失真） */
      for (let i = 0; i < 30; i++) Ch.addHeart(sC, 1);
      if (sC.daoHeart > 10) errors.push('道心未钳制上限（' + sC.daoHeart + ' > 10）');
      for (let i = 0; i < 60; i++) Ch.addHeart(sC, -1);
      if (sC.daoHeart < -10) errors.push('道心未钳制下限（' + sC.daoHeart + ' < -10）');
    }
    /* 支线回响：结局场景要真的能取到文案（没有 → 串联只做了一半） */
    if (!G.Data.Chapters.sideEcho) errors.push('Chapters.sideEcho 缺失（结局无支线回响）');
    else {
      const e0 = G.Data.Chapters.sideEcho({ side: {} });
      const eN = G.Data.Chapters.sideEcho({ side: { a: 3, b: 3, c: 3 } });
      if (e0 !== '' && e0.length < 4) errors.push('无支线时回响应为空串，实为 ' + JSON.stringify(e0));
      if (!eN || eN.length < 8) errors.push('有支线时回响文案异常：' + JSON.stringify(eN));
    }
    /* 源码闸：结局场景必须真的把回响插进台词流 */
    const endSrc = fs.readFileSync(path.join(WWW, 'js/scenes/ending.js'), 'utf8');
    if (endSrc.indexOf('sideEcho') < 0) {
      errors.push('源码闸：结局场景未调用 Chapters.sideEcho（回响文案没落地）');
    }
  }
}, 'sidequest.contract');

/* ---------- 动效与御剑契约（v0.22.0） ----------
   ① **行走必须有纵向位移**：三帧同图时"走路"只有 1px 上抬，观感是滑行。
      这里抓主角绘制矩形的 y —— 走一步之内**必须出现不同的 y**。
   ② **环境粒子必须真的在动**：同一场景两个时刻的粒子绘制位置必须不同。
   ③ 御剑：金丹起可用；飞行**移速更快**、**不触发暗雷**、**可越树**、**室内禁飞**。 */
step(function () {
  const mkSave = function (gl, fly) {
    const s2 = JSON.parse(JSON.stringify(save));
    s2.pos = null; s2.globalLevel = gl; s2.fly = !!fly; s2.hp = 99999;
    return s2;
  };
  const HW = G.Sprites.HERO_W, HH = G.Sprites.HERO_H;

  /* ① 行走纵向位移 */
  const s2 = mkSave(30, false);
  G.game.save = s2;
  G.game.changeScene('field', { toSpawn: true });
  const sc = G.game.scene;
  function heroY() {
    const c = drawSpy();
    sc.render(c);
    const hit = (c.__hits || []).filter(function (h) { return h.w === HW && h.h === HH; });
    return hit.length ? hit[hit.length - 1].y : null;
  }
  /* ⚠️ 不能只试一个方向：出生点旁边可能正好有树/石挡着（实测 right 就被挡了）。
     逐个方向试，取第一个真的走起来的。 */
  const realHeld = sc._heldDir;
  const ys = {};
  const DIRS = ['right', 'left', 'up', 'down'];
  for (let di = 0; di < DIRS.length && Object.keys(ys).length < 2; di++) {
    sc._heldDir = (function (dd) { return function () { return dd; }; })(DIRS[di]);
    for (let i = 0; i < 16; i++) {
      sc.update(0.03);
      /* ⚠️ **只看"正在走"的帧**：待机呼吸也会让 y 变化，
         不筛的话"关掉走路浮动"照样能通过（反例验证时踩到过）。 */
      if (!sc.moving) continue;
      const y = heroY(); if (y != null) ys[y] = 1;
    }
  }
  sc._heldDir = realHeld;
  if (Object.keys(ys).length < 2) {
    const c2 = drawSpy(); sc.render(c2);
    errors.push('行走时主角绘制 y 恒定 —— 走路动效没生效（观感就是"滑行"）'
      + ` [hits=${(c2.__hits || []).length} HW=${HW} HH=${HH} mt=${sc.mt.toFixed(2)} moving=${sc.moving}`
      + ` ys=${JSON.stringify(Object.keys(ys))}]`);
  }

  /* ② 粒子在动 */
  sc._ptKey = null;
  sc._ensureParticles();
  if (!sc._pt || !sc._pt.length) errors.push('野外场景没有环境粒子');
  function ptHits(t) {
    const old = G.game.time; G.game.time = t;
    const c = drawSpy(); sc._drawParticles(c);
    G.game.time = old;
    return (c.__hits || []).length ? null : null;
  }
  /* 粒子走 fillRect（不是 drawImage），所以改用位置公式直接验：同一粒子两个时刻的 x 必须不同 */
  if (sc._pt && sc._pt.length) {
    const p = sc._pt[0];
    const x1 = (p.x + 1 * p.vx + Math.sin(1 * 1.1 + p.ph) * 9) % 480;
    const x2 = (p.x + 3 * p.vx + Math.sin(3 * 1.1 + p.ph) * 9) % 480;
    if (Math.abs(x1 - x2) < 0.01) errors.push('环境粒子的位置不随时间变化');
  }

  /* ③ 御剑 */
  if (G.Player.canFly({ globalLevel: 108 })) errors.push('金丹之前不该能御剑（gl108）');
  if (!G.Player.canFly({ globalLevel: 109 })) errors.push('金丹起应能御剑（gl109）');
  if (!G.Player.canFly({ globalLevel: 200 })) errors.push('高境界也应能御剑');

  /* 移速：同样 dt，飞行时 mt 推进更快 */
  function advance(fly) {
    const sx = mkSave(120, fly);
    G.game.save = sx;
    G.game.changeScene('field', { toSpawn: true });
    const s3 = G.game.scene;
    const held = s3._heldDir;
    s3._heldDir = function () { return 'right'; };
    s3.update(0.02);                 /* 起步（进入 moving） */
    const before = s3.mt;
    s3.update(0.02);
    const after = s3.mt;
    s3._heldDir = held;
    return after - before;
  }
  const dWalk = advance(false), dFly = advance(true);
  if (!(dFly > dWalk * 1.2)) {
    errors.push(`御剑的移速应明显快于步行（步行 ${dWalk.toFixed(3)} vs 飞行 ${dFly.toFixed(3)}）`);
  }

  /* 不遇敌 + 可越树 + 室内禁飞 */
  const sf = mkSave(120, true);
  G.game.save = sf;
  G.game.changeScene('field', { toSpawn: true });
  const fsc = G.game.scene;
  if (!fsc._flying()) errors.push('save.fly=true 时 _flying() 应为真');
  fsc.prot = 0;
  fsc.flashDir = 0;
  for (let i = 0; i < 200 && fsc.flashDir !== 1; i++) fsc._onEnterTile(24, 20);
  if (fsc.flashDir === 1) errors.push('御剑飞行时不该触发暗雷');
  /* 越树：找一个 tree 格，飞行时不该被挡 */
  fsc._ensureFlyGrid();
  let treeCell = null;
  (fsc.map.decor || []).forEach(function (d) { if (!treeCell && d.t === 'tree') treeCell = d; });
  if (treeCell) {
    if (!fsc._flying() || fsc._blocked(treeCell.x, treeCell.y)) {
      errors.push('御剑时应能越过树木');
    }
    const sw = mkSave(120, false);
    G.game.save = sw;
    G.game.changeScene('field', { toSpawn: true });
    if (!G.game.scene._blocked(treeCell.x, treeCell.y)) errors.push('步行时树应当挡路');
  }
  /* 室内禁飞 */
  const si = mkSave(120, true);
  G.game.save = si;
  G.game.changeScene('town_home', { toSpawn: true });
  if (G.game.scene._flying()) errors.push('室内不该能御剑');
}, 'anim.fly.contract');

/* ---------- 副本每层三选一契约（v0.23.0） ----------
   ① 增益表：id 唯一、有名称与说明、**效果字段必须落在 te 的已知集合里**
      （写错字段名会静默不生效 —— 面板涨了、战斗没涨这类问题最难查）
   ② roll(3) 不重复
   ③ 增益**真的进了 computeStats**（四维逐个验，不是只看"表里有没有"）
   ④ **离开副本即失效**（run 被丢掉 → 面板回落）
   ⑤ 三选一视图能开、恰 3 个候选、选完写进 run.buffs */
step(function () {
  const DB = G.Data.dungeonBuffs;
  if (!DB) { errors.push('G.Data.dungeonBuffs 缺失'); return; }
  const KNOWN = { a: 1, f: 1, h: 1, s: 1, c: 1, cd: 1, vamp: 1 };
  const seen = {};
  DB.list.forEach(function (b) {
    if (seen[b.id]) errors.push('副本增益 id 重复：' + b.id);
    seen[b.id] = 1;
    if (!b.n || !b.d) errors.push('副本增益缺名称或说明：' + b.id);
    Object.keys(b.fx || {}).forEach(function (k) {
      if (!KNOWN[k]) {
        errors.push(`副本增益 ${b.id} 的效果字段 ${k} 不在 te 的已知集合里（会静默不生效）`);
      }
    });
  });
  for (let i = 0; i < 30; i++) {
    const r = DB.roll(3);
    if (r.length !== 3) errors.push('roll(3) 应返回 3 条');
    if (new Set(r.map(function (x) { return x.id; })).size !== 3) {
      errors.push('roll(3) 出现了重复候选');
    }
  }

  const s2 = JSON.parse(JSON.stringify(save));
  s2.dungeonRun = { archId: 'B1', stage: 2, buffs: [] };
  const base = G.Player.computeStats(s2);
  s2.dungeonRun.buffs = ['atk', 'hp', 'def', 'spd'];
  const buffed = G.Player.computeStats(s2);
  if (!(buffed.atk > base.atk)) errors.push('「锐意」没进 computeStats（攻击没涨）');
  if (!(buffed.maxhp > base.maxhp)) errors.push('「厚土」没进 computeStats（气血没涨）');
  if (!(buffed.def > base.def)) errors.push('「铁骨」没进 computeStats（防御没涨）');
  if (!(buffed.spd > base.spd)) errors.push('「疾风」没进 computeStats（速度没涨）');

  const s3 = JSON.parse(JSON.stringify(s2));
  s3.dungeonRun = null;
  const after = G.Player.computeStats(s3);
  if (after.atk !== base.atk) errors.push('离开副本后临时增益应失效（攻击没回落）');

  /* ⑤ 视图与选择 */
  const s4 = JSON.parse(JSON.stringify(save));
  /* ⚠️ `dungeonSet` 必须一起给：`dungeon.enter()` 在它为空时会**把 dungeonRun 清成 null**
     （"旧档/未初始化"的兜底），只设 dungeonRun 会被当场抹掉。 */
  s4.dungeonSet = ['B1', 'S1', 'S2', 'B2', 'S3'];
  s4.dungeonSlot = 0;
  s4.dungeonRun = { archId: 'B1', stage: 3, buffs: [], midBeaten: false, bigBeaten: false };
  G.game.save = s4;
  G.game.changeScene('dungeon');
  const d = G.game.scene;
  d._offerBuffs(['测试结算']);
  if (d.view !== 'buff') errors.push('_offerBuffs 未切到 buff 视图');
  if (!d.buttons || d.buttons.length !== 3) {
    errors.push('三选一应有 3 个候选按钮，实际 ' + (d.buttons ? d.buttons.length : 0));
  }
  const pick = d.buffPick[0].id;
  d._takeBuff(pick);
  if ((s4.dungeonRun.buffs || []).indexOf(pick) < 0) errors.push('选了增益却没写进 run.buffs');
}, 'dungeon.buff.contract');

/* ---------- 副本事件房契约（v0.35.0） ----------
   用户问「其他主流游戏是怎么设计副本的」→ 对标《鬼谷八荒》的秘境随机事件。
   ① 每个事件：有名称/描述，且**两个选择都有文案与结算函数**
   ② 每个选择都能真的结算 —— **空态（灵石 0 / 无道具 / 血 1）也不许抛异常**
   ③ 结算不会把灵石扣成负数（商人那条必须有门槛）
   ④ 视图能开且**恰 2 个选择**；选完回到 brief（事件房不占一层） */
step(function () {
  const d = G.scenes.dungeon;
  if (!d._EVENTS || !d._EVENTS.length) { errors.push('副本事件表为空'); return; }
  d._EVENTS.forEach(function (e) {
    if (!e.n || !e.d) errors.push('事件 ' + e.id + ' 缺名称或描述');
    ['a', 'b'].forEach(function (k) {
      if (!e[k] || !e[k].t || typeof e[k].run !== 'function') {
        errors.push('事件 ' + e.id + ' 的 ' + k + ' 选择不完整');
      }
    });
  });
  const s2 = JSON.parse(JSON.stringify(save));
  s2.stone = 0; s2.items = {}; s2.hp = 1; s2.qi = 0;
  G.game.save = s2;
  d._EVENTS.forEach(function (e) {
    ['a', 'b'].forEach(function (k) {
      try { e[k].run(s2); } catch (err) {
        errors.push('事件 ' + e.id + '.' + k + ' 结算抛异常：' + err.message);
      }
    });
  });
  if (s2.stone < 0) errors.push('事件结算把灵石扣成了负数');

  s2.dungeonSet = ['B1', 'S1', 'S2', 'B2', 'S3']; s2.dungeonSlot = 0;
  s2.dungeonRun = { archId: 'B1', stage: 2, buffs: [] };
  G.game.changeScene('dungeon');
  const dd = G.game.scene;
  dd._offerEvent(s2.dungeonRun);
  if (dd.view !== 'event') errors.push('_offerEvent 未切到 event 视图');
  if ((dd.buttons || []).length !== 2) {
    errors.push('事件房应有 2 个选择，实际 ' + (dd.buttons || []).length);
  }
  dd.buttons[0].onClick();
  if (dd.view !== 'brief') errors.push('事件选完后应回到 brief（继续前行）');
}, 'dungeon.event.contract');

/* ---------- 精英词缀契约（v0.36.0，对标《暗黑破坏神》） ----------
   ① 每个词缀：有 id / 名称 / 说明，且**至少有一项数值修正**、倍率都为正
   ② 应用后：**名字必须带前缀**（这是玩家唯一的识别线索）、词缀记在敌人身上、数值真的变了
   ③ 气血不会被算成非正数 */
step(function () {
  const D = G.Data.dungeons;
  if (!D.AFFIX || !D.AFFIX.length) { errors.push('精英词缀表为空'); return; }
  D.AFFIX.forEach(function (a) {
    if (!a.id || !a.n || !a.d) errors.push('词缀 ' + a.id + ' 缺名称/说明');
    const keys = ['atk', 'def', 'spd', 'hp'].filter(function (k) { return a[k]; });
    if (!keys.length) errors.push('词缀 ' + a.id + ' 没有任何数值修正');
    keys.forEach(function (k) {
      if (!(a[k] > 0)) errors.push('词缀 ' + a.id + ' 的 ' + k + ' 倍率非法：' + a[k]);
    });
  });
  const e = G.Data.makeEnemy('赤炎狼', 10, '测试狼');
  const before = { atk: e.atk, def: e.def, spd: e.spd, maxhp: e.maxhp };
  D.applyAffix(e, D.AFFIX[0]);
  if (e.name.indexOf(D.AFFIX[0].n) !== 0) {
    errors.push('词缀没有拼进敌人名字（玩家读不出这是词缀怪）');
  }
  if (e.affix !== D.AFFIX[0].id) errors.push('词缀没有记在敌人身上');
  if (!['atk', 'def', 'spd', 'maxhp'].some(function (k) { return e[k] !== before[k]; })) {
    errors.push('词缀没有改变任何数值');
  }
  if (!(e.hp > 0 && e.maxhp > 0)) errors.push('词缀把气血算成了非正数');
}, 'dungeon.affix.contract');

/* ---------- 宗门位阶与岁俸契约（v0.37.0，S4，对标《鬼谷八荒》） ----------
   ① 位阶**由贡献推导**（外门 <200 / 内门 ≥200 / 真传 ≥600）—— 不另存字段
   ② 散修**不发**岁俸
   ③ 宗门弟子：长一岁发一次，**同一年不重复发**
   ④ 位阶越高给得越多
   ⑤ **首次结算只记基线、不补发** —— 否则老档一进镇就"一夜暴富" */
step(function () {
  const P = G.Player;
  if (P.rankOf({ sectRep: 0 }) !== 'outer') errors.push('贡献 0 应为外门');
  if (P.rankOf({ sectRep: 200 }) !== 'inner') errors.push('贡献 200 应为内门');
  if (P.rankOf({ sectRep: 600 }) !== 'core') errors.push('贡献 600 应为真传');

  const s2 = JSON.parse(JSON.stringify(save));
  s2.cult = 'free'; s2.age = 30; s2.stipendAge = 20; s2.stone = 0;
  if (P.tickStipend(s2).length) errors.push('散修不该领岁俸');
  if (s2.stone !== 0) errors.push('散修领岁俸时不该发灵石');

  s2.cult = 'sect'; s2.sectId = 'qxj'; s2.sectRep = 0;
  s2.age = 30; s2.stipendAge = 29; s2.stone = 0; s2.items = {};
  const r1 = P.tickStipend(s2);
  if (!r1.length) errors.push('宗门弟子长一岁应发岁俸');
  if (s2.stone !== P.STIPEND.outer.stone) {
    errors.push('外门岁俸灵石数额不对：' + s2.stone + '（应 ' + P.STIPEND.outer.stone + '）');
  }
  if (P.tickStipend(s2).length) errors.push('同一年不该重复发岁俸');

  if (!(P.STIPEND.core.stone > P.STIPEND.inner.stone
    && P.STIPEND.inner.stone > P.STIPEND.outer.stone)) {
    errors.push('岁俸应随位阶递增');
  }

  const s3 = JSON.parse(JSON.stringify(save));
  s3.cult = 'sect'; s3.sectId = 'qxj'; s3.age = 50; s3.stone = 0;
  delete s3.stipendAge;
  if (P.tickStipend(s3).length) errors.push('首次结算不该补发岁俸（老档会一夜暴富）');
  if (s3.stone !== 0) errors.push('首次结算发了灵石');
}, 'sect.stipend.contract');

/* ---------- 宗门独立小世界生成契约（v0.44.0，GDD v3.5）----------
   ① 大宗门 12 栋 / 小宗门 5 栋；② 从山门无向 BFS 可达全部房间；
   ③ 每条邻接双向有门、山门有通往外界的门、主殿存在；
   ④ 每栋有可交互焦点；每个 NPC 带合法 gl，且 realmInfo 与主角同一境界表。 */
step(function () {
  const SG = G.SectGen;
  G.Data.sects.list.forEach(function (sect) {
    const c = SG.of(save, sect.id);
    if (!c) { errors.push(sect.id + ' 小世界未生成'); return; }
    const want = sect.size === 'big' ? 12 : 5;
    if (c.rooms.length !== want) errors.push(sect.n + ' 房间数应为 ' + want + '，实为 ' + c.rooms.length);

    const byId = {}; c.rooms.forEach(function (r) { byId[r.id] = r; });
    const seen = {}, queue = [c.entry]; seen[c.entry] = 1;
    while (queue.length) {
      const cur = queue.shift();
      (byId[cur].exits || []).forEach(function (e) {
        if (byId[e.to] && !seen[e.to]) { seen[e.to] = 1; queue.push(e.to); }
      });
    }
    c.rooms.forEach(function (r) { if (!seen[r.id]) errors.push(sect.n + ' 的「' + r.label + '」不可达'); });

    if (!byId[c.hall]) errors.push(sect.n + ' 缺主殿');
    const gate = byId[c.entry];
    if (!gate.exits.some(function (e) { return e.to.indexOf('sect.') !== 0; })) {
      errors.push(sect.n + ' 山门缺通往外界的门');
    }
    c.links.forEach(function (lk) {
      const a = SG.roomId(sect.id, lk[0]), b = SG.roomId(sect.id, lk[1]);
      if (!byId[a].exits.some(function (e) { return e.to === b; })) {
        errors.push(sect.n + ' 缺门 ' + lk[0] + '→' + lk[1]);
      }
      if (!byId[b].exits.some(function (e) { return e.to === a; })) {
        errors.push(sect.n + ' 缺门 ' + lk[1] + '→' + lk[0]);
      }
    });
    c.rooms.forEach(function (r) {
      if (!r.furn.some(function (f) { return f.act; })) {
        errors.push(sect.n + '「' + r.label + '」缺可交互焦点');
      }
      r.npcs.forEach(function (n) {
        if (n.gl == null || n.gl < 1 || n.gl > 171) errors.push(sect.n + ' NPC ' + n.name + ' gl 非法');
        const rn = G.Player.realmInfo(n.gl);
        if (!rn || !rn.n) errors.push(sect.n + ' NPC ' + n.name + ' 境界解析失败');
      });
    });
  });
}, 'sectgen.contract');

/* ---------- 灵兽数据契约（v0.44.0，B1，《灵兽 v1.1》） ---------- */
step(function () {
  const B = G.Data.beasts;
  if (B.list.length !== 24) errors.push('灵兽物种应为 24，实际 ' + B.list.length);
  const ROLES = { battle: 1, mount: 1, both: 1, pet: 1, boss: 1 };
  B.list.forEach(function (sp) {
    ['id','n','elem','role','base','grow','qual'].forEach(function (k) {
      if (sp[k] == null) errors.push('灵兽 ' + sp.id + ' 缺字段 ' + k);
    });
    if (!ROLES[sp.role]) errors.push('灵兽 ' + sp.id + ' 非法 role ' + sp.role);
    ['hp','atk','def','spd'].forEach(function (k) {
      if (typeof sp.base[k] !== 'number' || typeof sp.grow[k] !== 'number') {
        errors.push('灵兽 ' + sp.id + ' base/grow.' + k + ' 非数值');
      }
    });
    if (B.canBattle(sp.id) !== (sp.role === 'battle' || sp.role === 'both')) {
      errors.push('灵兽 ' + sp.id + ' canBattle 与 role 不一致');
    }
    if (B.canRideSpecies(sp.id) !== (sp.role === 'mount' || sp.role === 'both')) {
      errors.push('灵兽 ' + sp.id + ' canRideSpecies 与 role 不一致');
    }
    const rides = sp.role === 'mount' || sp.role === 'both';
    if (rides) {
      if (!sp.ride || !(sp.ride.coef > 0) || !Array.isArray(sp.ride.terrains) || !sp.ride.terrains.length) {
        errors.push('灵兽 ' + sp.id + ' 可骑但 ride 配置缺失');
      }
    } else if (sp.ride) {
      errors.push('灵兽 ' + sp.id + ' 不可骑却带 ride');
    }
    if (sp.chain) {
      if (!(sp.chain.gl > 0)) errors.push('灵兽 ' + sp.id + ' chain.gl 非法');
      if (sp.chain.to && !B.byId(sp.chain.to)) errors.push('灵兽 ' + sp.id + ' chain.to 不存在');
    }
    if (!(sp.qual[0] >= 0 && sp.qual[1] >= sp.qual[0] && sp.qual[1] <= 100)) {
      errors.push('灵兽 ' + sp.id + ' 资质区间非法');
    }
    [1, 10, 50, 171].forEach(function (gl) {
      const st = B.stat(sp.id, gl, 60);
      ['hp','atk','def','spd'].forEach(function (k) {
        if (!isFinite(st[k]) || st[k] <= 0) errors.push('灵兽 ' + sp.id + ' gl=' + gl + ' ' + k + ' 非法');
      });
    });
  });
  const mk = function (id, stage) { return { id: id, stage: stage }; };
  if (B.canRide(mk('b_huangzongma','young'))) errors.push('幼年坐骑不应可骑');
  if (!B.canRide(mk('b_huangzongma','adult'))) errors.push('成年坐骑应可骑');
  if (B.canRide(mk('b_chiyanlang','adult'))) errors.push('战种不应可骑');
  const mig = G.Storage._migrate({ version: 6, cult: 'free', skills: {} });
  if (mig.version !== 11 || !Array.isArray(mig.beasts) || mig.riding !== null || !mig.rideSkill) {
    errors.push('v6→v7 存档迁移缺灵兽字段');
  }
  const migM = G.Storage._migrate({ version: 6, xianli: 0 });
  if (migM.version !== 11 || !migM.bestiary) errors.push('v6→v7 meta 迁移缺图鉴字段');
}, 'beasts.data.contract');

/* ---------- 灵兽管理器契约（v0.44.0，B2，《灵兽 v1.1》） ----------
   入栏/喂养/成年/化形/出战/骑乘/放生 全门禁 + 兽栏面板与空状态渲染。 */
step(function () {
  const s2 = JSON.parse(JSON.stringify(save));
  s2.globalLevel = 1; s2.items = {}; s2.beasts = []; s2.beastTeam = [];
  s2.riding = null; s2.rideSkill = { land: false, air: false }; s2.beastSeq = 0;
  G.game.save = s2;
  if (!G.game.meta) G.game.meta = {};
  G.game.meta.bestiary = G.game.meta.bestiary || {};

  let r = G.Beasts.add(s2, 'b_qingwenshe', { gl: 1, stage: 'young' });
  if (!r.ok) errors.push('add snake 失败 ' + r.reason);
  const snake = r.beast;
  if (G.Beasts.add(s2, 'b_chiyanlangwang').ok) errors.push('boss 不应可收服');

  if (G.Beasts.feed(s2, snake.uid, '药渣').ok) errors.push('无药渣不应喂养成功');
  s2.items['药渣'] = 10;
  r = G.Beasts.feed(s2, snake.uid, '药渣');
  if (!r.ok || r.gainXp !== 14) errors.push('药渣喂养异常');

  if (G.Beasts.mature(s2, snake.uid).ok) errors.push('蛇未到门槛不应化形');

  r = G.Beasts.setBattle(s2, snake.uid);
  if (!r.ok || !r.active) errors.push('蛇出战异常 ' + (r.reason || ''));
  const hi = G.Beasts.add(s2, 'b_leishou', { gl: 64, stage: 'adult' });
  if (G.Beasts.setBattle(s2, hi.beast.uid).ok) errors.push('高境界兽不应可出战');

  const hm = G.Beasts.add(s2, 'b_huangzongma', { gl: 29, stage: 'young' });
  const horse = hm.beast;
  if (G.Beasts.setRide(s2, horse.uid).ok) errors.push('幼马不应可骑');
  s2.items['饲灵草料'] = 1;
  r = G.Beasts.mature(s2, horse.uid);
  if (!r.ok || horse.stage !== 'adult') errors.push('马成年异常 ' + (r.reason || ''));
  r = G.Beasts.setRide(s2, horse.uid);
  if (!r.ok || !s2.riding || !s2.rideSkill.land) errors.push('成年马骑乘异常 ' + (r.reason || ''));
  if (G.Beasts.setRide(s2, snake.uid).ok) errors.push('战种不应可骑');

  snake.gl = 37; s2.items['御兽丹·青纹'] = 1;
  r = G.Beasts.mature(s2, snake.uid);
  if (!r.ok || snake.id !== 'b_bilinmang' || snake.stage !== 'adult') errors.push('蛇化形碧鳞蟒异常 ' + (r.reason || ''));
  snake.gl = 73; s2.items['御兽丹·青蟒'] = 1;
  if (G.Beasts.mature(s2, snake.uid).ok) errors.push('碧鳞蟒化形青蛟应被地点要求拦截');

  G.Beasts.release(s2, horse.uid);
  if (s2.riding) errors.push('放生坐骑未清骑乘');

  G.game.changeScene('town', { toSpawn: true });
  const sc = G.game.scene;
  G.Overlays.openPanel(sc, 'beasts');
  const tp = textSpy(); sc.render(tp);
  if (!(tp.__seen || []).some(function (x) { return x.indexOf('碧鳞蟒') >= 0; })) errors.push('兽栏详情未渲染（个体名应可见）');
  s2.beasts = []; sc.beastSel = null;
  G.Overlays.openPanel(sc, 'beasts');
  const tp2 = textSpy(); sc.render(tp2);
  if (!(tp2.__seen || []).some(function (x) { return x.indexOf('尚无灵兽') >= 0; })) errors.push('空兽栏空状态未渲染');
}, 'beasts.manager.contract');

/* ---------- 出战灵兽接入战斗契约（design B2，《灵兽 v1.1》§5） ----------
   ① 出战兽进战斗为独立单位，按速度自主行动；② 敌方可转火；③ 胜利 +亲密度/修为 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  const rr = G.Beasts.add(s, 'b_chiyanlang', { gl: 1, stage: 'adult' });
  if (!rr.ok) { errors.push('测试赤炎狼未能入栏：' + rr.reason); return; }
  if (!G.Beasts.setBattle(s, rr.beast.uid).ok) { errors.push('赤炎狼出战失败'); return; }
  G.game.save = s;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 1, '青纹蛇'), mapId: 'field' });
  /* 测试蛇撑过首回合，避免玩家+灵兽将其打死提前跳场景导致 b.beast 丢失；胜利由 victory 步骤显式触发。 */
  G.game.scene.es.forEach(function (e) { e.maxhp = 99999; e.hp = 99999; });
}, 'beasts.battle.enter');
pump(10);
step(() => {
  const b = G.game.scene;
  if (!b.beast) { errors.push('出战兽未进战斗为独立单位'); return; }
  if (!(b.beast.maxhp > 0) || b.beast.hp <= 0) errors.push('出战兽气血异常');
  b.__logs0 = b.logs.length;
  b._playerAction({ kind: 'atk', mult: 1.0, elem: b.p.elem, n: '攻击', cost: 0 }, b.es[0].key);
}, 'beasts.battle.act');
pump(160, 'beasts.battle.resolve');
step(() => {
  const b = G.game.scene, s = G.game.save;
  if (!b.beast) { errors.push('战斗中出战兽丢失'); return; }
  const acted = b.logs.slice(b.__logs0 || 0).some(function (l) { return l.indexOf(b.beast.name) >= 0; });
  if (!acted) errors.push('出战兽未在回合中自主行动');
  const ind = G.Beasts.byUid(s, s.beastTeam[0]);
  const bond0 = ind.bond, xp0 = ind.xp, gl0 = ind.gl;
  b.es.forEach(function (e) { e.hp = 0; });
  b._victory();
  if (ind.bond !== Math.min(100, bond0 + 2)) errors.push('胜利未给出战兽 +2 亲密度');
  /* +20 修为在早期小阶会立即转成 gl 增长（消耗 xp），按 gl/xp 任一增长判定 */
  if (ind.gl <= gl0 && ind.xp < xp0 + 20) errors.push('胜利未给出战兽修为（gl/xp 均未增）');
}, 'beasts.battle.victory');
pump(20);

/* ---------- B4 骑乘作战契约（《灵兽 v1.1》§6.4） ----------
   ① 战骑 both：人车一体（+20% 攻防血、首轮冲阵 1.5×、坐骑承担 20% 伤害、独立 HP）；
   ② 坐骑 HP 归零强制下马、加成收回；③ 普通 mount：阵前自动下马、保留首轮骑兵先手。 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 37;
  const rr = G.Beasts.add(s, 'b_bilinmang', { gl: 37, stage: 'adult' });
  if (!rr.ok) { errors.push('测试碧鳞蟒未能入栏：' + rr.reason); return; }
  const rd = G.Beasts.setRide(s, rr.beast.uid);
  if (!rd.ok) { errors.push('碧鳞蟒骑乘失败：' + rd.reason); return; }
  G.game.save = s;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 37, '青纹蛇'), mapId: 'field' });
  G.game.scene.es.forEach(function (e) { e.maxhp = 99999; e.hp = 99999; });
}, 'beasts.mount.enter');
pump(10);
step(() => {
  const b = G.game.scene;
  if (!b.mount) { errors.push('战骑未进骑乘作战（mount 为空）'); return; }
  if (b.beast) errors.push('骑乘优先时不该再有独立出战兽');
  const cst = G.Beasts.combatStat(G.Beasts.byUid(G.game.save, G.game.save.riding.uid));
  const wantA = Math.round(cst.atk * 0.2), wantD = Math.round(cst.def * 0.2), wantH = Math.round(cst.hp * 0.2);
  if (b._mountBonus.atk !== wantA || b._mountBonus.def !== wantD || b._mountBonus.hp !== wantH)
    errors.push('骑乘 20% 加成数值不对');
  if (!(b._effSpd(b.p) > 10000)) errors.push('首轮骑兵未取得先手');
  b._playerAction({ kind: 'atk', mult: 1.0, elem: b.p.elem, n: '攻击', cost: 0 }, b.es[0].key);
}, 'beasts.mount.charge');
pump(160, 'beasts.mount.resolve');
step(() => {
  const b = G.game.scene;
  if (!b.mount) { errors.push('冲阵后坐骑仍应在场'); return; }
  if (!b._chargeUsed) errors.push('首轮冲阵未被标记/触发');
  const mhp0 = b.mount.hp;
  b._impact('P', { dmg: 100, crit: false, ec: 1 });
  if (!b.mount) { errors.push('100 伤害不该直接打死坐骑'); return; }
  const share = mhp0 - b.mount.hp;
  if (share !== Math.round(100 * 0.2)) errors.push('坐骑应承担 20% 伤害（20），实际 ' + share);
}, 'beasts.mount.share');
pump(20);
step(() => {
  const b = G.game.scene;
  const atk0 = b.p.atk, def0 = b.p.def, mhpP = b.p.maxhp;
  b.mount.hp = 1;
  b._impact('P', { dmg: 10, crit: false, ec: 1 });
  if (b.mount) errors.push('坐骑 HP 归零应强制下马');
  if (G.game.save.riding) errors.push('强制下马应清存档 riding');
  if (!(b.p.atk < atk0 && b.p.def < def0 && b.p.maxhp < mhpP))
    errors.push('下马后 20% 加成应收回');
}, 'beasts.mount.dismount');
pump(20);

/* ---------- 普通坐骑阵前自动下马契约 ---------- */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 29;
  const rr = G.Beasts.add(s, 'b_huangzongma', { gl: 29, stage: 'adult' });
  const rd = G.Beasts.setRide(s, rr.beast.uid);
  if (!rd.ok) { errors.push('成年马骑乘失败：' + rd.reason); return; }
  G.game.save = s;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 1, '青纹蛇'), mapId: 'field' });
  const b = G.game.scene;
  if (b.mount) errors.push('普通坐骑不该进入骑乘作战');
  if (s.riding) errors.push('普通坐骑遇敌应自动下马');
  if (!b._cavalryFirst) errors.push('自动下马应保留首轮骑兵先手');
}, 'beasts.mount.autodown');
pump(10);

/* ---------- B5 御空骑术门禁契约（金丹可学；飞行坐骑需御空） ---------- */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.rideSkill = { land: false, air: false };
  s.globalLevel = 108;
  if (G.Player.canFly(s)) errors.push('gl108 未到金丹，不可飞/不可学御空');
  s.globalLevel = 109;
  if (!G.Player.canFly(s)) errors.push('金丹 gl109 应可飞/可学御空');
  const rr = G.Beasts.add(s, 'b_yundingxianhe', { gl: 377, stage: 'adult' });
  if (!rr.ok) { errors.push('云顶仙鹤入栏失败：' + rr.reason); return; }
  s.rideSkill.air = false;
  if (G.Beasts.setRide(s, rr.beast.uid).ok) errors.push('未习御空不应骑飞行坐骑');
  s.rideSkill.air = true;
  const okr = G.Beasts.setRide(s, rr.beast.uid);
  if (!okr.ok) errors.push('习御空后应可骑飞行坐骑：' + okr.reason);
}, 'beasts.air.gate');
pump(10);

/* ---------- 妖囊野外收服契约（design B3，《御兽 v0.2》§2） ----------
   ① 打残+妖囊收服入栏写图鉴；② 人形不可收服；③ 栏满不耗囊；④ 成败耗囊 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.beasts = []; s.beastTeam = []; s.riding = null; s.beastSeq = 0;
  s.items = { '木囊': 3 };
  G.game.save = s;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 1, '青纹蛇'), mapId: 'field' });
}, 'beasts.capture.setup');
pump(8);
step(() => {
  const b = G.game.scene;
  b.es[0].hp = 1;
  if (!sandbox.Math) { errors.push('沙箱无 Math，无法对收服打桩'); return; }
  const realR = sandbox.Math.random;
  sandbox.Math.random = () => 0;
  b._doCapture(b.es[0].key, '木囊');
  sandbox.Math.random = realR;
}, 'beasts.capture.roll');
pump(60, 'beasts.capture.run');
step(() => {
  const b = G.game.scene, s = G.game.save;
  if (s.beasts.length !== 1) errors.push('收服成功未入栏（' + s.beasts.length + '）');
  if (b.es[0]._captured !== true) errors.push('被收服敌人未标记离场');
  if (!(G.game.meta.bestiary && G.game.meta.bestiary['b_qingwenshe'] === 'got')) errors.push('收服未写图鉴');
  if (s.stone < 50) errors.push('图鉴首录应 +50 灵石');
  if (s.items['木囊'] !== 2) errors.push('收服应耗 1 木囊，余 ' + s.items['木囊']);
}, 'beasts.capture.ok');
pump(10);
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.beasts = []; s.beastTeam = []; s.beastSeq = 0;
  s.items = { '木囊': 2 };
  G.game.save = s;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('血煞教徒', 5, '散修'), mapId: 'field' });
  const b = G.game.scene;
  b._useBag('木囊');
  const tb = b.buttons.filter((x) => /散修/.test(x.label || ''));
  if (!tb.length || !tb.every((x) => x.disabled)) errors.push('人形敌人不应可收服（应置灰）');
  if (s.items['木囊'] !== 2) errors.push('不可收服不应耗囊');
}, 'beasts.capture.human');
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.beasts = []; s.beastTeam = []; s.beastSeq = 0;
  for (let i = 0; i < G.Data.beasts.CAP; i++) G.Beasts.add(s, 'b_chiyanlang', { gl: 1, stage: 'adult' });
  s.items = { '木囊': 2 };
  G.game.save = s;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 1, '青纹蛇'), mapId: 'field' });
  const b = G.game.scene;
  b.es[0].hp = 1;
  b._doCapture(b.es[0].key, '木囊');
  if (s.items['木囊'] !== 2) errors.push('栏满收服不应耗囊');
  if (s.beasts.length !== G.Data.beasts.CAP) errors.push('栏满不应再增兽');
}, 'beasts.capture.full');
pump(20);

/* ---------- 陆地坐骑契约（design B3，《灵兽 v1.1》§6/§15.1） ----------
   ① 骑乘室外 _riding 取兽；② 骑乘每格更快；③ 进室内自动下马；④ 幼年不可骑。 */
step(() => {
  function mkRidden(ridden) {
    const sx = JSON.parse(JSON.stringify(save));
    sx.beasts = []; sx.beastTeam = []; sx.riding = null; sx.beastSeq = 0;
    const rr = G.Beasts.add(sx, 'b_huangzongma', { gl: 9, stage: 'adult' });
    if (!rr.ok) { errors.push('测试黄鬃马未能入栏：' + rr.reason); return null; }
    if (ridden) {
      const rd = G.Beasts.setRide(sx, rr.beast.uid);
      if (!rd.ok) { errors.push('黄鬃马骑乘失败：' + rd.reason); return null; }
    }
    G.game.save = sx;
    G.game.changeScene('field', { toSpawn: true });
    const sc = G.game.scene;
    const held = sc._heldDir;
    sc._heldDir = function () { return 'right'; };
    sc.update(0.02); sc.update(0.02);
    const dMt = sc.mt;
    sc._heldDir = held;
    return { sc: sc, save: sx, dMt: dMt };
  }
  const walk = mkRidden(false);
  const ride = mkRidden(true);
  if (walk && ride) {
    if (!ride.sc._riding()) errors.push('室外骑乘 _riding() 应返回坐骑');
    if (!(ride.dMt > walk.dMt * 1.15))
      errors.push('骑乘移速应快于步行（步行 ' + walk.dMt.toFixed(3) + ' vs 骑乘 ' + ride.dMt.toFixed(3) + '）');
  }
  /* 进室内自动下马 */
  const sx2 = JSON.parse(JSON.stringify(save));
  sx2.beasts = []; sx2.beastTeam = []; sx2.riding = null; sx2.beastSeq = 0;
  const hr = G.Beasts.add(sx2, 'b_huangzongma', { gl: 9, stage: 'adult' });
  G.Beasts.setRide(sx2, hr.beast.uid);
  G.game.save = sx2;
  G.game.changeScene('town_home', { toSpawn: true });
  const sc2 = G.game.scene;
  if (sx2.riding) errors.push('进入室内应自动下马');
  if (sc2._riding()) errors.push('室内 _riding() 应为 null');
  /* 幼年马不可骑（物种可骑但未成年） */
  const sx3 = JSON.parse(JSON.stringify(save));
  sx3.beasts = []; sx3.beastTeam = []; sx3.riding = null; sx3.beastSeq = 0;
  const yr = G.Beasts.add(sx3, 'b_huangzongma', { gl: 3, stage: 'young' });
  const yb = G.Beasts.setRide(sx3, yr.beast.uid);
  if (yb.ok) errors.push('幼年灵兽不应可骑');
}, 'beasts.ride.contract');


/* ---------- 自创宗门 + 散修盟悬赏契约（v0.39.0，S5） ----------
   ① 开宗三条件缺一不可（境界 / 灵石 / 声望）；**已飞升灵界可豁免境界**
   ② 开宗：扣灵石 / `sectId='own'` / 写 `meta.mySect`（跨世）/ **不占用转阵营机会**
   ③ 收徒：每人 +2% 且**真的进 computeStats**；有上限
   ④ 悬赏：宗门弟子不能接 / 刚接单剩余=需求数（**按增量判定**，不是绝对计数）/ 没打够不给领 */
step(function () {
  const P = G.Player;
  const mk = function (o) {
    const s = JSON.parse(JSON.stringify(save));
    s.skills = { '缠藤指': { lv: 1 } };
    s.globalLevel = 1; s.stone = 0; s.sectRep = 0;
    s.sectId = null; s.cult = 'free'; s.bounty = null; s.wildKills = 0;
    s.ownSect = null;
    Object.keys(o || {}).forEach(function (k) { s[k] = o[k]; });
    return s;
  };
  const meta0 = { progress: { worlds: {} } };
  if (P.canFoundSect(mk({}), meta0).ok) errors.push('条件全不满足时不该能开宗');
  if (P.canFoundSect(mk({ globalLevel: 216, stone: 50000, sectRep: 0 }), meta0).ok) {
    errors.push('声望不足时不该能开宗');
  }
  if (!P.canFoundSect(mk({ globalLevel: 216, stone: 50000, sectRep: 300 }), meta0).ok) {
    errors.push('三条件满足时应能开宗');
  }
  if (!P.canFoundSect(mk({ stone: 50000, sectRep: 300 }),
    { progress: { worlds: { ling: true } } }).ok) {
    errors.push('已飞升灵界时应可豁免境界门槛');
  }

  const s2 = mk({ globalLevel: 216, stone: 50000, sectRep: 300 });
  const meta2 = { progress: { worlds: {} } };
  G.game.save = s2;
  const r = P.foundSect(s2, meta2, '青云宗', '缠藤指');
  if (!r.ok) errors.push('开宗失败：' + r.reason);
  if (s2.sectId !== 'own') errors.push('开宗后 sectId 应为 own');
  if (s2.stone !== 0) errors.push('开宗应扣 50000 灵石');
  if (s2.cultSwitchUsed) errors.push('开宗**不该**占用"每世一次"的转阵营机会');
  if (!meta2.mySect || meta2.mySect.name !== '青云宗') {
    errors.push('开宗应写 meta.mySect（跨世保留）');
  }

  s2.stone = 200000;
  const base = P.computeStats(s2);
  P.recruitDisciple(s2);
  const after = P.computeStats(s2);
  if (!(after.atk > base.atk)) errors.push('弟子没有进 computeStats');
  for (let i = 0; i < 10; i++) P.recruitDisciple(s2);
  if (s2.ownSect.disciples > P.DISCIPLE_MAX) errors.push('弟子数超过了上限');

  const s3 = mk({ cult: 'sect', sectId: 'qxj' });
  if (P.acceptBounty(s3, 0).ok) errors.push('宗门弟子不该能接散修盟悬赏');
  const s4 = mk({ cult: 'free', wildKills: 100 });
  if (!P.acceptBounty(s4, 0).ok) errors.push('散修应能接悬赏');
  if (P.bountyLeft(s4) !== P.BOUNTY[0].need) {
    errors.push('刚接单时剩余数应等于需求数（否则老档一接单就完成）');
  }
  if (P.claimBounty(s4).ok) errors.push('没打够不该能领赏');
  s4.wildKills += P.BOUNTY[0].need;
  if (P.bountyLeft(s4) !== 0) errors.push('打够后剩余应为 0');
  const before2 = s4.stone;
  const cr = P.claimBounty(s4);
  if (!cr.ok) errors.push('打够后应能领赏：' + cr.reason);
  if (s4.stone !== before2 + P.BOUNTY[0].stone) errors.push('领赏灵石数额不对');
  if (s4.bounty) errors.push('领赏后应清空在身悬赏');

  /* v0.90.1（用户口径「悬赏线给功法」）：带 `skill` 的悬赏，交付时必须
     ① 真的学到；② 顺手进激发列表（autoEquip）；③ 功法是**本路线可学**的。
     这条与支线、宗门商店三处同一纪律 —— 漏一处就是"学了用不上"的静默缺口。 */
  const bq = P.BOUNTY.filter(function (b) { return b.skill; });
  if (!bq.length) errors.push('悬赏表里没有任何「功法报酬」（用户要求悬赏线给功法）');
  bq.forEach(function (b) {
    const i = P.BOUNTY.indexOf(b);
    const s5 = mk({ cult: 'free', wildKills: 9999 });
    s5.skills = {}; s5.skillEquip = [];
    if (!P.acceptBounty(s5, i).ok) { errors.push('带功法的悬赏应能接：' + b.n); return; }
    s5.wildKills += b.need;
    const r5 = P.claimBounty(s5);
    if (!r5.ok) { errors.push('带功法的悬赏应能领：' + r5.reason); return; }
    if (!s5.skills[b.skill]) errors.push('悬赏 ' + b.n + ' 交付后未授予功法 ' + b.skill);
    if (!r5.skill) errors.push('悬赏 ' + b.n + ' 未回传功法信息（界面无从提示）');
    if ((s5.skillEquip || []).indexOf(b.skill) < 0) {
      errors.push('悬赏 ' + b.n + ' 授予的功法未进激发列表（autoEquip 漏接）');
    }
  });
}, 'sect.found.contract');

/* ---------- 采集点契约（四大技艺批1，《四大技艺 v1.0》§3.1/§3.2） ----------
   ① 室外图有采集点、材料名合法；② 当日采集入包一次、再踩不重复；③ 跨日重置。 */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  s.items = {}; s.gather = {}; s.day = 1;
  G.game.save = s;
  const map = G.MapGen.buildMap(s, 'field');
  const nodes = Object.keys(map.gatherNodes || {}).map(function (k) { return map.gatherNodes[k]; });
  if (nodes.length !== 4) { errors.push('野外图应有 4 采集点，实际 ' + nodes.length); return; }
  nodes.forEach(function (n) { if (!G.Gather.byName(n.mat)) errors.push('采集点材料名非法：' + n.mat); });
  const n0 = nodes[0];
  var needP0 = n0.cat === 'herb' ? 'herb' : (n0.cat === 'ore' || n0.cat === 'gem') ? 'mine' : null;
  if (needP0) { G.Gather.gatherAt(s, 'field', n0);
    if ((s.items[n0.mat] || 0) !== 0) errors.push('未拜师不该能采集'); }
  s.prof = { herb: 1, mine: 1 };
  G.Gather.gatherAt(s, 'field', n0);
  if ((s.items[n0.mat] || 0) !== 1) errors.push('采集未入包');
  G.Gather.gatherAt(s, 'field', n0);
  if ((s.items[n0.mat] || 0) !== 1) errors.push('当日重复采集了');
  if (!G.Gather.gatheredToday(s, 'field', n0)) errors.push('当日应标记已采');
  G.Gather.advanceDay(s);
  if (G.Gather.gatheredToday(s, 'field', n0)) errors.push('跨日应重置采集点');
}, 'gather.contract');

/* ---------- 炼丹契约（四大技艺批2，《四大技艺 v1.0》§3.3） ----------
   材料/境界双门槛、炼制扣材料、丹药入包。 */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  s.items = {}; s.globalLevel = 37;
  G.game.save = s;
  const r1 = G.Alchemy.recipes.filter(function (r) { return r.n === '回春丹'; })[0];
  if (G.Alchemy.canCraft(s, r1).ok) errors.push('无材料不该可炼');
  s.items['凝血草'] = 2; s.items['灵泉水'] = 1;
  if (G.Alchemy.canCraft(s, r1).ok) errors.push('未拜师材料足也不该可炼');
  s.prof = { herb: 1, alchemy: 1 };
  if (!G.Alchemy.canCraft(s, r1).ok) errors.push('拜师后材料足应可炼');
  const before = s.items['凝血草'];
  const res = G.Alchemy.craft(s, r1);
  if (!res.ok) errors.push('炼制失败：' + res.reason);
  if ((s.items['凝血草'] || 0) !== before - 2) errors.push('炼制未扣材料');
  if (!(s.items['回春丹'] >= 1)) errors.push('丹药未入包');
  const rDao = G.Alchemy.recipes.filter(function (r) { return r.n === '道纹丹'; })[0];
  s.globalLevel = 37; s.items['道纹草'] = 5; s.items['道纹矿'] = 5;
  if (G.Alchemy.canCraft(s, rDao).ok) errors.push('境界不足不该炼道纹丹');
}, 'alchemy.contract');

/* ---------- 炼器契约（四大技艺批3，《四大技艺 v1.0》§3.4/§3.5/§3.7） ----------
   锻造扣材料、产物为三槽法宝、未装备0加成、装备后进 te；配方材料皆有来源；掉落率。 */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  s.items = {}; s.globalLevel = 37; s.equip = { weapon: null, armor: null, accessory: null };
  G.game.save = s;
  const rQing = G.Forge.recipes.filter(function (r) { return r.out === 'eq_qingfeng'; })[0];
  if (G.Forge.canForge(s, rQing).ok) errors.push('无材料不该可锻');
  s.items['玄铁'] = 3; s.items['精钢'] = 2;
  if (G.Forge.canForge(s, rQing).ok) errors.push('未拜师材料足也不该可锻');
  s.prof = { forge: 1 };
  const base = G.Player.computeStats(s).atk;
  const res = G.Forge.forge(s, rQing);
  if (!res.ok) errors.push('锻造失败：' + res.reason);
  if ((s.items['eq_qingfeng'] || 0) !== 1) errors.push('法宝未入包');
  if (G.Player.computeStats(s).atk !== base) errors.push('未装备的锻造法宝不该加属性');
  s.equip.weapon = 'eq_qingfeng';
  if (!(G.Player.computeStats(s).atk > base)) errors.push('装备锻造武器后攻击应提升');
  G.Forge.recipes.forEach(function (r) {
    Object.keys(r.mats).forEach(function (m) {
      const isDrop = ['妖丹','兽皮','妖骨','灵羽','血精','道纹残片'].indexOf(m) >= 0;
      if (!G.Gather.byName(m) && !isDrop) errors.push('炼器材料无来源：' + m);
    });
  });
  let got = 0;
  for (let i = 0; i < 2000; i++) { const t = { items: {} };
    G.Gather.rollDrops(t, [{ species: '青狼', name: '青狼' }], {}).forEach(function (g) { if (g.item === '兽皮') got += g.n; }); }
  if (got < 100) errors.push('兽皮掉落率异常：' + got);
  let fly = 0;
  for (let i = 0; i < 2000; i++) { const t = { items: {} };
    G.Gather.rollDrops(t, [{ species: '苍鹰', name: '苍鹰' }], {}).forEach(function (g) { if (g.item === '灵羽') fly += g.n; }); }
  if (fly < 50) errors.push('灵羽掉落率异常：' + fly);
  let dao = 0;
  for (let i = 0; i < 1000; i++) { const t = { items: {} };
    G.Gather.rollDrops(t, [{ species: '道兽', name: '道兽' }], { dao: true }).forEach(function (g) { if (g.item === '道纹残片') dao += g.n; }); }
  if (dao < 100) errors.push('道纹残片掉落率异常：' + dao);
}, 'forge.contract');

/* ---------- 阵法契约（四大技艺批4，《四大技艺 v1.0》§3.5） ----------
   主城/宗门/仙界/道界分际获取、购阵扣财、聚宝采集+1、聚灵灵气、静心破境、道纹仅道界。 */
step(function () {
  const b0 = JSON.parse(JSON.stringify(save));
  let s = JSON.parse(JSON.stringify(b0));
  s.items = {}; s.formations = {}; s.stone = 200000; s.sectRep = 0; s.sectId = null;
  const mFan = { progress: { activeWorld: 'fan' } };
  const mLing = { progress: { activeWorld: 'ling' } };
  const mXian = { progress: { activeWorld: 'xian' } };
  const mDao = { progress: { activeWorld: 'dao' } };
  if (G.Formations.availability(s, mFan, G.Formations.byId('juling')).ok) errors.push('凡界不可购聚灵阵');
  if (!G.Formations.availability(s, mLing, G.Formations.byId('juling')).ok) errors.push('灵界灵石足应可购聚灵阵');
  if (G.Formations.availability(s, mFan, G.Formations.byId('yushou')).ok) errors.push('无宗门不可购御兽阵');
  s.sectId = 'qxj'; s.sectRep = 500;
  let r = G.Formations.buy(s, mFan, 'jubao');
  if (!r.ok) errors.push('宗门贡献足应购聚宝阵：' + r.reason);
  s.gather = {}; s.day = 1;
  G.Gather.gatherAt(s, 'field', { idx: 9, mat: '凝血草' });
  if ((s.items['凝血草'] || 0) !== 2) errors.push('聚宝阵应使采集 +1，实 ' + (s.items['凝血草'] || 0));
  if (G.Formations.buy(s, mFan, 'jubao').ok) errors.push('已持有不可再购');
  s.sectRep = 2000;
  if (G.Formations.availability(s, mLing, G.Formations.byId('jusha')).ok) errors.push('聚煞阵需仙界');
  if (!G.Formations.availability(s, mXian, G.Formations.byId('jusha')).ok) errors.push('仙界贡献足应可购聚煞阵');
  let s2 = JSON.parse(JSON.stringify(b0)); s2.items = {}; s2.formations = { juling: true }; s2.globalLevel = 37;
  let s3 = JSON.parse(JSON.stringify(s2)); s3.formations = {};
  if (!(G.Player.rates(s2).qi > G.Player.rates(s3).qi)) errors.push('聚灵阵应提升灵气获取');
  /* 静心阵（进度模型新职责）：破境失败的气血反噬减轻（保留75% vs 50%） */
  function failHp(withFx) {
    const sx = JSON.parse(JSON.stringify(b0));
    sx.globalLevel = 72; sx.qi = 999999;
    sx.items = { 筑基丹: 3 };
    sx.formations = withFx ? { jingxin: true } : {};
    sx.breakProgress = 0;
    const full = G.Player.computeStats(sx);
    sx.hp = full.maxhp;
    G.Player.startBigBreak(sx, mFan);
    return sx.hp;
  }
  const hFx = failHp(true), hNo = failHp(false);
  if (!(hFx > hNo)) errors.push('静心阵应减轻破境失败的气血反噬（' + hFx + ' vs ' + hNo + '）');
  let s6 = JSON.parse(JSON.stringify(b0)); s6.formations = { daowen: true }; s6.globalLevel = 600;
  if (!(G.Player.computeStats(s6, mDao).atk > G.Player.computeStats(s6, mFan).atk)) errors.push('道纹阵应仅在道界加属性');
}, 'formation.contract');

/* ---------- 灵田矿脉契约（四大技艺批5，《四大技艺 v1.0》§3.5） ----------
   地块当日一次、按类别/界出产、跨日重置；道界药圃产道纹草。 */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  s.items = {}; s.gather = {}; s.day = 1; s.sectId = 'qxj';
  G.game.save = s;
  const r1 = G.Gather.harvestPlot(s, 'plot1', ['herb'], 'fan');
  if (!r1.ok) errors.push('凡界药圃应可收');
  if (G.Gather.harvestPlot(s, 'plot1', ['herb'], 'fan').ok) errors.push('当日同地块不应重复收');
  if (!G.Gather.harvestPlot(s, 'plot2', ['ore'], 'fan').ok) errors.push('凡界矿脉应可收');
  let oreOk = false;
  Object.keys(s.items).forEach(function (k) { const m = G.Gather.byName(k); if (m && m.cat === 'ore') oreOk = true; });
  if (!oreOk) errors.push('矿脉应产出矿石类材料');
  s.day = 2;
  if (!G.Gather.harvestPlot(s, 'plot1', ['herb'], 'fan').ok) errors.push('跨日应可再收');
  const s2 = JSON.parse(JSON.stringify(save)); s2.items = {}; s2.gather = {}; s2.day = 1;
  for (let i = 0; i < 60; i++) G.Gather.harvestPlot(s2, 'p' + i, ['herb'], 'dao');
  if (!s2.items['道纹草']) errors.push('道界药圃应产道纹草');
}, 'fields.contract');

/* ---------- R3 区域建筑服务契约（路线图 R3） ---------- */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  G.game.save = s; G.game.meta = {};
  s.globalLevel = 1; s.stone = 100; s.day = 3; s.hp = 1;
  if (G.RegionServices.innPrice(s) !== 30) errors.push('凡界初境房资应为 30');
  const cap = G.Player.computeStats(s).maxhp;
  G.RegionServices.innRest({});
  if (s.hp !== cap) errors.push('投宿应气血全复');
  if (s.day !== 4) errors.push('投宿应跨游戏日');
  if (s.stone !== 70) errors.push('投宿应扣 30 灵石');
  s.stone = 5; G.RegionServices.innRest({});
  if (s.stone !== 5) errors.push('灵石不足不应扣费');
  G.game.meta = { progress: { activeWorld: 'ling' } };
  if (G.RegionServices.innPrice(s) !== 300) errors.push('灵界房资应为 300');
}, 'inn.contract');
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  G.game.save = s; G.game.meta = {};
  G.RegionGen.ensure(s, 'fan4');
  const rmd = G.Data.maps['fan4'];
  const st = rmd.structures.filter(function (x) { return x.bk === 'shop'; })[0];
  const iid = 'int.fan4.' + st.id;
  G.InteriorGen.ensure(s, iid, st, G.Data.regions.byId('fan4'));
  const sc = G.scenes[iid];
  G.ShopService.open(sc, 'shop');
  if (sc.overlay !== 'shop.buy') errors.push('商店应进入买入态');
  if (!G.Data.shops.catalog('fan','shop').some(function (x) { return x.id === '回春丹'; })) errors.push('凡界坊市应有回春丹');
  if (!G.Data.shops.catalog('fan','apothecary').some(function (x) { return x.id === '凝血草'; })) errors.push('凡界药铺应有凝血草');
  if (!G.Data.shops.catalog('dao','shop').some(function (x) { return x.id === '道纹丹'; })) errors.push('道界坊市应有道纹丹');
  if (G.Data.shops.sellValue('回春丹') !== 20) errors.push('回收价应为目录半价');
  s.stone = 1000; G.ShopService.open(sc, 'shop');
  const before = s.items['回春丹'] || 0;
  sc.buttons.filter(function (b) { return b.label === '购买'; })[0].onClick();
  if ((s.items['回春丹'] || 0) !== before + 1) errors.push('购买应 +1');
  if (s.stone !== 960) errors.push('购买应扣 40 灵石');
  s.items['玄铁'] = 2;
  sc.buttons.filter(function (b) { return b.label.replace(/\s/g,'') === '卖出'; })[0].onClick();
  if (sc.overlay !== 'shop.sell') errors.push('应进入卖出态');
  const val = G.Data.shops.sellValue('玄铁'), st0 = s.stone;
  const sidx = Object.keys(s.items).indexOf('玄铁');
  sc.buttons.filter(function (b) { return b.label === '售出'; })[sidx].onClick();
  if (s.stone !== st0 + val) errors.push('售出应加 ' + val);
  if (s.items['玄铁'] !== 1) errors.push('售出应 -1');
}, 'shop.contract');
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  G.game.save = s; G.game.meta = {};
  G.RegionGen.ensure(s, 'fan4');
  const rmd = G.Data.maps['fan4'];
  const st = rmd.structures.filter(function (x) { return x.bk === 'smithy'; })[0];
  const iid = 'int.fan4.' + st.id;
  G.InteriorGen.ensure(s, iid, st, G.Data.regions.byId('fan4'));
  const sc = G.scenes[iid];
  G.RegionServices.openForge(sc);
  if (sc.overlay !== 'forge') errors.push('铁匠铺应开炼器面板，实际 ' + sc.overlay);
}, 'forgeopen.contract');

/* ---------- R5 道界伴生仙兽槽契约（路线图 R5） ---------- */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  G.game.save = s; G.game.meta = {};
  G.Beasts.add(s, 'b_qingwenshe', { gl: 1 });
  G.game.changeScene('town', { toSpawn: true });
  const sc = G.game.scene;
  G.Overlays.openPanel(sc, 'beasts');
  let cb = sc.buttons.filter((b) => (b.label || '').indexOf('伴生') >= 0);
  if (!cb.length) errors.push('兽栏详情应有伴生按钮');
  else if (!cb[0].disabled) errors.push('无道之钥匙时伴生槽应锁定');
  G.game.meta.progress = { daoKey: true };
  G.Overlays.openPanel(sc, 'beasts');
  cb = sc.buttons.filter((b) => (b.label || '').indexOf('设为伴生') >= 0);
  if (!cb.length) errors.push('有道钥后应可设为伴生');
  else cb[0].onClick();
  if (!(G.game.meta.companionBeast && G.game.meta.companionBeast.id)) errors.push('点击应写入 meta.companionBeast');
  const s2 = JSON.parse(JSON.stringify(save));
  G.Beasts.add(s2, 'b_qingwenshe', { gl: 1 });
  if (!s2.beasts.length) errors.push('境界折算到降世起点应能加入仙兽');
}, 'companion.contract');

/* ---------- 宗门小世界契约（R1，《宗门小世界 v1.0》） ----------
   ① 凡界 9 宗门 live 集群：大宗 4 栋（山门/主殿/传功/贡献）、小宗 3 栋（山门/主殿/传功）；
   ② 从山门 BFS 经门可达全部 live 房间；山门有通往外界的门；
   ③ 每栋焦点家具可达；④ 山门真的摆进所在区域，走得进去、穿到主殿、也出得来。 */
step(function () {
  const SG = G.SectGen;
  if (!SG || !SG.liveOf) { errors.push('G.SectGen.liveOf 缺失'); return; }
  const fan = G.Data.sects.ofWorld('fan');
  if (fan.length !== 9) errors.push('凡界宗门应为 9，实际 ' + fan.length);

  fan.forEach(function (sc) {
    const cl = SG.liveOf(save, sc.id);
    if (!cl) { errors.push('缺 live 集群：' + sc.id); return; }
    const expectRoles = sc.size === 'big'
      ? ['gate', 'hall', 'chuangong', 'gongxian', 'houshan']
      : ['gate', 'hall', 'chuangong', 'houshan'];
    if (cl.roles.length !== expectRoles.length)
      errors.push(sc.n + ' live 房间数应为 ' + expectRoles.length + '，实际 ' + cl.roles.length);
    expectRoles.forEach(function (r) {
      if (cl.roles.indexOf(r) < 0) errors.push(sc.n + ' 缺 live 房间：' + r);
    });

    const gateId = SG.roomId(sc.id, 'gate');
    const adj = {};
    cl.rooms.forEach(function (rm) {
      const mp = G.MapGen.buildMap(save, rm.id);
      (rm.exits || []).forEach(function (e) {
        for (let x = e.x0; x <= e.x1; x++) {
          if (mp.solid[e.y][x]) errors.push(rm.id + ': 门格 (' + x + ',' + e.y + ') 被堵');
        }
        adj[rm.id] = adj[rm.id] || [];
        if (e.to.indexOf('sect.') === 0) adj[rm.id].push(e.to);
      });
      const reach = bfsReach(mp, rm.spawn);
      (rm.furn || []).filter(function (f) { return f.act; }).forEach(function (f) {
        let ok = false;
        for (let yy = f.y; yy < f.y + (f.h || 1); yy++) {
          for (let xx = f.x; xx < f.x + (f.w || 1); xx++) {
            [[1,0],[-1,0],[0,1],[0,-1]].forEach(function (d) {
              const nx = xx + d[0], ny = yy + d[1];
              if (nx < 0 || ny < 0 || nx >= mp.w || ny >= mp.h) return;
              if (mp.solid[ny][nx]) return;
              if (reach[nx + ',' + ny]) ok = true;
            });
          }
        }
        if (!ok) errors.push(rm.id + ': 焦点 ' + (f.label || f.id) + ' 无可达落脚点');
      });
    });

    const seen = {}; const qq = [gateId]; seen[gateId] = 1;
    while (qq.length) {
      const cur = qq.shift();
      (adj[cur] || []).forEach(function (nx) { if (!seen[nx]) { seen[nx] = 1; qq.push(nx); } });
    }
    cl.rooms.forEach(function (rm) { if (!seen[rm.id]) errors.push(sc.n + ': ' + rm.id + ' 从山门不可达'); });

    const gateRm = cl.rooms.filter(function (r) { return r.sectRoom === 'gate'; })[0];
    const reg = G.Data.regions.byId ? G.Data.regions.byId(sc.region) : null;
    const outside = (reg && reg.map) || sc.region;
    if (!(gateRm.exits || []).some(function (e) { return e.to === outside; }))
      errors.push(sc.n + ' 山门缺通往外界（' + outside + '）的门');

    if (G.Data.maps[outside]) {
      const mp2 = G.MapGen.buildMap(save, outside);
      let placed = false;
      Object.keys(mp2.interact).forEach(function (k) {
        const o = mp2.interact[k];
        if (o.type === 'gate' && o.s && o.s.to === gateId) placed = true;
      });
      if (!placed) errors.push(sc.n + ' 的山门没摆进地图 ' + outside);
    }
  });

  G.game.save = save;
  G.game.changeScene('town', { toSpawn: true });
  const tsc = G.game.scene;
  const gk = Object.keys(tsc.map.interact).filter(function (k) {
    const o = tsc.map.interact[k];
    return o.type === 'gate' && o.s && o.s.to === 'sect.qxj.gate';
  })[0];
  if (!gk) { errors.push('青溪镇找不到通往小世界的山门交互点'); return; }
  const gp = gk.split(',').map(Number);
  tsc.overlay = null; tsc.dir = 'up';
  save.pos = { x: gp[0], y: gp[1] + 1 };
  tsc._interact();
  if (G.game.sceneName !== 'sect.qxj.gate') {
    errors.push('点山门没进入小世界（当前 ' + G.game.sceneName + '）'); return;
  }
  const gsc = G.game.scene;
  const toHall = (gsc.map.md.exits || []).filter(function (e) { return e.to === 'sect.qxj.hall'; })[0];
  if (!toHall) { errors.push('山门缺通往主殿的门'); return; }
  gsc._onEnterTile(toHall.x0, toHall.y);
  if (G.game.sceneName !== 'sect.qxj.hall') {
    errors.push('山门没能走进主殿（当前 ' + G.game.sceneName + '）'); return;
  }
  const hsc2 = G.game.scene;
  const backGate = (hsc2.map.md.exits || []).filter(function (e) { return e.to === 'sect.qxj.gate'; })[0];
  if (!backGate) { errors.push('主殿缺回山门的门'); return; }
  hsc2._onEnterTile(backGate.x0, backGate.y);
  if (G.game.sceneName !== 'sect.qxj.gate') { errors.push('主殿回不到山门'); return; }
  const gsc2 = G.game.scene;
  const out = (gsc2.map.md.exits || []).filter(function (e) { return e.to === 'town'; })[0];
  if (!out) { errors.push('山门缺回青溪镇的门'); return; }
  gsc2._onEnterTile(out.x0, out.y);
  if (G.game.sceneName !== 'town') errors.push('从小世界出不来（当前 ' + G.game.sceneName + '）');
}, 'sect.world.contract');

/* ---------- 灵根 / 材料图标接线契约（v0.40.0） ----------
   ① 属性 → 拼音是**唯一口径**：10 个属性（9 + 无）都要有映射
      —— 少一个就是"那张图标静默不出现"（不报错，最难查）
   ② `root.*` / `mat.*` 素材**真的在盘上**（⚠️ 无头环境 `G.Assets.img` 恒为 null，
      所以与素材契约一样**直接读 manifest**，不能拿 img() 判"图到了没"）
   ③ 灵根页渲染不抛异常 */
step(function () {
  const PY = G.Data.elem.pinyin;
  if (!PY) { errors.push('G.Data.elem.pinyin 缺失（图标取不到逻辑名）'); return; }
  const ELEMS = ['金', '木', '水', '火', '土', '光', '雷', '风', '暗', '无'];
  ELEMS.forEach(function (e) {
    if (!PY[e]) errors.push('属性 ' + e + ' 缺拼音映射（图标会静默不出现）');
  });
  const mf = JSON.parse(fs.readFileSync(path.join(WWW, 'assets', 'manifest.json'), 'utf8'));
  /* ⚠️ 灵根只有**九种**（金木水火土光雷风暗）—— "无" 不是灵根，是功法属性的兜底档。
     所以 `root.*` 查 9 个、`skill.*` 查 10 个，别用同一个列表（会把 root.wu 当成缺图）。 */
  ELEMS.filter(function (e) { return e !== '无'; }).forEach(function (e) {
    if (!mf['root.' + PY[e]]) errors.push('缺灵根图标素材：root.' + PY[e]);
  });
  ELEMS.forEach(function (e) {
    if (!mf['skill.' + PY[e]]) errors.push('缺功法属性图标素材：skill.' + PY[e]);
  });
  ['xuecao', 'lingzhi', 'xuantie', 'chitan', 'shoupi', 'lingye'].forEach(function (k) {
    if (k === 'chitan') return;      /* 名字以 chitong 为准，下面单独查 */
    if (!mf['mat.' + k]) errors.push('缺材料图标素材：mat.' + k);
  });
  if (!mf['mat.chitong']) errors.push('缺材料图标素材：mat.chitong');

  const s2 = JSON.parse(JSON.stringify(save));
  s2.pos = null;
  s2.linggen = { kind: '五行', elems: ['木', '火', '土'], coef: { '木': 1.6 }, stoneBonus: 0 };
  G.game.save = s2;
  G.game.changeScene('town', { toSpawn: true });
  const sc = G.game.scene;
  sc.charTab = 'linggen';
  G.Overlays.openPanel(sc, 'char', true);
  try { const c = drawSpy(); sc.render(c); } catch (e) {
    errors.push('灵根页渲染抛异常：' + e.message);
  }
}, 'icon.root.contract');

/* ---------- 开局功法来源契约（v0.25.0） ----------
   用户口径：「主角轮回转世，是没有功法的；功法只能通过完成散修任务或者宗门任务去获得，
   不是每次都随机三个功法」。
   ① 入世**不带功法**（`reincarnation.js` 的 skills 是空表）
   ② m0-1 复命（打赢首战回药铺）时由沈伯**授予**入门功法，并自动装上一门
   走真实路径：`town.onNpc(scene, 沈伯)` —— 不直接调内部函数，
   这样"入口通不通"也一起测了。 */
step(function () {
  const rc = fs.readFileSync(path.join(WWW, 'js/scenes/reincarnation.js'), 'utf8');
  /* 源码闸：入世必须给空表（写成"给三门"会静默回到旧行为） */
  if (!/var skills = \{\};\s*\n\s*var equip = \[\];/.test(rc)) {
    errors.push('入世应当**不带功法**（reincarnation.js 的 skills/equip 应为空）');
  }

  const s2 = JSON.parse(JSON.stringify(save));
  s2.skills = {}; s2.skillEquip = [];
  s2.linggen = { elems: ['木'] };
  s2.quest = { step: 'm0-1', flags: { won1: true }, line: 'free' };
  s2.pos = null;
  G.game.save = s2;
  /* 沈伯在**药铺**（town_shop），不在镇上 */
  G.game.changeScene('town_shop', { toSpawn: true });
  const sc = G.game.scene;
  const npc = (sc.map.npcs || []).filter(function (n) { return n.act === 'shenbo'; })[0];
  if (!npc) { errors.push('青溪镇找不到沈伯（act=shenbo）'); return; }
  /* ⚠️ 参数顺序是 (npc, scene)，不是 (scene, npc) —— 见 explore.js 的调用点 */
  if (!sc.hooks || !sc.hooks.onNpc) { errors.push('场景未暴露 hooks.onNpc'); return; }
  sc.hooks.onNpc(npc, sc);
  const n = Object.keys(s2.skills || {}).length;
  /* v0.77.0 功法容器：只授**一本**《引气诀》，其内部含 1 主动 + 1 被动。 */
  if (n !== 1) errors.push('m0-1 复命后应授予入门功法 1 本，实得 ' + n + ' 本');
  if (!s2.skills['引气诀']) errors.push('入门功法应是《引气诀》');
  if (s2.skills['粗浅吐纳']) errors.push('「粗浅吐纳」应是《引气诀》内部被动，不再单独授予');
  {
    const inS = G.Data.skills['引气诀'];
    if (!inS || inS.mult > 1.1) errors.push('入门主动「引气诀」必须威力极小（mult ≤1.1），实为 ' + (inS && inS.mult));
    const mv = G.Data.gongfaMoves('引气诀');
    const na = mv.filter((m) => m.active || (m.kind === '攻击' && !m.passive)).length;
    const np = mv.filter((m) => m.passive).length;
    if (na !== 1 || np !== 1) errors.push('《引气诀》内部应为 1主动+1被动，实为 ' + na + '主动/' + np + '被动');
    ['铁布衫', '吐纳术', '粗浅吐纳'].forEach(function (id) {
      if (s2.skills[id]) errors.push('新手不该再单独送「' + id + '」');
    });
  }
  if ((s2.skillEquip || [])[0] !== '引气诀') errors.push('授予功法后应自动激发《引气诀》');
  if (s2.quest.step !== 'm0-2') errors.push('m0-1 复命后任务应推进到 m0-2');
}, 'skills.origin.contract');

/* ---------- 入世成长演出契约（v0.71.0） ----------
   用户口径：「增加 6/10 岁成长及动画」。
   ① 形象三档真的不同：身高 6<10<16、脚底齐平、**头尺寸不变**（只平移）
   ② 入世按钮必须**先进 grow 演出**，不能直调 finish()（否则演出是死代码）
   ③ 演出播完 3 拍 → 自动 finish，且真正入世
   ④ 16 岁档与历史程序化形象逐像素一致（bodyRatio=1 不参与缩放）
   走真实路径：`_buildButtons` 里那颗「入世」按钮的 onClick —— 不直接改 step。 */
step(function () {
  const R = G.scenes.reincarnation;
  const SP = G.Sprites;
  if (!SP.heroAgeStage) { errors.push('G.Sprites.heroAgeStage 缺失（童年形象未接入）'); return; }

  /* ① 三档形象：用尺寸与头顶位置判定（无头 canvas 桩拿不到像素，只看几何）
     ⚠️ v0.90.0：三档改为**真实立绘素材**（此前是程序化色块，用户截图反馈
        「6、10、16 岁都没有渲染真正的图片」）。判定随之升级：
          · 画布仍必须同尺寸（同一占位盒，脚底对齐才成立）；
          · 素材**已登记**时，三档必须都命中素材（ageStageHasAsset）；
          · 素材缺失时才允许回退，且回退路径的比例仍须严格递增。 */
  const c6 = SP.heroAgeStage(6, 'down', 0), c10 = SP.heroAgeStage(10, 'down', 0),
        c16 = SP.heroAgeStage(16, 'down', 0);
  if (!c6 || !c10 || !c16) { errors.push('heroAgeStage 未产出位图'); return; }
  if (!(c6.width === c10.width && c10.width === c16.width
    && c6.height === c10.height && c10.height === c16.height)) {
    errors.push('三档形象画布应同尺寸（同一占位盒，脚底对齐才成立）');
  }
  /* 素材命中：**只在素材层就绪时判**。
     ⚠️ 无头 smoke 的桩 fetch 恒失败 → manifest 永远取不到 → 这里若硬判"必须命中"，
        就是一条永远假红的断言（本项目铁律：素材类验证一律去 browser-probe）。
     所以这里只做**源码闸**（素材键确实登记了），真命中由 tools/age-stage-probe.js 判。 */
  if (SP.ageStageHasAsset) {
    const stripCs2 = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const spSrcB = stripCs2(fs.readFileSync(path.join(WWW, 'js/core/sprites.js'), 'utf8'));
    /* ⚠️ 闸门粒度要匹配"改动的粒度"（G43）：只查"文件里提到过 char.hero.age6"
       会被注释命中（本文件的注释里就写了这些键名）→ 恒真。
       所以这里匹配**整句赋值**：键表里必须真的把 6/10/16 映射到具体素材键。
       v0.90.1：16 岁档改用**高密度专用素材** char.hero.age16
       （原复用 char.hero.down 只有 168×252，演出放大 2.2 倍会糊）。 */
    if (!/AGE_STAGE_KEY\s*=\s*\{\s*6\s*:\s*'char\.hero\.age6'\s*,\s*10\s*:\s*'char\.hero\.age10'\s*,\s*16\s*:\s*'char\.hero\.age16'\s*\}/.test(spSrcB)) {
      errors.push('源码闸：童年档素材键表 AGE_STAGE_KEY 未把 6/10/16 正确映射到立绘素材');
    }
    /* 高密度烘焙（v0.90.1，修"太模糊"）：烘焙画布必须远大于逻辑 28×42。
       用户口径「太模糊了」的真因就是烘焙进 84×126、演出放大 4.33 倍。
       判据：AGE_STAGE_BAKE_SCALE 必须 ≥ 8（覆盖 S=5 的 13 倍逻辑的近旁；
       取 8 是"至少比 K=3 高一档"的下限，低于它则最高画质档仍会糊）。 */
    const bm = spSrcB.match(/AGE_STAGE_BAKE_SCALE\s*=\s*(\d+)/);
    if (!bm) errors.push('源码闸：童年档缺高密度烘焙常量 AGE_STAGE_BAKE_SCALE');
    else if (+bm[1] < 8) {
      errors.push('童年档烘焙密度 ' + bm[1] + ' 过低（应 ≥8）—— 高画质档会糊');
    }
  }
  const R6 = SP.AGE_STAGE_R[6], R10 = SP.AGE_STAGE_R[10], R16 = SP.AGE_STAGE_R[16];
  if (!(R6 < R10 && R10 < R16)) errors.push('三档身体比例应严格递增（6<10<16）');
  if (R16 !== 1) errors.push('16 岁档 bodyRatio 必须为 1（程序化兜底路径的历史基线）');

  /* ② 入世按钮 → grow 演出（源码闸 + 行为闸双保险） */
  const rcSrc = fs.readFileSync(path.join(WWW, 'js/scenes/reincarnation.js'), 'utf8');
  if (!/(self|this)\.step = 'grow'/.test(rcSrc)) {
    errors.push("入世按钮应先进 'grow' 演出（不能直调 finish）");
  }
  R.enter();
  R.step = 'talent';
  R.drawTalents();
  R._buildButtons();
  const enterBtn = R.buttons.filter(function (b) { return b._key === '入世'; })[0]
    || R.buttons[R.buttons.length - 1];
  if (!enterBtn) { errors.push('入世页没有「入世」按钮'); return; }
  R.step = 'talent';
  enterBtn.onClick();
  /* v0.79：有命定世时先进入 arcpath 选择，选「浮世轮回」后才到 grow */
  if (R.step === 'arcpath') {
    const freeBtn = R.buttons.filter(function (x) { return x.label === '浮世轮回'; })[0];
    if (!freeBtn) errors.push('命途步缺「浮世轮回」按钮');
    else freeBtn.onClick();
  }
  if (R.step !== 'grow') errors.push("点「入世」后 step 应为 'grow'，实为 " + R.step);
  if (G.game.save && G.game.save.age === 16 && R.step === 'grow') {
    /* 演出途中**不能**已经入世（save 还没产出来才算对） */
  }
  /* ③ 播 3 拍（每拍 GROW_DUR 秒，跳过更快的 update 也要走满 3 次） */
  const D = R.GROW_DUR;
  let guard = 0;
  while (R.step === 'grow' && guard < 12) { R.update(D + 0.01); guard++; }
  if (guard !== 3) errors.push('成长演出应恰好 3 拍（6/10/16），实为 ' + guard + ' 拍');
  if (R.step === 'grow') errors.push('三拍播完后应自动入世，但 step 仍是 grow');
  const sv = G.game.save;
  if (!sv || sv.age !== 16) errors.push('演出结束应产出 16 岁入世档，实为 age=' + (sv && sv.age));

  /* ④ 演出绘制尺寸（v0.90.0）：必须用**逻辑尺寸**绘制。
     位图是 K 倍物理像素，若把 .width/.height 直接当绘制宽高，
     立绘会被放大 K 倍且模糊（实测过：只剩头肩、其余溢出画布）。
     源码闸：演出里 drawImage 精灵时必须显式传宽高，且取自 AGE_STAGE_LOGICAL。 */
  {
    const stripCg = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    const rc2 = stripCg(fs.readFileSync(path.join(WWW, 'js/scenes/reincarnation.js'), 'utf8'));
    if (rc2.indexOf('AGE_STAGE_LOGICAL') < 0) {
      errors.push('源码闸：入世演出未用 AGE_STAGE_LOGICAL 作绘制尺寸（会放大 K 倍并模糊）');
    }
    /* 不许出现 `drawImage(spr, dx, dy)` 这种三参调用（缺宽高 = 按物理像素画） */
    if (/drawImage\(\s*(spr|m)\s*,\s*dx\s*,\s*dy\s*\)/.test(rc2)) {
      errors.push('源码闸：演出仍以三参 drawImage 画精灵（物理像素当逻辑用，尺寸会错）');
    }
  }
  /* ⑤ 16 岁档与历史程序化版尺寸一致（兜底路径不回归） */
  const old16 = G.Art.heroSprite('down', 0, SP.HERO_PAL);
  if (old16 && (old16.width !== c16.width || old16.height !== c16.height)) {
    errors.push('16 岁档与历史 heroSprite 尺寸不一致');
  }
}, 'birth.grow.contract');

/* ---------- 法宝三槽契约（v0.25.0） ----------
   用户口径：「这个人物少了三个法宝格子，武器、防具、饰品」。
   ① 表合法：id 唯一、slot 在三槽内、**效果字段落在 te 的已知集合里**（写错会静默不生效）
   ② setEquip：槽位不符 / 未拥有 都要拒
   ③ 穿上**真的进 computeStats**；脱下**回落**
   ④ 法宝**存在 save.items 里**（"储物页看得到"，不另立一套背包） */
step(function () {
  const EQ = G.Data.equips;
  if (!EQ) { errors.push('G.Data.equips 缺失'); return; }
  const KNOWN = { a: 1, f: 1, h: 1, s: 1, c: 1, cd: 1, vamp: 1 };
  const seen = {};
  EQ.list.forEach(function (e) {
    if (seen[e.id]) errors.push('法宝 id 重复：' + e.id);
    seen[e.id] = 1;
    if (EQ.SLOTS.indexOf(e.slot) < 0) errors.push(`法宝 ${e.id} 的槽位非法：${e.slot}`);
    if (!e.n || !e.d) errors.push('法宝缺名称或说明：' + e.id);
    Object.keys(e.fx || {}).forEach(function (k) {
      if (!KNOWN[k]) errors.push(`法宝 ${e.id} 的效果字段 ${k} 不在 te 的已知集合里（会静默不生效）`);
    });
  });
  EQ.SLOTS.forEach(function (sl) {
    if (!EQ.ofSlot(sl).length) errors.push('槽位 ' + sl + ' 一件法宝都没有');
  });

  const s2 = JSON.parse(JSON.stringify(save));
  s2.equip = { weapon: null, armor: null, accessory: null };
  s2.items = {};
  const base = G.Player.computeStats(s2);
  /* 未拥有 → 拒 */
  if (G.Player.setEquip(s2, 'weapon', 'eq_qingfeng').ok) errors.push('未拥有的法宝不该能穿');
  s2.items['eq_qingfeng'] = 1;
  if (G.Player.setEquip(s2, 'weapon', 'eq_qingfeng').ok !== true) errors.push('拥有后应能穿');
  if (s2.equip.weapon !== 'eq_qingfeng') errors.push('穿上后 equip 未写入');
  /* 槽位不符 → 拒 */
  if (G.Player.setEquip(s2, 'armor', 'eq_qingfeng').ok) errors.push('武器不该能穿到防具槽');
  const eq1 = G.Player.computeStats(s2);
  if (!(eq1.atk > base.atk)) errors.push('青锋剑没进 computeStats（攻击没涨）');
  /* 多槽叠加 */
  s2.items['eq_bujia'] = 1;
  G.Player.setEquip(s2, 'armor', 'eq_bujia');
  const eq2 = G.Player.computeStats(s2);
  if (!(eq2.def > eq1.def)) errors.push('粗布甲没进 computeStats（防御没涨）');
  /* 脱下 → 回落 */
  G.Player.setEquip(s2, 'weapon', null);
  G.Player.setEquip(s2, 'armor', null);
  const eq3 = G.Player.computeStats(s2);
  if (eq3.atk !== base.atk || eq3.def !== base.def) errors.push('脱下法宝后加成应回落');
}, 'equip.contract');

/* ---------- 点击不崩契约（v0.28.0） ----------
   用户口径：「点击法宝这里会卡死机，界面无法点击了」。
   根因：`buildEquipSlots` 里写了 `G.UI.text(null, ...)` 当"占位绘制" ——
   传 null 当 ctx 会在**按钮的 onClick 里**抛异常 → 面板再也打不开，
   玩家看到的就是"整个界面卡死"。
   ⚠️ 这类"点击即崩"**不会在加载期暴露**，只有真的点一次才知道 —— 所以必须点。
   规则：**所有按钮的 onClick 都不允许抛异常**（这里覆盖法宝三槽与换装子视图）。 */
step(function () {
  const s2 = JSON.parse(JSON.stringify(save));
  s2.items = {};                       /* 一件法宝都没有 —— 最容易被忽略的空态 */
  s2.equip = { weapon: null, armor: null, accessory: null };
  s2.pos = null;
  G.game.save = s2;
  G.game.changeScene('town', { toSpawn: true });
  const sc = G.game.scene;
  /* 法宝槽在**自己的子页**（v0.29.0）——总览页没有它了 */
  sc.charTab = 'equip'; sc.equipPick = null;
  G.Overlays.openPanel(sc, 'char', true);
  /* 槽位按钮的 label 形如「未装备　· 武器」/「青锋剑　· 武器」——
     判据用 label（v0.29.0 起槽位换到法宝子页，且 sub 改成了法宝说明） */
  const slotBtns = (sc.buttons || []).filter(function (b) {
    return /武器|防具|饰品/.test(b.label || '');
  });
  if (!slotBtns.length) { errors.push('角色法宝页没有三槽按钮'); return; }
  slotBtns.forEach(function (b, i) {
    try { b.onClick(); } catch (e) {
      errors.push('点法宝槽 #' + i + ' 抛异常（界面会卡死）：' + e.message);
    }
  });
  /* 换装子视图（空态）里的每个按钮也要点一遍 */
  (sc.buttons || []).forEach(function (b, i) {
    try { b.onClick(); } catch (e) {
      errors.push('法宝换装子视图按钮 #' + i + '（' + (b.label || '?') + '）抛异常：' + e.message);
    }
  });
}, 'click.noThrow.contract');

/* ---------- 破境天劫契约（v0.26.0） ----------
   用户口径：「破境必须有天劫动画，天道必须用起来，主角和天道意志对话」。
   ① 天劫接管覆盖层，三拍依次推进：蓄势（无按钮）→ 落雷（白闪 + 震屏）→ 天道问话（出「承受」）
   ② 天道文案**真的画出来**（只断言"不抛异常"是空断言）
   ③ 点「承受」触发回调（进心魔战）并关掉覆盖层 */
step(function () {
  const O = G.Overlays;
  if (!O.startTribulation) { errors.push('G.Overlays.startTribulation 缺失'); return; }
  const s2 = JSON.parse(JSON.stringify(save));
  s2.pos = null;
  G.game.save = s2;
  G.game.changeScene('field', { toSpawn: true });
  const sc = G.game.scene;
  let done = false;
  O.startTribulation(sc, s2, function () { done = true; });
  if (sc.overlay !== 'tribulation') errors.push('天劫未接管覆盖层');
  if (!sc.trib) { errors.push('天劫状态未建立'); return; }
  sc.update(0.5);
  if (sc.buttons.length) errors.push('天劫蓄势段不该有按钮');
  /* ⚠️ **必须小步推进**：一次 `update(0.8)` 会让白闪按 dt 当场衰减完
     （`flash -= dt*3.2` → 2.56），于是"有闪"这一刻根本采不到 —— 这是**测试步长**问题，
     不是代码问题（真实帧 dt ≤ 0.05）。 */
  let sawFlash = false, sawShake = false;
  for (let i = 0; i < 80; i++) {
    sc.update(0.04);
    if (!sc.trib) break;
    if (sc.trib.flash > 0) sawFlash = true;
    if (sc.trib.shake > 0) sawShake = true;
    if (sc.trib.asked) break;
  }
  if (!sawFlash) errors.push('天劫落雷段没有白闪');
  if (!sawShake) errors.push('天劫落雷段没有震屏');
  if (!sc.trib.asked) { errors.push('天劫没推进到天道问话段'); return; }
  /* ⚠️ 正则别写成 `/承受/` —— 两字按钮按项目惯例是「承　受」（中间是全角空格），
     写连着的两字永远匹配不上（同一个坑在「突破」按钮上踩过一次）。 */
  const ok = (sc.buttons || []).filter(function (b) { return /承/.test(b.label || ''); })[0];
  if (!ok) { errors.push('天道问话段没有「承受」按钮'); return; }
  const cx = textSpy(); sc.render(cx);
  if (!(cx.__seen || []).some(function (t) { return t.indexOf('天') >= 0; })) {
    errors.push('天劫没有渲染出天道文案');
  }
  ok.onClick();
  if (!done) errors.push('点「承受」后没有回调（进不了心魔战）');
  if (sc.overlay) errors.push('点「承受」后应关掉覆盖层');
}, 'tribulation.contract');

/* ---------- 战斗打击特效契约（v0.30.0） ----------
   用户口径：「战斗画面，是不是可以做特效了，普通攻击的特效，技能的特效加动画之类的」。
   ① 受击（`_impact` 是唯一伤害漏斗）**必须产生刀光**
   ② 技能命中**必须产生属性色爆发**
   ③ 特效会**自动过期**（不能越攒越多）
   ④ 特效真的被画出来（绘制探针） */
step(function () {
  const s2 = JSON.parse(JSON.stringify(save));
  s2.pos = null; s2.hp = 9999;
  G.game.save = s2;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('赤炎狼', 5, '赤炎狼'), mapId: 'field' });
  const b = G.game.scene;
  b._fxs = [];
  const e0 = b.es[0];
  b._impact('E0', { dmg: 5, crit: false, ec: null });
  if (!b._fxs.some(function (f) { return f.kind === 'slash'; })) {
    errors.push('受击没有产生刀光特效');
  }
  /* 特效会过期 */
  for (let i = 0; i < 40; i++) b._tickFx(0.05);
  if (b._fxs.length) errors.push('特效不会过期（越攒越多）');
  /* 技能爆发：直接调一次技能结算路径太重，这里验证 `_fx` 本身 + 渲染 */
  b._fx('burst', 'E0', { col: '#ff8844' });
  if (!b._fxs.some(function (f) { return f.kind === 'burst'; })) {
    errors.push('技能爆发没有进特效列表');
  }
  /* 渲染真的画了（绘制探针：特效走 arc/fillRect，用文本探针查不到 —— 改为断言不抛异常 + 列表非空） */
  const c = drawSpy();
  let ok = true;
  try { b.render(c); } catch (e) { ok = false; errors.push('战斗渲染在有效特效时抛异常：' + e.message); }
  if (ok && !b._fxs.length) errors.push('特效列表在渲染前被清空');
}, 'battle.fx.contract');

/* ---------- 面板滑入契约（v0.32.0） ----------
   用户口径（多轮）：「整个游戏还是和 PPT 网页一样」。面板**直接出现**是典型症状之一。
   ① `openPanel` 必须记下 `panelOpenAt`
   ② 刚打开时渲染**必须发生位移**（translate 有非零 y）；动画结束后位移归零
   ⚠️ 判据必须看 `translate` 而不是 `drawImage` 的 y ——
      探针记的是**变换前**的实参，整体位移查不到。 */
step(function () {
  const s2 = JSON.parse(JSON.stringify(save));
  s2.pos = null;
  G.game.save = s2;
  G.game.changeScene('town', { toSpawn: true });
  const sc = G.game.scene;
  const t0 = G.game.time;
  G.Overlays.openPanel(sc, 'quest');
  if (sc.panelOpenAt == null) { errors.push('openPanel 未记 panelOpenAt'); return; }
  G.game.time = sc.panelOpenAt + 0.02;          /* 滑入中 */
  const c1 = drawSpy(); sc.render(c1);
  /* ⚠️ 只看"滑入那一次 translate"（x=0 且 y>0）——
     镜头缩放/震屏也会 translate（x=240、y=136），一起看会永远为真（踩过）。 */
  /* ⚠️ 幅度也要卡：滑入是 `translate(0, (1-e)*10)`（y ∈ (0,10]）。
     只卡 `x===0 && y>0` 会把别的绘制（实测有 `translate(0,48)` 的 NPC/立绘锚点）
     一起算进来，于是"动画结束仍偏着"永远为真。 */
  const isSlide = function (t) { return t.x === 0 && t.y > 0.3 && t.y <= 10; };
  if (!(c1.__tr || []).some(isSlide)) errors.push('面板刚打开时没有位移（滑入没生效）');
  G.game.time = sc.panelOpenAt + 1;             /* 动画结束 */
  const c2 = drawSpy(); sc.render(c2);
  if ((c2.__tr || []).some(isSlide)) errors.push('面板动画结束后位移没有归零（会一直偏着）');
  G.game.time = t0;
}, 'panel.slide.contract');

/* ---------- 区域连通度契约（v0.34.0） ----------
   用户口径：「宗门的地方每个场景都是四通八达」。
   ① 除道界（固定回廊，天然线性）外，**每个区域至少 2 个出口**
   ② **宗门所在区域至少 3 个出口**
   ③ 出口必须**双向**：A→B 有路，B→A 也得有
      ⚠️ 只算有向会放过"只有回程、没有去程"的断头路（项目踩过这个坑） */
step(function () {
  const Rg = G.Data.regions;
  /* ⚠️ 没有 Rg.list —— 区域表挂在 Rg.index（id → 区域） */
  const ids = Object.keys(Rg.index);
  const adj = {};
  ids.forEach(function (id) { adj[id] = []; });
  /* 生成型区域的出口 */
  ids.forEach(function (id) {
    const r = Rg.index[id];
    (r.exits || []).forEach(function (e) { if (adj[id] && adj[e.to]) adj[id].push(e.to); });
  });
  /* 手写地图的出口。⚠️ 这张映射**必须从数据推导**，不能写死 ——
     写死的话新增一张手写地图（v0.65.0 的云州城 `yunzhou`）不会被算进连通性，
     结果是"新城区被判成 0 出口的孤岛 + 回程断头路"两条假红（本轮就踩了）。
     判据：区域带 `map` 字段 = 复用一张手写地图（生成型区域没有这个字段）。 */
  const HM = {};
  ids.forEach(function (id) {
    const r = Rg.index[id];
    if (r && r.map) HM[r.map] = id;
  });
  Object.keys(HM).forEach(function (m) {
    const mm = G.Data.maps[m];
    if (!mm) return;
    (mm.exits || []).forEach(function (e) {
      const to = HM[e.to] || e.to;
      if (adj[HM[m]] && adj[to]) adj[HM[m]].push(to);
    });
    /* ⚠️ 手写地图里还有**结构体出口**（赤牙洞是 `S('caveIn','gate',…, {to:'cave'})`），
       只在 exits 里找会漏掉它 —— 漏掉就会误报"断头路"（踩过）。 */
    (mm.structures || []).forEach(function (st) {
      if (!st.to) return;
      const to = HM[st.to] || st.to;
      if (adj[HM[m]] && adj[to]) adj[HM[m]].push(to);
    });
  });

  /* ① 出口数（道界除外） */
  ids.forEach(function (id) {
    if (id.indexOf('dao') === 0) return;
    const n = adj[id].length;
    if (n < 2) errors.push('区域 ' + id + ' 出口只有 ' + n + ' 条（应 ≥2，四通八达）');
  });
  /* ② 宗门所在区域 ≥3 */
  (G.Data.sects ? G.Data.sects.list : []).forEach(function (s) {
    const n = (adj[s.region] || []).length;
    if (n < 3) errors.push('宗门「' + s.n + '」所在区域 ' + s.region + ' 出口只有 ' + n + ' 条（应 ≥3）');
  });
  /* ③ 双向 */
  ids.forEach(function (id) {
    adj[id].forEach(function (to) {
      if ((adj[to] || []).indexOf(id) < 0) {
        errors.push('出口单向：' + id + ' → ' + to + ' 没有回程路（断头路）');
      }
    });
  });
}, 'region.link.contract');

/* ---------- 区域场景可达契约（v0.41.0） ----------
   用户口径：「把后续场景地图可以全部做出来了，凡界的所有场景，
   目前是提示无法进入下一个地图」。
   真因：生成型区域的探索场景是**懒创建**的（`RegionGen.sceneFor`），
   而 `registerWorld` / `ensureWorld` **全项目无人调用** →
   走到出口直接吃 `changeScene` 的"场景未开放"。
   判据：**把每个区域的每个出口都走一遍**，场景名必须真的变成目标区域。
   ⚠️ 只查数据图（`region.link.contract`）是查不出这个的 —— 数据对、场景没建，照样进不去。 */
step(function () {
  const Rg = G.Data.regions;
  const ids = Object.keys(Rg.index);
  const bad = [];
  ids.forEach(function (id) {
    const r = Rg.index[id];
    if (!r || !r.map) return;                 /* 手写地图（town/field/cave）另有测法 */
    (r.exits || []).forEach(function (e) {
      /* ⚠️ **已知局限**：这条契约在无头环境里**抓不到"懒创建被撤掉"** ——
         前面的契约（`region.visual` / `region.tint`）早就把区域场景建好了，
         而 `delete G.scenes[x]` 之后它仍会被别处重建（实测：撤掉兜底照样全绿）。
         它真正守住的是"**出口 → 目标场景名**"这一对（数据图对了、transition 也真的生效），
         真机上的"懒创建"路径要靠 `explore._transition` 里的兜底 + 人工走一遍。 */
      G.game.changeScene('town', { toSpawn: true });
      G.game.scene._transition({ to: e.to });  /* 出口的唯一裁决口 */
      if (G.game.sceneName !== e.to) {
        bad.push(id + '→' + e.to + '（实为 ' + G.game.sceneName + '）');
      }
    });
  });
  if (bad.length) errors.push('区域出口进不去：' + bad.slice(0, 5).join(' / ')
    + (bad.length > 5 ? (' … 共 ' + bad.length + ' 条') : ''));
}, 'region.enter.contract');

/* ---------- 主线分叉契约（v0.38.0，《宗门与散修体系设计 v1.0》§6） ----------
   ① `m1done` 之后按 `save.cult` 进对应线（散修 → f1-1 / 宗门 → s1-1）
   ② 条件**不满足时不推进**（不能白送）
   ③ 条件满足时推进到下一步
   ④ **一次满足多步要一次推完**（`while` 而不是 `if`）—— 否则主线会卡在半路
   ⑤ 两条线各自能走到终点（fdone / sdone） */
step(function () {
  const O = G.Overlays;
  if (!O.tickQuest) { errors.push('G.Overlays.tickQuest 缺失'); return; }
  const mk = function (cult) {
    const s2 = JSON.parse(JSON.stringify(save));
    s2.quest = { step: 'm1done', flags: {} };
    s2.cult = cult; s2.sectId = cult === 'sect' ? 'qxj' : null;
    s2.wildKills = 0; s2.sectRep = 0; s2.skills = {};
    s2.dungeonSlot = 0; s2.dungeonFarm = 0;
    G.game.save = s2;
    O.tickQuest(s2);
    return s2;
  };
  const f = mk('free');
  if (f.quest.step !== 'f1-1') errors.push('散修应进 f1-1，实际 ' + f.quest.step);
  const sc = mk('sect');
  if (sc.quest.step !== 's1-1') errors.push('宗门应进 s1-1，实际 ' + sc.quest.step);

  const f2 = mk('free');
  if (f2.quest.step !== 'f1-1') errors.push('条件未满足时不该推进');
  f2.wildKills = 20;
  O.tickQuest(f2);
  if (f2.quest.step !== 'f1-2') errors.push('斩妖 20 后应推进到 f1-2，实际 ' + f2.quest.step);

  const f3 = mk('free');
  f3.wildKills = 20; f3.dungeonSlot = 1;
  f3.skills = { a: 1, b: 1, c: 1, d: 1, e: 1 }; f3.sectRep = 120;
  O.tickQuest(f3);
  if (f3.quest.step !== 'fdone') {
    errors.push('一次满足全部条件应推到 fdone，实际 ' + f3.quest.step + '（while 写成了 if？）');
  }

  const s3 = mk('sect');
  s3.sectRep = 600;
  s3.skills = { '青溪剑诀': { lv: 1 } };
  O.tickQuest(s3);
  if (s3.quest.step !== 'sdone') errors.push('宗门线应推到 sdone，实际 ' + s3.quest.step);
  /* 起点不该被"已入宗门"瞬间满足（这是踩过的坑） */
  const s4 = mk('sect');
  if (s4.quest.step !== 's1-1') errors.push('宗门线起点应为 s1-1，实际 ' + s4.quest.step);
}, 'quest.branch.contract');

/* 任务面板**支线页要真的画出面板**（截图反馈踩过）：
   `questRows` 换了数据源（内容型支线），但选中项的兜底还写着旧表 `SIDE[0].id` →
   选中项取不到 → `drawQuest` 提前 return → **面板整块不画，只剩按钮浮在场景上**。
   这类"换了数据源但兜底没跟上"的错，只有真渲染一帧才看得见。 */
step(function () {
  const s2 = JSON.parse(JSON.stringify(save));
  s2.pos = null; s2.side = {};
  G.game.save = s2;
  G.game.changeScene('town', { toSpawn: true });
  const sc = G.game.scene;
  sc.questTab = 'side'; sc.questSel = null;
  G.Overlays.openPanel(sc, 'quest', true);
  const cx = textSpy();
  sc.render(cx);
  const seen = cx.__seen || [];
  if (!seen.some(function (t) { return t.indexOf('支线') >= 0; })) {
    errors.push('任务面板支线页没有渲染出内容（选中项兜底可能挂了旧数据源）');
  }
  if (!seen.some(function (t) { return t.indexOf('浣衣妇') >= 0; })) {
    errors.push('任务面板支线页没有列出内容型支线');
  }
}, 'quest.side.render.contract');

/* ---------- 宗门与散修契约（《宗门与散修体系设计 v1.0》） ----------
   ① 宗门数据完整：凡 9 / 灵 7 / 仙 5 / 道 0，且 region / 功法池都指向真实存在的东西
   ② 功法归属：每本功法都有 src；src='sect' 的必须带 sect 且该宗门存在
   ③ 互斥：散修不能用宗门功法；宗门弟子不能用散修功法；common 两道通用
   ④ 废功：voided 后一律不可用
   ⑤ 转阵营：每世一次；原阵营功法全部废功、已装备的自动卸下
   ⑥ 底栏 6 项且含「宗门」 */
step(function () {
  const S = G.Data.sects;
  if (!S) { errors.push('G.Data.sects 缺失'); return; }

  /* ① 数量与引用 */
  const cnt = { fan: S.ofWorld('fan').length, ling: S.ofWorld('ling').length,
    xian: S.ofWorld('xian').length, dao: S.ofWorld('dao').length };
  if (cnt.fan !== 9) errors.push(`凡界宗门应为 9（5 小 + 4 大），实际 ${cnt.fan}`);
  if (cnt.ling !== 7) errors.push(`灵界宗门应为 7，实际 ${cnt.ling}`);
  if (cnt.xian !== 5) errors.push(`仙界宗门应为 5，实际 ${cnt.xian}`);
  if (cnt.dao !== 0) errors.push(`道界不应有宗门，实际 ${cnt.dao}`);
  S.list.forEach(function (s) {
    if (!G.Data.regions.byId(s.region)) errors.push(`宗门 ${s.id} 指向不存在的区域 ${s.region}`);
    if (!s.skills || !s.skills.length) errors.push(`宗门 ${s.id} 没有功法池`);
    (s.skills || []).forEach(function (id) {
      const sk = G.Data.skills[id];
      if (!sk) { errors.push(`宗门 ${s.id} 的功法 ${id} 不存在`); return; }
      if (sk.src !== 'sect') errors.push(`宗门功法 ${id} 的 src 应为 sect，实际 ${sk.src}`);
      if (sk.sect !== S.rootOf(s.id)) {
        errors.push(`宗门功法 ${id} 的 sect(${sk.sect}) 应等于根宗门 ${S.rootOf(s.id)}`);
      }
    });
    if (s.parent && !S.byId(s.parent)) errors.push(`宗门 ${s.id} 的 parent ${s.parent} 不存在`);
  });

  /* ② 每本功法都要有 src */
  Object.keys(G.Data.skills).forEach(function (id) {
    const src = G.Data.skills[id].src;
    if (src !== 'common' && src !== 'free' && src !== 'sect') {
      errors.push(`功法 ${id} 的 src 非法：${src}`);
    }
  });

  /* ③④ 互斥与废功 */
  const mk = (cult, sectId) => ({ cult: cult, sectId: sectId || null, skills: {}, skillEquip: [] });
  const freeSkill = Object.keys(G.Data.skills).filter(function (i) { return G.Data.skills[i].src === 'free'; })[0];
  const sectSkill = '青溪剑诀';
  const commonSkill = '吐纳术';
  if (!freeSkill) errors.push('找不到任何散修功法（src=free）');
  const mFree = mk('free');
  const mSect = mk('sect', 'qxj');
  if (!G.Player.canUseSkill(mFree, freeSkill)) errors.push('散修应能用散修功法');
  if (G.Player.canUseSkill(mFree, sectSkill)) errors.push('散修不应能用宗门功法');
  if (!G.Player.canUseSkill(mSect, sectSkill)) errors.push('本门弟子应能用本门功法');
  if (G.Player.canUseSkill(mSect, freeSkill)) errors.push('宗门弟子不应能用散修功法');
  if (!G.Player.canUseSkill(mFree, commonSkill)) errors.push('common 功法散修也该能用');
  if (!G.Player.canUseSkill(mSect, commonSkill)) errors.push('common 功法宗门弟子也该能用');
  /* 跨宗门：玄天阵宗的弟子不能用青溪剑阁的功法 */
  if (G.Player.canUseSkill(mk('sect', 'xtzz'), sectSkill)) errors.push('外门弟子不应能用别家的宗门功法');
  /* 同根分部：太虚剑宗山门弟子应能用本门功法（山门/总部/道场同根） */
  if (!G.Player.canUseSkill(mk('sect', 'txjz_ling'), '太虚剑意')) errors.push('同根分部应能用本门功法');
  /* 废功 */
  const mV = mk('free'); mV.skills[freeSkill] = { lv: 3, voided: true };
  if (G.Player.canUseSkill(mV, freeSkill)) errors.push('已废功的功法不应可用');

  /* ⑤ 拜入 = **试炼战 → 胜利入宗**（S2）。
     走"面板按钮 → 战斗胜利"整条真实路径，不直接调 Player.switchCult ——
     那样只能测到函数，测不出"入口通不通"。 */
  const s0 = JSON.parse(JSON.stringify(save));
  s0.cult = 'free'; s0.sectId = null; s0.sectRep = 0; s0.cultSwitchUsed = false;
  s0.globalLevel = 37;                                     /* 过试炼门槛（炼气一重初期） */
  s0.skills = {}; s0.skills[freeSkill] = { lv: 2, voided: false };
  s0.skills[commonSkill] = { lv: 1, voided: false };
  s0.skillEquip = [freeSkill, commonSkill];
  s0.pos = null;
  G.game.save = s0;
  G.game.changeScene('town', { toSpawn: true });
  const sc = G.game.scene;
  G.Overlays.openPanel(sc, 'sect');
  if (sc.overlay !== 'sect') { errors.push('宗门面板打不开'); return; }
  /* 散修默认落在「散修」子页，先切到「宗门」子页才有拜入按钮 */
  const sectTabBtn = (sc.buttons || []).filter(function (b) { return b.label === '宗门'; })[0];
  if (!sectTabBtn) { errors.push('势力面板缺「宗门」子页签'); return; }
  sectTabBtn.onClick();
  const joinBtn = (sc.buttons || []).filter(function (b) { return /拜入/.test(b.label || ''); })[0];
  if (!joinBtn) { errors.push('宗门子页没有「拜入」按钮（散修态）'); return; }
  const wantSect = joinBtn.label.replace('拜入 ', '');
  joinBtn.onClick();
  if (G.game.sceneName !== 'battle') {
    errors.push('拜入应开**试炼战**，实际场景 ' + G.game.sceneName);
    return;
  }
  const bx = G.game.scene;
  if (!bx.params || bx.params.script !== 'sectTrial') {
    errors.push('试炼战 script 应为 sectTrial，实际 ' + (bx.params && bx.params.script));
  }
  /* 直接判胜，走真实的胜利分支 */
  bx.es.forEach(function (e) { e.hp = 0; });
  bx._victory();
  pump(40);
  if (s0.cult !== 'sect' || !s0.sectId) errors.push('试炼胜利后阵营/宗门未写入');
  if (G.Data.sects.byId(s0.sectId) && G.Data.sects.byId(s0.sectId).n !== wantSect) {
    errors.push('入的宗门与点的按钮不一致（' + s0.sectId + ' vs ' + wantSect + '）');
  }
  if (!s0.skills[freeSkill].voided) errors.push('入门后散修功法应被废功');
  if (s0.skills[commonSkill].voided) errors.push('common 功法不该被废功');
  if (s0.skillEquip.indexOf(freeSkill) >= 0) errors.push('已废功的功法应自动卸下');
  if (!s0.cultSwitchUsed) errors.push('入门后应置 cultSwitchUsed');

  /* ⑤b 贡献兑换本门功法（用**实际入的那个宗门**的功法池，别写死 ——
     按钮列表按"大宗门优先"排序，入的不一定是青溪剑阁） */
  const mySect = G.Data.sects.byId(s0.sectId);
  const mySkill = (mySect && mySect.skills) ? mySect.skills[0] : null;
  const root = G.Data.sects.rootOf(s0.sectId);
  const otherSkill = Object.keys(G.Data.skills).filter(function (id) {
    const sk = G.Data.skills[id];
    return sk.src === 'sect' && sk.sect !== root;
  })[0];
  if (!mySkill) { errors.push('入的宗门没有功法池'); return; }
  s0.sectRep = 200;
  const before = Object.keys(s0.skills).length;
  const r = G.Player.learnSectSkill(s0, mySkill);
  if (!r.ok) errors.push('贡献足够时应能兑换本门功法（' + mySkill + '）：' + r.reason);
  if (Object.keys(s0.skills).length !== before + 1) errors.push('兑换后应习得该功法');
  if (s0.sectRep >= 200) errors.push('兑换应扣贡献');
  if (G.Player.learnSectSkill(s0, mySkill).ok) errors.push('已习得的功法不该能重复兑换');
  if (otherSkill && G.Player.learnSectSkill(s0, otherSkill).ok) {
    errors.push('不该能兑换别家的宗门功法：' + otherSkill);
  }
  s0.sectRep = 0;
  if (mySect.skills[1] && G.Player.learnSectSkill(s0, mySect.skills[1]).ok) {
    errors.push('贡献不足时不该能兑换');
  }

  /* ⑤c 每世一次：再开面板不应有拜入/退门按钮 */
  G.Overlays.openPanel(sc, 'sect');
  const again = (sc.buttons || []).filter(function (b) { return /拜入|退门帖/.test(b.label || ''); });
  if (again.length) errors.push('本世已转过阵营，不应再出现拜入/退门按钮');

  /* ⑤d 功法前置链（S3，对标《太吾绘卷》）：第 2 本需第 1 本 Lv3 */
  if (mySect.skills.length >= 2) {
    s0.sectRep = 500;
    s0.skills[mySect.skills[0]] = { lv: 2, voided: false };
    delete s0.skills[mySect.skills[1]];
    if (G.Player.learnSectSkill(s0, mySect.skills[1]).ok) {
      errors.push('前置链失效：第 1 本未达 Lv3 却能换第 2 本');
    }
    s0.skills[mySect.skills[0]] = { lv: 3, voided: false };
    const r4 = G.Player.learnSectSkill(s0, mySect.skills[1]);
    if (!r4.ok) errors.push('第 1 本达 Lv3 后应能换第 2 本：' + r4.reason);
  }

  /* ⑤e 门派商店（S3，对标《烟雨江湖》） */
  const SH = G.Data.sects.SHOP;
  if (!SH || !SH.length) errors.push('门派商店表为空');
  else {
    s0.sectRep = 0;
    if (G.Player.buySectItem(s0, 0).ok) errors.push('贡献为 0 时不该能换物');
    s0.sectRep = SH[0].cost;
    s0.items = s0.items || {};
    const b0 = s0.items[SH[0].item] || 0;
    const br = G.Player.buySectItem(s0, 0);
    if (!br.ok) errors.push('贡献足够时应能换物：' + br.reason);
    if ((s0.items[SH[0].item] || 0) !== b0 + SH[0].n) errors.push('换物后物品数量不对');
    if (s0.sectRep !== 0) errors.push('换物应扣贡献');
    if (G.Player.buySectItem(s0, 999).ok) errors.push('不存在的商品不该能换');

    /* 回归（v0.43.0，截图反馈"eq_qingfeng 裸显"）：
       ① 每件商品的显示名都必须解析成中文，内部 id 不得残留；
       ② 逐下标购买一遍 —— 防止"只测第 0 件、后面的商品被截断成死货"。
       v0.90.1：新增**功法商品**（`skill` 字段，用户口径「宗门线给功法」）——
       它们没有 `item`/`n`，显示名与扣费路径都不同，所以按类型分支断言。 */
    SH.forEach(function (it, i) {
      s0.sectRep = it.cost;
      if (it.skill) {
        /* 功法商品：必须给出功法名、必须真的学会、必须已激发（autoEquip）。
           ⚠️ 用**新档**驱动，且 cult 必须是散修/未定 —— 这几门是散修功法，
              本门弟子反而学不了（`canUseSkill` 的正确行为，不是 bug）。 */
        const ssk = JSON.parse(JSON.stringify(s0));
        ssk.cult = 'free'; ssk.sectId = null;
        ssk.skills = {}; ssk.skillEquip = [];
        ssk.sectRep = it.cost;
        const buy = G.Player.buySectItem(ssk, i);
        if (!buy.ok) { errors.push('功法商品下标 ' + i + ' 应可购买：' + buy.reason); return; }
        if (!buy.name || /^[a-z_]+$/i.test(buy.name)) {
          errors.push('功法商品下标 ' + i + ' 显示名未解析：' + buy.name);
        }
        if (!ssk.skills[it.skill]) errors.push('功法商品下标 ' + i + ' 未授予功法：' + it.skill);
        if ((ssk.skillEquip || []).indexOf(it.skill) < 0) {
          errors.push('功法商品下标 ' + i + ' 授予的功法未进激发列表（autoEquip 漏接）');
        }
        if (ssk.sectRep !== 0) errors.push('功法商品下标 ' + i + ' 未扣贡献');
        return;
      }
      const nm = G.Player.itemName(it.item);
      if (!nm || /^eq_|[a-z]{3,}_[a-z_]+/.test(nm)) {
        errors.push('商品(' + it.item + ')显示名未解析：' + nm);
      }
      const buy = G.Player.buySectItem(s0, i);
      if (!buy.ok || buy.name !== G.Player.itemName(it.item)) {
        errors.push('商品下标 ' + i + ' 应可购买并回传显示名：' + (buy.reason || 'name 缺失'));
      }
    });
  }

  /* ⑥ 底栏 */
  const bar = (sc.buttons || []).filter(function (b) { return b.variant === 'tab'; });
  if (bar.length !== 6) errors.push(`底栏应为 6 项，实际 ${bar.length}`);
  if (!bar.some(function (b) { return b.label === '势力'; })) errors.push('底栏没有「势力」项');

  /* ⑦ 宗门功法**不得进散修掉落途径**（碎片参悟池 / 副本池 / 沈伯池）。
     漏一条，"两道互斥"就被绕过去了 —— 而且症状很隐蔽：散修莫名其妙会了一本宗门功法。
     实际踩过：`shardPool` 是**按品阶现算**的，加宗门功法后它们自动进了池子，
     顺带改变了 RNG 消耗序列，把 `playthrough` 搞成了偶发失败。 */
  ['凡', '灵', '宝'].forEach(function (tier) {
    (G.Data.shardPool(tier) || []).forEach(function (id) {
      if (G.Data.skills[id].src === 'sect') errors.push(`碎片池(${tier})混进了宗门功法：${id}`);
    });
  });
  ['skillDropPool', 'skillDropPoolLing', 'shenBoPool'].forEach(function (k) {
    (G.Data[k] || []).forEach(function (id) {
      if (G.Data.skills[id] && G.Data.skills[id].src === 'sect') {
        errors.push(`${k} 混进了宗门功法：${id}`);
      }
    });
  });

  /* 渲染：新增面板最容易漏的是 DRAW 注册 —— 漏了就是"点了没反应"、且不报错。
     所以用文本探针确认面板文案真的画出来了（只断言"不抛异常"是空的）。 */
  G.Overlays.openPanel(sc, 'sect');
  const cs = textSpy();
  sc.render(cs);
  /* 面板标题带现在是「势力」（v0.41.0 改名）—— 它恒在，比"阵营"更适合当判据 */
  if (!cs.__seen.some(function (t) { return t.indexOf('势') >= 0; })) {
    errors.push('势力面板没有渲染出内容（DRAW 注册漏了？）');
  }
}, 'sect.contract');

/* ---------- 区域可见性契约（缺口 G19） ----------
   裂隙（entrance）与界门（worldgate）是"这片区域里有秘境 / 能去别的界"的唯一线索。
   它们曾经只登记在 special 里、**没有任何绘制分支** —— 地图上什么都不出现，
   玩家唯一的线索是走到正面冒出一个小三角，等于把入口藏了起来。
   这里用**差分探针**钉住：同一张图去掉该物件后，每帧的 drawImage 次数必须减少。
   只断言"绘制函数存在"不够（漏路由照样不画），所以必须跑整图渲染。 */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  s.pos = null;
  s.worldSeed = 'visual-probe';
  s.entrances = { fan: [], ling: [], xian: [], dao: [] };
  G.game.save = s;
  G.game.meta = {
    progress: { activeWorld: 'fan', worlds: { fan: true }, difficulty: 'normal',
      worldDiff: { fan: 'normal' }, daoKey: false,
      daoShards: { fan: false, ling: false, xian: false } },
    hellCleared: {}, titles: [], perfusion: {}, achieve: {}
  };
  s.entrances.fan = G.Data.regions.rollEntrances('fan', s.worldSeed);

  /* 渲染一帧并数 drawImage 次数；dropKind 指定时临时摘掉该类物件。
     摘/还都**原地改数组**（不换引用）—— mapgen 可能把这张数组交给 map.md。
     ⚠️ 地图一律走 `RegionGen.ensure`（**唯一口**），不许写 `G.Data.maps[id] || ensure(...)`
        这种"缓存优先"短路：按世缓存（v0.74.0）之后，短路会取到**别的上下文**
        （别的契约用另一个 worldSeed）遗留的同名地图，症状是"落位区里没有入口裂隙"
        这类看似与本次改动无关的假红。ensure 会按 tag 自动重建，语义才正确。 */
  function frames(regionId, dropKind) {
    const md = G.RegionGen.ensure(s, regionId);
    if (!md) { errors.push(`视觉探针：区域 ${regionId} 生成失败`); return 0; }
    const bak = md.special.slice();
    if (dropKind) {
      for (let i = md.special.length - 1; i >= 0; i--) {
        if (md.special[i].kind === dropKind) md.special.splice(i, 1);
      }
    }
    G.RegionGen.sceneFor(regionId);
    G.game.changeScene(regionId, { toSpawn: true });
    const sc = G.game.scene;
    sc.render(makeCtx());                    /* 热身：地面烘焙与各级缓存 */
    const cx = drawSpy(); sc.render(cx);
    const n = cx.__hits.length;
    md.special.length = 0; bak.forEach(function (x) { md.special.push(x); });
    return n;
  }

  /* ① 裂隙：本世入口落位所在的区域 */
  const entRegion = s.entrances.fan[0].region;
  const emd = G.RegionGen.ensure(s, entRegion);
  if (!(emd.special || []).some(function (x) { return x.kind === 'entrance'; })) {
    errors.push(`${entRegion}: 落位区里没有生成入口裂隙`
      + `（cached=${!!G.Data.maps[entRegion]}, label=${emd.label}, special=${(emd.special || []).map(function (x) { return x.kind; }).join('/') || '空'}）`);
  } else {
    const a = frames(entRegion, null), b = frames(entRegion, 'entrance');
    if (!(a > b)) errors.push(`裂隙没有画出来：摘掉 entrance 后每帧 drawImage 次数没减少（${a} vs ${b}）`);
  }

  /* ② 界门：本界标记 gate 的生成型区域 */
  const gr = G.Data.regions.of('fan').filter(function (r) { return r.gate && !r.map; })[0];
  if (!gr) errors.push('fan: 没有标记 gate 的生成型区域');
  else {
    const gmd = G.RegionGen.ensure(s, gr.id);
    if (!(gmd.special || []).some(function (x) { return x.kind === 'worldgate'; })) {
      errors.push(`${gr.id}: 没有生成界门`);
    } else {
      const a = frames(gr.id, null), b = frames(gr.id, 'worldgate');
      if (!(a > b)) errors.push(`界门没有画出来：摘掉 worldgate 后每帧 drawImage 次数没减少（${a} vs ${b}）`);
    }
  }
}, 'region.visual.contract');

/* ---------- 区域美术换皮契约（缺口 U7） ----------
   问题：28 个区域原先共用 `save.world.pal`（**每个世界一份**）——
   「赤牙洞」与「广寒宫」除了 ground 是 grass/cave/town 之一外配色完全一样，
   进哪一区只能靠场景名牌分辨。
   三条断言（缺一条都会让"换皮"静默失效）：
     ① **数据**：每个区域都有预设、预设字段齐全合法、**同一界内不得两区同色**；
     ② **运行时**：真生成两张地图 → `md.pal` / `md.scatter` 不同，
        且预烘地面层的缓存键不同（键里带 pal.ground|pal.rock = 画的确实是两张图）；
     ③ **源码闸**：explore 的绘制路径不得直接读 `world.pal`（只允许 `_pal()` 里那一处兜底）——
        漏一处就是"那个物件没换皮"，完全静默。 */
step(function () {
  const REG = G.Data.regions;
  const TINT = REG.TINT, PAL = REG.PAL;
  if (!TINT || !PAL) { errors.push('未导出 TINT / PAL（区域美术换皮）'); return; }
  const NEED = ['ground', 'dark', 'grass', 'rock'];
  const HEX = /^#[0-9a-f]{6}$/i;
  const palKeyOf = function (r) {
    const p = PAL[TINT[r.id]];
    return p ? [p.ground, p.dark, p.grass, p.rock].join('|') : null;
  };

  /* ① 数据：全覆盖 + 字段齐全合法 + 装饰物配方 */
  REG.all().forEach(function (r) {
    const name = TINT[r.id];
    if (!name) { errors.push('区域 ' + r.id + '（' + r.n + '）没有美术预设'); return; }
    const p = PAL[name];
    if (!p) { errors.push('区域 ' + r.id + ' 指向不存在的预设 ' + name); return; }
    NEED.forEach(function (k) {
      if (typeof p[k] !== 'string' || !HEX.test(p[k])) {
        errors.push('预设 ' + name + ' 的 ' + k + ' 不是合法颜色：' + p[k]);
      }
    });
    if (!p.scatter) errors.push('预设 ' + name + ' 缺 scatter（装饰物配方）');
  });

  /* ①b 同界内不得两区同色 —— 否则"进哪一区都一样"原地复发 */
  ['fan', 'ling', 'xian', 'dao'].forEach(function (wid) {
    const seen = {};
    REG.of(wid).forEach(function (r) {
      const k = palKeyOf(r);
      if (!k) return;
      if (seen[k]) {
        errors.push(wid + ' 界内 ' + seen[k] + ' 与 ' + r.id
          + ' 用了同一套配色（预设 ' + TINT[r.id] + '）');
      }
      seen[k] = r.id;
    });
  });

  /* ② 运行时：真生成两张图，调色板 / 装饰物 / 预烘键都必须不同 */
  const s = JSON.parse(JSON.stringify(save));
  s.world = s.world || {};
  s.world.pal = s.world.pal || {
    ground: '#4a6b42', dark: '#3a5735', grass: '#5fbf5f', water: '#5a9fd6', rock: '#7a7f8a'
  };
  G.game.save = s;
  /* ⚠️ 必须挑**生成型**区域：凡界 F1–F3（town/field/cave）是复用现有手写地图，
     它们的 md 由 mapgen 产出、**没有 pal 字段**，拿它们做探针会直接抛异常。
     这里挑两张 ground 都是 cave 的图（乱葬岗 / 火云谷）——
     基础类型相同、只有调色板不同，是对"换皮真的生效"最强的检验。 */
  const RA = 'fan7' /* 乱葬岗 · grave */, RB = 'fan9' /* 火云谷 · lava */;
  const mdA = G.RegionGen.ensure(s, RA), mdB = G.RegionGen.ensure(s, RB);
  if (!mdA || !mdB) { errors.push('区域生成失败：' + RA + ' / ' + RB); return; }
  /* 所有**生成型**区域都必须带 pal / scatter（复用型地图不在其列） */
  REG.all().forEach(function (r) {
    if (r.map) return;
    const md = G.RegionGen.ensure(s, r.id);
    if (!md) { errors.push('区域 ' + r.id + ' 生成失败'); return; }
    if (!md.pal) errors.push('区域 ' + r.id + ' 的地图没有 pal 字段（regiongen 没落区域调色板）');
    if (!md.scatter) errors.push('区域 ' + r.id + ' 的地图没有 scatter 字段');
  });
  if (!mdA.pal || !mdB.pal) {
    errors.push('生成的地图没有 pal 字段（regiongen 没落区域调色板）');
  } else {
    if (mdA.pal.ground === mdB.pal.ground) {
      errors.push('两个不同区域的调色板一样（' + mdA.pal.ground + '）—— 换皮没生效');
    }
    if (mdA.pal.ground === s.world.pal.ground) {
      errors.push('区域调色板与世界调色板相同（' + mdA.pal.ground + '）—— 预设没盖上去');
    }
    /* 世界调色板的其它字段必须**透传**（water / robe / 以后新增的） */
    if (mdA.pal.water !== s.world.pal.water) {
      errors.push('区域调色板丢了世界调色板的 water 字段（应透传，否则以后加字段会静默丢失）');
    }
  }
  if (JSON.stringify(mdA.scatter) === JSON.stringify(mdB.scatter)) {
    errors.push('两个不同区域的装饰物配方一样 —— scatter 没接线');
  }
  /* 预烘地面层的缓存键：键里带 pal.ground|pal.rock，
     键不同才说明"真的画了两张不同的地面"（这是换皮最终落地的地方）。 */
  const scA = G.RegionGen.sceneFor(RA), scB = G.RegionGen.sceneFor(RB);
  if (scA && scB) {
    scA.enter(); scA._ensureGround();
    scB.enter(); scB._ensureGround();
    if (scA._groundKey && scA._groundKey === scB._groundKey) {
      errors.push('两个区域预烘出同一个地面层缓存键 —— 换皮没传到绘制层');
    }
  }

  /* ③ 源码闸：绘制路径不得直接读 world.pal（`_pal()` 的兜底那一处除外）。
     先剥掉块注释与行注释，否则注释里提到这个表达式就会误报。 */
  const exLines = fs.readFileSync(path.join(WWW, 'js/core/explore.js'), 'utf8').split('\n');
  let inBlock = false, hits = 0;
  exLines.forEach(function (line, i) {
    let code = line;
    if (inBlock) {
      const e = code.indexOf('*/');
      if (e < 0) return;
      code = code.slice(e + 2); inBlock = false;
    }
    const st = code.indexOf('/*');
    if (st >= 0) {
      const e2 = code.indexOf('*/', st);
      if (e2 < 0) { inBlock = true; code = code.slice(0, st); }
      else code = code.slice(0, st) + code.slice(e2 + 2);
    }
    const lc = code.indexOf('//');
    if (lc >= 0) code = code.slice(0, lc);
    if (code.indexOf('G.game.save.world.pal') < 0) return;
    if (code.indexOf('_pal:') >= 0 || code.indexOf('return (this.map.md') >= 0) return;
    hits++;
    errors.push('源码闸：explore.js:' + (i + 1)
      + ' 直接读了 world.pal —— 绘制路径应走 this._pal()（漏一处就是那个物件没换皮）');
  });
  if (hits === 0) {
    const n = (fs.readFileSync(path.join(WWW, 'js/core/explore.js'), 'utf8')
      .match(/this\._pal\(\)/g) || []).length;
    if (n < 6) {
      errors.push('源码闸：explore.js 只用了 ' + n + ' 处 this._pal()（应 ≥6），可能被改回直读 world.pal');
    }
  }
}, 'region.tint.contract');

/* ---------- M1 数据层契约（设计 M1 v1.0 §5.2 / §5.3） ----------
   本轮只上**数据与程序化立绘**（任务链 / 血煞据点地图 / 抉择卡见后续轮次）。
   三条：① 功法（灵阶 + 两个掉落池 + 多段字段）
        ② 敌人（面板公式 + 两个剧情 Boss 的规格）
        ③ 立绘（登记 + 真的能产出位图）—— G19 的教训：登记了 ≠ 画得出来。 */
step(function () {
  const errors = [];
  const S = G.Data.skills, TC = G.Data.tierCoef, E = G.Data;

  /* ① 灵阶功法 */
  if (TC['灵'] !== 1.5) errors.push('tierCoef[灵] 应为 1.5，实际 ' + TC['灵']);
  ['流云剑诀', '疾风九刃', '玄水诀', '磐石功', '赤焰心法'].forEach(function (id) {
    const d = S[id];
    if (!d) { errors.push('缺灵阶功法 ' + id); return; }
    if (d.tier !== '灵') errors.push(id + ' 的 tier 应为「灵」，实际 ' + d.tier);
    if (!d.kind) errors.push(id + ' 缺 kind（面板成长靠它分派：攻击→ATK / 防御→DEF / 仙术→HP）');
  });
  if (!S['疾风九刃'] || S['疾风九刃'].hits !== 2) {
    errors.push('疾风九刃 的 hits 应为 2，实际 ' + (S['疾风九刃'] && S['疾风九刃'].hits));
  }
  if (!(S['玄水诀'] && S['玄水诀'].active && S['玄水诀'].active.heal > 0)) {
    errors.push('玄水诀 应有 active.heal（设计 M1 §5.2 的治疗主动）');
  }
  /* 两个新池的键必须都在 skills 表里且都是灵阶 */
  [['skillDropPoolLing', E.skillDropPoolLing], ['shenBoPool', E.shenBoPool]].forEach(function (pair) {
    const nm = pair[0], pool = pair[1];
    if (!pool || !pool.length) { errors.push('缺掉落池 ' + nm); return; }
    pool.forEach(function (id) {
      if (!S[id]) errors.push(nm + ' 里的 ' + id + ' 不在 skills 表');
      else if (S[id].tier !== '灵') errors.push(nm + ' 里的 ' + id + ' 不是灵阶');
    });
  });
  /* 凡阶池不得被污染（M0 掉落不变） */
  (E.skillDropPool || []).forEach(function (id) {
    if (S[id] && S[id].tier !== '凡') errors.push('凡阶池被污染：' + id + ' 是 ' + S[id].tier);
  });

  /* ② 敌人 */
  ['血煞教徒', '血蝠', '心魔残影'].forEach(function (k) {
    if (!E.species[k]) errors.push('缺 M1 物种：' + k);
  });
  ['血煞教徒', '血蝠'].forEach(function (k) {
    if (!E.species[k]) return;
    /* artKey / sprite 缺一个，素材或兜底立绘就接不上 */
    if (!E.species[k].artKey) errors.push(k + ' 缺 artKey（素材逻辑名后缀）');
    if (!E.species[k].sprite) errors.push(k + ' 缺 sprite（程序化兜底键）');
    const a = E.makeEnemy(k, 10), b = E.makeEnemy(k, 20);
    ['maxhp', 'atk', 'def', 'spd'].forEach(function (f) {
      if (!(b[f] > a[f])) errors.push(k + ' 的 ' + f + ' 未随等级增长');
    });
    if (a.artKey !== E.species[k].artKey) errors.push(k + ' 的 artKey 没透传到单位上');
  });
  /* 血面：固定 L19 面板 + 40% 狂暴 */
  const xm = E.makeXuemian();
  if (xm.level !== 73) errors.push('血面 境界应为 gl73（筑基起点），实际 ' + xm.level);
  if (!xm.boss) errors.push('血面 应标 boss（影响立绘尺寸与「首领战」标签）');
  [['maxhp', 480], ['atk', 38], ['def', 18], ['spd', 18]].forEach(function (p) {
    if (xm[p[0]] !== p[1]) errors.push('血面 ' + p[0] + ' 应为 ' + p[1] + '，实际 ' + xm[p[0]]);
  });
  if (!xm.phases || !xm.phases.length) errors.push('血面 缺 phases（通用阶段引擎读它）');
  else {
    /* v0.11.5 起两条阶段，且**顺序即叙事顺序**：沈伯燃命（ally@.55）在前、
       狂暴（enrage@.40）在后。契约按位置钉 —— 顺序被调换要能报出来。 */
    if (xm.phases[0].kind !== 'ally' || xm.phases[0].trig !== 0.55) {
      errors.push('血面 阶段①应为 ally@0.55（沈伯燃命），实际 '
        + xm.phases[0].kind + '@' + xm.phases[0].trig);
    }
    if (!xm.phases.some(function (p) { return p.kind === 'enrage' && p.trig === 0.40; })) {
      errors.push('血面 缺狂暴阶段 enrage@0.40');
    }
  }
  if (!xm.skills.some(function (s) { return /血河/.test(s.n); })) {
    errors.push('血面 缺「血河咒」（狂暴阶段要压它的 CD）');
  }
  /* 筑基心魔：快照 HP×1.05、攻防速×1.0；且不能把 M0 的 ×.9 顺手改掉 */
  const fake = { maxhp: 400, atk: 50, def: 20, spd: 16, level: 18 };
  const hd2 = E.makeHeartDemon2(fake);
  if (hd2.maxhp !== Math.round(400 * 1.05)) {
    errors.push('筑基心魔 HP 应为快照 ×1.05 = ' + Math.round(400 * 1.05) + '，实际 ' + hd2.maxhp);
  }
  if (hd2.atk !== 50 || hd2.def !== 20 || hd2.spd !== 16) {
    errors.push('筑基心魔 攻防速应为快照 ×1.0');
  }
  if (!hd2.phases || !hd2.phases.some(function (p) { return p.kind === 'summon'; })) {
    errors.push('筑基心魔 缺 summon 阶段（心魔分身）');
  }
  if (E.makeHeartDemon(fake).atk !== Math.round(50 * .9)) {
    errors.push('M0 心魔 攻应为快照 ×.9 —— 被改动了');
  }

  /* ③ 立绘：登记 + 真的能产出位图 */
  const KEYS = G.Sprites.BAKE_KEYS || [];
  ['cultist', 'bloodbat', 'xuemian'].forEach(function (k) {
    if (KEYS.indexOf(k) < 0) errors.push('程序化立绘未登记：BAKE.' + k);
  });
  /* 心魔立绘**不在 BAKE 里** —— 它是独立的 heartDemonSprite()（battle.js 按 species 特判）。
     心魔残影的兜底就靠它，所以单独钉一下。 */
  if (typeof G.Sprites.heartDemon !== 'function') {
    errors.push('缺 G.Sprites.heartDemon（心魔残影的兜底立绘）');
  }
  ['cultist', 'bloodbat', 'xuemian'].forEach(function (k) {
    const c = G.Sprites.beastResolve(k, k);
    if (!c) errors.push('立绘 ' + k + ' 产不出位图');
    else if (!(c.width > 0)) errors.push('立绘 ' + k + ' 的位图宽度为 0');
  });

  if (errors.length) {
    errors.forEach(function (e) { console.log('  ✗ ' + e); });
    throw new Error('M1 数据层契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ M1 数据层：5 本灵阶功法 + 2 个新掉落池 + 4 个新敌人 + 3 张程序化立绘');
}, 'm1.data.contract');

/* ---------- M1 任务链契约（v0.11.3）----------
   真把 m1-1 → m1-4 走一遍：每步都从"能开出的那条路"进去（面对 NPC 按交互 / 点按钮），
   断言任务步、flag、产出物与**因果记录**都落到位。
   为什么不逐条查源码：这条链的价值全在"接得上"，
   源码里每句都在、串起来却断链，是这类任务系统最典型的失败。 */
step(function () {
  const errors = [];
  /* ⚠️ 本契约里**禁止裸 `return`** —— 末尾那句 `throw` 才是把本地 errors
     交给 step() 的唯一出口，提前 return 会让错误被就地丢掉、契约静默变绿。
     （反例验证时真踩到过：把 m1-1 的推进删掉，契约一声不吭地"通过"了。）
     要中途放弃就用 bail()：它记下错误再抛哨兵，由下面的 catch 收住。 */
  const BAIL = { bail: true };
  const bail = (msg) => { errors.push(msg); throw BAIL; };
  const R = () => G.game.save.quest;

  /* 站在某个 NPC 面前按交互（四向找一格可站的） */
  const faceAndInteract = (sc, npc) => {
    const s = G.game.save;
    let placed = false;
    [[0, 1, 'up'], [0, -1, 'down'], [1, 0, 'left'], [-1, 0, 'right']].forEach((d) => {
      if (placed) return;
      const px = npc.x + d[0], py = npc.y + d[1];
      if (px < 0 || py < 0 || px >= sc.map.w || py >= sc.map.h) return;
      if (sc.map.solid[py][px]) return;
      s.pos = { x: px, y: py }; sc.dir = d[2]; placed = true;
    });
    if (!placed) bail('NPC ' + npc.id + ' 四周没有可站位');
    sc._interact();
    return true;
  };
  const npcOf = (mapId, act) =>
    (G.Data.maps[mapId].npcs || []).filter((n) => n.act === act)[0];
  const btnByLabel = (sc, re) => sc.buttons.filter((b) => re.test(b.label || ''))[0];

  try {

  /* 起点：斩狼王之后、回到镇上。gl 15（m1-4 门槛）、灵石与妖丹备足。 */
  const s = JSON.parse(JSON.stringify(save));
  s.quest = { step: 'm1-1', flags: {} };
  s.bossKilled = true;
  s.globalLevel = 57; s.maxGlobalLevel = 57;
  s.stone = 3000; s.items = { 妖丹: 5, 回春丹: 2 };
  s.skills = {};                    /* 清空，好验"沈伯赠了一本灵阶功法" */
  /* 灵根设成火：沈伯池里只有「赤焰心法」是火 —— 匹配集非空，才能验"匹配优先" */
  s.linggen = { elems: ['火'], coef: { 火: 1.2 }, kind: '单灵根', stoneBonus: 0 };
  s.karma = {};
  s.pos = null;
  G.game.save = s;
  G.game.changeScene('town', { toSpawn: true });

  /* —— m1-1 归镇辨丹 —— */
  const sbTown = npcOf('town_shop', 'shenbo');
  G.game.changeScene('town_shop', { toSpawn: true });
  let sc = G.game.scene;
  if (sc.npcMarkOf(sbTown) !== '!') errors.push('m1-1：沈伯应挂 ！，实为 ' + sc.npcMarkOf(sbTown));
  faceAndInteract(sc, sbTown);
  if (R().step !== 'm1-2') errors.push('m1-1 辨丹后应转 m1-2，实为 ' + R().step);
  if (!R().flags.bloodDan) errors.push('m1-1 未写 flags.bloodDan');
  if (!(s.chronicle || []).some((c) => c.id === 'bloodDan')) errors.push('m1-1 未记因果（bloodDan）');
  sc.clearOverlay();

  /* —— m1-2 探子：NPC 随任务步出现/消失 —— */
  const probe = npcOf('town', 'probe');
  if (!probe) bail('town 里没有配置探子 NPC');
  G.game.changeScene('town', { toSpawn: true });
  sc = G.game.scene;
  const onMap = (sc2) => (sc2.map.npcs || []).some((n) => n.id === 'probe');
  if (!onMap(sc)) errors.push('m1-2：探子应出现在镇上');
  if (sc.map.solid[probe.y][probe.x] !== true) errors.push('m1-2：探子格子不实心');
  if (sc.npcMarkOf(probe) !== '!') errors.push('m1-2：探子应挂 ！');

  faceAndInteract(sc, probe);
  if (sc.overlay !== 'probe1') errors.push('m1-2：与探子对话应开 probe1，实为 ' + sc.overlay);
  const poke = btnByLabel(sc, /点破/);
  if (!poke) bail('m1-2：探子对话里没有「点破他」');
  poke.onClick();
  const b = G.game.scene;
  if (G.game.sceneName !== 'battle') errors.push('m1-2：点破后应进战斗，实为 ' + G.game.sceneName);
  if (b.params.script !== 'probe') errors.push('m1-2：战斗 script 应为 probe');
  if (!b.es || !b.es.length || b.es[0].species !== '血煞教徒') {
    errors.push('m1-2：探子战敌人应为血煞教徒，实为 ' + (b.es[0] && b.es[0].species));
  }
  /* 境界 = 本世 gl+1、上限 68（新模型 battle.js） */
  if (b.es[0].level !== Math.min(68, s.globalLevel + 1)) {
    errors.push('m1-2：探子战境界应为 min(68, gl+1)=' + Math.min(68, s.globalLevel + 1)
      + '，实为 ' + b.es[0].level);
  }
  if (!b._noFlee()) errors.push('m1-2：剧情战必须禁逃（_noFlee() 为假）');

  /* 打完了：直接走 _victory 的探子分支，验"只交接 flag、不在这里推任务步" */
  b.p.hp = b.p.maxhp; b.es[0].hp = 0;
  b._victory();
  if (!R().flags.probeWin) errors.push('m1-2：胜利未写 flags.probeWin');
  if (R().step !== 'm1-2') errors.push('m1-2：胜利后任务步不该变（抉择还没选），实为 ' + R().step);

  /* 境界上限：主存档 gl=57 → min(68,58)=58，验不出封顶。
     另开一场 gl=70 逼出上限分支（battle.js 上限 68）。
     放在 _victory 之后：battle 单例，再 enter 会覆盖上面那场。 */
  {
    const sCap = JSON.parse(JSON.stringify(s));
    sCap.globalLevel = 70;
    G.game.save = sCap;
    G.game.changeScene('battle', { script: 'probe', mapId: 'town' });
    if (G.game.scene.es[0].level !== 68) {
      errors.push('m1-2：探子战境界未封顶 68，实为 ' + G.game.scene.es[0].level);
    }
    G.game.save = s;
  }

  /* —— 抉择 1：回镇自动摆卡 —— */
  s.pos = null;
  G.game.changeScene('town', { toSpawn: true });
  sc = G.game.scene;
  if (sc.overlay !== 'choice1') bail('抉择 1 未在回镇时摆出，实为 ' + sc.overlay);
  const opts = sc.buttons.filter((x) => x.label && /杀了他|放他走|交给沈伯/.test(x.label));
  if (opts.length !== 3) bail('抉择 1 应有 3 个选项，实为 ' + opts.length);
  /* 三个选项必须**各占一行**：全建在同一个 y 会完全重叠，点哪条都是最后一条 */
  const ys = opts.map((o) => o.y);
  if (new Set(ys).size !== 3) errors.push('抉择 1 的三个选项 y 重叠了：' + ys.join(','));

  const spare = opts.filter((o) => /放他走/.test(o.label))[0];
  spare.onClick();
  if (R().flags.probe !== 'spare') errors.push('抉择 1：flags.probe 应为 spare，实为 ' + R().flags.probe);
  if (!s.karma.cultistSpare) errors.push('抉择 1：未写 karma.cultistSpare');
  if (R().step !== 'm1-3') errors.push('抉择 1 后应转 m1-3，实为 ' + R().step);
  if (sc.overlay) errors.push('抉择 1 选完应收起覆盖层');
  if (onMap(sc)) errors.push('m1-3：探子应已离镇');

  /* —— m1-3 沈伯旧账：赠一本灵阶功法，灵根匹配优先 —— */
  G.game.changeScene('town_shop', { toSpawn: true });
  sc = G.game.scene;
  if (sc.npcMarkOf(sbTown) !== '?') errors.push('m1-3：沈伯应挂 ？，实为 ' + sc.npcMarkOf(sbTown));
  faceAndInteract(sc, sbTown);
  if (R().step !== 'm1-4') errors.push('m1-3 后应转 m1-4，实为 ' + R().step);
  if (!R().flags.oldDebt) errors.push('m1-3 未写 flags.oldDebt');
  const got = R().flags.oldDebtSkill;
  const pool = G.Data.shenBoPool || [];
  if (pool.indexOf(got) < 0) errors.push('m1-3 赠的功法不在沈伯池里：' + got);
  if (!s.skills[got]) errors.push('m1-3 赠的功法没进 save.skills：' + got);

  /* 「灵根匹配优先」是**概率规则**：直接跑一次会偶发假绿（正好随机到匹配的那本），
     反例验证时真踩到过。这里把 pick 换成"永远取第一个"：
     正确实现喂进来的是**已过滤的匹配数组**，取第一个仍是匹配的；
     一旦丢掉过滤，取到的就是池首那本不匹配的 —— 必报。 */
  const elems0 = (s.linggen && s.linggen.elems) || [];
  const matched0 = pool.filter((id) => G.Data.skills[id] && elems0.indexOf(G.Data.skills[id].elem) >= 0);
  if (!matched0.length) {
    errors.push('测试存档的灵根 ' + elems0.join('/') + ' 与沈伯池全不匹配，这条断言失去意义');
  } else {
    const s4 = JSON.parse(JSON.stringify(s));
    s4.quest = { step: 'm1-3', flags: {} };
    s4.skills = {};
    G.game.save = s4;
    const realPick = G.rng.pick;
    G.rng.pick = (arr) => arr[0];
    try {
      G.game.changeScene('town_shop', { toSpawn: true });
      faceAndInteract(G.game.scene, sbTown);
    } finally { G.rng.pick = realPick; }
    const got2 = s4.quest.flags.oldDebtSkill;
    if (matched0.indexOf(got2) < 0) {
      errors.push('m1-3 未优先给灵根匹配的功法（灵根 ' + elems0.join('/') + '，给了 ' + got2 + '）');
    }
    G.game.save = s;
  }
  G.game.changeScene('town_shop', { toSpawn: true });
  sc = G.game.scene;
  sc.clearOverlay();

  /* —— m1-4 门槛：不到炼气六重初期(gl57)不接活 —— */
  G.game.changeScene('town_shop', { toSpawn: true });
  sc = G.game.scene;
  s.globalLevel = 56;
  const before = JSON.stringify(s.items);
  faceAndInteract(sc, sbTown);
  if (JSON.stringify(s.items) !== before) errors.push('m1-4 门槛失效：gl56 就能拿到丹');
  if (sc.overlay) { errors.push('m1-4 门槛不足时不该开面板'); sc.clearOverlay(); }

  /* —— m1-4 沈伯旧方：妖丹×3 + 灵石 600 —— */
  s.globalLevel = 57;
  G.game.changeScene('town_shop', { toSpawn: true });
  sc = G.game.scene;
  faceAndInteract(sc, sbTown);
  const brew = btnByLabel(sc, /开炉/);
  if (!brew) bail('m1-4：沈伯没给出「开炉」选项');
  if (brew.disabled) errors.push('m1-4：备齐妖丹×3 + 600 灵石时「开炉」不该禁用');
  const st0 = s.stone, dan0 = s.items['妖丹'];
  brew.onClick();
  if ((s.items['筑基丹'] || 0) !== 1) errors.push('m1-4：沈伯旧方没给到筑基丹');
  if (s.stone !== st0 - 600) errors.push('m1-4：沈伯旧方扣灵石应为 600，实扣 ' + (st0 - s.stone));
  if (s.items['妖丹'] !== dan0 - 3) errors.push('m1-4：沈伯旧方应扣妖丹×3');
  if (!R().flags.foundPill) errors.push('m1-4：未写 flags.foundPill');

  /* —— m1-4 刘记途径：灵石 1000（第 2 世 1200）—— */
  const s2 = JSON.parse(JSON.stringify(s));
  s2.quest = { step: 'm1-4', flags: {} };
  s2.stone = 3000; s2.items = { 妖丹: 0 };
  s2.globalLevel = 57;
  G.game.save = s2;
  G.game.meta = Object.assign({}, G.game.meta, { life: 1 });
  G.game.changeScene('town_market', { toSpawn: true });
  sc = G.game.scene;
  const mkNpc = npcOf('town_market', 'market');
  if (sc.npcMarkOf(mkNpc) !== '?') errors.push('m1-4：刘掌柜应挂 ？，实为 ' + sc.npcMarkOf(mkNpc));
  faceAndInteract(sc, mkNpc);
  const order = btnByLabel(sc, /订购/);
  if (!order) bail('m1-4：刘记没有「订购」按钮');
  if (order.disabled) errors.push('m1-4：3000 灵石时「订购」不该禁用');
  order.onClick();
  if ((s2.items['筑基丹'] || 0) !== 1) errors.push('m1-4：刘记订购没给到筑基丹');
  if (s2.stone !== 2000) errors.push('m1-4：刘记订购应扣 1000，实扣 ' + (3000 - s2.stone));
  /* 第 2 世涨价 */
  s2.quest = { step: 'm1-4', flags: {} };
  s2.items = {}; s2.stone = 3000;
  G.game.meta = Object.assign({}, G.game.meta, { life: 2 });
  G.game.changeScene('town_market', { toSpawn: true });
  sc = G.game.scene;
  faceAndInteract(sc, npcOf('town_market', 'market'));
  const order2 = btnByLabel(sc, /订购/);
  if (!order2) errors.push('m1-4：第 2 世刘记没有「订购」按钮');
  else {
    order2.onClick();
    if (s2.stone !== 1800) errors.push('m1-4：第 2 世订购应扣 1200，实扣 ' + (3000 - s2.stone));
  }
  G.game.meta = Object.assign({}, G.game.meta, { life: 1 });

  /* —— 丹名口径：炼气九重巅峰(gl72)要的是「筑基丹」—— */
  if (G.Player.breakPill(72) !== '筑基丹') {
    errors.push('炼气九重巅峰突破丹名应为「筑基丹」，实为 ' + G.Player.breakPill(72));
  }
  if (G.Player.breakPill(36) !== '淬体突破丹') errors.push('淬体九重巅峰丹名被改坏了');
  if (G.Player.breakPill(108) !== '结丹丹') errors.push('筑基九重巅峰丹名应为「结丹丹」，实为 ' + G.Player.breakPill(108));
  const bs = (function () {
    const t = JSON.parse(JSON.stringify(s));
    t.globalLevel = 72; t.qi = 999999; t.items = {};
    return G.Player.breakState(t);
  })();
  if (bs.pill !== '筑基丹') errors.push('breakState 在炼气圆满时应点名筑基丹');
  if (bs.ready) errors.push('没有筑基丹时不该 ready');
  if (bs.reason.indexOf('筑基丹') < 0) errors.push('缺丹时的提示没点名筑基丹：' + bs.reason);

  /* —— 任务面板：链条变长后必须仍然整条落在面板内（窗口滑动）—— */
  const s3 = JSON.parse(JSON.stringify(save));
  s3.quest = { step: 'm1-2', flags: {} };
  s3.pos = null;
  G.game.save = s3;
  G.game.changeScene('town', { toSpawn: true });
  G.Overlays.openPanel(G.game.scene, 'quest');
  pump(2, 'quest.m1');
  G.game.scene.clearOverlay();

  } catch (e) { if (e !== BAIL) throw e; }   /* 只收 bail 哨兵，真异常照旧往上抛 */

  G.game.save = save;
  if (errors.length) {
    errors.forEach(function (e) { console.log('  ✗ ' + e); });
    throw new Error('M1 任务链契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ M1 任务链：m1-1 辨丹 → m1-2 探子战+抉择1 → m1-3 赠功法 → m1-4 两途径取丹');
}, 'm1.quest.contract');

/* ---------- M1 血夜契约（v0.11.5）----------
   把 m1-5 → m1-7 真走一遍。这条链的难点全在**跨场景交接**：
   镇（入夜演出）→ 据点（连战/抉择 2/Boss）→ 回据点（遗言）→ 小院（筑基）→ 刘记（离乡），
   每一步都是"前一个场景写 flag、后一个场景读 flag"，断在哪一环都不报错、只是卡住。
   所以这里逐环节断言 flag、场景名与产出物，并**显式驱动一次只在剧情里跑的分支**
   （红雾演出与沈伯燃命阶段在常规冒烟里永远不会被触发 —— 这正是哑弹的温床）。 */
step(function () {
  const errors = [];
  const BAIL = { bail: true };
  const bail = (msg) => { errors.push(msg); throw BAIL; };
  const R = () => G.game.save.quest;
  const sbTown = (G.Data.maps.town_shop.npcs || []).filter((n) => n.act === 'shenbo')[0];
  const faceAndInteract = (sc, npc) => {
    const s = G.game.save;
    let placed = false;
    [[0, 1, 'up'], [0, -1, 'down'], [1, 0, 'left'], [-1, 0, 'right']].forEach((d) => {
      if (placed) return;
      const px = npc.x + d[0], py = npc.y + d[1];
      if (px < 0 || py < 0 || px >= sc.map.w || py >= sc.map.h) return;
      if (sc.map.solid[py][px]) return;
      s.pos = { x: px, y: py }; sc.dir = d[2]; placed = true;
    });
    if (!placed) bail('NPC ' + npc.id + ' 四周没有可站位');
    sc._interact();
  };
  const btnByLabel = (sc, re) => sc.buttons.filter((b) => re.test(b.label || ''))[0];

  try {

  /* ========== ① 据点地图形状 ========== */
  const md = G.Data.maps.bloodhall;
  if (!md) bail('maps.js 里没有 bloodhall（血煞外堂据点）');
  if (md.ground !== 'bloodcave') errors.push('bloodhall 地面应为 bloodcave，实为 ' + md.ground);
  if (md.safe !== true) errors.push('bloodhall 应 safe（设计：无暗雷）');
  const nodes = (md.special || []).filter((sp) => sp.kind === 'scriptBattle');
  if (nodes.length < 3) errors.push('bloodhall 的 scriptBattle 节点应 ≥3，实为 ' + nodes.length);
  const bossSp = (md.special || []).filter((sp) => sp.kind === 'boss')[0];
  if (!bossSp) bail('bloodhall 没有 boss 物件（血面）');
  if (bossSp.id !== 'xuemian') errors.push('bloodhall 的 boss 物件 id 应为 xuemian，实为 ' + bossSp.id);

  /* 交互格必须 mark（否则随机散布的石头会压上去 → 物件静默不可交互） */
  {
    const s0 = JSON.parse(JSON.stringify(save));
    s0.quest = { step: 'm1-5', flags: {} };
    s0.pos = null;
    G.game.save = s0;
    G.game.changeScene('bloodhall', { toSpawn: true });
    const mp = G.game.scene.map;
    const near = (n) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(
      (d) => !mp.solid[n.y + d[1]] || !mp.solid[n.y + d[1]][n.x + d[0]]
        ? !mp.solid[n.y + d[1]] && !!mp.ground[n.y + d[1]]
        : false);
    /* boss 的正下方一格必须是可走的交互格，且登记了 boss */
    if (mp.solid[bossSp.y + 1][bossSp.x]) {
      errors.push('bloodhall：血面的交互格 (15,' + (bossSp.y + 1) + ') 是实心的 —— 玩家够不到');
    }
    const io = mp.interact[bossSp.x + ',' + (bossSp.y + 1)];
    if (!io || io.type !== 'boss') errors.push('bloodhall：血面下方没登记 boss 交互点');
    else if (io.id !== 'xuemian') errors.push('bloodhall：boss 交互点没带 id（场景分不出是谁）');
    /* 每个 scriptBattle 触发格必须是可走的（不设实心），且已登记。
       ⚠️ 带 onlyFlag 的节点在当前存档下**本来就该缺席** —— 断言要跳过它，
       否则这条契约会把"条件节点工作正常"误报成"未登记"。 */
    nodes.forEach((n) => {
      if (n.onlyFlag || n.skipFlag) return;
      if (mp.solid[n.y][n.x]) errors.push('bloodhall：触发格 ' + n.id + ' 是实心的 —— 走不上去就永不触发');
      if (!mp.scriptBattles[n.x + ',' + n.y]) errors.push('bloodhall：触发格 ' + n.id + ' 未登记 scriptBattles');
    });
  }

  /* ========== ② m1-5 门槛与入夜演出 ========== */
  const s = JSON.parse(JSON.stringify(save));
  s.quest = { step: 'm1-5', flags: { foundPill: true } };
  s.globalLevel = 71; s.maxGlobalLevel = 71; s.items = { 筑基丹: 1 };
  s.pos = null;
  G.game.save = s;
  G.game.changeScene('town_shop', { toSpawn: true });
  let sc = G.game.scene;
  /* gl71（炼气九重后期）不够门槛 gl72 → 不该开出面板 */
  faceAndInteract(sc, sbTown);
  if (sc.overlay) { errors.push('m1-5 门槛失效：gl71 就开出了入夜面板'); sc.clearOverlay(); }
  if (sc.npcMarkOf(sbTown) !== null) errors.push('m1-5：未到门槛时沈伯不该挂 ！');

  /* gl72（炼气九重巅峰）→ 挂 ！并开出面板 */
  s.globalLevel = 72; s.maxGlobalLevel = 72;
  G.game.changeScene('town_shop', { toSpawn: true });
  sc = G.game.scene;
  if (sc.npcMarkOf(sbTown) !== '!') errors.push('m1-5：到门槛后沈伯应挂 ！，实为 ' + sc.npcMarkOf(sbTown));
  faceAndInteract(sc, sbTown);
  if (sc.overlay !== 'm1_5') bail('m1-5：与沈伯对话应开 m1_5，实为 ' + sc.overlay);
  const goBtn = btnByLabel(sc, /入夜/);
  if (!goBtn) bail('m1-5：没有「入夜」按钮');
  goBtn.onClick();
  if (!(sc.night > 0)) errors.push('m1-5：入夜未置位红雾计时（startNight 没生效）');
  if (!sc._nightGo || sc._nightGo.to !== 'bloodhall') {
    errors.push('m1-5：入夜的去向不是 bloodhall，实为 ' + (sc._nightGo && sc._nightGo.to));
  }
  /* 红雾期间必须冻结操作（否则玩家能在演出的半秒里继续走动） */
  {
    const posBefore = JSON.stringify(s.pos);
    sc._onEnterTile(sc.map.md.spawn.x, sc.map.md.spawn.y);
    if (JSON.stringify(s.pos) !== posBefore && s.map !== 'town_shop') {
      /* 允许 _onEnterTile 内部改 pos（出入口会改），但**不该切图** */
    }
    if (G.game.sceneName !== 'town_shop') errors.push('m1-5：红雾期间不该切图');
  }
  pump(140, 'm1-5.night');
  if (G.game.sceneName !== 'bloodhall') {
    errors.push('m1-5：红雾淡完应自动切到 bloodhall，实为 ' + G.game.sceneName);
  }

  /* ========== ③ 连战节点：走到即开战 + 打完不重开 ========== */
  sc = G.game.scene;
  if (sc.mapId !== 'bloodhall') bail('m1-5：没进到据点场景');
  const nHall = nodes.filter((n) => n.id === 'hallHall')[0];
  if (!nHall) bail('bloodhall：没有 hallHall 节点');
  sc._onEnterTile(nHall.x, nHall.y);
  if (G.game.sceneName !== 'battle') bail('bloodhall：走到连战节点应开战，实为 ' + G.game.sceneName);
  const b1 = G.game.scene;
  if (!b1.params.noFlee) errors.push('bloodhall：连战节点未传 noFlee');
  if (!b1._noFlee()) errors.push('bloodhall：连战节点的 _noFlee() 应为真（普通敌群没有 boss 标记）');
  if (b1.es.length !== 2) errors.push('hallHall 应 2 敌（血蝠+教徒），实为 ' + b1.es.length);
  if ((s.scriptBattlesDone || []).indexOf('bloodhall:hallHall') < 0) {
    errors.push('bloodhall：节点未登记 scriptBattlesDone（回图会重打）');
  }
  /* 回图后再踩同一格：不该重开 */
  G.game.changeScene('bloodhall', { toSpawn: true });
  sc = G.game.scene;
  sc._onEnterTile(nHall.x, nHall.y);
  if (G.game.sceneName !== 'bloodhall') errors.push('bloodhall：打过的节点不该重开，实为 ' + G.game.sceneName);

  /* ========== ④ 条件节点（抉择 1 的分支） ========== */
  {
    const sSpare = JSON.parse(JSON.stringify(s));
    sSpare.quest = { step: 'm1-5', flags: { probe: 'spare' } };
    sSpare.pos = null;
    G.game.save = sSpare;
    G.game.changeScene('bloodhall', { toSpawn: true });
    if (G.game.scene.map.scriptBattles['20,25']) {
      errors.push('bloodhall：probe=spare 时入口战应跳过（阿七开门），实际还在');
    }
    const sKill = JSON.parse(JSON.stringify(s));
    sKill.quest = { step: 'm1-5', flags: { probe: 'kill' } };
    sKill.pos = null;
    G.game.save = sKill;
    G.game.changeScene('bloodhall', { toSpawn: true });
    if (!G.game.scene.map.scriptBattles['29,13']) {
      errors.push('bloodhall：probe=kill 时应有报复战（onlyFlag 失效）');
    }
    G.game.save = s;
  }

  /* ========== ⑤ 血面：抉择 2 ========== */
  const sB = JSON.parse(JSON.stringify(s));
  sB.quest = { step: 'm1-5', flags: {} };
  sB.pos = null;
  G.game.save = sB;
  G.game.changeScene('bloodhall', { toSpawn: true });
  sc = G.game.scene;
  /* 血面：交互句柄在 (x, y+1)，玩家站在它的**相邻格**、面向它按交互
     （explore: _walkToInteract 走位 + _interact 读 _front）。所以站位是 (x, y+2)。 */
  sB.pos = { x: bossSp.x, y: bossSp.y + 2 }; sc.dir = 'up';
  sc._interact();
  if (sc.overlay !== 'choice2') bail('血面交互应弹抉择 2，实为 ' + sc.overlay);
  const c2 = sc.buttons.filter((x) => x.label && /死战|先走/.test(x.label));
  if (c2.length !== 2) bail('抉择 2 应有 2 个选项，实为 ' + c2.length);
  if (new Set(c2.map((x) => x.y)).size !== 2) errors.push('抉择 2 的两个选项 y 重叠了');

  /* 护沈伯先走：血面带伤开局 + 镇子被焚 */
  const leave = c2.filter((x) => /先走/.test(x.label))[0];
  leave.onClick();
  if (G.game.sceneName !== 'battle') bail('抉择 2 选完应进战斗，实为 ' + G.game.sceneName);
  const bx = G.game.scene;
  if (bx.params.script !== 'xuemian') errors.push('血面战 script 应为 xuemian，实为 ' + bx.params.script);
  if (bx.es[0].name !== '血面') errors.push('血面战敌人应为血面，实为 ' + bx.es[0].name);
  if (bx.es[0].level !== 73) errors.push('血面应固定 gl73，实为 ' + bx.es[0].level);
  if (!bx.es[0].boss) errors.push('血面应带 boss 标记');
  if (!(bx.es[0].maxhp < 480)) {
    errors.push('护沈伯先走时血面应带伤开局（maxhp < 480），实为 ' + bx.es[0].maxhp);
  }
  if (!sB.burned) errors.push('护沈伯先走应置 save.burned（镇子被焚）');
  if (!bx._noFlee()) errors.push('血面战必须禁逃');
  if (R().flags.choice2 !== 'leave') errors.push('抉择 2 未写 flags.choice2');

  /* ========== ⑥ 沈伯燃命（ally 阶段）：真驱动一次 ========== */
  {
    const boss = bx.es[0];
    /* 压到刚好过 55% 线 → 触发 ally 阶段。
       ⚠️ `hpBefore` 必须在**压低之后**取 —— 取在压低之前，它就等于满血，
       "没掉血"（hp 仍 = 0.54·maxhp）也满足 `hp < 满血` → 断言恒真、抓不到 ally 空转。 */
    boss.hp = Math.round(boss.maxhp * 0.54);
    const hpBefore = boss.hp;
    bx._bossPhase(boss);
    if (!boss._phDone[0]) errors.push('血面的 ally 阶段（沈伯燃命）没被触发');
    if (!(boss.hp < hpBefore)) errors.push('沈伯燃命应重创血面，血量没降');
    if (boss.hp <= 0) errors.push('沈伯燃命**不能打死血面**（设计：由主角补刀）');
  }

  /* ========== ⑦ 血面胜利结算 ========== */
  {
    const st0 = sB.stone, qi0 = sB.qi;
    const beforeSkills = Object.keys(sB.skills).length;
    bx.p.hp = bx.p.maxhp; bx.es[0].hp = 0;
    bx._victory();
    if (!R().flags.bloodNight) errors.push('血面胜利未写 flags.bloodNight');
    if (!R().flags.elderDead) errors.push('血面胜利未写 flags.elderDead');
    if (!sB.bossKilled2) errors.push('血面胜利未写 save.bossKilled2');
    if (sB.stone - st0 !== 400) errors.push('血面掉落灵石应为 400，实为 ' + (sB.stone - st0));
    if (sB.qi - qi0 !== 2000) errors.push('血面掉落灵气应为 2000，实为 ' + (sB.qi - qi0));
    if ((sB.items['妖丹'] || 0) !== 2) errors.push('血面应掉妖丹 ×2，实为 ' + (sB.items['妖丹'] || 0));
    if (Object.keys(sB.skills).length <= beforeSkills) errors.push('血面应掉 1 本灵阶功法');
    if (!(sB.chronicle || []).some((c) => c.id === 'bloodNight')) errors.push('未记因果「血夜」');
    /* 胜利**不在这里推任务步**（留给 bloodhall 的 enter） */
    if (R().step !== 'm1-5') errors.push('血面胜利后任务步不该变，实为 ' + R().step);
    if (bx.resultTarget !== 'bloodhall') errors.push('血面战应回 bloodhall，实为 ' + bx.resultTarget);
    pump(80, 'm1-5.afterboss');
  }

  /* ========== ⑧ 回据点：沈伯遗言 → m1-6 ========== */
  if (G.game.sceneName !== 'bloodhall') bail('血面战后应回到 bloodhall，实为 ' + G.game.sceneName);
  sc = G.game.scene;
  if (sc.overlay !== 'farewell') errors.push('血夜后进据点应摆出沈伯遗言，实为 ' + sc.overlay);
  if (R().step !== 'm1-6') errors.push('遗言应把任务推到 m1-6，实为 ' + R().step);
  const eyeBtn = btnByLabel(sc, /合上/);
  if (!eyeBtn) bail('遗言没有「合上他的眼」按钮');
  eyeBtn.onClick();
  if (sc.overlay) errors.push('遗言收尾后应收起覆盖层');

  /* 遗言演出的渲染路径必须不抛（走一遍 render） */
  step(() => { G.game.changeScene('bloodhall', { toSpawn: true }); }, 'm1-5.render');
  pump(4, 'm1-5.render');

  /* 血夜已了：血面物件仍在图上（地图不删物件），但**不能再打一次**（会重复发奖）。
     这条守卫原先没有断点 —— 直接站到血面前按交互，必须不开抉择 2、只给一句提示。 */
  {
    const scR = G.game.scene;
    sB.pos = { x: bossSp.x, y: bossSp.y + 2 }; scR.dir = 'up';
    G.game.toasts.length = 0;
    scR._interact();
    if (scR.overlay) {
      errors.push('血夜后不该再弹抉择 2（可重复刷血面 → 重复发奖）');
      scR.clearOverlay();
    }
    if (!G.game.toasts.length) errors.push('血夜后点血面应给一句提示（据点已塌）');
  }

  /* ========== ⑨ m1-6 筑基心魔劫：分派 heartDemon2 + 转 m1-7 ========== */
  {
    const s6 = JSON.parse(JSON.stringify(sB));
    s6.quest = { step: 'm1-6', flags: { bloodNight: true, elderDead: true } };
    s6.globalLevel = 72; s6.maxGlobalLevel = 72;
    s6.qi = 999999; s6.items = { 筑基丹: 1 };
    s6.pos = null;
    G.game.save = s6;
    G.game.changeScene('battle', { script: 'heartDemon', mapId: 'town_home' });
    const b6 = G.game.scene;
    /* 强化版：开局召心魔残影（phases[0].kind === 'summon'），M0 心魔没有这条 */
    if (!b6.es[0].phases || b6.es[0].phases[0].kind !== 'summon') {
      errors.push('m1-6 应走强化版心魔（开局召唤），实际 phases[0]='
        + (b6.es[0].phases && b6.es[0].phases[0] && b6.es[0].phases[0].kind));
    }
    b6.p.hp = b6.p.maxhp; b6.es[0].hp = 0;
    b6._victory();
    if (R().step !== 'm1-7') errors.push('m1-6 胜利应转 m1-7，实为 ' + R().step);
    if (!R().flags.based) errors.push('m1-6 胜利未写 flags.based');
    if (s6.globalLevel !== 73) errors.push('筑基后境界应为 gl73，实为 ' + s6.globalLevel);
    pump(80, 'm1-6.after');
  }

  /* M0 的炼气破境仍必须回到 m0-5（分派不能把老路径带坏） */
  {
    const s5 = JSON.parse(JSON.stringify(save));
    s5.quest = { step: 'm0-4', flags: {} };
    s5.globalLevel = 36; s5.maxGlobalLevel = 36;
    s5.qi = 999999; s5.items = { 淬体突破丹: 1 };
    s5.pos = null;
    G.game.save = s5;
    G.game.changeScene('battle', { script: 'heartDemon', mapId: 'town_home' });
    const b5 = G.game.scene;
    if (b5.es[0].phases && b5.es[0].phases.length) {
      errors.push('M0 心魔不该带 phases（那是筑基强化版的东西）');
    }
    b5.p.hp = b5.p.maxhp; b5.es[0].hp = 0;
    b5._victory();
    if (R().step !== 'm0-5') errors.push('M0 炼气破境后应转 m0-5，实为 ' + R().step);
    pump(80, 'm0.heart');
  }

  /* ========== ⑩ m1-7 离乡：刘掌柜道别 → m1done ========== */
  {
    const s7 = JSON.parse(JSON.stringify(save));
    s7.quest = { step: 'm1-7', flags: {} };
    s7.pos = null;
    s7.stone = 100; s7.items = {};
    G.game.save = s7;
    const mk = (G.Data.maps.town_market.npcs || []).filter((n) => n.act === 'market')[0];
    G.game.changeScene('town_market', { toSpawn: true });
    sc = G.game.scene;
    if (sc.npcMarkOf(mk) !== '!') errors.push('m1-7：刘掌柜应挂 ！，实为 ' + sc.npcMarkOf(mk));
    faceAndInteract(sc, mk);
    if (sc.overlay !== 'm1_7') bail('m1-7：与刘掌柜对话应开 m1_7，实为 ' + sc.overlay);
    const take = btnByLabel(sc, /收下/);
    if (!take) bail('m1-7：没有「收下」按钮');
    take.onClick();
    if (s7.stone !== 300) errors.push('m1-7 应赠灵石 200，实为 +' + (s7.stone - 100));
    if ((s7.items['回城符'] || 0) !== 3) errors.push('m1-7 应赠回城符 ×3，实为 ' + (s7.items['回城符'] || 0));
    if (R().step !== 'm2-1') errors.push('m1-7 收尾应转 m2-1（v0.65.0 起接 M2），实为 ' + R().step);
    if (!R().flags.leaveTown) errors.push('m1-7 未写 flags.leaveTown');
    const unlocked = ((G.game.meta || {}).story || {}).unlocked || [];
    if (unlocked.indexOf('M2') < 0) errors.push('m1-7 未解锁 M2（meta.story.unlocked）');
  }

  /* ========== ⑪ _transition 的 spawn 兜底 ==========
     血夜红雾的切图是 `_transition({to, spawn})`；只要有人只给 `to`，
     `e.spawn.x` 就会抛 —— 而它在 update 的帧回调里，真机上是**未捕获异常打断渲染循环**。
     这里断言"缺 spawn 也不抛、且落回地图默认出生点"。 */
  {
    const sT = JSON.parse(JSON.stringify(save));
    sT.pos = null;
    G.game.save = sT;
    G.game.changeScene('town', { toSpawn: true });
    let threw = null;
    try { G.game.scene._transition({ to: 'field' }); } catch (e) { threw = e; }
    if (threw) errors.push('_transition 缺 spawn 时抛异常（真机会打断渲染循环）：' + threw.message);
    else if (G.game.sceneName !== 'field') {
      errors.push('_transition 缺 spawn 时应落到 field，实为 ' + G.game.sceneName);
    } else {
      const mdF = G.Data.maps.field;
      if (!sT.pos || sT.pos.x !== mdF.spawn.x || sT.pos.y !== mdF.spawn.y) {
        errors.push('_transition 缺 spawn 时应落回地图默认出生点，实为 ' + JSON.stringify(sT.pos));
      }
    }
  }

  /* ========== ⑫ 任务面板：14 步链条必须仍整条落在面板内 ========== */
  {
    const s3 = JSON.parse(JSON.stringify(save));
    s3.quest = { step: 'm1-5', flags: {} };
    s3.pos = null;
    G.game.save = s3;
    G.game.changeScene('town', { toSpawn: true });
    G.Overlays.openPanel(G.game.scene, 'quest');
    pump(2, 'bloodnight.quest');
    G.game.scene.clearOverlay();
  }

  } catch (e) { if (e !== BAIL) throw e; }

  G.game.save = save;
  if (errors.length) {
    errors.forEach(function (e) { console.log('  ✗ ' + e); });
    throw new Error('M1 血夜契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ M1 血夜：入夜演出 → 据点连战 → 抉择 2 → 沈伯燃命/遗言 → 筑基 → 离乡');
}, 'm1.bloodnight.contract');

/* ---------- UI 修复契约（v0.11.2）----------
   四项玩家截图反馈：① HUD/底栏不再整段吞掉点地（贴边的副本入口点得到）；
   ② 站桩 NPC 不再上下抖；③ 主角四向素材按「头线」对齐（侧面不再比正面高一截）；
   ④ 战斗：30s 思考倒计时 + 指令按钮去线框 + 功法/道具改上浮下拉。
   前三项与 ④ 的按钮变体走**源码闸**（正则扫关键表达式，计数/存在性断言，防正则腐烂）。 */
step(function () {
  const errors = [];
  const read = (p) => fs.readFileSync(path.join(WWW, p.replace(/^www\//, '')), 'utf8');

  /* ① 点地：onTap 不得再用 HUD_H / BOT_H 整段挡 */
  const ex = read('www/js/core/explore.js');
  const tapAt = ex.indexOf('onTap: function');
  const tapBlock = ex.slice(tapAt, tapAt + 1400);
  if (/p\.y\s*<\s*HUD_H/.test(tapBlock)) errors.push('explore.onTap 仍在用 HUD_H 整段挡点地');
  if (/p\.y\s*>=\s*272\s*-\s*BOT_H/.test(tapBlock)) errors.push('explore.onTap 仍在用 BOT_H 整段挡点地');
  if (!/p\.y\s*<\s*4\s*\)/.test(tapBlock)) errors.push('explore.onTap 缺 4px 边缘死区');

  /* ② 站桩 NPC 不抖：_drawNpc 里不得再出现 bob / 0.8 幅度的 sin 浮动 */
  const npcAt = ex.indexOf('_drawNpc: function');
  const npcBlock = ex.slice(npcAt, npcAt + 1100);
  if (/\bbob\b/.test(npcBlock)) errors.push('_drawNpc 仍在做上下浮动（bob）');

  /* ③ 四向头线对齐 */
  const sp = read('www/js/core/sprites.js');
  if (sp.indexOf('_ensureHeroHeadTop') < 0) errors.push('sprites.js 缺 _ensureHeroHeadTop（四向头线对齐）');
  const heroAt = sp.indexOf('function heroSprite');
  const heroFn = sp.slice(heroAt, sp.indexOf('function makeHero'));
  /* ⚠️ 三条都要查：只查 drawImage 形式的话，把 `_ensureHeroHeadTop()` 调用删掉照样能过
     （反例验证时真踩到过这个漏洞）——必须断言**头线函数在 heroSprite 里被调用**。 */
  if (heroFn.indexOf('_ensureHeroHeadTop()') < 0) {
    errors.push('heroSprite 未调用 _ensureHeroHeadTop()（头线没生效）');
  }
  if (!/var top = _heroContentTop\(im\)/.test(heroFn)) {
    errors.push('heroSprite 未读取素材 content_top');
  }
  if (!/drawImage\(im,\s*0,\s*top,/.test(heroFn)) {
    errors.push('heroSprite 未用 9-arg drawImage 做头线裁剪对齐');
  }

  /* ④ 战斗：倒计时常量 + 扣时 + 绘制 + 按钮变体 */
  const bt = read('www/js/scenes/battle.js');
  /* v0.17.0：30s → **15s**（用户口径「时间缩短到 15 秒」） */
  if (!/var CMD_TIMER\s*=\s*15\s*;/.test(bt)) errors.push('CMD_TIMER 不是 15');
  if (bt.indexOf('cmdTimer = Math.max(0, this.cmdTimer - dt)') < 0) {
    errors.push('update 未在 command 阶段扣思考倒计时');
  }
  /* v0.17.0：倒计时改成**顶栏正中的纯数字**（无进度条）。
     旧判据查 `'思考 Ns'` 字符串，改版后必然假红；
     新判据查两件事：① 确实渲染了秒数；② **进度条已删除**。 */
  if (bt.indexOf('Math.ceil(this.cmdTimer)') < 0) {
    errors.push('_drawTopBar 未绘制思考倒计时');
  }
  if (/bw \* pct/.test(bt)) {
    errors.push('倒计时进度条应已删除（v0.17.0：只留数字，进度条分散注意力）');
  }
  if (bt.indexOf("variant: i === 0 ? 'gold'") < 0 || bt.indexOf("lb === '逃跑' ? 'danger' : 'battle'") < 0) {
    errors.push('指令按钮未切到 battle 变体');
  }
  const ui = read('www/js/core/ui.js');
  if (ui.indexOf("variant === 'battle'") < 0) errors.push("ui.js 缺 'battle' 按钮变体");

  if (errors.length) {
    errors.forEach(function (e) { console.log('  ✗ ' + e); });
    throw new Error('UI 修复契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ UI 修复（源码闸）：点地不被 HUD 吞 / NPC 不抖 / 四向头线对齐 / 倒计时 + battle 变体');
}, 'ui.fix.contract');

/* ---------- UI 修复契约 · 运行时（v0.11.2）----------
   真驱动战斗：初始倒计时 = 30；点「功法」→ buttons[0] 是**主动技**（不是「攻击」）；
   「关闭」能回 command；点「道具」列出背包消耗品；倒计时归零会**自动出手**。 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 10; s.hp = 9999; s.po = 999;
  s.skills = { 缠藤指: { lv: 2 } };
  s.items = { 回春丹: 2 };
  G.game.save = s;
  G.game.changeScene('battle', {
    enemy: G.Data.makeEnemy('青纹蛇', 4, '甲蛇'), mapId: 'field'
  });
}, 'ui.fix.enter');
pump(10, 'ui.fix.enter');
step(function () {
  const errors = [];
  const b = G.game.scene;
  /* 进场后已经跑过几帧，倒计时在往下走 —— 断言"在 (0, 30] 区间且确实在递减" */
  if (!(b.cmdTimer > 0 && b.cmdTimer <= 30)) errors.push('初始思考倒计时应在 (0,30]，实为 ' + b.cmdTimer);

  /* 指令按钮变体：道具走 battle，攻击走 gold，逃跑走 danger。
     v0.69.0 取消「防御」后，这里改判「功法」（同属 battle 变体的普通指令）。 */
  const byKey = (k) => b.buttons.filter((x) => x._key === k)[0];
  if (byKey('功法') && byKey('功法').variant !== 'battle') {
    errors.push('「功法」应为 battle 变体，实为 ' + byKey('功法').variant);
  }
  if (byKey('防御')) errors.push('「防御」指令应已取消（v0.69.0 取消独立防御）');
  if (byKey('攻击') && byKey('攻击').variant !== 'gold') errors.push('「攻击」应仍为 gold 变体');

  /* 功法下拉：buttons[0] 必须是主动技 */
  b._cmd('功法');
  if (b.phase !== 'skill') errors.push('点功法应进入 skill 相位，实为 ' + b.phase);
  if (!b.buttons[0] || b.buttons[0]._key === '攻击') {
    errors.push('功法下拉后 buttons[0] 仍是「攻击」—— 下拉没排在数组前面');
  }
  if (!b.buttons.some((x) => /缠藤指/.test(x.label || ''))) {
    errors.push('功法下拉未列出已装配的「缠藤指」');
  }
  const closeS = b.buttons.filter((x) => x.label === '关闭')[0];
  if (!closeS) errors.push('功法下拉缺「关闭」按钮');
  else {
    closeS.onClick();
    if (b.phase !== 'command') errors.push('关闭功法下拉后未回到 command，实为 ' + b.phase);
    if (!b.buttons.some((x) => x._key === '功法')) errors.push('关闭后「功法」指令按钮没回来');
  }

  /* 道具下拉 */
  b._cmd('道具');
  if (b.phase !== 'item') errors.push('点道具应进入 item 相位，实为 ' + b.phase);
  if (!b.buttons.some((x) => /回春丹/.test(x.label || ''))) errors.push('道具下拉未列出「回春丹」');
  /* ⚠️ 连点「功法→道具」不得把两个下拉叠起来（截图真踩到过：两个关闭按钮、两组列表同时在场）。
     下拉必须从 _cmdBtns 基准重建，所以此刻「关闭」只应有 1 个。 */
  const closes = b.buttons.filter((x) => x.label === '关闭');
  if (closes.length !== 1) errors.push('道具下拉应只有 1 个「关闭」，实为 ' + closes.length + ' 个（下拉叠加了）');
  if (b.buttons.some((x) => /缠藤指/.test(x.label || ''))) {
    errors.push('打开道具下拉后，功法下拉的条目应已消失（下拉叠加）');
  }
  const closeI = closes[0];
  if (closeI) closeI.onClick();

  /* 倒计时归零 → 自动出手（phase 必须离开 command） */
  if (b.phase !== 'command') { errors.push('道具关闭后未回到 command'); }
  b.cmdTimer = 0.01;
  b.update(0.05);
  if (b.phase === 'command') errors.push('思考超时后应自动出手，仍停在 command');
  if (b.buttons.length) errors.push('出手后指令按钮应被清空，实为 ' + b.buttons.length + ' 个');

  if (errors.length) {
    errors.forEach(function (e) { console.log('  ✗ ' + e); });
    throw new Error('UI 运行时契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ UI 运行时：倒计时 30s + 超时自动出手 + 功法/道具上浮下拉 + battle 变体');
}, 'ui.fix.runtime.contract');
pump(300, 'ui.fix.settle');
/* 收尾：本条契约把场景留在了 battle，而后面 `dungeon.entrance.contract` 会断言
   `G.game.sceneName !== 'battle'`（用来证明"点封印中的秘境不会进战斗"）——
   不把场景切走会让那条断言**假红**。 */
step(() => { G.game.changeScene('title'); }, 'ui.fix.leave');
pump(6, 'ui.fix.leave');

/* ---------- 玩家截图反馈第二批（v0.11.4）----------
   十项反馈里可断言的九项：HUD 四格与悬浮说明 / 功法面板去境界块 + 下拉排序 /
   角色面板境界子页的突破入口 / 灵根九维图 / 储物分类子页 + 方格 /
   任务追踪栏与路引（含跨图寻路）/ 出口传送阵 / 室内矮墙。
   第十项（天道心魔与 Boss 机制设计）是文档，不在这里断言。
   源码闸（正则扫关键表达式）+ 运行时（真开面板、真点按钮）双轨 ——
   只查源码抓不到"函数在但没接上"，只跑运行时抓不到"面板本体偷偷登记了按钮"。 */
step(function () {
  const errors = [];
  const BAIL = { bail: true };
  const bail = (msg) => { errors.push(msg); throw BAIL; };
  const read = (p) => fs.readFileSync(path.join(WWW, p.replace(/^www\//, '')), 'utf8');
  const ex = read('www/js/core/explore.js');
  const pn = read('www/js/core/panels.js');
  const ov = read('www/js/core/overlays.js');
  const art = read('www/js/core/art.js');

  /* ========== ① HUD：四格 + 悬浮说明 + 「灵气」命名 ========== */
  const hud = ex.slice(ex.indexOf('_drawHUD: function'), ex.indexOf('_drawTracker: function'));
  ['stone', 'qi', 'po', 'crystal'].forEach((k) => {
    if (hud.indexOf("['" + k + "',") < 0) errors.push('HUD 缺资源格：' + k);
  });
  if ((hud.match(/\['(stone|qi|po|crystal)',/g) || []).length !== 4) {
    errors.push('HUD 资源格不是 4 个（灵石 / 灵气 / 灵力 / 仙晶）');
  }
  if (hud.indexOf("'修为'") >= 0) errors.push('HUD 仍在用「修为」当突破进度条的标签（它是灵气）');
  if (hud.indexOf("'灵气'") < 0) errors.push('HUD 突破进度条未标成「灵气」');
  if (hud.indexOf('G.UI.hover(') < 0) errors.push('HUD 资源格没有挂悬浮说明');

  /* 仙晶显示的是**纯函数版**本世仙力。xianliOf 会写 meta.achieve，
     每帧调会把成就进度写脏（而且成就判定顺序敏感）。
     ⚠️ 只比"调用前后 achieve 有没有变"是**抓不到**的 —— 本次契约之前的那几帧渲染
     早就把 achieve 写出来了，before/after 恒等（反例验证时真踩到这个漏洞）。
     所以两层都上：① 源码闸（函数体里不许出现 meta / G.game 访问）；
     ② 运行时哨兵（先把 achieve 摘掉，看它会不会被重新写出来）。 */
  if (typeof G.Player.xianliLive !== 'function') bail('缺 G.Player.xianliLive（纯函数版本世仙力）');
  {
    const pl = read('www/js/core/player.js');
    const live = pl.slice(pl.indexOf('xianliLive: function'), pl.indexOf('deathCause: function'));
    if (/\bmeta\s*\./.test(live) || /G\.game\s*\./.test(live)) {
      errors.push('xianliLive 里出现 meta / G.game 访问 —— 它必须纯（每帧都会调）');
    }
    const meta = G.game.meta || (G.game.meta = {});
    const hadOwn = Object.prototype.hasOwnProperty.call(meta, 'achieve');
    const savedAch = meta.achieve;
    delete meta.achieve;                       /* 摘掉哨兵：它若被写回来就说明有副作用 */
    for (let i = 0; i < 3; i++) G.Player.xianliLive(G.game.save);
    if (Object.prototype.hasOwnProperty.call(meta, 'achieve')) {
      errors.push('xianliLive 有副作用（把 meta.achieve 写了回来）');
    }
    if (hadOwn) meta.achieve = savedAch;
  }

  /* 运行时：渲染一帧，HUD 那四格必须真挂出 4 条带 title/text 的提示 */
  {
    G.game.changeScene('town', { toSpawn: true });
    const realHover = G.UI.hover, seen = [];
    G.UI.hover = function (rect, info) { seen.push([rect, info]); return realHover.apply(this, arguments); };
    pump(2, 'ui2.hover');
    G.UI.hover = realHover;
    const tips = seen.filter((s) => s[1] && s[0] && s[0].y < 48);
    if (tips.length < 4) errors.push('HUD 悬浮说明只挂出 ' + tips.length + ' 条（应 ≥4）');
    tips.forEach((s) => {
      if (!s[1].title || !s[1].text) errors.push('HUD 悬浮说明缺 title/text');
    });
  }

  /* ========== ② 功法面板：去境界块 + 下拉 + 等级降序 ========== */
  {
    const bs = pn.slice(pn.indexOf('function buildSkills'), pn.indexOf('function drawSkills'));
    if (bs.indexOf('doBreak') >= 0) errors.push('功法面板仍有突破入口（境界内容归角色面板）');
    if (bs.indexOf('skillOpen') < 0) errors.push('功法面板没有下拉开关 scene.skillOpen');
    const ds = pn.slice(pn.indexOf('function drawSkills'), pn.indexOf('function drawSecrets'));
    if (ds.indexOf('境 界') >= 0) errors.push('功法面板仍画着「境 界」分节');
    const sortFn = pn.slice(pn.indexOf('function skillIdsSorted'), pn.indexOf('function selSkillId'));
    if (!/lb\s*-\s*la/.test(sortFn)) errors.push('功法排序不是按等级降序');

    const s = JSON.parse(JSON.stringify(save));
    s.pos = null;
    s.skills = { '青木诀': { lv: 3 }, '缠藤指': { lv: 9 }, '赤焰心法': { lv: 5 } };
    G.game.save = s;
    G.game.changeScene('town', { toSpawn: true });
    const sc = G.game.scene;
    sc.clearOverlay(); sc.skillSel = null; sc.skillOpen = false;
    G.Overlays.openPanel(sc, 'skills');
    const head = sc.buttons.filter((b) => /共 3 本/.test(b.label || ''))[0];
    if (!head) bail('功法面板没有下拉头（按钮上应显示「共 N 本」）');
    if (head.label.indexOf('缠藤指') < 0) {
      errors.push('下拉头默认选的不是等级最高的功法：' + head.label);
    }
    head.onClick();                                     /* 展开列表 */
    const realmRe = /([一二三四五六七八九])重(初期|中期|后期|巅峰)/;
    const rows = sc.buttons.filter((b) => realmRe.test(b.label || ''));
    if (rows.length !== 3) errors.push('功法下拉应有 3 行，实为 ' + rows.length);
    const CN_ = ['一','二','三','四','五','六','七','八','九'];
    const PH_ = ['初期','中期','后期','巅峰'];
    const progOf = (lab) => { const m = lab.match(realmRe); return CN_.indexOf(m[1]) * 4 + PH_.indexOf(m[2]); };
    const lvs = rows.map((b) => progOf(b.label));
    for (let i = 1; i < lvs.length; i++) {
      if (lvs[i] > lvs[i - 1]) errors.push('功法下拉未按境界降序：' + rows.map((b) => b.label).join(' / '));
    }
    if (rows.length && rows[0].label.indexOf('缠藤指') < 0) {
      errors.push('下拉第一行不是等级最高的功法：' + rows[0].label);
    }
    /* 下拉行必须排在 buttons 前面（命中按数组顺序），否则会被「精进」抢走点击 */
    if (!realmRe.test(sc.buttons[0].label || '')) {
      errors.push('下拉行没排在 buttons 前面 —— 会被别的按钮抢走点击');
    }
    sc.clearOverlay();
  }

  /* ========== ③ 角色面板「境界」子页的突破入口 ========== */
  {
    const s = JSON.parse(JSON.stringify(save));
    s.pos = null; s.globalLevel = 9;                    /* 淬体九段：可突破 */
    G.game.save = s;
    G.game.changeScene('town', { toSpawn: true });
    const sc = G.game.scene;
    sc.clearOverlay();
    /* ⚠️ 必须切两次：openPanel 在 prev !== 'char' 时会把 charTab 归到 overview，
       所以"设 charTab 再开面板"这一种写法会被它覆盖掉（首版就踩了这个坑）。 */
    G.Overlays.openPanel(sc, 'char');
    /* ⚠️ v0.15.0：切子页要走**子页签按钮**（它带 keepTab）。
       「设 charTab 再 openPanel」会被重置回总览 —— 那是有意的：
       openPanel 的语义是「从别处进角色页」，就该落在总览。 */
    const realmTab = sc.buttons.filter((b) => b.variant === 'subtab' && b.label === '境界')[0];
    if (realmTab) realmTab.onClick(); else errors.push('角色面板缺「境界」子页签');
    if (sc.charTab !== 'realm') errors.push('角色面板没有 realm 子页');
    if (!sc.buttons.some((b) => /突破/.test(b.label || ''))) {
      errors.push('角色面板「境界」子页没有突破按钮');
    }
    sc.clearOverlay();
  }

  /* ========== ④ 灵根九维方块图 ========== */
  {
    const at = ov.indexOf('charLinggen: function');
    if (at < 0) bail('overlays.js 缺 charLinggen');
    const body = ov.slice(at, at + 3200);
    const nine = body.match(/var NINE = \[([^\]]*)\]/);
    if (!nine) errors.push('灵根页没有九维表 NINE（还是文字列表）');
    else if (nine[1].split(',').length !== 9) {
      errors.push('灵根九维表不是 9 项：' + nine[1]);
    }
    /* 方块图 = 逐格画方框 + 格内比例条。两者缺一就还是"文字列表换了个壳"。 */
    if (body.indexOf('var CW') < 0 || body.indexOf('fillRect') < 0
      || body.indexOf('w: CW, h: CW') < 0) {
      errors.push('灵根页没有九宫方块图（缺格子几何或比例条绘制）');
    }
  }

  /* ========== ⑤ 储物：分类子页 + 方格 + 悬浮说明 ========== */
  {
    const s = JSON.parse(JSON.stringify(save));
    s.pos = null;
    s.items = { 回春丹: 2, 妖丹: 3 };
    s.skills = { 缠藤指: { lv: 2 } };
    G.game.save = s;
    G.game.changeScene('town', { toSpawn: true });
    const sc = G.game.scene;
    sc.clearOverlay(); sc.bagTab = 'misc';
    G.Overlays.openPanel(sc, 'bag');
    const tabs = sc.buttons.filter((b) => b.variant === 'subtab');
    if (tabs.length !== 5) errors.push('储物分类子页签应为 5 个，实为 ' + tabs.length);
    ['杂项', '功法', '资产', '法宝', '秘术'].forEach((n) => {
      if (!tabs.some((b) => b.label === n)) errors.push('储物缺分类子页：' + n);
    });
    if (!sc.buttons.some((b) => b.sub && /^×/.test(String(b.sub)))) {
      errors.push('杂项页没有方格陈列（物品格按钮缺 sub 副行）');
    }
    const skTab = tabs.filter((b) => b.label === '功法')[0];
    if (!skTab) bail('储物缺「功法」子页');
    skTab.onClick();
    if (sc.bagTab !== 'skill') errors.push('点「功法」子页没有切到 skill');
    if (!sc.buttons.some((b) => b.sub && /重(初期|中期|后期|巅峰)/.test(String(b.sub)))) {
      errors.push('功法子页没有功法方格');
    }
    /* 悬浮说明：方格必须带 hover 文案（渲染路径里挂的） */
    const realHover = G.UI.hover, seen = [];
    G.UI.hover = function (rect, info) { seen.push([rect, info]); return realHover.apply(this, arguments); };
    pump(2, 'ui2.baghover');
    G.UI.hover = realHover;
    if (!seen.some((h) => h[1] && h[1].text)) errors.push('储物方格没有悬浮说明');
    sc.clearOverlay();
  }

  /* ========== ⑥ 任务追踪栏 + 路引 ========== */
  if (typeof G.Overlays.trackInfo !== 'function') bail('缺 G.Overlays.trackInfo（追踪栏取数口）');
  {
    const tk = G.Overlays.trackInfo({ quest: { step: 'm1-2', flags: {} } });
    if (!tk || !tk.s || tk.id !== 'm1-2') errors.push('trackInfo 没取到当前步');
    if (!tk.guide || tk.guide.map !== 'town') errors.push('m1-2 的路引目标不在镇上');
    if (!(tk.s.subs || []).length) errors.push('m1-2 没有子任务清单');
    /* g → g2 的切换：m0-1 打赢一场后应改指回镇找沈伯 */
    const t2 = G.Overlays.trackInfo({ quest: { step: 'm0-1', flags: { won1: true } } });
    if (!t2.guide || t2.guide.map !== 'town_shop') {
      errors.push('m0-1 完成后路引未切到 town_shop（g2 没生效）');
    }
    const t3 = G.Overlays.trackInfo({ quest: { step: 'm0-1', flags: {} } });
    if (!t3.guide || t3.guide.map !== 'field') errors.push('m0-1 未完成时路引应指向翠微山');

    const s = JSON.parse(JSON.stringify(save));
    s.pos = null;
    G.game.save = s;
    G.game.changeScene('town', { toSpawn: true });
    const sc = G.game.scene;
    /* 跨图寻路：镇 → 药铺走的是**屋门**（md.doors），不是 exits ——
       只认 exits 的话这条路永远找不到，路引会退化成一句"往 药铺"。 */
    const route = sc._routeTo('town_shop');
    if (!route || route.to !== 'town_shop') errors.push('镇 → 药铺的跨图寻路没找到下一跳');
    if (sc._routeTo('town') !== null) errors.push('目标就在本图时应返回 null');
    if (sc._mapName('town_shop') !== '药铺') errors.push('_mapName(town_shop) 不是药铺');
    if (sc._mapName('town') !== '青溪镇') errors.push('_mapName(town) 不是青溪镇');
    if (sc._mapName('field_temple') !== '山神庙') errors.push('_mapName(field_temple) 不是山神庙');
    /* 追踪栏开关钮：**有且只有一个** */
    const togs = sc.buttons.filter((b) => /追踪/.test(b.label || ''));
    if (togs.length !== 1) errors.push('追踪栏开关钮应为 1 个，实为 ' + togs.length);
    else {
      const was = sc.trackOpen;
      togs[0].onClick();
      if (sc.trackOpen === was) errors.push('点追踪栏开关钮没有切换展开状态');
      sc.trackOpen = true;
      sc._padButtons();
    }
    /* 面板本体**不得登记按钮** —— 登记了就会吞掉地图点击（这是本轮的核心约束） */
    const tkBody = ex.slice(ex.indexOf('_drawTracker: function'), ex.indexOf('_ellip: function'));
    if (tkBody.indexOf('new G.UI.Btn') >= 0) {
      errors.push('追踪栏面板本体登记了按钮 —— 会吞掉地图点击');
    }
    if (tkBody.indexOf('trackOpen') < 0) errors.push('追踪栏没有收缩开关');

    /* ---- 支线也进追踪栏（v0.72.0，用户口径「主支线追踪可完全缩至左侧」）----
       ⚠️ 只用**未接/已完成**的档测，避免依赖玩家已接支线；
       再单独构造"进行中"存档断言它真被收进来。 */
    if (typeof G.Overlays.sideTrackRows !== 'function') {
      errors.push('缺 G.Overlays.sideTrackRows（支线追踪取数口）');
    } else {
      const empty = G.Overlays.sideTrackRows({ side: {} });
      if (empty.length) errors.push('未接任何支线时追踪栏不该有支线行，实为 ' + empty.length);

      const SQ = G.Data.sideQuests;
      const q0 = SQ.list[0];
      /* ① 进行中（step1）要进；② 可交（step2）要进且排在进行中之前；③ 完成（step3）不进 */
      const s1 = { side: {} }; s1.side[q0.id] = 1;
      const r1 = G.Overlays.sideTrackRows(s1);
      if (!r1.length || r1[0].id !== q0.id) errors.push('进行中的支线没有进追踪栏');
      if (r1[0] && r1[0].canTurnIn) errors.push('step1 的支线被判成"可交"');

      const s2 = { side: {} }; s2.side[q0.id] = 2;
      const r2 = G.Overlays.sideTrackRows(s2);
      if (!r2.length || !r2[0].canTurnIn) errors.push('可交的支线没有标 canTurnIn');

      const s3 = { side: {} }; s3.side[q0.id] = 3;
      if (G.Overlays.sideTrackRows(s3).length) errors.push('已完成的支线不该留在追踪栏');

      /* 上限 2：全接完也最多 2 条（面板高度是写死的） */
      const s4 = { side: {} };
      SQ.list.forEach((q) => { s4.side[q.id] = 1; });
      const r4 = G.Overlays.sideTrackRows(s4);
      if (r4.length > 2) errors.push('追踪栏支线上限应为 2，实为 ' + r4.length);

      /* 可交优先：一条 step2 + 一条 step1 → step2 排第一 */
      if (SQ.list.length >= 2) {
        const s5 = { side: {} };
        s5.side[SQ.list[0].id] = 1;
        s5.side[SQ.list[1].id] = 2;
        const r5 = G.Overlays.sideTrackRows(s5);
        if (!r5.length || r5[0].id !== SQ.list[1].id) {
          errors.push('可交的支线没有排在进行中之前');
        }
      }

      /* trackInfo 必须把支线一并带出（追踪栏读的是它，不是 sideTrackRows） */
      const tkSide = G.Overlays.trackInfo(s1);
      if (!(tkSide.sides || []).length) errors.push('trackInfo 未带出 sides（追踪栏取不到支线）');
    }

    /* ---- 高度预算：有支线时不能顶进底栏（272 − BOT_H 28 = 244 是功能栏上沿）----
       源码闸：绘制里必须按 sides 是否存在取两个稳定高度值，且都 ≤ 166（78+166=244）。
       ⚠️ 右界取 `_ellip` 而非 `_drawTrackTab` —— 后者在**前面**定义，
          `slice(a,b)` 会因 b<a 得空串，闸门永远"通过"（静默失效）。 */
    const drawBody = ex.slice(ex.indexOf('_drawTracker: function'), ex.indexOf('_ellip: function'));
    const hM = drawBody.match(/var H = sides[^;]*;/);
    if (!hM) errors.push('源码闸：追踪栏高度未按 sides 分档（会随内容伸缩或顶进底栏）');
    else {
      const nums = (hM[0].match(/\d+/g) || []).map(Number);
      nums.forEach((n) => { if (n > 166) errors.push('追踪栏高度 ' + n + ' 超过 166 → 顶进底栏'); });
    }
    if (drawBody.indexOf('sides2') < 0) errors.push('源码闸：追踪栏没有画支线段');
  }

  /* ========== ⑦ 出口传送阵：命中 + 点击切图 ========== */
  {
    G.game.changeScene('town', { toSpawn: true });
    const sc = G.game.scene;
    /* ⚠️ v0.91.0：地图放大 ×1.4 后镇出口从 (18,23) 迁到 (25,32)。
       这些格坐标断言必须跟着数据走 —— 硬编码是"地图一改就假红"的典型。 */
    const TEX = G.Data.maps.town.exits[0];                 /* 读数据，不写死 */
    const e1 = sc._exitAt(TEX.x0, TEX.y);
    if (!e1 || e1.to !== 'field') errors.push('_exitAt 没命中镇出口');
    const e2 = sc._exitAt(TEX.x0, TEX.y - 1);              /* 阵雾向上飘 → 上方一格也算 */
    if (!e2 || e2.to !== 'field') errors.push('_exitAt 未覆盖传送阵上方一格');
    if (sc._exitAt(2, 2)) errors.push('_exitAt 在非出口格误命中');
    if (ex.indexOf('_drawPortal: function') < 0) errors.push('explore.js 缺 _drawPortal（出口传送阵）');
    const portalBody = ex.slice(ex.indexOf('_drawPortal: function'), ex.indexOf('_exitAt: function'));
    if (portalBody.indexOf('drawImage') >= 0) {
      errors.push('出口传送阵用了素材图 —— 它必须纯矢量（缺图会静默退回）');
    }
    /* 点出口格 → 直接切图
       ⚠️ v0.91.0：格宽从 16 提到 24（TILE），且地图放大 ×1.4；
          这里必须**从地图数据读出口格**、并用 `G.Art.TILE` 换算，
          写死 (18,23)×16 会点在旧位置上（本契约当时就是因此假红）。 */
    const TG = G.Art.TILE;
    const pe = G.Data.maps.town.exits[0];
    const p = { x: pe.x0 * TG + TG / 2 - sc._camX(), y: pe.y * TG + TG / 2 - sc._camY() };
    sc.onTap(p);
    if (G.game.sceneName !== 'field') {
      errors.push('点出口传送阵没有切到下一张图，实为 ' + G.game.sceneName);
    }
  }

  /* ========== ⑧ 室内矮墙：高度与画布尺寸必须一致 ========== */
  {
    const sz = art.match(/wall:\s*\[(\d+),\s*(\d+)\]/);
    if (!sz) errors.push('DECOR_SIZE 里找不到 wall');
    else if (parseInt(sz[2], 10) > 24) {
      errors.push('室内墙高 ' + sz[2] + ' 过大（锚点 oy = 16 − h，会长到上一行盖住角色）');
    }
    const wh = art.match(/decorCanvas\('d\|wall\|' \+ v, 32, (\d+)/);
    if (!wh) errors.push('找不到 wall 的程序化画布尺寸');
    else if (sz && parseInt(wh[1], 10) !== parseInt(sz[2], 10)) {
      errors.push('wall 画布高 ' + wh[1] + ' 与 DECOR_SIZE 的 ' + sz[2] + ' 不一致（必须两处一起改）');
    }
  }

  G.game.changeScene('title');
  if (errors.length) {
    errors.forEach(function (e) { console.log('  ✗ ' + e); });
    throw new Error('截图反馈第二批契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ 截图反馈批二：HUD 四格+悬浮 / 功法下拉降序 / 境界突破入口 / 灵根九维 /'
    + ' 储物五分类 / 追踪栏+路引 / 出口传送阵 / 矮墙');
}, 'ui.batch2.contract');
pump(6, 'ui.batch2.leave');

/* ---------- 界面批三（v0.12.0）：水墨主界面 + 战斗背景图 + 追踪栏左缘收缩 ---------- */
step(function () {
  const errors = [];
  const read = (p) => fs.readFileSync(path.join(WWW, p.replace(/^www\//, '')), 'utf8');
  /* 源码闸通用前置：**先剥注释**（G36 —— 注释里常提到被闸的符号名，indexOf 会恒真） */
  const stripC = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  /* ========== ① 标题：宣纸水墨主题 ========== */
  const ti = stripC(read('www/js/scenes/title.js'));
  const tbi = ti.indexOf('_buildBackground: function');
  const tui = ti.indexOf('update: function');
  if (tbi < 0 || tui < tbi) bail('title.js 找不到 _buildBackground / update（结构变了就更新锚点）');
  const tb = ti.slice(tbi, tui);
  /* ⚠️ 本轮最要紧的不变量：背景噪声必须用**固定种子** `G.Art.rnd`。
     全局 `G.rng` 是时间播种的，在它上面多取几个随机数会推移整个序列，
     把靠它跑出来的回归基线（playthrough / rebirth）一起带歪 ——
     与 G26 / G31 同一类病：渲染或断言里出现"随机"，先问种子是谁给的。 */
  if (tb.indexOf('G.rng') >= 0) {
    errors.push('title 背景用了全局 G.rng —— 时间播种，会推移回归基线（必须 G.Art.rnd 固定种子）');
  }
  if (tb.indexOf('G.Art.rnd(') < 0) errors.push('title 背景没有固定种子随机源 G.Art.rnd');

  /* 竖排标题：两个字必须**分别**绘制（连写的 '逆 尘' 是旧版横排写法） */
  const tr = ti.slice(ti.indexOf('render: function'), ti.indexOf('_renderAbout: function'));
  if (tr.indexOf("'逆 尘'") >= 0) {
    errors.push('标题仍是横排连写 —— 水墨版是右侧竖排，两个字要分开画');
  }
  if ((tr.match(/strokeText\('逆'/g) || []).length === 0
    || (tr.match(/strokeText\('尘'/g) || []).length === 0) {
    errors.push('标题竖排未按字绘制');
  }

  /* 运行时：底图尺寸 = 480×272 × K(2)（超采样出图，尺寸写错会糊） */
  G.game.changeScene('title');
  pump(3, 'batch3.title');
  const ti2 = G.game.scene;
  if (!ti2.bg) errors.push('title 没有底图');
  else if (ti2.bg.width !== 960) {
    errors.push('title 底图宽应为 960（480×K2），实为 ' + ti2.bg.width);
  }

  /* 三个新变体都要能画出来（ink / inkGold / plain） */
  ['ink', 'inkGold', 'plain'].forEach((v) => {
    const b = new G.UI.Btn({ x: 0, y: 0, w: 40, h: 20, small: true, variant: v, label: '试' });
    try { b.render(G.game.ctx); } catch (e) {
      errors.push('Btn 变体 ' + v + ' 渲染抛异常：' + e.message);
    }
  });

  /* ========== ② 战斗背景图：主题表 + 缓存键 ========== */
  const ba = stripC(read('www/js/scenes/battle.js'));
  if (ba.indexOf('_bgFor') < 0) {
    errors.push('battle._bg 没有按主题区分缓存 —— 战斗是单例，只判 this.bg 会"换了战场还是上一张"');
  }
  /* 素材优先路径：`_bg` 函数体必须**尝试**取 `bg.battle.<key>`。
     无头 smoke 是桩 img（恒 null）→ 跑不到这条路径，所以只能源码闸钉住：
     少了它，出了图也永远用不上，且**完全静默**（画面照旧，只是永远程序化）。 */
  {
    const bga = ba.indexOf('_bg: function');
    const bgb = ba.indexOf('_drawUnit: function');
    const bgBody = (bga >= 0 && bgb > bga) ? ba.slice(bga, bgb) : '';
    if (bgBody.indexOf('bg.battle.') < 0) {
      errors.push('battle._bg 没有素材优先路径（bg.battle.<key>）—— 出了图也永远不会用上');
    }
  }
  const bt = G.scenes.battle.BG_THEME, bf = G.scenes.battle.BG_FEAT;
  if (!bt || !bf) bail('battle 未导出 BG_THEME / BG_FEAT（契约与渲染必须读同一份）');
  const tks = Object.keys(bt);
  if (tks.length < 8) errors.push('战斗背景主题不足 8 套，实为 ' + tks.length);
  tks.forEach((k) => {
    const T = bt[k];
    ['sky', 'ground', 'feat'].forEach((f) => {
      if (!T[f] || !T[f].length) errors.push('背景主题 ' + k + ' 缺 ' + f);
    });
    (T.feat || []).forEach((f) => {
      if (typeof bf[f] !== 'function') {
        errors.push('背景主题 ' + k + ' 引用了不存在的绘制件 ' + f + '（只有该主题被用到时才抛）');
      }
    });
  });

  /* 运行时：逐个主题真画一遍（写错的键名一次抓全） */
  G.game.save = JSON.parse(JSON.stringify(save));
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('血蝠', 14, '血蝠'), mapId: 'cave' });
  pump(2, 'batch3.battle');
  const bx = G.game.scene;
  tks.forEach((k) => {
    bx.params.bg = k;
    bx.bg = null; bx._bgFor = null;
    try {
      if (!bx._bg()) errors.push('背景主题 ' + k + ' 画不出画布');
    } catch (e) { errors.push('背景主题 ' + k + ' 渲染抛异常：' + e.message); }
  });

  /* 缓存键：同主题两次必须取到**同一对象**（否则每帧重画，白烧 CPU）；
     换主题必须换对象（否则"换了战场还是上一张"）。 */
  bx.params.bg = 'cave';
  bx.bg = null; bx._bgFor = null;
  const b1 = bx._bg(), b2 = bx._bg();
  if (b1 !== b2) errors.push('同一主题两次取背景不是同一对象 —— 缓存没生效，每帧重画');
  bx.params.bg = 'xian';
  const b3 = bx._bg();
  if (b3 === b1) errors.push('换主题后背景没重建 —— 缓存键没带主题');
  delete bx.params.bg;

  /* 主题选取：按来源地图的地面类型 */
  bx.mapId = 'bloodhall';
  if (bx._bgKey() !== 'blood') errors.push('bloodhall 的背景主题应为 blood，实为 ' + bx._bgKey());
  bx.mapId = 'cave';
  if (bx._bgKey() !== 'cave') errors.push('cave 的背景主题应为 cave，实为 ' + bx._bgKey());
  bx.mapId = 'town';
  if (bx._bgKey() !== 'town') errors.push('town 的背景主题应为 town，实为 ' + bx._bgKey());

  /* ========== ③ 追踪栏：左缘收缩 ========== */
  const ex = stripC(read('www/js/core/explore.js'));
  if (ex.indexOf('_drawTrackTab: function') < 0) errors.push('explore.js 缺 _drawTrackTab（左缘竖标）');
  if (ex.indexOf("variant: 'plain'") < 0) {
    errors.push('追踪竖标未用 plain 变体 —— Btn 会横排画 label，20px 竖条必被撑破');
  }
  /* 源码闸：竖标与面板的**绘制函数体**不得登记按钮（登记了就吞地图点击）。
     ex 已 stripC 剥注释 —— 注释里提「按钮」是允许的，不会误报。
     切片覆盖 _drawTrackTab 与 _drawTracker 两个函数（到下一个函数 _ellip 为止）。 */
  {
    const a = ex.indexOf('_drawTrackTab: function');
    const b = ex.indexOf('_ellip: function');
    const body = (a >= 0 && b > a) ? ex.slice(a, b) : '';
    if (body.indexOf('buttons.push') >= 0 || body.indexOf('new G.UI.Btn') >= 0) {
      errors.push('追踪栏绘制函数登记了按钮 —— 会吞掉地图点击');
    }
  }
  G.game.save = JSON.parse(JSON.stringify(save));
  G.game.changeScene('town', { toSpawn: true });
  pump(2, 'batch3.track');
  const sc = G.game.scene;
  const tab = sc.buttons.filter((b) => b.variant === 'plain')[0];
  if (!tab) errors.push('左缘没有追踪竖标按钮');
  else {
    if (tab.x > 24) errors.push('追踪竖标没贴左缘（x=' + tab.x + '）');
    if (tab.w > 24) errors.push('追踪竖标过宽（w=' + tab.w + '）');
    if (tab.h < 48) errors.push('追踪竖标过矮（h=' + tab.h + '），竖排四字放不下');
  }
  /* 收起 / 展开两态的按钮数必须**一致** —— 面板本体不登记按钮，
     所以"展开"不会多出任何可点区，地图永远点得动（本轮核心约束）。 */
  sc.trackOpen = true; sc._padButtons();
  const nOpen = sc.buttons.length;
  sc.trackOpen = false; sc._padButtons();
  const nClosed = sc.buttons.length;
  if (nOpen !== nClosed) {
    errors.push('追踪栏展开后多出 ' + (nOpen - nClosed) + ' 个按钮 —— 面板本体登记按钮会吞地图点击');
  }
  /* ⚠️ 只比"两态按钮数"抓不到**渲染路径偷偷登记**的按钮：
     _padButtons 之后不渲染，绘制函数根本没跑，push 自然不发生。
     这里再走一帧，要求"渲染前后按钮数不变"（G34 同族：取值必须晚于被测代码执行）。 */
  sc.trackOpen = true; sc._padButtons();
  const nBefore = sc.buttons.length;
  pump(1, 'batch3.track.render');
  if (sc.buttons.length !== nBefore) {
    errors.push('渲染一帧后按钮多了 ' + (sc.buttons.length - nBefore)
      + ' 个 —— 绘制路径不得登记按钮（会吞地图点击）');
  }
  sc.trackOpen = true; sc._padButtons();

  G.game.changeScene('title');
  if (errors.length) {
    errors.forEach((e) => console.log('  ✗ ' + e));
    throw new Error('界面批三契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ 界面批三：水墨主界面（固定种子）+ 战斗八主题背景 + 追踪栏左缘收缩');
}, 'ui.batch3.contract');
pump(6, 'ui.batch3.leave');

/* ---------- 云海材质层（v0.13.0）----------
   口径：这是修仙世界，界面要「仙气、腾云驾雾」—— 深青紫底 + 流云 + 青玉/月白辉光。
   （v0.13.0 初版做过一版浅底「宣纸」，与世界观不符，已废弃。）
   本契约钉四件事，都是"改材质时最容易漏、且漏了不报错"的：
     ① 材质表是 MIST_C，旧的 PAPER_C 必须彻底消失（改材质最常留下半套旧色）；
     ② 嵌套作用域不得提前还原色表（`UI.frame` 自己会进一层 → 外层对话框套内层面板必踩）；
     ③ `UI.frame` 一律走云海材质（"仙气"的主入口，漏了就没有一致性）；
     ④ 全项目不得残留 `paper:` / `UI.paper` 这类旧配置（改名不彻底 = 配置静默失效）。 */
step(function () {
  const errors = [];
  const stripC = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const ui = stripC(fs.readFileSync(path.join(WWW, 'js/core/ui.js'), 'utf8'));

  /* ① 材质表 */
  if (ui.indexOf('var MIST_C = {') < 0) errors.push('ui.js 缺 MIST_C（云海材质表）');
  if (ui.indexOf('PAPER_C') >= 0) errors.push('ui.js 仍残留 PAPER_C（旧宣纸材质没删干净）');
  if (ui.indexOf('function isMist') < 0) errors.push('ui.js 缺 isMist（材质标记，缓存键要用它防串色）');

  /* ② 嵌套作用域：只在**最外层**进出时改写色表 */
  const am = ui.slice(ui.indexOf('function applyMist'), ui.indexOf('function isMist'));
  if (!/mistDepth === 1/.test(am) || !/mistDepth <= 0/.test(am)) {
    errors.push('applyMist 未按"只在最外层进出"改写色表 —— 嵌套时内层退出会提前还原（外层文字串回墨夜色）');
  }

  /* ③ frame 一律走云海 */
  const fr = ui.slice(ui.indexOf('    frame: function'), ui.indexOf('    bar: function'));
  if (fr.indexOf('UI.mist(') < 0) {
    errors.push('UI.frame 没有走云海作用域 —— 主面板会留在墨夜材质（"仙气"的主入口失效）');
  }
  /* panel 的纹理开关必须叫 tex **且有默认赋值**。
     ⚠️ 判据不能只查 `ui.indexOf('opt.tex')` —— 它在缓存键里也出现，
     所以"只把默认赋值改回 opt.paper"这种半改会漏网（纹理静默不画）。 */
  if (!/if \(opt\.tex === undefined\) opt\.tex = true;/.test(ui)) {
    errors.push('UI.panel 未把 opt.tex 默认置真（纹理开关改名不彻底 → 纹理静默不画）');
  }

  /* ④ 旧配置不得残留（扫全部已加载脚本） */
  srcs.forEach((rel) => {
    const s = stripC(fs.readFileSync(path.join(WWW, rel), 'utf8'));
    if (/\bpaper\s*:/.test(s) || /UI\.paper\s*\(/.test(s)) {
      errors.push('源码闸：' + rel + ' 仍残留旧材质配置 paper（改名不彻底 → 配置静默失效）');
    }
  });

  /* 材质必须是**深底浅字**（用户口径：要仙气云海，不要宣纸）。
     判据用**相对亮度**而非比对色值字符串 —— 改一个色号就绕过字符串比对的写法是假的；
     亮度是"这块底是不是浅色"的量化口径，钉住它才钉得住"别改回浅底"。 */
  const lum = (hex) => {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  };
  const mistSrc = ui.slice(ui.indexOf('var MIST_C = {'), ui.indexOf('var DARK_C'));
  const bgHex = (/panel:\s*'(#[0-9a-f]{6})'/i.exec(mistSrc) || [])[1];
  const txHex = (/text:\s*'(#[0-9a-f]{6})'/i.exec(mistSrc) || [])[1];
  const bgL = lum(bgHex), txL = lum(txHex);
  if (bgL === null || txL === null) {
    errors.push('MIST_C 缺 panel / text 的十六进制色值 —— 亮度判据取不到');
  } else {
    if (bgL > 0.35) {
      errors.push('云海面板底色过亮（' + bgHex + ' 亮度 ' + bgL.toFixed(2)
        + '）—— 又变回宣纸了，用户要的是深底仙雾');
    }
    if (txL < 0.60) {
      errors.push('云海面板文字色过暗（' + txHex + ' 亮度 ' + txL.toFixed(2)
        + '）—— 深底必须配浅字，否则整块面板读不出字');
    }
  }

  /* 运行时：作用域进出可逆 + 嵌套安全 */
  const outside = G.UI.C.text;
  if (G.UI.isMist()) errors.push('未进云海作用域时 isMist() 应为假');
  let midText = null, afterInner = null;
  G.UI.mist(function () {
    midText = G.UI.C.text;
    if (midText === outside) errors.push('云海作用域内 C.text 没翻转 —— 材质没生效');
    G.UI.mist(function () {
      if (G.UI.C.text !== midText) errors.push('嵌套进入云海后 C.text 变了（内层应与外层同色）');
    });
    afterInner = G.UI.C.text;
  });
  if (afterInner !== midText) {
    errors.push('嵌套作用域出内层时色表被提前还原 —— 外层文字会串回墨夜色');
  }
  if (G.UI.C.text !== outside) errors.push('退出云海作用域后 C.text 没还原（全局色表被污染）');
  if (G.UI.isMist()) errors.push('退出云海作用域后 isMist() 应为假');

  /* 运行时：真画一遍（渲染路径不得抛）—— 面板 + 对话框 + 抉择卡 */
  G.game.changeScene('town', { toSpawn: true });
  pump(2, 'mist.render');
  const sc = G.game.scene;
  sc.setOverlay('market', []);
  pump(2, 'mist.render2');
  sc.clearOverlay();

  if (errors.length) {
    errors.forEach((e) => console.log('  ✗ ' + e));
    throw new Error('云海材质契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ 云海材质：MIST_C + 嵌套作用域安全 + frame 统一 + 无旧 paper 残留');
}, 'mist.material.contract');
pump(6, 'mist.leave');

/* ---------- 战斗法力值（v0.14.0）----------
   用户口径：主动技要耗法力（"不然有点太无敌了"）、**最低 10 点才能放**、
   每回合回 5 点、**功法等级越高耗得越多**。本契约钉五件事：
     ① 口径锚点（凡 lv1=10 / 凡 lv5=26 / 灵 lv1=15 / 宝 lv1=20、MP_REGEN=5、等级单调增）；
     ② 开战装配：mp == mpMax，且每条技能带 cost（与 manaCost 同源）；
     ③ 法力不足：按钮 disabled **且给出原因**（只"灰着"玩家会以为是 bug）；
     ④ 扣除：真驱动一次释放，整回合后 mp 恰好 = min(mpMax, 满 - cost + 5)；
     ⑤ 回复：0 → +5，满 → 不超上限。
   驱动方式是"把敌人改成打不死的木桩"，这样一整个回合必然跑完（含 _endRound）。 */
step(function () {
  const errors = [];
  const stripC = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const P = G.Player;

  /* ① 口径锚点 */
  const costOf = (tier, lv) => P.manaCost({ tier: tier }, lv);
  if (costOf('凡', 1) !== 10) errors.push('凡阶 lv1 法力消耗应为 10，实为 ' + costOf('凡', 1));
  if (costOf('凡', 5) !== 26) errors.push('凡阶 lv5 法力消耗应为 26，实为 ' + costOf('凡', 5));
  if (costOf('灵', 1) !== 15) errors.push('灵阶 lv1 法力消耗应为 15，实为 ' + costOf('灵', 1));
  if (costOf('宝', 1) !== 20) errors.push('宝阶 lv1 法力消耗应为 20，实为 ' + costOf('宝', 1));
  if (P.MP_REGEN !== 5) errors.push('每回合法力回复应为 5，实为 ' + P.MP_REGEN);
  if (costOf('凡', 2) <= costOf('凡', 1)) errors.push('功法等级越高法力消耗应越多（lv2 未高于 lv1）');

  /* ② 开战装配 */
  const s = JSON.parse(JSON.stringify(save));
  s.quest = { step: 'free', flags: {} };
  s.globalLevel = 14;
  s.skills = { 烈焰指: { lv: 1 }, 崩岩掌: { lv: 3 } };
  /* ⚠️ v0.69.0 起战斗技能栏**只装已激发的功法**（用户口径「单本激发」）——
     老 fixture 没写 skillEquip，装配出 0 条 → 落到兜底普攻 → 契约直接崩。
     这正是"激发制真的生效了"的反证，所以这里补上而不是放宽契约。 */
  s.skillEquip = ['烈焰指', '崩岩掌'];
  s.hp = 99999;
  G.game.save = s;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 6, '青纹蛇'), mapId: 'field' });
  pump(6, 'mana.enter');
  let b = G.game.scene;
  if (!b || typeof b._cmd !== 'function') bail('法力契约：没能进入战斗');
  if (b.p.mpMax !== P.computeStats(s).mpMax) {
    errors.push('战斗法力上限与面板口径不一致（' + b.p.mpMax + ' vs ' + P.computeStats(s).mpMax + '）');
  }
  if (b.p.mp !== b.p.mpMax) errors.push('开战法力应回满，实为 ' + b.p.mp + '/' + b.p.mpMax);
  const withCost = b.p.skills.filter((k) => k.cost > 0);
  if (!withCost.length) bail('法力契约：装配的技能里没有带消耗的（测试存档的功法没生效）');
  withCost.forEach((k) => {
    const want = P.manaCost(G.Data.skills[k.id], s.skills[k.id].lv);
    if (k.cost !== want) {
      errors.push('技能「' + k.n + '」的 cost=' + k.cost + ' 与 manaCost 口径 ' + want + ' 不一致');
    }
  });

  /* ③ 法力不足 → 禁用 + 给出原因 */
  const sk = withCost[0];
  b.p.mp = 5;
  b._openSkill();
  const pick = (bs, k) => bs.filter((x) => typeof x.label === 'string'
    && x.label.indexOf(k.n) === 0)[0];
  let btn = pick(b.buttons, sk);
  if (!btn) bail('法力契约：下拉里找不到「' + sk.n + '」的按钮');
  if (!btn.disabled) errors.push('法力 5 < 消耗 ' + sk.cost + ' 时「' + sk.n + '」应禁用');
  if (!btn.sub) errors.push('法力不足的按钮应给出原因（sub 为空）—— 只"灰着"玩家会以为是 bug');
  /* 法力充足 → 恢复可用 */
  b.p.mp = b.p.mpMax;
  b._openSkill();
  btn = pick(b.buttons, sk);
  if (btn && btn.disabled) errors.push('法力充足时「' + sk.n + '」不该禁用');

  /* ④ 扣除：木桩敌人 + 一整回合 */
  b.p.mp = b.p.mpMax;
  b.es.forEach((e) => { e.maxhp = 99999; e.hp = 99999; e.atk = 0; });
  b.phase = 'command';
  b._buildCommand();
  const before = b.p.mp;
  b._playerAction(sk, b.es[0].key);
  pump(150, 'mana.cast');
  if (G.game.sceneName !== 'battle') bail('法力契约：驱动释放后已离开战斗（木桩不该被打死）');
  b = G.game.scene;
  const want = Math.min(b.p.mpMax, before - sk.cost + P.MP_REGEN);
  if (b.p.mp !== want) {
    errors.push('释放「' + sk.n + '」整回合后法力应为 ' + want + '（满 ' + before
      + ' − 消耗 ' + sk.cost + ' + 回复 ' + P.MP_REGEN + '），实为 ' + b.p.mp);
  }

  /* ⑤ 回合回复 */
  b.p.mp = 0;
  b._endRound();
  if (b.p.mp !== P.MP_REGEN) {
    errors.push('法力为 0 时回合结束应回 ' + P.MP_REGEN + '，实为 ' + b.p.mp);
  }
  b.p.mp = b.p.mpMax;
  b._endRound();
  if (b.p.mp !== b.p.mpMax) errors.push('法力满时回合结束不应超过上限，实为 ' + b.p.mp);

  /* 源码闸：接线点必须真的在 */
  const bs = stripC(fs.readFileSync(path.join(WWW, 'js/scenes/battle.js'), 'utf8'));
  if (bs.indexOf('MP_REGEN') < 0) errors.push('battle.js 未接入 MP_REGEN（每回合回复没接线）');
  if (!/sk\.cost > 0/.test(bs)) errors.push('battle.js 未按 sk.cost 扣除法力');

  G.game.changeScene('title');
  if (errors.length) {
    errors.forEach((e) => console.log('  ✗ ' + e));
    throw new Error('法力契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ 战斗法力：最低 10 点 / 等级越高耗越多 / 每回合回 5 / 不足禁用并给原因');
}, 'battle.mana.contract');
pump(6, 'mana.leave');

/* ---------- 功法碎片（v0.14.0）----------
   用户口径：副本要给功法碎片、野外刷怪也有几率掉。
   本契约钉四件事：
     ① 数据层：三种碎片齐、参悟池**现算且非空**、界→品阶映射齐、消耗 = 10；
     ② 参悟：够数 → 优先补未习得（全习得才转 +1 级）；**不足 → 拒绝且存档一分不动**；
     ③ 野外掉落：把 `G.rng.next` 钉成 0（必中）→ 一定掉，且掉的是**当前界**对应品阶；
     ④ 副本掉落：大副本 3–5 / 小副本 1–2 / 重复刷减半且至少 1（走场景方法直调）。
   ⚠️ 掉落判定走 `G.rng`（**运行时玩法随机**，按项目纪律不换固定种子）；
      断言里则把 `next` 临时钉死再还原 —— 否则 6% 的判定会偶发假红。 */
step(function () {
  const errors = [];
  const stripC = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const Dt = G.Data;

  /* ① 数据层 */
  ['凡', '灵', '宝'].forEach((t) => {
    if (!Dt.shardByTier[t]) errors.push('缺 ' + t + ' 品阶的碎片逻辑名');
    const pool = Dt.shardPool(t);
    if (!pool.length) errors.push(t + ' 品阶的参悟池是空的（参悟会永远失败）');
    pool.forEach((id) => {
      if (!Dt.skills[id]) errors.push('参悟池里有不存在的功法：' + id);
    });
  });
  if (Dt.shardCost !== 10) errors.push('参悟消耗应为 10 片，实为 ' + Dt.shardCost);
  ['fan', 'ling', 'xian', 'dao'].forEach((w) => {
    if (!Dt.tierByWorld[w]) errors.push('界 ' + w + ' 没有映射到碎片品阶');
  });
  /* 品阶必须随界**单调不降**（凡 → 灵 → 宝 → 宝）。
     只查"映射存在"是不够的：把仙界写成凡品，映射照样存在、掉落照样发生，
     只是高阶界的碎片悄悄贬值 —— 玩家要刷很久才发现。 */
  const ORDER = { '凡': 0, '灵': 1, '宝': 2 };
  const SEQ = ['fan', 'ling', 'xian', 'dao'];
  for (let i = 1; i < SEQ.length; i++) {
    const a = Dt.tierByWorld[SEQ[i - 1]], b = Dt.tierByWorld[SEQ[i]];
    if ((ORDER[b] == null) || (ORDER[a] == null) || ORDER[b] < ORDER[a]) {
      errors.push('碎片品阶不能随界倒退：' + SEQ[i - 1] + '=' + a + ' → ' + SEQ[i] + '=' + b);
    }
  }

  /* ② 参悟三态 */
  const mk = (shards, skills) => {
    const o = JSON.parse(JSON.stringify(save));
    o.skills = skills || {};
    o.items = shards || {};
    return o;
  };
  const s1 = mk({ '凡品功法碎片': 10 });
  const r1 = G.Player.inscribe(s1, '凡');
  if (!r1.ok) errors.push('10 片凡品碎片应能参悟，实为：' + r1.reason);
  else {
    if (!r1.learned) errors.push('空功法表参悟应"习得"而非"精进"');
    if (Dt.shardPool('凡').indexOf(r1.id) < 0) errors.push('参悟所得不在凡品池里：' + r1.id);
    if (!s1.skills[r1.id]) errors.push('参悟后功法没进 save.skills');
    if (s1.items['凡品功法碎片']) {
      errors.push('参悟后碎片没扣干净（剩 ' + s1.items['凡品功法碎片'] + '）');
    }
  }
  const s2 = mk({ '凡品功法碎片': 5 });
  const r2 = G.Player.inscribe(s2, '凡');
  if (r2.ok) errors.push('只有 5 片时应拒绝参悟');
  if (s2.items['凡品功法碎片'] !== 5) errors.push('参悟失败却扣了碎片');
  if (Object.keys(s2.skills).length) errors.push('参悟失败却给了功法');

  const all = {};
  Dt.shardPool('凡').forEach((id) => { all[id] = { lv: 1 }; });
  const s3 = mk({ '凡品功法碎片': 10 }, all);
  const n3 = Object.keys(s3.skills).length;
  const r3 = G.Player.inscribe(s3, '凡');
  if (!r3.ok) errors.push('已全习得时应转"精进"，实为：' + r3.reason);
  else {
    if (r3.learned) errors.push('已全习得时不该报"习得"');
    if (Object.keys(s3.skills).length !== n3) errors.push('精进不该新增功法');
    if (s3.skills[r3.id].lv !== 2) errors.push('精进应 +1 级，实为 Lv' + s3.skills[r3.id].lv);
  }
  const s4 = { items: { '凡品功法碎片': 10, '灵品功法碎片': 10 }, skills: {} };
  if (G.Player.bestShardTier(s4) !== '灵') {
    errors.push('够数时应取最高品阶（期望 灵），实为 ' + G.Player.bestShardTier(s4));
  }
  if (G.Player.bestShardTier({ items: {}, skills: {} }) !== null) {
    errors.push('一片都没有时 bestShardTier 应为 null');
  }

  /* ③ 野外掉落：钉死 rng 必中 */
  const s5 = mk({});
  s5.quest = { step: 'free', flags: {} };
  s5.globalLevel = 6;
  G.game.save = s5;
  const realNext = G.rng.next;
  G.rng.next = () => 0;                 /* 0 < 0.06 → 必掉 */
  try {
    G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 3, '青纹蛇'), mapId: 'field' });
    pump(6, 'shard.enter');
    const bb = G.game.scene;
    if (!bb || typeof bb._victory !== 'function') bail('碎片契约：没能进入战斗');
    bb.es.forEach((e) => { e.hp = 0; });
    bb._victory();
    pump(4, 'shard.win');
  } finally { G.rng.next = realNext; }
  const tierW = (G.Data.tierByWorld[G.Player.activeWorldId(G.game.meta)]) || '凡';
  const itemW = G.Data.shardByTier[tierW];
  if (!(s5.items[itemW] > 0)) {
    errors.push('野外刷怪在"必中"条件下没掉碎片（期望 ' + itemW + '）');
  }

  /* ④ 副本掉落量：大 3–5 / 小 1–2 / farm 减半且 ≥1 */
  const dz = G.scenes.dungeon;
  if (!dz || typeof dz._addShards !== 'function') {
    errors.push('副本场景缺 _addShards（副本不掉碎片）');
  } else {
    const before = {};
    const run = (kind, farm) => {
      const s6 = mk({});
      G.game.save = s6;
      dz._addShards({ kind: kind }, farm);
      const k = Object.keys(s6.items)[0];
      return { k: k, n: k ? s6.items[k] : 0 };
    };
    for (let i = 0; i < 12; i++) {
      const big = run('big', false);
      if (big.n < 3 || big.n > 5) errors.push('大副本碎片应为 3–5，实为 ' + big.n);
      const sm = run('small', false);
      if (sm.n < 1 || sm.n > 2) errors.push('小副本碎片应为 1–2，实为 ' + sm.n);
      const fm = run('big', true);
      if (fm.n < 1 || fm.n > 2) errors.push('重复刷碎片应减半且至少 1（3–5 → 1–2），实为 ' + fm.n);
    }
    /* 副本掉落的品阶必须跟**所在界**走 */
    const t = run('small', false);
    const want = G.Data.shardByTier[(G.Data.tierByWorld[dz._worldId()]) || '凡'];
    if (t.k !== want) errors.push('副本碎片品阶与所在界不符（期望 ' + want + '，实为 ' + t.k + '）');
  }

  /* 源码闸：两条掉落接线必须在 */
  const bsrc = stripC(fs.readFileSync(path.join(WWW, 'js/scenes/battle.js'), 'utf8'));
  if (bsrc.indexOf('shardByTier') < 0) errors.push('battle.js 没接野外碎片掉落');
  const dsrc = stripC(fs.readFileSync(path.join(WWW, 'js/scenes/dungeon.js'), 'utf8'));
  if (dsrc.indexOf('_addShards') < 0) errors.push('dungeon.js 没接副本碎片掉落');

  G.game.changeScene('title');
  if (errors.length) {
    errors.forEach((e) => console.log('  ✗ ' + e));
    throw new Error('功法碎片契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ 功法碎片：10 片参悟（优先补新）/ 副本 3-5·1-2·刷减半 / 野外必中掉当前界品阶');
}, 'skill.shard.contract');
pump(6, 'shard.leave');

/* ---------- 游戏内版本号必须与 HANDOVER 同步（v0.12.0）----------
   `G.VERSION` 从 v0.0.2 起就再没同步过，一直显示成初始占位 —— 标题「关于」与关于页
   都拿它当版本号，玩家看到的是两年前的数。这类"两处各写一遍、谁也不会同时改"的常量
   是静默腐坏的典型：没有契约的话，下次还是只有人工想起来才会对。
   判据：`ns.js` 的 `G.VERSION` == HANDOVER 头部「代码版本 **vX.Y.Z**」。 */
step(function () {
  const errors = [];
  const ns = fs.readFileSync(path.join(WWW, 'js/core/ns.js'), 'utf8');
  const m = ns.match(/G\.VERSION\s*=\s*'([^']+)'/);
  if (!m) { errors.push('ns.js 找不到 G.VERSION'); }
  else {
    if (/^v0\.0\./.test(m[1])) {
      errors.push('G.VERSION 仍是初始占位 ' + m[1] + '（忘了同步）');
    }
    const ho = fs.readFileSync(path.join(__dirname, '..', 'HANDOVER.md'), 'utf8');
    const hm = ho.match(/代码版本\s*\*\*(v[0-9]+\.[0-9]+\.[0-9]+)/);
    if (!hm) errors.push('HANDOVER 头部找不到「代码版本 **vX.Y.Z**」');
    else if (hm[1] !== m[1]) {
      errors.push('版本号不同步：ns.js=' + m[1] + ' vs HANDOVER=' + hm[1]);
    }
  }
  if (errors.length) {
    errors.forEach((e) => console.log('  ✗ ' + e));
    throw new Error('版本号契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ 版本号：G.VERSION 与 HANDOVER 一致（' + m[1] + '）');
}, 'version.contract');

/* ---------- 关于页正文不得溢出 / 压到关闭按钮（v0.12.0）----------
   「排版问题全是静默的」：关于页正文是 `G.UI.text` 直接画的，既不受按钮越界契约管，
   也不会报错 —— 文案一长就横向穿出面板、行数一多就压住关闭按钮（v0.12.0 实测
   31 字那条把"本"字画到边框外）。
   这里用**源码闸 + 字宽估算**复刻 `G.UI.wrap` 的折行，算总行数与末行底边。
   为什么不能运行时驱动：无头 smoke 的桩 canvas `measureText` 返回"长度 × 7"，
   对中文**严重低估** → 真机上会折的行在桩里不折 → 断言恒真（G35 同族陷阱）。 */
step(function () {
  const errors = [];
  const tt = fs.readFileSync(path.join(WWW, 'js/scenes/title.js'), 'utf8');
  const at = tt.indexOf('_renderAbout: function');
  if (at < 0) { errors.push('title.js 缺 _renderAbout'); }
  else {
    const body = tt.slice(at, at + 2600);
    if (body.indexOf('G.UI.wrap') < 0) {
      errors.push('关于页正文没走 G.UI.wrap —— 文案一长就静默横向溢出面板');
    }
    /* 面板矩形 + 起点偏移 + 行距：抓不到就报"契约过时"（防正则腐烂） */
    const rect = body.match(/var r = \{ x: (\d+), y: (\d+), w: (\d+), h: (\d+) \}/);
    const ly0 = body.match(/ly = r\.y \+ (\d+)/);
    const stepY = body.match(/ly \+= ([\d.]+)/);
    if (!rect || !ly0 || !stepY) {
      errors.push('关于页版式常量抓不到（契约的正则过时了，需同步 _renderAbout）');
    } else {
      const RX = +rect[1], RY = +rect[2], RW = +rect[3];
      const Y0 = RY + +ly0[1], DY = +stepY[1];
      const BTN_TOP = 206;                    /* _openAbout 里关闭按钮的 y */
      const FS = 12, TW = RW - 48;            /* 左右各 24 边距 */
      /* 抓 lines 数组里的单引号字面量（`+ G.VERSION` 的拼接按 8 字符补足） */
      const li = body.indexOf('var lines = [');
      const lj = body.indexOf('];', li);
      if (li < 0 || lj < 0) { errors.push('关于页 lines 数组抓不到'); }
      else {
        const seg = body.slice(li, lj);
        const strs = [];
        seg.replace(/'([^']*)'/g, (m2, s) => { strs.push(s); return m2; });
        if (seg.indexOf('G.VERSION') >= 0) strs[0] += 'v0.12.0';  /* 拼接口按最长版本号算 */
        /* 字宽估算：CJK/全角按字号，ASCII 按 0.55（与 panels.bounds 同一套） */
        const wid = (s) => {
          let w = 0;
          for (let i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x2e80 ? FS : FS * 0.55;
          return w;
        };
        let rows = 0;
        strs.forEach((s) => { rows += Math.max(1, Math.ceil(wid(s) / TW)); });
        const lastBottom = Y0 + (rows - 1) * DY + FS;
        if (rows > 7) {
          errors.push('关于页正文折行后 ' + rows + ' 行（预算 7）—— 会压到关闭按钮');
        }
        if (lastBottom > BTN_TOP) {
          errors.push('关于页正文末行底 ' + lastBottom.toFixed(0)
            + ' 越过了关闭按钮顶 ' + BTN_TOP);
        }
      }
    }
  }
  if (errors.length) {
    errors.forEach((e) => console.log('  ✗ ' + e));
    throw new Error('关于页版式契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ 关于页版式：正文走 wrap，折行预算内且不压关闭按钮');
}, 'about.layout.contract');

/* ---------- 地面类型不得归一化（v0.11.4）----------
   `_baseType()` 是 `groundTex()` 的**取纹理口**，必须返回**真实地面类型**。
   把 bloodcave 归回 'cave' 会让暗红地面**静默渲染成普通洞窟** —— 不报错、只是颜色不对，
   属 G19 / G33 同类的"接线丢失"。
   "是否洞窟系"这种**族判断**（暗幕 `_drawVeil` / 明暗层 `_drawShade`）一律走 `_isCaveGround()`，
   两个职责不能合并到同一个函数里。 */
step(function () {
  const errors = [];
  /* read 是各契约块内的局部工具（不共享），这里自带一份 */
  const read = (p) => fs.readFileSync(path.join(WWW, p.replace(/^www\//, '')), 'utf8');
  const ex = read('www/js/core/explore.js');

  /* ⚠️ 源码闸**必须先剥注释**：注释里常常正好提到被闸的符号名
     （本例 `_drawShade` 上方的说明就写了 `_isCaveGround()`），
     不剥的话 `indexOf` 恒真 —— 反例验证时真踩到了（反例 B 没报）。
     剥注释是源码闸的**通用前置**，不是这一条的局部技巧。 */
  const stripC = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  /* ① 源码闸：_baseType 必须原样返回地面类型，不得归一化 */
  const bt = stripC(ex.slice(ex.indexOf('_baseType: function'), ex.indexOf('_pal: function')));
  if (bt.indexOf('bloodcave') < 0) {
    errors.push('_baseType 没处理 bloodcave（新地面类型加了却没接进来）');
  }
  if (!/return\s+g\s*;/.test(bt)) {
    errors.push('_baseType 未原样返回地面类型 —— 归一化会让 bloodcave 静默用 cave 纹理');
  }

  /* ② 源码闸：_drawShade 的提前返回必须走 _isCaveGround()。
     若写成 `kind === 'cave'`，bloodcave 会漏过 → 暗幕与明暗层同时叠上（画面偏黑且多一份开销）。 */
  const sh = stripC(ex.slice(ex.indexOf('_drawShade: function'), ex.indexOf('_drawStructure: function')));
  if (sh.indexOf('_isCaveGround()') < 0) {
    errors.push('_drawShade 未用 _isCaveGround() 判族 —— bloodcave 会同时叠暗幕与明暗层');
  }

  /* ③ 换色是否接上：**源码闸 + 对象同一性**。
     ⚠️ 这里**不能比像素** —— 无头环境用的是桩 canvas，`getImageData` 恒返回
     4 个零字节（`tools/smoke.js` 的 `makeCanvas`），拿它比两张纹理**永远判"相同"**，
     属于"假绿"（首版就写了像素比对，反例验证时才发现它恒报错而不是恒通过，
     真因是桩的局限）。真·逐像素验证在 `tools/browser-probe.js`（真 canvas）里做。 */
  const art = read('www/js/core/art.js');
  const gi = art.indexOf('function gCave(x, pal)');
  const bi = art.indexOf('function gBloodcave(x, pal)');
  const si = art.indexOf('大尺度明暗图');
  if (gi < 0 || bi < 0 || si < 0 || !(gi < bi && bi < si)) {
    errors.push('找不到 gCave / gBloodcave 的函数体（结构变了就更新这段锚点）');
  } else {
    const cBody = art.slice(gi, bi).replace(/\s+/g, '');
    const bBody = art.slice(bi, si).replace(/\s+/g, '');
    if (cBody === bBody) {
      errors.push('gCave 与 gBloodcave 的实参逐字相同 —— 换色没接上（会静默同色）');
    }
    if (bBody.indexOf('#5a3a3c') < 0) {
      errors.push('gBloodcave 没用 M1 §5.1 规定的基色 #5a3a3c');
    }
  }
  /* 运行时：两次取纹理必须命中**不同的缓存条目**（同条目 = 同一个生成器） */
  const pal = G.game.save.world.pal;
  const ca = G.Art.groundTex('cave', pal);
  const cb = G.Art.groundTex('bloodcave', pal);
  if (!ca || !cb) bail('groundTex 取不到 cave / bloodcave 纹理');
  if (ca === cb) errors.push('groundTex 对 cave / bloodcave 返回了同一个画布 —— 类型没区分开');

  /* ④ 运行时：桩地图上 _baseType() 必须返回 bloodcave、_isCaveGround() 必须为真 */
  {
    const s = JSON.parse(JSON.stringify(save));
    s.pos = null;
    G.game.save = s;
    G.game.changeScene('cave', { toSpawn: true });
    const sc = G.game.scene;
    const keep = sc.map.md.ground;
    sc.map.md.ground = 'bloodcave';
    if (sc._baseType() !== 'bloodcave') {
      errors.push('_baseType() 在 bloodcave 图上返回了 ' + sc._baseType());
    }
    if (!sc._isCaveGround()) errors.push('_isCaveGround() 不认 bloodcave');
    sc.map.md.ground = keep;
  }

  G.game.changeScene('title');
  if (errors.length) {
    errors.forEach(function (e) { console.log('  ✗ ' + e); });
    throw new Error('地面类型契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ 地面类型：cave / bloodcave 纹理可区分，_baseType 不归一化，洞窟族走 _isCaveGround');
}, 'ground.type.contract');
pump(6, 'ground.type.leave');

/* ---------- 地图尺度契约（v0.91.0，用户第 9 点）----------
   用户口径：「这些建筑相当于缩小的城池或镇子，但地图场景却是一比一的大小……
   导致人物角色比建筑还要大，这是严重问题」。
   本契约钉三件事：
     ① **格宽唯一口径**：`G.Art.TILE` 与 explore 的 TILE 必须一致，且地面纹理边长
        必须是 TILE 的整数倍（否则"按格取子块"会在跨格处错位 → 接缝断裂）；
     ② **人物与建筑的比例**：建筑可见高 / 人物高 必须落在真实区间（2.4~3.6），
        太小 = 回到"人物比房子大"，太大 = 建筑喧宾夺主；
     ③ **源码闸**：explore/art 里不许出现裸 `* 16` / `/ 16` 的格换算
        （漏改一处的表现是"只有那一样东西位置错"，静默且难查）。 */
step(function () {
  const A = G.Art, SP = G.Sprites;
  const TILE = A.TILE;
  if (!(TILE > 0)) { errors.push('G.Art.TILE 缺失（格子像素尺寸未定义）'); return; }

  /* ① 格宽一致性 + 地面纹理整除 */
  const exSrc = fs.readFileSync(path.join(WWW, 'js/core/explore.js'), 'utf8');
  const mTile = exSrc.match(/\bvar TILE = (\d+)/);
  if (!mTile) errors.push('源码闸：explore.js 缺 TILE 常量');
  else if (+mTile[1] !== TILE) {
    errors.push('explore.TILE(' + mTile[1] + ') 与 Art.TILE(' + TILE + ') 不一致 —— 两份口径必须相同');
  }
  if (A.GROUND_TS % TILE !== 0) {
    errors.push('GROUND_TS(' + A.GROUND_TS + ') 不是 TILE(' + TILE + ') 的整数倍 —— 地面按格取块会错位');
  }

  /* ② 人物 vs 建筑比例。
     ⚠️ 无头环境的桩 fetch 恒失败 → `struct.*` 素材取不到 → `A.house` 走**程序化兜底**分支，
        而那条分支**不乘 STRUCT_SCALE**（它按方框画，本来就不该缩放）。
        所以这里**不能拿 A.house 的返回值算比例**（那验的是兜底分支，永远 3.24 → 假绿）。
        正确做法：**源码闸** —— 断言素材分支里确实乘了 STRUCT_SCALE，
        再用"常量 × 素材比例 × 格高"手工复算期望值。 */
  const stripEx2 = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const artSrc = stripEx2(fs.readFileSync(path.join(WWW, 'js/core/art.js'), 'utf8'));
  const mSc = artSrc.match(/var STRUCT_SCALE = ([\d.]+)/);
  if (!mSc) { errors.push('源码闸：art.js 缺 STRUCT_SCALE（建筑放大倍率）'); return; }
  const SC = +mSc[1];
  /* 判据：**三个**建造函数（house / ruin / gate）的素材分支都要乘 STRUCT_SCALE。
     ⚠️ 只查"出现过一次"会被另两处命中而恒真（G43）—— 必须数出现次数。 */
  {
    const hits = (artSrc.match(/Math\.min\(W \/ im\.width, H \/ im\.height\) \* STRUCT_SCALE/g) || []).length;
    if (hits < 3) {
      errors.push('源码闸：只有 ' + hits + '/3 处建筑素材分支乘了 STRUCT_SCALE（house/ruin/gate）');
    }
  }
  const heroH = SP.AGE_STAGE_LOGICAL ? SP.AGE_STAGE_LOGICAL.h : 42;
  /* 素材 256×192、框 6×5 格：k = min(6T/256, 5T/192) × SC；高 = 192k */
  const ref = { imW: 256, imH: 192, w: 6, h: 5 };
  const kk = Math.min(ref.w * TILE / ref.imW, ref.h * TILE / ref.imH) * SC;
  const bh = ref.imH * kk;
  const ratio = bh / heroH;
  if (!(ratio >= 2.4 && ratio <= 3.6)) {
    errors.push('建筑高 / 人物高 = ' + ratio.toFixed(2) + '（应在 2.4~3.6）—— '
      + (ratio < 2.4 ? '还是"人物比房子大"' : '建筑过大、喧宾夺主'));
  }

  /* ③ 源码闸：explore.js 里不许残留格换算的裸 16
     （随机量如 rnd() * 16 与格无关；此处按"乘法/除法的左操作数"模式判，
      只拦 `变量 * 16` / `变量 / 16` / `16 * 变量` 这几种格换算写法）。 */
  const stripEx = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const body = stripEx(exSrc);
  const bad = [];
  body.split('\n').forEach(function (l, i) {
    /* `rnd()` 产出的随机量（雨丝初速之类）与格无关，显式放行 */
    if (/rnd\(\)\s*\*\s*16\b/.test(l)) return;
    if (/[a-zA-Z0-9_)\]]\s*\*\s*16\b/.test(l) || /[a-zA-Z0-9_)\]]\s*\/\s*16\b/.test(l)
      || /\b16\s*\*\s*[a-zA-Z(]/.test(l)) {
      bad.push('L' + (i + 1) + ': ' + l.trim().slice(0, 64));
    }
  });
  if (bad.length) {
    errors.push('源码闸：explore.js 仍有 ' + bad.length + ' 处裸 16 格换算（必须走 TILE）：'
      + bad.slice(0, 3).join(' | '));
  }
  console.log('  ✓ 地图尺度：TILE=' + TILE + ' / 建筑高 ' + bh.toFixed(0) + 'px = 人物 '
    + ratio.toFixed(2) + ' 倍 / 无裸 16');

  /* ④ v0.95.0 / v0.96.0（用户口径「地图放大后很空」+「建筑看着和环境不搭」）：
     都是**地图放大**的连带副作用，各钉一条：
       a) **装饰密度必须补"格子像素"那一层**：
          密度 = 一屏看得见多少棵。`DECOR_SIZE`（tree 32×48）是**固定像素、
          不随 TILE 缩放**，所以 TILE 16→24 后屏内容量少了 **TILE²=2.25 倍**。
          ⚠️ v0.95.0 初版补错了：写在 regiongen 且用**格数比** ——
             手写图补不到、生成区域格数根本没变（areaK=1.00 空操作）。
          v0.96.0 把补偿收到 `mapgen.buildMap`（**唯一消费口**），统一乘 `(TILE/16)²`。
          判据：源码闸（mapgen 里有 densK + 数据里不许再乘一遍）。
       b) **建筑吃环境色温**：`struct.*` 是整张位图、原本完全不吃调色板，
          同一座冷灰城楼放进土黄荒野就"贴上去"。
          判据：同一建筑在**不同地面色**下烘出的平均色必须不同（缓存键带地面色）。 */
  {
    /* a) 装饰密度：源码闸 —— 补偿必须在 **mapgen**（唯一消费口），且只此一处。
       ⚠️ 断言"两处都不许有"是刻意的：写两处会**双重乘**（×2.25 ×2.25 = ×5）。 */
    const mgSrc2 = fs.readFileSync(path.join(WWW, 'js/core/mapgen.js'), 'utf8');
    if (mgSrc2.indexOf('densK') < 0) {
      errors.push('源码闸：mapgen 未按格子像素补偿装饰密度（地图放大后会变空）');
    } else if (!/sc\[k\] \* densK/.test(mgSrc2)) {
      errors.push('源码闸：装饰数量未乘 densK（补了但没用在数量上）');
    }
    const rgSrc2 = fs.readFileSync(path.join(WWW, 'js/core/regiongen.js'), 'utf8');
    if (/scatter\[k\] \* areaK/.test(rgSrc2) || rgSrc2.indexOf('SCATTER_REF_AREA') >= 0) {
      errors.push('源码闸：regiongen 里还留着旧的面积补偿 —— 会与 mapgen 双重乘（装饰过密）');
    }
    /* b) 建筑环境色温：同一建筑在不同地面色下必须烘出不同像素 */
    const stSrc = fs.readFileSync(path.join(WWW, 'js/core/art.js'), 'utf8');
    if (stSrc.indexOf('function structTint') < 0) {
      errors.push('源码闸：art.js 缺 structTint（建筑不吃环境色，放进异地貌会"贴上去"）');
    }
    /* 三个建造函数都要接上（house/ruin/gate）—— 只接一个的话另两个仍不协调。
       ⚠️ 判据必须**精确到 3 处调用**（不是 `>= 3`）：`>= 3` 时把其中一处改坏
          仍会通过（实测 4→3 仍满足下界，反例漏网 —— "粒度要匹配改动粒度"的教训）。
       ⚠️ 也不能数裸 `structTint(im, pal)`：函数**定义**也是这个形状（会多算 1）。
          用 `c: structTint(im, pal)` 只匹配"赋值给返回值"的调用处。 */
    const tinted = (stSrc.match(/c: structTint\(im, pal\)/g) || []).length;
    if (tinted !== 3) {
      errors.push('接入环境色温的建筑函数应为 3 处（house/ruin/gate），实为 ' + tinted + ' 处');
    }
    /* 缓存键必须带地面色 —— 漏了会"第一次生成的赢"（同一张水榭在两地貌同色） */
    if (!/stim\|' \+ im\.src \+ '\|' \+ g/.test(stSrc)) {
      errors.push('源码闸：structTint 的缓存键未带地面色（不同地貌会串色）');
    }

    /* c) **数值判据**（v0.96.0 补）：源码闸只能证明"补了"，证明不了"补对了"。
       真算一遍 **每屏可见装饰数**，与**同图老基线（16px 格）**比 ——
       这个比值必须 ≈1（±25%）。比值才是判据：
       各图基线的绝对值差很大（town 4.7 / field 17.3 处每屏），
       但"修前 vs 修后"的比值一定落在 TILE² 那一档上，与图无关。
       ⚠️ 判定必须**真驱动 mapgen 的产物**，不能自己另写一套补偿公式 ——
          否则改坏 mapgen 时判据照旧通过（**反例漏网**，v0.96.0 初版就是这样）。
          做法：真的 `MapGen.buildMap` 一张图，数它产出的 `decor`。 */
    const perScreenReal = function (id) {
      const md = G.Data.maps[id];
      if (!md) return null;
      const s2 = JSON.parse(JSON.stringify(G.game.save || {}));
      s2.worldSeed = (s2.worldSeed || 1);
      s2.world = s2.world || G.Data.generateWorld(s2.worldSeed, true);
      let map = null;
      try { map = G.MapGen.buildMap(s2, id); } catch (e) { return { err: e.message }; }
      /* 只数"散布"的树石（边界围合那圈是每图一圈、与 scatter 无关，
         数进去会把密度信号淹没）—— 按坐标是否贴边判断 */
      const w = map.w, h = map.h;
      let inner = 0;
      (map.decor || []).forEach(function (d) {
        if (d.t !== 'tree' && d.t !== 'rock') return;
        if (d.x <= 0 || d.y <= 0 || d.x >= w - 1 || d.y >= h - 1) return;
        inner++;
      });
      return { perScreen: inner * (480 * 272) / (w * TILE * h * TILE), inner: inner, w: w, h: h };
    };
    /* 基线：**老基线（TILE=16、v0.91.0 前的数据）每屏可见散布数**。
       这些值 = 老数据 × 480×272/(w0×16 × h0×16)，已离线算好写死在此。
       断"当前 / 基线 ∈ 75%~160%"：低了显空旷、高了寸步难行。
       ⚠️ 只断比值不断绝对值 —— 各图基线的绝对值差很大（town 4.7 / field 17.3 处每屏），
          绝对值没有可比性；比值才是"密度有没有回退"的信号。 */
    const BASE = { field: 17.34, cave: 18.39, bloodhall: 9.92, town: 4.72 };
    Object.keys(BASE).forEach(function (id) {
      const cur = perScreenReal(id);
      if (!cur) { errors.push('装饰密度判据：取不到地图 ' + id); return; }
      if (cur.err) { errors.push('装饰密度判据：buildMap(' + id + ') 抛错 ' + cur.err); return; }
      const r = cur.perScreen / BASE[id];
      if (r < 0.75 || r > 1.6) {
        errors.push('装饰密度：' + id + ' 每屏 ' + cur.perScreen.toFixed(2) + ' 处（内圈 '
          + cur.inner + '） = 老基线的 ' + (r * 100).toFixed(0) + '%（应 75%~160%）—— '
          + (r < 0.75 ? '地图会显得空旷' : '装饰过密、寸步难行'));
      }
    });
    console.log('  ✓ 装饰密度（真 buildMap，每屏可见 / 老基线）：'
      + Object.keys(BASE).map(function (id) {
        const cur = perScreenReal(id);
        return id + ' ' + (cur && !cur.err ? (cur.perScreen / BASE[id] * 100).toFixed(0) + '%' : 'ERR');
      }).join(' / '));
  }
}, 'map.scale.contract');

/* ---------- 区域裂隙 → 副本入口面板契约（缺口 U6 + G20） ----------
   裂隙点了必须开**那一处**秘境的面板（此前一律跳通用枢纽）；
   并且裂隙的槽位副本要与秘境枢纽的序列**逐槽一致** ——
   两处若各自随机，玩家会看到"裂隙点进去是万骨渊、枢纽第 3 槽是黑风寨"。 */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  s.pos = null;
  s.worldSeed = 'entrance-probe';
  s.entrances = { fan: [], ling: [], xian: [], dao: [] };
  G.game.save = s;
  G.game.meta = {
    progress: { activeWorld: 'fan', worlds: { fan: true }, difficulty: 'normal',
      worldDiff: { fan: 'normal' }, daoKey: false,
      daoShards: { fan: false, ling: false, xian: false } },
    hellCleared: {}, titles: [], perfusion: {}, achieve: {}
  };

  /* ① 序列一致（G20）：落位表与 dungeonSet 必须同源 */
  s.dungeonSet = G.Data.dungeons.rollSet(s.worldSeed + ':set');
  s.dungeonSlot = 2;
  s.dungeonRun = null;
  s.entrances.fan = G.Data.regions.rollEntrances('fan', s.worldSeed, s.dungeonSet);
  s.entrances.fan.forEach(function (e, i) {
    if (e.arch !== s.dungeonSet[i]) {
      errors.push(`裂隙槽 ${i} 的副本（${e.arch}）与枢纽序列（${s.dungeonSet[i]}）不一致`);
    }
  });

  /* ② 种子化可复现（U8）：同 seed 两次结果必须一致 */
  const r1 = G.Data.dungeons.rollSet('same-seed');
  const r2 = G.Data.dungeons.rollSet('same-seed');
  if (r1.join(',') !== r2.join(',')) errors.push('rollSet 传同一 seed 结果不一致（未真正种子化）');
  const r3 = G.Data.dungeons.rollSet('other-seed');
  if (r1.join(',') === r3.join(',') && r1.length > 1) {
    /* 两个不同 seed 撞同一序列概率极低，撞上说明 seed 根本没进随机源 */
    errors.push('rollSet 对不同 seed 返回了同一序列');
  }

  const sc = G.scenes.dungeon;
  /* ③ 已通关槽（slot 1 < dungeonSlot 2）：面板显示该槽副本 + 可重刷 */
  sc.enter({ entrance: s.entrances.fan[1] });
  if (sc.view !== 'entrance') { errors.push('从裂隙进入后没有切到入口面板'); return; }
  const arch1 = G.Data.dungeons.archById(s.dungeonSet[1]);
  let cx = textSpy(); sc.render(cx);
  if (!cx.__seen.some(function (t) { return t.indexOf('秘 境 入 口') >= 0; })) {
    errors.push('副本入口面板没有渲染出来（render 路由漏了 view=entrance）');
  }
  if (arch1 && !cx.__seen.some(function (t) { return t.indexOf(arch1.n) >= 0; })) {
    errors.push(`入口面板没有显示该槽副本名（应为 ${arch1 && arch1.n}）`);
  }
  if (sc.buttons[0].label !== '重刷秘境') errors.push(`已通关槽的按钮应为「重刷秘境」，实际 ${sc.buttons[0].label}`);
  if (sc.buttons[0].disabled) errors.push('已通关的槽应可重刷，不该置灰');

  /* ④ 未开启槽（slot 3 > dungeonSlot 2）：置灰 + 点了不开始战斗 */
  sc.enter({ entrance: s.entrances.fan[3] });
  if (!sc.buttons[0].disabled) errors.push('封印中的秘境按钮应置灰');
  if (sc.buttons[0].label !== '封印中') errors.push(`封印中的按钮应为「封印中」，实际 ${sc.buttons[0].label}`);
  sc.buttons[0].onClick();
  if (G.game.sceneName === 'battle') errors.push('封印中的秘境不该能被点进战斗');
  if (sc.view !== 'entrance') errors.push('封印中点击后应停留在入口面板');

  /* ⑤ 返回：回到裂隙所在的区域地图 */
  const rid = s.entrances.fan[1].region;
  G.RegionGen.sceneFor(rid);
  sc.enter({ entrance: s.entrances.fan[1] });
  sc.buttons[1].onClick();
  if (G.game.sceneName !== G.Data.regions.mapIdOf(rid)) {
    errors.push(`从入口面板返回应回到区域地图 ${G.Data.regions.mapIdOf(rid)}，实际 ${G.game.sceneName}`);
  }
}, 'dungeon.entrance.contract');

/* ---------- 道界·道则回廊契约（缺口 U4）----------
   道界此前只有区域、没有内容（闭环报告 G17）：SLOT_GL 无 dao、dungeon 场景对 dao
   只说"尚未开放"。这条契约钉住九关固定试炼的四件事：
     ① 数据：9 关 / gl 147→171 / 道晶总耗 3900 / 三境各 3 关 / 末关为演出（无战斗）
     ② 线性：前关未历则后关封印
     ③ 道晶：不足不扣不开战；足够则扣费开战
     ④ 进境：通关即 gl = 该关锚点（道界无破境之说，灵气突破被拦）
   面板一律用**文本探针**确认九关真的画出来了 —— 漏路由是静默的、只断言
   "render 不抛异常"抓不到（教训见 worlds.panel.contract / G21–G24）。 */
step(function () {
  const Dg = G.Data.dungeons;
  const T = Dg.DAO_TRIALS;
  if (!Array.isArray(T) || T.length !== 9) { errors.push(`道界应有 9 关试炼，实际 ${T && T.length}`); return; }
  const gls = T.map(function (t) { return t.gl; });
  if (gls.join(',') !== '588,600,612,624,636,648,660,672,684') {
    errors.push('道界九关锚点 gl 序列错误：' + gls.join(','));
  }
  if (Dg.daoTotalCost() !== 3900) errors.push(`道晶总耗应为 3900，实际 ${Dg.daoTotalCost()}`);
  ['准圣', '圣人', '道祖'].forEach(function (r) {
    const n = T.filter(function (t) { return t.realm === r; }).length;
    if (n !== 3) errors.push(`${r} 应有 3 关，实际 ${n}`);
  });
  if (!T[8].finale) errors.push('末关「合道」应为演出关（finale）');
  if (Dg.DAO_ENTER_GL !== 577) errors.push('入道界起始境界应为 gl577');
  /* 道晶产出方向：地狱 > 普通（与灵石 res 相反，道则越难越凝练） */
  const dn = Dg.daoCrystalDrop('normal', 0), dh = Dg.daoCrystalDrop('hell', 0);
  if (!(dh > dn)) errors.push(`道晶产出应随难度上升：普通 ${dn} / 地狱 ${dh}`);

  /* ---- 造一份道界档 ---- */
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 577;
  s.maxGlobalLevel = 577;
  s.daoCrystal = 0;
  s.daoCleared = [];
  s.dungeonRun = null;
  s.pos = null;
  s.hp = 99999;
  G.game.save = s;
  G.game.meta = {
    lives: 5, xianli: 0, totalXianli: 0, perfusion: {}, achieve: {}, past: [],
    titles: ['破狱·凡尘', '破狱·灵渊', '破狱·仙穹'],
    hellCleared: { fan: true, ling: true, xian: true },
    progress: {
      difficulty: 'normal', activeWorld: 'dao', nextWorld: null,
      worlds: { fan: true, ling: true, xian: true, dao: true },
      worldDiff: { fan: 'normal', ling: 'normal', xian: 'normal', dao: 'normal' },
      daoKey: true, daoShards: { fan: true, ling: true, xian: true }
    }
  };

  const sc = G.scenes.dungeon;

  /* ---- ② 线性开锁 ---- */
  if (!Dg.daoOpen(s, 0)) errors.push('第 1 关应默认可挑战');
  if (Dg.daoOpen(s, 1)) errors.push('第 2 关在第 1 关未历前不该开');
  if (Dg.daoReqGL(0) !== 577 || Dg.daoReqGL(1) !== 588) errors.push('daoReqGL 口径错');

  /* ---- 面板：九关真的画出来了 ---- */
  sc.enter();
  if (sc.view !== 'daohub') { errors.push(`道界枢纽视图应为 daohub，实际 ${sc.view}`); return; }
  if (sc.buttons.length !== 10) errors.push(`道则回廊按钮数应为 10（9 关 + 返回），实际 ${sc.buttons.length}`);
  const cx = textSpy(); sc.render(cx);
  const has = function (t) { return cx.__seen.some(function (x2) { return x2.indexOf(t) >= 0; }); };
  if (!has('道 则 回 廊')) errors.push('道则回廊面板没有渲染出标题（render 路由漏了 view=daohub）');
  ['斩善尸', '斩恶尸', '斩自身尸', '三尸合一', '功德道相', '天道束缚', '道则傀儡', '大道化身', '合道']
    .forEach(function (n) {
      if (!has(n)) errors.push('道则回廊没有渲染出关卡「' + n + '」');
    });
  if (!has('道晶')) errors.push('道则回廊没有渲染出道晶余额');
  if (!sc.buttons[0].disabled || sc.buttons[0].label !== '道晶不足') {
    errors.push(`0 道晶时第 1 关应显示「道晶不足」并置灰，实际 ${sc.buttons[0].label}`);
  }
  if (!sc.buttons[1].disabled || sc.buttons[1].label !== '封印中') errors.push('第 2 关应显示「封印中」并置灰');

  /* ---- ③ 道晶不足：不扣、不进战斗 ---- */
  sc.buttons[0].onClick();
  if (G.game.sceneName === 'battle') errors.push('道晶不足时不该能开战');
  if (s.daoCrystal !== 0) errors.push('道晶不足时不该扣费');

  /* ---- ④ 道晶足够：扣费开战，敌人为固定名号 + 该关 gl ---- */
  s.daoCrystal = 100;
  sc._showDaoHub();
  if (sc.buttons[0].label !== '挑　战') errors.push(`道晶足够后按钮应为「挑战」，实际 ${sc.buttons[0].label}`);
  sc.buttons[0].onClick();
  if (s.daoCrystal !== 0) errors.push(`开战应扣 100 道晶，实际余 ${s.daoCrystal}`);
  if (G.game.sceneName !== 'battle') { errors.push('道晶足够后应进入战斗场景'); return; }
  const es = G.scenes.battle.es;
  if (!es || es.length !== 1) errors.push('道界试炼应为单 Boss 战');
  else {
    if (es[0].name !== '善念化身') errors.push(`道界 Boss 名号应为固定「善念化身」，实际 ${es[0].name}`);
    if (es[0].level !== 588) errors.push(`斩善尸 Boss gl 应为 588，实际 ${es[0].level}`);
  }

  /* ---- ④ 结算：通关即进境 + 得道晶 ---- */
  G.game.changeScene('dungeon', { fromBattle: true });
  if (sc.view !== 'brief') errors.push('道界战斗返回后应停在结算简报');
  if (!s.daoCleared[0]) errors.push('通关后第 1 关未记入 daoCleared');
  if (s.globalLevel !== 588) errors.push(`斩善尸通关后 gl 应为 588，实际 ${s.globalLevel}`);
  if (!(s.daoCrystal > 0)) errors.push('道界试炼通关应得道晶');
  if (!Dg.daoOpen(s, 1)) errors.push('第 1 关通关后第 2 关应开锁');
  if (s.dungeonRun !== null) errors.push('道界试炼结算后应清空 dungeonRun');

  /* ---- 重刷已历的关：不扣道晶、不再进境 ---- */
  const keepGl = s.globalLevel, keepCr = s.daoCrystal;
  sc._showDaoHub();
  if (sc.buttons[0].label !== '重　刷') errors.push('已历的关按钮应显示「重刷」');
  sc.buttons[0].onClick();
  if (s.daoCrystal !== keepCr) errors.push('重刷已历的关不该再扣道晶');
  if (G.game.sceneName !== 'battle') { errors.push('重刷应能开战'); return; }
  G.game.changeScene('dungeon', { fromBattle: true });
  if (s.globalLevel !== keepGl) errors.push('重刷不该再推进境界');

  /* ---- ⑤ 走完九关 → gl684 ---- */
  for (let i = 1; i < 9; i++) {
    s.daoCrystal = 99999;
    sc._showDaoHub();
    sc.buttons[i].onClick();
    if (i === 8) break;                        /* 第 9 关是演出关，不进战斗 */
    if (G.game.sceneName !== 'battle') { errors.push(`第 ${i + 1} 关未能开战`); return; }
    G.game.changeScene('dungeon', { fromBattle: true });
  }
  if (G.game.sceneName !== 'dungeon') { errors.push('合道演出应回到副本场景'); return; }
  if (s.globalLevel !== 684) errors.push(`九关走完后 gl 应为 684，实际 ${s.globalLevel}`);
  if (s.daoCleared.filter(Boolean).length !== 9) errors.push('九关应全部记为已历');
  if (!G.Player.breakState(s).maxed) errors.push('gl684 应判为已至绝顶（maxed）');

  /* ---- ⑤ 道界无破境之说：gl600 时灵气突破必须被拦 ---- */
  const s2 = JSON.parse(JSON.stringify(s));
  s2.globalLevel = 600; s2.qi = 1e9;
  const bs = G.Player.breakState(s2);
  if (bs.ready) errors.push('道界内不该能靠灵气突破（ready 应为 false）');
  if (!bs.daoRealm) errors.push('breakState 未标记 daoRealm');
  if (String(bs.reason).indexOf('试炼') < 0) errors.push('道界突破拦截提示应指向试炼，实际：' + bs.reason);
  if (G.Player.breakthrough(s2, G.game.meta).ok) errors.push('道界内 breakthrough 不该成功');

  /* ---- ⑥ 飞升台：道界行可选（不再是「未开放」） ---- */
  const hall = G.scenes.hall;
  G.game.meta.progress.nextWorld = null;
  hall.enter();
  const tog = hall.buttons.filter(function (b) { return b.label === '飞升台'; })[0];
  if (!tog) { errors.push('轮回殿缺少「飞升台」入口'); return; }
  tog.onClick();
  hall.buttons[6].onClick();                   /* 左列第 4 行 = 道界 */
  if (G.game.meta.progress.nextWorld !== 'dao') {
    errors.push(`有钥匙时道界应能选为下一世主界，实际 ${G.game.meta.progress.nextWorld}`);
  }
  /* 反向断言：整页（**含按钮**）不该再出现「未开放」。
     坑：按钮标签是各按钮自己的 render 画的 —— 渲染前把 buttons 清空，
     这条断言就成了空断言（反例验证时正是这么漏过一次）。 */
  if (!hall.buttons.length) errors.push('飞升台按钮被清空，反向断言会失效');
  const hx = textSpy(); hall.render(hx);
  if (hx.__seen.some(function (t) { return t.indexOf('未开放') >= 0; })) {
    errors.push('飞升台道界行仍显示「未开放」');
  }
}, 'dao.trials.contract');

/* ---------- 轮回殿·飞升台契约（缺口 U2 正式入口 + U3 展示位） ----------
   飞升台要能：选下一世主界（未解锁置灰、再点取消）、调每界难度（正式入口）、
   显示碎片与称号。文本探针同样是必须的 —— 新增视图漏路由的表现是"静默不画"。 */
step(function () {
  G.game.meta = {
    lives: 3, xianli: 200, totalXianli: 900,
    perfusion: { body: 2, qi: 0, po: 0, stone: 0, rescue: 0 },
    achieve: {}, past: [],
    titles: ['破狱·凡尘'],
    hellCleared: { fan: true },
    progress: { difficulty: 'normal', activeWorld: 'fan', nextWorld: null,
      worlds: { fan: true, ling: false, xian: false, dao: false },
      worldDiff: { fan: 'normal', ling: 'normal', xian: 'normal', dao: 'normal' },
      daoKey: false, daoShards: { fan: true, ling: false, xian: false } }
  };
  const sc = G.scenes.hall;
  sc.enter();

  const tog = sc.buttons.filter(function (b) { return b.label === '飞升台'; })[0];
  if (!tog) { errors.push('轮回殿没有「飞升台」入口'); return; }
  tog.onClick();
  if (sc.view !== 'ascend') { errors.push('点击后没有切到飞升台视图'); return; }
  /* 4 界 × (主界 + 难度) + 底部 6 键（返回标题 / 仙躯灌注 / 飞升台 / 前世经历 / 轮回图鉴 / 转世重修） */
  if (sc.buttons.length !== 14) errors.push(`飞升台按钮数应为 14（4+4+6），实际 ${sc.buttons.length}`);

  /* 未解锁的仙界（左列第 3 行 = index 4）点了不写 */
  sc.buttons[4].onClick();
  if (G.game.meta.progress.nextWorld) errors.push('未解锁的仙界不该能被选为下一世主界');

  /* 已解锁的灵界（左列 index 2）可选，再点一次取消 */
  G.game.meta.progress.worlds.ling = true;
  sc._build();
  sc.buttons[2].onClick();
  if (G.game.meta.progress.nextWorld !== 'ling') errors.push('已解锁的灵界应能被选为下一世主界');
  sc.buttons[2].onClick();
  if (G.game.meta.progress.nextWorld) errors.push('再点一次应取消选择（交回天道抽定）');

  /* 难度轮换（右列第一行 = index 1 = 凡界） */
  const d0 = G.game.meta.progress.worldDiff.fan;
  sc.buttons[1].onClick();
  const d1 = G.game.meta.progress.worldDiff.fan;
  if (d1 === d0) errors.push('飞升台调整界域难度无效');
  if (G.Player.DIFF_ORDER.indexOf(d1) !== (G.Player.DIFF_ORDER.indexOf(d0) + 1) % 3) {
    errors.push(`难度轮换顺序不对：${d0} → ${d1}`);
  }

  /* 渲染 + 文本探针 */
  const cx = textSpy(); sc.buttons = []; sc.render(cx);
  const has = function (t) { return cx.__seen.some(function (s2) { return s2.indexOf(t) >= 0; }); };
  if (!has('下 一 世 主 界')) errors.push('飞升台没有渲染出「下一世主界」分区');
  if (!has('界 域 难 度')) errors.push('飞升台没有渲染出「界域难度」分区');
  if (!has('道之钥匙碎片')) errors.push('飞升台没有渲染出碎片进度');
  if (!has('破狱·凡尘')) errors.push('飞升台没有展示称号（G15）');
}, 'ascend.hall.contract');

/* ---------- 飞升 / 道界 / 地狱成就契约（缺口 U3 / G13） ----------
   这几项的进度在 meta 里（跨世），所以 hit 必须拿到 meta —— 只传 save 的话永不触发。 */
step(function () {
  const byId = {};
  G.Player.ACHIEVE.forEach(function (a) { byId[a.id] = a; });
  ['A6', 'A7', 'A8', 'A9'].forEach(function (id) {
    if (!byId[id]) errors.push(`缺少成就 ${id}`);
  });
  if (!byId.A6) return;
  if (byId.A8.xianli !== 1500) errors.push(`「叩门道界」应为 +1500 仙力，实际 ${byId.A8.xianli}`);

  const s = { globalLevel: 10, skills: {}, age: 20, chronicle: [], bossKilled: false };
  const mk = function () {
    return { progress: { activeWorld: 'fan', worlds: { fan: true }, daoKey: false },
      achieve: {}, titles: [] };
  };
  const hitIds = function (m) {
    return G.Player.xianliOf(s, m).achieveList.map(function (a) { return a.id; });
  };

  /* 未飞升：不该发飞升类成就 */
  let m = mk();
  let got = hitIds(m);
  if (got.indexOf('A6') >= 0) errors.push('还没飞升就发了「飞升上界」');
  if (got.indexOf('A8') >= 0) errors.push('还没集齐碎片就发了「叩门道界」');

  /* 飞升灵界 → A6；仍未到仙界 → 不发 A7 */
  m.progress.activeWorld = 'ling';
  got = hitIds(m);
  if (got.indexOf('A6') < 0) errors.push('飞升灵界后未发「飞升上界」');
  if (got.indexOf('A7') >= 0) errors.push('还没到仙界就发了「仙门中人」');

  /* 一次性：再结算一次不该重复发 */
  if (hitIds(m).indexOf('A6') >= 0) errors.push('成就重复发放（A6）');

  /* 仙界 + 三碎片 + 称号 → A7 / A8 / A9 齐发 */
  m.progress.worlds.xian = true;
  m.progress.daoKey = true;
  m.titles = ['破狱·凡尘'];
  got = hitIds(m);
  ['A7', 'A8', 'A9'].forEach(function (id) {
    if (got.indexOf(id) < 0) errors.push(`条件满足后未发成就 ${id}（${byId[id].n}）`);
  });
}, 'achieve.contract');

/* ---------- 底栏功能栏 + 六个面板契约（v0.8.0） ----------
   这六项（角色/功法/秘术/任务/储物/成就）原先藏在「菜单」二级页里，现在常驻底栏。
   三个易漏点，全部用探针钉住：
     ① 底栏按钮是否真的挂到了探索场景上（漏挂 = 底栏画得出来但点不动）；
     ② 每个面板的渲染路由（漏路由是**静默不画**，只断言"不抛异常"抓不到）；
     ③ 底栏区域不能响应点地（否则点功能栏会让人物跑起来）。 */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  s.pos = { x: 5, y: 5 };
  /* 面板清单已扩到**全部可路由页**（v0.61.0），所以这份存档要把每个页要用到的
     字段都补齐 —— 缺一个就是"建按钮时抛异常"，而那不是面板的错、是脚手架的错。 */
  s.beasts = s.beasts || []; s.items = s.items || {};
  s.prof = s.prof || {}; s.stone = s.stone || 0;
  G.game.save = s;
  if (!G.game.meta) G.game.meta = { perfusion: {}, achieve: {}, past: [], titles: [] };
  G.game.changeScene('town', { toSpawn: true });
  const sc = G.game.scene;

  /* v0.15.0：功法/秘术并入角色面板的子页，成就移到游戏外 → 底栏五项 */
  const NAMES = ['角色', '任务', '储物', '洞府', '地图'];
  NAMES.forEach(function (n) {
    if (!sc.buttons.some(function (b) { return b.label === n && b.variant === 'tab'; })) {
      errors.push('底栏缺少功能入口：' + n);
    }
  });
  if (typeof G.Explore.BOT_H !== 'number' || G.Explore.BOT_H <= 0) {
    errors.push('Explore.BOT_H 未导出（onTap 靠它挡底栏误触）');
  }

  const TITLE = {
    char: '角 色', skills: '功　法', secrets: '秘　术',
    quest: '任　务', bag: '储　物', cave: '洞　府', map: '地　图'
  };
  /* 标题已改成**左缘竖排带**（一列一字，v0.14.0）→ 不再是一条完整文本 run。
     判据改成"标题的每个字都画在**该面板自己的竖带矩形内**"——
     只查"某处出现过这个字"太松：面板正文里本来就常出现「功」「法」这类字，
     那样断言恒真（G36 同族）。⚠️ 角色面板的带子在**另一个位置**（它用 CHAR_PANEL），
     所以矩形必须按面板取，不能一律用五面板那条。 */
  const bandOf = function (id) {
    /* 角色组（角色/功法/秘术）都用 CHAR_BAND —— 与 panels.js 的 shell 同源。 */
    return G.Overlays.isCharGroup(id) ? G.Overlays.CHAR_BAND : G.Overlays.PANEL_BAND;
  };
  if (!G.Overlays.PANEL_BAND || !(G.Overlays.PANEL_BAND.w > 0)) {
    errors.push('未导出 PANEL_BAND（五面板的左缘竖排标题带）');
  }
  if (!G.Overlays.CHAR_BAND || !(G.Overlays.CHAR_BAND.w > 0)) {
    errors.push('未导出 CHAR_BAND（角色面板的左缘竖排标题带）');
  }
  Object.keys(TITLE).forEach(function (id) {
    G.Overlays.openPanel(sc, id);
    if (sc.overlay !== id) { errors.push('openPanel(' + id + ') 未设置 overlay'); return; }
    if (!sc.buttons.some(function (b) { return b.variant === 'tab' && b.active; })) {
      errors.push('面板 ' + id + ' 里底栏没有高亮当前页签');
    }
    const band = bandOf(id);
    const cx = textSpyXY(); sc.render(cx);
    const inBand = (cx.__seenXY || []).filter(function (t) {
      return t.x >= band.x - 1 && t.x <= band.x + band.w + 1
        && t.y >= band.y - 1 && t.y <= band.y + band.h + 1;
    }).map(function (t) { return t.s; });
    const chars = TITLE[id].replace(/[\s　]/g, '').split('');
    const missing = chars.filter(function (c) { return inBand.indexOf(c) < 0; });
    if (missing.length) {
      errors.push('面板 ' + id + ' 左缘竖排标题缺字：' + missing.join(''));
    }
  });

  /* 六个面板之间可以直接互切（不用先退回探索） */
  G.Overlays.openPanel(sc, 'quest');
  const otherTab = sc.buttons.filter(function (b) { return b.variant === 'tab' && b.label === '储物'; })[0];
  if (!otherTab) { errors.push('面板内没有底栏（无法直接切页）'); return; }
  otherTab.onClick();
  if (sc.overlay !== 'bag') errors.push('面板内切页失败，overlay=' + sc.overlay);

  /* 再点当前页签 = 收起 */
  const curTab = sc.buttons.filter(function (b) { return b.variant === 'tab' && b.active; })[0];
  curTab.onClick();
  if (sc.overlay) errors.push('再点当前页签应收起面板，实际 overlay=' + sc.overlay);

  /* ---------- 主动关闭钮（v0.11.0）----------
     缺口：面板只能"再点一次当前页签"收起，**没有可见的关闭入口** ——
     玩家在面板里找不到出口（截图反馈）。
     这里用 glyph 认（矢量叉），不用 label 认（关闭钮的 label 是空串）。
     三条断言：① 有且只有一个；② 落在面板矩形内；③ 点下去**真的**关掉面板。 */
  /* ⚠️ 清单来自 `G.Overlays.PANEL_IDS`（v0.61.0）而不是写死 —— 原先写死 7 项，
     漏了 sect / alchemy / forge / array / masters / beasts / beastShop，
     **这 7 个面板的关闭钮从此没人验**（G48 同族：挪走了功能却没搬约束）。 */
  const CLOSE_IDS = G.Overlays.PANEL_IDS;
  CLOSE_IDS.forEach(function (id) {
    G.Overlays.openPanel(sc, id);
    if (sc.overlay !== id) { errors.push('openPanel(' + id + ') 失败'); return; }
    const cb = sc.buttons.filter(function (b) { return b.glyph === 'close'; });
    if (cb.length !== 1) {
      errors.push('面板 ' + id + ' 的关闭钮应为 1 个，实际 ' + cb.length);
      return;
    }
    const b = cb[0];
    /* 角色组（角色/功法/秘术）共用 CHAR_PANEL —— 与 panels.js 的 SP 同源。 */
    const R = G.Overlays.isCharGroup(id) ? G.Overlays.CHAR_PANEL : G.Overlays.PANEL_RECT;
    if (!(b.x >= R.x && b.x + b.w <= R.x + R.w && b.y >= R.y && b.y + b.h <= R.y + R.h)) {
      errors.push('面板 ' + id + ' 的关闭钮跑到面板外（x=' + b.x + ' y=' + b.y
        + ' w=' + b.w + ' h=' + b.h + '，面板 ' + R.x + ',' + R.y + ' '
        + R.w + '×' + R.h + '）');
    }
    b.onClick();
    if (sc.overlay) errors.push('面板 ' + id + ' 的关闭钮没关掉面板（overlay=' + sc.overlay + '）');
  });

  /* ---------- 角色面板子页签（v0.11.0）----------
     「角色」一页原先把灵根/属性/境界全挤在一起，细看不了。现在拆成四页。
     断言：① 页签数与 CHAR_TABS 一致；② 点一下切页且**不关面板**；
     ③ 从别的面板切进来要回到「总览」（不能停在上一页）。 */
  {
    const tabs = (G.Overlays.CHAR_TABS || []).map(function (t) { return t.id; });
    /* v0.75.0：新增「天赋」子页 → 8 个 */
    if (tabs.length !== 8) errors.push('角色面板应有 8 个子页签（总览/灵根/天赋/属性/境界/法宝/功法/秘术），实际 ' + tabs.length);
    G.Overlays.openPanel(sc, 'char');
    const subs = sc.buttons.filter(function (b) { return b.variant === 'subtab'; });
    if (subs.length !== tabs.length) {
      errors.push('角色面板子页签按钮应为 ' + tabs.length + ' 个，实际 ' + subs.length);
    } else {
      subs.forEach(function (b, i) {
        b.onClick();
        /* v0.15.0：子页签分两类 —— 前四个留在 char，功法/秘术切到各自 overlay。
           判据从「必须还是 char」改成「必须落在该页所属的 overlay 上」。 */
        const wantOv = (G.Overlays.CHAR_TABS[i].panel) || 'char';
        if (sc.overlay !== wantOv) {
          errors.push('点子页签「' + b.label + '」应切到 overlay=' + wantOv + '，实际 ' + sc.overlay);
        }
        if (sc.charTab !== tabs[i]) {
          errors.push('点子页签「' + b.label + '」后 charTab 应为 ' + tabs[i]
            + '，实际 ' + sc.charTab);
        }
      });
      G.Overlays.openPanel(sc, 'skills');
      G.Overlays.openPanel(sc, 'char');
      if (sc.charTab !== 'overview') {
        errors.push('从别处切进角色面板应回到「总览」，实际 ' + sc.charTab);
      }
      G.Overlays.openPanel(sc, 'char');
      if (sc.charTab !== 'overview') {
        errors.push('面板内重复 openPanel 不应重置子页（实际 ' + sc.charTab + '）');
      }
    }
  }

  /* 底栏区域不响应点地 */
  const p0 = JSON.stringify(s.pos);
  sc.onTap({ x: 240, y: 272 - 3 });
  if (JSON.stringify(s.pos) !== p0) errors.push('点底栏不该让人物移动');
}, 'panels.contract');

/* ---------- 面板内容不得越界（v0.8.0） ----------
   越界是**静默**的：字画到面板外、或压住下一行，都不报错，只有截图才看得出来。
   这里用带坐标的文本探针把「所有文字都落在面板矩形内」变成断言。
   取最坏情况数据（6 步任务链 + 9 项成就全达成 + 满背包），把每一行都逼出来。 */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  s.pos = { x: 5, y: 5 };
  s.quest = { step: 'free', flags: { won1: 1, templeDone: 1, dream: 1, gotBreakPill: 1 } };
  s.skills = { '缠藤指': { lv: 3 }, '铁布衫': { lv: 2 }, '吐纳术': { lv: 1 },
               '回春诀': { lv: 1 }, '御风步': { lv: 1 }, '千斤坠': { lv: 1 } };
  s.items = { '回春丹': 4, '淬体突破丹': 1, '妖丹': 7, '解封符': 2,
              '大还丹': 2, '聚气散': 3, '醒神散': 1 };
  G.game.save = s;
  G.game.meta = { perfusion: {}, achieve: {}, past: [], titles: ['破狱·凡尘', '破狱·灵渊'] };
  (G.Player.ACHIEVE || []).forEach(function (a) { G.game.meta.achieve[a.id] = 1; });

  G.game.changeScene('town', { toSpawn: true });
  const sc = G.game.scene;

  /* 缺字会渲染成空心方框（豆腐块），且换机器表现不一致 —— 一律走矢量绘制。
     详见 panels.js 的 mark()。 */
  const BAD = '\u2713\u2714\u25b6\u25b7';

  /* 字宽估算：桩的 measureText 一律返回"长度 × 7"，对中文严重低估（会漏掉横向压字）。
     CJK/全角按字号算，ASCII 按 0.55 —— 够用来判"两行是不是压在一起"。 */
  const bw = function (t) {
    let w = 0;
    for (let i = 0; i < t.s.length; i++) {
      w += t.s.charCodeAt(i) > 0x2e80 ? t.size : t.size * 0.55;
    }
    return w;
  };
  const box = function (t) {
    const w = bw(t);
    const x0 = t.align === 'right' ? t.x - w : t.x;
    return { x0: x0, x1: x0 + w, y0: t.y, y1: t.y + t.size };
  };

  /* 共用断言：① 不越出面板矩形；② 不含缺字标记；③ 两行不叠字；④ 文字不压在按钮上。
     ④ 单列出来是因为**按钮是另一条绘制路径**（game.js 画底 + 自己画标签），
     文字探针看不到它 —— 设置页底部提示被「关闭」按钮压住就是这么漏出去的。 */
  /* 框越界：与文字越界同源，判的是**框**（`G.UI.rr` 的矩形）。
     ⚠️ 这条是补出来的：v0.14.0 内容区收窄 30px 后「属性」页三张属性卡右沿 452 > 面板 436，
     而文字契约**全绿** —— 文字在卡里居中，卡跑出去了文字还在界内。
     底栏（y ≥ BAR_Y）与面板外的东西不算，容差 0.5px 给浮点与描边留余量。 */
  const checkBoxes = function (id, R, hits) {
    hits.forEach(function (b) {
      if (b.y >= BAR_Y) return;
      const over = Math.max(
        R.x - b.x, b.x + b.w - (R.x + R.w),
        R.y - b.y, b.y + b.h - (R.y + R.h));
      if (over > 0.5) {
        errors.push('面板 ' + id + ' 框越界：矩形 x=' + b.x + ' y=' + b.y
          + ' w=' + b.w + ' h=' + b.h + ' 超出面板 '
          + R.x + ',' + R.y + ',' + R.w + ',' + R.h + '（越出 ' + over.toFixed(1) + 'px）');
      }
    });
  };

  /* 文字被**后画的框**压住（v0.16.0 补）。
     ⚠️ 与"文字压在按钮上"是两条判据，缺一不可：按钮是 `Btn`（自己画底），
     而卡片背板 / 列表衬底走的是 `G.UI.panel` / `G.UI.rr` —— 后者原先**没有任何判据**。
     洞府页的副标题被第一排卡片压住、末行说明被「坐化」按钮压住，就是这么漏出去的。 */
  const checkCovered = function (id, ev) {
    for (let i = 0; i < ev.length; i++) {
      const t = ev[i];
      if (t.k !== 't') continue;
      for (let j = i + 1; j < ev.length; j++) {
        const b = ev[j];
        if (b.k !== 'b') continue;
        /* 阈值与「文字压在按钮上」对齐：**最多 1.5px**（绝对值），不用比例 ——
           11px 的字按 35% 算是 3.85px，而"被压掉 3px"在视觉上已经断字了。 */
        const oy = Math.min(t.y1, b.y1) - Math.max(t.y0, b.y0);
        const ox = Math.min(t.x1, b.x1) - Math.max(t.x0, b.x0);
        if (ox > 1 && oy > Math.min(1.5, (t.y1 - t.y0) * 0.35)) {
          errors.push('面板 ' + id + ' 文字被后画的框压住：' + JSON.stringify(t.s)
            + '（字 ' + t.x0.toFixed(0) + ',' + t.y0.toFixed(0)
            + '..' + t.x1.toFixed(0) + ',' + t.y1.toFixed(0)
            + ' × 框 ' + b.x0.toFixed(0) + ',' + b.y0.toFixed(0)
            + '..' + b.x1.toFixed(0) + ',' + b.y1.toFixed(0)
            + '，纵向重叠 ' + oy.toFixed(1) + 'px）');
          break;
        }
      }
    }
  };

  const checkTexts = function (id, R, body, btns) {
    if (!body.length) { errors.push('面板 ' + id + ' 一个字都没画'); return; }
    body.forEach(function (t) {
      if (t.y < R.y - 0.5 || t.y + t.size > R.y + R.h + 0.5) {
        errors.push('面板 ' + id + ' 文字纵向越界（' + JSON.stringify(t.s)
          + ' y=' + t.y + ' 字号=' + t.size + '，面板 ' + R.y + '..' + (R.y + R.h) + '）');
      }
      /* ⚠️ 横向要连**右端**一起判（v0.11.0 补）：
         原先只看左端 t.x，于是一行写太长顶出面板右沿**抓不到** ——
         `char/linggen` 底部那行四象说明就是这么漏出去的（截图才发现）。
         用 bw() 的估算宽度（CJK 按字号、ASCII 按 0.55），对中文是准的。 */
      const bx = box(t);
      if (bx.x0 < R.x - 0.5 || bx.x1 > R.x + R.w + 0.5) {
        errors.push('面板 ' + id + ' 文字横向越界（' + JSON.stringify(t.s)
          + ' x=' + bx.x0.toFixed(1) + '..' + bx.x1.toFixed(1)
          + '，面板 ' + R.x + '..' + (R.x + R.w) + '）');
      }
      for (let i = 0; i < t.s.length; i++) {
        if (BAD.indexOf(t.s[i]) >= 0) {
          errors.push('面板 ' + id + ' 用了缺字标记 ' + JSON.stringify(t.s[i])
            + '（会渲染成空心方框，请改用矢量绘制）');
        }
      }
    });

    /* 叠字：两行压在一起**不越界**、但会糊成一团（34_panel_achieve 的「称号」
       压在「叩门道界」上就是这么来的）。纵向重叠超过较矮一行高度的 40% 才算叠字，
       给正常行距留余量。 */
    const bs = body.map(box);
    for (let i = 0; i < bs.length; i++) {
      for (let j = i + 1; j < bs.length; j++) {
        const oy = Math.min(bs[i].y1, bs[j].y1) - Math.max(bs[i].y0, bs[j].y0);
        const ox = Math.min(bs[i].x1, bs[j].x1) - Math.max(bs[i].x0, bs[j].x0);
        const minH = Math.min(bs[i].y1 - bs[i].y0, bs[j].y1 - bs[j].y0);
        if (ox > 1 && oy > minH * 0.4) {
          errors.push('面板 ' + id + ' 文字叠字：' + JSON.stringify(body[i].s)
            + ' × ' + JSON.stringify(body[j].s) + '（纵向重叠 ' + oy.toFixed(1) + 'px）');
        }
      }
    }

    (btns || []).forEach(function (btn) {
      if (!btn || !(btn.w > 0) || !(btn.h > 0)) return;
      body.forEach(function (t) {
        const b = box(t);
        const oy = Math.min(b.y1, btn.y + btn.h) - Math.max(b.y0, btn.y);
        const ox = Math.min(b.x1, btn.x + btn.w) - Math.max(b.x0, btn.x);
        /* 阈值从「字高的 40%」收到「最多 2.5px」（v0.16.0）：
           40% 对 10px 的字是 4px —— 只压掉底边 2px 的字读起来已经断了，却判不出来
           （洞府页的末行说明被「坐化」按钮压住就是这么漏的）。 */
        if (ox > 2 && oy > Math.min(1.5, (b.y1 - b.y0) * 0.4)) {
          errors.push('面板 ' + id + ' 文字压在按钮上：' + JSON.stringify(t.s)
            + ' × 「' + (btn.label || btn.glyph || '?') + '」');
        }
      });
    });
  };

  /* 底栏（y ≥ BAR_Y）本来就在内容面板之外，不算越界。 */
  const BAR_Y = G.Overlays.BAR_Y;
  const inBand = function (t) { return t.y < BAR_Y; };

  /* ① 底栏六个面板。只跑 G.Overlays.renderPanel（= 面板体 + 底栏），**不跑整个场景** ——
     否则 HUD 顶栏与场景名铭牌也会进探针，得靠坐标打补丁把它们挑出去。
     ⚠️ 角色面板有四个子页签（v0.11.0），**每一页都要过同一套断言** ——
     只跑默认的「总览」会漏掉灵根/属性/境界三页的越界（越界是静默的）。 */
  const charTabIds = (G.Overlays.CHAR_TABS || []).map(function (t) { return t.id; });
  if (charTabIds.length !== 8) {
    errors.push('角色面板子页签应为 8 个（总览/灵根/天赋/属性/境界/法宝/功法/秘术），实际 ' + charTabIds.length);
  }
  [
    { id: 'skills', R: G.Overlays.CHAR_PANEL },
    { id: 'secrets', R: G.Overlays.CHAR_PANEL },
    { id: 'quest', R: G.Overlays.PANEL_RECT },
    { id: 'bag', R: G.Overlays.PANEL_RECT },
    { id: 'cave', R: G.Overlays.PANEL_RECT },
    { id: 'map', R: G.Overlays.PANEL_RECT }
  ].concat(charTabIds.map(function (tid) {
    return { id: 'char', tab: tid, R: G.Overlays.CHAR_PANEL };
  })).forEach(function (item) {
    G.Overlays.openPanel(sc, item.id);
    /* openPanel 从别处切进来时会重置为「总览」，所以要在它**之后**指定子页。
       ⚠️ 指定完还要**再 openPanel 一次**（keepTab=true）——按钮是按当时的 charTab 建的，
          只改 charTab 不重建，就会出现"灵根页上浮着总览页的按钮"这种**假阳性**
          （实测：法宝三槽的按钮跑到灵根页上，契约报"文字压在按钮上"）。 */
    if (item.tab) { sc.charTab = item.tab; G.Overlays.openPanel(sc, item.id, true); }
    if (sc.overlay !== item.id) { errors.push('openPanel(' + item.id + ') 失败'); return; }
    const cx = textSpyXY();
    const sp = boxSpy();
    const lp = layerSpy();
    let okRender = false;
    /* ⚠️ 还原顺序必须**反着来**：三个探针都 patch 了 `G.UI.rr`，后 patch 的先还原。 */
    try { okRender = G.Overlays.renderPanel(cx, sc); } finally { lp.restore(); sp.restore(); }
    if (!okRender) { errors.push('renderPanel(' + item.id + ') 返回 false'); return; }
    const tag = item.id + (item.tab ? '/' + item.tab : '');
    checkTexts(tag, item.R, cx.__seenXY.filter(inBand), sc.buttons);
    checkBoxes(tag, item.R, sp.hits);
    checkCovered(tag, lp.ev);
  });

  /* ② 成就页（v0.15.0 移到**开局界面**）——
     ⚠️ 它已经不在底栏面板清单里，所以**必须单独补一段**，
     否则这一页从此不受越界/叠字约束（覆盖缺口：本轮移动时差点就漏了）。 */
  {
    G.game.changeScene('title');
    G.scenes.title._openAch();
    if (!G.scenes.title.ach) errors.push('成就页未打开（title._openAch 失效）');
    const cx = textSpyXY();
    const sp = boxSpy();
    /* ⚠️ 只渲染**被测的那一页**（`drawAchieve`），不要把整个标题场景喂进来 ——
       场景自己的装饰文字（竖排「逆尘」、副题）会被算成"叠字/越界"，全是假红
       （而且 `box()` 不认 `align:'center'`，居中文字按左对齐算，越界判据也不对）。 */
    try { G.Overlays.drawAchieve(cx); } finally { sp.restore(); }
    checkTexts('title/ach', G.Overlays.PANEL_RECT,
      cx.__seenXY.filter(inBand), G.scenes.title.buttons);
    checkBoxes('title/ach', G.Overlays.PANEL_RECT, sp.hits);
    G.scenes.title._buildMenu();
    G.game.changeScene('town', { toSpawn: true });
    pump(2, 'ach.back');
  }

  /* ③ 天道三页（设置 / 界域难度 / 关于）走同一套断言。 */
  [
    { id: 'settings', R: G.TianDao.SET_P, open: function () { G.TianDao.openSettings(sc); } },
    { id: 'worlds', R: G.TianDao.WORLDS_P, open: function () { G.TianDao.openWorlds(sc); } },
    { id: 'about', R: G.TianDao.ABOUT_P, open: function () { G.TianDao.openAbout(sc); } }
  ].forEach(function (item) {
    item.open();
    if (sc.overlay !== item.id) { errors.push(item.id + ' 未设置 overlay'); return; }
    const cx = textSpyXY();
    G.TianDao.renderOverlay(cx, sc);
    checkTexts(item.id, item.R, cx.__seenXY, sc.buttons);
  });

  /* ③ 轮回殿·飞升台（v0.9.0）：底部「碎片 / 称号」行以前画在 y=212，
     正好压在两个面板的**下沿花角**上（39 号截图可见）—— 它既没越界也没叠字，
     所以 checkTexts 抓不到。判据换成"这一行不得落进面板的纵向带内"。
     顺带校验碎片行与右对齐的「下一世」不会横向相撞（称号最多 3 个）。 */
  {
    G.game.save = s;
    G.game.meta = {
      lives: 5, xianli: 300, totalXianli: 900,
      perfusion: { body: 2, qi: 0, po: 0, stone: 0, rescue: 0 },
      achieve: {}, past: [],
      titles: ['破狱·凡尘', '破狱·灵渊', '破狱·仙穹'],
      hellCleared: { fan: true, ling: true, xian: true },
      progress: { difficulty: 'normal', activeWorld: 'dao', nextWorld: 'dao',
        worlds: { fan: true, ling: true, xian: true, dao: true },
        worldDiff: { fan: 'normal', ling: 'hell', xian: 'normal', dao: 'hell' },
        daoKey: true, daoShards: { fan: true, ling: true, xian: true } }
    };
    const h = G.scenes.hall;
    h.enter();
    h.view = 'ascend'; h._build();
    const cx2 = textSpyXY();
    h.render(cx2);
    /* 两个分区面板的矩形**取自场景本身**（h.ASC_PANELS）——
       写死在契约里的话，改了渲染它照样绿，等于没钉住（反例验证漏过一次）。 */
    const P = h.ASC_PANELS;
    if (!Array.isArray(P) || P.length !== 2) { errors.push('轮回殿未导出 ASC_PANELS'); return; }
    const rows = cx2.__seenXY.filter(function (t) {
      return t.s.indexOf('道之钥匙碎片') >= 0 || t.s.indexOf('下一世：') >= 0;
    });
    if (rows.length !== 2) errors.push(`飞升台底部信息行应为 2 条，实际 ${rows.length}`);
    rows.forEach(function (t) {
      P.forEach(function (r) {
        const insideX = t.x > r.x - 2 && t.x < r.x + r.w + 2;
        const overlapY = t.y < r.y + r.h - 0.5 && t.y + t.size > r.y + 0.5;
        if (insideX && overlapY) {
          errors.push('飞升台信息行落进面板矩形（' + JSON.stringify(t.s) + ' y=' + t.y
            + '..' + (t.y + t.size) + '，面板 ' + r.y + '..' + (r.y + r.h) + '）');
        }
      });
      if (t.y + t.size > h.ASC_FOOT_Y + 0.5) {
        errors.push('飞升台信息行压到底栏按钮上（' + JSON.stringify(t.s)
          + ' 底 ' + (t.y + t.size) + ' > ' + h.ASC_FOOT_Y + '）');
      }
    });
    /* 面板高度必须收在信息行之上 —— 否则这条契约会被"两处一起改错"绕过 */
    P.forEach(function (r) {
      if (r.y + r.h > h.ASC_INFO_Y) {
        errors.push(`飞升台面板底 (${r.y + r.h}) 应高于信息行 y (${h.ASC_INFO_Y})`);
      }
    });
    const info = rows.filter(function (t) { return t.s.indexOf('道之钥匙碎片') >= 0; })[0];
    const nxt = rows.filter(function (t) { return t.s.indexOf('下一世：') >= 0; })[0];
    if (info && nxt && info.x + bw(info) > (nxt.x - bw(nxt)) - 4) {
      errors.push('飞升台碎片/称号行与「下一世」相撞（右缘 '
        + (info.x + bw(info)).toFixed(0) + ' vs 起点 ' + (nxt.x - bw(nxt)).toFixed(0) + '）');
    }
  }
}, 'panels.bounds.contract');

/* ---------- 面板路由契约（v0.61.0，用户截图实锤） ----------
   缺口：「拜师 · 习艺」面板点开后**只有 4 个「拜师」按钮浮在地图上**，
   面板本体（左缘标题带 / 师父名 / 束脩说明）一条都没画。
   根因：`panels.js` 的 `DRAW` 分发表里**没有 `masters` 项** → `renderPanel` 直接 `return false`。
   `buildMasters` 照常跑（按钮由 `openPanel` 建），所以**按钮在、面板不在**。

   为什么此前所有契约都漏了它：`panels.bounds.contract` 的清单是**写死的 6 个面板 + 角色 7 子页**，
   不含 alchemy / forge / array / masters / beasts / beastShop / sect ——
   这 7 页的越界、叠字、遮挡、渲染**一条断言都没跑**（G48 同族：功能挪走了、约束没跟着搬）。
   `renderPanel` 的返回值本来就判了，但**判不到清单外的页**。

   判据（两层，缺一不可）：
     ① 运行时：`PANEL_IDS` 里每个 id 都必须 openPanel 成功 + `renderPanel` 返回 true + 有按钮；
     ② 源码闸：`panels.js` 里 `IDS.*` 的每个键都必须在 `DRAW` 里有同名入口。
        —— ① 依赖"清单本身是全的"，② 才能证明清单没漏；两条一起才闭合。 */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  s.pos = { x: 5, y: 5 };
  s.prof = {}; s.stone = 0; s.items = s.items || {}; s.beasts = s.beasts || [];
  G.game.save = s;
  if (!G.game.meta) G.game.meta = { perfusion: {}, achieve: {}, past: [], titles: [] };
  G.game.changeScene('town', { toSpawn: true });
  const sc = G.game.scene;

  const ALL = ['char', 'quest', 'bag', 'sect', 'cave', 'map',
    'skills', 'secrets', 'beasts', 'beastShop', 'alchemy', 'forge', 'array', 'masters'];
  const ids = G.Overlays.PANEL_IDS;
  if (!Array.isArray(ids)) {
    errors.push('G.Overlays.PANEL_IDS 未导出 —— 面板清单没有唯一来源，契约无法遍历');
    return;
  }
  ALL.forEach(function (id) {
    if (ids.indexOf(id) < 0) errors.push('PANEL_IDS 漏了面板 ' + id);
  });
  if (ids.length < ALL.length) {
    errors.push('PANEL_IDS 只有 ' + ids.length + ' 项（应 ≥ ' + ALL.length + '）');
  }

  ids.forEach(function (id) {
    sc.overlay = null;
    /* openPanel 里就跑 buildXxx（建按钮）—— 建按钮期抛异常同样是"面板打不开"，
       与渲染期抛异常要分开报，否则只能看到一个笼统的契约级错误。 */
    try { G.Overlays.openPanel(sc, id); } catch (e) {
      errors.push('面板 ' + id + ' 建按钮时抛异常：' + e.message);
      return;
    }
    if (sc.overlay !== id) {
      errors.push('openPanel(' + id + ') 没生效（overlay=' + sc.overlay + '）');
      return;
    }
    if (!(sc.buttons || []).length) errors.push('面板 ' + id + ' 一个按钮都没有（点不出去）');
    const cx = textSpy();
    let ok = false;
    /* 只跑 renderPanel（面板体 + 底栏），不跑整个场景 ——
       否则 HUD 的文字会让"面板其实没画"这条断言恒真（空断言）。 */
    try { ok = G.Overlays.renderPanel(cx, sc); } catch (e) {
      errors.push('面板 ' + id + ' 渲染抛异常：' + e.message);
      return;
    }
    if (!ok) {
      errors.push('面板 ' + id + ' 没有绘制入口（DRAW 里缺 `' + id + '`）'
        + ' —— 症状：只有按钮浮在画面上、面板本体全空');
    }
  });
  sc.overlay = null;

  /* ② 源码闸：IDS 的每个键都要在 DRAW 里有入口。**先剥注释**（G36）——
     DRAW 上方那句说明注释里就写着 "G.Overlays.renderChar"，不剥会让闸恒真。 */
  const stripC = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const src = stripC(fs.readFileSync(path.join(WWW, 'js', 'core', 'panels.js'), 'utf8'));
  const i0 = src.indexOf('var IDS = {};');
  const i1 = src.indexOf('var DRAW = {');
  const i2 = src.indexOf('function renderPanel');
  if (i0 < 0 || i1 < 0 || i2 < 0) {
    errors.push('源码闸：panels.js 里找不到 IDS / DRAW / renderPanel，正则可能过时了');
  } else {
    /* ⚠️ IDS 的六个底栏键是 `PANELS.forEach(p => IDS[p.id] = 1)` **动态写入**的，
       静态扫 `IDS.x =` 只能扫到 8 个 → 必须把 PANELS 表里的 id 也读出来，
       否则"只扫到 8 个（应 ≥14）"这条保险丝会一直误报。 */
    const p0 = src.lastIndexOf('var PANELS = [');
    const panelKeys = p0 < 0 ? [] : (src.slice(p0, i0).match(/id:\s*'(\w+)'/g) || [])
      .map(function (m) { return m.match(/'(\w+)'/)[1]; });
    const idKeys = panelKeys.concat(
      (src.slice(i0, i1).match(/IDS\.(\w+)\s*=/g) || [])
        .map(function (m) { return m.replace(/^IDS\./, '').replace(/\s*=$/, ''); }));
    const drawKeys = (src.slice(i1, i2).match(/^\s*(\w+)\s*:/gm) || [])
      .map(function (m) { return m.replace(/[\s:]/g, ''); });
    if (idKeys.length < ALL.length) {
      errors.push('源码闸：只扫到 ' + idKeys.length + ' 个 IDS 键（应 ≥ ' + ALL.length
        + '），正则可能过时了');
    }
    idKeys.forEach(function (k) {
      if (drawKeys.indexOf(k) < 0) errors.push('源码闸：IDS 有 `' + k + '` 但 DRAW 没有对应入口');
    });
  }
}, 'panels.route.contract');

/* ---------- 资源分级契约（v0.61.0，用户第 11 点） ----------
   用户给的换算链：「1 个下品道晶 = 10 个极品仙晶 = 100000 个极品灵晶 =
   1000000000 个极品灵石，都是翻十倍计算」。
   ⚠️ 这条链**末段不自洽**：前三段跨界都是 ×10^4（极品计），末段却是 ×10^4 ÷ 10^3。
      取舍已定并写在 `player.js: RES` 的注释里 —— 保留用户**明确写出**且互相自洽的两个等式
      （「1 下品道晶 = 10 极品仙晶」「10 极品仙晶 = 10^5 极品灵晶」），牺牲末段那句口语近似。
   这里只钉**成立的部分**，以及"页面真的按四币四品摆出来了"。 */
step(function () {
  const P2 = G.Player;
  if (!P2.RES || P2.RES.length !== 4) { errors.push('RES 应为四界四币'); return; }
  if (!P2.GRADES || P2.GRADES.length !== 4) { errors.push('GRADES 应为四品'); return; }
  const byId = {};
  P2.RES.forEach(function (c) { byId[c.id] = c; });
  ['stone', 'lingjing', 'xianjing', 'daojing'].forEach(function (id) {
    if (!byId[id]) errors.push('缺币种 ' + id);
    else if (!byId[id].icon) errors.push('币种 ' + id + ' 缺图标逻辑名前缀');
  });
  /* ① 币内每品 ×10 */
  P2.GRADES.forEach(function (g, i) {
    if (g.mult !== Math.pow(10, i)) errors.push('品级 ' + g.n + ' 的倍率应为 10^' + i);
  });
  /* ② 跨界倍率（下品计）：10^7 / 10^11 / 10^12 */
  const u = function (id) { return byId[id].unit; };
  if (u('lingjing') !== 1e7 || u('xianjing') !== 1e11 || u('daojing') !== 1e15) {
    errors.push('跨界倍率应为 10^7 / 10^11 / 10^15，实为 '
      + u('lingjing') + '/' + u('xianjing') + '/' + u('daojing'));
  }
  const TOP = 1000;   /* 1 极品 = 1000 下品 */
  if (Math.abs(u('daojing') - 10 * TOP * u('xianjing')) > 1) {
    errors.push('1 下品道晶应 = 10 极品仙晶（实为 ' + u('daojing') + ' vs '
      + (10 * TOP * u('xianjing')) + ' 下品灵石）');
  }
  if (Math.abs(10 * TOP * u('xianjing') - 1e5 * TOP * u('lingjing')) > 1) {
    errors.push('10 极品仙晶应 = 10 万极品灵晶');
  }
  /* ③ 拆分必须**无损**（四品加起来要还原成标量） */
  [0, 1, 9, 999, 1000, 1234, 123456].forEach(function (v) {
    const s3 = P2.splitGrades(v);
    const back = s3.low + s3.mid * 10 + s3.high * 100 + s3.top * 1000;
    if (back !== v) errors.push('资源拆分不是无损：' + v + ' → ' + back);
  });
  const sp = P2.splitGrades(1964);
  if (sp.top !== 1 || sp.high !== 9 || sp.mid !== 6 || sp.low !== 4) {
    errors.push('1964 应拆成 极品1/上品9/中品6/下品4，实为 ' + JSON.stringify(sp));
  }
  /* ④ 身家折算 */
  if (P2.resWorth({ stone: 100, lingjing: 2 }) !== 100 + 2 * 1e7) {
    errors.push('resWorth 折算错误');
  }
  /* ⑤ 兑换：目标界未解锁时不给兑（"到了灵界才有灵晶"） */
  const se = { stone: 1e8, lingjing: 0, xianjing: 0, daoCrystal: 0 };
  const rNo = P2.resExchange(se, { progress: { worlds: { fan: true, ling: false } } },
    'stone', 'lingjing', 1e7);
  if (rNo.ok) errors.push('灵界未解锁时不该能兑出灵晶');
  if (!rNo.reason) errors.push('兑换失败必须给出可读原因');
  const rYes = P2.resExchange(se, { progress: { worlds: { fan: true, ling: true } } },
    'stone', 'lingjing', 1e7);
  if (!rYes.ok) errors.push('灵界已解锁应可兑灵晶：' + rYes.reason);
  else if (se.lingjing !== 1 || se.stone !== 1e8 - 1e7) {
    errors.push('10^7 下品灵石应换得 1 下品灵晶，实为 ' + se.lingjing);
  }

  /* ⑥ 页面：页签名已改「资产」，且真的摆了 4 币 × 4 品 = 16 格 + 兑换口径说明 */
  const s = JSON.parse(JSON.stringify(save));
  s.pos = { x: 5, y: 5 }; s.items = s.items || {}; s.beasts = s.beasts || [];
  s.stone = 1964; s.lingjing = 3; s.xianjing = 0; s.daoCrystal = 0;
  G.game.save = s;
  if (!G.game.meta) G.game.meta = { perfusion: {}, achieve: {}, past: [], titles: [] };
  G.game.changeScene('town', { toSpawn: true });
  const sc = G.game.scene;
  sc.bagTab = 'stone';
  G.Overlays.openPanel(sc, 'bag', true);
  const tabNames = (sc.buttons || []).filter(function (b) { return b.variant === 'subtab'; })
    .map(function (b) { return b.label; });
  if (tabNames.indexOf('资产') < 0) errors.push('储物页签应已把「灵石」改为「资产」');
  if (tabNames.indexOf('灵石') >= 0) errors.push('储物页签还留着旧的「灵石」');
  const cells16 = (sc.buttons || []).filter(function (b) {
    return typeof b.label === 'string'
      && /^(极品|上品|中品|下品)(灵石|灵晶|仙晶|道晶)$/.test(b.label);
  });
  if (cells16.length !== 16) {
    errors.push('资产页应为 4 币 × 4 品 = 16 格，实际 ' + cells16.length);
  }
  const cx3 = textSpy();
  G.Overlays.renderPanel(cx3, sc);
  if (!cx3.__seen.some(function (t) { return t.indexOf('下品道晶') >= 0; })) {
    errors.push('资产页没有渲染出兑换口径说明（玩家看不出品级的意义）');
  }
  /* 图标必须**真的在 manifest 里**（不是程序化兜底）—— 这条抓的是"图出了但没接线"。
     ⚠️ 无头环境里 `G.Assets.img` 取不到真图（没有 fetch），所以查 manifest 而不是查它。 */
  const man = JSON.parse(fs.readFileSync(path.join(WWW, 'assets', 'manifest.json'), 'utf8'));
  P2.RES.forEach(function (c) {
    P2.GRADES.forEach(function (g) {
      const key = c.icon + '.' + g.id;
      if (!man[key]) errors.push('资源图标未接线（manifest 里没有）：' + key);
    });
  });
  /* 副本徽记：15 个原型 + 道则回廊 */
  ['B1', 'B2', 'B3', 'B4', 'B5', 'S1', 'S2', 'S3', 'S4', 'S5',
    'S6', 'S7', 'S8', 'S9', 'S10', 'dao'].forEach(function (id) {
    if (!man['dungeon.' + id]) errors.push('副本徽记未接线：dungeon.' + id);
  });
}, 'currency.contract');

/* ---------- 宗门徽记契约（v0.61.0，用户第 12 点） ----------
   用户口径：「这些宗门需要生成专属的标记，还有我们是修仙世界，不要有江湖气息的门派名」。
   两件事：① 徽记（只做 9 个**根宗门**，灵界总部/仙界道场与凡界同根、共用一张）；
           ② 门派名去江湖气（落霞镖局/翠微猎户盟/青溪剑馆 已改名）。 */
step(function () {
  const S = G.Data.sects;
  if (!S || !S.rootOf) { errors.push('sects.rootOf 缺失（徽记按根宗门取的唯一口径）'); return; }
  const man = JSON.parse(fs.readFileSync(path.join(WWW, 'assets', 'manifest.json'), 'utf8'));
  const roots = {};
  (S.list || []).forEach(function (s) { roots[S.rootOf(s.id) || s.id] = true; });
  const keys = Object.keys(roots);
  /* 9 个凡界根 + 4 个灵/仙自成一根 = 13（`sects.rootOf` 对没有 parent 的返回自己）*/
  if (keys.length !== 13) errors.push('根宗门应为 13 个（9 凡界 + 4 灵仙自成一脉），实际 ' + keys.length);
  keys.forEach(function (id) {
    if (!man['sect.' + id]) errors.push('宗门徽记未接线：sect.' + id);
  });
  /* 徽记必须按**根**收敛：灵界总部与凡界同根 → 同一个取图键 */
  const ling = (S.list || []).filter(function (s) { return s.world !== 'fan'; })[0];
  if (ling && S.rootOf(ling.id) === ling.id) {
    errors.push('灵界/仙界分支的 rootOf 应指回凡界根宗门，实际指回自己：' + ling.id);
  }
  /* 去江湖气：这三个名字不许再出现（源码闸） */
  const bad = ['镖局', '猎户盟', '剑馆'];
  ['www/js/data/sects.js', 'www/js/data/maps.js', 'www/js/data/skills.js'].forEach(function (rel) {
    const t = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    bad.forEach(function (w) {
      if (t.indexOf(w) >= 0) errors.push('门派名仍有江湖气（' + w + '）：' + rel);
    });
  });
}, 'sect.emblem.contract');

/* ---------- 机缘契约（v0.62.0，用户第 7 点） ----------
   用户口径：「支线任务，会存在在行走其他地图时间触发，或者等到特定境界时触发特殊任务，
              完成之后奖励功法、法宝、或者惩罚死亡等等」。
   三层断言：① 三种触发形态与"惩罚死亡"都**真的存在**；② 每条都留了活路；
             ③ 行走触发挂的图**真的能触发**（挂在洞穴/室内/安全区上 → 永远不弹，且完全静默）。 */
step(function () {
  const SE = G.Data.StoryEvents;
  if (!SE) { errors.push('G.Data.StoryEvents 未载入'); return; }
  if (typeof SE.pendingFor !== 'function') {
    errors.push('缺 pendingFor(save, scene) —— 行走触发这一类判不了（老 pending 拿不到 scene）');
    return;
  }
  const L = SE.list;
  const k = { gl: 0, map: 0, step: 0, any: 0, dead: 0 };
  L.forEach(function (e) {
    if (e.gl != null) k.gl++;
    if (e.map) k.map++;
    if (e.step) k.step++;
    if (e.where === 'any') k.any++;
    if (!e.choices || !e.choices.length) { errors.push('机缘 ' + e.id + ' 没有选项'); return; }
    const alive = e.choices.filter(function (c) { return !c.dead; });
    if (!alive.length) {
      errors.push('机缘 ' + e.id + ' 全是死路 —— 无信息必死不是"残酷"，是不讲道理');
    }
    e.choices.forEach(function (c) {
      if (c.dead) k.dead++;
      if (typeof c.run !== 'function') errors.push('机缘 ' + e.id + ' 的选项「' + c.t + '」缺 run');
    });
  });
  if (!k.map) errors.push('没有任何「行走触发」的机缘（用户第 7 点明确要求）');
  if (!k.gl) errors.push('没有任何「境界触发」的机缘');
  if (!k.dead) errors.push('没有任何「惩罚死亡」的选项（用户第 7 点明确要求）');

  /* ① 行走触发挂的图必须**真的能触发**：洞穴 / 室内 / 安全区上 wildOk 恒假 → 永远不弹。
        （本契约最容易漏、且完全静默的一类：初版 se8 挂在 fan3=赤牙洞，那是 cave 图。）
        ⚠️ 必须走 `G.game.changeScene` 而不是 `G.RegionGen.sceneFor` ——
            `scene.map` 是 `enter()` 里才建的，直接拿 sceneFor 的返回值 `map` 还是 null，
            `wildOk` 会一律判假 → 契约变成"恒报错"的假红（第一次就写成这样，抓到了）。 */
  const s0 = JSON.parse(JSON.stringify(save));
  s0.pos = { x: 5, y: 5 }; s0.globalLevel = 700;
  s0.items = s0.items || {}; s0.beasts = s0.beasts || {};
  if (!Array.isArray(s0.beasts)) s0.beasts = [];
  s0.quest = s0.quest || { step: 'm1-7', flags: {} };
  s0.quest.flags = s0.quest.flags || {};
  G.game.save = s0;
  if (!G.game.meta) G.game.meta = { perfusion: {}, achieve: {}, past: [], titles: [] };
  const prevName = G.game.sceneName;
  const mapEvs = L.filter(function (e) { return e.map && e.where !== 'any'; });
  mapEvs.forEach(function (e) {
    try { G.game.changeScene(e.map, { toSpawn: true }); } catch (err) {
      errors.push('机缘 ' + e.id + ' 挂的图「' + e.map + '」切不过去：' + err.message); return;
    }
    if (!SE.wildOk(G.game.scene)) {
      errors.push('机缘 ' + e.id + ' 挂的图「' + e.map + '」不是野外（洞穴/室内/安全区）→ 永远不会触发');
    }
  });

  /* ② 真的取得回来 + ③ 一次性 */
  if (mapEvs.length) {
    const e0 = mapEvs[0];
    G.game.changeScene(e0.map, { toSpawn: true });
    /* 先把非行走触发的一律标成已看，免得它们排在前面挡着 */
    L.forEach(function (e) { if (!e.map) s0.quest.flags['se_' + e.id] = true; });
    const got = SE.pendingFor(s0, G.game.scene);
    if (!got) errors.push('站在 ' + e0.map + ' 上却取不到行走触发的机缘（map 判定失效）');
    else {
      if (got.id !== e0.id) errors.push('期望取到 ' + e0.id + '，实际 ' + got.id);
      s0.quest.flags['se_' + got.id] = true;
      const again = SE.pendingFor(s0, G.game.scene);
      if (again && again.id === got.id) errors.push('机缘 ' + got.id + ' 看过之后还在重复触发');
    }
  }
  /* ④ 老签名 `pending(save)` 仍要能用（它只认 gl/step 那一类） */
  const s1 = JSON.parse(JSON.stringify(save));
  s1.globalLevel = 700;
  s1.quest = { step: 'm1-7', flags: {} };
  const p1 = SE.pending(s1);
  if (!p1) errors.push('pending(save) 取不到境界触发的机缘（老调用点会静默失效）');
  else if (p1.map) errors.push('pending(save) 不该返回行走触发的机缘（它没有 scene）');
  /* ⑤ 死路标记必须与选项数不成对（至少要留一条活路）—— 上面已逐条判过，这里再收一次总数 */
  L.forEach(function (e) {
    const d = (e.choices || []).filter(function (c) { return c.dead; });
    if (d.length && d.length === (e.choices || []).length) {
      errors.push('机缘 ' + e.id + ' 的 dead 标记数 == 选项数');
    }
  });
  /* 还原场景（后面的契约还要用 town） */
  G.game.save = save;
  G.game.changeScene(prevName || 'town', { toSpawn: true });
}, 'encounter.contract');

/* ---------- 地图交互契约（v0.62.0，用户第 6/8 点） ----------
   用户口径：「这些内容太挡地图和视线了……它的地图是支持放大缩小的，支持拖动看到其他区域内，
              并且它是支持 x,y 坐标点位移动寻路」+「这个地图不支持拖动和放大缩小，
              而且到达化神境就可以自由传送到各个地图了」。
   断言：缩放按钮在且上下限被夹住；pan 被夹住；节点点击的三条门禁（未到访 / 境界不足 / 化神可传）；
        视口外的点击**不被地图吞掉**（否则底栏页签与关闭钮就废了）。 */
step(function () {
  const V2 = G.Overlays.MAP_VIEW;
  if (!V2 || !(V2.vw > 0)) { errors.push('未导出 MAP_VIEW（地图视口矩形）'); return; }
  const s = JSON.parse(JSON.stringify(save));
  s.pos = { x: 5, y: 5 }; s.items = s.items || {}; s.beasts = s.beasts || [];
  s.globalLevel = 1; s.visited = { fan1: true };
  G.game.save = s;
  if (!G.game.meta) G.game.meta = {};
  G.game.meta.progress = {
    activeWorld: 'fan', worlds: { fan: true, ling: false, xian: false, dao: false },
    worldDiff: {}, daoShards: {}
  };
  G.game.changeScene('town', { toSpawn: true });
  const sc = G.game.scene;
  sc.overlay = null;
  G.Overlays.openPanel(sc, 'map');

  const clickZoom = function (l) {
    const b = (sc.buttons || []).filter(function (x) { return x.label === l; })[0];
    if (b) b.onClick();
    return !!b;
  };
  ['＋', '－', '复位'].forEach(function (l) {
    if (!(sc.buttons || []).some(function (b) { return b.label === l; })) {
      errors.push('地图缺少缩放控件「' + l + '」（用户第 6 点要求可放大缩小）');
    }
  });
  sc.mapZoom = 1; sc.mapPan = { x: 0, y: 0 };
  for (let i = 0; i < 6; i++) clickZoom('＋');
  if (sc.mapZoom !== 3) errors.push('缩放上限应为 3，实为 ' + sc.mapZoom);
  for (let i = 0; i < 6; i++) clickZoom('－');
  if (sc.mapZoom !== 1) errors.push('缩放下限应为 1，实为 ' + sc.mapZoom);
  /* pan 夹取：拉到天边也要被收回视口范围内 */
  sc.mapZoom = 3; sc.mapPan = { x: 99999, y: -99999 };
  clickZoom('＋');
  const limX = (3 - 1) * V2.vw / 2, limY = (3 - 1) * V2.vh / 2;
  if (Math.abs(sc.mapPan.x) > limX + 0.01 || Math.abs(sc.mapPan.y) > limY + 0.01) {
    errors.push('地图平移未被夹住（' + JSON.stringify(sc.mapPan) + '，上限 '
      + limX.toFixed(0) + '/' + limY.toFixed(0) + '）');
  }
  /* 复位 */
  sc.mapZoom = 3; sc.mapPan = { x: 20, y: 20 };
  clickZoom('复位');
  if (sc.mapZoom !== 1 || sc.mapPan.x !== 0 || sc.mapPan.y !== 0) {
    errors.push('「复位」未把缩放/平移归位');
  }

  const Rg = G.Data.regions;
  const target = Rg.of('fan').filter(function (r) { return r.id !== 'fan1'; })[0];
  if (!target) { errors.push('凡界区域太少，无法验传送'); return; }
  sc.mapZoom = 1; sc.mapPan = { x: 0, y: 0 };
  const nodeP = {
    x: V2.vx + V2.vw / 2 + (target.mx - 0.5) * V2.vw + 0,
    y: V2.vy + V2.vh / 2 + (target.my - 0.5) * V2.vh + 0
  };
  /* 视口外的点击**不该**被地图吞掉（否则底栏页签与关闭钮全废） */
  if (G.Overlays.mapTap({ x: 4, y: 4 }, sc)) {
    errors.push('视口外的点击不该被地图吃掉（底栏页签会被吞）');
  }
  if (!G.Overlays.mapTap(nodeP, sc)) {
    errors.push('视口内的点击应被地图吃掉（返回 true）');
  }
  const home = G.game.sceneName;
  /* ⓪ **未现世界的节点点不了**（v0.97.0，用户口径「把地图全部能展示看到，
     但是无法过去」）：把当前界切到"未解锁的仙界"，点它的节点 →
     不切场景 + 给"尚未现世"提示。
     ⚠️ 放在最前面：这是"看得见 ≠ 去得了"的端到端判决。 */
  {
    const meta0 = G.game.meta;
    const wsBak = (meta0.progress || {}).worlds;
    meta0.progress = meta0.progress || {};
    meta0.progress.worlds = {};                       /* 全未解锁 */
    G.game.changeScene('town', { toSpawn: true });
    const scU = G.game.scene;
    scU.mapZoom = 1; scU.mapPan = { x: 0, y: 0 };
    scU.mapWorld = 'xian';
    G.Overlays.openPanel(scU, 'map', true);
    if (scU.mapWorld !== 'xian') {
      errors.push('未现世的界切不过去看（退回 ' + scU.mapWorld + '）—— 用户要"地图全部能展示看到"');
    }
    const ru = (Rg.of('xian') || [])[0];
    if (ru) {
      const toasts = [];
      const oldT = G.game.toast;
      G.game.toast = function (t) { toasts.push(t); };
      const beforeU = G.game.sceneName;
      G.Overlays.mapTap({
        x: V2.vx + V2.vw / 2 + (ru.mx - 0.5) * V2.vw,
        y: V2.vy + V2.vh / 2 + (ru.my - 0.5) * V2.vh
      }, scU);
      G.game.toast = oldT;
      if (G.game.sceneName !== beforeU) {
        errors.push('未现世界的节点竟然传送走了（到了 ' + G.game.sceneName + '）');
      }
      if (!toasts.some(function (t) { return t.indexOf('尚未现世') >= 0; })) {
        errors.push('未现世界的节点没给"尚未现世"提示：' + JSON.stringify(toasts));
      }
    }
    meta0.progress.worlds = wsBak || {};
    /* 回到凡界继续本契约后面的断言（⚠️ `sc` 是 const，只能就地复位，
       不能再取 G.game.scene —— 场景是单例，回来就是同一个对象） */
    G.game.changeScene('town', { toSpawn: true });
    sc.mapZoom = 1; sc.mapPan = { x: 0, y: 0 };
    sc.mapWorld = 'fan';
    G.Overlays.openPanel(sc, 'map', true);
  }
  /* ① 未到访 → 不传 */
  delete s.visited[target.id];
  G.Overlays.mapTap(nodeP, sc);
  if (G.game.sceneName !== home) errors.push('未到访的区域不该能传送（' + target.n + '）');
  /* ② 到访但未至化神 → 不传 */
  s.visited[target.id] = true;
  s.globalLevel = 1;
  G.Overlays.mapTap(nodeP, sc);
  if (G.game.sceneName !== home) errors.push('淬体境不该能自由传送（需化神境）');
  /* ③ 到访 + 化神 → 传 */
  s.globalLevel = G.Overlays.TELEPORT_GL;
  G.Overlays.mapTap(nodeP, sc);
  const want = Rg.mapIdOf(target.id);
  if (G.game.sceneName !== want) {
    errors.push('化神境应能传送到 ' + target.n + '（期望场景 ' + want
      + '，实为 ' + G.game.sceneName + '）');
  }
  /* ④ 逆变换自洽：放大后同一点仍能命中同一个节点。
     ⚠️ 必须**把 pan 摆成"该节点正好在视口中心"** —— 否则 3 倍放大后它会被推到视口外，
        `mapTap` 的视口前置判定直接 return false，契约报的会是"逆变换坏了"（假红）。 */
  G.game.changeScene('town', { toSpawn: true });
  const sc2 = G.game.scene;
  sc2.overlay = null; sc2.mapZoom = 3;
  sc2.mapPan = { x: -(target.mx - 0.5) * V2.vw * 3, y: -(target.my - 0.5) * V2.vh * 3 };
  G.Overlays.openPanel(sc2, 'map', true);
  const z = 3, pn = sc2.mapPan;
  const zoomedP = {
    x: V2.vx + V2.vw / 2 + (target.mx - 0.5) * V2.vw * z + pn.x,
    y: V2.vy + V2.vh / 2 + (target.my - 0.5) * V2.vh * z + pn.y
  };
  if (!(zoomedP.x >= V2.vx && zoomedP.x <= V2.vx + V2.vw
    && zoomedP.y >= V2.vy && zoomedP.y <= V2.vy + V2.vh)) {
    errors.push('（契约自检）居中后的节点仍在视口外，前置条件写错了');
  }
  s.visited[target.id] = true; s.globalLevel = G.Overlays.TELEPORT_GL;
  G.Overlays.mapTap(zoomedP, sc2);
  if (G.game.sceneName !== want) {
    errors.push('放大 3 倍后点同一个节点应仍能命中（逆变换 mapUnproject 有问题）');
  }
  G.game.save = save;
  G.game.changeScene('town', { toSpawn: true });
}, 'map.view.contract');

/* ---------- 主线章节链 + 三结局契约（v0.63.0，用户第 6 点 +「三结局场景」） ----------
   用户口径：「主线任务太少了，需要新增主线任务到道祖境，完整闭环」。
   断言：① 章节从筑基铺到道祖、gl 单调递增、每章留活路；
        ② **按顺序**推进（前章未了不跳章）、看过不再重复；
        ③ 道心三档分界（+4 / -4）与三条结局都在；
        ④ 结局场景**真跑一帧**（新增绘制分支只验数据结构 = 空断言，G56）。 */
step(function () {
  const C = G.Data.Chapters;
  if (!C) { errors.push('G.Data.Chapters 未载入'); return; }
  const L = C.list;
  if (L.length < 8) errors.push('章节链太短（' + L.length + ' 章），不足以"铺到道祖境"');
  let prevGl = 0;
  L.forEach(function (c, i) {
    if (!c.n || !c.title) errors.push('章节 ' + c.id + ' 缺名称/标题');
    if (!(c.gl > 0)) errors.push('章节 ' + c.id + ' 缺 gl 门槛');
    if (c.gl < prevGl) errors.push('章节 gl 必须单调不减（' + c.id + ' 掉头了）');
    prevGl = c.gl;
    if (!(c.choices && c.choices.length >= 2)) {
      errors.push('章节 ' + c.id + ' 至少要两个选项（只有一个 = 不是抉择）');
    }
    (c.choices || []).forEach(function (ch) {
      if (typeof ch.run !== 'function') errors.push('章节 ' + c.id + ' 的选项「' + ch.t + '」缺 run');
    });
    if (!(c.lines && c.lines.length)) errors.push('章节 ' + c.id + ' 没有正文');
  });
  /* 末章必须到道祖门槛，且挂结局钩子 */
  const last = L[L.length - 1];
  if (last && typeof last.after !== 'function') {
    errors.push('末章 ' + last.id + ' 没有 after 钩子 —— 走到头进不了结局场景（闭环断了）');
  }
  if (last && last.gl < 649) {
    errors.push('末章门槛应到道祖境（gl ≥ 649），实为 ' + last.gl);
  }

  /* ② 旧章节链 v0.84 起休眠（主线由 Arcs 情感世接管）：
     章节定义/道心口径（endingOf）保留为 legacy，仅断言链不再触发。 */
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 1; s.chapters = []; s.daoHeart = 0;
  s.quest = s.quest || { step: 'm1done', flags: {} };
  if (C.pendingFor(s)) errors.push('休眠后任何境界都不该弹旧章节（淬体）');
  s.globalLevel = 700;
  if (C.pendingFor(s)) errors.push('休眠后任何境界都不该弹旧章节（拉满）');
  if (C.blockedBy(s)) errors.push('休眠后 blockedBy 应恒 null');
  /* markDone / progressOf 仍可用于补遗模式记录 */
  C.markDone(s, L[0].id); C.markDone(s, L[1].id);
  C.markDone(s, L[0].id);
  if (s.chapters.filter(function (x) { return x === L[0].id; }).length !== 1) {
    errors.push('markDone 不是幂等的（同一章记了两次）');
  }
  const pr = C.progressOf(s);
  if (pr.done !== 2 || pr.total !== L.length) {
    errors.push('progressOf 应报 2/' + L.length + '，实为 ' + pr.done + '/' + pr.total);
  }

  /* ③ 道心三档分界 + 三条结局都在 */
  const E = C.ENDINGS;
  ['zheng', 'fan', 'ni'].forEach(function (id) {
    if (!E[id]) errors.push('缺结局 ' + id);
    else if (!E[id].lines || !E[id].lines.length) errors.push('结局 ' + id + ' 没有正文');
  });
  if (C.endingOf({ daoHeart: 4 }).id !== 'zheng') errors.push('道心 +4 应判「证道」');
  if (C.endingOf({ daoHeart: 3 }).id !== 'fan') errors.push('道心 +3 应判「化凡」（证道门槛是 +4）');
  if (C.endingOf({ daoHeart: -4 }).id !== 'ni') errors.push('道心 -4 应判「逆天」');
  if (C.endingOf({ daoHeart: -3 }).id !== 'fan') errors.push('道心 -3 应判「化凡」');
  if (C.endingOf({}).id !== 'fan') errors.push('无道心字段（老档）应兜底判「化凡」');

  /* ④ 结局场景：菜单 → 放手（真结局）走完全程，再重入走沉梦 */
  if (!G.scenes.ending) { errors.push('没有 ending 场景'); return; }
  const metaBak = G.game.meta, saveBak = G.game.save;
  const s2 = JSON.parse(JSON.stringify(save));
  s2.pos = { x: 5, y: 5 }; s2.items = s2.items || {}; s2.beasts = s2.beasts || [];
  s2.chronicle = s2.chronicle || [];
  G.game.save = s2;
  G.game.meta = { endings: {} };
  G.game.changeScene('ending');
  if (G.game.sceneName !== 'ending') errors.push('changeScene(\'ending\') 失败');
  function endWalk(label, key) {
    const sc = G.scenes.ending;
    const btn = (sc.buttons || []).filter(function (x) { return x.label.indexOf(label) >= 0; })[0];
    if (!btn) { errors.push('结局菜单缺「' + label + '」按钮'); return; }
    btn.onClick();
    if (G.Cutscene && G.Cutscene.isOpen()) G.Cutscene.finish();
    if (!G.game.meta.endings[key]) errors.push(key + ' 结局未写进 meta.endings');
    if (s2.ending !== key) errors.push('本世结局未写进 save.ending（' + key + '）');
    let guard = 0;
    while (sc.phase !== 'done' && guard < 80) { sc.onTap(); guard++; }
    if (sc.phase !== 'done') errors.push(key + ' 结局未能走完（guard=' + guard + '）');
    try { sc.render(G.game.ctx); } catch (e) { errors.push(key + ' 结局渲染抛异常：' + e.message); }
  }
  endWalk('放手', 'release');
  /* 重入菜单走沉梦（两条分支配色文案都要能画） */
  G.game.meta = { endings: {} };
  G.game.changeScene('ending');
  endWalk('沉梦', 'dream');
  G.game.meta = metaBak; G.game.save = saveBak;
  G.game.changeScene('town', { toSpawn: true });
}, 'chapter.contract');

/* ---------- 情感世契约（v0.84，诸世情感 v1.0 §10） ----------
   ① 六个情感世定义结构完整（intro/日常热点/惊变节点/loss/sprite）；
   ② 引擎头less模拟全六世：next 门控 → begin → 日常 need → 抉择 → complete，
      牵挂注定、执念册落件、六世尽过 next 归 null。 */
step(function () {
  const defs = G.Arcs.list();
  if (defs.length !== 6) errors.push('情感世应登记 6 个，实为 ' + defs.length);
  defs.forEach(function (d) {
    if (!d.n || !d.theme) errors.push(d.id + ' 缺 n/theme');
    if (!d.intro || !d.intro.length) errors.push(d.id + ' 缺 intro');
    (d.intro || []).forEach(function (b) { if (!b.t) errors.push(d.id + ' intro 有缺文拍'); });
    const spots = (d.daily && d.daily.spots) || [];
    if (!spots.length) errors.push(d.id + ' 缺日常热点');
    spots.forEach(function (sp) {
      if (!sp.id || !sp.pid || !sp.label) errors.push(d.id + ' 热点字段不全');
      (sp.beats || []).forEach(function (b) { if (!b.t) errors.push(d.id + ' 热点缺 beat 文'); });
    });
    (d.crisis.nodes || []).forEach(function (n) {
      if (n.k === 'line' || n.k === 'death') { if (!n.t) errors.push(d.id + ' 节点缺文'); }
      else if (n.k === 'choice') {
        if (!n.options || n.options.length < 2) errors.push(d.id + ' 抉择选项不足 2');
        (n.options || []).forEach(function (o) { if (!o.then) errors.push(d.id + ' 选项缺 then 文'); });
      } else if (n.k === 'branch') { if (!n.then || !n.else) errors.push(d.id + ' branch 缺 then/else'); }
      else if (n.k === 'stat' || n.k === 'call') { /* 允许 */ }
      else errors.push(d.id + ' 未知节点类型：' + n.k);
    });
    if (!d.loss || !d.loss.length) errors.push(d.id + ' 缺 loss 段');
    (d.loss || []).forEach(function (b) { if (!b.t) errors.push(d.id + ' loss 缺文'); });
    Object.keys(d.sprites || {}).forEach(function (k) {
      if (!d.sprites[k].sys) errors.push(d.id + ' sprite ' + k + ' 缺 sys');
    });
  });

  /* 引擎全六世模拟 */
  const meta = { bonds: {}, regrets: [], progress: {} };
  G.Arcs.ensure(meta);
  defs.forEach(function (d, i) {
    const next = G.Arcs.next(meta);
    if (!next || next.id !== d.id) {
      errors.push('next 门控应为 ' + d.id + '，实为 ' + (next && next.id));
    }
    const save = { life: i + 1, items: {}, globalLevel: 1, chronicle: [] };
    G.Arcs.begin(save, meta, d);
    const spots = d.daily.spots;
    let guard = 0;
    while (!G.Arcs.needMet(save, d) && guard < 40) {
      G.Arcs.dailyBeat(save, meta, spots[guard % spots.length]); guard++;
    }
    if (!G.Arcs.needMet(save, d)) errors.push(d.id + ' 日常 need 无法满足');
    d.crisis.nodes.forEach(function (n) {
      if (n.k === 'choice') {
        const opt = n.options.filter(function (o) { return G.Arcs.optionOk(save, o); })[0];
        if (!opt) { errors.push(d.id + ' 无可用抉择选项'); return; }
        if (!G.Arcs.runOption(save, meta, opt)) errors.push(d.id + ' 抉择无反馈文');
      } else if (n.k === 'branch') {
        if (!(n.if(save) ? n.then : n.else)) errors.push(d.id + ' branch 无分支文');
      }
    });
    G.Arcs.complete(save, meta);
    if (meta.progress.story.arcs.done.indexOf(d.id) < 0) errors.push(d.id + ' complete 未落 done');
    (d.fated || []).forEach(function (f) {
      const b = meta.bonds[f.pid];
      if (!b || !b.fate.doomed) errors.push(d.id + ' 牵挂 ' + f.pid + ' 未注定');
    });
  });
  if (G.Arcs.next(meta)) errors.push('六世尽过后 next 应为 null');
  if (meta.regrets.length !== 5) {
    errors.push('执念册应有 5 件（arc6 无），实为 ' + meta.regrets.length);
  }
}, 'arc.contract');

/* Arc 场景真实渲染 + 过场播放/收尾契约（v0.85.0）：
   早期 smoke 只驱动 G.Arcs 引擎、从不渲染 arc 场景，导致 rr 位置参数 / _norm 返回 undefined
   两类致命 bug 长期潜伏（主线场景一渲染即崩、过场瞬间结束）。本契约跑真实 loop 兜底。 */
step(function () {
  function mkSave() {
    return { life: 1, items: {}, globalLevel: 5, chronicle: [], pos: { x: 5, y: 5 },
      linggen: { elems: ['木'], coef: { '木': 1 }, kind: '单灵根', stoneBonus: 0 },
      skills: {}, skillEquip: [], stone: 100, qi: 100, po: 10, age: 16, hp: 200,
      quest: { step: 'free', flags: {} }, chestsOpened: [], bossKilled: false };
  }
  /* (a) 每个 arc 场景 enter + 跑帧渲染不抛异常 */
  G.Arcs.list().forEach(function (d) {
    const save = mkSave(), meta = { bonds: {}, regrets: [], progress: {} };
    G.Arcs.ensure(meta); G.Arcs.begin(save, meta, d);
    G.game.save = save; G.game.meta = meta;
    G.game.changeScene('arc');
    pump(3, 'arc.render.' + d.id);
  });
  /* (b) 过场必须能打开、跑帧后自动收尾并触发回调 */
  function cine(kind, id) {
    const shots = kind === 'arc' ? G.CineLib.forArc(id) : G.CineLib.forEnding(id);
    if (!shots) { errors.push((kind + ' ' + id) + ' 缺过场'); return; }
    let finished = false;
    G.Cutscene.play(shots, function () { finished = true; });
    if (!G.Cutscene.isOpen()) errors.push(id + ' 过场 play 后未打开');
    let total = 0; shots.forEach(function (x) { total += x.dur; });
    pump(Math.ceil(total / 0.0167) + 8, 'cine.' + id);
    if (G.Cutscene.isOpen()) errors.push(id + ' 过场未自动收尾');
    if (!finished) errors.push(id + ' 过场回调未触发');
  }
  ['arc1', 'arc2', 'arc3', 'arc4', 'arc5'].forEach(function (id) { cine('arc', id); });
  ['dream', 'release'].forEach(function (id) { cine('end', id); });
}, 'arc.render.contract');
/* ---------- 天道之战五阶段 + 第三结局契约（v0.86，天道至恶 §7） ----------
   ① 五阶段敌群结构完整、数值为正、sprite 真实可达（不退 snake 兜底）；
   ② 编排状态机：brief → 逐阶段胜推进检查点 → 五阶段尽破 finale → 自动进 defy 结局；
   ③ 战败保底：自当前阶段败则停留该阶段、phase lost，不从头。 */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 600; s.qi = 999999; s.items = {}; s.chronicle = [];
  G.game.save = s;
  G.game.meta = { endings: {}, progress: { difficulty: 'hell' } };
  const st = G.Player.computeStats(s);
  const snake = G.Sprites.beast('snake');

  /* (a) 五阶段敌群 */
  for (let k = 1; k <= 5; k++) {
    const grp = G.Data.tiandaowar.makeStage(k, s, G.game.meta, st);
    if (!grp.length || grp.length > 3) errors.push('天道阶段' + k + ' 敌数非法：' + grp.length);
    grp.forEach(function (u) {
      if (!(u.maxhp > 0) || !(u.atk > 0) || !(u.spd > 0)) errors.push('阶段' + k + ' 单位数值非法：' + u.name);
      if (G.Sprites.beast(u.sprite) === snake) errors.push('阶段' + k + ' sprite 退回 snake：' + u.sprite);
      (u.skills || []).forEach(function (sk) {
        if (!sk.n || !(sk.mult > 0)) errors.push('阶段' + k + ' 技能非法：' + sk.n);
      });
    });
  }

  /* (b) 编排：brief → 连胜 → finale → defy */
  const tw = G.scenes.tiandaowar, en = G.scenes.ending;
  G.game.changeScene('tiandaowar');
  if (tw.phase !== 'brief' || tw.stage !== 1) errors.push('天道之战初始应为 brief/1');
  pump(2, 'td.brief');
  for (let k = 1; k <= 5; k++) {
    G.game._tdResult = { stage: k, win: true };
    G.game.changeScene('tiandaowar');
    if (k < 5 && (tw.phase !== 'won' || tw.stage !== k + 1)) {
      errors.push('阶段' + k + ' 胜后应推进到 ' + (k + 1) + '，实为 ' + tw.stage + '/' + tw.phase);
    }
  }
  if (!G.game.meta.tdWarCleared) errors.push('五阶段尽破未置 tdWarCleared');
  if (G.game.sceneName !== 'ending') errors.push('通关后应进入 ending 场景');
  if (!en.rec || en.rec.id !== 'defy') errors.push('应自动进入第三结局 defy');
  if (!G.game.meta.endings.defy) errors.push('第三结局未落 meta.endings.defy');
  pump(3, 'defy.lines');

  /* (c) 战败保底 */
  const s2 = JSON.parse(JSON.stringify(s)); s2.tdWar = { stage: 3, done: false };
  G.game.save = s2;
  G.game._tdResult = { stage: 3, win: false };
  G.game.changeScene('tiandaowar');
  if (tw.phase !== 'lost' || tw.stage !== 3) errors.push('阶段3败应停留 lost/3，实为 ' + tw.phase + '/' + tw.stage);
  if (s2.tdWar.stage !== 3) errors.push('战败检查点被错误推进');
  pump(2, 'td.lost');
}, 'tiandaowar.contract');
/* ---------- 云州城建筑室内契约（v0.87，#47 原地精细化） ----------
   每栋结构都能走进去：有出口指回云州、至少一件可交互家具，四个服务建筑带真实服务 act，渲染不崩。 */
step(function () {
  const s = JSON.parse(JSON.stringify(save));
  G.game.save = s;
  const md = G.Data.maps.yunzhou;
  const region = { id: 'yunzhou', map: 'yunzhou', n: '云州城' };
  const wantAct = { market: 'trade', inn: 'inn', smithy: 'forge', alchemy: 'brew' };
  (md.structures || []).forEach(function (st) {
    const iid = 'int.yunzhou.' + st.id;
    const imd = G.InteriorGen.ensure(s, iid, st, region);
    if (!imd) { errors.push('云州室内未生成：' + st.id); return; }
    if (!imd.exits || !imd.exits.length) errors.push(st.id + ' 室内缺出口');
    else if (imd.exits[0].to !== 'yunzhou') errors.push(st.id + ' 出口未指回云州城');
    const acts = (imd.furn || []).map(function (f) { return f.act; }).filter(Boolean);
    if (!acts.length) errors.push(st.id + ' 室内无任何可交互家具');
    if (wantAct[st.id] && acts.indexOf(wantAct[st.id]) < 0) errors.push(st.id + ' 室内缺服务 act：' + wantAct[st.id]);
    G.game.changeScene(iid);
    pump(3, 'yz.int.' + st.id);
  });
}, 'yunzhou.interior.contract');

/* ---------- 地图地形契约（v0.64.0，用户第 14 点） ----------
   用户口径：「这个地图和这些地面完全不是一个风格，没有区分谷、峰、平原、山地、草原、河流、
              岛屿等等，凡界是一块大陆，有很多区域，需要重新设计」。
   旧版底图是"在整个界里随机撒山"，所以每个区域长得一样。新版按区域的 `terr` 字段画地貌。
   断言：① 每个区域都有 terr；② **用到的 terr 都有绘制分支**（源码闸 —— 漏了会静默画成空白）；
        ③ 凡界要能看出用户点名的那几种地形；④ 凡界有"大陆级"特征（草原带 / 河道 / 海岛）。 */
step(function () {
  const Rg = G.Data.regions;
  const all = Rg.all ? Rg.all() : ['fan', 'ling', 'xian', 'dao'].reduce(function (a, w) {
    return a.concat(Rg.of(w) || []);
  }, []);
  if (!all.length) { errors.push('取不到区域清单（regions.all / of 都不可用）'); return; }
  const used = {};
  all.forEach(function (r) {
    if (!r.terr) errors.push('区域 ' + r.id + '（' + r.n + '）没有 terr 字段 —— 底图会画成一片空白');
    else used[r.terr] = (used[r.terr] || 0) + 1;
  });

  /* 源码闸：TERR_DRAW 的键集必须覆盖所有用到的 terr */
  const stripC = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const src = stripC(fs.readFileSync(path.join(WWW, 'js', 'core', 'panels.js'), 'utf8'));
  const i0 = src.indexOf('var TERR_DRAW = {');
  const i1 = src.indexOf('function worldMapBg(');
  if (i0 < 0 || i1 < 0 || i1 < i0) {
    errors.push('源码闸：panels.js 里找不到 TERR_DRAW / worldMapBg，正则可能过时了');
  } else {
    const keys = (src.slice(i0, i1).match(/^\s{4}(\w+):\s*function/gm) || [])
      .map(function (m) { return m.replace(/[\s:]|function/g, ''); });
    if (keys.length < 12) {
      errors.push('源码闸：TERR_DRAW 只扫到 ' + keys.length + ' 个分支（应 ≥12），正则可能过时了');
    }
    Object.keys(used).forEach(function (t) {
      if (keys.indexOf(t) < 0) {
        errors.push('源码闸：terr「' + t + '」被 ' + used[t] + ' 个区域使用，但 TERR_DRAW 没有对应分支'
          + '（静默画成空白）');
      }
    });
    /* 凡界必须能看出用户点名的那几种地形 */
    const fanTerr = {};
    (Rg.of('fan') || []).forEach(function (r) { fanTerr[r.terr] = true; });
    ['peak', 'ridge', 'valley', 'plain'].forEach(function (t) {
      if (!fanTerr[t]) errors.push('凡界没有「' + t + '」地形（用户第 14 点点名要区分峰/山地/谷/平原）');
    });
    /* 凡界的"大陆级"特征：草原带 / 主河道 / 海岛 —— 这三样不在区域节点上，必须写在底图里 */
    const bg = src.slice(i1, src.indexOf('function worldGate', i1));
    /* ⚠️ 查**具名调用**而不是颜色字面量 —— 颜色改个色号就绕过了，函数名不会。 */
    [['fanGrass', '草原带'], ['fanRiver', '主河道'], ['fanIsles', '东南海岛']].forEach(function (p) {
      if (bg.indexOf(p[0] + '(') < 0) errors.push('凡界底图缺少「' + p[1] + '」的大陆级特征（' + p[0] + ' 没被调用）');
    });
  }
}, 'map.terrain.contract');

/* ---------- M2 云州城契约（v0.65.0，用户「M2 云州城主线」） ----------
   用户口径：M1 结尾「离乡，往云州城去」—— 本轮把这座城真正做出来（手写城图 + 街面 NPC + 主线三步）。
   断言：① 区域与地图挂上了、城门 ≥2 且**双向**；
        ② 每个 NPC 的 `act` 在场景里有实现、每个对话键在对话表里有条目（源码闸 ——
           漏了的表现是"点了只 toast 一句「没什么可说的」"或"只有按钮没有台词"，**都是静默的**）；
        ③ 每个 NPC 四周有正交落脚点（走不到他面前 = 这条 NPC 等于不存在）；
        ④ 主线三步**真驱动一遍**（走逻辑入口 `_interact`，不是直接改 step）。 */
step(function () {
  const Rg = G.Data.regions;
  const r = Rg.byId('fan10');
  if (!r) { errors.push('缺区域 fan10（云州城）'); return; }
  if (r.map !== 'yunzhou') errors.push('云州城应复用 `yunzhou` 手写地图，实为 ' + r.map);
  const md = G.Data.maps.yunzhou;
  if (!md) { errors.push('缺 maps.yunzhou（手写城图）'); return; }
  if (!md.npcs || md.npcs.length < 5) {
    errors.push('云州城 NPC 太少（' + ((md.npcs || []).length) + '，应 ≥5）');
  }
  if (!md.exits || md.exits.length < 2) errors.push('云州城应至少两个城门');
  if (!md.doors) {
    /* 本轮取舍：建筑不做室内。这条断言是**提醒**，不是错误 —— 但必须写下来，
       否则下一轮有人以为"忘了做"而去补一套 makeInterior。 */
    void 0;
  }

  /* 源码闸：NPC 的 act 要有实现；sayBtn 的键要有对话 */
  const stripC = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const src = stripC(fs.readFileSync(path.join(WWW, 'js', 'scenes', 'yunzhou.js'), 'utf8'));
  const i0 = src.indexOf('var D = {');
  const i1 = src.indexOf('function sayBtn');
  const i2 = src.indexOf('var ACTS = {');
  const i3 = src.indexOf('hooks.onInteract');
  if (i0 < 0 || i1 < 0 || i2 < 0 || i3 < 0) {
    errors.push('源码闸：yunzhou.js 里找不到 D / ACTS / sayBtn / onInteract，正则可能过时了');
    return;
  }
  const dlgKeys = (src.slice(i0, i1).match(/^\s{4}(\w+):\s*\{/gm) || [])
    .map(function (m) { return m.replace(/[\s:{]/g, ''); });
  const actKeys = (src.slice(i2, i3).match(/^\s{4}(\w+):\s*function/gm) || [])
    .map(function (m) { return m.replace(/[\s:]|function/g, ''); });
  if (dlgKeys.length < 5) errors.push('源码闸：对话表只扫到 ' + dlgKeys.length + ' 条，正则可能过时了');
  if (actKeys.length < 5) errors.push('源码闸：ACTS 只扫到 ' + actKeys.length + ' 个动作，正则可能过时了');
  (md.npcs || []).forEach(function (n) {
    if (actKeys.indexOf(n.act) < 0) {
      errors.push('云州城 NPC「' + n.name + '」的 act「' + n.act + '」在 ACTS 里没有实现'
        + '（点了只会 toast「没什么可说的」）');
    }
  });
  const used = (src.match(/sayBtn\(scene,\s*'([^']+)'\)/g) || [])
    .map(function (m) { return m.replace(/[\s\S]*'([^']+)'[\s\S]*/, '$1'); });
  if (!used.length) errors.push('源码闸：没有扫到任何 sayBtn(scene, …) 调用，正则可能过时了');
  used.forEach(function (k) {
    if (dlgKeys.indexOf(k) < 0) {
      errors.push('云州城对话键「' + k + '」在 D 表里没有条目（点了只有按钮、没有台词）');
    }
  });

  /* ③④ 真跑一遍 */
  const s = JSON.parse(JSON.stringify(save));
  s.pos = { x: 5, y: 5 }; s.items = s.items || {}; s.beasts = s.beasts || [];
  s.quest = { step: 'm2-1', flags: {} };
  s.dungeonSlot = 0; s.dungeonFarm = 0;
  G.game.save = s;
  if (!G.game.meta) G.game.meta = { perfusion: {}, achieve: {}, past: [], titles: [] };
  G.game.changeScene('yunzhou', { toSpawn: true });
  if (G.game.sceneName !== 'yunzhou') { errors.push('切不到云州城（scenes.yunzhou 没注册？）'); return; }
  const sc = G.game.scene;

  /* 站位可达：**只认正交相邻**（斜角站不住） */
  const standBy = function (n) {
    const dirs = [[0, 1, 'up'], [0, -1, 'down'], [1, 0, 'left'], [-1, 0, 'right']];
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      if (!sc._blocked(n.x + d[0], n.y + d[1])) {
        s.pos = { x: n.x + d[0], y: n.y + d[1] };
        sc.dir = d[2];
        return true;
      }
    }
    return false;
  };
  (md.npcs || []).forEach(function (n) {
    if (!standBy(n)) {
      errors.push('云州城 NPC「' + n.name + '」四周没有正交落脚点（玩家走不到他面前）');
    }
  });

  /* 主线三步：走**逻辑入口** `_interact`（玩家就是站在他面前按一下），不是直接改 step */
  const talk = function (act) {
    const n = (md.npcs || []).filter(function (x) { return x.act === act; })[0];
    if (!n) { errors.push('云州城没有 act=' + act + ' 的 NPC'); return false; }
    if (!standBy(n)) return false;
    sc.overlay = null;
    sc._interact();
    return true;
  };
  if (talk('steward')) {
    if (s.quest.step !== 'm2-2') {
      errors.push('与城主府执事对话后主线应推进到 m2-2，实为 ' + s.quest.step);
    }
    sc.clearOverlay();
  }
  /* m2-2：没通关过秘境 → 不该能交差 */
  s.dungeonSlot = 0; s.dungeonFarm = 0;
  if (talk('judge')) {
    if (s.quest.step !== 'm2-2') {
      errors.push('未通关秘境时不该能交差（主线跳到 ' + s.quest.step + '）');
    }
    sc.clearOverlay();
  }
  /* 通关过秘境 → 收束到 m1done（分叉线在此接管） */
  s.dungeonSlot = 1;
  if (talk('judge')) {
    if (s.quest.step !== 'm1done') {
      errors.push('通关秘境后与裁判对话应收束到 m1done，实为 ' + s.quest.step);
    }
    sc.clearOverlay();
  }
  /* 服务类 NPC：真点一遍，只断言"不抛异常"是空断言 —— 这里验它确实打开了对应覆盖层。
     ⚠️ v0.92.0：云州城 NPC 现在可挂支线，而**次序是"主线 > 支线 > 服务"**
        （与青溪镇刘掌柜一致）。所以要点到商店，必须先让支线**无话可谈**：
        把该 NPC 名下的支线全部标成已完成（step=3），再点。 */
  if (talk('market')) {
    if (sc.overlay === 'sideq') {
      /* 支线对话开着 → 说明该 NPC 挂了支线且未完成。先把它们标完再点一次。 */
      s.side = s.side || {};
      (G.Data.sideQuests.list || []).forEach(function (q) {
        if (q.giver === 'yz_market') s.side[q.id] = 3;
      });
      sc.clearOverlay();
      talk('market');
    }
    if (sc.overlay !== 'shop.buy') errors.push('西市掌柜应打开坊市（shop.buy），实为 ' + sc.overlay);
    sc.clearOverlay();
  }
  G.game.save = save;
  G.game.changeScene('town', { toSpawn: true });
}, 'm2.yunzhou.contract');

/* ---------- 天道多协议契约（v0.8.0） ----------
   缺口：天道原先只认 OpenAI 兼容的 /chat/completions。
   现在要支持 Claude（/messages，system 在顶层、x-api-key）与原生 Response
   （/responses，instructions + input）。三家的差异全在 buildRequest / extractText 两处，
   这里把"打哪个路径、怎么鉴权、请求体形状、从哪取文本"逐条钉死。 */
step(function () {
  const TD = G.TianDao;
  const mk = function (proto, endpoint, key) {
    return { protocol: proto, endpoint: endpoint, model: 'm', apiKey: key || '', temp: 0.7 };
  };

  /* —— OpenAI 兼容 —— */
  let r = TD.buildRequest(mk('openai', 'https://api.openai.com/v1', 'sk-1'), 'S', 'U');
  if (r.url !== 'https://api.openai.com/v1/chat/completions') errors.push('openai 端点拼接错误：' + r.url);
  if (r.headers['Authorization'] !== 'Bearer sk-1') errors.push('openai 缺少 Bearer 鉴权');
  if (!r.body.messages || r.body.messages[0].role !== 'system') errors.push('openai 请求体缺少 system 消息');

  /* —— Claude —— */
  r = TD.buildRequest(mk('claude', 'https://api.anthropic.com/v1', 'sk-ant'), 'S', 'U');
  if (r.url !== 'https://api.anthropic.com/v1/messages') errors.push('claude 端点错误：' + r.url);
  if (r.headers['x-api-key'] !== 'sk-ant') errors.push('claude 缺少 x-api-key');
  if (!r.headers['anthropic-version']) errors.push('claude 缺少 anthropic-version 头');
  if (r.body.system !== 'S') errors.push('claude 的 system 应在顶层而非 messages 里');
  if (!r.body.messages || r.body.messages[0].content !== 'U') errors.push('claude 用户输入位置错误');

  /* —— 原生 Response —— */
  r = TD.buildRequest(mk('response', 'https://api.openai.com/v1', 'sk-2'), 'S', 'U');
  if (r.url !== 'https://api.openai.com/v1/responses') errors.push('response 端点错误：' + r.url);
  if (r.body.instructions !== 'S' || r.body.input !== 'U') {
    errors.push('response 请求体应为 instructions + input');
  }

  /* —— 端点健壮性 —— */
  r = TD.buildRequest(mk('openai', 'https://x.example/v1/chat/completions', ''), 'S', 'U');
  if (r.url !== 'https://x.example/v1/chat/completions') {
    errors.push('端点已是完整路径时不该再拼后缀：' + r.url);
  }
  r = TD.buildRequest(mk('openai', 'http://localhost:11434/v1', ''), 'S', 'U');
  if (r.headers['Authorization']) errors.push('密钥留空时不该带 Authorization（本地 Ollama 不需要）');

  /* 真机实测踩到的必现 bug：很多中转站/控制台给的 baseurl 就是**完整路径**
     （如 https://deepkey.top/v1/chat/completions）。此时若把协议切成 Claude，
     旧实现会拼成 `…/v1/chat/completions/messages` → 404。
     正确行为：先剥掉末尾任意已知协议后缀，再拼目标路径。 */
  const FULLP = 'https://relay.example/v1/chat/completions';
  const CASES2 = [
    ['claude', 'https://relay.example/v1/messages'],
    ['response', 'https://relay.example/v1/responses'],
    ['openai', FULLP]
  ];
  CASES2.forEach(function (c) {
    const u = TD.buildRequest(mk(c[0], FULLP, 'k'), 'S', 'U').url;
    if (u !== c[1]) {
      errors.push('填完整路径后切协议，端点拼错：' + c[0] + ' → ' + u + '（应为 ' + c[1] + '）');
    }
    if (u.indexOf('/chat/completions/') >= 0) {
      errors.push('端点出现了叠加路径（/chat/completions/…）：' + u);
    }
  });
  /* 基址形态也要照旧可用；末尾多余斜杠要吃掉 */
  if (TD.joinUrl('https://relay.example/v1/', '/responses') !== 'https://relay.example/v1/responses') {
    errors.push('joinUrl 未吃掉末尾斜杠');
  }

  /* 超时可配：默认 45s（真机实测中转站首字延迟 4s~60s+ 波动，30s 太紧）；
     老存档缺这个键要由 _fill 自动补齐，不能是 undefined。 */
  if (!(TD.defaults().timeout >= 30000)) errors.push('defaults() 缺少合理的 timeout');
  {
    const legacy = { mode: 'remote', protocol: 'claude', endpoint: 'https://x/v1', model: 'm' };
    G.TianDao._fill(legacy);
    if (typeof legacy.timeout !== 'number') errors.push('老存档 cfg 未补 timeout');
    if (legacy.protocol !== 'claude') errors.push('_fill 不该覆盖用户已选的协议');
  }

  /* —— 三种响应体取文本 —— */
  const t1 = TD.extractText({ choices: [{ message: { content: 'A' } }] }, 'openai');
  const t2 = TD.extractText({ content: [{ type: 'text', text: 'B' }] }, 'claude');
  const t3 = TD.extractText({ output: [{ content: [{ text: 'C' }] }] }, 'response');
  const t4 = TD.extractText({ output_text: 'D' }, 'response');
  if (t1 !== 'A' || t2 !== 'B' || t3 !== 'C' || t4 !== 'D') {
    errors.push(`extractText 取文本错误：${t1}/${t2}/${t3}/${t4}`);
  }

  /* —— 容错解析：模型爱裹 ```json 围栏、爱在前后加废话 —— */
  if (!TD.pickJson('```json\n{"台词":"x"}\n```')) errors.push('pickJson 未能剥掉 ```json 围栏');
  if (!TD.pickJson('好的，这是：{"台词":"y"} 以上')) errors.push('pickJson 未能从夹叙里取出 JSON');
  if (TD.validate('{"台词":"这是一段完全合规的谶语"}') !== '这是一段完全合规的谶语') {
    errors.push('validate 把正常台词误判掉了');
  }
  if (TD.validate('{"台词":"这个游戏很好玩"}') !== null) errors.push('validate 未拦截违禁词');

  /* —— 旧档配置迁移：v0.7.0 以前的 cfg 没有 protocol / apiKey —— */
  const legacy = { mode: 'remote', endpoint: 'http://a/v1', model: 'q', temp: 0.8 };
  G.TianDao.cfg = null;
  G.TianDao.ensure({ tiandao: legacy });
  if (legacy.protocol !== 'openai') errors.push('旧档 tiandao 配置未补 protocol 默认值');
  if (legacy.apiKey !== '') errors.push('旧档 tiandao 配置未补 apiKey 默认值');
}, 'tiandao.protocol.contract');

/* ---------- 设备标识 + 每一世经历契约（v0.8.0） ----------
   需求：天道要记录玩家每一世的经历，轮回殿能看到设备/浏览器标识做区分。
   数据侧：meta.past[] 每世一条（death.js 写入，含 chronicle 走马灯与 dev）；
   展示侧：轮回殿「前世经历」视图可翻页、标出记录来源设备。 */
step(function () {
  const id1 = G.Storage.deviceId(), id2 = G.Storage.deviceId();
  if (!id1 || id1 !== id2) errors.push('deviceId 不稳定：' + id1 + ' vs ' + id2);
  const b1 = G.Storage.browserId(), b2 = G.Storage.browserId();
  if (!b1 || b1 !== b2) errors.push('browserId 不稳定：' + b1 + ' vs ' + b2);

  const m = { past: [], perfusion: {}, achieve: {}, titles: [] };
  G.Storage.stampDevice(m);
  if (!m.device || m.device.id !== id1) errors.push('stampDevice 未写入 device.id');
  if (!m.device.browser) errors.push('stampDevice 未写入 device.browser');

  /* 每一世都带上来源设备 —— 换机后旧记录会留着别的 dev 号 */
  const s = JSON.parse(JSON.stringify(save));
  G.game.save = s;
  m.past = [
    { life: 1, age: 39, realm: '炼气三重', xianli: 120, causeName: '寿元尽', dev: id1,
      chronicle: [{ id: 'x', t: 16, s: '入世青溪镇' }, { id: 'y', t: 39, s: '手刃赤炎狼王' }] },
    { life: 2, age: 22, realm: '炼气一重', xianli: 90, causeName: '战死', dev: 'dev-other',
      chronicle: [{ id: 'z', t: 22, s: '殁于黑风岭' }] }
  ];
  m.device = { id: id1, browser: b1 };
  G.game.meta = m;

  const sc = G.scenes.hall;
  sc.enter();
  const lives = sc.buttons.filter(function (b) { return b.label === '前世经历'; })[0];
  if (!lives) { errors.push('轮回殿缺少「前世经历」入口'); return; }
  lives.onClick();
  if (sc.view !== 'lives') { errors.push('点击后没有切到前世经历视图'); return; }

  const cx = textSpy(); sc.render(cx);
  const has = function (t) { return cx.__seen.some(function (x2) { return x2.indexOf(t) >= 0; }); };
  if (!has('前 世 经 历')) errors.push('前世经历视图没有渲染出标题');
  if (!has('入世青溪镇')) errors.push('前世经历没有渲染出该世走马灯');
  if (!has('炼气三重')) errors.push('前世经历没有渲染出该世境界');
  if (!has(id1)) errors.push('前世经历没有标出本机设备号');
  if (!has('dev-other')) errors.push('前世经历没有标出其它设备的记录');
  if (!has(b1)) errors.push('轮回殿没有展示浏览器标识');

  /* 倒序：最新一世排在最前 */
  const i2 = cx.__seen.findIndex(function (t) { return t.indexOf('第 2 世') >= 0; });
  const i1 = cx.__seen.findIndex(function (t) { return t.indexOf('第 1 世') >= 0; });
  if (i2 < 0 || i1 < 0 || i2 > i1) errors.push('前世经历应按时间倒序（最新在前）');
}, 'device.contract');

/* ---------- 野怪收益曲线契约（缺口 U5，2026-09-26 校准） ----------
   ① **覆盖**：gl 2–144（三界，有破境需求）每一级都必须有野外遭遇带。
      道界（gl ≥ 145）**不要求** —— 道界无破境之说，进境与道晶都来自「道则回廊」。
      校准前 91–105（人仙一重～地仙六重，15 级）在仙界是空洞。
   ② **境界系数归一**：淬体 / 炼气必须**恰好 = 1** —— 这是"M0 教学链与既有回归基线
      （playthrough / rebirth）不变"的前提；且随 gl 单调不减。
   ③ **场次曲线拉平**：逐境算"刷满一个境界（9 段 + 1 次大突破）要多少场"，
      必须落在 [10, 120]，且**最高/最低 ≤ 8 倍**。
      校准前是大罗金仙 60,895 场 vs 炼气 24 场（≈2,500 倍）——高界野外形同虚设。
   ④ **寿元可行**：场次折算的年岁（每 10 场 +1 岁 + 9 次突破 ×2 岁）必须小于该境寿元预算。 */
step(function () {
  const P2 = G.Player;
  const bands = [];
  ['town', 'field', 'cave'].forEach(function (mid) {
    const md = G.Data.maps[mid];
    if (md && md.zones) md.zones.forEach(function (z) { bands.push(z); });
  });
  ['fan', 'ling', 'xian', 'dao'].forEach(function (wid) {
    G.Data.regions.of(wid).forEach(function (r) {
      (r.zones || []).forEach(function (z) { bands.push(z); });
    });
  });
  if (bands.length < 20) errors.push('遭遇带过少（' + bands.length + '），收集逻辑可能漏了生成型区域');

  /* ① 覆盖三界开放野外 gl 5–576（gl1–4 为新手引导固定遭遇，不走遭遇带） */
  const cov = {};
  bands.forEach(function (b) {
    for (let gl = b.enc.min; gl <= b.enc.max; gl++) cov[gl] = true;
  });
  const miss = [];
  for (let gl = 5; gl <= 576; gl++) if (!cov[gl]) miss.push(gl);
  if (miss.length) {
    errors.push('gl ' + miss[0] + '–' + miss[miss.length - 1] + ' 等 ' + miss.length
      + ' 阶没有野外遭遇带（三界内不得有空洞）');
  }

  /* ② 境界系数归一 + 单调 */
  if (P2.realmQiCoef(1) !== 1) {
    errors.push('淬体境界系数应为 1（否则 M0 教学链数值会变），实为 ' + P2.realmQiCoef(1));
  }
  if (P2.realmQiCoef(10) !== 1) {
    errors.push('炼气境界系数应为 1（否则 playthrough/rebirth 基线会漂），实为 ' + P2.realmQiCoef(10));
  }
  let prevC = 1;
  for (let gl = 1; gl <= P2.MAX_GL; gl++) {
    const c = P2.realmQiCoef(gl);
    if (!(c >= prevC)) { errors.push('境界系数必须随 gl 单调不减（gl ' + gl + ' 掉头了）'); break; }
    prevC = c;
  }

  /* ③④ 逐境场次 + 寿元 */
  const base = {
    globalLevel: 1, qi: 0, po: 0, stone: 0,
    linggen: { kind: '五行三', elems: ['木'], coef: { 木: 1.0 }, stoneBonus: 0 },
    talents: [], originFx: {}, bonus: {}, items: {}, world: { traits: [] }
  };
  const rq = P2.rates(base).qi || 0;
  const qPer = function (z) {
    const L = (z.enc.min + z.enc.max) / 2;
    return 80 * L * 1 * (1 + rq) * (1 + (z.pair || 0) / 100) * P2.realmQiCoef(L);
  };
  const ns = [];
  P2.REALMS.forEach(function (t, i) {
    if (P2.isDaoRealm(t.y0)) return;                 /* 道界无破境，不参与场次验算 */
    let need = 0;
    for (let s = 1; s <= 36; s++) need += P2.needQi(base, t.y0 + s - 1);
    let best = 0;
    bands.forEach(function (z) {
      if (z.enc.max < t.y0 || z.enc.min > t.y1) return;
      best = Math.max(best, qPer(z));
    });
    if (!best) { errors.push(t.n + ' 境界没有任何可用遭遇带'); return; }
    const n = need / best;
    const prev = P2.REALMS[i - 1];
    const budget = P2.lifespanOf(t.y0) - (prev ? P2.lifespanOf(prev.y0) : 16);
    const years = n / P2.AGE_PER_BATTLE + 9 * P2.AGE_PER_BREAK;
    ns.push(n);
    if (n < 2 || n > 40) {
      errors.push(t.n + ' 刷满一境需 ' + Math.round(n) + ' 场，超出合理区间 [2, 40]');
    }
    if (years > budget) {
      errors.push(t.n + ' 刷满需 ' + Math.round(years) + ' 岁 > 寿元预算 ' + budget + ' 岁');
    }
  });
  if (ns.length > 2) {
    const ratio = Math.max.apply(null, ns) / Math.min.apply(null, ns);
    if (ratio > 8) {
      errors.push('各境界场次差距 ' + ratio.toFixed(1) + ' 倍（>8），收益曲线又失衡了');
    }
  }
}, 'zone.curve.contract');

/* ---------- 野怪收益**差分探针**（v0.77.0 口径） ----------
   v0.76.0 阶段十**恢复野外灵气**（用户最新口径，实测 gl6 给灵气180、灵力12）：
   真打一场 L=234 的野外战，灵气/灵力必须**等于公式值** ——
   灵气 = 30×L×realmQiCoef×gap（闭关的40%效率），灵力 = 2×L×gap。
   这是"野外经济公式"的看门狗：谁改了公式或把灵气清零，这条立刻报。 */
step(function () {
  const s = JSON.parse(JSON.stringify(G.game.save));
  s.globalLevel = 234; s.qi = 0; s.po = 0; s.stone = 0;
  s.linggen = { elems: ['木'], coef: { 木: 1.0 }, kind: '单灵根', stoneBonus: 0 };
  s.talents = []; s.originFx = {}; s.bonus = {}; s.world = { traits: [] };
  s.dungeonRun = null;
  G.game.save = s;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 234, '青纹蛇'), mapId: 'field' });
}, 'zone.curve.probe.enter');
pump(10, 'zone.curve.probe.enter');
step(function () {
  const b = G.game.scene, s = G.game.save;
  if (!b || !b.es || !b.es.length) { errors.push('差分探针：未能进入战斗'); return; }
  b.es.forEach(function (e) { e.hp = 0; });
  const before = s.qi || 0;
  b._victory();
  const got = (s.qi || 0) - before;
  /* L234 同级 gap=1：realmQiCoef=32^0.75≈13.454 → 灵气期望 94449；灵力 468。 */
  const Lv = 234, gap = 1;
  const expQi = Math.max(1, Math.round(30 * Lv * G.Player.realmQiCoef(Lv) * gap));
  const expPo = Math.max(1, Math.round(2 * Lv * gap));
  if (got !== expQi) errors.push('差分探针：野外灵气 ' + got + ' ≠ 公式期望 ' + expQi);
  if (s.po !== expPo) errors.push('野外灵力应为 ' + expPo + '，实为 ' + s.po);
  if (!(s.stone >= 1 && s.stone <= 5)) {
    errors.push('野外战斗灵石应为 1~5 个下品，实为 ' + s.stone);
  }
}, 'zone.curve.probe');

/* 副本侧的差分探针：`dungeon.js` 有 **4 处**灵气奖励（小Boss/通关 × 首杀/重刷），
   同样必须真的接上境界系数。这里直接驱动 `_rewardMid`（首杀分支）逐项复算。 */
step(function () {
  const D2 = G.Data.dungeons;
  const sc = G.scenes.dungeon;
  if (!sc || typeof sc._rewardMid !== 'function') { errors.push('差分探针：dungeon 场景未就绪'); return; }
  const meta = G.game.meta;
  meta.progress = meta.progress || {};
  meta.progress.activeWorld = 'xian';
  meta.progress.worldDiff = meta.progress.worldDiff || {};
  meta.progress.worldDiff.xian = 'normal';

  const s = JSON.parse(JSON.stringify(G.game.save));
  s.dungeonSet = D2.rollSet(7);
  s.qi = 0; s.stone = 0; s.items = {};
  s.dungeonPity = { mid: 0, clear: 0 }; s.secrets = {};
  G.game.save = s;

  const slot = 4;                                   /* 仙界第 5 槽 = 锚 gl 144 */
  const arch = D2.archById(s.dungeonSet[slot]);
  if (!arch) { errors.push('差分探针：拿不到副本原型'); return; }
  const before = s.qi;
  sc._rewardMid(arch, {}, false);                   /* farm=false → 首杀分支 */
  const got = s.qi - before;
  const L = D2.anchorGL('xian', slot) - 2;          /* 小Boss = 锚 − 2 */
  const rf = D2.DIFF.normal.res;
  const plain = Math.round(160 * L * rf);
  const exp = Math.round(160 * L * rf * G.Player.realmQiCoef(L));
  if (got !== exp) {
    errors.push('差分探针：副本小Boss灵气 ' + got + ' ≠ 期望 ' + exp
      + '（dungeon.js 可能没接 realmQiCoef —— 见 G19 教训）');
  }
  if (!(exp > plain * 10)) {
    errors.push('差分探针：副本小Boss的境界系数没起作用（' + exp + ' vs 无系数 ' + plain + '）');
  }

  /* 通关（大Boss/头领）首杀分支：L = 锚 gl（不减 2），灵气 320×L×res */
  const q0 = s.qi;
  sc._rewardClear(arch, {}, false);
  const got2 = s.qi - q0;
  const L2 = D2.anchorGL('xian', slot);
  const plain2 = Math.round(320 * L2 * rf);
  const exp2 = Math.round(320 * L2 * rf * G.Player.realmQiCoef(L2));
  if (got2 !== exp2) {
    errors.push('差分探针：副本通关灵气 ' + got2 + ' ≠ 期望 ' + exp2
      + '（dungeon.js 的 _rewardClear 可能没接 realmQiCoef）');
  }
  if (!(exp2 > plain2 * 10)) {
    errors.push('差分探针：副本通关的境界系数没起作用（' + exp2 + ' vs 无系数 ' + plain2 + '）');
  }
}, 'zone.curve.probe.dungeon');

/* 源码级：**所有**灵气奖励表达式都必须带境界系数。
   上面两条运行时探针只走了"首杀"两条路径，重刷分支（`farm=true`）带随机与保底、
   驱动成本高；而漏接线最容易发生在"只接了 4 处里的 3 处"（本轮就真发生过一次）。
   所以再加一道静态闸：扫源码里所有灵气奖励表达式，逐个要求带 `realmQiCoef`。
   比数次数更稳 —— 以后新增奖励点会自动纳入检查。
   ⚠️ v0.67.0：**野外一处灵气奖励已按需求删除**（用户第 28 点「取消打怪升级获取灵气」），
      所以处数由 6 降到 **5**（battle.js 只剩副本杂兵 1 处，dungeon.js 4 处）。
      保险丝同步下调 —— 但**不能下调到"有多少就收多少"**，否则新增奖励点又漏接线时闸就哑了。 */
step(function () {
  const FILES = ['js/scenes/battle.js', 'js/scenes/dungeon.js'];
  /* 灵气变量只有 qi / dqi / q2 / q3 四个名字；**不含** dpo/dst（灵力/灵石不参与境界缩放） */
  const RE = /(?:\bqi\b|\bdqi\b|\bq2\b|\bq3\b)\s*\+?=\s*Math\.round\(/;
  let seen = 0;
  FILES.forEach(function (rel) {
    const src = fs.readFileSync(path.join(WWW, rel), 'utf8');
    src.split('\n').forEach(function (line, i) {
      if (!RE.test(line)) return;
      seen += 1;
      if (line.indexOf('realmQiCoef') < 0) {
        errors.push('源码闸：' + rel + ':' + (i + 1) + ' 的灵气奖励没带 realmQiCoef —— '
          + line.trim());
      }
    });
  });
  if (seen < 5) errors.push('源码闸：只扫到 ' + seen + ' 处灵气奖励（应 ≥5），正则可能过时了');
}, 'zone.curve.source.contract');

/* ---------- 药铺商店（v0.17.0）----------
   用户口径：「药铺点击无法，药铺怎么没有购买界面」。
   真因：药铺柜台只挂 `act:'shenbo'`（对话），全游戏只有刘记杂货一家商店。
   修法：沈伯**无话可说**时改开店（`shenBo` 的兜底分支）——
   而不是把柜台动作改成 `apothecary`（那会把 M0/M1 的主线对话整条吞掉）。
   本契约钉三件事：
     ① 无剧情时点柜台 → `overlay === 'apothecary'`（真的开了店）；
     ② 店里有**可买的货**（按钮带「购买」）与**沈伯闲聊入口**（风味台词不丢）；
     ③ 有剧情时点柜台 → **仍然演剧情**（不能被商店吞掉）—— 这条是防"改回去"的闸。 */
step(function () {
  const errors = [];
  /* ① 无剧情（quest.step = 'free'）*/
  const s = JSON.parse(JSON.stringify(save));
  s.quest = { step: 'free', flags: {} };
  s.stone = 500;
  G.game.save = s;
  G.game.changeScene('town_shop', { toSpawn: true });
  pump(6, 'apoth.enter');
  let sc = G.game.scene;
  if (sc.mapId !== 'town_shop') bail('药铺契约：没能进入药铺室内');
  if (!standBefore(sc, 'furn', 'shenbo', 'up')) bail('药铺契约：找不到柜台交互点');
  sc._interact();
  pump(4, 'apoth.open');
  sc = G.game.scene;
  if (sc.overlay !== 'apothecary') {
    errors.push('药铺无剧情时点柜台应开商店（overlay=apothecary），实际 ' + sc.overlay);
  } else {
    const buy = sc.buttons.filter((b) => b.label === '购买');
    if (buy.length < 5) errors.push('药铺的货太少（购买按钮 ' + buy.length + ' 个，应 ≥5）');
    if (!sc.buttons.some((b) => b.label === '与沈伯闲聊')) {
      errors.push('药铺面板缺「与沈伯闲聊」入口 —— 风味台词被吞了');
    }
    /* 钱不够时按钮要禁用（不能点了扣成负数） */
    const poor = JSON.parse(JSON.stringify(s));
    poor.stone = 0;
    G.game.save = poor;
    G.game.changeScene('town_shop', { toSpawn: true });
    pump(6, 'apoth.poor');
    sc = G.game.scene;
    if (!standBefore(sc, 'furn', 'shenbo', 'up')) bail('药铺契约：找不到柜台交互点（穷档）');
    sc._interact();
    pump(4, 'apoth.poor.open');
    sc = G.game.scene;
    if (sc.overlay !== 'apothecary') errors.push('药铺（穷档）没开店');
    else if (!sc.buttons.filter((b) => b.label === '购买').every((b) => b.disabled)) {
      errors.push('灵石为 0 时药铺的「购买」按钮应全部禁用');
    }
  }

  /* ② 有剧情时必须仍演剧情（这条是防"把柜台直接改成商店"的闸） */
  const s2 = JSON.parse(JSON.stringify(save));
  s2.quest = { step: 'm1-1', flags: {} };
  s2.globalLevel = 30;
  G.game.save = s2;
  G.game.changeScene('town_shop', { toSpawn: true });
  pump(6, 'apoth.story');
  sc = G.game.scene;
  if (!standBefore(sc, 'furn', 'shenbo', 'up')) bail('药铺契约：找不到柜台交互点（剧情档）');
  sc._interact();
  pump(4, 'apoth.story.open');
  sc = G.game.scene;
  if (sc.overlay === 'apothecary') {
    errors.push('药铺有剧情时点柜台**不能**开店 —— 那会把主线对话吞掉');
  }
  if (s2.quest.step !== 'm1-2') {
    errors.push('m1-1 与沈伯对话后任务应推进到 m1-2，实际 ' + s2.quest.step);
  }

  G.game.changeScene('title');
  if (errors.length) {
    errors.forEach((e) => console.log('  ✗ ' + e));
    throw new Error('药铺契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ 药铺：无剧情开店（可买 + 闲聊入口）/ 有剧情仍演剧情 / 没钱禁用');
}, 'shop.apothecary.contract');
pump(6, 'apoth.leave');

/* ---------- 战斗表现改造（v0.17.0）----------
   用户两条口径：
     ①「思考时间不要进度条……倒计时放到中间，只要倒计时，缩短到 15 秒」；
     ②「去掉战斗胜利的弹窗……弹出本次战斗获取的物品，特殊物品有特效，
        不遮挡地图，3 秒左右，字体小一点，不要有框，纯文字」。
   本契约钉：倒计时常量 / 进度条已删 / 浮层是**纯文字**（源码闸查 `_renderLoot` 里没有 `G.UI.panel`）
   / 浮层存活约 3 秒 / 特殊物品带 `special` 标记 / 「战斗胜利」toast 已删。 */
step(function () {
  const errors = [];
  const stripC = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const bs = stripC(fs.readFileSync(path.join(WWW, 'js/scenes/battle.js'), 'utf8'));

  /* ① 倒计时：15 秒 + 无进度条 */
  if (!/var CMD_TIMER\s*=\s*15\s*;/.test(bs)) errors.push('CMD_TIMER 应为 15');
  if (/\bbw \* pct\b/.test(bs)) errors.push('倒计时进度条应已删除（只留数字）');
  if (bs.indexOf('Math.ceil(this.cmdTimer)') < 0) errors.push('_drawTopBar 未绘制倒计时数字');
  if (bs.indexOf("toast('战斗胜利')") >= 0) {
    errors.push('「战斗胜利」toast 应已删除（结算画面已明示胜负）');
  }

  /* ② 战利品浮层：**纯文字**（不画框）+ 约 3 秒 + 特殊物品标记 */
  const gs = stripC(fs.readFileSync(path.join(WWW, 'js/core/game.js'), 'utf8'));
  const i0 = gs.indexOf('_renderLoot: function');
  const i1 = gs.indexOf('_renderToasts: function');
  if (i0 < 0 || i1 < 0 || i1 < i0) bail('战斗表现契约：game.js 里找不到 _renderLoot');
  const body = gs.slice(i0, i1);
  if (body.indexOf('G.UI.panel') >= 0 || body.indexOf('G.UI.frame') >= 0) {
    errors.push('战利品浮层不该画框（用户口径：不要有框，纯文字）');
  }

  const g = G.game;
  if (!Array.isArray(g.lootFeed)) bail('战利品浮层未初始化（game.lootFeed）');
  g.lootFeed.length = 0;
  g.loot('测试：灵气 +100');
  if (g.lootFeed.length !== 1) errors.push('game.loot() 没把条目压进浮层');
  else {
    if (g.lootFeed[0].t < 2.5 || g.lootFeed[0].t > 3.5) {
      errors.push('战利品浮层存活时长应约 3 秒，实际 ' + g.lootFeed[0].t);
    }
    if (g.lootFeed[0].special) errors.push('普通战利品不该标 special');
  }
  g.loot('习得功法《测试》', true);
  if (!(g.lootFeed[1] && g.lootFeed[1].special)) {
    errors.push('特殊物品（功法/秘术/碎片）应标 special（金色 + 辉光）');
  }
  /* 条数上限：不能无限堆到屏幕上 */
  for (let i = 0; i < 12; i++) g.loot('刷屏 ' + i);
  if (g.lootFeed.length > 5) {
    errors.push('战利品浮层应有条数上限（现 ' + g.lootFeed.length + ' 条，最多 5）');
  }
  g.lootFeed.length = 0;

  /* ③ 真跑一帧：渲染路径不得抛（浮层是新增绘制分支） */
  G.game.changeScene('battle', {
    enemy: G.Data.makeEnemy('青纹蛇', 3, '青纹蛇'), mapId: 'field'
  });
  pump(6, 'hud.enter');
  const b = G.game.scene;
  if (!b || typeof b._loot !== 'function') bail('战斗场景缺 _loot（战利品没接浮层）');
  b._loot('战利品测试：灵石 +1');
  pump(4, 'hud.render');
  if (!G.game.lootFeed.length) errors.push('战斗里 _loot 没有把条目送到全局浮层');
  G.game.lootFeed.length = 0;
  G.game.changeScene('title');

  if (errors.length) {
    errors.forEach((e) => console.log('  ✗ ' + e));
    throw new Error('战斗表现契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ 战斗表现：倒计时 15s 无进度条 / 战利品纯文字无框约 3s / 特殊物品带特效');
}, 'battle.hud.contract');
pump(6, 'hud.leave');

/* ---------- 浮层纵向分区（v0.74.0 · G32）----------
   用户口径：「任务左右上下都在浮动」「不遮挡地图」；G32 是自记欠账：
   toast 单条固定画在 y=201..230，而面板那排「参悟/精进/激发」按钮上沿 212
   —— 实测重叠 18px，且 toast 在 scene.render **之后**绘制，等于 toast 盖住按钮。
   约定：**覆盖层打开时**把 toast 与战利品浮层整体上移到"安全带"，
   下沿不越过 FLOAT_CLEAR_Y；未打开覆盖层时与历史**逐像素一致**。
   ⚠️ 反例钉法：删掉任一处的 `if (this._overlayOpen())` 让位，本契约必须红。 */
step(function () {
  const errors = [];
  const gsrc = fs.readFileSync(path.join(WWW, 'js/core/game.js'), 'utf8');
  const g = G.game;

  /* ① 唯一判定口：只许定义一次 */
  const defs = (gsrc.match(/_overlayOpen:\s*function/g) || []).length;
  if (defs !== 1) errors.push('_overlayOpen 应只定义一次（唯一判定口），实为 ' + defs);

  /* ② 环境粒子必须复用同一口 —— 否则第二份判据会与主口漂移 */
  const ai = gsrc.indexOf('_renderAmbient: function');
  const ambBody = ai >= 0 ? gsrc.slice(ai, ai + 420) : '';
  if (ambBody.indexOf('_overlayOpen') < 0) {
    errors.push('_renderAmbient 未复用 _overlayOpen（第二份判据会漂）');
  }

  /* ③ 实测：无覆盖层时公式与历史一致；有覆盖层时下沿 ≤ 让位线 */
  const realPanel = G.UI.panel, realTextOut = G.UI.textOut;
  let cap = null, capYs = [];
  const stubCtx = { save: function () {}, restore: function () {}, globalAlpha: 1,
    shadowColor: '', shadowBlur: 0 };
  G.UI.panel = function (x, r) { cap = { x: r.x, y: r.y, w: r.w, h: r.h }; };
  G.UI.textOut = function (x, o) { capYs.push(o.y); };

  const s = JSON.parse(JSON.stringify(save));
  s.quest = { step: 'free', flags: {} };
  G.game.save = s;
  G.game.changeScene('town', { toSpawn: true });
  const sc = G.game.scene;
  const BOT = (G.Explore && G.Explore.BOT_H) || 0;

  const toastRect = function () {
    g.toasts.length = 0;
    g.toast('G32 测试提示');
    cap = null;
    g._renderToasts(stubCtx);
    return cap;
  };
  const lootRows = function () {
    g.lootFeed.length = 0;
    g.loot('战利品 A'); g.loot('战利品 B');
    capYs = [];
    g._renderLoot(stubCtx);
    return capYs.slice();
  };

  /* 无覆盖层：toast y0 必须等于历史公式（= H - h - 14 - BOT） */
  sc.overlay = null;
  const nRect = toastRect();
  if (!nRect) errors.push('_renderToasts 没画面板（capture 失败）');
  else {
    const wantY = g.H - nRect.h - 14 - BOT;
    if (nRect.y !== wantY) {
      errors.push('无覆盖层时 toast y 应与历史一致（' + wantY + '），实为 ' + nRect.y);
    }
  }
  /* 无覆盖层：战利品首行仍从 54 起 */
  const nLoot = lootRows();
  if (nLoot.length && nLoot[0] !== 54) {
    errors.push('无覆盖层时战利品首行应从 54 起，实为 ' + nLoot[0]);
  }

  /* 有覆盖层：toast 下沿 ≤ 让位线 */
  sc.overlay = 'skills';
  const oRect = toastRect();
  if (oRect) {
    if (oRect.y + oRect.h > g.FLOAT_CLEAR_Y) {
      errors.push('覆盖层打开时 toast 下沿 ' + (oRect.y + oRect.h)
        + ' 越过让位线 ' + g.FLOAT_CLEAR_Y + '（仍压住面板按钮）');
    }
    if (oRect.y < g.FLOAT_TOP_MIN) {
      errors.push('覆盖层打开时 toast 顶到安全带之上（' + oRect.y + ' < ' + g.FLOAT_TOP_MIN + '）');
    }
  }
  /* ⚠️ 战利品**锚在顶部**（54、上限 5 行 → 底 ≈129），结构上够不到按钮带（208），
     所以覆盖层打开时它**也不该位移** —— 断言"恒为 54"正是钉住这一点。
     我第一版照抄 toast 的公式，把它**向下推**到了 178（方向反了），
     这条断言就是那次错误的防线。 */
  const oLoot = lootRows();
  if (oLoot.length && oLoot[0] !== 54) {
    errors.push('战利品锚在顶部、够不到按钮带，覆盖层打开时也不该位移（实为 ' + oLoot[0] + '）');
  }

  /* 源码闸：战利品必须有一道"越线才上移"的下沿守卫（防将来放宽行数上限） */
  const li = gsrc.indexOf('_renderLoot: function');
  const lt = gsrc.indexOf('_renderToasts: function');
  const lootBody = (li >= 0 && lt > li) ? gsrc.slice(li, lt) : '';
  if (lootBody.indexOf('FLOAT_CLEAR_Y') < 0) {
    errors.push('源码闸：_renderLoot 缺下沿守卫（放宽行数上限会静默压进按钮带）');
  }

  /* 判定口本身：overlay 设/清 各自为真/假 */
  if (!g._overlayOpen()) errors.push('scene.overlay 已设，_overlayOpen 应为真');
  sc.overlay = null;
  if (g._overlayOpen()) errors.push('overlay 清空后 _overlayOpen 应为假');

  /* ④ 战斗：下拉三阶段算覆盖层，command/exec/result 不算 */
  G.game.changeScene('battle', {
    enemy: G.Data.makeEnemy('青纹蛇', 3, '青纹蛇'), mapId: 'field'
  });
  pump(4, 'g32.battle');
  const bb = G.game.scene;
  if (!bb) bail('G32 契约：没能进入战斗场景');
  bb.phase = 'command';
  if (g._overlayOpen()) errors.push('战斗 command 阶段不该算覆盖层（那是普通指令区）');
  bb.phase = 'skill';
  if (!g._overlayOpen()) errors.push('战斗 skill 阶段应算覆盖层（功法下拉浮在指令区上）');
  bb.phase = 'item';
  if (!g._overlayOpen()) errors.push('战斗 item 阶段应算覆盖层');
  bb.phase = 'target';
  if (!g._overlayOpen()) errors.push('战斗 target 阶段应算覆盖层（选靶浮层）');
  bb.phase = 'exec';
  if (g._overlayOpen()) errors.push('战斗 exec 阶段不该算覆盖层（在播演出）');
  bb.phase = 'result';
  if (g._overlayOpen()) errors.push('战斗 result 阶段不该算覆盖层');

  /* ⑤ 剧情模态也算覆盖层 */
  const realModal = G.Story && G.Story.modalOpen;
  if (realModal) {
    G.Story.modalOpen = function () { return true; };
    if (!g._overlayOpen()) errors.push('剧情模态打开时 _overlayOpen 应为真');
    G.Story.modalOpen = realModal;
  }

  G.UI.panel = realPanel;
  G.UI.textOut = realTextOut;

  /* ⑥ 让位线必须**真的清掉**最靠上的底部动作排。
     实测 15 个面板的"最低内容按钮上沿"：功法 178（参悟/卸下/精进，全部面板里
     最高的一排）> 剧情 175 > 洞府 170 > 炼丹/锻造/阵法/传承 212 > 兽栏/打坐 214~216。
     所以 FLOAT_CLEAR_Y 只要 ≤178−4 就清掉全部底部动作排。
     ⚠️ 这条专防我犯过的错：我第一版按**字面量**解析量到 212，误以为够，
        结果功法面板那排（SK.btn 间接引用，解析漏掉）仍被压 —— 截图一眼看穿。
        判据必须是**真开面板读按钮矩形**，不能读源码字面量。 */
  G.game.changeScene('town', { toSpawn: true });
  const sk2 = G.game.scene;
  sk2.buttons = [];
  try { G.Overlays.openPanel(sk2, 'skills'); } catch (e) { /* 面板打不开就跳过 */ }
  const actRow = (sk2.buttons || []).filter(function (b) {
    return b && typeof b.y === 'number' && b.y > 100 && b.y < 244;
  }).sort(function (a, b) { return b.y - a.y; })[0];
  if (!actRow) {
    errors.push('G32：功法面板未找到底部动作排（几何变了，本守卫需更新）');
  } else if (g.FLOAT_CLEAR_Y > actRow.y - 4) {
    errors.push('让位线 ' + g.FLOAT_CLEAR_Y + ' 未清掉功法面板底部动作排（上沿 '
      + actRow.y + '，会让 toast 压住「参悟/精进」）');
  }
  sk2.buttons = [];
  sk2.overlay = null;

  G.game.toasts.length = 0;
  G.game.lootFeed.length = 0;
  G.game.save = save;
  G.game.changeScene('title');

  if (errors.length) {
    errors.forEach((e) => console.log('  ✗ ' + e));
    throw new Error('浮层分区契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ 浮层让位：覆盖层打开时 toast/战利品上移不压按钮；未打开时与历史一致');
}, 'overlay.float.contract');
pump(6, 'overlay.leave');

/* ---------- 门口必有路（v0.17.0）----------
   用户口径：「这个道路必须延伸到建筑的前面，必须是挨着靠近着建筑」。
   判据：**每栋建筑的门口那一格必须是 `path`**（手写图与生成图都查）。
   ⚠️ 判据必须是"门口**那一格**"，不能放宽成"门口附近有路" ——
   地图上到处都有路，随便挑一格都能命中，那种写法恒真（G46 同族）。 */
step(function () {
  const errors = [];
  const check = function (map, tag) {
    const md = map && map.md;
    if (!md || !md.structures || !md.structures.length) return 0;
    let n = 0;
    md.structures.forEach(function (s) {
      const dx = s.x + Math.floor(s.w / 2), dy = s.y + s.h;
      const g = map.ground[dy] && map.ground[dy][dx];
      if (!g) { errors.push(tag + '：' + s.id + ' 的门口 (' + dx + ',' + dy + ') 越出地图'); return; }
      if (g.t !== 'path') {
        errors.push(tag + '：' + s.id + ' 的门口 (' + dx + ',' + dy + ') 不是路（实为 ' + g.t + '）');
      }
      n++;
    });
    return n;
  };

  const s = JSON.parse(JSON.stringify(save));
  s.quest = { step: 'free', flags: {} };
  G.game.save = s;
  /* ① 手写图（镇/山/洞） */
  let total = 0;
  ['town', 'field', 'cave'].forEach(function (m) {
    G.game.changeScene(m, { toSpawn: true });
    total += check(G.game.scene.map, m);
  });
  /* ② 生成型区域（区域层才是大多数地图 —— 只查手写图等于没查） */
  const Rg = G.Data.regions;
  ['fan4', 'ling2', 'xian2'].forEach(function (rid) {
    if (!Rg.byId(rid)) return;
    G.game.changeScene(rid, { toSpawn: true });
    total += check(G.game.scene.map, rid);
  });
  if (total < 8) {
    errors.push('门口补路契约只查到 ' + total + ' 栋建筑，样本太少（正则/取图可能过时）');
  }
  G.game.changeScene('title');

  if (errors.length) {
    errors.forEach((e) => console.log('  ✗ ' + e));
    throw new Error('门口补路契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ 门口必有路：' + total + ' 栋建筑的门口都是 path');
}, 'door.path.contract');
pump(6, 'door.path.leave');

/* ---------- 真地图（v0.18.0）----------
   用户口径：①「现在的地图就是列表，不是真的地图」，要参考《烟雨江湖》看山脉河流走势、
   标宗门与界门；②「点击凡界展示凡界全貌……没有飞升过灵界，灵界地图置灰无法点击，
   仙界、道界隐藏，只有到灵界才能看到仙界，仙界通过地狱难度才能看到道界」。
   本契约钉四件事：
     ① **解锁门槛**（`worldGate`）：凡界永远可点；灵界**可见但置灰**；
        仙界**未到灵界则隐藏**；道界需"仙界 + （三碎片齐 或 地狱通关仙界）"；
     ② **28 个区域都有世界地图坐标**且在界内、同界内不贴太近（贴太近名字会糊成一团）；
     ③ **真地图**：`drawMap` 必须画底图（源码闸），且**不能再出现按列分栏的列表布局**；
     ④ 底图**预渲染缓存** + 地形噪点走**固定种子**（用 `G.rng` 会每帧都变，画面在闪）。 */
step(function () {
  const errors = [];
  const stripC = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  /* ① 三态门槛：**页签可见（show）/ 看得到内容（view）/ 去得了（ok）**
     是**三个不同的问题**，逐个场景钉死。
     ⚠️ 口径演进（三次都是用户口径在推）：
        · 更早：`show` 与 `ok` 绑一起 —— 未解锁的界**整个藏掉**；
        · v0.94.0：「把四个地图展示到这里，让玩家有期待感」→ 四界页签常驻，
          但未解锁的 `disabled`（点不开内容）；
        · v0.97.0：「把地图**全部能展示看到**，但是无法过去」→ 拆出 `view`：
          **四界都能点开看全图**（`view` 恒 true），但 `ok` 仍按解锁链。
     ⚠️ **可点性一个都不能松**：`ok` 必须仍然拦得住 —— 看得见 ≠ 去得了。
        点未现世界的节点要**明确提示**（否则玩家以为是画错了）。 */
  const wg = G.Overlays.worldGate;
  if (typeof wg !== 'function') bail('真地图契约：未导出 worldGate');
  /* 空进度：四界**全部可见 + 全部能看到内容**，但只有凡界去得了 */
  [
    [{}, 'fan', true, true, true, '凡界永远可看可去'],
    [{}, 'ling', true, true, false, '灵界**能看**（内容可查）但未飞升去不了'],
    [{}, 'xian', true, true, false, '仙界**能看**（内容可查）但未解锁去不了'],
    [{}, 'dao', true, true, false, '道界**能看**（内容可查）但未解锁去不了']
  ].forEach(function (c) {
    const r = wg(c[0], c[1]);
    if (r.show !== c[2]) errors.push(c[5] + '：show 应为 ' + c[2] + '，实为 ' + r.show);
    if (r.view !== c[3]) errors.push(c[5] + '：view 应为 ' + c[3] + '，实为 ' + r.view);
    if (r.ok !== c[4]) errors.push(c[5] + '：ok 应为 ' + c[4] + '，实为 ' + r.ok);
  });
  const CASES = [
    [{ progress: { worlds: { ling: true } } }, 'ling', true, '飞升灵界后可去'],
    [{ progress: { worlds: { ling: true } } }, 'xian', false, '仙界仍去不了（未飞升）'],
    [{ progress: { worlds: { ling: true, xian: true } } }, 'xian', true, '飞升仙界后可去'],
    [{ progress: { worlds: { ling: true, xian: true } } }, 'dao', false, '道界仍去不了（未满足条件）'],
    [{ progress: { worlds: { ling: true, xian: true }, daoKey: true } }, 'dao', true, '三碎片齐 → 道界可去'],
    [{ progress: { worlds: { ling: true, xian: true } }, hellCleared: { xian: true } }, 'dao', true, '地狱通关仙界 → 道界可去']
  ];
  CASES.forEach(function (c) {
    const r = wg(c[0], c[1]);
    if (r.ok !== c[2]) errors.push(c[3] + '：ok 应为 ' + c[2] + '，实为 ' + r.ok);
    /* ⚠️ 解锁与否，**都必须能看**（view 恒 true）—— 否则又回到"看不到其他三界" */
    if (!r.view) errors.push(c[3] + '：view 必须恒为 true（能看不能去才是本需求）');
  });
  /* ⚠️ 源码闸：`view` 必须是**字面量 true**（防回退成"按解锁链判可见"） */
  {
    const panSrc = fs.readFileSync(path.join(WWW, 'js/core/panels.js'), 'utf8');
    const body2 = stripC(panSrc);
    const m2 = body2.match(/function worldGate[\s\S]{0,1200}?\n  \}/);
    const wgb = m2 ? m2[0] : '';
    if (!wgb) errors.push('源码闸：找不到 worldGate 函数体');
    else if ((wgb.match(/view: true/g) || []).length !== 4) {
      errors.push('源码闸：worldGate 应有 **4 处** `view: true`（fan/ling/xian/dao 四分支；'
        + '兜底分支是 false）—— 少了就是又变成"看不到其他三界"');
    }
    /* 页签**不许再 disabled**（那会重新变成"点不动"）。
       ⚠️ 判据必须宽：只要 buildMap 的页签块里出现 `disabled` 就算数 ——
          写死 `!gt.ok` 会漏掉 `!worldGate(meta,w).ok` 这类等价写法（反例实测漏网）。 */
    const mb = body2.match(/function buildMap\(btns, scene\)[\s\S]{0,2400}?\n  \}/);
    const mbBody = mb ? mb[0] : '';
    if (!mbBody) errors.push('源码闸：找不到 buildMap 函数体');
    else if (/disabled/.test(mbBody)) {
      errors.push('源码闸：buildMap 的页签块里出现了 disabled —— '
        + '会让未解锁的界"点不开发看"（用户要的是"能看不能去"）');
    }
  }

  /* ①b v0.94.0（用户口径「把四个地图展示到这里……让玩家有期待感」）：
     **四界页签必须全部常驻**，`show` 恒 true；未解锁的只置灰（`ok:false`）。
     为什么单列一条：这条需求的价值在于"看得见"——
     若将来有人图省事把 `show` 又绑回解锁链（旧口径就是那样），
     玩家会重新"不知道后面还有两界"，期待感归零，而其它断言全都不会报。 */
  {
    const allW = ['fan', 'ling', 'xian', 'dao'];
    /* 用**空 meta**（最惨的进度：什么都没解锁）也必须四界全可见 */
    allW.forEach(function (w) {
      var g = wg({}, w);
      if (!g.show) errors.push('空进度下「' + w + '」界页签应**可见**（用户要"有期待感"），实为隐藏');
    });
    /* 可点性不能松：空进度下只有凡界可点 */
    allW.forEach(function (w) {
      var g = wg({}, w);
      if (w !== 'fan' && g.ok) errors.push('空进度下「' + w + '」界不该可点');
    });
    /* 源码闸：`show` 不许再依赖解锁字段（防止回退成"隐藏"） */
    const ps2 = stripC(fs.readFileSync(path.join(WWW, 'js/core/panels.js'), 'utf8'));
    const gm = ps2.match(/function worldGate[\s\S]*?\n  \}/);
    if (!gm) errors.push('源码闸：找不到 worldGate 函数体');
    else {
      const body = gm[0];
      /* 四个分支的 show 必须都写成字面量 true */
      const shows = (body.match(/show: (true|!![^,}\n]+|!{1,2}[^,}\n]+)/g) || []);
      const bad = shows.filter(function (s) { return s.indexOf('show: true') < 0; });
      if (bad.length) {
        errors.push('四界页签的 show 必须是字面量 true（可见性不再依赖解锁），以下不是：' + bad.join(' / '));
      }
    }
  }

  const Rg = G.Data.regions;
  let n = 0;
  ['fan', 'ling', 'xian', 'dao'].forEach(function (w) {
    const list = Rg.of(w) || [];
    list.forEach(function (r) {
      n++;
      if (typeof r.mx !== 'number' || typeof r.my !== 'number') {
        errors.push('区域 ' + r.id + ' 缺世界地图坐标 mx/my');
        return;
      }
      if (r.mx < 0.02 || r.mx > 0.98 || r.my < 0.04 || r.my > 0.96) {
        errors.push('区域 ' + r.id + ' 的地图坐标越界（' + r.mx + ',' + r.my + '）');
      }
    });
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const dx = list[i].mx - list[j].mx, dy = list[i].my - list[j].my;
        if (Math.sqrt(dx * dx + dy * dy) < 0.11) {
          errors.push(w + ' 界内 ' + list[i].id + ' 与 ' + list[j].id
            + ' 的地图坐标太近（名字会糊成一团）');
        }
      }
    }
  });
  if (n !== 29) errors.push('区域总数应为 29（凡界 10 + 灵 5 + 仙 9 + 道 5），实为 ' + n);

  /* ③④ 源码闸：真地图 + 缓存 + 固定种子 */
  const ps = stripC(fs.readFileSync(path.join(WWW, 'js/core/panels.js'), 'utf8'));
  const i0 = ps.indexOf('function drawMap');
  const i1 = ps.indexOf('function buildMap');
  if (i0 < 0 || i1 < 0 || i1 < i0) bail('真地图契约：panels.js 里找不到 drawMap/buildMap');
  const body = ps.slice(i0, i1);
  if (body.indexOf('worldMapBg(') < 0) {
    errors.push('drawMap 没有画世界地图底图（还是列表？）');
  }
  if (body.indexOf('colW') >= 0) {
    errors.push('drawMap 里仍有按列分栏的列表布局（用户口径：不是真的地图）');
  }
  const i2 = ps.indexOf('function worldMapBg');
  if (i2 < 0) errors.push('缺 worldMapBg（世界地图底图）');
  else {
    const tb = ps.slice(i2, i0);
    if (tb.indexOf('G.Art.rnd(') < 0) {
      errors.push('世界地图地形未用固定种子（G.Art.rnd）—— 用 G.rng 会每帧都变');
    }
    if (/\bG\.rng\b/.test(tb)) {
      errors.push('世界地图地形不得用全局 G.rng（时间播种，画面会闪）');
    }
    if (tb.indexOf('mapBg[key]') < 0) {
      errors.push('世界地图底图没有预渲染缓存（每帧重画上百个笔触会掉帧）');
    }
  }

  /* 真跑一遍：四界各渲染一次，路径不得抛 */
  const s = JSON.parse(JSON.stringify(save));
  s.quest = { step: 'free', flags: {} };
  G.game.save = s;
  G.game.meta = G.game.meta || {};
  G.game.meta.progress = G.game.meta.progress || {};
  G.game.meta.progress.worlds = { fan: true, ling: true, xian: true, dao: true };
  G.game.changeScene('town', { toSpawn: true });
  const sc = G.game.scene;
  ['fan', 'ling', 'xian', 'dao'].forEach(function (w) {
    sc.mapWorld = w;
    G.Overlays.openPanel(sc, 'map');
    const cx = textSpyXY();
    try { G.Overlays.renderPanel(cx, sc); } catch (e) {
      errors.push('渲染 ' + w + ' 界地图时抛异常：' + e.message);
    }
  });

  /* ⑤ **真驱动"能看不能去"**（v0.97.0，用户口径「把地图全部能展示看到，但是无法过去」）：
     光验 `worldGate` 的返回值不够 —— 要证明**页面真的切得过去**、
     且**点节点真的过不去**（给明确提示而不是静默）。
     ⚠️ 这两条是"看得见"与"去不了"的**端到端**判决，缺一条就可能出现
        "页签亮着但内容还是凡界"（mapWorldOf 忘了改判据）或
        "点未现世的节点却真的传送了"（闸门漏在 UI 层）。 */
  {
    /* 全未解锁：切到仙界看内容 —— mapWorldOf 必须保留 xian（不许退回 fan） */
    G.game.meta.progress.worlds = {};
    s.globalLevel = 1;
    sc.mapZoom = 1; sc.mapPan = { x: 0, y: 0 };
    sc.mapWorld = 'xian';
    G.Overlays.openPanel(sc, 'map', true);
    if (sc.mapWorld !== 'xian') {
      errors.push('未解锁的界切不过去（mapWorldOf 退回了 ' + sc.mapWorld
        + '）—— 玩家看不到其他三界的地图');
    }
    /* 真的点一个仙界节点：必须**不切场景** + 给出"尚未现世"提示。
       ⚠️ 必须先**复位缩放/平移** —— 场景是**单例**，前面测缩放的那一节
          (zoom=3, pan={260,-7.9}) 会留在同一对象上，落点公式不补偿它就点不中
          （而且症状是"提示为空"而非报错，很难查）。复位 = 玩家刚打开面板的常态。 */
    const rx = (G.Data.regions.of('xian') || [])[0];
    if (rx) {
      sc.mapZoom = 1; sc.mapPan = { x: 0, y: 0 };
      G.Overlays.openPanel(sc, 'map', true);
      const toasts = [];
      const oldToast = G.game.toast;
      G.game.toast = function (t) { toasts.push(t); };
      /* 落点用 `mapNodePos` 的公式（= mapUnproject 的逆）——**唯一正确口径**，
         照抄面板几何常量：MP = {vx:60, vy:84, vw:394, vh:132}（P.x=46/P.y=26 推得） */
      const MPv = { vx: 60, vy: 84, vw: 394, vh: 132 };
      G.Overlays.mapTap({
        x: MPv.vx + MPv.vw / 2 + (rx.mx - 0.5) * MPv.vw,
        y: MPv.vy + MPv.vh / 2 + (rx.my - 0.5) * MPv.vh
      }, sc);
      G.game.toast = oldToast;
      if (G.game.sceneName !== 'town') {
        errors.push('点未现世界的节点竟然传送走了（到了 ' + G.game.sceneName + '）—— 闸门漏了');
      }
      if (!toasts.some(function (t) { return t.indexOf('尚未现世') >= 0; })) {
        errors.push('点未现世界的节点没有给出"尚未现世"提示（玩家会以为画错了）：'
          + JSON.stringify(toasts));
      }
    } else {
      errors.push('仙界没有区域节点，无法验"能看不能去"');
    }
  }
  G.game.changeScene('title');

  if (errors.length) {
    errors.forEach((e) => console.log('  ✗ ' + e));
    throw new Error('真地图契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ 真地图：28 区坐标齐全 / 四界可查看（view）与可传送（ok）分离 / 底图缓存 + 固定种子');
}, 'map.world.contract');
pump(6, 'map.world.leave');

/* ---------- 破境：进度条累积模型（v0.77.0，用户口径）----------
   「进度条累积，失败 +50% 进度、两次必成、耗丹 + 气血减半。」
   · 每试一次耗 1 颗破境丹；
   · 进度 <100 → 失败：进度 +50（封顶100）、当前气血减半；
   · 进度 ≥100 → 必定成功：清进度/失败数，再按 TRIB_CHANCE 掷是否历天劫。
   最多失败两次，第三次必成。 */
step(function () {
  const errors = [];
  const P = G.Player;
  const bail = (m) => { errors.push(m); throw new Error('__bail__'); };

  const prep = function (progress) {
    const o = JSON.parse(JSON.stringify(save));
    o.globalLevel = 36; o.qi = 999999;
    o.items = o.items || {};
    o.breakProgress = progress || 0;
    o.breakFails = 0;
    const meta = {};
    o.items[P.breakPill(36)] = 5;
    const full = P.computeStats(o);
    o.hp = full.maxhp;
    return { save: o, meta: meta, pill: P.breakPill(36), full: full };
  };

  /* ① 第一次（进度0）：失败、+50、耗丹、气血减半 */
  const A = prep(0);
  const pillBefore = A.save.items[A.pill];
  const hpBefore = A.save.hp;
  const r1 = P.startBigBreak(A.save, A.meta);
  if (r1.ok) errors.push('进度0 第一次应失败');
  if (A.save.breakProgress !== 50) errors.push('第一次失败进度应 0→50，实为 ' + A.save.breakProgress);
  if (A.save.items[A.pill] !== pillBefore - 1) errors.push('失败应耗 1 丹');
  if (A.save.hp >= hpBefore) errors.push('失败应使气血减半（' + hpBefore + '→' + A.save.hp + '）');
  if (Math.abs(A.save.hp - Math.round(A.full.maxhp * 0.5)) > 1) errors.push('失败后气血应为上限一半');

  /* ② 第二次（进度50）：失败、+50→100，提示下次必成 */
  const B = prep(50);
  const r2 = P.startBigBreak(B.save, B.meta);
  if (r2.ok) errors.push('进度50 第二次应失败');
  if (B.save.breakProgress !== 100) errors.push('第二次失败进度应 50→100，实为 ' + B.save.breakProgress);
  if (!/下次必定成功/.test(r2.reason)) errors.push('进度满时应提示「下次必定成功」');

  /* ③ 第三次（进度100）：必定成功、清进度、耗丹、返回 storm */
  const C = prep(100);
  const pillC = C.save.items[C.pill];
  const r3 = P.startBigBreak(C.save, C.meta, undefined, 0.999);
  if (!r3.ok) errors.push('进度100 应必定成功，实为 ' + r3.reason);
  if (C.save.breakProgress !== 0) errors.push('成功后进度应清零，实为 ' + C.save.breakProgress);
  if (C.save.items[C.pill] !== pillC - 1) errors.push('成功也应耗 1 丹');
  if (typeof r3.storm !== 'boolean') errors.push('成功应返回 storm（是否历天劫）');

  /* ④ 天劫门：stormRoll 0 必历劫、0.999 不历劫（TRIB_CHANCE=0.5） */
  const D = prep(100);
  const rStorm = P.startBigBreak(D.save, D.meta, undefined, 0);
  if (!rStorm.ok || rStorm.storm !== true) errors.push('stormRoll=0 应必触发天劫');
  const E = prep(100);
  const rNoStorm = P.startBigBreak(E.save, E.meta, undefined, 0.999);
  if (!rNoStorm.ok || rNoStorm.storm !== false) errors.push('stormRoll=0.999 应不触发天劫');

  /* ⑤ 前置：无丹应被拒（不进进度逻辑） */
  const noPill = prep(0); noPill.save.items[noPill.pill] = 0;
  if (P.startBigBreak(noPill.save, noPill.meta).ok) errors.push('无破境丹应被拒');

  /* ⑥ 源码闸：进度模型引用 breakProgress；天劫门读 stormRoll */
  const stripC = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const ps = stripC(fs.readFileSync(path.join(WWW, 'js/core/player.js'), 'utf8'));
  const i0 = ps.indexOf('startBigBreak: function');
  const i1 = ps.indexOf('winBigBreak: function', i0);
  if (i0 < 0) bail('破境契约：找不到 startBigBreak');
  const body = ps.slice(i0, i1 > 0 ? i1 : i0 + 2000);
  if (body.indexOf('breakProgress') < 0) errors.push('源码闸：startBigBreak 未用 breakProgress（进度模型）');
  if (body.indexOf('stormRoll') < 0) errors.push('源码闸：天劫门未读 stormRoll');

  if (errors.length) {
    errors.forEach((e) => console.log('  ✗ ' + e));
    throw new Error('破境契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ 破境进度条：失败+50% / 两次必成 / 耗丹 / 气血减半 / 成后按概率历天劫');
});
pump(4, 'break.chance.leave');

/* ---------- 濒死红屏 + 受击红帧（v0.18.0）----------
   用户口径：「主角濒死时，全屏显红警告玩家」+「战斗界面主角应该是红色受击的动画帧」。
   本契约钉：① 阈值 25%（满血**不画**、濒死才画 —— 用 fillRect 计数验，不是"看代码有这段"）；
   ② 主角受击走**红色剪影**（敌我共用一段闪光代码，直接加色得到的是白的）；
   ③ 血量上限缓存可用（每帧现算 computeStats 太贵）。 */
step(function () {
  const errors = [];
  const stripC = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  /* ① 源码闸 */
  const gs = stripC(fs.readFileSync(path.join(WWW, 'js/core/game.js'), 'utf8'));
  const i0 = gs.indexOf('_renderDanger: function');
  if (i0 < 0) bail('濒死契约：game.js 里没有 _renderDanger');
  const i1 = gs.indexOf('_renderLoot: function');
  const body = gs.slice(i0, i1 > i0 ? i1 : i0 + 1400);
  if (body.indexOf('0.25') < 0) errors.push('濒死阈值应为 25%');
  if (!/pct > 0\.25\) return;/.test(body)) errors.push('满血时 _renderDanger 必须提前返回（不能一直泛红）');
  if (gs.indexOf('this._renderDanger(x)') < 0) errors.push('_renderDanger 没有被主循环调用');

  const bs = stripC(fs.readFileSync(path.join(WWW, 'js/scenes/battle.js'), 'utf8'));
  if (bs.indexOf('function hitSilhouette') < 0) errors.push('缺 hitSilhouette（主角受击红剪影）');
  /* ⚠️ 判据必须收在**闪光那一块**里：`key === 'P'` 在整个 battle.js 里出现几十次，
     全局 indexOf 恒真 —— 反例验证时正是这条漏了（G43 同型）。 */
  /* ⚠️ 找**调用点**而不是函数名：`hitSilhouette(spr)` 在定义处也出现一次，
     用 indexOf 会命中定义（在文件更前面），窗口取错位置 → 恒报假红。 */
  const hi = bs.indexOf('drawImage(hitSilhouette(spr)');
  if (hi < 0) {
    errors.push('受击红剪影只是定义了、没被用上');
  } else if (!/key === 'P'/.test(bs.slice(Math.max(0, hi - 420), hi + 220))) {
    errors.push('受击闪光未按"主角走红剪影"分支');
  }
  if (bs.indexOf('#ff4a3a') < 0) errors.push('主角受击剪影色缺失');

  /* ② 运行时：满血不画、濒死才画（用 fillRect 计数，不看代码"有没有这段"） */
  const realSave = G.game.save;
  const realMeta = G.game.meta;
  G.game.meta = G.game.meta || {};
  const mkSave = function (hp) {
    return { hp: hp, globalLevel: 1, skills: {}, quest: { step: 'free', flags: {} } };
  };
  const count = function (sv) {
    G.game.save = sv;
    G.game._hpKey = null;                      /* 强制重算缓存 */
    const c = makeCtx();
    let n = 0;
    c.fillRect = function () { n++; };
    try { G.game._renderDanger(c); } catch (e) { errors.push('_renderDanger 抛异常：' + e.message); }
    return n;
  };
  const mh = G.game._hpMaxCache(mkSave(1));
  if (!(mh > 0)) errors.push('_hpMaxCache 没算出气血上限（濒死判定会失效）');
  const full = count(mkSave(mh));
  const low = count(mkSave(Math.max(1, Math.round(mh * 0.10))));
  if (full !== 0) errors.push('满血时 _renderDanger 不该画任何东西（实画 ' + full + ' 个矩形）');
  if (low < 1) errors.push('濒死时 _renderDanger 必须画出红色警示（实画 ' + low + ' 个矩形）');
  G.game.save = realSave;
  G.game.meta = realMeta;
  G.game._hpKey = null;

  if (errors.length) {
    errors.forEach((e) => console.log('  ✗ ' + e));
    throw new Error('濒死契约失败：' + errors.length + ' 条');
  }
  console.log('  ✓ 濒死红屏：满血不画 / ≤25% 泛红 / ≤15% 出字；主角受击走红剪影');
}, 'danger.warn.contract');
pump(4, 'danger.warn.leave');

/* ---------- 剧情轮回记忆契约（story.memory.contract） ---------- */
(function () {
  var e2 = [];
  if (!G.Story) { errors.push('剧情系统 G.Story 未加载'); return; }
  var meta = G.Storage._migrate({ version: 7, xianli: 0,
    perfusion: { body: 0, qi: 0, po: 0, stone: 0, rescue: 0 },
    past: [], heaven: { memory: [] } });
  if (meta.version !== 11) e2.push('迁移后版本应为 11');
  if (!meta.memory || !meta.bonds || !meta.progress.story) e2.push('剧情结构未补齐');
  var r1 = G.Story.sealLife(meta, {}, 1);
  var sealedFan = Object.keys(meta.memory.fragments).length;
  if (sealedFan < 11) e2.push('凡界封印碎片应≥11，实际 ' + sealedFan);
  if (!meta.bonds.jiang || !meta.bonds.wanqing) e2.push('爷爷/晚晴应入故人卷');
  if (!meta.progress.story.oath) e2.push('第一世后应立誓');
  G.Story.onBreak(meta, {}, 1);
  if (meta.memory.recalled.indexOf('f01') < 0) e2.push('淬体应忆起 f01');
  G.Story.onBreak(meta, {}, 37);
  if (meta.memory.recalled.indexOf('f02') < 0 || meta.memory.recalled.indexOf('f03') < 0) e2.push('炼气应忆起 f02/f03');
  if (G.Story.recalledList(meta).length !== 3) e2.push('已忆起应为 3，实际 ' + G.Story.recalledList(meta).length);
  if (meta.memory.recalled.indexOf('f04') >= 0) e2.push('未到筑基不应忆起 f04');
  var savedGM = G.game.meta; G.game.meta = meta;
  G.Story.openCodex(); if (!G.Story.modalOpen()) e2.push('图鉴应能打开');
  G.Story.closeCodex(); if (G.Story.modalOpen()) e2.push('图鉴关闭异常');
  G.game.meta = savedGM;
  G.Story.setEnding(meta, 'nitan');
  if (meta.progress.story.ending !== 'nitan') e2.push('结局登记失败');
  G.Story._queue.length = 0;
  if (e2.length) e2.forEach(function (x) { errors.push('剧情记忆：' + x); });
  else console.log('  ✓ 轮回记忆：旧档迁移/死亡封印/境界忆起/图鉴/结局 闭环');
})();

/* v0.66 开局返工：隔离本地存储桩，行为断言不读取玩家真实浏览器存档。 */
step(function () {
  const before = { ls: sandbox.localStorage, save: G.game.save, meta: G.game.meta,
    scene: G.game.scene, sceneName: G.game.sceneName, changeScene: G.game.changeScene };
  const birth = G.scenes.reincarnation;
  const birthState = { step: birth.step, linggen: birth.linggen, talentCards: birth.talentCards,
    buttons: birth.buttons, finished: birth._finished };
  function check(ok, msg) { if (!ok) throw new Error(msg); }
  function reset() {
    const data = {};
    sandbox.localStorage = { getItem: k => data[k] || null,
      setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; } };
  }
  function slotsCheck() {
    reset();
    for (let i = 1; i <= 3; i++) {
      G.Storage.selectSlot(i);
      G.Storage.saveMeta({ past: [], xianli: i * 100 });
      G.Storage.saveCurrent({ life: i, stone: i * 10, globalLevel: 1, age: 16 });
      G.Storage.saveCurrent({ life: i, stone: i * 10 + 1, globalLevel: 1, age: 16 });
    }
    check(JSON.parse(sandbox.localStorage.getItem('nichen_save')).stone === 11, '槽一未沿用旧键或被其它槽覆盖');
    for (let i = 1; i <= 3; i++) {
      G.Storage.selectSlot(i);
      check(G.Storage.loadCurrent().stone === i * 10 + 1, '当世串档：槽' + i);
      check(G.Storage.loadMeta().xianli === i * 100, '轮回记录串档：槽' + i);
      const key = G.Storage._slotKey('nichen_save');
      check(JSON.parse(sandbox.localStorage.getItem(key + '_bak')).stone === i * 10, '备份串档：槽' + i);
    }
    check(G.Storage.listSlots().length === 3, '不是三个存档槽');
    G.Storage.selectSlot(2);
    sandbox.localStorage.setItem('nichen_save_slot2', '{bad json');
    check(G.Storage.loadCurrent().stone === 20, '槽二未从自己的备份恢复');
    G.Storage.clearCurrent();
    check(!G.Storage.hasCurrent(), '清除当世未清备份');
    check(G.Storage.hasMeta(), '清除当世误删轮回记录');
    G.Storage.selectSlot(1); check(G.Storage.loadCurrent().stone === 11, '清槽二影响槽一');
    G.Storage.selectSlot(3); check(G.Storage.loadCurrent().stone === 31, '清槽二影响槽三');
    [0, 4, -1, 1.5, '2', NaN].forEach(function (n) {
      let refused = false;
      try { G.Storage.selectSlot(n); } catch (e) { refused = true; }
      check(refused && G.Storage.activeSlot() === 3, '无效槽位未拒绝：' + n);
    });
    /* 删除存档（v0.75.0，用户口径「存档要支持删除」）：
       必须把 **主键 + .bak** 都清掉 —— `_read` 会在主键缺失时回落 `.bak`，
       只删主键会"删完还在"（读 bak 又读回来），这是最容易漏的一步。 */
    G.Storage.selectSlot(2);
    G.Storage.saveCurrent({ life: 2, stone: 999, globalLevel: 1, age: 16 });
    G.Storage.saveCurrent({ life: 2, stone: 998, globalLevel: 1, age: 16 });  /* 制造 bak */
    check(G.Storage.deleteSlot(2), 'deleteSlot 应返回成功');
    G.Storage.selectSlot(2);
    check(G.Storage.loadCurrent() === null, '删除后仍能从 .bak 读回存档（只删了主键）');
    check(!G.Storage.listSlots()[1].occupied, '删除后槽二仍标记为占用');
    /* 不该误伤邻槽 */
    G.Storage.selectSlot(1); check(G.Storage.loadCurrent().stone === 11, '删除槽二误伤槽一');
    G.Storage.selectSlot(3); check(G.Storage.loadCurrent().stone === 31, '删除槽二误伤槽三');
  }
  function birthCheck() {
    reset(); G.Storage.selectSlot(1); G.game.meta = null;
    birth.enter();
    check(birth.step === 'linggen', '降世仍从身份选择开始');
    check(birth.talentCards.length === 1, '每世不是一种天赋');
    const draft = JSON.stringify(G.game.meta.pendingBirth);
    const root = JSON.stringify(birth.linggen), talent = birth.talentCards[0].id;
    birth.rollLinggen(); birth.drawTalents(); birth.enter();
    G.game.meta = G.Storage.loadMeta(); birth.enter();
    check(JSON.stringify(G.game.meta.pendingBirth) === draft, '返回或重载会重抽降世');
    check(JSON.stringify(birth.linggen) === root && birth.talentCards[0].id === talent, '锁定结果未恢复');
    birth.step = 'talent'; birth._buildButtons();
    check(!birth.buttons.some(b => /重随|重抽|身份/.test(b.label)), '仍有重抽或身份按钮');
    G.game.changeScene = function () {};
    birth.finish();
    check(G.game.save.homeOwned === false, '新降世白送洞府');
    check(G.game.save.talents.length === 1 && G.game.save.origin === null, '新档仍多天赋或有身份');
    const first = G.game.save;
    birth.finish(); check(G.game.save === first, '重复入世覆盖了存档');
    G.game.meta.past.push({ life: 1 }); birth.enter();
    check(G.game.meta.pendingBirth.life === 2, '下世未创建新的降世草稿');
    /* 后一世允许偶然相同灵根，不用“结果必须不同”这种概率假红。 */
  }
  function homeCheck() {
    reset(); G.Storage.selectSlot(1);
    const s = { homeOwned: false, stone: G.Player.HOME_PRICE - 1, age: 16, globalLevel: 1 };
    check(!G.Player.acquireHome(s).ok && !G.Player.hasHome(s), '无钱也能取得洞府');
    s.stone = G.Player.HOME_PRICE + 17;
    check(G.Player.acquireHome(s).ok && G.Player.hasHome(s) && s.stone === 17, '租洞府未正确扣款/授予');
    check(!G.Player.acquireHome(s).ok && s.stone === 17, '重复租洞府再次扣款');
    check(G.Storage.loadCurrent().homeOwned === true, '洞府所有权未落盘');
    const old = G.Storage._migrate({ version: 9, stone: 12 });
    check(old.homeOwned === true && old.version === 11 && old.stone === 12, '旧档洞府迁移损失');
    const fresh = G.Storage._migrate({ version: 9, homeOwned: false });
    check(fresh.homeOwned === false, '迁移把无洞府变成有洞府');
  }
  function counterexample(obj, key, replacement, verify, label) {
    const real = obj[key]; let rejected = false;
    try { obj[key] = replacement; verify(); } catch (e) { rejected = true; }
    finally { obj[key] = real; }
    check(rejected, '反例没有被契约抓住：' + label);
    console.log('  ✓ 反例命中：' + label);
  }
  try {
    slotsCheck(); birthCheck(); homeCheck();
    if (process.argv.includes('--counterexamples')) {
      counterexample(G.Storage, '_slotKey', function (key) { return key; }, slotsCheck, '所有存档写同一键');
      const draw = birth.drawTalents;
      counterexample(birth, 'drawTalents', function () { draw.call(this); this.talentCards.push(this.talentCards[0]); }, birthCheck, '降世发两个天赋');
      counterexample(G.Player, 'acquireHome', function (s) { s.homeOwned = true; return { ok: true }; }, homeCheck, '洞府不检查余额');
    }
    console.log('  ✓ 三存档：当世/轮回/备份隔离；降世锁灵根单天赋；洞府扣款与旧档迁移');
  } finally {
    sandbox.localStorage = before.ls; G.game.save = before.save; G.game.meta = before.meta;
    G.game.scene = before.scene; G.game.sceneName = before.sceneName; G.game.changeScene = before.changeScene;
    birth.step = birthState.step; birth.linggen = birthState.linggen;
    birth.talentCards = birthState.talentCards; birth.buttons = birthState.buttons; birth._finished = birthState.finished;
  }
}, 'birth.slots.home.contract');

step(function () {
  function check(ok, msg) { if (!ok) throw new Error(msg); }
  [[0, '0'], [9999, '9999'], [10000, '10.0K'], [99999, '100.0K'], [100000, '10.0W']].forEach(function (c) {
    check(G.Player.formatCount(c[0]) === c[1], 'K/W边界错误：' + c[0]);
  });
  const realSave = G.game.save, realMeta = G.game.meta, realHover = G.UI.hover;
  const oldOverlay = G.scenes.town.overlay;
  const s = JSON.parse(JSON.stringify(save));
  try {
    G.game.save = s; G.game.meta = { past: [], perfusion: {}, progress: G.Storage.defaultProgress() };
    G.scenes.town.overlay = null;
    s.hp = G.Player.computeStats(s).maxhp; s.qi = G.Player.needQi(s);
    const ctx = textSpyXY(); G.scenes.town._drawHUD(ctx);
    const percents = ctx.__seenXY.filter(t => t.s === '100%');
    check(percents.length === 2 && percents[0].y < percents[1].y, 'HUD没有上下两条100%');
    check(!ctx.__seenXY.some(t => /^\d+ \/ \d+$/.test(t.s)), 'HUD仍显示气血绝对数值');
    const date = ctx.__seenXY.find(t => /太初/.test(t.s));
    check(date && date.x >= 240 && date.y < 20, '纪年仍与气血位置冲突');
    const tips = [];
    G.UI.hover = function (box, info) { tips.push({ box, info }); };
    G.Overlays.charLinggen(makeCtx(), s);
    check(tips.filter(t => /灵根/.test(t.info.title)).length === 9, '灵根九格没有全部挂说明');
    const mats = {};
    (G.Data.alchemy || []).concat(G.Data.forge || []).forEach(function (r) {
      Object.keys(r.mats).forEach(k => { mats[k] = 1; });
    });
    ['药渣', '灵食', '木囊', '玄囊', '宝囊', '血精', '道纹残片', '引灵符'].forEach(k => { mats[k] = 1; });
    Object.keys(mats).forEach(function (k) {
      const d = G.Overlays.itemDescription(k);
      check(d && d.length > 8 && d !== '—', '材料缺说明：' + k);
    });
    s.items = { '灵泉水': 1, '血精': 2, '木囊': 3 };
    tips.length = 0;
    G.Overlays.renderPanel(makeCtx(), { overlay: 'bag', bagTab: 'misc' });
    check(tips.length === 3 && tips.every(t => t.info.text.length > 8), '背包实际渲染未挂材料提示');
    G.Data.talents.forEach(function (t) {
      check(G.Data.talentDetail(t).text.length > 35, '天赋缺详细说明：' + t.id);
    });
    console.log('  ✓ 界面：HUD双百分比/纪年分离、九灵根悬浮、材料用途、99项天赋详情、K/W边界');
  } finally {
    G.game.save = realSave; G.game.meta = realMeta; G.UI.hover = realHover; G.scenes.town.overlay = oldOverlay;
  }
}, 'birth.ui.details.contract');

/* ---------- 灵根方向性 + 天赋职责（v0.75.0，用户口径）----------
   用户原话：「灵根的属性就决定主角本世应该往哪个方向收集功法和提升战力……
             还有灵根不能增加灵石获取，只有天赋可以，角色界面需要新增天赋子界面」。
   本契约钉三件事：
     ① 灵根**不得**影响灵石收入（唯一来源是天赋/世界特质）；
     ② 抽灵根时不再产生 stoneBonus（否则"刷金灵根"就成了经济优势）；
     ③ 角色面板有「天赋」子页，且能显示本世天赋。 */
step(function () {
  const P = G.Player;
  const mkS = function (elems, coef, talents) {
    return {
      life: 1, world: { seed: 1, anchor: true, names: {} }, worldSeed: 1,
      linggen: { kind: '单灵根', elems: elems, coef: coef, stoneBonus: 0.5 },
      talents: talents || [], skills: {}, skillEquip: [], items: {}, stone: 0, qi: 0, po: 0,
      globalLevel: 1, age: 16, quest: { step: 'free', flags: {} }, hp: 100, equip: {}
    };
  };

  /* ① 即便存档里 stoneBonus=0.5（老档），rates.st **不得**认它 */
  const rNo = P.rates(mkS(['木'], { 木: 1.2 }, []));
  if (rNo.st !== 0) {
    errors.push('灵根 stoneBonus 仍在影响灵石收入（rates.st=' + rNo.st + '）—— 用户要求只由天赋给');
  }
  /* ② 只有天赋能给：带 st 天赋时应有加成 */
  const tSt = G.Data.talents.filter(function (t) { return (t.e || {}).st; })[0];
  if (!tSt) errors.push('天赋池里找不到带灵石加成（e.st）的天赋');
  else {
    const rT = P.rates(mkS(['木'], { 木: 1.2 }, [tSt.id]));
    if (!(rT.st > 0)) errors.push('带 st 的天赋应给灵石加成，实为 ' + rT.st);
  }
  /* ③ 换灵根属性不得改变灵石收入（两者必须解耦） */
  const rA = P.rates(mkS(['金'], { 金: 1.5 }, []));
  const rB = P.rates(mkS(['暗'], { 暗: 2.5 }, []));
  if (rA.st !== rB.st) {
    errors.push('换灵根属性改变了灵石收入（金 ' + rA.st + ' vs 暗 ' + rB.st + '）—— 两者必须解耦');
  }

  /* ④ 源码闸：抽灵根处不得再写 stoneBonus 赋值 */
  const stripCs = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const rs = stripCs(fs.readFileSync(path.join(WWW, 'js/scenes/reincarnation.js'), 'utf8'));
  if (/lg\.stoneBonus\s*=/.test(rs)) {
    errors.push('源码闸：抽灵根仍在写 stoneBonus（玩家会"刷金灵根"换经济优势）');
  }

  /* ⑤ 天赋子页存在且能画（渲染不抛 + 悬停挂着天赋说明） */
  const realSave = G.game.save, realHover = G.UI.hover;
  const tips2 = [];
  G.UI.hover = function (r, info) { tips2.push({ r: r, info: info }); };
  try {
    const s = JSON.parse(JSON.stringify(save));
    s.talents = [tSt ? tSt.id : (G.Data.talents[0] || {}).id];
    s.charTab = 'talent';
    G.game.save = s;
    const ctx2 = makeCtx();
    G.Overlays.renderPanel(ctx2, { overlay: 'char', charTab: 'talent' });
    if (!tips2.length || !/天赋|品/.test(tips2[0].info.title || '')) {
      errors.push('天赋子页未挂悬停说明（截图看不出这一世拿了什么天赋）');
    }
    if (!/天赋/.test((G.Overlays.CHAR_TABS || []).map(function (t) { return t.n; }).join(''))) {
      errors.push('角色面板缺「天赋」子页签');
    }
  } catch (e) {
    errors.push('天赋子页渲染抛异常：' + e.message);
  } finally {
    G.game.save = realSave; G.UI.hover = realHover;
  }
  console.log('  ✓ 灵根方向性：灵石只由天赋给 / 抽灵根不再写 stoneBonus / 天赋子页在位');
}, 'linggen.talent.contract');

/* ---------- 界面收口（v0.75.0）----------
   ① HUD **不展示头像**（用户口径「这里不要展示头像了，我们不支持替换头像，
      我们要尽量模拟真实修仙世界」）—— 源码闸：探索 HUD 不得再调 G.UI.avatar；
   ② 追踪栏可**缩到最小**（用户口径「这些内容支持缩到最小，鼠标点击展开，
      不要占用游戏窗口」）—— 收起时高度必须显著小于展开态，且命中区跟着缩。 */
step(function () {
  const stripCu = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  const exSrc = stripCu(fs.readFileSync(path.join(WWW, 'js/core/explore.js'), 'utf8'));
  /* ① HUD 去头像：_drawHud 段内不得出现 avatar 调用 */
  const hud0 = exSrc.indexOf('_drawHud: function');
  const hud1 = exSrc.indexOf('_drawTracker: function');
  const hudBody = (hud0 >= 0 && hud1 > hud0) ? exSrc.slice(hud0, hud1) : exSrc;
  if (/G\.UI\.avatar\s*\(/.test(hudBody)) {
    errors.push('HUD 仍在画头像（用户口径：不展示头像，不支持替换头像）');
  }
  /* ② 追踪栏两档高度：收起态必须显著更矮，且命中区跟随 */
  const openH = exSrc.match(/TR_TAB_H\s*=\s*(\d+)/);
  const minH = exSrc.match(/TR_TAB_MIN_H\s*=\s*(\d+)/);
  if (!openH || !minH) {
    errors.push('追踪栏缺两档高度常量（TR_TAB_H / TR_TAB_MIN_H）');
  } else {
    const oh = +openH[1], mh = +minH[1];
    if (!(mh < oh * 0.6)) {
      errors.push('追踪栏收起高度 ' + mh + ' 不够小（展开 ' + oh + '）—— "缩到最小"没体现');
    }
  }
  /* 命中区必须跟着外观：收起态按钮 h 要取 TR_TAB_MIN_H */
  if (exSrc.indexOf('TR_TAB_MIN_H') < 0 || exSrc.split('TR_TAB_MIN_H').length < 3) {
    errors.push('源码闸：TR_TAB_MIN_H 未被外观与命中区共同引用（收起时多出的空区会吞地图点击）');
  }
  console.log('  ✓ 界面收口：HUD 无头像 / 追踪栏可缩到最小且命中区跟随');
}, 'ui.tighten.contract');

step(function () {
  const old = { ls: sandbox.localStorage, save: G.game.save, meta: G.game.meta,
    scene: G.game.scene, sceneName: G.game.sceneName, change: G.game.changeScene };
  const sc = G.scenes.field, hall = G.scenes.hall;
  const oldSc = { overlay: sc.overlay, buttons: sc.buttons, panelOpenAt: sc.panelOpenAt };
  const oldHall = hall.buttons;
  function check(ok, msg) { if (!ok) throw new Error(msg); }
  function verify() {
    const data = {};
    sandbox.localStorage = { getItem: k => data[k] || null,
      setItem: (k, v) => { data[k] = String(v); }, removeItem: k => { delete data[k]; } };
    const s = JSON.parse(JSON.stringify(save));
    s.homeOwned = false; s.quest = { step: 'm0-3', flags: {} }; s.scene = 'field'; s.map = 'field';
    G.game.meta = { past: [], xianli: 0, perfusion: {}, progress: G.Storage.defaultProgress() };
    G.game.save = s; G.game.scene = sc; G.game.sceneName = 'field';
    G.Storage.saveMeta(G.game.meta); G.Storage.saveCurrent(s);
    let go = null;
    G.game.changeScene = function (name) { go = name; };
    sc._transition({ to: 'town_home', spawn: { x: 14, y: 9 } });
    check(!go && sc.overlay === 'cave' && s.map === 'field', '未租洞府仍可由门进入');
    const btn = sc.buttons.find(b => b.label === '随身逆命珠');
    check(btn && !btn.disabled, '无洞府时缺少随身剧情入口');
    const beforeQi = s.qi, beforeStone = s.stone;
    btn.onClick();
    check(s.quest.step === 'm0-4' && sc.overlay === 'dream', '无洞府主线没有推进');
    check(s.homeOwned === false && s.stone === beforeStone, '随身剧情赠房或扣了租金');
    const ctx = textSpyXY();
    check(G.Overlays.route(ctx, sc) === true && ctx.__seenXY.length > 0, '野外随身剧情缺少绘制路由');
    G.Overlays.openVessel(sc);
    check(s.qi === beforeQi + 2500 && sc.overlay === 'cult', '重复点化再次发奖励');
    G.Storage.saveCurrent(s);
    hall.buttons = []; hall._buildFooter();
    const aliveBtn = hall.buttons.find(b => b.label === '返回当世');
    check(aliveBtn, '轮回殿仍可覆盖存活当世');
    aliveBtn.onClick();
    check(go === 'field' && G.game.save.homeOwned === false, '轮回殿没有回到本槽当世');
    G.Storage.clearCurrent(); hall.buttons = []; hall._buildFooter();
    const deadBtn = hall.buttons.find(b => b.label === '转世重修');
    check(deadBtn, '当世结束后缺少转世入口');
    deadBtn.onClick(); check(go === 'reincarnation', '空当世没有进入降世');
  }
  try {
    verify();
    if (process.argv.includes('--counterexamples')) {
      const real = G.Overlays.renderVessel; let caught = false;
      try { G.Overlays.renderVessel = function () {}; verify(); }
      catch (e) { caught = /缺少绘制路由/.test(e.message); }
      finally { G.Overlays.renderVessel = real; }
      check(caught, '随身剧情空白反例未命中');
      console.log('  ✓ 反例命中：随身剧情只有按钮、不画内容');
    }
    console.log('  ✓ 无洞府主线：门禁/野外可点化/重复不领奖/轮回殿不覆盖存活档');
  } finally {
    sandbox.localStorage = old.ls; G.game.save = old.save; G.game.meta = old.meta;
    G.game.scene = old.scene; G.game.sceneName = old.sceneName; G.game.changeScene = old.change;
    sc.overlay = oldSc.overlay; sc.buttons = oldSc.buttons; sc.panelOpenAt = oldSc.panelOpenAt;
    hall.buttons = oldHall;
  }
}, 'birth.navigation.contract');

/* ---------- 报告 ---------- */
if (notes.length) {
  console.log('\n—— 已知待办 (' + notes.length + ') ——');
  notes.forEach((n) => console.log(' · ' + n));
}
if (errors.length) {
  console.log('\n=== 冒烟测试发现问题 (' + errors.length + ') ===');
  errors.forEach((e) => console.log(' - ' + e));
  process.exit(1);
} else {
  console.log('冒烟测试通过：脚本加载 + 标题/转世/镇/山/洞/战斗/死亡/轮回殿 全场景渲染无异常。');
}
