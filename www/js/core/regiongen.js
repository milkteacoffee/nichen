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
      /* 出口名牌也走 `nameOf`（v0.74.0）—— 否则出口写着"青溪镇"、点进去场景名却是
         "白鹿集"（区域名按世随机后必然分叉）。 */
      exits.push({ x0: x0, x1: x1, y: ey, to: G.Data.regions.mapIdOf(e.to), spawn: targetSpawn(e.to, e.side), label: G.Data.regions.nameOf(e.to, save) });
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
    /* 宗门山门（v0.42.0）：凡界 9 宗门的山门就建在它所在的区域里。
       走和普通建筑**同一条摆放逻辑**（保证门口接得上路），只是多带 `to`/`spawn`。 */
    if (G.Data.sectHalls) {
      G.Data.sectHalls.gatesOfRegion(regionId).forEach(function (g) {
        /* ⚠️ 必须**显式**带 `kind: 'gate'` —— `structKind('gate')` 返回的是 **'house'**
           （它只认 RUIN_LIKE 那三样，其余一律当房子），于是 mapgen 会把门格登记成
           `type:'door'`（"走进屋"）而不是 `type:'gate'`（用 `s.to` 换场景），
           山门就退化成"进去是一间普通屋子"。契约当场抓到：7 个生成型区域的山门全部没生效。
           `bk` 仍要写 'gate'（素材取图键），`kind` 才是画法/交互大类。 */
        list.push({ k: 'gate', kind: 'gate', n: g.name, w: 6, h: 3, to: g.to, spawn: { x: 15, y: 14 } });
      });
    }
    list.forEach(function (b, idx) {
      var placed = false;
      for (var t = 0; t < 900 && !placed; t++) {
        var bx = rng.int(2, w - b.w - 2), by = rng.int(2, h - b.h - 2);
        if (!isFree(bx, by, b.w, b.h)) continue;
        var id = 'b' + (idx + 1);
        var dx = bx + Math.floor(b.w / 2), dy = by + b.h;
        structures.push({ id: id, kind: b.kind || structKind(b.k), bk: b.k, n: b.n, x: bx, y: by, w: b.w, h: b.h,
          to: b.to || null, spawn: b.spawn || null });
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
    /* 区域支线（v0.93.0，用户口径「保证所有的场景地图都有支线」）：
       生成型区域的 NPC id 是动态的（n1/n2），挂不了"按 NPC id"的支线；
       所以支线改按**区域 id** 挂（`sidequests.byRegion`）。
       这里把该区域的支线**指派给第一个村民**：`npc.sq` = 支线 id。
       ⚠️ 只指派给第一个，其余保持普通闲聊 —— 满地图都是任务 NPC 会让人以为
          "野外全是任务点"，而且一条支线配一个 NPC 语义最清楚。
       ⚠️ 生成型区域没有手写 NPC，所以支线**必须**在这里接上，
          否则这 24 条支线永远没人发（静默）。 */
    var rq = (G.Data.sideQuests && G.Data.sideQuests.byRegion)
      ? G.Data.sideQuests.byRegion(regionId) : null;
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
        var npc = { id: 'n' + (ni + 1), kind: kind, name: nm,
                    portrait: kind === 'elder' ? 'villager' : kind,
                    x: nx, y: ny, act: 'chat.villager' };
        /* 第一个 NPC 兼区域支线的引路人 */
        if (ni === 0 && rq) npc.sq = rq.id;
        npcs.push(npc);
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

    /* 界门：本界首区（`gate:true`）放一座，用于往返已解锁的界（设计 v1.1 §2.3）。
       放完立刻 carve 一次，保证"站在旁边能点到、且走得过去"。 */
    if (r.gate) {
      for (var gt = 0; gt < 600; gt++) {
        var gx = rng.int(3, w - 4), gy = rng.int(3, h - 4);
        if (taken[gx + ',' + gy] || roads[gx + ',' + gy]) continue;
        var gy2 = gy + 1;
        if (taken[gx + ',' + gy2]) continue;
        special.push({ id: 'gate', kind: 'worldgate', x: gx, y: gy });
        carve(gx, gy2);
        break;
      }
    }

    /* 区域美术换皮（U7）：调色板取**区域预设**（`regions.palOf`），
       装饰物配方也按区域给；两者都没登记才退回通用兜底。 */
    var pal = G.Data.regions.palOf(regionId, save.world && save.world.pal);
    var scatter = G.Data.regions.scatterOf(regionId)
      || (r.safe ? { trees: 6, rocks: 2 }
        : (r.ground === 'cave' ? { rocks: 12 } : { trees: 14, rocks: 6 }));

    /* ⚠️ v0.95.0：装饰数量必须**随地图面积缩放**（用户截图反馈「地图放大后很空」）。
       真因：`scatter` 表里的数值是**按老尺寸（约 42×30 格）标定**的，
       而 v0.91.0 把地图整体放大到 ×1.4 → 面积 ×1.96，装饰**没跟着变**，
       密度掉到 52%（一眼看成"荒地"）。
       修法：以 `SCATTER_REF_AREA`（老尺寸基准）为 1.0，按 `本图面积 / 基准面积`
       等比放大数量 —— 这样"每格多少棵树"恒定，与地图多大无关。
       ⚠️ 用**面积比**而不是线性比：装饰是铺在二维地面上的，
          边长 ×2 时要 ×4 才保持同样观感（线性会显得越大地图越空）。
       ⚠️ 只动 `regiongen`（生成型区域）；手写城镇（town/yunzhou）的 scatter
          写在地图数据里，它们的尺寸自 v0.91.0 起就固定，不需要再乘。 */
    var SCATTER_REF_AREA = 42 * 30;       /* scatter 表的标定基准（老区域尺寸） */
    var areaK = Math.max(1, (w * h) / SCATTER_REF_AREA);
    if (areaK > 1.01) {
      var sc2 = {};
      Object.keys(scatter).forEach(function (k) {
        sc2[k] = Math.max(1, Math.round(scatter[k] * areaK));
      });
      scatter = sc2;
    }

    /* 区域名（v0.74.0）：走 `regions.nameOf` 的**唯一口** —— 场景名 / 地图节点名 /
       出口名牌都从 md.label 取，所以只要这里按世随机，三处显示自动一致。
       （用户第 24 点：「实际场景和地图名称要一致」。） */
    var rn = G.Data.regions.nameOf(regionId, save);

    var md = {
      id: regionId, regionId: regionId, n: rn, label: rn,
      tex: regionId,   /* 区域专属底图键（ground.<regionId>） */
      w: w, h: h, ground: r.ground, safe: !!r.safe,
      zones: r.zones || [],
      structures: structures, paths: [], fences: [],
      pal: pal,
      scatter: scatter,
      special: special, npcs: npcs, exits: exits,
      spawn: { x: cx, y: cy }
    };
    return md;
  }

  /* ===== 注册（幂等） ===== */
  /* ⚠️ v0.74.0：地图缓存必须**按世失效**。`G.Data.maps[regionId]` 里烘着区域名
     （`md.label` / 出口名牌 / NPC 名）与装饰散布，区域名按世随机之后，
     跨世沿用旧缓存 = 第 2 世地图上还写着第 1 世的区名。

     世代标签取 `world.seed | worldSeed` 两段：
       · `world.seed` 供区域名（regions.nameOf 的种子）—— 换世变；
       · `worldSeed` 供地图内容（build 的 rng）—— 契约里改它会重抽入口落位。
     只取一个会漏（无头契约换 worldSeed 却不清缓存 → 取到旧图的入口落位）。

     ⚠️ 判定是**逐区**的（标记挂在 md 上），**不做全局清空**。
        全局 `delete G.Data.maps[k]` 会改变别处"缓存存不存在"的前提：
        调用方普遍写 `G.Data.maps[id] || ensure(...)`（缓存优先短路），
        被我一清就会重新生成，把后续契约拿到的对象换掉（踩过：区域可见性
        差分探针静默报"落位区没有入口裂隙"）。逐区标记只影响被访问的那个区。 */
  function ensure(save, regionId) {
    if (!save) return null;
    var r = G.Data.regions.byId(regionId);
    if (!r) return null;
    var mapId = r.map || regionId;
    if (r.map) return G.Data.maps[mapId];          /* 复用型：现成地图 */
    var tag = ((save.world && save.world.seed) || 0) + '|' + (save.worldSeed || 0);
    var md = G.Data.maps[regionId];
    if (md && md._genTag === tag) return md;
    md = build(save, regionId);
    if (md) md._genTag = tag;
    G.Data.maps[regionId] = md;
    return md;
  }
  /* 供契约/测试显式复位（清掉全部生成型的世代标记 → 下次访问强制重建）。
     ⚠️ 只清标记、**不删对象**；确实要丢弃对象时由调用方自行备份还原。 */
  function resetGen() {
    Object.keys(G.Data.maps).forEach(function (k) {
      if (G.Data.regions.byId(k) && G.Data.maps[k]) delete G.Data.maps[k]._genTag;
      if (k.indexOf('int.') === 0 && G.Data.maps[k]) delete G.Data.maps[k]._genTag;
    });
  }

  /* ===== 场景工厂（惰性、幂等） ===== */
  function sceneFor(regionId) {
    if (G.scenes[regionId]) return G.scenes[regionId];
    var hooks = {
      menu: function (s) { G.TianDao.openSettings(s); },
      overlayTap: G.TianDao.overlayTap,
      overlayKey: G.TianDao.overlayKey,
      /* ⚠️ NPC 走的是 `hooks.onNpc` 而**不是** `onInteract`（见 explore._interact 的分派：
         `o.type === 'npc' && hooks.onNpc` → 命中就 return，不会再落到 onInteract）。
         上一版只注册了 onInteract，于是"点 NPC 什么都不会发生"（真驱动核验抓到）。
         这里把 NPC 单独接上：带 `sq` 的走区域支线，其余给一句环境闲聊。 */
      onNpc: function (npc, s) {
        if (!npc) return;
        var SQ = G.Data.sideQuests;
        if (npc.sq && SQ && SQ.talkById) {
          var rn = (G.Data.regions.byId(regionId) || {}).n || regionId;
          if (SQ.talkById(s, npc.sq, rn + ' · 支线', npc.portrait)) return;
        }
        /* 无支线可谈（或已做完）→ 一句区域特色的闲聊，不留白。
           ⚠️ 直接 toast 而不是开对话覆盖层：生成区域的 NPC 没有立绘资源，
             硬开 dialog 会显示占位像；toast 足够传达"理你了"。 */
        var say = (G.Data.sideQuests && npc.sq) ? '“该说的都说了。”' : '“客官，山高路远。”';
        G.game.toast((npc.name || '村民') + '　' + say);
      },
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
        /* 界门 → 往返已解锁的界 */
        if (o.type === 'worldgate') {
          G.RegionGen.openGate(s);
          return;
        }
        /* 区域支线（v0.93.0）：带 `sq` 的 NPC 优先走支线对话。
           与青溪镇/云州城**同一套流程**（`sideQuests.talk`）——
           次序也是"支线 > 闲聊"，三处一致才不会让玩家困惑。
           ⚠️ 这里不能用 `o.id` 找 giver（生成型 NPC 的 id 是动态 n1/n2），
              要用 `o.sq`（区域支线的稳定 id）。 */
        if (o.type === 'npc' && o.sq && G.Data.sideQuests && G.Data.sideQuests.talk) {
          var sqTalk = G.Data.sideQuests;
          var rname = (G.Data.regions.byId(regionId) || {}).n || regionId;
          /* 用 npcId=null 走"按支线 id 直谈"模式（见 sideQuests.talkById） */
          if (sqTalk.talkById && sqTalk.talkById(s, o.sq, rname + ' · 支线', o.portrait)) return;
        }
      },
      renderOverlay: function (x, s) {
        if (G.Overlays.route(x, s)) return;
        /* 区域支线对话（v0.93.0）：与两镇共用 `sideQuests.dialogOf` */
        if (s.overlay === 'sideq' && G.Data.sideQuests) {
          var nm2 = '当地人', md2 = G.Data.maps[regionId];
          (md2 && md2.npcs || []).forEach(function (n) {
            if (n.sq && n.sq === G.SideCur) nm2 = n.name;
          });
          var rn2 = (G.Data.regions.byId(regionId) || {}).n || regionId;
          G.Overlays.dialog(x, G.Data.sideQuests.dialogOf(G.game.save, rn2 + ' · 支线', nm2, 'villager'));
        }
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

  /* ===== 界门（设计 v1.1 §2.3）=====
     往返**已解锁**的界：当前界一眼可见，未解锁的界置灰。
     各界的首区各有一座界门（`regions.js` 里 `gate:true`）。 */
  function openGate(scene) {
    var meta = G.game.meta, save = G.game.save;
    if (!meta || !save) { G.game.toast('尚无存档'); return; }
    var pr = meta.progress || {};
    var wd = pr.worlds || {};
    var cur = G.Player.activeWorldId(meta);
    var WN = G.Data.regions.worldNames;
    var btns = [], y = 62;
    ['fan', 'ling', 'xian', 'dao'].forEach(function (w) {
      var unlocked = (w === 'fan') || !!wd[w];
      var isCur = (w === cur);
      btns.push(new G.UI.Btn({
        x: 70, y: y, w: 300, h: 26, small: true,
        variant: isCur ? 'gold' : (unlocked ? 'default' : 'ghost'),
        label: WN[w] + '　' + (isCur ? '（当前）' : (unlocked ? '可往' : '未解锁')),
        onClick: function () {
          if (isCur) { G.game.toast('已在' + WN[w]); return; }
          if (!unlocked) { G.game.toast(WN[w] + '尚未解锁（先通关前一界）'); return; }
          travelTo(meta, save, w);
        }
      }));
      y += 34;
    });
    btns.push(new G.UI.Btn({ x: 190, y: 222, w: 100, h: 24, small: true, variant: 'ghost',
      label: '返　回', onClick: function () { scene.clearOverlay(); } }));
    scene.setOverlay('worldgate', btns);
  }

  /* 界门传送：切「当前界」→ 落在该界首区的出生点。
     目标界的入口落位若还没 roll（第一次去），这里补一次。 */
  function travelTo(meta, save, worldId) {
    var first = G.Data.regions.of(worldId)[0];
    if (!first) { G.game.toast('该界暂无区域'); return; }
    ensure(save, first.id);
    var mapId = G.Data.regions.mapIdOf(first.id);
    var md = G.Data.maps[mapId];
    if (!md) { G.game.toast('目标区域加载失败'); return; }

    meta.progress = meta.progress || {};
    meta.progress.activeWorld = worldId;
    save.entrances = save.entrances || { fan: [], ling: [], xian: [], dao: [] };
    if (!save.entrances[worldId] || !save.entrances[worldId].length) {
      /* 第一次去该界：补一次落位。序列复用当世的 dungeonSet（缺口 G20）——
         否则区域裂隙与秘境枢纽会各拿一条随机序列，互相打架。 */
      save.entrances[worldId] = G.Data.regions.rollEntrances(worldId, save.worldSeed, save.dungeonSet);
    }
    save.map = mapId; save.scene = mapId;
    save.pos = { x: md.spawn.x, y: md.spawn.y };
    if (G.Storage.saveMeta) G.Storage.saveMeta(meta);
    G.Storage.saveCurrent(save);
    G.game.changeScene(mapId);
    G.game.toast('行至 ' + (G.Data.regions.worldNames[worldId] || worldId));
  }

  G.RegionGen = {
    build: build,
    ensure: ensure,
    resetGen: resetGen,
    sceneFor: sceneFor,
    openGate: openGate,
    travelTo: travelTo,
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
