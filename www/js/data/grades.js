/* 品级 与 功法境界（统一规格，去“等级”化）
 *
 * 设计口径（GDD v3.5）：游戏里只有两类成长坐标 ——
 *   · 「境界」：角色 / 灵兽 / NPC 共用一套 19 大境界（见 player.js REALMS，gl 1–171）；
 *   · 「品级」：物品 / 道具 / 装备 / 丹药 / 材料的成色档位（本文件 GRADES，11 档）。
 *
 * 功法不设“等级”：
 *   · 功法本身有「品阶 tier」（凡/灵/宝/玄/地/天/仙，沿用 skills.js，是功法的品级）；
 *   · 功法的修炼进度为「九重 × 四阶段」—— 每重 初期→中期→后期→巅峰，
 *     九重巅峰为最高（prog 1–36）。显示一律走 skillRealm()，不出现 Lv。
 */
(function () {
  /* ===== 物品品级（11 档，用户口径）===== */
  var GRADES = ['下品', '中品', '上品', '极品', '黄级', '玄级', '地级', '天级', '神级', '仙级', '圣级'];
  /* 道级：道界专属、超出常规 11 档（如道祖亲手所炼之物），单独标记，不进常规循环 */
  var DAO_GRADE = '道级';

  /* ===== 功法修炼境界：九重 × 四阶段 ===== */
  var CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  var PHASES = ['初期', '中期', '后期', '巅峰'];
  var SKILL_MAX_PROG = 36;                 /* 九重巅峰 */

  /* prog(1–36) -> { chong:1–9, phase:0–3, n:'三重·中期', short:'三重中期' } */
  function skillRealm(prog) {
    var p = Math.max(1, Math.min(SKILL_MAX_PROG, Math.floor(prog || 1)));
    var chong = Math.ceil(p / 4);
    var phase = (p - 1) % 4;
    return {
      chong: chong, phase: phase,
      n: CN[chong - 1] + '重·' + PHASES[phase],
      short: CN[chong - 1] + '重' + PHASES[phase]
    };
  }
  /* 是否到顶（精进按钮置灰用）*/
  function skillAtTop(prog) { return (prog || 0) >= SKILL_MAX_PROG; }

  G.Data = G.Data || {};
  G.Data.grades = {
    list: GRADES,
    idxOf: function (name) { return GRADES.indexOf(name); },
    nameOf: function (i) { return GRADES[i] || GRADES[0]; },
    dao: DAO_GRADE,
    isValid: function (name) { return GRADES.indexOf(name) >= 0 || name === DAO_GRADE; }
  };
  G.Data.skillRealm = skillRealm;
  G.Data.skillAtTop = skillAtTop;
  G.Data.SKILL_MAX_PROG = SKILL_MAX_PROG;
})();
