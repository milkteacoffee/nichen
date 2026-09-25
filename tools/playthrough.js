/* 无头 M0 通关模拟：从新档按真实任务链一路走到击杀赤炎狼王。
   用法：node tools/playthrough.js
   目的：验证"灵气 → 突破 → 境界 → 地图解锁 → 狼王"这条主因果链没有断点。
   战斗用真实场景（_initUnits / _victory / _defeat），只把敌方血量置零来跳过随机性，
   因此奖励公式、任务推进、突破规则都是真实代码路径。 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const WWW = path.join(__dirname, '..', 'www');

function makeGradient() { return { addColorStop() {} }; }
function makeCtx() {
  const noop = () => {};
  return {
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
      if (!img) throw new Error('drawImage(null)');
      for (let i = 1; i < arguments.length; i++) {
        if (typeof arguments[i] !== 'number' || !isFinite(arguments[i])) throw new Error('drawImage 非有限数');
      }
      if (!img.width || !img.height) throw new Error('drawImage 源尺寸为 0');
    },
    putImageData: noop, getImageData: () => ({ data: new Uint8ClampedArray(4) })
  };
}
function makeCanvas(w, h) {
  const c = {
    width: w || 300, height: h || 150, style: {},
    getContext() { if (!c._ctx) { c._ctx = makeCtx(); c._ctx.canvas = c; } return c._ctx; },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: c.width, height: c.height }; }
  };
  return c;
}

const gameCanvas = makeCanvas(480, 272);
let rafQueue = [];
const sandbox = {
  console,
  document: {
    createElement(tag) { return tag === 'canvas' ? makeCanvas(1, 1) : { style: {}, appendChild() {}, addEventListener() {} }; },
    getElementById(id) { return id === 'game' ? gameCanvas : null; },
    addEventListener() {}
  },
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
sandbox.window.addEventListener = () => {};
sandbox.window.removeEventListener = () => {};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const html = fs.readFileSync(path.join(WWW, 'index.html'), 'utf8');
const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
for (const rel of srcs) {
  vm.runInContext(fs.readFileSync(path.join(WWW, rel), 'utf8'), sandbox, { filename: rel });
}

const errors = [];
const trace = [];
function pump(frames) {
  let t = sandbox.performance.now();
  for (let i = 0; i < frames; i++) {
    const q = rafQueue; rafQueue = [];
    if (!q.length) break;
    t += 16.7;
    for (const fn of q) {
      try { fn(t); } catch (e) { errors.push('帧异常: ' + e.stack.split('\n').slice(0, 3).join(' | ')); return; }
    }
  }
}
function step(fn, label) {
  try { fn(); } catch (e) { errors.push('[' + label + '] ' + e.message + '\n    ' + e.stack.split('\n')[1]); }
}
let fightCount = 0;
function note(tag) {
  const s = G.game.save;
  trace.push(
    tag.padEnd(22) + ' 境界 ' + G.Player.realmInfo(s.globalLevel).n.padEnd(6) +
    ' 灵气 ' + String(Math.floor(s.qi)).padStart(6) +
    ' 灵力 ' + String(Math.floor(s.po)).padStart(4) +
    ' 灵石 ' + String(s.stone).padStart(5) +
    ' 战斗 ' + String(fightCount).padStart(3) + ' 场' +
    ' 任务 ' + s.quest.step
  );
}

const G = sandbox.G;
step(() => G.game.start(), 'start');
pump(10);

/* ---- 1) 新档（五行单灵根·木，模拟 reincarnation.finish 的产物） ---- */
const world = G.Data.generateWorld(20240924, true);
const save = {
  life: 1, worldSeed: 20240924, world: world,
  origin: 'herb', originFx: { qi: .08, br: -.04 },
  linggen: { elems: ['木'], coef: { 木: 1.2 }, kind: '五行单', stoneBonus: 0 },
  talents: [], skills: { 缠藤指: { lv: 1 }, 铁布衫: { lv: 1 }, 吐纳术: { lv: 1 } },
  skillEquip: ['缠藤指'],
  items: { 回春丹: 2 }, stone: 50, qi: 100, po: 0,
  globalLevel: 1, age: 16, watch: 0, whispers: 0, escapeLeft: 3,
  quest: { step: 'm0-1', flags: {} },
  scene: 'town', map: 'town', pos: null,
  chestsOpened: [], bossKilled: false
};
G.game.save = save;
note('① 入世');

