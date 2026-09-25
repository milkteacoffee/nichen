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

    /* 边界围合（室内用砖墙，野外用树/石） */
    var borderDecor = md.indoor ? 'wall'
      : (md.ground === 'cave' ? 'wallrock' : (md.ground === 'grass' ? 'tree' : 'rock'));
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

    /* 特殊物件 */
    var chests = {}, boss = null;
    (md.special || []).forEach(function (sp) {
      if (sp.kind === 'well') { addDecor('well', sp.x, sp.y, true); }
      else if (sp.kind === 'chest') {
        solid[sp.y][sp.x] = true; mark(sp.x, sp.y);
        chests[sp.id] = sp;
        setInteract(sp.x, sp.y + 1, { type: 'chest', id: sp.id });
      } else if (sp.kind === 'boss') {
        solid[sp.y][sp.x] = true; mark(sp.x, sp.y);
        boss = sp;
        setInteract(sp.x, sp.y + 1, { type: 'boss' });
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
      chests: chests, boss: boss, rng: rng
    };
  }

  G.MapGen = { buildMap: buildMap };
})();
