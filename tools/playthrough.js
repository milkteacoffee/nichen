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
/* 破境成功率是**随机**的（`Player.startBigBreak` 走 `Math.random`，85% 起）。
   契约若真采样，跑 10 次会有 1 次破境失败 → 主线整条走不下去，
   变成"偶尔红"的假红。回归脚本要的是**确定性**，所以把 `Math.random` 钉死成必然成功。
   ⚠️ 与 `rebirth.js` 钉 `Date.now` 同理：**必须在脚本载入之后**再钉，
      否则会改到 `G.rng` 的初始种子（种子里掺了真实时间），污染既有的世界生成基线。 */
vm.runInContext('Math.random = function () { return 0; };', sandbox);
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
  /* ⚠️ label 以前**根本没被使用** —— 实现是"取第一个同类交互点"。
     一张图只有一道门时看不出问题；v0.42.0 给野外加了第二道 gate（宗门山门）之后，
     'gate' 的第一个交互点变成了山门，于是"入赤牙洞"这一步走进了宗门山门，
     报出的却是一串**看不出根因**的错（未进入狼王战 / 狼王未掉落妖丹）。
     现在按 label 匹配（双向包含，'赤牙洞入口' 能匹配到 '赤牙洞'），匹配不到才退回第一个。 */
  let first = null, hit = null;
  Object.keys(sc.map.interact).forEach((k) => {
    const o = sc.map.interact[k];
    if (o.type !== type) return;
    if (!first) first = k;
    const nm = (o.s && o.s.label) || o.id || '';
    if (!hit && label && nm && (nm.indexOf(label) >= 0 || label.indexOf(nm) >= 0)) hit = k;
  });
  const hk = hit || first;
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

/* ---- 5) 修炼到淬体九段：走真实突破，灵气**只能靠闭关打坐** ----
   v0.67.0（用户第 28 点）：「取消打怪升级获取灵气…升级人物角色只能通过闭关打坐」。
   ⚠️ **v0.76.0 阶段十改了回来**：野外战斗恢复给灵气，但效率低于闭关
      （野外 30×L，闭关约 60% 基准）—— 设计上是"探索有收益、但闭关仍是主力"。
      所以旧断言「野怪不该再给灵气」已作废，改为断言**收益方向**：
      野外给灵气、且**明显少于**同境界闭关一次的量（否则"闭关为主"的设计被架空）。 */
enterMap('field');
const qiBeforeFight = save.qi;
fight({ enemy: G.Data.makeEnemy('赤炎狼', 5, '赤炎狼'), mapId: 'field' }, 'grind');
const qiFromFight = save.qi - qiBeforeFight;
/* ⚠️ 判据只断**方向与量级**，不拿"当前小阶需求"当分母 ——
   gl 很低时 needQi 只有个位数（gl=1 时是 2），任何正常奖励都会被判超标（假红）。
   这里用**敌人等级**折算的上界：野外单场 ≈ 30×L×境界系数，留 2 倍余量。
   要验的是"野外给灵气、但不是印钞机"，比值精确与否不影响这条结论。 */
if (qiFromFight <= 0) {
  errors.push('野外战斗应给灵气（v0.76.0 阶段十恢复）：' + qiBeforeFight + ' → ' + save.qi);
}
{
  const cap = 30 * 5 * 2;      /* L=5 的敌人 × 2 倍余量 */
  if (qiFromFight > cap) {
    errors.push('野外灵气(' + qiFromFight + ') 超出上界 ' + cap
      + ' —— 野外只是辅助，不该盖过闭关（v0.76.0 设计口径）');
  }
}
note('⑦a 野怪已不再产灵气');

