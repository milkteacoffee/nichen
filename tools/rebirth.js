/* 无头轮回闭环模拟：第 1 世通关 → 战死 → 轮回殿灌注 → 第 2 世，验证「第二世变强」。
   用法：node tools/rebirth.js
   目的（M0 定义的最后一项：「第二世验证变强」）：
     1) 一世终结时仙力按 v0.4 §4 逐项入账；
     2) 轮回殿五线灌注真实消耗仙力；
     3) 第 2 世是「浮世」（非锚世、新种子、地名重掷）；
     4) 第 2 世开局资源与同等级战力确实高于第 1 世。
   全程走真实场景与真实公式：转世 → 入世 → 战斗/突破 → 战死 → 轮回殿 → 再转世。 */
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

/* 钉死时钟，让「第 2 世变强」这行**可复现**。
   原因：非锚世的世界种子取自 `Date.now()`（`reincarnation.js: var seed = anchor ? 20260924
   : (Date.now() & 0x7fffffff)`），于是第 2 世的落位/调色板等每次跑都可能不同，
   实测 30 次里 28 次「攻击 41→43」、2 次「41→46」——**基线不可复现等于没有基线**。
   必须放在脚本载入**之后**：`G.rng` 的种子在 `rng.js` 载入时就取过真实时间了，
   此处改 `Date.now` 不会回改它，第 1 世（锚世，种子固定 20260924）行为完全不变。 */
const FIXED_NOW = 1774512000000;   /* 2026-09-26T12:00:00+08:00 */
vm.runInContext('Date.now = function () { return ' + FIXED_NOW + '; };', sandbox);

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
/* 注意：死亡结算 enter() 会把当世档置空（G.game.save = null），
   所以 note() 必须容忍空档 —— 此时改从 meta.past 末条读取终局信息。 */
function note(tag) {
  const s = G.game.save;
  if (!s) {
    const past = G.game.meta.past || [];
    const rec = past[past.length - 1];
    if (!rec) { trace.push(tag.padEnd(14) + ' （当世档已清空，且无前世档案）'); return; }
    trace.push(
      tag.padEnd(14) + ' ' + rec.causeName + '　享年 ' + String(rec.age).padStart(2) +
      ' 岁　' + rec.realm.padEnd(8) +
      ' 仙力 +' + String(rec.xianli).padStart(4) +
      '　战斗 ' + String(fightCount).padStart(3) + ' 场'
    );
    return;
  }
  trace.push(
    tag.padEnd(14) + ' 境界 ' + G.Player.realmInfo(s.globalLevel).n.padEnd(6) +
    ' 年龄 ' + String(s.age).padStart(2) +
    ' 灵气 ' + String(Math.floor(s.qi)).padStart(6) +
    ' 灵力 ' + String(Math.floor(s.po)).padStart(4) +
    ' 灵石 ' + String(s.stone).padStart(5) +
    ' 战斗 ' + String(fightCount).padStart(3) + ' 场'
  );
}

const G = sandbox.G;
step(() => G.game.start(), 'start');
pump(10);

/* 两世都锁死同一灵根/无天赋，才能把「变强」归因到仙力灌注本身 */
const FIXED_LG = { kind: '五行', elems: ['木'], coef: { 木: 1.2 }, stoneBonus: 0 };
function rollFixed(scene) {
  scene.rollLinggen();
  scene.linggen = JSON.parse(JSON.stringify(FIXED_LG));
  scene.talentCards = [];
}

/* ================= 第 1 世 ================= */
step(() => G.game.changeScene('reincarnation'), 'reinc1');
pump(6);
step(() => {
  const s = G.game.scene;
  s.originSel = 0;                       /* 农家子弟：体质 +8 勇猛 +3 */
  s.step = 'linggen'; rollFixed(s);
  s.step = 'talent';
  s.finish();
}, 'reinc1.finish');
pump(6);

const life1 = {};
step(() => {
  const s = G.game.save;
  if (!s) { errors.push('第 1 世未生成当世档'); return; }
  life1.seed = s.worldSeed;
  life1.anchor = s.world.anchor;
  life1.names = JSON.parse(JSON.stringify(s.world.names));
  life1.qi = s.qi; life1.po = s.po; life1.stone = s.stone;
  life1.escapeLeft = s.escapeLeft;
}, 'life1.snapshot');

