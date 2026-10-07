/* 支线任务（内容型）—— 有 NPC、有剧情、有进度
 *
 * 与主线的区别：主线走 `save.quest`（单线推进）；支线**并行多条**，各记各的进度：
 *   `save.side = { <id>: step }`   step 0/缺省 = 未接，1 = 进行中，2 = 可交，3 = 完成
 *
 * 每条支线的结构：
 *   n      任务名
 *   giver  接取/交付的 NPC id（town.js 的 NPC_ACTS 里按 id 找）
 *   intro  接取时的开场白（NPC 说）
 *   steps  每步的 { d 目标文案, hint 提示 }（索引 = step-1）
 *   ready  判定"能不能交"（返回 bool）—— 用**已有系统**（物品 / 副本进度）判，不新造子系统
 *   cost   交付时扣除（物品名 → 数量）
 *   reward 交付奖励 { stone?, items?, rep?, skill? }
 *           · `skill` = **功法 id**（v0.90.0，用户口径「分支任务获取功法」）。
 *             ⚠️ 必须走 `Player.autoEquip` 顺手激发 —— 只写 `save.skills` 不进技能栏，
 *                玩家会看到"学了新功法但战斗里没有它"（项目历史上踩过的静默缺口）。
 *   out    交付时的收尾台词
 *
 * ⚠️ `ready` 与 `cost` 必须**成对**：ready 判"够不够"，cost 扣"扣多少"。
 *    只写 ready 不写 cost 会白送；只写 cost 不写 ready 会扣成负数（物品是平表，扣穿就没了）。
 */
