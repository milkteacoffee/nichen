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
function shot(name, frames) {
  pump(frames || 6);
  if (ONLY.length && !ONLY.some((p) => name.indexOf(p) >= 0)) return;
  log('  … ' + name);
  const file = path.join(OUT, name + '.png');
  fs.writeFileSync(file, gameCanvas.toBuffer('image/png'));
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

/* 2) 转世 */
step(() => G.game.changeScene('reincarnation'), 'reincarnation');
shot('03_reincarnation', 30);

/* 3) 世界存档（幼年场景要求已有存档，否则会退回标题） */
const world = G.Data.generateWorld(12345, true);
const save = {
  life: 1, worldSeed: 12345, world: world,
  origin: 'test', six: { 勇猛: 8, 灵巧: 7, 体质: 9, 智力: 6, 魅力: 5 },
  linggen: { elems: ['木'], coef: { 木: 1.2 }, kind: '单灵根', stoneBonus: 0 },
  talents: [], skills: { 缠藤指: { lv: 2 }, 回春诀: { lv: 1 } }, skillEquip: ['缠藤指'],
  items: { 回春丹: 3, 妖囊: 2, 解封符: 1 },
  stone: 500, qi: 1200, po: 30,
  globalLevel: 5, age: 1, watch: 0, whispers: 0, escapeLeft: 3,
  quest: { step: 'free', flags: {} },
  scene: 'town', map: 'town', pos: null,
  chestsOpened: [], bossKilled: false,
  childhood: { randomDrawn: [], log: [] },
  hp: 200
};
G.game.save = save;

/* 3b) 幼年（打字机需要足够帧数把卡面文字打完） */
step(() => G.game.changeScene('childhood'), 'childhood');
shot('04_childhood', 110);
save.age = 16;

/* 4) 镇 / 山 / 洞 */
[['05_town', 'town'], ['07_field', 'field'], ['09_cave', 'cave']].forEach(function (m) {
  step(() => { save.pos = null; G.game.changeScene(m[1], { toSpawn: true }); }, 'scene:' + m[1]);
  shot(m[0], 24);
  const sc = G.game.scene;
  if (m[1] !== 'cave') {
    step(() => G.Overlays.openChar(sc), 'overlay:' + m[1]);
    shot(m[0] + 'b', 8);
    step(() => sc.clearOverlay(), 'overlay.close');
  }
  step(() => {
    sc._heldDir = () => 'down';
    for (let i = 0; i < 40; i++) sc.update(0.05);
    sc.onTap({ x: 240, y: 140 });
    for (let i = 0; i < 60; i++) sc.update(0.05);
    sc._interact();
  }, 'walk:' + m[1]);
  shot(m[0] + '_walk', 10);
});

/* 5) 战斗：普通遭遇（含功法 / 道具 / 防御 面板） */
step(() => {
  save.pos = null;
  G.game.changeScene('battle', { enemy: G.Data.makeEnemy('赤炎狼', 6, '苍鬃狼'), mapId: 'field' });
}, 'battle.enter');
shot('11_battle', 30);
step(() => G.game.scene._cmd('功法'), 'battle.skill');
shot('12_battle_skill', 8);
step(() => G.game.scene._cmd('道具'), 'battle.item');
shot('13_battle_item', 8);
step(() => G.game.scene._cmd('攻击'), 'battle.attack');
shot('14_battle_attack', 60);
step(() => G.game.scene._cmd('防御'), 'battle.guard');
shot('15_battle_guard', 60);

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
    past: [
      { life: 1, age: 27, realm: '炼气三段', level: 12, sixSum: 38, stone: 210, boss: false, xianli: 152, at: Date.now() },
      { life: 2, age: 34, realm: '筑基一段', level: 19, sixSum: 52, stone: 480, boss: true, xianli: 260, at: Date.now() }
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

/* ---------- 报告 ---------- */
if (errors.length) {
  console.log('\n渲染期间异常 (' + errors.length + ')：');
  errors.forEach((e) => console.log(' - ' + e));
  process.exit(1);
}
console.log('完成，共 ' + n + ' 张。');

})();
