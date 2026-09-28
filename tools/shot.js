/* 无头真实光栅化截图：用 @napi-rs/canvas 提供真 Canvas2D，在 Node 中把各场景渲染成 PNG。
   用法：node tools/shot.js [输出目录] [名字片段 ...]
     · 第一个参数若指向**已存在的目录**，就当作输出目录（保持旧用法不变）；
     · 其余参数当作截图名字过滤，只落盘名字里含该片段的图。
   依赖：NODE_PATH 指向已安装 @napi-rs/canvas 的 node_modules */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WWW = path.join(__dirname, '..', 'www');
/* 输出目录用"存在且是目录"来判定，避免和名字过滤器抢同一个位置：
   以前 argv[2] 一律当目录，于是 `shot.js 24_char` 会悄悄建出一个 ./24_char 目录。 */
const ARGS = process.argv.slice(2);
const HAS_DIR = ARGS.length && fs.existsSync(ARGS[0]) && fs.statSync(ARGS[0]).isDirectory();
const OUT = HAS_DIR ? path.resolve(ARGS[0]) : path.join(__dirname, '..', '_shots');
fs.mkdirSync(OUT, { recursive: true });

/* ---------- 真 Canvas 后端 ---------- */
let napi;
try {
  napi = require('@napi-rs/canvas');
} catch (e) {
  console.error('缺少 @napi-rs/canvas。请先安装并设置 NODE_PATH：');
  console.error('  cd D:/SoftWare/WorkBuddyAI/data/config/binaries/node/workspace && npm install @napi-rs/canvas');
  process.exit(2);
}
const { createCanvas, GlobalFonts } = napi;

/* 注册中文字体，让 "LXGW WenKai" / KaiTi 字体栈在无头环境也能落到楷体 */
const FONTS = [
  ['C:/Windows/Fonts/simkai.ttf', ['LXGW WenKai', 'KaiTi']],
  ['C:/Windows/Fonts/msyh.ttc', ['Microsoft YaHei']],
  ['C:/Windows/Fonts/NotoSansSC-VF.ttf', ['Noto Sans SC']],
  ['C:/Windows/Fonts/simsun.ttc', ['SimSun']]
];
for (const [p, names] of FONTS) {
  if (!fs.existsSync(p)) continue;
  for (const n of names) { try { GlobalFonts.registerFromPath(p, n); } catch (e) {} }
}

/* 直接用真 canvas 对象，并挂上 DOM 侧属性（style / 事件 / 尺寸查询）。
   不能用包装对象：@napi-rs/canvas 的 drawImage 只接受真 CanvasElement。 */
function makeRealCanvas(w, h) {
  const c = createCanvas(w || 300, h || 150);
  c.style = {};
  c.addEventListener = () => {};
  c.removeEventListener = () => {};
  c.getBoundingClientRect = () => ({ left: 0, top: 0, width: c.width, height: c.height });
  c.toBuffer = c.toBuffer.bind(c);
  return c;
}

/* ---------- DOM / BOM 桩 ---------- */
const gameCanvas = makeRealCanvas(1440, 816);
const doc = {
  createElement(tag) { return tag === 'canvas' ? makeRealCanvas(1, 1) : { style: {}, appendChild() {}, addEventListener() {} }; },
  getElementById(id) { return id === 'game' ? gameCanvas : null; },
  addEventListener() {}
};

let rafQueue = [];
const sandbox = {
  console, document: doc, window: null,
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
  devicePixelRatio: 3
};
sandbox.window = sandbox;
sandbox.window.innerWidth = 1440;
sandbox.window.innerHeight = 816;
sandbox.window.devicePixelRatio = 3;
sandbox.window.addEventListener = () => {};
sandbox.window.removeEventListener = () => {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

/* ---------- 加载脚本（顺序与 index.html 一致） ---------- */
const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
for (const rel of srcs) {
  const p = path.join(WWW, rel);
  if (!fs.existsSync(p)) { console.error('缺失脚本：' + rel); process.exit(1); }
  vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: rel });
}

/* ---------- 驱动 ---------- */
const errors = [];
/* 虚拟时钟跨 pump 调用单调递增（与 tools/smoke.js 同理）：
   每次从 performance.now() 重新起算会让第一帧 now - game._last 变成负数，
   dt 为负时所有 `-= dt` 的计时器倒着走，截图就会拍到"动画没播完/播反了"的中间态。 */
let vclock = sandbox.performance.now();
function pump(frames) {
  for (let i = 0; i < frames; i++) {
    const q = rafQueue; rafQueue = [];
    if (!q.length) break;
    vclock += 16.7;
    for (const fn of q) {
      try { fn(vclock); } catch (e) { errors.push('帧异常: ' + e.stack.split('\n').slice(0, 3).join(' | ')); return; }
    }
  }
}
function step(fn, label) {
  try { fn(); } catch (e) { errors.push('[' + label + '] ' + e.message); }
}
let n = 0;
/* 用法：node tools/shot.js [名字片段 ...]
   带参数时只落盘名字里含该片段的截图 —— 但**所有帧照常推进**：
   后面的截图依赖前面的场景状态，跳过 pump 会让状态对不上、拍到错的画面。 */
const ONLY = (HAS_DIR ? ARGS.slice(1) : ARGS).filter((a) => !a.startsWith('-'));
/* draw 是可选的后置钩子：在 pump 之后、落盘之前直接往画布上补画东西。
   用在"场景本身画不出"的对照图（例：四向精灵并排 + 头线参考线）。 */
function shot(name, frames, draw) {
  pump(frames || 6);
  if (ONLY.length && !ONLY.some((p) => name.indexOf(p) >= 0)) return;
  if (draw) {
    try { draw(G.game.ctx, G.game); }
    catch (e) { errors.push('[' + name + '.draw] ' + e.message); }
  }
  log('  … ' + name);
  const file = path.join(OUT, name + '.png');
  const _buf = gameCanvas.toBuffer('image/png');
  fs.writeFileSync(file, _buf);
  n++;
  log('  · ' + name + '.png');
}

const G = sandbox.G;
if (!G) { console.error('G 未初始化'); process.exit(1); }

/* 同步落盘日志：进程被 SIGTERM 时 stdout 缓冲会丢，改用文件定位卡点 */
const LOGFILE = path.join(OUT, '_shot.log');
try { fs.writeFileSync(LOGFILE, ''); } catch (e) {}
function log(msg) { try { fs.appendFileSync(LOGFILE, msg + '\n'); } catch (e) {} console.log(msg); }

log('渲染截图 → ' + OUT);

/* ---------- 预加载素材层 ----------
   Assets.load() 走的是 fetch + new Image().src，两个在无头环境都跑不了（而且是异步的，
   本脚本是同步流程，promise 回调根本轮不上）。所以这里用 loadImage 直接把
   www/assets/manifest.json 里的图登记进去 —— 截图看到的就是"装了素材"的真实画面。 */
async function preloadAssets() {
  const mfPath = path.join(WWW, 'assets', 'manifest.json');
  if (!fs.existsSync(mfPath)) { log('（无 manifest.json，全部走程序化画面）'); return; }
  const mf = JSON.parse(fs.readFileSync(mfPath, 'utf8'));
  let ok = 0, miss = 0;
  for (const key of Object.keys(mf)) {
    if (typeof mf[key] !== 'string') continue;
    const p = path.join(WWW, mf[key]);
    if (!fs.existsSync(p)) { miss++; continue; }
    try { G.Assets.register(key, await napi.loadImage(p)); ok++; }
    catch (e) { errors.push('素材加载失败 ' + key + '：' + e.message); }
  }
  log('素材层：登记 ' + ok + ' 个键' + (miss ? '（缺文件 ' + miss + ' 个）' : ''));
}

