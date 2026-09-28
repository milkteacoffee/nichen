/* 宗门「独立小世界」程序化生成 —— 《宗门小世界与内部地图生成设计 v1.0》
 *
 * 每个宗门不是一间 30×17 的房，而是一座**独立小世界**：由多栋 30×17 的室内场景
 * （山门 / 主殿 / 传功 / 任务 / 贡献·商店 / 藏经 / 炼丹 / 炼器 / 灵兽园 / 后山 / 闭关 / 禁地）
 * 以门相连，确定性生成。
 *
 *   · 房间 map id = sect.<sectId>.<role>；种子 = worldSeed + ':' + sectId，
 *     同世重进同一宗门布局完全一致。
 *   · 大宗门 = 全套 12 栋；小宗门 = 山门 / 主殿 / 传功（兼任务·商店）/ 一栋特色 / 后山，5 栋。
 *   · 门用既有 exits 形状 {x0,x1,y,to,spawn,label}：主殿南墙接山门，北墙三个门分接
 *     西院（传功→藏经→灵兽园）、后山（→闭关→禁地）、东院（任务→贡献→炼丹→炼器）。
 *   · 每个 NPC 带 **gl**（与主角同一套 19 境界，realmInfo 可转名）；敌对 NPC/妖兽同样走 gl。
 *
 * 本文件负责**生成与数据校验**（smoke 的 sectgen 契约覆盖）；逐房间的场景接入与交互面板
 * 按 v1.0 §6 分阶段开放，未开放的建筑不会出现在玩家可进入的 live 集群里（不留占位空房）。
 */
