/* ============================================================
   世界时钟与寿元（v0.61.0，用户第 3 / 第 4 点）
   ------------------------------------------------------------
   用户口径：
     ·「关于游戏内的时间比例和现实世界比例是怎么做的，最好是现实比游戏是 1 天 : 365 天」
     ·「主角进入一些秘境也会加速时间流逝，这是修仙世界的残酷」
     ·「目前关于灵根的作用，除了获取灵气的速度快，没有打坐修炼的感觉」
     ·「需要新增离线打坐收益灵气，这样才能把灵根的作用体现出来」

   设计（**一个真相源**）：`save.gt` = 本世累计的**游戏分钟**。
     · 年龄不再是"被行为零散加出来的"，而是 `16 + floor(gt / 一年分钟数) + ageBonus`。
       一切"耗寿元"的事都换算成**推进 gt**，玩家看到的寿元消耗因此有了统一解释。
     · 世界时钟按现实时间走：**1 现实秒 = 365 游戏秒**（即现实 1 天 = 游戏 365 天）。
       只在游戏运行时累计 —— 关掉游戏不会猝死，但挂着不动一样会老。
     · 秘境 / 副本里时间流速 ×12，**并且每层另结 30 游戏日**（这一条才是"残酷"：
       一趟秘境出来，人间已过数月）。

   ⚠️ 老档迁移：把既有的 `save.age` 折成 gt（一岁 = 一游戏年），`ageBonus` 归零。
   ⚠️ 这个模块**不碰** `save.age` 以外的任何字段，也不写盘（写盘由调用方决定）。
   ============================================================ */