(async function main() {
  await preloadAssets();

/* 1) 标题 */
step(() => G.game.start(), 'start');
shot('01_title', 40);
step(() => G.scenes.title._openAbout(), 'title.about');
shot('02_title_about', 10);
step(() => { G.scenes.title.about = false; G.scenes.title._buildMenu(); }, 'title.menu');

/* 1b) 难度选择（新游戏首入：标题 → 难度 → 转世） */
step(() => G.game.changeScene('difficulty'), 'difficulty');
shot('02c_difficulty', 12);

/* 2) 转世 */
step(() => G.game.changeScene('reincarnation'), 'reincarnation');
shot('03_reincarnation', 30);

/* 3) 世界存档 */
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

/* 3b) HUD 走查：满血 / 濒死 两态各留一张。
   HUD 是这轮重做的重点（圆头像 + 境界·第N世 + 气血/修为双条 + 资源格），
   单独留档才好做视觉回归 —— 旧版 155/155 压在血条上的问题就在这两张里看得见。 */
step(() => { save.pos = null; G.game.changeScene('town', { toSpawn: true }); }, 'hud.enter');
shot('04_hud', 24);

/* 悬浮说明实拍（v0.11.4）：tooltip 走的是"帧内登记 → 帧末统一画"，
   所以**必须先注入 G.Input.mouse 再 pump**（shot 的 draw 钩子在 pump 之后跑，来不及）。
   触屏上 G.Input.mouse 恒为 null → 提示条本就不出现，这两帧是桌面端专有形态。 */
step(() => { G.Input.mouse = { x: 445, y: 35 }; }, 'hud.tip');   /* 仙晶格中心 */
shot('04b_hud_tip', 2);
step(() => { G.Input.mouse = null; }, 'hud.tip.off');
shot('04c_hud_tip_off', 2);
step(() => { save.hp = Math.max(1, Math.round(200 * 0.12)); }, 'hud.low');
shot('04b_hud_lowhp', 24);
step(() => { save.hp = 200; }, 'hud.restore');

/* 4) 镇 / 山 / 洞 */
[['05_town', 'town'], ['07_field', 'field'], ['09_cave', 'cave']].forEach(function (m) {
  step(() => { save.pos = null; G.game.changeScene(m[1], { toSpawn: true }); }, 'scene:' + m[1]);
  shot(m[0], 24);
  /* 屏幕中央行走帧（v0.54.0）：把主角放到视野中部再向右驱动，
     验收真实行走帧（非纸片人），避免 _walk 那帧人在视口边缘。 */
  if (m[1] === 'field') {
    step(() => { save.pos = { x: 14, y: 9 }; G.game.changeScene('field'); }, 'field.center');
    shot('07c0', 16);
    step(() => {
      const sc2 = G.game.scene;
      sc2._heldDir = () => 'right';
      for (let i = 0; i < 13; i++) sc2.update(0.05);
    }, 'field.walkcenter');
    shot('07c_field_walkcenter', 4);
    step(() => { G.game.scene._heldDir = function () { return null; }; }, 'field.walkstop');
  }
  /* 建筑特写（v0.16.0）：把相机推到镇北的建筑群 —— 出生点在镇南，
     建筑全被顶栏挡住，验收时看不到"建筑换图 + 匾额"的实际效果。
     ⚠️ 必须**先设 pos 再进场景**（`toSpawn` 会把它覆盖回出生点）。 */
  if (m[1] === 'town') {
    /* ⚠️ save.pos 是**格坐标**不是像素（explore._px() 才乘 16）—— 写像素的话
       会被当成格坐标，角色直接跑到地图外，相机就贴着上沿不走了。 */
    step(() => { save.pos = { x: 18, y: 11 }; G.game.changeScene('town'); }, 'town.houses');
    shot('05a_town_houses', 40);
    /* 建筑悬浮名签（v0.54.0）：鼠标落在药铺 footprint 上，应出「药铺 + 买卖丹药…」富卡。
       站位(18,11)→相机约(48,40)，药铺格(14..19,6..10)屏中约(224,96)。 */
    step(() => { G.Input.mouse = { x: 224, y: 96 }; }, 'town.structtip');
    shot('05b_town_structtip', 40);
    step(() => { G.Input.mouse = null; }, 'town.structtip.off');
    /* 宗门山门特写（v0.42.0）：青溪剑阁的山门在南侧空场（x6..11, y15..17）。
       ⚠️ 站位要选在**山门的左边**（x=4）—— 相机把山门推到画面右半边，
          否则它会落在左侧任务追踪栏底下（那一片恒定被盖住）。 */
    step(() => { save.pos = { x: 4, y: 18 }; G.game.changeScene('town'); }, 'town.sectgate');
    shot('05c_town_sectgate', 40);
    step(() => { save.pos = null; G.game.changeScene('town', { toSpawn: true }); }, 'town.back');
  }
  /* 赤牙洞洞口特写（v0.42.0）：`A.gate` 改成等比内含之后要复看 —— 洞口是 4×2 的框，
     素材是 4:3，等比之后会变窄；这一帧就是用来盯"有没有变得太小"。 */
  if (m[1] === 'field') {
    step(() => { save.pos = { x: 25, y: 7 }; G.game.changeScene('field'); }, 'field.cave');
    shot('07b_field_cave', 30);
    step(() => { save.pos = null; G.game.changeScene('field', { toSpawn: true }); }, 'field.back');
  }
  const sc = G.game.scene;
  if (m[1] !== 'cave') {
    step(() => G.Overlays.openChar(sc), 'overlay:' + m[1]);
    shot(m[0] + 'b', 8);
    step(() => sc.clearOverlay(), 'overlay.close');
  }
  step(() => {
    /* ⚠️ `_heldDir` 是场景**自身属性**（不是原型方法），覆写后会一直留在场景上 ——
       本意只是"驱动一次走路"，但收尾不还原的话，之后每次进这张图角色都自己往下走。
       镇南出口离出生点只有两格 → 拍别的帧时会拍到"人已经走到翠微山了"。
       所以这里用完**立刻还原**（场景是单例，跨帧复用）。 */
    const orig = sc._heldDir;
    sc._heldDir = () => 'down';
    for (let i = 0; i < 40; i++) sc.update(0.05);
    sc.onTap({ x: 240, y: 140 });
    for (let i = 0; i < 60; i++) sc.update(0.05);
    sc._interact();
    sc._heldDir = orig;
  }, 'walk:' + m[1]);
  shot(m[0] + '_walk', 10);
});

/* 4a) 追踪栏开合两态（v0.12.0 改左缘收缩，参考《烟雨江湖》）。
   收起态只有一条 20px 竖标贴左缘 —— 顺便当"收起后地图依然完整可见"的存档。 */
step(() => {
  save.pos = null;
  G.game.changeScene('town', { toSpawn: true });
  G.game.scene.trackOpen = true;
}, 'track.open');
shot('05m_track_open', 20);
step(() => {
  G.game.scene.trackOpen = false;
  G.game.scene._padButtons();
}, 'track.closed');
shot('05n_track_closed', 20);
step(() => { G.game.scene.trackOpen = true; G.game.scene._padButtons(); }, 'track.restore');

/* 4a2) 追踪栏含支线（v0.72.0，用户口径「主支线追踪可完全缩至左侧」）：
   接两条支线，其中一条置为"可交"（step2）看金色实心点与排序（可交排前）。
   **故意选 m0-1** —— 它有路引、目标文案两行，是主线段最占位的形态；
   再加两条支线就是"最密版式"，专门验不越界（面板底 78+161=239 < 底栏 244）。 */
step(() => {
  const s = G.game.save;
  s.side = s.side || {};
  const SQ = G.Data.sideQuests.list;
  if (SQ[0]) s.side[SQ[0].id] = 1;
  if (SQ[1]) s.side[SQ[1].id] = 2;
  s.quest = { step: 'm0-1', flags: {} };
  save.pos = null;
  G.game.changeScene('town', { toSpawn: true });
  G.game.scene.trackOpen = true;
  G.game.scene._padButtons();
  clearStoryModal();
}, 'track.sides');
shot('05o_track_sides', 20);
step(() => {
  const s = G.game.save; s.side = {};
  s.quest = { step: 'm0-5', flags: {} };
  G.game.scene._padButtons();
}, 'track.sides.reset');

/* 4b) 四向精灵对照（v0.11.2 修「侧身比前后高一头」）：
   场景里四向不会同框，所以直接铺一张对照图 —— 四向 × 三帧并排，画头线与脚底线。
   以后改 sprite 素材/裁切算法，肉眼扫一眼这张就知道有没有再错位。 */
shot('05c_hero_dirs', 4, (x) => {
  x.imageSmoothingEnabled = true;
  if ('imageSmoothingQuality' in x) x.imageSmoothingQuality = 'high';
  x.fillStyle = '#161b26'; x.fillRect(0, 0, 480, 272);
  const HW = G.Sprites.HERO_W, HH = G.Sprites.HERO_H;
  const dirs = ['down', 'left', 'right', 'up'];
  const cellW = 480 / dirs.length, baseY = 206;
  /* 参考线：头线（青）与脚底线（琥珀）——四向都该压在线上 */
  const line = (yy, c) => {
    x.strokeStyle = c; x.lineWidth = 1;
    x.beginPath(); x.moveTo(0, yy + 0.5); x.lineTo(480, yy + 0.5); x.stroke();
  };
  line(baseY - HH + 11.5, 'rgba(96,214,182,0.75)');   /* 头线：HEAD 源像素 → dest 11.5 */
  line(baseY - 0.5, 'rgba(226,178,86,0.75)');          /* 脚底线 */
  dirs.forEach((d, di) => {
    const cx = cellW * di + cellW / 2;
    [0, 1, 2].forEach((st) => {
      const spr = G.Art.heroSprite(d, st, G.Sprites.HERO_PAL);
      x.drawImage(spr, Math.round(cx - HW * 1.5 - 1 + st * (HW + 1)),
        Math.round(baseY - HH), HW, HH);
    });
    G.UI.textOut(x, { x: cx, y: 240 }, d, 12, '#c9d2e6', 'center');
  });
});

/* 4c) M1 主线（v0.11.3）：探子登场 / 沈伯辨丹 / 抉择卡 / 刘记货架。
   每帧都用**克隆存档**并走真实交互路径（不是直接把 overlay 字符串塞进去）——
   塞字符串只能证明渲染器画得出，证明不了"这条线真的接上了"。 */
function m1Save(quest, flags, mutate) {
  const s = JSON.parse(JSON.stringify(save));
  s.quest = { step: quest, flags: flags || {} };
  s.pos = null;
  if (mutate) mutate(s);
  G.game.save = s;
  /* 每帧前清掉残留 toast：toast 落在 y≈201..230，正好压住对话框/抉择卡底部的按钮。
     上一帧的提示留到这一帧，拍出来的就是"按钮被盖住"的假象。
     （真机上这条重叠确实存在，见闭环报告 G32；截图不该再叠一层干扰。） */
  G.game.toasts.length = 0;
  return s;
}
/* 走到某个 NPC 面前按交互（与 smoke 的 npc.contract 同一套走位约定） */
function faceNpc(sc, npc, s) {
  [[0, 1, 'up'], [0, -1, 'down'], [1, 0, 'left'], [-1, 0, 'right']].some((d) => {
    const px = npc.x + d[0], py = npc.y + d[1];
    if (px < 0 || py < 0 || px >= sc.map.w || py >= sc.map.h) return false;
    if (sc.map.solid[py][px]) return false;
    s.pos = { x: px, y: py }; sc.dir = d[2]; return true;
  });
  sc._interact();
}

step(() => {
  const s = m1Save('m1-2', {}, (o) => { o.globalLevel = 14; });
  G.game.changeScene('town');
  s.pos = { x: 25, y: 16 };            /* 站在探子（25,15）正下方 */
  G.scenes.town._fixPos(s);
}, 'm1.probe');
shot('05d_town_probe', 20);

step(() => {
  const s = m1Save('m1-1', {}, (o) => { o.bossKilled = true; o.globalLevel = 14; });
  G.game.changeScene('town_shop', { toSpawn: true });
  const sc = G.game.scene;
  faceNpc(sc, (G.Data.maps.town_shop.npcs || []).filter((n) => n.act === 'shenbo')[0], s);
}, 'm1.1.dialog');
shot('05e_m1_dialog', 8);

step(() => {
  m1Save('m1-2', { probeWin: true });
  /* 回镇时 hooks.enter 会自动把抉择卡摆上来 —— 这正是要验的那一步 */
  G.game.changeScene('town', { toSpawn: true });
}, 'm1.choice');
shot('05f_choice1', 8);

step(() => {
  const s = m1Save('m1-4', {}, (o) => {
    o.globalLevel = 15; o.stone = 3000; o.items = { 妖丹: 3, 回春丹: 2 };
  });
  G.game.changeScene('town_market', { toSpawn: true });
  faceNpc(G.game.scene, (G.Data.maps.town_market.npcs || []).filter((n) => n.act === 'market')[0], s);
}, 'm1.market');
shot('05g_market_m1', 8);

/* 上面几帧把 G.game.save 换成了克隆 → 后面所有帧都要回到基准存档 */
step(() => { G.game.save = save; }, 'm1.restore');

/* 4d) M1 血夜（v0.11.5）：入夜 → 据点 → 抉择 2 → 血面 → 遗言。
   同样走真实交互路径；血面那帧直接以 script:'xuemian' 起战斗（等同抉择 2 的 onClick 效果）。 */
step(() => {
  const s = m1Save('m1-5', { foundPill: true }, (o) => {
    o.globalLevel = 18; o.maxGlobalLevel = 18; o.items = { 筑基丹: 1 };
  });
  G.game.changeScene('town_shop', { toSpawn: true });
  faceNpc(G.game.scene, (G.Data.maps.town_shop.npcs || []).filter((n) => n.act === 'shenbo')[0], s);
}, 'm1.night');
shot('05h_town_night', 8);

/* 血夜红雾（压暗演出，1.2s 后自动切图）。泵 62 帧 ≈ 1.04s → night≈0.16、k≈0.87，
   即**接近最浓的一刻**（再往后就切图了）。这是只在剧情里出现的渲染路径
   （常规帧永远不触发），必须实拍一张，否则"哑弹"没人发现。 */
step(() => {
  m1Save('m1-5', { foundPill: true });
  G.game.changeScene('town', { toSpawn: true });
  G.game.scene.startNight({
    to: 'bloodhall',
    spawn: { x: G.Data.maps.bloodhall.spawn.x, y: G.Data.maps.bloodhall.spawn.y }
  });
}, 'm1.veil');
shot('05h2_town_veil', 62);

step(() => {
  m1Save('m1-5', { foundPill: true }, (o) => {
    o.globalLevel = 18; o.maxGlobalLevel = 18; o.items = { 筑基丹: 1 };
  });
  G.game.changeScene('bloodhall', { toSpawn: true });
}, 'm1.bloodhall');
shot('05i_bloodhall', 20);

step(() => {
  const s = m1Save('m1-5', {});
  const sc = G.game.scene;
  const bsp = (G.Data.maps.bloodhall.special || []).filter((sp) => sp.kind === 'boss')[0];
  s.pos = { x: bsp.x, y: bsp.y + 2 }; sc.dir = 'up';
  sc._interact();
}, 'm1.choice2');
shot('05j_choice2', 8);

step(() => {
  m1Save('m1-5', {});
  G.game.changeScene('battle', { script: 'xuemian', mapId: 'bloodhall', after: 'bloodhall' });
}, 'm1.xuemian');
shot('05k_xuemian', 30);

step(() => {
  m1Save('m1-6', { bloodNight: true, elderDead: true }, (o) => { o.globalLevel = 18; });
  G.game.changeScene('bloodhall', { toSpawn: true });
}, 'm1.farewell');
shot('05l_farewell', 8);

/* 上面几帧又把 G.game.save 换成了克隆 → 后面所有帧都要回到基准存档 */
step(() => { G.game.save = save; }, 'm1.restore2');

/* 5) 战斗：普通遭遇（含功法 / 道具 / 法宝常显） */
step(() => {
  /* 已装备法宝（v0.70.0）：武器+防具各一，**饰品特意留空** ——
     正好验证空槽虚位（三格定长，缺哪格一眼看得出）。 */
  save.equip = { weapon: 'eq_qingfeng', armor: 'eq_bujia', accessory: null };
  save.pos = null;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('赤炎狼', 6, '苍鬃狼'), mapId: 'field' });
}, 'battle.enter');
shot('11_battle', 30);
/* 战斗打击特效（v0.30.0）：刀光 + 属性色爆发 */
step(() => {
  const b = G.game.scene;
  b._fxs = [];
  b._fx('slash', 'E0', { col: '#e8f0ff' });
  b._fx('burst', 'E0', { col: '#ff8844' });
  b._fxs[0].t = 0.06; b._fxs[1].t = 0.16;
  b._tickFx(0);
}, 'battle.fx');
shot('11b_battle_fx', 2);
/* 战利品浮层（v0.17.0）：**直接压两条**而不是真打赢 —— 真打赢会切场景，
   后面那一串战斗帧全部崩掉（本轮踩过）。浮层只活 3 秒，所以紧接着就拍。 */
