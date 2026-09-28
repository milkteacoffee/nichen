/* 地图数据：结构建筑、道路、围栏、散布与出入口（宝可梦式俯视瓦片，16px/格） */
(function () {
  function S(id, kind, x, y, w, h, extra) {
    var o = { id: id, kind: kind, x: x, y: y, w: w, h: h };
    if (extra) Object.keys(extra).forEach(function (k) { o[k] = extra[k]; });
    return o;
  }
  /* 道路段：h 横 / v 纵 */
  function path(kind, x, y, n) { return { kind: kind, x: x, y: y, n: n }; }
  function fence(x0, y0, x1, y1, gap) { return { x0: x0, y0: y0, x1: x1, y1: y1, gap: gap }; }

  var maps = {
    town: {
      id: 'town', w: 36, h: 24, safe: true, ground: 'town', tex: 'fan1',
      spawn: { x: 18, y: 21 },
      structures: [
        /* `bk`（建筑类型）= **素材取图的键**（v0.16.0）：`struct.<bk>` 优先，
           没有则退回 `struct.<kind>`。不写 `bk` 的话，药铺和民居会共用同一张图。
           ⚠️ `kind` 只管"画法大类"（house/ruin/gate），`bk` 才是"这是哪家店"。 */
        /* 宗门山门（v0.42.0）：青溪剑阁就开在青溪镇上。
           ⚠️ 位置（6,15）是**南侧空场**，不是北面住宅区 —— 那里已经被 `home`（x3..8,y5..9）
              与四面围栏占满，硬塞山门会和洞府**叠在一起画**（两栋楼重叠）。
              放在玩家出生点（18,21）往西一眼能看见的空地上。 */
        S('gateQxj', 'gate', 6, 15, 6, 3, {
          label: '青溪剑阁 · 山门', to: 'sect.qxj.gate', spawn: { x: 15, y: 14 }
        }),
        S('home', 'house', 3, 5, 6, 5, { label: '洞府', bk: 'house', roof: '#6b5a4a' }),
        S('shop', 'house', 14, 6, 6, 5, { label: '药铺', bk: 'apothecary', roof: '#5a6478' }),
        S('market', 'house', 26, 7, 5, 4, { label: '刘记杂货', bk: 'shop', roof: '#78624a' })
      ],
      paths: [
        path('v', 18, 11, 12),
        path('h', 6, 11, 13),
        path('h', 18, 12, 11),
        path('h', 28, 12, -9),
        /* 东出落霞镇的路（v0.19.0）：y=20 是唯一一条从 x=18 到东缘不压任何
           建筑/NPC/水井的横线（well 在 y=16、浣衣妇在 (22,18)）。 */
        path('h', 18, 20, 18)
      ],
      fences: [
        fence(2, 4, 10, 4, { x: 6, y: 4 }),
        fence(2, 11, 2, 4, null),
        fence(10, 11, 10, 4, null),
        fence(2, 11, 10, 11, { x: 6, y: 11 })
      ],
      scatter: { trees: 6, rocks: 2 },
      special: [ { id: 'well', kind: 'well', x: 23, y: 16 } ],
      /* 屋门 → 室内图。**单一真相源**：town.js 的 onInteract 与探索场景的
         「路引」寻路都读这一份。以前这份映射写在 town.js 里（DOOR_TO_MAP），
         路引要做跨图寻路就得再抄一遍 —— 两份表迟早会分叉。 */
      doors: { home: 'town_home', shop: 'town_shop', market: 'town_market' },
      /* 站桩 NPC（探图 v0.2 §NPC）：占格实心、按 y 排序渲染、可点可面对交互。
         位置必须避开道路 —— 镇里的主路只有 1 格宽，NPC 站上去就把路堵死了。
         NPC 只有正面一套画法（程序化或 char.npc.<kind>），所以不配朝向。 */
      npcs: [
        { id: 'washer', kind: 'villager', name: '浣衣妇', portrait: 'villager',
          x: 22, y: 18, act: 'chat.washer' },
        { id: 'woodman', kind: 'villager', name: '老樵夫', portrait: 'villager',
          x: 7, y: 13, act: 'chat.woodman' },
        /* 外堂探子（M1 §4 m1-1 起）：化名"行脚商"，站在刘记杂货附近。
           condStep = 只在主线走到这一步时才出现，由 mapgen 在每次进图时求值。
           用**字符串**而不是函数：契约测试要能"把存档拨到那一步再建一次图"来验占位，
           函数式条件没法从外部驱动，等于这条 NPC 的占格检查永远测不到。 */
        { id: 'probe', kind: 'cultist', name: '行脚商', portrait: 'cultist',
          x: 25, y: 15, act: 'probe', condStep: 'm1-2' }
      ],
      exits: [
        { x0: 17, x1: 19, y: 23, to: 'field', spawn: { x: 24, y: 37 }, label: '翠微山' },
        /* 东出落霞镇（凡界 F4）：25 个生成型区域全靠这一条链才走得到 ——
           没有它，fan4–fan9 就是**孤岛**（地图生成得出来、玩家永远到不了）。 */
        { x0: 35, x1: 35, y: 20, to: 'fan4', spawn: { x: 1, y: 14 }, label: '落霞镇' },
        /* 四通八达（v0.34.0）：青溪镇是**宗门所在**（青溪剑阁），西缘再开一条通往黑风岭的路 */
        { x0: 0, x1: 0, y: 12, to: 'fan5', spawn: { x: 40, y: 15 }, label: '黑风岭' }
      ]
    },

    /* ===== 云州城（M2，v0.65.0，用户「M2 云州城主线」）=====
       凡界第二座城，比青溪镇大一倍：**城主府 / 云州论道台 / 丹霞坊 / 云州铁坊 / 云州客栈 / 西市**
       + 四条主街十字。M1 结尾「离乡，往云州城去」指向的就是这里（主线 m2-1..m2-3）。
       ⚠️ 这是**手写地图**（不是 regiongen 生成）—— 生成型区域的 NPC 是通用的村民/掌柜，
          没有对话钩子，做不了主线。手写的代价是：出口要在 `exits` 里自己写（见下），
          而且 `regiongen.targetSpawn` 对"有 map 的区域"直接取 `md.spawn`，所以**入口落点就是 spawn**。
       ⚠️ NPC 站位必须避开道路 —— 主街只有 1 格宽，站上去就把路堵死了（青溪镇踩过）。 */
    yunzhou: {
      id: 'yunzhou', w: 44, h: 30, safe: true, ground: 'town', tex: 'fan4',
      /* ⚠️ `label` 是场景名牌的**唯一来源**（`explore._sceneName` 只对 town/field/cave 有硬编码兜底，
         其余一律返回 mapId）—— 不写它，左上角会显示裸 id「yunzhou」。 */
      label: '云州城',
      spawn: { x: 22, y: 27 },
      structures: [
        S('keep', 'ruin', 3, 3, 11, 6, { label: '城主府', bk: 'hall', roof: '#4a4a5a' }),
        S('pavilion', 'ruin', 19, 3, 10, 5, { label: '云州论道台', bk: 'tower', roof: '#46566a' }),
        S('alchemy', 'house', 34, 4, 7, 5, { label: '丹霞坊', bk: 'alchemy', roof: '#6a4a4a' }),
        S('smithy', 'house', 34, 15, 7, 5, { label: '云州铁坊', bk: 'smithy', roof: '#5a5a5a' }),
        S('inn', 'house', 3, 15, 7, 5, { label: '云州客栈', bk: 'inn', roof: '#6a5a4a' }),
        S('market', 'house', 3, 23, 7, 4, { label: '西市', bk: 'shop', roof: '#78624a' }),
        S('houseA', 'house', 14, 20, 4, 3, { label: '民居', bk: 'house' }),
        S('houseB', 'house', 27, 20, 4, 3, { label: '民居', bk: 'house' })
      ],
      /* 主街：一条南北纵街 + 两条东西横街，十字交叉在 (22,12) */
      paths: [
        path('v', 22, 4, 25),
        path('h', 8, 12, 30),
        path('h', 8, 22, 30)
      ],
      scatter: { trees: 8, rocks: 3 },
      special: [ { id: 'well', kind: 'well', x: 30, y: 12 } ],
      /* 云州城的建筑**不做室内**（v0.65.0 的取舍）：手写室内要另写一套 makeInterior，
         而本轮的交付重点是"城 + 主线"，服务由街面 NPC 直接给（投宿 / 坊市 / 打造 / 炼丹）。
         以后要补室内，在 `doors` 里加映射并在 yunzhou.js 里注册场景即可。 */
      npcs: [
        /* 主线三人组：城主府执事 → 论道台裁判 → 归客 */
        { id: 'yz_steward', kind: 'elder', name: '城主府执事', portrait: 'villager',
          x: 17, y: 10, act: 'steward' },
        { id: 'yz_judge', kind: 'keeper', name: '论道台裁判', portrait: 'villager',
          x: 24, y: 10, act: 'judge' },
        /* 服务：坊市 / 投宿 / 打造 / 炼丹（复用已有服务，不另写一套） */
        { id: 'yz_market', kind: 'keeper', name: '西市掌柜', portrait: 'keeper',
          x: 8, y: 21, act: 'market' },
        { id: 'yz_inn', kind: 'keeper', name: '客栈小二', portrait: 'keeper',
          x: 8, y: 14, act: 'inn' },
        { id: 'yz_smith', kind: 'villager', name: '铁坊匠人', portrait: 'villager',
          x: 32, y: 14, act: 'smith' },
        { id: 'yz_dan', kind: 'villager', name: '丹霞坊主', portrait: 'villager',
          x: 32, y: 4, act: 'dan' },
        { id: 'yz_story', kind: 'villager', name: '说书人', portrait: 'villager',
          x: 14, y: 12, act: 'story' }
      ],
      exits: [
        /* 南门 → 落霞镇（凡界 F4 的枢纽，那格是十字路口，一定走得到）。
           ⚠️ 反向那条（fan4 → fan10）写在 regions.js 的 fan4.exits 里；
              两侧都要有，否则是**有向断头路**（能出去、回不来）。 */
        { x0: 21, x1: 23, y: 29, to: 'fan4', spawn: { x: 22, y: 15 }, label: '落霞镇' },
        /* 北门 → 落霞灵矿（M2-3 的台词就说"灵界之门在落霞镇西边那座废矿底下"，
           这条门是把那句话变成能走的路）。反向写在 fan8.exits 的 south。 */
        { x0: 21, x1: 23, y: 0, to: 'fan8', spawn: { x: 21, y: 14 }, label: '落霞灵矿' }
      ]
    },

    field: {
      id: 'field', w: 50, h: 40, ground: 'grass', tex: 'fan2',
      spawn: { x: 24, y: 37 },
      zones: [
        /* sp = 单只遭遇的相对权重；pair = 双只组出现概率（%，灵根切片 v0.3 §11）
           bias = 该物种在本区的等级偏移（前坡狼比蛇高一段） */
        { id: 'front', y0: 28, y1: 39, enc: { min: 5, max: 16 },
          sp: { 青纹蛇: 60, 赤炎狼: 30 }, pair: 10, pairWith: '青纹蛇',
          bias: { 赤炎狼: 1 } },
        { id: 'mid', y0: 15, y1: 27, enc: { min: 13, max: 24 },
          sp: { 赤炎狼: 50, 青纹蛇: 20 }, pair: 30, pairWith: '赤炎狼' },
        { id: 'back', y0: 2, y1: 14, enc: { min: 17, max: 32 },
          sp: { 树精: 50, 赤炎狼: 25 }, pair: 25, pairWith: '树精' }
      ],
      structures: [
        S('temple', 'ruin', 40, 32, 5, 4, { label: '山神庙' }),
        /* 宗门山门（v0.42.0）：翠微御灵宗就设在翠微山 */
        S('gateCwl', 'gate', 30, 26, 6, 3, {
          label: '翠微御灵宗 · 山门', to: 'sect.cwl.gate', spawn: { x: 15, y: 14 }
        }),
        S('caveIn', 'gate', 23, 2, 4, 2, {
          label: '赤牙洞', need: { globalLevel: 16 },
          to: 'cave', spawn: { x: 16, y: 24 },
          closedText: '落石封路，需淬体四重以上修为。'
        })
      ],
      paths: [ path('v', 24, 4, 35), path('h', 24, 20, 26) ],
      fences: [],
      scatter: { trees: 46, rocks: 22 },
      special: [
        { id: 'chest1', kind: 'chest', x: 10, y: 20, loot: { stone: 100 } },
        { id: 'chest2', kind: 'chest', x: 38, y: 8, loot: { items: { '解封符': 2 } } },
        /* 第一处秘境裂隙（v0.60，用户第 11 点）：需沈伯「引灵符」解封，slot 0 */
        { id: 'rift0', kind: 'entrance', x: 6, y: 17, slot: 0 }
      ],
      exits: [
        { x0: 23, x1: 26, y: 39, to: 'town', spawn: { x: 18, y: 20 }, label: '青溪镇' },
        /* 东出落霞镇（凡界 F4）：翠微山不再只是"回镇 / 进洞"的死胡同。 */
        { x0: 49, x1: 49, y: 20, to: 'fan4', spawn: { x: 1, y: 14 }, label: '落霞镇' },
        /* 四通八达（v0.34.0）：翠微山是**宗门所在**（青溪剑阁/翠微御灵宗），
           北缘再开一条通往幽篁谷的路 —— 原先进出只有"回镇/去落霞镇"两条，太单薄。 */
        { x0: 24, x1: 26, y: 0, to: 'fan6', spawn: { x: 20, y: 28 }, label: '幽篁谷' }
      ]
    },

    cave: {
      id: 'cave', w: 32, h: 26, ground: 'cave', tex: 'fan3',
      spawn: { x: 16, y: 24 },
      zones: [ { id: 'cave', y0: 4, y1: 25, enc: { min: 21, max: 36 },
        sp: { 青纹蛇: 40, 赤炎狼: 35, 树精: 25 }, pair: 35, pairWith: '青纹蛇' } ],
      structures: [],
      paths: [], fences: [],
      scatter: { rocks: 30 },
      special: [
        { id: 'chest3', kind: 'chest', x: 8, y: 14,
          loot: { stone: 150, items: { '回春丹': 2 } } },
        { id: 'boss', kind: 'boss', x: 16, y: 6 }
      ],
      exits: [ { x0: 14, x1: 17, y: 25, to: 'field', spawn: { x: 24, y: 4 }, label: '翠微山' },
        /* 四通八达（v0.34.0）：洞窟不再是单出口的死胡同，东缘再开一条通往乱葬岗 */
        { x0: 31, x1: 31, y: 13, to: 'fan7', spawn: { x: 2, y: 15 }, label: '乱葬岗' } ]
    },

    /* 血煞外堂据点（M1 §5.1）：一次性剧情图。
       ground = bloodcave（cave 的暗红换色变体，art.js 已接）；safe → 无暗雷；
       连战节点是 scriptBattle（走到即开战，不占格、不登记交互、但会 mark 防散布压格）；
       血面在堂中，走"站旁边按交互"的老约定（boss 物件）。
       抉择 1 = spare 时首战免打（阿七开门）；= kill 时追加一战（血煞教报复加码）。
       打完由 town 侧按 q.flags.bloodNight 拒绝再进（入口 toast「据点已塌」）。 */
    bloodhall: {
      id: 'bloodhall', w: 30, h: 24, ground: 'bloodcave', safe: true,
      label: '血煞外堂据点',
      spawn: { x: 14, y: 21 },
      structures: [], paths: [], fences: [],
      scatter: { rocks: 14 },
      special: [
        { kind: 'scriptBattle', id: 'hallGate', x: 14, y: 18,
          enemies: [ { sp: '血煞教徒', lv: 65 } ],
          skipFlag: { key: 'probe', val: 'spare' } },
        { kind: 'scriptBattle', id: 'hallHall', x: 14, y: 12,
          enemies: [ { sp: '血煞教徒', lv: 61 }, { sp: '血蝠', lv: 65 } ] },
        { kind: 'scriptBattle', id: 'hallRevenge', x: 21, y: 9,
          enemies: [ { sp: '血煞教徒', lv: 65 }, { sp: '血煞教徒', lv: 65 } ],
          onlyFlag: { key: 'probe', val: 'kill' } },
        { kind: 'boss', id: 'xuemian', x: 15, y: 5 }
      ],
      exits: [ { x0: 13, x1: 16, y: 23, to: 'town', spawn: { x: 15, y: 10 }, label: '青溪镇' } ]
    },

    /* ============================================================
       室内：全部按 30×17 格（正好一屏 480×272），门开在下边墙正中。
       spawn 是进门后的落脚点（门内侧一格），exits 走回门外那一格。
       ============================================================ */

    town_home: {
      id: 'town_home', w: 30, h: 17, indoor: true, ground: 'floor', safe: true,
      label: '洞府', spawn: { x: 15, y: 14 },
      /* 家具从 y=3 起摆：房间正好一屏（17 格），顶部 0—2 行会被 HUD 盖住 */
      furn: [
        { id: 'bed', kind: 'bed', x: 3, y: 3, w: 3, h: 2, act: 'rest', label: '床' },
        { id: 'vessel', kind: 'vessel', x: 13, y: 3, w: 2, h: 2, act: 'cult', label: '逆命珠' },
        { id: 'screen', kind: 'screen', x: 20, y: 3, w: 4, h: 1 },
        { id: 'table', kind: 'table', x: 22, y: 5, w: 3, h: 2 },
        { id: 'cushion', kind: 'cushion', x: 13, y: 8, w: 2, h: 2, act: 'meditate', label: '蒲团' },
        { id: 'lanternL', kind: 'lantern', x: 1, y: 8, w: 1, h: 2 },
        { id: 'lanternR', kind: 'lantern', x: 28, y: 8, w: 1, h: 2 },
        { id: 'shelf', kind: 'shelf', x: 2, y: 12, w: 3, h: 1 },
        { id: 'jar', kind: 'jar', x: 6, y: 13, w: 1, h: 1 },
        { id: 'crate', kind: 'crate', x: 25, y: 13, w: 1, h: 1 }
      ],
      exits: [ { x0: 14, x1: 15, y: 16, to: 'town', spawn: { x: 6, y: 11 }, label: '出门' } ]
    },

    town_shop: {
      id: 'town_shop', w: 30, h: 17, indoor: true, ground: 'floor', safe: true,
      label: '药铺', spawn: { x: 15, y: 14 },
      furn: [
        { id: 'shelfA', kind: 'shelf', x: 2, y: 3, w: 3, h: 1 },
        { id: 'shelfB', kind: 'shelf', x: 25, y: 3, w: 3, h: 1 },
        { id: 'lanternL', kind: 'lantern', x: 1, y: 5, w: 1, h: 2 },
        { id: 'lanternR', kind: 'lantern', x: 28, y: 5, w: 1, h: 2 },
        /* 柜台动作仍是 shenbo（v0.17.0）：沈伯的**任务对话与开店都走这一条路** ——
           有剧情先演剧情、没剧情才开店（见 town.js: shenBo 的兜底分支）。
           拆成两个动作的话，主线对话会被柜台吞掉。 */
        { id: 'counter', kind: 'counter', x: 11, y: 6, w: 5, h: 1, act: 'shenbo', label: '柜台' },
        { id: 'jarA', kind: 'jar', x: 2, y: 7, w: 1, h: 1 },
        { id: 'jarB', kind: 'jar', x: 27, y: 7, w: 1, h: 1 },
        { id: 'jarC', kind: 'jar', x: 2, y: 11, w: 1, h: 1 },
        { id: 'jarD', kind: 'jar', x: 27, y: 11, w: 1, h: 1 },
        { id: 'crate', kind: 'crate', x: 26, y: 10, w: 1, h: 1 },
        { id: 'shelfC', kind: 'shelf', x: 2, y: 13, w: 3, h: 1 },
        { id: 'shelfD', kind: 'shelf', x: 25, y: 13, w: 3, h: 1 }
      ],
      /* 沈伯站在柜台之后（y=5，柜台 y=6）。室内 y<5 的话头顶会被顶部 HUD 压住，
         连任务标记都会藏进 HUD 里，所以掌柜一律摆到 y≥5。 */
      npcs: [
        { id: 'shenbo', kind: 'elder', name: '沈伯', portrait: 'shenbo', gl: 105,
          x: 13, y: 5, act: 'shenbo' }
      ],
      exits: [ { x0: 14, x1: 15, y: 16, to: 'town', spawn: { x: 17, y: 12 }, label: '出门' } ]
    },

    town_market: {
      id: 'town_market', w: 30, h: 17, indoor: true, ground: 'floor', safe: true,
      label: '刘记杂货', spawn: { x: 15, y: 14 },
      furn: [
        { id: 'crateA', kind: 'crate', x: 2, y: 3, w: 1, h: 1 },
        { id: 'crateB', kind: 'crate', x: 3, y: 3, w: 1, h: 1 },
        { id: 'crateC', kind: 'crate', x: 2, y: 4, w: 1, h: 1 },
        { id: 'crateD', kind: 'crate', x: 4, y: 3, w: 1, h: 1 },
        { id: 'crateE', kind: 'crate', x: 25, y: 3, w: 1, h: 1 },
        { id: 'crateF', kind: 'crate', x: 26, y: 3, w: 1, h: 1 },
        { id: 'crateG', kind: 'crate', x: 25, y: 4, w: 1, h: 1 },
        { id: 'lanternL', kind: 'lantern', x: 1, y: 7, w: 1, h: 2 },
        { id: 'lanternR', kind: 'lantern', x: 28, y: 7, w: 1, h: 2 },
        { id: 'counter', kind: 'counter', x: 10, y: 7, w: 5, h: 1, act: 'market', label: '柜台' },
        { id: 'table', kind: 'table', x: 20, y: 9, w: 3, h: 2 },
        { id: 'jarA', kind: 'jar', x: 2, y: 13, w: 1, h: 1 },
        { id: 'jarB', kind: 'jar', x: 3, y: 13, w: 1, h: 1 },
        { id: 'shelf', kind: 'shelf', x: 25, y: 13, w: 3, h: 1 }
      ],
      npcs: [
        { id: 'keeper', kind: 'keeper', name: '刘掌柜', portrait: 'keeper', gl: 17,
          x: 12, y: 6, act: 'market' }
      ],
      exits: [ { x0: 14, x1: 15, y: 16, to: 'town', spawn: { x: 28, y: 12 }, label: '出门' } ]
    },

    field_temple: {
      id: 'field_temple', w: 30, h: 17, indoor: true, ground: 'floor', safe: true,
      label: '山神庙', spawn: { x: 15, y: 14 },
      furn: [
        { id: 'altar', kind: 'altar', x: 13, y: 3, w: 3, h: 2, act: 'temple', label: '神台' },
        { id: 'lanternL', kind: 'lantern', x: 4, y: 4, w: 1, h: 2 },
        { id: 'lanternR', kind: 'lantern', x: 25, y: 4, w: 1, h: 2 },
        { id: 'cushion', kind: 'cushion', x: 14, y: 7, w: 2, h: 2 },
        { id: 'jarA', kind: 'jar', x: 4, y: 13, w: 1, h: 1 },
        { id: 'jarB', kind: 'jar', x: 5, y: 13, w: 1, h: 1 },
        { id: 'crateA', kind: 'crate', x: 24, y: 13, w: 1, h: 1 },
        { id: 'crateB', kind: 'crate', x: 25, y: 12, w: 1, h: 1 }
      ],
      exits: [ { x0: 14, x1: 15, y: 16, to: 'field', spawn: { x: 41, y: 36 }, label: '出门' } ]
    }
  };

  G.Data = G.Data || {};
  G.Data.maps = maps;
})();
