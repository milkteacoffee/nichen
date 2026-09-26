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

  /* 青溪剑馆（剑·金） */
  S.青溪剑诀 = sectAtk('青溪剑诀', '青溪剑诀', '金', 1.25, 'qxj');
  S.流云三叠 = sectAtk('流云三叠', '流云三叠', '风', 0.80, 'qxj', { hits: 3 });
  /* 落霞镖局（体·土） */
  S.铁镖护体 = sectPass('铁镖护体', '铁镖护体', '防御', '土', 'lxb');
  S.镖行千里 = sectPass('镖行千里', '镖行千里', '仙术', '土', 'lxb');
  /* 幽篁药庐（丹·木） */
  S.百草回春 = sectPass('百草回春', '百草回春', '仙术', '木', 'yhy');
  S.药王真解 = sectActive('药王真解', '药王真解', '木', 'yhy',
    { n: '药王真解', heal: 1.8, cd: 3, hit: 100, target: '自身' });
  /* 火云观（火） */
  S.火云咒 = sectAtk('火云咒', '火云咒', '火', 1.30, 'hyg', { status: { t: '烧', chance: .22 } });
  S.焚天诀 = sectAtk('焚天诀', '焚天诀', '火', 1.50, 'hyg', { cd: 2, status: { t: '烧', chance: .30 } });
  /* 翠微猎户盟（御兽·木/土） */
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
})();