/* 入世断言。幼年阶段（1~15 岁事件卡）已在 v0.5.2 整段删除：
   finish() 直接产出"入世态"，中间不再有 _growUp 这一步。
   这里钉的东西没变，只是产出者从 _growUp 换成了 finish()。 */
step(() => {
  const s = G.game.save;
  if (G.game.sceneName !== 'town') errors.push('入世后应直接进青溪镇，实为 ' + G.game.sceneName);
  if (s.quest.step !== 'm0-1') errors.push('入世后任务应推进到 m0-1，实为 ' + s.quest.step);
  if (s.age !== 16) errors.push('入世年龄应为 16，实为 ' + s.age);
  if (s.maxGlobalLevel !== 1) errors.push('入世应初始化 maxGlobalLevel');
  if (!(s.chronicle || []).some((c) => c.id === 'birth')) errors.push('入世未写入大事记');
}, 'life1.enter');
note('第 1 世入世');

/* ===== 交互助手：把主角摆到指定交互物正前方并走真实的 _interact() =====
   直接调 hooks.onInteract 拿不到闭包，所以照玩家操作的方式触发。
   家具用第三个参数 act 匹配（家具的 id 是 'counter'/'vessel' 这种，act 才是行为）。 */
function interactWith(type, id, act) {
  const sc = G.game.scene;
  const map = sc.map;
  if (!map || !map.interact) { errors.push(G.game.sceneName + ' 无交互物表'); return false; }
  let tk = null;
  Object.keys(map.interact).forEach((k) => {
    if (tk) return;
    const o = map.interact[k];
    if (o.type !== type) return;
    if (id && o.id !== id) return;
    if (act && o.act !== act) return;
    tk = k;
  });
  if (!tk) {
    errors.push('场景 ' + G.game.sceneName + ' 未找到交互物 '
      + type + (id ? '/' + id : '') + (act ? '#' + act : ''));
    return false;
  }
  const c = tk.split(',');
  G.game.save.pos = { x: Number(c[0]) - 1, y: Number(c[1]) };
  sc.dir = 'right'; sc.overlay = null; sc.moving = false; sc.path = [];
  sc._interact();
  return true;
}
/* 按标签正则点击当前覆盖层按钮 */
function clickBtn(re, label) {
  const sc = G.game.scene;
  const b = (sc.buttons || []).find((x) => re.test(x.label || ''));
  if (!b) { errors.push('未找到按钮：' + label); return false; }
  b.onClick();
  return true;
}

/* 真实战斗：只把敌血置零跳过随机性，奖励/突破/任务全走真代码 */
function fight(params) {
  G.game.changeScene('battle', params);
  pump(4);
  const b = G.game.scene;
  b.es.forEach((e) => { e.hp = 0; });
  step(() => b._victory(), 'victory');
  pump(30);
  fightCount++;
}

/* ---- m0-1 沈伯教学：走进药铺找沈伯 → 进山打赢 1 场 → 回镇领灵石 50 并解锁 m0-2 ---- */
step(() => G.game.changeScene('town'), 'town');
pump(6);
step(() => interactWith('door', 'shop'), 'shop.open');     /* 门 → 走进药铺室内 */
step(() => {
  if (G.game.sceneName !== 'town_shop') {
    errors.push('药铺门应走进室内地图 town_shop，实为 ' + G.game.sceneName);
    return;
  }
  interactWith('furn', null, 'shenbo');                    /* 柜台后的沈伯 */
}, 'shenbo.talk');
step(() => {
  const sc = G.game.scene;
  if (sc.overlay !== 'shenbo1') { errors.push('药铺未开沈伯教学覆盖层，实为 ' + sc.overlay); return; }
  clickBtn(/知道了/, '沈伯教学 · 知道了');
}, 'shenbo1.ack');
pump(4);
note('沈伯交代首战');

