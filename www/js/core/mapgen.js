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
    if (!md && mapId.indexOf('sect.') === 0 && G.SectGen && G.SectGen.liveOf) {
      var parts = mapId.split('.');
      var cluster = G.SectGen.liveOf(save, parts[1]);
      if (cluster) cluster.rooms.forEach(function (r) { if (r.id === mapId) md = r; });
    }
    if (!md) throw new Error('MapGen: 未知地图 ' + mapId);
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
    /* ===== 地形高度场（v1.4.0，用户口径「场景里没有区分道路上坡下坡」）=====
       **设计：不引入 3D，只给每格一个 `elev`（0/1/2 三档）** ——
       与《宝可梦》的 elevation、《烟雨江湖》的高度层同一个思路：
       落差**靠美术表达**（崖壁/坡道瓦片），逻辑上仍是 2D 格。
       ⚠️ **寻路完全不动**：`elev` 不参与 `solid` / `_astar` ——
          高度差不阻断通行（玩家能走上去），只影响**画出来的样子**。
          这是刻意的：把高度塞进连通性判定会牵动 A*、可达性契约与 50+ 条回归。
       ⚠️ **确定性**：用"世界种子 + 地图 id + 格子坐标"的哈希，**不用 `rng`** ——
          用 rng 会推移全局随机序列、污染所有依赖 rng 的回归基线（项目老坑）。
       ⚠️ 数据源是**已有的** `terr` 字段（plain/peak/ridge/valley/moor/cave…），
          不新造地形概念：`terr` 决定这一带"该有多起伏"，坐标哈希决定"具体哪格高"。 */
    var ELEV_AMP = {
      plain: 0, town: 0, floor: 0,        /* 平地 / 城镇 / 室内：**恒 0**（零回归） */
      valley: 1, moor: 1, marsh: 1,       /* 缓起伏 */
      ridge: 2, peak: 2, hill: 2,         /* 明显高低差 */
      cave: 1, bloodcave: 1               /* 洞窟：洞内小起伏 */
    };
    var terr = md.terr || (md.safe ? 'plain' : 'plain');
    var amp = ELEV_AMP[terr] != null ? ELEV_AMP[terr] : 0;
    /* 手写图（town/yunzhou/field/cave/bloodhall）没有 `terr` → amp=0 → 恒平地，
       **保证既有地图逐像素不变**（这是零回归的闸）。 */
    /* ⚠️ v1.7.0 **重要修正**：原来用 `hashStr(seed+':'+mapId+':e'+bx+','+by)` 直接取哈希。
       实测发现 **FNV-1a 对"末尾增量"雪崩不足** —— `by` 只改字符串最后 1~2 个字符，
       哈希值仅在小数第 3 位抖动（0.734 / 0.730 / 0.742 / 0.738），
       `Math.floor(h*3)` **恒为同一个值** → 高度场退化成**竖条纹**
       （每列从上到下高度完全相同，实测南向落差只有 5 条、东向 94 条）。
       这个缺陷从 v1.4.0 就在，**直到 v1.7.0 画东向落差时才暴露**（那时才发现
       "绝大多数落差没有视觉表达"，追下去是真因）。
       **修法**：坐标**分开**混入（不拼进字符串尾部）—— 前缀仍走 FNV，
       然后 x/y 各做一次 `Math.imul` 混合，最后跑一轮 `mix32` finals（雪崩）。
       实测：块分布真实（每 4 行一层）、档位均匀（100×100 块 → 3295/3308/3397）。 */
    function mix32(h) {
      h ^= h >>> 16; h = Math.imul(h, 2246822507);
      h ^= h >>> 13; h = Math.imul(h, 3266489909);
      h ^= h >>> 16; return h >>> 0;
    }
    function elevHash(bx, by) {
      var h = 2166136261;
      var s = save.worldSeed + ':' + mapId + ':e';
      for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
      h = Math.imul(h ^ (bx + 0x9E3779B9), 2654435761);
      h = Math.imul(h ^ (by + 0x85EBCA6B), 2246822519);
      return mix32(h) / 4294967296;
    }
    function elevAt(x, y) {
      if (amp <= 0) return 0;
      /* 三档高度的"块状"分布：先用 4×4 粗格决定大块高度，再用细坐标做边界抖动 ——
         纯逐格哈希会让相邻格高高低低像"马赛克"，人是走在**坡面**上而不是格阵上。 */
      var bx = Math.floor(x / 4), by = Math.floor(y / 4);
      var e = Math.floor(elevHash(bx, by) * (amp + 1));
      if (e > amp) e = amp;
      return e;
    }
    for (var ey = 0; ey < h; ey++) {
      for (var ex = 0; ex < w; ex++) {
        var ev = elevAt(ex, ey);
        if (ev) ground[ey][ex].elev = ev;      /* 0 不写字段（省内存，且"没有=平地"） */
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

    /* ⚠️ 出口格与它**内侧那一格**必须登记为"已占用"（v0.42.0）：
       随机散布的树/石只避开 `mark` 过的格子 —— 而出口这一侧以前**漏了 mark**
       （门格 `mark(doorX, doorY)` 有、出口没有），于是树可以长在出口**里面那一格**，
       把出口整个封死 → 可达性契约报「出口 (0,12) → fan5 从出生点走不到」。
       表现是**偶发**且极难查：加/挪一个建筑会改变 rng 流 → 散落位置随之变化，
       于是"昨天还走得到的出口"今天被一棵树封死，而代码里看不出任何关联。 */
    (md.exits || []).forEach(function (e) {
      for (var xx = e.x0; xx <= e.x1; xx++) {
        mark(xx, e.y);
        var ix = xx, iy = e.y;
        if (e.y === 0) iy = 1;
        else if (e.y === h - 1) iy = h - 2;
        else if (xx === 0) ix = 1;
        else if (xx === w - 1) ix = w - 2;
        mark(ix, iy);
      }
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

    /* ===== 门口路接入主路网（v1.9.5）=====
       ⚠️ **铺路不许用随机数**（本项目铁律，本轮踩了）：
          最初用随机数取路面变体 → **推移了全局随机序列** →
          后续所有依赖它的生成（散布/明雷/暗雷候选/宝箱位…）全部改变，
          实测把 `dao5` 的 spawn 变成了实心格。
          改用**坐标哈希** `pathV`：确定、可复现、且与随机流解耦
          （与 `elevAt` 的坐标哈希同一纪律）。
       ⚠️ 源码闸 `road.connect.contract` 会扫这段代码里有没有随机数调用 ——
          所以注释里也**不要写那个函数名**（闸门会把你自己的说明文字当违规）。 */
    function pathV(x, y) {
      return hashStr(mapId + ':pv' + x + ',' + y) % 6;
    }
    (function connectDoorRoads() {
      var w2 = md.w, h2 = md.h;
      var isPath = function (x, y) {
        return ground[y] && ground[y][x] && ground[y][x].t === 'path';
      };
      /* 建筑占格表（BFS 不能穿） */
      var blockedByStruct = {};
      (md.structures || []).forEach(function (s) {
        for (var yy = s.y; yy < s.y + s.h; yy++) {
          for (var xx = s.x; xx < s.x + s.w; xx++) blockedByStruct[xx + ',' + yy] = 1;
        }
      });
      /* 主路网 = 从"最大的一段路"开始（避免把孤立门格当成主路基准）。
         做法：先扫出所有路格，取其中一个、洪泛标记；若还有没标记的路格，
         说明存在多个分量 —— 只需保证"门格能到**最大分量**"即可。 */
      var mainSeed = null, best = -1;
      var comp = {};
      for (var yy2 = 1; yy2 < h2 - 1; yy2++) {
        for (var xx2 = 1; xx2 < w2 - 1; xx2++) {
          if (!isPath(xx2, yy2) || comp[xx2 + ',' + yy2]) continue;
          /* 洪泛这一片 */
          var seen2 = {}, q2 = [[xx2, yy2]], cnt = 0;
          seen2[xx2 + ',' + yy2] = 1;
          while (q2.length) {
            var c2 = q2.shift(); cnt++;
            var d2 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (var i2 = 0; i2 < 4; i2++) {
              var nx2 = c2[0] + d2[i2][0], ny2 = c2[1] + d2[i2][1];
              var k2 = nx2 + ',' + ny2;
              if (seen2[k2] || !isPath(nx2, ny2)) continue;
              seen2[k2] = 1; q2.push([nx2, ny2]);
            }
          }
          for (var kk in seen2) comp[kk] = 1;
          if (cnt > best) { best = cnt; mainSeed = [xx2, yy2]; }
        }
      }
      if (!mainSeed) return;                     /* 全图没路：无基准可接，跳过 */
      /* 主路网标记（从最大分量洪泛） */
      var mainRoad = {}, qm = [mainSeed];
      mainRoad[mainSeed[0] + ',' + mainSeed[1]] = 1;
      while (qm.length) {
        var cm = qm.shift();
        var dm = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var im = 0; im < 4; im++) {
          var nxm = cm[0] + dm[im][0], nym = cm[1] + dm[im][1];
          var km = nxm + ',' + nym;
          if (mainRoad[km] || !isPath(nxm, nym)) continue;
          mainRoad[km] = 1; qm.push([nxm, nym]);
        }
      }
      /* 每个门格：不在主路网 → BFS 到主路网，沿途铺路 */
      var doors = [];
      (md.structures || []).forEach(function (s) {
        var dx = s.x + Math.floor(s.w / 2), dy = s.y + s.h;
        if (dy < h2 && dx < w2 && dy >= 0 && dx >= 0) doors.push([dx, dy]);
      });
      doors.forEach(function (d) {
        var dk = d[0] + ',' + d[1];
        if (mainRoad[dk]) return;                /* 已接主路网：跳过（零改动） */
        var seen3 = {}, prev3 = {}, q3 = [d], goal = null;
        seen3[dk] = 1;
        while (q3.length && !goal) {
          var c3 = q3.shift();
          var d3 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
          for (var i3 = 0; i3 < 4; i3++) {
            var nx3 = c3[0] + d3[i3][0], ny3 = c3[1] + d3[i3][1];
            var k3 = nx3 + ',' + ny3;
            if (nx3 < 1 || ny3 < 1 || nx3 > w2 - 2 || ny3 > h2 - 2) continue;
            if (seen3[k3]) continue;
            if (mainRoad[k3]) { seen3[k3] = 1; prev3[k3] = c3; goal = [nx3, ny3]; break; }
            /* 不许穿建筑（但**门格自己**是起点，不在建筑内） */
            if (blockedByStruct[k3] && k3 !== dk) continue;
            seen3[k3] = 1; prev3[k3] = c3; q3.push([nx3, ny3]);
          }
        }
        if (!goal) return;                       /* 走不到主路：放弃（别硬铺出断头路） */
        /* 回溯铺路 */
        var cur3 = goal;
        while (cur3 && (cur3[0] + ',' + cur3[1]) !== dk) {
          var cx3 = cur3[0], cy3 = cur3[1];
          if (!isPath(cx3, cy3)) {
            ground[cy3][cx3] = { t: 'path', v: pathV(cx3, cy3) };
          }
          /* ⚠️ **必须同时 `mark`**：`occupied` 是"别在此处放东西"的表，
             mapgen 后面若干步（灵脉/宝箱/野怪/散布…）都会读它。
             漏 mark → 铺出来的路会被后续散布占住（实测 dao5 的 spawn 变实心）。 */
          mark(cx3, cy3);
          mainRoad[cx3 + ',' + cy3] = 1;
          cur3 = prev3[cx3 + ',' + cy3];
        }
        /* 门格本身也铺成路（它可能是草地） */
        if (ground[d[1]] && ground[d[1]][d[0]] && ground[d[1]][d[0]].t !== 'path') {
          ground[d[1]][d[0]] = { t: 'path', v: pathV(d[0], d[1]) };
        }
        mark(d[0], d[1]);
        mainRoad[dk] = 1;
      });
    })();

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
      if (sp.kind === 'well') { solid[sp.y][sp.x] = true; mark(sp.x, sp.y); }  /* 井改手绘 special(_drawWellSpecial)，不挂程序化 decor */
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

    /* ===== 关键点连通路（v1.9.5）=====
       用户口径：「所有的地图都要有单独的一条小路，可以通往所有的建筑或者副本，
                全面对标《烟雨江湖》」。
       ⚠️ **缺口（实测）**：室内图（town_shop / town_home）与洞窟图（cave / bloodhall）
          **完全没有路**（`md.paths` 为空、也非 `regiongen` 生成型）。
          玩家在"药铺里"没有任何路径线索，不知道柜台/宝箱/出口在哪 ——
          与「通往所有建筑或副本」的目标不符。
       **做法**：从**出生点**出发，对每个"关键点"铺一条最短小路：
         · 关键点 = 交互格（NPC / 宝箱 / Boss / 出口传送阵）+ 各出口的落点
         · 用**四邻 BFS**（不穿 solid），沿途铺 `path`
         · 已在路上的点跳过（零改动）
       ⚠️ **只铺"最短连接"**，不做全图铺路：洞窟里"有一条踩出来的路"才对，
          满屏路会像铺装广场（出戏）。
       ⚠️ **不消耗 `rng`**（用 `pathV` 坐标哈希取变体 —— 见上面的教训）。 */
    (function connectKeyPoints() {
      var w3 = md.w, h3 = md.h;
      var isPath3 = function (x, y) {
        return ground[y] && ground[y][x] && ground[y][x].t === 'path';
      };
      /* 关键点：**按"物件"去重**，每个物件只取一个代表格 ——
         ⚠️ 一开始对**每个交互格**都铺一条，多格宽的建筑会产生一串相邻目标 →
            绕出"U 形路"（实测 town 的药铺门口铺成一大块绿地毯，完全不像小路）。
         现在：同类相邻目标只保留一个（用 visited 标记），且优先取**正下方**那格。 */
      var goals = [];
      var taken2 = {};
      for (var ik in interact) {
        var q = ik.split(',');
        var gx = +q[0], gy = +q[1] + 1;
        var gk2 = gx + ',' + gy;
        if (taken2[gk2]) continue;
        taken2[gk2] = 1;
        goals.push([gx, gy]);
      }
      (md.exits || []).forEach(function (e) {
        var mx = Math.floor((e.x0 + e.x1) / 2);
        var ek = mx + ',' + e.y;
        if (taken2[ek]) return;
        taken2[ek] = 1;
        goals.push([mx, e.y]);
      });
      /* ⚠️ **目标去重**：多个目标若互相相邻（同一栋楼的几个门），
         只留一个，避免"同一片区域反复铺"成地毯。
         判据：目标两步内有另一个目标 → 后者丢弃。 */
      var uniq = [];
      goals.forEach(function (g) {
        var near = uniq.some(function (h) {
          return Math.abs(h[0] - g[0]) <= 2 && Math.abs(h[1] - g[1]) <= 2;
        });
        if (!near) uniq.push(g);
      });
      goals = uniq;
      /* 起点：spawn（没有就用地图中心） */
      var start = md.spawn ? [md.spawn.x, md.spawn.y] : [Math.floor(w3 / 2), Math.floor(h3 / 2)];
      /* 从起点洪泛一次（不穿 solid），得到"能走到的范围"与来源链 */
      var seen = {}, prev = {}, qq = [start];
      seen[start[0] + ',' + start[1]] = 1;
      var GUARD = w3 * h3 + 8;
      while (qq.length) {
        var c = qq.shift();
        var d = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var i = 0; i < 4; i++) {
          var nx = c[0] + d[i][0], ny = c[1] + d[i][1];
          var kk = nx + ',' + ny;
          if (nx < 1 || ny < 1 || nx > w3 - 2 || ny > h3 - 2) continue;
          if (seen[kk]) continue;
          if (solid[ny][nx]) continue;              /* 不穿墙 */
          /* ⚠️ **不穿"物件所在的格"**（NPC/宝箱/井…是 solid，已被上面拦住；
             但交互格的"下方"是空位，可走） */
          seen[kk] = 1; prev[kk] = c;
          qq.push([nx, ny]);
        }
        if (Object.keys(seen).length > GUARD) break;   /* 防御：不该发生 */
      }
      /* 起点本身若是实心（某些图 spawn 贴墙），退化为"从 spawn 的下方" */
      if (!seen[start[0] + ',' + start[1]]) {
        start = [md.spawn ? md.spawn.x : Math.floor(w3 / 2),
          Math.min(h3 - 2, (md.spawn ? md.spawn.y : Math.floor(h3 / 2)) + 1)];
        seen = {}; prev = {}; qq = [start];
        seen[start[0] + ',' + start[1]] = 1;
        while (qq.length) {
          var c2 = qq.shift();
          var d2 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
          for (var i2 = 0; i2 < 4; i2++) {
            var nx2 = c2[0] + d2[i2][0], ny2 = c2[1] + d2[i2][1];
            var k2 = nx2 + ',' + ny2;
            if (nx2 < 1 || ny2 < 1 || nx2 > w3 - 2 || ny2 > h3 - 2) continue;
            if (seen[k2] || solid[ny2][nx2]) continue;
            seen[k2] = 1; prev[k2] = c2; qq.push([nx2, ny2]);
          }
        }
      }
      /* 每个关键点：沿 BFS 来源链回溯铺路 */
      var painted = 0;
      goals.forEach(function (g) {
        var gk = g[0] + ',' + g[1];
        if (!seen[gk]) return;                      /* 走不到（被墙隔开）→ 放弃，不硬铺断头路 */
        var cur = [g[0], g[1]];
        while (cur && (cur[0] + ',' + cur[1]) !== (start[0] + ',' + start[1])) {
          var cx = cur[0], cy = cur[1];
          if (!isPath3(cx, cy) && !solid[cy][cx]) {
            ground[cy][cx] = { t: 'path', v: pathV(cx, cy) };
            mark(cx, cy);
            painted++;
          }
          cur = prev[cx + ',' + cy];
        }
      });
      /* 起点格本身也铺（玩家落脚处有路才自然） */
      if (!isPath3(start[0], start[1]) && !solid[start[1]][start[0]]) {
        ground[start[1]][start[0]] = { t: 'path', v: pathV(start[0], start[1]) };
        mark(start[0], start[1]);
        painted++;
      }
      /* ⚠️ 只在**真有缺口**时记录（便于排查），不打印（smoke 输出要清爽） */
      if (painted) md._roadPainted = painted;
    })();

    /* ===== 随机散布 =====
       ⚠️ v0.96.0：装饰数量必须补 **格子像素变大** 这一层（用户「地图放大后很空」）。

       密度 = 玩家**一屏**能看见多少棵树。而 `DECOR_SIZE`（tree 32×48）是
       **固定像素、不随 TILE 缩放**（v0.91.0 没改过它）——
       所以 TILE 从 16 提到 24 之后，屏幕可见格数从 30×17 掉到 20×11
       （少 **TILE² 倍**），装饰总数却没变 → **屏内密度只剩 1/2.25 = 44%**。
       这就是"空旷"的真正来源（不是地图格数变了 —— 格数只影响"世界多大"，
       不影响"一屏多密"）。

       ⚠️ v0.95.0 初版把补偿写在 `regiongen`、且用**格数比**（`SCATTER_REF_AREA`），
          两处都不对：
          ① 位置错 —— 手写图（maps.js）的 md 不经 regiongen，补不到；
          ② 口径错 —— 生成型区域的格数 v0.91.0 **根本没变**（只动了 maps.js），
             格数比恒为 1 → **完全是空操作**（实测 fan5 areaK=1.00）。
          且 v0.91.0 给手写图补的散数也漏了 TILE² 这一层（只补了格数比 ×1.97）。
          更细的一处：cave/bloodhall 的 scatter **完全没被 v0.91.0 动过**
          （格数涨了、装饰数还是 30/14）。

       修法（唯一口径，就在这里）：以**老基线（16px 格）的像素面积**为 1.0，
       统一乘 `(TILE/16)²`。这样两边的历史遗留各自归位：
       - 生成型区域：格数未变 → 只需这一层（×2.25）✓
       - 手写图 town/yunzhou/field：数据已含格数比 ×1.97 → 再 ×2.25 = ×4.43 ✓
       - 手写图 cave/bloodhall：数据未补 → ×2.25（格数比那层由数据另行补齐，见 maps.js）
       ⚠️ 用**面积比**而不是线性比：装饰铺在二维地面上，边长 ×1.5 要 ×2.25 才同观感。
       ⚠️ `TILE` 取 `G.Art.TILE`（唯一口径；art.js 在 mapgen 之前加载）。 */
    var sc = md.scatter || {};
    var REF_TILE = 16;                       /* 老基线格宽 */
    var TILE = (G.Art && G.Art.TILE) || 24;
    var densK = Math.max(1, (TILE * TILE) / (REF_TILE * REF_TILE));
    if (densK > 1.01) {
      var sc2 = {};
      Object.keys(sc).forEach(function (k) { sc2[k] = Math.round(sc[k] * densK); });
      sc = sc2;
    }
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

    var gatherNodes = (G.Gather && G.Gather.buildNodes)
      ? G.Gather.buildNodes(save, mapId, { md: md, w: w, h: h, solid: solid, ground: ground })
      : {};

    /* ===== 明雷（可见野怪，v0.68.0 用户第 22 点）=====
       用户原话：「这个地图是有野怪的，而且我觉得当前暗雷遇怪的情况太频繁了，
       需要改成明雷加暗雷，暗雷就是概率小一点，而且只有特定区域有暗雷，
       而不是整个地图场景随处都能遇到，比如说像草地、山地、岩石地等等这种」。
       明雷 = 地图上**站着的野怪**（看得见、可以绕着走）；暗雷 = 踩格子随机遇袭。
       两者共用 `_encounter`，所以战利品/等级/世界加成完全一致。
       ⚠️ 只在**野外**（非 safe、非 indoor）生成；安全区/室内一只都不放。 */
    var roams = [];
    if (!md.safe && !md.indoor) {
      var world = (save && save.world) || null;
      /* ⚠️ 世界种群表在 `save.world.beast`（由 `generateWorld` 从 `G.Data.xiang` 的 beast 权重写入），
         **不是** `G.Data.worlds` —— 后者根本不存在（v0.68.0 初版照 "G.Data.xxx" 的命名习惯写错，
         结果明雷一只都生成不出来、且完全静默：整个 if 分支被跳过）。 */
      var beastTbl = (world && world.beast) || null;
      var zones = md.zones || [];
      /* 明雷数量按地图面积给，但设上限 —— 大图也不至于走两步撞一只 */
      var area = w * h;
      var want = Math.max(3, Math.min(10, Math.round(area / 220)));
      var placedR = 0, triesR = 0;
      while (placedR < want && triesR < want * 80) {
        triesR++;
        var rx = rng.int(2, w - 3), ry = rng.int(2, h - 3);
        if (isMarked(rx, ry)) continue;
        if (solid[ry][rx]) continue;
        /* 不占出口、不堵门（门口那格已被 mark，这里再兜一道） */
        if (exitCells[rx + ',' + ry]) continue;
        if (interact[rx + ',' + ry]) continue;
        /* 地形限制：只在**草地/山地/岩石地/荒漠/沼泽**这类"野地"上生成，
           路面 / 室内砖地 / 大厅地面不放（用户在过道里看到野怪会很出戏）。 */
        var gt = ground[ry][rx].t;
        if (ROAM_FORBID[gt]) continue;
        /* 等级取**该格所属分区**的区间 —— 与暗雷 `_zone(y)` 同一口径。
           ⚠️ 不能用 zones[0]：翠微山前坡 5–16、后山 17–32，全按 zones[0] 取
              会让后山站着一群 Lv5 的杂鱼（或反过来前坡出现 Lv32）。
              契约 `roam.contract` 正是拿这个漂移抓住初版的。 */
        var zr = null;
        for (var zi = 0; zi < zones.length; zi++) {
          if (ry >= zones[zi].y0 && ry <= zones[zi].y1) { zr = zones[zi]; break; }
        }
        if (!zr && zones.length) zr = zones[0];
        var lv = zr ? rng.int(zr.enc.min, zr.enc.max) : 5;
        var sp = null;
        if (zr && zr.sp) {
          /* 分区有种群权重就按权重掷，与暗雷完全同源 */
          var pl = Object.keys(zr.sp).map(function (k) { return { k: k, w: zr.sp[k] }; });
          sp = pl[rng.int(0, pl.length - 1)].k;
        } else if (beastTbl) {
          var keys = Object.keys(beastTbl);
          if (keys.length) sp = keys[rng.int(0, keys.length - 1)];
        }
        roams.push({
          x: rx, y: ry, species: sp || '青纹蛇', lv: lv,
          /* 游荡相位：每只动画错开（纯确定性，不用 Math.random，截图才钉得住） */
          ph: (rx * 7 + ry * 13) % 100 / 100
        });
        /* 明雷**占格可通行** —— 玩家撞上去即开战，但不像 NPC 那样把人挡住。
           所以只 mark（避开树石），不设 solid。 */
        mark(rx, ry);
        placedR++;
      }
    }

    return {
      md: md, w: w, h: h, solid: solid, ground: ground,
      decor: decor, interact: interact, exitCells: exitCells,
      chests: chests, boss: boss, rng: rng, npcs: npcs, scriptBattles: scriptBattles,
      gatherNodes: gatherNodes, roams: roams
    };
  }

  /* 明雷禁放地形：路面/室内地面/石厅 —— 这些都是"人走的路"，不该站野怪。
     其余（grass / cave / sand / snow / marsh / lava …）都算野地，可以放。 */
  var ROAM_FORBID = { path: 1, floor: 1, town: 1 };

  /* 地形口径**唯一来源**：明雷生成（上面）与暗雷触发（explore.js）都读它。
     改成两处各写一份 'path' 判断，就会出现"明雷不放路面、暗雷还是能在路面踩中"的错配。 */
  G.MapGen = { buildMap: buildMap, ROAM_FORBID: ROAM_FORBID };
})();
