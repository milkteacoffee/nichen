/* 探索引擎 v3：俯视瓦片地图，**纯鼠标点击**操作 —— 点地走过去、点物件自动走近交互。
   镇/山/洞/室内通用。键盘方向键保留为无 UI 的辅助（方便调试与无障碍）。 */
(function () {
  var MOVE_T = 0.18;
  var MAX_PATH = 64;                      /* 寻路上限（格）：够走完 36×24 镇子的对角 */
  var HUD_H = 48;                         /* 顶栏高度：这一段不响应点地 */

  /* 资源数值压缩：超过一万用「万」。
     资源格只有 62px 宽，五行灵石中后期是五位数，不压缩就会顶到图标上。 */
  function num(n) {
    n = Math.floor(n || 0);
    if (n < 10000) return String(n);
    var v = n / 10000;
    return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + '万';
  }

  function create(mapId, hooks) {
    hooks = hooks || {};
    var scene = {
      smooth: true,
      mapId: mapId,
      map: null,
      dir: 'down',
      moving: false, from: null, to: null, mt: 0,
      walkT: 0, frame: 0,
      path: [],
      pendingAct: null,                     /* 走到位后要交互的目标格 */
      mark: null,                           /* 点击落点标记 {x,y,t} */
      steps: 0, prot: 3,
      hintT: 0,                             /* 操作提示已显示时长 */
      flash: 0, flashDir: 0,
      overlay: null,
      returning: false,
      _groundLayer: null, _groundKey: null, /* 整图地面预烘层（见 _ensureGround） */
      _indoorLayer: null, _indoorKey: null, /* 室内环境光预烘层（见 _ensureIndoor） */

      enter: function (params) {
        var save = G.game.save;
        if (!save) { G.game.changeScene('title'); return; }
        params = params || {};
        this.map = G.MapGen.buildMap(save, mapId);
        if (!save.pos || params.toSpawn) {
          save.pos = { x: this.map.md.spawn.x, y: this.map.md.spawn.y };
        }
        save.map = mapId; save.scene = mapId;
        this._fixPos(save);
        this.moving = false; this.path = []; this.pendingAct = null; this.mark = null;
        this.hintT = 0;
        this.overlay = null;
        /* 遭遇状态必须一并清空 —— 它属于"刚才那张图"。
           探索场景是**单例**，状态跨进出复用；漏掉这三行会出现一种很阴的串味：
           在 A 图踩到暗雷、闪白还没走完就离开了（走出出口/被剧情切走），
           再回 A 图时 flash/flashDir/_pending 原封不动地留着，
           进门第一帧闪白补满、当场莫名其妙进战斗。 */
        this.flash = 0; this.flashDir = 0; this._pending = null;
        if (params.returned) { this.flash = 1; this.flashDir = -1; this.prot = 3; this.steps = 0; }
        this._padButtons();
        G.Storage.saveCurrent(save);
        /* 场景钩子：进门演出之类的"一进来就发生"的事挂在这里 */
        if (hooks.enter) hooks.enter(this);
      },

      /* 右上角「菜单」是唯一的常驻按钮：其余操作全靠点击场景 */
      _padButtons: function () {
        var self = this;
        this.buttons = [];
        if (hooks.menu) {
          this.buttons.push(new G.UI.Btn({
            x: 412, y: 5, w: 60, h: 20, small: true, variant: 'ghost', label: '菜单',
            onClick: function () { hooks.menu(self); }
          }));
        }
      },

      setOverlay: function (name, btns) {
        this.overlay = name;
        this.buttons = btns || [];
      },
      /* 供调试与测试查询：某个 NPC 此刻头顶该挂什么标记（'!' / '?' / null） */
      npcMarkOf: function (npc) { return hooks.npcMark ? hooks.npcMark(npc) : null; },
      clearOverlay: function () {
        this.overlay = null;
        if (G.TianDao) G.TianDao.Field.hide();
        G.Storage.saveCurrent(G.game.save);
        this._padButtons();
      },

      /* ===== 移动 ===== */
      update: function (dt) {
        /* 寿元尽 → 坐化。年龄在战斗/打坐/突破后推进，这里统一裁决；
           切场景后 this.save 已被清空，必须立刻 return。 */
        if (G.game.checkAged && G.game.checkAged()) return;
        /* 遭遇闪白：flashDir=1 是"闪出去"（0 → 1 之后交给 _checkFlash 进战斗），
           -1 是"打完回来"（1 → 0 淡入）。
           这条推进原本整个漏了：_encounter 只把 flash 置 0、flashDir 置 1，
           而 _checkFlash 要求 flash >= 1 —— 于是暗雷一踩中就是**永久卡死**：
           _pending 永远排队、onTap 因为 flashDir===1 永远 early return，
           玩家看到的就是"这个地图动不了"。回归用例见 smoke 的 encounter.enter。 */
        if (this.flashDir === 1) {
          this.flash += dt * 3.2;
          if (this.flash > 1) this.flash = 1;
          return;                     /* 闪白期间冻结操作，免得边走边打 */
        }
        if (this.flashDir === -1) {
          this.flash -= dt * 3;
          if (this.flash <= 0) { this.flash = 0; this.flashDir = 0; }
        }
        if (this.mark) { this.mark.t -= dt; if (this.mark.t <= 0) this.mark = null; }
        if (this.hintT < 20) this.hintT += dt;
        if (this.overlay) return;

        var inp = G.Input, save = G.game.save;
        var d = this._heldDir(inp);

        if (this.moving) {
          this.mt += dt / MOVE_T;
          this.walkT += dt;
          this.frame = 1 + Math.floor(this.walkT / .18) % 2;
          if (this.mt >= 1) {
            this.moving = false;
            save.pos = { x: this.to.x, y: this.to.y };
            this._onEnterTile(this.to.x, this.to.y);
          }
        }
        if (!this.moving) {
          var next = null;
          if (d) {
            this.dir = d; next = this._front(save.pos, d);
            this.path = []; this.pendingAct = null;
          } else if (this.path.length) {
            next = this.path.shift();
            this.dir = this._dirTo(save.pos, next);
          } else if (this.pendingAct) {
            /* 已走到目标旁：转向并交互（这就是"点物件自动走过去开门"的落点） */
            var a = this.pendingAct; this.pendingAct = null;
            this.dir = this._dirTo(save.pos, a);
            this._interact();
            return;
          }
          /* 边界必须夹：_front 不夹，站在最下一行再往下读 solid[h] 会直接炸 */
          if (next && next.x >= 0 && next.y >= 0 && next.x < this.map.w && next.y < this.map.h
              && !this.map.solid[next.y][next.x]) {
            this.moving = true; this.from = save.pos; this.to = next; this.mt = 0;
          }
          this.frame = 0;
        }
      },

      _front: function (p, d) {
        var v = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[d];
        return { x: p.x + v[0], y: p.y + v[1] };
      },
      _dirTo: function (a, b) {
        if (b.x > a.x) return 'right';
        if (b.x < a.x) return 'left';
        if (b.y > a.y) return 'down';
        return 'up';
      },

      /* 键盘辅助（无 UI）：鼠标点击是主操作，这里只作为调试/无障碍兜底 */
      _heldDir: function (inp) {
        var k = inp.keys;
        if (k['ArrowUp'] || k['KeyW']) return 'up';
        if (k['ArrowDown'] || k['KeyS']) return 'down';
        if (k['ArrowLeft'] || k['KeyA']) return 'left';
        if (k['ArrowRight'] || k['KeyD']) return 'right';
        return null;
      },

      _onEnterTile: function (x, y) {
        var key = x + ',' + y, save = G.game.save;
        if (this.map.exitCells[key]) { this._transition(this.map.exitCells[key]); return; }
        if (this.map.md.safe) return;
        this.steps += 1;
        if (this.prot > 0) { this.prot -= 1; return; }
        var zone = this._zone(y);
        if (!zone) return;
        if (G.rng.next() < .12) this._encounter(zone);
      },

      _zone: function (ty) {
        var zones = this.map.md.zones || [];
        for (var i = 0; i < zones.length; i++) {
          if (ty >= zones[i].y0 && ty <= zones[i].y1) return zones[i];
        }
        return null;
      },

      _transition: function (e) {
        var save = G.game.save;
        save.map = e.to; save.scene = e.to;
        save.pos = { x: e.spawn.x, y: e.spawn.y };
        G.Storage.saveCurrent(save);
        /* 不要传 toSpawn：那会把出口指定的落点覆盖成地图默认出生点，
           门里门外就会差一格（旧版 town→field→town 就偏了一格）。 */
        G.game.changeScene(e.to);
      },

      /* ===== 遭遇（分区权重见灵根切片 v0.3 §11） =====
         分区权重决定"这一带以什么为主"，浮世相位的妖兽配比再叠一层调制；
         两者相乘可在保持分区差异的同时，让不同世界观的兽群构成不同。
         pair 是双只组概率：命中则出两只同种妖兽（前坡的"双蛇组"即此）。 */
      _encounter: function (zone) {
        var save = G.game.save, world = save.world;
        var list = [];
        if (zone.sp) {
          Object.keys(zone.sp).forEach(function (k) {
            var w = zone.sp[k] * ((world.beast && world.beast[k]) || 0);
            if (w > 0) list.push({ k: k, w: w });
          });
        }
        if (!list.length) {
          Object.keys(world.beast).forEach(function (k) {
            list.push({ k: k, w: world.beast[k] });
          });
        }

        var pairChance = (zone.pair || 0) / 100;
        var isPair = pairChance > 0 && G.rng.next() < pairChance;

        var units = [];
        if (isPair) {
          /* 双只组：主兽出两只（pairWith 缺省取权重最高者） */
          var pk = zone.pairWith;
          if (!pk || !zone.sp || !(pk in zone.sp)) {
            var best = null;
            list.forEach(function (it) { if (!best || it.w > best.w) best = it; });
            pk = best ? best.k : '青纹蛇';
          }
          for (var n = 0; n < 2; n++) {
            var lu = this._rollUnit(zone, pk);
            /* 双只组要能一眼分清：名字撞了就重掷，池子太小时退化为"·甲/·乙" */
            if (n === 1) {
              for (var t = 0; t < 8 && lu.name === units[0].name; t++) lu = this._rollUnit(zone, pk);
              if (lu.name === units[0].name) {
                units[0].name += '·甲';
                lu.name += '·乙';
              }
            }
            units.push(lu);
          }
        } else {
          units.push(this._rollUnit(zone, list[G.rng.weighted(list)].k));
        }

        this.flash = 0; this.flashDir = 1;
        /* unit 保留为"首只"，兼容单敌路径与既有测试 */
        this._pending = { unit: units[0], units: units };
      },

      /* 掷一只该区该物种的敌人（含等级偏移与浮世相位加成） */
      _rollUnit: function (zone, speciesKey) {
        var bias = (zone.bias && zone.bias[speciesKey]) || 0;
        var L = G.rng.int(zone.enc.min, zone.enc.max) + bias;
        var poolKey = speciesKey === '青纹蛇' ? 'snake'
          : speciesKey === '赤炎狼' ? 'wolf' : null;
        var nm = poolKey ? G.rng.pick(G.Data.namePools[poolKey]) : '树精';
        var unit = G.Data.makeEnemy(speciesKey, L, nm);
        this._applyWorldEnemy(unit);
        return unit;
      },

      _applyWorldEnemy: function (unit) {
        var we = G.Player.worldEffects(G.game.save);
        if (we.enemyMul) {
          unit.maxhp = Math.round(unit.maxhp * (1 + we.enemyMul.hp));
          unit.hp = unit.maxhp;
          unit.atk = Math.round(unit.atk * (1 + we.enemyMul.atk));
        }
      },

      _checkFlash: function () {
        if (this.flashDir === 1 && this.flash >= 1 && this._pending) {
          var p = this._pending; this._pending = null; this.flashDir = 0; this.flash = 0;
          var units = p.units || [p.unit];
          G.game.changeScene('battle', units.length > 1
            ? { enemies: units, mapId: mapId }
            : { enemy: units[0], mapId: mapId });
        }
      },

      /* ===== 交互 ===== */
      _interact: function () {
        if (this.overlay) return;
        var save = G.game.save;
        var f = this._front(save.pos, this.dir), key = f.x + ',' + f.y;
        var o = this.map.interact[key];
        if (!o) return;
        if (o.type === 'chest') this._openChest(o);
        else if (o.type === 'gate') this._useGate(o);
        else if (o.type === 'npc' && hooks.onNpc) hooks.onNpc(o.npc, this);
        else if (hooks.onInteract) hooks.onInteract(o, this);
      },

      _openChest: function (o) {
        var save = G.game.save;
        if (save.chestsOpened.indexOf(o.id) >= 0) { G.game.toast('宝箱已空'); return; }
        var sp = this.map.chests[o.id], loot = sp.loot;
        if (loot.stone) { save.stone += loot.stone; G.game.toast('灵石 +' + loot.stone); }
        if (loot.items) Object.keys(loot.items).forEach(function (k) {
          save.items[k] = (save.items[k] || 0) + loot.items[k];
          G.game.toast(k + ' ×' + loot.items[k]);
        });
        save.chestsOpened.push(o.id);
        G.Storage.saveCurrent(save);
      },

      _useGate: function (o) {
        var save = G.game.save, s = o.s;
        if (s.need && save.globalLevel < s.need.globalLevel) {
          G.game.toast(s.closedText);
          return;
        }
        this._transition({ to: s.to, spawn: s.spawn });
      },

      /* 落点兜底：门里门外的落点可能正好被随机散布的树石占了。
         卡在实心格里会彻底动不了（点击寻路起点即非法），就近挪一格。 */
      _fixPos: function (save) {
        var p = save.pos;
        if (!p || !this.map.solid[p.y] || !this.map.solid[p.y][p.x]) return;
        for (var r = 1; r <= 6; r++) {
          for (var dy = -r; dy <= r; dy++) {
            for (var dx = -r; dx <= r; dx++) {
              if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
              var nx = p.x + dx, ny = p.y + dy;
              if (nx < 0 || ny < 0 || nx >= this.map.w || ny >= this.map.h) continue;
              if (!this.map.solid[ny][nx]) { save.pos = { x: nx, y: ny }; return; }
            }
          }
        }
      },

      /* 点地：纯鼠标操作。
         ─ 点到可交互物（门 / 破庙 / 洞口 / 宝箱 / Boss）→ 自动走到相邻可行走格并交互；
         ─ 点到可行走地面 → A* 走过去；
         ─ 点到自己脚下 → 原地交互（等价于旧版 A 键）。 */
      onTap: function (p) {
        if (this.overlay) {
          if (hooks.overlayTap) hooks.overlayTap(p, this);
          return;
        }
        if (this.flashDir === 1) return;
        if (p.y < HUD_H) return;                    /* 顶栏不响应，避免误触 HUD */
        var tx = Math.floor(this._camX() / 16 + p.x / 16);
        var ty = Math.floor(this._camY() / 16 + p.y / 16);
        if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return;

        /* ① 点到交互物：走过去再交互 */
        if (this.map.interact[tx + ',' + ty]) {
          this._walkToInteract(tx, ty);
          return;
        }
        /* ② 点到自己所在格：原地交互（面向不变） */
        var save = G.game.save;
        if (tx === save.pos.x && ty === save.pos.y) {
          this.path = []; this.pendingAct = null;
          this._interact();
          return;
        }
        /* ③ 点到实心格（房屋 / 墙 / 家具）：在附近找交互物 ——
           门的交互点其实是"房屋正下方那一格"，玩家会直接点房子本身，
           所以这里放宽到 2 格半径，点整栋房子都能进。 */
        if (this.map.solid[ty][tx]) {
          var near = this._nearInteract(tx, ty, 2);
          if (near) this._walkToInteract(near.x, near.y);
          return;
        }
        /* ④ 点地面：走过去 */
        var path = this._astar(save.pos.x, save.pos.y, tx, ty);
        if (path && path.length) {
          this.path = path;
          this.pendingAct = null;
          this.mark = { x: tx, y: ty, t: 0.55 };
        }
      },

      /* 在以 (tx,ty) 为中心、半径 r 的方框里找最近的交互点（曼哈顿距离） */
      _nearInteract: function (tx, ty, r) {
        var best = null, bd = 1e9;
        for (var dy = -r; dy <= r; dy++) {
          for (var dx = -r; dx <= r; dx++) {
            var nx = tx + dx, ny = ty + dy;
            if (nx < 0 || ny < 0 || nx >= this.map.w || ny >= this.map.h) continue;
            if (!this.map.interact[nx + ',' + ny]) continue;
            var d = Math.abs(dx) + Math.abs(dy);
            if (d < bd) { bd = d; best = { x: nx, y: ny }; }
          }
        }
        return best;
      },

      /* 走到 (tx,ty) 的某个相邻可行走格，到位后自动交互。
         相邻格可能有多个（门的左右下方都是空地），取"离玩家最近"的那个。 */
      _walkToInteract: function (tx, ty) {
        var save = G.game.save;
        var best = null;
        var dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        for (var i = 0; i < dirs.length; i++) {
          var sx = tx + dirs[i][0], sy = ty + dirs[i][1];
          if (sx < 0 || sy < 0 || sx >= this.map.w || sy >= this.map.h) continue;
          if (this.map.solid[sy][sx]) continue;
          var path = this._astar(save.pos.x, save.pos.y, sx, sy);
          if (!path) continue;
          if (!best || path.length < best.length) best = path;
        }
        if (!best) {
          /* 走不过去（被围死或太远）：仍然把标记打在目标上，给玩家反馈 */
          this.mark = { x: tx, y: ty, t: 0.55 };
          return;
        }
        this.path = best;
        this.pendingAct = { x: tx, y: ty };
        this.mark = { x: tx, y: ty, t: 0.55 };
      },

      _astar: function (sx, sy, tx, ty) {
        var solid = this.map.solid;
        var open = [{ x: sx, y: sy, g: 0, f: 0, p: null }];
        var seen = {}; seen[sx + ',' + sy] = open[0];
        var dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        while (open.length) {
          var bi = 0;
          for (var i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
          var cur = open.splice(bi, 1)[0];
          if (cur.x === tx && cur.y === ty) {
            var path = [], c = cur;
            while (c.p) { path.unshift({ x: c.x, y: c.y }); c = c.p; }
            if (path.length > MAX_PATH) return null;
            return path;
          }
          if (cur.g >= MAX_PATH) continue;
          for (var d2 = 0; d2 < 4; d2++) {
            var nx = cur.x + dirs[d2][0], ny = cur.y + dirs[d2][1];
            if (nx < 0 || ny < 0 || nx >= this.map.w || ny >= this.map.h) continue;
            if (solid[ny][nx] && !(nx === tx && ny === ty)) continue;
            var k = nx + ',' + ny;
            var g = cur.g + 1;
            if (seen[k] && seen[k].g <= g) continue;
            var node = { x: nx, y: ny, g: g,
              f: g + Math.abs(nx - tx) + Math.abs(ny - ty), p: cur };
            seen[k] = node; open.push(node);
          }
        }
        return null;
      },

      /* ===== 相机 ===== */
      _px: function () {
        var save = G.game.save;
        var x = save.pos.x, y = save.pos.y;
        if (this.moving) {
          x = this.from.x + (this.to.x - this.from.x) * this.mt;
          y = this.from.y + (this.to.y - this.from.y) * this.mt;
        }
        return { x: x * 16 + 8, y: y * 16 + 12 };
      },
      _camX: function () {
        var cx = this._px().x;
        return Math.max(0, Math.min(this.map.w * 16 - 480, cx - 240));
      },
      _camY: function () {
        var cy = this._px().y;
        return Math.max(0, Math.min(this.map.h * 16 - 272, cy - 136));
      },

      /* ===== 渲染 ===== */
      render: function (x) {
        this._checkFlash();
        var camX = this._camX(), camY = this._camY();
        var self = this;

        /* 地面：整图已预烘好，每帧只 blit 视口这一块（1 次，而不是逐格 540 次）。
           详见 _bakeGround —— 逐格从 672×672 大纹理取子块实测每帧 7.8~22.6ms，
           室内大图直接把帧率压到 30fps，是整个游戏最浪费的一处。
           这一趟仍关平滑：源层按 K 烘、目标按 S 画，K===S 时就是 1:1 像素搬运。 */
        this._drawGroundLayer(x, camX, camY);

        /* 整屏大尺度明暗（在铺地之上、建筑之下） */
        this._drawShade(x, this._baseType(), G.game.save.world.pal, camX, camY);

        /* 建筑（室内图没有 structures/special 字段，必须容错） */
        (this.map.md.structures || []).forEach(function (s) {
          self._drawStructure(x, s, camX, camY);
        });

        /* 装饰、家具、NPC 与玩家按 y 交错（家具按"最下一格"参与排序，否则会被玩家穿过去） */
        var list = this.map.decor.slice();
        (this.map.md.furn || []).forEach(function (f) {
          list.push({ furn: f, x: f.x, y: f.y + (f.h || 1) - 1 });
        });
        (this.map.npcs || []).forEach(function (n) {
          list.push({ npc: n, x: n.x, y: n.y });
        });
        var pp = this._px();
        list.push({ player: true, x: pp.x / 16, y: pp.y / 16 });
        list.sort(function (a, b) { return a.y - b.y; });
        list.forEach(function (o) {
          if (o.player) self._drawPlayer(x, camX, camY);
          else if (o.furn) self._drawFurn(x, o.furn, camX, camY);
          else if (o.npc) self._drawNpc(x, o.npc, camX, camY);
          else self._drawDecor(x, o, camX, camY);
        });

        /* 宝箱 / Boss / 秘境裂隙 / 界门 */
        (this.map.md.special || []).forEach(function (sp) {
          if (sp.kind === 'chest') self._drawChest(x, sp, camX, camY);
          if (sp.kind === 'boss') self._drawBoss(x, sp, camX, camY);
          if (sp.kind === 'entrance') self._drawEntrance(x, sp, camX, camY);
          if (sp.kind === 'worldgate') self._drawWorldgate(x, sp, camX, camY);
        });

        /* 洞窟暗幕（火把可视范围） */
        if (this.map.md.ground === 'cave') this._drawVeil(x, camX, camY);
        /* 室内：暖色环境光 + 暗角，做出"封闭空间"的收束感 */
        if (this.map.md.indoor) this._drawIndoor(x);

        this._drawHUD(x);
        this._drawInteractHint(x, camX, camY);
        this._drawMark(x, camX, camY);
        if (!this.overlay) this._drawHint(x);
        if (hooks.renderOverlay && this.overlay) hooks.renderOverlay(x, this);

        if (this.flash > 0) {
          x.fillStyle = 'rgba(255,255,255,' + Math.min(1, this.flash) * .9 + ')';
          x.fillRect(0, 0, 480, 272);
        }
        for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);
      },

      /* 地面基础类型（决定瓦片与过渡） */
      _baseType: function () {
        var g = this.map.md.ground;
        if (g === 'town') return 'town';
        if (g === 'cave') return 'cave';
        if (g === 'floor') return 'floor';
        return 'grass';
      },

      _drawFurn: function (x, f, camX, camY) {
        var px = f.x * 16 - camX, py = f.y * 16 - camY;
        var w = (f.w || 1) * 16, h = (f.h || 1) * 16;
        if (px > 480 || px + w < 0 || py > 272 || py + h < 0) return;
        var art = G.Art.furn(f.kind, G.game.save.world.pal);
        if (!art) return;
        x.drawImage(art.c, Math.round(px), Math.round(py), art.w, art.h);
      },

      /* ===== 地面预烘（分块） =====
         地面是**完全静态**的：只随地图与调色板变，相机怎么动都不影响像素内容。
         原先每帧逐格从 672×672 的大纹理里取 16×16 子块 —— 30×18=540 次 blit，
         实测每帧 7.8~22.6ms（占整帧 80%+），室内大图直接掉到 30fps。
         现在把整张地图烘成一张离屏层，每帧只 blit 视口那一块：
           · 每帧传输量正好等于视口（1.18M 设备像素），是最优解 ——
             试过按纹理周期(224=14格)分块，但块比视口小不了多少，
             边界块只有部分可见，12 块合起来要搬 5.4M 像素，反而慢 3~5 倍；
           · 烘焙内部也不逐格画：基础地面是周期纹理，"按 TS 对齐平铺"
             与"逐格取 (tx*16)%TS 子块"逐像素等价，blit 次数从整图格数
             （field 有 2000 格）降到 6 次左右，只有路格与路缘才逐格补画。 */
      _ensureGround: function () {
        var K = G.Art.K, pal = G.game.save.world.pal;
        /* key 里带上 K 与调色板：窗口缩放改了倍率、或轮回换了世界，
           旧层必须作废，否则会残留错误倍率/配色的地面。 */
        var key = this.mapId + '|' + K + '|' + pal.ground + '|' + pal.rock;
        if (this._groundLayer && this._groundKey === key) return;
        var m = this.map;
        var w = m.w * 16, h = m.h * 16;
        var c = document.createElement('canvas');
        c.width = Math.round(w * K); c.height = Math.round(h * K);
        var g = c.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.setTransform(K, 0, 0, K, 0, 0);

        /* 1) 基础地面：整张周期纹理按 TS 对齐平铺（超出画布的部分自动裁掉） */
        var TS = G.Art.GROUND_TS;
        var base = G.Art.groundTex(this._baseType(), pal);
        for (var oy = 0; oy < h; oy += TS)
          for (var ox = 0; ox < w; ox += TS)
            g.drawImage(base, ox, oy, TS, TS);

        /* 2) 路格与路缘：只占少数格子，逐格补画 */
        for (var ty = 0; ty < m.h; ty++)
          for (var tx = 0; tx < m.w; tx++)
            if (m.ground[ty][tx].t === 'path') this._drawPathTile(g, tx, ty);

        this._groundLayer = c;
        this._groundKey = key;
      },

      /* 每帧的地面：从预烘好的整图层里取视口这一块（1 次 blit） */
      _drawGroundLayer: function (x, camX, camY) {
        this._ensureGround();
        x.imageSmoothingEnabled = false;
        if (this._groundLayer) {
          var gk = G.Art.K;
          x.drawImage(this._groundLayer,
            Math.round(camX * gk), Math.round(camY * gk),
            Math.round(480 * gk), Math.round(272 * gk),
            0, 0, 480, 272);
        }
        x.imageSmoothingEnabled = !!this.smooth;
      },

      /* 单个路格：路面纹理块 + 与基础地面交界处的路缘镶边。
         只在预烘地面层时调用一次（路格是少数，基础地面走平铺）。 */
      _drawPathTile: function (x, tx, ty) {
        var m = this.map, pal = G.game.save.world.pal;
        var px = tx * 16, py = ty * 16;

        /* 从 224×224 周期大纹理里按"世界坐标"取 16×16 子块 ——
           与基础地面的平铺取到的是同一个位置，接缝处完全连续。 */
        var TS = G.Art.GROUND_TS;
        var sx = ((tx * 16) % TS + TS) % TS;
        var sy = ((ty * 16) % TS + TS) % TS;
        G.Art.groundBlit(x, 'path', pal, sx, sy, px, py);

        /* 路缘过渡：只在这一格不与另一格路面相邻的那些边上画 */
        var mask = 0;
        if (ty === 0 || m.ground[ty - 1][tx].t !== 'path') mask |= 1;
        if (tx === m.w - 1 || m.ground[ty][tx + 1].t !== 'path') mask |= 2;
        if (ty === m.h - 1 || m.ground[ty + 1][tx].t !== 'path') mask |= 4;
        if (tx === 0 || m.ground[ty][tx - 1].t !== 'path') mask |= 8;
        var fr = G.Art.fringe(mask, 'path', this._baseType(), pal);
        if (fr) x.drawImage(fr, px, py, 16, 16);
      },

      /* 大尺度明暗：整屏一层平滑起伏，1:1 平铺（不缩放，避免边缘钳制出直缝）。
         逐格 fillRect 叠明暗会在 16px 网格上留下方块补丁。 */
      _drawShade: function (x, kind, pal, camX, camY) {
        if (kind === 'cave' || kind === 'floor') return;
        var SP = G.Art.GROUND_TS;
        var sc = G.Art.shadeTex(kind, pal);
        var ox = -(((camX % SP) + SP) % SP), oy = -(((camY % SP) + SP) % SP);
        for (var yy = oy; yy < 272; yy += SP)
          for (var xx = ox; xx < 480; xx += SP)
            x.drawImage(sc, Math.round(xx), Math.round(yy), SP, SP);
      },

      _drawStructure: function (x, s, camX, camY) {
        var px = s.x * 16 - camX, py = s.y * 16 - camY;
        if (px > 480 || px + s.w * 16 < 0 || py > 272 || py + s.h * 16 < 0) return;
        var pal = G.game.save.world.pal;
        var art = s.kind === 'house' ? G.Art.house(s, pal)
          : s.kind === 'ruin' ? G.Art.ruin(s, pal)
            : s.kind === 'gate' ? G.Art.gate(s, pal) : null;
        if (!art) return;
        G.Art.blit(x, art, px, py);
      },

      _drawDecor: function (x, o, camX, camY) {
        var px = o.x * 16 - camX, py = o.y * 16 - camY;
        var h1 = (((o.x * 73856093) ^ (o.y * 19349663)) >>> 0);
        var v = (h1 % 3 + 3) % 3;
        /* 缩放走 3 档预烘（见 A.decorScaled）：同一变体在每个位置都一模一样，
           一眼就是复制粘贴，所以按位置给一点缩放与水平翻转 —— 但缩放必须是
           预烘好的整数尺寸，否则每帧一次滤波缩放既费帧又糊画面。 */
        var art = G.Art.decorScaled(o.t, G.game.save.world.pal, v, h1 % 3);
        if (!art) return;
        if ((h1 >> 10) & 1) {
          var dx = Math.round(px + art.ox), dy = Math.round(py + art.oy);
          x.save();
          x.translate(dx + art.w, dy);
          x.scale(-1, 1);
          x.drawImage(art.c, 0, 0, art.w, art.h);
          x.restore();
        } else {
          G.Art.blit(x, art, px, py);
        }
      },

      _drawChest: function (x, sp, camX, camY) {
        var opened = G.game.save.chestsOpened.indexOf(sp.id) >= 0;
        var px = sp.x * 16 - camX, py = sp.y * 16 - camY;
        var art = G.Art.chest(opened);
        G.Art.blit(x, art, px, py);
      },

      _drawBoss: function (x, sp, camX, camY) {
        var px = sp.x * 16 - camX, py = sp.y * 16 - camY;
        var art = G.Art.boss(G.game.save.world.pal);
        G.Art.blit(x, art, px, py);
        /* 脉动血光 */
        var t = performance.now() / 700;
        x.fillStyle = 'rgba(224,74,60,' + (0.10 + 0.07 * Math.sin(t)) + ')';
        x.beginPath();
        x.ellipse(px + 8, py + 8, 15, 12, 0, 0, 6.2832);
        x.fill();
      },

      /* 秘境裂隙（区域副本入口）：紫雾脉动 + 裂口。
         它同时承担"这里有一处秘境"的信息量，所以光环比物件本身更醒目。 */
      _drawEntrance: function (x, sp, camX, camY) {
        var px = sp.x * 16 - camX, py = sp.y * 16 - camY;
        var t = performance.now() / 620;
        x.save();
        x.fillStyle = 'rgba(168,116,236,' + (0.12 + 0.09 * Math.sin(t)).toFixed(3) + ')';
        x.beginPath();
        x.ellipse(px + 8, py + 10, 17, 14, 0, 0, 6.2832);
        x.fill();
        x.restore();
        G.Art.blit(x, G.Art.rift(), px, py);
      },

      /* 界门（四界往返）：蓝色光晕脉动 + 石拱光幕 */
      _drawWorldgate: function (x, sp, camX, camY) {
        var px = sp.x * 16 - camX, py = sp.y * 16 - camY;
        var t = performance.now() / 900;
        x.save();
        x.fillStyle = 'rgba(132,182,255,' + (0.10 + 0.07 * Math.sin(t)).toFixed(3) + ')';
        x.beginPath();
        x.ellipse(px + 8, py + 4, 14, 16, 0, 0, 6.2832);
        x.fill();
        x.restore();
        G.Art.blit(x, G.Art.worldgate(), px, py);
      },

      _drawVeil: function (x, camX, camY) {
        var pp = this._px();
        var sx = pp.x - camX, sy = pp.y - camY;
        var rg = x.createRadialGradient(sx, sy, 30, sx, sy, 160);
        rg.addColorStop(0, 'rgba(4,5,10,0)');
        rg.addColorStop(0.48, 'rgba(4,5,10,0.34)');
        rg.addColorStop(1, 'rgba(4,5,10,0.86)');
        x.fillStyle = rg;
        x.fillRect(0, 0, 480, 272);
        /* 火把暖光 */
        var wg = x.createRadialGradient(sx, sy - 4, 4, sx, sy - 4, 76);
        wg.addColorStop(0, 'rgba(255,192,112,0.16)');
        wg.addColorStop(0.55, 'rgba(255,170,90,0.06)');
        wg.addColorStop(1, 'rgba(255,170,90,0)');
        x.fillStyle = wg;
        x.fillRect(0, 0, 480, 272);
      },

      /* 室内环境光：中心偏暖，四周压暗；比野外暗幕轻得多，不挡视线。
         两层渐变都是**固定几何**（中心与半径写死），所以预烘成一张整屏叠加层，
         每帧 1 次 blit 即可。原来每帧现算 2 个径向渐变 + 2 次全屏 alpha 填充
         —— S=4 时那是 2×2.09M 像素的逐像素渐变求值，室内图就是被它从 60fps
         压到 30fps 的。 */
      _ensureIndoor: function () {
        var K = G.Art.K;
        var key = 'indoor|' + K;
        if (this._indoorLayer && this._indoorKey === key) return;
        var c = document.createElement('canvas');
        c.width = Math.round(480 * K); c.height = Math.round(272 * K);
        var g = c.getContext('2d');
        g.setTransform(K, 0, 0, K, 0, 0);
        var wg = g.createRadialGradient(240, 120, 60, 240, 136, 320);
        wg.addColorStop(0, 'rgba(255,206,140,0.09)');
        wg.addColorStop(0.55, 'rgba(255,190,120,0.03)');
        wg.addColorStop(1, 'rgba(255,170,90,0)');
        g.fillStyle = wg; g.fillRect(0, 0, 480, 272);
        var vg = g.createRadialGradient(240, 130, 110, 240, 136, 310);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(1, 'rgba(18,9,4,0.46)');
        g.fillStyle = vg; g.fillRect(0, 0, 480, 272);
        this._indoorLayer = c;
        this._indoorKey = key;
      },

      _drawIndoor: function (x) {
        this._ensureIndoor();
        if (!this._indoorLayer) return;
        var K = G.Art.K;
        x.drawImage(this._indoorLayer, 0, 0, Math.round(480 * K), Math.round(272 * K),
          0, 0, 480, 272);
      },

      _drawPlayer: function (x, camX, camY) {
        var pp = this._px();
        var px = pp.x - camX, py = pp.y - camY;
        var HW = G.Sprites.HERO_W, HH = G.Sprites.HERO_H;
        /* 落地投影：跟着角色尺寸走，否则大角色会"浮"在影子上 */
        x.save();
        x.fillStyle = 'rgba(0,0,0,0.30)';
        x.beginPath();
        x.ellipse(px, py - 1, HW * 0.33, HW * 0.13, 0, 0, 6.2832);
        x.fill();
        x.restore();
        var spr = G.Sprites.heroFrames()[this.dir][this.frame];
        x.drawImage(spr, Math.round(px - HW / 2), Math.round(py + 3 - HH), HW, HH);
      },

      /* 站桩 NPC：落地投影 + 待机浮动（相位按坐标错开，一排人不会同频点头）。
         头顶挂任务标记（探图 v0.2 §NPC：可接 ！/ 可交 ？；无任务不显示）。 */
      _drawNpc: function (x, n, camX, camY) {
        var px = n.x * 16 - camX + 8, py = n.y * 16 - camY + 12;
        var HW = G.Sprites.HERO_W, HH = G.Sprites.HERO_H;
        var bob = Math.sin(performance.now() / 620 + n.x * 1.7 + n.y * 2.3) * 0.8;
        var top = py + 3 - HH + bob;
        x.save();
        x.fillStyle = 'rgba(0,0,0,0.28)';
        x.beginPath();
        x.ellipse(px, py - 1, HW * 0.32, HW * 0.12, 0, 0, 6.2832);
        x.fill();
        x.restore();
        x.drawImage(G.Sprites.npc(n.kind), Math.round(px - HW / 2), Math.round(top), HW, HH);
        var mk = hooks.npcMark ? hooks.npcMark(n) : null;
        if (mk) this._drawNpcMark(x, px, top - 4, mk);
      },

      /* 头顶任务标记：金/玉色 ！？，暗描边 + 上下浮动，亮地面也看得清 */
      _drawNpcMark: function (x, px, py, kind) {
        var pu = Math.sin(performance.now() / 300);
        x.save();
        x.font = G.UI.F(14);
        x.textAlign = 'center'; x.textBaseline = 'alphabetic';
        x.lineJoin = 'round'; x.lineWidth = 3.2;
        x.strokeStyle = 'rgba(6,8,14,0.85)';
        x.fillStyle = kind === '?' ? '#a8dcc4' : '#f5e3a8';
        x.strokeText(kind, px, py + pu * 1.6);
        x.fillText(kind, px, py + pu * 1.6);
        x.restore();
      },

      /* 点击落点标记：一个收束的金环，告诉玩家"我收到这一下了" */
      _drawMark: function (x, camX, camY) {
        var m = this.mark;
        if (!m) return;
        var px = m.x * 16 - camX + 8, py = m.y * 16 - camY + 8;
        var k = m.t / 0.55;                       /* 1 → 0 */
        var r = 5 + (1 - k) * 7;
        x.save();
        x.globalAlpha = Math.min(1, k * 1.6);
        x.strokeStyle = 'rgba(232,201,106,0.95)';
        x.lineWidth = 1.6;
        x.beginPath(); x.arc(px, py, r, 0, 6.2832); x.stroke();
        x.globalAlpha = Math.min(1, k * 1.6) * 0.5;
        x.beginPath(); x.arc(px, py, r * 0.45, 0, 6.2832); x.stroke();
        x.restore();
      },

      /* 可交互提示：角色正面对的格子若有交互物，浮一个脉动的小箭头。
         纯点击操作没有 A 键，必须让"这里能点"变得可见。 */
      _drawInteractHint: function (x, camX, camY) {
        if (this.overlay || this.moving) return;
        var save = G.game.save;
        var f = this._front(save.pos, this.dir);
        if (!this.map.interact[f.x + ',' + f.y]) return;
        var px = f.x * 16 - camX + 8, py = f.y * 16 - camY;
        var pu = 0.5 + 0.5 * Math.sin(performance.now() / 240);
        x.save();
        x.globalAlpha = 0.55 + 0.45 * pu;
        x.fillStyle = 'rgba(232,201,106,0.95)';
        x.beginPath();
        x.moveTo(px, py + 2);
        x.lineTo(px - 4, py - 4);
        x.lineTo(px + 4, py - 4);
        x.closePath(); x.fill();
        x.restore();
      },

      /* 当前场景名：室内图取地图自带 label（沈家小院/药铺/…），
         室外图按 mapId 取世界随机名（青溪镇/翠微山/赤牙洞）。 */
      _sceneName: function () {
        var md = this.map.md;
        if (md.label) return md.label;
        var names = G.game.save.world && G.game.save.world.names;
        if (this.mapId === 'town') return (names && names.town) || '青溪镇';
        if (this.mapId === 'field') return (names && names.mountain) || '翠微山';
        if (this.mapId === 'cave') return (names && names.cave) || '赤牙洞';
        return this.mapId;
      },

      /* ===== HUD =====
         烟雨江湖式：左上圆形头像（立绘裁圆 + 金环），右侧竖排
         「境界 · 第N世 / 气血 / 修为」，右上角是资源与菜单。
         四条硬约束，改之前先读：
         ① 数值一律排在条的**右侧**，绝不压在条上 —— 压在条上时数字和条的高光
            叠在一起，亮色地面背景直接糊成一片（旧版 155/155 就是这个问题）；
         ② 顶栏高度必须等于 HUD_H：onTap 靠它挡掉误触，画得比 HUD_H 高就会出现
            "点在 HUD 上人却动了"；
         ③ 资源三格与菜单各占一块固定宽度，数值再长（五位数）也不会互相压字；
         ④ 头像走 G.UI.avatar，内部已经把立绘按头部裁好，这里只给圆心与半径。 */
      _drawHUD: function (x) {
        var save = G.game.save;
        var st = G.Player.computeStats(save);
        var ri = G.Player.realmInfo(save.globalLevel);
        var bs = G.Player.breakState(save);
        var t = performance.now();

        /* 背板：墨色渐隐 + 底部金线 */
        var g = x.createLinearGradient(0, 0, 0, HUD_H);
        g.addColorStop(0, 'rgba(6,8,14,0.90)');
        g.addColorStop(0.62, 'rgba(6,8,14,0.62)');
        g.addColorStop(1, 'rgba(6,8,14,0)');
        x.fillStyle = g; x.fillRect(0, 0, 480, HUD_H);
        x.fillStyle = 'rgba(216,183,104,0.26)';
        x.fillRect(0, HUD_H - 1.6, 480, 0.8);

        /* --- 左：圆形头像 --- */
        G.UI.avatar(x, 26, 24, 18, 'luchen');

        /* --- 左：境界 · 第N世 --- */
        G.UI.textOut(x, { x: 52, y: 4 }, ri.n, 14, G.UI.C.goldHi);
        G.UI.textOut(x, { x: 114, y: 7.5 }, '第 ' + save.life + ' 世', 10.5, G.UI.C.textDim);

        /* --- 气血 --- */
        var ratio = st.maxhp ? save.hp / st.maxhp : 0;
        var low = ratio <= 0.3;
        G.UI.text(x, { x: 52, y: 21 }, '气血', 10.5, G.UI.C.textDim);
        G.UI.bar(x, { x: 80, y: 22, w: 84, h: 8 }, ratio, low ? '#e2605a' : G.UI.C.hp);
        if (low) {                       /* 濒死：条外一圈脉动红晕 */
          x.save();
          x.globalAlpha = 0.30 + 0.30 * Math.sin(t / 220);
          G.UI.rr(x, { x: 78.5, y: 20.5, w: 87, h: 11 }, 3);
          x.strokeStyle = '#ff8a80'; x.lineWidth = 1.2; x.stroke();
          x.restore();
        }
        G.UI.textOut(x, { x: 170, y: 21 }, Math.round(save.hp) + ' / ' + st.maxhp, 10.5,
          low ? '#ff9a92' : G.UI.C.text);

        /* --- 修为（突破进度）---
           数值列与「可突破」**互斥**：灵气满时数值会变成 1200 / 100 这种超宽串，
           两个都画就会糊在一起（首版实测 "1200 / 100可突破" 连成一片）。
           灵气余额右边资源格里一直看得见，所以这里让位给可操作信息。 */
        var pr = bs.need ? Math.min(1, bs.have / bs.need) : 1;
        G.UI.text(x, { x: 52, y: 36 }, '修为', 10.5, G.UI.C.textDim);
        G.UI.bar(x, { x: 80, y: 37.5, w: 84, h: 7 }, pr, bs.ready ? '#f5e3a8' : G.UI.C.qi);
        if (bs.ready) {
          x.save();
          x.globalAlpha = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t / 260));
          G.UI.textOut(x, { x: 170, y: 35.5 }, '可突破', 11.5,
            bs.big ? '#ff9a7a' : '#8fe0a0');
          x.restore();
        } else {
          G.UI.textOut(x, { x: 170, y: 36 }, bs.have + ' / ' + bs.need, 10.5, G.UI.C.textDim);
        }

        /* --- 右：资源（三格等宽，图标 + 右对齐数值）---
           背板要够暗：顶栏渐变到这一行已经快透明了，格子底压不住的话
           屋脊/树梢会从数字底下穿过去，数字就读不清了。
           底走 G.UI.panel（带缓存 → 1 次 blit）：HUD 每帧都画，
           三个圆角矩形现描路径 + 现填 + 现描边是纯浪费。 */
        [
          ['stone', save.stone, '#a9d4f2'],
          ['qi', save.qi, '#a8dcc4'],
          ['po', save.po, '#e8c08a']
        ].forEach(function (s, i) {
          var sx = 278 + i * 66;
          G.UI.panel(x, { x: sx, y: 27, w: 62, h: 17 }, 'rgba(8,11,19,0.86)',
            'rgba(216,183,104,0.32)', 4, { paper: false, shadow: false });
          G.UI.icon(x, s[0], sx + 11, 35.5, 6.2);
          G.UI.textOut(x, { x: sx + 55, y: 29.5 }, num(s[1]), 11.5, s[2], 'right');
        });

        /* 场景名称铭牌：顶栏之下。金框小牌，亮色地面也清晰。 */
        var sname = this._sceneName();
        x.font = G.UI.F(13);
        var sw = x.measureText(sname).width;
        var px = 8, py = HUD_H + 5, ph = 19, pw = sw + 27;
        G.UI.panel(x, { x: px, y: py, w: pw, h: ph }, 'rgba(6,8,14,0.74)',
          'rgba(216,183,104,0.55)', 5, { paper: false, shadow: false });
        x.fillStyle = G.UI.C.goldHi;
        x.beginPath(); x.arc(px + 11, py + ph / 2, 2.4, 0, 6.2832); x.fill();
        G.UI.textOut(x, { x: px + 18, y: py + 3.5 }, sname, 13, G.UI.C.goldHi);
      },

      /* 底部左侧的常驻操作提示：纯点击操作没有摇杆，得有一句话交代怎么玩。
         进图后显示 14 秒，随后 2 秒淡出，不长期占画面。 */
      _drawHint: function (x) {
        var life = Math.max(0, Math.min(1, (16 - this.hintT) / 2));
        if (life <= 0) return;
        x.save();
        x.globalAlpha = 0.74 * life;
        G.UI.textOut(x, { x: 12, y: 254 }, '点击地面移动　·　点击门与物件交互', 10.5,
          'rgba(226,216,192,0.95)', 'left', 'rgba(0,0,0,0.7)', 2.4);
        x.restore();
      },

      onKey: function (code) {
        if (this.overlay) {
          if (hooks.overlayKey) hooks.overlayKey(code, this);
          return;
        }
        if (code === 'Space' || code === 'Enter') this._interact();
        if (code === 'Escape' && hooks.menu) hooks.menu(this);
      }
    };
    return scene;
  }

  G.Explore = { create: create };
})();