step(() => G.game.changeScene('field'), 'field');
pump(6);
step(() => fight({ enemy: G.Data.makeEnemy('青纹蛇', 2, '青纹蛇'), mapId: 'field' }),
  'first.blood');
step(() => {
  const s = G.game.save;
  if (!s.quest.flags.won1) errors.push('m0-1 首战后未置 won1（主线会永久卡死在 m0-1）');
  if (s.quest.step !== 'm0-1') errors.push('首战不应直接推进任务，实为 ' + s.quest.step);
}, 'won1.check');
note('进山首战告捷');

step(() => G.game.changeScene('town'), 'town2');
pump(6);
step(() => interactWith('door', 'shop'), 'shop.again');
step(() => interactWith('furn', null, 'shenbo'), 'shenbo.reward');
pump(4);
step(() => {
  const s = G.game.save;
  if (s.quest.step !== 'm0-2') errors.push('回访沈伯后任务应到 m0-2，实为 ' + s.quest.step);
}, 'm0-2.check');
note('沈伯指路山神庙');

/* ---- 山神庙：走进庙里 → 血煞教杀手 → 逆命珠（m0-2 → m0-3） ---- */
step(() => G.game.changeScene('field'), 'field2');
pump(6);
step(() => interactWith('ruin', 'temple'), 'temple.open');
step(() => {
  const sc = G.game.scene;
  if (G.game.sceneName !== 'field_temple') {
    errors.push('山神庙应走进室内地图 field_temple，实为 ' + G.game.sceneName);
    return;
  }
  if (sc.overlay !== 'temple') { errors.push('进门未自动演山神庙剧情，实为 ' + sc.overlay); return; }
  clickBtn(/迎战/, '血煞教杀手 · 迎战');
}, 'temple.fight');
pump(6);
step(() => {
  if (G.game.sceneName !== 'battle') { errors.push('未进入杀手战，实为 ' + G.game.sceneName); return; }
  const b = G.game.scene;
  b.es.forEach((e) => { e.hp = 0; });
  b._victory();
}, 'killer.win');
pump(80);   /* _finish 有 0.9 秒演出才会真正切场景 */
step(() => {
  const s = G.game.save;
  if (s.quest.step !== 'm0-3') errors.push('杀手战后任务应到 m0-3，实为 ' + s.quest.step);
  if (!(s.chronicle || []).some((c) => c.id === 'vessel')) errors.push('杀手战后未记下逆命珠大事');
  if (G.game.sceneName !== 'field_temple') {
    errors.push('杀手战结束后应留在庙内，实为 ' + G.game.sceneName);
  }
}, 'vessel.check');
note('山神庙得逆命珠');

/* ---- 沈家小院 → 走到逆命珠前 → 珠内空间梦境点化（m0-3 → m0-4） ---- */
step(() => G.game.changeScene('town'), 'town3');
pump(6);
step(() => interactWith('door', 'home'), 'home.open');
step(() => {
  if (G.game.sceneName !== 'town_home') {
    errors.push('小院门应走进室内地图 town_home，实为 ' + G.game.sceneName);
    return;
  }
  interactWith('furn', 'vessel');                          /* 珠就供在屋里 */
}, 'cult.open');
pump(6);
step(() => {
  const sc = G.game.scene;
  if (sc.overlay !== 'dream') { errors.push('未播珠内梦境，实为 ' + sc.overlay); return; }
  clickBtn(/醒来/, '珠内梦境 · 醒来');
}, 'dream.wake');
pump(4);
step(() => {
  const s = G.game.save;
  if (s.quest.step !== 'm0-4') errors.push('梦境后任务应到 m0-4，实为 ' + s.quest.step);
  if (!(s.chronicle || []).some((c) => c.id === 'dream')) errors.push('未记下珠内梦境大事');
}, 'dream.check');
note('珠内梦境点化');

