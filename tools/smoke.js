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
    putImageData: noop, getImageData: () => ({ data: new Uint8ClampedArray(4) })
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

function makeCanvas(w, h) {
  const c = {
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

/* ---------- 加载脚本（顺序与 index.html 一致） ---------- */
const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
if (!srcs.length) { console.error('未在 index.html 中找到脚本'); process.exit(1); }

const errors = [];
/* 非致命提示（"这条有意如此"）。与 errors 分开：errors 一非空就退出码 1，
   notes 只打印 —— 用来记"待办但已知"，免得把 TODO 混进红色报错里，看久了就没人看报错了。 */
const notes = [];
/* 有意走程序化兜底的素材键（详见 npc.portrait.assets 契约里的注释） */
const PROC_FALLBACK_OK = new Set(['char.npc.cultist', 'portrait.cultist']);
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

/* 0c) 副本 Boss 立绘接线（磁盘级）。无头环境拿不到 manifest（fetch 被桩成 reject），
      但 manifest.json 就在磁盘上，可以直接读。这里钉两件事：
      ① dungeons 里每个 Boss 的 artKey 都在 manifest 里登记了「battle.enemy.<artKey>」；
      ② 登记的文件真实存在、且是 RGBA 透明底。
      漏登记/改名**不会报错**，只会静默退回程序化兜底（beastResolve 的 fallback），
      表现是"Boss 长得跟设计稿完全不一样"却查不出原因 —— 所以必须在这里锁死。 */
step(function () {
  const mfPath = path.join(WWW, 'assets', 'manifest.json');
  if (!fs.existsSync(mfPath)) { errors.push('缺少 www/assets/manifest.json'); return; }
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
  const want = [];
  G.Data.dungeons.ARCH.forEach((a) => {
    ['big', 'mid', 'leader'].forEach((t) => {
      if (a[t] && a[t].artKey) want.push(a[t].artKey);
    });
  });
  if (want.length !== 20) errors.push(`副本 Boss artKey 应为 20 个，实际 ${want.length}`);
  want.forEach((ak) => {
    const key = 'battle.enemy.' + ak;
    const rel = mf[key];
    if (!rel) { errors.push(`manifest 未登记 Boss 立绘：${key}（会静默退回程序化兜底）`); return; }
    const p = path.join(WWW, rel);
    if (!fs.existsSync(p)) { errors.push(`manifest 登记的 Boss 立绘不存在：${key} → ${rel}`); return; }
    /* PNG 第 26 字节是 IHDR 的 color type，6 = truecolor+alpha（透明底） */
    if (fs.readFileSync(p)[25] !== 6) errors.push(`${key} 不是 RGBA 透明底：${rel}`);
  });
}, 'dungeon.boss.assets');

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
  want({ step: 'm0-4', flags: {} }, 9, '?', 'm0-4 淬体九段待领丹');
  want({ step: 'm0-4', flags: { gotBreakPill: true } }, 9, null, 'm0-4 已领丹');
  want({ step: 'free', flags: {} }, 9, null, '自由游玩期');
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
  s.quest = { step: 'm1-4', flags: {} }; s.globalLevel = 14;
  if (keeper && mk.npcMarkOf(keeper) !== null) errors.push('任务标记错：m1-4 未到门槛时刘掌柜不应挂标记');
  s.quest = { step: 'm1-4', flags: {} }; s.globalLevel = 15;
  if (keeper && mk.npcMarkOf(keeper) !== '?') errors.push('任务标记错：m1-4 到门槛时刘掌柜应挂 ？');
  s.quest = { step: 'm1-4', flags: { foundPill: true } }; s.globalLevel = 15;
  if (keeper && mk.npcMarkOf(keeper) !== null) errors.push('任务标记错：已得丹后刘掌柜不应再挂标记');

  /* M1 各步的标记（沈伯 / 探子）—— 与任务链契约里的运行时断言互为冗余：
     这里只查"标记函数"，那边查"整条链真的走通"，两边都过才算数。 */
  s.globalLevel = 15;
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
  s.globalLevel = 14;
  wantShen({ step: 'm1-4', flags: {} }, null, 'm1-4 未到门槛');
  s.globalLevel = 15;
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
  sc._onEnterTile(sc.map.md.spawn.x, 30);
  if (sc._pending) errors.push('prot>0 的保护期内不应触发遭遇');
  sc.prot = 0;
  if (!sc._zone(30)) { errors.push('翠微山 y=30 没有遭遇分区'); G.rng.next = realNext; return; }
  /* ② 踩中暗雷 → 排队 + 闪白方向为 1 */
  sc._onEnterTile(sc.map.md.spawn.x, 30);
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
  sc2.onTap({ x: 240, y: 200 });
  if (!sc2.path.length) errors.push('返回后点击不能寻路 —— 玩家仍被锁着');
}, 'encounter.enter');

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
  if (s.globalLevel !== 2) errors.push('点突破后应为淬体二段，实为 ' + s.globalLevel);
  if (s.qi !== q0 - 40) errors.push('突破未按公式扣除灵气（' + q0 + ' → ' + s.qi + '）');
}, 'quest.dream');
pump(8, 'quest.dream.render');

