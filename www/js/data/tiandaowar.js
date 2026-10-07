/* 天道之战 · 五阶段数据（v0.86，《天道至恶》§7 / 《诸世情感》终局）
   ------------------------------------------------------------
   敌人面板按**主角当前实测属性**成比例缩放（st = computeStats），
   故无论何种构筑，五阶段始终"差一线、可打过"，不做裸数值墙。
   难度：normal / hard / hell 给气血、攻击系数与 CD 缩减；
   hell 为设计所指「完整形态」。
   五阶段（复用天道感应五阶段）：
     1 无视——以规则压人，少主动攻击，教你读蓄力、会格挡；
     2 眼熟——唤出已故牵挂残影，攻心 + 多目标，残影脆、先清；
     3 识破轮回——封灵夺法，逼你以不耗法力的凝气拳应对；
     4 识破异世——代行者 / 化身全力围剿，高数值多目标；
     5 对弈——天道本体（云幕冷眼），召唤 + 狂暴连环，全游戏最难。
   ============================================================ */
(function () {
  function sk(n, mult, extra) {
    var s = { n: n, mult: mult, cd: 0, cdLeft: 0, hit: 100, target: '前排', elem: '无' };
    if (extra) Object.keys(extra).forEach(function (k) { s[k] = extra[k]; });
    return s;
  }
  var DIFFM = {
    normal: { hp: 1.0, atk: 1.0, cd: 0 },
    hard:   { hp: 1.35, atk: 1.25, cd: 0 },
    hell:   { hp: 1.8, atk: 1.55, cd: 1 }
  };

  function makeStage(stage, save, meta, st) {
    var diff = (meta && meta.progress && meta.progress.difficulty) || 'normal';
    var dm = DIFFM[diff] || DIFFM.normal;
    function r(v) { return Math.max(1, Math.round(v)); }
    function unit(o) {
      var hp = r(st.maxhp * o.hpF * dm.hp);
      var u = {
        name: o.name, species: '天道', elem: o.elem || '无',
        level: save.globalLevel, artKey: null, sprite: o.sprite,
        maxhp: hp, hp: hp,
        atk: r(st.atk * o.atkF * dm.atk),
        def: r(st.def * (o.defF == null ? 1 : o.defF)),
        spd: r(st.spd * (o.spdF == null ? 1 : o.spdF)),
        skills: (o.skills || []).map(function (s) {
          var c = Object.assign({}, s);
          if (dm.cd && c.cd) c.cd = Math.max(1, c.cd - dm.cd);
          return c;
        }),
        statuses: {}, buffs: {}, side: 'right',
        boss: !!o.boss, phases: o.phases || []
      };
      return u;
    }

    if (stage === 1) {
      return [unit({
        name: '天道·规则', sprite: 'primordial', boss: true,
        hpF: 1.0, atkF: 0.45, defF: 1.0, spdF: 0.7,
        skills: [
          sk('天规压顶', 0.7),
          sk('因果律', 1.9, { cd: 4, charge: true })
        ]
      })];
    }
    if (stage === 2) {
      return [
        unit({
          name: '天道·旧影', sprite: 'lich', boss: true,
          hpF: 0.85, atkF: 0.45, defF: 0.9, spdF: 0.8,
          skills: [sk('攻心', 1.2, { cd: 2 })],
          phases: [{ trig: 0.5, kind: 'heal', pct: 0.15 }]
        }),
        unit({
          name: '爷爷残影', sprite: 'diviner',
          hpF: 0.4, atkF: 0.5, defF: 0.8, spdF: 0.8,
          skills: [sk('药要趁热', 0.9)]
        }),
        unit({
          name: '晚晴残影', sprite: 'aurora_spirit',
          hpF: 0.4, atkF: 0.5, defF: 0.8, spdF: 1.0,
          skills: [sk('等我回来', 1.0)]
        })
      ];
    }
    if (stage === 3) {
      return [unit({
        name: '天道·轮回', sprite: 'reaper', boss: true,
        hpF: 0.8, atkF: 0.55, defF: 0.9, spdF: 1.1,
        skills: [
          sk('封灵', 0.7, { cd: 2, status: { t: '封', chance: 0.5 } }),
          sk('轮回重置', 1.5, { cd: 4, charge: true })
        ]
      })];
    }
    if (stage === 4) {
      return [
        unit({
          name: '执尺代行者', sprite: 'celestial_guard',
          hpF: 0.55, atkF: 0.6, defF: 1.0, spdF: 1.0,
          skills: [sk('量罪', 1.1, { cd: 2 })]
        }),
        unit({
          name: '执尺代行者', sprite: 'celestial_guard',
          hpF: 0.55, atkF: 0.6, defF: 1.0, spdF: 1.0,
          skills: [sk('量罪', 1.1, { cd: 2 })]
        }),
        unit({
          name: '天道化身', sprite: 'thunder_god', boss: true,
          hpF: 0.8, atkF: 0.7, defF: 1.0, spdF: 1.05,
          skills: [
            sk('天威', 1.3, { cd: 2, elem: '雷' }),
            sk('雷霆万钧', 1.6, { cd: 4, charge: true, elem: '雷' })
          ]
        })
      ];
    }
    /* stage 5：天道本体 */
    return [unit({
      name: '天道', sprite: 'tiandao', boss: true,
      hpF: 1.6, atkF: 0.7, defF: 1.0, spdF: 1.1,
      skills: [
        sk('冷眼', 1.0),
        sk('天命封灵', 1.3, { cd: 2, status: { t: '封', chance: 0.3 } }),
        sk('诸世轮回', 1.7, { cd: 4, charge: true, target: '全体' })
      ],
      phases: [
        { trig: 0.66, kind: 'summon', n: 1, spec: { name: '代行者', base: '杀手' } },
        { trig: 0.33, kind: 'enrage', atk: 0.3 }
      ]
    })];
  }

  var STAGES = [
    { id: 1, n: '无　视', sub: '天道以规则压人，几乎不主动出手。', quote: '众生如棋，落子无悔。你，也不过是其中一子。' },
    { id: 2, n: '眼　熟', sub: '云幕里走出的，是故去牵挂的模样。', quote: '你牵挂的每一个，都先你而去——这便是规则。' },
    { id: 3, n: '识轮回', sub: '战场被改写，法术被一层层封去。', quote: '轮回百遍，你救不回任何一人，此为定数。' },
    { id: 4, n: '识异世', sub: '代行者与化身，全力围剿。', quote: '执尺者皆从我命，你拿什么，与我争？' },
    { id: 5, n: '对　弈', sub: '云幕深处，那只冷眼，终于睁开。', quote: '棋至终盘，你仍无一子可活。' }
  ];

  G.Data.tiandaowar = {
    makeStage: makeStage,
    STAGES: STAGES,
    stageInfo: function (n) { return STAGES[n - 1] || STAGES[0]; },
    stageCount: function (meta) { return 5; }
  };
})();
