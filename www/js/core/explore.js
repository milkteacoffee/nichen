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
  /* 斜俯角模拟：**世界层纵向压缩系数**（v1.8.0）。
     用户口径：「② 斜俯角模拟（远景轻微 Y 压缩，补最后一条"无纵深"）」。
     原理：把世界层纵向 scale(1, 1/VIEW_Y)，格块高度与格间距**同时**被压 →
     格与格之间不留缝（这是"自洽"的关键）；角色再反向 scale(1, VIEW_Y) 补回来
     防变形（人应该是"站着"的，不该被压扁）。
     ⚠️ **1.06 是实测甜点**：压 3% 时完全看不出（等同没做）；
        压 15% 时格块明显变扁、草地纹理出现摩尔纹、建筑也矮了一截（像"趴着"）。
     ⚠️ 它只影响**世界层**（地面/建筑/装饰/角色/NPC），
        HUD、追踪栏、浮层、对话框**一律不压**（UI 压扁会糊且不像 UI）。 */
  var VIEW_Y = 1.06;
  /* ===== 等距（45° 俯视）投影（v1.9.0）=====
     用户口径：「我现在希望的是全部转向俯视角 45°，看起来更立体，还有地图参考《烟雨江湖》」。

     **做法：一个 canvas 变换覆盖全部绘制点**（与 v1.8.0 的纵向压缩同一思路）。
     现有 18 个绘制点算的都是 `tx*TILE - camX / ty*TILE - camY` ——
     只要让 `cam` 在等距模式下变成"玩家世界像素"并置零偏移，
     它们输出的就是**世界像素**；再由一个等距矩阵统一变成屏幕坐标。
     **⇒ 18 处换算一处都不用改。**

     矩阵（标准 2:1 等距）：
         屏幕x = 中心x + (wx - wy)
         屏幕y = 中心y + (wx + wy) * 0.5
       ⇒ canvas `transform(a,b,c,d,e,f)` 对应 a=1,b=0.5,c=-1,d=0.5。
     ⚠️ **菱形纵横比 2:1** 是等距的行业标准（`√2:1` 是数学等距，2:1 是"游戏等距"，
        更好看且纹理不被非均匀拉伸）。改 ISO_RATIO 会同时改观感与可见范围。

     ⚠️ **零回归**：`ISO_ON = false` 时**整段跳过** —— 走路、排序、反投影、
        视口裁剪全部走原路径，手写图逐像素不变。这是整个改造的安全闸。 */
  var ISO_ON = true;
  /* ⚠️ 暴露给契约/探针读"当前是否等距" —— **唯一口径**。
     契约里不许自己拼 `_camX()===0` 之类的推断（那依赖于当时的场景对象，
     而契约常在切场景**之前**取 `G.game.scene` → 拿到上一个场景 → 判错）。 */
  G.ISO_ON = ISO_ON;
  var ISO_RATIO = 0.5;                    /* 纵向压扁比（2:1 = 0.5） */
  var ISO_CX = 240, ISO_CY = 136;         /* 屏幕中心（等距原点落在屏幕正中） */
  var MAX_PATH = 64;                      /* 寻路上限（格）：够走完 36×24 镇子的对角 */

  /* 逐格确定性哈希（v1.9.0）：给"等距瓦片微明暗"用。
     ⚠️ **坐标必须分开混入**，不许拼进字符串尾部 ——
        mapgen 的 `elevAt` 就是这么踩的（FNV-1a 对末尾增量雪崩不足 →
        高度场退化成竖条纹，潜伏了三个版本才发现）。
     ⚠️ 不用 `G.rng`：会推移全局随机序列、污染所有依赖它的回归基线。 */
  function hashTile(tx, ty, salt) {
    var h = 2166136261;
    var s = 'wt:' + (salt || '');
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    h = Math.imul(h ^ (tx + 0x9E3779B9), 2654435761);
    h = Math.imul(h ^ (ty + 0x85EBCA6B), 2246822519);
    h ^= h >>> 16; h = Math.imul(h, 2246822507);
    h ^= h >>> 13; h = Math.imul(h, 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
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
            /* ⚠️ v1.9.4：**按键位移走 `_keyVec`**（等距下映射成世界对角），
               但 `this.dir` 仍记**朝向名**（给角色朝向图 / `_front` 交互判定用）。
               ⚠️ 别用 `_front(save.pos, d)` —— 那是**朝向语义**（世界 4 邻），
                  等距下会让按键走成"世界的正上方"（屏幕上却是斜的）。 */
            this.dir = d;
            var kv = this._keyVec(d);
            next = { x: save.pos.x + kv[0], y: save.pos.y + kv[1] };
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
        var v = this._dirVec(d);
        return { x: p.x + v[0], y: p.y + v[1] };
      },

      /* ===== 方向向量：**两套语义必须分开**（v1.9.4 踩坑）=====
         ⚠️ 这里有个容易搞混的点：`up/down/left/right` 在两个语境里含义**不同**：

           · **按键语境**（`_heldDir` → 移动）：要按"**视觉方向**" —
             等距下按 ↑ 应走世界 `(-1,-1)`（屏幕正上），否则"按上却斜着走"。
           · **朝向语境**（`this.dir` → `_front` 取"面前那格"）：
             仍应是**世界的 4 邻**（`up` = `(0,-1)`）——
             因为 NPC / 交互物 / 门的**站位数据是按世界格写的**，
             把朝向也改成对角会让"面向正上方的 NPC"判定失效
             （实测：25 条交互契约全红）。

         ⇒ **`_dirVec(d)` 保持世界 4 邻**（朝向用）；
           **按键映射单独做**（见 `_keyVec`），两者别混。 */
      _dirVec: function (d) {
        return { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[d] || [0, 0];
      },

      /* 按键 → 位移（v1.9.4）。
         **等距下按键必须映射成世界对角**：
           世界 (-1,-1) → 屏幕**正上**   世界 (+1,+1) → 屏幕**正下**
           世界 (-1,+1) → 屏幕**正左**   世界 (+1,-1) → 屏幕**正右**
         ⇒ 按 ↑ 走 `(-1,-1)`，玩家看到的是"往上走"（视觉正确）。
         ⚠️ 这是"**输入语义跟着视角走**"的典型：画面转了，操作也得转，
            否则按上往左上跑、按右往右上跑 —— 手感完全错。
         ⚠️ 非等距时退回 4 邻（逐像素不变，零回归）。 */
      _keyVec: function (d) {
        if (!ISO_ON) return this._dirVec(d);
        return {
          up: [-1, -1], down: [1, 1], left: [-1, 1], right: [1, -1]
        }[d] || [0, 0];
      },

      /* 由位移求朝向名（用于 `this.dir` → 角色朝向图）。
         ⚠️ 保持**世界 4 邻口径**（与 `_dirVec` 一致）：
            对角位移时取"主导轴"（|dx| 与 |dy| 谁大用谁；相等时优先竖直），
            —— 角色素材只有 4 向，对角必须降级到最近的一个轴，
              否则会出现"没有对应朝向图 → 用错图"（表现为人物朝向乱跳）。 */
      _dirTo: function (a, b) {
        var dx = b.x - a.x, dy = b.y - a.y;
        if (dx && dy) {
          /* 对角：降级到主导轴（相等时优先竖直，与 `_keyVec` 的"屏幕上下"感一致） */
          return Math.abs(dy) >= Math.abs(dx) ? (dy < 0 ? 'up' : 'down')
            : (dx < 0 ? 'left' : 'right');
        }
        if (dx) return dx > 0 ? 'right' : 'left';
        return dy > 0 ? 'down' : 'up';
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
        var tx, ty;
        if (ISO_ON) {
          /* ⚠️ v1.9.0 等距反投影：屏幕点先经逆矩阵回到"世界像素（相对玩家）"，
             再加上玩家的世界像素。**必须走 `_isoScreen`** ——
             自己在这写 `(sx-sy)/2` 之类的三角公式，是"两处分写同一判据"的老坑。 */
          var pw = this._isoScreen(p.x, p.y);           /* 相对 ISO 中心的世界像素 */
          var pp = this._px();
          var wx = pw.x - ISO_CX + pp.x;                /* 世界像素 */
          var wy = pw.y - ISO_CY + pp.y;
          tx = Math.floor(wx / TILE);
          ty = Math.floor(wy / TILE);
        } else {
          tx = Math.floor(this._camX() / TILE + p.x / TILE);
          /* ⚠️ v1.8.0 **反投影必须乘 VIEW_Y**：世界层纵向被压了 `1/VIEW_Y`，
             所以"屏幕上的 1px"对应"世界里的 VIEW_Y px"。
             漏了这一步的表现是：**点击位置总是比实际点到的格子偏上**（越靠下偏得越多），
             而画面完全正常 —— 属"看着对但点不准"的静默错。 */
          ty = Math.floor(this._camY() / TILE + p.y * VIEW_Y / TILE);
        }
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

      /* 8 向 A*（v1.9.4）。
         **为什么加对角**（用户口径：「地图参考《烟雨江湖》」）：
         等距下"屏幕正上/正下"对应世界的**对角**方向（-1,-1)/(+1,+1) ——
         只有 4 向时玩家没法"往屏幕上方走直线"，走位会很别扭。
         ⚠️ **对角代价 = √2（不是 1）**：否则寻路会偏爱斜走（同样距离省步数），
            路径会变成"之字形"而不是"先横后竖"。
         ⚠️ **斜向许可**（关键）：对角移动要求**两个正交邻格都可通行** ——
            否则会"从两堵墙的缝里钻过去"（经典穿墙 bug）。
            判据：`solid[y][x±1]` 与 `solid[y±1][x]` **都不能是实心**。
         ⚠️ 对角线**通向目标格本身**时仍允许（与 4 向的 `<>(nx===tx&&ny===ty)`
            同一豁免），否则"目标贴着墙"时永远走不到。
         ⚠️ 启发式用**八向距离**（`max + (√2−1)·min`），不能用曼哈顿 ——
            曼哈顿会高估对角距离，导致 A* 退化成 Dijkstra（慢、且可能不最优）。 */
      _astar: function (sx, sy, tx, ty) {
        var solid = this.map.solid;
        var SQ2 = 1.4142135623730951;
        var open = [{ x: sx, y: sy, g: 0, f: 0, p: null }];
        var seen = {}; seen[sx + ',' + sy] = open[0];
        /* 4 正交 + 4 对角（对角在后面 4 个，代价 √2） */
        var dirs = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
          [1, 1, SQ2], [1, -1, SQ2], [-1, 1, SQ2], [-1, -1, SQ2]];
        var self = this;
        /* 八向距离启发式：对角走 √2、轴向走 1 */
        function h(nx, ny) {
          var dx = Math.abs(nx - tx), dy = Math.abs(ny - ty);
          var mn = Math.min(dx, dy), mx = Math.max(dx, dy);
          return (mx - mn) + mn * SQ2;
        }
        /* 该格是否能站（目标格豁免实心） */
        function passable(nx, ny, allowSolid) {
          if (nx < 0 || ny < 0 || nx >= self.map.w || ny >= self.map.h) return false;
          if (solid[ny][nx] && !allowSolid) return false;
          return true;
        }
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
          for (var d2 = 0; d2 < 8; d2++) {
            var dv = dirs[d2];
            var nx = cur.x + dv[0], ny = cur.y + dv[1];
            var isTarget = (nx === tx && ny === ty);
            if (!passable(nx, ny, isTarget)) continue;
            /* ⚠️ 斜向许可：两个正交邻格都要能走（防穿墙角）。
               目标格豁免 —— 与 `passable` 的豁免一致，否则贴墙目标走不到。 */
            if (dv[0] && dv[1]) {
              var o1 = passable(cur.x + dv[0], cur.y, false);
              var o2 = passable(cur.x, cur.y + dv[1], false);
              if (!o1 || !o2) continue;
            }
            var k = nx + ',' + ny;
            var g = cur.g + dv[2];
            if (seen[k] && seen[k].g <= g) continue;
            var node = { x: nx, y: ny, g: g, f: g + h(nx, ny), p: cur };
            seen[k] = node; open.push(node);
          }
        }
        return null;
      },

      /* ===== 排序深度（v1.6.0）：**绘制位置的像素 y，减掉地形高度** =====
         所有参与 y 排序的物件都走这里 —— 保证"排序基准 == 绘制基准"。

         ⚠️ **口径要按"原来的 y 口径"来，只在其上减高度偏移**：
            原代码各类物件的排序 y 是**各自调好的**（装饰按格 y、家具按"最下一格"），
            它们的相对关系正确 —— 本轮的改动**只该加高度**，不该顺手改口径。
            所以这里**保留原口径**（`o.y` / `o.y + h - 1`），只减 `_elevPx`。
            若把口径改成"统一脚底像素 y"，会改变**既有地图里的相对顺序**，
            手写图（无高度）也会跟着变 → 破坏零回归。

         ⚠️ 玩家是**例外**：它的 `o.y` 在入列时已按 `_pxDraw()`（**含高度**）
            换算过，所以这里**不再减**（减两次 = 双重偏移，反例实测差 32px）。

         ⚠️ 无高度图时 `_elevPx` 恒 0 → depth 退化为原 `y` 序，
            **手写图逐像素不变**（零回归）。 */
      _depthOf: function (o) {
        /* ⚠️ v1.9.0：等距下"谁在前"由**屏幕 y** 决定，而屏幕 y ∝ (x + y)。
           所以排序键必须换成 `(x + y)`，否则"站在左后方的物体会压住右前方的"（穿帮）。
           ⚠️ **不要试图在等距下继续用 y** —— 那正是"+ 加一维信息却没接进判据"的经典错。
           判据仍要**减高度**（高地物件持续靠上）。 */
        var key = ISO_ON ? (o.x + o.y) : o.y;
        if (o.player) {
          /* 已在入列时按 `_pxDraw()` 换算（含高度）→ 直接用，不再减 */
          return key * TILE;
        }
        if (o.furn) {
          /* 家具按"最下一格"参与排序（与入列时的 `y + (h||1) - 1` 一致） */
          return key * TILE - this._elevPx(o.x, o.y);
        }
        /* 装饰 / NPC / 采集 / 明雷：按格坐标，只减高度 */
        return key * TILE - this._elevPx(o.x, o.y);
      },

      /* ===== 相机 =====
         ⚠️ v1.5.0：`_px()` 保持**逻辑基准位置**（不含高度偏移）——
            因为 `_camX/_camY` 也读它，相机跟着高度走会让**整屏随坡上下移动**，
            观感是"地形在动、人不动"（正好反了！）。
            高度偏移单独由 `_pxDraw()` 提供，只用于**绘制**。
            这样"人上坡"= 人在屏幕上**相对地形**往上走 → 才是"走上去"的感觉。 */
      _px: function () {
        var save = G.game.save;
        var x = save.pos.x, y = save.pos.y;
        if (this.moving) {
          x = this.from.x + (this.to.x - this.from.x) * this.mt;
          y = this.from.y + (this.to.y - this.from.y) * this.mt;
        }
        return { x: x * TILE + 8, y: y * TILE + 12 };
      },
      /* 绘制用的玩家位置 = 逻辑位置 − 地形高度（双线性插值，跨落差连续）。
         ⚠️ 只有绘制该用它；**相机、粒子锚点、光效一律用 `_px()`** ——
            否则它们也会随坡偏移（粒子会脱地、相机整屏动）。 */
      _pxDraw: function () {
        var save = G.game.save;
        var x = save.pos.x, y = save.pos.y;
        if (this.moving) {
          x = this.from.x + (this.to.x - this.from.x) * this.mt;
          y = this.from.y + (this.to.y - this.from.y) * this.mt;
        }
        var p = this._px();
        return { x: p.x, y: p.y - this._elevPx(x, y) };
      },
      _camX: function () {
        /* ⚠️ v1.9.0：等距模式下返回 **0** —— 让所有绘制点输出的 `tx*TILE - camX`
           就等于**世界像素**，再由 render 里的等距矩阵统一变屏幕。
           这正是"18 处换算一处都不改"的原理（与 v1.8.0 的压缩同一思路）。
           非等距时保持原语义（视口左上角的世界坐标 + 边界夹取）。 */
        if (ISO_ON) return 0;
        var cx = this._px().x;
        return Math.max(0, Math.min(this.map.w * TILE - 480, cx - 240));
      },
      /* 相机 Y 上限：可见世界高度 = 272 * VIEW_Y（屏幕被纵向压缩后能装更多世界内容）。
         ⚠️ v1.8.0：**必须乘 VIEW_Y**，否则相机以为只看得见 272px 世界，
            压扁后会**露出地图外的空白**（底边出现黑带）。
         ⚠️ 居中偏移用 `272*VIEW_Y/2`（可见范围的**一半**），不是固定 136 ——
            用 136 会让主角在压缩后**偏上**（不再居中）。
         ⚠️ v1.9.0：等距模式下同样返回 0（见 `_camX`）。 */
      _camY: function () {
        if (ISO_ON) return 0;
        var cy = this._px().y;
        var vis = 272 * VIEW_Y;
        return Math.max(0, Math.min(this.map.h * TILE - vis, cy - vis / 2));
      },
      /* 当前可见的世界高度（像素）：纵向压缩后是 272*VIEW_Y。
         视口裁剪、视口范围计算都该走它 —— 别各写一份 272。 */
      _viewH: function () { return 272 * VIEW_Y; },

      /* ===== 等距投影（v1.9.0）=====
         **唯一口**：世界像素 ↔ 屏幕。所有手动换算（反投影、视口裁剪）
         都必须走这里，不许自己写三角公式（否则迟早有一处漏改）。 */

      /* 世界像素 → 屏幕像素 */
      _isoWorld: function (wx, wy) {
        var u = wx - ISO_CX, v = wy - ISO_CY;
        return { x: ISO_CX + (u - v), y: ISO_CY + (u + v) * ISO_RATIO };
      },

      /* 屏幕像素 → 世界像素（`_isoWorld` 的逆）。
         Δx = u - v,  Δy = (u + v)R  ⇒  u = Δx/2 + Δy/(2R),  v = -Δx/2 + Δy/(2R) */
      _isoScreen: function (sx, sy) {
        var dx = sx - ISO_CX, dy = sy - ISO_CY;
        var u = dx / 2 + dy / (2 * ISO_RATIO);
        var v = -dx / 2 + dy / (2 * ISO_RATIO);
        return { x: u + ISO_CX, y: v + ISO_CY };
      },

      /* 可见区域在世界像素里的 AABB（等距下屏幕是**旋转**的，不能用屏幕矩形裁剪）。
         ⚠️ **必须用 AABB 而不是半径** —— 判断者是矩形包含，用半径会漏画角上的物件。
         ⚠️ 等距的 AABB 是屏幕矩形（±240, ±136）经逆矩阵得到的：
              四角 → u,v ∈ [-256, 256]（RATIO=0.5 时）→ 比方形视口大得多，
              不减视口尺寸会出现"边缘一整条空白"。 */
      _viewBounds: function () {
        var camX = this._camX(), camY = this._camY();
        if (!ISO_ON) {
          return { x0: camX, y0: camY, x1: camX + 480, y1: camY + this._viewH() };
        }
        /* 等距：以屏幕四角求世界 AABB（相对中心） */
        var px = this._px().x, py = this._px().y;
        var R = 0, RY = 0;
        var cs = [[0, 0], [480, 0], [0, 272], [480, 272]];
        var minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
        for (var i = 0; i < 4; i++) {
          var w = this._isoScreen(cs[i][0], cs[i][1]);
          var u = w.x - ISO_CX, v = w.y - ISO_CY;
          if (u < minU) minU = u; if (u > maxU) maxU = u;
          if (v < minV) minV = v; if (v > maxV) maxV = v;
        }
        return {
          x0: px + minU, y0: py + minV,
          x1: px + maxU, y1: py + maxV
        };
      },

      /* ===== 等距投影（v1.9.0）=====
         **唯一口**：世界像素 ↔ 屏幕。所有需要手动换算的地方（反投影、视口裁剪）
         都必须走这两个函数，不许自己写三角公式（否则迟早有一处漏改）。 */

      /* 世界像素 → 屏幕像素 */
      _isoWorld: function (wx, wy) {
        var u = wx - ISO_CX, v = wy - ISO_CY;
        return { x: ISO_CX + (u - v), y: ISO_CY + (u + v) * ISO_RATIO };
      },

      /* 屏幕像素 → 世界像素（`_isoWorld` 的逆）。
         逆矩阵：Δx = u - v,  Δy = (u + v) * R
               ⇒ u = Δx/2 + Δy/(2R),  v = -Δx/2 + Δy/(2R) */
      _isoScreen: function (sx, sy) {
        var dx = sx - ISO_CX, dy = sy - ISO_CY;
        var u = dx / 2 + dy / (2 * ISO_RATIO);
        var v = -dx / 2 + dy / (2 * ISO_RATIO);
        return { x: u + ISO_CX, y: v + ISO_CY };
      },

      /* 视口裁剪的唯一判据（v1.9.0）。
         **为什么收敛成函数**：原先各绘制点自己写 `px > 480 || py > 272` ——
         等距下 px/py 是**世界像素**，那套判据会**全错**（世界宽高远大于 480×272，
         结果是一律不裁或一律裁掉）。逐处改 12 个地方必漏，所以统一走这里。

         ⚠️ **口径必须与世界 AABB 一致**（`_viewBounds` 返回的是**世界像素**）。
            踩过的坑：调用处传的是 `_proj()` 的**屏幕坐标** → 拿屏幕比世界 AABB
            → 判断全错（建筑在屏幕 y=114 却被判"不可见"）。
            **⇒ 本函数收世界像素矩形**；调用处要传 `wx = s.x*TILE`（不是 `_proj` 的结果）。
         ⚠️ 非等距时 AABB 恰好等于原视口矩形 → 行为逐像素不变（零回归）。 */
      _inView: function (wx, wy, w, h) {
        var b = this._viewBounds();
        return !(wx > b.x1 || wx + w < b.x0 || wy > b.y1 || wy + h < b.y0);
      },

      /* ===== 立牌（billboard）变换（v1.9.0）=====
         **为什么必须有**：等距矩阵会把**整个世界**旋转 45° —— 地面变成菱形（正确），
         但角色/建筑/树也跟着被旋转，结果就是"人物躺在地上"（实测截图确认）。

         标准做法（所有等距游戏都这么做）：
           · **地面**：跟着矩阵旋转（菱形铺开）
           · **立牌**（角色/建筑/树/家具）：**保持屏幕竖直**，只把"锚点"投到屏幕

         实现：把一个点 (wx,wy) 投到屏幕后，在该点处**反转等距矩阵**再画精灵 ——
         效果是精灵"竖着站在菱形格上"。
         ⚠️ 反转后的变换会**放大/压扁精灵**（矩阵含纵向 ×0.5）。所以还要
            `scale(1, 1/ISO_RATIO)` 把它拉回原比例（否则人会矮一半）。
         ⚠️ 只对**立牌**用；地面/明暗/高度层的格块**不要**用（它们该是菱形）。 */
      _billboard: function (x, wx, wy, fn) {
        if (!ISO_ON) { fn(); return; }
        var s = this._isoWorld(wx, wy);
        x.save();
        x.translate(s.x, s.y);
        /* 反转等距的线性部分：M = [[1,-1],[R,R]]  ⇒  M⁻¹ = [[0.5, 1/(2R)],[-0.5, 1/(2R)]] */
        var inv = 1 / (2 * ISO_RATIO);
        x.transform(0.5, -0.5, inv, inv, 0, 0);
        /* 矩阵纵向压了 R 倍（且横向上有 √2 的放大）→ 补偿回原比例。
           ⚠️ 横向也会被放大约 1.414 倍（|a|+|c| 的行范数），所以两个方向都要补。 */
        var k = 1;
        x.scale(k / Math.SQRT2, (k / Math.SQRT2) / ISO_RATIO);
        /* fn 里用**相对该点**的坐标（与原本的 `- camX - 中心` 等价：此处原点已在锚点） */
        fn();
        x.restore();
      },

      /* ===== 立牌投影（v1.9.0）=====
         **唯一口**：把"世界像素坐标"变成"绘制坐标"。
         · 非等距：恒等（减去 camX/camY，与原逻辑完全一致 → 零回归）
         · 等距：**投到屏幕**（`_isoWorld`），且**不带旋转** —— 立牌保持屏幕竖直

         ⚠️ **为什么立牌必须单独投而不是跟着矩阵转**（实测截图发现）：
            等距矩阵把整个世界旋转 45°，地面变菱形（正确），
            但角色/建筑/树也跟着被旋转 → **人物"躺在地上"**。
            所有等距游戏的做法都是：**地面跟着矩阵转，立牌保持竖直**。
         ⚠️ 立牌的**锚点**用世界坐标（含高度），所以"站在坡上"依然正确。
         ⚠️ 立牌的**尺寸**不缩放（`scale(1, 1)`）—— 人还是那么高，
            不会因为"在等距世界里"而变矮（这与 v1.8.0 的角色反向补偿同一理念）。 */
      _proj: function (wx, wy) {
        if (!ISO_ON) return { x: wx - this._camX(), y: wy - this._camY() };
        var pw = this._px();
        var s = this._isoWorld(wx, wy);
        var c = this._isoWorld(pw.x, pw.y);
        return { x: s.x - c.x + ISO_CX, y: s.y - c.y + ISO_CY };
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

        /* ===== 斜俯角：世界层纵向压缩（v1.8.0）=====
           用户口径：「② 斜俯角模拟（远景轻微 Y 压缩，补最后一条"无纵深"）」。
           **为什么 scale 世界层就够**（不用逐绘制点改）：
             `scale(1, 1/VIEW_Y)` 会**同时**压格块高度与格间距 ——
             两者同一系数 → 格子仍严丝合缝（不留缝），
             所有 `y*TILE` 的绘制自动跟着变，**18 个投影点一处都不用改**。
           **为什么要给角色反向补偿**：世界被压扁 6%，角色若跟着压就"矮胖变形"。
             人应该是站着的 → 角色单独 `scale(1, VIEW_Y)` 抵消。
           **为什么相机要改**：压扁后 272px 屏幕对应**更多**世界内容
             （272 * VIEW_Y = 288px）→ 相机可见范围变大，见 `_camY`。 */
        var _viewY = VIEW_Y;
        /* ===== 等距（45° 俯视）矩阵（v1.9.0）=====
           用户口径：「我现在希望的是全部转向俯视角 45°，看起来更立体，还有地图参考《烟雨江湖》」。

           **一次性覆盖全部绘制点**：等距模式下 `_camX/_camY` 返回 0，
           所以每个绘制点算出的 `tx*TILE - camX` 就是**世界像素**；
           这里再用矩阵把它变到屏幕 —— **18 处换算一处都不用改**。

           矩阵构造（屏幕 = ISO_CX/CY + M·(世界 - 玩家世界像素)）：
             ① translate(ISO_CX, ISO_CY)        → 原点挪到屏幕中心
             ② transform(1, R, -1, R, 0, 0)     → 等距旋转+压缩
                （canvas 的 a,b,c,d：x' = a·x + c·y, y' = b·x + d·y）
             ③ translate(-ux, -uy)              → 把玩家挪到原点
           其中 (ux,uy) = 玩家世界像素 − ISO 中心（保持玩家恒在屏幕中心）。

           ⚠️ 顺序是"先绕中心旋转再平移玩家"，与方形模式的"cam 平移"不同 ——
              写成 translate(240-ux, 136-uy) 会错（那是方形，不是旋转）。
           ⚠️ 纵向压缩 VIEW_Y 与等距**不能同时开**（等距自带 2:1 压缩）→ 等距时置 1。 */
        var _isoT = null;
        if (ISO_ON) {
          var pwp = this._px();
          var ux = pwp.x - ISO_CX, uy = pwp.y - ISO_CY;
          _isoT = { ux: ux, uy: uy };
        }
        if (_zoom !== 1 || _shk || _viewY !== 1 || ISO_ON) {
          x.save();
          x.translate(240 + (_shk ? Math.sin(_trib.t * 61) * _shk : 0),
            136 + (_shk ? Math.sin(_trib.t * 73) * _shk : 0));
          if (ISO_ON) {
            x.transform(1, ISO_RATIO, -1, ISO_RATIO, 0, 0);   /* 等距旋转+压缩 */
            x.translate(-_isoT.ux, -_isoT.uy);                /* 玩家回到屏幕中心 */
          } else {
            x.scale(_zoom, _zoom * (1 / _viewY));             /* 斜俯角纵向压缩 */
          }
          x.translate(-240, -136);
        }

        /* 地面：整图已预烘好，每帧只 blit 视口这一块（1 次，而不是逐格 540 次）。
           详见 _bakeGround —— 逐格从 672×672 大纹理取子块实测每帧 7.8~22.6ms，
           室内大图直接把帧率压到 30fps，是整个游戏最浪费的一处。
           这一趟仍关平滑：源层按 K 烘、目标按 S 画，K===S 时就是 1:1 像素搬运。 */
        /* ⚠️ v1.9.0：等距下**必须先在屏幕系铺一层地图外底色** ——
           等距可见范围是一个**旋转的正方形**（玩家 ±256px），
           当玩家靠近地图边界时，这个菱形会有一角**伸出地图之外** →
           露出画布底（黑/透明），观感像 bug。
           做法：在应用等距变换**之前**（此刻还是屏幕系）铺满整屏的"远景色"。
           ⚠️ 只在等距时铺：非等距时地图总是盖满屏幕（camX/camY 有夹取），
              铺了反而会改变边界像素（破坏零回归）。
           ⚠️ v1.9.3：颜色**取调色板的暗色**（不是写死的 #2a2419）——
              写死色在不同区域（雪原/炎浆）会与地面完全脱节，像"贴了块黑板"。
              用 `pal.dark` 再压暗一档 → 读作"远处的地面"（大气透视）。 */
        if (ISO_ON && this._groundLayer) {
          var palF = this._pal();
          x.fillStyle = G.Art.shade((palF && palF.dark) || '#2a2419', -0.25);
          x.fillRect(0, 0, 480, 272);
        }
        this._drawGroundLayer(x, camX, camY);

        /* ===== 地图边界渐隐（v1.9.3）=====
           **为什么需要**：等距下地面是一张旋转 45° 的矩形 —— 它伸出屏幕外时，
           地图**边缘**在屏幕上是斜的，且纹理是 24px 一块 → 边缘呈 **24px 阶梯（锯齿）**，
           观感像 bug（实测截图确认）。
           **做法**：在**等距变换内部**（此时坐标 = 世界像素）沿地图四条边，
           向**内**画一条 N px 的渐变（从"远景色"淡到透明）→ 边界被"雾"吃掉，
           不再有硬边与锯齿。
           ⚠️ 必须画在**地面之后、高度层之前**（否则会盖住建筑/角色）。
           ⚠️ 高度 FADE 取 3 格（72px）：比一格厚、又不到"看不清地图"的程度。 */
        if (ISO_ON) {
          var FADE = TILE * 3;
          var palE = this._pal();
          var fogCol = G.Art.shade((palE && palE.dark) || '#2a2419', -0.25);
          var wl = this.map.w * TILE, hl = this.map.h * TILE;
          var _fade = function (x0, y0, x1, y1, gx0, gy0, gx1, gy1) {
            var gr = x.createLinearGradient(gx0, gy0, gx1, gy1);
            gr.addColorStop(0, fogCol);
            gr.addColorStop(1, 'rgba(0,0,0,0)');
            x.fillStyle = gr;
            x.fillRect(x0, y0, x1 - x0, y1 - y0);
          };
          /* 四条边各一条向内渐变 */
          _fade(0, 0, wl, FADE, 0, 0, 0, FADE);                       /* 上（世界 y 小侧） */
          _fade(0, hl - FADE, wl, hl, 0, hl, 0, hl - FADE);           /* 下 */
          _fade(0, 0, FADE, hl, 0, 0, FADE, 0);                       /* 左（世界 x 小侧） */
          _fade(wl - FADE, 0, wl, hl, wl, 0, wl - FADE, 0);           /* 右 */
        }

        /* 地形高度（v1.4.0）：抬升的格块 + 崖壁。
           位置：**铺地之上、明暗之下** —— 它是"地面的一部分"，
           要被 `_drawShade` 一起压暗才不显得浮。 */
        this._drawElevation(x, camX, camY);

        /* 整屏大尺度明暗（在铺地之上、建筑之下） */
        this._drawShade(x, this._baseType(), this._pal(), camX, camY);

        /* ===== 等距：底层到此为止，立牌层退出等距变换（v1.9.0）=====
           **必须在这里分出两层**（实测截图发现）：
             · **底层**（地面 / 高度块 / 崖壁 / 明暗 / 传送阵）：跟着等距矩阵转 → 菱形铺开
             · **立牌层**（建筑 / 装饰 / 家具 / NPC / 玩家 / 宝箱 / Boss / 界门…）：
               **必须退出矩阵、在屏幕系里画** —— 否则建筑会跟着地面"斜躺下来"，
               角色会"躺在地上"（这正是第一次截图的样子）。
           所有立牌绘制都走 `_proj`（世界像素 → 屏幕），所以退出后位置依然正确。
           ⚠️ 非等距时这段是 no-op（下面那个 `if (ISO_ON)` 不成立）。 */
        if (ISO_ON) x.restore();
        var _isoRestored = ISO_ON;

        /* 出口传送阵（云雾）。它在**底层之上、立牌之下** ——
           所以放在退出等距**之后**用 `_proj` 画（否则阵会跟着地面斜躺）。
           观感依据：角色站到阵上时人影压在雾上，读起来才是"站在阵里"。 */
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
        /* ⚠️ v1.9.0：**裁剪必须走 **（世界 AABB）。
           原来手算  的屏幕矩形 —— 等距下 camX 恒 0、且屏幕是旋转的，
           那套判据会把**整个世界**当成可见（1000+ 装饰全进排序）或全部裁掉。
            在非等距时恰好等于原矩形 → 逐像素不变。 */
        var mvB2 = this._viewBounds();
        var mvL = mvB2.x0 - TILE * 2, mvT = mvB2.y0 - TILE * 3;
        var mvR = mvB2.x1 + TILE * 2, mvB = mvB2.y1 + TILE * 3;
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
        /* 玩家：排序键要走 **`_pxDraw()`**（含高度）——与 `_drawPlayer` 同一套基准。
           ⚠️ v1.6.0 修：原先用 `_px()`（**逻辑**位置，不含高度），
              于是"排序基准"与"绘制基准"分叉 —— 玩家站高地时排序仍按地面位置，
              会与邻近低地物件出现遮挡错（详见下方 depth 注释）。 */
        var pp = this._pxDraw();
        list.push({ player: true, x: pp.x / TILE, y: pp.y / TILE });

        /* ===== 排序键：**绘制用的脚底 y**（v1.6.0）=====
           用户口径（承 v1.4/v1.5 的"纸片感/高低差"）：让高低差下的遮挡关系正确。

           **问题**：原先 `list.sort((a,b) => a.y - b.y)` 用的是**格坐标 y**
           （不含高度）。而绘制位置是 `y*TILE + 12 − elev*ELEV_STEP`。
           两者基准不同 → 高度差足够大时**绘制顺序反了**：
             例：(5,10) 高台(elev2) 与 (5,11) 低地(elev0)
             排序键 10 < 11 → 高台**先画**；但它绘制后的脚底(236) 比低地(276) **更靠上**
             → 应该"更靠下的后画"（低地压住高台下沿）。顺序反了 = 高台的下沿被低地盖住。

           **修法**：排序键统一成**绘制后的脚底像素 y**（`_depthOf`），
           与 `_drawPlayer` / `_drawDecor` 等用的基准**完全同一套**。
           ⚠️ 这是"同一判据禁止两处分写"的又一例：**排序基准必须与绘制基准同源**，
              否则两者会在某些取值下分叉，且**只在特定高度组合下才显形**（极难查）。
           ⚠️ 同一格内（depth 相等）保持稳定：用 `index` 兜底，避免 sort 不稳定导致的抖动。 */
        list.forEach(function (o, i) {
          o._i = i;
          o.depth = self._depthOf(o);
        });
        list.sort(function (a, b) {
          if (a.depth !== b.depth) return a.depth - b.depth;
          return a._i - b._i;
        });
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

        /* ⚠️ restore 的条件必须与上面 save 的**完全一致**（v1.8.0 顺手修）：
           原来是 `if (_zoom !== 1 || _shk)` 存、`if (_zoom !== 1)` 取 ——
           天劫震屏时（有 _shk 但 _zoom===1）**只存不取**，变换泄漏到 UI 层
           （HUD/追踪栏会跟着抖）。这类"存取条件不成对"是画布变换的经典坑，
           两个条件写在同一屏、隔 130 行很容易走散，所以都在这里注明。
           ⚠️ v1.9.0：等距模式下**已经在立牌层之前 restore 过一次**（为了让立牌
              保持竖直），所以这里必须**跳过**，否则会"还两次" ——
              多还一次会吃掉调用方（game.js）的变换，症状是**整个 UI 错位**。 */
        if (!_isoRestored && (_zoom !== 1 || _shk || _viewY !== 1)) x.restore();

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
        /* ⚠️ v1.9.0：传送阵画在**立牌层**（已退出等距），所以走 `_proj`
           —— 它虽然贴地，但因为画在退出之后，用屏幕投影才不会歪。
           （让它当"立牌"是有意的：阵的辉光是**屏幕对齐的径向渐变**，
             跟着等距转会被压成椭圆，读起来不像"光晕"。） */
        var _q = this._proj((e.x0 + e.x1 + 1) / 2 * TILE, e.y * TILE + 10 - LIFT);
        var cx = _q.x, cy = _q.y;
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
        var _q = this._proj(f.x * TILE, f.y * TILE - this._elevPx(f.x, f.y)); var px = _q.x, py = _q.y;
        var w = (f.w || 1) * TILE, h = (f.h || 1) * TILE;
        /* ⚠️ 裁剪走世界 AABB（ 是世界口径）→ 必须传**世界像素**，
           不能传上面  的结果（那是屏幕坐标，口径不一致会误判）。 */
        if (!this._inView(f.x * TILE, f.y * TILE, w, h)) return;
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
        var key = this.mapId + '|' + K + '|' + pal.ground + '|' + pal.rock
          + '|' + (ISO_ON && G.pixelOn && G.pixelOn() ? G.PIXEL : 1);
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

        /* 3) 等距瓦片感（v1.9.3 加强）——**逐格画瓦片**（缝 + 芯）。
           ⚠️ 为什么不能只改 `gGrass`（v1.9.2 的教训）：
              `groundTex` 的优先序是「**区域专属底图 → 地面类型素材 → 程序化**」——
              `ground.grass` / `ground.fan1` **素材存在**，所以程序化 `gGrass`
              **根本不会执行**（实测纹理输出 448×448 = 素材，不是 216 = GTS）。
              ⇒ **在程序化层改"地面观感"是无效的**；必须改**烘焙层**（素材之后）。
           **做法**（逐格两层，都在世界坐标里画 → 等距矩阵自动转成菱形）：
             · **瓦片缝**：格的上边 + 左边各 1px 暗线（alpha 0.16）
             · **瓦片芯**：格中心 8×8 极淡亮块（alpha 0.05）+ 坐标哈希的微明暗
           ⚠️ 数值是实测甜点：缝 0.16 能"读出格"但不刺眼；芯 0.05 让格子有"面"。
              再大就会像"网格纸"（v1.9.1 的格线方案就是栽在这）。 */
        if (ISO_ON) {
          var EDGE_A = 0.16, CORE_A = 0.05;
          g.fillStyle = 'rgba(0,0,0,' + EDGE_A + ')';
          for (var ey = 0; ey <= m.h; ey++) g.fillRect(0, ey * TILE, w, 1);       /* 横缝 */
          for (var ex = 0; ex <= m.w; ex++) g.fillRect(ex * TILE, 0, 1, h);       /* 竖缝 */
          g.fillStyle = 'rgba(255,246,220,' + CORE_A + ')';
          for (var cy3 = 0; cy3 < m.h; cy3++)
            for (var cx3 = 0; cx3 < m.w; cx3++)
              g.fillRect(cx3 * TILE + (TILE - 8) / 2, cy3 * TILE + (TILE - 8) / 2, 8, 8);
          /* 再叠一层"逐格微明暗"（坐标哈希）：让格子之间**有微差**，不呆板 */
          for (var ty2 = 0; ty2 < m.h; ty2++) {
            for (var tx2 = 0; tx2 < m.w; tx2++) {
              var hv = hashTile(tx2, ty2, this.mapId);
              if (hv < 0.5) continue;                 /* 一半的格不动 → 自然、不成规律 */
              g.fillStyle = hv > 0.75 ? 'rgba(255,246,220,0.030)' : 'rgba(40,30,16,0.030)';
              g.fillRect(tx2 * TILE, ty2 * TILE, TILE, TILE);
            }
          }
        }

        /* ===== 像素化（v2.0.0）=====
           地面预烘层是**整张地图**的高清图（K 倍），像素化必须在这一层做 ——
           不能靠渲染点关平滑：那样只是"不去插值地放大"，格边仍是 HD 抠出来的细边，
           读不出"一块一块的像素"。
           ⚠️ 缓存键必须**带上像素档位** —— 不带的话调 `G.PIXEL` 后旧层继续被复用
              （表现：改了开关画面没反应，且完全静默）。
           ⚠️ 道路蒙版（`_softRoads` 的 blur 羽化）**在像素化之前**已经混进 `c` ——
              所以路缘的羽化也会被一起量化成硬边。这是**想要**的：
              像素风里路缘本来就该是硬边台阶，而不是一段渐变。
           ⚠️ 只在 `ISO_ON` 时像素化：非等距手写图（town/field/…）已经调得很稳，
              本版不动它们（零回归）。 */
        if (ISO_ON && G.pixelOn && G.pixelOn() && G.Art && G.Art.pixelate) {
          c = G.Art.pixelate(c, G.PIXEL);
        }
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
          if (ISO_ON) {
            /* 等距：屏幕是**旋转**的 → 不能用"视口矩形"取源（那会取到世界的
               一个正矩形，旋转后盖不全屏幕）。改成**整张地图铺出去**：
               由矩阵负责旋转，被裁掉的区域 culling 由浏览器做（代价可接受，
               因为地面只有 1 次 drawImage）。
               ⚠️ 目标坐标是**世界像素 (0,0)→(w,h)**，不是屏幕坐标 ——
                  矩阵会把它转成菱形铺满屏幕。 */
            x.drawImage(this._groundLayer, 0, 0,
              Math.round(this.map.w * TILE * gk), Math.round(this.map.h * TILE * gk),
              0, 0, this.map.w * TILE, this.map.h * TILE);
          } else {
            x.drawImage(this._groundLayer,
              Math.round(camX * gk), Math.round(camY * gk),
              Math.round(480 * gk), Math.round(272 * gk),
              0, 0, 480, 272);
          }
        }
        /* ===== 世界层收口（v2.0.0）=====
           地面之后就是**世界层**（高度块 / 崖壁 / 建筑 / 家具 / 角色 / 物件）。
           ⚠️ 这里**不需要**按像素化改平滑开关 —— `A.pixelate` 是"两趟同尺寸"
              做法（降采样 → 最近邻升回原尺寸），像素块**已经烘进画布本身**，
              后续按什么方式放大都是块。第一版误以为要在这里关平滑，
              同时又缩了画布尺寸 → 取源矩形越界 → 整屏变黑（实测亮度 136→24）。
           ⚠️ 保持原逻辑（跟随 `this.smooth`）：探索场景是 true，与历史一致（零回归）。 */
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
        var y1 = Math.min(m.h - 1, Math.ceil((camY + this._viewH()) / TILE) + 4);
        /* 按 elev 分层画：低 → 高 */
        for (var lv = 1; lv <= emax; lv++) {
          for (var ty = y0; ty <= y1; ty++) {
            for (var tx = x0; tx <= x1; tx++) {
              var g = m.ground[ty][tx];
              if ((g.elev || 0) !== lv) continue;
              var px = tx * TILE - camX;
              var py = ty * TILE - camY - lv * ELEV_STEP;
              /* ⚠️ v1.7.0：**不在高度层重铺纹理**（原因见 `_drawSlope` 的头注：
                 重铺的纹理没有 `_drawShade` 那层叠加 → 与周围地面质感对不上，
                 读成一块异色补丁）。抬升的格块直接**透出预烘层**，
                 只叠"台面受光"这一点半透明效果 —— 它才是"高台"读得出来的主因。 */
              x.fillStyle = 'rgba(255,255,255,0.045)';
              x.fillRect(px, py, TILE, TILE);
              /* 落差面（v1.7.0）：**南向 + 东向都要画**，统一走 `_drawDrop` 分流。
                 ⚠️ v1.4~1.6 **只画了南向（+y）** —— 实测 fan5 南向落差仅 **5** 条、
                    东向 **94** 条：绝大多数落差**没有任何视觉表达**，
                    玩家看到的是"地面突然换了个高度"，正是"纸片感"的残留。
                 ⚠️ 两个方向都要**朝南/朝东**判定（本格比邻居高才画），
                    否则会把"上坡"画成"下坡"。 */
              var sS = (ty + 1 > m.h - 1) ? null : m.ground[ty + 1][tx];
              var eS = sS ? (sS.elev || 0) : 0;
              if (eS < lv) this._drawDrop(x, px, py + TILE, 'S', lv - eS, sS, tx, ty, pal);
              var sE2 = (tx + 1 > m.w - 1) ? null : m.ground[ty][tx + 1];
              var eE2 = sE2 ? (sE2.elev || 0) : 0;
              if (eE2 < lv) this._drawDrop(x, px + TILE, py, 'E', lv - eE2, sE2, tx, ty, pal);
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

      /* 落差面分流（v1.7.0）：把"这处落差画成什么"收敛成**唯一口**。
         **判据**：`elev` 本来就**不阻断通行**（v1.4.0 定的铁律：高度差只进表现层），
         所以**所有落差都是人能走的** → 一律画**坡面**（`_drawSlope`），
         只有**地图边缘**（`sN === null`，坡通向地图外）才画**截面**（`_drawCliff`）。
         ⚠️ 我先试过"两侧都是路面才算坡"的判据 —— 实测是**死条件**：
            生成型地图路面仅占 **0.2~0.6%**，落差边命中坡道的数量是 **0**。
            **判据要能被产出验证，不能只看"语义上说得通"。**
         ⚠️ 统一画坡的另一个理由：若按"缓坡/陡崖"分流，玩家会看到同一种地形
            因高度差不同而换皮（1 档=坡、2 档=崖），但**两者都能走上去** ——
            画面在撒谎。高度差只影响**坡的长短**，不影响"能不能走"。 */
      _drawDrop: function (x, px, py, dir, dLv, sN, tx, ty, pal) {
        if (dLv <= 0) return;
        var hgt = dLv * ELEV_STEP;
        /* 地图边缘：画截面（坡不能通向地图外，那里本来就是"世界的边") */
        if (!sN) { this._drawCliff(x, px, py, TILE, hgt, pal); return; }
        this._drawSlope(x, px, py, TILE, hgt, pal, dir, tx, ty);
      },

      /* 坡面（v1.8.0）：落差的竖向投影里画**真梯形**（远边窄、近边宽）。
         **为什么梯形才是"斜的"**：矩形坡面读起来是"一格色块"（平面），
         而**上窄下宽的梯形**天然表达"这个面朝观察者倾斜"——
         这正是《烟雨江湖》坡道的读法：靠形状而不是靠贴图。
         ⚠️ **仍然不动格子位置**：梯形只是格内画出的形状，
            格子的坐标、寻路、物件锚点全都不变（三者都按方形格算）。
            所以"几何上仍是 2.5D 平面"，但**视觉上有了斜面**。
         ⚠️ **不重铺地面纹理**（v1.7.0 教训）：预烘层之上还压着 
            （周期明暗，alpha 仅 15），重铺的纹理没有这层叠加 → 质感对不上、
            读成异色补丁。**只叠半透明，让底下的预烘地面透出来。**
         ⚠️ （东西向落差）时梯形要**横过来**（左右收窄），
            否则纹理方向与南北向的坡互相垂直、像贴错图。 */
      _drawSlope: function (x, px, py, w, hgt, pal, dir) {
        if (hgt <= 0) return;
        /* 收窄量：近边满宽，远边收窄。
           ⚠️ **基准必须按"被收窄的那个方向"取**（v1.8.0 修正）：
              南向落差的收窄发生在**横向** → 以格宽 w 为基准；
              东向落差的收窄发生在**纵向** → 以坡长 hgt 为基准。
            一开始两个方向都用 hgt*0.42 —— 南向正确（16→7，收 29%），
            东向则错（16 高的左边被收掉 14 → 只剩 2px，几乎成了三角形）。
            这是**从顶点序列实测**发现的：(100,57)(124,50)(124,66)(100,59)。
          ⚠️ 上限 0.30：收太多会露出底下的方形地面（地面是方的、坡是梯形的）。 */
        var ins = dir === 'E'
          ? Math.round(Math.min(w * 0.42, hgt * 0.30))
          : Math.round(Math.min(hgt * 0.42, w * 0.30));
        x.save();
        /* ① 梯形路径（两个方向各一种朝向） */
        x.beginPath();
        if (dir === 'E') {
          /* 东西向：**左边（远/高侧）窄、右边（近/低侧）宽** ——
             与南北向同理，只是收窄发生在纵向。
             ⚠️ 一开始这里写成了矩形（只有外层 4 顶点、没有纵向收窄），
                实测顶点 `(107,50)(124,50)(124,66)(107,66)` —— 左右都是 107/124，
                即"整体平移了个矩形"，**完全没有梯形效果**。已修。 */
          x.moveTo(px, py + ins);
          x.lineTo(px + w, py);
          x.lineTo(px + w, py + hgt);
          x.lineTo(px, py + hgt - ins);
        } else {
          /* 南北向：上（远/高侧）窄，下（近/低侧）宽 */
          x.moveTo(px + ins, py);
          x.lineTo(px + w - ins, py);
          x.lineTo(px + w, py + hgt);
          x.lineTo(px, py + hgt);
        }
        x.closePath();
        /* ② 斜面受光：渐变压暗（远边浅、近边深 —— 越靠下越背光） */
        var grd = dir === 'E'
          ? x.createLinearGradient(px, py, px + w, py)
          : x.createLinearGradient(px, py, px, py + hgt);
        grd.addColorStop(0, 'rgba(0,0,0,0.13)');
        grd.addColorStop(1, 'rgba(0,0,0,0.30)');
        x.fillStyle = grd;
        x.fill();
        /* ③ 踏阶暗线：梯形内按比例插值（跟随收窄，不是等宽横条） */
        var n = Math.max(1, Math.min(3, Math.round(hgt / 6)));
        x.fillStyle = 'rgba(0,0,0,0.22)';
        for (var i = 1; i < n; i++) {
          var t = i / n;
          if (dir === 'E') {
            /* 东西向：竖线，左界随 t 从 px+ins 左移到 px（跟随梯形收窄） */
            x.fillRect(px + ins * (1 - t), py, 1, hgt);
          } else {
            var xl = px + ins * (1 - t), xr = px + w - ins * (1 - t);
            x.fillRect(xl, py + Math.round(hgt * t), xr - xl, 1);
          }
        }
        /* ④ 底边：与下层地面接壤的阴影（沿近边全长） */
        var botH = Math.max(1, Math.round(hgt * 0.22));
        x.fillStyle = 'rgba(0,0,0,0.26)';
        if (dir === 'E') x.fillRect(px + ins, py, botH, hgt);
        else x.fillRect(px, py + hgt - botH, w, botH);
        /* ⑤ 上沿亮线：与台面接壤（远边）—— 高差的视觉锚点 */
        x.fillStyle = 'rgba(255,255,255,0.13)';
        if (dir === 'E') x.fillRect(px + w - 1, py, 1, hgt);
        else x.fillRect(px + ins, py, w - ins * 2, 1);
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

      /* 该格的高度像素偏移（整数格坐标；`_elevPx` 的简化版，供物件使用）。
         ⚠️ 无高度图返回 0（零回归）。 */
      _elevAt: function (tx, ty) {
        if (!(this._elevMax() > 0)) return 0;
        var m = this.map;
        var g = m.ground[ty] && m.ground[ty][tx];
        return ((g && g.elev) || 0) * ELEV_STEP;
      },

      /* ===== 高度偏移的**唯一出口**（v1.5.0）=====
         所有"随地形起伏"的绘制（玩家 / NPC / 树石 / 建筑 / 宝箱…）都走这里，
         不许各自去读 `ground[y][x].elev` —— 13 个绘制函数各写一份必然漏（项目老坑）。
         **双线性插值**（关键）：玩家移动时代入的是**浮点格坐标**，
          若直接取整格高度，跨落差的那一帧会**突跳**一格高（像被弹了一下）。
          双线性让"上坡/下坡"是**连续过渡**的 —— 这正是"坡"而非"台阶"的观感来源。
         ⚠️ 整数格坐标调用时（物件）双线性退化为最近格值，不会失真。 */
      _elevPx: function (fx, fy) {
        if (!(this._elevMax() > 0)) return 0;
        var m = this.map;
        var x0 = Math.floor(fx), y0 = Math.floor(fy);
        var tx = fx - x0, ty = fy - y0;
        var g = function (x, y) {
          var row = m.ground[y];
          var c = row && row[x];
          return ((c && c.elev) || 0);
        };
        /* 采样点夹在合法范围（边缘外按边界值，不做环绕） */
        var xa = Math.max(0, Math.min(m.w - 1, x0)), xb = Math.max(0, Math.min(m.w - 1, x0 + 1));
        var ya = Math.max(0, Math.min(m.h - 1, y0)), yb = Math.max(0, Math.min(m.h - 1, y0 + 1));
        var e = g(xa, ya) * (1 - tx) * (1 - ty) + g(xb, ya) * tx * (1 - ty)
          + g(xa, yb) * (1 - tx) * ty + g(xb, yb) * tx * ty;
        return e * ELEV_STEP;
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
        /* ⚠️ 这里**不传 `md.tex`**，是正确的 —— 路面纹理用的是 `groundTex('path', pal)`，
           与上面的基础地面平铺口径一致（路面**不**随区域底图变）。
           与 v1.7.0 高度层的差别在于：高度层要**复刻某一格的现有地面**（含区域底图），
           这里只是往空画布上铺路面纹理。两处目的不同，别照着对方改。 */

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
        if (ISO_ON) {
          /* 等距：铺满**世界**范围（矩阵会转成菱形盖住屏幕）——
             用 camX modulo + 屏幕循环在这里会完全失效（camX 恒 0）。 */
          var wl = this.map.w * TILE, hl = this.map.h * TILE;
          for (var wyy = 0; wyy < hl; wyy += SP)
            for (var wxx = 0; wxx < wl; wxx += SP)
              x.drawImage(sc, wxx, wyy, SP, SP);
          return;
        }
        var ox = -(((camX % SP) + SP) % SP), oy = -(((camY % SP) + SP) % SP);
        for (var yy = oy; yy < 272; yy += SP)
          for (var xx = ox; xx < 480; xx += SP)
            x.drawImage(sc, Math.round(xx), Math.round(yy), SP, SP);
      },

      _drawStructure: function (x, s, camX, camY) {
        /* ⚠️ v1.9.0：等距下**立牌的锚点必须是"脚底"**（建筑底边的中点），
           不是左上角 —— 因为等距要表达的是"这个物体**站在**哪一格的地面上"。
           用左上角会把建筑整体挪到地图的右上方（实测截图：建筑跑到屏幕右上角）。
           非等距时退回原公式（左上角 − cam），逐像素不变。 */
        var art0 = s.kind === 'house' ? G.Art.house(s, this._pal())
          : s.kind === 'ruin' ? G.Art.ruin(s, this._pal())
            : s.kind === 'gate' ? G.Art.gate(s, this._pal()) : null;
        var px, py;
        if (ISO_ON) {
          var _q = this._proj((s.x + (s.w || 1) / 2) * TILE,
            (s.y + (s.h || 1)) * TILE - this._elevPx(s.x, s.y));
          px = _q.x; py = _q.y;
        } else {
          var _q2 = this._proj(s.x * TILE, s.y * TILE - this._elevPx(s.x, s.y));
          px = _q2.x; py = _q2.y;
        }
        /* ⚠️ 同 ：裁剪口径是**世界像素**。 */
        if (!this._inView(s.x * TILE, s.y * TILE, s.w * TILE, s.h * TILE)) return;
        var pal = this._pal();
        var art = s.kind === 'house' ? G.Art.house(s, pal)
          : s.kind === 'ruin' ? G.Art.ruin(s, pal)
            : s.kind === 'gate' ? G.Art.gate(s, pal) : null;
        if (!art) return;
        /* 等距下 (px,py) 是**脚底中点** → 换回"结构格左上角"，
           好让下面的 `art.ox/oy` 逻辑（按格尺寸算的偏移）继续成立。 */
        if (ISO_ON) { px -= (s.w || 1) * TILE / 2; py -= (s.h || 1) * TILE; }
        var bx0 = px + (art.ox || 0), by0 = py + (art.oy || 0);
        var bw0 = art.w, bh0 = art.h;

        /* ===== 等距侧面（v1.9.3；v2.6.0 起按素材分流）=====
           **为什么需要**：**正视**素材（`A.house` 程序化 / 旧 `struct.*`）在等距下
           仍是一张平面图 —— 没有"两个可见面"，读不出"立方体"。
           **做法**：在 art **之前**先画一个"右后侧面"的平行四边形（屏幕系，
           用 `_proj` 投 4 个角），art 再盖在上面 →
           观感变成"正面（art）+ 右后侧面（新增）+ 屋顶（art 自带）"。
           ⚠️ 必须在 art **之前**画，否则侧面会盖住正面。
           ⚠️ 坐标一律用**绝对世界像素**（`_proj` 收的是绝度坐标）——
              写 `_proj(0, 0)` 是"世界的原点"，不是"建筑的左下角"（踩过）。

           ⚠️⚠️ **v2.6.0：像素等距建筑必须跳过这一段**。
             新出的像素建筑素材**自带两个可见面**，再补一个代码侧面会变成
             **两份侧面**（位置还错开，一眼就假）。
             分流判据 = `G.Art.isIsoNative(取图键)`（显式登记，见 art.js: A.ISO_NATIVE）
             —— **不要按"底边宽/最大宽"自动猜**：实测该比值受图上装饰
             （石狮/树/灯笼）影响，不可靠。 */
        var _artKey = null;
        if (s.kind === 'house') _artKey = 'struct.' + (s.bk || s.kind || 'house');
        else if (s.kind === 'gate') _artKey = 'struct.' + (s.bk || 'gate');
        else if (s.kind === 'ruin') _artKey = 'struct.ruin';
        var _isoNative = !!(G.Art.isIsoNative && G.Art.isIsoNative(_artKey));
        if (ISO_ON && !_isoNative) {
          var wallG = (pal && pal.dark) || '#3a2f22';
          var wx0 = s.x * TILE;                 /* 建筑左下角（世界像素，绝对值） */
          var wy0 = s.y * TILE;
          var ww = (s.w || 1) * TILE, wh = (s.h || 1) * TILE;
          /* 侧面深度：等距 2:1 下"深度"取格宽的一半，与菱形比例一致 */
          var DD = ww * (ISO_RATIO * 2 * 0.5) * 0.9;   /* ≈ ww*0.45 */
          /* 4 角：右后侧面 = 右下(y0) / 右上(y0+wh) / 后右上 / 后右下 */
          var _a = this._proj(wx0, wy0);              /* 前-左下 */
          var _b = this._proj(wx0, wy0 + wh);         /* 前-左上 */
          var _c = this._proj(wx0 + DD, wy0 + wh);    /* 后-左上 */
          var _d = this._proj(wx0 + DD, wy0);         /* 后-左下 */
          x.save();
          x.fillStyle = wallG;
          x.beginPath();
          x.moveTo(_b.x, _b.y); x.lineTo(_c.x, _c.y);
          x.lineTo(_d.x, _d.y); x.lineTo(_a.x, _a.y);
          x.closePath(); x.fill();
          /* 侧面顶边暗线（受光对侧，强化"两个面"的转折） */
          x.strokeStyle = 'rgba(0,0,0,0.38)';
          x.lineWidth = 1;
          x.beginPath(); x.moveTo(_b.x, _b.y); x.lineTo(_c.x, _c.y); x.stroke();
          x.restore();
        }

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
        var _q = this._proj(o.x * TILE, o.y * TILE - this._elevPx(o.x, o.y)); var px = Math.round(_q.x), py = Math.round(_q.y);
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
        var _q = this._proj(o.x * TILE, o.y * TILE - this._elevPx(o.x, o.y)); var px = _q.x, py = _q.y;
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
        var _q = this._proj(sp.x * TILE, sp.y * TILE - this._elevPx(sp.x, sp.y)); var px = _q.x, py = _q.y;
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
        var _q = this._proj(sp.x * TILE, sp.y * TILE - this._elevPx(sp.x, sp.y)); var px = _q.x, py = _q.y;
        var art = G.Art.chest(opened);
        G.Art.blit(x, art, px, py);
      },

      _drawBoss: function (x, sp, camX, camY) {
        var _q = this._proj(sp.x * TILE, sp.y * TILE - this._elevPx(sp.x, sp.y)); var px = _q.x, py = _q.y;
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
        var _q = this._proj(sp.x * TILE, sp.y * TILE - this._elevPx(sp.x, sp.y)); var px = _q.x, py = _q.y;
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
        var _q = this._proj(sp.x * TILE, sp.y * TILE - this._elevPx(sp.x, sp.y)); var px = _q.x, py = _q.y;
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
        /* ⚠️ v1.9.0：暗幕是**屏幕系的径向渐变**（画在世界层收口之后）→
           必须把玩家位置投到屏幕（`_proj`），否则等距下光圈会跑到画面外
           （症状：整屏全黑或光圈错位）。 */
        var _vq = this._proj(pp.x, pp.y);
        var sx = _vq.x, sy = _vq.y;
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
        /* ⚠️ 走 `_proj` 统一口径（它内部已处理"非等距除 VIEW_Y / 等距投屏幕"）。
           ⚠️ v1.8.0 的坑：这里画在**世界层 restore 之后**（屏幕坐标系），
              直接用世界坐标会让雾圈比主角**偏下**。
           ⚠️ v1.9.0：等距下更错（camX/camY 恒 0）→ 光圈会跑到画面外。 */
        var _wq = this._proj(pp.x, pp.y);
        var sx = _wq.x, sy = _wq.y;
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
        var pp = this._pxDraw();   /* 玩家绘制：带地形高度偏移（v1.5.0） */
        /* ⚠️ v1.9.0：等距下走  —— 玩家是**立牌**，必须保持屏幕竖直
           （跟着等距矩阵转会"躺在地上"，实测截图确认）。 */
        var _pq = this._proj(pp.x, pp.y);
        var px = _pq.x, py = _pq.y;
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
        /* v2.0.0 换装：帧初把当前外观登记给精灵层（**唯一来源 = 存档**）。
           为什么在**这里**登记而不是 `enter()`：玩家在面板里换完衣服**不切场景**，
           `enter()` 不会再跑一次 → 外观就会停在上次进图时的样子。
           挂在渲染点上每帧登记，代价是一次对象分配（不建位图），换装即刻生效。
           ⚠️ 登记是**幂等**的：`setLook` 只存引用，缓存失效由 `lkTagOf` 的键负责。 */
        var _look = G.Sprites.lookOf(this.save || (G.game && G.game.save));
        G.Sprites.setLook(_look);
        var _pal = (G.Data.appearance ? G.Data.appearance.palOf(this.save || (G.game && G.game.save)) : null);
        var frames = G.Sprites.heroAnim(view, this.moving ? 'walk' : 'idle', _look);
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
          /* ===== 斜俯角反向补偿（v1.8.0）=====
             世界层被纵向压了 `1/VIEW_Y`，角色若跟着压就"矮胖变形"——
             人应该是**站着**的。这里乘回 `VIEW_Y` 抵消。
             ⚠️ **以脚底为不动点**（与上面的呼吸同法）：
                绕中心放大会让人"从地里长出来"，脚离地。
             顺序：先移到脚底 → 反向缩放 → 移回 → 再画。
             ⚠️ 与 `breathe` 分开写两次 scale 是可以的（都是纵向，
                结果等价于 `breathe * VIEW_Y`），但**合并会与呼吸的
                "脚底不动点"逻辑纠缠**，分开更清楚。 */
          if (VIEW_Y !== 1) {
            var footY2 = animY + AH;
            x.translate(0, footY2);
            x.scale(1, VIEW_Y);
            x.translate(0, -footY2);
          }
          x.drawImage(frames[fi], Math.round(-AW / 2), animY, AW, AH);
          x.restore();
        } else {
          /* ===== v2.0.0 换装兜底帧 =====
             无手绘帧（素材缺 / 穿了非默认外观）时走程序化分层。
             ⚠️ 旧实现写的是 `G.Sprites.heroFrames()[this.dir][this.frame]` —— 那是
                **不带外观的**缓存表，换来换去永远画默认外观。
                现在改为**按外观取帧**：`heroSprite(dir, step, pal, look)` 的缓存键
                自带 `lkTag`，所以"换了衣服"必然烘出新位图。
             ⚠️ 呼吸/反向补偿那段**照旧保留** —— 它与外观无关，是"人站着不浮"的判据。 */
          var spr0 = G.Sprites.heroSprite
            ? G.Sprites.heroSprite(this.dir, this.frame, _pal, _look)
            : G.Sprites.heroFrames()[this.dir][this.frame];
          x.save();
          x.translate(px, py + 3);
          /* 兜底帧同样要做反向补偿（不然只有"有动画帧"的角色不变形） */
          if (VIEW_Y !== 1) {
            x.translate(0, -HH + bob);
            x.scale(1, VIEW_Y);
            x.translate(0, HH - bob);
          }
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
        var _q = this._proj(n.x * TILE + 8, n.y * TILE + 12 - this._elevPx(n.x, n.y)); var px = _q.x, py = _q.y;
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
        /* ⚠️ v1.9.0：明雷是**立牌**（画在退出等距之后）→ 必须走 `_proj`，
           否则它在等距下会停在"方形世界坐标当屏幕坐标"的位置（跑到画面外）。 */
        var _rq = this._proj(r.x * TILE + 8, r.y * TILE + 12);
        var gx = _rq.x, gy = _rq.y;
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
        /* ⚠️ v1.8.0：同 _drawInteractHint —— 屏幕系，纵向除 VIEW_Y */
        var _q = this._proj(m.x * TILE + 8, m.y * TILE + 8 - this._elevPx(m.x, m.y)); var px = _q.x, py = _q.y;
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
        /* ⚠️ v1.8.0：画在世界层 restore 之后（屏幕系）→ 纵向除 VIEW_Y 才能与世界对齐 */
        var _q = this._proj(f.x * TILE + 8, f.y * TILE - this._elevPx(f.x, f.y)); var px = _q.x, py = _q.y;
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
