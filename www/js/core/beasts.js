/* ============================================================
 * 灵兽核心管理器（《灵兽系统 v1.1》§5/§6/§8）
 * 在存档 save 上做个体 CRUD、喂养成长、成年/异化、出战位、骑乘。
 * 成长坐标与主角同一套境界 gl；出战兽 gl 不得超过主角。
 * ============================================================ */
(function () {
  var B = G.Data.beasts;

  /* 升到下一段所需修为（随境界抬升） */
  function need(gl) { return 60 + gl * 8; }
  function maxGl() { return (G.Player && G.Player.MAX_GL) || 171; }

  /* 喂养表：日常培育，不是化形道具（化形走 species.chain.item）。 */
  var FOOD = {
    '药渣': { xp: 14, bond: 1 },
    '灵食': { xp: 30, bond: 2 },
    '妖丹': { xp: 70, bond: 3 }
  };

  /* 字段兜底：任何途径构造的 save 进管理器前都补齐，防 undefined.length。 */
  function ensure(save) {
    if (!Array.isArray(save.beasts)) save.beasts = [];
    if (!Array.isArray(save.beastTeam)) save.beastTeam = [];
    if (save.riding == null) save.riding = null;
    if (!save.rideSkill) save.rideSkill = { land: false, air: false };
    return save;
  }

  function uidOf(save) { save.beastSeq = (save.beastSeq || 0) + 1; return save.beastSeq; }

  function makeIndividual(save, id, opts) {
    opts = opts || {};
    var sp = B.byId(id);
    if (!sp) return null;
    var gl = opts.gl != null ? opts.gl : 1;
    var span = sp.qual[1] - sp.qual[0];
    var qual = opts.qual != null ? opts.qual
      : sp.qual[0] + (span > 0 ? Math.floor(Math.random() * (span + 1)) : 0);
    var beast = {
      uid: uidOf(save), id: id, gl: gl,
      stage: opts.stage || 'young',
      qual: qual, bond: opts.bond != null ? opts.bond : 20,
      name: opts.name || sp.n,
      xp: 0, skills: [], equip: null, tack: null
    };
    beast.skills = B.skillsAtGl(id, gl);
    return beast;
  }

  function markBestiary(id) {
    var meta = G.game && G.game.meta;
    if (meta) { meta.bestiary = meta.bestiary || {}; meta.bestiary[id] = 'got'; }
  }

  function byUid(save, uid) {
    for (var i = 0; i < save.beasts.length; i++)
      if (save.beasts[i].uid === uid) return save.beasts[i];
    return null;
  }

  /* 化形/成年前置判定（不扣物品），供按钮置灰与 mature 复用。 */
  function matureBlockFor(save, beast) {
    var sp = B.byId(beast.id), ch = sp.chain;
    if (!ch) return '此兽已无需化形';
    if (beast.stage === 'adult' && !ch.to) return '已经成年';
    if (beast.gl < ch.gl) {
      var ri = G.Player.realmInfo ? G.Player.realmInfo(ch.gl) : null;
      return '修为不足，需到「' + (ri ? ri.n : ch.gl) + '」';
    }
    if (ch.place) return '需携它往「' + ch.place + '」点化（兽栏内不可）';
    if (!(save.items[ch.item] > 0)) return '缺少「' + ch.item + '」';
    return null;
  }

  G.Beasts = {
    need: need,
    FOOD: FOOD,
    TEAM_MAX: 1,

    byUid: byUid,
    /* 收服/赠予入栏 */
    add: function (save, id, opts) {
      ensure(save);
      var sp = B.byId(id);
      if (!sp) return { ok: false, reason: '无此灵兽物种' };
      if (sp.role === 'boss') return { ok: false, reason: '此等凶兽，收服不得' };
      if (save.beasts.length >= B.CAP) return { ok: false, reason: '兽栏已满（上限 ' + B.CAP + '）' };
      var beast = makeIndividual(save, id, opts);
      save.beasts.push(beast);
      markBestiary(id);
      return { ok: true, beast: beast };
    },
    /* 放生 */
    release: function (save, uid) {
      ensure(save);
      var i;
      for (i = 0; i < save.beasts.length; i++) if (save.beasts[i].uid === uid) break;
      if (i >= save.beasts.length) return { ok: false, reason: '兽栏中无此灵兽' };
      save.beasts.splice(i, 1);
      save.beastTeam = save.beastTeam.filter(function (u) { return u !== uid; });
      if (save.riding && save.riding.uid === uid) save.riding = null;
      return { ok: true };
    },
    /* 喂养：扣物品 → 加修为/亲密度 → 够了就涨 gl、领悟技能 */
    feed: function (save, uid, itemKey) {
      ensure(save);
      var beast = byUid(save, uid);
      if (!beast) return { ok: false, reason: '兽栏中无此灵兽' };
      var food = FOOD[itemKey];
      if (!food) return { ok: false, reason: '此物不合灵兽胃口' };
      if (!(save.items[itemKey] > 0)) return { ok: false, reason: '没有「' + itemKey + '」了' };
      save.items[itemKey] -= 1;
      if (!save.items[itemKey]) delete save.items[itemKey];
      beast.bond = Math.min(100, beast.bond + food.bond);
      beast.xp += food.xp;
      var ups = 0;
      while (beast.gl < maxGl() && beast.xp >= need(beast.gl)) {
        beast.xp -= need(beast.gl);
        beast.gl += 1; ups += 1;
      }
      if (beast.gl >= maxGl()) beast.xp = 0;
      beast.skills = B.skillsAtGl(beast.id, beast.gl);
      return { ok: true, gainXp: food.xp, gainBond: food.bond, glUps: ups, beast: beast };
    },
    /* 化形/成年的非破坏前置原因（null = 可执行） */
    matureBlock: function (save, uid) {
      ensure(save);
      var beast = byUid(save, uid);
      if (!beast) return '兽栏中无此灵兽';
      return matureBlockFor(save, beast);
    },
    /* 成年 / 异化（chain） */
    mature: function (save, uid) {
      ensure(save);
      var beast = byUid(save, uid);
      if (!beast) return { ok: false, reason: '兽栏中无此灵兽' };
      var block = matureBlockFor(save, beast);
      if (block) return { ok: false, reason: block };
      var sp = B.byId(beast.id), ch = sp.chain;
      save.items[ch.item] -= 1;
      if (!save.items[ch.item]) delete save.items[ch.item];
      var toName = null;
      if (ch.to) {
        beast.id = ch.to;
        var nsp = B.byId(ch.to);
        beast.name = nsp.n;
        toName = nsp.n;
        markBestiary(ch.to);
      }
      beast.stage = 'adult';
      beast.skills = B.skillsAtGl(beast.id, beast.gl);
      return { ok: true, evolved: !!ch.to, to: toName, beast: beast };
    },
    /* 出战位（单人伴兽，TEAM_MAX=1）：可战 + gl 不超过主角 */
    setBattle: function (save, uid) {
      ensure(save);
      var beast = byUid(save, uid);
      if (!beast) return { ok: false, reason: '兽栏中无此灵兽' };
      var why = B.battleBlockReason(beast.id);
      if (why) return { ok: false, reason: why };
      if (beast.gl > (save.globalLevel || 1))
        return { ok: false, reason: '灵兽境界高过你，压不住阵脚' };
      var has = save.beastTeam.indexOf(uid) >= 0;
      save.beastTeam = has ? [] : [uid];
      return { ok: true, active: !has, beast: beast };
    },
    isBattling: function (save, uid) { return save.beastTeam.indexOf(uid) >= 0; },
    /* 骑乘：物种可骑 + 成年 + 对应骑术（陆地可在骑乘中习得，空中需先会 air） */
    setRide: function (save, uid) {
      ensure(save);
      var beast = byUid(save, uid);
      if (!beast) return { ok: false, reason: '兽栏中无此灵兽' };
      var why = B.rideBlockReason(beast);
      if (why) return { ok: false, reason: why };
      var ride = B.rideInfo(beast.id);
      var airOnly = ride.terrains.length === 1 && ride.terrains[0] === 'air';
      save.rideSkill = save.rideSkill || { land: false, air: false };
      if (airOnly && !save.rideSkill.air)
        return { ok: false, reason: '尚未习得御空骑术，驯不得飞骑' };
      if (!airOnly && !save.rideSkill.land) save.rideSkill.land = true;   /* 骑中学会陆地骑术 */
      save.riding = { uid: uid };
      return { ok: true, beast: beast };
    },
    dismount: function (save) { ensure(save); save.riding = null; return { ok: true }; },
    isRiding: function (save, uid) { return !!(save.riding && save.riding.uid === uid); },
    /* 个体战斗属性（B3 接入战斗用） */
    combatStat: function (beast) { return B.stat(beast.id, beast.gl, beast.qual); }
  };
})();
