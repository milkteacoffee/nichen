/* 玩家属性引擎：境界、面板数值、天赋/世界效果合并、资源加成 */
(function () {
  var ADD_KEYS = ['a', 'f', 'h', 's', 'qi', 'po', 'st', 'c', 'cd', 'ct', 'br',
    'he', 'ls', 'rc', 'rf', 'se', 'es', 'chest', 'lowHpDef', 'killAtk',
    'killAtkCap', 'drAll'];
  var MERGE_KEYS = ['rs', 'dr', 'eb'];

  function empty() {
    var e = {};
    ADD_KEYS.forEach(function (k) { e[k] = 0; });
    e.im = [];
    MERGE_KEYS.forEach(function (k) { e[k] = {}; });
    return e;
  }

  function mergeInto(dst, src) {
    if (!src) return dst;
    ADD_KEYS.forEach(function (k) {
      if (typeof src[k] === 'number') dst[k] += src[k];
    });
    if (src.im) src.im.forEach(function (t) { if (dst.im.indexOf(t) < 0) dst.im.push(t); });
    MERGE_KEYS.forEach(function (k) {
      if (src[k]) Object.keys(src[k]).forEach(function (t) {
        dst[k][t] = Math.max(dst[k][t] || 0, src[k][t]);
      });
    });
    if (src.mf) dst.mf = true;
    if (src.zeroStone) dst.zeroStone = true;
    if (src.bdur) dst.bdur = Math.max(dst.bdur || 0, src.bdur);
    if (src.items) { dst.items = dst.items || {}; addItems(dst.items, src.items); }
    return dst;
  }
  function addItems(dst, src) {
    Object.keys(src).forEach(function (k) { dst[k] = (dst[k] || 0) + src[k]; });
  }

  /* ===== 境界体系（19 境，gl 1–684）=====
     每个**大境界**含 **九重**，每重又分 **初期 / 中期 / 后期 / 巅峰** 四个小境界，
     即每大境 36 小阶（gl），19 境共 684。统一以「重」称，不再有段/层/转等异称。
     小阶所需灵气按"境进度"平滑增长（见 needQi），使每大境总灵气与旧九段版相当。
     大境界切换（如 36→37、72→73）：另需一枚对应「突破丹」，并触发「问心魔劫」剧情战。
     跨界边界（252→253 / 360→361 / 576→577）：不由破境走，由「通关第5副本·飞升接引」完成（见 ascend）。 */
  var REALMS = [
    { n: '淬体', y0: 1, y1: 36, gate: 1, calib: .4 },
    { n: '炼气', y0: 37, y1: 72, gate: 2, calib: 1 },
    { n: '筑基', y0: 73, y1: 108, gate: 4, calib: 1 },
    { n: '金丹', y0: 109, y1: 144, gate: 8, calib: 1 },
    { n: '元婴', y0: 145, y1: 180, gate: 16, calib: 1 },
    { n: '化神', y0: 181, y1: 216, gate: 32, calib: 1 },
    { n: '炼虚', y0: 217, y1: 252, gate: 64, calib: 1 },
    { n: '合体', y0: 253, y1: 288, gate: 128, calib: 1 },
    { n: '大乘', y0: 289, y1: 324, gate: 256, calib: 1 },
    { n: '渡劫', y0: 325, y1: 360, gate: 512, calib: 1 },
    { n: '人仙', y0: 361, y1: 396, gate: 1024, calib: 1 },
    { n: '地仙', y0: 397, y1: 432, gate: 2048, calib: 1 },
    { n: '天仙', y0: 433, y1: 468, gate: 4096, calib: 1 },
    { n: '金仙', y0: 469, y1: 504, gate: 8192, calib: 1 },
    { n: '太乙金仙', y0: 505, y1: 540, gate: 16384, calib: 1 },
    { n: '大罗金仙', y0: 541, y1: 576, gate: 32768, calib: 1 },
    { n: '准圣', y0: 577, y1: 612, gate: 65536, calib: 1 },
    { n: '圣人', y0: 613, y1: 648, gate: 131072, calib: 1 },
    { n: '道祖', y0: 649, y1: 684, gate: 262144, calib: 1 }
  ];
  var MAX_GL = 684;
  var CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  /* 每重的四个小境界（初/中/后/巅）；全 19 境统一。 */
  var CH_PHASE = ['初期', '中期', '后期', '巅峰'];
  function stageName(t, stage) {
    var st = Math.max(1, Math.min(36, stage));
    var chong = Math.floor((st - 1) / 4);
    var phase = (st - 1) % 4;
    return t.n + CN[chong] + '重' + CH_PHASE[phase];
  }

  /* ===== 四界天花板（境界 v3.6 / 副本 v3.3）===== */
  var WORLDS = [
    { id: 'fan',  n: '凡界', start: 1,   cap: 252 },
    { id: 'ling', n: '灵界', start: 253, cap: 360 },
    { id: 'xian', n: '仙界', start: 361, cap: 576 },
    { id: 'dao',  n: '道界', start: 577, cap: 684 }
  ];

  /* ===== 寿元（境界 v3.2 §3）=====
     境界寿元上限；入世时 16 岁起算，年龄按游戏内行为推进。
     寿元尽 → 「坐化」，按善终结算（仙力 ×1.1）。道祖不朽。 */
  var LIFESPAN = {
    淬体: 100, 炼气: 150, 筑基: 200, 金丹: 300, 元婴: 500,
    化神: 800, 炼虚: 1000, 合体: 1500, 大乘: 2000, 渡劫: 3000,
    人仙: 5000, 地仙: 8000, 天仙: 12000, 金仙: 20000,
    太乙金仙: 30000, 大罗金仙: 50000, 准圣: 100000, 圣人: 200000,
    道祖: Infinity
  };
  var AGE_PER_BATTLE = 10;          /* 每 10 场战斗 +1 岁 */
  var AGE_PER_MEDITATE = 60;        /* 打坐每 60 分钟 +1 岁 */
  var AGE_PER_BREAK = 2;            /* 每次突破 +2 岁 */

  /* ===== 资源分级（v0.61.0，用户第 11 点）=====
     用户口径原话：「灵石要区分下品、中品、上品、极品灵石的图标，到了灵界需要新增灵晶
     包括(下、中、上、极)的图标，仙界用的是仙晶也是(下、中、上、极)，道界用的是道晶
     (下、中、上、极)，1 个下品道晶 = 10 个极品仙晶 = 100000 个极品灵晶 =
     1000000000 个极品灵石，都是翻十倍计算」。

     ⚠️ 把口径翻译成数字（这是本表唯一容易搞错的地方，契约逐条钉住）：
       · **币内**每上一品 ×10 → 1 极品 = 10 上品 = 100 中品 = 1000 下品；
       · **跨界**按「10 极品仙晶 = 10 万极品灵晶」= ×10^4（两边都取极品计）。
     于是「下品」之间的倍率 = 10^4 × 1000 = **10^7**：
         1 下品灵晶 = 10^7 下品灵石；1 下品仙晶 = 10^11；1 下品道晶 = 10^15。
     自检（对得上用户原话的两句）：
         1 下品道晶 = 10^15 下品灵石；
         10 极品仙晶 = 10 × 1000 × 10^11 = 10^15 ✓
         10^5 极品灵晶 = 10^5 × 1000 × 10^7 = 10^15 ✓
         10^9 极品灵石 = 10^9 × 1000 × 1 = 10^12 ✗ ← **末段对不上**（差 1000 倍）
     ⚠️ **取舍已定**：保留用户**明确写出**的两个等式
         「1 下品道晶 = 10 极品仙晶」与「10 极品仙晶 = 10^5 极品灵晶」（它们互相自洽），
         牺牲末段那句近似口语的「= 10^9 极品灵石」。
         面板上只展示成立的那两段，**不展示**末段 —— 显示了就是自相矛盾。
         这条取舍写在这里，别再有人拿"用户说了 10 亿"去改数字。 */
  var GRADES = [
    { id: 'low', n: '下品', mult: 1 },
    { id: 'mid', n: '中品', mult: 10 },
    { id: 'high', n: '上品', mult: 100 },
    { id: 'top', n: '极品', mult: 1000 }
  ];
  var RES = [
    { id: 'stone', n: '灵石', world: 'fan', unit: 1, key: 'stone', icon: 'res.stone' },
    { id: 'lingjing', n: '灵晶', world: 'ling', unit: 1e7, key: 'lingjing', icon: 'res.lingjing' },
    { id: 'xianjing', n: '仙晶', world: 'xian', unit: 1e11, key: 'xianjing', icon: 'res.xianjing' },
    { id: 'daojing', n: '道晶', world: 'dao', unit: 1e15, key: 'daoCrystal', icon: 'res.daojing' }
  ];

  /* 把一个"下品数量"拆成四品（贪心：先扣极品）。
     ⚠️ 这是**显示用**的拆分，不写回存档 —— 存档里每币只有一个标量（`save.stone` 等），
        两处各存一份"分品余额"必然分叉（换零钱换丢过一类的 bug 全从这来）。 */
  function splitGrades(v) {
    v = Math.max(0, Math.floor(v || 0));
    var out = {};
    GRADES.slice().reverse().forEach(function (g) {
      out[g.id] = Math.floor(v / g.mult);
      v -= out[g.id] * g.mult;
    });
    return out;
  }
  /* 四币余额（各自的下品数量） */
  function resHold(save) {
    var out = {};
    RES.forEach(function (c) { out[c.id] = (save && save[c.key]) || 0; });
    return out;
  }
  /* 总身家（折算成下品灵石）—— 面板与契约共用这一条口径 */
  function resWorth(save) {
    var hold = resHold(save), sum = 0;
    RES.forEach(function (c) { sum += hold[c.id] * c.unit; });
    return sum;
  }
  /* 跨币兑换：把 from 的 amount 个下品单位换成 to 的下品单位（只允许高→低或低→高同价交换）。
     返回 { ok, reason?, gain, cost }。境界/世界未解锁时不给兑（"到了灵界才有灵晶"）。 */
  function resExchange(save, meta, fromId, toId, amount) {
    var from = null, to = null;
    RES.forEach(function (c) { if (c.id === fromId) from = c; if (c.id === toId) to = c; });
    if (!from || !to || from === to) return { ok: false, reason: '无此兑换' };
    var pr = (meta && meta.progress) || {};
    var unlocked = (to.world === 'fan') || (pr.worlds && pr.worlds[to.world]);
    if (!unlocked) return { ok: false, reason: '未至' + to.n + '所辖之界，兑不出' + to.n };
    amount = Math.floor(amount || 0);
    if (!(amount > 0)) return { ok: false, reason: '数目不对' };
    var have = (save[from.key] || 0);
    if (have < amount) return { ok: false, reason: from.n + '不足' };
    var worth = amount * from.unit;                  /* 折算成下品灵石 */
    var gain = Math.floor(worth / to.unit);          /* 换得多少下品 to */
    if (gain < 1) return { ok: false, reason: '不足 1 ' + to.n + '（下品）' };
    save[from.key] = have - amount;
    save[to.key] = (save[to.key] || 0) + gain;
    if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
    return { ok: true, gain: gain, cost: amount, worth: worth };
  }

  var Player = {
    REALMS: REALMS,
    MAX_GL: MAX_GL,
    formatCount: function (n) {
      n = Math.max(0, Math.floor(Number(n) || 0));
      if (n >= 100000) return (n / 10000).toFixed(1) + 'W';
      if (n >= 10000) return (n / 1000).toFixed(1) + 'K';
      return String(n);
    },
    hasHome: function (save) { return !!save && save.homeOwned !== false; },
    HOME_PRICE: 300,
    acquireHome: function (save) {
      if (!save || this.hasHome(save)) return { ok: false, reason: '本世已有洞府' };
      if ((save.stone || 0) < this.HOME_PRICE) return { ok: false, reason: '需 300 下品灵石租用洞府' };
      save.stone -= this.HOME_PRICE;
      save.homeOwned = true;
      this.chronicle(save, 'home', '以三百下品灵石租得此世洞府');
      G.Storage.saveCurrent(save);
      return { ok: true };
    },
    rootDescription: function (save, elem) {
      var lg = save.linggen || save || {}, elems = lg.elems || [];
      var owned = elems.indexOf(elem) >= 0;
      var parts = [owned ? '本世天生拥有，不可重随。' : '本世未拥有此属性灵根。'];
      if (owned) parts.push('根性系数 ×' + ((lg.coef || {})[elem] || 1) + '，影响相应修行收益。');
      if (elems.length === 5) parts.push('五行俱全，当前根性系数 0.6，晋级最为艰难。');
      parts.push('金克木、木克土、土克水、水克火、火克金。');
      return { title: elem + '灵根 · ' + (owned ? '已拥有' : '未拥有'), text: parts.join('\n') };
    },
    WORLDS: WORLDS,
    GRADES: GRADES,
    RES: RES,
    splitGrades: splitGrades,
    resHold: resHold,
    resWorth: resWorth,
    resExchange: resExchange,
    resById: function (id) {
      for (var i = 0; i < RES.length; i++) if (RES[i].id === id) return RES[i];
      return null;
    },
    AGE_PER_BATTLE: AGE_PER_BATTLE,
    AGE_PER_MEDITATE: AGE_PER_MEDITATE,
    AGE_PER_BREAK: AGE_PER_BREAK,

    /* ===== 世界（四界）===== */
    /* 按 id 取世界条目 */
    worldById: function (id) {
      for (var i = 0; i < WORLDS.length; i++) if (WORLDS[i].id === id) return WORLDS[i];
      return WORLDS[0];
    },
    /* 某 gl 所属世界 */
    worldOfGL: function (gl) {
      gl = gl || 1;
      for (var i = 0; i < WORLDS.length; i++) {
        if (gl >= WORLDS[i].start && gl <= WORLDS[i].cap) return WORLDS[i];
      }
      return WORLDS[WORLDS.length - 1];
    },
    /* 当前所在世界 id：优先 meta.progress.activeWorld，兜底按 gl 推断 */
    activeWorldId: function (meta) {
      meta = meta || (G.game && G.game.meta) || (G.Storage && G.Storage.loadMeta && G.Storage.loadMeta());
      if (meta && meta.progress && meta.progress.activeWorld) return meta.progress.activeWorld;
      return this.worldOfGL(1).id;
    },
    /* 当前世界天花板 gl */
    worldCap: function (meta) {
      return this.worldById(this.activeWorldId(meta)).cap;
    },

    /* ===== 界域难度（设计 v1.1 §2.5）=====
       每界独立、可回刷（"普通通关凡界 → 日后回刷凡界地狱拿碎片"靠它成立）。
       轮换 普通→困难→地狱→普通，**立即生效**并写 meta。
       返回新难度 id；该界未解锁时返回 null（调用方负责提示）。
       菜单「界域难度」与轮回殿「飞升台」共用这一份逻辑，避免两处口径漂移。 */
    DIFF_ORDER: ['normal', 'hard', 'hell'],
    cycleWorldDiff: function (meta, worldId) {
      if (!meta) return null;
      var pr = meta.progress = meta.progress || {};
      var wd = pr.worlds || {};
      if (!(worldId === 'fan' || wd[worldId])) return null;
      pr.worldDiff = pr.worldDiff || {};
      var cur = pr.worldDiff[worldId] || pr.difficulty || 'normal';
      var next = this.DIFF_ORDER[(this.DIFF_ORDER.indexOf(cur) + 1) % this.DIFF_ORDER.length];
      pr.worldDiff[worldId] = next;
      if (G.Storage && G.Storage.saveMeta) G.Storage.saveMeta(meta);
      return next;
    },

    /* ===== 灵气收益的境界系数（缺口 U5，2026-09-26 校准）=====
       问题：破境需求 = 100 × 门槛系数 × 段数²，而门槛系数**每境 ×2**
             （淬体 1 → 道祖 262144，共 2^18 倍）；产出侧却只有 `80 × L` 的线性量级
             （野外、副本 trash、打坐、跨世灌注全是 O(L) 或固定值）。
             实测（`tools/zone-curve.js`）：刷满一个境界所需场次从炼气 **24 场**
             一路涨到大罗金仙 **60,895 场**（≈2,500 倍）—— 高界野外路线形同虚设。
       校准：让灵气产出随**妖兽自身的境界**缩放，取门槛系数的 **0.75 次幂**。
             不用 1 次幂（= 门槛系数本身）：那会把高界压到 3~5 场，过度修正。
             下限 1，且淬体（门槛 1）/ 炼气（门槛 2）恰好落在 1 →
             **凡界 M0 教学链与既有回归基线（playthrough / rebirth）完全不变**。
       结果：各境界刷满场次拉平到 20–45 场。对表工具见 `tools/zone-curve.js`。
       ⚠️ 只作用于**灵气**。灵力/灵石仍是原公式 —— 它们各自有独立的消耗侧
          （功法升级 / 商店），没有跟着境界指数爆炸，不需要一起改。 */
    realmQiCoef: function (gl) {
      var t = this.realmOf(gl || 1);
      var half = (t.gate || 1) / 2;
      return half <= 1 ? 1 : Math.pow(half, 0.75);
    },

    /* 该境界的寿元上限 */
    lifespanOf: function (gl) {
      var t = this.realmOf(gl || 1);
      return LIFESPAN[t.n];
    },

    /* 年龄推进。reason: 'battle' | 'meditate' | 'break'
       v0.61.0 起**全部折算成世界时钟**（`save.gt`），年龄只是它的读数 ——
       原来"每 10 场 +1 岁 / 每 60 分钟 +1 岁"的零散加法已经废掉：
       那套写法下玩家问"寿元到底怎么消耗的"是答不上来的（用户第 3 点原话）。
       · battle  ：每 AGE_PER_BATTLE 场 = 1 游戏年
       · meditate：n 就是**游戏分钟**（打坐多久就老多久）
       · break   ：顿悟，走 ageBonus（不进日历），`age = 16 + 年数 + ageBonus`
       返回本次实际增加的年岁（0 = 未跨年）。 */
    agePush: function (save, reason, n) {
      if (save.age == null) save.age = 16;
      n = n || 1;
      if (!G.Time) { save.age += (reason === 'break' ? AGE_PER_BREAK : 0); return 0; }
      G.Time.ensure(save);
      if (reason === 'break') return this.addAgeBonus(save, AGE_PER_BREAK);
      if (reason === 'meditate') return G.Time.advance(save, n);
      return G.Time.advance(save, n / AGE_PER_BATTLE * G.Time.MIN_PER_YEAR);
    },

    /* 寿元是否已尽（坐化） */
    isAged: function (save) {
      return (save.age || 16) >= this.lifespanOf(save.globalLevel);
    },

    /* 剩余寿元 */
    lifespanLeft: function (save) {
      return Math.max(0, this.lifespanOf(save.globalLevel) - (save.age || 16));
    },

    /* 本世大事记（死亡走马灯用，§3.3）。同一 id 只记一次。 */
    chronicle: function (save, id, text) {
      save.chronicle = save.chronicle || [];
      for (var i = 0; i < save.chronicle.length; i++) {
        if (save.chronicle[i].id === id) return;
      }
      save.chronicle.push({ id: id, t: save.age || 16, s: text });
    },

    /* ===== 仙力结算（轮回转世 v0.4 §4）=====
       仙力 = 境界仙力 + 功法仙力 + 击杀仙力 + 年岁仙力 + 轮回成就
       境界仙力 10×L（本世最高）｜功法仙力 2×Σ功法最高等级
       击杀仙力 30×首领击杀数｜年岁仙力 (年龄−15)×2
       善终修正：寿终坐化 ×1.1 */
    ACHIEVE: [
      { id: 'A1', n: '初踏仙途', d: '首次修至炼气', xianli: 50, hit: function (s) { return (s.globalLevel || 1) >= 37; } },
      { id: 'A2', n: '道基初成', d: '首次修至筑基', xianli: 150, hit: function (s) { return (s.globalLevel || 1) >= 73; } },
      { id: 'A3', n: '手刃狼王', d: '首次击杀赤炎狼王', xianli: 100, hit: function (s) { return !!s.bossKilled; } },
      { id: 'A4', n: '功法小成', d: '任一功法首次修至 L5', xianli: 50, hit: function (s) {
        var sk = s.skills || {};
        return Object.keys(sk).some(function (k) { return (sk[k].lv || 0) >= 5; });
      } },
      { id: 'A5', n: '轮回新手', d: '完成第一次死亡结算', xianli: 30, hit: function () { return true; } },
      /* ===== 飞升 / 道界 / 地狱（缺口 U3；设计 v3.2 §128 + v1.1 §2.5）=====
         这几项的进度是**跨世**的（写在 meta 里，不在当世 save 上），
         所以 hit 的第二个参数是 meta —— 结算时由 xianliOf 传进来。 */
      { id: 'A6', n: '飞升上界', d: '首次飞离凡界', xianli: 200, hit: function (s, m) {
        return !!(m && m.progress && m.progress.activeWorld && m.progress.activeWorld !== 'fan');
      } },
      { id: 'A7', n: '仙门中人', d: '首次飞升仙界', xianli: 400, hit: function (s, m) {
        return !!(m && m.progress && m.progress.worlds && m.progress.worlds.xian);
      } },
      { id: 'A8', n: '叩门道界', d: '集齐三枚道之钥匙碎片', xianli: 1500, hit: function (s, m) {
        return !!(m && m.progress && m.progress.daoKey);
      } },
      { id: 'A9', n: '破狱者', d: '以地狱难度踏破任一界', xianli: 300, hit: function (s, m) {
        return !!(m && m.titles && m.titles.length);
      } },
      /* ===== v0.15.0 富化（用户口径："富化一下成就和称号"）=====
         新增的这几项**全部可由 save/meta 现算**，不引入新的埋点 ——
         埋点一多就会漏，而漏掉的成就是"永远拿不到且不报错"的静默缺陷。 */
      { id: 'A10', n: '藏书五卷', d: '单世习得五本功法', xianli: 80, hit: function (s) {
        return Object.keys(s.skills || {}).length >= 5;
      } },
      { id: 'A11', n: '秘术初得', d: '习得第一个签名秘术', xianli: 60, hit: function (s) {
        return Object.keys(s.secrets || {}).length >= 1;
      } },
      { id: 'A12', n: '五术通玄', d: '习得五个签名秘术', xianli: 350, hit: function (s) {
        return Object.keys(s.secrets || {}).length >= 5;
      } },
      { id: 'A13', n: '斩妖除魔', d: '累计斩杀十位首领', xianli: 250, hit: function (s) {
        return (s.bossKills || 0) >= 10;
      } },
      { id: 'A14', n: '功参造化', d: '任一功法修至 L10', xianli: 180, hit: function (s) {
        var sk = s.skills || {};
        return Object.keys(sk).some(function (k) { return (sk[k].lv || 0) >= 10; });
      } },
      { id: 'A15', n: '富甲一方', d: '单世持有灵石满五千', xianli: 120, hit: function (s) {
        return (s.stone || 0) >= 5000;
      } },
      { id: 'A16', n: '寿终正寝', d: '以寿终坐化结束一世', xianli: 90, hit: function (s) {
        return s._cause === 'aged';
      } },
      { id: 'A17', n: '自了尘缘', d: '主动坐化，早入轮回', xianli: 40, hit: function (s) {
        return s._cause === 'self';
      } },
      { id: 'A18', n: '大乘之境', d: '首次修至大乘', xianli: 900, hit: function (s) {
        return (s.globalLevel || 1) >= 289;
      } }
    ],

    /* 结算一世仙力。返回明细，便于结算屏逐项展示。
       meta 会写入 meta.achieve（一次性成就），调用方负责存盘。 */
    xianliOf: function (save, meta) {
      var meta = meta || G.game.meta || {};
      var gl = save.maxGlobalLevel || save.globalLevel || 1;
      var gls = this.scaleLevel(gl);
      var lvSum = 0;
      Object.keys(save.skills || {}).forEach(function (k) {
        lvSum += (save.skills[k] && save.skills[k].lv) || 0;
      });
      var kills = save.bossKills || (save.bossKilled ? 1 : 0);
      var age = save.age || 16;
      var cause = this.deathCause(save);

      var d = {
        realm: 10 * gls,
        skill: 2 * lvSum,
        kill: 30 * kills,
        age: Math.max(0, age - 15) * 2,
        achieve: 0,
        achieveList: [],
        cause: cause.id, causeName: cause.n,
        base: 0, mul: cause.mul, total: 0
      };

      /* 轮回成就：meta 一次性。hit 带 meta —— 飞升/道界/地狱这几项只有 meta 里才有
         （A6–A9），只传 save 的话它们永远不触发。 */
      meta.achieve = meta.achieve || {};
      this.ACHIEVE.forEach(function (a) {
        if (meta.achieve[a.id]) return;
        if (!a.hit(save, meta)) return;
        meta.achieve[a.id] = 1;
        d.achieve += a.xianli;
        d.achieveList.push(a);
      });

      d.base = d.realm + d.skill + d.kill + d.age + d.achieve;
      d.total = Math.max(5, Math.round(d.base * d.mul));
      return d;
    },

    /* 本世**已累积**的仙力（HUD「仙晶」格用）。
       ⚠️ 必须与 `xianliOf` 分开，不能直接调它：那个会写 `meta.achieve`（发成就），
       而 HUD 每帧都画 —— 每帧发一次成就是不可接受的副作用。
       这里只算 save 内的四项（境界/功法/击杀/年岁），**纯函数、零副作用**；
       轮回成就那部分只有身故结算时才知道，本来也不该出现在"本世进行中"的读数里。 */
    xianliLive: function (save) {
      var gl = save.maxGlobalLevel || save.globalLevel || 1;
      var gls = this.scaleLevel(gl);
      var lvSum = 0;
      Object.keys(save.skills || {}).forEach(function (k) {
        lvSum += (save.skills[k] && save.skills[k].lv) || 0;
      });
      var kills = save.bossKills || (save.bossKilled ? 1 : 0);
      var age = save.age || 16;
      return 10 * gls + 2 * lvSum + 30 * kills + Math.max(0, age - 15) * 2;
    },

    /* 死因分类（§3.1）：M0 只做战死与寿终坐化 */
    deathCause: function (save) {
      if (save._cause === 'aged') return { id: 'aged', n: '寿终坐化', mul: 1.1 };
      if (save._cause === 'event') return { id: 'event', n: '殒于变故', mul: 1.0 };
      /* 主动轮回（v0.15.0）：玩家在洞府自行坐化。**不给加成也不打折** ——
         它只是一种"早点重开"的手段，有加成就会变成刷分最优解。 */
      if (save._cause === 'self') return { id: 'self', n: '自行坐化', mul: 1.0 };
      return { id: 'war', n: '战死', mul: 1.0 };
    },

    /* 天赋效果合并（运行时） */
    talentEffects: function (save) {
      var e = empty();
      /* 出身效果与天赋走同一套聚合：出身只给百分比加成（originFx），不给固定值。
         六维系统已整体删除，所以面板数值的来源只剩四处 ——
         境界成长 + 功法 + 这里的百分比 + 仙躯（meta.perfusion.body）。 */
      mergeInto(e, save.originFx);
      (save.talents || []).forEach(function (id) {
        var t = G.Data.talentById(id);
        if (t) mergeInto(e, t.e);
      });
      return e;
    },

    /* 世界特质效果合并 */
    worldEffects: function (save) {
      var e = empty();
      ((save.world && save.world.traits) || []).forEach(function (tid) {
        var t = G.Data.worldTraitById(tid);
        if (t) mergeInto(e, t.e);
      });
      return e;
    },

    /* 圣术（签名秘术·面板百分比）：随品阶 grade 缩放（凡1/灵1.5/仙2） */
    secretPct: function (save) {
      var p = { a: 0, f: 0, h: 0, s: 0 }, Dg = G.Data.dungeons;
      var secs = save.secrets || {};
      Object.keys(secs).forEach(function (id) {
        var ef = Dg.secretEffectById(id);
        if (!ef || ef.cat !== '圣') return;
        var g = Dg.gradeOf(save, id);
        if (ef.atk) p.a += ef.atk * g;
        if (ef.def) p.f += ef.def * g;
        if (ef.hp) p.h += ef.hp * g;
        if (ef.spd) p.s += ef.spd * g;
      });
      return p;
    },

    realmInfo: function (gl) {
      gl = Math.max(1, Math.min(MAX_GL, gl || 1));
      var t = this.realmOf(gl);
      var stage = gl - t.y0 + 1;
      return { realm: t.n, stage: stage, n: stageName(t, stage) };
    },

    /* 所在大境界条目 */
    realmOf: function (gl) {
      gl = Math.max(1, Math.min(MAX_GL, gl || 1));
      for (var i = 0; i < REALMS.length; i++) {
        if (gl >= REALMS[i].y0 && gl <= REALMS[i].y1) return REALMS[i];
      }
      return REALMS[REALMS.length - 1];
    },

    /* 大境界内的细分坐标。
       返回 { r:大境序号0..18, stage:小阶1..36, chong:重1..9, phase:阶段0..3 }。 */
    realmPos: function (gl) {
      gl = Math.max(1, Math.min(MAX_GL, gl || 1));
      var r = 0;
      for (var i = 0; i < REALMS.length; i++) {
        if (gl >= REALMS[i].y0 && gl <= REALMS[i].y1) { r = i; break; }
      }
      var stage = gl - REALMS[r].y0 + 1;
      return {
        r: r,
        stage: stage,
        chong: Math.floor((stage - 1) / 4) + 1,
        phase: (stage - 1) % 4
      };
    },

    /* 压缩缩放阶（敌人/Boss 数值成长用）：
       新 gl 每大境有 36 小阶，但同一"重"内的初/中/后/巅四阶**实力相近**
       （四阶主要是称谓与晋级节奏），所以数值只按"大境×九重"生长 ——
       scaleLevel = r×9 + chong，范围 1..171，正好等价于旧版 gl 刻度。
       这样在不推翻既有线性数值的前提下实现 36 阶的细粒度。 */
    scaleLevel: function (gl) {
      var p = this.realmPos(gl);
      return p.r * 9 + p.chong;
    },

    /* 突破灵气折扣（天赋/世界特质；br 为负值即减免） */
    breakCut: function (save) {
      var te = this.talentEffects(save), we = this.worldEffects(save);
      var b = save.bonus || {};
      var cut = (te.br || 0) + (we.br || 0) + (b.br || 0);
      return Math.max(-0.6, Math.min(0.6, cut));
    },

    /* 破境所需灵气的**难度系数**（v0.62.0，用户第 5 点）
       ------------------------------------------------------------
       用户口径：「这四个值太容易获取了，玩家一下子就升级完成了，需要修改，
                  而且并没有体现修仙很难」。
       实测（按 **36 小阶** 的真实模型复算，`tools/smoke.js: zone.curve` 与 `tools/zone-curve.js` 同口径）：
       改前每个大境刷满只要 **2.96–10.54 场**（淬体 3.7 / 炼气 3.6 / 筑基 7.2 / 化神 3.0）——
       **一场架几乎刷满一境**，所以"一下子就升级完成了"。
       修法：给 `needQi` 乘一个统一的难度系数，把"刷满一个境界的场次"从 3–10 场推到 **10–37 场**
       （×3.5；各境的原始差距只有 3.6 倍，所以**一个统一系数**就能整体平移，不需要逐境配表）。
       ⚠️ **淬体也一起乘** —— 它是 M0 教学链，但"一场架通一境"在教学关里同样是错的；
          首阶 needQi 由 1 变 6（4 点灵气起步仍够打第一架）。
       ⚠️ 改这个数必须同时复跑：
          · `zone-curve`（看"场次"列，且它的 9 段模型已过时，以 smoke 的 36 阶模型为准）
          · `smoke`（`zone.curve.contract` 会逐境验 [2,40] 与最高/最低 ≤8 倍）
          · `playthrough` / `rebirth`（末行数字会整体位移，属预期） */
    NEED_SCALE: 3.5,
    needScale: function (gl) { return this.NEED_SCALE; },

    /* 当前境界 → 下一**小阶**所需灵气 */
    needQi: function (save, gl) {
      gl = gl || save.globalLevel || 1;
      var t = this.realmOf(gl);
      var stage = gl - t.y0 + 1;                 /* 1..36（九重×四阶） */
      var u = stage / 36;                         /* 境进度 0.028..1 */
      /* 36 小阶按境进度 u² 平滑增长；系数 22.8 使每大境总灵气与旧九段版相当
         （Σ22.8·u² ≈ 285，与旧 Σstage²=285 同基准），不改变整体修炼节奏。 */
      var base = 100 * t.gate * 22.8 * u * u * t.calib;
      return Math.max(1, Math.round(base * (1 + this.breakCut(save)) * this.needScale(gl)));
    },

    /* 大境界 9→10 所需丹药名 */
    /* 大境界突破丹命名：默认 = **当前**境界 + 突破丹（淬体突破丹 / 炼气突破丹 / 筑基突破丹…）。
       例外表：炼气九段圆满 → 筑基这一段，丹名用仙侠通行的「筑基丹」
       （《M1 剧情与内容设计 v1.0》§4 全篇这么写；§8 商店表里写的"炼气突破丹"是同一件东西，
       以本表为准）。别名按"当前境界名"查，所以只有 gl=18 那一次大突破会真的用上。 */
    BREAK_PILL_ALIAS: { '炼气': '筑基丹', '筑基': '结丹丹' },
    /* 突破丹的获取途径（v0.15.0）：破境失败时**必须告诉玩家去哪拿**。
       原来只报「需「淬体突破丹」」—— 玩家翻遍面板也不知道在哪买（截图反馈）。
       ⚠️ 文案长度按**面板可用宽 334px / 9.5px 字**算：超过约 30 个全角字就会越界。
       ⚠️ 未登记的丹名走通用兜底，**不留空** —— 留空等于把玩家卡死在原地。 */
    PILL_HINT: {
      '淬体突破丹': '青溪镇药铺 200 灵石，或主线「破境备丹」赠予',
      '筑基丹': '刘记订购 1000 灵石，或用沈伯旧方（妖丹×3 + 600 灵石）'
    },
    pillHint: function (pill) {
      return this.PILL_HINT[pill] || '秘境/小世界探索可得，或宗门贡献兑换、自行炼制';
    },
    breakPill: function (gl) {
      var n = this.realmOf(gl || 1).n;
      return this.BREAK_PILL_ALIAS[n] || (n + '突破丹');
    },

    /* 是否已入道界三境（准圣/圣人/道祖）。道界**无破境之说** ——
       境界只由「道则回廊」九关试炼推进（境界 v3.6 §5–§7），
       所以灵气突破在 gl≥577 一律拦截，避免玩家刷灵气跳过三境试炼。 */
    isDaoRealm: function (gl) { return (gl || 1) >= 577; },

    /* 突破按钮/面板状态 */
    breakState: function (save) {
      var gl = save.globalLevel || 1;
      var t = this.realmOf(gl);
      var stage = gl - t.y0 + 1;
      /* 仅本大境最后一小阶（九重巅峰 → 下一境）才是"大突破"：需破境丹+心魔劫；
         其余 35 小阶（重内四阶、跨重）皆为灵气小进。 */
      var big = stage >= 36;
      var need = this.needQi(save, gl);
      var have = Math.floor(save.qi || 0);
      var pill = this.breakPill(gl);
      var owned = (save.items && save.items[pill]) || 0;
      var cap = this.worldCap();
      var daoLv = this.isDaoRealm(gl) && gl < MAX_GL;
      var st = {
        gl: gl, realm: t.n, stage: stage, big: big,
        need: need, have: have, lack: Math.max(0, need - have),
        pill: pill, pillOwned: owned,
        maxed: gl >= MAX_GL,
        worldcap: gl >= cap && gl < MAX_GL,
        daoRealm: daoLv,
        cap: cap,
        next: this.realmInfo(Math.min(MAX_GL, gl + 1))
      };
      st.ready = !st.maxed && !st.worldcap && !daoLv
        && have >= need && (!big || owned > 0);
      st.pillHint = this.pillHint(pill);
      st.reason = st.maxed ? '已至道祖圆满，无路可破'
        : st.worldcap ? '此界天道所限，飞升方可再进一步'
          : daoLv ? '道界无破境之说 —— 唯历「道则回廊」试炼可进'
            : (big && !owned) ? '需「' + pill + '」：' + st.pillHint
              : (have < need) ? '灵气不足，还需 ' + st.lack
                : '';
      return st;
    },

    /* 小境界突破：灵气足够且未至 9 段时直接升段 */
    breakthrough: function (save, meta) {
      var st = this.breakState(save);
      if (st.maxed) return { ok: false, reason: st.reason };
      if (st.worldcap) return { ok: false, worldcap: true, reason: st.reason };
      if (st.daoRealm) return { ok: false, daoRealm: true, reason: st.reason };
      if (st.big) return { ok: false, big: true, reason: st.reason || ('需「' + st.pill + '」') };
      if (st.have < st.need) return { ok: false, reason: st.reason };
      save.qi = Math.max(0, (save.qi || 0) - st.need);
      this._applyBreak(save, meta, false);
      return { ok: true, gl: save.globalLevel, info: this.realmInfo(save.globalLevel), cost: st.need };
    },

    /* 大境界：校验灵气 + 扣丹，交由战斗场景打「问心魔劫」。
       ⚠️ v0.18.0 起**先掷破境成功率**（用户口径"会存在失败"）：
       失败 → 丹照扣 + `save.breakFails += 1`（筑基后累计道基，下次更容易）；
       成功 → 才进「问心魔劫」。心魔战是**演出的高潮**，不是第二道门槛 ——
       两道都掷会让实际成功率变成"概率²"，玩家算不明白。
       `roll` 只给测试用（传 0..1），不传才真掷；用 `Math.random` 而不是 `G.rng`
       —— 破境是玩家行为，不该消耗全局序列（那会带歪回归基线）。 */
    startBigBreak: function (save, meta, roll) {
      var st = this.breakState(save);
      if (st.maxed) return { ok: false, reason: st.reason };
      if (st.worldcap) return { ok: false, worldcap: true, reason: st.reason };
      if (st.daoRealm) return { ok: false, daoRealm: true, reason: st.reason };
      if (!st.big) return { ok: false, reason: '尚未修至大圆满' };
      if (st.have < st.need) return { ok: false, reason: st.reason };
      if (!st.pillOwned) return { ok: false, reason: '需「' + st.pill + '」' };
      var ch = this.breakChance(save, meta);
      var r = typeof roll === 'number' ? roll : Math.random();
      if (r * 100 >= ch.total) {
        /* 失败：丹照扣（"大道五十，天衍四九"—— 试错是有代价的） */
        save.items[st.pill] -= 1;
        if (save.items[st.pill] <= 0) delete save.items[st.pill];
        save.breakFails = (save.breakFails || 0) + 1;
        /* v0.60 失败代价加重（修仙残酷，用户第 10 点）：灵气散 15%、
           道基受损 +3 岁、气血折半 —— 破境不是无成本的反复尝试。 */
        save.qi = Math.floor((save.qi || 0) * 0.85);
        save.age = (save.age == null ? 16 : save.age) + 3;
        var _fb = this.computeStats(save);
        save.hp = Math.max(1, Math.round(_fb.maxhp * 0.5));
        if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
        return {
          ok: false, failed: true, chance: ch, from: st.gl,
          reason: '破境失败（成功率 ' + ch.total + '%）—— 道基受损、气血大伤，再寻破境丹可增胜算'
        };
      }
      save.items[st.pill] -= 1;
      if (save.items[st.pill] <= 0) delete save.items[st.pill];
      save.breakFails = 0;                      /* 成功即清零（道基不再累积） */
      if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      return { ok: true, pill: st.pill, need: st.need, from: st.gl, to: st.gl + 1, chance: ch };
    },

    /* 心魔战胜利：扣突破灵气并升入下一大境界 */
    winBigBreak: function (save, meta) {
      var need = this.needQi(save, save.globalLevel);
      save.qi = Math.max(0, (save.qi || 0) - need);
      this._applyBreak(save, meta, true);
      return this.realmInfo(save.globalLevel);
    },

    /* 心魔战失败：不降级，突破丹已耗，灵气保留 80% */
    loseBigBreak: function (save) {
      save.qi = Math.floor((save.qi || 0) * 0.8);
      if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      return save.qi;
    },

    /* 飞升接引（副本 v3.3）：通关第5副本后跨界，不走破境、不需丹/心魔。
       targetId = 目标世界 id；前置当前 gl 已达当前世界 cap（由副本结算保证）。 */
    ascend: function (save, meta, targetId) {
      meta = meta || (G.game && G.game.meta);
      var fromW = this.worldById(this.activeWorldId(meta));
      var toW = this.worldById(targetId);
      if (!toW) return { ok: false, reason: '无此界' };
      if (toW.start <= fromW.cap) return { ok: false, reason: '目标界未高于当前界' };
      save.globalLevel = toW.start;
      save.maxGlobalLevel = Math.max(save.maxGlobalLevel || 1, save.globalLevel);
      this.chronicle(save, 'ascend:' + targetId, '自' + fromW.n + '飞升' + toW.n);
      /* 秘术飞升升品（《闭环报告 v3.2》G11）：秘术品阶跟着**获得它的世界**走，
         飞升到更高的界后手上的秘术一并升品 —— 否则凡界早期拿到的秘术
         到了仙界还是凡品 1.0，等于作废。只升不降。 */
      var upgraded = 0;
      if (G.Data.dungeons && save.secrets) {
        var g2 = G.Data.dungeons.secretGrade(targetId);
        Object.keys(save.secrets).forEach(function (id) {
          if (G.Data.dungeons.gradeOf(save, id) < g2) {
            save.secrets[id] = g2;
            upgraded += 1;
          }
        });
      }
      if (meta) {
        meta.progress = meta.progress || {};
        meta.progress.activeWorld = targetId;
      }
      var st = this.computeStats(save, meta);
      save.hp = st.maxhp;     /* 飞升跨界，气血回满 */
      if (G.Storage) {
        if (G.Storage.saveMeta) G.Storage.saveMeta(meta);
        if (G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      }
      if (G.TianDao) G.TianDao.notify('ascend');
      if (G.Story) G.Story.onBreak(meta, save, save.globalLevel);
      return { ok: true, from: fromW.id, to: targetId, gl: save.globalLevel,
        secretUpgraded: upgraded };
    },

    _applyBreak: function (save, meta, big) {
      save.globalLevel = Math.min(MAX_GL, (save.globalLevel || 1) + 1);
      /* 本世到达过的最高等级（仙力结算用，规格 v0.4 §4） */
      save.maxGlobalLevel = Math.max(save.maxGlobalLevel || 1, save.globalLevel);
      /* 突破耗岁（§3.2）：每次 +2 岁 */
      this.agePush(save, 'break');
      if (big) this.chronicle(save, 'break:' + save.globalLevel,
        '破入' + this.realmInfo(save.globalLevel).n);
      var st = this.computeStats(save, meta);
      save.hp = st.maxhp;     /* 突破刷新上限并回满气血 */
      if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      /* 天道注视 + 低语（v2.7：注视累加与阈值判定统一走 TianDao） */
      if (G.TianDao) G.TianDao.notify(big ? 'breakBig' : 'breakSmall');
      if (G.Story) G.Story.onBreak(meta, save, save.globalLevel);
      return save.globalLevel;
    },

    /* 地狱难度永久加成（《四界区域与副本落位设计 v1.1》§2.5）
       每界地狱通关 → meta.hellCleared[界]=true；**从飞升到上一界起**生效，跨世永久。
       返回百分比（0.1 = +10%），三界都满足时叠加到 +30%。 */
    hellBonusPct: function (meta) {
      meta = meta || G.game.meta;
      var hc = (meta && meta.hellCleared) || {};
      var pr = (meta && meta.progress) || {};
      var wd = pr.worlds || {};
      var pct = 0;
      if (hc.fan && wd.ling) pct += 0.10;        /* 凡界地狱 → 飞升灵界后 */
      if (hc.ling && wd.xian) pct += 0.10;       /* 灵界地狱 → 飞升仙界后 */
      if (hc.xian && pr.daoKey) pct += 0.10;     /* 仙界地狱 → 道界开启后 */
      return pct;
    },

    /* ===== 宗门与散修：功法归属门禁（《宗门与散修体系设计 v1.0》§2.2）=====
       这是"两道互斥"的**唯一判定口** —— 装备、面板显示、战斗技能栏三处都调它，
       不各判一次（三处各判迟早分叉）。

       规则：
         · `voided`（废功）→ 一律不可用（转阵营时被打上，保留条目但封掉）
         · `common` 开局三本 → 两道通用
         · `free`   散修功法 → 仅散修（`cult !== 'sect'`）
         · `sect`   宗门功法 → 仅本门（按**根宗门**判：山门/总部/道场算同一门） */
    canUseSkill: function (save, id) {
      var sk = G.Data.skills && G.Data.skills[id];
      if (!sk) return false;
      var own = (save && save.skills && save.skills[id]) || null;
      if (own && own.voided) return false;
      var src = sk.src || 'free';
      if (src === 'common') return true;
      if (src === 'free') return (save.cult || 'free') !== 'sect';
      if (src === 'sect') {
        if ((save.cult || 'free') !== 'sect' || !save.sectId) return false;
        if (!G.Data.sects) return true;
        return G.Data.sects.rootOf(save.sectId) === sk.sect;
      }
      return true;
    },

    /* 该功法为什么不可用（面板/装备失败时的提示文案）；可用则返回 null */
    skillBlockReason: function (save, id) {
      var sk = G.Data.skills && G.Data.skills[id];
      if (!sk) return '无此功法';
      var own = (save && save.skills && save.skills[id]) || null;
      if (own && own.voided) return '已废功（改换门庭所致）';
      if (this.canUseSkill(save, id)) return null;
      return (sk.src === 'sect') ? '宗门功法，非本门弟子不可用' : '散修功法，宗门弟子不可用';
    },

    /* ===== 法宝三槽（v0.25.0）=====
       用户口径：「这个人物少了三个法宝格子，武器、防具、饰品」。
       `save.equip = { weapon, armor, accessory }`；法宝本身存在 `save.items`（>0 即拥有）——
       **不另立一套背包**，否则"储物页看不到法宝"必然出问题。 */
    equipFx: function (save) {
      if (!G.Data.equips) return { a: 0, f: 0, h: 0, s: 0, c: 0, cd: 0, vamp: 0 };
      return G.Data.equips.sum(save && save.equip);
    },
    /* 穿上/脱下：穿上前校验"该槽 + 拥有"；脱下即置空。
       返回 {ok, reason} —— 调用方只负责提示文案。 */
    setEquip: function (save, slot, id) {
      if (!G.Data.equips || G.Data.equips.SLOTS.indexOf(slot) < 0) {
        return { ok: false, reason: '无此槽位' };
      }
      save.equip = save.equip || { weapon: null, armor: null, accessory: null };
      if (!id) { save.equip[slot] = null; }
      else {
        var e = G.Data.equips.byId(id);
        if (!e) return { ok: false, reason: '无此法宝' };
        if (e.slot !== slot) return { ok: false, reason: '法宝与槽位不符' };
        if (!((save.items || {})[id] > 0)) return { ok: false, reason: '尚未拥有' };
        save.equip[slot] = id;
      }
      if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      return { ok: true };
    },

    /* ===== 副本内临时增益（每层三选一，v0.23.0）=====
       只读 `save.dungeonRun.buffs` —— 它**只在本场副本内存在**：
       进副本时新建、出副本/飞升时整个 run 被丢掉，所以不需要额外的清理逻辑。 */
    dungeonBuffFx: function (save) {
      var run = save && save.dungeonRun;
      if (!run || !run.buffs || !run.buffs.length || !G.Data.dungeonBuffs) {
        return { a: 0, f: 0, h: 0, s: 0, c: 0, cd: 0, vamp: 0 };
      }
      return G.Data.dungeonBuffs.sum(run.buffs);
    },

    /* ===== 御剑飞行（v0.22.0）=====
       金丹境起可御剑（《境界体系 v3.2》的 19 境里第 4 境）。
       ⚠️ 门槛**从 REALMS 表现算**，不写死 gl 数字 —— 境界表一调，
          门槛自动跟着走；写死就会在境界调整后静默失准。 */
    flyRealmName: '金丹',
    canFly: function (save) {
      if (!save) return false;
      var r = this.realmOf(save.globalLevel || 1);
      /* 按境界序号比较：>= 金丹 的境都算 */
      var idx = -1, need = -1;
      for (var i = 0; i < REALMS.length; i++) {
        if (REALMS[i].n === this.flyRealmName) need = i;
        if (REALMS[i].n === r.n) idx = i;
      }
      return need >= 0 && idx >= need;
    },
    /* 飞行时的移速倍率（越小越快） */
    FLY_MOVE_COEF: 0.55,

    /* ===== 宗门：转阵营与贡献（《宗门与散修体系设计 v1.0》S2）=====
       放在 Player 而不是 panels.js —— **战斗也要能调**（入门试炼在 battle 里结算），
       放面板里会让 battle 反向依赖 UI。 */
    switchCult: function (save, toSect, sectId) {
      var n = 0;
      Object.keys(save.skills || {}).forEach(function (id) {
        var sk = G.Data.skills[id];
        if (!sk || !save.skills[id]) return;
        if (sk.src !== 'free' && sk.src !== 'sect') return;      /* common 两道通用，不动 */
        if (toSect && sk.src === 'free') { save.skills[id].voided = true; n++; }
        if (!toSect && sk.src === 'sect') { save.skills[id].voided = true; n++; }
      });
      /* 先切阵营再过滤装备 —— canUseSkill 读的是切完之后的 save */
      save.cult = toSect ? 'sect' : 'free';
      save.sectId = toSect ? sectId : null;
      save.sectRep = 0;
      save.sectRank = 'outer';
      save.cultSwitchUsed = true;
      save.skillEquip = (save.skillEquip || []).filter(function (id) {
        return this.canUseSkill(save, id);
      }, this);
      return n;                                   /* 被废功的条数，供提示文案用 */
    },

    /* 贡献/声望增减（散修时同一字段当"散修声望"用） */
    addRep: function (save, n) {
      save.sectRep = Math.max(0, (save.sectRep || 0) + n);
      return save.sectRep;
    },

    /* ===== 宗门位阶与岁俸（S4，对标《鬼谷八荒》）=====
       用户问「其他主流游戏是怎么设计宗门的」→ 鬼谷八荒的宗门有**职位**，
       职位带来**稳定收益**（月俸），这才让"待在宗门里"有实感。
       我们的时间单位是**岁**（不是月），所以做**岁俸**：每长一岁领一次。
       · 位阶**由贡献推导**，不另存一个字段（两处真相源必然分叉）：
         外门 <200 / 内门 ≥200 / 真传 ≥600。
       · `save.stipendAge` 记上次结算的年龄 —— 同一年不重复发。 */
    RANK_N: { outer: '外门', inner: '内门', core: '真传' },
    RANK_AT: { inner: 200, core: 600 },
    rankOf: function (save) {
      var rep = (save && save.sectRep) || 0;
      if (rep >= this.RANK_AT.core) return 'core';
      if (rep >= this.RANK_AT.inner) return 'inner';
      return 'outer';
    },
    /* 岁俸数额：按位阶给灵石 + 丹药（真传还多一颗聚气散） */
    STIPEND: {
      outer: { stone: 120, items: {} },
      inner: { stone: 320, items: { '回春丹': 2 } },
      core: { stone: 700, items: { '回春丹': 3, '聚气散': 1 } }
    },
    /* 结算岁俸；返回本次发放的文案数组（没到新岁 / 非宗门弟子则返回空数组） */
    tickStipend: function (save) {
      if (!save || save.cult !== 'sect' || !save.sectId) return [];
      var age = save.age || 0;
      if (save.stipendAge == null) { save.stipendAge = age; return []; }
      if (save.stipendAge >= age) return [];
      save.stipendAge = age;
      var rank = this.rankOf(save);
      var sp = this.STIPEND[rank] || this.STIPEND.outer;
      save.stone = (save.stone || 0) + sp.stone;
      save.items = save.items || {};
      var got = [];
      Object.keys(sp.items).forEach(function (k) {
        save.items[k] = (save.items[k] || 0) + sp.items[k];
        got.push(k + ' ×' + sp.items[k]);
      });
      if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      return ['岁俸（' + (this.RANK_N[rank] || rank) + '）　灵石 +' + sp.stone]
        .concat(got.length ? ['　' + got.join('　')] : []);
    },

    /* ===== 自创宗门（S5，《宗门与散修体系设计 v1.0》§5）=====
       三条件：境界 ≥ 化神圆满（gl 54）**或**已飞升灵界 / 灵石 ≥ 50000 / 声望 ≥ 300。
       · 写 `meta.mySect`（**跨世保留**）—— 下一世可"继承本门"免创建费。
       · 创建后 `cult='sect'`、`sectId='own'`，**不占用**那"每世一次"的转阵营机会
         （自创是独立事件，与"改换门庭"不是一回事）。
       · 镇派功法从**自己已习得**的功法里选 —— 把散修功法收编为镇派，
         这是唯一"跨道"的口子，且要付出创建成本。 */
    FOUND: { gl: 216, stone: 50000, rep: 300 },
    canFoundSect: function (save, meta) {
      if (!save) return { ok: false, reason: '无存档' };
      if (save.sectId === 'own') return { ok: false, reason: '你已自创宗门' };
      var have = Object.keys(save.skills || {}).filter(function (id) {
        return !(save.skills[id] && save.skills[id].voided);
      });
      if (!have.length) return { ok: false, reason: '尚无可用功法，无以立派' };
      var gl = save.globalLevel || 1;
      var ascended = !!(meta && meta.progress && meta.progress.worlds
        && meta.progress.worlds.ling);
      if (gl < this.FOUND.gl && !ascended) {
        return { ok: false, reason: '境界不足（需化神圆满或已飞升灵界）' };
      }
      if ((save.stone || 0) < this.FOUND.stone) {
        return { ok: false, reason: '灵石不足（需 ' + this.FOUND.stone + '）' };
      }
      if ((save.sectRep || 0) < this.FOUND.rep) {
        return { ok: false, reason: '声望不足（需 ' + this.FOUND.rep + '）' };
      }
      return { ok: true, skills: have };
    },
    foundSect: function (save, meta, name, skillId) {
      var chk = this.canFoundSect(save, meta);
      if (!chk.ok) return chk;
      if (!skillId || chk.skills.indexOf(skillId) < 0) {
        return { ok: false, reason: '镇派功法须是你已习得的功法' };
      }
      save.stone -= this.FOUND.stone;
      save.cult = 'sect';
      save.sectId = 'own';
      save.ownSect = { name: name || '无名宗', skill: skillId, disciples: 0 };
      meta.mySect = { name: save.ownSect.name, skill: skillId };
      if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      if (G.Storage && G.Storage.saveMeta) G.Storage.saveMeta(meta);
      return { ok: true, name: save.ownSect.name };
    },
    /* 收徒（S5）：花灵石招一名弟子，每人 **+2% 全属性**（上限 5 人）。
       ⚠️ 加成并进 `te`（与法宝/副本增益同一条路）—— 一处生效，面板与战斗都认。 */
    DISCIPLE_MAX: 5,
    DISCIPLE_COST: 8000,
    DISCIPLE_BONUS: 0.02,
    recruitDisciple: function (save) {
      if (!save || save.sectId !== 'own' || !save.ownSect) {
        return { ok: false, reason: '只有自创宗门才可收徒' };
      }
      var n = save.ownSect.disciples || 0;
      if (n >= this.DISCIPLE_MAX) return { ok: false, reason: '弟子已满（' + this.DISCIPLE_MAX + ' 人）' };
      if ((save.stone || 0) < this.DISCIPLE_COST) {
        return { ok: false, reason: '灵石不足（需 ' + this.DISCIPLE_COST + '）' };
      }
      save.stone -= this.DISCIPLE_COST;
      save.ownSect.disciples = n + 1;
      if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      return { ok: true, n: save.ownSect.disciples };
    },
    ownSectFx: function (save) {
      var n = (save && save.ownSect && save.ownSect.disciples) || 0;
      var v = n * this.DISCIPLE_BONUS;
      return { a: v, f: v, h: v, s: 0, c: 0, cd: 0, vamp: 0 };
    },

    /* ===== 散修盟悬赏（S4 的另一半）=====
       散修侧原先只有"买与刷"，没有任何"接活换钱"的路径（设计稿 §4.2）。
       悬赏：接一件 → 在野外斩妖 N 只 → 回来领灵石。
       ⚠️ 用 `wildKills` 的**增量**判定（接单时记基线），不是绝对计数 ——
          否则老档一接单就直接完成。 */
    BOUNTY: [
      { id: 'b1', n: '清剿山兽', need: 8, stone: 400 },
      { id: 'b2', n: '猎杀凶兽', need: 16, stone: 900 },
      { id: 'b3', n: '血战群妖', need: 28, stone: 1800 }
    ],
    acceptBounty: function (save, idx) {
      if (!save || save.cult === 'sect') return { ok: false, reason: '宗门弟子不接散修盟的活' };
      var b = this.BOUNTY[idx];
      if (!b) return { ok: false, reason: '无此悬赏' };
      if (save.bounty) return { ok: false, reason: '手上还有一件悬赏未了' };
      save.bounty = { id: b.id, need: b.need, stone: b.stone, base: save.wildKills || 0 };
      if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      return { ok: true, b: b };
    },
    bountyLeft: function (save) {
      var b = save && save.bounty;
      if (!b) return 0;
      return Math.max(0, b.need - ((save.wildKills || 0) - b.base));
    },
    claimBounty: function (save) {
      var b = save && save.bounty;
      if (!b) return { ok: false, reason: '没有在身的悬赏' };
      if (this.bountyLeft(save) > 0) {
        return { ok: false, reason: '还差 ' + this.bountyLeft(save) + ' 只' };
      }
      save.stone = (save.stone || 0) + b.stone;
      save.sectRep = (save.sectRep || 0) + 30;   /* 散修声望（同一字段） */
      var got = b.stone;
      save.bounty = null;
      if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      return { ok: true, stone: got };
    },

    /* ===== 门派商店（S3，对标《烟雨江湖》）=====
       用**贡献**换丹药/符箓/材料 —— 宗门弟子除了功法还有稳定补给，
       这是"宗门 vs 散修"资源差的落点（散修只能靠买与刷）。
       ⚠️ 商品表按宗门品阶过滤：小宗门只出凡阶，大宗门才出灵阶。 */
    buySectItem: function (save, idx) {
      var SH = G.Data.sects && G.Data.sects.SHOP;
      if (!SH || !SH[idx]) return { ok: false, reason: '无此商品' };
      var it = SH[idx];
      if ((save.sectRep || 0) < it.cost) {
        return { ok: false, reason: '贡献不足（需 ' + it.cost + '）' };
      }
      save.sectRep -= it.cost;
      save.items = save.items || {};
      save.items[it.item] = (save.items[it.item] || 0) + it.n;
      if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      return { ok: true, item: it, name: this.itemName(it.item) };
    },

    /* 道具显示名（v0.41.0）：普通道具 id 即中文名；法宝 id（eq_ 前缀）走法宝表。
       ⚠️ 任何"把道具 id 画给玩家看"的地方都必须先过这里 ——
          否则 eq_qingfeng 这类内部 id 会直接裸显在界面上。 */
    itemName: function (id) {
      var eq = G.Data.equips && G.Data.equips.byId(id);
      return eq ? eq.n : id;
    },

    /* 入门试炼的**门槛**（试炼本身是一场切磋战，见 battle.js: sectTrial） */
    trialReady: function (save) {
      return (save.globalLevel || 1) >= 37;       /* 炼气一重初期起 */
    },

    /* 兑换本门功法：扣贡献 → 习得（未习得才给换；已习得返回原因） */
    learnSectSkill: function (save, id) {
      var sk = G.Data.skills[id];
      if (!sk) return { ok: false, reason: '无此功法' };
      if (save.skills && save.skills[id] && !save.skills[id].voided) {
        return { ok: false, reason: '已习得' };
      }
      if (!this.canUseSkill(save, id)) return { ok: false, reason: '非本门功法' };
      /* ===== 功法前置链（S3，对标《太吾绘卷》）=====
         本门功法**按池子顺序解锁**：第 2 本需要第 1 本修至「一重·后期」（prog≥3）。
         没有前置链的话，贡献一够就能直接买最强的 —— "成长"没有层次，
         玩家也不会去用第一本。 */
      var sect = G.Data.sects.byId(save.sectId);
      var pool = (sect && sect.skills) || [];
      var myIdx = pool.indexOf(id);
      if (myIdx > 0) {
        var prev = pool[myIdx - 1];
        var pv = (save.skills && save.skills[prev] && save.skills[prev].lv) || 0;
        if (pv < 3) {
          var pn = (G.Data.skills[prev] && G.Data.skills[prev].n) || prev;
          return { ok: false, reason: '需先修《' + pn + '》至「' + G.Data.skillRealm(3).short + '」（当前 ' + G.Data.skillRealm(pv).short + '）' };
        }
      }
      var cost = (sk.tier === '灵') ? 150 : 50;
      if ((save.sectRep || 0) < cost) {
        return { ok: false, reason: '贡献不足（需 ' + cost + '）' };
      }
      save.sectRep -= cost;
      save.skills = save.skills || {};
      /* 已废功的同类功法：重新习得视为"复功"（清掉 voided） */
      save.skills[id] = { lv: 1, voided: false };
      if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      return { ok: true, cost: cost };
    },

    /* ===== 问道（v0.20.0）=====
       用户口径：「天道赐福属于**问道其中的一种**；每个大境界可以问道一次；
       突破之后，问道可能是奖励也可能是惩罚，扣除灵石、灵力、灵气之类的」。

       · 触发：**破大境成功之后**（心魔劫胜）自动问一次
       · 频次：每个「境」一次 —— `save.askedRealms[境名]`，**本世有效**（轮回清空）
       · 结果：加权抽取，正负都有；「赐福」写 `meta.blessing`，
         直接进破境公式的"天道赐福 额外 +1~5%"那一项
       · 扣减有**下限保护**：不会把资源扣成负数 */
    ASK_TABLE: [
      { id: 'bless', w: 26, k: 'good', t: '天道赐福 · 此后破境 +{n}%' },
      { id: 'stone', w: 16, k: 'good', t: '灵石 +{n}' },
      { id: 'qi', w: 14, k: 'good', t: '灵气 +{n}' },
      { id: 'po', w: 10, k: 'good', t: '灵力 +{n}' },
      { id: 'plain', w: 12, k: 'none', t: '天道无言，唯余风声' },
      { id: 'lostS', w: 10, k: 'bad', t: '天道索偿 · 灵石 -{n}' },
      { id: 'lostQ', w: 8, k: 'bad', t: '天道索偿 · 灵气 -{n}' },
      { id: 'lostP', w: 4, k: 'bad', t: '天道索偿 · 灵力 -{n}' }
    ],

    /* 返回 {id,k,text,n,realm}；本境已问过则返回 null（调用方据此决定要不要出提示） */
    askDao: function (save, meta) {
      if (!save || !meta) return null;
      var realm = this.realmOf(save.globalLevel || 1);
      save.askedRealms = save.askedRealms || {};
      if (save.askedRealms[realm.n]) return null;
      save.askedRealms[realm.n] = 1;

      var T = this.ASK_TABLE, tot = 0;
      T.forEach(function (e) { tot += e.w; });
      var r = G.rng.next() * tot, pick = T[T.length - 1];
      for (var i = 0; i < T.length; i++) { r -= T[i].w; if (r < 0) { pick = T[i]; break; } }

      /* 数额随境界走：越高的境，赏罚越大（按压缩阶，与经济口径一致） */
      var lvl = Math.max(1, Math.round(this.scaleLevel(save.globalLevel || 1) / 8));
      var n = 0;
      if (pick.id === 'bless') {
        n = 1 + Math.floor(G.rng.next() * 5);              /* 1~5 */
        meta.blessing = Math.max(meta.blessing || 0, n);
      } else if (pick.id === 'stone') { n = 60 * lvl; save.stone = (save.stone || 0) + n; }
      else if (pick.id === 'qi') { n = 220 * lvl; save.qi = (save.qi || 0) + n; }
      else if (pick.id === 'po') { n = 6 * lvl; save.po = (save.po || 0) + n; }
      else if (pick.id === 'lostS') {
        n = Math.min(60 * lvl, save.stone || 0); save.stone = (save.stone || 0) - n;
      } else if (pick.id === 'lostQ') {
        n = Math.min(220 * lvl, save.qi || 0); save.qi = (save.qi || 0) - n;
      } else if (pick.id === 'lostP') {
        n = Math.min(6 * lvl, save.po || 0); save.po = (save.po || 0) - n;
      }
      if (G.Storage) {
        if (G.Storage.saveCurrent) G.Storage.saveCurrent(save);
        if (G.Storage.saveMeta) G.Storage.saveMeta(meta);
      }
      return { id: pick.id, k: pick.k, text: pick.t.replace('{n}', n), n: n, realm: realm.n };
    },

    computeStats: function (save, meta) {
      meta = meta || G.game.meta;
      var gl = save.globalLevel || 1;
      /* 基础属性按**压缩阶**（大境×九重，1..171）生长：同一重内初/中/后/巅四阶
         实力相近，与敌人/Boss 的缩放口径一致 —— 不直接用 36 阶的 gl 数值。 */
      var Ls = this.scaleLevel(gl);
      /* 存档兜底：残缺/损坏档不应让 HUD 直接白屏 */
      var lg = save.linggen || { elems: ['无'], coef: {}, stoneBonus: 0 };
      var coef = lg.coef || {};
      if (!lg.elems || !lg.elems.length) lg.elems = ['无'];
      var atk = 10 + Ls * 2, def = 5 + Ls * 1.5;
      var hp = 100 + Ls * 20, spd = 10 + Ls * .5;
      /* 法力上限（v0.14.0）：释放主动技的代价，战斗内每回合回 MP_REGEN 点。
         基础随境界涨；仙术类功法额外贡献（与"仙术→气血"同一条分支）——
         不新增"第六个来源"，仍走「境界成长 + 功法」这两条老口径。 */
      var mp = 20 + Ls * 2;

      /* 功法 */
      Object.keys(save.skills || {}).forEach(function (id) {
        var sd = G.Data.skills[id], lv = (save.skills[id] && save.skills[id].lv) || 1;
        if (!sd) return;
        var base = G.Data.tierCoef[sd.tier] || 1;
        var matched = sd.elem !== '无' && coef[sd.elem] ? 1.2 : 1;
        var lgCoef = coef[sd.elem] || 1;
        var m = base * matched * lgCoef;
        if (sd.kind === '攻击') atk += lv * 5 * m;
        else if (sd.kind === '防御') def += lv * 3 * m;
        else { hp += lv * 20 * m; mp += lv * 6 * m; }
      });

      /* 仙躯灌注 */
      var bk = (meta && meta.perfusion && meta.perfusion.body) || 0;
      atk += 2 * bk; def += bk; hp += 12 * bk; spd += bk;

      /* 天赋百分比 */
      var te = this.talentEffects(save);
      /* 副本内临时增益（每层三选一）：**并进 te** —— 一处生效，
         面板 / HUD / 战斗三处自动都认到。另起一套应用点必然有一处漏
         （表现是"面板涨了、战斗没涨"，且完全静默）。 */
      var dbfx = this.dungeonBuffFx(save);
      te.a += dbfx.a; te.f += dbfx.f; te.h += dbfx.h; te.s += dbfx.s;
      te.c += dbfx.c; te.cd += dbfx.cd;
      /* 法宝三槽（v0.25.0）：同一条路并进 te —— 面板/HUD/战斗自动都认到 */
      var eqfx = this.equipFx(save);
      te.a += eqfx.a; te.f += eqfx.f; te.h += eqfx.h; te.s += eqfx.s;
      te.c += eqfx.c; te.cd += eqfx.cd;
      /* 自创宗门的弟子加成（S5）：同一条路并进 te */
      var osfx = this.ownSectFx(save);
      te.a += osfx.a; te.f += osfx.f; te.h += osfx.h;
      atk *= 1 + te.a; def *= 1 + te.f;
      hp *= 1 + te.h; spd *= 1 + te.s;
      var crit = .05 + te.c;
      var critDmg = 1.5 + te.cd;

      /* 世界特质 */
      var we = this.worldEffects(save);
      atk *= 1 + we.a;
      hp *= 1 + we.h;
      def *= 1 + we.f;
      spd *= 1 + we.s;

      /* 地狱难度永久加成（跨世；生效时机见设计 v1.1 §2.5）——全属性同乘 */
      var hb = this.hellBonusPct(meta);
      if (hb > 0) { atk *= 1 + hb; def *= 1 + hb; hp *= 1 + hb; spd *= 1 + hb; mp *= 1 + hb; }

      /* 圣术（签名秘术）百分比 */
      var sp2 = this.secretPct(save);
      atk *= 1 + sp2.a; def *= 1 + sp2.f;
      hp *= 1 + sp2.h; spd *= 1 + sp2.s;

      /* 道纹阵：道界内全属性 +5%（《四大技艺 v1.0》§3.5） */
      if (G.Formations && G.Formations.has(save, 'daowen')
          && this.activeWorldId(meta) === 'dao') {
        atk *= 1.05; def *= 1.05; hp *= 1.05; spd *= 1.05;
      }

      var st = {
        maxhp: Math.round(hp), atk: Math.round(atk), def: Math.round(def),
        spd: Math.round(spd), crit: crit, critDmg: critDmg,
        mpMax: Math.max(10, Math.round(mp)),
        te: te, we: we,
        /* 免疫状态（天赋 T003/T009/T018/T019/T024/T028 等） */
        im: te.im.slice(),
        /* 普攻属性 = 灵根第一属性（v0.3 §4.4） */
        attackElem: (lg.elems && lg.elems[0]) || '无'
      };
      this.ensureHP(save, st);
      return st;
    },

    ensureHP: function (save, st) {
      if (save.hp == null) save.hp = st.maxhp;
      save.hp = Math.max(0, Math.min(save.hp, st.maxhp));
    },

    /* 资源获取加成（分数） */
    rates: function (save) {
      var te = this.talentEffects(save), we = this.worldEffects(save);
      var bonus = save.bonus || {};
      var fQi = (G.Formations && G.Formations.has(save, 'juling')) ? 0.15 : 0;
      return {
        qi: te.qi + we.qi + (bonus.qi || 0) + fQi,
        po: te.po + we.po + (bonus.po || 0),
        st: te.st + we.st
          + ((save.linggen && save.linggen.stoneBonus) || 0)
      };
    },

    /* 修炼灵力消耗：30 × 当前等级 × 品阶系数 */
    skillCost: function (sd, currentLv) {
      var tc = G.Data.tierCoef[sd.tier] || 1;
      return Math.round(30 * currentLv * tc);
    },

    /* ===== 破境成功率（v0.18.0）=====
       用户口径：「大道五十，天衍四九，人遁其一」——
         成功率 = **基础 + 失败累计道基 + 破境丹 + 天道赐福**；
         其中（基础 + 道基 + 破境丹）**封顶 95%**（"天衍四九"），天道赐福**额外**再加 1%~5%。
       三条规则（用户原话）：
         · 基础突破概率与失败累计道基**随境界提升而降低**；
         · 破境丹：下品固定 +10%，每品级额外 +2%，**最高道级也只 +30%**；
         · **所有大境界破境都需要破境丹**（现有规则，这里只是把它写进公式）。
       ⚠️ 基础概率用**境界序号**衰减，不是用 gl —— gl 有 171 级，
       拿它做线性衰减会让中期直接掉到 0（"后期必失败"不是设计意图）。 */
    PILL_QUALITY: [
      { n: '下品', add: 10 }, { n: '中品', add: 12 }, { n: '上品', add: 14 },
      { n: '极品', add: 16 }, { n: '黄级', add: 18 }, { n: '玄级', add: 20 },
      { n: '地级', add: 22 }, { n: '天级', add: 24 }, { n: '神级', add: 26 },
      { n: '仙级', add: 28 }, { n: '圣级', add: 30 }, { n: '道级', add: 30 }
    ],
    /* 破境丹的品级序号（1..12）= 它服务的**大境界序号**映射到 12 档。
       ⚠️ 必须**单调不降**：写成"高境界反而吃低品丹"会让后期破境比前期还容易。 */
    pillQualityIdx: function (gl) {
      var name = this.realmOf(gl || 1).n;
      var list = this.REALMS || [];
      var i = 0;
      for (var k = 0; k < list.length; k++) { if (list[k].n === name) { i = k; break; } }
      var n = Math.max(1, list.length);
      return Math.max(1, Math.min(12, Math.round(i / Math.max(1, n - 1) * 11) + 1));
    },
    /* 筑基的 gl（"失败累计道基"从这一刻起才生效 —— 用户口径"筑基之后才有"） */
    BASE_GL: 73,
    breakChance: function (save, meta) {
      var st = this.breakState(save);
      var gl = st.gl;
      var q = this.pillQualityIdx(gl);
      var base = 85 - (q - 1) * 5.5;                       /* v0.60 更残酷：85 / 79.5 / … / 24.5（早期+丹仍封顶95） */
      var dao = 0;
      if (gl >= this.BASE_GL) dao = Math.min(20, (save.breakFails || 0) * 6);
      var pill = this.PILL_QUALITY[q - 1].add;
      var b = (meta && meta.blessing) || 0;
      var bless = b > 0 ? Math.max(1, Math.min(5, b)) : 0;
      var jing = (G.Formations && G.Formations.has(save, 'jingxin')) ? 10 : 0;
      var core = Math.min(95, base + dao + pill);        /* 「天衍四九」：前三项封顶 95 */
      return {
        base: base, dao: dao, pill: pill, bless: bless, jing: jing,
        core: core, total: Math.min(100, core + bless + jing),
        q: q, pillName: this.PILL_QUALITY[q - 1].n, fails: save.breakFails || 0
      };
    },

    /* 战斗内每回合回复的法力（v0.14.0）。写在这里而不是 battle.js ——
       契约与面板都要读同一份，散在场景里就等于有两个口径。 */
    MP_REGEN: 5,

    /* 释放主动技的法力消耗（v0.14.0）：
       基础 **10 点**（用户口径："最低 10 点才能释放一个技能"），
       **功法等级越高耗得越多**（每级 +4），再乘品阶系数（凡 1.0 / 灵 1.5 / 宝 2.0）。
       品阶系数沿用 `tierCoef` —— 与功法对面板的贡献同源，不另立一套。
       ⚠️ 系数改了这里会自动跟着变，但**消耗的绝对值会变**，契约钉了 lv1 凡阶 = 10。 */
    manaCost: function (sd, lv) {
      var tc = G.Data.tierCoef[(sd && sd.tier) || '凡'] || 1;
      var base = 10 + (Math.max(1, lv || 1) - 1) * 4;
      return Math.round(base * tc);
    },

    /* 碎片持有量（v0.14.0）：储物里按逻辑名存，缺字段一律当 0 */
    shardCount: function (save, tier) {
      var item = (G.Data.shardByTier || {})[tier];
      if (!item) return 0;
      return ((save.items || {})[item]) || 0;
    },

    /* 当前**碎片够数**的最高品阶（宝 → 灵 → 凡），没有则 null。
       功法面板的「参悟」按钮读它 —— 让玩家不必自己算哪个品阶够了。 */
    bestShardTier: function (save) {
      var need = G.Data.shardCost || 10;
      var order = ['宝', '灵', '凡'];
      for (var i = 0; i < order.length; i++) {
        if (this.shardCount(save, order[i]) >= need) return order[i];
      }
      return null;
    },

    /* 参悟（v0.14.0）：消耗 shardCost 片同品阶碎片 → 随机一本该品阶功法。
       **优先补未习得**：全习得了才转"精进"（+1 级）——
       否则老玩家会反复抽到同一本，碎片等于白花。
       返回 { ok, reason?, id?, name?, lv?, learned? }。 */
    inscribe: function (save, tier) {
      var Dt = G.Data;
      var item = (Dt.shardByTier || {})[tier];
      if (!item) return { ok: false, reason: '未知品阶：' + tier };
      var need = Dt.shardCost || 10;
      var have = this.shardCount(save, tier);
      if (have < need) {
        return { ok: false, reason: item + '不足（' + have + '/' + need + '）' };
      }
      var pool = Dt.shardPool(tier);
      if (!pool.length) return { ok: false, reason: '此品阶暂无功法可参悟' };

      var MAXP = G.Data.SKILL_MAX_PROG;
      var fresh = pool.filter(function (id) { return !save.skills[id]; });
      /* 已习得的里，只挑还没到九重巅峰的（否则碎片会白砸到顶的功法上）*/
      var canUp = pool.filter(function (id) {
        return save.skills[id] && save.skills[id].lv < MAXP;
      });
      if (!fresh.length && !canUp.length) {
        return { ok: false, reason: '此品阶功法皆已修至九重巅峰' };
      }
      var pick = G.rng.pick(fresh.length ? fresh : canUp);
      save.items = save.items || {};
      save.items[item] -= need;
      if (save.items[item] <= 0) delete save.items[item];

      var learned = !save.skills[pick];
      if (learned) save.skills[pick] = { lv: 1 };
      else save.skills[pick].lv += 1;
      return {
        ok: true, id: pick, name: (Dt.skills[pick] || {}).n || pick,
        lv: save.skills[pick].lv, learned: learned
      };
    },

    /* 打坐（legacy，按**游戏分钟**线性给灵气）。
       ⚠️ v0.61.0 起正式的打坐是 `closeDoor`（闭关档位，见下）—— 这条只留给
          "珠内空间 / 香案"这类一次性小打坐，且**同样要推进世界时钟**（时间不会白给）。 */
    meditate: function (save, minutes) {
      var r = this.rates(save);
      var lg = save.linggen || { elems: ['无'], coef: {} };
      var first = (lg.elems && lg.elems[0]) || '无';
      var coef = (lg.coef && lg.coef[first]) || 1;
      var gain = Math.round(10 * minutes * coef * (1 + r.qi));
      save.qi = (save.qi || 0) + gain;
      if (G.Time) G.Time.advance(save, minutes);
      return gain;
    },

    /* 闭关（v0.61.0，用户第 4 点）：真正的"打坐修炼"。
       档位由 `G.Time.MEDITATE_TIERS` 给；收益随**首灵根系数**与灵气加成放大
       —— 这就是"灵根的作用"：同样的年月，好灵根拿到的灵气多得多。
       唯一实现走 `G.Time.meditate`（含寿元前置判定与时间推进），这里只是转发。 */
    closeDoor: function (save, tierId) {
      if (!G.Time) return { ok: false, reason: '世界时钟未载入' };
      return G.Time.meditate(save, tierId);
    },

    /* 突破等行为的**一次性加龄**（走 `ageBonus`，不混进世界时钟的累计里）。
       为什么不直接 advance：突破是"顿悟"，不该被日历折算成零头；
       走 ageBonus 后 `age = 16 + 年数 + ageBonus`，玩家在面板上能看明白这两笔账。 */
    addAgeBonus: function (save, years) {
      if (!save) return 0;
      save.ageBonus = (save.ageBonus || 0) + (years || 0);
      save.age = G.Time ? G.Time.ageOf(save) : (save.age || 16) + (years || 0);
      return years || 0;
    }
  };

  /* ============================================================
     副业（技艺）拜师学习（用户第 7 点）
     炼丹 / 炼器 / 采药 / 采矿皆**非天生即会**，须找名师拜师、付束脩、
     满足境界（有的还需先入门、或身为宗门弟子）方可掌握。
     技艺等级 1 入门 / 2 精通 / 3 宗师，决定能炼哪些配方、采哪些材料。
     **本世有效，轮回清零** —— 第一世若不去寻师，便一样都不会。
     ============================================================ */
  var PROFESSIONS = {
    herb: { n: '采药', lv: [
      { master: '姜老药师', place: '药圃', cost: 0, gl: 1, note: '养父采药老人，肯学便教' },
      { master: '宗门药圃执事', place: '宗门·药圃', cost: 800, gl: 73, sect: 1, note: '精通药性' },
      { master: '瑶池药仙', place: '仙界·药圃', cost: 12000, gl: 361, note: '宗师·识仙药' } ] },
    alchemy: { n: '炼丹', lv: [
      { master: '坐堂丹师·苏玄青', place: '药铺', cost: 300, gl: 1, need: { herb: 1 }, note: '先识药，再炼丹' },
      { master: '宗门丹堂首座', place: '宗门·炼丹房', cost: 1500, gl: 73, sect: 1, note: '精通丹火' },
      { master: '太清丹仙', place: '仙界·丹房', cost: 20000, gl: 361, note: '宗师·炼仙丹' } ] },
    mine: { n: '采矿', lv: [
      { master: '老矿工·石敢当', place: '矿口', cost: 200, gl: 1, note: '辨脉开山' },
      { master: '宗门矿脉管事', place: '宗门·矿脉', cost: 800, gl: 73, sect: 1, note: '精通寻脉' },
      { master: '幽冥矿使', place: '仙界·矿脉', cost: 12000, gl: 361, note: '宗师·采仙矿' } ] },
    forge: { n: '炼器', lv: [
      { master: '铁匠·铁大', place: '铁匠铺', cost: 400, gl: 1, note: '入门锻打' },
      { master: '宗门器堂首座', place: '宗门·炼器堂', cost: 1500, gl: 73, sect: 1, note: '精通炼器' },
      { master: '铸仙剑师', place: '仙界·器坊', cost: 20000, gl: 361, note: '宗师·铸仙器' } ] }
  };

  G.Professions = {
    list: PROFESSIONS,
    levelOf: function (save, id) { return ((save && save.prof) || {})[id] || 0; },
    known: function (save, id) { return this.levelOf(save, id) > 0; },
    /* 能否拜第 lv 级（1-based）的师父 */
    canLearn: function (save, meta, id, lv) {
      var t = PROFESSIONS[id].lv[lv - 1];
      if (!t) return { ok: false, reason: '无此师承' };
      if (this.levelOf(save, id) >= lv) return { ok: false, reason: '已习得' };
      if (lv > 1 && this.levelOf(save, id) < lv - 1)
        return { ok: false, reason: '须先得前一位师父传授' };
      if ((save.globalLevel || 1) < t.gl)
        return { ok: false, reason: '境界不足（需 ' + Player.realmInfo(t.gl).n + '）' };
      if (t.sect && save.cult !== 'sect') return { ok: false, reason: '需为宗门弟子' };
      if (t.need) for (var k in t.need) {
        if (this.levelOf(save, k) < t.need[k])
          return { ok: false, reason: '需先习得「' + PROFESSIONS[k].n + '」' };
      }
      if ((save.stone || 0) < t.cost)
        return { ok: false, reason: '灵石不足（束脩 ' + t.cost + '）' };
      return { ok: true };
    },
    learn: function (save, meta, id, lv) {
      var c = this.canLearn(save, meta, id, lv);
      if (!c.ok) return c;
      save.stone -= PROFESSIONS[id].lv[lv - 1].cost;
      save.prof = save.prof || {};
      save.prof[id] = lv;
      if (G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      return { ok: true };
    }
  };

  G.Player = Player;
})();
