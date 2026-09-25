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

  /* ===== 境界体系 =====
     十境九段（成长规格 v0.1）；全局境界等级 = (境序号-1)×9 + 段数，范围 1—90。
     所需灵气 = 100 × 升级门槛系数 × 当前段数²
     新手境校准（经济表 v0.2 §5）：淬体境全部突破灵气 ×0.4
       → 淬体 1→9 合计 8,160（8 次小突破），淬体 9→10 = 8,100×0.4 = 3,240
     大境界 9→10 另需一枚对应「突破丹」，并触发「问心魔劫」剧情战。 */
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
    { n: '渡劫', y0: 82, y1: 90, gate: 512, calib: 1 }
  ];
  var MAX_GL = 90;
  var CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

  /* ===== 寿元（轮回转世 v0.4 §3.2）=====
     境界寿元上限；入世时 16 岁起算，年龄按游戏内行为推进。
     寿元尽 → 「坐化」，按善终结算（仙力 ×1.1）。 */
  var LIFESPAN = { 淬体: 80, 炼气: 120, 筑基: 200, 金丹: 400 };
  var LIFESPAN_HIGH = 800;          /* 元婴及以上，按卷设定，M1 统一取 800 */
  var AGE_PER_BATTLE = 10;          /* 每 10 场战斗 +1 岁 */
  var AGE_PER_MEDITATE = 60;        /* 打坐每 60 分钟 +1 岁 */
  var AGE_PER_BREAK = 2;            /* 每次突破 +2 岁 */

  var Player = {
    REALMS: REALMS,
    MAX_GL: MAX_GL,
    AGE_PER_BATTLE: AGE_PER_BATTLE,
    AGE_PER_MEDITATE: AGE_PER_MEDITATE,
    AGE_PER_BREAK: AGE_PER_BREAK,

    /* 该境界的寿元上限 */
    lifespanOf: function (gl) {
      var t = this.realmOf(gl || 1);
      return LIFESPAN[t.n] || LIFESPAN_HIGH;
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
      { id: 'A5', n: '轮回新手', d: '完成第一次死亡结算', xianli: 30, hit: function () { return true; } }
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

      /* 轮回成就：meta 一次性 */
      meta.achieve = meta.achieve || {};
      var self = this;
      this.ACHIEVE.forEach(function (a) {
        if (meta.achieve[a.id]) return;
        if (!a.hit(save)) return;
        meta.achieve[a.id] = 1;
        d.achieve += a.xianli;
        d.achieveList.push(a);
      });

      d.base = d.realm + d.skill + d.kill + d.age + d.achieve;
      d.total = Math.max(5, Math.round(d.base * d.mul));
      return d;
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

    realmInfo: function (gl) {
      gl = Math.max(1, Math.min(MAX_GL, gl || 1));
      var t = this.realmOf(gl);
      var stage = gl - t.y0 + 1;
      return { realm: t.n, stage: stage, n: t.n + CN[stage - 1] + '段' };
    },

    /* 所在大境界条目 */
    realmOf: function (gl) {
      gl = Math.max(1, Math.min(MAX_GL, gl || 1));
      for (var i = 0; i < REALMS.length; i++) {
        if (gl >= REALMS[i].y0 && gl <= REALMS[i].y1) return REALMS[i];
      }
      return REALMS[REALMS.length - 1];
    },

    /* 突破灵气折扣（天赋/世界特质/幼年奇遇；br 为负值即减免） */
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
    breakPill: function (gl) {
      return this.realmOf(gl || 1).n + '突破丹';
    },

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
      var st = {
        gl: gl, realm: t.n, stage: stage, big: big,
        need: need, have: have, lack: Math.max(0, need - have),
        pill: pill, pillOwned: owned,
        maxed: gl >= MAX_GL,
        next: this.realmInfo(Math.min(MAX_GL, gl + 1))
      };
      st.ready = !st.maxed && have >= need && (!big || owned > 0);
      st.reason = st.maxed ? '已至渡劫圆满，无路可破'
        : (big && !owned) ? '需「' + pill + '」'
          : (have < need) ? '灵气不足，还需 ' + st.lack
            : '';
      return st;
    },

    /* 小境界突破：灵气足够且未至 9 段时直接升段 */
    breakthrough: function (save, meta) {
      var st = this.breakState(save);
      if (st.maxed) return { ok: false, reason: st.reason };
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

    _applyBreak: function (save, meta, big) {
      save.globalLevel = Math.min(MAX_GL, (save.globalLevel || 1) + 1);
      /* 本世到达过的最高等级（仙力结算用，规格 v0.4 §4） */
      save.maxGlobalLevel = Math.max(save.maxGlobalLevel || 1, save.globalLevel);
      /* 天道注视：小境界 +3，大境界 +15（天道意志规格 v0.5 §2） */
      save.watch = (save.watch || 0) + (big ? 15 : 3);
      /* 突破耗岁（§3.2）：每次 +2 岁 */
      this.agePush(save, 'break');
      if (big) this.chronicle(save, 'break:' + save.globalLevel,
        '破入' + this.realmInfo(save.globalLevel).n);
      var st = this.computeStats(save, meta);
      save.hp = st.maxhp;     /* 突破刷新上限并回满气血 */
      if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      return save.globalLevel;
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
        else hp += lv * 20 * m;
      });

      /* 六维 */
      var six = save.six || {};
      atk += (six['勇猛'] || 0) * .5;
      var crit = .05 + (six['勇猛'] || 0) * .002;
      spd += (six['灵巧'] || 0) * .3;
      hp += (six['体质'] || 0) * 5; def += (six['体质'] || 0) * .3;

      /* 仙躯灌注 */
      var bk = (meta && meta.perfusion && meta.perfusion.body) || 0;
      atk += 2 * bk; def += bk; hp += 12 * bk; spd += bk;

      /* 天赋百分比 */
      var te = this.talentEffects(save);
      atk *= 1 + te.a; def *= 1 + te.f;
      hp *= 1 + te.h; spd *= 1 + te.s;
      crit += te.c;
      var critDmg = 1.5 + te.cd;

      /* 世界特质 */
      var we = this.worldEffects(save);
      atk *= 1 + we.a;
      hp *= 1 + we.h;
      def *= 1 + we.f;
      spd *= 1 + we.s;

      var st = {
        maxhp: Math.round(hp), atk: Math.round(atk), def: Math.round(def),
        spd: Math.round(spd), crit: crit, critDmg: critDmg,
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
      var six = save.six || {}, te = this.talentEffects(save), we = this.worldEffects(save);
      var bonus = save.bonus || {};
      return {
        qi: Math.min(.4, (six['智力'] || 0) * .008) + te.qi + we.qi + (bonus.qi || 0),
        po: Math.min(.4, (six['智力'] || 0) * .012) + te.po + we.po + (bonus.po || 0),
        st: Math.min(.4, (six['魅力'] || 0) * .008) + te.st + we.st
          + ((save.linggen && save.linggen.stoneBonus) || 0)
      };
    },

    /* 修炼灵力消耗：30 × 当前等级 × 品阶系数 */
    skillCost: function (sd, currentLv) {
      var tc = G.Data.tierCoef[sd.tier] || 1;
      return Math.round(30 * currentLv * tc);
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