step(() => { G.game.loot('战利品：灵气 +120　灵力 +9　灵石 +36'); G.game.loot('拾得「凡品功法碎片」×2', true); }, 'battle.loot');
shot('11b_battle_loot', 4);
step(() => { G.game.lootFeed.length = 0; }, 'battle.loot.clear');
step(() => G.game.scene._cmd('功法'), 'battle.skill');
shot('12_battle_skill', 8);
step(() => G.game.scene._cmd('道具'), 'battle.item');
shot('13_battle_item', 8);
step(() => G.game.scene._cmd('攻击'), 'battle.attack');
shot('14_battle_attack', 60);
step(() => G.game.scene._cmd('逃跑'), 'battle.flee');
shot('15_battle_flee', 60);
/* v0.69.0 取消独立防御：指令区改为 5 个（3+2）。补拍一张收起态，
   确认新版式不空不挤（原 15_battle_guard 已删 —— 那个按钮不存在了）。 */
step(() => {
  const b = G.game.scene;
  if (b._buildCommand) b._buildCommand();
}, 'battle.cmd5');
shot('15_battle_cmd5', 6);

/* 5b) 蓄力预告（敌方蓄力技：必须提前一回合提示） */
step(() => {
  const b = G.game.scene;
  b.chargeMark.E0 = '烈焰冲袭';
  b._log('苍鬃狼 气机暴涨，正在蓄力「烈焰冲袭」！');
  b._log('—— 下回合务必守御或速攻。');
}, 'battle.charge');
shot('15b_battle_charge', 8);

/* 5c) 状态系统：中毒/灼烧/麻痹 角标 + 后手提示 */
step(() => {
  const b = G.game.scene;
  b.p.statuses = { 毒: 3, 烧: 2 };
  b.es[0].statuses = { 麻: 3, 封: 2 };
  b.p.spd = 8; b.es[0].spd = 22;
  b._log('陆尘 受「毒」侵蚀，损失 12。');
  b._log('苍鬃狼 陷入「麻」！');
}, 'battle.status');
shot('15c_battle_status', 8);

/* 5d) 多敌：双只组布局 + 选目标浮层 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 6; s.hp = 999;
  s.skills = { 缠藤指: { lv: 2 } };
  G.game.save = s;
  G.game.changeScene('battle', {
    enemies: [
      G.Data.makeEnemy('赤炎狼', 6, '苍鬃狼'),
      G.Data.makeEnemy('青纹蛇', 5, '青纹蛇')
    ], mapId: 'field'
  });
}, 'battle.multi');
shot('15d_battle_multi', 30);
step(() => G.game.scene._cmd('攻击'), 'battle.multi.target');
shot('15e_battle_target', 8);

/* 5d-2) 三敌：完整斜线站位 + 「前排」功法的行过滤浮层 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 10; s.hp = 9999;
  s.skills = { 缠藤指: { lv: 2 }, 铁布衫: { lv: 1 } };
  G.game.save = s;
  G.game.changeScene('battle', {
    enemies: [
      G.Data.makeEnemy('赤炎狼', 7, '苍鬃狼'),
      G.Data.makeEnemy('青纹蛇', 6, '碧鳞蛇'),
      G.Data.makeEnemy('树精', 6, '古木')
    ], mapId: 'field'
  });
}, 'battle.multi3');
shot('15f_battle_multi3', 30);
step(() => {
  const b = G.game.scene;
  b._cmd('功法');
  if (b.buttons[0]) b.buttons[0].onClick();
}, 'battle.multi3.row');
shot('15g_battle_row', 8);

/* 5e) 狼王召唤群狼后的重排（Boss 居后 + 两只小兵在前） */
step(() => {
  G.game.save = JSON.parse(JSON.stringify(save));
  G.game.save.globalLevel = 12;
  G.game.changeScene('battle', { script: 'wolfKing', mapId: 'cave' });
}, 'battle.summon.enter');
pump(20);
step(() => {
  const b = G.game.scene;
  b.es[0].hp = Math.round(b.es[0].maxhp * 0.45);
  b._bossPhase(b.es[0]);
}, 'battle.summon');
shot('18c_battle_summon', 20);

/* M1：血煞教三敌（程序化立绘验收，设计 M1 v1.0 §5.3）——
   本轮只上了数据与立绘，所以直接造单位进战斗，验证 beastResolve 真的取到新图。 */
[['血煞教徒', '44_battle_cultist'], ['血蝠', '45_battle_bloodbat']].forEach((it) => {
  step(() => {
    G.game.save = JSON.parse(JSON.stringify(save));
    G.game.changeScene('battle', { enemy: G.Data.makeEnemy(it[0], 14, it[0]), mapId: 'cave' });
  }, 'battle.' + it[0]);
  shot(it[1], 30);
});

/* 5f) 战斗背景主题巡览（v0.12.0）：八张主题各拍一张。
   背景按战场地形/界域自动选主题（battle.js: _bgKey），这里用 params.bg 强制指定，
   一张一张肉眼比对 —— 光跑契约看不出"两个主题长得一样"或"某主题糊成一片"。
   ⚠️ 背景是缓存 + 缓存键带主题名，所以换主题必须**重新 changeScene**（走 enter 清缓存），
      不能只改 params.bg 后 pump —— 那样拍到的还是上一张。 */
['night', 'town', 'cave', 'blood', 'hall', 'ling', 'xian', 'dao'].forEach((bg) => {
  step(() => {
    G.game.save = JSON.parse(JSON.stringify(save));
    G.game.changeScene('battle', {
      enemy: G.Data.makeEnemy('赤炎狼', 6, '苍鬃狼'), mapId: 'field', bg: bg
    });
  }, 'bgtheme.' + bg);
  shot('17bg_' + bg, 14);
});
step(() => { G.game.save = JSON.parse(JSON.stringify(save)); }, 'bgtheme.restore');
step(() => {
  G.game.save = JSON.parse(JSON.stringify(save));
  G.game.changeScene('battle', { enemy: G.Data.makeXuemian(), mapId: 'cave' });
}, 'battle.xuemian');
shot('46_battle_xuemian', 30);

/* 6) 剧情战：杀手 / 狼王 / 心魔 */
step(() => {
  G.game.save = JSON.parse(JSON.stringify(save));
  G.game.changeScene('battle', { script: 'killer', mapId: 'field' });
}, 'battle.killer');
shot('16_battle_killer', 30);
step(() => G.game.scene._cmd('攻击'), 'killer.attack');
shot('17_battle_killer_run', 80);

step(() => {
  G.game.save = JSON.parse(JSON.stringify(save));
  G.game.changeScene('battle', { script: 'wolfKing', mapId: 'cave' });
}, 'battle.boss');
shot('18_battle_boss', 30);

step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.globalLevel = 9; s.qi = 3240; s.items = { 淬体突破丹: 1 };
  s.quest = { step: 'm0-4', flags: {} };
  s.skills = { 缠藤指: { lv: 3 }, 铁布衫: { lv: 1 }, 吐纳术: { lv: 1 } };
  G.game.save = s;
  G.Player.startBigBreak(s);
  G.game.changeScene('battle', { script: 'heartDemon', mapId: 'town' });
}, 'battle.heartDemon');
shot('18b_battle_heartdemon', 30);