let guard = 0;
while (save.globalLevel < 36 && guard++ < 400) {
  save.hp = G.Player.computeStats(save).maxhp;
  const st = G.Player.breakState(save);
  if (st.have >= st.need && !st.big) {
    const r = G.Player.breakthrough(save);
    if (!r.ok) errors.push('闭关补齐后突破失败：' + r.reason);
    continue;
  }
  /* 真实闭关入口：走 G.Time.meditate（内部取 needQi，不另算一套）。
     ⚠️ v0.75.0 起闭关收益**整组 ÷2**（用户口径「闭关灵气太多、太容易破境」），
        旧脚本用「闭关三月」×400 次已**补不满**（且每次耗 90 日 → 先把寿元坐光，
        报的是"寿元不足（需 90 日，尚余 0 时）"）。
        改用**档位随剩余寿元自适应**：优先长档（每岁收益更高，理性玩家的真实选择），
        坐不下当前档就退一档。这样既跟得上新数值，也顺带把"长档更划算"这条设计跑实了。 */
  const left = G.Player.lifespanLeft(save);
  const tierPick = left >= 10 ? 'y10' : left >= 1 ? 'y1' : 'm3';
  const med = G.Time.meditate(save, tierPick);
  if (!med.ok) { errors.push('闭关失败：' + med.reason); break; }
}
if (save.globalLevel < 36) errors.push('未能修炼到淬体九重巅峰（当前 ' + save.globalLevel + '）');
note('⑦ 淬体九重巅峰');

/* 淬体9 → 进药铺找沈伯赠丹 */
enterMap('town');
step(() => enterDoor('shop'), 'm0-4.pill.shop');
step(() => interactFurn('shenbo', '沈伯'), 'm0-4.pill');
pump(4);
if (!save.items['淬体突破丹']) errors.push('m0-4 未获得淬体突破丹');
note('⑧ 沈伯赠丹');

/* 补满灵气以突破（依旧走闭关，不刷怪）
   ⚠️ 同 ⑦：÷2 后要更多灵气，档位按剩余寿元自适应（见上）。 */
guard = 0;
while (save.qi < G.Player.needQi(save, 36) && guard++ < 400) {
  const left2 = G.Player.lifespanLeft(save);
  const tier2 = left2 >= 10 ? 'y10' : left2 >= 1 ? 'y1' : 'm3';
  const med = G.Time.meditate(save, tier2);
  if (!med.ok) { errors.push('补气闭关失败：' + med.reason); break; }
}
note('⑨ 灵气备足');

/* ---- 6) 大境界突破 → 天劫镜像战（v0.75.0；Math.random 钉死 0 → 必触发天劫）----
   ⚠️ v0.76.0 起大境界是**进度累积制**：第一次必失败（+50% 进度、扣丹、气血减半），
      第二次（进度≥100%）必定成功。所以这里要**重试**，第一次失败不算 bug。
      补丹在循环里做（每次突破消耗一颗）。 */
enterMap('town');
step(() => enterDoor('home'), 'm0-4.home');
step(() => interactFurn('cult', '逆命珠'), 'm0-4.cult');
pump(4);
step(function () {
  const sc = G.game.scene;
  if (sc.overlay !== 'cult') { errors.push('小院未进入珠内空间面板：' + sc.overlay); return; }
  /* ⚠️ 按钮文案已统一成「突破」两字（v0.25.0）——旧正则 /问心魔劫|突破境界/ 匹配不上了 */
  const bk = sc.buttons.filter((b) => /突破/.test(b.label))[0];
  if (!bk) { errors.push('小院缺少突破入口'); return; }
  if (bk.disabled) { errors.push('灵气与丹齐备时突破按钮仍禁用'); return; }
  bk.onClick();
  /* ⚠️ v0.76.0 进度累积制：第一次点必失败（+50% 进度**并关闭面板**），
     补丹后要**重开面板**再点一次才会成功。旧写法只补丹不重开 → 面板已关、
     循环立刻 break，表现就是"突破未进入破境战"。
     终止条件按**真实结果**判：进了天劫覆盖层（tribulation）或战斗，或已升境。 */
  let t = 0;
  while (t++ < 4) {
    const saved = G.game.save;
    if (G.game.scene.overlay === 'tribulation' || G.game.sceneName === 'battle'
      || saved.globalLevel >= 37) break;
    saved.items['淬体突破丹'] = (saved.items['淬体突破丹'] || 0) + 1;
    sc.clearOverlay();
    interactFurn('cult', '逆命珠');
    pump(3);
    const b2 = (G.game.scene.buttons || []).filter((b) => /突破/.test(b.label))[0];
    if (!b2 || b2.disabled) break;
    b2.onClick();
    pump(3);
  }
}, 'm0-4.break');
pump(6);
/* 破境天劫（v0.26.0）：大境突破会**先演天劫 + 天道问话**，点「承受」才进心魔战。
   ⚠️ 测试必须跟着新流程走 —— 不点的话就永远停在覆盖层上，后面全线报错。 */
