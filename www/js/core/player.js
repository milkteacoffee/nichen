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

  /* ===== 境界体系（19 境，gl 1–171）=====
     淬体九段 + 炼气…道祖 各九重；全局境界等级 gl 范围 1—171。
     所需灵气 = 100 × 升级门槛系数 × 当前段数²
     新手境校准（经济表 v0.2 §5）：淬体境全部突破灵气 ×0.4
       → 淬体 1→9 合计 8,160（8 次小突破），淬体 9→10 = 8,100×0.4 = 3,240
     同界大境界切换（如 9→10、18→19）：另需一枚对应「突破丹」，并触发「问心魔劫」剧情战。
     跨界边界（63→64 / 90→91 / 144→145）：不由破境走，由「通关第5副本·飞升接引」完成（见 ascend）。 */
  var REALMS = [
    { n: '淬体', y0: 1, y1: 9, gate: 1, calib: .4 },
    { n: '炼气', y0: 10, y1: 18, gate: 2, calib: 1 },
    { n: '筑基', y0: 19, y1: 27, gate: 4, calib: 1 },
    { n: '金丹', y0: 28, y1: 36, gate: 8, calib: 1 },
    { n: '元婴', y0: 37, y1: 45, gate: 16, calib: 1 },
    { n: '化神', y0: 46, y1: 54, gate: 32, calib: 1 },
    { n: '炼虚', y0: 55, y1: 63, gate: 64, calib: 1 },
    { n: '合体', y0: 64, y1: 72, gate: 128, calib: 1 },
    { n: '大乘', y0: 73, y1: 81, gate: 256, calib: 1 },
    { n: '渡劫', y0: 82, y1: 90, gate: 512, calib: 1 },
    { n: '人仙', y0: 91, y1: 99, gate: 1024, calib: 1 },
    { n: '地仙', y0: 100, y1: 108, gate: 2048, calib: 1 },
    { n: '天仙', y0: 109, y1: 117, gate: 4096, calib: 1 },
    { n: '金仙', y0: 118, y1: 126, gate: 8192, calib: 1 },
    { n: '太乙金仙', y0: 127, y1: 135, gate: 16384, calib: 1 },
    { n: '大罗金仙', y0: 136, y1: 144, gate: 32768, calib: 1 },
    { n: '准圣', y0: 145, y1: 153, gate: 65536, calib: 1 },
    { n: '圣人', y0: 154, y1: 162, gate: 131072, calib: 1 },
    { n: '道祖', y0: 163, y1: 171, gate: 262144, calib: 1 }
  ];
  var MAX_GL = 171;
  var CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  /* 阶段单位（境界 v3.2 §1.1）：默认「重」，例外如下 */
  var REALM_UNIT = { 淬体: '段', 炼虚: '层', 准圣: '转', 圣人: '转', 道祖: '转' };
  /* 这三境用「初期/中期/后期/圆满」而非数序 */
  var PHASE_REALMS = { 筑基: 1, 金丹: 1, 元婴: 1 };
  function stageName(t, stage) {
    if (PHASE_REALMS[t.n]) {
      if (stage <= 3) return t.n + '初期';
      if (stage <= 6) return t.n + '中期';
      if (stage <= 8) return t.n + '后期';
      return t.n + (t.n === '元婴' ? '大圆满' : '圆满');
    }
    return t.n + CN[stage - 1] + (REALM_UNIT[t.n] || '重');
  }

  /* ===== 四界天花板（境界 v3.2 / 副本 v3.3）===== */
  var WORLDS = [
    { id: 'fan',  n: '凡界', start: 1,   cap: 63 },
    { id: 'ling', n: '灵界', start: 64,  cap: 90 },
    { id: 'xian', n: '仙界', start: 91,  cap: 144 },
    { id: 'dao',  n: '道界', start: 145, cap: 171 }
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

  var Player = {
    REALMS: REALMS,
    MAX_GL: MAX_GL,
    WORLDS: WORLDS,
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
       battle 每 10 场 +1 岁、meditate 每 60 分钟 +1 岁（余数累计），break 每次 +2 岁。
       返回本次实际增加的年岁（0 = 未满一岁）。 */
    agePush: function (save, reason, n) {
      if (save.age == null) save.age = 16;
      n = n || 1;
      if (reason === 'break') { save.age += AGE_PER_BREAK; return AGE_PER_BREAK; }
      var unit = reason === 'meditate' ? AGE_PER_MEDITATE : AGE_PER_BATTLE;
      save._ageTick = (save._ageTick || 0) + n;
      var gained = 0;
      while (save._ageTick >= unit) { save._ageTick -= unit; save.age += 1; gained += 1; }
      return gained;
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
      { id: 'A1', n: '初踏仙途', d: '首次修至炼气', xianli: 50, hit: function (s) { return (s.globalLevel || 1) >= 10; } },
      { id: 'A2', n: '道基初成', d: '首次修至筑基', xianli: 150, hit: function (s) { return (s.globalLevel || 1) >= 19; } },
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
      } }
    ],

    /* 结算一世仙力。返回明细，便于结算屏逐项展示。
       meta 会写入 meta.achieve（一次性成就），调用方负责存盘。 */
    xianliOf: function (save, meta) {
      var meta = meta || G.game.meta || {};
      var gl = save.maxGlobalLevel || save.globalLevel || 1;
      var lvSum = 0;
      Object.keys(save.skills || {}).forEach(function (k) {
        lvSum += (save.skills[k] && save.skills[k].lv) || 0;
      });
      var kills = save.bossKills || (save.bossKilled ? 1 : 0);
      var age = save.age || 16;
      var cause = this.deathCause(save);

      var d = {
        realm: 10 * gl,
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
      var lvSum = 0;
      Object.keys(save.skills || {}).forEach(function (k) {
        lvSum += (save.skills[k] && save.skills[k].lv) || 0;
      });
      var kills = save.bossKills || (save.bossKilled ? 1 : 0);
      var age = save.age || 16;
      return 10 * gl + 2 * lvSum + 30 * kills + Math.max(0, age - 15) * 2;
    },

    /* 死因分类（§3.1）：M0 只做战死与寿终坐化 */
    deathCause: function (save) {
      if (save._cause === 'aged') return { id: 'aged', n: '寿终坐化', mul: 1.1 };
      if (save._cause === 'event') return { id: 'event', n: '殒于变故', mul: 1.0 };
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

    /* 突破灵气折扣（天赋/世界特质；br 为负值即减免） */
    breakCut: function (save) {
      var te = this.talentEffects(save), we = this.worldEffects(save);
      var b = save.bonus || {};
      var cut = (te.br || 0) + (we.br || 0) + (b.br || 0);
      return Math.max(-0.6, Math.min(0.6, cut));
    },

    /* 当前境界 → 下一段所需灵气 */
    needQi: function (save, gl) {
      gl = gl || save.globalLevel || 1;
      var t = this.realmOf(gl);
      var stage = gl - t.y0 + 1;
      var base = 100 * t.gate * stage * stage * t.calib;
      return Math.max(1, Math.round(base * (1 + this.breakCut(save))));
    },

    /* 大境界 9→10 所需丹药名 */
    /* 大境界突破丹命名：默认 = **当前**境界 + 突破丹（淬体突破丹 / 炼气突破丹 / 筑基突破丹…）。
       例外表：炼气九段圆满 → 筑基这一段，丹名用仙侠通行的「筑基丹」
       （《M1 剧情与内容设计 v1.0》§4 全篇这么写；§8 商店表里写的"炼气突破丹"是同一件东西，
       以本表为准）。别名按"当前境界名"查，所以只有 gl=18 那一次大突破会真的用上。 */
    BREAK_PILL_ALIAS: { '炼气': '筑基丹' },
    breakPill: function (gl) {
      var n = this.realmOf(gl || 1).n;
      return this.BREAK_PILL_ALIAS[n] || (n + '突破丹');
    },

    /* 是否已入道界三境（准圣/圣人/道祖）。道界**无破境之说** ——
       境界只由「道则回廊」九关试炼推进（境界 v3.2 §5–§7），
       所以灵气突破在 gl≥145 一律拦截，避免玩家刷灵气跳过三境试炼。 */
    isDaoRealm: function (gl) { return (gl || 1) >= 145; },

    /* 突破按钮/面板状态 */
    breakState: function (save) {
      var gl = save.globalLevel || 1;
      var t = this.realmOf(gl);
      var stage = gl - t.y0 + 1;
      var big = stage >= 9;
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
      st.reason = st.maxed ? '已至道祖圆满，无路可破'
        : st.worldcap ? '此界天道所限，飞升方可再进一步'
          : daoLv ? '道界无破境之说 —— 唯历「道则回廊」试炼可进'
            : (big && !owned) ? '需「' + pill + '」'
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

    /* 大境界：校验灵气 + 扣丹，交由战斗场景打「问心魔劫」 */
    startBigBreak: function (save) {
      var st = this.breakState(save);
      if (st.maxed) return { ok: false, reason: st.reason };
      if (st.worldcap) return { ok: false, worldcap: true, reason: st.reason };
      if (st.daoRealm) return { ok: false, daoRealm: true, reason: st.reason };
      if (!st.big) return { ok: false, reason: '尚未修至大圆满' };
      if (st.have < st.need) return { ok: false, reason: st.reason };
      if (!st.pillOwned) return { ok: false, reason: '需「' + st.pill + '」' };
      save.items[st.pill] -= 1;
      if (save.items[st.pill] <= 0) delete save.items[st.pill];
      if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      return { ok: true, pill: st.pill, need: st.need, from: st.gl, to: st.gl + 1 };
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

    computeStats: function (save, meta) {
      meta = meta || G.game.meta;
      var gl = save.globalLevel || 1;
      /* 存档兜底：残缺/损坏档不应让 HUD 直接白屏 */
      var lg = save.linggen || { elems: ['无'], coef: {}, stoneBonus: 0 };
      var coef = lg.coef || {};
      if (!lg.elems || !lg.elems.length) lg.elems = ['无'];
      var atk = 10 + gl * 2, def = 5 + gl * 1.5;
      var hp = 100 + gl * 20, spd = 10 + gl * .5;
      /* 法力上限（v0.14.0）：释放主动技的代价，战斗内每回合回 MP_REGEN 点。
         基础随境界涨；仙术类功法额外贡献（与"仙术→气血"同一条分支）——
         不新增"第六个来源"，仍走「境界成长 + 功法」这两条老口径。 */
      var mp = 20 + gl * 2;

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
      return {
        qi: te.qi + we.qi + (bonus.qi || 0),
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

      var fresh = pool.filter(function (id) { return !save.skills[id]; });
      var pick = G.rng.pick(fresh.length ? fresh : pool);
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

    /* 打坐：每分钟灵气 = 10 × 首灵根系数 × (1+灵气加成) */
    meditate: function (save, minutes) {
      var r = this.rates(save);
      var lg = save.linggen || { elems: ['无'], coef: {} };
      var first = (lg.elems && lg.elems[0]) || '无';
      var coef = (lg.coef && lg.coef[first]) || 1;
      var gain = Math.round(10 * minutes * coef * (1 + r.qi));
      save.qi = (save.qi || 0) + gain;
      return gain;
    }
  };

  G.Player = Player;
})();