/* 6b) 室内地图：镇内三栋房子 + 山神庙（v0.4 起房屋可以走进去探索） */
/* 点门 → 走进室内地图 */
function enterDoor(doorId) {
  const sc = G.game.scene;
  let hk = null;
  Object.keys(sc.map.interact).forEach((k) => {
    const o = sc.map.interact[k];
    if (o.type === 'door' && o.id === doorId) hk = hk || k;
  });
  if (!hk) { errors.push('找不到门：' + doorId); return; }
  const xy = hk.split(',').map(Number);
  sc.overlay = null; sc.dir = 'up';
  G.game.save.pos = { x: xy[0], y: xy[1] + 1 };
  sc._interact();
}
/* 走到某件家具前交互 */
function interactFurn(act) {
  const sc = G.game.scene;
  let best = null;
  Object.keys(sc.map.interact).forEach((k) => {
    const o = sc.map.interact[k];
    if (o.type !== 'furn' || o.act !== act || best) return;
    const xy = k.split(',').map(Number);
    const py = xy[1] + 1;
    if (!sc.map.solid[py] || sc.map.solid[py][xy[0]]) return;
    best = { x: xy[0], y: py };
  });
  if (!best) { errors.push('找不到家具动作：' + act); return; }
  sc.overlay = null; sc.dir = 'up';
  G.game.save.pos = best;
  sc._interact();
}

step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.quest = { step: 'm0-3', flags: {} };
  s.qi = 2680; s.po = 160; s.stone = 420;
  s.skills = { 缠藤指: { lv: 3 }, 铁布衫: { lv: 1 }, 吐纳术: { lv: 1 }, 回春诀: { lv: 2 } };
  s.globalLevel = 5;
  G.game.save = s;
  s.pos = null;
  G.game.changeScene('town', { toSpawn: true });
}, 'town.cult.enter');
pump(20);
step(() => enterDoor('home'), 'town.home');
shot('21_town_home', 10);
/* 走到逆命珠前 → 珠内梦境（注意：'vessel' 是家具 id，act 是 'cult'） */
step(() => interactFurn('cult'), 'town.dream');
shot('22_cult_dream', 8);
step(() => G.game.scene.buttons[0].onClick(), 'town.wake');
shot('23_cult', 8);

/* 药铺 / 杂货铺 / 山神庙各一张：验证家具美术、地板纹理与室内暖光 */
step(() => { G.game.changeScene('town_shop', { toSpawn: true }); }, 'shot.shop');
shot('21b_town_shop', 10);
step(() => { G.game.changeScene('town_market', { toSpawn: true }); }, 'shot.market');
shot('21c_town_market', 10);
step(() => { G.game.changeScene('field_temple', { toSpawn: true }); }, 'shot.temple');
shot('21d_field_temple', 10);

/* 6b-2) 站桩 NPC：头顶任务标记 + 对话立绘（探图 v0.2 §NPC） */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.quest = { step: 'm0-1', flags: {} };        /* 沈伯头顶应挂「！」 */
  s.stone = 300;
  G.game.save = s;
  G.game.changeScene('town_shop', { toSpawn: true });
}, 'npc.mark.enter');
shot('21e_npc_mark', 10);
step(() => {
  const sc = G.game.scene;
  const n = (sc.map.npcs || []).filter((x) => x.act === 'shenbo')[0];
  sc.overlay = null;
  G.game.save.pos = { x: n.x, y: n.y + 2 };
  sc.dir = 'up';
  sc._interact();
}, 'npc.shenbo.talk');
shot('21f_npc_dialog', 10);
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.quest = { step: 'free', flags: {} };
  G.game.save = s;
  G.game.changeScene('town', { toSpawn: true });
}, 'npc.town.enter');
step(() => {
  const sc = G.game.scene;
  const n = (sc.map.npcs || [])[0];
  sc.overlay = null;
  G.game.save.pos = { x: n.x, y: n.y + 1 };
  sc.dir = 'up';
  sc._interact();
}, 'npc.chat');
shot('21g_npc_chat', 10);

/* 6c) 角色面板：寿元行（轮回 v0.4 §3.2）—— 含长数值「700/800」与转红告警 */
step(() => {
  const sc = G.game.scene;
  G.game.save.age = 46;
  G.game.save.maxGlobalLevel = 5;
  /* 称号行（缺口 G15）：角色面板右栏底部应显示 meta.titles */
  G.game.meta = G.game.meta || {};
  G.game.meta.titles = ['破狱·凡尘', '破狱·灵渊'];
  sc.clearOverlay();
  G.Overlays.openChar(sc);
}, 'town.char');
shot('24_char', 8);
step(() => {
  const sc = G.game.scene;
  G.game.save.globalLevel = 37;      /* 元婴一段：寿元上限 800 */
  G.game.save.age = 700;             /* 逼近上限 → 转红 */
  sc.clearOverlay();
  G.Overlays.openChar(sc);
}, 'town.char.aged');
shot('24b_char_aged', 8);

/* 7) 死亡结算 / 轮回殿 */
step(() => {
  G.game.meta = {
    lives: 2, xianli: 260, totalXianli: 412,
    perfusion: { body: 2, qi: 1, po: 0, stone: 3, rescue: 0 },
    pity: 0, heaven: { talks: 0, watchTotal: 0, memory: [], karma: [] },
    titles: ['破狱·凡尘'],
    past: [
      { life: 1, age: 27, realm: '炼气三段', level: 12, atk: 38, maxhp: 340, stone: 210, boss: false, xianli: 152, at: Date.now() },
      { life: 2, age: 34, realm: '筑基一段', level: 19, atk: 52, maxhp: 480, stone: 480, boss: true, xianli: 260, at: Date.now() }
    ]
  };
  G.game.save = JSON.parse(JSON.stringify(save));
  G.game.save.globalLevel = 22; G.game.save.age = 41;
  G.game.save.stone = 640; G.game.save.bossKilled = true;
  G.game.save.bossKills = 1;
  /* 走马灯数据（§3.3）：让一世大事记在结算页可见 */
  G.game.save.chronicle = [
    { id: 'birth', t: 16, s: '入世落霞镇' },
    { id: 'vessel', t: 16, s: '山神庙得逆命珠' },
    { id: 'dream', t: 16, s: '珠内空间，梦境点化' },
    { id: 'break:10', t: 24, s: '破入炼气一段' },
    { id: 'heartDemon', t: 24, s: '问心破魔，入炼气一段' },
    { id: 'wolfKing', t: 31, s: '手刃赤炎狼王' },
    { id: 'break:19', t: 38, s: '破入筑基一段' }
  ];
  G.game.changeScene('death');
}, 'death');
shot('19_death', 30);
step(() => G.game.changeScene('hall'), 'hall');
shot('20_hall', 30);

/* 8) v0.7.0：区域可见性 + 副本入口面板 + 飞升台
   —— 裂隙与界门此前**只登记不绘制**，这几张图就是"它们真的画出来了"的肉眼凭据。 */
step(() => {
  /* death 场景会把当世档清掉（G.game.save = null），所以每一步都要重建 */
  const s = JSON.parse(JSON.stringify(save));
  G.game.save = s;
  s.worldSeed = 20260926;
  s.entrances = { fan: [], ling: [], xian: [], dao: [] };
  G.game.meta = {
    lives: 3, xianli: 200, totalXianli: 900,
    perfusion: { body: 2, qi: 0, po: 0, stone: 0, rescue: 0 },
    achieve: {}, past: [], titles: ['破狱·凡尘'], hellCleared: { fan: true },
    progress: { difficulty: 'normal', activeWorld: 'fan', nextWorld: null,
      worlds: { fan: true, ling: false, xian: false, dao: false },
      worldDiff: { fan: 'normal', ling: 'normal', xian: 'normal', dao: 'normal' },
      daoKey: false, daoShards: { fan: false, ling: false, xian: false } }
  };
  s.dungeonSet = G.Data.dungeons.rollSet(s.worldSeed + ':set');
  s.dungeonSlot = 2;
  s.dungeonRun = null;
  s.entrances.fan = G.Data.regions.rollEntrances('fan', s.worldSeed, s.dungeonSet);
  const rid = s.entrances.fan[0].region;
  G.RegionGen.sceneFor(rid);
  G.game.changeScene(rid, { toSpawn: true });
  const md = G.Data.maps[rid];
  const sp = (md.special || []).filter((x) => x.kind === 'entrance')[0];
  if (sp) s.pos = { x: sp.x, y: sp.y + 1 };      /* 站到裂隙旁边，让它进视口 */
}, 'region.rift');
shot('25_region_rift', 14);

step(() => {
  const s = JSON.parse(JSON.stringify(save));
  G.game.save = s;
  const gr = G.Data.regions.of('fan').filter((r) => r.gate && !r.map)[0];
  G.RegionGen.sceneFor(gr.id);
  G.game.changeScene(gr.id, { toSpawn: true });
  const md = G.Data.maps[gr.id];
  const sp = (md.special || []).filter((x) => x.kind === 'worldgate')[0];
  if (sp) s.pos = { x: sp.x, y: sp.y + 1 };
}, 'worldgate');
shot('26_worldgate', 14);

/* 区域美术换皮（缺口 U7，v0.11.0）：四张图**刻意挑成"基础地面类型相同、只有调色板不同"** ——
   40/41 都是 cave（乱葬岗 灰紫 vs 火云谷 赤红），42/43 都是 grass（黄沙古堡 沙黄 vs 蟠桃园 桃绿）。
   这样截图能直接证明"换的是配色，不是地面种类"，也能看出装饰物配方（树/石数量）确实按区域走。 */
[
  { id: 'fan7', n: '乱葬岗', gl: 34, file: '40_region_grave' },
  { id: 'fan9', n: '火云谷', gl: 50, file: '41_region_lava' },
  { id: 'ling4', n: '黄沙古堡', gl: 82, file: '42_region_desert' },
  { id: 'xian5', n: '蟠桃园', gl: 125, file: '43_region_peach' }
].forEach((it) => {
  step(() => {
    const s = JSON.parse(JSON.stringify(save));
    s.globalLevel = it.gl;
    s.maxGlobalLevel = it.gl;
    G.game.save = s;
    G.RegionGen.sceneFor(it.id);
    G.game.changeScene(it.id, { toSpawn: true });
  }, 'region.tint.' + it.id);
  shot(it.file, 12);
});