step(function () {
  const sc = G.game.scene;
  if (sc.overlay !== 'tribulation') return;
  for (let i = 0; i < 80 && sc.trib && !sc.trib.asked; i++) sc.update(0.04);
  const ok = (sc.buttons || []).filter((b) => /承/.test(b.label || ''))[0];
  if (!ok) { errors.push('天劫问话段没有「承受」按钮'); return; }
  ok.onClick();
}, 'm0-4.tribulation');
pump(6);
step(function () {
  if (G.game.sceneName !== 'battle') { errors.push('突破未进入破境战（当前 ' + G.game.sceneName + '）'); return; }
  const b = G.game.scene;
  if (b.es.length !== 1) errors.push('破境战应为单敌，实为 ' + b.es.length + ' 只');
  /* v0.75.0：大境界破境有**两条分支**（用户口径「不一定会触发天劫」）：
       · 天劫镜像（`storm`）→ 敌人名「天劫」，面板逐项等于主角
       · 天道未降劫 → 直接破镜，不进战斗（这条分支由 overlays 短路，走不到这里）
     所以走到战斗时**只可能是天劫**；心魔是 M0/M1 剧情战，不由本路径进入。 */
  if (b.es[0].name !== '天劫') errors.push('破境战敌人异常：' + b.es[0].name);
  b.es[0].hp = 0;
  b._victory();
}, 'm0-4.tribulation.battle');
pump(40);
if (save.globalLevel !== 37) errors.push('心魔战后应为炼气一重初期（37），实为 ' + save.globalLevel);
if (save.quest.step !== 'm0-5') errors.push('心魔战后未推进到 m0-5（当前 ' + save.quest.step + '）');
note('⑩ 天劫战 → 炼气一重');

/* ---- 7) 炼气 1 → 3（赤牙洞门槛）：同样**只能闭关**（v0.67.0） ---- */
enterMap('field');
guard = 0;
while (save.globalLevel < 45 && guard++ < 400) {
  save.hp = G.Player.computeStats(save).maxhp;
  const st = G.Player.breakState(save);
  if (st.have >= st.need && !st.big) {
    const r = G.Player.breakthrough(save);
    if (!r.ok) errors.push('炼气期突破失败：' + r.reason);
    continue;
  }
  const left3 = G.Player.lifespanLeft(save);
  const tier3 = left3 >= 10 ? 'y10' : left3 >= 1 ? 'y1' : 'm3';
  const med = G.Time.meditate(save, tier3);
  if (!med.ok) { errors.push('炼气期闭关失败：' + med.reason); break; }
}
if (save.globalLevel < 45) errors.push('未能修炼到炼气三重（当前 ' + save.globalLevel + '）');
note('⑪ 炼气三重');

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
/* M0 收束后主线不再停在 'free'：M1 起斩狼王直接接「m1-1 归镇辨丹」。
   'free' 只剩"旧存档 / 无处可去"的兜底态，不再是 M0 的正常出口。 */
if (save.quest.step !== 'm1-1') errors.push('狼王战后未进入 M1 主线（当前 ' + save.quest.step + '）');
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
