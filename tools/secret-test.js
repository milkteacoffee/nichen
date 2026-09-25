/* 秘术效果系统无头测试：数据层 + 圣术面板 + 神术战斗被动 + 仙术主动施放。
   用法：node tools/secret-test.js
   依据：功法秘术 v2.2 §4.2 + 副本 v3.2 §8.1；数值随品阶（凡1/灵1.5/仙2/道2.5）。 */
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
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }
function check(cond, msg) { if (!cond) errors.push(msg); }

const G = sandbox.G;
G.game.start();
pump(10);

/* 真实开局：难度 → 转世 finish */
const D = G.Data.dungeons;
G.game.changeScene('difficulty');
G.game.scene._choose('normal');
pump(5);
(function () {
  const r = G.game.scene;
  r.originSel = 0;
  r.rollLinggen();
  r.drawTalents();
  r.finish();
})();
pump(10);
const save = G.game.save;

/* ===== 1. 数据层：品阶 / gradeOf / 效果表 ===== */
check(D.secretGrade('fan') === 1, 'secretGrade(fan) 应为1');
check(D.secretGrade('ling') === 1.5, 'secretGrade(ling) 应为1.5');
check(D.secretGrade('xian') === 2, 'secretGrade(xian) 应为2');
check(D.secretGrade('dao') === 2.5, 'secretGrade(dao) 应为2.5');

save.secrets = { a: 2, b: true };
check(D.gradeOf(save, 'a') === 2, 'gradeOf 数值应原样返回');
check(D.gradeOf(save, 'b') === 1, 'gradeOf 布尔应折算1');
check(D.gradeOf(save, 'missing') === 1, 'gradeOf 缺失应折算1');

const effectIds = Object.keys(D.SECRET_EFFECTS);
check(effectIds.length === 15, '秘术效果表应为15道，实为 ' + effectIds.length);
['圣', '神', '仙'].forEach(function (cat) {
  const n = effectIds.filter(function (id) { return D.SECRET_EFFECTS[id].cat === cat; }).length;
  check(n === 5, cat + '术应有5道，实为 ' + n);
});

/* ===== 2. 圣术：面板百分比聚合（数值 × 品阶）===== */
save.secrets = {
  s_dajingang: 1,      /* atk .12 ×1   */
  s_longxiang: 2,      /* atk .08 ×2 = .16 ; hp .10 ×2 = .20 */
  s_taiyi: 1.5,        /* def .15 ×1.5 = .225 */
  x_yufeng: 1,         /* spd .12 ×1   */
  s_bulao: 1           /* hp .15 ×1    */
};
const pct = G.Player.secretPct(save);
check(approx(pct.a, .12 + .16), '圣术攻击百分比异常：' + pct.a);
check(approx(pct.f, .225), '圣术防御百分比异常：' + pct.f);
check(approx(pct.h, .20 + .15), '圣术气血百分比异常：' + pct.h);
check(approx(pct.s, .12), '圣术速度百分比异常：' + pct.s);

/* ===== 3. 神术：战斗被动初始化 ===== */
save.secrets = {
  n_xuehai: 1,         /* vamp .15 */
  x_zhuxie: 1,         /* zhuxie .25 */
  n_kurong: 2,         /* chance .30 pct .08×2=.16 max3 */
  x_4xiang: 1,         /* startShield .20 */
  x_mangshan: 2        /* mangshan 2×2=4 */
};
const enemy = G.Data.makeEnemy('青纹蛇', 3, '青纹蛇');
G.game.changeScene('battle', { enemy: enemy });
pump(5);
const b = G.scenes.battle;
check(approx(b.p._secretVamp, .15), '血海吸血应为.15，实为 ' + b.p._secretVamp);
check(approx(b.p._zhuxie, .25), '诛邪概率应为.25，实为 ' + b.p._zhuxie);
check(b.p._kurongLeft === 3, '枯荣次数应为3，实为 ' + b.p._kurongLeft);
check(b.p._kurong && approx(b.p._kurong.chance, .30), '枯荣触发概率异常');
check(b.p._kurong && approx(b.p._kurong.pct, .16), '枯荣回血比应×品阶=.16，实为 ' + (b.p._kurong && b.p._kurong.pct));
check(b.p._mangshan === 4, '芒山每回合灵力应为4，实为 ' + b.p._mangshan);
const wantShield = Math.round(b.p.maxhp * .20);
check(b.p.shield === wantShield, '四象开局护盾应为 ' + wantShield + '，实为 ' + b.p.shield);

/* 芒山：_endRound 后 save.po 应增加 */
const poBefore = save.po || 0;
b._endRound();
check(save.po === poBefore + 4, '芒山回合回灵异常：' + poBefore + '→' + save.po);

/* ===== 4. 仙术：每场一次主动（self 治疗）===== */
/* 重新进一场干净战斗，给一道治疗仙术 */
save.secrets = { x_9tianxirang: 1 };
G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 3, '青纹蛇') });
pump(5);
const b2 = G.scenes.battle;
b2.p.hp = 10;
b2.p.spd = 9999;                 /* 确保玩家先手，避免出手前被 DOT 击杀 */
b2._castSecret('x_9tianxirang');
pump(60);
check(!!b2.p._secretUsed['x_9tianxirang'], '九天息壤应标记已用');
check(b2.p.hp > 10, '九天息壤自疗应提升气血，仍为 ' + b2.p.hp);
/* 再次施放应被禁用：直接调 _castSecret 会重复标记，故验按钮 disabled */
let healBtn = null;
b2.phase = 'command'; b2._buildCommand(); b2._openSkill();
b2.buttons.forEach(function (bt) { if (bt.label.indexOf('九天息壤') >= 0) healBtn = bt; });
check(healBtn && healBtn.disabled, '已用仙术按钮应禁用');

/* ===== 5. 仙术：单体攻击（九霄雷霆）走完整回合 ===== */
save.secrets = { x_jiuxiao: 1 };
G.game.changeScene('battle', { enemy: G.Data.makeEnemy('青纹蛇', 3, '青纹蛇') });
pump(5);
const b3 = G.scenes.battle;
b3._castSecret('x_jiuxiao');
pump(160);
check(!!b3.p._secretUsed['x_jiuxiao'], '九霄雷霆应标记已用');
check(b3.phase === 'command' || G.game.sceneName !== 'battle',
  '施放后回合应正常结算（phase=' + b3.phase + '）');

/* ===== 报告 ===== */
if (errors.length) {
  console.log('=== 秘术效果测试发现问题 (' + errors.length + ') ===');
  errors.forEach((e) => console.log(' - ' + e));
  process.exit(1);
} else {
  console.log('秘术效果测试通过：品阶/圣术面板/神术被动(吸血·封印·枯荣·护盾·回灵)/仙术主动 全部符合设计。');
}