/* ---- 刷到炼气三段（大境界用商店可购的突破丹打通，与 playthrough 一致） ---- */
const save1 = G.game.save;
let guard = 0;
while (save1.globalLevel < 12 && guard++ < 400) {
  fight({ enemy: G.Data.makeEnemy('赤炎狼', 7, '赤炎狼'), mapId: 'field' });
  save1.hp = G.Player.computeStats(save1).maxhp;
  const st = G.Player.breakState(save1);
  if (st.have < st.need) continue;
  if (!st.big) { G.Player.breakthrough(save1); continue; }
  save1.items[st.pill] = (save1.items[st.pill] || 0) + 1;   /* 药铺有售 */
  const r = G.Player.startBigBreak(save1);
  if (!r.ok) { errors.push('大境界突破被拒：' + r.reason); break; }
  G.game.changeScene('battle', { script: 'heartDemon', mapId: 'town' });
  pump(4);
  const b = G.game.scene;
  b.es[0].hp = 0;
  step(() => b._victory(), 'heartDemon');
  pump(30);
  fightCount++;
}
step(() => {
  if (save1.globalLevel < 12) errors.push('未能修至炼气三段，实为 ' + save1.globalLevel);
  if (save1.quest.step !== 'm0-5') errors.push('破境后任务应到 m0-5，实为 ' + save1.quest.step);
}, 'life1.grind');
note('修至炼气三段');

/* 记录第 1 世「同等级战力」基准。
   必须放在狼王战之前：狼王会掉一本功法，而第 2 世开局没有这本，
   若在狼王后取基准，两世功法就不一致，「变强」会被功法差污染。 */
const life1Stats = {};
step(() => {
  const st = G.Player.computeStats(save1);
  life1Stats.atk = st.atk; life1Stats.def = st.def;
  life1Stats.hp = st.maxhp; life1Stats.spd = st.spd;
  life1Stats.level = save1.globalLevel;
}, 'life1.stats');

/* ---- 赤牙洞：赤炎狼王（m0-5）→ 首领击杀计数 ---- */
step(() => G.game.changeScene('cave'), 'cave');
pump(6);
step(() => interactWith('boss'), 'boss.open');
pump(6);
step(() => {
  if (G.game.sceneName !== 'battle') { errors.push('未进入狼王战，实为 ' + G.game.sceneName); return; }
  const b = G.game.scene;
  b.es.forEach((e) => { e.hp = 0; });
  b._victory();
}, 'wolfKing.win');
pump(40);
step(() => {
  const s = G.game.save;
  if (s.bossKills !== 1) errors.push('狼王击杀数应为 1，实为 ' + s.bossKills);
  if (!(s.chronicle || []).some((c) => c.id === 'wolfKing')) errors.push('未记下手刃狼王大事');
}, 'wolfKing.check');
note('手刃赤炎狼王');

/* 战死：真实 _defeat 路径 → 死亡结算 */
step(() => {
  G.game.changeScene('battle', {
    enemy: G.Data.makeEnemy('赤炎狼', 30, '赤炎狼'), mapId: 'field'
  });
}, 'death.enter');
pump(6);
step(() => {
  const b = G.game.scene;
  b.p.hp = 0;
  b._defeat();
}, 'defeat');
pump(120);

step(() => {
  if (G.game.sceneName !== 'heaven') {
    errors.push('战死后应先入天道拦魂，实为 ' + G.game.sceneName);
    return;
  }
  /* 走完拦魂三轮（模板模式同步返回）→ 入死亡结算 */
  const hv = G.scenes.heaven;
  hv._reply('（默然）');
  hv._reply('（默然）');
  hv._finish();
}, 'heaven.pass');
pump(4);

