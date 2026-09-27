/* ============================================================
 * 灵兽数据层（《灵兽系统 v1.1》§11/§12）
 * 24 物种；角色标签 battle战 / mount骑 / both战骑 / pet宠 / boss不可收服。
 * 成长坐标 = 与主角同一套境界 gl（1–171），无独立等级。
 * 数值：round(base + grow × (gl−1) × 资质系数 k)，与敌人 stat(pair,L) 同思路。
 * ============================================================ */
(function () {
  var D = G.Data = G.Data || {};

  /* 便捷构造：sp.chain.to 为另一物种 id（进化换种）；to 为 null 表示原地成年（马牛等）。 */
  function S(sp) { return sp; }

  var list = [
    /* ============ 凡界（10） ============ */
    S({ id: 'b_qingwenshe', n: '青纹蛇', elem: '木', world: 'fan', role: 'battle',
      chain: { to: 'b_bilinmang', gl: 10, item: '御兽丹·青纹' },
      base: { hp: 55, atk: 12, def: 7, spd: 11 }, grow: { hp: 7, atk: 1.7, def: 1.0, spd: 1.2 },
      skills: [{ n: '撕咬', gl: 1 }, { n: '蛇毒吐信', gl: 5 }, { n: '缠绕', gl: 9 }],
      qual: [30, 70], habitat: '后山前坡', ride: null }),
    S({ id: 'b_bilinmang', n: '碧鳞蟒', elem: '木', world: 'fan', role: 'both',
      chain: { to: 'b_qingjiao', gl: 19, item: '御兽丹·青蟒', place: '水脉石台' },
      base: { hp: 95, atk: 20, def: 12, spd: 13 }, grow: { hp: 11, atk: 2.6, def: 1.6, spd: 1.4 },
      skills: [{ n: '撕咬', gl: 10 }, { n: '蛇毒缠绞', gl: 15 }],
      qual: [40, 80], habitat: '幽篁竹海', ride: { coef: 0.65, terrains: ['land', 'water'] } }),
    S({ id: 'b_qingjiao', n: '青蛟', elem: '水', world: 'fan', role: 'both', chain: null,
      base: { hp: 150, atk: 30, def: 18, spd: 16 }, grow: { hp: 16, atk: 3.6, def: 2.2, spd: 1.8 },
      skills: [{ n: '兴风作浪', gl: 19 }, { n: '水龙击', gl: 24 }, { n: '腾云渡水', gl: 30 }],
      qual: [55, 90], habitat: '寒渊深水', ride: { coef: 0.55, terrains: ['land', 'water', 'cliff'] } }),
    S({ id: 'b_chiyanlang', n: '赤炎狼', elem: '火', world: 'fan', role: 'battle', chain: null,
      base: { hp: 60, atk: 14, def: 6, spd: 14 }, grow: { hp: 8, atk: 2.1, def: 0.9, spd: 1.5 },
      skills: [{ n: '烈焰冲袭', gl: 1 }, { n: '嗥月', gl: 8 }],
      qual: [30, 70], habitat: '黑风岭', ride: null }),
    S({ id: 'b_shujing', n: '树精', elem: '木', world: 'fan', role: 'battle', chain: null,
      base: { hp: 85, atk: 10, def: 12, spd: 5 }, grow: { hp: 12, atk: 1.4, def: 1.7, spd: 0.6 },
      skills: [{ n: '藤鞭', gl: 1 }, { n: '催眠粉', gl: 6 }],
      qual: [25, 65], habitat: '翠微山林', ride: null }),
    S({ id: 'b_chiyanshi', n: '赤眼豕', elem: '火', world: 'fan', role: 'battle', chain: null,
      base: { hp: 70, atk: 15, def: 8, spd: 9 }, grow: { hp: 9, atk: 2.0, def: 1.1, spd: 1.0 },
      skills: [{ n: '蛮力冲撞', gl: 1 }],
      qual: [25, 60], habitat: '山野灌丛', ride: null }),
    S({ id: 'b_huangzongma', n: '黄鬃马', elem: '无', world: 'fan', role: 'mount',
      chain: { to: null, gl: 8, item: '饲灵草料' },
      base: { hp: 60, atk: 8, def: 7, spd: 13 }, grow: { hp: 8, atk: 1.2, def: 1.0, spd: 1.4 },
      skills: [],
      qual: [20, 60], habitat: '落霞马市', ride: { coef: 0.75, terrains: ['land'] } }),
    S({ id: 'b_tiejiaoniu', n: '铁角牛', elem: '土', world: 'fan', role: 'mount',
      chain: { to: null, gl: 8, item: '饲灵草料' },
      base: { hp: 80, atk: 10, def: 10, spd: 8 }, grow: { hp: 10, atk: 1.4, def: 1.3, spd: 0.9 },
      skills: [],
      qual: [20, 55], habitat: '乡野田垄', ride: { coef: 0.80, terrains: ['land'], carry: true } }),
    S({ id: 'b_huiyuhe', n: '灰羽鹤', elem: '金', world: 'fan', role: 'mount',
      chain: { to: null, gl: 10, item: '灵鱼' },
      base: { hp: 55, atk: 9, def: 6, spd: 15 }, grow: { hp: 7, atk: 1.3, def: 0.9, spd: 1.6 },
      skills: [],
      qual: [30, 65], habitat: '苇荡山崖', ride: { coef: 0.70, terrains: ['land', 'cliff'] } }),
    S({ id: 'b_chiyanlangwang', n: '赤炎狼王', elem: '火', world: 'fan', role: 'boss', chain: null,
      base: { hp: 320, atk: 30, def: 14, spd: 16 }, grow: { hp: 0, atk: 0, def: 0, spd: 0 },
      skills: [{ n: '烈焰冲袭', gl: 1 }, { n: '狼王嗥月', gl: 1 }],
      qual: [0, 0], habitat: '黑风岭深处', ride: null }),

    /* ============ 灵界（6） ============ */
    S({ id: 'b_leishou', n: '雷兽', elem: '水', world: 'ling', role: 'battle', chain: null,
      base: { hp: 120, atk: 26, def: 12, spd: 12 }, grow: { hp: 13, atk: 3.2, def: 1.6, spd: 1.3 },
      skills: [{ n: '雷电轰击', gl: 64 }, { n: '雷泽怒', gl: 70 }],
      qual: [40, 80], habitat: '雷泽荒原', ride: null }),
    S({ id: 'b_shihunfu', n: '噬魂蝠', elem: '暗', world: 'ling', role: 'battle', chain: null,
      base: { hp: 70, atk: 24, def: 8, spd: 17 }, grow: { hp: 9, atk: 3.0, def: 1.1, spd: 1.8 },
      skills: [{ n: '吸血乱神', gl: 64 }, { n: '群蝠乱舞', gl: 72 }],
      qual: [35, 75], habitat: '古堡夜穹', ride: null }),
    S({ id: 'b_youlandie', n: '幽兰蝶', elem: '木', world: 'ling', role: 'pet', chain: null,
      base: { hp: 45, atk: 6, def: 5, spd: 12 }, grow: { hp: 5, atk: 0.8, def: 0.7, spd: 1.3 },
      skills: [{ n: '鳞粉催眠', gl: 64 }],
      qual: [50, 85], habitat: '幽兰深谷', ride: null }),
    S({ id: 'b_leizeju', n: '雷泽驹', elem: '雷', world: 'ling', role: 'both',
      chain: { to: null, gl: 70, item: '饲灵草料' },
      base: { hp: 130, atk: 28, def: 14, spd: 16 }, grow: { hp: 14, atk: 3.4, def: 1.8, spd: 1.7 },
      skills: [{ n: '雷蹄冲阵', gl: 70 }, { n: '雷泽奔袭', gl: 76 }],
      qual: [45, 85], habitat: '雷泽水畔', ride: { coef: 0.60, terrains: ['land', 'water'] } }),
    S({ id: 'b_xuangui', n: '玄龟', elem: '水', world: 'ling', role: 'mount',
      chain: { to: null, gl: 68, item: '灵鱼' },
      base: { hp: 160, atk: 16, def: 24, spd: 6 }, grow: { hp: 17, atk: 2.2, def: 2.8, spd: 0.7 },
      skills: [],
      qual: [40, 80], habitat: '寒渊深海', ride: { coef: 0.65, terrains: ['water'] } }),
    S({ id: 'b_qingluan', n: '青鸾', elem: '风', world: 'ling', role: 'mount',
      chain: { to: null, gl: 72, item: '灵鱼' },
      base: { hp: 95, atk: 22, def: 12, spd: 18 }, grow: { hp: 11, atk: 2.8, def: 1.5, spd: 1.9 },
      skills: [],
      qual: [50, 85], habitat: '云海高崖', ride: { coef: 0.50, terrains: ['air'] } }),

    /* ============ 仙界（6） ============ */
    S({ id: 'b_yundingxianhe', n: '云顶仙鹤', elem: '光', world: 'xian', role: 'mount',
      chain: { to: null, gl: 95, item: '灵鱼' },
      base: { hp: 120, atk: 20, def: 15, spd: 18 }, grow: { hp: 13, atk: 2.6, def: 1.9, spd: 1.9 },
      skills: [],
      qual: [55, 90], habitat: '瑶池云空', ride: { coef: 0.45, terrains: ['air'] } }),
    S({ id: 'b_bailu', n: '白鹿', elem: '木', world: 'xian', role: 'mount',
      chain: { to: null, gl: 95, item: '灵草' },
      base: { hp: 130, atk: 22, def: 16, spd: 17 }, grow: { hp: 14, atk: 2.8, def: 2.0, spd: 1.8 },
      skills: [],
      qual: [55, 90], habitat: '寿星仙园', ride: { coef: 0.50, terrains: ['air', 'land'] } }),
    S({ id: 'b_tianma', n: '天马', elem: '光', world: 'xian', role: 'both',
      chain: { to: null, gl: 100, item: '饲灵草料' },
      base: { hp: 150, atk: 32, def: 18, spd: 20 }, grow: { hp: 16, atk: 3.8, def: 2.2, spd: 2.1 },
      skills: [{ n: '天马冲阵', gl: 100 }, { n: '流光踏星', gl: 108 }],
      qual: [60, 92], habitat: '星河天厩', ride: { coef: 0.40, terrains: ['air'] } }),
    S({ id: 'b_pixiu', n: '貔貅', elem: '土', world: 'xian', role: 'both',
      chain: { to: null, gl: 100, item: '饲灵草料' },
      base: { hp: 160, atk: 30, def: 20, spd: 15 }, grow: { hp: 17, atk: 3.6, def: 2.4, spd: 1.6 },
      skills: [{ n: '吞金纳宝', gl: 100 }, { n: '貔貅扑击', gl: 108 }],
      qual: [60, 92], habitat: '天宫宝阙', ride: { coef: 0.45, terrains: ['air', 'land'], fortune: true } }),
    S({ id: 'b_qilin', n: '麒麟', elem: '火', world: 'xian', role: 'both',
      chain: { to: null, gl: 105, item: '御兽丹·麒麟' },
      base: { hp: 180, atk: 34, def: 22, spd: 18 }, grow: { hp: 19, atk: 4.0, def: 2.6, spd: 1.9 },
      skills: [{ n: '麒麟踏火', gl: 105 }, { n: '瑞兽冲阵', gl: 113 }],
      qual: [65, 95], habitat: '祥瑞仙山', ride: { coef: 0.40, terrains: ['air', 'land'] } }),
    S({ id: 'b_jinchidapeng', n: '金翅大鹏', elem: '金', world: 'xian', role: 'both',
      chain: { to: null, gl: 110, item: '御兽丹·大鹏' },
      base: { hp: 165, atk: 36, def: 18, spd: 22 }, grow: { hp: 18, atk: 4.2, def: 2.2, spd: 2.3 },
      skills: [{ n: '扶摇九万', gl: 110 }, { n: '金翅裂空', gl: 118 }],
      qual: [65, 95], habitat: '天海绝巅', ride: { coef: 0.35, terrains: ['air'], ocean: true } }),

    /* ============ 道界（2） ============ */
    S({ id: 'b_yinyangdaoli', n: '阴阳道鲤', elem: '道', world: 'dao', role: 'pet', chain: null,
      base: { hp: 80, atk: 8, def: 10, spd: 10 }, grow: { hp: 9, atk: 1.0, def: 1.2, spd: 1.1 },
      skills: [{ n: '观之悟道', gl: 145 }],
      qual: [70, 95], habitat: '道则池', ride: null }),
    S({ id: 'b_hundunshou', n: '混沌兽', elem: '道', world: 'dao', role: 'both',
      chain: { to: null, gl: 150, item: '道兽点化丹' },
      base: { hp: 220, atk: 44, def: 28, spd: 22 }, grow: { hp: 24, atk: 5.0, def: 3.2, spd: 2.3 },
      skills: [{ n: '混沌一击', gl: 150 }, { n: '鸿蒙冲阵', gl: 158 }],
      qual: [75, 100], habitat: '鸿蒙未判', ride: { coef: 0.30, terrains: ['air', 'water', 'land'] } })
  ];

  var index = {};
  list.forEach(function (sp) { index[sp.id] = sp; });

  /* 资质系数 k（§8） */
  function qualK(qual) { return 0.7 + (qual / 100) * 0.6; }
  function qualComment(q) {
    return q <= 29 ? '劣' : q <= 59 ? '平' : q <= 79 ? '良' : q <= 94 ? '优' : '天';
  }
  function r1(v) { return Math.round(v); }

  D.beasts = {
    list: list,
    byId: function (id) { return index[id] || null; },
    roleOf: function (id) { var sp = index[id]; return sp ? sp.role : null; },
    /* 出战门禁：仅 battle / both */
    canBattle: function (id) { var sp = index[id]; return !!sp && (sp.role === 'battle' || sp.role === 'both'); },
    /* 物种能否骑：mount / both（还要看个体是否成年） */
    canRideSpecies: function (id) { var sp = index[id]; return !!sp && (sp.role === 'mount' || sp.role === 'both'); },
    /* 个体能否骑：物种可骑 + 成年 */
    canRide: function (beast) {
      var sp = index[beast && beast.id];
      return !!sp && (sp.role === 'mount' || sp.role === 'both') && beast.stage === 'adult';
    },
    /* 不可骑/不可战的一句话原因（§2.2） */
    rideBlockReason: function (beast) {
      var sp = index[beast && beast.id];
      if (!sp) return '无此灵兽';
      if (sp.role === 'battle' || sp.role === 'pet') return '此兽难以为骑';
      if (beast.stage !== 'adult') return '尚未成年，驮不动人';
      return null;
    },
    battleBlockReason: function (id) {
      var sp = index[id];
      if (!sp) return '无此灵兽';
      if (sp.role === 'mount' || sp.role === 'pet') return '此兽不习战阵';
      return null;
    },
    /* 成年/进化门槛 */
    matureGl: function (id) { var sp = index[id]; return sp && sp.chain ? sp.chain.gl : null; },
    /* 境界属性（§4.1） */
    stat: function (id, gl, qual) {
      var sp = index[id];
      if (!sp) return null;
      var k = qualK(qual || 50);
      var g = (gl || 1) - 1;
      return {
        hp: r1(sp.base.hp + sp.grow.hp * g * k),
        atk: r1(sp.base.atk + sp.grow.atk * g * k),
        def: r1(sp.base.def + sp.grow.def * g * k),
        spd: r1(sp.base.spd + sp.grow.spd * g * k)
      };
    },
    /* 已领悟技能（gl 门槛） */
    skillsAtGl: function (id, gl) {
      var sp = index[id];
      if (!sp) return [];
      return sp.skills.filter(function (sk) { return sk.gl <= (gl || 1); }).map(function (sk) { return sk.n; });
    },
    rideInfo: function (id) { var sp = index[id]; return sp ? sp.ride : null; },
    worldOf: function (id) { var sp = index[id]; return sp ? sp.world : null; },
    qualK: qualK,
    qualComment: qualComment,
    /* 持有上限（§1） */
    CAP: 20
  };
})();
