/* 底部功能栏 + 六个常驻面板（v0.8.0）
 *
 * 背景：这六项（角色/功法/秘术/任务/储物/成就）原先全塞在「菜单」二级页里，
 * 每次要点两下才能到，而且是"探索途中最高频的操作"。现在拆出来常驻底栏、一键直达；
 * 「菜单」这一页随之删除 —— 顶栏右上角只剩「设置」（天道模型 / 界域难度 / 关于）。
 *
 * 三条约束：
 *   ① 底栏高度 = Explore.BOT_H，探索场景的 onTap 靠它挡掉误触（同 HUD_H 的道理）；
 *   ② 面板内**也画底栏**，六个面板可直接互相切换，不必先退回探索；
 *   ③ 新增面板只改这里的 PANELS 表 + 一个 draw 函数，路由不用动
 *      （各场景的 renderOverlay 统一走 G.Overlays.isPanel / renderPanel）。
 */
(function () {
  /* 面板版式（v0.14.0 参考《烟雨江湖》的卷轴式）：
     外框**左缘留一条竖排标题带**，内容区整体右移 BAND_W。
     ⚠️ 两个矩形别混：
        · `FRAME` 是外框（也是导出给契约的 PANEL_RECT —— 越界判据按外框算）；
        · `P` 是**内容区**（各面板都按 `P.x + N` / `P.y + N` 定位）。
        把 FRAME 当 P 用，所有面板内容会整体右移 34px；
        把 P 当 FRAME 用，外框会缩到内容区（左缘那条带子就露不出来）。 */
  var FRAME = { x: 12, y: 26, w: 456, h: 212 };
  var BAND_W = 34;
  var P = { x: FRAME.x + BAND_W, y: FRAME.y, w: FRAME.w - BAND_W, h: FRAME.h };
  /* 角色组的**功法/秘术**两页与其余子页共用同一个外框（CHAR_PANEL）。
     原先它们用五面板的 FRAME（456×212），比 CHAR_PANEL（392×232）更宽更矮，
     玩家在「境界」与「功法」之间切换时会看到面板忽宽忽窄（截图反馈）。 */
  var SP = G.Overlays.CHAR_BODY;
  var BAR_Y = 244, BAR_H = 28;

  /* 左缘竖排标题带矩形（五面板这一条）。**绘制实现统一在 overlays.js**
     （`G.Overlays.titleBand`）—— 角色面板那条也调它，两处各画一份必然漂。 */
  var BAND = { x: FRAME.x + 6, y: FRAME.y + 8, w: BAND_W - 12, h: FRAME.h - 16 };

  var WN = { fan: '凡界', ling: '灵界', xian: '仙界', dao: '道界' };
  var ST_NAME = { '麻': '麻痹', '毒': '中毒', '烧': '灼烧', '封': '封印' };

  /* 道具说明：battle.js 的 CONSUM 只管战斗内消耗，杂货铺的 SHOP_ITEMS 只管在售，
     两边都不全。这里是"背包视角"的唯一说明表。 */
  var ITEM_D = {
    '回春丹': '回复四成气血',
    '大还丹': '回复七成五气血',
    '聚气散': '灵气 +500',
    '醒神散': '解除异常状态',
    '解毒丹': '解除中毒',
    '甘霖丹': '解除灼烧',
    '舒筋丹': '解除麻痹',
    '解封符': '解除封印',
    '回城符': '返回已到过的城镇（M2 用）',
    '淬体突破丹': '大境界突破所需',
    '筑基丹': '炼气圆满破境筑基所需',
    '妖丹': '杂货铺回收，15 灵石 / 枚',
    /* 功法碎片（v0.14.0）：副本通关与野外刷怪掉落，集满 10 片在「功法」页参悟 */
    '凡品功法碎片': '10 片可在「功法」页参悟一本凡阶功法',
    '灵品功法碎片': '10 片可在「功法」页参悟一本灵阶功法',
    '宝品功法碎片': '10 片可在「功法」页参悟一本宝阶功法',
    /* ===== 材料（v0.40.0，文生图 15 种）=====
       炼丹 / 炼器 / 灵兽三系共用这套基础材料（设计稿《宗门副本对标》§5）。 */
    '凝血草': '三叶药草，止血生肌，炼丹最常用的引子。',
    '灵芝': '暗红灵芝，补气养元，凡品丹方的主药。',
    '幽兰': '淡紫幽兰，安神定魄，多用于凝神类丹方。',
    '火莲': '赤红火莲，性烈如火，火系丹方与炼器淬火皆需。',
    '玄铁矿': '黑灰铁矿，坚硬沉重，凡品法器的主料。',
    '赤铜': '赤铜矿石，导灵性佳，多用于符器与阵盘。',
    '寒玉': '青白寒玉，寒气内蕴，可制护身玉符。',
    '星砂': '发光星砂结晶，极难得，高阶炼器才用得上。',
    '兽皮': '完整兽皮，柔韧耐磨，可制皮甲与护腕。',
    '兽骨': '坚硬兽骨，可磨成箭镞或炼入法器。',
    '青羽': '青色翎羽，轻若无物，御风类法器所需。',
    '灵液': '乳白灵液，草木精华所凝，炼丹辅料。',
    '符纸': '黄纸符纸，未书之符，画符必备。',
    '朱砂': '朱砂，书符点睛之用，亦可入丹。',
    '灵木': '深褐灵木。当前暂无消耗配方，可留作材料收藏。',
    '灵泉水': '炼丹辅料，用于回春丹、解毒丹、聚气散等；在丹房选配方时消耗。',
    '百年灵芝': '筑基丹和结丹丹的主药，在丹房炼制破境丹时消耗。',
    '玄铁': '多种法宝的主料，在炼器页按配方消耗。',
    '精钢': '青锋剑、寒月刃的炼器材料。',
    '灵玉': '炼丹及炼器材料，用于结丹丹、解封符和护身法宝等。',
    '妖骨': '炼器材料，用于寒月刃。',
    '灵羽': '炼器材料，用于疾风靴与聚灵玉佩。',
    '道纹草': '道界材料，用于道纹丹及道纹法宝。',
    '道纹矿': '道界矿料，用于道纹丹及道纹法宝。',
    '铁木': '采集或购买取得的木料。当前暂无消耗配方，可暂存。',
    '血精': '血煞类敌人掉落的特殊材料。当前暂无消耗配方，可暂存。',
    '道纹残片': '道界试炼掉落的残片。当前暂无消耗配方，可暂存。',
    '药渣': '在灵兽页喂养：修为 +14、亲密 +1，每次消耗一份。',
    '灵食': '在灵兽页喂养：修为 +30、亲密 +2，每次消耗一份。',
    '木囊': '战斗中选择道具捕捉可收服妖兽，捕捉系数 1.0；先压低其气血。',
    '玄囊': '战斗捕兽用品，捕捉系数 1.5；不能捕捉首领。',
    '宝囊': '战斗捕兽用品，捕捉系数 2.0；不能捕捉首领。',
    '灵草': '部分灵兽的进化材料，在灵兽页满足进化条件后消耗。',
    '饲灵草料': '特定灵兽的进化材料，在灵兽页满足进化条件后消耗。',
    '引灵符': '沈伯所赠的任务凭证，用于开启翠微山秘境裂隙。',
    '结丹丹': '筑基圆满冲击金丹时使用的破境丹。',
    '道纹丹': '战斗内回复六成气血，在战斗道具菜单使用。',
    '伤药': '旧版遗留道具，当前没有使用入口；保留在储物中。',
    '灵石': '通用货币；持有余额在资产页查看，物品栏中的旧记录不重复折算。'
  };
  function itemDescription(name) {
    var uses = [];
    (G.Data.alchemy || []).forEach(function (r) {
      if (r.mats[name]) uses.push('炼制' + r.n + '需 ' + r.mats[name] + ' 份');
    });
    (G.Data.forge || []).forEach(function (r) {
      if (r.mats[name]) uses.push('炼制' + G.Forge.outName(r) + '需 ' + r.mats[name] + ' 份');
    });
    if (uses.length) return '用途：' + uses.join('；') + '。在相应技艺页按配方消耗。';
    var evo = [];
    if (G.Data.beasts) {
      var beasts = G.Data.beasts.list || [];
      beasts.forEach(function (b) { if (b.chain && b.chain.item === name) evo.push(b.n); });
    }
    if (evo.length) return '灵兽进化材料：' + evo.join('、') + '；在灵兽页满足进化条件后消耗。';
    return ITEM_D[name] || '当前没有可用的消耗入口或配方，请保留；不会因点击而消失。';
  }
  /* 可在面板里直接使用的道具（战斗外的即时收益） */
  var ITEM_USE = {
    '回春丹': { heal: 0.40 }, '大还丹': { heal: 0.75 }, '聚气散': { qi: 500 }
  };

  /* 道具图标逻辑名（v0.19.0）：中文道具名 → `item.<id>`。
     取图见 art.js: A.itemIcon（素材优先，缺图按前缀走程序化兜底）。
     新增道具时**两处都要加**：这里的映射 + assets-build.py 的 SIZES。 */
  var ITEM_ICON_ID = {
    '回春丹': 'pill_huichun', '大还丹': 'pill_dahuan', '聚气散': 'pill_juqi',
    '醒神散': 'pill_xingshen', '解毒丹': 'pill_jiedu', '甘霖丹': 'pill_ganlin',
    '舒筋丹': 'pill_shujin', '淬体突破丹': 'pill_cuiti', '筑基丹': 'pill_zhuji',
    /* v0.67.0：结丹丹 / 道纹丹 原先只在 ITEM_D 有说明，ITEM_ICON_ID 缺映射
       → `itemIcon` 一路拼到 `item.结丹丹` 查不到 → 静默退回程序化兜底。 */
    '结丹丹': 'pill_jiedan', '道纹丹': 'pill_daowen',
    /* 旧版遗留的疗伤道具（无使用入口，仅旧档背包装饰），复用回春丹图，避免静默兜底 */
    '伤药': 'pill_huichun',
    '解封符': 'talisman_jiefeng', '引灵符': 'talisman_jiefeng', '回城符': 'talisman_huicheng',
    '妖丹': 'mat_yaodan',
    '凡品功法碎片': 'shard_fan', '灵品功法碎片': 'shard_ling', '宝品功法碎片': 'shard_bao',
    '灵石': 'stone',
    /* 材料（v0.40.0）：`mat.<拼音>` —— 绝对键，art.js 的 itemIcon 会先试绝对键 */
    '凝血草': 'mat.xuecao', '灵芝': 'mat.lingzhi', '幽兰': 'mat.youlan', '火莲': 'mat.huolian',
    '玄铁矿': 'mat.xuantie', '赤铜': 'mat.chitong', '寒玉': 'mat.hanyu', '星砂': 'mat.xingsha',
    '兽皮': 'mat.shoupi', '兽骨': 'mat.shougu', '青羽': 'mat.yumao',
    '灵液': 'mat.lingye', '符纸': 'mat.fuzhi', '朱砂': 'mat.zhusha', '灵木': 'mat.lingmu',
    /* 采集/掉落实际名称（v0.60） */
    '灵泉水': 'mat.lingquan', '百年灵芝': 'mat.lingzhi', '玄铁': 'mat.xuantie', '精钢': 'mat.steel',
    '灵玉': 'mat.lingyu', '铁木': 'mat.tiemu', '道纹草': 'mat.daoherb', '道纹矿': 'mat.daoore',
    '道纹残片': 'mat.daoshard', '妖骨': 'mat.yaogu', '灵羽': 'mat.lingyu_f', '血精': 'mat.bloodessence',
    /* v0.61.0（用户第 10 点「这些道具怎么没有图标」）：驯兽三件套 + 灵食/灵草
       —— 原先根本没登记，`itemIcon` 一路拼到 `item.药渣` 查不到 → 静默退回程序化兜底。 */
    '药渣': 'mat.yaozha', '木囊': 'mat.munang', '玄囊': 'mat.xuannang', '宝囊': 'mat.baonang',
    '灵食': 'mat.lingshi', '灵草': 'mat.lingcao',
    /* v0.67.0：灵兽进化材料，beasts.js 的 chain.item 用它，原先无映射 → 无图标 */
    '饲灵草料': 'mat.siliao'
  };

  /* M0 主线链：与 town/field/cave/battle 里的判定一一对应。
     改任务链时**两处都要改** —— 这里只是给玩家看的文案，不做判定。 */
  /* 主线表。
     · t / d   标题与目标文案（任务面板与左侧追踪栏共用）
     · f / fd  进度旗标与"已完成"短标
     · g       路引目标 { map, x, y, who } —— 探索场景左侧追踪栏据此画箭头与距离。
               map 是**场景 id**（town / town_shop / field_temple / cave …），
               跨图时追踪栏沿出口与屋门做一次 BFS 找下一跳（见 explore.js: _routeTo）。
               x / y 是格坐标，仅同图时用来算方位与距离；who 是目标显示名。
     · g2      旗标 f 已置位后改用的目标（例：m0-1 打赢一场后要回镇找沈伯）
     · subs    子任务清单 [{ t, f? }]：给了 f 就按旗标判完成，没给只作提示
     路引是**纯提示**，不参与任何判定 —— 删掉 g 只影响显示，不会卡住任务。 */
  var QUEST = {
    'm0-1': { t: '拜入药铺', d: '往翠微山打赢一头妖兽，再回镇复命', f: 'won1', fd: '已胜一场',
      g: { map: 'field', x: 24, y: 32, who: '翠微山 · 前坡' },
      g2: { map: 'town_shop', x: 13, y: 6, who: '沈伯（药铺）' } },
    'm0-2': { t: '雪夜山神庙', d: '入翠微山破庙，取回那件东西', f: 'templeDone', fd: '已得逆命珠',
      g: { map: 'field_temple', x: 15, y: 6, who: '山神庙 · 神台' } },
    'm0-3': { t: '珠内点化', d: '底栏洞府页点击随身逆命珠，入定消化机缘；无需洞府', f: 'dream', fd: '已受点化',
      g: null },
    'm0-4': { t: '破境备丹', d: '修至淬体九段，回镇向沈伯取淬体突破丹', f: 'gotBreakPill', fd: '已得丹',
      g: { map: 'town_shop', x: 13, y: 6, who: '沈伯（药铺）' },
      subs: [{ t: '修至淬体九段' }, { t: '取淬体突破丹', f: 'gotBreakPill' }] },
    'm0-5': { t: '赤牙洞 · 狼王', d: '修至炼气三重，入赤牙洞斩赤炎狼王', f: null, fd: '',
      g: { map: 'cave', x: 16, y: 7, who: '赤牙洞 · 狼王' },
      subs: [{ t: '修至炼气三重' }, { t: '斩赤炎狼王' }] },
    'free': { t: '逍遥世间', d: '狼王已诛，可四处历练、刷秘境、寻界门飞升', f: null, fd: '', g: null },
    /* —— M1 主线（《M1 剧情与内容设计 v1.0》§3/§4）—— */
    'm1-1': { t: '归镇辨丹', d: '把狼王妖丹交给沈伯过目', f: 'bloodDan', fd: '已辨丹',
      g: { map: 'town_shop', x: 13, y: 6, who: '沈伯（药铺）' } },
    'm1-2': { t: '外堂探子', d: '镇上来了生面孔，去摸摸他的底', f: 'probe', fd: '已处置',
      g: { map: 'town', x: 25, y: 16, who: '行脚商（刘记旁）' },
      subs: [{ t: '在镇上找到行脚商' }, { t: '处置探子', f: 'probe' }] },
    'm1-3': { t: '沈伯旧账', d: '回药铺，听沈伯讲他的来历', f: 'oldDebt', fd: '已闻旧事',
      g: { map: 'town_shop', x: 13, y: 6, who: '沈伯（药铺）' } },
    'm1-4': { t: '筑基筹备', d: '修至炼气九段圆满，并取得筑基丹', f: 'foundPill', fd: '已得丹',
      g: { map: 'town_shop', x: 13, y: 6, who: '沈伯（药铺）' },
      subs: [{ t: '修至炼气九段' }, { t: '取得筑基丹', f: 'foundPill' }] },
    'm1-5': { t: '血夜', d: '血煞外堂围镇，回药铺与沈伯商议', f: 'bloodNight', fd: '血夜已了',
      g: { map: 'town_shop', x: 13, y: 6, who: '沈伯（药铺）' },
      g2: { map: 'bloodhall', x: 15, y: 6, who: '血煞外堂 · 血面' },
      subs: [{ t: '入夜 · 血煞外堂' }, { t: '斩执事血面', f: 'bloodNight' }] },
    'm1-6': { t: '筑基心魔劫', d: '血夜后于角色境界页或随身逆命珠前服丹筑基，无需洞府', f: 'based', fd: '已筑基',
      g: null },
    'm1-7': { t: '离乡', d: '与刘掌柜道别，往云州城去', f: 'leaveTown', fd: '已辞乡',
      g: { map: 'town_market', x: 8, y: 5, who: '刘掌柜（刘记杂货）' } },
    'm1done': { t: '云州在望', d: 'M1 已了，可继续历练、刷秘境、寻界门飞升', f: null, fd: '', g: null },

    /* ===== M2 云州城（v0.65.0，用户「M2 云州城主线」）=====
       插在 m1-7（离乡）与 m1done（分叉线接管）之间 —— 三处**同一份顺序**：
       `QUEST` 表、`QUEST_ORDER`、`town.js` 的 m1-7 收束、`yunzhou.js` 的推进。
       ⚠️ 判据一律用**可测量的状态**（`dungeonSlot`/`dungeonFarm`），不用"去跟某人说话"——
          那种条件无法自动判定，主线会卡死且没有出口（设计稿 §6 的教训）。 */
    'm2-1': { t: '云州城', d: '到云州城，见城主府执事，领「云州论道」的木牌', f: null, fd: '',
      g: { map: 'yunzhou', x: 18, y: 11, who: '城主府执事（云州城）' } },
    'm2-2': { t: '云州论道', d: '入一处秘境，带回战果 —— 论道台只认活着回来的人', f: null, fd: '',
      g: { map: 'yunzhou', x: 25, y: 11, who: '论道台裁判（云州城）' },
      subs: [{ t: '通关任意一处秘境' }, { t: '回论道台复命' }] },
    'm2-3': { t: '灵界之讯', d: '回论道台，听裁判说完那句话', f: null, fd: '',
      g: { map: 'yunzhou', x: 25, y: 11, who: '论道台裁判（云州城）' } },

    /* ===== 主线分叉（v0.38.0，《宗门与散修体系设计 v1.0》§6）=====
       M1 之后按 `save.quest.line` 走两条线之一 —— 用户多轮提到"主线本身未动"，
       这里把设计稿里写好的分叉真正落地。
       ⚠️ 每步的判据必须是**可测量的状态**（击杀数 / 副本进度 / 贡献 / 功法数）——
          "去跟某人说话"这类无法自动判定的条件会让主线卡死且没有出口。 */
    /* —— 散修线：云游 / 机缘 / 独行 —— */
    'f1-1': { t: '云游四方', d: '在野外斩妖二十只，攒下行走江湖的底气', f: null, fd: '',
      g: { map: 'field', x: 24, y: 20, who: '翠微山 · 任意野地' } },
    'f1-2': { t: '偶得残卷', d: '入一处秘境，取回散落其中的功法残卷', f: null, fd: '',
      g: { map: 'town', x: 18, y: 14, who: '底栏「角色」→ 秘境' } },
    'f1-3': { t: '博采众长', d: '散修无师，唯有多学几门功法傍身（习得五门）', f: null, fd: '', g: null },
    'f1-4': { t: '散修之名', d: '声望积到一百二十，散修盟才认你这号人', f: null, fd: '', g: null },
    'fdone': { t: '独行天下', d: '散修一线已了 —— 江湖再无靠山，也无拘束', f: null, fd: '', g: null },
    /* —— 宗门线：拜师 / 差遣 / 传功 / 晋升 —— */
    's1-1': { t: '门中立足', d: '入了一门墙，先为宗门做几件事（贡献三十）', f: null, fd: '',
      g: { map: 'town', x: 18, y: 14, who: '底栏「宗门」· 副本通关得贡献' } },
    's1-2': { t: '传功授业', d: '以贡献兑换本门功法，才算真正入门', f: null, fd: '',
      g: { map: 'town', x: 18, y: 14, who: '底栏「宗门」→ 兑换' } },
    's1-3': { t: '内门晋升', d: '贡献满二百，可列内门', f: null, fd: '', g: null },
    's1-4': { t: '真传之资', d: '贡献满六百，宗门才认你是真传', f: null, fd: '', g: null },
    'sdone': { t: '门墙之内', d: '宗门一线已了 —— 有靠山，也有门规', f: null, fd: '', g: null }
  };
  var QUEST_ORDER = ['m0-1', 'm0-2', 'm0-3', 'm0-4', 'm0-5', 'free',
    'm1-1', 'm1-2', 'm1-3', 'm1-4', 'm1-5', 'm1-6', 'm1-7',
    'm2-1', 'm2-2', 'm2-3', 'm1done'];

  /* 分叉两条线各自的顺序（主线走完 m1done 之后二选一） */
  var ORDER_FREE = ['f1-1', 'f1-2', 'f1-3', 'f1-4', 'fdone'];
  var ORDER_SECT = ['s1-1', 's1-2', 's1-3', 's1-4', 'sdone'];
  /* 当前该用哪条顺序 —— **唯一口径**（追踪栏与任务面板都读它，不各判一次） */
  function questOrderOf(save) {
    var step = (save && save.quest && save.quest.step) || 'm0-1';
    if (step.indexOf('f1-') === 0 || step === 'fdone') return ORDER_FREE;
    if (step.indexOf('s1-') === 0 || step === 'sdone') return ORDER_SECT;
    return QUEST_ORDER;
  }

  /* 分叉每步的**可测量判据** */
  var BRANCH_AT = {
    'f1-1': function (s) { return (s.wildKills || 0) >= 20; },
    'f1-2': function (s) { return (s.dungeonSlot || 0) > 0 || (s.dungeonFarm || 0) > 0; },
    'f1-3': function (s) { return Object.keys(s.skills || {}).length >= 5; },
    'f1-4': function (s) { return (s.sectRep || 0) >= 120; },
    /* ⚠️ 起点判据**不能是"已入宗门"** —— 玩家走到分叉时本来就是宗门弟子，
       那样 s1-1 会被瞬间满足、第一步永远看不到（实测："宗门应进 s1-1，实际 s1-2"）。
       改成"为宗门做过事（贡献三十）"，这才是一个真的还没完成的状态。 */
    's1-1': function (s) { return (s.sectRep || 0) >= 30; },
    's1-2': function (s) {
      var sect = G.Data.sects && G.Data.sects.byId(s.sectId);
      return !!(sect && (sect.skills || []).some(function (id) { return s.skills && s.skills[id]; }));
    },
    's1-3': function (s) { return (s.sectRep || 0) >= 200; },
    's1-4': function (s) { return (s.sectRep || 0) >= 600; }
  };
  var BRANCH_NEXT = {
    'f1-1': 'f1-2', 'f1-2': 'f1-3', 'f1-3': 'f1-4', 'f1-4': 'fdone',
    's1-1': 's1-2', 's1-2': 's1-3', 's1-3': 's1-4', 's1-4': 'sdone'
  };
  /* 推进分叉；返回本次推进的文案（供 toast）。
     ⚠️ 用 `while` 而不是 `if` —— 玩家可能在一步里同时满足多步条件（比如一口气刷完），
        只推一步会让主线"卡在半路"直到下次进镇。 */
  G.Overlays.tickQuest = function (save) {
    var q = save && save.quest;
    if (!q) return [];
    var out = [];
    if (q.step === 'm1done') {
      q.step = (save.cult === 'sect') ? 's1-1' : 'f1-1';
      out.push(q.step === 's1-1' ? '主线分岔 —— 宗门线' : '主线分岔 —— 散修线');
    }
    var guard = 0;
    while (BRANCH_AT[q.step] && BRANCH_AT[q.step](save) && guard++ < 8) {
      q.step = BRANCH_NEXT[q.step];
      out.push('主线推进 —— ' + ((QUEST[q.step] || {}).t || q.step));
    }
    if (out.length) G.Storage.saveCurrent(save);
    return out;
  };

  /* ============================================================
     底栏
     ============================================================ */
  /* 底栏五功能（v0.15.0 重构）：
     · **功法 / 秘术并入角色面板的子页**（用户口径："把功法、秘术放到角色面板里面"）——
       仍是独立的面板实现，只是不进底栏；
     · **成就移到游戏外**（开局界面，与设备绑定、跨世只发一次）；
     · 新增 **洞府**（炼丹 / 炼器 / 阵法 / 灵兽）与 **地图**（四界区域导航）。 */
  var PANELS = [
    { id: 'char', n: '角色' },
    { id: 'quest', n: '任务' },
    { id: 'bag', n: '储物' },
    /* 底栏叫「势力」而不是「宗门」（v0.41.0）：面板里散修与宗门**并列**，
       叫「宗门」会让散修玩家以为这一页与自己无关。 */
    { id: 'sect', n: '势力' },
    { id: 'cave', n: '洞府' },
    { id: 'map', n: '地图' }
  ];

  var IDS = {};
  PANELS.forEach(function (p) { IDS[p.id] = 1; });
  /* 功法/秘术仍是**可路由**的面板（角色子页签要切过去），只是不进底栏 */
  IDS.skills = 1; IDS.secrets = 1;
  IDS.beasts = 1;   /* 兽栏：洞府内进入，不进底栏 */
  IDS.beastShop = 1;
  IDS.alchemy = 1;  /* 丹房：洞府炼丹子页，不进底栏 */
  IDS.forge = 1;    /* 器坊：洞府炼器子页，不进底栏 */
  IDS.array = 1;    /* 阵台：洞府阵法子页，不进底栏 */
  IDS.masters = 1;  /* 拜师：洞府寻名师习艺，不进底栏 */
  IDS.meditate = 1; /* 闭关：灵根苦修 + 离线收益（v0.61.0），不进底栏 */

  /* 底栏按钮：六个等宽页签。active 传当前面板 id 时该项高亮。 */
  function barBtns(scene, active) {
    /* 页签宽按数量现算：v0.15.0 从 6 项变 5 项，写死 75 会挤在中间一小撮 */
    var gap = 3;
    var w = Math.min(92, Math.floor((480 - 16 - (PANELS.length - 1) * gap) / PANELS.length));
    var x0 = (480 - (PANELS.length * w + (PANELS.length - 1) * gap)) / 2;
    return PANELS.map(function (p, i) {
      var on = (p.id === active);
      return new G.UI.Btn({
        x: Math.round(x0 + i * (w + gap)), y: BAR_Y + 3, w: w, h: BAR_H - 6,
        small: true, variant: 'tab', active: on, label: p.n,
        onClick: function () {
          /* 点当前页 = 收起（回到探索），省一个"关闭"按钮 */
          if (on) { scene.clearOverlay(); return; }
          G.Overlays.openPanel(scene, p.id);
        }
      });
    });
  }

  function renderBar(x, active) {
    x.fillStyle = 'rgba(7,9,15,0.94)';
    x.fillRect(0, BAR_Y, 480, 272 - BAR_Y);
    x.fillStyle = 'rgba(216,183,104,0.20)';
    x.fillRect(0, BAR_Y, 480, 0.8);
    /* 页签宽按数量现算：v0.15.0 从 6 项变 5 项，写死 75 会挤在中间一小撮 */
    var gap = 3;
    var w = Math.min(92, Math.floor((480 - 16 - (PANELS.length - 1) * gap) / PANELS.length));
    var x0 = (480 - (PANELS.length * w + (PANELS.length - 1) * gap)) / 2;
    PANELS.forEach(function (p, i) {
      if (p.id !== active) return;
      x.fillStyle = 'rgba(216,183,104,0.75)';
      x.fillRect(Math.round(x0 + i * (w + gap)) + 5, BAR_Y + 2, w - 10, 1.4);
    });
  }

  /* 角色面板的子页签（总览 / 灵根 / 属性 / 境界）——排在标题带右侧，
     给右上角的关闭钮留出位置（几何来自 overlays.js，单一真相源）。 */
  /* ===== 法宝子页（v0.29.0）=====
     用户口径：「在角色界面新增法宝子界面，可以装备已有的法宝……总览不需要法宝操作」。
     左栏三槽（大格，看得出穿了什么）+ 右栏"已拥有法宝"列表（点一件即穿到它自己的槽）。
     ⚠️ 格子与列表**都用真按钮**（label+sub+icon）—— 面板自绘文字压到按钮上会被
        `panels.bounds.contract` 判违规。
     ⚠️ 该槽一件都没有时**什么都不画** —— 曾经在这里写 `G.UI.text(null, ...)` 当占位，
        点击时抛异常 → 整个界面卡死（见 `click.noThrow.contract`）。 */
  function buildEquipSlots(btns, scene) {
    var EQ = G.Data.equips;
    if (!EQ) return;
    var save = G.game.save;
    var P2 = G.Overlays.CHAR_BODY;
    var LX2 = P2.x + 18, RX2 = P2.x + 206;
    var LW2 = 168, RW2 = P2.x + P2.w - 18 - RX2;

    /* 左栏：三槽（竖排） */
    EQ.SLOTS.forEach(function (sl, i) {
      var eid = (save.equip || {})[sl];
      var e = eid ? EQ.byId(eid) : null;
      btns.push(new G.UI.Btn({
        x: LX2, y: P2.y + 118 + i * 34, w: LW2, h: 30, small: true, fs: 10, lalign: true,
        variant: e ? 'gold' : 'ghost',
        label: (e ? e.n : '未装备') + '　· ' + EQ.SLOT_N[sl],
        sub: e ? (e.d.length > 14 ? e.d.slice(0, 13) + '…' : e.d) : '　',
        icon: e ? e.id : null,
        onClick: function () {
          if (!eid) { G.game.toast('该槽还空着 —— 去炼器、做任务、刷怪或打首领'); return; }
          var r = G.Player.setEquip(save, sl, null);
          G.game.toast(r.ok ? ('已卸下' + e.n) : ('无法卸下：' + r.reason));
          G.Overlays.openPanel(scene, 'char', true);
        }
      }));
    });

    /* 右栏：已拥有法宝（点一件即穿） */
    var owned = EQ.list.filter(function (e) {
      return ((save.items || {})[e.id] || 0) > 0;
    });
    owned.slice(0, 6).forEach(function (e, i) {
      var on = (save.equip || {})[e.slot] === e.id;
      btns.push(new G.UI.Btn({
        x: RX2, y: P2.y + 76 + i * 24, w: RW2, h: 21, small: true, fs: 10, lalign: true,
        variant: on ? 'gold' : 'default',
        label: e.n + '　' + EQ.SLOT_N[e.slot] + (on ? '（已佩）' : ''),
        icon: e.id,
        onClick: function () {
          var r = G.Player.setEquip(save, e.slot, e.id);
          G.game.toast(r.ok ? ('已佩' + e.n) : ('无法装备：' + r.reason));
          G.Overlays.openPanel(scene, 'char', true);
        }
      }));
    });
    if (owned.length > 6) {
      btns.push(new G.UI.Btn({
        x: RX2, y: P2.y + 76 + 6 * 24, w: RW2, h: 20, small: true, fs: 9.5, lalign: true,
        variant: 'ghost', label: '另有 ' + (owned.length - 6) + ' 件（储物页可见）',
        onClick: function () { G.game.toast('储物页可查看全部法宝'); }
      }));
    }
  }

  function buildCharTabs(btns, scene, frame, reserve) {
    /* ⚠️ 六个子页签**必须用同一份几何**：原先按"是不是五面板外框"决定要不要留位，
       结果「境界」与「功法」两页的页签起点差 100px —— 玩家在组内切页时页签会跳
       （截图反馈的"功法和其他界面长宽不一致"就是这个观感的一部分）。
       现在整组统一：同一个外框（CHAR_PANEL）+ 同一份左侧保留位（给状态文字）。 */
    var g = G.Overlays.charTabGeom(frame || G.Overlays.CHAR_PANEL, reserve);
    /* 当前子页：功法/秘术由 overlay 决定，其余看 scene.charTab */
    var cur = (scene.overlay === 'skills' || scene.overlay === 'secrets')
      ? scene.overlay : (scene.charTab || 'overview');
    G.Overlays.CHAR_TABS.forEach(function (t, i) {
      btns.push(new G.UI.Btn({
        x: g.x0 + i * (g.w + g.gap), y: g.y, w: g.w, h: g.h,
        small: true, variant: 'subtab', active: cur === t.id, label: t.n,
        onClick: function () {
          scene.charTab = t.id;
          /* keepTab=true：组内切页，别让 openPanel 把刚设的页重置回总览 */
          G.Overlays.openPanel(scene, t.panel || 'char', true);
        }
      }));
    });
    /* 「境界」子页的突破按钮（v0.11.4）：突破是**角色的事**，放在角色面板最顺，
       原先只在功法页与珠内空间各有一个入口，玩家在角色页看着境界却破不了。
       口径统一走 G.Overlays.doBreak，这里不重写规则；破完仍回到「境界」子页。 */
    if (cur === 'realm') {
      var save = G.game.save;
      var bs = G.Player.breakState(save);
      var B = G.Overlays.CHAR_BREAK;
      btns.push(new G.UI.Btn({
        x: B.x, y: B.y, w: B.w, h: B.h, small: true,
        variant: bs.ready ? 'gold' : 'default',
        /* 按钮文案只要「突破」两个字（用户口径）—— 目标境界已经在境界页写着，
           重复一遍反而让按钮变长、和旁边元素挤。 */
        label: '突破',
        disabled: !bs.ready,
        /* keepTab=true：突破完留在「境界」子页，别弹回总览 */
        onClick: function () { G.Overlays.doBreak(scene, 'char', true); }
      }));
    }
  }

  function openPanel(scene, id, keepTab) {
    /* 面板滑入（v0.32.0）：记下打开时刻，渲染时按 `G.game.time` 算进度。
       ⚠️ 用 `G.game.time` 而不是 performance.now —— 截图与契约才钉得住。 */
    scene.panelOpenAt = G.game.time || 0;
    if (!IDS[id]) return;
    var prev = scene.overlay;
    scene.overlay = id;
    /* 角色组有子页签：**从别处切进来**时回到「总览」。
       ⚠️ 判据是 `keepTab` 这个显式入参，不是"上一个 overlay 属不属角色组" ——
       子页签点击会**先设 charTab 再调 openPanel**，用后者会把刚设好的页重置掉
       （表现：点「属性」跳回「总览」）。调用方最清楚自己是不是在组内切页。 */
    if (id === 'char' && !keepTab) scene.charTab = 'overview';
    /* 功法面板的下拉：从别处切进来时收起（选中的那本保留，换页签回来还是它） */
    if (id === 'skills' && prev !== 'skills') scene.skillOpen = false;
    var btns = [];
    if (id === 'skills') buildSkills(btns, scene);
    if (id === 'quest') buildQuest(btns, scene);
    if (id === 'bag') buildBag(btns, scene);
    if (id === 'cave') buildCave(btns, scene);
    if (id === 'alchemy') buildAlchemy(btns, scene);
    if (id === 'forge') buildForge(btns, scene);
    if (id === 'array') buildArray(btns, scene);
    if (id === 'masters') buildMasters(btns, scene);
    if (id === 'meditate') buildMeditate(btns, scene);
    if (id === 'beasts') buildBeasts(btns, scene);
    if (id === 'beastShop') buildBeastShop(btns, scene);
    if (id === 'sect') buildSect(btns, scene);
    if (id === 'map') buildMap(btns, scene);
    /* 角色组三个页共用同一条子页签条。外框按当前页取：
       角色页用 CHAR_PANEL，功法/秘术页用五面板的 FRAME（它们的外框不同）。 */
    if (G.Overlays.isCharGroup(id)) {
      buildCharTabs(btns, scene, G.Overlays.CHAR_PANEL, G.Overlays.TAB_RESERVE);
    }
    /* 法宝只在**自己的子页**出现（v0.29.0）：总览只查看，不做法宝操作 */
    if (id === 'char' && (scene.charTab || 'overview') === 'equip') {
      buildEquipSlots(btns, scene);
    }
    /* 底栏高亮：功法/秘术属角色组，高亮落在「角色」上（否则进了这两页底栏一个都不亮） */
    barBtns(scene, G.Overlays.isCharGroup(id) ? 'char' : id).forEach(function (b) { btns.push(b); });
    /* 关闭钮：每个面板统一加（角色页的面板矩形不同，故取各自的外框）。 */
    btns.push(closeBtn(scene, G.Overlays.isCharGroup(id) ? G.Overlays.CHAR_PANEL : FRAME));
    scene.buttons = btns;
  }

  /* ============================================================
     通用壳
     ============================================================ */
  /* 关闭钮：面板右上角一个**矢量**叉（v0.11.0）。
     以前只有"再点一次当前页签"这一种收起方式，等于没有可见的关闭入口 ——
     玩家在面板里找不到出口（截图反馈）。底栏页签的"点自己收起"保留，两条路都能走。 */
  var CLOSE = { w: 22, h: 20 };

  function closeBtn(scene, R) {
    return new G.UI.Btn({
      x: R.x + R.w - 6 - CLOSE.w, y: R.y + 5, w: CLOSE.w, h: CLOSE.h,
      small: true, variant: 'ghost', glyph: 'close',
      onClick: function () { scene.clearOverlay(); }
    });
  }

  function shell(x, title, right, opts) {
    opts = opts || {};
    /* 外框/标题带/内容区可覆盖：角色组的**功法/秘术**两页要跟其余四个子页共用
       CHAR_PANEL（见 SP 的注释），其余面板用五面板的 FRAME。 */
    var frame = opts.frame || FRAME;
    var band = opts.band || BAND;
    var p = opts.p || P;
    G.Overlays.dim(x);
    G.UI.frame(x, frame, null, { tex: true });
    G.Overlays.titleBand(x, band, title);
    if (right) {
      if (opts.left) {
        /* 角色组的右上角被**子页签条**占了 → 状态文字改左对齐，让到页签左边。
           （压上去会变成"文字压在按钮上"，panels.bounds.contract 直接报。） */
        G.UI.textOut(x, { x: p.x + 14, y: frame.y + 9 }, right, 11, G.UI.C.textDim);
      } else {
        G.UI.textOut(x, { x: frame.x + frame.w - 38, y: frame.y + 9 }, right, 11,
          G.UI.C.textDim, 'right');
      }
    }
    /* 顶条分隔线：标题已移到左缘竖带，这里只把顶条与正文分开 */
    G.UI.divider(x, p.x + p.w / 2, frame.y + 30, p.w - 42, 'rgba(216,183,104,0.18)');
  }

  /* 分节小标题：**实现统一在 overlays.js**（`G.Overlays.sec`），这里只转发 ——
     两处各写一份的话，改个颜色/字号就会漂。 */
  function sec(x, sx, sy, t) {
    G.Overlays.sec(x, sx, sy, t);
  }

  function empty(x, sx, sy, t) {
    G.UI.text(x, { x: sx, y: sy }, t, 12, G.UI.C.textDim);
  }

  /* 状态标记（完成 / 进行中 / 未开始）：一律**矢量绘制**。
     ⚠ 不要改回 '✓' / '▶' 这类字符：字体是系统回退（工程里没有 @font-face），
     缺字会渲染成空心方框（豆腐块），而且换机器/换浏览器表现不一致 ——
     这种"看着像占位符"的失败是静默的，截图里才发现。
     cy 传**文字行的垂直中心**（G.UI.text 的 y 是 top，故调用处写 y + 字号/2）。 */
  function mark(x, cx, cy, state) {
    if (state === 'done') {
      x.save();
      x.strokeStyle = G.UI.C.jadeHi; x.lineWidth = 1.5; x.lineCap = 'round';
      x.beginPath();
      x.moveTo(cx - 2.8, cy); x.lineTo(cx - 0.9, cy + 2.2); x.lineTo(cx + 3.0, cy - 2.6);
      x.stroke(); x.restore(); return;
    }
    if (state === 'now') {
      x.save(); x.fillStyle = G.UI.C.goldHi;
      x.beginPath();
      x.moveTo(cx - 2.4, cy - 3.2); x.lineTo(cx + 2.8, cy); x.lineTo(cx - 2.4, cy + 3.2);
      x.closePath(); x.fill(); x.restore(); return;
    }
    x.save(); x.fillStyle = G.UI.C.textDim;
    x.beginPath(); x.arc(cx, cy, 1.3, 0, 6.2832); x.fill(); x.restore();
  }

  /* ============================================================
     一、功法（境界 / 突破 / 功法精进）
     ============================================================ */
  /* ============================================================
     二、功法（v0.11.4 改版）
     ─ 删掉顶部的「境界 / 灵气进度」整块：境界是角色面板的事，功法面板重复一遍没意义，
       而且原来的「突破」按钮与角色面板「境界」子页的按钮是同一件事、两个入口。
     ─ 列表改成**下拉选择**：头部一行显示当前选中，点开列出全部（等级降序），
       选中后下方展示该功法的效果、面板贡献与「精进」。
       下拉**展开时不再画详情与精进按钮** —— 两者在 y 上是重叠的，
       而按钮数组的语义是"下标小 = 命中优先、下标大 = 画在上层"，重叠时这两条互相打架，
       必有一处点不到。干脆做成互斥的两个状态（真下拉就是这样）。
     ============================================================ */
  var TIER_RANK = { '凡': 1, '灵': 2, '宝': 3, '玄': 4, '地': 5, '天': 6, '仙': 7 };

  /* 等级最高的排最上面。同级按品阶降序，最后按 id ——
     少了最后一层，同级的几本会随 Object.keys 的顺序漂，每次开面板顺序都在跳。 */
  function skillIdsSorted(save) {
    return Object.keys(save.skills).sort(function (a, b) {
      var la = (save.skills[a] && save.skills[a].lv) || 0;
      var lb = (save.skills[b] && save.skills[b].lv) || 0;
      if (lb !== la) return lb - la;
      var ta = TIER_RANK[(G.Data.skills[a] || {}).tier] || 0;
      var tb = TIER_RANK[(G.Data.skills[b] || {}).tier] || 0;
      if (tb !== ta) return tb - ta;
      return a < b ? -1 : (a > b ? 1 : 0);
    });
  }

  /* 下拉头 / 下拉行 / 详情区的几何（渲染与契约共用一份） */
  var SK = {
    head: { x: SP.x + 14, y: SP.y + 40, w: SP.w - 28, h: 24 },
    rowH: 21, maxRows: 6,
    infoY: SP.y + 74,
    /* 激发状态行（v0.69.0）：紧跟 info 之下，左右两栏各一句
       （左"已/未激发"、右"威力 ×N"），与 sec 之间留 2px 呼吸。 */
    stateY: SP.y + 90,
    secY: SP.y + 106,
    effY: SP.y + 121,
    /* 贡献行：在三行效果（121/135/149）之下、按钮行（172）之上。
       ⚠️ 提示行 y + 字号必须 ≤ 面板底 238（SP.y=26 → 偏移上限 202）。 */
    contribY: SP.y + 158,
    /* ⚠️ 三个按钮必须并排不叠（panels.bounds.contract 会判"文字压在按钮上"）。
       可用横段 = SP.x+14 .. SP.x+SP.w-14（= 88..422，宽 334）。
       等分三份：各 104 宽 + 10 间距 → 104×3 + 10×2 = 332，正好落在 334 内。
       顺序按"用得最频繁的靠左"：参悟（碎片线）→ 激发（战斗配置）→ 精进（灵力线）。 */
    btn: { x: SP.x + 242, y: SP.y + 172, w: 104, h: 22 },
    /* 参悟按钮（v0.14.0）：与「精进」同一行，落在最左段 */
    shardBtn: { x: SP.x + 14, y: SP.y + 172, w: 104, h: 22 },
    /* 激发/卸下按钮（v0.69.0）：同一行中段 —— 三个按钮的**唯一**横向分区。 */
    equipBtn: { x: SP.x + 128, y: SP.y + 172, w: 104, h: 22 },
    hintY: SP.y + 200
  };
  SK.listY = SK.head.y + SK.head.h + 2;

  function selSkillId(scene, save) {
    var ids = skillIdsSorted(save);
    if (!ids.length) return null;
    /* 没选过 / 选中的已被删掉 → 落回第一条（也就是等级最高的那本） */
    if (ids.indexOf(scene.skillSel) < 0) scene.skillSel = ids[0];
    return scene.skillSel;
  }

  /* 该功法的效果说明（按 kind 分支；与 computeStats 的口径对齐） */
  function skillEffects(sd) {
    if (!sd) return ['—'];
    var out = [];
    var tc = G.Data.tierCoef[sd.tier] || 1;
    if (sd.kind === '攻击') {
      out.push('主动 · 伤害 ×' + sd.mult + (sd.hits > 1 ? '（' + sd.hits + ' 段）' : ''));
      var bits = [];
      if (sd.cd > 0) bits.push('冷却 ' + sd.cd + ' 回合');
      if (sd.hit && sd.hit < 100) bits.push('命中 ' + sd.hit + '%');
      if (sd.target) bits.push('目标 ' + sd.target);
      if (bits.length) out.push(bits.join('　'));
      if (sd.status) {
        out.push('附加「' + (ST_NAME[sd.status.t] || sd.status.t) + '」'
          + Math.round(sd.status.chance * 100) + '%');
      }
      if (sd.healSelf) out.push('吸取伤害的 ' + Math.round(sd.healSelf * 100) + '% 回复气血');
      if (sd.heal) out.push('同时回复 ' + Math.round(sd.heal * 100) + '% 气血');
    } else if (sd.kind === '防御') {
      out.push('被动 · 每精进一阶 防御 +' + (3 * tc) + '（品阶系数 ×' + tc + '）');
    } else {
      out.push('被动 · 每精进一阶 气血 +' + (20 * tc) + '（品阶系数 ×' + tc + '）');
    }
    if (sd.active) {
      out.push('主动「' + sd.active.n + '」：回复 '
        + Math.round(sd.active.heal * 100) + '% 气血，冷却 ' + sd.active.cd + ' 回合');
    }
    return out;
  }

  /* 该功法当前给面板加了多少（**与 computeStats 同一套系数**，不另写一份公式） */
  function skillContrib(sd, lv, save) {
    var coef = (save.linggen && save.linggen.coef) || {};
    var m = (G.Data.tierCoef[sd.tier] || 1)
      * (sd.elem !== '无' && coef[sd.elem] ? 1.2 : 1) * (coef[sd.elem] || 1);
    if (sd.kind === '攻击') return '攻击 +' + Math.round(lv * 5 * m);
    if (sd.kind === '防御') return '防御 +' + Math.round(lv * 3 * m);
    return '气血 +' + Math.round(lv * 20 * m);
  }

  /* 参悟用哪一档碎片（v0.14.0）：
     够数 → 取**够数里最高**的品阶（宝 > 灵 > 凡）；
     都不够 → 取**持有最多**的那档做展示（玩家一眼知道该刷哪一档，而不是看个空按钮）。 */
  function shardPick(save) {
    var order = ['宝', '灵', '凡'];
    var best = G.Player.bestShardTier(save);
    if (best) return { tier: best, ok: true, have: G.Player.shardCount(save, best) };
    var bt = '凡', bh = -1, any = false;
    order.forEach(function (t) {
      var n = G.Player.shardCount(save, t);
      if (n > 0) any = true;
      if (n > bh) { bh = n; bt = t; }
    });
    /* 一片都没有 → 一律显示「凡品」：玩家最先掉的就是它。
       不这么做的话，三档都是 0 时会显示「宝品（0/10）」—— 新号看着莫名其妙。 */
    if (!any) bt = '凡';
    return { tier: bt, ok: false, have: Math.max(0, bh) };
  }

  function buildSkills(btns, scene) {
    var save = G.game.save;
    var ids = skillIdsSorted(save);
    if (!ids.length) return;
    var sel = selSkillId(scene, save);
    var sd = G.Data.skills[sel] || { n: sel, tier: '凡', elem: '无', kind: '仙术' };
    var lv = save.skills[sel].lv;
    var cost = G.Player.skillCost(sd, lv);
    var equippedNow = G.Player.equippedIds(save);
    var isEq = equippedNow.indexOf(sel) >= 0;

    /* 展开时先把列表压进数组 —— 下标小 = 命中优先，列表要盖住下面的一切 */
    if (scene.skillOpen) {
      ids.slice(0, SK.maxRows).forEach(function (id, i) {
        var d = G.Data.skills[id] || { n: id, elem: '无', tier: '凡' };
        var l = save.skills[id].lv;
        /* 激发位的功法在行首标「激」—— 一眼看出哪几本正在战斗里用。
           不用符号（'★' 之类）是因为字体回退会出豆腐块（项目老坑）。 */
        var eq = equippedNow.indexOf(id) >= 0 ? '激　' : '';
        btns.push(new G.UI.Btn({
          x: SK.head.x, y: SK.listY + i * SK.rowH, w: SK.head.w, h: SK.rowH - 1,
          small: true,
          variant: eq ? 'gold' : (id === sel ? 'gold' : 'battle'),
          label: eq + d.n + '　' + G.Data.skillRealm(l).short + '　' + (d.elem || '无') + '　' + (d.tier || '凡') + '阶',
          onClick: function () {
            scene.skillSel = id; scene.skillOpen = false;
            G.Overlays.openPanel(scene, 'skills');
          }
        }));
      });
    } else {
      /* ===== 激发 / 卸下（v0.69.0）=====
         用户在功法详情页**唯一**能改变"战斗里能用哪几本"的入口。
         占的是原先「参悟」右侧的空白段（精进在左、参悟居中，这里放最右）——
         ⚠️ 三个按钮必须并排不叠：x 段 14..166（精进）/ 176..296（参悟）/ 306..426（激发）。
         按内容判：`occupiesSlot` 为真才计槽；纯被动随时可激（不占槽）。 */
      var sk = sd;
      var occupies = G.Player.occupiesSlot(sel);
      var left = G.Player.slotsLeft(save);
      var label, variant, disabled, onClick;
      if (isEq) {
        label = '卸下激发'; variant = 'gold'; disabled = false;
        onClick = function () {
          var r = G.Player.cancelSkill(save, sel);
          if (!r.ok) { G.game.toast(r.reason); return; }
          G.Storage.saveCurrent(save);
          G.game.toast('已卸下「' + sd.n + '」');
          G.Overlays.openPanel(scene, 'skills');
        };
      } else {
        var chk = G.Player.canActivate(save, sel);
        label = occupies
          ? ('激发（余 ' + left + ' 位）')
          : '激发（被动不占位）';
        variant = chk.ok ? 'battle' : 'default';
        disabled = !chk.ok;
        onClick = function () {
          var r = G.Player.activateSkill(save, sel);
          if (!r.ok) { G.game.toast(r.reason); return; }
          G.Storage.saveCurrent(save);
          G.game.toast('已激发「' + sd.n + '」');
          G.Overlays.openPanel(scene, 'skills');
        };
      }
      btns.push(new G.UI.Btn({
        x: SK.equipBtn.x, y: SK.equipBtn.y, w: SK.equipBtn.w, h: SK.equipBtn.h,
        small: true, variant: variant, label: label, disabled: disabled,
        onClick: onClick
      }));

      btns.push(new G.UI.Btn({
        x: SK.btn.x, y: SK.btn.y, w: SK.btn.w, h: SK.btn.h, small: true,
        variant: (save.po >= cost && !G.Data.skillAtTop(lv)) ? 'gold' : 'default',
        label: G.Data.skillAtTop(lv) ? '已至九重巅峰' : ('精进 ' + cost + ' 灵力'),
        disabled: save.po < cost || G.Data.skillAtTop(lv),
        onClick: function () {
          save.po -= cost; save.skills[sel].lv += 1;
          G.Storage.saveCurrent(save);
          G.game.toast(sd.n + ' 精进至 ' + G.Data.skillRealm(save.skills[sel].lv).n);
          G.Overlays.openPanel(scene, 'skills');
        }
      }));
      /* 参悟（v0.14.0）：碎片 → 功法。与「精进」并排（灵力 vs 碎片，两条成长线）。
         展开列表时**不建**这个按钮 —— 列表要盖住下方，留着它会与列表区重叠。 */
      var sp = shardPick(save);
      btns.push(new G.UI.Btn({
        x: SK.shardBtn.x, y: SK.shardBtn.y, w: SK.shardBtn.w, h: SK.shardBtn.h,
        small: true, variant: sp.ok ? 'gold' : 'default',
        label: '参悟 · ' + sp.tier + '品（' + sp.have + '/' + G.Data.shardCost + '）',
        disabled: !sp.ok,
        onClick: function () {
          var r = G.Player.inscribe(save, sp.tier);
          if (!r.ok) { G.game.toast(r.reason); return; }
          G.Storage.saveCurrent(save);
          G.game.toast(r.learned
            ? '参悟得「' + r.name + '」'
            : '「' + r.name + '」精进至 ' + G.Data.skillRealm(r.lv).n);
          G.Overlays.openPanel(scene, 'skills');
        }
      }));
    }

    /* 下拉头放最后：它只与"列表"相邻（不重叠），与详情区也不重叠。
       当前选中的功法名**写进按钮自己的 label**（而不是在按钮上另画一行字）——
       另画的话会与按钮居中的 label 叠字，panels.bounds.contract 会直接报。 */
    btns.push(new G.UI.Btn({
      x: SK.head.x, y: SK.head.y, w: SK.head.w, h: SK.head.h, small: true,
      variant: scene.skillOpen ? 'gold' : 'default',
      label: scene.skillOpen
        ? '收起列表'
        : sd.n + '　' + G.Data.skillRealm(lv).short + '　（共 ' + ids.length + ' 本）',
      onClick: function () {
        scene.skillOpen = !scene.skillOpen;
        G.Overlays.openPanel(scene, 'skills');
      }
    }));
  }

  function drawSkills(x, scene) {
    var save = G.game.save;
    shell(x, '功　法', '灵力 ' + Math.floor(save.po),
      { left: true, frame: G.Overlays.CHAR_PANEL, band: G.Overlays.CHAR_BAND, p: SP });
    var ids = skillIdsSorted(save);

    if (!ids.length) {
      empty(x, SP.x + 14, SP.y + 60, '尚无功法 —— 拜师、拾遗、斩首领皆可得。');
      return;
    }
    var sel = selSkillId(scene, save);
    var sd = G.Data.skills[sel] || { n: sel, tier: '凡', elem: '无', kind: '仙术' };
    var lv = save.skills[sel].lv;
    var COL = (G.Data.elem && G.Data.elem.color) || {};

    /* 下拉头：当前功法名与等级由按钮的 label 承担（见 buildSkills），
       这里只补一个**矢量**展开箭头 —— 不用 '▾' 字符（字体回退会出豆腐块）。 */
    var hb = SK.head;
    x.save();
    x.strokeStyle = G.UI.C.gold; x.lineWidth = 1.6; x.lineCap = 'round';
    var ax = hb.x + hb.w - 34, ay = hb.y + hb.h / 2;
    x.beginPath();
    if (scene.skillOpen) { x.moveTo(ax - 4, ay + 2); x.lineTo(ax, ay - 2.4); x.lineTo(ax + 4, ay + 2); }
    else { x.moveTo(ax - 4, ay - 2); x.lineTo(ax, ay + 2.4); x.lineTo(ax + 4, ay - 2); }
    x.stroke();
    x.restore();

    if (scene.skillOpen) {
      /* 展开态：只画列表（详情/精进按钮此时不存在，见文件头说明）。
         列表外框衬一层底，免得文字直接压在面板的回纹上。 */
      var lh = Math.min(ids.length, SK.maxRows) * SK.rowH;
      G.UI.panel(x, { x: hb.x - 2, y: SK.listY - 2, w: hb.w + 4, h: lh + 3 },
        'rgba(8,11,19,0.94)', 'rgba(216,183,104,0.28)', 4, { tex: false, shadow: false });
      var more = ids.length - SK.maxRows;
      if (more > 0) {
        G.UI.textOut(x, { x: hb.x + hb.w - 10, y: SK.listY + lh + 3 },
          '另有 ' + more + ' 本未列出', 10, G.UI.C.textDim, 'right');
      }
      G.UI.text(x, { x: SP.x + 14, y: SP.y + 202 },
        '点一本即可切换；境界高的排在最上面。', 10, G.UI.C.textDim);
      return;
    }

    /* ---- 收起态：详情 ---- */
    var info = (sd.tier || '凡') + '阶　' + sd.kind
      + '　属性 ' + (sd.elem || '无') + '　' + G.Data.skillRealm(lv).n;
    G.UI.text(x, { x: SP.x + 14, y: SK.infoY }, info, 11.5, G.UI.C.text);

    /* 激发状态 + 九重威力（v0.69.0）：
       ① 让玩家一眼看到"这本是否在战斗里能用"（此前完全无处可看）；
       ② 把 prog 的实际收益（伤害倍率）摊开 —— 否则"精进"对玩家是个黑箱数字。 */
    var eqIds = G.Player.equippedIds(save);
    var on = eqIds.indexOf(sel) >= 0;
    var pc = G.Player.progCoef ? G.Player.progCoef(lv) : 1;
    G.UI.text(x, { x: SP.x + 14, y: SK.stateY },
      on ? '已激发：本功法参与战斗' : '未激发：战斗技能栏不会出现',
      10.5, on ? G.UI.C.jadeHi : G.UI.C.textDim);
    /* ⚠️ 用**左对齐 + 手动左移**而不是 align:'right' ——
       `panels.bounds.contract` 的 `box()` 不认 align（按左对齐算宽度），
       用 'right' 会被判成"文字从 x 向右越界"（项目老坑 G49 同族）。
       "威力 ×2.15" 最长约 62px（10.5 号字），起点放在 SP 右沿内 70px 处即安全。 */
    G.UI.text(x, { x: SP.x + SP.w - 84, y: SK.stateY },
      '威力 ×' + pc.toFixed(2), 10.5, G.UI.C.gold);

    sec(x, SP.x + 14, SK.secY, '效 果');
    skillEffects(sd).slice(0, 3).forEach(function (t, i) {
      G.UI.text(x, { x: SP.x + 14, y: SK.effY + i * 14 }, t, 10.5, G.UI.C.textDim);
    });

    G.UI.text(x, { x: SP.x + 14, y: SK.contribY }, '本功法贡献', 10.5, G.UI.C.textDim);
    G.UI.text(x, { x: SP.x + 84, y: SK.contribY },
      skillContrib(sd, lv, save), 11, COL[sd.elem] || G.UI.C.jadeHi);

    G.UI.text(x, { x: SP.x + 14, y: SK.hintY },
      '激发后才进战斗技能栏（至多 3 本，被动不占位）；精进耗灵力。', 10, G.UI.C.textDim);
  }


  /* ============================================================
     二、秘术
     ============================================================ */
  function secretDesc(id, grade) {
    var e = G.Data.dungeons.SECRET_EFFECTS[id];
    if (!e) return '—';
    var g = grade || 1;
    var pct = function (v) { return Math.round(v * g * 100) + '%'; };
    if (e.cat === '圣') {
      var parts = [];
      if (e.atk) parts.push('攻击 +' + pct(e.atk));
      if (e.def) parts.push('防御 +' + pct(e.def));
      if (e.hp) parts.push('气血 +' + pct(e.hp));
      if (e.spd) parts.push('速度 +' + pct(e.spd));
      return '圣术 · ' + parts.join('　');
    }
    if (e.cat === '神') {
      if (e.vamp) return '神术 · 攻击吸血 ' + pct(e.vamp);
      if (e.kurong) return '神术 · ' + Math.round(e.kurong.chance * 100) + '% 枯荣（每层 −'
        + Math.round(e.kurong.pct * 100) + '%，至多 ' + e.kurong.max + ' 层）';
      if (e.zhuxie) return '神术 · ' + Math.round(e.zhuxie * 100) + '% 概率诛邪（驱散增益）';
      if (e.mangshan) return '神术 · 芒山聚灵（每回合回灵 ×' + e.mangshan + '）';
      if (e.startShield) return '神术 · 开场护盾 ' + pct(e.startShield);
      return '神术';
    }
    if (e.cat === '仙') {
      var c = e.cast || {};
      if (c.target === 'self') {
        return '仙术 · 每场一次：回复 ' + Math.round((c.healSelf || 0) * 100) + '% 气血';
      }
      return '仙术 · 每场一次：' + (c.target === 'all' ? '全体' : '单体') + ' '
        + Math.round((c.mult || 0) * 100) + '%'
        + (c.status ? '（' + (ST_NAME[c.status.t] || c.status.t) + ' '
          + Math.round(c.status.chance * 100) + '%）' : '');
    }
    return '—';
  }

  function drawSecrets(x) {
    var save = G.game.save;
    var Dg = G.Data.dungeons;
    var all = Object.keys(Dg.SECRETS);
    var have = save.secrets || {};
    var owned = all.filter(function (id) { return have[id]; });
    shell(x, '秘　术', '已习 ' + owned.length + ' / ' + all.length,
      { left: true, frame: G.Overlays.CHAR_PANEL, band: G.Overlays.CHAR_BAND, p: SP });

    if (!owned.length) {
      empty(x, SP.x + 14, SP.y + 44, '尚未习得任何秘术。');
      G.UI.text(x, { x: SP.x + 14, y: SP.y + 66 },
        '通关秘境（第 5 关或第 9 关）可得该秘境的签名秘术，', 10.5, G.UI.C.textDim);
      G.UI.text(x, { x: SP.x + 14, y: SP.y + 82 },
        '品阶随所得界域提升：凡品 1 → 灵品 1.5 → 仙品 2 → 道品 2.5。', 10.5, G.UI.C.textDim);
      return;
    }
    owned.slice(0, 7).forEach(function (id, i) {
      var y = SP.y + 44 + i * 23;
      var g = Dg.gradeOf(save, id);
      var e = Dg.SECRET_EFFECTS[id] || {};
      var catCol = e.cat === '仙' ? G.UI.C.goldHi
        : (e.cat === '神' ? G.UI.C.jadeHi : G.UI.C.text);
      G.UI.text(x, { x: SP.x + 14, y: y }, Dg.SECRETS[id], 12, catCol);
      G.UI.text(x, { x: SP.x + 122, y: y + 1 }, '品阶 ' + g, 10, G.UI.C.gold);
      /* 描述用限宽单行：起点 +176，右止于内容区右缘 -12，超长自动缩字/省略，杜绝右溢出。 */
      G.UI.textFit(x, { x: SP.x + 176, y: y + 1 }, secretDesc(id, g), 10.5,
        G.UI.C.textDim, (SP.x + SP.w - 12) - (SP.x + 176));
    });
    if (owned.length > 7) {
      G.UI.text(x, { x: SP.x + 14, y: SP.y + 206 }, '……另有 ' + (owned.length - 7) + ' 项', 10, G.UI.C.textDim);
    }
  }

  /* ============================================================
     三、任务
     ============================================================ */
  /* ============================================================
     任务（v0.20.0 改版）：主线 / 支线分列 + **列表可点** + 右侧详情
     ------------------------------------------------------------
     旧版把整条主线铺成一张**不可点**的清单，玩家只能"看"不能"选"
     （用户口径：「这些任务必须要能点击，选择任务可以查看任务的详情」）。
     现在：左栏是可点列表，点一下 → 右栏出该任务的详情（目标 / 子任务 / 状态 / 提示）。
     ⚠️ 列表行用 `variant:'plain'`（**只登记命中、不画任何像素**），外观仍由本函数自绘 ——
        换成普通按钮它会自己画底板 + 居中 label，和"状态点 + 标题 + 完成标"的版式冲突。
     ============================================================ */
  /* 详情栏宽度必须**够放一行不折的正文**：`G.UI.wrap` 依赖 `measureText`，而
     无头 smoke 的桩返回"长度 × 7"，对中文严重低估 → 桩里根本不折行，
     `panels.bounds.contract` 按真实字宽一算就判越界。真机虽然会折，但把宽度留够
     可以让"真机"和"契约"两个口径一致（少一类假阳性）。 */
  var QP = {
    tabY: P.y + 30, tabW: 64, tabH: 20, tabGap: 6,
    listX: P.x + 14, listW: 150, listY: P.y + 64, rowH: 15, maxRows: 9,
    detX: P.x + 168, detW: P.w - 182, detY: P.y + 64
  };

  /* 支线（**系统型**）：从已有系统派生、可自动判定完成。
     内容型支线（有 NPC、有剧情）留待后续版本 —— 这里先给"长线目标"清单，
     让玩家在任务面板里看得到"除了主线还能干什么"。 */
  var SIDE = [
    { id: 'sd_dungeon', t: '秘境历练', d: '通关任意一个秘境副本。',
      hint: '底栏「角色」→ 秘境，或地图上的秘境裂隙。',
      done: function (s) { return (s.dungeonSlot || 0) > 0 || (s.dungeonFarm || 0) > 0; } },
    { id: 'sd_skill', t: '功法小成', d: '习得 3 本功法。',
      hint: '副本掉落、野外刷怪、宗门传功皆可。',
      done: function (s) { return Object.keys(s.skills || {}).length >= 3; } },
    { id: 'sd_zhuji', t: '筑基之路', d: '修至筑基境。',
      hint: '破境需破境丹 + 天劫，见角色面板「境界」子页。',
      done: function (s) { return (s.globalLevel || 1) >= 19; } },
    { id: 'sd_cult', t: '道途之择', d: '拜入宗门，或改换门庭一次。',
      hint: '底栏「宗门」。每世只有一次改换门庭的机会。',
      done: function (s) { return s.cult === 'sect' || !!s.cultSwitchUsed; } }
  ];


  /* 按**字数**折行（不依赖 `measureText`）。
     为什么要自己折：`G.UI.wrap` 用 `measureText`，而无头桩返回"长度 × 7"，
     对中文严重低估 → 桩里根本不折行，`panels.bounds.contract` 按真实字宽一算就判越界。
     任务详情是**中文为主**的整句，按"每行 maxW/size 个字"切就够准，且两个口径一致。 */
  function wrapCJK(str, size, maxW, maxLines) {
    str = String(str || '');
    var per = Math.max(4, Math.floor(maxW / size));
    var out = [], i = 0;
    while (i < str.length && out.length < maxLines) {
      out.push(str.slice(i, i + per));
      i += per;
    }
    if (i < str.length && out.length) {
      out[out.length - 1] = out[out.length - 1].slice(0, -1) + '…';
    }
    return out;
  }

  /* 左栏此刻**实际显示**的行 —— drawQuest 与 buildQuest 共用这一份，
     两处各算一次窗口必然分叉（点到的行和看到的行对不上）。 */
  function questRows(save, scene) {
    var tab = scene.questTab || 'main';
    if (tab === 'side') {
      /* 内容型支线（`data/sidequests.js`）：有 NPC、有剧情、各记各的进度。
         旧的"系统型"清单已被取代 —— 那一版没有 NPC 也没有剧情，
         玩家在任务面板里看到的是"秘境历练/功法小成"这种目标，不像任务。 */
      var list = (G.Data.sideQuests ? G.Data.sideQuests.list : []);
      return { rows: list.map(function (q) { return { id: q.id, sq: q }; }), win0: 0, total: list.length };
    }
    var q = save.quest || { step: 'free', flags: {} };
    /* ⚠️ 顺序表按**当前所在线**取（分叉后主线不再是一条） */
    var order = questOrderOf(save);
    var idx = order.indexOf(q.step);
    if (idx < 0) idx = order.length - 1;
    /* 主线章节（v0.63.0，用户第 6 点）：列表末尾挂**当前待推进的那一章**（只挂一章）。
       ⚠️ 挂全部十章会顶出面板（rowH 15 × maxRows 9 已经顶到 y=225，面板底 238）——
          所以有章节时主线窗口少放一行（`cap2 = CAP - 1`）。 */
    var ch = (G.Data.Chapters ? G.Data.Chapters.pendingFor(save) : null);
    var CAP = QP.maxRows;
    var cap2 = ch ? CAP - 1 : CAP;
    var win0 = 0;
    if (order.length > cap2) {
      win0 = Math.max(0, Math.min(idx - Math.floor(cap2 / 2), order.length - cap2));
    }
    var rows = order.slice(win0, win0 + cap2).map(function (id, i) {
      return { id: id, gi: win0 + i, s: QUEST[id] };
    });
    if (ch) rows.push({ id: 'ch:' + ch.id, ch: ch });
    return { rows: rows, win0: win0, total: order.length, chapter: ch };
  }

  function drawQuest(x, scene) {
    var save = G.game.save;
    var q = save.quest || { step: 'free', flags: {} };
    var tab = scene.questTab || 'main';
    var idx = questOrderOf(save).indexOf(q.step);
    if (idx < 0) idx = 0;
    var view = questRows(save, scene);
    var selId = scene.questSel || (tab === 'main' ? q.step : (G.Data.sideQuests.list[0] || {}).id);
    /* 选中项解析：主线行带 `s`（QUEST 条目），支线行带 `sq`（SIDEQ 条目）——
       ⚠️ 两边的字段名不同，**兜底也必须分叉**。曾经兜底统一取 `.s`，
       支线页于是永远取不到选中项 → `return` → **面板整块不画、只剩按钮浮在场景上**
       （截图反馈踩过；这类"换了数据源但兜底没跟上"只有真渲染一帧才看得见）。 */
    var sel = null, selGi = -1, selSide = null, selCh = null;
    function pick(r) {
      if (!r) return;
      if (r.ch) {
        /* 章节行（v0.63.0）：它不是 QUEST 条目，字段也不一样 —— 自己拼一份"详情视图" */
        selCh = r.ch;
        sel = {
          t: '第 ' + (G.Data.Chapters.list.indexOf(r.ch) + 1) + ' 章 · ' + r.ch.n,
          d: r.ch.lines ? r.ch.lines[0] : '',
          subs: []
        };
        selGi = -1;
      } else if (r.sq) { sel = r.sq; selSide = r.sq; }
      else { sel = r.s; selGi = r.gi; }
    }
    view.rows.forEach(function (r) { if (r.id === selId) pick(r); });
    if (!sel) pick(view.rows[0]);
    if (!sel) return;

    /* 右上角：主线页顺带报**章节进度**（v0.63.0）—— 用户第 6 点说"主线太少了"，
       光加内容不报进度，玩家在面板上还是看不出主线有多长。 */
    var chProg = (tab === 'main' && G.Data.Chapters)
      ? G.Data.Chapters.progressOf(save) : null;
    shell(x, '任　务', tab === 'main'
      ? ('主线 · 章节 ' + (chProg ? (chProg.done + '/' + chProg.total) : '—'))
      : '支线');

    /* ---- 左栏：可点列表 ---- */
    var chev = function (cx, cy, up) {
      x.save(); x.fillStyle = 'rgba(150,158,180,0.75)';
      x.beginPath();
      if (up) { x.moveTo(cx - 3.4, cy + 1.8); x.lineTo(cx + 3.4, cy + 1.8); x.lineTo(cx, cy - 2.0); }
      else { x.moveTo(cx - 3.4, cy - 1.8); x.lineTo(cx + 3.4, cy - 1.8); x.lineTo(cx, cy + 2.0); }
      x.closePath(); x.fill(); x.restore();
    };
    view.rows.forEach(function (r, i) {
      var on = (r.id === selId);
      var done;
      if (r.ch) {
        done = false;                    /* 章节行 = 还没做完的那一章 */
      } else if (r.sq) {
        done = (G.Data.sideQuests.stepOf(save, r.sq.id) >= 3);
      } else {
        done = (r.gi < idx);
      }
      /* 状态点画在按钮**左侧之外**（按钮矩形从 QP.listX 起）——
         行的标签由按钮自己画（见 buildQuest），面板这边只补这个点。
         行文字不在这里画：画了就会判"面板文字压在按钮上"。 */
      mark(x, QP.listX - 8, QP.listY + i * QP.rowH + 2, done ? 'done' : (on ? 'now' : 'todo'));
    });
    if (tab === 'main') {
      if (view.win0 > 0) chev(QP.listX + QP.listW - 10, QP.listY - 8, true);
      if (view.win0 + QP.maxRows < view.total) {
        chev(QP.listX + QP.listW - 10, QP.listY + view.rows.length * QP.rowH - 2, false);
      }
    }

    /* ---- 右栏：详情 ---- */
    var dx = QP.detX, dy = QP.detY;
    G.UI.text(x, { x: dx, y: dy - 16 }, selCh ? '主线 · 章节' : (selSide ? '支线' : '主线'),
      10, G.UI.C.gold);
    G.UI.text(x, { x: dx, y: dy + 2 }, selSide ? selSide.n : sel.t, 13.5, G.UI.C.goldHi);
    var sideDesc = '';
    if (selSide) {
      var st0 = G.Data.sideQuests.stepOf(save, selSide.id);
      sideDesc = st0 === 0 ? selSide.intro
        : selSide.steps[Math.min(st0, 3) - 1].d;
    }
    var dl = wrapCJK(selSide ? sideDesc : sel.d, 11, QP.detW, 3);
    dl.slice(0, 3).forEach(function (l, i) {
      G.UI.text(x, { x: dx, y: dy + 22 + i * 15 }, l, 11, G.UI.C.text);
    });
    var by = dy + 22 + Math.min(dl.length, 3) * 15 + 8;

    if (selSide) {
      /* 内容型支线：step 0 未接 / 1 进行中 / 2 可交付 / 3 已完成 */
      var SQ = G.Data.sideQuests;
      var st = SQ.stepOf(save, selSide.id);
      var stN = st === 0 ? '未接取' : (st === 1 ? '进行中' : (st === 2 ? '可交付' : '已完成'));
      G.UI.text(x, { x: dx, y: by }, stN, 11,
        st === 3 ? G.UI.C.jadeHi : (st === 2 ? G.UI.C.goldHi : G.UI.C.gold));
      G.UI.text(x, { x: dx, y: by + 20 }, '提示', 10, G.UI.C.gold);
      var hint = st === 0 ? '去镇上找他说说话。'
        : (st >= 3 ? '此桩已了。' : selSide.steps[st - 1].hint);
      wrapCJK(hint, 10, QP.detW, 2).forEach(function (l, i) {
        G.UI.text(x, { x: dx, y: by + 34 + i * 13 }, l, 10, G.UI.C.textDim);
      });
      return;
    }

    /* 主线详情：子任务（有 f 的按旗标判完成）+ 本步状态。
       ⚠️ 纵向预算只有 SP.h - 64 = 168px，而"目标 2 行 + 子任务 2 条 + 状态 + 提示"
       很容易超 —— 所以**去掉单独的「前往」行**（路引已经指了），提示只留一行。 */
    var subs = sel.subs || [];
    if (subs.length) {
      G.UI.text(x, { x: dx, y: by }, '子任务', 10, G.UI.C.gold);
      subs.slice(0, 2).forEach(function (sb, i) {
        var d2 = !!(sb.f && q.flags && q.flags[sb.f]);
        mark(x, dx + 2, by + 18 + i * 15, d2 ? 'done' : 'todo');
        G.UI.text(x, { x: dx + 14, y: by + 14 + i * 15 }, sb.t, 10,
          d2 ? G.UI.C.jadeHi : G.UI.C.text);
      });
      by += 18 + Math.min(subs.length, 2) * 15 + 6;
    }
    var isCur = (view.rows.some(function (r) { return r.id === selId && r.gi === idx; }));
    G.UI.text(x, { x: dx, y: by }, isCur ? '当前进行中'
      : (selGi >= 0 && selGi < idx ? '已完成' : '未开始'),
      10, isCur ? G.UI.C.gold : G.UI.C.textDim);
    G.UI.text(x, { x: dx, y: by + 20 }, '点左侧任一条可查看详情。', 10, G.UI.C.textDim);
  }

  function buildQuest(btns, scene) {
    var save = G.game.save;
    var q = save.quest || { step: 'free', flags: {} };
    var tab = scene.questTab || 'main';
    var selId = scene.questSel || (tab === 'main' ? q.step : (G.Data.sideQuests.list[0] || {}).id);

    /* 页签：主线 / 支线 */
    [{ id: 'main', n: '主线' }, { id: 'side', n: '支线' }].forEach(function (t, i) {
      btns.push(new G.UI.Btn({
        x: QP.listX + i * (QP.tabW + QP.tabGap), y: QP.tabY, w: QP.tabW, h: QP.tabH,
        small: true, variant: 'subtab', active: tab === t.id, label: t.n,
        onClick: function () {
          scene.questTab = t.id;
          scene.questSel = (t.id === 'main') ? q.step : (G.Data.sideQuests.list[0] || {}).id;
          G.Overlays.openPanel(scene, 'quest', true);
        }
      }));
    });

    /* 列表行：**真按钮**（自己画左对齐标签）。
       不能用"面板自绘文字 + plain 命中框" —— 两者的矩形必然重叠，
       `panels.bounds.contract` 直接判"文字压在按钮上"。 */
    questRows(save, scene).rows.forEach(function (r, i) {
      var on = (r.id === selId);
      var done = r.ch ? false
        : (r.sq ? (G.Data.sideQuests.stepOf(save, r.sq.id) >= 3) : (r.gi < idxOf(q.step)));
      btns.push(new G.UI.Btn({
        x: QP.listX, y: QP.listY + i * QP.rowH - 5, w: QP.listW, h: QP.rowH - 1,
        small: true, fs: 10.5, lalign: true,
        variant: on ? 'gold' : 'ghost',
        label: r.ch ? ('章 · ' + r.ch.n) : (r.sq ? r.sq.n : r.s.t),
        onClick: function () {
          scene.questSel = r.id;
          G.Overlays.openPanel(scene, 'quest', true);
        }
      }));
    });
  }
  function idxOf(step) {
    var i = QUEST_ORDER.indexOf(step);
    return i < 0 ? QUEST_ORDER.length - 1 : i;
  }

  /* ============================================================
     四、储物（v0.11.4 改版：分类子页 + 方格陈列 + 悬浮说明）
     ─ 原先是一张平铺列表（名 / 数量 / 说明各一列），功法、秘术、灵石根本进不来，
       玩家看不到"我一共有些什么"。
     ─ 现在按类分页，每类**独立方格**陈列（8 列 × 3 行 = 24 格），指针停在格上出说明。
       各类的数据来源不同（杂项=save.items 平表 / 功法=save.skills / 灵石=save.stone 标量
       / 秘术=save.secrets / 法宝 M2 才有），所以由 bagCells 逐类取。

     ⚠️ 格子的名称与数量**必须由按钮自己画**（label + sub），不能在 drawBag 里另画：
       `panels.bounds.contract` 会判"文字压在按钮上"，而格子**必须**是可点的按钮
       （点格子即使用），面板体再往上画字必然报错。
       renderPanel 不渲染 scene.buttons，所以按钮自己的 label 不进 textSpy。 */
  var BAG_TABS = [
    { id: 'misc', n: '杂项' },
    { id: 'skill', n: '功法' },
    { id: 'stone', n: '资产' },
    { id: 'treasure', n: '法宝' },
    { id: 'secret', n: '秘术' }
  ];
  /* 方格几何：8 列 × 3 行，格 46 + 缝 6。
     横向 8*46 + 7*6 = 410 ≤ 内容宽 428；纵向 3*46 + 2*6 = 150（84..234，面板底 238）。 */
  var BG = {
    tabY: P.y + 34, tabW: 62, tabH: 20, tabGap: 6,
    x0: P.x + 14, y0: P.y + 58,
    /* 格宽 46 → 44（v0.14.0）：内容区左沿右移 34 后，8 列 46 会顶出外框右沿。
       8×44 + 7×6 = 394 = 内容可用宽，正好收住。改格宽前先算这条。 */
    cell: 44, gap: 6, cols: 8, rows: 3
  };
  BG.cap = BG.cols * BG.rows;

  /* 总身家（下品灵石计）的紧凑显示：过万走「万」，过亿走「亿」。
     用户第 11 点要求"灵石改称资产"，而资产是**四币合计**，所以必须有个折算口径。 */
  function fmtWorth(v) { return G.Player.formatCount(v); }

  /* 逐类取格子：{ n 名称, c 数量/等级, d 悬浮说明, use 可使用则填道具名 } */
  function bagCells(tab, save) {
    var out = [];
    if (tab === 'misc') {
      Object.keys(save.items || {}).forEach(function (k) {
        if (!(save.items[k] > 0)) return;
        /* 法宝（eq_ 前缀）归「法宝」页陈列，不混在杂项里 */
        if (G.Data.equips && G.Data.equips.byId(k)) return;
        out.push({ n: k, c: '×' + G.Player.formatCount(save.items[k]), d: itemDescription(k),
          use: ITEM_USE[k] ? k : null, icon: ITEM_ICON_ID[k] || null });
      });
    } else if (tab === 'skill') {
      skillIdsSorted(save).forEach(function (id) {
        var sd = G.Data.skills[id] || { n: id, tier: '凡', kind: '仙术', elem: '无' };
        /* 宗门与散修互斥：不可用的**保留显示**（玩家要看得见"我曾经会"），
           但数量位改成原因、说明里前置【】标注。 */
        var why = G.Player.skillBlockReason ? G.Player.skillBlockReason(save, id) : null;
        out.push({
          n: sd.n, c: why ? '不可用' : G.Data.skillRealm(save.skills[id].lv).short,
          icon: ELEM_PINYIN[sd.elem] || null,
          blocked: !!why,
          d: (why ? '【' + why + '】' : '')
            + (sd.tier || '凡') + '阶 · ' + sd.kind + ' · 属性 ' + (sd.elem || '无')
            + '。精进在底栏「功法」页。'
        });
      });
    } else if (tab === 'stone') {
      /* 资产（v0.61.0，用户第 11 点）：**四界四币 × 四品 = 16 格**。
         用户原话「灵石要区分下品、中品、上品、极品……这个地方灵石名称改为资产」。
         ⚠️ 存档里每种币只有**一个标量**（以下品计），四品是 `Player.splitGrades` 的
            显示拆分 —— 另存一份"分品余额"必然与标量分叉（换零钱换丢就是这么来的）。 */
      var hold = G.Player.resHold(save);
      G.Player.RES.forEach(function (c) {
        var g = G.Player.splitGrades(hold[c.id]);
        /* 极品在前：玩家的注意力先落在最值钱的那一档 */
        G.Player.GRADES.slice().reverse().forEach(function (gr) {
          out.push({
            n: gr.n + c.n, c: G.Player.formatCount(g[gr.id]) + '个',
            icon: c.icon + '.' + gr.id,
            d: '1 ' + gr.n + c.n + ' = ' + gr.mult + ' 下品' + c.n
              + '　·　' + (c.world === 'fan' ? '凡界通货，通用'
                : '须至' + c.n + '所辖之界方得')
          });
        });
      });
    } else if (tab === 'secret') {
      var Dg = G.Data.dungeons;
      Object.keys(save.secrets || {}).forEach(function (id) {
        var lv = save.secrets[id];
        out.push({
          n: (Dg.SECRETS && Dg.SECRETS[id]) || id,
          c: '×' + lv,
          d: secretDesc(id, lv)
        });
      });
    } else if (tab === 'treasure') {
      /* 法宝（v0.41.0 起入库陈列）：save.items 里的 eq_ 前缀条目。
         陈列用，穿戴在「角色 → 法宝」子页（不做"点了没反应"的僵尸操作）。 */
      var EQD = G.Data.equips;
      Object.keys(save.items || {}).forEach(function (k) {
        var eq = EQD && EQD.byId(k);
        if (!eq || !(save.items[k] > 0)) return;
        out.push({
          n: eq.n, c: '×' + save.items[k], icon: k,
          d: eq.tier + '阶 · ' + EQD.SLOT_N[eq.slot] + '。' + eq.d
            + ' 在「角色 → 法宝」页穿戴。'
        });
      });
    }
    return out;
  }

  function buildBag(btns, scene) {
    var save = G.game.save;
    var tab = scene.bagTab || 'misc';
    BAG_TABS.forEach(function (t, i) {
      btns.push(new G.UI.Btn({
        x: BG.x0 + i * (BG.tabW + BG.tabGap), y: BG.tabY, w: BG.tabW, h: BG.tabH,
        small: true, variant: 'subtab', active: tab === t.id, label: t.n,
        onClick: function () {
          scene.bagTab = t.id;
          G.Overlays.openPanel(scene, 'bag');
        }
      }));
    });
    bagCells(tab, save).slice(0, BG.cap).forEach(function (c, i) {
      var gx = BG.x0 + (i % BG.cols) * (BG.cell + BG.gap);
      var gy = BG.y0 + Math.floor(i / BG.cols) * (BG.cell + BG.gap);
      var usable = !!c.use && canUse(c.use);
      btns.push(new G.UI.Btn({
        x: gx, y: gy, w: BG.cell, h: BG.cell, small: true, fs: 10.5,
        variant: usable ? 'battle' : 'default',
        /* 可用 → 点即使用；不可用 → passive（外观正常但点不动） */
        passive: !usable, disabled: !usable,
        label: c.n, sub: c.c, icon: c.icon,
        onClick: function () { if (usable) useItem(scene, c.use); }
      }));
    });
  }

  function canUse(k) {
    var save = G.game.save;
    var u = ITEM_USE[k];
    if (!u) return false;
    if (u.heal) {
      var st = G.Player.computeStats(save);
      return save.hp < st.maxhp;
    }
    if (u.qi) return true;
    return false;
  }

  function useItem(scene, k) {
    var save = G.game.save;
    var u = ITEM_USE[k];
    if (!u || !save.items[k]) return;
    if (u.heal) {
      var st = G.Player.computeStats(save);
      if (save.hp >= st.maxhp) { G.game.toast('气血已满'); return; }
      save.hp = Math.min(st.maxhp, Math.round(save.hp + st.maxhp * u.heal));
      G.game.toast(k + '　气血回复');
    } else if (u.qi) {
      save.qi = (save.qi || 0) + u.qi;
      G.game.toast(k + '　灵气 +' + u.qi);
    }
    save.items[k] -= 1;
    if (save.items[k] <= 0) delete save.items[k];
    G.Storage.saveCurrent(save);
    G.Overlays.openPanel(scene, 'bag');
  }

  function drawBag(x, scene) {
    var save = G.game.save;
    var tab = (scene && scene.bagTab) || 'misc';
    shell(x, '储　物', '资产 ' + fmtWorth(G.Player.resWorth(save)));

    var cells = bagCells(tab, save);
    /* 格子本体由按钮画（见文件头说明）；这里只画空态文案与"溢出"提示。
       可用格子的边框由 'battle' 变体给，不可用的走 'default'。 */
    if (!cells.length) {
      empty(x, P.x + 14, BG.y0 + 8,
        tab === 'treasure' ? '尚无法宝 —— 宗门商店可用贡献换取。'
          : tab === 'skill' ? '尚未习得任何功法。'
            : tab === 'secret' ? '尚未获得任何秘术（秘境首通可得）。'
              : '囊中空空。');
      G.UI.text(x, { x: P.x + 14, y: BG.y0 + 32 },
        tab === 'treasure' ? '拜入宗门后，在「势力 → 门派商店」换取。'
          : '杂货铺可购丹药；妖丹可回收换灵石。', 10.5, G.UI.C.textDim);
      return;
    }
    var more = cells.length - BG.cap;
    if (more > 0) {
      G.UI.textOut(x, { x: P.x + P.w - 14, y: P.y + 38 },
        '另有 ' + more + ' 件未列出', 10, G.UI.C.textDim, 'right');
    }
    /* 资产页的**兑换口径**必须写在面板上（用户第 11 点给的就是这条换算链）——
       只摆 16 个格子而不说"哪个值钱"，玩家看不出品级的意义。 */
    if (tab === 'stone') {
      G.UI.text(x, {
        x: P.x + 14,
        y: BG.y0 + Math.ceil(cells.length / BG.cols) * (BG.cell + BG.gap) + 2
      }, '1 下品道晶 = 10 极品仙晶 = 10 万极品灵晶'
        + '（币内每品 ×10，跨界 ×1 万）', 9, G.UI.C.textDim);
    }
    /* 悬浮说明：逐格登记。提示条由 game.js 在帧末统一画（见 ui.js 的 hover 说明）。 */
    cells.slice(0, BG.cap).forEach(function (c, i) {
      var gx = BG.x0 + (i % BG.cols) * (BG.cell + BG.gap);
      var gy = BG.y0 + Math.floor(i / BG.cols) * (BG.cell + BG.gap);
      G.UI.hover({ x: gx, y: gy, w: BG.cell, h: BG.cell },
        { title: c.n + '　' + c.c, text: c.d });
    });
  }

  /* ============================================================
     五、成就
     ============================================================ */
  /* 成就：**两列**排布。
     单列 9 行 × 21px 会从 P.y+44 一路排到 238（= 面板底），
     既顶穿下沿、又正好压在底部「称号」行上（218）—— 两列 5 行 × 26px 收在 194 以内。
     每格两行：① 标记 + 名称 + 仙力（右对齐）；② 说明。 */
  /* 成就页（v0.15.0 移到**游戏外**的开局界面；展示一并富化）。
     口径（用户）：成就与**当前设备/用户 id 绑定**，跨世只发一次；
     所以这页读的是 `meta.achieve`（跨世累积），不是当世 save。
     ⚠️ 从「两列 × 5 行 = 10 格」扩到「三列 × 6 行 = 18 格」：
     v0.15.0 把成就从 9 项加到 18 项，原来的 10 格装不下（多出来的只能写"另有 N 项"）。
     三列宽度：内容宽 394，列宽 (394−16)/3 = 126 —— 够放「名称 + 仙力」一行与说明一行。 */
  function drawAchieve(x) {
    var m = G.game.meta || {};
    var got = m.achieve || {};
    var ALL = G.Player.ACHIEVE || [];
    var n = ALL.filter(function (a) { return got[a.id]; }).length;
    var dev = (G.Storage && G.Storage.deviceId) ? G.Storage.deviceId() : '';
    shell(x, '成　就', '已达成 ' + n + ' / ' + ALL.length);
    /* 设备标识：成就是**跟设备走**的（用户口径），所以这页要把它标出来 ——
       否则玩家换机后看到成就"还在"，会以为成就没跟着存档。 */
    G.UI.text(x, { x: P.x + 14, y: P.y + 32 },
      '本机标识 ' + (dev ? dev.slice(0, 12) : '未知') + '　·　成就与设备绑定，跨世只计一次',
      9.5, G.UI.C.textDim);

    var cols = 3, colW = Math.floor((P.w - 28 - (cols - 1) * 8) / cols);
    /* 行距 24 → 22：6 行的末行说明（+12）会与底部称号区叠上（契约抓到过） */
    var rowH = 22, y0 = P.y + 50;
    ALL.slice(0, cols * 6).forEach(function (a, i) {
      var cx = P.x + 14 + (i % cols) * (colW + 8);
      var cy = y0 + Math.floor(i / cols) * rowH;
      var ok = !!got[a.id];
      mark(x, cx + 4, cy + 5.5, ok ? 'done' : 'todo');
      G.UI.text(x, { x: cx + 14, y: cy }, a.n, 10.5, ok ? G.UI.C.goldHi : G.UI.C.textDim);
      G.UI.textOut(x, { x: cx + colW, y: cy + 1 },
        (ok ? '' : '') + '+' + a.xianli, 9.5, ok ? G.UI.C.gold : G.UI.C.textDim, 'right');
      G.UI.text(x, { x: cx + 14, y: cy + 12 }, a.d, 9,
        ok ? G.UI.C.text : G.UI.C.textDim);
    });

    /* 称号：分列展示（原来只挤在一行里，称号一多就截断成「破狱·凡尘·破狱…」） */
    var ty = P.y + P.h - 26;
    G.UI.divider(x, P.x + P.w / 2, ty - 8, P.w - 28, 'rgba(216,183,104,0.18)');
    var titles = (m.titles && m.titles.length) ? m.titles : [];
    G.UI.text(x, { x: P.x + 14, y: ty }, '称 号', 11, G.UI.C.textDim);
    G.UI.textOut(x, { x: P.x + P.w - 38, y: ty + 0.5 },
      titles.length ? ('共 ' + titles.length + ' 枚') : '尚无', 10, G.UI.C.textDim, 'right');
    G.UI.text(x, { x: P.x + 74, y: ty }, titles.length ? titles.join(' · ') : '无',
      10.5, titles.length ? G.UI.C.goldHi : G.UI.C.textDim);
    if (!titles.length) {
      G.UI.text(x, { x: P.x + 14, y: ty + 14 },
        '以地狱难度踏破任一界可得称号（全属性 +10%，跨世保留）。', 9.5, G.UI.C.textDim);
    }
  }

  /* ============================================================
     洞府（v0.15.0 新增）：炼丹 / 炼器 / 阵法 / 灵兽 四大技艺的入口。
     设计口径（用户）：常见材料在各地图采集、每日刷新；特殊材料刷怪掉落；
     阵法只能从主城/宗门（分布在隐藏区域）交易；灵兽靠捕兽器在小世界捕捉或主线赠予。
     ⚠️ 本版只落地"入口 + 规则说明 + 主动轮回"：四大技艺的**配方与产出**要等
     玩法方向（半开放世界 vs 固定剧情）定稿后再做，避免先写一套再推翻。
     ============================================================ */
  /* ⚠️ 版位算式（改任何一项都要重算整列）：
     副标题 32..43 → 卡片行1 44..90 → 行2 98..144 → 说明 152..162 / 166..176 → 按钮 184..206。
     内容区底 = P.y + P.h - 10 = 228（按钮底 206，留 22px）。
     原来 cardH=54 / y0=40 时副标题被卡片压住、说明被按钮压住 —— 契约两条判据都报过。 */
  var CV = {
    cardW: 191, cardH: 46, gapX: 12, gapY: 8,
    x0: P.x + 14, y0: P.y + 44,
    noteY: P.y + 152,
    btn: { x: P.x + 14, y: P.y + 184, w: 176, h: 22 }
  };
  /* 四大技艺：id / 名 / 载体 / 一句话规则 */
  var ARTS = [
    { id: 'alchemy', n: '炼丹', by: '丹炉', d: '材料各地采集 · 每日刷新' },
    { id: 'forge', n: '炼器', by: '锻台', d: '配方需先识得，方可炼制' },
    { id: 'array', n: '阵法', by: '阵盘', d: '仅主城与宗门可交易' },
    { id: 'beast', n: '灵兽', by: '兽栏', d: '捕兽器捕捉 · 或主线赠予' }
  ];

  function drawCave(x, scene) {
    var save = G.game.save, meta = G.game.meta || {};
    shell(x, '洞府', '第 ' + (save.life || 1) + ' 世');
    if (!G.Player.hasHome(save)) {
      G.UI.text(x, { x: P.x + 16, y: P.y + 46 }, '本世尚无洞府', 17, G.UI.C.goldHi);
      G.UI.text(x, { x: P.x + 16, y: P.y + 78 }, '居所不随转世继承，需以此世所得自行租用。', 12, G.UI.C.text);
      G.UI.text(x, { x: P.x + 16, y: P.y + 102 }, '租金：300 下品灵石；取得后开放丹房、器坊与阵台。', 11, G.UI.C.textDim);
      G.UI.text(x, { x: P.x + 16, y: P.y + 126 }, '无洞府亦可就地打坐、寻师或照料随行灵兽。', 11, G.UI.C.textDim);
      return;
    }
    G.UI.text(x, { x: P.x + 14, y: P.y + 32 },
      '丹房 · 器坊 · 阵台 · 兽栏', 11, G.UI.C.textDim);
    ARTS.forEach(function (a, i) {
      var col = i % 2, row = Math.floor(i / 2);
      var bx = CV.x0 + col * (CV.cardW + CV.gapX);
      var by = CV.y0 + row * (CV.cardH + CV.gapY);
      G.UI.panel(x, { x: bx, y: by, w: CV.cardW, h: CV.cardH },
        G.UI.C.panelDark, G.UI.C.rule, 4, { tex: false, shadow: false });
      G.UI.textOut(x, { x: bx + 10, y: by + 7 }, a.n, 13, G.UI.C.goldHi);
      G.UI.text(x, { x: bx + 10 + 30, y: by + 10 }, a.by, 10, G.UI.C.textDim);
      G.UI.text(x, { x: bx + 10, y: by + 26 }, a.d, 9.5, G.UI.C.textDim);
      if (a.id !== 'alchemy' && a.id !== 'forge' && a.id !== 'array') G.UI.textOut(x, { x: bx + CV.cardW - 10, y: by + 7 }, '未启', 10,
        'rgba(200,160,110,0.85)', 'right');
    });
    G.UI.text(x, { x: P.x + 14, y: CV.noteY },
      '炼丹 / 炼器 / 采药 / 采矿皆须先寻名师拜师，非天生即会。', 10, G.UI.C.goldHi);
    G.UI.text(x, { x: P.x + 14, y: CV.noteY + 14 },
      '点「拜师」寻师习艺；此世若已无望，可主动坐化，早入轮回。', 10, G.UI.C.textDim);
  }

  function buildCave(btns, scene) {
    if (!G.Player.hasHome(G.game.save)) {
      btns.push(new G.UI.Btn({ x: P.x + 16, y: P.y + 153, w: 175, h: 24, small: true,
        variant: 'gold', label: '租用洞府 · 300 灵石', disabled: (G.game.save.stone || 0) < G.Player.HOME_PRICE,
        onClick: function () {
          var result = G.Player.acquireHome(G.game.save);
          G.game.toast(result.ok ? '本世洞府已租得' : result.reason);
          G.Overlays.openPanel(scene, 'cave');
        } }));
      var q = G.game.save.quest || {};
      if (q.step && q.step !== 'm0-1' && q.step !== 'm0-2') {
        btns.push(new G.UI.Btn({ x: P.x + 200, y: P.y + 153, w: 174, h: 24, small: true,
          label: '随身逆命珠', onClick: function () { G.Overlays.openVessel(scene); } }));
      }
      [{ id: 'meditate', label: '就地打坐' }, { id: 'masters', label: '寻师习艺' },
        { id: 'beasts', label: '随行灵兽' }].forEach(function (v, i) {
        btns.push(new G.UI.Btn({ x: P.x + 16 + i * 125, y: P.y + 184, w: 112, h: 22,
          small: true, label: v.label, onClick: function () {
            scene._medFrom = 'cave'; G.Overlays.openPanel(scene, v.id);
          } }));
      });
      return;
    }
    /* 主动轮回（v0.15.0）：**两步确认**（点一次进入待确认，再点一次才真的走）。
       不弹独立对话框 —— 那要新开一条 overlay 管线，而"按钮自变文案"已经够表达意图，
       且失败面为零（第二次点击就是确认，没有第三个状态）。
       ⚠️ 触发方式与寿终一致：写 `_cause` 后切 death 场景，**复用同一套结算**
       （仙力明细 / 走马灯 / 轮回档案），不另写一份 —— 两份结算必然漂。 */
    btns.push(new G.UI.Btn({
      x: CV.x0 + CV.cardW - 36, y: CV.y0 + 3, w: 32, h: 16, small: true, variant: 'gold', label: '进入',
      onClick: function () { scene._craftFrom = 'cave'; G.Overlays.openPanel(scene, 'alchemy'); }
    }));
    btns.push(new G.UI.Btn({
      x: CV.x0 + CV.cardW + CV.gapX + CV.cardW - 36, y: CV.y0 + 3, w: 32, h: 16, small: true, variant: 'gold', label: '进入',
      onClick: function () { scene._craftFrom = 'cave'; G.Overlays.openPanel(scene, 'forge'); }
    }));
    btns.push(new G.UI.Btn({
      x: CV.x0 + CV.cardW - 36, y: CV.y0 + CV.cardH + CV.gapY + 3, w: 32, h: 16, small: true, variant: 'gold', label: '进入',
      onClick: function () { scene._craftFrom = 'cave'; G.Overlays.openPanel(scene, 'array'); }
    }));
    var arm = !!scene.endArm;
    if (!arm) btns.push(new G.UI.Btn({
      x: CV.btn.x + CV.btn.w + 8, y: CV.btn.y, w: 88, h: CV.btn.h, small: true,
      variant: 'gold', label: '进入兽栏',
      onClick: function () { G.Overlays.openPanel(scene, 'beasts'); }
    }));
    btns.push(new G.UI.Btn({
      x: CV.btn.x, y: CV.btn.y, w: CV.btn.w, h: CV.btn.h, small: true,
      variant: 'danger',
      label: arm ? '再点一次 · 确认坐化' : '坐化 · 主动轮回',
      onClick: function () {
        if (!scene.endArm) { scene.endArm = true; G.Overlays.openPanel(scene, 'cave'); return; }
        var save = G.game.save;
        save._cause = 'self';
        G.Storage.saveCurrent(save);
        G.game.changeScene('death');
      }
    }));
    if (arm) {
      btns.push(new G.UI.Btn({
        x: CV.btn.x + CV.btn.w + 8, y: CV.btn.y, w: 88, h: CV.btn.h, small: true,
        variant: 'battle', label: '再想想',
        onClick: function () { scene.endArm = false; G.Overlays.openPanel(scene, 'cave'); }
      }));
    }
    /* 闭关 · 打坐（v0.61.0，用户第 3/4 点）：灵根苦修的正式入口。
       卡片区（2×2）与底部按钮行都排满了，所以借说明行右侧那一块空白
       （说明文字最宽约到 x=320，按钮从 340 起，水平不叠）。 */
    btns.push(new G.UI.Btn({
      x: 340, y: 170, w: 120, h: 18, small: true,
      variant: 'gold', label: '闭 关 · 打 坐',
      onClick: function () { scene._medFrom = 'cave'; G.Overlays.openPanel(scene, 'meditate'); }
    }));
    /* 拜师·习艺：寻名师学炼丹/炼器/采药/采矿（用户第 7 点） */
    btns.push(new G.UI.Btn({
      x: 340, y: CV.btn.y, w: 120, h: CV.btn.h, small: true,
      variant: 'gold', label: '拜师 · 习艺',
      onClick: function () { G.Overlays.openPanel(scene, 'masters'); }
    }));
  }

  /* 内联材料：图标 + 持有/所需，不足标红（v0.60，用户第 4 点）。 */
  function drawMatsInline(x, save, mats, x0, y) {
    var cp = x0;
    Object.keys(mats).forEach(function (nm) {
      var need = mats[nm], have = (save.items && save.items[nm]) || 0;
      var id = G.Overlays.itemIconId ? G.Overlays.itemIconId(nm) : nm;
      var SZ = 11, ic = G.Art.itemIcon(id, SZ);
      x.drawImage(ic.c, cp + ic.ox, y + ic.oy, ic.w, ic.h);
      cp += SZ + 1;
      G.UI.text(x, { x: cp, y: y - 1 }, have + '/' + need, 8,
        have >= need ? G.UI.C.textDim : '#d98a8a');
      cp += 19;
    });
  }
  /* 丹房（四大技艺批2）：列出炼丹配方，材料足即可炼制。 */
  var AL = { lx: P.x + 12, y0: P.y + 34, rowH: 14, btnX: P.x + P.w - 70 };
  function drawAlchemy(x, scene) {
    var save = G.game.save;
    shell(x, '丹房 · 炼丹', '第 ' + (save.life || 1) + ' 世');
    G.Alchemy.recipes.forEach(function (r, i) {
      var y = AL.y0 + i * AL.rowH, c = G.Alchemy.canCraft(save, r);
      G.UI.textOut(x, { x: AL.lx, y: y - 1 }, r.n, 11, c.ok ? G.UI.C.goldHi : G.UI.C.textDim);
      drawMatsInline(x, save, r.mats, AL.lx + 56, y);
    });
  }
  function buildAlchemy(btns, scene) {
    var save = G.game.save;
    G.Alchemy.recipes.forEach(function (r, i) {
      var y = AL.y0 + i * AL.rowH, c = G.Alchemy.canCraft(save, r);
      btns.push(new G.UI.Btn({
        x: AL.btnX, y: y - 3, w: 58, h: 16, small: true,
        variant: c.ok ? 'gold' : 'ghost', label: '炼制', disabled: !c.ok,
        onClick: function () {
          var res = G.Alchemy.craft(save, r);
          G.game.toast(res.ok ? ('炼成 ' + r.n + ' ×' + res.n) : res.reason);
          G.Overlays.openPanel(scene, 'alchemy');
        }
      }));
    });
    btns.push(new G.UI.Btn({
      x: AL.lx, y: 212, w: 96, h: 20, small: true,
      label: scene._craftFrom === 'cave' ? '返回洞府' : '关　闭',
      onClick: function () { if (scene._craftFrom === 'cave') G.Overlays.openPanel(scene, 'cave'); else scene.clearOverlay(); }
    }));
  }

  /* 器坊（四大技艺批3）：列出炼器配方，材料足即可锻造，产物走三槽法宝。 */
  var FG = { lx: P.x + 12, y0: P.y + 34, rowH: 15, btnX: P.x + P.w - 70 };
  function drawForge(x, scene) {
    var save = G.game.save;
    shell(x, '器坊 · 炼器', '第 ' + (save.life || 1) + ' 世');
    G.Forge.recipes.forEach(function (r, i) {
      var y = FG.y0 + i * FG.rowH, c = G.Forge.canForge(save, r);
      G.UI.textOut(x, { x: FG.lx, y: y - 1 }, G.Forge.outName(r), 11, c.ok ? G.UI.C.goldHi : G.UI.C.textDim);
      G.UI.text(x, { x: FG.lx + 46, y: y - 1 }, r.d, 8, G.UI.C.textDim);
      drawMatsInline(x, save, r.mats, FG.lx + 116, y);
    });
  }
  function buildForge(btns, scene) {
    var save = G.game.save;
    G.Forge.recipes.forEach(function (r, i) {
      var y = FG.y0 + i * FG.rowH, c = G.Forge.canForge(save, r);
      btns.push(new G.UI.Btn({
        x: FG.btnX, y: y - 3, w: 58, h: 16, small: true,
        variant: c.ok ? 'gold' : 'ghost', label: '锻造', disabled: !c.ok,
        onClick: function () {
          var res = G.Forge.forge(save, r);
          G.game.toast(res.ok ? ('锻成 ' + G.Forge.outName(r)) : res.reason);
          G.Overlays.openPanel(scene, 'forge');
        }
      }));
    });
    btns.push(new G.UI.Btn({
      x: FG.lx, y: 212, w: 96, h: 20, small: true,
      label: scene._craftFrom === 'cave' ? '返回洞府' : '关　闭',
      onClick: function () { if (scene._craftFrom === 'cave') G.Overlays.openPanel(scene, 'cave'); else scene.clearOverlay(); }
    }));
  }

  /* 拜师（v0.60）：寻名师学炼丹/炼器/采药/采矿。每艺只显示下一位可拜的师父。 */
  var MS = { lx: P.x + 14, y0: P.y + 36, rowH: 40 };
  var PROF_IDS = ['herb', 'alchemy', 'mine', 'forge'];
  var LV_NAME = ['未习', '入门', '精通', '宗师'];
  function drawMasters(x, scene) {
    var save = G.game.save;
    shell(x, '拜师 · 寻 名 师 习 艺', '第 ' + (save.life || 1) + ' 世');
    PROF_IDS.forEach(function (id, k) {
      var def = G.Professions.list[id], lv = G.Professions.levelOf(save, id);
      var by = MS.y0 + k * MS.rowH;
      G.UI.text(x, { x: MS.lx, y: by }, def.n, 12.5, G.UI.C.goldHi);
      G.UI.text(x, { x: MS.lx + 46, y: by }, '当前：' + LV_NAME[lv], 10,
        lv ? G.UI.C.jadeHi : G.UI.C.textDim);
      if (lv >= 3) {
        G.UI.text(x, { x: MS.lx + 140, y: by }, '已臻宗师，无师可拜', 9.5, G.UI.C.textDim);
        return;
      }
      var t = def.lv[lv], c = G.Professions.canLearn(save, G.game.meta, id, lv + 1);
      G.UI.text(x, { x: MS.lx, y: by + 16 }, '师：' + t.master + '（' + t.place + '）',
        9.5, c.ok ? G.UI.C.text : G.UI.C.textDim);
      G.UI.text(x, { x: MS.lx + 205, y: by + 16 },
        '束脩 ' + (t.cost || '免') + '　' + t.note, 9, G.UI.C.textDim);
    });
  }
  function buildMasters(btns, scene) {
    var save = G.game.save;
    PROF_IDS.forEach(function (id, k) {
      var lv = G.Professions.levelOf(save, id);
      if (lv >= 3) return;
      var c = G.Professions.canLearn(save, G.game.meta, id, lv + 1);
      var by = MS.y0 + k * MS.rowH;
      btns.push(new G.UI.Btn({ x: P.x + P.w - 72, y: by - 3, w: 60, h: 18, small: true,
        variant: c.ok ? 'gold' : 'ghost', label: '拜师', disabled: !c.ok,
        onClick: function () {
          var r = G.Professions.learn(save, G.game.meta, id, lv + 1);
          G.game.toast(r.ok
            ? ('拜入 ' + G.Professions.list[id].lv[lv].master + ' 门下，习得「'
              + G.Professions.list[id].n + '」')
            : r.reason);
          G.Overlays.openPanel(scene, 'masters');
        }
      }));
    });
    btns.push(new G.UI.Btn({ x: MS.lx, y: 212, w: 96, h: 20, small: true, label: '返回洞府',
      onClick: function () { G.Overlays.openPanel(scene, 'cave'); }
    }));
  }

  /* 闭关（v0.61.0，用户第 3 / 第 4 点）：灵根苦修 + 离线收益的唯一入口。
     为什么单开一页：原先"打坐"只是蒲团上一次 +1200 灵气、年龄 +2 的无声动作，
     玩家反馈「没有打坐修炼的感觉」。现在改成**档位 + 演出 + 结算**：
       · 五档（入定一月 → 枯坐百年），耗时 / 耗寿元 / 预计灵气都写在行上；
       · 收益 = 当前小阶 needQi × 档位系数 × **首灵根系数** × (1+灵气加成)
         —— 这就是"灵根的作用"：同样的年月，好灵根拿到的灵气多得多；
       · 点下去先落数据、再播一段打坐演出（脉动光晕 + 灵气上升 + 大字报数）。
     ⚠️ 收益只能走 `G.Time.meditate`（内部取 `Player.needQi`）——
        自己另算一套必然与破境需求分叉，症状是"闭关十年还不够破一阶"。 */
  var MD = { lx: P.x + 14, y0: P.y + 38, rowH: 24 };
  var MED_ANIM_SEC = 1.8;
  function medResultLine(save, scene) {
    var r = scene.medResult;
    if (!r) return '闭关可得灵气，亦可离机闭关（下次回到此世自动结算）';
    return '本次闭关 ' + r.days + ' 日（寿元 −' + G.Time.fmtYears(r.years) + '）· 灵气 +'
      + r.gain + '　' + (r.aged ? '岁月如流' : '容颜未改');
  }
  function drawMeditate(x, scene) {
    var save = G.game.save;
    shell(x, '闭　关', G.Time.label(save));
    var r = G.Player.rates(save);
    var coef = G.Time.linggenCoef(save);
    var gl = save.globalLevel || 1;
    var need = G.Player.needQi(save, gl);
    var have = Math.floor(save.qi || 0);

    G.Time.MEDITATE_TIERS.forEach(function (t, k) {
      var y = MD.y0 + k * MD.rowH;
      var c = G.Time.canMeditate(save, t);
      var gain = G.Time.meditateGain(save, t);
      var years = t.days / G.Time.DAY_PER_YEAR;
      G.UI.textOut(x, { x: MD.lx, y: y }, t.n, 12.5, c.ok ? G.UI.C.goldHi : G.UI.C.textDim);
      G.UI.text(x, { x: MD.lx + 76, y: y + 1 }, '耗 ' + t.days + ' 日', 9.5,
        c.ok ? G.UI.C.text : G.UI.C.textDim);
      G.UI.text(x, { x: MD.lx + 146, y: y + 1 },
        '寿元 −' + G.Time.fmtYears(years), 9.5, c.ok ? G.UI.C.text : G.UI.C.danger);
      G.UI.text(x, { x: MD.lx + 220, y: y + 1 }, '灵气 +' + gain, 10,
        c.ok ? G.UI.C.jadeHi : G.UI.C.textDim);
    });

    /* 账本行：把"寿元怎么消耗"直接写在面板上（用户第 3 点的原话就是这个疑问） */
    var infoY = MD.y0 + G.Time.MEDITATE_TIERS.length * MD.rowH + 6;
    G.UI.text(x, { x: MD.lx, y: infoY },
      '寿元 ' + (save.age || 16) + ' / ' + G.Player.lifespanOf(gl)
      + '　·　灵气 ' + have + ' / ' + need + '（本阶）'
      + '　·　首灵根 ×' + coef, 10, G.UI.C.text);
    G.UI.text(x, { x: MD.lx, y: infoY + 13 },
      '灵气加成 +' + Math.round((r.qi || 0) * 100) + '%　·　' + G.Time.ratioText()
      + '　·　秘境中时间流速 ×' + G.Time.SCENE_MULT.dungeon, 9, G.UI.C.textDim);
    G.UI.text(x, { x: MD.lx, y: infoY + 25 }, medResultLine(save, scene), 9.5,
      scene.medResult ? G.UI.C.jadeHi : G.UI.C.textDim);

    /* 打坐演出：脉动光晕 + 灵气上升 + 大字报数（约 1.8 秒）。
       相位取 `G.game.time`（不用 performance.now）—— 截图与契约才钉得住。 */
    if (scene.medAt != null) {
      var el = (G.game.time || 0) - scene.medAt;
      if (el < MED_ANIM_SEC && el >= 0) {
        var cx = P.x + P.w / 2, cy = P.y + P.h / 2;
        var k1 = el / MED_ANIM_SEC;
        var pulse = 0.5 + 0.5 * Math.sin(el * 9);
        var rad = 26 + 34 * k1 + 4 * pulse;
        var gr = x.createRadialGradient(cx, cy, 2, cx, cy, rad);
        gr.addColorStop(0, 'rgba(198,236,255,' + (0.30 * (1 - k1)).toFixed(3) + ')');
        gr.addColorStop(0.55, 'rgba(150,205,255,' + (0.16 * (1 - k1)).toFixed(3) + ')');
        gr.addColorStop(1, 'rgba(120,180,255,0)');
        x.fillStyle = gr;
        x.beginPath(); x.arc(cx, cy, rad, 0, Math.PI * 2); x.fill();
        /* 上升的灵气点：确定性相位（按序号取模），不用随机数 */
        for (var m = 0; m < 14; m++) {
          var ph = ((el * 0.9 + m * 0.0714) % 1);
          var mx = cx + Math.sin(m * 2.3) * (16 + 26 * ph);
          var my = cy + 34 - ph * 68;
          x.fillStyle = 'rgba(214,244,255,' + ((1 - ph) * (1 - k1) * 0.85).toFixed(3) + ')';
          x.fillRect(mx, my, 1.6, 1.6);
        }
        var res = scene.medResult;
        if (res) {
          G.UI.textOut(x, { x: cx, y: cy - 6 }, '+' + res.gain, 20,
            'rgba(226,246,255,' + (1 - k1).toFixed(2) + ')', 'center');
        }
      } else if (el >= MED_ANIM_SEC) {
        scene.medAt = null;   /* 演出结束：下次进来不再播 */
      }
    }
  }
  function buildMeditate(btns, scene) {
    var save = G.game.save;
    G.Time.MEDITATE_TIERS.forEach(function (t, k) {
      var y = MD.y0 + k * MD.rowH;
      var c = G.Time.canMeditate(save, t);
      btns.push(new G.UI.Btn({
        x: P.x + P.w - 72, y: y - 3, w: 60, h: 18, small: true,
        variant: c.ok ? 'gold' : 'ghost', label: '闭关', disabled: !c.ok,
        onClick: function () {
          var res = G.Player.closeDoor(save, t.id);
          if (!res.ok) { G.game.toast(res.reason); return; }
          scene.medResult = { gain: res.gain, days: res.days, years: res.years, aged: res.aged };
          scene.medAt = G.game.time;
          G.game.toast('闭关 ' + res.days + ' 日 · 灵气 +' + res.gain);
          if (G.Storage.saveCurrent) G.Storage.saveCurrent(save);
          G.Overlays.openPanel(scene, 'meditate', true);
          /* 坐化裁决：闭关是**最可能**把人坐死的一条路（枯坐百年），必须立刻判 */
          if (G.game.checkAged) G.game.checkAged();
        }
      }));
    });
    btns.push(new G.UI.Btn({
      x: MD.lx, y: 214, w: 96, h: 20, small: true,
      label: scene._medFrom === 'cave' ? '返回洞府' : '关　闭',
      onClick: function () {
        if (scene._medFrom === 'cave') G.Overlays.openPanel(scene, 'cave');
        else scene.clearOverlay();
      }
    }));
  }

  /* 阵台（四大技艺批4）：阵法只能主城/宗门交易（道纹阵道界），经营长线投资。 */
  var FM = { lx: P.x + 12, y0: P.y + 34, rowH: 22, btnX: P.x + P.w - 70 };
  function curName(cur) { return cur === 'stone' ? '灵石' : cur === 'sectRep' ? '贡献' : '道晶'; }
  function drawArray(x, scene) {
    var save = G.game.save, meta = G.game.meta;
    shell(x, '阵台 · 阵法', '第 ' + (save.life || 1) + ' 世');
    G.Formations.list.forEach(function (f, i) {
      var y = FM.y0 + i * FM.rowH, owned = G.Formations.has(save, f.id);
      var av = owned ? { ok: true } : G.Formations.availability(save, meta, f);
      G.UI.textOut(x, { x: FM.lx, y: y }, f.n + (owned ? '（已布）' : ''), 11,
        owned ? G.UI.C.goldHi : (av.ok ? G.UI.C.text : G.UI.C.textDim));
      G.UI.text(x, { x: FM.lx + 78, y: y }, f.src, 8.5, G.UI.C.textDim);
      G.UI.text(x, { x: FM.lx, y: y + 10 }, f.d + '　价 ' + f.cost + curName(f.cur), 8.5,
        av.ok ? G.UI.C.text : G.UI.C.textDim);
    });
  }
  function buildArray(btns, scene) {
    var save = G.game.save, meta = G.game.meta;
    G.Formations.list.forEach(function (f, i) {
      var y = FM.y0 + i * FM.rowH, owned = G.Formations.has(save, f.id);
      var av = owned ? { ok: true } : G.Formations.availability(save, meta, f);
      btns.push(new G.UI.Btn({
        x: FM.btnX, y: y - 2, w: 58, h: 16, small: true,
        variant: owned ? 'ghost' : (av.ok ? 'gold' : 'ghost'), label: owned ? '已布' : '购置', disabled: owned || !av.ok,
        onClick: function () {
          var res = G.Formations.buy(save, meta, f.id);
          G.game.toast(res.ok ? ('布下 ' + f.n) : res.reason);
          G.Overlays.openPanel(scene, 'array');
        }
      }));
    });
    btns.push(new G.UI.Btn({
      x: FM.lx, y: 212, w: 96, h: 20, small: true,
      label: scene._craftFrom === 'cave' ? '返回洞府' : '关　闭',
      onClick: function () { if (scene._craftFrom === 'cave') G.Overlays.openPanel(scene, 'cave'); else scene.clearOverlay(); }
    }));
  }

  /* ============================================================
     宗门（《宗门与散修体系设计 v1.0》）
     ------------------------------------------------------------
     · 展示当前阵营 / 宗门 / 位阶 / 贡献（散修时为声望，同一字段两用）
     · 列出本门功法池（已学 / 未学）
     · 拜师（散修 → 宗门）：列出**当前界**的宗门，点一个即入
     · 退门（宗门 → 散修）
     · **每世只有一次**转阵营机会；转阵营把原阵营功法**全部废功**
       （保留条目、不可用，`voided`），并自动卸下已装备的废功功法
     ⚠️ S1 只做"入/退"骨架，入门试炼与贡献任务属 S2（设计 §9）。
     ============================================================ */
  /* 功法属性 → 图标后缀（`assets/img/skill.<拼音>.png`，文生图 4×4 图标集切片）。
     ⚠️ 键必须与 `data/skills.js` 的 `elem` 字面量一致（'无' 也在内）——
        少一个属性就会退回程序化兜底（不报错，只是那张图标不出现）。 */
  var ELEM_PINYIN = {
    '金': 'jin', '木': 'mu', '水': 'shui', '火': 'huo', '土': 'tu',
    '光': 'guang', '雷': 'lei', '风': 'feng', '暗': 'an', '无': 'wu'
  };

  var RANK_N = { outer: '外门', inner: '内门', core: '真传' };
  /* 宗门面板版式（内容区 P 为 y 26..238，底栏从 244 起）：
     · 散修态：说明在 y+138，拜师按钮**两行 × 三列**（y+160 / y+188，22 高 → 236 收住）
     · 宗门态：功法池 4 行（y+108 起、行距 15），底部说明 y+172，退门按钮一行 y+184
     ⚠️ 两态行数不同，所以按钮的 y 也分两套 —— 一套到底会让第二排穿进底栏。 */
  var SEC = {
    freeNoteY: P.y + 138,
    rowY: P.y + 160, row2Y: P.y + 188,
    rowW: 124, rowH: 22, rowGap: 6,
    listY: P.y + 108,
    sectNoteY: P.y + 172,
    /* 未入门「本界全部宗门」3 列网格（凡界 9 宗正好 3×3） */
    gridW: 126, gridGap: 8, gridH: 26, gridGapY: 8
  };
  function sectOf(save) {
    if (!G.Data.sects || !save.sectId) return null;
    return G.Data.sects.byId(save.sectId);
  }
  /* 本界宗门列表（**排序的唯一口径**）：大派在前，其余保持数据序。
     ⚠️ 面板体画徽记、`buildSect` 建按钮 —— 两处**必须共用这一个函数**，
        各排各的必然错位（图标落在隔壁宗门的按钮上，且不报错）。 */
  function sectListOf(meta) {
    var wid = G.Player.activeWorldId(meta);
    var list = (G.Data.sects ? G.Data.sects.ofWorld(wid) : []).slice();
    list.sort(function (a, b) { return (a.size === 'big' ? 0 : 1) - (b.size === 'big' ? 0 : 1); });
    return list;
  }
  /* 宗门徽记取图键（v0.61.0，用户第 12 点）：**按根宗门取** ——
     灵界总部 / 仙界道场与凡界同根（`sects.rootOf`），共用一张徽记，
     所以 21 个宗门只需要 9 张图。 */
  function sectEmblem(id) {
    var root = (G.Data.sects && G.Data.sects.rootOf) ? G.Data.sects.rootOf(id) : id;
    return 'sect.' + (root || id);
  }
  /* ===== 势力面板（v0.41.0 重构）=====
     用户口径：「散修的任务和宗门重叠在一起了，可以在宗门的界面里面新增散修/宗门两个子界面，
     宗门底部的功能名称改成势力」。
     两件事一起做：
      ① 底栏那一项改名「**势力**」—— 面板里散修与宗门**并列**，叫"宗门"会让散修玩家以为与自己无关；
      ② 面板内加**散修 / 宗门 两个子页签**，各自独占一屏 —— 原先两套内容挤在同一屏，
         悬赏文案与"拜入"按钮直接叠在一起（截图反馈）。
     ⚠️ 子页签状态存 `scene.sectTab`（默认按当前阵营：散修玩家看散修页、宗门弟子看宗门页）。 */
  var SECT_TAB_Y = P.y + 30, SECT_TAB_W = 64, SECT_TAB_H = 20;
  function sectTabOf(scene, save) {
    if (scene.sectTab) return scene.sectTab;
    return (save.cult === 'sect') ? 'sect' : 'free';
  }

  function drawSect(x, scene) {
    var save = G.game.save || {};
    var tab = sectTabOf(scene, save);

    /* 自创宗门：取名子视图 */
    if (scene.sectView === 'found') {
      shell(x, '势力', '开宗立派');
      G.UI.text(x, { x: P.x + 14, y: P.y + 58 }, '为自己立一个名号', 12, G.UI.C.goldHi);
      G.UI.text(x, { x: P.x + 14, y: P.y + 78 },
        '镇派功法取你已习得的第一门。开宗后仍可收徒。', 10, G.UI.C.textDim);
      return;
    }
    /* 门派商店子视图（v0.41.0：两列陈列、全部商品可见；名称一律走 itemName 解析，
       内部 id 不再裸显）。 */
    if (scene.sectView === 'shop') {
      shell(x, '势力', '贡献 ' + (save.sectRep || 0));
      G.UI.text(x, { x: P.x + 14, y: P.y + 58 }, '门派商店 · 以贡献换取', 12, G.UI.C.goldHi);
      G.UI.text(x, { x: P.x + 14, y: P.y + 78 },
        '贡献来自副本通关（首杀 +20 / 刷取 +8）。', 10, G.UI.C.textDim);
      var SH = (G.Data.sects && G.Data.sects.SHOP) || [];
      /* 两列几何：内容宽 422，左右各留 14、列间留 12 → 列宽 191；
         5 行 ×16 收在 y+100..179，返回按钮（y+184）不打架。 */
      var SH_COL_W = (P.w - 14 * 2 - 12) / 2;
      SH.forEach(function (it, i) {
        var col = i % 2, row = Math.floor(i / 2);
        var cx = P.x + 14 + col * (SH_COL_W + 12);
        var cy = P.y + 100 + row * 16;
        var can = (save.sectRep || 0) >= it.cost;
        /* 小图标：普通道具走 ITEM_ICON_ID，法宝直接用 id（itemIcon 会补 equip. 前缀） */
        var iconId = ITEM_ICON_ID[it.item] || it.item;
        var ic = G.Art.itemIcon ? G.Art.itemIcon(iconId, 14) : null;
        if (ic && ic.c) {
          x.drawImage(ic.c, Math.round(cx + ic.ox), Math.round(cy + 1 + ic.oy), ic.w, ic.h);
        }
        G.UI.text(x, { x: cx + 18, y: cy + 3 },
          G.Player.itemName(it.item) + ' ×' + it.n + '　' + it.cost + '贡献', 9.5,
          can ? G.UI.C.text : G.UI.C.textDim);
      });
      return;
    }

    shell(x, '势力', '第 ' + (save.life || 1) + ' 世');
    /* 子页签由按钮画，这里只画内容 */
    if (tab === 'free') {
      G.UI.text(x, { x: P.x + 14, y: P.y + 58 },
        '当前阵营：散修　　声望 ' + (save.sectRep || 0), 12, G.UI.C.goldHi);
      G.UI.text(x, { x: P.x + 14, y: P.y + 78 },
        '散修功法靠副本与野怪自寻；宗门功法与你无缘。', 10, G.UI.C.textDim);

      /* 散修盟悬赏 */
      var b = save.bounty;
      G.UI.text(x, { x: P.x + 14, y: P.y + 102 }, '散修盟 · 悬赏', 11, G.UI.C.gold);
      if (b) {
        G.UI.text(x, { x: P.x + 22, y: P.y + 118 },
          '在身：斩妖 ' + b.need + ' 只（还差 ' + G.Player.bountyLeft(save) + '）· 赏 ' + b.stone + ' 灵石',
          10, G.UI.C.text);
      } else {
        G.UI.text(x, { x: P.x + 22, y: P.y + 118 }, '未接悬赏 —— 接一件换灵石。', 10, G.UI.C.textDim);
      }
      /* 拜入入口已移至「宗门」子页（用户口径） */
      G.UI.text(x, { x: P.x + 14, y: P.y + 144 }, '欲拜入宗门？切到「宗门」子页择一。', 10.5, G.UI.C.gold);
      G.UI.text(x, { x: P.x + 14, y: P.y + 162 },
        save.cultSwitchUsed ? '此世已改换门庭一次，来世再议。'
                            : '拜入后散修自悟功法将废功。', 10, G.UI.C.textDim);
      return;
    }

    /* ---- 宗门页 ---- */
    /* 未入门：列出**本界全部宗门**（拜入入口在此；钮由 buildSect 建）。 */
    if (!save.sectId) {
      var wid0 = G.Player.activeWorldId(G.game.meta);
      G.UI.text(x, { x: P.x + 14, y: P.y + 58 },
        (WN[wid0] || '凡界') + '宗门 · 择一拜入', 12, G.UI.C.goldHi);
      G.UI.text(x, { x: P.x + 14, y: P.y + 78 },
        '通过入门试炼即入；拜入后散修自悟功法将废功。', 10, G.UI.C.textDim);
      /* 宗门徽记（v0.61.0，用户第 12 点）：贴在**每格按钮的左缘内**。
         ⚠️ 不能走 `Btn.icon` —— 那个字段会把标签下移到 `y+27`（为 46px 方格设计），
            26px 高的列表行会被顶出按钮外。所以由面板体直接 drawImage。
         ⚠️ 迭代顺序必须与 `buildSect` 一致 → 共用 `sectListOf`。 */
      sectListOf(G.game.meta).forEach(function (sc4, i) {
        var col = i % 3, row = Math.floor(i / 3);
        var ex = P.x + 14 + col * (SEC.gridW + SEC.gridGap);
        var ey = P.y + 96 + row * (SEC.gridH + SEC.gridGapY);
        var ic = G.Art.itemIcon(sectEmblem(sc4.id), 15);
        x.drawImage(ic.c, ex + 5 + ic.ox, ey + (SEC.gridH - 15) / 2 + ic.oy, ic.w, ic.h);
      });
      /* 底部说明：size10 用 top 基线，y 须保证文字不越出面板下框（FRAME 底 238）。
         放 P.y+198(abs224，止于237)；第三行按钮止于 P.y+190(abs216)，留 8px。 */
      G.UI.text(x, { x: P.x + 14, y: P.y + 198 },
        save.cultSwitchUsed ? '此世已改换门庭一次，来世再议。'
          : '每世仅一次改换门庭；宗门功法靠贡献兑换。', 10, G.UI.C.textDim);
      return;
    }
    var s = sectOf(save);
    if (save.sectId === 'own') {
      var os = save.ownSect || { name: '无名宗', disciples: 0 };
      G.UI.text(x, { x: P.x + 14, y: P.y + 58 },
        '当前宗门：' + os.name + '（自创）', 12, G.UI.C.goldHi);
      G.UI.text(x, { x: P.x + 14, y: P.y + 78 },
        '镇派：' + ((G.Data.skills[os.skill] || {}).n || '—')
        + '　　贡献 ' + (save.sectRep || 0), 10.5, G.UI.C.text);
      G.UI.text(x, { x: P.x + 14, y: P.y + 100 }, '弟子', 11, G.UI.C.gold);
      G.UI.text(x, { x: P.x + 22, y: P.y + 116 },
        (os.disciples || 0) + ' / ' + G.Player.DISCIPLE_MAX + '　每人 +2% 攻防血', 10, G.UI.C.jadeHi);
      G.UI.text(x, { x: P.x + 14, y: P.y + 144 },
        save.cultSwitchUsed ? '此世已改换门庭一次，来世再议。' : '退门即散（自家宗门也可以散）。',
        10, G.UI.C.textDim);
      return;
    }
    G.UI.text(x, { x: P.x + 14, y: P.y + 58 },
      '当前宗门：' + ((s && s.n) || '散修'), 12, G.UI.C.goldHi);
    /* 本门徽记（v0.61.0）：贴在右上角，与「当前宗门」同一行但**不压文字** ——
       文字最宽到约 x+180（「当前宗门：太虚剑宗·灵界总部」），徽记从 x+w-46 起。 */
    if (s) {
      var eic = G.Art.itemIcon(sectEmblem(s.id), 30);
      x.drawImage(eic.c, P.x + P.w - 46 + eic.ox, P.y + 50 + eic.oy, eic.w, eic.h);
    }
    G.UI.text(x, { x: P.x + 14, y: P.y + 78 },
      '位阶 ' + (G.Player.RANK_N[G.Player.rankOf(save)] || '外门')
      + '　贡献 ' + (save.sectRep || 0) + '（副本：首杀+20 刷取+8）', 11, G.UI.C.textDim);
    G.UI.text(x, { x: P.x + 14, y: P.y + 102 }, '本门功法', 11, G.UI.C.gold);
    var pool = (s && s.skills) || [];
    pool.slice(0, 4).forEach(function (id, i) {
      var sk = G.Data.skills[id];
      if (!sk) return;
      var own = save.skills && save.skills[id];
      var cost = (sk.tier === '灵') ? 150 : 50;
      var st, col;
      if (own && !own.voided) { st = G.Data.skillRealm(own.lv).short; col = G.UI.C.jadeHi; }
      else if (own && own.voided) { st = '已废功 · 需 ' + cost; col = 'rgba(180,120,120,0.9)'; }
      else { st = '未习 · 需 ' + cost + ' 贡献'; col = G.UI.C.textDim; }
      G.UI.text(x, { x: P.x + 22, y: P.y + 120 + i * 15 }, sk.n + '　' + st, 10, col);
    });
    /* 贡献来源已并入顶部「贡献」行；此处不再放底部说明，避免文字越出面板下框。 */
  }

  function buildSect(btns, scene) {
    var save = G.game.save;
    var tab = sectTabOf(scene, save);

    /* 子页签（散修 / 宗门）—— 两个页签都常驻，玩家能看见"还有另一半" */
    [['free', '散修'], ['sect', '宗门']].forEach(function (t, i) {
      btns.push(new G.UI.Btn({
        x: P.x + 14 + i * (SECT_TAB_W + 6), y: SECT_TAB_Y, w: SECT_TAB_W, h: SECT_TAB_H,
        small: true, variant: 'subtab', active: tab === t[0], label: t[1],
        onClick: function () {
          scene.sectTab = t[0]; scene.sectView = null;
          G.Overlays.openPanel(scene, 'sect', true);
        }
      }));
    });

    /* 取名子视图 */
    if (scene.sectView === 'found') {
      ['青云宗', '问道斋', '不孤峰'].forEach(function (nm, i) {
        btns.push(new G.UI.Btn({
          x: P.x + 14 + i * 128, y: P.y + 108, w: 120, h: 26, small: true, fs: 11,
          variant: i === 0 ? 'gold' : 'default', label: nm,
          onClick: function () {
            var chk = G.Player.canFoundSect(save, G.game.meta);
            var r = G.Player.foundSect(save, G.game.meta, nm, chk.skills && chk.skills[0]);
            G.game.toast(r.ok ? ('开宗立派 —— ' + r.name) : ('无法开宗：' + r.reason));
            scene.sectView = null;
            G.Overlays.openPanel(scene, 'sect', true);
          }
        }));
      });
      btns.push(new G.UI.Btn({
        x: P.x + 14, y: P.y + 184, w: 176, h: 22, small: true, variant: 'ghost',
        label: '返　回',
        onClick: function () { scene.sectView = null; G.Overlays.openPanel(scene, 'sect', true); }
      }));
      return;
    }
    /* 商店子视图（v0.41.0：两列，按钮落在每行右侧；购买索引用全表真实下标，
       不再受 slice 截断影响）。 */
    if (scene.sectView === 'shop') {
      var SH = (G.Data.sects && G.Data.sects.SHOP) || [];
      var SH_COL_W = (P.w - 14 * 2 - 12) / 2;
      SH.forEach(function (it, i) {
        var col = i % 2, row = Math.floor(i / 2);
        var cx = P.x + 14 + col * (SH_COL_W + 12);
        var cy = P.y + 100 + row * 16;
        var can = (save.sectRep || 0) >= it.cost;
        btns.push(new G.UI.Btn({
          x: cx + SH_COL_W - 58, y: cy, w: 58, h: 15, small: true, fs: 9,
          variant: can ? 'gold' : 'ghost',
          label: can ? ('换取 ' + it.cost) : '贡献不足',
          onClick: function () {
            var r = G.Player.buySectItem(save, i);
            G.game.toast(r.ok ? ('得 ' + r.name + ' ×' + r.item.n + '　贡献 -' + r.item.cost)
              : ('无法换取：' + r.reason));
            if (r.ok) G.Overlays.openPanel(scene, 'sect', true);
          }
        }));
      });
      btns.push(new G.UI.Btn({
        x: P.x + 14, y: P.y + 184, w: 176, h: 22, small: true, variant: 'ghost',
        label: '返　回',
        onClick: function () { scene.sectView = null; G.Overlays.openPanel(scene, 'sect', true); }
      }));
      return;
    }

    /* ---- 散修页 ---- */
    if (tab === 'free') {
      var b0 = save.bounty;
      if (b0) {
        var left = G.Player.bountyLeft(save);
        btns.push(new G.UI.Btn({
          x: P.x + P.w - 150, y: P.y + 96, w: 140, h: 22, small: true,
          variant: left > 0 ? 'ghost' : 'gold',
          label: left > 0 ? ('悬赏中（还差 ' + left + '）') : ('领赏 · 灵石 +' + b0.stone),
          onClick: function () {
            var r = G.Player.claimBounty(save);
            G.game.toast(r.ok ? ('悬赏了结 · 灵石 +' + r.stone) : ('无法领赏：' + r.reason));
            if (r.ok) G.Overlays.openPanel(scene, 'sect', true);
          }
        }));
      } else {
        G.Player.BOUNTY.forEach(function (bb, i) {
          btns.push(new G.UI.Btn({
            x: P.x + P.w - 290 + i * 96, y: P.y + 96, w: 90, h: 22, small: true, fs: 9.5,
            variant: 'default', label: bb.n + ' ' + bb.need,
            onClick: function () {
              var r = G.Player.acceptBounty(save, i);
              G.game.toast(r.ok ? ('接下悬赏：' + bb.n + '（斩妖 ' + bb.need + '）')
                : ('无法接单：' + r.reason));
              if (r.ok) G.Overlays.openPanel(scene, 'sect', true);
            }
          }));
        });
      }
      /* 拜入按钮已移至「宗门」子页 */
      return;
    }

    /* ---- 宗门页：未入门 → 本界全部宗门，3 列网格拜入 ---- */
    if (!save.sectId) {
      /* ⚠️ 顺序必须与 `drawSect` 画徽记时一致 → 共用 `sectListOf`（排序的唯一口径） */
      var list2 = sectListOf(G.game.meta);
      var ready2 = G.Player.trialReady(save);
      list2.forEach(function (sc3, i) {
        var col = i % 3, row = Math.floor(i / 3);
        btns.push(new G.UI.Btn({
          x: P.x + 14 + col * (SEC.gridW + SEC.gridGap),
          y: P.y + 96 + row * (SEC.gridH + SEC.gridGapY),
          w: SEC.gridW, h: SEC.gridH, small: true, fs: 10,
          variant: ready2 ? 'default' : 'ghost',
          label: '拜入 ' + sc3.n,
          onClick: function () {
            if (!ready2) { G.game.toast('修为不足（需炼气一重初期），先去历练'); return; }
            scene.clearOverlay();
            G.game.changeScene('battle', {
              script: 'sectTrial', mapId: G.game.sceneName, sectId: sc3.id
            });
          }
        }));
      });
      return;
    }
    if (save.sectId === 'own') {
      var os2 = save.ownSect || { disciples: 0 };
      var full = (os2.disciples || 0) >= G.Player.DISCIPLE_MAX;
      var rich = (save.stone || 0) >= G.Player.DISCIPLE_COST;
      btns.push(new G.UI.Btn({
        x: P.x + 14, y: P.y + 176, w: 150, h: 22, small: true,
        variant: (!full && rich) ? 'gold' : 'ghost',
        label: full ? '弟子已满' : ('收徒 · ' + G.Player.DISCIPLE_COST),
        onClick: function () {
          var r = G.Player.recruitDisciple(save);
          G.game.toast(r.ok ? ('收得弟子一名（共 ' + r.n + '）') : ('无法收徒：' + r.reason));
          if (r.ok) G.Overlays.openPanel(scene, 'sect', true);
        }
      }));
    } else {
      var pool2 = (sectOf(save) && sectOf(save).skills) || [];
      pool2.slice(0, 4).forEach(function (id, i) {
        var sk = G.Data.skills[id];
        if (!sk) return;
        var own = save.skills && save.skills[id];
        var cost = (sk.tier === '灵') ? 150 : 50;
        var can = !(own && !own.voided) && (save.sectRep || 0) >= cost;
        btns.push(new G.UI.Btn({
          x: P.x + P.w - 110, y: P.y + 114 + i * 15, w: 100, h: 15, small: true, fs: 9.5,
          variant: can ? 'gold' : 'ghost',
          label: can ? ('兑换 ' + cost) : '—',
          onClick: function () {
            var r = G.Player.learnSectSkill(save, id);
            G.game.toast(r.ok ? ('习得《' + sk.n + '》　贡献 -' + r.cost) : ('无法兑换：' + r.reason));
            if (r.ok) G.Overlays.openPanel(scene, 'sect', true);
          }
        }));
      });
      var fc = G.Player.canFoundSect(save, G.game.meta);
      btns.push(new G.UI.Btn({
        x: P.x + 14, y: P.y + 176, w: 128, h: 22, small: true,
        variant: fc.ok ? 'gold' : 'ghost',
        label: fc.ok ? '开宗立派' : '开宗立派（未足）',
        onClick: function () {
          var chk = G.Player.canFoundSect(save, G.game.meta);
          if (!chk.ok) { G.game.toast('尚不能开宗：' + chk.reason); return; }
          scene.sectView = 'found';
          G.Overlays.openPanel(scene, 'sect', true);
        }
      }));
    }
    /* 商店 / 退门（两页共用） */
    btns.push(new G.UI.Btn({
      x: P.x + 148, y: P.y + 176, w: 128, h: 22, small: true, variant: 'default',
      label: '门派商店',
      onClick: function () { scene.sectView = 'shop'; G.Overlays.openPanel(scene, 'sect', true); }
    }));
    if (!save.cultSwitchUsed) {
      btns.push(new G.UI.Btn({
        x: P.x + 282, y: P.y + 176, w: 126, h: 22, small: true, variant: 'danger',
        label: '退　门',
        onClick: function () {
          var n = G.Player.switchCult(save, false, null);
          G.Storage.saveCurrent(save);
          G.game.toast('退出门墙　宗门功法废功 ×' + n);
          G.Overlays.openPanel(scene, 'sect', true);
        }
      }));
    }
  }

  /* ============================================================
     地图（v0.15.0 新增）：四界区域导航。
     一屏列全 28 区（4 栏 × 最多 9 行）—— 比"翻页列表"更接近半开放世界的地图观感，
     也不依赖素材。当前所在区域高亮；已到过的区域亮，未至的压暗。
     ============================================================ */
  /* ============================================================
     地图（v0.18.0 改「真地图」）：四界各一张**程序化全貌图**。
     ------------------------------------------------------------
     旧版是"四栏区域列表"（用户口径："现在的地图就是列表，不是真的地图"）。
     新版按《烟雨江湖》的观感做：地形走势（山脉 / 河流 / 林地）+ 区域节点 +
     界门标记，一界一屏。
     ⚠️ 底图**必须预渲染缓存**（每界一张）：上百个山脊 / 河流笔触每帧重画会直接掉帧。
     ⚠️ 地形噪点用**固定种子**（由界 id 派生）—— 用全局 `G.rng` 会每帧都变（画面在闪）。
     ============================================================ */
  var MP = {
    tabY: P.y + 32, tabH: 20, tabW: 64, tabGap: 6,
    vx: P.x + 14, vy: P.y + 58, vw: P.w - 28, vh: P.h - 80
  };
  /* 缩放控件的矩形（**唯一几何来源**）：`buildMap` 建按钮、`drawMap` 的标注层避让都用它。
     三颗 24×16、间距 2，贴在视口右上角内侧。 */
  var MAP_ZOOM_N = 3;
  function mapZoomRect(i) {
    return {
      x: P.x + P.w - 14 - (MAP_ZOOM_N - i) * 26, y: MP.vy + 4, w: 24, h: 16
    };
  }
  function mapZoomBand() {
    return {
      x: P.x + P.w - 14 - MAP_ZOOM_N * 26, y: MP.vy + 4,
      w: MAP_ZOOM_N * 26 - 2, h: 16
    };
  }

  /* ===== 地图视口：缩放与平移（v0.62.0，用户第 6/8 点）=====
     用户口径：「这个地图不支持拖动和放大缩小，而且到达化神境就可以自由传送到各个地图了」。
     约定：
       · `scene.mapZoom` ∈ [1,3]，缺省 1；`scene.mapPan` = 屏幕像素位移（缺省 0,0）。
       · 节点屏幕坐标 = 视口中心 + (mx-0.5)×vw×z + pan。
         ⚠️ z=1 且 pan=0 时它**退化成原来的 `vx + mx*vw`** —— 这是"不改默认观感"的保证，
            也是契约能拿旧坐标对表的前提。
       · pan 必须夹住：|pan| ≤ (z-1)×vw/2，否则能把地图拖出视口，只剩一片空白。 */
  var MAP_ZOOM_MAX = 3;
  function mapZoomOf(scene) {
    var z = (scene && scene.mapZoom) || 1;
    return Math.max(1, Math.min(MAP_ZOOM_MAX, z));
  }
  function mapPanOf(scene) {
    var p = (scene && scene.mapPan) || { x: 0, y: 0 };
    return { x: p.x || 0, y: p.y || 0 };
  }
  function mapClampPan(scene) {
    var z = mapZoomOf(scene), p = scene.mapPan = mapPanOf(scene);
    var lx = (z - 1) * MP.vw / 2, ly = (z - 1) * MP.vh / 2;
    p.x = Math.max(-lx, Math.min(lx, p.x));
    p.y = Math.max(-ly, Math.min(ly, p.y));
  }
  function mapNodePos(scene, r) {
    var z = mapZoomOf(scene), p = mapPanOf(scene);
    return {
      x: MP.vx + MP.vw / 2 + (r.mx - 0.5) * MP.vw * z + p.x,
      y: MP.vy + MP.vh / 2 + (r.my - 0.5) * MP.vh * z + p.y
    };
  }
  /* 视口变换的**逆方向**。绘制走 `x.translate/scale`（原有代码一行不改就自动缩放），
     但**悬浮框与命中判定不经过 ctx**，必须自己换算 —— 少了它，
     放大后提示条会飘到别处、点节点也点不中（都是静默的）。 */
  function mapUnproject(scene, px, py) {
    var V = MP, z = mapZoomOf(scene), p = mapPanOf(scene);
    var ox = V.vx + V.vw / 2, oy = V.vy + V.vh / 2;
    return { x: ox + (px - (ox + p.x)) / z, y: oy + (py - (oy + p.y)) / z };
  }
  var WORLD_ORDER = ['fan', 'ling', 'xian', 'dao'];
  /* 每界的地形配色与密度 —— 决定"这一界长什么样"（用户口径：按地图特色出图，
     冰谷 / 岩石地各有各的样）。程序化版先用配色 + 密度区分；出图后整张替换。 */
  var WORLD_TERRAIN = {
    fan: { land: '#39461f', land2: '#2b3617', ridge: '#55663a', ridgeHi: '#6d7f4a',
      water: '#3f6274', trees: 22, peaks: 26, snow: 0 },
    ling: { land: '#16303a', land2: '#0f232c', ridge: '#2c5060', ridgeHi: '#3f6b7e',
      water: '#2f7d9c', trees: 12, peaks: 30, snow: 0.5 },
    xian: { land: '#2c2846', land2: '#201d36', ridge: '#544c74', ridgeHi: '#7a6fa0',
      water: '#4a6a8a', trees: 6, peaks: 34, snow: 0.7 },
    dao: { land: '#1c1234', land2: '#120b24', ridge: '#3a2a5c', ridgeHi: '#5a4488',
      water: '#2a2050', trees: 3, peaks: 20, snow: 0.2 }
  };

  /* 世界地图底图（预渲染缓存，键带界 id 与像素尺寸） */
  var mapBg = {};
  /* ===== 地图地貌：**按区域地形画**（v0.64.0，用户第 14 点）=====
     用户口径：「这个地图和这些地面完全不是一个风格，没有区分谷、峰、平原、山地、草原、河流、
                岛屿等等，凡界是一块大陆，有很多区域，需要重新设计」。
     旧版是"在整个界里随机撒山"，所以每个区域看起来一模一样。
     新版：每个区域在 data/regions.js 里带一个 terr 字段（峰 / 山地 / 谷 / 平原 / 洞窟 / 矿 /
     荒冢 / 熔岩谷 / 水 / 沼泽 / 荒漠 / 遗迹 / 宫阙 / 园囿 / 台 / 虚空），底图在它的坐标附近
     **画出对应的地貌**；凡界再叠**大陆级的草原带 / 主河道与支流 / 东南海岛**。
     ⚠️ 新增一种 terr 必须同时往 TERR_DRAW 加分支 —— 漏了会**静默画成空白**
        （契约 map.terrain.contract 用源码闸钉住"用到的 terr 都有分支"）。 */

  /* 地貌原语：两个就够（三角 = 山、簇 = 成片点） */
  function terrTri(x, cx, cy, w, h, col, a) {
    x.globalAlpha = a; x.fillStyle = col;
    x.beginPath();
    x.moveTo(cx - w, cy + h); x.lineTo(cx, cy - h); x.lineTo(cx + w, cy + h);
    x.closePath(); x.fill();
    x.globalAlpha = 1;
  }
  function terrDots(x, cx, cy, n, spread, r, col, a, rnd) {
    x.globalAlpha = a; x.fillStyle = col;
    for (var i = 0; i < n; i++) {
      x.beginPath();
      x.arc(cx + (rnd() - 0.5) * spread, cy + (rnd() - 0.5) * spread * 0.72, r, 0, 6.2832);
      x.fill();
    }
    x.globalAlpha = 1;
  }

  var TERR_DRAW = {
    /* 峰：一组高而尖的山（中间主峰最高），带雪线 */
    peak: function (x, cx, cy, T2, rnd) {
      terrTri(x, cx - 26, cy + 8, 22, 26, T2.ridge, 0.44);
      terrTri(x, cx + 25, cy + 10, 19, 22, T2.ridge, 0.40);
      terrTri(x, cx, cy, 28, 40, T2.ridgeHi, 0.50);
      terrTri(x, cx, cy + 6, 10, 18, 'rgba(226,238,255,0.85)', 0.55);
    },
    /* 山地 / 岭：连绵矮脊，比峰低而宽 */
    ridge: function (x, cx, cy, T2, rnd) {
      for (var i = -2; i <= 2; i++) {
        terrTri(x, cx + i * 19, cy + 6 + (i % 2 ? 5 : 0), 14, 14, T2.ridge, 0.38);
      }
    },
    /* 谷：两侧夹山、中间一条暗色低地 */
    valley: function (x, cx, cy, T2, rnd) {
      x.globalAlpha = 0.24; x.fillStyle = T2.land2;
      x.beginPath(); x.ellipse(cx, cy, 40, 17, 0, 0, 6.2832); x.fill();
      x.globalAlpha = 1;
      terrTri(x, cx - 34, cy - 4, 17, 23, T2.ridge, 0.42);
      terrTri(x, cx + 34, cy + 5, 17, 23, T2.ridge, 0.42);
      terrTri(x, cx, cy + 24, 13, 16, T2.ridgeHi, 0.30);
    },
    /* 平原：田垄细纹 + 一座小丘（与"草原"的区别是**有垄**、几乎无草点） */
    plain: function (x, cx, cy, T2, rnd) {
      x.globalAlpha = 0.15; x.strokeStyle = T2.ridgeHi; x.lineWidth = 1;
      for (var i = -2; i <= 2; i++) {
        x.beginPath();
        x.moveTo(cx - 40, cy + i * 7); x.lineTo(cx + 40, cy + i * 7 - 4);
        x.stroke();
      }
      x.globalAlpha = 1;
      terrTri(x, cx + 34, cy - 14, 11, 8, T2.ridge, 0.26);
    },
    /* 草原：成片草点，无垄无山 */
    grass: function (x, cx, cy, T2, rnd) {
      terrDots(x, cx, cy, 34, 80, 1.4, T2.ridgeHi, 0.34, rnd);
    },
    /* 洞窟：一整块山体 + 一个暗色洞口 */
    cave: function (x, cx, cy, T2, rnd) {
      terrTri(x, cx, cy, 28, 32, T2.ridge, 0.50);
      x.globalAlpha = 0.9; x.fillStyle = '#0a0d12';
      x.beginPath(); x.arc(cx, cy + 15, 8, Math.PI, 0); x.fill();
      x.globalAlpha = 1;
    },
    /* 矿：山体 + 坑口 + 矿渣点 */
    mine: function (x, cx, cy, T2, rnd) {
      terrTri(x, cx - 10, cy, 24, 24, T2.ridge, 0.46);
      x.globalAlpha = 0.75; x.fillStyle = '#0a0d12';
      x.beginPath(); x.arc(cx + 14, cy + 12, 5, 0, 6.2832); x.fill();
      x.globalAlpha = 1;
      terrDots(x, cx + 18, cy + 14, 12, 34, 1.7, 'rgba(214,190,140,0.9)', 0.45, rnd);
    },
    /* 荒冢：稀疏土丘 + 枯树杆 */
    moor: function (x, cx, cy, T2, rnd) {
      terrDots(x, cx, cy, 12, 70, 3.2, T2.ridge, 0.24, rnd);
      x.globalAlpha = 0.36; x.strokeStyle = '#2a2a24'; x.lineWidth = 1.4;
      for (var i = 0; i < 5; i++) {
        var tx = cx + (rnd() - 0.5) * 64, ty = cy + (rnd() - 0.5) * 42;
        x.beginPath(); x.moveTo(tx, ty + 7); x.lineTo(tx, ty - 5); x.stroke();
      }
      x.globalAlpha = 1;
    },
    /* 熔岩谷：暗红底 + 熔缝 + 侧山 */
    lava: function (x, cx, cy, T2, rnd) {
      x.globalAlpha = 0.32; x.fillStyle = '#3a1c14';
      x.beginPath(); x.arc(cx, cy, 38, 0, 6.2832); x.fill();
      x.globalAlpha = 1;
      terrTri(x, cx - 30, cy - 10, 15, 19, T2.ridge, 0.42);
      x.globalAlpha = 0.75; x.strokeStyle = '#e2762e'; x.lineWidth = 2;
      x.beginPath(); x.moveTo(cx - 32, cy + 6);
      x.quadraticCurveTo(cx, cy - 13, cx + 32, cy + 4); x.stroke();
      x.globalAlpha = 1;
    },
    /* 水：湖 / 海 —— 水面 + 三道波纹 */
    water: function (x, cx, cy, T2, rnd) {
      x.globalAlpha = 0.42; x.fillStyle = T2.water;
      x.beginPath(); x.arc(cx, cy, 38, 0, 6.2832); x.fill();
      x.globalAlpha = 0.55; x.strokeStyle = 'rgba(226,240,255,0.75)'; x.lineWidth = 1.2;
      for (var i = 0; i < 3; i++) {
        x.beginPath();
        x.moveTo(cx - 21 + i * 6, cy - 8 + i * 8);
        x.quadraticCurveTo(cx, cy - 13 + i * 8, cx + 21 - i * 6, cy - 8 + i * 8);
        x.stroke();
      }
      x.globalAlpha = 1;
    },
    /* 沼泽：水面 + 芦苇点 */
    marsh: function (x, cx, cy, T2, rnd) {
      TERR_DRAW.water(x, cx, cy, T2, rnd);
      terrDots(x, cx, cy, 16, 70, 1.6, '#4a5a34', 0.45, rnd);
    },
    /* 荒漠：沙丘弧 + 碎石 */
    desert: function (x, cx, cy, T2, rnd) {
      x.globalAlpha = 0.26; x.fillStyle = '#c9ae74';
      x.beginPath(); x.arc(cx, cy + 8, 40, Math.PI, 0); x.fill();
      x.globalAlpha = 1;
      terrDots(x, cx, cy + 12, 10, 64, 1.6, '#8a7448', 0.40, rnd);
    },
    /* 遗迹：地基 + 断柱 */
    ruin: function (x, cx, cy, T2, rnd) {
      x.globalAlpha = 0.30; x.fillStyle = T2.ridge;
      x.fillRect(cx - 32, cy + 10, 64, 5);
      x.globalAlpha = 0.5;
      for (var i = -2; i <= 2; i++) {
        if (i === 0) continue;
        var hh = (i % 2) ? 20 : 14;
        x.fillRect(cx + i * 14 - 2, cy + 10 - hh, 5, hh);
      }
      x.globalAlpha = 1;
    },
    /* 宫阙：三层台基 + 檐柱 */
    palace: function (x, cx, cy, T2, rnd) {
      x.globalAlpha = 0.42; x.fillStyle = T2.ridgeHi;
      for (var i = 0; i < 3; i++) {
        var w2 = 38 - i * 9;
        x.fillRect(cx - w2, cy + 10 - i * 9, w2 * 2, 6);
      }
      x.globalAlpha = 0.6; x.fillStyle = '#e6d6a2';
      x.fillRect(cx - 4, cy - 20, 8, 14);
      x.globalAlpha = 1;
    },
    /* 园囿：花木点簇 + 一圈矮栏 */
    garden: function (x, cx, cy, T2, rnd) {
      terrDots(x, cx, cy, 30, 72, 2.1, 'rgba(228,196,208,0.85)', 0.42, rnd);
      x.globalAlpha = 0.26; x.strokeStyle = T2.ridgeHi; x.lineWidth = 1.2;
      x.beginPath(); x.arc(cx, cy, 36, 0, 6.2832); x.stroke();
      x.globalAlpha = 1;
    },
    /* 台：一方高台 + 四角短柱 */
    platform: function (x, cx, cy, T2, rnd) {
      x.globalAlpha = 0.40; x.fillStyle = T2.ridge;
      x.fillRect(cx - 32, cy - 6, 64, 21);
      x.globalAlpha = 0.55; x.fillStyle = T2.ridgeHi;
      for (var i = -1; i <= 1; i += 2) {
        x.fillRect(cx + i * 28 - 2, cy - 16, 4, 12);
        x.fillRect(cx + i * 28 - 2, cy + 13, 4, 12);
      }
      x.globalAlpha = 1;
    },
    /* 虚空：更深的暗 + 星点 */
    void: function (x, cx, cy, T2, rnd) {
      x.globalAlpha = 0.5; x.fillStyle = 'rgba(8,6,14,0.9)';
      x.beginPath(); x.arc(cx, cy, 44, 0, 6.2832); x.fill();
      x.globalAlpha = 1;
      terrDots(x, cx, cy, 18, 78, 1, 'rgba(226,238,255,0.9)', 0.6, rnd);
    }
  };

  /* 凡界的**大陆级特征**（v0.64.0）：草原带 / 主河道与支流 / 东南海岛。
     为什么抽成具名函数而不是内联一段：契约 `map.terrain.contract` 要能"看见"这三样真的被画了 ——
     内联时源码闸只能去找颜色字面量（改个色号就绕过）。具名之后，闸查的是**调用**。
     ⚠️ 这三样**不属于任何区域节点** —— 用户要的"凡界是一块大陆"靠它们成立，
        只画区域地貌的话，整张图会是一堆孤立的小图案。 */
  function fanGrass(x, wpx, hpx, rnd) {
    var midR = Math.min(wpx, hpx) * 0.34;
    x.globalAlpha = 0.30; x.fillStyle = '#4e6a34';
    x.beginPath(); x.arc(wpx * 0.56, hpx * 0.52, midR, 0, 6.2832); x.fill();
    x.globalAlpha = 1;
    terrDots(x, wpx * 0.56, hpx * 0.52, 90, midR * 1.8, 1.3, '#6f8c46', 0.36, rnd);
  }
  function fanRiver(x, wpx, hpx, T) {
    x.strokeStyle = T.water; x.lineCap = 'round';
    x.globalAlpha = 0.9; x.lineWidth = 4.4;
    x.beginPath();
    x.moveTo(wpx * 0.04, hpx * 0.16);
    x.bezierCurveTo(wpx * 0.30, hpx * 0.40, wpx * 0.44, hpx * 0.52, wpx * 0.62, hpx * 0.72);
    x.bezierCurveTo(wpx * 0.74, hpx * 0.86, wpx * 0.86, hpx * 0.94, wpx * 1.03, hpx * 1.03);
    x.stroke();
    /* 两条支流：一条往东北、一条往东南，让水系看起来是从山里流出去的 */
    x.lineWidth = 2.0; x.globalAlpha = 0.68;
    x.beginPath();
    x.moveTo(wpx * 0.30, hpx * 0.40);
    x.quadraticCurveTo(wpx * 0.40, hpx * 0.30, wpx * 0.56, hpx * 0.28);
    x.stroke();
    x.beginPath();
    x.moveTo(wpx * 0.62, hpx * 0.72);
    x.quadraticCurveTo(wpx * 0.74, hpx * 0.62, wpx * 0.90, hpx * 0.60);
    x.stroke();
    x.globalAlpha = 1;
  }
  function fanIsles(x, wpx, hpx, T, rnd) {
    [[0.86, 0.87, 20], [0.95, 0.74, 13], [0.78, 0.95, 11]].forEach(function (isl) {
      var ix = wpx * isl[0], iy = hpx * isl[1];
      x.globalAlpha = 0.42; x.fillStyle = T.water;
      x.beginPath(); x.arc(ix, iy, isl[2] * 1.5, 0, 6.2832); x.fill();
      x.globalAlpha = 0.58; x.fillStyle = T.land;
      x.beginPath(); x.arc(ix, iy, isl[2] * 0.72, 0, 6.2832); x.fill();
      x.globalAlpha = 1;
      terrDots(x, ix, iy, 5, isl[2] * 1.1, 1.5, '#6f8c46', 0.45, rnd);
    });
  }

  function worldMapBg(w, wpx, hpx) {
    var key = w + '|' + wpx + 'x' + hpx;
    if (mapBg[key]) return mapBg[key];
    var T = WORLD_TERRAIN[w] || WORLD_TERRAIN.fan;
    var o = G.Art.cv(wpx, hpx), x = o.x;
    /* 固定种子：同一界每次生成完全一样（截图与契约才钉得住） */
    var rnd = G.Art.rnd(w.charCodeAt(0) * 7919 + w.length * 131);
    var list = (G.Data.regions && G.Data.regions.of) ? (G.Data.regions.of(w) || []) : [];

    /* ① 底：三段渐变（上远山、中平原、下近地） */
    var g = x.createLinearGradient(0, 0, 0, hpx);
    g.addColorStop(0, T.land2);
    g.addColorStop(0.42, T.land);
    g.addColorStop(1, T.land2);
    x.fillStyle = g; x.fillRect(0, 0, wpx, hpx);

    /* ② 大陆级特征（**与区域节点无关**）—— 用户要的"凡界是一块大陆"靠这一段成立：
          草原带 / 主河道与两条支流 / 东南海岛。
          ⚠️ 这一段只给凡界；灵 / 仙 / 道是浮空屿与宫阙，套"大陆"反而怪。 */
    if (w === 'fan') {
      fanGrass(x, wpx, hpx, rnd);
      fanRiver(x, wpx, hpx, T);
      fanIsles(x, wpx, hpx, T, rnd);
    } else {
      /* 其余界保留"山系 + 横贯水脉"的观感（它们本来就是浮空屿 / 宫阙） */
      var groups = Math.max(3, Math.round(T.peaks / 4));
      for (var gi = 0; gi < groups; gi++) {
        var gx = rnd() * wpx, gy = hpx * (0.12 + rnd() * 0.72);
        var cnt = 3 + Math.floor(rnd() * 3);
        for (var k = 0; k < cnt; k++) {
          var mw = 9 + rnd() * 22, mh = 6 + rnd() * 15;
          terrTri(x, gx + (k - cnt / 2) * (mw * 0.85) + (rnd() - 0.5) * 8,
            gy + (rnd() - 0.5) * 10, mw, mh, T.ridge, 0.30 + rnd() * 0.24);
        }
      }
      x.strokeStyle = T.water; x.lineCap = 'round'; x.globalAlpha = 0.85;
      for (var r2 = 0; r2 < 2; r2++) {
        var ry0 = hpx * (0.34 + r2 * 0.30) + (rnd() - 0.5) * 12;
        x.lineWidth = 3.6 - r2 * 0.8;
        x.beginPath(); x.moveTo(-8, ry0);
        for (var sx0 = -8; sx0 <= wpx + 8; sx0 += 56) {
          x.quadraticCurveTo(sx0 + 28, ry0 + (rnd() - 0.5) * 40, sx0 + 56, ry0 + (rnd() - 0.5) * 26);
        }
        x.stroke();
      }
      x.globalAlpha = 1;
    }

    /* ③ **按区域地形画地貌** —— v0.64.0 的核心改动（旧版是随机撒山，所以每个区域长得一样） */
    list.forEach(function (r) {
      var fn = TERR_DRAW[r.terr];
      if (!fn) return;
      fn(x, r.mx * wpx, r.my * hpx, T, rnd);
    });

    /* ④ 暗角：四边压暗，把视线收进画面中间 */
    var vg = x.createRadialGradient(wpx / 2, hpx / 2, Math.min(wpx, hpx) * 0.35,
      wpx / 2, hpx / 2, Math.max(wpx, hpx) * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.42)');
    x.fillStyle = vg; x.fillRect(0, 0, wpx, hpx);

    mapBg[key] = o.c;
    return o.c;
  }

  /* 界的可见性 / 可点性（v0.18.0，用户口径）：
     · 凡界：永远可点；
     · 灵界：**可见但未飞升就置灰**（"表示灵界地图置灰无法点击"）；
     · 仙界：**到过灵界才出现**（没到过则整栏隐藏）；
     · 道界：**地狱难度通关仙界才出现**。
     ⚠️ "隐藏"与"置灰"是两件事：隐藏 = 玩家不知道它存在（仙界 / 道界）；
     置灰 = 知道但去不了（灵界）。两套判据分开写，别合成一个 ——
     合成之后"该藏起来的界"会以灰按钮的形式提前泄底。 */
  function worldGate(meta, w) {
    var p = (meta && meta.progress) || {};
    var ws = p.worlds || {};
    var hell = (meta && meta.hellCleared) || {};
    if (w === 'fan') return { show: true, ok: true };
    if (w === 'ling') return { show: true, ok: !!ws.ling };
    if (w === 'xian') return { show: !!ws.ling, ok: !!ws.xian };
    if (w === 'dao') return { show: !!(ws.xian && (p.daoKey || hell.xian)), ok: !!ws.dao };
    return { show: false, ok: false };
  }

  /* 当前该看哪一界：选了看不了的界就退回凡界（别让"隐藏"的界被选中） */
  function mapWorldOf(scene, meta) {
    var w = scene.mapWorld || G.Player.activeWorldId(meta);
    var g = worldGate(meta, w);
    if (!g.show || !g.ok) w = 'fan';
    scene.mapWorld = w;
    return w;
  }

  /* 地图节点悬浮说明（v0.41.0）—— 用户口径：「鼠标放到这些地点名称上面要有悬浮说明，
     这些地方是否存在宗门、副本、境界信息、野怪信息、界门信息等等」。
     **全部从已有数据拼**，不新造字段：
       · 境界 / 野怪 ← 区域的 `zones`（野怪等级区间 + 种群）
       · 宗门        ← `G.Data.sects.ofWorld(w)` 按 region 过滤
       · 秘境        ← `save.entrances[w]`（落位表）
       · 界门        ← 区域的 `gate`
       · 是否到访    ← `save.visited` */
  function mapNodeInfo(r, save, meta, w, visited) {
    var L = [];
    var z = (r.zones || [])[0];
    if (z && z.enc) {
      var ra = G.Player.realmInfo ? G.Player.realmInfo(z.enc.min) : null;
      var rb = G.Player.realmInfo ? G.Player.realmInfo(z.enc.max) : null;
      L.push('境界　' + (ra ? ra.n : ('L' + z.enc.min))
        + (z.enc.max !== z.enc.min ? (' ~ ' + (rb ? rb.n : ('L' + z.enc.max))) : ''));
      var sp = Object.keys(z.sp || {});
      if (sp.length) L.push('野怪　' + sp.join(' · '));
    } else {
      L.push('境界　安全区（无野怪）');
    }
    var sc = (G.Data.sects ? G.Data.sects.ofWorld(w) : []).filter(function (x) {
      return x.region === r.id;
    });
    L.push('宗门　' + (sc.length ? sc.map(function (x) { return x.n; }).join(' · ') : '无'));
    var ent = (save.entrances && save.entrances[w]) || [];
    var mine = ent.filter(function (e) { return e.region === r.id; });
    L.push('秘境　' + (mine.length ? ('有入口 ×' + mine.length) : '无'));
    L.push('界门　' + (r.gate ? '有' : '无'));
    L.push(visited[r.id] ? '已到访' : '未曾至');
    return { title: r.n + '　' + (r.theme || ''), text: L.join('\n') };
  }

  /* ============================================================
     多层仙云（v0.54.0，对标《烟雨江湖》卷轴云雾）——
     2~3 层透明云整层 drawImage，横向漂移、速度不同（近快远慢）、绕回无缝；
     仙界云最厚最快、道界最慢最淡、凡界薄雾。时间源一律 G.game.time（截图可钉）。
     ============================================================ */
  var CLOUD_CFG = {
    fan: [
      { k: 'cloud.4', sp: 6, a: 0.26, y: 0.66, s: 1.15 },
      { k: 'cloud.1', sp: 9, a: 0.26, y: 0.16, s: 1.0 },
      { k: 'cloud.2', sp: 13, a: 0.22, y: 0.36, s: 0.8 }
    ],
    ling: [
      { k: 'cloud.1', sp: 8, a: 0.28, y: 0.12, s: 1.05 },
      { k: 'cloud.2', sp: 14, a: 0.26, y: 0.3, s: 0.9 },
      { k: 'cloud.4', sp: 9, a: 0.26, y: 0.66, s: 1.2 }
    ],
    xian: [
      { k: 'cloud.2', sp: 16, a: 0.28, y: 0.2, s: 1.0 },
      { k: 'cloud.3', sp: 24, a: 0.6, y: 0.44, s: 1.0 },
      { k: 'cloud.4', sp: 12, a: 0.28, y: 0.7, s: 1.25 }
    ],
    dao: [
      { k: 'cloud.1', sp: 5, a: 0.22, y: 0.2, s: 1.1 },
      { k: 'cloud.3', sp: 7, a: 0.36, y: 0.42, s: 1.05 }
    ]
  };
  function drawMapClouds(x, w, V) {
    var cfg = CLOUD_CFG[w];
    if (!cfg) return;
    var time = (G.game && G.game.time) || 0;
    x.save();
    x.beginPath();
    x.rect(V.vx, V.vy, V.vw, V.vh);
    x.clip();
    for (var i = 0; i < cfg.length; i++) {
      var c = cfg[i];
      var img = G.Assets.img(c.k);
      if (!img) continue;
      var dw = V.vw * c.s;
      var dh = dw * (img.height / img.width);
      var yy = V.vy + c.y * V.vh - dh * 0.5;
      var period = dw;
      var off = (time * c.sp) % period;
      x.globalAlpha = c.a;
      for (var px2 = V.vx - off; px2 < V.vx + V.vw; px2 += period) {
        x.drawImage(img, px2, yy, dw, dh);
      }
    }
    x.restore();
  }

  function drawMap(x, scene) {
    var save = G.game.save, meta = G.game.meta || {};
    var Rg = G.Data.regions;
    var cur = Rg.regionIdOf ? Rg.regionIdOf(save.map) : null;
    var visited = save.visited || {};
    var w = mapWorldOf(scene, meta);
    var list = Rg.of(w) || [];
    shell(x, '地图', Rg.worldNames[w] || '');

    /* 视口（v0.62.0 起带缩放/平移）。
       ⚠️ 手法：把**整层地图**放进一个 ctx 变换里（clip 到视口 → 平移到中心+pan →
          scale(z) → 把原点挪回视口左上）。这样底下"节点/连线/界门/名字"的既有代码
          **一行都不用改**就自动跟着缩放 —— 比逐处乘 z 安全得多（漏一处就飘）。 */
    var V = MP, Z = mapZoomOf(scene), PAN = mapPanOf(scene);
    x.save();
    x.beginPath(); x.rect(V.vx, V.vy, V.vw, V.vh); x.clip();
    x.translate(V.vx + V.vw / 2 + PAN.x, V.vy + V.vh / 2 + PAN.y);
    x.scale(Z, Z);
    x.translate(-(V.vx + V.vw / 2), -(V.vy + V.vh / 2));

    var mapScrollImg = G.Assets.img('mapscroll.' + w);
    if (mapScrollImg) {
      x.drawImage(mapScrollImg, V.vx, V.vy, V.vw, V.vh);
    } else {
      x.drawImage(worldMapBg(w, Math.round(V.vw), Math.round(V.vh)),
        V.vx, V.vy, V.vw, V.vh);
    }
    G.UI.rr(x, { x: V.vx + 0.5, y: V.vy + 0.5, w: V.vw - 1, h: V.vh - 1 }, 4);
    x.strokeStyle = 'rgba(158,206,246,0.42)';
    x.lineWidth = 1; x.stroke();

    /* ===== 地图精细化（v0.31.0，对标《烟雨江湖》）=====
       用户口径：「这个地图可以精细化一点，看看烟雨江湖的地图」。
       底图（山系/河流/林地）本来就有，缺的是**地图该有的"读图元素"**：
        ① **道路连线**：把相距较近的区域用虚线连起来 —— 一眼看得出"哪几处挨着"，
           而不是一堆孤立的圆点（这正是"粗糙"的主要来源）。
        ② **云雾留白**：沿视口边缘压几团半透明的云，让画面有"卷轴未展"的呼吸感。
       ⚠️ 都走**固定种子**：同一界每次生成完全一样（换机/重开不会变），
          截图与契约才钉得住。 */
    var rndM = G.Art.rnd(w.charCodeAt(0) * 3571 + list.length * 977);
    x.save();
    x.strokeStyle = 'rgba(226,236,252,0.20)';
    x.lineWidth = 1.2;
    x.setLineDash([3, 4]);
    for (var ai = 0; ai < list.length; ai++) {
      for (var bi = ai + 1; bi < list.length; bi++) {
        var ax = list[ai].mx, ay = list[ai].my;
        var bx2 = list[bi].mx, by2 = list[bi].my;
        var dd = Math.hypot((ax - bx2) * V.vw, (ay - by2) * V.vh);
        if (dd > 150) continue;                  /* 太远的不是"相邻" */
        x.beginPath();
        x.moveTo(V.vx + ax * V.vw, V.vy + ay * V.vh);
        x.lineTo(V.vx + bx2 * V.vw, V.vy + by2 * V.vh);
        x.stroke();
      }
    }
    x.setLineDash([]);
    drawMapClouds(x, w, V);
    x.restore();

    /* 区域节点 */
    list.forEach(function (r) {
      var nx = V.vx + r.mx * V.vw, ny = V.vy + r.my * V.vh;
      var isCur = r.id === cur;
      var seen = isCur || !!visited[r.id];
      if (isCur) {
        x.strokeStyle = 'rgba(245,227,168,0.85)';
        x.lineWidth = 1.4;
        x.beginPath(); x.arc(nx, ny, 7, 0, 6.2832); x.stroke();
        x.fillStyle = '#f5e3a8';
        x.beginPath(); x.arc(nx, ny, 3.4, 0, 6.2832); x.fill();
      } else if (seen) {
        x.fillStyle = 'rgba(226,236,252,0.92)';
        x.beginPath(); x.arc(nx, ny, 2.6, 0, 6.2832); x.fill();
      } else {
        x.strokeStyle = 'rgba(150,168,196,0.7)';
        x.lineWidth = 1;
        x.beginPath(); x.arc(nx, ny, 2.6, 0, 6.2832); x.stroke();
      }
      /* 界门标记：节点上方一个菱形（与"区域"本身区分开） */
      if (r.gate) {
        x.fillStyle = '#8fd8f0';
        x.beginPath();
        x.moveTo(nx, ny - 12); x.lineTo(nx + 3.6, ny - 8.2);
        x.lineTo(nx, ny - 4.4); x.lineTo(nx - 3.6, ny - 8.2);
        x.closePath(); x.fill();
      }
      /* 悬浮说明：鼠标落在**节点或它的名字**上就弹（v0.41.0）。
         ⚠️ 命中框要盖住"节点 + 名字"两块，只盖节点的话移到名字上就没了（很难用）。 */
      if (G.UI.hover) {
        /* ⚠️ 悬浮框不走 ctx，必须自己换算到**屏幕坐标**（`mapNodePos`）。
           而且框的尺寸要**固定**（44×34）—— 跟着 Z 放大会让提示条盖住半个视口。 */
        var np = mapNodePos(scene, r);
        G.UI.hover({ x: np.x - 22, y: np.y - 14, w: 44, h: 34 },
          mapNodeInfo(r, save, meta, w, visited));
      }
      /* 名字**不在这里画** —— 见下面"标注层"的说明（要在视口变换之外、用屏幕坐标画）。 */
    });

    /* 地图层结束：把视口变换还原（图例与提示必须在**未缩放**的屏幕坐标里画） */
    x.restore();

    /* ===== 标注层（v0.62.0）=====
       区域名**必须画在视口变换之外**，两个理由：
        ① 文字是"标注"不是"位置"：跟着 Z 放大会把地图本身盖掉（3 倍时「赤牙洞」撑满半屏）；
        ② 契约的文字探针**不认 ctx 变换**（它只记 `fillText` 的实参）——
           在变换里 translate 到别处再画，探针看到的是 (0,0)，直接判"越界"。
       所以这里用 `mapNodePos`（正变换）算出屏幕坐标，再按屏幕坐标画与夹取。 */
    list.forEach(function (r) {
      var isCur = r.id === cur;
      var seen = isCur || !!visited[r.id];
      var np = mapNodePos(scene, r);
      /* 视口外不画（否则会盖到面板外框与底栏上）；
         **缩放控件底下也不画** —— 按钮是后画的框，压住先画的字就是"框盖字"（契约会报）。 */
      var zb = mapZoomBand();
      var labelW = 34;
      if (np.x < V.vx - 4 || np.x > V.vx + V.vw + 4
        || np.y < V.vy - 4 || np.y > V.vy + V.vh + 4) return;
      if (np.x + labelW / 2 > zb.x && np.x - labelW / 2 < zb.x + zb.w
        && np.y + 13 > zb.y && np.y - 4 < zb.y + zb.h) return;
      var fs = isCur ? 10.5 : 9.5;
      x.font = G.UI.F(fs);
      var tw = x.measureText(r.n).width;
      var lx = Math.max(V.vx + tw / 2 + 1, Math.min(V.vx + V.vw - tw / 2 - 1, np.x));
      var ly = Math.max(V.vy + 2, Math.min(V.vy + V.vh - 13, np.y + 5));
      G.UI.textOut(x, { x: lx, y: ly }, r.n, fs,
        isCur ? G.UI.C.goldHi : (seen ? 'rgba(228,236,248,0.95)' : 'rgba(140,152,176,0.9)'),
        'center', 'rgba(6,10,20,0.9)', 2.2);
    });

    /* 图例 + "还没现世"的界提示（v0.62.0 补上新的操作口径） */
    var hint = '拖拽平移 · ＋/− 缩放 · 点节点传送（化神境起）';
    if (!worldGate(meta, 'xian').show) hint += '　仙界未现';
    else if (!worldGate(meta, 'dao').show) hint += '　道界未现';
    G.UI.text(x, { x: P.x + 14, y: P.y + P.h - 18 }, hint, 9.5, G.UI.C.textDim);
  }

  function buildMap(btns, scene) {
    var meta = G.game.meta || {};
    var Rg = G.Data.regions;
    var cur = mapWorldOf(scene, meta);
    /* 缩放控件（v0.62.0）：贴在视口右上角内侧。
       ⚠️ 用**按钮**而不是滚轮 / 双指 —— 无头契约点得到、触屏也好按；
          滚轮与双指只有真机验证得了，契约覆盖不到（"没人验"= 迟早坏）。 */
    [['＋', 1], ['－', -1], ['复位', 0]].forEach(function (zb2, i) {
      var r2 = mapZoomRect(i);
      btns.push(new G.UI.Btn({
        x: r2.x, y: r2.y, w: r2.w, h: r2.h, small: true, fs: 9.5,
        variant: 'ghost', label: zb2[0],
        onClick: function () {
          if (zb2[1] === 0) { scene.mapZoom = 1; scene.mapPan = { x: 0, y: 0 }; }
          else {
            /* ⚠️ **在写入时就夹**，不要只在读取时夹（`mapZoomOf`）——
               否则 `scene.mapZoom` 会一路涨到 4、5、6，契约读到的原始值超出范围，
               而且"再点 ＋ 没反应"这种事只有靠原始值才看得出来。 */
            scene.mapZoom = Math.max(1, Math.min(MAP_ZOOM_MAX, mapZoomOf(scene) + zb2[1]));
            mapClampPan(scene);
          }
          G.Overlays.openPanel(scene, 'map', true);
        }
      }));
    });
    /* 只给**可见**的界建按钮（隐藏 = 玩家不知道它存在，不该以灰按钮的形式泄底） */
    var show = WORLD_ORDER.filter(function (w) { return worldGate(meta, w).show; });
    var total = show.length * MP.tabW + (show.length - 1) * MP.tabGap;
    var x0 = P.x + (P.w - total) / 2;
    show.forEach(function (w, i) {
      var gt = worldGate(meta, w);
      btns.push(new G.UI.Btn({
        x: Math.round(x0 + i * (MP.tabW + MP.tabGap)), y: MP.tabY,
        w: MP.tabW, h: MP.tabH, small: true,
        variant: 'subtab', active: cur === w, disabled: !gt.ok,
        label: Rg.worldNames[w],
        onClick: function () {
          scene.mapWorld = w;
          G.Overlays.openPanel(scene, 'map');
        }
      }));
    });
  }
  /* ============================================================
     兽栏 · 灵兽园（《灵兽 v1.1》§5/§6/§8）
     左列个体名册，右列选中个体详情；底部喂养 / 化形 / 出战 / 骑乘 / 放生。
     空兽栏给诚实空状态，不画假格子。
     ============================================================ */
  var BS = {
    lx: P.x + 12, lw: 150, ly: 58, rowH: 16,
    dx: P.x + 12 + 150 + 14, dy: 56,
    dw: (P.x + P.w - 12) - (P.x + 12 + 150 + 14),
    aY: 202, aH: 16
  };
  function beastSelOf(scene, save) {
    var cur = G.Beasts.byUid(save, scene.beastSel);
    if (!cur) { cur = save.beasts[0] || null; scene.beastSel = cur ? cur.uid : null; }
    return cur;
  }
  function realmN(gl) { var i = G.Player.realmInfo(gl); return i ? i.n : ('' + gl); }
  function roleTag(beast) {
    var t = [];
    if (G.Data.beasts.canBattle(beast.id)) t.push('战');
    if (G.Data.beasts.canRideSpecies(beast.id)) t.push('骑');
    return t.join('/') || '宠';
  }
  function drawBeasts(x, scene) {
    var save = G.game.save;
    shell(x, '兽栏 · 灵兽园', '第 ' + (save.life || 1) + ' 世 · ' + save.beasts.length + '/' + G.Data.beasts.CAP);

    if (!save.beasts.length) {
      G.UI.text(x, { x: BS.lx, y: 110 }, '兽栏空空，尚无灵兽相伴。', 12, G.UI.C.textDim);
      G.UI.text(x, { x: BS.lx, y: 130 }, '可寻药铺沈伯结缘，或以御兽索在野外驯服。', 11, G.UI.C.textDim);
      return;
    }

    /* 左：名册 */
    G.UI.panel(x, { x: BS.lx - 6, y: BS.ly - 6, w: BS.lw + 12, h: BS.rowH * Math.min(8, save.beasts.length) + 12 },
      G.UI.C.panelDark, G.UI.C.rule, 4, { tex: false, shadow: false });
    save.beasts.slice(0, 8).forEach(function (b, i) {
      var ry = BS.ly + i * BS.rowH;
      var sel = scene.beastSel === b.uid;
      if (sel) G.UI.panel(x, { x: BS.lx - 4, y: ry, w: BS.lw + 8, h: BS.rowH - 1 },
        'rgba(92,124,150,0.28)', null, 3, { tex: false, shadow: false });
      G.UI.text(x, { x: BS.lx, y: ry + 3 }, b.name, 11, sel ? G.UI.C.goldHi : G.UI.C.text);
      G.UI.text(x, { x: BS.lx + 56, y: ry + 4 }, realmN(b.gl), 8.5, G.UI.C.textDim);
      G.UI.textOut(x, { x: BS.lx + BS.lw - 2, y: ry + 4 },
        (b.stage === 'young' ? '幼·' : '') + roleTag(b), 9, G.UI.C.textDim, 'right');
    });

    /* 右：详情 */
    var b = beastSelOf(scene, save);
    if (!b) return;
    var sp = G.Data.beasts.byId(b.id);
    var st = G.Beasts.combatStat(b);
    var dx = BS.dx, y = BS.dy;
    G.UI.text(x, { x: dx, y: y }, b.name, 15, G.UI.C.goldHi);
    G.UI.text(x, { x: dx + 96, y: y + 3 }, (b.stage === 'adult' ? '已成年' : '尚年幼'), 10,
      b.stage === 'adult' ? G.UI.C.jadeHi : G.UI.C.textDim);
    y += 18;
    var lines = [
      '物种 ' + sp.n + '　五行 ' + sp.elem + '　' + roleTag(b),
      '境界 ' + realmN(b.gl),
      '资质 ' + b.qual + '（' + G.Data.beasts.qualComment(b.qual) + '）　亲密度 ' + b.bond,
      '气血 ' + st.hp + '　攻 ' + st.atk + '　防 ' + st.def + '　速 ' + st.spd
    ];
    lines.forEach(function (t) { G.UI.text(x, { x: dx, y: y }, t, 10.5, G.UI.C.text); y += 14; });

    /* 修为进度 */
    var nd = G.Beasts.need(b.gl);
    G.UI.text(x, { x: dx, y: y }, '修为 ' + b.xp + '/' + nd, 9.5, G.UI.C.textDim);
    var barW = BS.dw - 70, ratio = Math.min(1, b.xp / nd);
    G.UI.panel(x, { x: dx + 70, y: y + 2, w: barW, h: 7 }, 'rgba(40,52,66,0.9)', G.UI.C.rule, 2, { tex: false, shadow: false });
    if (ratio > 0) G.UI.panel(x, { x: dx + 70, y: y + 2, w: Math.max(2, Math.round(barW * ratio)), h: 7 },
      'rgba(122,168,196,0.85)', null, 2, { tex: false, shadow: false });
    y += 16;

    /* 技能 / 化形 */
    G.UI.text(x, { x: dx, y: y }, '已悟 ' + (b.skills.join('、') || '无'), 9.5, G.UI.C.text);
    y += 14;
    if (sp.chain) {
      var ch = sp.chain;
      var target = ch.to ? G.Data.beasts.byId(ch.to).n : '成年';
      G.UI.text(x, { x: dx, y: y }, '化形→' + target + '：需 ' + realmN(ch.gl) + ' · ' + ch.item +
        (ch.place ? ' · 于' + ch.place : ''), 9, G.UI.C.textDim);
    } else {
      G.UI.text(x, { x: dx, y: y }, '此兽已无更高化形。', 9, G.UI.C.textDim);
    }
  }

  function refreshBeasts(scene) { G.Storage.saveCurrent(G.game.save); G.Overlays.openPanel(scene, 'beasts'); }
  function beastToast(t) { G.game.toast(t); }
  function buildBeasts(btns, scene) {
    var save = G.game.save;
    /* 空栏：只给返回 */
    if (!save.beasts.length) {
      btns.push(new G.UI.Btn({ x: 190, y: 214, w: 100, h: 20, small: true,
        label: '返回洞府', onClick: function () { G.Overlays.openPanel(scene, 'cave'); } }));
      return;
    }
    var b = beastSelOf(scene, save);
    var x0 = BS.lx, wBtn = 62, gap = 4, y = BS.aY;
    function feedBtn(itemKey, i) {
      var n = save.items[itemKey] || 0;
      btns.push(new G.UI.Btn({
        x: x0 + i * (wBtn + gap), y: y, w: wBtn, h: BS.aH, small: true,
        label: itemKey + '×' + n, disabled: n <= 0,
        onClick: function () {
          var r = G.Beasts.feed(save, b.uid, itemKey);
          if (!r.ok) { beastToast(r.reason); return; }
          beastToast('喂养 ' + b.name + '：修为 +' + r.gainXp +
            (r.glUps ? '，境界提升 ×' + r.glUps : ''));
          refreshBeasts(scene);
        }
      }));
    }
    feedBtn('药渣', 0); feedBtn('灵食', 1); feedBtn('妖丹', 2);

    /* 化形 / 出战 / 骑乘 */
    var xA = x0 + 3 * (wBtn + gap);
    var sp = G.Data.beasts.byId(b.id);
    btns.push(new G.UI.Btn({
      x: xA, y: y, w: wBtn, h: BS.aH, small: true, variant: 'gold',
      label: sp.chain ? (sp.chain.to ? '化形' : '成年') : '无化形',
      disabled: !!G.Beasts.matureBlock(save, b.uid),
      onClick: function () {
        var r = G.Beasts.mature(save, b.uid);
        if (!r.ok) { beastToast(r.reason); return; }
        beastToast(r.evolved ? '化形成功：' + r.to : (b.name + ' 已成年'));
        refreshBeasts(scene);
      }
    }));
    var battling = G.Beasts.isBattling(save, b.uid);
    btns.push(new G.UI.Btn({
      x: xA + (wBtn + gap), y: y, w: wBtn, h: BS.aH, small: true,
      variant: battling ? 'gold' : 'default',
      label: battling ? '出战中' : '出战',
      disabled: !!G.Data.beasts.battleBlockReason(b.id),
      onClick: function () {
        var r = G.Beasts.setBattle(save, b.uid);
        if (!r.ok) { beastToast(r.reason); return; }
        beastToast(r.active ? b.name + ' 随你出战' : b.name + ' 退回兽栏');
        refreshBeasts(scene);
      }
    }));
    var riding = G.Beasts.isRiding(save, b.uid);
    btns.push(new G.UI.Btn({
      x: xA + 2 * (wBtn + gap), y: y, w: wBtn, h: BS.aH, small: true,
      variant: riding ? 'gold' : 'default',
      label: riding ? '骑乘中' : '骑乘',
      disabled: !riding && !!G.Data.beasts.rideBlockReason(b),
      onClick: function () {
        if (riding) { G.Beasts.dismount(save); beastToast('已下马'); refreshBeasts(scene); return; }
        var r = G.Beasts.setRide(save, b.uid);
        if (!r.ok) { beastToast(r.reason); return; }
        beastToast('跨上 ' + b.name);
        refreshBeasts(scene);
      }
    }));

    /* R5 伴生仙兽槽：取得道之钥匙（地狱级通关仙界）后解锁 */
    var meta = G.game.meta || {};
    var slotOn = !!(meta.progress && meta.progress.daoKey);
    var cbOn = meta.companionBeast && meta.companionBeast.id === b.id;
    btns.push(new G.UI.Btn({
      x: BS.dx, y: 180, w: BS.dw, h: 16, small: true,
      variant: cbOn ? 'gold' : 'default',
      label: !slotOn ? '伴生槽未启 · 需道之钥匙' : cbOn ? '★ 伴生仙兽（点击解除）' : '设为伴生仙兽 · 随轮回同行',
      disabled: !slotOn,
      onClick: function () {
        if (cbOn) { delete meta.companionBeast; G.Storage.saveMeta(meta); beastToast('已解除伴生仙兽'); refreshBeasts(scene); }
        else { meta.companionBeast = { id: b.id }; G.Storage.saveMeta(meta); beastToast(b.name + ' 已设为伴生仙兽'); refreshBeasts(scene); }
      }
    }));
    /* 第二行：名册选择 / 放生 / 返回 */
    var y2 = y + BS.aH + 4;
    save.beasts.slice(0, 8).forEach(function (bb, i) {
      btns.push(new G.UI.Btn({
        x: BS.lx + i * 18, y: y2, w: 16, h: 14, small: true,
        variant: bb.uid === scene.beastSel ? 'gold' : 'default',
        label: '' + (i + 1),
        onClick: function () { scene.beastSel = bb.uid; refreshBeasts(scene); }
      }));
    });
    var relArmed = scene.beastRelArm === b.uid;
    btns.push(new G.UI.Btn({
      x: BS.dx, y: y2, w: 86, h: 14, small: true, variant: 'danger',
      label: relArmed ? '再点确认放生' : '放生',
      onClick: function () {
        if (!relArmed) { scene.beastRelArm = b.uid; G.Overlays.openPanel(scene, 'beasts'); return; }
        var r = G.Beasts.release(save, b.uid);
        if (!r.ok) { beastToast(r.reason); return; }
        scene.beastRelArm = null; scene.beastSel = null;
        beastToast('已放生 ' + b.name);
        refreshBeasts(scene);
      }
    }));
    btns.push(new G.UI.Btn({
      x: BS.dx + 94, y: y2, w: 86, h: 14, small: true,
      label: '返回洞府',
      onClick: function () { G.Overlays.openPanel(scene, 'cave'); }
    }));
    btns.push(new G.UI.Btn({
      x: BS.dx + 188, y: y2, w: 46, h: 14, small: true, variant: 'gold',
      label: '购饲料',
      onClick: function () { G.Overlays.openPanel(scene, 'beastShop'); }
    }));
  }

  var AIR_RIDE_COST = 300;
  var FEED_GOODS = [
    { id: '药渣', n: '药渣', price: 5, d: '喂养，略增修为' },
    { id: '灵食', n: '灵食', price: 18, d: '喂养，增修为' },
    { id: '御兽丹·青纹', n: '御兽丹·青纹', price: 150, d: '青纹蛇化形所需' }
  ];
  var BAG_GOODS = [
    { id: '木囊', n: '木囊', price: 30, d: '收服妖兽 · 系数1.0' },
    { id: '玄囊', n: '玄囊', price: 120, d: '收服妖兽 · 系数1.5' },
    { id: '宝囊', n: '宝囊', price: 400, d: '收服妖兽 · 系数2.0' }
  ];
  function shopRow(x, g, yy) {
    G.UI.text(x, { x: BS.lx, y: yy }, g.n, 12, G.UI.C.text);
    G.UI.text(x, { x: BS.lx + 78, y: yy + 1 }, g.d, 9.5, G.UI.C.textDim);
    G.UI.textOut(x, { x: BS.lx + BS.lw + 118, y: yy + 1 }, g.price + ' 灵石', 10,
      G.UI.C.gold, 'right');
  }
  function drawBeastShop(x, scene) {
    var save = G.game.save;
    shell(x, '兽栏 · 饲料、妖囊与骑术', '灵石 ' + (save.stone || 0));
    G.UI.text(x, { x: BS.lx, y: 50 }, '— 饲料 —', 10, G.UI.C.textDim);
    FEED_GOODS.forEach(function (g, i) { shopRow(x, g, 62 + i * 18); });
    G.UI.text(x, { x: BS.lx, y: 116 }, '— 妖囊（战中收服）—', 10, G.UI.C.textDim);
    BAG_GOODS.forEach(function (g, i) { shopRow(x, g, 128 + i * 18); });
    G.UI.text(x, { x: BS.lx, y: 182 }, '— 骑术 —', 10, G.UI.C.textDim);
    G.UI.text(x, { x: BS.lx, y: 195 }, '御空骑术', 12, G.UI.C.text);
    G.UI.text(x, { x: BS.lx + 78, y: 196 }, '金丹可学，驭飞骑代步', 9.5, G.UI.C.textDim);
    G.UI.textOut(x, { x: BS.lx + BS.lw + 118, y: 196 }, AIR_RIDE_COST + ' 灵石', 10,
      G.UI.C.gold, 'right');
  }
  function shopBuyBtn(btns, scene, g, yy) {
    var save = G.game.save;
    btns.push(new G.UI.Btn({
      x: BS.lx + BS.lw + 128, y: yy - 2, w: 58, h: 18, small: true,
      label: '购买', disabled: (save.stone || 0) < g.price,
      onClick: function () {
        save.stone -= g.price;
        save.items[g.id] = (save.items[g.id] || 0) + 1;
        G.Storage.saveCurrent(save);
        G.game.toast(g.n + ' ×1　灵石 −' + g.price);
        G.Overlays.openPanel(scene, 'beastShop');
      }
    }));
  }
  function buildBeastShop(btns, scene) {
    FEED_GOODS.forEach(function (g, i) { shopBuyBtn(btns, scene, g, 62 + i * 18); });
    BAG_GOODS.forEach(function (g, i) { shopBuyBtn(btns, scene, g, 128 + i * 18); });
    /* 御空骑术：金丹可学（与御剑同门槛），学会才能骑飞行坐骑 */
    var save0 = G.game.save;
    var airLearned = !!(save0.rideSkill && save0.rideSkill.air);
    var canLearnAir = !airLearned && G.Player.canFly(save0) && (save0.stone || 0) >= AIR_RIDE_COST;
    btns.push(new G.UI.Btn({
      x: BS.lx + BS.lw + 128, y: 193, w: 58, h: 18, small: true,
      variant: canLearnAir ? 'gold' : 'ghost',
      label: airLearned ? '已习得' : (G.Player.canFly(save0) ? '学习' : '需金丹'),
      disabled: !canLearnAir,
      onClick: function () {
        save0.stone -= AIR_RIDE_COST;
        save0.rideSkill = save0.rideSkill || { land: false, air: false };
        save0.rideSkill.air = true;
        G.Storage.saveCurrent(save0);
        G.game.toast('习得御空骑术 —— 可驭飞骑');
        G.Overlays.openPanel(scene, 'beastShop');
      }
    }));
    btns.push(new G.UI.Btn({
      x: BS.lx, y: 216, w: 96, h: 20, small: true,
      label: '返回兽栏',
      onClick: function () { G.Overlays.openPanel(scene, 'beasts'); }
    }));
  }

  var DRAW = {
    /* 角色面板要读 scene.charTab（子页签），所以把 scene 透传下去 */
    char: function (x, scene) { G.Overlays.renderChar(x, scene); },
    skills: drawSkills,
    secrets: drawSecrets,
    quest: drawQuest,
    bag: drawBag,
    cave: drawCave,
    alchemy: drawAlchemy,
    forge: drawForge,
    array: drawArray,
    masters: drawMasters,
    meditate: drawMeditate,
    beasts: drawBeasts,
    beastShop: drawBeastShop,
    sect: drawSect,
    map: drawMap
  };

  function renderPanel(x, scene) {
    var fn = DRAW[scene.overlay];
    if (!fn) return false;
    /* 六面板 = 云海玉牌（深青紫底 + 浅字）。**底栏不在作用域内** —— 它跟 HUD 一样是墨夜，
       两套材质靠这个作用域边界分开，所以 `renderBar` 必须留在外面。 */
    G.UI.mist(function () { fn(x, scene); });
    /* 底栏高亮：功法/秘术属于「角色」组，底栏高亮也要落在角色上 ——
       否则进了功法页底栏一个都不亮，玩家不知道自己在哪。 */
    renderBar(x, G.Overlays.isCharGroup(scene.overlay) ? 'char' : scene.overlay);
    return true;
  }

  /* 左侧追踪栏的**唯一取数口**（探索场景每帧要读）。
     不让 explore.js 自己翻 QUEST 表 —— 表在这个闭包里，外面看不见；
     也避免"两处各判一次当前步"，那种重复迟早会分叉。
     返回：{ id, idx, total, s, flags, guide, upcoming }。
     · guide 已按旗标做过 g → g2 的切换（打赢一场后自动改指回镇）。
     · upcoming 是紧随其后的两步（追踪栏"子任务"的兜底内容）。 */
  G.Overlays.trackInfo = function (save) {
    var q = (save && save.quest) || { step: 'm0-1', flags: {} };
    var step = q.step || 'm0-1';
    /* ⚠️ 顺序表按**当前所在线**取（分叉后主线不再是一条） */
    var order = questOrderOf(save);
    var idx = order.indexOf(step);
    if (idx < 0) idx = 0;
    var s = QUEST[step] || QUEST[order[0]];
    var flags = q.flags || {};
    var done = !!(s.f && flags[s.f]);
    return {
      id: step, idx: idx, total: order.length, s: s, flags: flags,
      guide: (done && s.g2) ? s.g2 : (s.g || null),
      upcoming: order.slice(idx + 1, idx + 3).map(function (id2) { return QUEST[id2]; })
    };
  };

  G.Overlays.PANELS = PANELS;  G.Overlays.PANEL_RECT = FRAME;
  /* 内容区也导出：契约要判"内容不越出外框"，两处都得拿到 */
  G.Overlays.PANEL_BODY = P;
  G.Overlays.PANEL_BAND = BAND;
  G.Overlays.BAR_Y = BAR_Y;
  G.Overlays.BAR_H = BAR_H;
  G.Overlays.isPanel = function (name) { return !!IDS[name]; };
  /* 全部可路由面板 id 的**唯一清单**（v0.61.0）。
     为什么导出：`DRAW` 漏一项的表现是"面板点了没反应、只有按钮浮在地图上、且不报错"
     —— v0.60.0 的「拜师」面板就是这样漏的（DRAW 里有 alchemy/array，独缺 masters）。
     契约要能**遍历所有 id** 才能把这类漏注册钉死，所以清单必须出得来。 */
  G.Overlays.PANEL_IDS = Object.keys(IDS);
  G.Overlays.itemIconId = function (name) { return ITEM_ICON_ID[name] || name; };
  G.Overlays.itemDescription = itemDescription;
  /* 成就页移出游戏内（v0.15.0）：底栏不再有它，改由**开局界面**渲染。
     绘制实现仍留在这里（单一实现），只是换个调用方 —— 不复制一份。 */
  G.Overlays.drawAchieve = drawAchieve;
  G.Overlays.CAVE_ARTS = ARTS;
  G.Overlays.MAP_WORLDS = WORLD_ORDER;
  /* 导出给契约：分界的可见性/可点性判据（用户口径的"隐藏 vs 置灰"） */
  G.Overlays.worldGate = worldGate;
  G.Overlays.worldMapBg = worldMapBg;
  /* 地图视口矩形（契约要拿它算节点坐标，别在契约里另抄一份几何） */
  G.Overlays.MAP_VIEW = MP;
  /* ---- 地图的拖拽 / 节点传送（v0.62.0，用户第 6/8 点）----
     拖拽：指针状态在 `G.Input._down` / `G.Input.drag`（input.js 已记录）。
     ⚠️ 只在"面板是 map 且按下点落在视口内"时起拖 —— 否则在面板外按下也会把地图拖走。 */
  G.Overlays.mapDragTick = function (scene) {
    var inp = G.Input;
    if (!inp) return;
    if (!inp._down) { scene._mapDrag = null; return; }
    var p0 = inp._down, p1 = inp.drag || inp._down;
    var V = MP;
    if (!scene._mapDrag) {
      if (!(p0.x >= V.vx && p0.x <= V.vx + V.vw && p0.y >= V.vy && p0.y <= V.vy + V.vh)) return;
      var pan = mapPanOf(scene);
      scene._mapDrag = { x: p0.x, y: p0.y, px: pan.x, py: pan.y };
    }
    var d = scene._mapDrag;
    scene.mapPan = { x: d.px + (p1.x - d.x), y: d.py + (p1.y - d.y) };
    mapClampPan(scene);
  };
  /* 节点点击 = 传送（用户原话：「到达化神境就可以自由传送到各个地图了」）。
     返回 true = 这次点击被地图吃掉（不再往下派发）。 */
  var TELEPORT_GL = 181;                  /* 化神境起始 gl（REALMS 里 化神 y0 = 181） */
  G.Overlays.TELEPORT_GL = TELEPORT_GL;
  G.Overlays.mapTap = function (p, scene) {
    if (!scene || scene.overlay !== 'map') return false;
    var V = MP;
    /* 视口外的点击不归地图管（底栏页签、关闭钮都在外面） */
    if (!(p.x >= V.vx && p.x <= V.vx + V.vw && p.y >= V.vy && p.y <= V.vy + V.vh)) return false;
    var meta = G.game.meta || {}, save = G.game.save;
    if (!save) return true;
    var w = mapWorldOf(scene, meta);
    var list = G.Data.regions.of(w) || [];
    /* ⚠️ 命中判定要**逆变换**回未缩放的视口坐标再比 —— 直接拿屏幕坐标比，
       放大之后就再也点不中（而且看起来像"这个节点是死的"）。 */
    var q = mapUnproject(scene, p.x, p.y);
    var hit = null;
    list.forEach(function (r) {
      var nx = V.vx + r.mx * V.vw, ny = V.vy + r.my * V.vh;
      if (Math.hypot(q.x - nx, q.y - ny) <= 12) hit = r;
    });
    if (!hit) return true;
    var curId = G.Data.regions.regionIdOf ? G.Data.regions.regionIdOf(save.map) : null;
    if (hit.id === curId) { G.game.toast('已在此处'); return true; }
    if (!(save.visited || {})[hit.id]) {
      G.game.toast('未曾到过 ' + hit.n + '，无从传送');
      return true;
    }
    if ((save.globalLevel || 1) < TELEPORT_GL) {
      var ri = G.Player.realmInfo(save.globalLevel) || { n: '' };
      G.game.toast('需化神境方可自由传送（当前 ' + ri.n + '）');
      return true;
    }
    scene.clearOverlay();
    G.game.changeScene(G.Data.regions.mapIdOf(hit.id), { toSpawn: true });
    G.game.toast('御空而至 · ' + hit.n);
    return true;
  };
  G.Overlays.barBtns = barBtns;
  G.Overlays.renderBar = renderBar;
  G.Overlays.openPanel = openPanel;
  G.Overlays.renderPanel = renderPanel;
  G.Overlays.secretDesc = secretDesc;
})();