step(function () {
  const s = G.game.save;
  s.quest.step = 'm0-4'; s.globalLevel = 9; s.items = {}; s.stone = 0;
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
  if (!s.items['淬体突破丹']) errors.push('m0-4 淬体9 与沈伯对话未赠突破丹');
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
  if (labels !== '攻击,功法,道具,防御,逃跑,自动') errors.push('指令集不符 M0 裁剪：' + labels);
}, 'battle.commands');

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
  if (P.needQi(bare, 1) !== 40) errors.push('淬体1→2 应为 40，实为 ' + P.needQi(bare, 1));
  let sum = 0;
  for (let gl = 1; gl <= 8; gl++) sum += P.needQi(bare, gl);
  if (sum !== 8160) errors.push('淬体 1→9 合计应为 8,160，实为 ' + sum);
  if (P.needQi(bare, 9) !== 3240) errors.push('淬体9→10 应为 3,240，实为 ' + P.needQi(bare, 9));
  if (P.needQi(bare, 10) !== 200) errors.push('炼气1→2 应为 200，实为 ' + P.needQi(bare, 10));
  if (P.needQi(bare, 11) !== 800) errors.push('炼气2→3 应为 800，实为 ' + P.needQi(bare, 11));
  /* 天赋/世界折扣 */
  const disc = { globalLevel: 1, linggen: bare.linggen, talents: [], world: { traits: ['W13'] } };
  if (P.needQi(disc, 1) !== 36) errors.push('洞天福地 -10% 未生效：' + P.needQi(disc, 1));
}, 'break.formula');

step(function () {
  const P = G.Player;
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 1; s.qi = 100; s.items = {};
  s.talents = []; s.world.traits = [];
  /* 正常：灵气 100 → 突破 → 淬体2、灵气归零 */
  let r = P.breakthrough(s);
  if (!r.ok) errors.push('灵气 100 未能突破淬体1→2：' + r.reason);
  else if (s.globalLevel !== 2) errors.push('突破后境界应为 2，实为 ' + s.globalLevel);
  else if (s.qi !== 60) errors.push('突破后灵气应为 100-40=60，实为 ' + s.qi);
  /* 失败：灵气不足不升级不扣灵气 */
  s.qi = 10;
  const before = s.qi, gl0 = s.globalLevel;
  r = P.breakthrough(s);
  if (r.ok) errors.push('灵气不足却突破成功');
  if (s.qi !== before || s.globalLevel !== gl0) errors.push('灵气不足时不应改动灵气/境界');
  if (!/还需/.test(r.reason)) errors.push('灵气不足提示文案异常：' + r.reason);
  /* 边界：淬体9 无丹 → 提示需突破丹，不进心魔战 */
  s.globalLevel = 9; s.qi = 3240; s.items = {};
  const st = P.breakState(s);
  if (!st.big) errors.push('淬体9 未识别为大境界突破');
  if (!/淬体突破丹/.test(st.reason)) errors.push('缺丹提示文案异常：' + st.reason);
  if (P.breakthrough(s).big !== true) errors.push('淬体9 点击突破未走大境界分支');
  const bb = P.startBigBreak(s);
  if (bb.ok) errors.push('无突破丹却开始了心魔战');
  /* 有丹 → 扣丹 + 进心魔战；胜利 → 炼气1 */
  s.items = { 淬体突破丹: 1 };
  const bb2 = P.startBigBreak(s);
  if (!bb2.ok) errors.push('持丹却无法开始大境界突破：' + bb2.reason);
  if (s.items['淬体突破丹']) errors.push('心魔战开始时未消耗突破丹');
  const info = P.winBigBreak(s);
  if (s.globalLevel !== 10) errors.push('心魔战胜利后应为炼气1（10），实为 ' + s.globalLevel);
  if (info.n !== '炼气一重') errors.push('境界名异常：' + info.n);
  if (s.qi !== 0) errors.push('突破后灵气应为 3240-3240=0，实为 ' + s.qi);
  /* 失败：不降级、灵气保留 80% */
  s.globalLevel = 9; s.qi = 1000;
  const left = P.loseBigBreak(s);
  if (s.globalLevel !== 9) errors.push('心魔战失败不应降级');
  if (left !== 800) errors.push('心魔战失败灵气应保留 80%（800），实为 ' + left);
}, 'break.rules');