step(() => {
  const s = JSON.parse(JSON.stringify(save));
  G.game.save = s;
  s.worldSeed = 20260926;
  s.dungeonSet = G.Data.dungeons.rollSet(s.worldSeed + ':set');
  s.dungeonSlot = 2;
  s.dungeonRun = null;
  const rid = G.Data.regions.entranceCandidates('fan')[0].id;
  G.game.changeScene('dungeon', {
    entrance: { slot: 1, arch: s.dungeonSet[1], region: rid }
  });
}, 'dungeon.entrance');
shot('27_dungeon_entrance', 6);
/* 破境天劫（v0.26.0）：蓄势 → 落雷 → 天道问话。停在**问话段**拍一张 */
step(() => {
  G.game.changeScene('field', { toSpawn: true });
  const sc = G.game.scene;
  G.Overlays.startTribulation(sc, G.game.save, function () {});
  for (let i = 0; i < 80 && sc.trib && !sc.trib.asked; i++) sc.update(0.04);
  sc.update(0.04);
}, 'tribulation.ask');
shot('06_tribulation', 4);
/* 立体感 B+C：建筑基座/落地投影 + 树加高（把镜头挪到镇中，让建筑完整入画） */
step(() => {
  /* ⚠️ 不能带 toSpawn —— 它会用出生点覆盖 pos，镜头永远停在镇子最上沿 */
  G.game.changeScene('town');
  G.game.save.pos = { x: 18, y: 13 };
}, 'solid.town');
shot('06b_solid_town', 10);
/* 每层三选一（v0.23.0）：Roguelite 的构筑环节 —— 通关一层后从 3 个临时增益里选 1 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  G.game.save = s;
  s.worldSeed = 20260926;
  s.dungeonSet = G.Data.dungeons.rollSet('shot:buff');
  s.dungeonSlot = 1;
  s.dungeonRun = { archId: s.dungeonSet[1], stage: 3, buffs: ['atk', 'crit'],
    midBeaten: false, bigBeaten: false };
  G.game.changeScene('dungeon');
  G.scenes.dungeon._offerBuffs(['第 2 关 · 杂兵已清，前路可进']);
}, 'dungeon.buff');
shot('28_dungeon_buff', 6);

step(() => {
  G.game.changeScene('hall');
  G.scenes.hall.view = 'ascend';
  G.scenes.hall._build();
}, 'hall.ascend');
shot('28_hall_ascend', 8);

/* 剧情：轮回图鉴 + 忆起弹层（v0.54.0） */
function storyMeta() {
  G.game.changeScene('hall');
  let meta = G.game.meta || G.Storage.loadMeta();
  if (!meta) {
    meta = { lives: 0, xianli: 0, totalXianli: 0,
      perfusion: { body: 0, qi: 0, po: 0, stone: 0, rescue: 0 },
      past: [], heaven: { memory: [], watchTotal: 0 },
      progress: G.Storage.defaultProgress() };
    G.game.meta = meta;
  }
  G.Story.ensure(meta);
  G.Story.sealLife(meta, {}, 1);
  return meta;
}
step(() => {
  const meta = storyMeta();
  G.Story.onBreak(meta, {}, 145);
  G.Story._queue.length = 0; G.Story._cur = null;
  G.Story._tab = 0; G.Story._page = 0;
  G.Story.openCodex();
}, 'codex.memory');
shot('70_codex_memory', 10);

step(() => { G.Story._tab = 1; G.Story._page = 0; }, 'codex.people');
shot('70b_codex_people', 6);

step(() => {
  G.Story.closeCodex();
  const meta = G.game.meta;
  meta.memory.recalled = [];
  G.Story._queue.length = 0; G.Story._cur = null;
  G.Story.onBreak(meta, {}, 37);
}, 'recall.flash');
shot('71_recall', 8);

/* 10) v0.8.0：底栏六功能 + 设置多协议 + 前世经历
   这四张是"底栏真的常驻、六个面板真的能开、设置真的能配云端模型"的肉眼凭据。
   每步都重建存档 —— death 场景会把当世档清空（G.game.save = null）。 */
const richSave = () => {
  const s = JSON.parse(JSON.stringify(save));
  s.skills = { 缠藤指: { lv: 3 }, 铁布衫: { lv: 2 }, 吐纳术: { lv: 1 }, 回春诀: { lv: 1 } };
  s.secrets = { n_xuehai: 1, x_jiuxiao: 2, s_longxiang: 1.5, x_zhanxian: 2 };
  s.items = { 回春丹: 4, 淬体突破丹: 1, 妖丹: 7, 解封符: 2 };
  s.po = 260; s.stone = 1420; s.qi = 3200; s.hp = 92;
  s.quest = { step: 'm0-4', flags: { won1: true, templeDone: true, dream: true } };
  s.globalLevel = 8;
  /* 三灵根（金·木·水）：角色面板「灵根」子页要看得出来系数与相克高亮 */
  s.linggen = { kind: '五行', elems: ['金', '木', '水'], coef: { 金: 1.0, 木: 1.0, 水: 1.0 }, stoneBonus: 0.15 };
  s.age = 18;
  s.pos = null;
  return s;
};
const richMeta = () => ({
  lives: 3, xianli: 260, totalXianli: 1180,
  perfusion: { body: 2, qi: 1, po: 0, stone: 3, rescue: 0 },
  achieve: { A1: 1, A2: 1, A4: 1 }, pity: 0,
  heaven: { talks: 0, watchTotal: 0, memory: [], karma: [] },
  titles: ['破狱·凡尘', '破狱·灵渊'], hellCleared: { fan: true, ling: true },
  device: { id: G.Storage.deviceId(), browser: G.Storage.browserId(), first: Date.now(), last: Date.now() },
  progress: {
    difficulty: 'normal', activeWorld: 'fan', nextWorld: null,
    worlds: { fan: true, ling: true, xian: false, dao: false },
    worldDiff: { fan: 'hard', ling: 'hell', xian: 'normal', dao: 'normal' },
    daoKey: false, daoShards: { fan: true, ling: true, xian: false }
  },
  past: [
    { life: 1, age: 27, realm: '炼气三段', level: 12, xianli: 152, causeName: '战死', dev: 'dev-other01',
      chronicle: [{ s: '入世青溪镇' }, { s: '山神庙得逆命珠' }, { s: '殁于黑风岭' }] },
    { life: 2, age: 34, realm: '筑基一段', level: 19, xianli: 260, causeName: '寿元尽', dev: G.Storage.deviceId(),
      chronicle: [{ s: '入世落霞镇' }, { s: '破入炼气一重' }, { s: '手刃赤炎狼王' }] },
    { life: 3, age: 41, realm: '筑基圆满', level: 22, xianli: 312, causeName: '寿元尽', dev: G.Storage.deviceId(),
      chronicle: [{ s: '入世雷泽荒原' }, { s: '破入筑基一段' }, { s: '以地狱难度踏破灵界' }] }
  ]
});

step(() => {
  G.game.save = richSave();
  G.game.meta = richMeta();
  G.game.changeScene('town', { toSpawn: true });
}, 'hud.bar');
shot('29_hud_bar', 12);

step(() => {
  /* 上一段「忆起」演出会留一个 modal（G.Story._cur），不清掉会整个盖住面板 ——
     第一次拍 30_panel_skills 拍到的就是忆起卡而不是功法面板。 */
  if (G.Story) { G.Story._cur = null; G.Story._queue.length = 0; G.Story.closeCodex(); }
  G.Overlays.openPanel(G.game.scene, 'skills');
}, 'panel.skills');
shot('30_panel_skills', 6);
step(() => { G.Overlays.openPanel(G.game.scene, 'secrets'); }, 'panel.secrets');
shot('31_panel_secrets', 6);
step(() => { G.Overlays.openPanel(G.game.scene, 'quest'); }, 'panel.quest');
shot('32_panel_quest', 6);
/* 法宝三槽（v0.25.0）：武器 / 防具 / 饰品 */
step(() => {
  const s = G.game.save;
  s.items = s.items || {};
  s.items['eq_qingfeng'] = 1; s.items['eq_bujia'] = 1;
  s.equip = { weapon: 'eq_qingfeng', armor: 'eq_bujia', accessory: null };
  s.charTab = 'overview'; s.equipPick = null;
  G.Overlays.openPanel(G.game.scene, 'char', true);
}, 'panel.char.equip');
shot('29_panel_char_equip', 6);
/* 支线页（内容型支线）：切到「支线」页签并选中第一条 */
step(() => {
  const sc = G.game.scene;
  sc.questTab = 'side'; sc.questSel = 'sq_washer';
  G.game.save.side = { sq_washer: 1 };
  G.Overlays.openPanel(sc, 'quest', true);
}, 'panel.quest.side');
shot('32b_panel_quest_side', 6);
step(() => { G.game.scene.questTab = 'main'; }, 'quest.tab.back');
step(() => { G.Overlays.openPanel(G.game.scene, 'bag'); }, 'panel.bag');
shot('33_panel_bag', 6);
step(() => { G.Overlays.openPanel(G.game.scene, 'cave'); }, 'panel.cave');
shot('35_panel_cave', 6);
/* 兽栏面板（B2，《灵兽 v1.1》）：空态 / 有兽 / 饲料店 */
step(() => {
  const s = G.game.save;
  s.beasts = []; s.beastTeam = []; s.riding = null; s.beastSeq = 0;
  G.Overlays.openPanel(G.game.scene, 'beasts');
}, 'panel.beasts.empty');
shot('47_panel_beasts_empty', 6);
step(() => {
  const s = G.game.save;
  s.beasts = []; s.beastSeq = 0;
  G.Beasts.add(s, 'b_qingwenshe', { gl: 6, stage: 'young' });
  G.Beasts.add(s, 'b_huangzongma', { gl: 8, stage: 'adult' });
  G.Beasts.add(s, 'b_chiyanlang', { gl: 7, stage: 'adult' });
  s.items = { '药渣': 8, '灵食': 3, '妖丹': 2 };
  G.game.scene.beastSel = s.beasts[0].uid;
  G.Overlays.openPanel(G.game.scene, 'beasts');
}, 'panel.beasts');
shot('47b_panel_beasts', 6);
step(() => { G.Overlays.openPanel(G.game.scene, 'beastShop'); }, 'panel.beastshop');
shot('47c_panel_beastshop', 6);
/* 出战兽接入战斗（design B2）：赤炎狼作友方单位站主角左后侧 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.beasts = []; s.beastTeam = []; s.riding = null; s.beastSeq = 0;
  const r = G.Beasts.add(s, 'b_chiyanlang', { gl: 2, stage: 'adult' });
  G.Beasts.setBattle(s, r.beast.uid);
  G.game.save = s;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 2, '青纹蛇'), mapId: 'field' });
}, 'battle.beast');
shot('48_battle_beast', 30);
/* 陆地坐骑（design B3）：骑黄鬃马在野外，坐骑精灵在主角身下 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.beasts = []; s.beastTeam = []; s.riding = null; s.beastSeq = 0;
  const r = G.Beasts.add(s, 'b_huangzongma', { gl: 9, stage: 'adult' });
  const rd = G.Beasts.setRide(s, r.beast.uid);
  if (!rd.ok) throw new Error('骑乘截图设置失败：' + rd.reason);
  G.game.save = s;
  G.game.changeScene('field', { toSpawn: true });
}, 'ride.field');
shot('49_field_ride', 30);
/* 采集点（四大技艺批1）：野外图上的草药/矿石节点 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.gather = {}; s.day = 1; s.pos = null;
  G.game.save = s;
  G.game.changeScene('field', { toSpawn: true });
}, 'shot.field.gather');
shot('56_field_gather', 30);
/* 丹房面板（四大技艺批2）：配方 + 材料 have/need + 炼制 */
step(() => {
  const s = G.game.save;
  s.items = Object.assign({}, s.items, { '凝血草': 5, '灵泉水': 3, '妖丹': 1, '回春丹': 2, '百年灵芝': 1 });
  s.globalLevel = 37;
  G.Overlays.openPanel(G.game.scene, 'alchemy');
}, 'panel.alchemy');
shot('57_panel_alchemy', 5);
/* 器坊面板（四大技艺批3） */
step(() => {
  const s = G.game.save;
  s.items = Object.assign({}, s.items, { '玄铁': 6, '精钢': 5, '兽皮': 3, '灵羽': 2, '妖骨': 1, '道纹矿': 3, '道纹草': 2 });
  s.globalLevel = 73;
  G.Overlays.openPanel(G.game.scene, 'forge');
}, 'panel.forge');
shot('58_panel_forge', 5);
/* 阵台面板（四大技艺批4）：含已布与各界分际 */
step(() => {
  const s = G.game.save;
  s.stone = 30000; s.sectId = 'qxj'; s.sectRep = 800;
  s.formations = { jubao: true };
  G.Overlays.openPanel(G.game.scene, 'array');
}, 'panel.formation');
shot('59_panel_formation', 5);
/* 宗门后山（四大技艺批5）：灵田/药圃/矿脉 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.cult = 'free'; s.sectId = null; s.pos = null;
  G.game.save = s;
  const rid = G.SectGen.roomId('qxj', 'houshan');
  G.SectGen.sceneFor(rid);
  G.game.changeScene(rid, { toSpawn: true });
}, 'shot.60_sect_qxj_houshan');
shot('60_sect_qxj_houshan', 24);
/* R3 区域建筑服务：坊市买入/卖出、铁匠铺炼器面板 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.pos = null; s.stone = 2000; G.game.meta = {};
  G.game.save = s;
  G.RegionGen.ensure(s, 'fan4');
  const rmd = G.Data.maps['fan4'];
  const st = rmd.structures.filter((x) => x.bk === 'shop')[0];
  const iid = 'int.fan4.' + st.id;
  G.InteriorGen.ensure(s, iid, st, G.Data.regions.byId('fan4'));
  G.game.changeScene(iid, { toSpawn: true });
  G.ShopService.open(G.game.scene, 'shop');
}, 'r3.shop.buy');
shot('61_interior_shop_buy', 6);
step(() => {
  const s = G.game.save;
  s.items = Object.assign({}, s.items, { '玄铁': 2, '回春丹': 3, '兽皮': 1 });
  G.ShopService.open(G.game.scene, 'shop');
  G.game.scene.buttons.filter((b) => b.label.replace(/\s/g,'') === '卖出')[0].onClick();
}, 'r3.shop.sell');
shot('62_interior_shop_sell', 6);
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.pos = null; G.game.meta = {}; G.game.save = s;
  G.RegionGen.ensure(s, 'fan4');
  const rmd = G.Data.maps['fan4'];
  const st = rmd.structures.filter((x) => x.bk === 'smithy')[0];
  const iid = 'int.fan4.' + st.id;
  G.InteriorGen.ensure(s, iid, st, G.Data.regions.byId('fan4'));
  G.game.changeScene(iid, { toSpawn: true });
  G.RegionServices.openForge(G.game.scene);
}, 'r3.smithy');
shot('63_interior_smithy_forge', 6);
/* R5 伴生仙兽：道钥解锁，兽栏详情可设为伴生（随轮回同行） */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  G.game.save = s; G.game.meta = { progress: { daoKey: true } };
  G.Beasts.add(s, 'b_bilinmang', { gl: 109, stage: 'adult' });
  G.game.changeScene('town', { toSpawn: true });
  const sc = G.game.scene;
  G.Overlays.openPanel(sc, 'beasts');
  const setb = sc.buttons.filter((b) => (b.label || '').indexOf('设为伴生') >= 0)[0];
  if (setb) setb.onClick();
}, 'r5.companion');
shot('64_beasts_companion', 6);