(function () {
  var G = window.G;

  /* ---- 比例常数（契约要钉的就是这几个） ---- */
  var RATIO_DAY = 365;                 /* 现实 1 天 = 游戏 365 天 */
  var SEC_PER_REAL_SEC = 365;          /* = RATIO_DAY：1 现实秒 = 365 游戏秒 */
  var SEC_PER_MIN = 60, MIN_PER_HOUR = 60, HOUR_PER_DAY = 24;
  var MIN_PER_DAY = MIN_PER_HOUR * HOUR_PER_DAY;        /* 1440 */
  var DAY_PER_MONTH = 30, MONTH_PER_YEAR = 12;
  var DAY_PER_YEAR = 365;              /* 12×30=360 天 + 5 天「岁末」 */
  var MIN_PER_YEAR = MIN_PER_DAY * DAY_PER_YEAR;        /* 525600 */
  var BIRTH_AGE = 16;                  /* 入世年龄 */

  /* ---- 时间流速：秘境 / 副本里时间过得快 ---- */
  var SCENE_MULT = { dungeon: 12, battle: 1 };
  var DUNGEON_DAYS_PER_FLOOR = 30;     /* 副本每层另结 30 游戏日 */

  /* ---- 闭关档位（打坐）----
     收益 = needQi(当前小阶) × gain × 首灵根系数 × (1 + 灵气加成)。
     `gain` 与 `days` 的比值就是"这条路划不划算"：档位越长越划算（闭关的复利），
     但寿元是硬上限 —— 淬体只活 100 岁，枯坐百年就只能坐一次。
     `days` 同时是寿元成本（1 年 = 1 岁）。

     ⚠️ v0.75.0 整体 ÷2（用户口径：「闭关获取的灵气太多了，太容易升级破镜了」）。
        实测旧值下一次「闭关一年」= **2.64 阶**（收益恒为需求的 2.64 倍），
        修到炼气三重只要 5 岁、筑基 60 岁 —— 修炼完全失去重量。
        **为什么恰好 ÷2（不能再多）**：淬体段有 36 小阶、而淬体寿元只有 100 岁
        （16 岁入世 → 只剩 84 年），供给被砍太狠会直接卡死在淬体，重现
        v0.67.0 那个"修不到炼气就坐化"的坑。逐阶模拟（`_gen/_probe_med3.js`）：
          ÷1  → 炼气三重 40~50 岁 / 筑基 60 岁（太快）
          ÷2  → 炼气三重 60 岁   / 筑基 80 岁（**本档**，两种灵根系数下都不卡）
          ÷3  → 筑基 100 岁（贴着淬体寿元线，无灵根加成时必卡）
        所以 ÷2 是当前寿元表下的**上限削减**。要更慢必须同时放宽寿元
        （LIFESPAN）或降低破境需求（needQi），不能单砍这一处。 */
  var MEDITATE_TIERS = [
    { id: 'm1', n: '入定一月', days: 30, gain: 0.075 },
    { id: 'm3', n: '闭关三月', days: 90, gain: 0.25 },
    { id: 'y1', n: '闭关一年', days: 365, gain: 1.1 },
    { id: 'y10', n: '苦修十年', days: 3650, gain: 13 },
    { id: 'y100', n: '枯坐百年', days: 36500, gain: 150 }
  ];

  /* ---- 离线打坐 ----
     离线时按"挂着打坐"结算：效率打折、且有上限（否则放一个月回来直接破境）。
     上限 12 现实小时；效率 60%。 */
  var OFFLINE_CAP_HOURS = 12;
  var OFFLINE_EFF = 0.6;
  var OFFLINE_MIN_REAL_SEC = 60;       /* 少于 1 分钟不结算（避免刷屏） */

  function ageOf(save) {
    var gt = (save && save.gt) || 0;
    return BIRTH_AGE + Math.floor(gt / MIN_PER_YEAR) + ((save && save.ageBonus) || 0);
  }

  function ensure(save) {
    if (!save) return save;
    if (save.gt == null) {
      /* 老档：把 age 折成游戏时间；`_ageTick` 是旧的分段余数，已无意义 */
      var a = (save.age == null ? BIRTH_AGE : save.age);
      save.gt = Math.max(0, a - BIRTH_AGE) * MIN_PER_YEAR;
      delete save._ageTick;
    }
    if (save.ageBonus == null) save.ageBonus = 0;
    save.age = ageOf(save);
    return save;
  }

  /* 游戏历：返回 { y, m, d, h, y13 }。y 从 1 起算；第 13 月是「岁末」（只 5 天）。 */
  function cal(save) {
    var mins = Math.max(0, Math.floor((save && save.gt) || 0));
    var day = Math.floor(mins / MIN_PER_DAY);
    var y = Math.floor(day / DAY_PER_YEAR);
    var doy = day - y * DAY_PER_YEAR;                       /* 0..364 */
    var m = Math.floor(doy / DAY_PER_MONTH) + 1;            /* 1..13 */
    var d = doy - (m - 1) * DAY_PER_MONTH + 1;
    var h = Math.floor((mins % MIN_PER_DAY) / MIN_PER_HOUR);
    return { y: y + 1, m: m, d: d, h: h, y13: m > MONTH_PER_YEAR };
  }

  function label(save) {
    var c = cal(save);
    return '太初 ' + c.y + ' 年 ' + (c.y13 ? '岁末' : (c.m + ' 月'));
  }

  /* 推进游戏时间。返回本次跨过的**年数**（0 = 没跨年）。 */
  function advance(save, minutes) {
    if (!save || !(minutes > 0)) return 0;
    var before = ageOf(save);
    save.gt = (save.gt || 0) + minutes;
    var after = ageOf(save);
    save.age = after;
    return after - before;
  }

  function sceneMult() {
    var n = (G.game && G.game.sceneName) || '';
    return SCENE_MULT[n] || 1;
  }

  /* 每帧调用：现实 dt（秒）→ 游戏分钟。 */
  function tick(save, realDt) {
    if (!save || !(realDt > 0)) return 0;
    return advance(save, realDt * SEC_PER_REAL_SEC * sceneMult() / SEC_PER_MIN);
  }

  /* 副本每层的时间代价（"秘境加速时间流逝"）。 */
  function dungeonFloor(save) {
    return advance(save, DUNGEON_DAYS_PER_FLOOR * MIN_PER_DAY);
  }

  /* ---- 闭关（打坐）----
     `tierId` 取 MEDITATE_TIERS。返回：
       { ok, reason?, tier, days, gain, years, aged }
     `gain` 是本次得到的灵气；`years` 是耗掉的年数（寿元）。
     ⚠️ 灵气收益**必须**走 `needQi`（唯一口径）—— 自己另算一套必然与破境需求分叉。 */
  function tierById(id) {
    for (var i = 0; i < MEDITATE_TIERS.length; i++) {
      if (MEDITATE_TIERS[i].id === id) return MEDITATE_TIERS[i];
    }
    return null;
  }

  function linggenCoef(save) {
    var lg = (save && save.linggen) || { elems: ['无'], coef: {} };
    var first = (lg.elems && lg.elems[0]) || '无';
    return (lg.coef && lg.coef[first]) || 1;
  }

  /* 一次闭关的**基础收益**（不含灵根与加成）—— 面板要预告收益，必须能单独取到。 */
  function meditateBase(save, tier) {
    var gl = (save && save.globalLevel) || 1;
    var need = G.Player.needQi(save, gl) || 1;
    return Math.max(1, Math.round(need * tier.gain));
  }

  function meditateGain(save, tier) {
    var r = (G.Player.rates && G.Player.rates(save)) || { qi: 0 };
    var coef = linggenCoef(save);
    return Math.max(1, Math.round(meditateBase(save, tier) * coef * (1 + (r.qi || 0))));
  }

  /* 闭关能不能坐得起：耗掉的年数不能超过剩余寿元（否则等于自杀）。
     返回值给面板用，`ok=false` 时 `reason` 必须能读。 */
  function canMeditate(save, tier) {
    if (!tier) return { ok: false, reason: '无此闭关档' };
    var years = tier.days / DAY_PER_YEAR;
    var left = G.Player.lifespanLeft(save);
    if (years > left) {
      return { ok: false, reason: '寿元不足（需 ' + fmtYears(years) + '，尚余 '
        + fmtYears(left) + '）', years: years, left: left };
    }
    return { ok: true, years: years, left: left };
  }

  function fmtYears(y) {
    if (y >= 1) return Math.round(y) + ' 岁';
    var days = y * DAY_PER_YEAR;
    if (days >= 1) return Math.round(days) + ' 日';
    return Math.round(days * 24) + ' 时';
  }

  /* 真正闭关：推进时间 → 给灵气。**先判寿元**，坐不起就别坐。 */
  function meditate(save, tierId) {
    var tier = tierById(tierId);
    var c = canMeditate(save, tier);
    if (!c.ok) return { ok: false, reason: c.reason };
    var gain = meditateGain(save, tier);
    var years = advance(save, tier.days * MIN_PER_DAY);
    save.qi = (save.qi || 0) + gain;
    return { ok: true, tier: tier, days: tier.days, gain: gain, years: years, aged: years > 0 };
  }

  /* ---- 离线打坐收益 ----
     进入游戏时调用一次。返回 null（不足阈值）或 { realSec, gameDays, gain }。
     ⚠️ 不改 `save.lastSeen` —— 由调用方在结算后自己写，避免"结算两次"。 */
  function offlineGain(save, nowMs) {
    if (!save || !save.lastSeen) return null;
    var realSec = (nowMs - save.lastSeen) / 1000;
    if (!(realSec >= OFFLINE_MIN_REAL_SEC)) return null;
    var capped = Math.min(realSec, OFFLINE_CAP_HOURS * 3600);
    /* 离线 = 挂着打坐：走同一套「按需灵气比例给收益」的口径，
       用「入定一月」当每分钟的基准收益（否则一天离线 = 几百个小阶）。 */
    var base = meditateBase(save, MEDITATE_TIERS[0]) / (MEDITATE_TIERS[0].days * MIN_PER_DAY);
    var gameMin = capped * SEC_PER_REAL_SEC / SEC_PER_MIN;
    var coef = linggenCoef(save);
    var r = (G.Player.rates && G.Player.rates(save)) || { qi: 0 };
    var gain = Math.round(gameMin * base * OFFLINE_EFF * coef * (1 + (r.qi || 0)));
    if (gain < 1) return null;
    return {
      realSec: realSec, capped: realSec > capped,
      gameDays: gameMin / MIN_PER_DAY, gain: gain
    };
  }

  G.Time = {
    RATIO_DAY: RATIO_DAY,
    SEC_PER_REAL_SEC: SEC_PER_REAL_SEC,
    MIN_PER_DAY: MIN_PER_DAY,
    MIN_PER_YEAR: MIN_PER_YEAR,
    DAY_PER_YEAR: DAY_PER_YEAR,
    DAY_PER_MONTH: DAY_PER_MONTH,
    MONTH_PER_YEAR: MONTH_PER_YEAR,
    BIRTH_AGE: BIRTH_AGE,
    SCENE_MULT: SCENE_MULT,
    DUNGEON_DAYS_PER_FLOOR: DUNGEON_DAYS_PER_FLOOR,
    MEDITATE_TIERS: MEDITATE_TIERS,
    OFFLINE_CAP_HOURS: OFFLINE_CAP_HOURS,
    OFFLINE_EFF: OFFLINE_EFF,

    ensure: ensure,
    ageOf: ageOf,
    cal: cal,
    label: label,
    advance: advance,
    tick: tick,
    sceneMult: sceneMult,
    dungeonFloor: dungeonFloor,
    linggenCoef: linggenCoef,
    tierById: tierById,
    meditateBase: meditateBase,
    meditateGain: meditateGain,
    canMeditate: canMeditate,
    meditate: meditate,
    offlineGain: offlineGain,
    fmtYears: fmtYears,
    /* 给面板/契约用的文案：把"时间比例"讲清楚（用户第 3 点就是问这个） */
    ratioText: function () {
      return '现实 1 天 = 此界 365 天（1 息 ≈ 6 刻）';
    }
  };
})();