/* 4c) 普通遭遇奖励公式：灵气 80×L×灵根系数 / 灵力 8×L / 灵石 6×L */
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
  if (s.qi !== 480) errors.push('灵气奖励应为 80×6×1.0=480，实为 ' + s.qi);
  if (s.po !== 48) errors.push('灵力奖励应为 8×6=48，实为 ' + s.po);
  if (s.stone !== 36) errors.push('灵石奖励应为 6×6=36，实为 ' + s.stone);
}, 'reward.formula');
pump(20, 'reward.result');

/* 4d) 心魔战：走通战斗场景分支（胜利 → 炼气1 + 任务 m0-5） */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 9; s.qi = 3240; s.items = { 淬体突破丹: 1 };
  s.quest = { step: 'm0-4', flags: {} };
  G.game.save = s;
  const bb = G.Player.startBigBreak(s);
  if (!bb.ok) { errors.push('心魔战前置失败：' + bb.reason); return; }
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
  if (s.globalLevel !== 10) errors.push('心魔战胜利后境界应为 10，实为 ' + s.globalLevel);
  if (s.quest.step !== 'm0-5') errors.push('心魔战胜利后任务应推进到 m0-5，实为 ' + s.quest.step);
  if (s.hp !== G.Player.computeStats(s).maxhp) {
    errors.push('突破后气血应回满，实为 ' + s.hp + ' / ' + G.Player.computeStats(s).maxhp);
  }
}, 'battle.heartDemon.win');
pump(20, 'battle.heartDemon.result');

/* 4e) 心魔战失败：不降级、灵气 80%、回镇（不进死亡） */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 9; s.qi = 3000; s.items = {};
  s.quest = { step: 'm0-4', flags: {} };
  G.game.save = s;
  G.game.changeScene('battle', { script: 'heartDemon', mapId: 'town' });
}, 'battle.heartDemon.lose');
pump(10, 'battle.heartDemon.lose');
step(function () {
  const b = G.game.scene, s = G.game.save;
  b.p.hp = 0;
  b._defeat();
  if (s.globalLevel !== 9) errors.push('心魔战失败不应降级');
  if (s.qi !== 2400) errors.push('心魔战失败灵气应保留 80%（2400），实为 ' + s.qi);
  if (b.resultWin !== false) errors.push('心魔战失败结果标记异常');
  if (!(s.hp > 0)) errors.push('心魔战失败回镇气血不应为 0，实为 ' + s.hp);
}, 'battle.heartDemon.lose.check');
pump(20, 'battle.heartDemon.lose.result');