/* 点门 → 走进对应的室内地图（v0.4 起房屋是可进入的探索空间，不再弹面板） */
const DOOR_TO_MAP = { home: 'town_home', shop: 'town_shop', market: 'town_market' };
function enterDoor(doorId) {
  const sc = G.game.scene;
  let hk = null;
  Object.keys(sc.map.interact).forEach((k) => {
    const o = sc.map.interact[k];
    if (o.type === 'door' && o.id === doorId) hk = hk || k;
  });
  if (!hk) { errors.push('找不到门：' + doorId); return false; }
  const xy = hk.split(',').map(Number);
  sc.overlay = null; sc.dir = 'up';
  save.pos = { x: xy[0], y: xy[1] + 1 };
  sc._interact();
  const want = DOOR_TO_MAP[doorId];
  if (want && G.game.sceneName !== want) {
    errors.push('门 ' + doorId + ' 未走进室内地图 ' + want + '（当前 ' + G.game.sceneName + '）');
    return false;
  }
  pump(4);
  return true;
}
function enterMap(m) {
  save.pos = null;
  G.game.changeScene(m, { toSpawn: true });
  pump(4);
}
/* 走到室内家具前交互：家具的交互点登记在它的每一格上，
   所以要挑一个"站位不被占"的格子（比如床是 3×2，站它正上方那格会卡在床里）。 */
function interactFurn(act, label) {
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
  if (!best) { errors.push('找不到家具动作：' + (label || act)); return false; }
  sc.overlay = null; sc.dir = 'up';
  save.pos = best;
  sc._interact();
  return true;
}
/* 打一场真实战斗：进场景 → 敌方归零 → 真实 _victory */
function fight(params, label) {
  G.game.changeScene('battle', params);
  pump(4);
  const b = G.game.scene;
  b.es.forEach((e) => { e.hp = 0; });
  step(() => b._victory(), 'victory:' + label);
  pump(30);
  fightCount++;
  return b;
}

/* 站在交互点正下方，面朝上触发 */
function interactAt(type, label) {
  const sc = G.game.scene;
  let hk = null;
  Object.keys(sc.map.interact).forEach((k) => {
    const o = sc.map.interact[k];
    if (o.type === type) hk = hk || k;
  });
  if (!hk) { errors.push('找不到交互点：' + (label || type)); return false; }
  const xy = hk.split(',').map(Number);
  sc.overlay = null; sc.dir = 'up';
  save.pos = { x: xy[0], y: xy[1] + 1 };
  sc._interact();
  return true;
}

/* ---- 2) m0-1：进药铺找沈伯听教学 → 进山打赢一场 ---- */
enterMap('town');
step(() => enterDoor('shop'), 'm0-1.shop');
step(() => interactFurn('shenbo', '沈伯'), 'm0-1.shenbo');
pump(4);
step(function () {
  const sc = G.game.scene;
  if (sc.overlay !== 'shenbo1') { errors.push('药铺内未触发沈伯教学：' + sc.overlay); return; }
  sc.buttons[0].onClick();   /* 知道了 */
}, 'm0-1.dialog');
note('② m0-1 教学');

enterMap('field');
fight({ enemy: G.Data.makeEnemy('青纹蛇', 3, '青纹蛇'), mapId: 'field' }, 'm0-1');
save.quest.flags.won1 = true;
note('③ 首战胜利');

enterMap('town');
step(() => enterDoor('shop'), 'm0-1.reward.shop');
step(() => interactFurn('shenbo', '沈伯'), 'm0-1.reward');
pump(4);
if (save.quest.step !== 'm0-2') errors.push('m0-1 未推进到 m0-2（当前 ' + save.quest.step + '）');
note('④ 得灵石 → m0-2');