/* B4 骑乘作战：骑成年碧鳞蟒进战斗，人车一体 */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.beasts = []; s.beastTeam = []; s.riding = null; s.beastSeq = 0;
  s.globalLevel = 37;
  const r = G.Beasts.add(s, 'b_bilinmang', { gl: 37, stage: 'adult' });
  const rd = G.Beasts.setRide(s, r.beast.uid);
  if (!rd.ok) throw new Error('骑乘作战截图设置失败：' + rd.reason);
  G.game.save = s;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 37, '青纹蛇'), mapId: 'field' });
}, 'battle.mount');
shot('50_battle_mount', 30);

/* 宗门面板（《宗门与散修体系设计 v1.0》）：散修态应看到「拜入 XX」按钮 */
step(() => {
  const s = G.game.save;
  s.cult = 'free'; s.sectId = null; s.sectRep = 0; s.cultSwitchUsed = false;
  /* 先切回干净镇内（此前停在战斗场景，面板叠在战场上构图无效）。 */
  G.game.changeScene('town', { toSpawn: true });
  G.Overlays.openPanel(G.game.scene, 'sect');
}, 'panel.sect');
shot('34_panel_sect', 6);
/* 未入门·切到「宗门」子页：应见本界宗门 3×3 拜入网格（验证底部说明不越界）。 */
step(() => {
  const s = G.game.save;
  s.cult = 'free'; s.sectId = null; s.sectRep = 0; s.cultSwitchUsed = false;
  G.game.changeScene('town', { toSpawn: true });
  G.Overlays.openPanel(G.game.scene, 'sect');
  G.game.scene.sectTab = 'sect';
}, 'panel.sect.grid');
shot('34a_panel_sect_grid', 6);
step(() => {
  const s = G.game.save;
  s.cult = 'sect'; s.sectId = 'qxj'; s.sectRep = 120; s.sectRank = 'inner';
  s.cultSwitchUsed = true;
  G.game.changeScene('town', { toSpawn: true });
  G.Overlays.openPanel(G.game.scene, 'sect');
}, 'panel.sect.joined');
shot('34b_panel_sect_joined', 6);
/* 门派商店（S3）：贡献换物 */
step(() => {
  const s = G.game.save;
  s.cult = 'sect'; s.sectId = 'qxj'; s.sectRep = 120; s.sectRank = 'inner';
  G.game.scene.sectView = 'shop';
  G.Overlays.openPanel(G.game.scene, 'sect', true);
}, 'panel.sect.shop');
shot('34c_panel_sect_shop', 6);
/* R1 宗门小世界房间 qxj/gate */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.cult = 'free'; s.sectId = null; s.pos = null;
  G.game.save = s;
  const rid = G.SectGen.roomId('qxj', 'gate');
  G.SectGen.sceneFor(rid);
  G.game.changeScene(rid, { toSpawn: true });
}, 'shot.51_sect_qxj_gate');
shot('51_sect_qxj_gate', 24);
/* R1 宗门小世界房间 qxj/hall */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.cult = 'free'; s.sectId = null; s.pos = null;
  G.game.save = s;
  const rid = G.SectGen.roomId('qxj', 'hall');
  G.SectGen.sceneFor(rid);
  G.game.changeScene(rid, { toSpawn: true });
}, 'shot.52_sect_qxj_hall');
shot('52_sect_qxj_hall', 24);
/* R1 宗门小世界房间 qxj/chuangong */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.cult = 'free'; s.sectId = null; s.pos = null;
  G.game.save = s;
  const rid = G.SectGen.roomId('qxj', 'chuangong');
  G.SectGen.sceneFor(rid);
  G.game.changeScene(rid, { toSpawn: true });
}, 'shot.53_sect_qxj_chuangong');
shot('53_sect_qxj_chuangong', 24);
/* R1 宗门小世界房间 txjz/gate */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.cult = 'free'; s.sectId = null; s.pos = null;
  G.game.save = s;
  const rid = G.SectGen.roomId('txjz', 'gate');
  G.SectGen.sceneFor(rid);
  G.game.changeScene(rid, { toSpawn: true });
}, 'shot.54_sect_txjz_gate');
shot('54_sect_txjz_gate', 24);
/* R1 宗门小世界房间 txjz/gongxian */
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  s.cult = 'free'; s.sectId = null; s.pos = null;
  G.game.save = s;
  const rid = G.SectGen.roomId('txjz', 'gongxian');
  G.SectGen.sceneFor(rid);
  G.game.changeScene(rid, { toSpawn: true });
}, 'shot.55_sect_txjz_gongxian');
shot('55_sect_txjz_gongxian', 24);

step(() => { G.Overlays.openPanel(G.game.scene, 'map'); }, 'panel.map');
shot('36_panel_map', 6);
/* 灵根页（v0.40.0）：九宫格改用**文生图灵珠**，未激活的压暗 */
step(() => {
  const s = G.game.save;
  s.linggen = { kind: '五行', elems: ['木', '火', '土'], coef: { '木': 1.6, '火': 1.1, '土': 1.1 }, stoneBonus: 0 };
  s.charTab = 'linggen';
  G.Overlays.openPanel(G.game.scene, 'char', true);
}, 'panel.linggen');
shot('29b_panel_linggen', 6);
/* 储物格子的悬浮说明（鼠标落在第一个格子里：BG.x0=26, BG.y0=84, cell=46） */
step(() => { G.Input.mouse = { x: 49, y: 107 }; }, 'bag.tip');
shot('33b_bag_tip', 2);
step(() => { G.Input.mouse = null; }, 'bag.tip.off');
/* 成就页 v0.15.0 移到**开局界面**（游戏外）；拍完回镇上继续拍面板 */
/* ⚠️ 必须先 changeScene('title') —— 只调 _openAch 的话当前场景还是 town，
   拍到的会是上一张面板（本轮就拍错过一次）。 */
step(() => { G.game.changeScene('title'); G.scenes.title._openAch(); }, 'title.ach');
shot('02b_title_ach', 8);
step(() => { G.scenes.title._buildMenu(); G.game.changeScene('town', { toSpawn: true }); }, 'back.town');

/* 角色面板四个子页（v0.11.0）：**每页都要肉眼过一遍** ——
   排版越界/叠字/压按钮全是静默的，只有截图能看出来。
   ⚠️ 顺序：先设 charTab 再 openPanel —— openPanel 会按当前 charTab 重建按钮，
   反过来写的话截图里的**页签高亮会停在上一个子页**（真实点击流程就是先设后建）。 */