/* 4f) 蓄力预告：敌方蓄力技必须先预告一回合 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 8; s.hp = 999;
  G.game.save = s;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('赤炎狼', 6, '苍鬃狼'), mapId: 'field' });
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
    globalLevel: 20, maxGlobalLevel: 20, age: 33,
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
  [['淬体', 1, 100], ['炼气', 10, 150], ['筑基', 19, 200], ['金丹', 28, 300],
   ['元婴', 37, 500], ['化神', 46, 800], ['炼虚', 55, 1000], ['合体', 64, 1500],
   ['大乘', 73, 2000], ['渡劫', 82, 3000], ['人仙', 91, 5000], ['地仙', 100, 8000],
   ['天仙', 109, 12000], ['金仙', 118, 20000], ['太乙金仙', 127, 30000],
   ['大罗金仙', 136, 50000], ['准圣', 145, 100000], ['圣人', 154, 200000],
   ['道祖', 163, Infinity]]
    .forEach(function (c) {
      if (P.lifespanOf(c[1]) !== c[2]) {
        errors.push(c[0] + ' 寿元应为 ' + c[2] + '，实为 ' + P.lifespanOf(c[1]));
      }
    });

  const s = { age: 16, globalLevel: 1 };
  let gained = 0;
  for (let i = 0; i < 9; i++) gained += P.agePush(s, 'battle', 1);
  if (gained !== 0) errors.push('9 场战斗不应增龄，实增 ' + gained);
  if (P.agePush(s, 'battle', 1) !== 1) errors.push('第 10 场战斗应 +1 岁');
  if (s.age !== 17) errors.push('战斗增龄后应为 17 岁，实为 ' + s.age);
  P.agePush(s, 'meditate', 60);
  if (s.age !== 18) errors.push('打坐 60 分钟应 +1 岁，实为 ' + s.age);
  P.agePush(s, 'break');
  if (s.age !== 20) errors.push('突破应 +2 岁，实为 ' + s.age);
  if (P.isAged(s)) errors.push('20 岁不应判为寿元尽');
  s.age = 100;
  if (!P.isAged(s)) errors.push('淬体 100 岁应判为寿元尽');
  if (P.lifespanLeft(s) !== 0) errors.push('寿元尽时剩余应为 0');
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

  /* 指定灵界 → gl64 + 雷泽荒原 */
  s = descend('ling', false);
  if (G.Player.activeWorldId(G.game.meta) !== 'ling') errors.push('指定灵界降世未生效');
  if (s.globalLevel !== 64) errors.push(`灵界降世起始 gl 应为 64，实际 ${s.globalLevel}`);
  if (s.scene !== G.Data.regions.mapIdOf('ling1')) errors.push(`灵界降世落点应为 ling1，实际 ${s.scene}`);
  if (s.entrances.ling.length !== 5) errors.push('灵界降世未抽 5 处副本落位');

  /* 指定道界但没钥匙 → 必须回落（不能被扔进没开的世界） */
  s = descend('dao', false);
  if (G.Player.activeWorldId(G.game.meta) === 'dao') errors.push('没钥匙却降世到了道界');

  /* 有钥匙 → 道界可选：gl145 + 道则回廊（dao1），且只有 1 处入口 */
  s = descend('dao', true);
  if (G.Player.activeWorldId(G.game.meta) !== 'dao') errors.push('有钥匙时道界降世未生效');
  if (s.globalLevel !== 145) errors.push(`道界降世起始 gl 应为 145，实际 ${s.globalLevel}`);
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
        buildingN++;
        const dx = st.x + Math.floor(st.w / 2), dy = st.y + st.h;
        const o = mp.interact[dx + ',' + dy];
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
     摘/还都**原地改数组**（不换引用）—— mapgen 可能把这张数组交给 map.md。 */
  function frames(regionId, dropKind) {
    const md = G.Data.maps[regionId] || G.RegionGen.ensure(s, regionId);
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
  const emd = G.Data.maps[entRegion] || G.RegionGen.ensure(s, entRegion);
  if (!(emd.special || []).some(function (x) { return x.kind === 'entrance'; })) {
    errors.push(`${entRegion}: 落位区里没有生成入口裂隙`);
  } else {
    const a = frames(entRegion, null), b = frames(entRegion, 'entrance');
    if (!(a > b)) errors.push(`裂隙没有画出来：摘掉 entrance 后每帧 drawImage 次数没减少（${a} vs ${b}）`);
  }

  /* ② 界门：本界标记 gate 的生成型区域 */
  const gr = G.Data.regions.of('fan').filter(function (r) { return r.gate && !r.map; })[0];
  if (!gr) errors.push('fan: 没有标记 gate 的生成型区域');
  else {
    const gmd = G.Data.maps[gr.id] || G.RegionGen.ensure(s, gr.id);
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
  if (xm.level !== 19) errors.push('血面 等级应为 19，实际 ' + xm.level);
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
  s.globalLevel = 15; s.maxGlobalLevel = 15;
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
  /* 等级 = 本世 gl+1、上限 17（设计 §4 明写） */
  if (b.es[0].level !== Math.min(17, s.globalLevel + 1)) {
    errors.push('m1-2：探子战等级应为 min(17, gl+1)=' + Math.min(17, s.globalLevel + 1)
      + '，实为 ' + b.es[0].level);
  }
  if (!b._noFlee()) errors.push('m1-2：剧情战必须禁逃（_noFlee() 为假）');

  /* 打完了：直接走 _victory 的探子分支，验"只交接 flag、不在这里推任务步" */
  b.p.hp = b.p.maxhp; b.es[0].hp = 0;
  b._victory();
  if (!R().flags.probeWin) errors.push('m1-2：胜利未写 flags.probeWin');
  if (R().step !== 'm1-2') errors.push('m1-2：胜利后任务步不该变（抉择还没选），实为 ' + R().step);

  /* 等级上限：主测试存档 gl=15 → min(17,16)=16，**验不出封顶**。
     另开一场 gl=20 的逼出上限分支（设计 §4 明写"上限 17"）。
     放在 _victory 之后：battle 是单例，再 enter 一次会把上面那场覆盖掉。 */
  {
    const sCap = JSON.parse(JSON.stringify(s));
    sCap.globalLevel = 20;
    G.game.save = sCap;
    G.game.changeScene('battle', { script: 'probe', mapId: 'town' });
    if (G.game.scene.es[0].level !== 17) {
      errors.push('m1-2：探子战等级未封顶 17，实为 ' + G.game.scene.es[0].level);
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

  /* —— m1-4 门槛：不到炼气六段不接活 —— */
  G.game.changeScene('town_shop', { toSpawn: true });
  sc = G.game.scene;
  s.globalLevel = 14;
  const before = JSON.stringify(s.items);
  faceAndInteract(sc, sbTown);
  if (JSON.stringify(s.items) !== before) errors.push('m1-4 门槛失效：14 级就能拿到丹');
  if (sc.overlay) { errors.push('m1-4 门槛不足时不该开面板'); sc.clearOverlay(); }

  /* —— m1-4 沈伯旧方：妖丹×3 + 灵石 600 —— */
  s.globalLevel = 15;
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
  s2.globalLevel = 15;
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

  /* —— 丹名口径：炼气九段圆满要的是「筑基丹」—— */
  if (G.Player.breakPill(18) !== '筑基丹') {
    errors.push('炼气九段突破丹名应为「筑基丹」，实为 ' + G.Player.breakPill(18));
  }
  if (G.Player.breakPill(9) !== '淬体突破丹') errors.push('淬体九段丹名被改坏了');
  if (G.Player.breakPill(27) !== '筑基突破丹') errors.push('筑基九段丹名被改坏了');
  const bs = (function () {
    const t = JSON.parse(JSON.stringify(s));
    t.globalLevel = 18; t.qi = 999999; t.items = {};
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
  s.globalLevel = 17; s.maxGlobalLevel = 17; s.items = { 筑基丹: 1 };
  s.pos = null;
  G.game.save = s;
  G.game.changeScene('town_shop', { toSpawn: true });
  let sc = G.game.scene;
  /* 17 级（炼气八段）不够门槛 → 不该开出面板 */
  faceAndInteract(sc, sbTown);
  if (sc.overlay) { errors.push('m1-5 门槛失效：17 级就开出了入夜面板'); sc.clearOverlay(); }
  if (sc.npcMarkOf(sbTown) !== null) errors.push('m1-5：未到门槛时沈伯不该挂 ！');

  /* 18 级（炼气九段圆满）→ 挂 ！并开出面板 */
  s.globalLevel = 18; s.maxGlobalLevel = 18;
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
    if (G.game.scene.map.scriptBattles['14,18']) {
      errors.push('bloodhall：probe=spare 时入口战应跳过（阿七开门），实际还在');
    }
    const sKill = JSON.parse(JSON.stringify(s));
    sKill.quest = { step: 'm1-5', flags: { probe: 'kill' } };
    sKill.pos = null;
    G.game.save = sKill;
    G.game.changeScene('bloodhall', { toSpawn: true });
    if (!G.game.scene.map.scriptBattles['21,9']) {
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
  if (bx.es[0].level !== 19) errors.push('血面应固定 L19，实为 ' + bx.es[0].level);
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
    s6.globalLevel = 18; s6.maxGlobalLevel = 18;
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
    if (s6.globalLevel !== 19) errors.push('筑基后境界应为 gl19，实为 ' + s6.globalLevel);
    pump(80, 'm1-6.after');
  }

  /* M0 的炼气破境仍必须回到 m0-5（分派不能把老路径带坏） */
  {
    const s5 = JSON.parse(JSON.stringify(save));
    s5.quest = { step: 'm0-4', flags: {} };
    s5.globalLevel = 9; s5.maxGlobalLevel = 9;
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
    if (R().step !== 'm1done') errors.push('m1-7 收尾应转 m1done，实为 ' + R().step);
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

  /* 指令按钮变体：防御/道具走 battle，攻击走 gold，逃跑走 danger */
  const byKey = (k) => b.buttons.filter((x) => x._key === k)[0];
  if (byKey('防御') && byKey('防御').variant !== 'battle') {
    errors.push('「防御」应为 battle 变体，实为 ' + byKey('防御').variant);
  }
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
    const rows = sc.buttons.filter((b) => /Lv\d/.test(b.label || ''));
    if (rows.length !== 3) errors.push('功法下拉应有 3 行，实为 ' + rows.length);
    const lvs = rows.map((b) => parseInt((b.label.match(/Lv(\d+)/) || [0, 0])[1], 10));
    for (let i = 1; i < lvs.length; i++) {
      if (lvs[i] > lvs[i - 1]) errors.push('功法下拉未按等级降序：' + lvs.join(' / '));
    }
    if (rows.length && rows[0].label.indexOf('缠藤指') < 0) {
      errors.push('下拉第一行不是等级最高的功法：' + rows[0].label);
    }
    /* 下拉行必须排在 buttons 前面（命中按数组顺序），否则会被「精进」抢走点击 */
    if (sc.buttons[0].label.indexOf('Lv') < 0) {
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
    ['杂项', '功法', '灵石', '法宝', '秘术'].forEach((n) => {
      if (!tabs.some((b) => b.label === n)) errors.push('储物缺分类子页：' + n);
    });
    if (!sc.buttons.some((b) => b.sub && /^×/.test(String(b.sub)))) {
      errors.push('杂项页没有方格陈列（物品格按钮缺 sub 副行）');
    }
    const skTab = tabs.filter((b) => b.label === '功法')[0];
    if (!skTab) bail('储物缺「功法」子页');
    skTab.onClick();
    if (sc.bagTab !== 'skill') errors.push('点「功法」子页没有切到 skill');
    if (!sc.buttons.some((b) => b.sub && /^Lv/.test(String(b.sub)))) {
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
  }

  /* ========== ⑦ 出口传送阵：命中 + 点击切图 ========== */
  {
    G.game.changeScene('town', { toSpawn: true });
    const sc = G.game.scene;
    const e1 = sc._exitAt(18, 23);                       /* town 出口在 y=23 */
    if (!e1 || e1.to !== 'field') errors.push('_exitAt 没命中镇出口');
    const e2 = sc._exitAt(18, 22);                       /* 阵雾向上飘 → 上方一格也算 */
    if (!e2 || e2.to !== 'field') errors.push('_exitAt 未覆盖传送阵上方一格');
    if (sc._exitAt(5, 5)) errors.push('_exitAt 在非出口格误命中');
    if (ex.indexOf('_drawPortal: function') < 0) errors.push('explore.js 缺 _drawPortal（出口传送阵）');
    const portalBody = ex.slice(ex.indexOf('_drawPortal: function'), ex.indexOf('_exitAt: function'));
    if (portalBody.indexOf('drawImage') >= 0) {
      errors.push('出口传送阵用了素材图 —— 它必须纯矢量（缺图会静默退回）');
    }
    /* 点出口格 → 直接切图 */
    const p = { x: 18 * 16 + 8 - sc._camX(), y: 23 * 16 + 8 - sc._camY() };
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
  if (gls.join(',') !== '147,150,153,156,159,162,165,168,171') {
    errors.push('道界九关锚点 gl 序列错误：' + gls.join(','));
  }
  if (Dg.daoTotalCost() !== 3900) errors.push(`道晶总耗应为 3900，实际 ${Dg.daoTotalCost()}`);
  ['准圣', '圣人', '道祖'].forEach(function (r) {
    const n = T.filter(function (t) { return t.realm === r; }).length;
    if (n !== 3) errors.push(`${r} 应有 3 关，实际 ${n}`);
  });
  if (!T[8].finale) errors.push('末关「合道」应为演出关（finale）');
  if (Dg.DAO_ENTER_GL !== 145) errors.push('入道界起始境界应为 gl145');
  /* 道晶产出方向：地狱 > 普通（与灵石 res 相反，道则越难越凝练） */
  const dn = Dg.daoCrystalDrop('normal', 0), dh = Dg.daoCrystalDrop('hell', 0);
  if (!(dh > dn)) errors.push(`道晶产出应随难度上升：普通 ${dn} / 地狱 ${dh}`);

  /* ---- 造一份道界档 ---- */
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 145;
  s.maxGlobalLevel = 145;
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
  if (Dg.daoReqGL(0) !== 145 || Dg.daoReqGL(1) !== 147) errors.push('daoReqGL 口径错');

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
    if (es[0].level !== 147) errors.push(`斩善尸 Boss gl 应为 147，实际 ${es[0].level}`);
  }

  /* ---- ④ 结算：通关即进境 + 得道晶 ---- */
  G.game.changeScene('dungeon', { fromBattle: true });
  if (sc.view !== 'brief') errors.push('道界战斗返回后应停在结算简报');
  if (!s.daoCleared[0]) errors.push('通关后第 1 关未记入 daoCleared');
  if (s.globalLevel !== 147) errors.push(`斩善尸通关后 gl 应为 147，实际 ${s.globalLevel}`);
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

  /* ---- ⑤ 走完九关 → gl171 ---- */
  for (let i = 1; i < 9; i++) {
    s.daoCrystal = 99999;
    sc._showDaoHub();
    sc.buttons[i].onClick();
    if (i === 8) break;                        /* 第 9 关是演出关，不进战斗 */
    if (G.game.sceneName !== 'battle') { errors.push(`第 ${i + 1} 关未能开战`); return; }
    G.game.changeScene('dungeon', { fromBattle: true });
  }
  if (G.game.sceneName !== 'dungeon') { errors.push('合道演出应回到副本场景'); return; }
  if (s.globalLevel !== 171) errors.push(`九关走完后 gl 应为 171，实际 ${s.globalLevel}`);
  if (s.daoCleared.filter(Boolean).length !== 9) errors.push('九关应全部记为已历');
  if (!G.Player.breakState(s).maxed) errors.push('gl171 应判为已至绝顶（maxed）');

  /* ---- ⑤ 道界无破境之说：gl150 时灵气突破必须被拦 ---- */
  const s2 = JSON.parse(JSON.stringify(s));
  s2.globalLevel = 150; s2.qi = 1e9;
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
  /* 4 界 × (主界 + 难度) + 底部 5 键（返回标题 / 仙躯灌注 / 飞升台 / 前世经历 / 转世重修） */
  if (sc.buttons.length !== 13) errors.push(`飞升台按钮数应为 13（4+4+5），实际 ${sc.buttons.length}`);

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
    return id === 'char' ? G.Overlays.CHAR_BAND : G.Overlays.PANEL_BAND;
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
  const CLOSE_IDS = ['char', 'skills', 'secrets', 'quest', 'bag', 'cave', 'map'];
  CLOSE_IDS.forEach(function (id) {
    G.Overlays.openPanel(sc, id);
    if (sc.overlay !== id) { errors.push('openPanel(' + id + ') 失败'); return; }
    const cb = sc.buttons.filter(function (b) { return b.glyph === 'close'; });
    if (cb.length !== 1) {
      errors.push('面板 ' + id + ' 的关闭钮应为 1 个，实际 ' + cb.length);
      return;
    }
    const b = cb[0];
    const R = (id === 'char') ? G.Overlays.CHAR_PANEL : G.Overlays.PANEL_RECT;
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
    if (tabs.length !== 6) errors.push('角色面板应有 6 个子页签（总览/灵根/属性/境界/功法/秘术），实际 ' + tabs.length);
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
  if (charTabIds.length !== 6) {
    errors.push('角色面板子页签应为 6 个（总览/灵根/属性/境界/功法/秘术），实际 ' + charTabIds.length);
  }
  [
    { id: 'skills', R: G.Overlays.PANEL_RECT },
    { id: 'secrets', R: G.Overlays.PANEL_RECT },
    { id: 'quest', R: G.Overlays.PANEL_RECT },
    { id: 'bag', R: G.Overlays.PANEL_RECT },
    { id: 'cave', R: G.Overlays.PANEL_RECT },
    { id: 'map', R: G.Overlays.PANEL_RECT }
  ].concat(charTabIds.map(function (tid) {
    return { id: 'char', tab: tid, R: G.Overlays.CHAR_PANEL };
  })).forEach(function (item) {
    G.Overlays.openPanel(sc, item.id);
    /* openPanel 从别处切进来时会重置为「总览」，所以要在它**之后**指定子页 */
    if (item.tab) sc.charTab = item.tab;
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

  /* ① 覆盖 gl 2–144 */
  const cov = {};
  bands.forEach(function (b) {
    for (let gl = b.enc.min; gl <= b.enc.max; gl++) cov[gl] = true;
  });
  const miss = [];
  for (let gl = 2; gl <= 144; gl++) if (!cov[gl]) miss.push(gl);
  if (miss.length) {
    errors.push('gl ' + miss[0] + '–' + miss[miss.length - 1] + ' 等 ' + miss.length
      + ' 级没有野外遭遇带（三界内不得有空洞；U5 修过一次 91–105）');
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
    for (let s = 1; s <= 9; s++) need += P2.needQi(base, t.y0 + s - 1);
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
    if (n < 10 || n > 120) {
      errors.push(t.n + ' 刷满一境需 ' + Math.round(n) + ' 场，超出合理区间 [10, 120]');
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

/* ---------- 野怪收益曲线**差分探针** ----------
   ⚠️ G19 的教训：只断言"函数存在 / 数值自洽"抓不到**"登记了但没接线"** ——
   把 `battle.js` 里的 `* G.Player.realmQiCoef(L)` 摘掉，上面那条契约**照样全绿**。
   所以这里必须**真的打一场 L=144 的野外战**，逐项复算期望值再比对；
   并反向确认收益**显著高于**"不带境界系数"的值，否则说明系数根本没生效。 */
step(function () {
  const s = JSON.parse(JSON.stringify(G.game.save));
  s.globalLevel = 144; s.qi = 0; s.po = 0; s.stone = 0;
  s.linggen = { elems: ['木'], coef: { 木: 1.0 }, kind: '单灵根', stoneBonus: 0 };
  s.talents = []; s.originFx = {}; s.bonus = {}; s.world = { traits: [] };
  s.dungeonRun = null;
  G.game.save = s;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 144, '青纹蛇'), mapId: 'field' });
}, 'zone.curve.probe.enter');
pump(10, 'zone.curve.probe.enter');
step(function () {
  const b = G.game.scene, s = G.game.save;
  if (!b || !b.es || !b.es.length) { errors.push('差分探针：未能进入战斗'); return; }
  b.es.forEach(function (e) { e.hp = 0; });
  const before = s.qi || 0;
  b._victory();
  const got = (s.qi || 0) - before;
  const lg = s.linggen || { elems: ['无'], coef: {} };
  const lgc = (lg.coef && lg.coef[(lg.elems && lg.elems[0]) || '无']) || 1;
  const rq2 = G.Player.rates(s).qi || 0;
  let exp = 0, noCoef = 0;
  b.es.forEach(function (e) {
    const L = e.level;
    const gap = ((s.globalLevel || 1) - L) > 5 ? 0.5 : 1;
    noCoef += Math.round(80 * L * lgc * (1 + rq2) * gap);
    exp += Math.round(80 * L * lgc * (1 + rq2) * gap * G.Player.realmQiCoef(L));
  });
  if (got !== exp) {
    errors.push('差分探针：野外灵气收益 ' + got + ' ≠ 期望 ' + exp
      + '（battle.js 可能没接 realmQiCoef —— 见 G19 教训）');
  }
  if (!(exp > noCoef * 10)) {
    errors.push('差分探针：L=144 的境界系数没起作用（' + exp + ' vs 无系数 ' + noCoef + '）');
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
   比数次数更稳 —— 以后新增奖励点会自动纳入检查。 */
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
  if (seen < 6) errors.push('源码闸：只扫到 ' + seen + ' 处灵气奖励（应 ≥6），正则可能过时了');
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
