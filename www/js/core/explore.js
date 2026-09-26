/* 探索引擎 v3：俯视瓦片地图，**纯鼠标点击**操作 —— 点地走过去、点物件自动走近交互。
   镇/山/洞/室内通用。键盘方向键保留为无 UI 的辅助（方便调试与无障碍）。 */
(function () {
  var MOVE_T = 0.18;
  var MAX_PATH = 64;                      /* 寻路上限（格）：够走完 36×24 镇子的对角 */
  var HUD_H = 48;                         /* 顶栏高度：渲染与版位常量；onTap 不再整段挡（v0.11.2 改） */
  var BOT_H = 28;                         /* 底栏高度：同上，渲染用，不再整段挡 */

  /* 左侧任务追踪栏（v0.11.4 起；v0.12.0 改**左缘收缩**，参考《烟雨江湖》）。
     收起 = 只在屏幕左缘留一条竖标（点它展开）；展开 = 竖标右侧弹出面板。
     竖标是**整个追踪栏唯一的按钮**（variant:'plain'，外观由 _drawTrackTab 自己画）；
     面板本体只画、不登记按钮 —— 登记了就会吞掉地图点击（G19 同族：登记了却没人画 / 画了却没人管）。
     高度 = 顶距 8 + 4 个竖排字 × 12 + 8 + 折角 14 + 底距 6。 */
  var TR_TAB_X = 0, TR_TAB_W = 20, TR_TAB_H = 76;
  /* 起点在场景铭牌之下（铭牌 y = HUD_H + 5、高 19） */
  var TR_Y = 78;
  var TR_W = 118, TR_PANEL_X = TR_TAB_W + 3;

  /* 血夜红雾时长（秒，M1 §6.3）。红雾是"入夜"压暗演出，淡完即切图。
     ⚠️ 引用它的地方在 _drawBloodVeil 里 —— 这个常量**曾经漏定义**，
     而 night 默认 0、冒烟从不触发演出，于是它是一颗哑弹（真进剧情才 ReferenceError）。
     凡"只在剧情里跑"的分支，必须有契约显式驱动一次（见 bloodnight.contract）。 */
  var NIGHT_T = 1.2;

  /* 跨图寻路与地图名的缓存。图与出口在存档生命周期内不变，
     但追踪栏是**每帧**画的 —— 不缓存的话每帧都要跑一次 BFS 与全表扫描。
     enter() 里清一次（换存档 / 首次进生成型区域后要重建）。 */
  var NAME_CACHE = {}, ROUTE_CACHE = {};

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
        /* 到过记录（v0.15.0）：地图面板靠它区分"已至 / 未至"。
           ⚠️ `save.visited` **早已存在**（v3 迁移建的），形状是**对象映射**不是数组 ——
           直接当数组用会让老档 `.indexOf is not a function` 崩掉（本轮就是这么撞的）。
           就地补字段、不写迁移。记的是**区域 id**（不是场景 id）：
           凡界 F1–F3 复用 town/field/cave，按场景 id 记会把它们当三个不同区域。 */
        save.visited = save.visited || {};
        var rg = G.Data.regions;
        var rid = (rg && rg.regionIdOf) ? rg.regionIdOf(mapId) : null;
        if (rid) save.visited[rid] = 1;
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
        /* 血夜红雾（M1 §6.3）：剩余秒数 + 淡出后的去处（{to, spawn}）。
           由 town.js 在"入夜"时置位，本场景负责计时与切图 ——
           这样"镇景压暗 0.5s 再进据点"不需要在 town 侧塞定时器。 */
        this.night = 0; this._nightGo = null;
        if (params.returned) { this.flash = 1; this.flashDir = -1; this.prot = 3; this.steps = 0; }
        /* 追踪栏的寻路/取名缓存跟着存档走：换世、首次进生成型区域后图会变。
           `trackOpen` 是**玩家偏好**，不在这里重置（否则每次换图都弹回来）。 */
        ROUTE_CACHE = {}; NAME_CACHE = {};
        this._padButtons();
        G.Storage.saveCurrent(save);
        /* 场景钩子：进门演出之类的"一进来就发生"的事挂在这里 */
        if (hooks.enter) hooks.enter(this);
      },

      /* 右上角「设置」+ 底部常驻功能栏。
         六项功能（角色/功法/秘术/任务/储物/成就）原先藏在「菜单」二级页里，
         是探索途中最高频的操作 —— 每次要点两下，现在常驻底栏一键直达。
         底栏按钮也进 this.buttons，所以开覆盖层时会被 setOverlay 换掉，
         面板内部由 G.Overlays 自己重画底栏（见 panels.js: renderBar）。 */
      _padButtons: function () {
        var self = this;
        this.buttons = [];
        if (hooks.menu) {
          this.buttons.push(new G.UI.Btn({
            x: 412, y: 5, w: 60, h: 20, small: true, variant: 'ghost', label: '设置',
            onClick: function () { hooks.menu(self); }
          }));
        }
        if (G.Overlays && G.Overlays.barBtns) {
          G.Overlays.barBtns(self, null).forEach(function (b) { self.buttons.push(b); });
        }
        /* 任务追踪栏的收起/展开钮 —— **整个追踪栏唯一的按钮**，落在屏幕左缘的竖标上。
           variant:'plain' 不画任何像素（竖标由 _drawTrackTab 画成竖向；
           Btn 只会横排一行字，塞进 20px 宽的竖条必然溢出）。
           面板本体（见 _drawTracker）只画不登记按钮，所以点面板上的文字
           走的仍是 onTap 的"点地面走过去"，不会出现"面板一盖地图就点不动"。 */
        if (G.Overlays && G.Overlays.trackInfo) {
          this.buttons.push(new G.UI.Btn({
            x: TR_TAB_X, y: TR_Y, w: TR_TAB_W, h: TR_TAB_H, small: true, variant: 'plain',
            label: '任务追踪',
            onClick: function () {
              self.trackOpen = (self.trackOpen === false);
              self._padButtons();
            }
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
        /* 血夜红雾（M1 §6.3）：红雾淡完就切图。期间冻结操作 ——
           否则玩家能在"入夜"演出的半秒里继续走动，甚至点开面板。 */
        if (this.night > 0) {
          this.night -= dt;
          if (this.night <= 0) {
            this.night = 0;
            var go = this._nightGo; this._nightGo = null;
            if (go) { this._transition(go); return; }
          }
          return;
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
        /* 剧情战斗触发格（M1 §5.1 血煞据点）：**走到格子上即开战**，
           与出入口同一处裁决 —— 所以放在 exitCells 之后、暗雷之前。
           打过的节点记进 save.scriptBattlesDone（键含 mapId，避免跨图 id 撞车），
           回图后再踩上来不会重打。判据放这里而不是各场景里，是为了只有一份真相源。 */
        var sb = this.map.scriptBattles && this.map.scriptBattles[key];
        if (sb && hooks.onScriptBattle) {
          var done = save.scriptBattlesDone || (save.scriptBattlesDone = []);
          if (done.indexOf(this.mapId + ':' + sb.id) < 0) {
            if (hooks.onScriptBattle(sb, this)) return;
          }
        }
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
        /* spawn 缺省兜底：`enter` 对 save.pos === null 会退回地图默认出生点。
           没有这行时，任何"只给 to 不给 spawn"的调用都会在 e.spawn.x 上抛异常 ——
           而它多半发生在 update 的帧回调里（血夜红雾淡完那一刻），
           真机上就是**未捕获异常把渲染循环整个打断**，玩家直接卡死。
           宁可落回默认出生点，也不要让一次切图把游戏打死。 */
        var spawn = e.spawn || (G.Data.maps[e.to] && G.Data.maps[e.to].spawn) || null;
        save.map = e.to; save.scene = e.to;
        save.pos = spawn ? { x: spawn.x, y: spawn.y } : null;
        G.Storage.saveCurrent(save);
        /* 不要传 toSpawn：那会把出口指定的落点覆盖成地图默认出生点，
           门里门外就会差一格（旧版 town→field→town 就偏了一格）。 */
        G.game.changeScene(e.to);
      },

      /* 入夜压暗演出（M1 §6.3）：红雾淡完**自动**切到 go 指定的图。
         给剧情用的公开入口 —— NIGHT_T 保持模块私有，调用方不需要知道时长。
         期间 update 会整帧 return（冻结操作），否则玩家能在演出的半秒里继续走动。 */
      startNight: function (go, dur) {
        this.night = dur || NIGHT_T;
        this._nightGo = go || null;
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
        /* 不再硬挡 HUD/底栏整段：按钮优先派发（game.js）已经处理 HUD/底栏上的真实交互。
           这里保留 4px 边缘死区防止系统手势误触，但玩家点得到贴着 HUD 的入口与物件。
           （v0.11.2 修：之前 HUD_H=48 / BOT_H=28 整段挡掉，会让贴边的副本入口点不到。） */
        if (p.y < 4) return;
        if (p.y >= 272 - 4) return;
        var tx = Math.floor(this._camX() / 16 + p.x / 16);
        var ty = Math.floor(this._camY() / 16 + p.y / 16);
        if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return;

        /* ⓪ 点到出口传送阵：直接切图。
           排在交互物之前 —— 出口格上不会同时有交互物，但顺序写死能省掉
           以后"出口上放了个 NPC"时的一类诡异 bug。 */
        var ex = this._exitAt(tx, ty);
        if (ex) { this._transition(ex); return; }

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
        this._drawShade(x, this._baseType(), this._pal(), camX, camY);

        /* 出口传送阵（云雾）。画在铺地/明暗之上、角色之下 ——
           角色站到阵上时人影压在雾上，读起来才是"站在阵里"而不是"雾浮在人身上"。
           洞穴暗幕在更后面才画，所以洞里的传送阵会被压暗一档，属于预期（它就该埋在暗里发光）。 */
        var selfP = this;
        (this.map.md.exits || []).forEach(function (e) {
          selfP._drawPortal(x, e, camX, camY);
        });

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

        /* 洞窟暗幕（火把可视范围）。bloodcave 是 cave 的换色变体（M1 §5.1），
           共用同一套暗幕 —— 判据收敛在 _isCaveGround() 一处，别在别处再写 'cave'。 */
        if (this._isCaveGround()) this._drawVeil(x, camX, camY);
        /* 室内：暖色环境光 + 暗角，做出"封闭空间"的收束感 */
        if (this.map.md.indoor) this._drawIndoor(x);

        this._drawHUD(x);
        this._drawTracker(x);
        this._drawInteractHint(x, camX, camY);
        this._drawMark(x, camX, camY);
        if (!this.overlay) this._drawHint(x);
        if (hooks.renderOverlay && this.overlay) hooks.renderOverlay(x, this);

        if (this.flash > 0) {
          x.fillStyle = 'rgba(255,255,255,' + Math.min(1, this.flash) * .9 + ')';
          x.fillRect(0, 0, 480, 272);
        }
        for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);
        /* 血夜红雾画在最上层：它要盖住 HUD 与底栏，读作"整屏被夜色吞掉" */
        if (this.night > 0) this._drawBloodVeil(x);
      },

      /* 血夜红雾（M1 §6.3 入据点前的压暗演出）。
         全矢量 + 时间驱动：红色暗角随时间加深，切图前一刻最浓。
         刻意不做成"镇景调色板换成夜晚" —— 那要动 _pal() 与三级缓存，
         而这段演出只活 1.2 秒，用一层叠加就够，且不可能污染别的图。 */
      _drawBloodVeil: function (x) {
        var k = 1 - Math.max(0, Math.min(1, this.night / NIGHT_T));   /* 0 → 1 */
        var a = 0.25 + 0.55 * k;
        var g = x.createRadialGradient(240, 150, 40, 240, 150, 300);
        g.addColorStop(0, 'rgba(74,6,12,' + (a * 0.74).toFixed(3) + ')');
        g.addColorStop(0.6, 'rgba(54,4,9,' + (a * 0.94).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(24,2,5,' + Math.min(1, a * 1.35).toFixed(3) + ')');
        x.fillStyle = g;
        x.fillRect(0, 0, 480, 272);
      },

      /* ===== 出口传送阵（v0.11.4）=====
         原先出口只是地面上一条颜色略深的路，玩家看不出"这里是出口"。
         现在在出口格上画一座云雾传送阵，**点它直接切图**。
         ① 全矢量 + 时间驱动，零素材依赖（缺图静默退回这种事不会发生在这里）；
         ② 点击命中在 onTap 里排在寻路之前（见 _exitAt）；
         ③ "走进去也触发"的老路径（_onEnterTile）原样保留 —— 两条路都通，
            所以这个改动不可能让任何一张图变得走不出去。
         ⚠️ **底边出口要抬高画**：底栏占 244..272，而底边出口那格正好是 256..272 ——
         按格子居中画，雾会整个埋进底栏里（首版实测就是这样，等于白做）。
         所以 bottom 出口整体上抬 LIFT，靠**向上飘的雾柱**把存在感做到栏以上。
         北/东/西出口不抬（它们本来就在可视区里）。 */
      _drawPortal: function (x, e, camX, camY) {
        var bottom = (e.y >= this.map.h - 1);
        var LIFT = bottom ? 14 : 0;
        var cx = (e.x0 + e.x1 + 1) / 2 * 16 - camX;
        var cy = e.y * 16 - camY + 10 - LIFT;
        var rx = ((e.x1 - e.x0 + 1) * 16) / 2 + 3;
        if (cx + rx < -10 || cx - rx > 490) return;
        var t = performance.now() / 1000;

        x.save();
        /* 地面辉光 */
        var g = x.createRadialGradient(cx, cy, 1, cx, cy, rx);
        g.addColorStop(0, 'rgba(150,220,255,0.46)');
        g.addColorStop(0.55, 'rgba(110,170,235,0.22)');
        g.addColorStop(1, 'rgba(90,140,220,0)');
        x.fillStyle = g;
        x.beginPath(); x.ellipse(cx, cy, rx, 12, 0, 0, 6.2832); x.fill();

        /* 上升雾柱：底边出口靠它把存在感顶到底栏以上（plume 高 28） */
        var plume = 28;
        var pg = x.createLinearGradient(0, cy - plume, 0, cy + 6);
        pg.addColorStop(0, 'rgba(170,225,255,0)');
        pg.addColorStop(0.45, 'rgba(170,225,255,0.16)');
        pg.addColorStop(1, 'rgba(200,238,255,0.30)');
        x.fillStyle = pg;
        x.beginPath();
        x.moveTo(cx - rx * 0.52, cy + 5);
        x.quadraticCurveTo(cx - rx * 0.34, cy - plume * 0.5, cx - 5, cy - plume);
        x.lineTo(cx + 5, cy - plume);
        x.quadraticCurveTo(cx + rx * 0.34, cy - plume * 0.5, cx + rx * 0.52, cy + 5);
        x.closePath(); x.fill();

        /* 三道旋转雾环：相位与转速都错开，才不会读成"一个圈在闪" */
        for (var i = 0; i < 3; i++) {
          var ph = t * (0.9 + i * 0.35) + i * 2.1;
          x.strokeStyle = 'rgba(198,236,255,' + (0.44 - i * 0.11).toFixed(3) + ')';
          x.lineWidth = 1.5 - i * 0.3;
          x.beginPath();
          x.ellipse(cx, cy, rx * (0.86 - i * 0.17), 10.5 * (0.86 - i * 0.17), 0,
            ph, ph + 4.2);
          x.stroke();
        }

        /* 上升雾团：越飘越淡，做出"从阵里升起来"的感觉 */
        for (var k = 0; k < 6; k++) {
          var a = t * 0.7 + k * 1.05;
          var up = (a % 1.6) / 1.6;
          var mx = cx + Math.sin(a * 2.3) * rx * 0.55;
          var my = cy - up * plume;
          x.fillStyle = 'rgba(224,246,255,' + (0.32 * (1 - up)).toFixed(3) + ')';
          x.beginPath(); x.arc(mx, my, 2.8 - up * 1.3, 0, 6.2832); x.fill();
        }

        /* 目的地名牌：挂在雾柱顶端。**必须在底栏之上**（244），否则等于没写。 */
        if (e.label) {
          x.font = G.UI.F(10);
          var tw = x.measureText(e.label).width + 16;
          var lx = cx - tw / 2, ly = Math.max(52, cy - plume - 15);
          G.UI.panel(x, { x: lx, y: ly, w: tw, h: 14 }, 'rgba(6,10,18,0.78)',
            'rgba(150,210,245,0.50)', 4, { tex: false, shadow: false });
          G.UI.text(x, { x: cx, y: ly + 2.5 }, e.label, 10, '#c8e8ff', 'center');
        }
        x.restore();
      },

      /* 点到出口传送阵？返回出口对象，否则 null。
         命中放宽到**上方一格**：传送阵的雾是向上飘的，视觉重心比它占的那格高一截，
         玩家点雾的顶部时会落在上一行 —— 只认原格会出现"明明点在阵上却没反应"。 */
      _exitAt: function (tx, ty) {
        if (!this.map || !this.map.exitCells) return null;
        return this.map.exitCells[tx + ',' + ty]
          || this.map.exitCells[tx + ',' + (ty + 1)] || null;
      },

      /* 是否洞窟系地面（cave 与它的换色变体 bloodcave）。
         唯一判据 —— 暗幕、瓦片基类都走这里，避免两处各写一份 'cave' 判断。 */
      _isCaveGround: function () {
        var g = this.map.md.ground;
        return g === 'cave' || g === 'bloodcave';
      },

      /* 区域基础类型（决定瓦片与过渡）。
         ⚠️ 必须返回**真实地面类型**，不能把 bloodcave 归回 'cave' ——
         地面纹理走 `groundTex(this._baseType(), pal)`，归一化会让暗红地面
         **静默渲染成普通洞窟**（不报错、只是颜色不对，属 G19 同类的"接线丢失"）。
         "是否洞窟系"这种族判断一律用 `_isCaveGround()`，别在这里合并。 */
      _baseType: function () {
        var g = this.map.md.ground;
        if (g === 'town') return 'town';
        if (g === 'cave' || g === 'bloodcave') return g;
        if (g === 'floor') return 'floor';
        return 'grass';
      },

      /* 区域调色板（缺口 U7）：优先用地图自带的 `md.pal`（区域美术预设），
         没有才退回世界调色板 —— 室内图、凡界复用型地图（town/field/cave）走退回这条路。
         ⚠️ 绘制路径里**一律走这里**，不要再直接读 `G.game.save.world.pal`：
         漏一处就是"那个物件没换皮"，而且完全静默（smoke 的源码闸会报）。 */
      _pal: function () {
        return (this.map.md && this.map.md.pal) || G.game.save.world.pal;
      },

      _drawFurn: function (x, f, camX, camY) {
        var px = f.x * 16 - camX, py = f.y * 16 - camY;
        var w = (f.w || 1) * 16, h = (f.h || 1) * 16;
        if (px > 480 || px + w < 0 || py > 272 || py + h < 0) return;
        var art = G.Art.furn(f.kind, this._pal());
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
        var K = G.Art.K, pal = this._pal();
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
        var m = this.map, pal = this._pal();
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
        /* 洞窟系（cave / bloodcave）**不铺明暗纹理** —— 它们走的是火把暗幕（`_drawVeil`）。
           判据用 `_isCaveGround()` 而不是 `kind === 'cave'`：`kind` 现在是**真实地面类型**，
           bloodcave 会漏过字符串比较 → 暗幕与明暗两层同时叠上（画面偏黑且多一份开销）。 */
        if (this._isCaveGround() || kind === 'floor') return;
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
        var pal = this._pal();
        var art = s.kind === 'house' ? G.Art.house(s, pal)
          : s.kind === 'ruin' ? G.Art.ruin(s, pal)
            : s.kind === 'gate' ? G.Art.gate(s, pal) : null;
        if (!art) return;
        G.Art.blit(x, art, px, py);
        this._drawPlaque(x, s, px + (art.ox || 0), py + (art.oy || 0));
      },

      /* 建筑匾额（v0.16.0）：**建筑上写它当前的名字**（用户口径）。
         ⚠️ 名字一律**矢量程序化绘制**，绝不烘进素材图 —— 两个硬理由：
           ① 文生图 / 像素图里的中文必然是乱码；
           ② 同一张建筑图要复用到不同建筑（药铺 / 刘家小院…），名字得跟着数据走。
         位置取"屋顶上方"而不是贴在墙上：屋墙从上到下被屋檐、两扇窗、门占满，
         没有能放下 4 个字的空档（4 行高的房子只有 8px 可用）。
         顶到屏幕上沿时改为压进屋顶内侧，避免被裁掉。 */
      _drawPlaque: function (x, s, bx0, by0) {
        var label = s.label;
        if (!label) return;
        var W = s.w * 16;
        var fs = 9.5;
        x.font = G.UI.F(fs);
        var tw = x.measureText(label).width;
        var pw = Math.ceil(tw + 10), ph = 13;
        var px0 = Math.round(bx0 + (W - pw) / 2);
        var py0 = Math.round(by0 - ph - 2);
        if (py0 < 2) py0 = Math.round(by0 + 3);       /* 顶到上沿 → 压进屋顶 */
        G.UI.rr(x, { x: px0, y: py0, w: pw, h: ph }, 3);
        x.fillStyle = 'rgba(10,14,24,0.82)';
        x.fill();
        x.strokeStyle = 'rgba(216,183,104,0.55)';
        x.lineWidth = 0.9;
        x.stroke();
        G.UI.text(x, { x: px0 + pw / 2, y: py0 + 2 }, label, fs, G.UI.C.goldHi, 'center');
      },

      _drawDecor: function (x, o, camX, camY) {
        var px = o.x * 16 - camX, py = o.y * 16 - camY;
        var h1 = (((o.x * 73856093) ^ (o.y * 19349663)) >>> 0);
        var v = (h1 % 3 + 3) % 3;
        /* 缩放走 3 档预烘（见 A.decorScaled）：同一变体在每个位置都一模一样，
           一眼就是复制粘贴，所以按位置给一点缩放与水平翻转 —— 但缩放必须是
           预烘好的整数尺寸，否则每帧一次滤波缩放既费帧又糊画面。 */
        var art = G.Art.decorScaled(o.t, this._pal(), v, h1 % 3);
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
        var art = G.Art.boss(this._pal());
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

      /* 站桩 NPC：落地投影 + 待机**不抖**（v0.11.2 改）。
         旧版 ±0.8 逻辑像素（≈ 3 实际像素 @ K=4）肉眼可见"上下点头"，
         玩家反馈"村民动得很奇怪，静止的没事"。
         站桩不需要呼吸感；动画留给走路的 1 帧上抬（heroSprite 那 1 像素就够）。
         头顶任务标记保持浮动，那是 UI 层而非人物本身。 */
      _drawNpc: function (x, n, camX, camY) {
        var px = n.x * 16 - camX + 8, py = n.y * 16 - camY + 12;
        var HW = G.Sprites.HERO_W, HH = G.Sprites.HERO_H;
        var top = py + 3 - HH;
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
         ② 顶栏视觉高度必须等于 HUD_H：让 HUD 视觉与内容一致。
         ③ 资源三格与菜单各占一块固定宽度，数值再长（五位数）也不会互相压字;
         ④ 头像走 G.UI.avatar，内部已经把立绘按头部裁好，这里只给圆心与半径。 */
      _drawHUD: function (x) {
        var self = this;
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

        /* --- 灵气（突破进度）---
           标签是**灵气**不是「修为」：这个条画的 `breakState.have/need` 就是
           `save.qi` 与该级所需灵气，修为是境界本身、不是这个数（v0.11.4 更正）。
           数值列与「可突破」**互斥**：灵气满时数值会变成 1200 / 100 这种超宽串，
           两个都画就会糊在一起（首版实测 "1200 / 100可突破" 连成一片）。
           灵气余额右边资源格里一直看得见，所以这里让位给可操作信息。 */
        var pr = bs.need ? Math.min(1, bs.have / bs.need) : 1;
        G.UI.text(x, { x: 52, y: 36 }, '灵气', 10.5, G.UI.C.textDim);
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

        /* --- 右：资源（四格等宽，图标 + 右对齐数值）---
           背板要够暗：顶栏渐变到这一行已经快透明了，格子底压不住的话
           屋脊/树梢会从数字底下穿过去，数字就读不清了。
           底走 G.UI.panel（带缓存 → 1 次 blit）：HUD 每帧都画，
           四个圆角矩形现描路径 + 现填 + 现描边是纯浪费。
           四格版式：起 x=244（左块数值最长到 ~230，留 14 余量），
           格宽 54 / 间距 4 → 末格右沿 472，距画布右沿 8。 */
        var RES = [
          ['stone', save.stone, '#a9d4f2', {
            title: '灵石（下品）',
            text: '通用通货。杂货铺买丹药、妖丹回收、秘境与任务奖励都用它。'
          }],
          ['qi', save.qi, '#a8dcc4', {
            title: '灵气',
            text: '修炼与突破用的灵气。打坐、杀怪、任务都能得；攒够本境界所需即可破境。'
          }],
          ['po', save.po, '#e8c08a', {
            title: '灵力',
            text: '功法精进的经验（功法升级）。在功法面板「精进」消耗，部分秘术也要花它。'
          }],
          ['crystal', G.Player.xianliLive(save), '#d8c0f0', {
            title: '仙晶',
            text: '本世累积的仙力：境界 + 功法 + 击杀首领（每个 +30）+ 年岁。\n'
              + '身故结算后可在轮回殿灌输仙躯，永久增益下一世。'
          }]
        ];
        RES.forEach(function (s, i) {
          var sx = 244 + i * 58;
          var cell = { x: sx, y: 27, w: 54, h: 17 };
          G.UI.panel(x, cell, 'rgba(8,11,19,0.86)',
            'rgba(216,183,104,0.32)', 4, { tex: false, shadow: false });
          G.UI.icon(x, s[0], sx + 10, 35.5, 6.2);
          G.UI.textOut(x, { x: sx + 49, y: 29.5 }, num(s[1]), 11.5, s[2], 'right');
          /* 面板打开时 HUD 被压暗，此时不该再挂提示（否则提示会浮在暗罩之上） */
          if (!self.overlay) G.UI.hover(cell, s[3]);
        });

        /* 场景名称铭牌：顶栏之下。金框小牌，亮色地面也清晰。 */
        var sname = this._sceneName();
        x.font = G.UI.F(13);
        var sw = x.measureText(sname).width;
        var px = 8, py = HUD_H + 5, ph = 19, pw = sw + 27;
        G.UI.panel(x, { x: px, y: py, w: pw, h: ph }, 'rgba(6,8,14,0.74)',
          'rgba(216,183,104,0.55)', 5, { tex: false, shadow: false });
        x.fillStyle = G.UI.C.goldHi;
        x.beginPath(); x.arc(px + 11, py + ph / 2, 2.4, 0, 6.2832); x.fill();
        G.UI.textOut(x, { x: px + 18, y: py + 3.5 }, sname, 13, G.UI.C.goldHi);
      },

      /* ===== 左缘竖标（v0.12.0）=====
         屏幕左缘一条常驻竖标，是整个追踪栏唯一的可点区域（按钮在 _padButtons 注册，
         variant:'plain' 不画像素，外观全在这里）。竖排四字 + 底部折角指示开合方向。
         **竖排而不是旋转**：ctx.rotate 后字体基线与对齐都要重算，竖排逐字画更稳，
         而且中文竖排本来就是这个读法（《烟雨江湖》的侧边栏也是竖排字）。
         折角**矢量画**，不用 '‹' '›' 字符（无 @font-face，缺字会变豆腐块）。 */
      _drawTrackTab: function (x, tk, open) {
        var C = G.UI.C;
        var h = TR_TAB_H, by = TR_Y;
        /* 左边两个圆角落在屏外（x = -4）→ 视觉上就是"贴住屏幕左缘的一条" */
        G.UI.panel(x, { x: -4, y: by, w: TR_TAB_W + 4, h: h },
          'rgba(6,9,16,0.86)', 'rgba(216,183,104,0.42)', 4,
          { tex: false, shadow: false });
        /* 右缘亮线：开合状态用**亮度**区分（展开时更亮），比换色更不吵 */
        x.fillStyle = open ? 'rgba(245,227,168,0.75)' : 'rgba(216,183,104,0.42)';
        x.fillRect(TR_TAB_W - 1.4, by + 6, 1.4, h - 12);

        /* 竖排「任务追踪」：4 字 × 12px，起点 by + 8 */
        var ty = by + 8;
        for (var i = 0; i < 4; i++) {
          G.UI.textOut(x, { x: TR_TAB_W / 2 - 1, y: ty }, '任务追踪'.charAt(i), 11,
            i === 0 ? C.goldHi : 'rgba(206,196,172,0.88)', 'center');
          ty += 12;
        }

        /* 底部折角：收起时指右（点它展开），展开时指左（点它收起） */
        var ax = TR_TAB_W / 2 - 1, ay = by + h - 13;
        x.save();
        x.strokeStyle = open ? C.goldHi : 'rgba(216,183,104,0.72)';
        x.lineWidth = 1.6; x.lineCap = 'round'; x.lineJoin = 'round';
        x.beginPath();
        if (open) { x.moveTo(ax + 3, ay - 3); x.lineTo(ax - 1.5, ay); x.lineTo(ax + 3, ay + 3); }
        else { x.moveTo(ax - 3, ay - 3); x.lineTo(ax + 1.5, ay); x.lineTo(ax - 3, ay + 3); }
        x.stroke();
        x.restore();

        /* 有路引时在竖标顶端点一颗呼吸金点：收起状态下也能看出"任务有方向可走" */
        if (tk && tk.guide) {
          var p = 0.5 + 0.5 * Math.sin(performance.now() / 420);
          x.save();
          x.globalAlpha = 0.35 + 0.5 * p;
          x.fillStyle = C.goldHi;
          x.beginPath(); x.arc(TR_TAB_W / 2 - 1, by + 4, 2.1, 0, 6.2832); x.fill();
          x.restore();
        }
      },

      /* ===== 左侧任务追踪栏（v0.11.4）=====
         参考《烟雨江湖》：左侧常驻一条，展示**当前主任务 + 子任务 + 路引**
         （路引 = 指向任务目的地的箭头 + 方位 + 距离）。
         五条硬约束，改版式前先读：
         ① **不吞地图点击**：面板本体不登记任何按钮 —— 唯一的按钮是顶部那根
            「收起 / 展开」窄条（在 _padButtons 里注册）。点面板上的字走的仍是
            onTap 的"点地面走过去"。
         ② 宽度写死 TR_W：所有文字按它折行 / 截断，超出去会压到地图中央。
         ③ 路引箭头**矢量画**，不用 '→' 字符（无 @font-face，缺字会变豆腐块）。
         ④ 起点在场景铭牌之下（铭牌 y = HUD_H + 5、高 19）。
         ⑤ 面板打开时整条不画 —— 面板自带暗罩，追踪栏浮在暗罩上会显得脏。 */
      _drawTracker: function (x) {
        if (this.overlay) return;
        var tk = G.Overlays.trackInfo ? G.Overlays.trackInfo(G.game.save) : null;
        if (!tk || !tk.s) return;
        var open = this.trackOpen !== false;

        /* 左缘竖标**常驻**（收起时它是唯一入口，展开时它是收起钮） */
        this._drawTrackTab(x, tk, open);
        if (!open) return;

        var s = tk.s, C = G.UI.C;

        /* 目标文案：折行最多 2 行（面板只有 118 宽，第 3 行就顶到面板底了） */
        var dl = G.UI.wrap(x, s.d, 9.5, TR_W - 14);
        if (dl.length > 2) { dl = dl.slice(0, 2); dl[1] = dl[1].replace(/.$/, '') + '…'; }
        var subs = (s.subs || []).slice(0, 3);
        var guide = tk.guide || null;
        var route = guide ? this._routeTo(guide.map) : null;

        var H = 9 + 12 + 14 + dl.length * 11 + subs.length * 11 + (guide ? 27 : 0) + 9;
        var bx = TR_PANEL_X, by = TR_Y, bw = TR_W;
        G.UI.panel(x, { x: bx, y: by, w: bw, h: H }, 'rgba(6,9,16,0.80)',
          'rgba(216,183,104,0.34)', 4, { tex: false, shadow: false });
        x.fillStyle = 'rgba(216,183,104,0.55)';
        x.fillRect(bx + 1.5, by + 4, 1.6, H - 8);

        var cy = by + 7;
        G.UI.text(x, { x: bx + 8, y: cy }, '主 线', 9.5, C.gold);
        G.UI.textOut(x, { x: bx + bw - 7, y: cy + 0.5 },
          (tk.idx + 1) + ' / ' + tk.total, 9, C.textDim, 'right');
        cy += 12;

        /* 当前步：金点 + 标题 */
        x.fillStyle = C.goldHi;
        x.beginPath(); x.arc(bx + 10, cy + 5, 2.2, 0, 6.2832); x.fill();
        G.UI.text(x, { x: bx + 16, y: cy }, s.t, 11, C.goldHi);
        cy += 14;

        dl.forEach(function (ln) {
          G.UI.text(x, { x: bx + 8, y: cy }, ln, 9.5, C.textDim); cy += 11;
        });

        /* 子任务：已完成画勾、未完成画空圈（都是矢量，无字符依赖） */
        subs.forEach(function (sb) {
          var done = !!(sb.f && tk.flags[sb.f]);
          var sx2 = bx + 10, sy2 = cy + 5;
          x.save();
          if (done) {
            x.strokeStyle = C.jadeHi; x.lineWidth = 1.2; x.lineCap = 'round';
            x.beginPath();
            x.moveTo(sx2 - 2.6, sy2); x.lineTo(sx2 - 0.7, sy2 + 2.2);
            x.lineTo(sx2 + 3, sy2 - 2.4); x.stroke();
          } else {
            x.strokeStyle = 'rgba(150,158,178,0.7)'; x.lineWidth = 1;
            x.beginPath(); x.arc(sx2, sy2, 2.4, 0, 6.2832); x.stroke();
          }
          x.restore();
          G.UI.text(x, { x: bx + 16, y: cy }, sb.t, 9.5, done ? C.jadeHi : C.text);
          cy += 11;
        });

        /* ---- 路引 ---- */
        if (!guide) return;
        x.fillStyle = 'rgba(216,183,104,0.18)';
        x.fillRect(bx + 6, cy + 1.5, bw - 12, 0.8);
        cy += 5;

        var onMap = guide.map === this.mapId;
        var hop = onMap ? null : route;          /* null = 同图；undefined = 无路 */
        var tx = onMap ? guide.x : (hop ? hop.x : null);
        var ty = onMap ? guide.y : (hop ? hop.y : null);
        var pp = this._px();
        var dx = 0, dy = 0, ok = false;
        if (tx != null) {
          dx = tx - pp.x / 16; dy = ty - pp.y / 16;
          ok = Math.abs(dx) + Math.abs(dy) > 0.6;   /* 站在目标点上就别画箭头了 */
        }

        var acx = bx + 15, acy = cy + 8;
        x.save();
        x.fillStyle = 'rgba(216,183,104,0.14)';
        x.beginPath(); x.arc(acx, acy, 8, 0, 6.2832); x.fill();
        x.strokeStyle = 'rgba(216,183,104,0.40)'; x.lineWidth = 1;
        x.beginPath(); x.arc(acx, acy, 8, 0, 6.2832); x.stroke();
        x.restore();
        if (ok) {
          x.save();
          x.translate(acx, acy); x.rotate(Math.atan2(dy, dx));
          x.strokeStyle = C.goldHi; x.lineWidth = 1.4; x.lineCap = 'round';
          x.beginPath(); x.moveTo(-4.2, 0); x.lineTo(3, 0); x.stroke();
          x.fillStyle = C.goldHi;
          x.beginPath(); x.moveTo(5, 0); x.lineTo(0.6, -3); x.lineTo(0.6, 3);
          x.closePath(); x.fill();
          x.restore();
        } else {
          x.fillStyle = C.goldHi;
          x.beginPath(); x.arc(acx, acy, 2.2, 0, 6.2832); x.fill();
        }

        /* 目标名：同图用 NPC / 地点名，跨图用"下一跳地图名 · 出口名" */
        var who = onMap
          ? guide.who
          : this._mapName(guide.map) + (hop && hop.name ? ' · ' + hop.name : '');
        G.UI.text(x, { x: bx + 28, y: cy }, this._ellip(x, who, 10, bw - 35), 10, C.text);
        var line2 = ok
          ? this._dirName(dx, dy) + '　约 ' + Math.round(Math.sqrt(dx * dx + dy * dy)) + ' 格'
          : (onMap ? '就在此处' : '往 ' + this._mapName(guide.map));
        G.UI.text(x, { x: bx + 28, y: cy + 12 }, line2, 9, C.textDim);
      },

      /* 超宽截断：按字号量宽度，超出补 '…'（中文一个字就是一个字宽，够用） */
      _ellip: function (x, str, size, maxW) {
        x.font = G.UI.F(size);
        if (x.measureText(str).width <= maxW) return str;
        var out = str;
        while (out.length > 1 && x.measureText(out + '…').width > maxW) {
          out = out.slice(0, -1);
        }
        return out + '…';
      },

      /* 方位名：屏幕坐标里 +y 向下 = 南。0° 取东，每 45° 一档。 */
      _dirName: function (dx, dy) {
        var a = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
        return ['东', '东南', '南', '西南', '西', '西北', '北', '东北']
          [Math.round(a / 45) % 8];
      },

      /* 地图显示名。手写图有 label，生成型区域查 regions 表，
         最后才是兜底表 —— 三层都查不到就直接显示 id（不静默成空串）。 */
      _mapName: function (id) {
        if (!id) return '';
        if (NAME_CACHE[id]) return NAME_CACHE[id];
        var md = G.Data.maps[id], nm = '';
        if (md && (md.label || md.n)) nm = md.label || md.n;
        if (!nm && G.Data.regions) {
          var Rg = G.Data.regions;
          var r = Rg.byId ? Rg.byId(Rg.regionIdOf ? Rg.regionIdOf(id) : id) : null;
          if (r && r.n) nm = r.n;
        }
        if (!nm) {
          nm = { town: '青溪镇', field: '翠微山', cave: '赤牙洞', town_home: '沈家小院',
            town_shop: '药铺', town_market: '刘记杂货', field_temple: '山神庙' }[id] || id;
        }
        NAME_CACHE[id] = nm;
        return nm;
      },

      /* 本图的所有"通往别处"的边：出口 + 带 to 的建筑（山门/洞门）+ 屋门（md.doors）。
         屋门映射读的是地图数据（maps.js: town.doors），与 town.js 的 onInteract 同源 ——
         这里再抄一份就会分叉。 */
      _linksOf: function (md) {
        if (!md) return [];
        var out = [], Rg = G.Data.regions;
        (md.exits || []).forEach(function (e) {
          var to = e.to;
          if (Rg && Rg.mapIdOf) to = Rg.mapIdOf(to) || to;
          out.push({ to: to, x: (e.x0 + e.x1) / 2, y: e.y, name: e.label || '' });
        });
        (md.structures || []).forEach(function (s) {
          var dx = s.x + Math.floor((s.w || 1) / 2), dy = s.y + (s.h || 1);
          if (s.to) out.push({ to: s.to, x: dx, y: dy, name: s.label || '' });
          else if (s.id && md.doors && md.doors[s.id]) {
            out.push({ to: md.doors[s.id], x: dx, y: dy, name: s.label || '' });
          }
        });
        return out;
      },

      /* 跨图寻路：沿 _linksOf 的边做 BFS，返回**从当前图迈出的第一跳**。
         返回值：null = 已在本图（调用方自己算方向）；undefined = 走不到；否则 {to,x,y,name}。
         图很小（十几个节点），BFS 每帧跑也不心疼 —— 而且结果按 起>止 缓存了。 */
      _routeTo: function (targetMap) {
        if (!targetMap) return undefined;
        if (targetMap === this.mapId) return null;
        var key = this.mapId + '>' + targetMap;
        if (key in ROUTE_CACHE) return ROUTE_CACHE[key];
        var seen = {}, queue = [{ id: this.mapId, first: null }], res;
        seen[this.mapId] = true;
        for (var guard = 0; guard < 128 && queue.length; guard++) {
          var cur = queue.shift();
          var links = this._linksOf(G.Data.maps[cur.id]);
          for (var i = 0; i < links.length; i++) {
            var lk = links[i], first = cur.first || lk;
            if (lk.to === targetMap) { res = first; guard = 999; break; }
            if (seen[lk.to]) continue;
            seen[lk.to] = true;
            queue.push({ id: lk.to, first: first });
          }
        }
        ROUTE_CACHE[key] = res;
        return res;
      },

      /* 底部左侧的常驻操作提示：纯点击操作没有摇杆，得有一句话交代怎么玩。
         进图后显示 14 秒，随后 2 秒淡出，不长期占画面。
         位置必须**让开底栏**（272−BOT_H=244 起是功能栏），否则被压在底栏底下。 */
      _drawHint: function (x) {
        var life = Math.max(0, Math.min(1, (16 - this.hintT) / 2));
        if (life <= 0) return;
        x.save();
        x.globalAlpha = 0.74 * life;
        G.UI.textOut(x, { x: 12, y: 272 - BOT_H - 18 }, '点击地面移动　·　点击门与物件交互', 10.5,
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

  G.Explore = { create: create, HUD_H: HUD_H, BOT_H: BOT_H };
})();