(function () {
  function hashStr(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function F(id, kind, x, y, w, h, act, label) {
    return { id: id, kind: kind, x: x, y: y, w: w, h: h, act: act || null, label: label || null };
  }

  var W = 30, H = 17, CX = 15;

  /* ===== 房间模板：furn 布局（焦点建筑带 act）+ 主角落点 ===== */
  var ROOM = {
    gate: { n: '山门殿', act: 'sect.gate', furn: function (p) {
      return [F('stele', 'altar', 13, 3, 4, 2, 'sect.gate', '山门碑'),
        F('rackL', 'shelf', 2, 4, 3, 1), F('rackR', 'shelf', 25, 4, 3, 1),
        F('lanternL', 'lantern', 5, 8, 1, 2), F('lanternR', 'lantern', 24, 8, 1, 2)];
    } },
    hall: { n: '主殿', act: 'secthall', furn: function () {
      return [F('screen', 'screen', 13, 3, 4, 1),
        F('seat', 'counter', 12, 6, 6, 1, 'secthall', '主座'),
        F('lanternA', 'lantern', 1, 4, 1, 2), F('lanternB', 'lantern', 28, 4, 1, 2),
        F('tableL', 'table', 3, 12, 3, 2), F('tableR', 'table', 24, 12, 3, 2)];
    } },
    chuangong: { n: '传功殿', act: 'sect.exchange', furn: function () {
      return [F('shelfL', 'shelf', 2, 3, 3, 1), F('shelfR', 'shelf', 25, 3, 3, 1),
        F('seat', 'counter', 11, 6, 8, 1, 'sect.exchange', '传功座'),
        F('cushionA', 'cushion', 6, 11, 2, 2), F('cushionB', 'cushion', 22, 11, 2, 2)];
    } },
    task: { n: '任务堂', act: 'sect.tasks', furn: function () {
      return [F('board', 'shelf', 12, 3, 6, 1, 'sect.tasks', '任务榜'),
        F('counter', 'counter', 11, 7, 8, 1, 'sect.tasks', '执事案'),
        F('table', 'table', 4, 11, 3, 2), F('crate', 'crate', 25, 11, 1, 1)];
    } },
    gongxian: { n: '贡献堂', act: 'sect.shop', furn: function () {
      return [F('shelfL', 'shelf', 2, 3, 3, 1), F('shelfR', 'shelf', 25, 3, 3, 1),
        F('counter', 'counter', 11, 7, 8, 1, 'sect.shop', '兑换柜'),
        F('jarA', 'jar', 5, 11, 1, 1), F('jarB', 'jar', 24, 11, 1, 1)];
    } },
    cangjing: { n: '藏经阁', act: 'sect.library', furn: function () {
      return [F('shelfA', 'shelf', 2, 3, 3, 1), F('shelfB', 'shelf', 25, 3, 3, 1),
        F('shelfC', 'shelf', 2, 9, 3, 1), F('shelfD', 'shelf', 25, 9, 3, 1),
        F('desk', 'table', 11, 6, 8, 2, 'sect.library', '阅经案')];
    } },
    liandan: { n: '炼丹房', act: 'sect.alchemy', furn: function () {
      return [F('shelfL', 'shelf', 2, 3, 3, 1), F('shelfR', 'shelf', 25, 3, 3, 1),
        F('furnace', 'vessel', 14, 6, 2, 2, 'sect.alchemy', '丹炉'),
        F('jarA', 'jar', 6, 11, 1, 1), F('jarB', 'jar', 23, 11, 1, 1)];
    } },
    lianqi: { n: '炼器堂', act: 'sect.forge', furn: function () {
      return [F('shelf', 'shelf', 2, 3, 3, 1),
        F('anvil', 'counter', 11, 6, 8, 1, 'sect.forge', '炼器台'),
        F('crateA', 'crate', 24, 10, 1, 1), F('crateB', 'crate', 25, 11, 1, 1)];
    } },
    lingshou: { n: '灵兽园', act: 'sect.beasts', furn: function () {
      return [F('pen', 'fence', 4, 4, 8, 6, 'sect.beasts', '兽栏'),
        F('pen2', 'fence', 18, 4, 8, 6, 'sect.beasts', '幼兽栏'),
        F('manger', 'counter', 11, 12, 8, 1, 'sect.beasts', '饲槽')];
    } },
    houshan: { n: '后山', act: 'sect.fields', furn: function () {
      return [F('field', 'ltian', 2, 4, 8, 5, 'sect.fields', '灵田'),
        F('herb', 'yaopu', 18, 4, 8, 5, 'sect.fields', '药圃'),
        F('mine', 'kuangmai', 12, 11, 6, 4, 'sect.fields', '矿脉')];
    } },
    biguan: { n: '闭关石室', act: 'sect.seclusion', furn: function () {
      return [F('roomA', 'cave', 3, 4, 5, 5, 'sect.seclusion', '石室·甲'),
        F('roomB', 'cave', 22, 4, 5, 5, 'sect.seclusion', '石室·乙'),
        F('cushion', 'cushion', 14, 8, 2, 2)];
    } },
    jindi: { n: '禁地', act: 'sect.forbidden', furn: function () {
      return [F('rift', 'altar', 12, 4, 6, 3, 'sect.forbidden', '秘境入口'),
        F('steleL', 'altar', 4, 9, 3, 2), F('steleR', 'altar', 23, 9, 3, 2)];
    } }
  };

  /* 大宗门 12 栋的连接（邻接表，双向在 build 时由 exits 自动配对）*/
  var BIG_LINKS = [
    ['gate', 'hall'],
    ['hall', 'chuangong'], ['chuangong', 'cangjing'], ['cangjing', 'lingshou'],   /* 西院 */
    ['hall', 'task'], ['task', 'gongxian'], ['gongxian', 'liandan'], ['liandan', 'lianqi'], /* 东院 */
    ['hall', 'houshan'], ['houshan', 'biguan'], ['biguan', 'jindi']              /* 后山 */
  ];
  /* 西院挂主殿北门左、东院北门右、后山北门中 */
  var HALL_NORTH = { chuangong: { x0: 3, x1: 7 }, houshan: { x0: 13, x1: 16 }, task: { x0: 22, x1: 26 } };

  /* 小宗门：5 栋。特色房随宗门主题 */
  function smallRoles(sect) {
    var e = sect.elem || '';
    var feature = 'cangjing';
    if (sect.id === 'yhy' || sect.id === 'hyg' || e === '木' || e === '火') feature = 'liandan';
    if (sect.id === 'cwl' || sect.id === 'wssz') feature = 'lingshou';
    if (sect.id === 'lxb') feature = 'lianqi';
    return { list: ['gate', 'hall', 'chuangong', feature, 'houshan'],
      links: [['gate', 'hall'], ['hall', 'chuangong'], ['chuangong', feature], ['hall', 'houshan']] };
  }

  /* 掌门境界 gl（按界 + 规模）；其余 NPC 在此基础上递减 */
  function masterGl(sect) {
    var base = { fan: { small: 27, big: 36 }, ling: { small: 72, big: 90 }, xian: { small: 117, big: 144 } };
    var w = base[sect.world] || base.fan;
    return w[sect.size === 'big' ? 'big' : 'small'];
  }
  /* 房间 NPC：称号 + gl 偏移 */
  var NPC_DEF = {
    gate: ['迎客弟子', -18], hall: ['门主', 0], chuangong: ['传功长老', -9],
    task: ['任务执事', -12], gongxian: ['掌库执事', -12], cangjing: ['守阁长老', -9],
    liandan: ['丹师', -9], lianqi: ['炼器师', -9], lingshou: ['御兽师', -9],
    houshan: ['灵植弟子', -18], biguan: null, jindi: ['镇守长老', -6]
  };

  function roomId(sectId, role) { return 'sect.' + sectId + '.' + role; }

  /* 建一栋房间的 map md */
  function buildRoom(sect, role, exits, rng) {
    var tpl = ROOM[role];
    var furn = tpl.furn().map(function (f) {
      return { id: role + '.' + f.id, kind: f.kind, x: f.x, y: f.y, w: f.w, h: f.h,
               act: f.act, label: f.label };
    });
    var npcs = [];
    var nd = NPC_DEF[role];
    if (nd) {
      var gl = Math.max(1, masterGl(sect) + nd[1]);
      npcs.push({
        id: role + '.npc', kind: 'keeper', name: nd[0], gl: gl,
        portrait: 'keeper', x: CX, y: 9, act: tpl.act
      });
    }
    return {
      id: roomId(sect.id, role), sectRoom: role, indoor: true, safe: true,
      n: sect.n + '·' + tpl.n, label: tpl.n,
      w: W, h: H, ground: 'floor', furn: furn, npcs: npcs,
      exits: exits, spawn: { x: CX, y: H - 2 }
    };
  }

  /* 门在房间的哪面墙：link 中，约定每栋“后继”房在北、前驱在南。
     由邻接顺序推断父子（hall/gate 为根），这里直接按 links 顺序给出方向。 */
  function build(save, sect) {
    var rng = new G.RNG(hashStr(save.worldSeed + ':' + sect.id));
    var small = sect.size !== 'big';
    var plan = small ? smallRoles(sect) : { list: Object.keys(ROOM), links: BIG_LINKS };

    /* 为每条 link 两端各写一个 exit：from 端北门 → to；to 端南门 → from。
       主殿的三个北门用不同 x 段，其余房间北门/南门居中。 */
    var exitsByRole = {};
    plan.list.forEach(function (r) { exitsByRole[r] = []; });

    /* 山门南门 → 外界（回宗门所在区域）*/
    var regionMap = sect.region;
    if (G.Data.regions && G.Data.regions.mapIdOf) regionMap = G.Data.regions.mapIdOf(sect.region) || sect.region;
    exitsByRole.gate.push({ x0: CX - 1, x1: CX + 1, y: H - 1, to: regionMap,
      spawn: { x: CX, y: 12 }, label: '离开' + sect.n });

    plan.links.forEach(function (lk) {
      var a = lk[0], b = lk[1];
      /* a 北墙开门 → b */
      var northBand = (a === 'hall' && HALL_NORTH[b]) ? HALL_NORTH[b] : { x0: CX - 1, x1: CX + 1 };
      exitsByRole[a].push({ x0: northBand.x0, x1: northBand.x1, y: 0, to: roomId(sect.id, b),
        spawn: { x: CX, y: H - 2 }, label: ROOM[b].n });
      /* b 南墙开门 → a */
      exitsByRole[b].push({ x0: CX - 1, x1: CX + 1, y: H - 1, to: roomId(sect.id, a),
        spawn: { x: CX, y: 2 }, label: ROOM[a].n });
    });

    var rooms = plan.list.map(function (role) {
      return buildRoom(sect, role, exitsByRole[role], rng);
    });

    return {
      id: 'sect.' + sect.id, sectId: sect.id, n: sect.n + '·小世界',
      small: small, entry: roomId(sect.id, 'gate'), hall: roomId(sect.id, 'hall'),
      roles: plan.list, rooms: rooms, links: plan.links
    };
  }

  var cache = {};
  function of(save, sectId) {
    var sect = G.Data.sects.byId(sectId);
    if (!sect) return null;
    var key = (save.worldSeed || '0') + ':' + sectId;
    if (!cache[key]) cache[key] = build(save, sect);
    return cache[key];
  }

  /* ===== R1：live 集群（只含功能已闭环房间，《宗门小世界 v1.0》§7）===== */
  var LIVE = {
    big: { roles: ['gate', 'hall', 'chuangong', 'gongxian', 'houshan'],
      links: [['gate', 'hall'], ['hall', 'chuangong'], ['hall', 'gongxian'], ['hall', 'houshan']] },
    small: { roles: ['gate', 'hall', 'chuangong', 'houshan'],
      links: [['gate', 'hall'], ['hall', 'chuangong'], ['hall', 'houshan']] }
  };
  /* live 主殿北门分位（避免多门叠同一格）：传功左 / 后山中 / 贡献右 */
  var LIVE_NORTH = { chuangong: { x0: 3, x1: 7 }, houshan: { x0: 13, x1: 16 }, gongxian: { x0: 22, x1: 26 } };

  function liveOf(save, sectId) {
    var full = of(save, sectId);
    if (!full) return null;
    var sect = G.Data.sects.byId(sectId);
    var plan = LIVE[sect.size === 'big' ? 'big' : 'small'];
    var exitsByRole = {};
    plan.roles.forEach(function (r) { exitsByRole[r] = []; });
    var regionMap = sect.region;
    if (G.Data.regions && G.Data.regions.mapIdOf) regionMap = G.Data.regions.mapIdOf(sect.region) || sect.region;
    exitsByRole.gate.push({ x0: CX - 1, x1: CX + 1, y: H - 1, to: regionMap,
      spawn: { x: CX, y: 12 }, label: '离开' + sect.n });
    plan.links.forEach(function (lk) {
      var a = lk[0], b = lk[1];
      var nBand = (a === 'hall' && LIVE_NORTH[b]) ? LIVE_NORTH[b] : { x0: CX - 1, x1: CX + 1 };
      exitsByRole[a].push({ x0: nBand.x0, x1: nBand.x1, y: 0, to: roomId(sectId, b),
        spawn: { x: CX, y: H - 2 }, label: ROOM[b].n });
      exitsByRole[b].push({ x0: CX - 1, x1: CX + 1, y: H - 1, to: roomId(sectId, a),
        spawn: { x: CX, y: 2 }, label: ROOM[a].n });
    });
    var rooms = plan.roles.map(function (role) {
      var src = null;
      full.rooms.forEach(function (r) { if (r.sectRoom === role) src = r; });
      var cp = JSON.parse(JSON.stringify(src));
      cp.exits = exitsByRole[role];
      return cp;
    });
    return { id: full.id, sectId: sectId, n: full.n, small: full.small,
      entry: full.entry, hall: full.hall, roles: plan.roles.slice(),
      rooms: rooms, links: plan.links.map(function (l) { return l.slice(); }) };
  }

  /* ===== R1：房间焦点动作分派（对接已闭环系统）===== */
  function dispatch(act, scene, o) {
    var save = G.game.save;
    var sid = scene.mapId.split('.')[1];
    if (act === 'sect.gate') {
      if (save.cult === 'sect' && save.sectId === sid) { G.game.toast('你已在本门'); return; }
      if (save.cultSwitchUsed) { G.game.toast('此世已改换门庭一次，来世再议'); return; }
      if (!G.Player.trialReady(save)) { G.game.toast('修为不足（需炼气一重初期），先去历练'); return; }
      scene.clearOverlay();
      G.game.changeScene('battle', { script: 'sectTrial', mapId: scene.mapId, sectId: sid });
      return;
    }
    if (act === 'secthall' || act === 'sect.exchange') {
      scene.sectTab = 'sect'; scene.sectView = null;
      G.Overlays.openPanel(scene, 'sect', true);
      return;
    }
    if (act === 'sect.shop') {
      scene.sectTab = 'sect'; scene.sectView = 'shop';
      G.Overlays.openPanel(scene, 'sect', true);
      return;
    }
    if (act === 'sect.fields') {
      var fSid = scene.mapId.split('.')[1];
      var fSect = G.Data.sects.byId(fSid);
      var fWorld = fSect ? fSect.world : 'fan';
      var fLabel = (o && o.label) || '';
      var fCats = fLabel === '矿脉' ? ['ore'] : fLabel === '灵田' ? ['herb', 'wood'] : ['herb'];
      G.Gather.harvestPlot(G.game.save, o && o.id, fCats, fWorld);
      return;
    }
    G.game.toast('没什么可做的');
  }

  /* ===== R1：逐房间场景工厂（惰性、幂等）===== */
  function sceneFor(roomMapId) {
    if (G.scenes[roomMapId]) return G.scenes[roomMapId];
    var sc = G.Explore.create(roomMapId, {
      menu: function (s) { G.TianDao.openSettings(s); },
      overlayTap: G.TianDao.overlayTap,
      overlayKey: G.TianDao.overlayKey,
      onInteract: function (o, s) { if (o && o.type === 'furn') dispatch(o.act, s, o); },
      onNpc: function (n, s) { dispatch(n.act, s); },
      renderOverlay: function (x, s) { G.Overlays.route(x, s); }
    });
    G.scenes[roomMapId] = sc;
    return sc;
  }

  G.SectGen = { build: build, of: of, liveOf: liveOf, sceneFor: sceneFor,
    roomId: roomId, masterGl: masterGl, roomTemplates: ROOM, LIVE: LIVE, _cache: cache };
})();
