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
    /* 雷兽（v1.2.0，用户口径「雷雨天加成雷系妖兽」）：
       ⚠️ 加入它的**动机**：原有野生动物只有青纹蛇/赤炎狼/树精（木/火/木），
          **一个雷系都没有** —— 于是"雷雨天助雷"只能助玩家，帮不到敌人，
          天气的"双向性"立不起来。补一个雷系物种，雷雨天才会真的更难打。
       数值定位：**脆而快**（hp 低、spd 高），雷系招式带麻痹 —— 与"雨天路滑"相配。 */
    雷貂: {
      base: '雷貂', elem: '雷',
      hp: [48, 6], atk: [15, 2.3], def: [5, 0.8], spd: [19, 1.9],
      sprite: 'thunder_beast',
      skills: [
        { lv: 1, s: sp('扑咬', 1.0) },
        { lv: 4, s: sp('雷弧', 1.4, { elem: '雷', cd: 2, hit: 95, status: { t: '麻', chance: .30 } }) },
        { lv: 9, s: sp('惊雷落', 1.7, { elem: '雷', cd: 4, target: '全体', charge: true }) }
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
    },

    /* ===== M1：血煞教（设计 M1 v1.0 §5.3）=====
       artKey = **素材逻辑名后缀**（`battle.enemy.<artKey>`）；缺图时 beastResolve
       自动退回 BAKE 里的同名程序化立绘（见 sprites.js）。 */
    血煞教徒: {
      base: '血煞教徒', elem: '暗', artKey: 'cultist', sprite: 'cultist',
      hp: [70, 8], atk: [12, 2.2], def: [6, 1.2], spd: [10, .5],
      skills: [
        { lv: 1, s: sp('血煞斩', 1.3, { cd: 2 }) },
        { lv: 6, s: sp('血煞刀法', 1.5, { cd: 4, charge: true }) }
      ]
    },
    血蝠: {
      base: '血蝠', elem: '暗', artKey: 'bloodbat', sprite: 'bloodbat',
      hp: [55, 7], atk: [13, 2.4], def: [4, 1], spd: [14, .8],
      skills: [
        { lv: 1, s: sp('吸血', 0.9, { cd: 1, healSelf: .5 }) }
      ]
    },
    /* 筑基心魔的召唤物（M1 §5.3 备注）：只有作为 summon 的 spec.base 出现，
       不参与任何野外遭遇池。 */
    心魔残影: {
      base: '心魔残影', elem: '无', artKey: 'heartDemon2', sprite: 'heartDemon',
      hp: [70, 8], atk: [13, 2.2], def: [6, 1.2], spd: [11, .6],
      skills: [
        { lv: 1, s: sp('心魔乱咒', 1.0, { cd: 3, status: { t: '封', chance: .20 } }) }
      ]
    }
  };

  function stat(pair, L) { return Math.round(pair[0] + pair[1] * (L - 1)); }

  function makeEnemy(speciesKey, L, name) {
    var d = species[speciesKey];
    /* 数值与技能解锁按**压缩阶**（大境×九重）生长；传入的 L 是新 gl（36 阶/境），
       同一重内初/中/后/巅四阶实力相近。level 字段保留新 gl 供界面显示境界。 */
    var Ls = (G.Player && G.Player.scaleLevel) ? G.Player.scaleLevel(L) : L;
    var skills = [];
    d.skills.forEach(function (k) {
      if (Ls >= k.lv) skills.push(Object.assign({ cdLeft: 0 }, k.s));
    });
    return {
      name: name || d.base, species: speciesKey, elem: d.elem, level: L,
      /* artKey / sprite 透传给 beastResolve：前者查素材（battle.enemy.<artKey>），
         后者是程序化兜底键。老物种两者都没登记 → null，行为与以前逐字一致。 */
      artKey: d.artKey || null, sprite: d.sprite || null,
      maxhp: stat(d.hp, Ls), hp: stat(d.hp, Ls),
      atk: stat(d.atk, Ls), def: stat(d.def, Ls), spd: stat(d.spd, Ls),
      skills: skills, statuses: {}, buffs: {}, side: 'right'
    };
  }

  /* Boss：赤炎狼王（名字随浮世替换） */
  function makeWolfKing(name) {
    return {
      name: name || '赤炎狼王', species: '赤炎狼王', elem: '火', level: 36, boss: true,
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
      name: '血煞教杀手', species: '杀手', elem: '无', level: 12,
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

  /* ===== M1 剧情 Boss（设计 M1 v1.0 §5.3）=====
     两者都走 battle.js 的**通用阶段引擎**（`_genericPhases` 读 `phases`），
     禁逃由 `params.script` 自动兜住（`_noFlee` 见 script 即 true），不需要额外字段。 */

  /* 执事·血面：固定 L19 面板。HP<40% 狂暴（攻击 +25%，并把「血河咒」CD 压到 2）。 */
  function makeXuemian() {
    return {
      name: '血面', species: '血面', elem: '暗', level: 73, boss: true,
      artKey: 'xuemian', sprite: 'xuemian',
      maxhp: 480, hp: 480, atk: 38, def: 18, spd: 18,
      skills: [
        Object.assign({ cdLeft: 0 }, sp('血影斩', 1.5, { cd: 2, hit: 95, healSelf: .30 })),
        Object.assign({ cdLeft: 0 }, sp('血河咒', 1.2, {
          cd: 3, target: '全体', charge: 'all', status: { t: '烧', chance: .20 }
        })),
        Object.assign({ cdLeft: 0 }, sp('血煞封脉', 1.0, { cd: 3, status: { t: '封', chance: .30 } }))
      ],
      /* 阶段顺序 = 叙事顺序：先沈伯燃命重创（血面跌破 55%），再它凶性大发（跌破 40%）。
         同一次攻击若把血面从 >55% 直接打到 <40%，两条会在同一 tick 依次触发，
         顺序仍由数组决定。 */
      phases: [
        { trig: .55, kind: 'ally', pct: .35, name: '沈伯',
          line: '别哭……药还在炉上……好好活。' },
        { trig: .40, kind: 'enrage', atk: .25, cdCut: [{ match: '血河', cd: 2 }] }
      ],
      statuses: {}, buffs: {}, side: 'right'
    };
  }

  /* 筑基心魔：快照 HP ×1.05、攻防速 ×1.0（M0 的 makeHeartDemon 是 ×.9）。
     阶段：开局召一次「心魔残影」—— 设计写"第二回合"，实现为**开局触发**
     （通用阶段引擎按血量过线，trig .99 在满血即成立；等效且不引入回合计数状态）。 */
  function makeHeartDemon2(p) {
    return {
      name: '心魔', species: '心魔', elem: '无', level: p.level,
      artKey: 'heartDemon2', sprite: 'heartDemon',
      maxhp: Math.round(p.maxhp * 1.05), hp: Math.round(p.maxhp * 1.05),
      atk: Math.round(p.atk * 1.0), def: Math.round(p.def * 1.0), spd: Math.round(p.spd * 1.0),
      skills: [
        Object.assign({ cdLeft: 0 }, sp('心魔乱咒', 1.2, { cd: 2, status: { t: '封', chance: .30 } })),
        Object.assign({ cdLeft: 0 }, sp('执念一击', 1.6, { cd: 4, charge: true }))
      ],
      phases: [{ trig: .99, kind: 'summon', n: 1, spec: { base: '心魔残影', name: '心魔残影' } }],
      statuses: {}, buffs: {}, side: 'right'
    };
  }

  /* ===== 天劫镜像（v0.75.0，用户口径）=====
     用户原话：「吃完破镜丹不一定会触发天劫，天劫的镜像战力和主角是一模一样的，
     血量、攻击、防御都是一样的，但是出招是随机的，功法也是和当前的主角学的功法
     是一样的，只不过是随机激发一本九重的功法，所以需要靠策略和对放技能的控制」。

     与心魔（剧情战）的分工：
       · **心魔** = M0/M1 主线剧本战，固定面板（×0.9 / ×1.05），台词驱动，不进不复。
       · **天劫** = 大境界破境的**镜像试炼**，面板**逐项等于主角**（×1.0，不打折），
         技能 = 主角已学功法里**随机一本、按九重满级（prog=36）**放大。
         所以它既是"打自己"，也是"打一本你还没练到顶的功法" —— 靠策略与控制取胜。

     `p` 由 battle.js 传入主角快照：{ level, maxhp, atk, def, spd, skills }
       · skills = 主角**已激发功法**（Player.equippedIds）编译出的技能数组；
         为空时由 battle.js 传 `save.skills` 的全量池，这里再抽一本。
     镜像名字取「天劫」，species 用 '天劫' → SPECIES_SPRITE 兜到心魔立绘（同为人形虚影）。 */
  function makeTribulation(p) {
    var pool = (p.skills && p.skills.length) ? p.skills : null;
    var sk = [];
    if (pool) {
      /* 抽一本（用 G.rng.pick 保持可复现 —— 与战斗其它随机同序列） */
      var pick = G.rng ? G.rng.pick(pool) : pool[0];
      sk = [Object.assign({ cdLeft: 0 }, pick)];
      /* 若主角只有一本，补一招"劫雷"让它有变化（否则天劫只有一招，玩家无策略空间） */
      if (pool.length < 2) {
        sk.push(Object.assign({ cdLeft: 0 },
          sp('劫雷加身', 1.35, { cd: 3, status: { t: '封', chance: .25 } })));
      }
    } else {
      sk = [
        Object.assign({ cdLeft: 0 }, sp('劫雷加身', 1.35, { cd: 3 })),
        Object.assign({ cdLeft: 0 }, sp('天罚一击', 1.6, { cd: 4, charge: true }))
      ];
    }
    return {
      name: '天劫', species: '天劫', elem: '无', level: p.level,
      /* artKey 显式给 null → 让取图链回退 SPECIES_SPRITE['天劫']（= 心魔的虚影形象） */
      artKey: null, sprite: null,
      /* **逐项等于主角**（用户口径："血量、攻击、防御都是一样的"）。
         整数化只在最后一步做，避免先行取整让三项悄悄低于主角。 */
      maxhp: Math.round(p.maxhp * 1.0), hp: Math.round(p.maxhp * 1.0),
      atk: Math.round(p.atk * 1.0), def: Math.round(p.def * 1.0), spd: Math.round(p.spd * 1.0),
      skills: sk, statuses: {}, buffs: {}, side: 'right'
    };
  }

  /* 物种 → 程序化立绘键（`battle.enemy.<key>` 素材名与 BAKE 兜底名都用它）。
     **唯一真相源**：战斗（battle.js）与地图明雷（explore.js）共用这一份。
     v0.68.0 之前它只写死在 battle.js 的闭包里，explore 想画野怪只能再抄一份 ——
     两份表一旦不同步，就会出现"地图上是狼、打起来是蛇"的静默错位。 */
  var SPECIES_SPRITE = {
    '青纹蛇': 'snake', '赤炎狼': 'wolf', '树精': 'tree',
    '赤炎狼王': 'wolfking', '杀手': 'killer', '心魔': 'heartDemon',
    /* M1：血煞教（设计 M1 v1.0 §5.3）。心魔残影与心魔同形象（本就是它的影）。 */
    '血煞教徒': 'cultist', '血蝠': 'bloodbat', '血面': 'xuemian', '心魔残影': 'heartDemon',
    /* 天劫（v0.75.0）：镜像虚影，借心魔立绘（都是"你自己的影子"）。 */
    '天劫': 'heartDemon',
    /* 雷兽（v1.2.0）：新增物种，键与 `sprites.js` 的 `BAKE.thunder_beast` 对应。
       ⚠️ **这张表是唯一真相源**（战斗与地图明雷共用）—— 漏登记就会
          "地图上是一只雷貂、打起来是条蛇"，且完全静默。 */
    '雷貂': 'thunder_beast'
  };

  /* 物种 → 属性。给"天气按属性加权遭遇"用（`_encounter` 掷物种时乘权重）。
     ⚠️ 从 `species` 表**派生**而不是再抄一份 —— 抄一份就会与上面分叉。 */
  G.Data.enemyElemOf = function (key) {
    var d = species[key];
    return d ? (d.elem || null) : null;
  };

  G.Data = G.Data || {};
  G.Data.species = species;
  G.Data.SPECIES_SPRITE = SPECIES_SPRITE;
  G.Data.makeEnemy = makeEnemy;
  G.Data.makeWolfKing = makeWolfKing;
  G.Data.makeKiller = makeKiller;
  G.Data.makeHeartDemon = makeHeartDemon;
  G.Data.makeXuemian = makeXuemian;
  G.Data.makeHeartDemon2 = makeHeartDemon2;
  G.Data.makeTribulation = makeTribulation;
})();