/* ---- 3) m0-2：走进山神庙 → 杀手战 ---- */
enterMap('field');
step(() => interactAt('ruin', '山神庙'), 'm0-2.temple');
pump(4);
step(function () {
  const sc = G.game.scene;
  if (G.game.sceneName !== 'field_temple') {
    errors.push('山神庙应走进室内地图 field_temple（当前 ' + G.game.sceneName + '）');
    return;
  }
  if (sc.overlay !== 'temple') { errors.push('进门未自动演山神庙剧情：' + sc.overlay); return; }
  sc.buttons[0].onClick();
}, 'm0-2.enter');
pump(6);
step(function () {
  const b = G.game.scene;
  if (G.game.sceneName !== 'battle') { errors.push('迎战后未进战斗（当前 ' + G.game.sceneName + '）'); return; }
  b.es.forEach((e) => { e.hp = 0; });
  b._victory();
}, 'm0-2.killer');
pump(80);   /* _finish 有 0.9 秒演出（约 54 帧）才会真正切场景 */
if (save.quest.step !== 'm0-3') errors.push('杀手战后未推进到 m0-3（当前 ' + save.quest.step + '）');
if (!save.quest.flags.vessel) errors.push('杀手战后未取得逆命珠');
if (G.game.sceneName !== 'field_temple') {
  errors.push('杀手战结束后应留在庙内（当前 ' + G.game.sceneName + '）');
}
note('⑤ 杀手战 → m0-3');

/* ---- 4) m0-3：回镇 → 小院 → 走到逆命珠前 → 珠内梦境（+2500）→ m0-4 ---- */
enterMap('town');
step(() => enterDoor('home'), 'm0-3.home');
step(() => interactFurn('cult', '逆命珠'), 'm0-3.dream');
pump(4);
step(function () {
  const sc = G.game.scene;
  if (sc.overlay !== 'dream') { errors.push('未播珠内梦境：' + sc.overlay); return; }
  sc.buttons[0].onClick();
}, 'm0-3.wake');
pump(4);
if (save.quest.step !== 'm0-4') errors.push('梦境后未推进到 m0-4（当前 ' + save.quest.step + '）');
note('⑥ 珠内梦境 → m0-4');

/* ---- 5) 修炼到淬体九段：走真实突破，刷怪补灵气 ---- */
enterMap('field');
let guard = 0;
while (save.globalLevel < 9 && guard++ < 400) {
  fight({ enemy: G.Data.makeEnemy('赤炎狼', 5, '赤炎狼'), mapId: 'field' }, 'grind');
  save.hp = G.Player.computeStats(save).maxhp;
  const st = G.Player.breakState(save);
  if (st.have >= st.need && !st.big) {
    const r = G.Player.breakthrough(save);
    if (!r.ok) errors.push('刷怪后突破失败：' + r.reason);
  }
}
if (save.globalLevel < 9) errors.push('未能修炼到淬体九段（当前 ' + save.globalLevel + '）');
note('⑦ 淬体九段');

/* 淬体9 → 进药铺找沈伯赠丹 */
enterMap('town');
step(() => enterDoor('shop'), 'm0-4.pill.shop');
step(() => interactFurn('shenbo', '沈伯'), 'm0-4.pill');
pump(4);
if (!save.items['淬体突破丹']) errors.push('m0-4 未获得淬体突破丹');
note('⑧ 沈伯赠丹');

/* 补满灵气以突破 */
enterMap('field');
guard = 0;
while (save.qi < G.Player.needQi(save, 9) && guard++ < 400) {
  fight({ enemy: G.Data.makeEnemy('树精', 6, '树精'), mapId: 'field' }, 'grind2');
  save.hp = G.Player.computeStats(save).maxhp;
}
note('⑨ 灵气备足');