step(() => {
  if (G.game.sceneName !== 'death') {
    errors.push('拦魂后应进入死亡结算，实为 ' + G.game.sceneName);
    return;
  }
  const m = G.game.meta;
  if (!m.past.length) { errors.push('死亡结算未写入前世档案'); return; }
  const rec = m.past[m.past.length - 1];
  const d = rec.detail;
  if (rec.cause !== 'war') errors.push('死因应为战死，实为 ' + rec.cause);
  if (d.realm !== 10 * rec.level) errors.push('境界仙力与等级不符');
  if (d.kill !== 30 * 1) errors.push('击杀仙力应为 30（本世斩狼王 1 次），实为 ' + d.kill);
  if (d.age !== Math.max(0, rec.age - 15) * 2) errors.push('年岁仙力与享年不符');
  if (!(d.skill > 0)) errors.push('功法仙力应 > 0（三本功法均 Lv1）');
  if (rec.xianli !== d.total) errors.push('档案仙力与明细不一致');
  if (!(m.xianli >= d.total)) errors.push('可用仙力未入账');
  if (!rec.chronicle.length) errors.push('走马灯为空');
  life1.xianli = d.total;
  life1.rec = rec;
}, 'death.check');
step(() => {
  const rec = life1.rec;
  if (!rec) return;
  const ids = rec.chronicle.map((c) => c.id);
  ['birth', 'vessel', 'dream', 'wolfKing'].forEach((k) => {
    if (ids.indexOf(k) < 0) errors.push('走马灯缺少大事：' + k);
  });
  if (rec.chronicle.length > 8) errors.push('走马灯超过 8 条：' + rec.chronicle.length);
}, 'death.chronicle');
note('战死结算');

/* ================= 轮回殿：五线灌注 ================= */
step(() => G.game.changeScene('hall'), 'hall');
pump(6);
step(() => {
  const h = G.game.scene;
  const rows = h.buttons.filter((b) => b.label === '');
  if (rows.length !== 5) { errors.push('轮回殿应有 5 条灌注线，实为 ' + rows.length); return; }
  const before = G.game.meta.xianli;
  let spent = 0;
  for (let i = 0; i < rows.length; i++) {
    const cost = 20;                       /* Lv0 → Lv1 固定 20 */
    if (G.game.meta.xianli < cost) { errors.push('仙力不足以灌注第 ' + (i + 1) + ' 线'); break; }
    rows[i].onClick();
    spent += cost;
  }
  if (before - G.game.meta.xianli !== spent) {
    errors.push('灌注扣费不符：扣了 ' + (before - G.game.meta.xianli) + '，应 ' + spent);
  }
  const pf = G.game.meta.perfusion;
  ['body', 'qi', 'po', 'stone', 'rescue'].forEach((k) => {
    if (pf[k] !== 1) errors.push('第 ' + k + ' 线应为 Lv1，实为 ' + pf[k]);
  });
}, 'hall.perfuse');
pump(6);
note('五线各灌注一级');

/* ================= 第 2 世 ================= */
step(() => G.game.changeScene('reincarnation'), 'reinc2');
pump(6);
step(() => {
  const s = G.game.scene;
  s.originSel = 0;                       /* 同出身，排除出身百分比差异 */
  s.step = 'linggen'; rollFixed(s);
  s.step = 'talent';
  s.finish();
}, 'reinc2.finish');
pump(6);

step(() => {
  const s = G.game.save;
  if (!s) { errors.push('第 2 世未生成当世档'); return; }
  if (s.life !== 2) errors.push('第 2 世 life 应为 2，实为 ' + s.life);
  if (s.world.anchor !== false) errors.push('第 2 世不应是锚世');
  if (s.worldSeed === life1.seed) errors.push('第 2 世世界种子与第 1 世相同');
  if (s.quest.step !== 'm0-1') errors.push('第 2 世应直接入世（m0-1），实为 ' + s.quest.step);
  if (s.maxGlobalLevel !== 1) errors.push('第 2 世应重置 maxGlobalLevel');
  if (s.bossKills !== 0) errors.push('第 2 世应重置首领击杀数');
  /* finish() 现在自己就写「入世」这条大事记（幼年阶段没了，没人替它写），
     所以新一世的大事记不是空的，而是恰好一条 birth。 */
  var ch = s.chronicle || [];
  if (ch.length !== 1 || ch[0].id !== 'birth') {
    errors.push('第 2 世大事记应只有「入世」一条，实为 ' + ch.length + ' 条');
  }
  if (s.age !== 16) errors.push('第 2 世应从 16 岁入世，实为 ' + s.age);
}, 'life2.fresh');

