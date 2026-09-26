/* 运行时地图生成：地面、碰撞、结构渲染信息、散布装饰、交互点（由世界种子复现） */
(function () {
  function hashStr(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function buildMap(save, mapId) {
    var md = G.Data.maps[mapId];
    var w = md.w, h = md.h;
    var rng = new G.RNG(hashStr(save.worldSeed + ':' + mapId));

    var solid = [], ground = [];
    for (var y = 0; y < h; y++) {
      solid[y] = []; ground[y] = [];
      for (var x = 0; x < w; x++) {
        solid[y][x] = false;
        ground[y][x] = { t: md.ground, v: rng.int(0, 5) };
      }
    }
    var occupied = {};
    function mark(x, y) { occupied[x + ',' + y] = true; }
    function isMarked(x, y) { return !!occupied[x + ',' + y]; }

    var decor = [];
    function addDecor(t, x, y, solid_) {
      decor.push({ t: t, x: x, y: y });
      if (solid_) solid[y][x] = true;
      mark(x, y);
    }

    /* 出入口必须先算：室内图的门洞就开在边界墙上，
       边界围合时要跳过这些格子，否则门会被墙堵死。 */
    var exitCells = {};
    (md.exits || []).forEach(function (e) {
      for (var xx = e.x0; xx <= e.x1; xx++) exitCells[xx + ',' + e.y] = e;
    });

    /* 边界围合（室内用砖墙，野外用树/石）。bloodcave 是 cave 的换色变体 → 同样用岩壁。 */
    var isCave = md.ground === 'cave' || md.ground === 'bloodcave';
    var borderDecor = md.indoor ? 'wall'
      : (isCave ? 'wallrock' : (md.ground === 'grass' ? 'tree' : 'rock'));
    for (var bx = 0; bx < w; bx++) {
      [0, h - 1].forEach(function (by) {
        if (exitCells[bx + ',' + by]) return;
        solid[by][bx] = true; mark(bx, by);
        decor.push({ t: borderDecor, x: bx, y: by });
      });
    }
    for (var by2 = 1; by2 < h - 1; by2++) {
      [0, w - 1].forEach(function (bxx) {
        if (exitCells[bxx + ',' + by2]) return;
        solid[by2][bxx] = true; mark(bxx, by2);
        decor.push({ t: borderDecor, x: bxx, y: by2 });
      });
    }

    /* 道路 */
    (md.paths || []).forEach(function (p) {
      for (var i = 0; i < p.n; i++) {
        var tx = p.kind === 'h' ? p.x + i : p.x;
        var ty = p.kind === 'h' ? p.y : p.y + i;
        if (tx < 0) continue;
        ground[ty][tx] = { t: 'path', v: rng.int(0, 5) };
      }
    });

    /* 门口补路（v0.17.0）——用户口径：「道路必须延伸到建筑的前面，必须是挨着靠近着建筑」。
       ⚠️ 顺序必须在**铺路之后**：要读 `ground` 判断门口那格是不是已经是路。
       为什么只补**门前那一格**、不硬接一条长引道：
       长引道会横穿草地与树林，看起来像凭空画出来的一条线；
       而玩家真正感知到的是"能顺着路走到门口" —— 门前有路就够了。 */
    (md.structures || []).forEach(function (s) {
      var dx = s.x + Math.floor(s.w / 2), dy = s.y + s.h;
      if (ground[dy] && ground[dy][dx] && ground[dy][dx].t !== 'path') {
        ground[dy][dx] = { t: 'path', v: rng.int(0, 5) };
      }
    });

    var interact = {};
    function setInteract(x, y, obj) { interact[x + ',' + y] = obj; }

    /* 建筑结构 */
    (md.structures || []).forEach(function (s) {
      for (var yy = s.y; yy < s.y + s.h; yy++) {
        for (var xx = s.x; xx < s.x + s.w; xx++) {
          solid[yy][xx] = true; mark(xx, yy);
        }
      }
      var doorX = s.x + Math.floor(s.w / 2);
      var doorY = s.y + s.h;
      /* 门格必须标成"已占用"：随机散布的树/石会落在未占用的空格上，
         正好压在门口就把门堵死了（区域图上门被堵 = 那栋建筑永远进不去）。 */
      mark(doorX, doorY);
      if (s.kind === 'house') {
        setInteract(doorX, doorY, { type: 'door', id: s.id });
      } else if (s.kind === 'ruin') {
        setInteract(doorX, doorY, { type: 'ruin', id: s.id });
      } else if (s.kind === 'gate') {
        setInteract(doorX, doorY, { type: 'gate', s: s });
      }
    });

    /* 围栏 */
    (md.fences || []).forEach(function (f) {
      for (var xx = f.x0; xx <= f.x1; xx++) {
        if (f.gap && xx === f.gap.x && f.y0 === f.gap.y) continue;
        addDecor('fence', xx, f.y0, true);
      }
      for (var yy = f.y0; yy <= f.y1; yy++) {
        if (f.gap && f.x0 === f.gap.x && yy === f.gap.y) continue;
        addDecor('fence', f.x0, yy, true);
      }
      if (f.x1 !== f.x0) for (var xx2 = f.x0; xx2 <= f.x1; xx2++) {
        if (f.gap && xx2 === f.gap.x && f.y1 === f.gap.y) continue;
        addDecor('fence', xx2, f.y1, true);
      }
      if (f.y1 !== f.y0) for (var yy2 = f.y0; yy2 <= f.y1; yy2++) {
        if (f.gap && f.x1 === f.gap.x && yy2 === f.gap.y) continue;
        addDecor('fence', f.x1, yy2, true);
      }
    });

    /* 特殊物件。scriptBattle 支持两个**字符串条件**（刻意不用函数：契约才能
       "把存档拨到那一步再建一次图"验占位，和 npc 的 condStep 同一套思路）：
         onlyFlag: {key,val} —— 只在 q.flags[key] === val 时出现（抉择 1 = kill 才追加的报复战）
         skipFlag: {key,val} —— q.flags[key] === val 时跳过（抉择 1 = spare → 阿七开门，首战免打） */
    var chests = {}, boss = null, scriptBattles = {};
    function flagIs(sp, f) {
      var fl = (save.quest && save.quest.flags) || {};
      return fl[f.key] === f.val;
    }
    /* "站旁边按交互"的物件（宝箱/Boss/入口/界门）都把交互点登记在**正下方一格**，
       玩家走到那一格的相邻格、面向它按交互（explore: _walkToInteract + _interact）。
       所以两格都得留出来：
         · (x, y+1) = 交互句柄本身 —— 它被石头占了，可达性检查会直接判"走不到"；
         · (x, y+2) = 最自然的站位（正下方），被占了玩家得绕到侧面才能交互。
       散布是随机的 → 漏掉这里就是**偶发**失败（曾表现为"dao1 界门走不到"）。 */
    function markApproach(sp) { mark(sp.x, sp.y + 1); mark(sp.x, sp.y + 2); }
    (md.special || []).filter(function (sp) {
      if (sp.onlyFlag && !flagIs(sp, sp.onlyFlag)) return false;
      if (sp.skipFlag && flagIs(sp, sp.skipFlag)) return false;
      return true;
    }).forEach(function (sp) {
      if (sp.kind === 'well') { addDecor('well', sp.x, sp.y, true); }
      else if (sp.kind === 'chest') {
        solid[sp.y][sp.x] = true; mark(sp.x, sp.y); markApproach(sp);
        chests[sp.id] = sp;
        setInteract(sp.x, sp.y + 1, { type: 'chest', id: sp.id });
      } else if (sp.kind === 'boss') {
        solid[sp.y][sp.x] = true; mark(sp.x, sp.y); markApproach(sp);
        boss = sp;
        /* id 必须带上：一张图可能有多个 boss 物件（或场景要按 id 分派不同剧情），
           不带 id 时场景只能"看到有个 boss"、分不出是谁。 */
        setInteract(sp.x, sp.y + 1, { type: 'boss', id: sp.id });
      } else if (sp.kind === 'scriptBattle') {
        /* 剧情战斗触发格（M1 §5.1 血煞据点）：与 chest/boss 的"站旁边按交互"不同，
           这里是**走到格子上即开战**（暗关，无暗雷、无宝箱）。
           所以**不设实心、不登记 interact** —— 它必须是一格能走上去的地面。
           但**必须 mark**：mark 只登记"这格被占了"、不影响可通行，而 scatter 正是
           靠它避开随机散布 —— 不 mark 的话石头会压在触发格上把它变实心，
           触发点**静默失效**（玩家走到那格前面就被挡住，永远不会开战）。
           触发在 explore.js: _onEnterTile（和出入口同一处裁决点）。 */
        mark(sp.x, sp.y);
        scriptBattles[sp.x + ',' + sp.y] = sp;
      } else if (sp.kind === 'entrance') {
        /* 副本入口（秘境裂隙）：占格实心，交互点登记在正下方一格，
           与 chest/boss 同一套"站到旁边才能触发"的走位约定。 */
        solid[sp.y][sp.x] = true; mark(sp.x, sp.y); markApproach(sp);
        setInteract(sp.x, sp.y + 1, { type: 'entrance', id: sp.id, slot: sp.slot, arch: sp.arch });
      } else if (sp.kind === 'worldgate') {
        /* 界门：往返已解锁的界（设计 v1.1 §2.3）。同样占格实心、交互点在正下方一格。 */
        solid[sp.y][sp.x] = true; mark(sp.x, sp.y); markApproach(sp);
        setInteract(sp.x, sp.y + 1, { type: 'worldgate', id: sp.id });
      }
    });

    /* 室内家具：占格全部设为实心，并逐格登记交互点 ——
       这样从任意一侧站着面对家具都能触发，点击家具本身也能走过去。 */
    (md.furn || []).forEach(function (f) {
      var fw = f.w || 1, fh = f.h || 1;
      var obj = { type: 'furn', id: f.id, act: f.act, label: f.label };
      for (var fy = f.y; fy < f.y + fh; fy++) {
        for (var fx = f.x; fx < f.x + fw; fx++) {
          if (fx < 0 || fy < 0 || fx >= w || fy >= h) continue;
          solid[fy][fx] = true; mark(fx, fy);
          setInteract(fx, fy, obj);
        }
      }
    });

    /* 站桩 NPC：占格设实心（不可穿过），并在**自己这一格**登记交互点 ——
       这样"面对他"和"直接点他"两条路都能走位到相邻格再开口说话。
       必须在随机散布之前处理：否则树/石可能正好落在他脚下，把人埋了。 */
    /* condStep 不匹配时该 NPC 这一趟不出现（例：外堂探子只在 m1-2 期间站在镇上）。
       buildMap 每次 enter 都重建，所以任务一推进，下一次进图就生效，不需要额外的增删逻辑。
       过滤必须**在散布之前**：否则不出现的 NPC 也会占格、把树挡在他本该站的位置。 */
    var npcs = (md.npcs || []).filter(function (n) {
      return !n.condStep || (save.quest && save.quest.step === n.condStep);
    });
    npcs.forEach(function (n) {
      solid[n.y][n.x] = true; mark(n.x, n.y);
      setInteract(n.x, n.y, { type: 'npc', npc: n, id: n.id, act: n.act });
    });

    /* 随机散布 */
    var sc = md.scatter || {};
    function scatterN(t, n) {
      var placed = 0, tries = 0;
      while (placed < n && tries < n * 60) {
        tries++;
        var tx = rng.int(1, w - 2), ty = rng.int(1, h - 2);
        if (isMarked(tx, ty)) continue;
        if (ground[ty][tx].t === 'path') continue;
        addDecor(t, tx, ty, true);
        placed++;
      }
    }
    if (sc.trees) scatterN('tree', sc.trees);
    if (sc.rocks) scatterN('rock', sc.rocks);

    return {
      md: md, w: w, h: h, solid: solid, ground: ground,
      decor: decor, interact: interact, exitCells: exitCells,
      chests: chests, boss: boss, rng: rng, npcs: npcs, scriptBattles: scriptBattles
    };
  }

  G.MapGen = { buildMap: buildMap };
})();
