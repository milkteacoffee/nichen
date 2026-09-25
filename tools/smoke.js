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

/* 1) 启动 → 标题 */
step(() => G.game.start(), 'start');
pump(30, 'title');
step(() => G.scenes.title._openAbout(), 'title.about');
pump(10, 'title.about');
step(() => { G.scenes.title.about = false; G.scenes.title._buildMenu(); }, 'title.menu');

/* 2) 转世 / 幼年场景 */
step(() => G.game.changeScene('reincarnation'), 'reincarnation');
pump(20, 'reincarnation');
step(() => G.game.changeScene('childhood'), 'childhood');
pump(20, 'childhood');

/* 3) 造一份存档 → 镇 / 山 / 洞 */
const world = G.Data.generateWorld(12345, true);
const save = {
  life: 1, worldSeed: 12345, world: world,
  origin: 'test', six: { 勇猛: 8, 灵巧: 7, 体质: 9, 智力: 6, 魅力: 5 },
  linggen: { elems: ['木'], coef: { 木: 1.2 }, kind: '单灵根', stoneBonus: 0 },
  talents: [], skills: { 缠藤指: { lv: 2 }, 回春诀: { lv: 1 } }, skillEquip: ['缠藤指'],
  items: { 回春丹: 3, 妖囊: 2, 解封符: 1 },
  stone: 500, qi: 1200, po: 30,
  globalLevel: 5, age: 16, watch: 0, whispers: 0, escapeLeft: 3,
  quest: { step: 'free', flags: {} },
  scene: 'town', map: 'town', pos: null,
  chestsOpened: [], bossKilled: false,
  childhood: { randomDrawn: [], log: [] },
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
    const mp = G.MapGen.buildMap(save, m);

    /* 从出生点 BFS 求可达集（不走实心格） */
    const seen = {};
    const q = [[md.spawn.x, md.spawn.y]];
    seen[md.spawn.x + ',' + md.spawn.y] = true;
    while (q.length) {
      const c = q.shift();
      [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
        const nx = c[0] + d[0], ny = c[1] + d[1];
        if (nx < 0 || ny < 0 || nx >= mp.w || ny >= mp.h) return;
        const k = nx + ',' + ny;
        if (seen[k] || mp.solid[ny][nx]) return;
        seen[k] = true; q.push([nx, ny]);
      });
    }

    npcs.forEach(function (n) {
      if (!n.act) errors.push(`${m}: NPC ${n.id} 没有 act`);
      if (!n.name) errors.push(`${m}: NPC ${n.id} 没有名字`);
      if (!mp.solid[n.y][n.x]) {
        errors.push(`${m}: NPC ${n.id} 的格子 (${n.x},${n.y}) 不是实心 —— 玩家会从他身上走过去`);
      }
      const o = mp.interact[n.x + ',' + n.y];
      if (!o || o.type !== 'npc') errors.push(`${m}: NPC ${n.id} 的格子没有登记 npc 交互点`);
      else if (!o.npc || o.npc.id !== n.id) errors.push(`${m}: NPC ${n.id} 的交互点挂错了对象`);
      if (mp.ground[n.y][n.x].t === 'path') {
        errors.push(`${m}: NPC ${n.id} 站在路上 (${n.x},${n.y}) —— 单宽道路会被堵死`);
      }
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(function (d) {
        return !!seen[(n.x + d[0]) + ',' + (n.y + d[1])];
      });
      if (!near) errors.push(`${m}: NPC ${n.id} 从出生点走不到 —— 玩家永远说不上话`);
    });

    /* 交互必须真的开出对话（quest 取 free，避开"领赏后不留面板"的分支） */
    const s2 = JSON.parse(JSON.stringify(save));
    s2.quest = { step: 'free', flags: {} };
    s2.pos = null;
    G.game.save = s2;
    G.game.changeScene(m, { toSpawn: true });
    npcs.forEach(function (n) {
      const sc = G.game.scene;
      sc.overlay = null;
      let placed = false;
      [[0, 1, 'up'], [0, -1, 'down'], [1, 0, 'left'], [-1, 0, 'right']].forEach(function (d) {
        if (placed) return;
        const px = n.x + d[0], py = n.y + d[1];
        if (px < 0 || py < 0 || px >= sc.map.w || py >= sc.map.h) return;
        if (sc.map.solid[py][px]) return;
        s2.pos = { x: px, y: py }; sc.dir = d[2]; placed = true;
      });
      if (!placed) { errors.push(`${m}: NPC ${n.id} 四周没有可站位`); return; }
      sc._interact();
      if (!sc.overlay) errors.push(`${m}: 与 NPC ${n.id} 对话没有开出覆盖层`);
      sc.clearOverlay();
    });
  });
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

  /* 非任务 NPC（村民 / 刘掌柜）任何时候都不挂标记 */
  const keeper = (G.Data.maps.town_market.npcs || [])[0];
  if (keeper && G.scenes.town_market.npcMarkOf(keeper) !== null) {
    errors.push('任务标记错：刘掌柜不应挂标记');
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
  ['front', 'mid', 'back'].forEach(function (id) {
    const zone = (sc.map.md.zones || []).filter((z) => z.id === id)[0];
    if (!zone) { errors.push('缺少分区：' + id); return; }
    pairCount[id] = 0;
    for (let i = 0; i < 400; i++) {
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
    const rate = pairCount[id] / 400 * 100;
    const want = zone.pair || 0;
    if (Math.abs(rate - want) > 8) {
      errors.push(id + ' 区双只组概率偏离配置：实测 ' + rate.toFixed(1) + '%（应约 ' + want + '%）');
    }
  });
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
  if (info.n !== '炼气一段') errors.push('境界名异常：' + info.n);
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
  s.six = { 勇猛: 0, 灵巧: 0, 体质: 0, 智力: 0, 魅力: 0, 家境: 0 };
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
  const base = d.realm + d.skill + d.kill + d.age;
  if (d.total !== Math.round(base * 1.1)) {
    errors.push('善终修正未生效：' + d.total + ' 应 ' + Math.round(base * 1.1));
  }
  if (G.Player.deathCause({}).id !== 'war') errors.push('缺省死因应为战死');
}, 'xianli.aged');

/* 5b-3) 寿元上限与年龄推进（§3.2） */
step(function () {
  const P = G.Player;
  [['淬体', 1, 80], ['炼气', 10, 120], ['筑基', 19, 200], ['金丹', 28, 400], ['元婴', 37, 800]]
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
  s.age = 80;
  if (!P.isAged(s)) errors.push('淬体 80 岁应判为寿元尽');
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
  s.globalLevel = 1; s.age = 80; s.pos = null;
  G.game.meta = {
    lives: 1, xianli: 0, totalXianli: 0, perfusion: {}, pity: 0,
    achieve: {}, past: []
  };
  G.game.save = s;
  G.game.changeScene('field', { toSpawn: true });
}, 'aged.enter');
pump(10, 'aged.enter');
step(function () {
  if (G.game.sceneName !== 'death') {
    errors.push('寿元尽后应进入死亡结算，实为 ' + G.game.sceneName);
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

/* ---------- 报告 ---------- */
if (errors.length) {
  console.log('\n=== 冒烟测试发现问题 (' + errors.length + ') ===');
  errors.forEach((e) => console.log(' - ' + e));
  process.exit(1);
} else {
  console.log('冒烟测试通过：脚本加载 + 标题/转世/幼年/镇/山/洞/战斗/死亡/轮回殿 全场景渲染无异常。');
}
