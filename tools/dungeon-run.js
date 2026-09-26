/* 无头副本全流程模拟：真实走完 凡界5本 → 飞升灵界 → 灵界5本 → 飞升仙界。
   用法：node tools/dungeon-run.js
   验证：关卡结构（大9/小5）、Boss gl（大=锚/中=锚−2/头领=锚）、
        首杀签名秘术、第5槽通关飞升与秘境重抽，全部走真实代码路径。 */
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
function step(fn, label) {
  try { fn(); } catch (e) { errors.push('[' + label + '] ' + e.message); }
}

const G = sandbox.G;
step(() => G.game.start(), 'start');
pump(10);

/* ===== 结构断言：关卡类型序列 ===== */
const D = G.Data.dungeons;
D.ARCH.forEach(function (a) {
  if (a.kind === 'big') {
    const seq = [];
    for (let s = 1; s <= 9; s++) seq.push(D.stageType(a, s));
    const want = ['trash','trash','elite','trash','mid','rest','elite','trash','big'];
    if (JSON.stringify(seq) !== JSON.stringify(want))
      errors.push(a.id + ' 大副本关型序列错误：' + seq.join(','));
  } else {
    const seq = [];
    for (let s = 1; s <= 5; s++) seq.push(D.stageType(a, s));
    const want = ['trash','elite','trash','elite','leader'];
    if (JSON.stringify(seq) !== JSON.stringify(want))
      errors.push(a.id + ' 小副本关型序列错误：' + seq.join(','));
  }
});

/* ===== 结构断言：Boss gl（凡界槽0，锚9）===== */
(function () {
  const a = D.archById('B1');
  const big = D.makeBoss(a, 'fan', 0, 'normal', 'big');
  const mid = D.makeBoss(a, 'fan', 0, 'normal', 'mid');
  const s1 = D.archById('S1');
  const leader = D.makeBoss(s1, 'fan', 0, 'normal', 'leader');
  if (big.level !== 9) errors.push('大Boss gl 应为锚9，实为 ' + big.level);
  if (mid.level !== 7) errors.push('小Boss gl 应为锚−2=7，实为 ' + mid.level);
  if (leader.level !== 9) errors.push('头领 gl 应为锚9，实为 ' + leader.level);
})();

/* ===== 真实开局：难度 → 转世 finish ===== */
step(() => G.game.changeScene('difficulty'), 'to-difficulty');
step(() => G.game.scene._choose('normal'), 'choose-normal');
pump(5);
if (G.game.sceneName !== 'reincarnation') errors.push('选难度后未进转世（当前 ' + G.game.sceneName + '）');
step(function () {
  const r = G.game.scene;
  r.originSel = 0;
  r.rollLinggen();
  r.drawTalents();
  r.finish();
}, 'reincarnation-finish');
pump(10);
if (G.game.sceneName !== 'town') errors.push('入世后未进镇（当前 ' + G.game.sceneName + '）');
const save = G.game.save;
if (!Array.isArray(save.dungeonSet) || save.dungeonSet.length !== 5)
  errors.push('入世未抽得5副本序列：' + save.dungeonSet);

/* ===== 战斗胜利：敌方归零 → 真实 _victory → 等 _finishDungeon ===== */
function winBattle() {
  const b = G.game.scene;
  if (G.game.sceneName !== 'battle') { errors.push('期望战斗场景，实为 ' + G.game.sceneName); return; }
  b.es.forEach((e) => { e.hp = 0; });
  b._victory();
  pump(70);
}

/* 清空指定槽位副本（含休整/通关/飞升） */
function clearDungeon(slot) {
  const d = G.scenes.dungeon;
  step(() => d._startOrResume(slot), 'start-slot-' + slot);
  pump(5);
  let guard = 0;
  while (guard++ < 300) {
    if (G.game.sceneName === 'battle') { winBattle(); continue; }
    if (G.game.sceneName === 'dungeon') {
      const sc = G.game.scene;
      if (sc.view === 'brief') { step(() => sc._continue(), 'continue'); pump(8); continue; }
      /* 每层三选一（v0.23.0）：非终层通关后会先出这个视图。
         测试必须跟着新流程走 —— 不处理的话循环直接 break，整条链路假死。 */
      if (sc.view === 'buff') {
        step(() => sc._takeBuff(sc.buffPick[0].id), 'buff'); pump(8); continue;
      }
      if (sc.view === 'hub') break;
    }
    break;
  }
  return guard;
}

function secretCount() { return Object.keys(G.game.save.secrets || {}).length; }

/* ===== 凡界 5 本 ===== */
console.log('=== 凡界秘境 ===');
for (let i = 0; i < 5; i++) {
  const archId = save.dungeonSet[i];
  const arch = D.archById(archId);
  const before = secretCount();
  const expectDelta = save.secrets[arch.drop] ? 0 : 1;
  const g = clearDungeon(i);
  console.log('  槽' + (i + 1) + ' ' + arch.n +
    '（' + (arch.kind === 'big' ? '大' : '小') + '）通关　秘术 ' +
    before + '→' + secretCount() + '　步数 ' + g);
  if (secretCount() !== before + expectDelta)
    errors.push(archId + ' 秘术增量异常，期望 +' + expectDelta +
      '（' + before + '→' + secretCount() + '）');
}
/* 第5槽通关即触发飞升：slot 已随飞升重置为0，世界转为灵界 */
if (G.Player.activeWorldId(G.game.meta) !== 'ling')
  errors.push('凡界通关后应飞升灵界，当前 ' + G.Player.activeWorldId(G.game.meta));
if (save.globalLevel !== 64) errors.push('飞升灵界后 gl 应为64，实为 ' + save.globalLevel);
if (!G.game.meta.progress.worlds.ling) errors.push('灵界未解锁');

/* ===== 灵界 5 本 ===== */
console.log('=== 灵界秘境（飞升后重抽）===');
if (save.dungeonSlot !== 0) errors.push('飞升后 slot 未重置为0：' + save.dungeonSlot);
for (let i = 0; i < 5; i++) {
  const archId = save.dungeonSet[i];
  const arch = D.archById(archId);
  const before = secretCount();
  const expectDelta = save.secrets[arch.drop] ? 0 : 1;
  const g = clearDungeon(i);
  console.log('  槽' + (i + 1) + ' ' + arch.n +
    '（' + (arch.kind === 'big' ? '大' : '小') + '）通关　秘术 ' +
    before + '→' + secretCount() + '　步数 ' + g);
  if (secretCount() !== before + expectDelta)
    errors.push(archId + ' 秘术增量异常，期望 +' + expectDelta +
      '（' + before + '→' + secretCount() + '）');
}
if (G.Player.activeWorldId(G.game.meta) !== 'xian')
  errors.push('灵界通关后应飞升仙界，当前 ' + G.Player.activeWorldId(G.game.meta));
if (save.globalLevel !== 91) errors.push('飞升仙界后 gl 应为91，实为 ' + save.globalLevel);
if (!G.game.meta.progress.worlds.xian) errors.push('仙界未解锁');

/* ===== 报告 ===== */
console.log('');
console.log('累计习得签名秘术：' + secretCount() + ' / 15');
if (errors.length) {
  console.log('=== 副本流程发现问题 (' + errors.length + ') ===');
  errors.forEach((e) => console.log(' - ' + e));
  process.exit(1);
} else {
  console.log('副本全流程通过：凡界5本 → 飞升灵界 → 灵界5本 → 飞升仙界，关卡/秘术/飞升链路无断点。');
}
