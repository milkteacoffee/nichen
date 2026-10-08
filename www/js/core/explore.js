/* 探索引擎 v3：俯视瓦片地图，**纯鼠标点击**操作 —— 点地走过去、点物件自动走近交互。
   镇/山/洞/室内通用。键盘方向键保留为无 UI 的辅助（方便调试与无障碍）。 */
(function () {
  var MOVE_T = 0.18;
  /* ===== 格子像素尺寸（v0.91.0，用户第 9 点「地图做大、建筑一比一」）=====
     用户口径：「这些建筑相当于缩小的城池或镇子，但地图场景却是一比一的大小……
     导致人物角色比建筑还要大，这是严重问题」。
     实测：人物精灵逻辑高 24×1.75 = **42px**；民居框 5 格 × 16 = 80px，
     素材等比内含后再乘 0.75 → 可见高仅 60px = 人物的 **1.4 倍**（真实民居≈3 倍）。
     解法：**格子 16 → 24**（地图与建筑同步 ×1.5）+ 建筑素材再 ×1.4（见 art.STRUCT_SCALE）
     → 民居可见高 5×24×0.75×1.4 = **126px = 人物的 3.0 倍**，比例回到真实。
     ⚠️ 改这个常量意味着**所有"格 ↔ 像素"换算都必须走它**，不许再写裸 16：
        一旦有地方漏改，表现是"只有那一样东西位置错"（静默、难查）。
        `TILE.contract` 会扫源码闸拦裸 16。 */
  var TILE = 24;
  /* 地形高度：每档抬升多少像素（v1.4.0）。
     1/3 格（8px）是"看得出坡、又不至于把格子错得认不出网格"的实测甜点 ——
     取半格（12px）会让相邻格看起来"断开"，取太小（4px）则读不出层级。 */
  var ELEV_STEP = 8;
  var MAX_PATH = 64;                      /* 寻路上限（格）：够走完 36×24 镇子的对角 */
  var HUD_H = 48;                         /* 顶栏高度：渲染与版位常量；onTap 不再整段挡（v0.11.2 改） */
  var BOT_H = 28;                         /* 底栏高度：同上，渲染用，不再整段挡 */

  /* 左侧任务追踪栏（v0.11.4 起；v0.12.0 改**左缘收缩**，参考《烟雨江湖》）。
     收起 = 只在屏幕左缘留一条竖标（点它展开）；展开 = 竖标右侧弹出面板。
     竖标是**整个追踪栏唯一的按钮**（variant:'plain'，外观由 _drawTrackTab 自己画）；
     面板本体只画、不登记按钮 —— 登记了就会吞掉地图点击（G19 同族：登记了却没人画 / 画了却没人管）。
     高度 = 顶距 8 + 4 个竖排字 × 12 + 8 + 折角 14 + 底距 6。 */
  var TR_TAB_X = 0, TR_TAB_W = 20, TR_TAB_H = 76;
  /* 收起态的**紧凑**高度（v0.75.0，用户口径「这些内容支持缩到最小，鼠标点击展开，
     不要占用游戏窗口」）：收起时只剩一个 20×30 的小竖标（两个字），
     把屏幕左缘让给地图；点它才展开成完整面板。
     ⚠️ 两个高度都必须**是稳定值**（用户明确「任务左右上下都在浮动」）——
        不随时间/内容变化，只在开合时切换一次。 */
  var TR_TAB_MIN_H = 30;
  /* 起点在场景铭牌之下（铭牌 y = HUD_H + 5、高 19） */
  var TR_Y = 78;
  var TR_W = 118, TR_PANEL_X = TR_TAB_W + 3;

  /* 血夜红雾时长（秒，M1 §6.3）。红雾是"入夜"压暗演出，淡完即切图。
     ⚠️ 引用它的地方在 _drawBloodVeil 里 —— 这个常量**曾经漏定义**，
     而 night 默认 0、冒烟从不触发演出，于是它是一颗哑弹（真进剧情才 ReferenceError）。
     凡"只在剧情里跑"的分支，必须有契约显式驱动一次（见 bloodnight.contract）。 */
  var NIGHT_T = 1.2;

  /* 建筑功能说明（v0.54.0）—— 全部从结构已有字段(label/bk/kind/to/need/closedText)
     推导「名称 + 一句功能」，不新造数据；鼠标悬浮建筑时由 G.UI.hover 富卡展示。 */
  var STRUCT_DESC = {
    house: '居所，可闭关修炼、休整',
    apothecary: '买卖丹药、药材，可出售战利品',
    shop: '买卖杂货、材料与器具',
    inn: '投宿恢复气血，可打听消息',
    smithy: '打造与修理兵器、法器',
    alchemy: '炼制丹药之所',
    hall: '宗门正殿，议事领务',
    temple: '供奉神祇，可祈福',
    tower: '登高瞭望、镇守要地',
    gate: '山门或城门，可由此进出',
    ruin: '荒废遗迹，或藏机缘'
  };
  function structureInfo(s) {
    var L = [];
    if (s.to) {
      if (String(s.to).indexOf('sect.') === 0) L.push('宗门山门，可拜入或进入宗门');
      else if (s.to === 'cave') L.push('由此进入洞穴秘境');
      else L.push('门户，可由此进出');
    } else if (s.label === '洞府') {
      L.push('你的居所，可闭关修炼、休整');
    } else {
      var key = s.bk || s.kind;
      if (STRUCT_DESC[key]) L.push(STRUCT_DESC[key]);
      else if (s.kind === 'ruin') L.push(STRUCT_DESC.ruin);
      else if (s.kind === 'gate') L.push(STRUCT_DESC.gate);
      else L.push('一处建筑');
    }
    if (s.closedText) L.push(s.closedText);
    else if (s.need) L.push('修为或条件不足，暂不可入');
    return { title: s.label || '建筑', text: L.join('\n') };
  }

  /* 手绘场景道具（v0.54.0）：把生成的 prop.* 透明图按目标高度预烘（避免每帧滤波缩放），
     ox 让道具在锚点格水平居中、oy 使根部落在格中(py+14)。缓存按逻辑键。 */
  var PROP_CACHE = {};
  function paintedSingle(imgKey, targetH) {
    if (PROP_CACHE[imgKey]) return PROP_CACHE[imgKey];
    var img = G.Assets.img(imgKey);
    if (!img) return null;
    var tw = Math.max(8, Math.round(img.width * (targetH / img.height)));
    var o2 = G.Art.cv(tw, targetH);
    o2.x.drawImage(img, 0, 0, tw, targetH);
    var art = { c: o2.c, w: tw, h: targetH, ox: Math.round((16 - tw) / 2), oy: 14 - targetH };
    PROP_CACHE[imgKey] = art;
    return art;
  }
  function paintedProp(type, v) {
    if (type === 'tree') return paintedSingle('prop.tree.' + (v + 1), 48);
    if (type === 'rock') return paintedSingle('prop.rock.' + (v + 1), 24);
    return null;
  }

  /* 跨图寻路与地图名的缓存。图与出口在存档生命周期内不变，
     但追踪栏是**每帧**画的 —— 不缓存的话每帧都要跑一次 BFS 与全表扫描。
     enter() 里清一次（换存档 / 首次进生成型区域后要重建）。 */
  var NAME_CACHE = {}, ROUTE_CACHE = {};

  /* 资源数值压缩：超过一万用「万」。
     资源格只有 62px 宽，五行灵石中后期是五位数，不压缩就会顶到图标上。 */
  function num(n) { return G.Player.formatCount(n); }

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
        /* 陆地坐骑只在室外；一进室内（洞府/店铺/山门）自动翻身下马，避免骑着穿屋。 */
        if (this.map.md.indoor && save.riding) {
          G.Beasts.dismount(save);
          G.game.toast('入得室内，翻身下马');
        }
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
        /* 明雷索引：从 map.roams 建格键表，供 _roamAt 与绘制共用。
           生命周期说明：**每次进图由 buildMap 重新生成**（种子 = worldSeed + mapId，
           所以同一世同一图的点位固定），本次进图内击杀即从 roams 里移除、当次不再刷新；
           离开再回来会重新出现 —— 这是刻意设计：明雷是**可重复的刷取口**，
           收益已按"只给材料 + 1~5 下品灵石"封顶，不会重演旧版"刷怪刷灵气"。
           为何不落存档：明雷不是"一次性遗迹"，玩家需要它可反复刷；
           落存档的话清完一张图就永久空了，材料来源会断。 */
        this._roamIdx = this._buildRoamIdx();
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
        /* 御剑开关（v0.22.0）：**解锁后才出现** —— 低境界玩家不该看到"用不了的按钮"。
           按钮文案本身兼作状态提示（御剑 / 御剑·飞）。 */
        var save0 = G.game.save;
        if (save0 && G.Player.canFly && G.Player.canFly(save0)) {
          var flyOn = !!save0.fly;
          this.buttons.push(new G.UI.Btn({
            x: 346, y: 5, w: 60, h: 20, small: true,
            variant: flyOn ? 'gold' : 'ghost',
            label: flyOn ? '御剑·飞' : '御剑',
            onClick: function () {
              var sv = G.game.save;
              sv.fly = !sv.fly;
              G.Storage.saveCurrent(sv);
              G.game.toast(sv.fly ? '御剑而行 —— 移速提升，不再遇袭' : '收剑落地');
              self._padButtons();
            }
          }));
        }
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
            /* 收起态用**紧凑**高度（30），展开态用完整高度（76）——
               命中区必须跟着外观走，否则收起时那截 46px 的空区还会吞地图点击
               （G19 同族：画了却没人管 / 管了却没画）。 */
            x: TR_TAB_X, y: TR_Y, w: TR_TAB_W,
            h: (this.trackOpen === false) ? TR_TAB_MIN_H : TR_TAB_H,
            small: true, variant: 'plain',
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
        /* 地图面板的拖拽（v0.62.0，用户第 6/8 点）。
           ⚠️ 必须放在**最前面** —— 面板打开时下面的逻辑会 early return，
              挂到后面就永远不跑（表现是"拖不动"，且完全不报错）。 */
        if (this.overlay === 'map' && G.Overlays.mapDragTick) G.Overlays.mapDragTick(this);
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
        /* 破境天劫（v0.26.0）：必须在 `if (this.overlay) return;` **之前**推进 ——
           天劫期间是有覆盖层的，放后面就永远不动（表现：卡在蓄势那一帧）。 */
        if (this.overlay === 'tribulation' && G.Overlays.tickTribulation) {
          G.Overlays.tickTribulation(this, dt);
        }
        if (this.overlay) return;

        var inp = G.Input, save = G.game.save;
        var d = this._heldDir(inp);

        if (this.moving) {
          /* 御剑：移速 ×1/0.55 ≈ 1.8 倍（"飞"的第二个线索） */
          var mtBase = MOVE_T;
          if (this._flying()) mtBase = MOVE_T * G.Player.FLY_MOVE_COEF;
          else { var _rd = this._riding(); if (_rd) { var _ri = G.Data.beasts.rideInfo(_rd.id); if (_ri) mtBase = MOVE_T * _ri.coef; } }
          this.mt += dt / mtBase;
          this.walkT += dt;
          this.frame = 1 + Math.floor(this.walkT / .18) % 2;
          if (this.mt >= 1) {
            this.moving = false;
            /* 步数：走完一格 +1 —— 走路动效的"左右倾摆"按它换向 */
            this._stepN = (this._stepN || 0) + 1;
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
          if (next && !this._blocked(next.x, next.y)) {
            this.moving = true; this.from = save.pos; this.to = next; this.mt = 0;
          }
          this.frame = 0;
        }
        /* 主线插曲·机缘（v0.60 立，v0.62.0 扩成三态触发：gl / map 行走 / step）。
           ⚠️ 用 `pendingFor(save, this)` 而不是老的 `pending(save)` ——
              老签名拿不到 scene，判不了"野外/城镇"与"当前图 id"，
              `map` 触发的那一类会**永远不弹**（且不报错）。 */
        if (!this.moving && !this.path.length && !this.pendingAct && G.Data.StoryEvents) {
          var _ev = G.Data.StoryEvents.pendingFor(save, this);
          /* 主线章节（v0.63.0，用户第 6 点）：**排在机缘之后**，而且同帧只弹一个 ——
             两者都设 `overlay`，同时弹的话后一个会盖掉前一个，玩家只看到最后一章。 */
          if (!_ev && G.Data.Chapters) {
            _ev = G.Data.Chapters.pendingFor(save);
            if (_ev) _ev.chapter = true;      /* 标记：完成记录写进 `save.chapters` 而不是 quest.flags */
          }
          if (_ev) G.Data.StoryEvents.show(this, _ev);
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
        /* ===== 明雷（可见野怪）撞上即开战（v0.68.0 用户第 22 点）=====
           放在出口裁决**之后**（踩到出口就切图，不该同时开战），
           但放在暗雷之前 —— 明雷是"看得见的必战"，优先级高于随机暗雷。
           ⚠️ 用**格子键**查表而不是遍历数组：地图每帧最多走一格，
              遍历几十只野怪是不必要的开销，且格子表天然去重。 */
        var roam = this._roamAt(x, y);
        if (roam) {
          if (this._flying()) return;            /* 飞过去不算撞上（与暗雷一致） */
          if (this.prot > 0) { this.prot -= 1; return; }
          this._encounterRoam(roam);
          return;
        }
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
        var gn = this.map.gatherNodes && this.map.gatherNodes[key];
        if (gn && G.Gather) G.Gather.gatherAt(save, this.mapId, gn, this);
        if (this.map.md.safe) return;
        /* 御剑飞行时**不触发暗雷** —— 这是"飞"最直观的收益 */
        if (this._flying()) return;
        this.steps += 1;
        if (this.prot > 0) { this.prot -= 1; return; }
        var zone = this._zone(y);
        if (!zone) return;
        /* ===== 暗雷（v0.68.0 用户第 22 点）=====
           改成**明雷 + 暗雷**之后，暗雷必须"概率小一点 + 只在特定地形"。
           ① 概率 12% → 6%；② 只在野地（草地/山地/岩石地等）触发，
              路面/室内砖地等"人走的路"踩上去无事发生（与明雷的 ROAM_FORBID 同源）。
           地形口径收敛在一处：`ROAM_FORBID` 由 mapgen 导出，避免两处各写一份。 */
        if (G.MapGen.ROAM_FORBID && G.MapGen.ROAM_FORBID[this._tileType(x, y)]) return;
        if (G.rng.next() < .06) this._encounter(zone);
      },

      /* 该格的地面类型（明雷/暗雷的地形口径统一走这里） */
      _tileType: function (x, y) {
        var g = this.map.ground;
        if (!g || !g[y] || !g[y][x]) return '';
        return g[y][x].t || '';
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
        if (e.to === 'town_home' && !G.Player.hasHome(save)) {
          G.game.toast('尚未取得洞府，可在「洞府」页租用');
          G.Overlays.openPanel(this, 'cave');
          return;
        }
        /* spawn 缺省兜底：`enter` 对 save.pos === null 会退回地图默认出生点。
           没有这行时，任何"只给 to 不给 spawn"的调用都会在 e.spawn.x 上抛异常 ——
           而它多半发生在 update 的帧回调里（血夜红雾淡完那一刻），
           真机上就是**未捕获异常把渲染循环整个打断**，玩家直接卡死。
           宁可落回默认出生点，也不要让一次切图把游戏打死。 */
        var spawn = e.spawn || (G.Data.maps[e.to] && G.Data.maps[e.to].spawn) || null;
        save.map = e.to; save.scene = e.to;
        save.pos = spawn ? { x: spawn.x, y: spawn.y } : null;
        G.Storage.saveCurrent(save);
        /* ⚠️ 生成型区域（fan5..dao5 这些）的探索场景是**懒创建**的
           （`RegionGen.sceneFor`），而 `registerWorld/ensureWorld` 全项目**无人调用** ——
           所以走到出口会直接吃到 `changeScene` 的"场景未开放"，
           玩家看到的就是"**提示无法进入下一个地图**"（用户口径）。
           这里兜一道：目标场景不存在且是区域，就先建。 */
        if (!G.scenes[e.to] && G.RegionGen && G.RegionGen.sceneFor) {
          G.RegionGen.sceneFor(e.to);
        }
        if (!G.scenes[e.to] && e.to.indexOf('sect.') === 0 && G.SectGen && G.SectGen.sceneFor) {
          G.SectGen.sceneFor(e.to);
        }
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
      /* 该格上的明雷（可见野怪）。格键索引在 enter 时建好，O(1) 查。 */
      _roamAt: function (x, y) {
        if (!this._roamIdx) return null;
        return this._roamIdx[x + ',' + y] || null;
      },

      /* 建明雷格键索引。同一格只会有一只（生成时已 mark 去重），
         所以这里不用处理"两只见面"的合并问题。 */
      _buildRoamIdx: function () {
        var idx = {};
        (this.map.roams || []).forEach(function (r) { idx[r.x + ',' + r.y] = r; });
        return idx;
      },

      /* 撞上明雷开战：与暗雷共用 `_encounter` 之后的整条链，
         差别只在"这一场是玩家自己撞上去的"，所以直接构造 units 走同一出口。 */
      _encounterRoam: function (roam) {
        var unit = this._rollUnitR(roam);
        this.flash = 0; this.flashDir = 1;
        this._pending = { unit: unit, units: [unit], roam: roam };
      },

      /* 掷明雷对应的敌人。**等级与物种一律钉住地图上那只** ——
         玩家看到的"那只狼"和真正打的那只必须一致，否则明雷就失去意义了
         （看到 Lv15 的青纹蛇、打的是 Lv17 的别的兽，玩家会觉得被骗）。
         所以这里**不重新 roll 等级/物种**，也不走 `_rollUnit` 的随机取名：
         名字直接用物种名（或兽名池里取一个，但保持物种前缀可比对）。 */
      _rollUnitR: function (roam) {
        var L = roam.lv;
        var poolKey = roam.species === '青纹蛇' ? 'snake'
          : roam.species === '赤炎狼' ? 'wolf' : null;
        var nm = poolKey ? G.rng.pick(G.Data.namePools[poolKey]) : roam.species;
        /* 名字兜一道：兽名池用的别名（花脊蛇/灰背狼…）会让"名字里含物种"这条失配，
           于是补一个物种后缀，既保留随机感又保证可追溯到地图上那只。
           ⚠️ 这正是契约 `roam.contract` 抓到的第二处漂移。 */
        if (nm.indexOf(roam.species) < 0) nm = roam.species + '·' + nm;
        var unit = G.Data.makeEnemy(roam.species, L, nm);
        this._applyWorldEnemy(unit);
        return unit;
      },

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
        /* ===== 天气专属兽注入（v1.2.0）=====
           雷雨天把「雷貂」加进候选池。**这是"雷雨天加成雷系妖兽"的真正实现** ——
           只提高属性权重不够（池子里若本来没有雷系兽，权重再高也掷不出来）。
           ⚠️ 注入的是**基础权重**，之后还会乘属性加权（雷系 ×6 = 1+5），
              所以雷雨天的雷貂会明显多于其他兽。
           ⚠️ 只在**池子非空**时注入（空池意味着这张图本来就没野怪，不该凭空造）。 */
        if (list.length && G.game.weatherSpawns) {
          G.game.weatherSpawns().forEach(function (ws) {
            var found = null;
            list.forEach(function (it) { if (it.k === ws.species) found = it; });
            if (found) found.w += ws.w;
            else list.push({ k: ws.species, w: ws.w });
          });
        }
        /* ===== 天气的属性偏向（v1.2.0，用户口径「雷雨天加成雷系妖兽」）=====
           把天气关心的属性（`encElemWeight`）乘到权重上 —— 雷雨天雷系兽 ×5，
           于是"雷雨多雷兽"是从**权重**上自然发生的，而不是特殊分支。
           ⚠️ 只在**有属性表**时加权（`G.Data.enemies` 里的 `elem`）；
              查不到属性的老兽按 1 倍（不改变原有分布）。
           ⚠️ 加权**只影响暗雷重掷**。明雷是地图生成时定好的（mapgen），
              它的等级/物种**必须与玩家看到的那只一致**，不能临时改（见 `_rollUnitR` 注释）。 */
        if (G.game.encElemWeight && G.Data.makeEnemy) {
          list.forEach(function (it) {
            var el = (G.Data.enemyElemOf && G.Data.enemyElemOf(it.k)) || null;
            if (el) it.w *= G.game.encElemWeight(el);
          });
        }

        /* 天气加成双只组概率（恶劣天气野兽结伴） */
        var pairChance = (zone.pair || 0) / 100 + (G.game.encPairAdd ? G.game.encPairAdd() : 0);
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
        /* 天气的等级上浮（v1.2.0）：雷雨/瘴气 +2 —— "雨天野怪更凶"。
           ⚠️ 夹在该分区的 enc 上限**再往上一档**（不超过上限 +3），
              否则恶劣天气下后山杂鱼会顶到 BOSS 的等级区间。 */
        var wBias = G.game.encLvBias ? G.game.encLvBias() : 0;
        var L = G.rng.int(zone.enc.min, zone.enc.max) + bias + wBias;
        if (zone.enc && L > zone.enc.max + 4) L = zone.enc.max + 4;
        var poolKey = speciesKey === '青纹蛇' ? 'snake'
          : speciesKey === '赤炎狼' ? 'wolf' : null;
        var nm = poolKey ? G.rng.pick(G.Data.namePools[poolKey]) : null;
        if (!nm) {
          /* 新物种（如雷貂）先看兽名池里有没有；没有再退回物种名本身。
             ⚠️ 用 `G.Data.namePools` 的存在性判断，别写死 if 链（加物种会漏）。 */
          nm = speciesKey;
        }
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
          G.game.toast(G.Player.itemName(k) + ' ×' + loot.items[k]);
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
        var tx = Math.floor(this._camX() / TILE + p.x / TILE);
        var ty = Math.floor(this._camY() / TILE + p.y / TILE);
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
        return { x: x * TILE + 8, y: y * TILE + 12 };
      },
      _camX: function () {
        var cx = this._px().x;
        return Math.max(0, Math.min(this.map.w * TILE - 480, cx - 240));
      },
      _camY: function () {
        var cy = this._px().y;
        return Math.max(0, Math.min(this.map.h * TILE - 272, cy - 136));
      },

      /* ===== 渲染 ===== */
      render: function (x) {
        this._checkFlash();
        var camX = this._camX(), camY = this._camY();
        var self = this;

        /* ===== 遇敌转场：闪白 + **镜头缩放脉冲**（v0.23.0）=====
           用户口径："现在的游戏质感没有动画，还是很像 PPT"。
           只有闪白的话，观感像"画面闪了一下"（甚至像 bug）；加一次整体轻微放大再回落，
           才读得出"被拉进战斗"的仪式感（对标《宝可梦》的转场擦除/缩放）。
           ⚠️ 只缩**世界层**，HUD / 追踪栏 / 提示不缩 —— 它们缩了会糊且不像 UI。 */
        var _zoom = 1;
        if (this.flashDir === 1) _zoom = 1 + 0.06 * Math.sin(this.flash * Math.PI);
        /* 天劫震屏：用 `t` 的正弦做抖动（**不用 Math.random** —— 随机会让截图钉不住） */
        var _trib = this.trib;
        var _shk = _trib ? _trib.shake : 0;
        if (_zoom !== 1 || _shk) {
          x.save();
          x.translate(240 + (_shk ? Math.sin(_trib.t * 61) * _shk : 0),
            136 + (_shk ? Math.sin(_trib.t * 73) * _shk : 0));
          x.scale(_zoom, _zoom); x.translate(-240, -136);
        }

        /* 地面：整图已预烘好，每帧只 blit 视口这一块（1 次，而不是逐格 540 次）。
           详见 _bakeGround —— 逐格从 672×672 大纹理取子块实测每帧 7.8~22.6ms，
           室内大图直接把帧率压到 30fps，是整个游戏最浪费的一处。
           这一趟仍关平滑：源层按 K 烘、目标按 S 画，K===S 时就是 1:1 像素搬运。 */
        this._drawGroundLayer(x, camX, camY);

        /* 地形高度（v1.4.0）：抬升的格块 + 崖壁。
           位置：**铺地之上、明暗之下** —— 它是"地面的一部分"，
           要被 `_drawShade` 一起压暗才不显得浮。 */
        this._drawElevation(x, camX, camY);

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

        /* 装饰、家具、NPC 与玩家按 y 交错（家具按"最下一格"参与排序，否则会被玩家穿过去）。

           ⚠️ v0.98.0 **视口裁剪**（性能）：原先把**全图**装饰（field 539 个）都塞进
              `list` 参与排序与逐个绘制 —— 而一屏只有 20×12 = 240 格，实际看得见的
              不到一半。实测 field 的 render 要 10ms，裁剪后降到 ~1ms。
              做法：装饰在**入列前**就按屏幕矩形筛掉（排序量也同比减少，sort 是 O(n log n)）。
              余量给 2 格：树冠画在锚点**上方**（`DECOR_SIZE.tree.h` = 48 > TILE 24），
              只有 1 格余量时贴下边缘的树顶会被切掉。 */
        var mvL = camX - TILE * 2, mvT = camY - TILE * 3;
        var mvR = camX + G.game.W + TILE * 2, mvB = camY + G.game.H + TILE * 3;
        function inView(o) {
          var ox = o.x * TILE, oy = o.y * TILE;
          return ox >= mvL && ox <= mvR && oy >= mvT && oy <= mvB;
        }
        var list = [];
        this.map.decor.forEach(function (o) { if (inView(o)) list.push(o); });
        (this.map.md.furn || []).forEach(function (f) {
          list.push({ furn: f, x: f.x, y: f.y + (f.h || 1) - 1 });
        });
        (this.map.npcs || []).forEach(function (n) {
          list.push({ npc: n, x: n.x, y: n.y });
        });
        Object.keys(this.map.gatherNodes || {}).forEach(function (gk) {
          var g0 = self.map.gatherNodes[gk];
          if (!inView(g0)) return;                 /* 采集点同样裁剪（远处的不画） */
          list.push({ gather: g0, x: g0.x, y: g0.y });
        });
        /* 明雷（可见野怪）：参与 y 排序 —— 与玩家/NPC 同一套遮挡关系，
           否则会出现"野怪永远压在玩家身上"或反之的穿帮。
           ⚠️ 明雷**不裁剪** —— 它们是玩法对象（可以绕开、可以打），
              藏在屏幕外会让"看着空旷但一走就被打"变成不可理喻的体验。
              数量本就很少（每图几只），留着不影响性能。 */
        (this.map.roams || []).forEach(function (r) {
          list.push({ roam: r, x: r.x, y: r.y });
        });
        var pp = this._px();
        list.push({ player: true, x: pp.x / TILE, y: pp.y / TILE });
        list.sort(function (a, b) { return a.y - b.y; });
        list.forEach(function (o) {
          if (o.player) self._drawPlayer(x, camX, camY);
          else if (o.furn) self._drawFurn(x, o.furn, camX, camY);
          else if (o.npc) self._drawNpc(x, o.npc, camX, camY);
          else if (o.gather) self._drawGather(x, o.gather, camX, camY);
          else if (o.roam) self._drawRoam(x, o.roam, camX, camY);
          else self._drawDecor(x, o, camX, camY);
        });

        /* 宝箱 / Boss / 秘境裂隙 / 界门 */
        (this.map.md.special || []).forEach(function (sp) {
          if (sp.kind === 'chest') self._drawChest(x, sp, camX, camY);
          if (sp.kind === 'boss') self._drawBoss(x, sp, camX, camY);
          if (sp.kind === 'entrance') self._drawEntrance(x, sp, camX, camY);
          if (sp.kind === 'worldgate') self._drawWorldgate(x, sp, camX, camY);
          if (sp.kind === 'well') self._drawWellSpecial(x, sp, camX, camY);
        });

        /* 洞窟暗幕（火把可视范围）。bloodcave 是 cave 的换色变体（M1 §5.1），
           共用同一套暗幕 —— 判据收敛在 _isCaveGround() 一处，别在别处再写 'cave'。 */
        if (this._isCaveGround()) this._drawVeil(x, camX, camY);
        /* 室内：暖色环境光 + 暗角，做出"封闭空间"的收束感 */
        if (this.map.md.indoor) this._drawIndoor(x);

        /* 环境粒子（v0.22.0）：**放在暗幕/室内光之后** ——
           洞窟里的火星、阴气要在暗幕之上才有"发光"感，放下面会被一起压暗。 */
        this._drawParticles(x);

        if (_zoom !== 1) x.restore();      /* 世界层缩放到此为止，UI 不参与 */

        /* ===== 昼夜色温 + 体积雾（v0.99.0）=====
           ⚠️ **必须在这里**（世界层收口处、HUD 之前）—— 而不是 game.js 的最外层。
              理由：`_drawHUD` 是本场景的内部方法，它也在 `scene.render()` 之内。
              先前把色温层挂在 game.js（scene.render 之后）→ **把气血条/资源数字也染蓝了**
              （截图一眼看出：夜晚整条 HUD 偏色，读不清）。
              色温要染的是"世界"，不是"界面"。
           ⚠️ 也必须在 `_zoom` 恢复**之后** —— 否则闪白缩放会把色温层一起放大，
              边缘露出未染色的黑边。 */
        /* 世界层染色（v1.0.0）：**昼夜色温 + 天气压暗合并成一次全屏填充**。
           顺序（都在这里，`_drawHUD` 之前）：雾/天气粒子 → 合并染色 → 闪电。
           ⚠️ 合并是性能优化，数学已数值验证等价（差 0.000）。
           ⚠️ 粒子在下、整屏染色在上 —— 雨雪要看起来"在画面里"而不是"浮在暗纱上"。
           ⚠️ 闪电是"环境光"（把暗处照亮），所以放在染色之后。
           ⚠️ **必须在这里**（世界层收口处、`_drawHUD` 之前）：`_drawHUD` 是本场景
              内部方法、也在 scene.render() 之内，挂在 game.js 最外层会把 HUD 一起染色。 */
        G.game._renderFog(x);
        G.game._renderWeather(x);
        G.game._renderWorldTint(x);
        G.game._renderLightning(x);
        /* 天气视野压制（v1.1.0）：雨雪/瘴气**收窄可视范围** —— 让天气影响玩法而非只看。
           画在染色之后（它是"遮挡"，该压在最上层）、HUD 之前（不许挡界面）。
           ⚠️ 只有天气恶化了视野才画；晴天 `vision === 1` → 直接返回（零回归基线）。 */
        this._drawWeatherVeil(x);

        this._drawHUD(x);
        this._drawTracker(x);
        this._drawInteractHint(x, camX, camY);
        this._drawMark(x, camX, camY);
        if (!this.overlay) this._drawHint(x);
        if (this.flash > 0) {
          x.fillStyle = 'rgba(255,255,255,' + Math.min(1, this.flash) * .9 + ')';
          x.fillRect(0, 0, 480, 272);
        }

        /* ===== 面板滑入（v0.32.0）=====
           用户口径（多轮）：「整个游戏还是和 PPT 网页一样」。面板**直接出现**是典型症状之一。
           0.18s 内从下方 10px 滑到位 + 淡入（easeOutQuad）。
           ⚠️ 必须把**面板与按钮一起**包进同一个变换 —— 只滑面板不滑按钮会变成
              "面板在滑、按钮不动"，比不做还怪。
           ⚠️ 闪白放在变换**之外**（整屏白如果被平移 10px，顶上会留一条缝）。 */
        var _pk = 1;
        if (this.overlay && this.panelOpenAt != null) {
          _pk = Math.min(1, ((G.game.time || 0) - this.panelOpenAt) / 0.18);
        }
        var _pe = 1 - (1 - _pk) * (1 - _pk);
        var _popen = (this.overlay && _pk < 1);
        if (_popen) {
          x.save();
          x.globalAlpha = 0.35 + 0.65 * _pe;
          x.translate(0, (1 - _pe) * 10);
        }
        /* 天劫是**核心覆盖层**（不属于任何场景的 hooks），优先分派 */
        if (this.overlay === 'tribulation' && G.Overlays.renderTribulation) {
          G.Overlays.renderTribulation(x, this);
        } else if (this.overlay === 'storyevent' && G.Data.StoryEvents) {
          G.Data.StoryEvents.render(x, this);
        } else if (hooks.renderOverlay && this.overlay) hooks.renderOverlay(x, this);
        for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);
        if (_popen) x.restore();
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
        var cx = (e.x0 + e.x1 + 1) / 2 * TILE - camX;
        var cy = e.y * TILE - camY + 10 - LIFT;
        var rx = ((e.x1 - e.x0 + 1) * TILE) / 2 + 3;
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

        /* 目的地名牌：**只在鼠标悬浮时显示**。
           用户口径：「这个下一个地图的名称信息是鼠标放到传送门上面悬浮提示，不需要固定展示」。
           固定挂着会长期占屏，多个传送门的名牌还会互相挤。 */
        var mm = G.Input && G.Input.mouse;
        var hov = mm && mm.x >= cx - 22 && mm.x <= cx + 22 && mm.y >= cy - 40 && mm.y <= cy + 12;
        if (e.label && hov) {
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
        var px = f.x * TILE - camX, py = f.y * TILE - camY;
        var w = (f.w || 1) * TILE, h = (f.h || 1) * TILE;
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
             与"逐格取 (tx*TILE)%TS 子块"逐像素等价，blit 次数从整图格数
             （field 有 2000 格）降到 6 次左右，只有路格与路缘才逐格补画。 */
      _ensureGround: function () {
        var K = G.Art.K, pal = this._pal();
        /* key 里带上 K 与调色板：窗口缩放改了倍率、或轮回换了世界，
           旧层必须作废，否则会残留错误倍率/配色的地面。 */
        var key = this.mapId + '|' + K + '|' + pal.ground + '|' + pal.rock;
        if (this._groundLayer && this._groundKey === key) return;
        var m = this.map;
        var w = m.w * TILE, h = m.h * TILE;
        var c = document.createElement('canvas');
        c.width = Math.round(w * K); c.height = Math.round(h * K);
        var g = c.getContext('2d');
        g.imageSmoothingEnabled = false;
        g.setTransform(K, 0, 0, K, 0, 0);

        /* 1) 基础地面：整张周期纹理按 TS 对齐平铺（超出画布的部分自动裁掉） */
        var TS = G.Art.GROUND_TS;
        /* texKey：区域专属底图（md.tex = 区域 id）；没有则退回该地面类型的通用图 */
        var base = G.Art.groundTex(this._baseType(), pal, this.map.md.tex);
        for (var oy = 0; oy < h; oy += TS)
          for (var ox = 0; ox < w; ox += TS)
            g.drawImage(base, ox, oy, TS, TS);

        /* 2) 道路：整片软蒙版 + 噪声羽化，路面像被踩进土里（v0.60，用户第 5 点） */
        this._softRoads(m, g, K, pal);

        this._groundLayer = c;
        this._groundKey = key;
      },

      /* 软道路：路面层按噪声羽化的覆盖率与基础地面逐像素混合。
         边缘只向路面内侧磨损（不向外铺），噪声取世界像素坐标 → 长路边连续、不重复。 */
      _softRoads: function (m, g, K, pal) {
        var wl = m.w * TILE, hl = m.h * TILE;
        var W = Math.round(wl * K), H = Math.round(hl * K);
        var TS = G.Art.GROUND_TS;
        /* 路面层（周期平铺，与基础同对齐） */
        var pc = document.createElement('canvas'); pc.width = W; pc.height = H;
        var pctx = pc.getContext('2d');
        pctx.setTransform(K, 0, 0, K, 0, 0); pctx.imageSmoothingEnabled = false;
        var ptex = G.Art.groundTex('path', pal);
        for (var yy = 0; yy < hl; yy += TS)
          for (var xx = 0; xx < wl; xx += TS) pctx.drawImage(ptex, xx, yy, TS, TS);
        /* 二元蒙版：透明底 + 白色路块 */
        var bc = document.createElement('canvas'); bc.width = W; bc.height = H;
        var bctx = bc.getContext('2d');
        bctx.fillStyle = '#ffffff';
        for (var ty = 0; ty < m.h; ty++)
          for (var tx = 0; tx < m.w; tx++)
            if (m.ground[ty][tx].t === 'path') bctx.fillRect(tx * TILE * K, ty * TILE * K, TILE * K, TILE * K);
        /* 路缘不规则侵蚀：草/土啃进路面（destination-out 软黑斑） */
        var ERSIDES = [['N', 0, -1], ['S', 0, 1], ['W', -1, 0], ['E', 1, 0]];
        bctx.globalCompositeOperation = 'destination-out';
        for (var ey = 0; ey < m.h; ey++)
          for (var ex = 0; ex < m.w; ex++) {
            if (m.ground[ey][ex].t !== 'path') continue;
            for (var es = 0; es < 4; es++) {
              var edf = ERSIDES[es], enx = ex + edf[1], eny = ey + edf[2];
              var outN = enx < 0 || eny < 0 || enx >= m.w || eny >= m.h || m.ground[eny][enx].t !== 'path';
              if (!outN) continue;
              var ev = (Math.imul(ex, 73856093) ^ Math.imul(ey, 19349663) ^ Math.imul(es, 83492791)) >>> 0;
              var stamp = G.Art.edgeErode(edf[0], ev % 3, K);
              bctx.drawImage(stamp, ex * TILE * K, ey * TILE * K);
            }
          }
        bctx.globalCompositeOperation = 'source-over';
        /* 羽化（blur，仅 drawImage，不读像素 → file:// 不污染）；无 filter 时退回硬边 */
        var fc = document.createElement('canvas'); fc.width = W; fc.height = H;
        var fctx = fc.getContext('2d');
        fctx.filter = 'blur(' + Math.round(2.6 * K) + 'px)';
        fctx.drawImage(bc, 0, 0); fctx.filter = 'none';
        /* 蒙版裁路面（destination-in 用 alpha），再叠到基础地面 */
        pctx.setTransform(1, 0, 0, 1, 0, 0);
        pctx.globalCompositeOperation = 'destination-in';
        pctx.drawImage(fc, 0, 0, W, H);
        pctx.globalCompositeOperation = 'source-over';
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(pc, 0, 0);
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

      /* ===== 地形高度的逐格绘制（v1.4.0）=====
         玩家口径：「场景里没有区分道路上坡下坡，想想《烟雨江湖》的上坡下坡、
                   《宝可梦》的瓦片分层」。
         **做法不引入 3D**：每格有 `elev`（0/1/2），绘制时整格**上移 `elev*STEP` px**，
         并在**朝南的落差边**画一道崖壁（`_drawCliff`）—— 这正是宝可梦 GBA 的手法。
         ⚠️ 只对**有高度的图**生效：`_elevMax() === 0` 时**整段跳过**，
            手写图（town/field/…）逐像素不变（零回归）。
         ⚠️ 绘制顺序：**从低到高**（先画 elev 小的）—— 高地后画才会压住低地的崖壁，
            反过来高地会被低地盖住（成了"坑"而不是"台"）。
         ⚠️ 地面整层 `_groundLayer` 已经画过一遍平铺底，这里是在它之上**再叠**
            抬升后的格块 —— 所以底层会透出一点，正好当"坡地的阴影面"。 */
      _drawElevation: function (x, camX, camY) {
        var emax = this._elevMax();
        if (!emax) return;
        var m = this.map, pal = this._pal();
        var base = G.Art.groundTex(this._baseType(), pal, m.md.tex);
        var TS = G.Art.GROUND_TS;
        /* 视口范围（多留 2 格余量：高度会把格块往上推，边缘那几格仍要画） */
        var x0 = Math.max(0, Math.floor(camX / TILE) - 1);
        var x1 = Math.min(m.w - 1, Math.ceil((camX + 480) / TILE) + 1);
        var y0 = Math.max(0, Math.floor(camY / TILE) - 1);
        var y1 = Math.min(m.h - 1, Math.ceil((camY + 272) / TILE) + 4);
        /* 按 elev 分层画：低 → 高 */
        for (var lv = 1; lv <= emax; lv++) {
          for (var ty = y0; ty <= y1; ty++) {
            for (var tx = x0; tx <= x1; tx++) {
              var g = m.ground[ty][tx];
              if ((g.elev || 0) !== lv) continue;
              var px = tx * TILE - camX;
              var py = ty * TILE - camY - lv * ELEV_STEP;
              /* 格块：从周期大纹理按世界坐标取子块（与底层同一位置 → 接缝连续） */
              var sx = ((tx * TILE) % TS + TS) % TS;
              var sy = ((ty * TILE) % TS + TS) % TS;
              G.Art.groundBlit(x, g.t === 'path' ? 'path' : this._baseType(),
                pal, sx, sy, px, py);
              /* 崖壁/坡道：朝南（+y）若是低地或边界，画落差面 */
              var sN = (ty + 1 > m.h - 1) ? null : m.ground[ty + 1][tx];
              var sE = (sN === null) ? 0 : (sN.elev || 0);
              if (sE < lv) {
                this._drawCliff(x, px, py + TILE, TILE, (lv - sE) * ELEV_STEP, pal);
              }
            }
          }
        }
      },

      /* 崖壁：一格宽的竖向落差面 —— 读起来是"土坡/岩壁的截面"。
         三层结构（与 2.5D 建筑的"落地投影 + 墙脚基座"同一套语言）：
           · 主体    `pal.dark`（比地面暗一档的**土色**，不是把 ground 直接调暗 ——
                     草地绿调暗会变橄榄色，在草地上像"砖块"）
           · 顶部亮边 受光面（与地面相接处那条线，"台"靠它读出来）
           · 底部暗边 与下层地面接壤的阴影
         ⚠️ 基座色取 `pal.dark` 而不是 `shade(pal.ground, -0.3)`：
            后者在绿地上会算出偏红棕的色，像贴了块砖。 */
      _drawCliff: function (x, px, py, w, hgt, pal) {
        if (hgt <= 0) return;
        x.save();
        /* 主体：土层暗色（用 pal.dark —— 它本来就是"这一带地面的暗部"） */
        x.fillStyle = pal.dark || G.Art.shade(pal.ground, -0.30);
        x.fillRect(px, py, w, hgt);
        /* 顶部亮边：与地面相接处受光 */
        var topH = Math.max(1, Math.round(hgt * 0.22));
        x.fillStyle = G.Art.shade(pal.ground, 0.10);
        x.fillRect(px, py, w, topH);
        /* 底部暗边：与下一层地面接壤的阴影 */
        var botH = Math.max(1, Math.round(hgt * 0.30));
        x.fillStyle = G.Art.shade(pal.dark, -0.34);
        x.fillRect(px, py + hgt - botH, w, botH);
        /* 竖向纹理：2 道（按坐标派生，确定） —— 纯色块太"塑料"，
           竖纹让它读成"被冲刷出的土壁"。 */
        x.fillStyle = G.Art.shade(pal.dark, -0.20);
        var h1 = ((px * 73856093) ^ (py * 19349663)) >>> 0;
        if (hgt >= 5) {
          x.fillRect(px + (h1 % 5) + 2, py + topH, 1, Math.max(1, hgt - topH - botH));
          x.fillRect(px + (h1 % 7) + 9, py + topH, 1, Math.max(1, hgt - topH - botH));
        }
        x.restore();
      },

      /* 该图的最大高度（0 = 纯平地，直接跳过整个高度层） */
      _elevMax: function () {
        var m = this.map;
        if (this._elevMaxCache != null && this._elevMaxKey === this.mapId) return this._elevMaxCache;
        var mx = 0;
        for (var y = 0; y < m.h; y++)
          for (var x = 0; x < m.w; x++) {
            var e = m.ground[y][x].elev || 0;
            if (e > mx) mx = e;
          }
        this._elevMaxCache = mx; this._elevMaxKey = this.mapId;
        return mx;
      },

      /* 该格的高度偏移（供角色/物件绘制用；无高度图返回 0） */
      _elevAt: function (tx, ty) {
        var m = this.map;
        if (!(this._elevMax() > 0)) return 0;
        var g = m.ground[ty] && m.ground[ty][tx];
        return ((g && g.elev) || 0) * ELEV_STEP;
      },

      /* 单个路格：路面纹理块 + 与基础地面交界处的路缘镶边。
         只在预烘地面层时调用一次（路格是少数，基础地面走平铺）。 */
      _drawPathTile: function (x, tx, ty) {
        var m = this.map, pal = this._pal();
        var px = tx * TILE, py = ty * TILE;

        /* 从 224×224 周期大纹理里按"世界坐标"取 16×16 子块 ——
           与基础地面的平铺取到的是同一个位置，接缝处完全连续。 */
        var TS = G.Art.GROUND_TS;
        var sx = ((tx * TILE) % TS + TS) % TS;
        var sy = ((ty * TILE) % TS + TS) % TS;
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
        var px = s.x * TILE - camX, py = s.y * TILE - camY;
        if (px > 480 || px + s.w * TILE < 0 || py > 272 || py + s.h * TILE < 0) return;
        var pal = this._pal();
        var art = s.kind === 'house' ? G.Art.house(s, pal)
          : s.kind === 'ruin' ? G.Art.ruin(s, pal)
            : s.kind === 'gate' ? G.Art.gate(s, pal) : null;
        if (!art) return;
        var bx0 = px + (art.ox || 0), by0 = py + (art.oy || 0);
        var bw0 = art.w, bh0 = art.h;

        /* ===== 立体感 C：建筑基座 + 落地投影（v0.28.0，零出图）=====
           用户口径：「我们能不能做得比较有 3D 的感觉，2.5D 俯视角我们能用吗」。
           建筑素材本身已经有"屋顶 + 正面墙 + 门窗"（`A.house` 程序化绘制），
           缺的是**它与地面的接触关系** —— 没有基座、没有投影，建筑就像"贴在地上的一张图"。
           补两层（都画在**建筑之前**，先影后物）：
             ① 落地投影：底边往下 6px 的柔和暗影（越往下越淡）
             ② 墙脚基座：底边往下 4px 的暗色带 + 上缘一线亮边（受光面）
           ⚠️ 这两层会**越出建筑自己的格子** —— 那正是 2.5D 的观感来源
              （建筑向观察者方向"长"出一截），不是越界 bug。 */
        var inset = bw0 * 0.06;
        var gx0 = bx0 + inset, gw = bw0 - inset * 2;
        x.save();
        var grd = x.createLinearGradient(0, by0 + bh0 - 2, 0, by0 + bh0 + 7);
        grd.addColorStop(0, 'rgba(0,0,0,0.34)');
        grd.addColorStop(1, 'rgba(0,0,0,0)');
        x.fillStyle = grd;
        x.fillRect(gx0, by0 + bh0 - 2, gw, 9);
        x.restore();
        x.save();
        x.fillStyle = 'rgba(24,20,18,0.55)';
        x.fillRect(gx0, by0 + bh0 - 4, gw, 4);
        x.fillStyle = 'rgba(255,246,214,0.16)';
        x.fillRect(gx0, by0 + bh0 - 4, gw, 1);
        x.restore();

        G.Art.blit(x, art, px, py);
        this._drawPlaque(x, s, bx0, by0, bw0, bh0);
      },

      /* 建筑匾额（v0.16.0）：**建筑上写它当前的名字**（用户口径）。
         ⚠️ 名字一律**矢量程序化绘制**，绝不烘进素材图 —— 两个硬理由：
           ① 文生图 / 像素图里的中文必然是乱码；
           ② 同一张建筑图要复用到不同建筑（药铺 / 刘家小院…），名字得跟着数据走。
         位置取"屋顶上方"而不是贴在墙上：屋墙从上到下被屋檐、两扇窗、门占满，
         没有能放下 4 个字的空档（4 行高的房子只有 8px 可用）。
         顶到屏幕上沿时改为压进屋顶内侧，避免被裁掉。 */
      /* 建筑悬浮名签（v0.54.0）：鼠标悬浮显示「名称 + 功能说明」。
         复用全局 G.UI.hover 富卡（帧末置顶、触屏自动静默、自动翻面不越界），
         不再自绘小匾额；面板打开时不挂。 */
      _drawPlaque: function (x, s, bx0, by0, bw0, bh0) {
        if (this.overlay) return;
        G.UI.hover({ x: bx0, y: by0, w: bw0, h: bh0 }, structureInfo(s));
      },

      _drawGather: function (x, o, camX, camY) {
        var done = (G.Gather && G.Gather.gatheredToday)
          ? G.Gather.gatheredToday(G.game.save, this.mapId, o) : false;
        var px = Math.round(o.x * TILE - camX), py = Math.round(o.y * TILE - camY);
        var id = G.Overlays.itemIconId ? G.Overlays.itemIconId(o.mat) : o.mat;
        var SZ = 22;
        var ic = G.Art.itemIcon(id, SZ);
        var ph = o.x * 0.9 + o.y * 0.5;
        var bob = done ? 0 : Math.sin(G.game.time * 2.2 + ph) * 1.1;
        x.save();
        x.globalAlpha = done ? 0.22 : 1;
        if (!done) {
          var glow = o.cat === 'herb' ? 'rgba(120,200,140,0.20)' : 'rgba(150,180,220,0.20)';
          x.fillStyle = glow;
          x.beginPath(); x.ellipse(px + 8, py + 14, 8, 3.2, 0, 0, 7); x.fill();
        }
        var bx = px + 8 - SZ / 2, by = py + 15 - SZ + bob;
        x.drawImage(ic.c, bx + ic.ox, by + ic.oy, ic.w, ic.h);
        if (!done) {
          var sp = (G.game.time * 0.8 + ph) % 2.2;
          x.globalAlpha = (1 - sp / 2.2) * 0.7;
          x.fillStyle = o.cat === 'herb' ? '#cfeecb' : '#cfe0f5';
          x.fillRect(px + 8 + Math.sin(ph) * 3, py + 12 - sp * 7, 1.4, 1.4);
        }
        x.restore();
      },

      _drawDecor: function (x, o, camX, camY) {
        var px = o.x * TILE - camX, py = o.y * TILE - camY;
        var h1 = (((o.x * 73856093) ^ (o.y * 19349663)) >>> 0);
        var v = (h1 % 3 + 3) % 3;
        /* 缩放走 3 档预烘（见 A.decorScaled）：同一变体在每个位置都一模一样，
           一眼就是复制粘贴，所以按位置给一点缩放与水平翻转 —— 但缩放必须是
           预烘好的整数尺寸，否则每帧一次滤波缩放既费帧又糊画面。 */
        var art = (o.t === 'tree' || o.t === 'rock') ? paintedProp(o.t, v) : null;
        if (!art) art = G.Art.decorScaled(o.t, this._pal(), v, h1 % 3);
        if (!art) return;

        /* ===== 摇摆（v0.22.0）=====
           只有 `tree` 是"软"的（rock/fence/well/wall 都是硬物，摇了就是穿帮）。
           ⚠️ **相位必须由格子坐标派生** —— 全场同步摆动比不动更假。
           幅度 1.2px：再大就会看到树根离地。 */
        /* ===== 摇摆（v0.22.0，v0.25.0 改为**绕根部旋转**）=====
           只有 `tree` 是"软"的（rock/fence/well/wall 都是硬物，摇了就是穿帮）。
           ⚠️ **必须绕树根旋转，不能整体平移** —— 平移会把树根一起挪走，
              观感是"树在飘/在滑"（截图反馈："这些树在动，看起来很怪"）。
              枢轴取**树底中心**，角度 ±0.7°：树冠摆幅约 1.5px，树根不动。
           ⚠️ 相位由格子坐标派生 —— 全场同步摆动比不动更假。 */
        var sway = 0;
        if (o.t === 'tree') {
          var ph = (o.x * 0.7 + o.y * 0.3) % 6.2832;
          sway = Math.sin((G.game.time || 0) * 1.6 + ph) * 0.012;
        }
        var bx = px + art.ox, by = py + art.oy;
        var pivX = bx + art.w / 2, pivY = by + art.h;

        /* ===== 接触阴影（v0.26.0）=====
           用户口径：「是我们的视角有问题吗？烟雨江湖怎么看起来好像更加立体」。
           立体感**不来自透视计算**（2D 没有真透视），而来自"高度"的视觉线索；
           其中**接触阴影最便宜、最有效** —— 阴影是大脑判断"这东西是浮在地上还是贴在地上"的第一线索。
           以前只有主角有影子、装饰物一个都没有 → 一眼就是"贴纸"。
           ⚠️ 阴影按**物件底部**（`by + art.h`）画，不是顶部 —— 画在顶部就读不出"立在地上"。
           ⚠️ 用**椭圆**不是圆：俯视下的落地影一定是压扁的。 */
        x.save();
        x.fillStyle = 'rgba(0,0,0,0.24)';
        x.beginPath();
        x.ellipse(bx + art.w / 2, by + art.h - art.h * 0.06,
          art.w * 0.30, art.h * 0.085, 0, 0, 6.2832);
        x.fill();
        x.restore();

        x.save();
        if (sway) { x.translate(pivX, pivY); x.rotate(sway); x.translate(-pivX, -pivY); }
        /* ===== 立体感 B：高物件纵向拉伸（v0.28.0，零出图）=====
           树的"高"在正俯视里读不出来（只有一个圆冠）。以**底部为锚**纵向拉高 14% ——
           树冠因此往上长，树根仍钉在原地（拉锚在中心会变成"整棵树在飘"）。
           ⚠️ 只对 `tree` 生效：石头/井/围栏拉高就变成"被扯长了"。 */
        var stretch = (o.t === 'tree') ? 1.14 : 1;
        if (stretch !== 1) {
          x.translate(bx + art.w / 2, by + art.h);
          x.scale(1, stretch);
          x.translate(-(bx + art.w / 2), -(by + art.h));
        }
        if ((h1 >> 10) & 1) {
          x.translate(bx + art.w, by);
          x.scale(-1, 1);
          x.drawImage(art.c, 0, 0, art.w, art.h);
        } else {
          x.drawImage(art.c, Math.round(bx), Math.round(by), art.w, art.h);
        }
        x.restore();
      },

      /* ===== 环境粒子层（v0.22.0）=====
         用户口径："现在的游戏质感没有动画，还是很像 PPT"。
         根因是**场景里 90% 的像素在两次刷新之间完全一样** → 感知上就是静止。
         粒子是**最便宜的一层"永远在动"**：22 个 2px 点，按区域主题换配色。
         ⚠️ 初位置由 mapId 派生（确定性，同一张图每次都一样）；
            位置随 `G.game.time` 演进 —— 截图能钉住，且不每帧重算随机。 */
      _ensureParticles: function () {
        var kind = this._baseType ? this._baseType() : 'grass';
        var tex = (this.map && this.map.md && this.map.md.tex) || kind;
        var key = this.mapId + '|' + tex + '|' + kind;
        if (this._ptKey === key) return;
        this._ptKey = key;
        var col = G.Art.particleColor ? G.Art.particleColor(tex, kind) : null;
        this._ptCol = col;
        if (!col) { this._pt = []; return; }
        var rnd = G.Art.rnd(this.mapId.length * 7919 + this.mapId.charCodeAt(0) * 131);
        this._pt = [];
        for (var i = 0; i < 26; i++) {
          this._pt.push({
            x: rnd() * 480, y: rnd() * 272,
            vx: 6 + rnd() * 14, vy: 9 + rnd() * 16,
            s: 2 + Math.floor(rnd() * 2), ph: rnd() * 6.2832
          });
        }
      },
      _drawParticles: function (x) {
        this._ensureParticles();
        if (!this._pt || !this._pt.length) return;
        var t = G.game.time || 0;
        x.save();
        x.fillStyle = this._ptCol;
        for (var i = 0; i < this._pt.length; i++) {
          var p = this._pt[i];
          var px = (p.x + t * p.vx + Math.sin(t * 1.1 + p.ph) * 9) % 480;
          var py = (p.y + t * p.vy) % 272;
          if (px < 0) px += 480;
          x.globalAlpha = 0.45 + 0.45 * Math.abs(Math.sin(t * 0.9 + p.ph));
          x.fillRect(px | 0, py | 0, p.s, p.s);
        }
        x.restore();
      },

      _drawWellSpecial: function (x, sp, camX, camY) {
        var px = sp.x * TILE - camX, py = sp.y * TILE - camY;
        var art = paintedSingle('prop.well', 30);
        if (!art) return;
        var bx = px + art.ox, by = py + art.oy;
        x.save();
        x.fillStyle = 'rgba(0,0,0,0.22)';
        x.beginPath();
        x.ellipse(bx + art.w / 2, by + art.h - 3, art.w * 0.32, art.h * 0.1, 0, 0, 6.2832);
        x.fill();
        x.restore();
        x.drawImage(art.c, Math.round(bx), Math.round(by), art.w, art.h);
        if (!this.overlay) {
          G.UI.hover({ x: bx, y: by, w: art.w, h: art.h },
            { title: '水井', text: '清冽井水，饮之可解渴、恢复少许气血' });
        }
      },

      _drawChest: function (x, sp, camX, camY) {
        var opened = G.game.save.chestsOpened.indexOf(sp.id) >= 0;
        var px = sp.x * TILE - camX, py = sp.y * TILE - camY;
        var art = G.Art.chest(opened);
        G.Art.blit(x, art, px, py);
      },

      _drawBoss: function (x, sp, camX, camY) {
        var px = sp.x * TILE - camX, py = sp.y * TILE - camY;
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
        var px = sp.x * TILE - camX, py = sp.y * TILE - camY;
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
        var px = sp.x * TILE - camX, py = sp.y * TILE - camY;
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

      /* 天气视野压制（v1.1.0，用户口径「雨雪降低视野」）：
         以玩家为中心收窄一圈"看得清"的范围，外面压上雨/雪的雾色。
         ⚠️ **晴天直接返回**（`vision === 1`）—— 保证不改晴天下的任何像素（零回归基线）。
         ⚠️ 半径不是"硬边圆圈"：用**两段渐变**（内圈透明 → 中圈半透 → 外圈实）
            才像"能见度下降"，单段硬边会像"戴了个望远镜"。
         ⚠️ 洞窟/室内**没有天气**（`weatherId()` 返回 none → vision=1）→ 自然不画。 */
      _drawWeatherVeil: function (x) {
        var vs = G.game.visionScale ? G.game.visionScale() : 1;
        if (vs >= 0.995) return;                       /* 晴天 / 无天气：零回归 */
        var pp = this._px();
        var camX = this._camX(), camY = this._camY();
        var sx = pp.x - camX, sy = pp.y - camY;
        /* 基准可视半径 190 → 按天气倍率收缩（瘴气 0.58 → 110） */
        var R = 190 * vs;
        /* 雾色按天气取（雨=冷灰蓝、雪=亮白、瘴气=黄绿）—— 与粒子同源，读起来一致 */
        var wx = G.game._weatherFor ? G.game._weatherFor(this.mapId) : null;
        var col = '150,168,196';                       /* 默认冷灰 */
        if (wx && wx.id === 'snow') col = '226,236,248';
        else if (wx && wx.id === 'miasma') col = '140,164,96';
        else if (wx && wx.id === 'storm') col = '120,134,162';
        x.save();
        var rg = x.createRadialGradient(sx, sy, R * 0.30, sx, sy, R);
        rg.addColorStop(0, 'rgba(' + col + ',0)');
        rg.addColorStop(0.55, 'rgba(' + col + ',0.30)');
        rg.addColorStop(1, 'rgba(' + col + ',0.62)');
        x.fillStyle = rg;
        x.fillRect(0, 0, 480, 272);
        x.restore();
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

      /* ===== 御剑飞行（v0.22.0）=====
         金丹境起可御剑。三条效果叠起来才是"飞"：
           ① **离地**：角色抬高 6px + 影子变小变淡（2D 俯视里唯一有效的高度线索）
           ② **速度**：移速 ×1/0.55 ≈ 1.8 倍
           ③ **通行**：可越过树/石/围栏/水井（低矮物），仍挡边界·建筑·墙·家具
         另有收益：**飞行时不触发暗雷**。
         ⚠️ 室内一律禁飞（空间小，飞起来会穿家具）。 */
      _flying: function () {
        if (!this.map || !this.map.md || this.map.md.indoor) return false;
        var save = G.game.save;
        return !!(save && save.fly && G.Player.canFly && G.Player.canFly(save));
      },
      /* 当前骑乘的成年可骑灵兽（仅室外）。室内/不可骑/被放生 → null。 */
      _riding: function () {
        var save = G.game.save;
        if (!save || !save.riding || !this.map || !this.map.md || this.map.md.indoor) return null;
        var bst = G.Beasts.byUid(save, save.riding.uid);
        return bst && G.Data.beasts.canRide(bst) ? bst : null;
      },
      /* 骑乘飞行坐骑（ride.terrains 含 air）：可如御剑般越过软障 */
      _mountAir: function () {
        var bst = this._riding();
        if (!bst) return false;
        var ri = G.Data.beasts.rideInfo(bst.id);
        return !!(ri && ri.terrains && ri.terrains.indexOf('air') >= 0);
      },
      /* 可越过的低矮物：只有这几类。`wall`/`wallrock` 是墙，绝不可越 */
      _ensureFlyGrid: function () {
        if (this._flyKey === this.mapId) return;
        this._flyKey = this.mapId;
        var w = this.map.w, h = this.map.h, g = [];
        for (var y = 0; y < h; y++) { g[y] = []; for (var x = 0; x < w; x++) g[y][x] = false; }
        var SOFT = { tree: 1, rock: 1, fence: 1, well: 1 };
        (this.map.decor || []).forEach(function (d) {
          if (SOFT[d.t] && d.x >= 0 && d.y >= 0 && d.x < w && d.y < h) g[d.y][d.x] = true;
        });
        this._flyOver = g;
      },
      /* 通行判定**唯一入口**：走路与飞行都走它，别在别处再写 `map.solid[...]` */
      _blocked: function (x, y) {
        if (x < 0 || y < 0 || x >= this.map.w || y >= this.map.h) return true;
        if (!this.map.solid[y][x]) return false;
        if (!this._flying() && !this._mountAir()) return true;
        this._ensureFlyGrid();
        return !this._flyOver[y][x];
      },

      _drawPlayer: function (x, camX, camY) {
        var pp = this._px();
        var px = pp.x - camX, py = pp.y - camY;
        var HW = G.Sprites.HERO_W, HH = G.Sprites.HERO_H;

        /* ===== 程序化行走 / 待机动效（v0.22.0）=====
           **为什么这么做**：行走图的三帧 `.0/.1/.2` 登记的是**同一张图**，
           所以"走路"过去只有 1px 上抬 —— 观感就是**滑行**（用户口径："像 PPT"）。
           这里用**叠加变换**补出步伐感，**零出图**：
             · 浮动：一步一起一落（`|sin(π·步内进度)|`）
             · 倾摆：左右交替 ±2°（按步数奇偶换向 —— 同向摆会像抽搐，不是走路）
             · 挤压：y 缩放 ±3%（落地压扁、抬脚拉长）
             · 待机：极缓慢呼吸（周期 ≈4.8s），幅度远小于走路
           ⚠️ 时间源一律用 `G.game.time`（**不是** `performance.now()`）——
              否则截图与契约都钉不住（本项目踩过这个坑）。
           ⚠️ 变换以**脚底**为锚点：绕中心转/缩放会让人物"飘起来"。 */
        /* ⚠️ 相位用 **`_stepN + mt`**，不能用裸 `mt`：
           `mt` 每走完一格就归零，相位会在格子边界**突然回跳** → 观感是"卡顿"
           （截图反馈："主角的动画帧不连贯，导致看起来是卡顿的"）。
           加上已走格数后相位跨格连续；停步时 mt=0 → 相位落在整数 → 浮动自然归零，不会跳。 */
        var step = this.moving ? ((this._stepN || 0) + this.mt) : 0;
        var bob = 0, tilt = 0, sq = 1;
        /* ===== 待机小动作（v1.1.0，用户口径「主角待机随机小动作（理袖、远眺）」）=====
           设计：站着时每隔一段时间**自己动一下** —— 玩家会觉得"这人还活着"。
           两种动作：
             · 理袖：轻微侧倾 + 横向收（像拂了下衣袖）
             · 远眺：头部带动整体微微上抬 + 稍后仰
           ⚠️ 用**周期 + 固定相位**而不是 `Math.random()` —— 随机会让截图与契约
              钉不住（本项目老坑）。用 `time` 与一个按角色位置派生的相位，
              同一位置同一时刻的动作**完全可复现**。
           ⚠️ **幅度必须极小**（侧倾 <2°、位移 <1px）—— 用户明确反馈过
              "人物上下浮动很怪"；大动作会让"静止"读成"抽动"。
           ⚠️ **只在待机时叠加**（走路有走路自己的 bob/tilt），
              两者同时叠加会互相干扰、节奏打架。 */
        if (!this.moving) {
          /* 周期 7.3s：一周期内 0~0.5s 做一次动作（占比 7%，其余时间真静止） */
          var CYC = 7.3, ACT = 0.5;
          var ph0 = (this._px().x * 0.017 + this._px().y * 0.031);
          var phase = ((G.game.time + ph0) % CYC + CYC) % CYC;
          if (phase < ACT) {
            var u = phase / ACT;                       /* 0..1 */
            var env = Math.sin(u * Math.PI);           /* 起收两端为 0（不会突然开始/结束） */
            /* 两种动作按相位奇偶交替：偶数周期理袖、奇数周期远眺 */
            var cycN = Math.floor((G.game.time + ph0) / CYC);
            if (cycN % 2 === 0) {
              tilt = 0.030 * env;                      /* 理袖：侧倾 */
              sq = 1 - 0.020 * env;                    /* 横收（像收袖） */
            } else {
              bob = -1.0 * env;                        /* 远眺：极轻上抬 */
              tilt = -0.018 * env;                     /* 稍后仰 */
            }
          }
        }
        if (this.moving) {
          bob = -Math.abs(Math.sin(step * Math.PI)) * 2.2;
          tilt = Math.sin(step * Math.PI) * (((this._stepN || 0) % 2) ? 0.035 : -0.035);
          sq = 1 + Math.sin(step * Math.PI * 2) * 0.03;
        }
        /* ⚠️ **待机不做呼吸浮动**（用户口径：「人物在上下浮动，不像立体感，反而很怪」）——
           站立时 0.6px 的上下浮动在像素游戏里读不出"呼吸"，只读得出"在抖/在飘"。
           动效集中在**走路**上就够了：静止时人物就该是静止的。 */
        

        /* 落地投影：跟着角色尺寸走，否则大角色会"浮"在影子上。
           走路时影子**随浮动反向缩放/变淡**（人抬高 → 影子变小）——
           这是 2D 俯视里最有效的"离地"线索（御剑飞行也复用它）。 */
        /* ===== 御剑飞行（v0.22.0）：抬高 + 剑光 + 影子缩小 =====
           2D 俯视没法真的表现高度，能用的只有三条线索，全用上：
             · 抬高 6px   · 影子变小变淡   · 脚下一道剑光（程序化，零出图） */
        var flying = this._flying();
        var mountAir = !flying && this._mountAir();
        if (flying) bob -= 6;
        else if (mountAir) bob -= 4;

        var shk = (1 + bob / 8) * ((flying || mountAir) ? 0.78 : 1);
        x.save();
        x.globalAlpha = Math.max(0.06, (0.30 + bob / 40) * (flying ? 0.7 : 1));
        x.fillStyle = '#000';
        x.beginPath();
        x.ellipse(px, py - 1, HW * 0.33 * shk, HW * 0.13 * shk, 0, 0, 6.2832);
        x.fill();
        x.restore();

        if (flying) {
          /* 剑光：斜置的青白光刃 + 外发光，画在脚下、角色之前 */
          x.save();
          x.translate(px, py + 1);
          x.rotate(-0.42);
          x.globalAlpha = 0.30; x.fillStyle = 'rgba(120,190,255,0.9)';
          x.fillRect(-22, -3.5, 44, 7);
          x.globalAlpha = 0.85; x.fillStyle = 'rgba(196,232,255,0.95)';
          x.fillRect(-15, -1, 30, 2);
          x.restore();
          /* 移动时的上冲气流（两条短线，随步内进度伸缩） */
          if (this.moving) {
            var puff = 1 - Math.abs(Math.sin(step * Math.PI));
            x.save();
            x.globalAlpha = 0.25 + 0.25 * puff;
            x.fillStyle = 'rgba(180,220,255,0.8)';
            x.fillRect(px - 9, py + 4, 3, 6 + 4 * puff);
            x.fillRect(px + 6, py + 4, 3, 6 + 4 * puff);
            x.restore();
          }
        }

        var rdBeast = (!this._flying()) ? this._riding() : null;
        if (rdBeast) {
          var mspr = G.Sprites.beastResolve(rdBeast.id, 'mount');
          x.save();
          x.translate(px, py + 2);
          if (this.dir === 'left') x.scale(-1, 1);
          x.drawImage(mspr, -19, -30, 38, 36);
          x.restore();
        }
        var view = this.dir === 'down' ? 'down' : this.dir === 'up' ? 'up' : 'side';
        var AW = G.Sprites.ANIM_W, AH = G.Sprites.ANIM_H;
        var frames = G.Sprites.heroAnim(view, this.moving ? 'walk' : 'idle');
        var fi = 0;
        if (frames) {
          if (this.moving) {
            fi = Math.floor(step * 2) % frames.length;
            if (fi < 0) fi += frames.length;
          } else {
            /* 待机眨眼：每 3.2s 短暂切到第 2 帧（不是持续浮动，避免"在抖"） */
            var ph = G.game.time % 3.2;
            fi = ph < 0.18 ? 1 : 0;
            if (fi >= frames.length) fi = 0;
          }
        }
        if (frames) {
          x.save();
          x.translate(px, py + 3);
          if (this.dir === 'left') x.scale(-1, 1);
          /* ===== 待机呼吸（v0.99.0，用户口径「多帧行走/待机动画」）=====
             原先待机只有眨眼两帧，"站着像立牌"。加一层**极轻的纵向呼吸**：
             `scale(1, 1±0.012)` —— 只压/放 1.2%，肉眼是"胸腔起伏"而不是"抖动"。
             ⚠️ **以脚底为不动点**：先把原点移到脚底（`-AH` 处），缩放后再移回，
                否则人会**整体上下浮**（脚离地），比不动还假。
             ⚠️ 走路时**不叠加**（走的 bob 已经给了节奏），否则两个频率打架。
             ⚠️ 幅度超过 2% 就会像"在蹦"，1.2% 是实测的舒适上限。 */
          var breathe = 1;
          var animY = Math.round(-AH + bob);
          if (!this.moving) {
            breathe = 1 + 0.012 * Math.sin(G.game.time * 2.1);
            /* 以脚底（y = animY + AH）为不动点缩放 */
            var footY = animY + AH;
            x.translate(0, footY);
            x.scale(1, breathe);
            x.translate(0, -footY);
          }
          x.drawImage(frames[fi], Math.round(-AW / 2), animY, AW, AH);
          x.restore();
        } else {
          var spr0 = G.Sprites.heroFrames()[this.dir][this.frame];
          x.save();
          x.translate(px, py + 3);
          x.drawImage(spr0, Math.round(-HW / 2), Math.round(-HH + bob), HW, HH);
          x.restore();
        }
      },

      /* 站桩 NPC：落地投影 + 待机**不抖**（v0.11.2 改）。
         旧版 ±0.8 逻辑像素（≈ 3 实际像素 @ K=4）肉眼可见"上下点头"，
         玩家反馈"村民动得很奇怪，静止的没事"。
         站桩不需要呼吸感；动画留给走路的 1 帧上抬（heroSprite 那 1 像素就够）。
         头顶任务标记保持浮动，那是 UI 层而非人物本身。 */
      _drawNpc: function (x, n, camX, camY) {
        var px = n.x * TILE - camX + 8, py = n.y * TILE - camY + 12;
        var HW = G.Sprites.HERO_W, HH = G.Sprites.HERO_H;
        var top = py + 3 - HH;
        x.save();
        x.fillStyle = 'rgba(0,0,0,0.28)';
        x.beginPath();
        x.ellipse(px, py - 1, HW * 0.32, HW * 0.12, 0, 0, 6.2832);
        x.fill();
        x.restore();
        var nfr = G.Sprites.npcAnim ? G.Sprites.npcAnim(n.kind) : null;
        if (nfr) {
          var nph = G.game.time % 3.2, nfi = nph < 0.18 ? 1 : 0;
          if (nfi >= nfr.length) nfi = 0;
          var ntop = py + 3 - G.Sprites.ANIM_H;
          x.drawImage(nfr[nfi], Math.round(px - G.Sprites.ANIM_W / 2), Math.round(ntop),
            G.Sprites.ANIM_W, G.Sprites.ANIM_H);
        } else {
          x.drawImage(G.Sprites.npc(n.kind), Math.round(px - HW / 2), Math.round(top), HW, HH);
        }
        var mk = hooks.npcMark ? hooks.npcMark(n) : null;
        if (mk) this._drawNpcMark(x, px, top - 4, mk);
      },

      /* 明雷（可见野怪）绘制（v0.68.0 用户第 22 点）。
         与野怪立绘同源（`G.Sprites.beast(speciesSpriteKey)`），所以"地图上看到的那只"
         和"进战斗打的那只"长相一致 —— 这是明雷的立身之本。
         ⚠️ 尺寸用 `BEAST_LW/LH`（40×40）等比缩到地图格尺度，**不要**直接铺满 16px 格：
            野怪立绘是方图，铺满格子会糊成一团；按格高的 ~1.6 倍显示才有"蹲在草里"的体量。
         头顶加一枚低调的血气指示（红点），玩家一眼能分出"这格有野怪"，
         而不是和装饰石头混淆 —— 这是"明雷"能被**看见**的关键。 */
      _drawRoam: function (x, r, camX, camY) {
        var gx = r.x * TILE - camX + 8, gy = r.y * TILE - camY + 12;
        /* 游荡呼吸：用确定性相位（roam.ph）+ 全局时钟，无头环境稳定 */
        var bob = Math.sin(G.game.time * 1.8 + r.ph * 6.2832);
        /* 尺寸取 30：与主角（28×42）体量相当，一眼能认出"这是只怪"；
           再小（初版 22）在 84px 的地图格里会被树石淹没。 */
        var HH = 30, HW = 30;
        var top = gy + 3 - HH + Math.round(bob * 1.2);
        x.save();
        /* 影子 */
        x.fillStyle = 'rgba(0,0,0,0.30)';
        x.beginPath();
        x.ellipse(gx, gy - 1, HW * 0.30, HW * 0.12, 0, 0, 6.2832);
        x.fill();
        x.restore();
        /* 物种 → 立绘键走**唯一真相源** `G.Data.SPECIES_SPRITE`（与 battle.js 同表）。
           v0.68.0 初版在这里又抄了一份三元表达式 —— 一旦新增物种只改 battle 不改这里，
           地图上就会画出错的怪（且完全静默）。 */
        var spKey = (G.Data.SPECIES_SPRITE && G.Data.SPECIES_SPRITE[r.species]) || 'snake';
        var spr = G.Sprites.beastResolve
          ? G.Sprites.beastResolve(r.artKey || null, spKey)
          : (G.Sprites.beast ? G.Sprites.beast(spKey) : null);
        if (spr) {
          x.drawImage(spr, Math.round(gx - HW / 2), Math.round(top), HW, HH);
        } else {
          /* 兜底：无素材时画一只简笔色块，保证"看得见有野怪"这条不丢 */
          x.save();
          x.fillStyle = '#7a4a3a';
          x.beginPath();
          x.ellipse(gx, top + HH * 0.6, HW * 0.28, HH * 0.30, 0, 0, 6.2832);
          x.fill();
          x.restore();
        }
        /* 头顶"遇敌"标记：红色小三角 + 微浮动，颜色与任务标记（金/玉）明确区分 */
        var mk = Math.sin(G.game.time * 3 + r.ph * 6.2832) * 1.5;
        x.save();
        x.fillStyle = 'rgba(6,8,14,0.75)';
        x.beginPath();
        x.moveTo(gx, top - 3 + mk);
        x.lineTo(gx - 4.5, top - 11 + mk);
        x.lineTo(gx + 4.5, top - 11 + mk);
        x.closePath();
        x.fill();
        x.fillStyle = '#e4695f';
        x.beginPath();
        x.moveTo(gx, top - 4.5 + mk);
        x.lineTo(gx - 3, top - 10.5 + mk);
        x.lineTo(gx + 3, top - 10.5 + mk);
        x.closePath();
        x.fill();
        x.restore();
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
        var px = m.x * TILE - camX + 8, py = m.y * TILE - camY + 8;
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
        var px = f.x * TILE - camX + 8, py = f.y * TILE - camY;
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

      /* 当前场景名：室内图取地图自带 label（洞府/药铺/…），
         室外图走 `regions.nameOf` 的**唯一口**（v0.74.0，区域名按世随机）。
         ⚠️ 老图三张（town/field/cave）的名字由 `save.world.names` 供，
            生成型区域由 `regions.nameOf` 供 —— 两者都由 nameOf 转发，
            所以这里不再自己写 mapId 分支（历史就是这么漂的：地图面板改名了、
            进图场景名还是老的）。 */
      _sceneName: function () {
        var md = this.map.md;
        if (md && md.label) return md.label;
        if (G.Data.regions && G.Data.regions.nameByMapId) {
          var nm = G.Data.regions.nameByMapId(this.mapId, G.game.save);
          if (nm) return nm;
        }
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

        /* --- 左：境界 · 第N世 ---
           v0.75.0（用户口径「这里不要展示头像了，我们不支持替换头像，
           我们要尽量模拟真实修仙世界」）：**删掉了圆形头像**，左块整体左移利用空出来的宽度。
           去掉头像后起点从 52 收到 14，两条进度条也相应左移 38 —— 多出的横向空间
           让「太乙金仙九重巅峰」这类长境界名与百分比都不再挤。
           ⚠️ 百分比居中锚点也要跟着左移，否则会偏出条外。 */
        G.UI.textOut(x, { x: 14, y: 4 }, ri.n, 14, G.UI.C.goldHi);
        var nameW = x.measureText(ri.n).width;
        G.UI.textOut(x, { x: 14 + nameW + 8, y: 7.5 }, '第 ' + save.life + ' 世',
          10.5, G.UI.C.textDim);

        /* 气血/灵气上下排列，条内只画百分比；纪年独立放在右上。 */
        var ratio = Math.max(0, Math.min(1, st.maxhp ? save.hp / st.maxhp : 0));
        var low = ratio <= 0.3;
        var qiNeed = G.Player.needQi(save);
        var qiRatio = Math.max(0, Math.min(1, qiNeed > 0 ? (save.qi || 0) / qiNeed : 1));
        G.UI.text(x, { x: 14, y: 20 }, '气血', 9.5, G.UI.C.textDim);
        G.UI.bar(x, { x: 42, y: 20, w: 132, h: 11 }, ratio, low ? '#e2605a' : G.UI.C.hp);
        G.UI.textOut(x, { x: 108, y: 20.5 }, Math.round(ratio * 100) + '%', 9.5, '#ffffff', 'center');
        G.UI.text(x, { x: 14, y: 34 }, '灵气', 9.5, G.UI.C.textDim);
        G.UI.bar(x, { x: 42, y: 34, w: 132, h: 11 }, qiRatio, G.UI.C.jadeHi);
        G.UI.textOut(x, { x: 108, y: 34.5 }, Math.round(qiRatio * 100) + '%', 9.5, '#ffffff', 'center');
        if (G.Time) G.UI.text(x, { x: 244, y: 8 }, G.Time.label(save), 9.5, G.UI.C.jadeHi);

        /* ===== 天气指示（v1.2.0，用户口径「天气进 HUD，玩家要能看见现在什么天气、什么效果」）=====
           位置：纪年下方（y=20）、资源四格之上（y=27）—— 那块横向空隙正好放一行。
           ⚠️ **晴天不显示**（`clear`）：晴是"没有效果"的默认态，占一行反而干扰；
              只有**真的有影响**的天气才提示 —— 玩家看到的每一行都对应一个实际效果。
           ⚠️ 悬停列**全部效果**（视野/元素/速度/打坐/遭遇），走 `WEATHER_FX` 同一份数据，
              不在这里另写文案表（否则加一条天气就要改两处）。
           ⚠️ 颜色按天气取（雨=冷蓝/雷=紫/雪=白/瘴=黄绿），一眼可辨。 */
        (function () {
          if (!G.game.weatherId) return;
          var wid = G.game.weatherId();
          if (wid === 'none' || wid === 'clear') return;
          var fx = G.game.weatherFx();
          var COL = { rain: '#a9d4f2', storm: '#c9b0ff', snow: '#e4eefb', miasma: '#b9d06a' };
          var col = COL[wid] || '#cfe0f5';
          var label = '天时 · ' + (fx.n || wid);
          x.save();
          x.font = G.UI.F(9.5);
          var lw = x.measureText(label).width;
          /* 右侧对齐到资源末格右沿（472），与纪年同侧，视觉成列 */
          var bx = 472 - lw - 10;
          G.UI.textOut(x, { x: 472, y: 20 }, label, 9.5, col, 'right');
          x.restore();
          if (!self.overlay) {
            /* 效果清单：**从 WEATHER_FX 派生**，保证"显示的就是生效的" */
            var lines = [];
            var vp = Math.round((fx.vision || 1) * 100);
            if (vp !== 100) lines.push('视野　' + vp + '%');
            if (fx.eb) Object.keys(fx.eb).forEach(function (k) {
              lines.push(k + '系功法　+' + Math.round(fx.eb[k] * 100) + '%');
            });
            if (fx.spd && fx.spd !== 1) {
              lines.push('行动速度　' + (fx.spd > 1 ? '+' : '') + Math.round((fx.spd - 1) * 100) + '%');
            }
            if (fx.qiWane) lines.push('打坐灵气　-' + Math.round(fx.qiWane * 100) + '%');
            var enc = fx.enc || {};
            if (enc.lvBias) lines.push('野怪等级　+' + enc.lvBias);
            if (enc.pairAdd) lines.push('结伴出没　+' + Math.round(enc.pairAdd * 100) + '%');
            if (enc.elemBias) {
              Object.keys(enc.elemBias).forEach(function (k) {
                lines.push(k + '系妖兽出没　+' + enc.elemBias[k] + '倍');
              });
            }
            G.UI.hover({ x: bx - 4, y: 18, w: lw + 14, h: 14 }, {
              title: '天时 · ' + (fx.n || wid),
              text: lines.length ? lines.join('\n') : '此天气暂无额外影响。'
            });
          }
        })();

        if (!self.overlay) G.UI.hover({ x: 42, y: 34, w: 132, h: 11 }, {
          title: bs.ready ? '灵气已足 · 可尝试突破' : '灵气修炼进度',
          text: '当前 ' + num(save.qi) + ' / 所需 ' + num(qiNeed) + '。突破还需满足境界条件。'
        });
        if (low) {
          x.save();
          x.globalAlpha = 0.30 + 0.30 * Math.sin(t / 220);
          G.UI.rr(x, { x: 40.5, y: 18.5, w: 135, h: 14 }, 3);
          x.strokeStyle = '#ff8a80'; x.lineWidth = 1.2; x.stroke();
          x.restore();
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
            text: '功法精进所用的修为。在功法面板「精进」消耗，部分秘术也要花它。'
          }],
          ['crystal', G.Player.xianliLive(save), '#d8c0f0', {
            title: '仙力（本世待结算）',
            text: '本世累积的仙力：境界 + 功法 + 击杀首领（每个 +30）+ 年岁。\n'
              + '身故结算后可在轮回殿灌输仙躯，永久增益下一世。'
          }]
        ];
        RES.forEach(function (s, i) {
          var sx = 244 + i * 58;
          var cell = { x: sx, y: 27, w: 54, h: 17 };
          G.UI.panel(x, cell, 'rgba(8,11,19,0.86)',
            'rgba(216,183,104,0.32)', 4, { tex: false, shadow: false });
          /* 灵气满可破境：该芯片金边脉动（替代被移除的顶部灵气条上的"可突破"）。 */
          if (s[0] === 'qi' && bs.ready) {
            var pq = 0.5 + 0.5 * Math.sin((G.game.time || 0) * 3.2);
            x.save();
            G.UI.rr(x, { x: cell.x - 1, y: cell.y - 1, w: cell.w + 2, h: cell.h + 2 }, 4);
            x.strokeStyle = 'rgba(245,227,168,' + (0.45 + 0.5 * pq).toFixed(3) + ')';
            x.lineWidth = 1.4; x.stroke();
            x.restore();
          }
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
        /* 收起态 = 紧凑小竖标（2 字），展开态 = 完整竖标（4 字 + 折角）。
           v0.75.0（用户口径「支持缩到最小，不要占用游戏窗口」）。 */
        var h = open ? TR_TAB_H : TR_TAB_MIN_H;
        var by = TR_Y;
        /* 左边两个圆角落在屏外（x = -4）→ 视觉上就是"贴住屏幕左缘的一条" */
        G.UI.panel(x, { x: -4, y: by, w: TR_TAB_W + 4, h: h },
          'rgba(6,9,16,0.86)', 'rgba(216,183,104,0.42)', 4,
          { tex: false, shadow: false });
        /* 右缘亮线：开合状态用**亮度**区分（展开时更亮），比换色更不吵 */
        x.fillStyle = open ? 'rgba(245,227,168,0.75)' : 'rgba(216,183,104,0.42)';
        x.fillRect(TR_TAB_W - 1.4, by + 6, 1.4, h - 12);

        /* 竖排标题：展开 4 字「任务追踪」，收起只 2 字「任务」（省高度） */
        var title = open ? '任务追踪' : '任务';
        var ty = by + (open ? 8 : 6);
        for (var i = 0; i < title.length; i++) {
          G.UI.textOut(x, { x: TR_TAB_W / 2 - 1, y: ty }, title.charAt(i), 11,
            i === 0 ? C.goldHi : 'rgba(206,196,172,0.88)', 'center');
          ty += 12;
        }

        /* 底部折角：收起时指右（点它展开），展开时指左（点它收起） */
        var ax = TR_TAB_W / 2 - 1, ay = by + h - 8;
        x.save();
        x.strokeStyle = open ? C.goldHi : 'rgba(216,183,104,0.72)';
        x.lineWidth = 1.6; x.lineCap = 'round'; x.lineJoin = 'round';
        x.beginPath();
        if (open) { x.moveTo(ax + 3, ay - 3); x.lineTo(ax - 1.5, ay); x.lineTo(ax + 3, ay + 3); }
        else { x.moveTo(ax - 3, ay - 3); x.lineTo(ax + 1.5, ay); x.lineTo(ax - 3, ay + 3); }
        x.stroke();
        x.restore();

        /* 有路引时在竖标顶端点一颗金点：收起状态下也能看出"任务有方向可走"。
           ⚠️ **不做呼吸**（用户口径：「任务左右上下都在浮动，做不好就改成禁止」）——
              呼吸/浮动这类"永远在动"的装饰放在**常驻 UI** 上只会让人分心，
              而且它原先是 `performance.now()`（本项目铁律：时间源一律 `G.game.time`，
              否则截图与契约都钉不住）。这里改成**静态点**，信息不减、干扰归零。 */
        if (tk && tk.guide) {
          x.save();
          x.globalAlpha = 0.85;
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
        var self = this;
        var tk = G.Overlays.trackInfo ? G.Overlays.trackInfo(G.game.save) : null;
        if (!tk || !tk.s) return;
        var open = this.trackOpen !== false;

        /* 左缘竖标**常驻**（收起时它是唯一入口，展开时它是收起钮） */
        this._drawTrackTab(x, tk, open);
        if (!open) return;

        var s = tk.s, C = G.UI.C;
        /* 地名随世替换（v0.74.0，用户第 24 点）：章节标题/目标/子任务里写死的
           "赤牙洞""翠微山"要显示成本世区名 —— 否则地图节点叫「白骨窟」、
           追踪栏还写「赤牙洞」，正是用户点名的"场景与地图名不一致"。
           锚世恒等（零回归）；只用于显示。 */
        var TX = (G.Data.regions && G.Data.regions.textOf) || function (v) { return v; };
        var SV = G.game.save;

        /* 目标文案：折行最多 2 行（面板只有 118 宽，第 3 行就顶到面板底了） */
        var dl = G.UI.wrap(x, TX(s.d, SV), 9.5, TR_W - 14);
        if (dl.length > 2) { dl = dl.slice(0, 2); dl[1] = dl[1].replace(/.$/, '') + '…'; }
        /* 支线（v0.72.0）：有支线时主线段少放两条子任务 —— 面板高度写死，总预算必须守住：
           by=78、底栏上沿 244 → 可用高 ≤ 158。主线段满配（2 行目标 + 3 条子任务 + 路引）
           = 117，再加支线段（2 条 × 21 + 18 表头）= 60 → 177 会顶进底栏。
           所以有支线时子任务封顶 1 条（117−22=95；95+60=155 ≤ 158）。 */
        var sides = tk.sides || [];
        var subCap = sides.length ? 1 : 3;
        var subs = (s.subs || []).slice(0, subCap);
        var guide = tk.guide || null;
        var route = guide ? this._routeTo(guide.map) : null;

        /* ⚠️ 高度只取**两个稳定值**：无支线 118 / 有支线 161。
           不随内容伸缩（用户口径：「任务左右上下都在浮动」）；也不做"按条数递增"，
           否则接一条支线面板就跳一次。两个值各自稳定，切换只发生在玩家接/交支线时。 */
        var H = sides.length ? 161 : 118;
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
        G.UI.text(x, { x: bx + 16, y: cy }, TX(s.t, SV), 11, C.goldHi);
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
          G.UI.text(x, { x: bx + 16, y: cy }, TX(sb.t, SV), 9.5, done ? C.jadeHi : C.text);
          cy += 11;
        });

        /* ---- 路引 ---- */
        if (guide) {
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
          dx = tx - pp.x / TILE; dy = ty - pp.y / TILE;
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
        var _tx = (G.Data.regions && G.Data.regions.textOf) || function (v) { return v; };
        var who = onMap
          ? _tx(guide.who, G.game.save)
          : this._mapName(guide.map) + (hop && hop.name ? ' · ' + _tx(hop.name, G.game.save) : '');
        G.UI.text(x, { x: bx + 28, y: cy }, this._ellip(x, who, 10, bw - 35), 10, C.text);
        var line2 = ok
          ? this._dirName(dx, dy) + '　约 ' + Math.round(Math.sqrt(dx * dx + dy * dy)) + ' 格'
          : (onMap ? '就在此处' : '往 ' + this._mapName(guide.map));
        G.UI.text(x, { x: bx + 28, y: cy + 12 }, line2, 9, C.textDim);
        cy += 24;
        }

        /* ---- 支线（v0.72.0，用户口径「主支线追踪可完全缩至左侧」）----
           主线段在上、支线段在下，中间一条分隔线。支线**只列进行中/可交的**
           （见 panels.sideTrackRows），可交的用金色描边突出 —— 能拿奖励的先看见。
           ⚠️ 高度必须留够：面板 H 是写死的，支线段画在它的下半区，
              超出会被底栏盖住（不是裁切，是画在下面看不见）。 */
        var sides2 = tk.sides || [];
        if (sides2.length) {
          x.fillStyle = 'rgba(216,183,104,0.18)';
          x.fillRect(bx + 6, cy + 1.5, bw - 12, 0.8);
          cy += 6;
          G.UI.text(x, { x: bx + 8, y: cy }, '支 线', 9.5, C.jade || C.gold);
          cy += 12;
          sides2.forEach(function (sd) {
            /* 圆点：可交 = 亮金实心（提醒去拿），进行中 = 暗青空心 */
            x.save();
            if (sd.canTurnIn) {
              x.fillStyle = C.goldHi;
              x.beginPath(); x.arc(bx + 10, cy + 5, 2.4, 0, 6.2832); x.fill();
            } else {
              x.strokeStyle = 'rgba(120,190,170,0.75)'; x.lineWidth = 1;
              x.beginPath(); x.arc(bx + 10, cy + 5, 2.4, 0, 6.2832); x.stroke();
            }
            x.restore();
            G.UI.text(x, { x: bx + 16, y: cy },
              self._ellip(x, sd.n, 10, bw - 24), 10, sd.canTurnIn ? C.goldHi : C.text);
            cy += 11;
            var sl = G.UI.wrap(x, TX(sd.hint || sd.d, SV), 9, TR_W - 24);
            if (sl.length > 1) { sl = sl.slice(0, 1); sl[0] = sl[0].replace(/.$/, '') + '…'; }
            if (sl[0]) { G.UI.text(x, { x: bx + 16, y: cy }, sl[0], 9, C.textDim); cy += 10; }
          });
        }
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
         最后才是兜底表 —— 三层都查不到就直接显示 id（不静默成空串）。
         ⚠️ v0.74.0：缓存键带**世代标签**（`world.seed`）—— 区域名按世随机后，
            沿用跨世缓存会让"白鹿集"这一世的地图面板里列出上一世的区名。 */
      _mapName: function (id) {
        if (!id) return '';
        var w = G.game.save && G.game.save.world;
        var ck = ((w && w.seed) || 0) + '|' + id;
        if (NAME_CACHE[ck]) return NAME_CACHE[ck];
        var md = G.Data.maps[id], nm = '';
        if (md && (md.label || md.n)) nm = md.label || md.n;
        if (!nm && G.Data.regions && G.Data.regions.nameByMapId) {
          nm = G.Data.regions.nameByMapId(id, G.game.save) || '';
        }
        if (!nm) {
          nm = { town: '青溪镇', field: '翠微山', cave: '赤牙洞', town_home: '洞府',
            town_shop: '药铺', town_market: '刘记杂货', field_temple: '山神庙' }[id] || id;
        }
        NAME_CACHE[ck] = nm;
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
    /* 把 hooks 挂到场景上（v0.25.0）：契约要能走"真实交互路径"
       （例如"与沈伯对话 → 是否授予入门功法"），而不是直接调内部函数。
       挂在场景对象上是最省事又不改行为的做法。 */
    scene.hooks = hooks;
    return scene;
  }

  G.Explore = { create: create, HUD_H: HUD_H, BOT_H: BOT_H };
})();