/* 灌注兑现：资源侧 */
step(() => {
  const s = G.game.save, pf = G.game.meta.perfusion;
  if (s.qi !== 100 + pf.qi * 120) {
    errors.push('灵息灌注未兑现：qi=' + s.qi + '，应 ' + (100 + pf.qi * 120));
  }
  if (s.po !== pf.po * 12) errors.push('魂力灌注未兑现：po=' + s.po);
  if (s.escapeLeft !== 3 + pf.rescue) errors.push('遁法灌注未兑现：' + s.escapeLeft);
  if (!(s.stone >= pf.stone * 60)) errors.push('财禄灌注未兑现：stone=' + s.stone);
  if (!(s.qi > life1.qi)) errors.push('第 2 世开局灵气应高于第 1 世');
  if (!(s.po > life1.po)) errors.push('第 2 世开局灵力应高于第 1 世');
  if (!(s.stone > life1.stone)) errors.push('第 2 世开局灵石应高于第 1 世');
  if (!(s.escapeLeft > life1.escapeLeft)) errors.push('第 2 世遁走次数应高于第 1 世');
}, 'life2.resources');

/* 灌注兑现：战力侧（同等级、同灵根、同功法、同出身 → 差值只可能来自仙躯） */
step(() => {
  const s2 = G.game.save;
  const tmp = JSON.parse(JSON.stringify(s2));
  tmp.globalLevel = life1Stats.level;
  const l2 = G.Player.computeStats(tmp);
  const diffs = [
    ['攻击', l2.atk - life1Stats.atk],
    ['防御', l2.def - life1Stats.def],
    ['气血', l2.maxhp - life1Stats.hp],
    ['速度', l2.spd - life1Stats.spd]
  ];
  diffs.forEach(function (d) {
    if (d[1] <= 0) errors.push('第 2 世同级 ' + d[0] + ' 未变强（差值 ' + d[1] + '）');
  });
  life1Stats.l2 = l2;
}, 'life2.stronger');

/* 浮世生成：同种子可复现，不同种子确实换世 */
step(() => {
  const a = G.Data.generateWorld(11, false);
  const b = G.Data.generateWorld(11, false);
  if (a.names.town !== b.names.town) errors.push('同种子的浮世应可复现');
  const c = G.Data.generateWorld(12, false);
  const d = G.Data.generateWorld(13, false);
  const diff = (c.names.town !== d.names.town) || (c.names.mountain !== d.names.mountain)
    || (c.names.cave !== d.names.cave) || (c.xiang !== d.xiang);
  if (!diff) errors.push('不同种子应生成不同世界');
}, 'world.seed');

/* ================= 报告 ================= */
console.log('\n=== 轮回闭环模拟 ===');
trace.forEach((l) => console.log('  ' + l));
if (life1.rec) {
  const r = life1.rec, d = r.detail;
  console.log('\n  第 1 世终结：' + r.causeName + '　享年 ' + r.age + ' 岁　' + r.realm);
  console.log('    仙力明细  境界 ' + d.realm + '　功法 ' + d.skill + '　击杀 ' + d.kill
    + '　年岁 ' + d.age + '　成就 ' + d.achieve + (d.mul !== 1 ? '　善终 ×' + d.mul : ''));
  console.log('    仙力合计  +' + d.total);
  if (d.achieveList.length) {
    console.log('    轮回成就  ' + d.achieveList.map((a) => a.n + '+' + a.xianli).join('　'));
  }
  console.log('    走马灯    ' + r.chronicle.map((c) => c.t + '岁 ' + c.s).join(' · '));
}
if (life1Stats.l2) {
  console.log('\n  第 2 世变强（同 ' + G.Player.realmInfo(life1Stats.level).n + '）：'
    + '攻击 ' + life1Stats.atk + '→' + life1Stats.l2.atk
    + '　防御 ' + life1Stats.def + '→' + life1Stats.l2.def
    + '　气血 ' + life1Stats.hp + '→' + life1Stats.l2.maxhp
    + '　速度 ' + life1Stats.spd + '→' + life1Stats.l2.spd);
}
console.log('');
if (errors.length) {
  console.log('=== 轮回闭环发现问题 (' + errors.length + ') ===');
  errors.forEach((e) => console.log(' - ' + e));
  process.exit(1);
}
console.log('轮回闭环通过：一世终结算 → 五线灌注 → 浮世重生，第 2 世确已变强。');