/* ---- 6) 大境界突破 → 心魔战 ---- */
enterMap('town');
step(() => enterDoor('home'), 'm0-4.home');
step(() => interactFurn('cult', '逆命珠'), 'm0-4.cult');
pump(4);
step(function () {
  const sc = G.game.scene;
  if (sc.overlay !== 'cult') { errors.push('小院未进入珠内空间面板：' + sc.overlay); return; }
  const bk = sc.buttons.filter((b) => /问心魔劫|突破境界/.test(b.label))[0];
  if (!bk) { errors.push('小院缺少突破入口'); return; }
  if (bk.disabled) { errors.push('灵气与丹齐备时突破按钮仍禁用'); return; }
  bk.onClick();
}, 'm0-4.break');
pump(6);
step(function () {
  if (G.game.sceneName !== 'battle') { errors.push('突破未进入心魔战（当前 ' + G.game.sceneName + '）'); return; }
  const b = G.game.scene;
  if (b.es.length !== 1) errors.push('心魔战应为单敌，实为 ' + b.es.length + ' 只');
  if (b.es[0].name !== '心魔') errors.push('心魔战敌人异常：' + b.es[0].name);
  b.es[0].hp = 0;
  b._victory();
}, 'm0-4.heartdemon');
pump(40);
if (save.globalLevel !== 10) errors.push('心魔战后应为炼气一重（10），实为 ' + save.globalLevel);
if (save.quest.step !== 'm0-5') errors.push('心魔战后未推进到 m0-5（当前 ' + save.quest.step + '）');
note('⑩ 心魔战 → 炼气一重');

/* ---- 7) 炼气 1 → 3（赤牙洞门槛） ---- */
enterMap('field');
guard = 0;
while (save.globalLevel < 12 && guard++ < 400) {
  fight({ enemy: G.Data.makeEnemy('赤炎狼', 7, '赤炎狼'), mapId: 'field' }, 'grind3');
  save.hp = G.Player.computeStats(save).maxhp;
  const st = G.Player.breakState(save);
  if (st.have >= st.need && !st.big) {
    const r = G.Player.breakthrough(save);
    if (!r.ok) errors.push('炼气期突破失败：' + r.reason);
  }
}
if (save.globalLevel < 12) errors.push('未能修炼到炼气三段（当前 ' + save.globalLevel + '）');
note('⑪ 炼气三段');

/* 赤牙洞门槛 */
enterMap('field');
step(() => interactAt('gate', '赤牙洞入口'), 'm0-5.gate');
pump(6);
if (G.game.sceneName !== 'cave') errors.push('炼气三段仍进不了赤牙洞（当前 ' + G.game.sceneName + '）');
note('⑫ 入赤牙洞');

/* ---- 8) 狼王战 ---- */
step(() => interactAt('boss', '狼王巢'), 'm0-5.boss');
pump(6);
step(function () {
  if (G.game.sceneName !== 'battle') { errors.push('未进入狼王战（当前 ' + G.game.sceneName + '）'); return; }
  const b = G.game.scene;
  if (!b.es[0].boss) errors.push('狼王战敌人不是 boss：' + b.es[0].name);
  b.es.forEach((e) => { e.hp = 0; });
  b._victory();
}, 'm0-5.kill');
pump(40);
if (save.quest.step !== 'free') errors.push('狼王战后未进入自由游玩（当前 ' + save.quest.step + '）');
if (!save.bossKilled) errors.push('狼王击杀标记未写入');
if (!save.items['妖丹']) errors.push('狼王未掉落妖丹');
note('⑬ 击杀狼王 · M0 通关');

/* ---- 报告 ---- */
console.log('\n=== M0 通关链路 ===');
trace.forEach((l) => console.log('  ' + l));
console.log('');
if (errors.length) {
  console.log('=== 通关模拟发现问题 (' + errors.length + ') ===');
  errors.forEach((e) => console.log(' - ' + e));
  process.exit(1);
} else {
  console.log('通关模拟通过：新档 → m0-1..m0-5 → 赤炎狼王，主因果链全程无断点。');
}