(function () {
  function S(o) { return o; }

  var LIST = [
    S({
      id: 'sq_washer', n: '浣衣妇的心事', giver: 'washer',
      intro: '“……你从翠微山回来？我那儿子进山采药，三天没回来了。”',
      steps: [
        { d: '浣衣妇的儿子进翠微山采药未归。她求你替他讨个说法。',
          hint: '带 2 枚妖丹回来 —— 那是山中妖兽的凭证。' },
        { d: '妖丹已备齐，可以回青溪镇交给浣衣妇了。',
          hint: '回镇找浣衣妇。' },
        { d: '浣衣妇收下了妖丹，在河边烧了一夜纸钱。', hint: '（已完成）' }
      ],
      ready: function (s) { return ((s.items || {})['妖丹'] || 0) >= 2; },
      cost: { '妖丹': 2 },
      reward: { stone: 150, items: { '回春丹': 2 } },
      out: '“……多谢。这点钱你拿着，山里的路不好走。”'
    }),
    S({
      id: 'sq_woodman', n: '老樵夫的药方', giver: 'woodman',
      intro: '“老骨头不中用了。你若手头有回春丹，匀我几粒？”',
      steps: [
        { d: '老樵夫的老寒腿犯了，需要回春丹压一压。',
          hint: '凑 3 粒回春丹（杂货铺可买、妖兽也会掉）。' },
        { d: '回春丹凑齐了。', hint: '回镇交给老樵夫。' },
        { d: '老樵夫把压箱底的符箓塞给了你。', hint: '（已完成）' }
      ],
      ready: function (s) { return ((s.items || {})['回春丹'] || 0) >= 3; },
      cost: { '回春丹': 3 },
      reward: { items: { '解封符': 2 }, rep: 30 },
      out: '“好孩子。这符是我年轻时从一位游方道人手里换的，你带着。”'
    }),
    S({
      id: 'sq_keeper', n: '刘掌柜的旧账', giver: 'market',
      intro: '“刘记的旧账册丢在秘境里了。你若有本事进去，替老朽取回来？”',
      steps: [
        { d: '刘掌柜的旧账册落在了秘境里，他想讨回来。',
          hint: '通关任意一个秘境副本。' },
        { d: '你在秘境深处翻出了那本账册。', hint: '回镇交给刘掌柜。' },
        { d: '刘掌柜翻着账册，半晌没说话。', hint: '（已完成）' }
      ],
      ready: function (s) { return (s.dungeonSlot || 0) > 0 || (s.dungeonFarm || 0) > 0; },
      /* `free: true` = **无物品代价**（判定靠别的系统，如副本进度）。
         不写这个标记、又只给 ready 不给 cost，会被契约判成"白送"（见 smoke 的 sidequest.contract）。 */
      free: true, cost: null,
      reward: { stone: 200, items: { '聚气散': 1 }, skill: '回春诀' },
      out: '“多谢。往你在我这儿买东西，记你一份人情。”——他从柜底翻出一卷佚册塞给你。'
    }),
    /* ===== v0.90.0 新增：**奖励功法 / 剧情道具**的支线（用户口径）=====
       「新增分支任务获取功法，副本道具、主线道具等等」。
       设计原则（照抄凡人修仙传的"机缘"感）：
         · 功法只由**人物关系**给（师父/药师/故人），不掉落 —— 与"功法难得"配套；
         · 副本道具是**凭证类**（不是数值），用来开启后续支线，形成链条；
         · 主线道具是**信物类**，进 `save.items` 平表，任务面板/背包都能看到。 */

    /* ① 幽篁药庐的旧识 —— 给药修功法（被动·治疗向）。
       为什么挂在幽篁药庐方向：灵根/宗门有属性匹配，功法也该有**来源匹配**，
       玩家跑药庐线就该拿到药修的东西，而不是随便掉一本。 */
    S({
      id: 'sq_herb', n: '药庐旧识', giver: 'washer',
      intro: '“你若真有心修行……我娘家原是幽篁药庐的。这卷《百草回春》残篇，你拿去。”',
      steps: [
        { d: '浣衣妇愿引你入药修之门，但要你先证明心性：采三株凝血草来。',
          hint: '野外采集或妖兽掉落，凑 3 株凝血草。' },
        { d: '凝血草已备齐，可以回青溪镇交给她了。', hint: '回镇找浣衣妇。' },
        { d: '浣衣妇把药庐残篇交到你手上，算是认了你这个后辈。', hint: '（已完成）' }
      ],
      ready: function (s) { return ((s.items || {})['凝血草'] || 0) >= 3; },
      cost: { '凝血草': 3 },
      /* ⚠️ 必须给**散修可学**的功法 —— `百草回春` 是幽篁药庐的宗门功法（src:'sect'），
         散修拿了也激活不了（`canUseSkill` 会拒），等于白给（契约抓到过）。
         `回春诀` 是通用商店功法（带治疗主动），散修线拿到就能用。 */
      reward: { stone: 80, skill: '回春诀' },
      out: '“……拿着。修行路上，救人也是救己。”'
    }),

    /* ② 秘境凭证 —— 产出**副本道具**「秘境残图」。
       残图本身不加数值，它是"下一段支线的前置"，形成"打副本 → 得凭证 → 开新任务"的链。 */
    S({
      id: 'sq_relic', n: '残图之谜', giver: 'woodman',
      intro: '“我年轻时在秘境门口捡过半张图……你若有本事通关秘境，替我看看另半张在不在里面。”',
      steps: [
        { d: '老樵夫手里有半张秘境残图，他想凑齐另一半。',
          hint: '通关任意秘境副本，进深处翻找。' },
        { d: '你在秘境深处摸到了另半张残图。', hint: '回镇交给老樵夫。' },
        { d: '两张残图拼在一起，指向一处从未听说过的所在。', hint: '（已完成）' }
      ],
      ready: function (s) { return (s.dungeonSlot || 0) > 0 || (s.dungeonFarm || 0) > 0; },
      free: true, cost: null,
      /* 「秘境残图」= 副本道具（凭证类）：交给老樵夫后他会折成护身符还你。 */
      reward: { items: { '秘境残图': 1, '解封符': 1 }, rep: 20 },
      out: '“好、好……拼上了。这图你收着，往后总用得上。”'
    }),

    /* ============================================================
       v0.92.0 批量扩充（用户口径「支线任务还是太少了」）
       ============================================================
       设计原则（照抄凡人修仙传的"机缘"感，与前 5 条一致）：
         · 每条必须**挂在一个真实存在的 NPC** 上（`giver` = maps 里的 NPC id）；
         · `ready` 只读**已有系统**的字段（物品 / 副本进度 / 境界 / 击杀数 /
           宗门贡献），不新造子系统 —— 新造子系统等于给它单开一套账本；
         · `ready` 与 `cost` **成对**（判"够不够" / 扣"扣多少"），
           无物品代价的显式写 `free: true`；
         · 奖励向"功法 / 凭证 / 声望 / 材料"倾斜，少给裸灵石 ——
           灵石已经是野怪与悬赏的主产出，支线不该抢那条线的定位。
       一个 NPC 可挂**多条**（`byGiver` 按 step 排队，见上）。

       —— 第一组：青溪镇加深（浣衣妇/老樵夫/刘掌柜 各补第 2 条）—— */

    /* 浣衣妇 · 第 2 条：井边的银镯（人情线，纯代价换稳定收益） */
    S({
      id: 'sq_washer2', n: '井边的银镯', giver: 'washer',
      intro: '“井里摸出个镯子……不是我的。你替我打听打听，兴许是谁家丢的。”',
      steps: [
        { d: '浣衣妇在井底捞到一只银镯，想寻失主。',
          hint: '去镇上问问（需境界炼气一重以上，才走得动道）。' },
        { d: '你打听到镯子是刘记旧物。', hint: '回井边告诉浣衣妇。' },
        { d: '镯子物归原主，浣衣妇松了口气。', hint: '（已完成）' }
      ],
      /* 条件：达到炼气一重（37）—— 挡住刚出镇的玩家，避免"还没见过世面就四处打听" */
      ready: function (s) { return (s.globalLevel || 1) >= 37; },
      free: true, cost: null,
      reward: { stone: 120, rep: 25, items: { '灵泉水': 2 } },
      out: '“找着了就好。这水是谢你的——井底打上来的，甜。”'
    }),

    /* 老樵夫 · 第 2 条：山货换药（教玩家"采集 → 兑换"的循环） */
    S({
      id: 'sq_woodman2', n: '山货换药', giver: 'woodman',
      intro: '“你常往山里去？帮我捎些灵草回来，我给你配副好药。”',
      steps: [
        { d: '老樵夫想要山里的灵草入药。', hint: '采 4 株灵草（野外采集点）。' },
        { d: '灵草备齐，可以回镇给他了。', hint: '回镇找老樵夫。' },
        { d: '老樵夫配了副药，还教了你两味方子。', hint: '（已完成）' }
      ],
      ready: function (s) { return ((s.items || {})['灵草'] || 0) >= 4; },
      cost: { '灵草': 4 },
      reward: { items: { '大还丹': 1, '饲灵草料': 3 }, rep: 20 },
      out: '“喏，这丸留着保命。山里的东西，认得比打得多。”'
    }),

    /* 刘掌柜 · 第 2 条：押货（副本凭证线的延伸） */
    S({
      id: 'sq_keeper2', n: '押货走镖', giver: 'market',
      intro: '“有一趟货要出山，路上不太平。你护一趟，回来记你大功。”',
      steps: [
        { d: '刘掌柜要押一批货出山。', hint: '路上得先清掉 20 头野怪。' },
        { d: '路清干净了，回刘记复命。', hint: '回镇找刘掌柜。' },
        { d: '货平安送到，刘掌柜塞了你一卷手札。', hint: '（已完成）' }
      ],
      /* 条件：累计斩妖 20 —— 用 `wildKills`（战斗已写好，不新造字段） */
      ready: function (s) { return (s.wildKills || 0) >= 20; },
      free: true, cost: null,
      reward: { stone: 260, items: { '解封符': 2 }, rep: 30 },
      out: '“稳当。往后你要走远路，记得先来我这儿看看货单。”'
    }),

    /* —— 第二组：云州城 6 个 NPC（此前**一个支线都没有**）—— */

    /* 西市掌柜：市面行情（材料收购） */
    S({
      id: 'yz_market', n: '西市行情', giver: 'yz_market',
      intro: '“西市做的是矿石买卖。你要有玄铁，我按高价收。”',
      steps: [
        { d: '西市掌柜想收一批玄铁压仓。', hint: '凑 3 块玄铁（矿脉采集 / 妖兽掉落）。' },
        { d: '玄铁够了。', hint: '回西市交货。' },
        { d: '掌柜验过成色，痛快结了账。', hint: '（已完成）' }
      ],
      ready: function (s) { return ((s.items || {})['玄铁'] || 0) >= 3; },
      cost: { '玄铁': 3 },
      reward: { stone: 320, rep: 25, items: { '灵玉': 1 } },
      out: '“成色足。往后有好东西尽管拿来，我不压价。”'
    }),

    /* 客栈小二：跑腿传信（低门槛、纯跑腿） */
    S({
      id: 'yz_inn', n: '送信上路', giver: 'yz_inn',
      intro: '“客官，我这有封信要送去落霞镇，一直没人敢接这趟。”',
      steps: [
        { d: '客栈有一封信要送去落霞镇。', hint: '走到落霞镇（东门出城，往东）。' },
        { d: '信已送到。', hint: '回云州客栈复命。' },
        { d: '小二千恩万谢，说下回来了给你留间上房。', hint: '（已完成）' }
      ],
      /* 条件：去过落霞镇（`save.visited` 是对象映射，见 G50 教训）——
         ⚠️ 必须按**已存在的形状**读：它是 `{mapId: n}` 的映射，不是数组。 */
      ready: function (s) { return !!(s.visited && s.visited.fan4); },
      free: true, cost: null,
      reward: { stone: 150, items: { '回春丹': 3 }, rep: 20 },
      out: '“真是麻烦你了。路上还太平吧？”'
    }),

    /* 铁坊匠人：炼器材料（教玩家"材料 → 打造"） */
    S({
      id: 'yz_smith', n: '铁坊缺料', giver: 'yz_smith',
      intro: '“炉子烧了三天，就差几块精钢。你去外头给我弄点回来？”',
      steps: [
        { d: '铁坊等着精钢开炉。', hint: '凑 2 块精钢。' },
        { d: '精钢到手。', hint: '回铁坊交给匠人。' },
        { d: '匠人开了炉，顺手替你修了件器物。', hint: '（已完成）' }
      ],
      ready: function (s) { return ((s.items || {})['精钢'] || 0) >= 2; },
      cost: { '精钢': 2 },
      reward: { stone: 200, items: { '玄铁矿': 2 }, rep: 20 },
      out: '“好料。下回你要打什么，报我名字就行。”'
    }),

    /* 丹霞坊主：炼丹线的支线（丹方与人情） */
    S({
      id: 'yz_dan', n: '丹霞求药', giver: 'yz_dan',
      intro: '“丹霞坊的炉火烧得再好，也缺一味引子——你可有火莲？”',
      steps: [
        { d: '丹霞坊主需要火莲引火。', hint: '寻 1 朵火莲（熔岩地带 / 采集）。' },
        { d: '火莲已在手。', hint: '回丹霞坊交给她。' },
        { d: '她收下火莲，回赠你两丸好丹。', hint: '（已完成）' }
      ],
      ready: function (s) { return ((s.items || {})['火莲'] || 0) >= 1; },
      cost: { '火莲': 1 },
      reward: { items: { '大还丹': 2 }, rep: 35, skill: '回春诀' },
      out: '“难得你还记得。这丹你收着——救人也是修行。”'
    }),

    /* 说书人：故事支线（情报型，给声望与小礼） */
    S({
      id: 'yz_story', n: '说书人的旧闻', giver: 'yz_story',
      intro: '“老朽说了一辈子书，就差一段真事。你在外头见过什么？说来听听。”',
      steps: [
        { d: '说书人想听你亲历的奇闻。', hint: '通关任意秘境，才有可讲的事。' },
        { d: '你在秘境里的见闻够讲一场了。', hint: '回云州城找说书人。' },
        { d: '说书人把这段编成了新篇，场下叫好声一片。', hint: '（已完成）' }
      ],
      ready: function (s) { return (s.dungeonSlot || 0) > 0 || (s.dungeonFarm || 0) > 0; },
      free: true, cost: null,
      reward: { stone: 180, rep: 40, items: { '符纸': 3 } },
      out: '“好一段真事！下回你再出门，记得回来给我讲下半段。”'
    }),

    /* 城主府执事：声望型（高门槛，给修为向奖励） */
    S({
      id: 'yz_steward', n: '城主府的委托', giver: 'yz_steward',
      intro: '“城主府不轻易用人。你若真行，替云州城清一清外头的祸患。”',
      steps: [
        { d: '执事要看你是否真能担事。', hint: '累计斩妖 40 头，证明实力。' },
        { d: '你的战绩够了。', hint: '回城主府复命。' },
        { d: '执事点了点头，给了你一份通行凭据。', hint: '（已完成）' }
      ],
      ready: function (s) { return (s.wildKills || 0) >= 40; },
      free: true, cost: null,
      reward: { stone: 500, rep: 60, items: { '灵玉': 2 } },
      out: '“不错。云州城记你一份功——往后出入城门，不必再验。”'
    }),

    /* 论道台裁判：境界线（长线目标，给功法） */
    S({
      id: 'yz_judge', n: '论道台的名次', giver: 'yz_judge',
      intro: '“上论道台者，至少要筑基。你如今的火候……还差些。”',
      steps: [
        { d: '裁判要你以筑基之境再上论道台。', hint: '修至筑基境（角色 → 境界）。' },
        { d: '你已入筑基。', hint: '回论道台找裁判。' },
        { d: '裁判记了名次，赠你一卷剑诀。', hint: '（已完成）' }
      ],
      ready: function (s) { return (s.globalLevel || 1) >= 73; },   /* 筑基一重初期 */
      free: true, cost: null,
      reward: { stone: 400, rep: 80, skill: '流云剑诀' },
      out: '“筑基之后，方知天地之大。这卷剑诀，拿去。”'
    }),

    /* —— 第三组：玩法系统支线（采集 / 灵兽 / 宗门）—— */

    /* 猎户（镇外）：御兽入门（灵兽系统支线入口） */
    S({
      id: 'sq_hunter', n: '山里的踪迹', giver: 'woodman',
      intro: '“山里近来多了些生面孔的兽……你若有胆，替我去认认。”',
      steps: [
        { d: '老樵夫说山里有陌生的兽踪。', hint: '在野外击杀 12 头妖兽。' },
        { d: '山里的兽你见过了。', hint: '回镇说给他听。' },
        { d: '他照着你的描述画了张兽谱。', hint: '（已完成）' }
      ],
      ready: function (s) { return (s.wildKills || 0) >= 12; },
      free: true, cost: null,
      reward: { items: { '妖骨': 2, '兽皮': 2, '饲灵草料': 2 }, rep: 25 },
      out: '“记下了。往后见着这样的兽，知道该避还是该打。”'
    }),

    /* 刘掌柜 · 第 3 条：宗门人情（给贡献） */
    S({
      id: 'sq_keeper3', n: '刘记的荐书', giver: 'market',
      intro: '“你若想入宗门，我这儿有封旧荐书——是我年轻时欠下的人情。”',
      steps: [
        { d: '刘掌柜肯写荐书，但要你先做出成绩。', hint: '累计斩妖 30 头。' },
        { d: '你的名声够了。', hint: '回刘记取荐书。' },
        { d: '荐书到手，宗门对你高看一眼。', hint: '（已完成）' }
      ],
      ready: function (s) { return (s.wildKills || 0) >= 30; },
      free: true, cost: null,
      /* 声望给得高：这是"入宗门"的前置铺垫（宗门入门要境界，声望用来换门派商店） */
      reward: { stone: 200, rep: 120 },
      out: '“拿着。到了山门，报我刘记的名号。”'
    })
  ];

  var index = {};
  LIST.forEach(function (q) { index[q.id] = q; });

  G.Data = G.Data || {};
  G.Data.sideQuests = {
    list: LIST,
    byId: function (id) { return index[id] || null; },
    /* 按 giver NPC id 找**该 NPC 当前该谈的那一条**支线。
       v0.92.0（用户口径「支线任务还是太少了」）：一个 NPC 现在可以挂**多条**
       （`giver` 相同的按表内顺序排队），返回**第一条没做完的**：
         · 全都没接 → 返回第一条（玩家先接这条）
         · 第 1 条进行中/可交 → 返回它（先把手上这条了结）
         · 第 1 条完成 → 轮到第 2 条；全完成 → null（调用方退回普通闲聊）
       ⚠️ 旧的实现是 `filter(...)[0]`，**永远只认第一条** —— 那样给同一 NPC
          挂第二条也永远不会被触发（静默）。这里必须按 step 过滤再取首条。 */
    byGiver: function (giverId, save) {
      var cands = LIST.filter(function (q) { return q.giver === giverId; });
      if (!cands.length) return null;
      if (!save) return cands[0];
      var self = this;
      /* 优先「进行中/可交」的（step 1/2）—— 手上这条先了结 */
      var active = cands.filter(function (q) {
        var st = self.stepOf(save, q.id);
        return st === 1 || st === 2;
      });
      if (active.length) return active[0];
      /* 其次「还没接」的（step 0）—— 按表内顺序解锁 */
      var fresh = cands.filter(function (q) { return self.stepOf(save, q.id) === 0; });
      if (fresh.length) return fresh[0];
      return null;                                   /* 全部完成 */
    },
    /* 该 NPC 名下共几条（面板/契约用） */
    countByGiver: function (giverId) {
      return LIST.filter(function (q) { return q.giver === giverId; }).length;
    },
    /* 当前步（0 = 未接） */
    stepOf: function (save, id) { return ((save.side || {})[id] | 0); },
    /* 能不能交（step 2 且 ready） */
    canTurnIn: function (save, q) {
      if (this.stepOf(save, q.id) !== 2) return false;
      try { return !!q.ready(save); } catch (e) { return false; }
    },
    /* 交付：扣 cost → 发 reward → step = 3。返回 {ok, reason, text} */
    turnIn: function (save, q) {
      if (!this.canTurnIn(save, q)) return { ok: false, reason: '条件未满足' };
      var cost = q.cost || {};
      Object.keys(cost).forEach(function (k) {
        if (((save.items || {})[k] || 0) < cost[k]) { cost = null; }
      });
      if (cost === null) return { ok: false, reason: '物品不足' };
      Object.keys(cost).forEach(function (k) { save.items[k] -= cost[k]; });

      var r = q.reward || {};
      if (r.stone) save.stone = (save.stone || 0) + r.stone;
      if (r.rep && G.Player.addRep) G.Player.addRep(save, r.rep);
      Object.keys(r.items || {}).forEach(function (k) {
        save.items = save.items || {};
        save.items[k] = (save.items[k] || 0) + r.items[k];
      });
      /* 功法奖励（v0.90.0，用户口径「分支任务获取功法」）：
         ⚠️ 必须跟着 `autoEquip` —— 只写 save.skills 不进技能栏 = 玩家学了却用不上，
            且完全静默（项目"路径遗漏型缺口"的典型，见 v0.69.0 的教训）。 */
      if (r.skill) {
        save.skills = save.skills || {};
        if (!save.skills[r.skill]) save.skills[r.skill] = { lv: 1 };
        if (G.Player.autoEquip) G.Player.autoEquip(save, r.skill);
        if (G.Player.chronicle) {
          var sdn = (G.Data.skills[r.skill] || {}).n || r.skill;
          G.Player.chronicle(save, 'skill:' + r.skill, '得传《' + sdn + '》');
        }
      }
      save.side = save.side || {};
      save.side[q.id] = 3;
      if (G.Player.chronicle) G.Player.chronicle(save, 'side:' + q.id, '了却一桩：' + q.n);
      if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      return { ok: true, text: q.out, reward: r };
    },
    /* 接取：step = 1 */
    accept: function (save, q) {
      save.side = save.side || {};
      if (save.side[q.id]) return false;
      save.side[q.id] = 1;
      if (G.Storage && G.Storage.saveCurrent) G.Storage.saveCurrent(save);
      return true;
    },

    /* ===== 统一的「找 NPC 谈支线」流程（v0.92.0）=====
       为什么要提到数据层：青溪镇（town.js）与云州城（yunzhou.js）都要用同一套
       「按 step 出接下/交付/知道了」的交互。两边各抄一份的话，
       改一处（比如加"放弃"按钮、改文案）另一处必然漏 —— 项目"两份表必然分叉"的老坑。
       返回 true = 已开好支线对话（调用方别再走普通闲聊）。

       `label`/`portrait` 是给**对话标题**用的（各镇自己传自己的地名口径）。 */
    talk: function (scene, npcId, label, portrait) {
      var save = G.game && G.game.save;
      if (!scene || !save) return false;
      /* ⚠️ 必须先 `tick` 再 `byGiver`：tick 把"条件已达成"的支线从 step1 推到 step2，
         而 byGiver 按 step 决定"该谈哪一条"。顺序反了会选到一条刚够条件的旧支线。 */
      this.tick(save);
      var q = this.byGiver(npcId, save);
      if (!q) return false;
      var step = this.stepOf(save, q.id);
      if (step >= 3) return false;                 /* 做完了 → 回到普通闲聊 */
      var self = this;
      G.SideCur = q.id;                            /* 对话渲染读它取内容（见各场景 sideq） */
      var mk = function (x, lb, variant, fn) {
        return new G.UI.Btn({ x: x, y: 214, w: 100, h: 24, small: true,
          variant: variant, label: lb, onClick: fn });
      };
      var close = function () { scene.clearOverlay(); };
      var btns = [];
      if (step === 0) {
        btns.push(mk(190, '接下', 'gold', function () {
          self.accept(save, q); G.game.toast('接下支线：' + q.n); close();
        }));
        btns.push(mk(70, '再说', 'ghost', close));
      } else if (step === 2 && this.canTurnIn(save, q)) {
        btns.push(mk(190, '交付', 'gold', function () {
          var r = self.turnIn(save, q);
          if (r.ok) { G.game.toast('了却一桩：' + q.n); G.game.toast(r.text); }
          else G.game.toast('无法交付：' + r.reason);
          close();
        }));
        btns.push(mk(70, '再说', 'ghost', close));
      } else {
        btns.push(mk(190, '知道了', null, close));
      }
      scene.setOverlay('sideq', btns);
      return true;
    },

    /* 支线对话的内容（各场景的 dialog 表共用这一份）——
       `save` 用来决定"该显示哪一步的文案"。 */
    dialogOf: function (save, label, name, portrait) {
      var q = this.byId(G.SideCur);
      if (!q) return { title: label || '镇民', name: '镇民', portrait: portrait || 'villager', lines: ['……'] };
      var step = this.stepOf(save, q.id);
      var lines;
      if (step === 0) lines = [q.intro];
      else if (step >= 3) lines = [q.out];
      else lines = [q.steps[step - 1].d, '（' + q.steps[step - 1].hint + '）'];
      return { title: label || '支线', name: name || '镇民',
        portrait: portrait || 'villager', lines: lines };
    },
    /* 把 step 1 → 2（条件达成时由 tick 调） */
    tick: function (save) {
      var self = this, changed = false;
      LIST.forEach(function (q) {
        if (self.stepOf(save, q.id) !== 1) return;
        var ok = false;
        try { ok = !!q.ready(save); } catch (e) { ok = false; }
        if (ok) { save.side[q.id] = 2; changed = true; }
      });
      return changed;
    }
  };
})();
