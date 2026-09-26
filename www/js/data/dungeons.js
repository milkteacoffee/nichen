/* 副本数据与工厂 v3.3
 * 15 原型（5 大 + 10 小），大副本九关（小Boss+大Boss）、小副本五关（头领）。
 * 依据：《副本系统与四界轮回设计 v3.2》+《副本Boss形象与关卡结构设计 v3.3》。
 * 技能字段沿用 enemies.js / battle.js：
 *   mult, cd, charge, target('前排'/'后排'/'全体'), status{t,chance}, hit, elem,
 *   kind('atk'默认/'shield'/'status'), vamp(吸血分数), pierce(破防分数),
 *   pct(护盾/治疗占最大气血比)。
 * Boss 阶段 phases（血量阈值，各一次）：
 *   {kind:'summon', trig, spec:{base,name}, n}
 *   {kind:'clone',  trig, pct, n:2}
 *   {kind:'enrage', trig, atk, cdCut:[{match,cd}]}
 *   {kind:'heal',   trig, pct}
 */
(function () {

  /* ===== 三级 Boss 成长（L = Boss 自身 gl）===== */
  var GROWTH = {
    leader: { hp: [130, 28], atk: [12, 1.9], def: [6, 1.2],  spd: [10, .6] },
    mid:    { hp: [160, 30], atk: [13, 2.0], def: [7, 1.25], spd: [10.5, .62] },
    big:    { hp: [200, 36], atk: [15, 2.2], def: [8, 1.3],  spd: [11, .65] }
  };

  /* ===== 槽位 → Boss 锚点 gl =====
     道界不抽随机池（九关固定），这一行是给 `anchorGL('dao', i)` 兜底用的：
     下标 i = 第 i 关，值 = **通关后**的境界锚点（见 DAO_TRIALS）。 */
  var SLOT_GL = {
    fan:  [9, 27, 45, 54, 63],
    ling: [64, 72, 81, 86, 90],
    xian: [99, 108, 117, 135, 144],
    dao:  [147, 150, 153, 156, 159, 162, 165, 168, 171]
  };

  /* ===== 三难度倍率 =====
     `res` 是**灵石**收益系数（地狱扣到 0.6）；道界不流通灵石，
     所以另给 `dao` 系数 —— 道晶是"道则结晶"，越难的道则越凝练，方向与 res 相反。 */
  var DIFF = {
    normal: { id: 'normal', n: '普通', bossHp: 1,    bossAtk: 1,    trash: 1,   res: 1,   xianli: 1,   rare: 1,   cdAdj: 0,  dao: 1 },
    hard:   { id: 'hard',   n: '困难', bossHp: 1.35, bossAtk: 1.25, trash: 1.2, res: .8,  xianli: 1.2, rare: 1.5, cdAdj: 0,  dao: 1.3 },
    hell:   { id: 'hell',   n: '地狱', bossHp: 1.8,  bossAtk: 1.55, trash: 1.4, res: .6,  xianli: 1.5, rare: 2,   cdAdj: -1, dao: 1.6 }
  };

  /* ===== 世界系数 / 名号 ===== */
  var WORLD_COEF = { fan: 1, ling: 1.05, xian: 1.1, dao: 1.15 };
  var WORLD_NAME = { fan: '凡界', ling: '灵界', xian: '仙界', dao: '道界' };
  var WORLD_TIER_KEY = { fan: 'fan', ling: 'ling', xian: 'xian', dao: 'xian' };

  /* ===== 杂兵底怪（喂 makeEnemy 的 species）===== */
  var TRASH = {
    B1: ['杀手', '赤炎狼'], B2: ['树精'], B3: ['赤炎狼', '青纹蛇'],
    B4: ['树精', '杀手'], B5: ['杀手'],
    S1: ['青纹蛇'], S2: ['杀手'], S3: ['青纹蛇'], S4: ['树精'], S5: ['赤炎狼'],
    S6: ['树精'], S7: ['青纹蛇'], S8: ['杀手'], S9: ['树精'], S10: ['杀手']
  };

  /* 技能/阶段深拷贝（每个 Boss 实例独立，避免共享 cd） */
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function round(v) { return Math.round(v); }
  function rngPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  /* ============================================================
   * 15 原型
   * ============================================================ */
  var ARCH = [
    /* ---------------- B1 血河魔殿 ---------------- */
    { id: 'B1', n: '血河魔殿', kind: 'big', stages: 9, elem: '暗', drop: 'n_xuehai',
      big: {
        artKey: 'b1big', sprite: 'killer', tier: 'big',
        title: { fan: '魔道宗宗主', ling: '魔道老魔', xian: '血河魔祖' },
        skills: [
          { n: '血河斩', mult: 1.3, cd: 2, elem: '暗' },
          { n: '血海滔天', mult: 1.3, cd: 4, charge: true, target: '全体', elem: '暗' }
        ],
        phases: [
          { kind: 'summon', trig: .6, spec: { base: '杀手', name: '血影弟子' }, n: 2 },
          { kind: 'enrage', trig: .3, atk: .25 }
        ]
      },
      mid: {
        artKey: 'b1mid', sprite: 'killer', tier: 'mid',
        title: { fan: '血影护法', ling: '血影老魔', xian: '噬血影魔' },
        skills: [
          { n: '血影爪', mult: 1.2, cd: 2, elem: '暗' },
          { n: '噬血刃', mult: 1.1, cd: 3, elem: '暗', vamp: .5 }
        ],
        phases: [ { kind: 'enrage', trig: .3, atk: .2 } ]
      }
    },

    /* ---------------- B2 万骨渊 ---------------- */
    { id: 'B2', n: '万骨渊', kind: 'big', stages: 9, elem: '土', drop: 'n_kurong',
      big: {
        artKey: 'b2big', sprite: 'tree', tier: 'big',
        title: { fan: '白骨真君', ling: '白骨老祖', xian: '万骨魔祖' },
        skills: [
          { n: '骨刺', mult: 1.2, cd: 2, elem: '土' },
          { n: '万骨护盾', kind: 'shield', pct: .2, cd: 4 }
        ],
        phases: [
          { kind: 'summon', trig: .6, spec: { base: '树精', name: '白骨傀' }, n: 2 },
          { kind: 'heal', trig: .4, pct: .24 }
        ]
      },
      mid: {
        artKey: 'b2mid', sprite: 'killer', tier: 'mid',
        title: { fan: '骨牢守将', ling: '白骨骁将', xian: '万骨战魔' },
        skills: [
          { n: '骨戟横扫', mult: 1.3, cd: 2, elem: '土' },
          { n: '碎骨重击', mult: 1.5, cd: 3, charge: true, elem: '土' }
        ],
        phases: [ { kind: 'enrage', trig: .3, atk: .2 } ]
      }
    },

    /* ---------------- B3 九渊妖皇殿 ---------------- */
    { id: 'B3', n: '九渊妖皇殿', kind: 'big', stages: 9, elem: '水', drop: 's_longxiang',
      big: {
        artKey: 'b3big', sprite: 'wolfking', tier: 'big',
        title: { fan: '九渊妖皇', ling: '九渊妖尊', xian: '万妖魔祖' },
        skills: [
          { n: '撕咬', mult: 1.1, cd: 2, elem: '水' },
          { n: '九渊吞噬', mult: 1.6, cd: 3, charge: true, elem: '水' }
        ],
        phases: [
          { kind: 'summon', trig: .66, spec: { base: '赤炎狼', name: '深渊妖兽' }, n: 2 },
          { kind: 'enrage', trig: .33, atk: .3, cdCut: [{ match: '九渊吞噬', cd: 2 }] }
        ]
      },
      mid: {
        artKey: 'b3mid', sprite: 'tree', tier: 'mid',
        title: { fan: '玄甲龟将', ling: '黑水龟丞相', xian: '镇渊玄龟' },
        skills: [
          { n: '托水叉', mult: 1.2, cd: 2, elem: '水' },
          { n: '玄甲', kind: 'shield', pct: .25, cd: 4 }
        ],
        phases: [ { kind: 'enrage', trig: .3, atk: .15 } ]
      }
    },

    /* ---------------- B4 雷泽古阵 ---------------- */
    { id: 'B4', n: '雷泽古阵', kind: 'big', stages: 9, elem: '雷', drop: 'x_jiuxiao',
      big: {
        artKey: 'b4big', sprite: 'snake', tier: 'big',
        title: { fan: '雷泽蛟龙', ling: '雷泽龙王', xian: '九天应龙' },
        skills: [
          { n: '雷罚', mult: 1.3, cd: 2, elem: '雷', status: { t: '麻', chance: .3 } },
          { n: '雷泽万顷', mult: 1.2, cd: 4, charge: true, target: '全体', elem: '雷',
            status: { t: '麻', chance: .35 } }
        ],
        phases: [ { kind: 'clone', trig: .5, pct: .45, n: 2 } ]
      },
      mid: {
        artKey: 'b4mid', sprite: 'tree', tier: 'mid',
        title: { fan: '雷泽阵枢', ling: '雷枢守卫', xian: '九天雷枢' },
        skills: [
          { n: '雷锤', mult: 1.2, cd: 2, elem: '雷', status: { t: '麻', chance: .3 } },
          { n: '雷幕', kind: 'shield', pct: .15, cd: 4 }
        ],
        phases: [ { kind: 'enrage', trig: .3, atk: .2 } ]
      }
    },

    /* ---------------- B5 南天门 ---------------- */
    { id: 'B5', n: '南天门', kind: 'big', stages: 9, elem: '金', drop: 's_taiyi',
      big: {
        artKey: 'b5big', sprite: 'killer', tier: 'big',
        title: { fan: '镇门天王', ling: '镇门天王将', xian: '南天魔祖' },
        skills: [
          { n: '镇山鞭', mult: 1.3, cd: 2, elem: '金' },
          { n: '横扫天门', mult: 1.3, cd: 4, charge: true, target: '全体', elem: '金' },
          { n: '金身', kind: 'shield', pct: .25, cd: 5 }
        ],
        phases: [ { kind: 'summon', trig: .5, spec: { base: '杀手', name: '天兵' }, n: 2 } ]
      },
      mid: {
        artKey: 'b5mid', sprite: 'killer', tier: 'mid',
        title: { fan: '巨灵力士', ling: '巡天力士', xian: '金甲大力神' },
        skills: [
          { n: '金瓜锤', mult: 1.4, cd: 2, elem: '金' },
          { n: '力劈华山', mult: 1.6, cd: 3, charge: true, elem: '金' }
        ],
        phases: [ { kind: 'enrage', trig: .3, atk: .2 } ]
      }
    },

    /* ---------------- S1 青蛇涧 ---------------- */
    { id: 'S1', n: '青蛇涧', kind: 'small', stages: 5, elem: '木', drop: 'x_zhuxie',
      leader: {
        artKey: 's1', sprite: 'snake', tier: 'leader',
        title: { fan: '青鳞蛇君', ling: '碧鳞蛇妖', xian: '九头蛇祖' },
        skills: [
          { n: '蛇毒吐信', mult: .9, cd: 2, elem: '木', status: { t: '毒', chance: .4 } },
          { n: '缠绕', mult: 1.1, hit: 95, cd: 3, elem: '木', status: { t: '麻', chance: .3 } }
        ],
        phases: []
      }
    },

    /* ---------------- S2 黑风寨 ---------------- */
    { id: 'S2', n: '黑风寨', kind: 'small', stages: 5, elem: '无', drop: 's_dajingang',
      leader: {
        artKey: 's2', sprite: 'killer', tier: 'leader',
        title: { fan: '黑风寨主', ling: '黑风匪王', xian: '吞天黑煞' },
        skills: [
          { n: '开山斧', mult: 1.4, cd: 3, charge: true, elem: '无' }
        ],
        phases: [ { kind: 'summon', trig: .5, spec: { base: '杀手', name: '山匪' }, n: 1 } ]
      }
    },

    /* ---------------- S3 乱葬岗 ---------------- */
    { id: 'S3', n: '乱葬岗', kind: 'small', stages: 5, elem: '暗', drop: 'x_taiyi5yan',
      leader: {
        artKey: 's3', sprite: 'killer', tier: 'leader',
        title: { fan: '噬魂鬼修', ling: '噬魂鬼王', xian: '幽冥鬼祖' },
        skills: [
          { n: '噬魂咒', mult: 1.2, cd: 2, elem: '暗', status: { t: '封', chance: .3 } },
          { n: '摄魂', kind: 'status', hit: 75, cd: 3, elem: '暗', status: { t: '睡', chance: .6 } }
        ],
        phases: []
      }
    },

    /* ---------------- S4 落霞灵矿 ---------------- */
    { id: 'S4', n: '落霞灵矿', kind: 'small', stages: 5, elem: '土', drop: 'x_zhanxian',
      leader: {
        artKey: 's4', sprite: 'tree', tier: 'leader',
        title: { fan: '镇矿傀儡', ling: '镇矿傀儡将', xian: '矿源魔傀' },
        skills: [
          { n: '碎岩拳', mult: 1.4, cd: 3, charge: true, elem: '土' },
          { n: '矿壁', kind: 'shield', pct: .15, cd: 4 }
        ],
        phases: []
      }
    },

    /* ---------------- S5 火云洞 ---------------- */
    { id: 'S5', n: '火云洞', kind: 'small', stages: 5, elem: '火', drop: 'x_mangshan',
      leader: {
        artKey: 's5', sprite: 'wolf', tier: 'leader',
        title: { fan: '火鸦道人', ling: '火鸦妖王', xian: '金乌道祖' },
        skills: [
          { n: '烈焰弹', mult: 1.3, cd: 2, elem: '火', status: { t: '烧', chance: .25 } },
          { n: '金乌怒', mult: 1.5, cd: 3, charge: true, elem: '火' }
        ],
        phases: []
      }
    },

    /* ---------------- S6 幽竹林 ---------------- */
    { id: 'S6', n: '幽竹林', kind: 'small', stages: 5, elem: '木', drop: 'x_9tianxirang',
      leader: {
        artKey: 's6', sprite: 'tree', tier: 'leader',
        title: { fan: '竹姥姥', ling: '竹妖姥姥', xian: '万古竹祖' },
        skills: [
          { n: '藤鞭', mult: 1.0, cd: 2, elem: '木' },
          { n: '催眠粉', kind: 'status', cd: 3, elem: '木', status: { t: '睡', chance: .6 } }
        ],
        phases: [ { kind: 'heal', trig: .4, pct: .2 } ]
      }
    },

    /* ---------------- S7 寒潭水府 ---------------- */
    { id: 'S7', n: '寒潭水府', kind: 'small', stages: 5, elem: '水', drop: 's_bulao',
      leader: {
        artKey: 's7', sprite: 'snake', tier: 'leader',
        title: { fan: '碧水夜叉', ling: '寒潭蛟王', xian: '天河龙王' },
        skills: [
          { n: '水箭', mult: 1.1, cd: 2, elem: '水', status: { t: '麻', chance: .25 } },
          { n: '水幕', kind: 'shield', pct: .15, cd: 4 }
        ],
        phases: []
      }
    },

    /* ---------------- S8 血煞分坛 ---------------- */
    { id: 'S8', n: '血煞分坛', kind: 'small', stages: 5, elem: '暗', drop: 'x_4xiang',
      leader: {
        artKey: 's8', sprite: 'killer', tier: 'leader',
        title: { fan: '血煞执事', ling: '血煞长老', xian: '血煞魔祖' },
        skills: [
          { n: '血煞斩', mult: 1.3, cd: 2, elem: '暗', vamp: .2 },
          { n: '血河刀法', mult: 1.5, cd: 4, charge: true, elem: '暗' }
        ],
        phases: []
      }
    },

    /* ---------------- S9 黄沙古堡 ---------------- */
    { id: 'S9', n: '黄沙古堡', kind: 'small', stages: 5, elem: '土', drop: 'x_yufeng',
      leader: {
        artKey: 's9', sprite: 'tree', tier: 'leader',
        title: { fan: '沙暴傀儡将', ling: '沙暴尸王', xian: '黄沙魔祖' },
        skills: [
          { n: '沙暴', mult: 1.2, cd: 3, charge: true, target: '全体', elem: '土',
            status: { t: '封', chance: .25 } }
        ],
        phases: [ { kind: 'clone', trig: .5, pct: .4, n: 2 } ]
      }
    },

    /* ---------------- S10 云海剑冢 ---------------- */
    { id: 'S10', n: '云海剑冢', kind: 'small', stages: 5, elem: '金', drop: 'x_leiyin',
      leader: {
        artKey: 's10', sprite: 'killer', tier: 'leader',
        title: { fan: '守冢剑灵', ling: '剑冢剑主', xian: '万剑魔祖' },
        skills: [
          { n: '万剑归宗', mult: 1.2, cd: 3, target: '全体', elem: '金' },
          { n: '定脉剑', mult: 1.4, cd: 3, elem: '金', pierce: .2,
            status: { t: '麻', chance: .3 } }
        ],
        phases: []
      }
    }
  ];

  /* ============================================================
   * 工厂
   * ============================================================ */

  function archById(id) {
    for (var i = 0; i < ARCH.length; i++) if (ARCH[i].id === id) return ARCH[i];
    return null;
  }

  /* 槽位锚点 gl */
  function anchorGL(worldId, slot) {
    var row = SLOT_GL[worldId] || SLOT_GL.fan;
    return row[Math.max(0, Math.min(row.length - 1, slot))];
  }

  /* 组装技能副本（含地狱 CD 调整） */
  function buildSkills(specSkills, diff) {
    var list = (specSkills || []).map(clone);
    var adj = (DIFF[diff] || DIFF.normal).cdAdj;
    list.forEach(function (s) {
      s.cdLeft = 0;
      if (s.cd == null) s.cd = 0;
      if (adj < 0) s.cd = Math.max(1, s.cd + adj);
    });
    return list;
  }

  /* 通用 Boss 单位生成
   * tier: 'big' / 'mid' / 'leader'
   * slot: 0–4 */
  function makeBoss(arch, worldId, slot, diff, tier) {
    var spec = arch[tier === 'mid' ? 'mid' : (tier === 'leader' ? 'leader' : 'big')];
    var anchor = anchorGL(worldId, slot);
    var L = (tier === 'mid') ? anchor - 2 : anchor;
    L = Math.max(1, L);
    var g = GROWTH[spec.tier || tier] || GROWTH.big;
    var d = DIFF[diff] || DIFF.normal;
    var w = WORLD_COEF[worldId] || 1;

    var hp  = g.hp[0]  + g.hp[1]  * (L - 1);
    var atk = g.atk[0] + g.atk[1] * (L - 1);
    var def = g.def[0] + g.def[1] * (L - 1);
    var spd = g.spd[0] + g.spd[1] * (L - 1);

    hp  = round(hp * d.bossHp * w);
    atk = round(atk * d.bossAtk * w);
    def = round(def * w);
    spd = round(spd);

    var title = spec.title[WORLD_TIER_KEY[worldId]] || spec.title.fan;
    var name = '【' + WORLD_NAME[worldId] + '*' + title + '】';

    return {
      name: name, species: title,
      artKey: spec.artKey, sprite: spec.sprite,
      level: L,
      maxhp: hp, hp: hp,
      atk: atk, def: def, spd: spd,
      elem: arch.elem,
      boss: true,
      skills: buildSkills(spec.skills, diff),
      phases: (spec.phases || []).map(clone),
      shield: 0,
      buffs: { atk: 0, turns: 0 },
      guard: false, statuses: {}, im: [], charge: null
    };
  }

  /* 杂兵单位 */
  function makeTrash(arch, gl, nameSuffix) {
    var bases = TRASH[arch.id] || ['杀手'];
    var base = rngPick(bases);
    return G.Data.makeEnemy(base, gl, nameSuffix || base);
  }

  /* 召唤物（Boss 阶段 summon） */
  function makeSummon(spec, bossGL) {
    var L = Math.max(1, bossGL - 2);
    var e = G.Data.makeEnemy(spec.base, L, spec.name);
    return e;
  }

  /* 关卡类型（大九关 / 小五关） */
  function stageType(arch, stage) {
    var s = stage;
    if (arch.kind === 'big') {
      if (s === 5) return 'mid';
      if (s === 9) return 'big';
      if (s === 6) return 'rest';
      if (s === 3 || s === 7) return 'elite';
      return 'trash';
    }
    if (s === 5) return 'leader';
    if (s === 2 || s === 4) return 'elite';
    return 'trash';
  }

  /* 组装某一关的战斗参数
   * 返回 { type, enemies }；rest 关无敌人。 */
  function makeStage(arch, worldId, slot, diff, stage) {
    var type = stageType(arch, stage);
    var anchor = anchorGL(worldId, slot);
    if (type === 'big') return { type: type, enemies: [makeBoss(arch, worldId, slot, diff, 'big')] };
    if (type === 'mid') return { type: type, enemies: [makeBoss(arch, worldId, slot, diff, 'mid')] };
    if (type === 'leader') return { type: type, enemies: [makeBoss(arch, worldId, slot, diff, 'leader')] };
    if (type === 'rest') return { type: 'rest', enemies: [] };

    if (type === 'elite') {
      var gl = Math.max(1, anchor - 1);
      var e = makeTrash(arch, gl, null);
      e.name = '精锐 ' + e.name;
      e.maxhp = round(e.maxhp * 1.3); e.hp = e.maxhp;
      e.atk = round(e.atk * 1.1);
      return { type: 'elite', enemies: [e] };
    }
    /* trash：1–2 只，gl 在锚点 ±2~4 */
    var n = (stage === 1) ? 1 : (Math.random() < .55 ? 2 : 1);
    var list = [];
    for (var i = 0; i < n; i++) {
      var delta = 2 + Math.floor(Math.random() * 3);
      var tgl = Math.max(1, anchor - delta);
      list.push(makeTrash(arch, tgl, null));
    }
    return { type: 'trash', enemies: list };
  }

  /* ============================================================
   * 每世随机抽取（浮世）
   * ============================================================ */
  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
  /* 种子化随机（缺口 U8）：传 seed（字符串/数字）→ 走 G.RNG，**同一世同一界可复现**；
     不传 → 回落 Math.random（无头测试靠它覆盖随机性）。
     也接受 G.RNG 实例（调用方要连抽多组时，自己建一个传进来）。 */
  function seedRng(seed) {
    if (seed == null) return null;
    if (typeof seed === 'object' && typeof seed.next === 'function') return seed;
    return new G.RNG(G.RNG.hash(seed));
  }
  /* 抽 5：2 大 3 小、末位必大。返回原型 id 数组。seed 可选（见 seedRng）。 */
  function rollSet(seed) {
    var rng = seedRng(seed);
    var shuf = rng ? function (a) { return rng.shuffle(a); } : shuffle;
    var big = ARCH.filter(function (a) { return a.kind === 'big'; });
    var small = ARCH.filter(function (a) { return a.kind === 'small'; });
    var b = shuf(big.slice()).slice(0, 2);
    var s = shuf(small.slice()).slice(0, 3);
    var head = shuf([b[0]].concat(s));
    return head.concat([b[1]]).map(function (a) { return a.id; });
  }

  /* ===== 签名秘术（通关大 Boss / 头领首杀保底；效果系统后续接入）===== */
  var SECRETS = {
    n_xuehai: '血海神术', n_kurong: '枯荣神术',
    s_longxiang: '龙象圣力', x_jiuxiao: '九霄雷霆', s_taiyi: '太乙圣体',
    x_zhuxie: '诛邪神光', s_dajingang: '大金刚圣力', x_taiyi5yan: '太乙五烟',
    x_zhanxian: '斩仙飞刀', x_mangshan: '芒山聚灵', x_9tianxirang: '九天息壤',
    s_bulao: '不老君圣体', x_4xiang: '四象神盾', x_yufeng: '御风圣行',
    x_leiyin: '雷音度厄'
  };
  function secretById(id) {
    return SECRETS[id] ? { id: id, n: SECRETS[id] } : null;
  }

  /* ===== 秘术效果（功法秘术 v2.2 §4.2 + 副本 v3.2 §8.1）=====
     cat 圣=面板百分比 / 神=战斗被动 / 仙=每场一次主动（不耗灵力）。
     数值幅度随品阶（凡1 / 灵1.5 / 仙2），由 gradeOf 取。 */
  var SECRET_EFFECTS = {
    s_dajingang: { cat: '圣', atk: .12 },
    s_taiyi: { cat: '圣', def: .15 },
    s_bulao: { cat: '圣', hp: .15 },
    s_longxiang: { cat: '圣', atk: .08, hp: .10 },
    x_yufeng: { cat: '圣', spd: .12 },
    n_xuehai: { cat: '神', vamp: .15 },
    n_kurong: { cat: '神', kurong: { chance: .30, pct: .08, max: 3 } },
    x_zhuxie: { cat: '神', zhuxie: .25 },
    x_mangshan: { cat: '神', mangshan: 2 },
    x_4xiang: { cat: '神', startShield: .20 },
    x_jiuxiao: { cat: '仙', cast: { target: 'single', mult: 2.2, elem: '雷',
      status: { t: '麻', chance: .4 } } },
    x_taiyi5yan: { cat: '仙', cast: { target: 'all', mult: 1.3, elem: '无',
      status: { t: '封', chance: .3 } } },
    x_9tianxirang: { cat: '仙', cast: { target: 'self', healSelf: .5 } },
    x_zhanxian: { cat: '仙', cast: { target: 'single', mult: 2.6, elem: '金',
      pierce: .3 } },
    x_leiyin: { cat: '仙', cast: { target: 'all', mult: 1.3, elem: '雷',
      status: { t: '麻', chance: .3 } } }
  };
  function secretEffectById(id) { return SECRET_EFFECTS[id] || null; }

  /* 品阶随秘术获得世界：凡界凡品 1 / 灵界灵品 1.5 / 仙界仙品 2 / 道界 2.5 */
  function secretGrade(worldId) {
    return worldId === 'ling' ? 1.5
      : (worldId === 'xian' ? 2 : (worldId === 'dao' ? 2.5 : 1));
  }
  /* 旧档秘术为布尔 true → 按凡品 1 折算 */
  function gradeOf(save, id) {
    var v = save.secrets && save.secrets[id];
    return typeof v === 'number' ? v : 1;
  }

  /* ============================================================
   * 道界：固定三境试炼（《境界体系 v3.2》§5–§7 + 副本 v3.2 §6.3）
   * ============================================================
     道界**不抽随机池**：一条线性「道则回廊」共九关，3 关一境 × 三境 ——
       准圣斩三尸 → 圣人证混元 → 道祖合道。
     每关 `gl` 是**通关后**的境界锚点，九关正好把 145 → 171 走完：
       147 斩善尸 ｜ 150 斩恶尸 ｜ 153 斩自身尸
       156 三尸合一 ｜ 159 功德道相 ｜ 162 天道束缚
       165 道则傀儡 ｜ 168 大道化身 ｜ 171 合道（演出，无战斗）
     `cost` 是入场道晶（《闭环报告 v3.2》G4 口径）：
       100+300+500（准圣）+ 250+350+400（证圣）+ 500+700+800（合道）= 3900
     名号一律**固定、非前缀**（副本 v3.2 §7.2）—— 不走「【界*称号】」公式，
     因为三尸/道相/道则都是"道"本身的化身，不属于任何一界。 */
  var DAO_GROWTH = { hp: [260, 46], atk: [18, 2.6], def: [10, 1.5], spd: [12, .7] };
  var DAO_DROP_BASE = 80;              /* 道界每场战斗的道晶基准（× 难度 dao 系数） */
  var DAO_ENTER_GL = 145;              /* 入道界的起始境界（准圣一重） */
  var DAO_STAGES = 9;

  var DAO_TRIALS = [
    /* ---- 准圣：斩三尸（gl145–153）---- */
    { n: '斩善尸', gl: 147, realm: '准圣', cost: 100, drop: 60,
      win: '善尸已斩。慈悲亦是执，斩之方见本来。',
      boss: {
        name: '善念化身', sprite: 'heartDemon', elem: '木',
        skills: [
          { n: '慈悲渡厄', mult: 1.2, cd: 2, elem: '木' },
          { n: '莲台护持', kind: 'shield', pct: .22, cd: 4 },
          { n: '普度甘霖', kind: 'heal', pct: .18, cd: 5 }
        ],
        phases: [ { kind: 'heal', trig: .45, pct: .20 } ]
      } },

    { n: '斩恶尸', gl: 150, realm: '准圣', cost: 300, drop: 70,
      win: '恶尸已斩。修罗相灭，杀心归寂。',
      boss: {
        name: '恶念化身', sprite: 'heartDemon', elem: '暗',
        skills: [
          { n: '修罗斩', mult: 1.45, cd: 2, elem: '暗', vamp: .25 },
          { n: '血海滔天', mult: 1.3, cd: 4, charge: true, target: '全体', elem: '暗' }
        ],
        phases: [ { kind: 'enrage', trig: .35, atk: .30 } ]
      } },

    /* 自身尸 = 主角快照 ×1.1（境界 v3.2 §5：「本相：主角快照 ×1.1、全技能」），
       面板在战斗生成时现取，所以这里只留 snapshot 倍率。 */
    { n: '斩自身尸', gl: 153, realm: '准圣', cost: 500, drop: 80,
      win: '自身尸已斩。照见执念 —— 执念即我，我即无我。',
      boss: {
        name: '执念化身', sprite: 'heartDemon', elem: '无', snapshot: 1.10,
        skills: [
          { n: '执念一击', mult: 1.6, cd: 3, charge: true },
          { n: '心魔乱咒', mult: 1.2, cd: 2, status: { t: '封', chance: .30 } },
          { n: '镜花水月', kind: 'shield', pct: .20, cd: 4 }
        ],
        phases: [ { kind: 'enrage', trig: .30, atk: .25 } ]
      } },

    /* ---- 圣人：证道混元（gl154–162）---- */
    { n: '三尸合一', gl: 156, realm: '圣人', cost: 250, drop: 70,
      win: '三尸合一，混元道基已成。',
      boss: {
        name: '混元道基', sprite: 'heartDemon', elem: '无',
        skills: [
          { n: '三尸合击', mult: 1.5, cd: 2 },
          { n: '混元一气', mult: 1.25, cd: 4, charge: true, target: '全体' },
          { n: '道基不坏', kind: 'shield', pct: .25, cd: 5 }
        ],
        phases: [ { kind: 'summon', trig: .55, spec: { base: '杀手', name: '尸气化身' }, n: 2 } ]
      } },

    { n: '功德道相', gl: 159, realm: '圣人', cost: 350, drop: 75,
      win: '功德圆满，道相庄严 —— 业力不沾其身。',
      boss: {
        name: '功德道相', sprite: 'heartDemon', elem: '金',
        skills: [
          { n: '功德金光', mult: 1.3, cd: 2, elem: '金' },
          { n: '业力反噬', mult: 1.2, cd: 3, target: '全体', elem: '无',
            status: { t: '封', chance: .30 } },
          { n: '莲台护持', kind: 'shield', pct: .28, cd: 4 }
        ],
        phases: [ { kind: 'heal', trig: .50, pct: .22 } ]
      } },

    { n: '天道束缚', gl: 162, realm: '圣人', cost: 400, drop: 80,
      win: '天道锁链尽断 —— 元神寄托天道，证天道圣人。',
      boss: {
        name: '天道束缚', sprite: 'heartDemon', elem: '雷',
        skills: [
          { n: '锁链绞杀', mult: 1.4, cd: 2, elem: '雷' },
          { n: '天规雷罚', mult: 1.35, cd: 4, charge: true, target: '全体', elem: '雷',
            status: { t: '麻', chance: .35 } },
          { n: '法则锁链', kind: 'shield', pct: .30, cd: 5 }
        ],
        phases: [ { kind: 'enrage', trig: .40, atk: .25, cdCut: [ { match: '天规雷罚', cd: 2 } ] } ]
      } },

    /* ---- 道祖：合道天劫（gl163–171）---- */
    { n: '道则傀儡', gl: 165, realm: '道祖', cost: 500, drop: 70,
      win: '五行四象皆入彀中，道则傀儡伏诛。',
      boss: {
        name: '道则傀儡', sprite: 'heartDemon', elem: '无',
        skills: [
          { n: '五行轮转', mult: 1.4, cd: 2 },
          { n: '四象镇封', mult: 1.3, cd: 4, charge: true, target: '全体',
            status: { t: '封', chance: .35 } },
          { n: '法则护体', kind: 'shield', pct: .28, cd: 5 }
        ],
        phases: [ { kind: 'clone', trig: .50, pct: .45, n: 2 } ]
      } },

    { n: '大道化身', gl: 168, realm: '道祖', cost: 700, drop: 80,
      win: '大道化身崩解 —— 万法归墟，唯道长存。',
      boss: {
        name: '大道化身', sprite: 'heartDemon', elem: '无',
        skills: [
          { n: '大道碾落', mult: 1.6, cd: 2 },
          { n: '万法归墟', mult: 1.45, cd: 4, charge: true, target: '全体' },
          { n: '一气化三清', mult: 1.3, cd: 3, target: '全体' }
        ],
        phases: [
          { kind: 'summon', trig: .60, spec: { base: '杀手', name: '道则化身' }, n: 2 },
          { kind: 'enrage', trig: .30, atk: .30 }
        ]
      } },

    /* 合道 = 演出关（境界 v3.2 §7「合道演出：身合天道」），无战斗。 */
    { n: '合道', gl: 171, realm: '道祖', cost: 800, drop: 0, finale: true,
      win: '身合天道，言出为则。道祖境圆满 —— 此为修炼终点。',
      boss: null }
  ];

  /* ===== 道界工厂 ===== */

  function daoById(i) { return DAO_TRIALS[i] || null; }
  function daoCount() { return DAO_TRIALS.length; }

  /* 第 i 关的**入场**境界要求：线性回廊 —— 前关通关即达（第 0 关要求 gl145） */
  function daoReqGL(i) { return i <= 0 ? DAO_ENTER_GL : DAO_TRIALS[i - 1].gl; }

  /* 该关是否已历（本世内有效） */
  function daoCleared(save, i) {
    var cl = (save && save.daoCleared) || [];
    return !!cl[i];
  }

  /* 该关是否可挑战：线性回廊，前关已历才开下一关 */
  function daoOpen(save, i) {
    if (i <= 0) return true;
    return daoCleared(save, i - 1);
  }

  /* 道晶产出：道界每场战斗（野外与试炼同口径），随难度与关序略增 */
  function daoCrystalDrop(diff, index) {
    var d = DIFF[diff] || DIFF.normal;
    var base = DAO_DROP_BASE * (d.dao || 1);
    return Math.max(1, Math.round(base * (1 + 0.06 * (index || 0))));
  }

  /* 道晶总耗（用于 UI 与契约校验）：3900 */
  function daoTotalCost() {
    var n = 0;
    DAO_TRIALS.forEach(function (t) { n += t.cost || 0; });
    return n;
  }

  /* 某界当前难度（每界独立，缺省回落新游戏选的默认档）——
     dungeon 场景与 battle 场景共用这一份口径，避免两处漂移。 */
  function diffOf(meta, worldId) {
    var p = (meta && meta.progress) || {};
    var wd = p.worldDiff || {};
    return wd[worldId] || p.difficulty || 'normal';
  }

  /* 道界 Boss：不走 makeBoss 的「【界*称号】」公式（名号固定），
     数值按 DAO_GROWTH 生长；`snapshot` 关（执念化身）现取玩家面板 × 倍率。 */
  function makeDaoBoss(trial, diff, save, meta) {
    var b = trial.boss, d = DIFF[diff] || DIFF.normal, L = trial.gl;
    var hp, atk, def, spd;
    if (b.snapshot) {
      var st = G.Player.computeStats(save, meta);
      hp = st.maxhp * b.snapshot;
      atk = st.atk * b.snapshot;
      def = st.def * b.snapshot;
      spd = st.spd * b.snapshot;
    } else {
      hp  = DAO_GROWTH.hp[0]  + DAO_GROWTH.hp[1]  * (L - 1);
      atk = DAO_GROWTH.atk[0] + DAO_GROWTH.atk[1] * (L - 1);
      def = DAO_GROWTH.def[0] + DAO_GROWTH.def[1] * (L - 1);
      spd = DAO_GROWTH.spd[0] + DAO_GROWTH.spd[1] * (L - 1);
    }
    var w = WORLD_COEF.dao;
    hp  = round(hp * d.bossHp * w);
    atk = round(atk * d.bossAtk * w);
    def = round(def * w);
    spd = round(spd);

    return {
      name: b.name, species: b.name,
      sprite: b.sprite, artKey: b.artKey || null,
      level: L,
      maxhp: hp, hp: hp,
      atk: atk, def: def, spd: spd,
      elem: b.elem,
      boss: true,
      skills: buildSkills(b.skills, diff),
      phases: (b.phases || []).map(clone),
      shield: 0,
      buffs: { atk: 0, turns: 0 },
      guard: false, statuses: {}, im: [], charge: null
    };
  }

  /* 某关的战斗参数；合道关（finale）无敌人 */
  function makeDaoStage(trial, diff, save, meta) {
    if (!trial || trial.finale || !trial.boss) return { type: 'finale', enemies: [] };
    return { type: 'dao', enemies: [makeDaoBoss(trial, diff, save, meta)] };
  }

  G.Data.dungeons = {
    ARCH: ARCH,
    GROWTH: GROWTH,
    SLOT_GL: SLOT_GL,
    DIFF: DIFF,
    WORLD_COEF: WORLD_COEF,
    WORLD_NAME: WORLD_NAME,
    TRASH: TRASH,
    SECRETS: SECRETS,
    SECRET_EFFECTS: SECRET_EFFECTS,
    /* 道界 */
    DAO_TRIALS: DAO_TRIALS,
    DAO_GROWTH: DAO_GROWTH,
    DAO_ENTER_GL: DAO_ENTER_GL,
    DAO_STAGES: DAO_STAGES,
    DAO_DROP_BASE: DAO_DROP_BASE,
    archById: archById,
    anchorGL: anchorGL,
    makeBoss: makeBoss,
    makeSummon: makeSummon,
    makeStage: makeStage,
    stageType: stageType,
    rollSet: rollSet,
    secretById: secretById,
    secretEffectById: secretEffectById,
    secretGrade: secretGrade,
    gradeOf: gradeOf,
    /* 道界接口 */
    daoById: daoById,
    daoCount: daoCount,
    daoReqGL: daoReqGL,
    daoCleared: daoCleared,
    daoOpen: daoOpen,
    daoCrystalDrop: daoCrystalDrop,
    daoTotalCost: daoTotalCost,
    diffOf: diffOf,
    makeDaoBoss: makeDaoBoss,
    makeDaoStage: makeDaoStage
  };

})();