step(() => { const sc = G.game.scene; sc.charTab = 'overview'; G.Overlays.openPanel(sc, 'char'); }, 'panel.char.overview');
shot('34b_char_overview', 6);
step(() => { const sc = G.game.scene; sc.charTab = 'linggen'; G.Overlays.openPanel(sc, 'char', true); }, 'panel.char.linggen');
shot('34c_char_linggen', 6);
step(() => { const sc = G.game.scene; sc.charTab = 'attr'; G.Overlays.openPanel(sc, 'char', true); }, 'panel.char.attr');
shot('34d_char_attr', 6);
step(() => { const sc = G.game.scene; sc.charTab = 'realm'; G.Overlays.openPanel(sc, 'char', true); }, 'panel.char.realm');
shot('34e_char_realm', 6);

step(() => {
  /* 打开设置页并把协议切到 Claude、填上地址与模型，看看"配云端"这条路的样子 */
  G.TianDao.ensure(G.game.meta);
  G.game.meta.tiandao = {
    mode: 'remote', protocol: 'claude',
    endpoint: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-haiku-20241022',
    apiKey: 'sk-ant-api03-abcdefghijklmnop', temp: 0.8
  };
  G.TianDao.openSettings(G.game.scene);
}, 'settings');
shot('35_settings', 6);

step(() => {
  G.game.save = richSave();
  G.game.meta = richMeta();
  G.game.changeScene('hall');
  G.scenes.hall.view = 'lives';
  G.scenes.hall.page = 0;
  G.scenes.hall._build();
}, 'hall.lives');
shot('36_hall_lives', 10);

/* 11) v0.9.0：道界·道则回廊（缺口 U4）
   道界此前**只有区域、没有内容** —— 这三张是"九关真的列出来了、通关真的结算了、
   飞升台的道界行真的可选了"的肉眼凭据。 */
const daoMeta = () => ({
  lives: 5, xianli: 0, totalXianli: 0,
  perfusion: { body: 3, qi: 2, po: 1, stone: 2, rescue: 1 },
  achieve: {}, past: [],
  titles: ['破狱·凡尘', '破狱·灵渊', '破狱·仙穹'],
  hellCleared: { fan: true, ling: true, xian: true },
  device: { id: G.Storage.deviceId(), browser: G.Storage.browserId() },
  progress: {
    difficulty: 'normal', activeWorld: 'dao', nextWorld: null,
    worlds: { fan: true, ling: true, xian: true, dao: true },
    worldDiff: { fan: 'normal', ling: 'hell', xian: 'normal', dao: 'hard' },
    daoKey: true, daoShards: { fan: true, ling: true, xian: true }
  }
});
step(() => {
  const s = JSON.parse(JSON.stringify(save));
  G.game.save = s;
  G.game.meta = daoMeta();
  s.globalLevel = 156;                 /* 斩三尸已历，正在证道 */
  s.maxGlobalLevel = 156;
  s.daoCrystal = 320;
  s.daoCleared = [true, true, true, true, false, false, false, false, false];
  s.dungeonRun = null;
  s.pos = null;
  G.game.changeScene('dungeon');
}, 'dao.corridor');
shot('37_dao_corridor', 8);

step(() => {
  const s = JSON.parse(JSON.stringify(save));
  G.game.save = s;
  G.game.meta = daoMeta();
  s.globalLevel = 147;
  s.maxGlobalLevel = 147;
  s.daoCrystal = 300;
  s.daoCleared = [true, false, false, false, false, false, false, false, false];
  s.dungeonRun = null;
  s.pos = null;
  G.game.changeScene('dungeon');
  G.scenes.dungeon._startDaoTrial(1);          /* 扣道晶 → 进战斗 */
  G.game.changeScene('dungeon', { fromBattle: true });   /* 结算简报 */
}, 'dao.brief');
shot('38_dao_brief', 8);

step(() => {
  G.game.save = JSON.parse(JSON.stringify(save));
  G.game.meta = daoMeta();
  G.game.meta.progress.nextWorld = 'dao';
  G.game.changeScene('hall');
  G.scenes.hall.view = 'ascend';
  G.scenes.hall._build();
}, 'hall.ascend.dao');
shot('39_hall_ascend_dao', 8);

/* 宗门山门（v0.42.0）：凡界 9 宗门的山门室内场景 —— 拜师台 / 传功殿 / 贡献堂 / 香案 */
step(() => {
  const s = G.game.save;
  s.cult = 'free'; s.sectId = null;
  G.game.changeScene('sect_qxj', { toSpawn: true });
}, 'secthall');
shot('43_sect_hall', 8);

/* ---------- v0.61.0 新增/返工的四页（**每页都要肉眼过一遍**） ----------
   ① 拜师：v0.60.0 的 DRAW 漏注册（只有按钮、面板全空），用户截图实锤；
   ② 闭关：灵根苦修 + 离线收益的新入口；
   ③ 资产：四界四币 × 四品（原「灵石」页）；
   ④ 副本枢纽：五行徽记（原先只有文字）。
   ⚠️ 开拍前必须**清掉「轮回记忆」弹窗**（`G.Story._cur` / `_queue`）——
      它是全屏模态，会整块盖住面板，拍出来的图看不出面板好坏（第一版就拍成这样了）。 */
function clearStoryModal() {
  if (G.Story) { G.Story._cur = null; G.Story._queue = []; G.Story._codex = false; }
  /* ⚠️ toast / 战利品浮层也要清：它们要 1.6~3 秒才散，而 `shot` 只 pump 2~6 帧，
     不清就会横在面板或选项按钮上（拍出来像"按钮被盖住了"，其实是上一帧的残留）。 */
  if (G.game) { G.game.toasts.length = 0; G.game.lootFeed.length = 0; }
}
step(() => {
  const s = G.game.save;
  s.prof = s.prof || {}; s.stone = 1964;
  G.game.changeScene('town', { toSpawn: true });
  clearStoryModal();
  const sc = G.game.scene;
  sc._medFrom = 'cave';
  G.Overlays.openPanel(sc, 'masters');
}, 'panel.masters');
shot('44_panel_masters', 2);

step(() => {
  clearStoryModal();
  const sc = G.game.scene;
  sc._medFrom = 'cave';
  G.Overlays.openPanel(sc, 'meditate');
}, 'panel.meditate');
shot('45_panel_meditate', 2);

/* 打坐演出：结算后 `medAt` 会在 1.8 秒内画脉动光晕 + 灵气上升 + 大字报数。
   必须**先真闭关一次**再拍，否则拍到的是静止面板。 */
step(() => {
  const s = G.game.save;
  s.gt = 40 * 365 * 1440; s.age = 56; s.ageBonus = 0; s.qi = 0;
  clearStoryModal();
  const sc = G.game.scene;
  sc._medFrom = 'cave';
  G.Overlays.openPanel(sc, 'meditate');
  const b = (sc.buttons || []).filter((x) => x.label === '闭关')[0];
  if (b) b.onClick();
  clearStoryModal();
}, 'panel.meditate.fx');
shot('45b_meditate_fx', 3);

step(() => {
  const s = G.game.save;
  s.stone = 1964; s.lingjing = 3; s.xianjing = 0; s.daoCrystal = 0;
  clearStoryModal();
  const sc = G.game.scene;
  sc.bagTab = 'stone';
  G.Overlays.openPanel(sc, 'bag', true);
}, 'panel.bag.asset');
shot('46_panel_bag_asset', 2);

step(() => {
  const s = G.game.save;
  /* ⚠️ 必须把主界与境界都拨回**凡界**：前面的道界步骤把 gl 拨到 147，
     `_worldId()` 于是走 `daohub`（道则回廊），拍到的是九关列表而不是秘境枢纽。 */
  G.game.meta = G.game.meta || {};
  G.game.meta.progress = G.game.meta.progress || {};
  G.game.meta.progress.activeWorld = 'fan';
  G.game.meta.progress.worlds = { fan: true, ling: true, xian: true, dao: false };
  s.globalLevel = 73; s.maxGlobalLevel = 73;
  s.dungeonSlot = 2;
  s.dungeonSet = G.Data.dungeons.rollSet(s.worldSeed || 'shot-seed').slice(0, 5);
  G.game.changeScene('dungeon');
  clearStoryModal();
}, 'dungeon.hub');
shot('47_dungeon_hub', 2);

/* 势力面板·宗门页（v0.61.0，用户第 12 点）：3×3 拜入网格 + 宗门徽记。
   ⚠️ 必须 `cult='free'` 且 `sectId=null` 才会走到"未入门 → 择一拜入"那一支。 */
step(() => {
  const s = G.game.save;
  s.cult = 'free'; s.sectId = null; s.sectRep = 0;
  s.globalLevel = 73; s.maxGlobalLevel = 73;
  G.game.meta.progress.activeWorld = 'fan';
  G.game.changeScene('town', { toSpawn: true });
  clearStoryModal();
  const sc = G.game.scene;
  sc.sectTab = 'sect'; sc.sectView = null;
  G.Overlays.openPanel(sc, 'sect', true);
}, 'panel.sect');
shot('48_panel_sect_emblem', 2);

/* ---------- v0.62.0 ---------- */
/* ① 地图：拖拽 / 缩放 / 节点传送（用户第 6/8 点）。
   拍**放大 3 倍 + 平移**那一帧 —— 默认 1 倍的观感与旧版一致，看不出新能力。 */
step(() => {
  const s = G.game.save;
  s.globalLevel = 200; s.maxGlobalLevel = 200;
  s.visited = s.visited || {};
  G.Data.regions.of('fan').forEach((r) => { s.visited[r.id] = true; });
  G.game.meta.progress.activeWorld = 'fan';
  G.game.changeScene('town', { toSpawn: true });
  clearStoryModal();
  const sc = G.game.scene;
  sc.overlay = null;
  G.Overlays.openPanel(sc, 'map');
  sc.mapZoom = 3; sc.mapPan = { x: 0, y: 0 };
  G.Overlays.openPanel(sc, 'map', true);
  clearStoryModal();   /* ⚠️ openPanel 之后**再清一次**：上面那次可能跑在浮层生成之前 */
}, 'panel.map.zoom');
shot('49_panel_map_zoom', 2);

/* ② 机缘（用户第 7 点）：行走触发的"山道劫修"，三选一里一个是死路 */
step(() => {
  const s = G.game.save;
  s.globalLevel = 200; s.maxGlobalLevel = 200;
  s.hp = G.Player.computeStats(s).maxhp;      /* 别让「气血垂危」红字压住标题 */
  s.quest.flags = {};
  s.visited = s.visited || {}; s.visited.fan5 = true;
  G.game.changeScene('fan5', { toSpawn: true });
  clearStoryModal();
  /* ⚠️ 必须清 toast：上一步的「闭关 30 日」要 1.6 秒才散，pump 的帧数不够，
     它会横在选项按钮上（拍出来的图看着像"按钮被盖住了"）。 */
  G.game.toasts.length = 0;
  G.game.lootFeed.length = 0;
  const ev = G.Data.StoryEvents.list.filter((e) => e.map === 'fan5')[0];
  if (ev) G.Data.StoryEvents.show(G.game.scene, ev);
}, 'encounter.se8');
shot('50_encounter_bandit', 2);

