/* 区域地图生成器 —— 《逆尘》四界区域与副本落位设计 v1.0 §4.2
 *
 * 职责：
 *   1. ensure(save, regionId)：由紧凑规格**确定性**生成完整地图定义，注册进 G.Data.maps。
 *      —— mapgen.buildMap(save, mapId) 只读 G.Data.maps[mapId]，所以注册完它就能直接用，mapgen 零改动。
 *   2. sceneFor(regionId)：为生成型区域创建探索场景（惰性、幂等），并包一层 enter 前置 ensure。
 *   3. 门路由：区域内每栋建筑的门交互点 → 建筑内部 int.<regionId>.<buildingId>。
 *
 * 种子 = worldSeed + ':' + regionId，保证同一世重进区域布局完全一致。
 */
(function () {
  function hashStr(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  var OPP = { north: 'south', south: 'north', east: 'west', west: 'east' };

  /* 区域某侧的「落点」：从对侧进来时站在这里。确定性，不依赖 rng。 */
  function landingOf(r, side) {
    var w = r.w, h = r.h;
    if (side === 'north') return { x: Math.floor(w / 2), y: 1 };
    if (side === 'south') return { x: Math.floor(w / 2), y: h - 2 };
    if (side === 'west') return { x: 1, y: Math.floor(h / 2) };
    return { x: w - 2, y: Math.floor(h / 2) };
  }

  /* 出口格：开在边界墙上（mapgen 会跳过这些格不围合） */
  function exitCellOf(r, side) {
    var w = r.w, h = r.h;
    if (side === 'north') return { x: Math.floor(w / 2), y: 0 };
    if (side === 'south') return { x: Math.floor(w / 2), y: h - 1 };
    if (side === 'west') return { x: 0, y: Math.floor(h / 2) };
    return { x: w - 1, y: Math.floor(h / 2) };
  }

  /* 目标区域的落点：复用型地图用它自己的 spawn，生成型用对侧 landing */
  function targetSpawn(regionId, side) {
    var tr = G.Data.regions.byId(regionId);
    if (!tr) return { x: 1, y: 1 };
    if (tr.map) {
      var md = G.Data.maps[tr.map];
      return md && md.spawn ? { x: md.spawn.x, y: md.spawn.y } : { x: 1, y: 1 };
    }
    return landingOf(tr, OPP[side]);
  }

  /* 建筑类型 → 结构外观 kind（mapgen 只认 house/ruin/gate；
     门交互类型：house→'door'、ruin→'ruin'，两者都由本文件的场景钩子接成"进建筑内部"） */
  var RUIN_LIKE = { temple: 1, hall: 1, tower: 1 };
  function structKind(bk) { return RUIN_LIKE[bk] ? 'ruin' : 'house'; }

  /* ===== 主生成 ===== */
  function build(save, regionId) {
    var r = G.Data.regions.byId(regionId);
    if (!r) return null;
    var rng = new G.RNG(hashStr(save.worldSeed + ':' + regionId));
    var w = r.w, h = r.h;
    var cx = Math.floor(w / 2), cy = Math.floor(h / 2);

    var ground = [];
    for (var y = 0; y < h; y++) {
      ground[y] = [];
      for (var x = 0; x < w; x++) ground[y][x] = { t: r.ground, v: rng.int(0, 5) };
    }

    /* ① 出口与主干道：以 (cx,cy) 为十字枢纽，把每个出口沿对应轴连到枢纽。
          出口格用 floor(w/2)/floor(h/2)，与枢纽严格对齐，所以路径必然连得上。 */
    var exits = [];
    var roads = {};
    function road(x, y) { roads[x + ',' + y] = true; ground[y][x] = { t: 'path', v: rng.int(0, 5) }; }

    (r.exits || []).forEach(function (e) {
      var c = exitCellOf(r, e.side);
      var x0 = c.x, x1 = c.x, ey = c.y;
      if (e.side === 'north' || e.side === 'south') { x0 = Math.max(1, c.x - 1); x1 = Math.min(w - 2, c.x + 1); }
      exits.push({ x0: x0, x1: x1, y: ey, to: G.Data.regions.mapIdOf(e.to), spawn: targetSpawn(e.to, e.side), label: (G.Data.regions.byId(e.to) || {}).n || '' });
      /* 出口内侧一格 → 枢纽 */
      if (e.side === 'north') for (var yy = 1; yy <= cy; yy++) road(cx, yy);
      else if (e.side === 'south') for (var yy2 = cy; yy2 <= h - 2; yy2++) road(cx, yy2);
      else if (e.side === 'west') for (var xx = 1; xx <= cx; xx++) road(xx, cy);
      else for (var xx2 = cx; xx2 <= w - 2; xx2++) road(xx2, cy);
    });
    /* 没有出口的轴也给一小段路，保证有落脚地 */
    if (!(r.exits || []).some(function (e) { return e.side === 'north' || e.side === 'south'; })) {
      for (var vy = 1; vy <= h - 2; vy++) road(cx, vy);
    }
    if (!(r.exits || []).some(function (e) { return e.side === 'east' || e.side === 'west'; })) {
      for (var hx = 1; hx <= w - 2; hx++) road(hx, cy);
    }
    road(cx, cy);

    /* ② 建筑落位：沿路两侧依次摆，整块占位，门朝下方一格且必须可行走 */
    var structures = [], taken = {};
    function reserve(x, y, bw, bh) {
      for (var yy = y; yy < y + bh; yy++) for (var xx = x; xx < x + bw; xx++) taken[xx + ',' + yy] = true;
    }
    function isFree(x, y, bw, bh) {
      if (x < 1 || y < 1 || x + bw > w - 1 || y + bh > h - 1) return false;
      for (var yy = y; yy < y + bh; yy++) for (var xx = x; xx < x + bw; xx++) {
        if (taken[xx + ',' + yy]) return false;
        if (roads[xx + ',' + yy]) return false;              /* 不压路 */
      }
      /* 门下沿那两格必须能站人（门交互点在正下方一格） */
      var dx = x + Math.floor(bw / 2), dy = y + bh;
      if (dy > h - 2) return false;
      if (taken[dx + ',' + dy] || taken[(dx + 1) + ',' + dy]) return false;
      if (roads[dx + ',' + dy] === undefined && false) return false;
      return true;
    }

    /* ③ 连通性：建筑是随机落位的，门格可能被别的建筑围成孤岛 ——「走不到的门 = 进不去的建筑」。
          做法是**放置时就验证**：从门格沿非建筑格 BFS 到最近的道路，通就落位、不通就回滚重摆。
          比"只允许贴着路放建筑"宽松得多，荒野区域也能有自然的散落布局。 */
    var rects = [];
    function inStruct(x, y) {
      for (var i = 0; i < rects.length; i++) {
        var R = rects[i];
        if (x >= R[0] && x < R[0] + R[2] && y >= R[1] && y < R[1] + R[3]) return true;
      }
      return false;
    }
    function refreshRects() {
      rects = structures.map(function (s) { return [s.x, s.y, s.w, s.h]; });
    }
    /* 从门格铺一条路接到最近的道路；成功返回 true（失败时不留任何痕迹） */
    function carve(doorX, doorY) {
      var start = doorX + ',' + doorY;
      if (roads[start]) return true;
      var seen = {}, prev = {}, q = [[doorX, doorY]], goal = null;
      seen[start] = true;
      while (q.length && !goal) {
        var c = q.shift();
        var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var i = 0; i < 4; i++) {
          var nx = c[0] + dirs[i][0], ny = c[1] + dirs[i][1];
          if (nx < 1 || ny < 1 || nx > w - 2 || ny > h - 2) continue;
          var k = nx + ',' + ny;
          if (seen[k] || inStruct(nx, ny)) continue;
          seen[k] = true; prev[k] = c[0] + ',' + c[1];
          if (roads[k]) { goal = k; break; }
          q.push([nx, ny]);
        }
      }
      if (!goal) return false;
      var cur = goal;
      while (cur && cur !== start) {
        var p = cur.split(','), px = +p[0], py = +p[1];
        if (!roads[cur]) { ground[py][px] = { t: 'path', v: rng.int(0, 5) }; roads[cur] = true; }
        cur = prev[cur];
      }
      /* 门格本身也铺成路：门口是"踏实的落脚地"，同时让 mapgen 的随机散布绕开它 */
      ground[doorY][doorX] = { t: 'path', v: rng.int(0, 5) };
      roads[start] = true;
      return true;
    }
    function unreserve(x, y, bw, bh) {
      for (var yy = y; yy < y + bh; yy++) for (var xx = x; xx < x + bw; xx++) delete taken[xx + ',' + yy];
    }

    var list = [];
    (r.b || []).forEach(function (b) {
      var n = b.n2 || 1;
      for (var i = 0; i < n; i++) list.push({ k: b.k, n: n > 1 ? (b.n + '·' + '甲乙丙丁'[i] || b.n + (i + 1)) : b.n, w: b.w, h: b.h });
    });
    list.forEach(function (b, idx) {
      var placed = false;
      for (var t = 0; t < 900 && !placed; t++) {
        var bx = rng.int(2, w - b.w - 2), by = rng.int(2, h - b.h - 2);
        if (!isFree(bx, by, b.w, b.h)) continue;
        var id = 'b' + (idx + 1);
        var dx = bx + Math.floor(b.w / 2), dy = by + b.h;
        structures.push({ id: id, kind: structKind(b.k), bk: b.k, n: b.n, x: bx, y: by, w: b.w, h: b.h });
        reserve(bx, by, b.w, b.h);
        reserve(dx, dy, 2, 1);
        refreshRects();
        if (carve(dx, dy)) { placed = true; }
        else {                                  /* 门接不上路：整栋回滚，换个位置重摆 */
          structures.pop();
          unreserve(bx, by, b.w, b.h);
          unreserve(dx, dy, 2, 1);
          refreshRects();
        }
      }
    });

    /* ④ NPC：贴在路边（保证从出生点可达），不站路上 */
    var npcs = [];
    var npcKinds = (r.npcKinds && r.npcKinds.length) ? r.npcKinds : (r.safe ? ['villager', 'keeper', 'elder'] : ['villager']);
    var npcN = r.safe ? 4 : 2;
    for (var ni = 0; ni < npcN; ni++) {
      var done = false;
      for (var tt = 0; tt < 300 && !done; tt++) {
        var nx = rng.int(2, w - 3), ny = rng.int(2, h - 3);
        if (taken[nx + ',' + ny] || roads[nx + ',' + ny]) continue;
        /* 必须有一个正交邻居在路/已占位以外的空地，且本身紧邻路 → 可达 */
        var nearRoad = roads[(nx + 1) + ',' + ny] || roads[(nx - 1) + ',' + ny] || roads[nx + ',' + (ny + 1)] || roads[nx + ',' + (ny - 1)];
        if (!nearRoad) continue;
        var kind = npcKinds[ni % npcKinds.length];
        var nm = r.n + '·' + ({ villager: '村民', keeper: '掌柜', elder: '老者' }[kind] || '村民');
        npcs.push({ id: 'n' + (ni + 1), kind: kind, name: nm, portrait: kind === 'elder' ? 'villager' : kind,
                    x: nx, y: ny, act: 'chat.villager' });
        taken[nx + ',' + ny] = true;
        done = true;
      }
    }

    /* ⑤ 副本入口：本世被天道抽中的区域，在远离出口的空地放一个裂隙。
          入口落位**按界分桶**存 `save.entrances[world]` —— 这样"飞升上界后回访下界"
          时，下界原来的入口落位还在（每界的落位各自独立、互不覆盖）。 */
    var special = [];
    var ent = null;
    var wEnt = (save.entrances || {})[r.world] || [];
    wEnt.forEach(function (e) { if (e && e.region === regionId) ent = e; });
    if (ent) {
      for (var et = 0; et < 400 && !special.length; et++) {
        var ex = rng.int(3, w - 4), ey2 = rng.int(3, h - 4);
        if (taken[ex + ',' + ey2] || roads[ex + ',' + ey2]) continue;
        special.push({ id: 'ent' + ent.slot, kind: 'entrance', x: ex, y: ey2, slot: ent.slot, arch: ent.arch });
      }
    }

    var md = {
      id: regionId, regionId: regionId, n: r.n, label: r.n,
      w: w, h: h, ground: r.ground, safe: !!r.safe,
      zones: r.zones || [],
      structures: structures, paths: [], fences: [],
      scatter: r.safe ? { trees: 6, rocks: 2 } : (r.ground === 'cave' ? { rocks: 12 } : { trees: 14, rocks: 6 }),
      special: special, npcs: npcs, exits: exits,
      spawn: { x: cx, y: cy }
    };
    return md;
  }

  /* ===== 注册（幂等） ===== */
  function ensure(save, regionId) {
    if (!save) return null;
    var r = G.Data.regions.byId(regionId);
    if (!r) return null;
    var mapId = r.map || regionId;
    if (r.map) return G.Data.maps[mapId];          /* 复用型：现成地图 */
    if (!G.Data.maps[regionId]) G.Data.maps[regionId] = build(save, regionId);
    return G.Data.maps[regionId];
  }

  /* ===== 场景工厂（惰性、幂等） ===== */
  function sceneFor(regionId) {
    if (G.scenes[regionId]) return G.scenes[regionId];
    var hooks = {
      menu: function (s) { G.TianDao.openMenu(s); },
      overlayTap: G.TianDao.overlayTap,
      overlayKey: G.TianDao.overlayKey,
      onInteract: function (o, s) {
        var save = G.game.save;
        if (!o) return;
        /* 建筑门 → 内部 */
        if (o.type === 'door' || o.type === 'ruin') {
          var md = G.Data.maps[regionId];
          var st = null;
          (md.structures || []).forEach(function (x) { if (x.id === o.id) st = x; });
          if (!st) return;
          var iid = 'int.' + regionId + '.' + st.id;
          var imd = G.InteriorGen ? G.InteriorGen.ensure(save, iid, st, G.Data.regions.byId(regionId)) : null;
          if (!imd) { G.game.toast('门锁着，推不开'); return; }
          s._transition({ to: iid, spawn: imd.spawn });
          return;
        }
        /* 副本入口 → 秘境面板 */
        if (o.type === 'entrance') {
          G.game.changeScene('dungeon', { entrance: { slot: o.slot, arch: o.arch, region: regionId } });
          return;
        }
      },
      renderOverlay: function (x, s) {
        if (G.TianDao.isMenuOverlay(s.overlay)) { G.TianDao.renderOverlay(x, s); return; }
        if (s.overlay === 'char') { G.Overlays.renderChar(x); }
      }
    };
    var sc = G.Explore.create(regionId, hooks);
    var baseEnter = sc.enter;
    /* buildMap 在 enter 内部立刻执行，所以必须**在进入前**把地图注册好 */
    sc.enter = function (params) {
      G.RegionGen.ensure(G.game.save, regionId);
      return baseEnter.call(this, params);
    };
    G.scenes[regionId] = sc;
    return sc;
  }

  G.RegionGen = {
    build: build,
    ensure: ensure,
    sceneFor: sceneFor,
    landingOf: landingOf,
    exitCellOf: exitCellOf,
    /* 确保某界全部生成型区域的地图已注册（切换世界/新世时调） */
    ensureWorld: function (save, worldId) {
      G.Data.regions.of(worldId).forEach(function (r) {
        if (!r.map) ensure(save, r.id);
      });
    },
    /* 把某界全部生成型区域注册成场景（供轮回/界门切换用） */
    registerWorld: function (worldId) {
      G.Data.regions.of(worldId).forEach(function (r) {
        if (!r.map) sceneFor(r.id);
      });
    }
  };
})();
