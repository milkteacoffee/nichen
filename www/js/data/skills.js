/* 功法数据（M0：凡阶）。kind: 攻击/防御/仙术；主动技能：mult/cd/hit/target/status */
(function () {
  function atk(id, n, elem, mult, extra) {
    var s = { id: id, n: n, kind: '攻击', tier: '凡', elem: elem, mult: mult, cd: 0, hit: 100, target: '前排' };
    if (extra) Object.keys(extra).forEach(function (k) { s[k] = extra[k]; });
    return s;
  }
  var S = {};

  /* 开局配发（v0.3 §6） */
  S.裂金指 = atk('裂金指', '裂金指', '金', 1.3, { status: { t: '麻', chance: .20 } });
  S.缠藤指 = atk('缠藤指', '缠藤指', '木', 1.2, { status: { t: '毒', chance: .20 } });
  S.凝水弹 = atk('凝水弹', '凝水弹', '水', 1.2);
  S.烈焰指 = atk('烈焰指', '烈焰指', '火', 1.3, { status: { t: '烧', chance: .20 } });
  S.崩岩指 = atk('崩岩指', '崩岩指', '土', 1.2, { status: { t: '封', chance: .20 } });
  S.曜光诀 = atk('曜光诀', '曜光诀', '光', 1.3);
  S.惊雷诀 = atk('惊雷诀', '惊雷诀', '雷', 1.3, { status: { t: '麻', chance: .20 } });
  S.风刃诀 = atk('风刃诀', '风刃诀', '风', 1.2);
  S.冥气诀 = atk('冥气诀', '冥气诀', '暗', 1.3);

  /* 防御 / 仙术（被动成长，无主动） */
  S.铁布衫 = { id: '铁布衫', n: '铁布衫', kind: '防御', tier: '凡', elem: '无', passive: true };
  S.吐纳术 = { id: '吐纳术', n: '吐纳术', kind: '仙术', tier: '凡', elem: '无', passive: true };

  /* 商店：回春诀（带治疗主动） */
  S.回春诀 = {
    id: '回春诀', n: '回春诀', kind: '仙术', tier: '凡', elem: '木', passive: true,
    active: { n: '回春术', heal: 1.5, cd: 2, hit: 100, target: '自身' }
  };

  /* Boss 掉落池（M0 随机 1 本，均为凡阶、强度略高于开局技） */
  S.崩岩掌 = atk('崩岩掌', '崩岩掌', '土', 1.4, { cd: 2, hit: 95, status: { t: '封', chance: .25 } });
  S.烈焰诀 = atk('烈焰诀', '烈焰诀', '火', 1.6, { cd: 3, hit: 95, status: { t: '烧', chance: .30 } });
  S.寒水诀 = atk('寒水诀', '寒水诀', '水', 1.4, { cd: 2, hit: 95 });
  S.疾风诀 = atk('疾风诀', '疾风诀', '风', 1.4, { cd: 2, hit: 95, status: { t: '麻', chance: .15 } });
  S.曜日诀 = atk('曜日诀', '曜日诀', '光', 1.5, { cd: 3, hit: 95, heal: .8 });

  var dropPool = ['崩岩掌', '烈焰诀', '寒水诀', '疾风诀', '曜日诀'];
  var startByElem = {
    '金': '裂金指', '木': '缠藤指', '水': '凝水弹', '火': '烈焰指', '土': '崩岩指',
    '光': '曜光诀', '雷': '惊雷诀', '风': '风刃诀', '暗': '冥气诀'
  };

  /* ===== M1：灵阶功法（tier 灵 → tierCoef 1.5；设计 M1 v1.0 §5.2）=====
     面板贡献走 computeStats 的 kind 分支：攻击→ATK、防御→DEF、仙术→HP，
     所以这里只声明 kind/tier/elem，成长自动按 1.5 倍算。
     ⚠️ 凡阶池（dropPool）保持不变，灵阶另立两池，别混。 */
  S.流云剑诀 = atk('流云剑诀', '流云剑诀', '金', 1.4, { tier: '灵', cd: 2, hit: 95 });
  /* hits：多段攻击（见 battle.js 结算）。cd 1 的低倍率靠 2 段补回来。 */
  S.疾风九刃 = atk('疾风九刃', '疾风九刃', '风', 1.1, { tier: '灵', cd: 1, hit: 90, hits: 2 });
  S.赤焰心法 = { id: '赤焰心法', n: '赤焰心法', kind: '仙术', tier: '灵', elem: '火', passive: true };
  S.磐石功 = { id: '磐石功', n: '磐石功', kind: '防御', tier: '灵', elem: '土', passive: true };
  S.玄水诀 = {
    id: '玄水诀', n: '玄水诀', kind: '仙术', tier: '灵', elem: '水', passive: true,
    active: { n: '玄水术', heal: 0.9, cd: 2, hit: 100, target: '自身' }
  };

  /* 血面掉落池（随机 1 本）；沈伯旧藏池（m1-3 赠，匹配灵根优先） */
  var dropPoolLing = ['流云剑诀', '疾风九刃', '赤焰心法'];
  var shenBoPool = ['流云剑诀', '玄水诀', '磐石功', '疾风九刃', '赤焰心法'];

  /* 品阶系数（成长规格 v0.1） */
  var tierCoef = { '凡': 1.0, '灵': 1.5, '宝': 2.0, '玄': 3.0, '地': 4.5, '天': 6.5, '仙': 10.0 };

  G.Data = G.Data || {};
  G.Data.skills = S;
  G.Data.skillDropPool = dropPool;
  G.Data.skillDropPoolLing = dropPoolLing;
  G.Data.shenBoPool = shenBoPool;
  G.Data.startSkillByElem = startByElem;
  G.Data.tierCoef = tierCoef;
})();