/* ③ 主线章节链（v0.63.0，用户第 6 点）：任务面板「主线」页要能看见章节行与进度 */
step(() => {
  const s = G.game.save;
  s.globalLevel = 200; s.maxGlobalLevel = 200;
  s.chapters = ['c1', 'c2'];            /* 已完成两章 → 列表挂出第三章 */
  s.daoHeart = 2;
  s.quest.step = 'm1done';
  G.game.changeScene('town', { toSpawn: true });
  clearStoryModal();
  const sc = G.game.scene;
  sc.questTab = 'main';
  sc.questSel = 'ch:c3';
  G.Overlays.openPanel(sc, 'quest', true);
  clearStoryModal();
}, 'panel.quest.chapter');
shot('51_panel_quest_chapter', 2);

/* ③b 末章被九关闸卡住（v0.73.0）：境界拉满但**本世九关一关没过** ——
   此前 c10 只看 gl>=649，"九关尽过"只是台词，打 6 关就能看到结局。
   现在面板必须说清"为什么过不去"（挂一行进度引导，而不是让玩家以为卡 bug）。 */
step(() => {
  const s = G.game.save;
  s.globalLevel = 700; s.maxGlobalLevel = 700;
  /* 前九章全做完 → 只剩末章；但九关一关未过 */
  s.chapters = G.Data.Chapters.list.slice(0, 9).map((c) => c.id);
  s.daoCleared = [];
  s.daoHeart = 2;
  s.quest.step = 'm1done';
  G.game.changeScene('town', { toSpawn: true });
  clearStoryModal();
  const sc = G.game.scene;
  sc.questTab = 'main';
  sc.questSel = 'ch:c10';
  G.Overlays.openPanel(sc, 'quest', true);
  clearStoryModal();
}, 'panel.quest.daoGate');
shot('51b_panel_quest_daogate', 2);

/* ④ 三结局场景（v0.63.0）：证道 / 逆天各拍一张（配色与文案是两条分支） */
step(() => {
  const s = G.game.save;
  s.chapters = G.Data.Chapters.list.map((c) => c.id);
  s.daoHeart = 7;                       /* → 证道 */
  s.chronicle = s.chronicle || [];
  G.game.changeScene('ending');
  clearStoryModal();
}, 'ending.zheng');
shot('52_ending_zheng', 3);

step(() => {
  G.game.save.daoHeart = -8;            /* → 逆天 */
  G.game.changeScene('ending');
  clearStoryModal();
}, 'ending.ni');
shot('53_ending_ni', 3);

/* ⑤ 地图地形（v0.64.0，用户第 14 点）：凡界看"大陆感"（草原带/主河道/海岛 + 各区地貌），
   灵界看"浮空屿 + 水泽"——两界的底图逻辑不同，都要肉眼过一遍。 */
step(() => {
  const s = G.game.save;
  s.globalLevel = 400; s.maxGlobalLevel = 400;
  s.visited = s.visited || {};
  ['fan', 'ling'].forEach((w) => { G.Data.regions.of(w).forEach((r) => { s.visited[r.id] = true; }); });
  G.game.meta.progress.activeWorld = 'fan';
  G.game.meta.progress.worlds = { fan: true, ling: true, xian: true, dao: false };
  G.game.changeScene('town', { toSpawn: true });
  clearStoryModal();
  const sc = G.game.scene;
  sc.overlay = null; sc.mapZoom = 1; sc.mapPan = { x: 0, y: 0 };
  sc.mapWorld = 'fan';
  G.Overlays.openPanel(sc, 'map', true);
  clearStoryModal();
}, 'map.terrain.fan');
shot('54_map_terrain_fan', 2);

step(() => {
  const sc = G.game.scene;
  sc.mapWorld = 'ling'; sc.mapZoom = 1; sc.mapPan = { x: 0, y: 0 };
  G.Overlays.openPanel(sc, 'map', true);
  clearStoryModal();
}, 'map.terrain.ling');
shot('55_map_terrain_ling', 2);

/* ⑥ 云州城（M2，v0.65.0）：城景 + M2 主线对话。
   ⚠️ 拍城景要把主线拨到 m2-1 并让主角站在**街口**（spawn 在南门），否则拍到的是墙。 */
step(() => {
  const s = G.game.save;
  s.globalLevel = 120; s.maxGlobalLevel = 120;
  /* ⚠️ 章节链**和机缘**都要标成已看过 —— 否则进图那一帧会弹「筑基心障」
     （那是 `storyevents.js` 的 se10，`gl:73 / where:'any'`，不是章节），整屏盖住城景。
     两套系统都会在 explore.update 里弹模态，拍场景前都要清干净。 */
  s.chapters = G.Data.Chapters.list.map((c) => c.id);
  s.daoHeart = 2;
  s.quest = s.quest || { step: 'm2-1', flags: {} };
  s.quest.step = 'm2-1';
  s.quest.flags = s.quest.flags || {};
  G.Data.StoryEvents.list.forEach((e) => { s.quest.flags['se_' + e.id] = true; });
  s.pos = null;
  G.game.meta.progress.activeWorld = 'fan';
  G.game.changeScene('yunzhou', { toSpawn: true });
  clearStoryModal();
}, 'scene.yunzhou');
shot('56_scene_yunzhou', 3);

/* M2-1 的对话：**走逻辑入口**（站到执事面前按一下），不是直接把覆盖层塞进去 ——
   这样拍到的就是玩家真会看到的那一屏（含按钮版式）。 */
step(() => {
  const s = G.game.save;
  const sc = G.game.scene;
  const md = G.Data.maps.yunzhou;
  const n = md.npcs.filter((x) => x.act === 'steward')[0];
  const dirs = [[0, 1, 'up'], [0, -1, 'down'], [1, 0, 'left'], [-1, 0, 'right']];
  for (let i = 0; i < dirs.length; i++) {
    const d = dirs[i];
    if (!sc._blocked(n.x + d[0], n.y + d[1])) {
      s.pos = { x: n.x + d[0], y: n.y + d[1] }; sc.dir = d[2]; break;
    }
  }
  sc.overlay = null;
  sc._interact();
  clearStoryModal();
}, 'yunzhou.m2_1');
shot('57_yunzhou_dialog', 2);

/* v0.66 首批验收。只操作上方 Node 内存 localStorage，不读写玩家浏览器存档。 */
step(() => {
  sandbox.localStorage.clear();
  G.Storage.selectSlot(1);
  G.game.meta = { past: [], xianli: 0, pity: 0,
    perfusion: { body: 0, qi: 0, po: 0, stone: 0, rescue: 0 },
    progress: G.Storage.defaultProgress() };
  const s = JSON.parse(JSON.stringify(save));
  s.homeOwned = false; s.origin = null; s.originFx = {};
  s.globalLevel = 5; s.age = 16; s.gt = null;
  s.quest = { step: 'm0-3', flags: {} }; s.pos = null;
  s.chapters = G.Data.Chapters.list.map(c => c.id);
  G.Data.StoryEvents.list.forEach(e => { s.quest.flags['se_' + e.id] = true; });
  s.scene = 'town'; s.map = 'town';
  s.items = { '灵泉水': 3, '血精': 2, '木囊': 1, '回春丹': 5, '铁矿': 12 };
  s.stone = 100000; s.lingCrystal = 0; s.xianCrystal = 0; s.daoCrystal = 0;
  s.talents = [G.Data.talents[0].id];
  G.game.save = s;
  s.hp = G.Player.computeStats(s).maxhp; s.qi = G.Player.needQi(s);
  G.Storage.saveMeta(G.game.meta); G.Storage.saveCurrent(s);
  G.game.changeScene('title'); G.scenes.title._openSlots();
  clearStoryModal();
}, 'v66.slots');
shot('66a_three_slots', 2);

step(() => {
  G.Storage.selectSlot(2); G.game.meta = null; G.game.save = null;
  G.game.changeScene('reincarnation'); clearStoryModal();
}, 'v66.birth.root');
shot('66b_locked_roots', 2);
step(() => {
  G.scenes.reincarnation.step = 'talent'; G.scenes.reincarnation._buildButtons();
}, 'v66.birth.talent');
shot('66c_single_talent', 2);

/* v0.71.0：入世成长演出三拍（6 → 10 → 16 岁）。固定在每拍进度 60%
   （人物已从地面完全长出、走帧已开始、光柱仍亮），三张连看就是"长高"。 */
[0, 1, 2].forEach((stage) => {
  step(() => {
    const R = G.scenes.reincarnation;
    R.step = 'grow'; R.grow = stage; R.growT = R.GROW_DUR * 0.6; R._growSkip = false;
    R._buildButtons();
  }, 'v71.grow.' + stage);
  shot('71_grow_' + ['6y', '10y', '16y'][stage], 2);
});

step(() => {
  G.Storage.selectSlot(1); G.game.meta = G.Storage.loadMeta(); G.game.save = G.Storage.loadCurrent();
  G.Input.mouse = null;
  G.game.changeScene('town', { toSpawn: true }); clearStoryModal();
  G.game.scene.trackOpen = false;
}, 'v66.hud');
shot('66d_hud_percent', 14);
step(() => { G.Overlays.openPanel(G.game.scene, 'cave'); clearStoryModal(); }, 'v66.nohome');
shot('66e_no_home', 14);
step(() => {
  const sc = G.game.scene; sc.charTab = 'linggen';
  G.Overlays.openPanel(sc, 'char', true); clearStoryModal();
  const p = G.Overlays.CHAR_BODY;
  G.Input.mouse = { x: p.x + 35, y: p.y + 69 };
}, 'v66.root.tip');
shot('66f_root_tooltip', 14);
step(() => {
  const sc = G.game.scene; sc.bagTab = 'misc';
  G.Overlays.openPanel(sc, 'bag', true); clearStoryModal();
  G.Input.mouse = { x: 83, y: 108 };
}, 'v66.item.tip');
shot('66g_item_tooltip', 14);
step(() => {
  G.Input.mouse = null; const sc = G.game.scene; sc.bagTab = 'stone';
  G.Overlays.openPanel(sc, 'bag', true); clearStoryModal();
}, 'v66.assets');
shot('66h_asset_zero', 14);
step(() => {
  G.Overlays.openVessel(G.game.scene); clearStoryModal();
}, 'v66.portable.story');
shot('66i_portable_story', 14);

/* ---------- 报告 ---------- */
if (errors.length) {
  console.log('\n渲染期间异常 (' + errors.length + ')：');
  errors.forEach((e) => console.log(' - ' + e));
  process.exit(1);
}
console.log('完成，共 ' + n + ' 张。');

})();
