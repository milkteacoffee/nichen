/* 功法数据（M0：凡阶）。kind: 攻击/防御/仙术；主动技能：mult/cd/hit/target/status */
(function () {
  function atk(id, n, elem, mult, extra) {
    var s = { id: id, n: n, kind: '攻击', tier: '凡', elem: elem, mult: mult, cd: 0, hit: 100, target: '前排' };
    if (extra) Object.keys(extra).forEach(function (k) { s[k] = extra[k]; });
    return s;
  }
  var S = {};

  /* ===== 下品入门功法（v0.75.0，用户口径）=====
     「一进来新手任务只会送下品功法，只有一个被动和一个主动技能，而且威力特别小」。
     参考凡人修仙传/仙逆：入门那本《长春功》就是最粗浅的东西 —— 能引气入体而已。
     这两本**刻意做弱**：
       · 主动 mult 1.05（比 Boss 池的 1.4~1.6 低一大截，也比开局技 1.2~1.3 低）；
       · 被动只给极少属性（靠 kind 自动分派，凡阶 ×1 无灵根匹配）。
     它们的作用是"让你能打第一只怪"，不是"陪你到筑基" —— 玩家必须去换功法。 */
  S.引气诀 = atk('引气诀', '引气诀', '无', 1.05, { tier: '凡', starter: true });
  /* 新功法模型（v0.77.0，用户口径）：一次只激发**一本功法**，深度来自功法**内部**——
     功法随品级/修炼等级解锁招式，最多 5 个技能、其中最多 3 个主动。
     入门下品《引气诀》= 1 主动（引气诀，威力极小）+ 1 被动（粗浅吐纳），皆 lv1 解锁。 */
  S.引气诀.moves = [
    { n: '引气诀', kind: '攻击', active: true, elem: '无', mult: 1.05, cd: 0, hit: 100, target: '前排', unlock: 1 },
    { n: '粗浅吐纳', kind: '仙术', passive: true, elem: '无', unlock: 1 }
  ];
  S.粗浅吐纳 = {
    id: '粗浅吐纳', n: '粗浅吐纳', kind: '仙术', tier: '凡', elem: '无',
    passive: true, starter: true
  };

  /* 开局配发（v0.3 §6）—— v0.75.0 起**不再赠予**，改为 Boss/商店/宗门产出 */
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
  /* 高品功法示范（v0.77.0）：5 技能（3主动+2被动），随修炼等级逐层解锁 */
  S.烈焰诀.moves = [
    { n: '烈焰诀', kind: '攻击', active: true, elem: '火', mult: 1.6, cd: 3, hit: 95, target: '前排', status: { t: '烧', chance: .30 }, unlock: 1 },
    { n: '火灵', kind: '攻击', passive: true, elem: '火', unlock: 9 },
    { n: '烈焰冲击', kind: '攻击', active: true, elem: '火', mult: 2.0, cd: 2, hit: 95, target: '前排', status: { t: '烧', chance: .35 }, unlock: 18 },
    { n: '焚意', kind: '攻击', passive: true, elem: '火', unlock: 27 },
    { n: '焚天', kind: '攻击', active: true, elem: '火', mult: 2.8, cd: 4, hit: 90, target: '全体', status: { t: '烧', chance: .50 }, unlock: 36 }
  ];
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

  /* ===== 功法碎片（v0.14.0）=====
     用户口径：副本要给功法碎片，野外刷怪也有几率掉。
     按**品阶**分三种，键沿用 `tierCoef` 的品阶名 —— 不另立一套命名：
       凡界 → 凡品功法碎片 / 灵界 → 灵品功法碎片 / 仙·道界 → 宝品功法碎片。
     用途 = 功法面板「参悟」：**10 片同品阶** → 随机一本该品阶功法
       （未习得 → 习得 lv1；已习得 → +1 级）。
     ⚠️ 池子**现算**（按 `tier` 过滤 S），不写静态清单 —— 加新功法不用回来改这里。 */
  var SHARD_BY_TIER = { '凡': '凡品功法碎片', '灵': '灵品功法碎片', '宝': '宝品功法碎片' };
  var SHARD_COST = 10;
  var TIER_BY_WORLD = { fan: '凡', ling: '灵', xian: '宝', dao: '宝' };
  /* 品阶 → 更低品阶（该品阶一本功法都没有时往下退，否则「参悟」会抽空池）。
     目前 宝 阶还没有功法 → 宝品碎片退到灵品；加功法后自动生效，不用改这里。 */
  var TIER_FALLBACK = { '宝': '灵', '灵': '凡' };
  function shardPool(tier) {
    var t = tier;
    for (var guard = 0; guard < 4; guard++) {
      var ids = Object.keys(S).filter(function (id) {
        /* ⚠️ 宗门功法**不进碎片池**：否则散修能用碎片「参悟」出宗门功法，
           "两道互斥"就被整条绕过去了（宗门功法只走宗门途径，见宗门 v1.0 §4）。 */
        return S[id].tier === t && S[id].src !== 'sect';
      });
      if (ids.length) return ids;
      if (!TIER_FALLBACK[t]) break;
      t = TIER_FALLBACK[t];
    }
    return [];
  }

  /* ============================================================
     宗门功法（《宗门与散修体系设计 v1.0》§4）
     ------------------------------------------------------------
     · src='sect'，sect = **根宗门 id**（分部/总部/道场共用同一本，靠 sects.rootOf 判授权）
     · 强度与同阶散修功法**同档**，差异在获取路径与手感：
       宗门偏"稳"（防御 / 续航 / 群体），散修偏"险"（爆发 / 吸血 / 单点）
     · 品阶：首版全部凡阶（山门可授）；灵阶/仙阶待灵界、仙界总部开工后补
     ============================================================ */
  function sectAtk(id, n, elem, mult, sectId, extra) {
    var s = { id: id, n: n, kind: '攻击', tier: '凡', elem: elem, mult: mult,
      cd: 0, hit: 100, target: '前排', src: 'sect', sect: sectId };
    if (extra) Object.keys(extra).forEach(function (k) { s[k] = extra[k]; });
    return s;
  }
  function sectPass(id, n, kind, elem, sectId, extra) {
    var s = { id: id, n: n, kind: kind, tier: '凡', elem: elem, passive: true,
      src: 'sect', sect: sectId };
    if (extra) Object.keys(extra).forEach(function (k) { s[k] = extra[k]; });
    return s;
  }
  function sectActive(id, n, elem, sectId, act) {
    return { id: id, n: n, kind: '仙术', tier: '凡', elem: elem, passive: true,
      src: 'sect', sect: sectId, active: act };
  }

  /* 青溪剑阁（剑·金） */
  S.青溪剑诀 = sectAtk('青溪剑诀', '青溪剑诀', '金', 1.25, 'qxj');
  S.流云三叠 = sectAtk('流云三叠', '流云三叠', '风', 0.80, 'qxj', { hits: 3 });
  /* 落霞宗（体·土） */
  S.铁镖护体 = sectPass('铁镖护体', '铁镖护体', '防御', '土', 'lxb');
  S.镖行千里 = sectPass('镖行千里', '镖行千里', '仙术', '土', 'lxb');
  /* 幽篁药庐（丹·木） */
  S.百草回春 = sectPass('百草回春', '百草回春', '仙术', '木', 'yhy');
  S.药王真解 = sectActive('药王真解', '药王真解', '木', 'yhy',
    { n: '药王真解', heal: 1.8, cd: 3, hit: 100, target: '自身' });
  /* 火云观（火） */
  S.火云咒 = sectAtk('火云咒', '火云咒', '火', 1.30, 'hyg', { status: { t: '烧', chance: .22 } });
  S.焚天诀 = sectAtk('焚天诀', '焚天诀', '火', 1.50, 'hyg', { cd: 2, status: { t: '烧', chance: .30 } });
  /* 翠微御灵宗（御兽·木/土） */
  S.猎兽诀 = sectAtk('猎兽诀', '猎兽诀', '木', 1.30, 'cwl');
  S.御兽同心 = sectPass('御兽同心', '御兽同心', '仙术', '土', 'cwl');
  /* 太虚剑宗（剑·金） */
  S.太虚剑意 = sectAtk('太虚剑意', '太虚剑意', '金', 1.35, 'txjz');
  S.万剑归宗 = sectActive('万剑归宗', '万剑归宗', '金', 'txjz',
    { n: '万剑归宗', mult: 1.20, cd: 3, hit: 100, target: '全体' });
  /* 丹霞谷（丹·火） */
  S.丹霞吐纳 = sectPass('丹霞吐纳', '丹霞吐纳', '仙术', '火', 'dxg');
  S.九转丹经 = sectActive('九转丹经', '九转丹经', '火', 'dxg',
    { n: '九转丹经', heal: 2.0, cd: 4, hit: 100, target: '自身' });
  /* 玄天阵宗（阵·土） */
  S.小周天阵 = sectPass('小周天阵', '小周天阵', '防御', '土', 'xtzz');
  S.玄天困阵 = sectActive('玄天困阵', '玄天困阵', '土', 'xtzz',
    { n: '玄天困阵', mult: 0.9, cd: 3, hit: 100, target: '前排', status: { t: '封', chance: .45 } });
  /* 万兽山庄（御兽·土） */
  S.兽血诀 = sectAtk('兽血诀', '兽血诀', '土', 1.35, 'wssz');
  S.万兽朝宗 = sectActive('万兽朝宗', '万兽朝宗', '土', 'wssz',
    { n: '万兽朝宗', mult: 1.15, cd: 3, hit: 100, target: '全体' });
  /* 雷泽散人盟（水） */
  S.雷泽引气 = sectPass('雷泽引气', '雷泽引气', '仙术', '水', 'lzm');
  S.雷泽怒涛 = sectAtk('雷泽怒涛', '雷泽怒涛', '水', 1.30, 'lzm', { status: { t: '麻', chance: .28 } });
  /* 云海剑冢守冢一脉（剑·金） */
  S.守冢剑式 = sectPass('守冢剑式', '守冢剑式', '防御', '金', 'yhjz');
  S.冢中枯骨 = sectAtk('冢中枯骨', '冢中枯骨', '金', 1.40, 'yhjz', { pierce: .20 });
  /* 寒渊水府鲛族（水） */
  S.鲛绡歌 = sectActive('鲛绡歌', '鲛绡歌', '水', 'hysf',
    { n: '鲛绡歌', mult: 0, cd: 3, hit: 80, target: '前排', status: { t: '睡', chance: .55 } });
  S.寒渊怒啸 = sectAtk('寒渊怒啸', '寒渊怒啸', '水', 1.35, 'hysf', { status: { t: '麻', chance: .25 } });
  /* 南天门天兵营（光） */
  S.天兵列阵 = sectPass('天兵列阵', '天兵列阵', '防御', '光', 'tmty');
  S.天门敕令 = sectActive('天门敕令', '天门敕令', '光', 'tmty',
    { n: '天门敕令', mult: 1.25, cd: 4, hit: 100, target: '全体' });

  /* ============================================================
     功法归属（src）—— 宗门与散修互斥的落地依据
     ------------------------------------------------------------
     · 'common' 开局三本（灵根功 + 铁布衫 + 吐纳术）：**两道都能用**
     · 'free'   其余全部既有功法 = 散修功法（江湖上流通的）
     · 'sect'   上面新加的宗门功法
     新增功法**必须**显式给 src，否则这里兜底成 'free'（散修侧），
     会让宗门功法误落到散修池里 —— 所以 `sect.*` 契约会逐条校验。
     ============================================================ */
  var COMMON_IDS = ['铁布衫', '吐纳术'];
  /* ⚠️ `startByElem` 是**对象**（属性 → 功法 id），不是数组 —— 别对它用 indexOf，
     那会让整个 skills.js 加载失败，连锁炸掉几十条契约（踩过）。 */
  var START_IDS = {};
  Object.keys(startByElem).forEach(function (k) { START_IDS[startByElem[k]] = 1; });
  Object.keys(S).forEach(function (id) {
    if (S[id].src) return;                      /* 宗门功法已显式声明 */
    S[id].src = (COMMON_IDS.indexOf(id) >= 0 || START_IDS[id]) ? 'common' : 'free';
  });

  /* ============================================================
     功法里程碑系统（v0.76.0 阶段五-3）
     ------------------------------------------------------------
     用户口径：「前期要快，后期要慢，每个里程碑（lv9/18/27/36）都要有仪式感」

     里程碑结构：每9级（一重）解锁1个被动效果
       - lv9（一重）：基础威力提升
       - lv18（二重）：属性加成（暴击/穿透/吸血等）
       - lv27（三重）：进阶效果（倍率提升/特殊机制）
       - lv36（四重·九重巅峰）：终极效果（大幅提升/特殊能力）

     effect类型：
       - mult: 技能倍率加成（乘法，如1.2 = 提升20%）
       - crit: 暴击率加成（加法，如0.05 = +5%）
       - pierce: 穿透率加成（加法，如0.10 = +10%）
       - vamp: 吸血率加成（加法，如0.08 = +8%）
       - atk/def/hp: 属性百分比加成（如0.15 = +15%属性）
       - cost: 法力消耗降低（如-0.20 = 降低20%消耗）
     ============================================================ */
  var SKILL_MAX_PROG = 36;  // 九重巅峰
  var MILESTONES = [9, 18, 27, 36];  // 四个里程碑

  /* 通用里程碑模板（按功法kind分类）*/
  var MILESTONE_TEMPLATES = {
    /* 攻击类功法：重视输出与爆发 */
    '攻击': [
      { lv: 9, desc: '威力初显', effect: { mult: 1.15 } },          // +15%倍率
      { lv: 18, desc: '破敌锋芒', effect: { crit: 0.05 } },         // +5%暴击
      { lv: 27, desc: '凌厉攻势', effect: { pierce: 0.10 } },       // +10%穿透
      { lv: 36, desc: '九重巅峰', effect: { mult: 1.30, crit: 0.08 } }  // +30%倍率+8%暴击
    ],
    /* 防御类功法：重视生存与韧性 */
    '防御': [
      { lv: 9, desc: '金刚不坏', effect: { def: 0.20 } },          // +20%防御
      { lv: 18, desc: '铜墙铁壁', effect: { hp: 0.15 } },          // +15%气血
      { lv: 27, desc: '护体神功', effect: { def: 0.35 } },         // 额外+35%防御
      { lv: 36, desc: '九重巅峰', effect: { def: 0.50, hp: 0.30 } } // +50%防御+30%气血
    ],
    /* 仙术类功法：重视续航与法力 */
    '仙术': [
      { lv: 9, desc: '灵气充盈', effect: { hp: 0.15 } },           // +15%气血
      { lv: 18, desc: '仙家妙法', effect: { cost: -0.15 } },       // 法力消耗-15%
      { lv: 27, desc: '灵台清明', effect: { hp: 0.25 } },          // 额外+25%气血
      { lv: 36, desc: '九重巅峰', effect: { hp: 0.40, vamp: 0.05 } } // +40%气血+5%吸血
    ]
  };

  /* 为每个功法生成里程碑数据 */
  function getMilestones(skillData) {
    var kind = skillData.kind || '攻击';
    var template = MILESTONE_TEMPLATES[kind] || MILESTONE_TEMPLATES['攻击'];
    return template;
  }

  /* ============================================================
     功法「招式」系统（v0.77.0，用户口径）
     · 一本功法 = 容器，含 moves[]（最多 5、主动最多 3）
     · 每个 move 有 unlock（功法 lv1..36 解锁）
     · 未显式给 moves 的旧功法 → legacyMoves 自动封装，不破坏旧内容
     ============================================================ */
  var MAX_MOVES = 5, MAX_ACTIVE_MOVES = 3;
  function isActiveMove(m){ return !!m.active || (m.kind === '攻击' && !m.passive); }
  function legacyMoves(sd){
    var mv = [];
    if (sd.kind === '攻击' && sd.mult) {
      mv.push({ n: sd.n, kind: '攻击', active: true, elem: sd.elem, mult: sd.mult, cd: sd.cd || 0,
        hit: sd.hit, target: sd.target, status: sd.status, hits: sd.hits, pierce: sd.pierce, unlock: 1 });
      /* 攻击功法亦有『功法本体』的被动修炼（贡献 ATK）——主动是招式、被动是根基 */
      mv.push({ n: sd.n + '·功法', kind: '攻击', passive: true, elem: sd.elem, unlock: 1 });
    }
    if (sd.passive) {
      mv.push({ n: sd.n, kind: sd.kind, passive: true, elem: sd.elem, unlock: 1 });
    }
    if (sd.active && sd.kind !== '攻击') {
      var a = sd.active;
      mv.push({ n: a.n, kind: sd.kind, active: true, elem: sd.elem, mult: a.mult || 0, heal: a.heal || 0,
        cd: a.cd || 0, hit: a.hit, target: a.target, status: a.status, unlock: a.unlock || 1 });
    }
    if (!mv.length) mv.push({ n: sd.n, kind: sd.kind || '仙术', passive: true, elem: sd.elem || '无', unlock: 1 });
    return mv;
  }
  function gongfaMoves(id){
    var sd = S[id]; if (!sd) return [];
    if (Array.isArray(sd.moves) && sd.moves.length) return sd.moves;
    return legacyMoves(sd);
  }
  function unlockedMoves(id, lv){
    lv = lv || 1;
    return gongfaMoves(id).filter(function (m){ return (m.unlock || 1) <= lv; });
  }
  function activeMovesOf(id, lv){ return unlockedMoves(id, lv).filter(isActiveMove); }
  function passiveMovesOf(id, lv){ return unlockedMoves(id, lv).filter(function (m){ return !!m.passive; }); }

  G.Data = G.Data || {};
  G.Data.skills = S;
  G.Data.skillDropPool = dropPool;
  G.Data.skillDropPoolLing = dropPoolLing;
  G.Data.shenBoPool = shenBoPool;
  G.Data.startSkillByElem = startByElem;
  G.Data.tierCoef = tierCoef;
  G.Data.shardByTier = SHARD_BY_TIER;
  G.Data.shardCost = SHARD_COST;
  G.Data.tierByWorld = TIER_BY_WORLD;
  G.Data.shardPool = shardPool;
  G.Data.SKILL_MAX_PROG = SKILL_MAX_PROG;
  G.Data.MILESTONES = MILESTONES;
  G.Data.getMilestones = getMilestones;
  G.Data.gongfaMoves = gongfaMoves;
  G.Data.unlockedMoves = unlockedMoves;
  G.Data.activeMovesOf = activeMovesOf;
  G.Data.passiveMovesOf = passiveMovesOf;
  G.Data.MAX_MOVES = MAX_MOVES;
  G.Data.MAX_ACTIVE_MOVES = MAX_ACTIVE_MOVES;
})();
