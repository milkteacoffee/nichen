/* 敌人数据与工厂（数值取自御兽规格 v0.2；M0 中妖兽只作为敌人，资质系数取 1） */
(function () {
  function sp(n, mult, extra) {
    var s = { n: n, mult: mult, cd: 0, hit: 100, target: '前排', elem: '无' };
    if (extra) Object.keys(extra).forEach(function (k) { s[k] = extra[k]; });
    return s;
  }

  var species = {
    青纹蛇: {
      base: '青纹蛇', elem: '木',
      hp: [55, 7], atk: [12, 1.7], def: [7, 1.0], spd: [11, 1.2],
      skills: [
        { lv: 1, s: sp('撕咬', 1.0) },
        { lv: 3, s: sp('蛇毒吐信', 0.9, { elem: '木', cd: 2, status: { t: '毒', chance: .40 } }) },
        { lv: 7, s: sp('缠绕', 1.1, { elem: '木', cd: 3, hit: 95, status: { t: '麻', chance: .30 } }) }
      ]
    },
    赤炎狼: {
      base: '赤炎狼', elem: '火',
      hp: [60, 8], atk: [14, 2.1], def: [6, 0.9], spd: [14, 1.5],
      skills: [
        { lv: 1, s: sp('撕咬', 1.0) },
        { lv: 4, s: sp('烈焰冲袭', 1.5, { elem: '火', cd: 3, hit: 90, status: { t: '烧', chance: .25 }, charge: true }) },
        { lv: 8, s: sp('嗥月', 0, { cd: 5, buff: { atk: .20, turns: 3 } }) }
      ]
    },
    树精: {
      base: '树精', elem: '木',
      hp: [85, 12], atk: [10, 1.4], def: [12, 1.7], spd: [5, 0.6],
      skills: [
        { lv: 1, s: sp('藤鞭', 1.0, { elem: '木', target: '后排' }) },
        { lv: 5, s: sp('催眠粉', 0, { cd: 3, hit: 75, status: { t: '睡', chance: .60 } }) },
        { lv: 8, s: sp('自我愈合', 0, { cd: 4, healSelf: .20 }) }
      ]
    },
    /* 人形杂兵（副本换色母版：血影教徒/天兵/山匪/剑偶等，设计 v3.3 §5）。
       与剧情固定的 makeKiller() 区分：此条目可按 gl 缩放。 */
    杀手: {
      base: '杀手', elem: '无',
      hp: [60, 8], atk: [12, 1.8], def: [7, 1.0], spd: [12, 1.2],
      skills: [
        { lv: 1, s: sp('血煞斩', 1.2, { cd: 2 }) },
        { lv: 5, s: sp('血煞刀法', 1.5, { cd: 4, charge: true }) }
      ]
    }
  };

  function stat(pair, L) { return Math.round(pair[0] + pair[1] * (L - 1)); }

  function makeEnemy(speciesKey, L, name) {
    var d = species[speciesKey];
    var skills = [];
    d.skills.forEach(function (k) {
      if (L >= k.lv) skills.push(Object.assign({ cdLeft: 0 }, k.s));
    });
    return {
      name: name || d.base, species: speciesKey, elem: d.elem, level: L,
      maxhp: stat(d.hp, L), hp: stat(d.hp, L),
      atk: stat(d.atk, L), def: stat(d.def, L), spd: stat(d.spd, L),
      skills: skills, statuses: {}, buffs: {}, side: 'right'
    };
  }

  /* Boss：赤炎狼王（名字随浮世替换） */
  function makeWolfKing(name) {
    return {
      name: name || '赤炎狼王', species: '赤炎狼王', elem: '火', level: 9, boss: true,
      maxhp: 320, hp: 320, atk: 30, def: 14, spd: 16,
      skills: [
        Object.assign({ cdLeft: 0 }, sp('撕咬', 1.0)),
        Object.assign({ cdLeft: 0 }, sp('烈焰冲袭', 1.5, { elem: '火', cd: 3, hit: 90, status: { t: '烧', chance: .25 }, charge: true })),
        Object.assign({ cdLeft: 0 }, sp('烈焰风暴', 1.3, { elem: '火', cd: 4, target: '全体', charge: 'all' }))
      ],
      statuses: {}, buffs: {}, side: 'right',
      summoned: false, enraged: false
    };
  }

  /* q1 杀手 */
  function makeKiller() {
    return {
      name: '血煞教杀手', species: '杀手', elem: '无', level: 3,
      maxhp: 90, hp: 90, atk: 16, def: 8, spd: 12,
      skills: [
        Object.assign({ cdLeft: 0 }, sp('血煞斩', 1.3, { cd: 2 })),
        Object.assign({ cdLeft: 0 }, sp('血煞刀法', 1.6, { cd: 4, charge: true }))
      ],
      statuses: {}, buffs: {}, side: 'right'
    };
  }

  /* 心魔：主角快照 */
  function makeHeartDemon(p) {
    return {
      name: '心魔', species: '心魔', elem: '无', level: p.level,
      maxhp: Math.round(p.maxhp * 1.0), hp: Math.round(p.maxhp * 1.0),
      atk: Math.round(p.atk * .9), def: Math.round(p.def * .9), spd: Math.round(p.spd * .9),
      skills: [
        Object.assign({ cdLeft: 0 }, sp('心魔乱咒', 1.2, { cd: 2, status: { t: '封', chance: .30 } })),
        Object.assign({ cdLeft: 0 }, sp('执念一击', 1.6, { cd: 4, charge: true }))
      ],
      statuses: {}, buffs: {}, side: 'right'
    };
  }

  G.Data = G.Data || {};
  G.Data.species = species;
  G.Data.makeEnemy = makeEnemy;
  G.Data.makeWolfKing = makeWolfKing;
  G.Data.makeKiller = makeKiller;
  G.Data.makeHeartDemon = makeHeartDemon;
})();
