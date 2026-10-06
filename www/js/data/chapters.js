/* 主线 · 章节链与三结局（v0.63.0，用户第 6 点 + 「三结局场景」）
   ------------------------------------------------------------
   用户口径：「主线任务太少了，需要新增主线任务到道祖境，完整闭环」，
             原始需求里还有「三结局场景」。

   设计：
     · 章节链 `c1..c10` 从**筑基**一路铺到**道祖**，每章 = 一个境界里程碑 + 一段剧情 + 2~3 个抉择。
       它不是"又一套任务机"：**演出与结果页完全复用 `G.Data.StoryEvents`**
       （同一个 `storyevent` 覆盖层、同一套按钮与渲染），这里只负责"什么时候弹、弹哪一章"。
     · 抉择累计 **道心 `save.daoHeart`**（-10..+10）。道心是**结局的唯一分水岭**：
         ≥ +4 → 证道 / -3..+3 → 化凡 / ≤ -4 → 逆天。
     · 第十章（道祖）读完 → 进独立结局场景 `ending`（三选一），读完回轮回殿。
       ⚠️ 这就是"完整闭环"的**终点**：以前 gl 684 只能看到「已至道祖圆满，无路可破」，
          现在是"走到头有话说"。
   ⚠️ 章节与 M0/M1 主线**并行**（只看境界 + 顺序），不塞进 `save.quest.step` ——
      step 是一台单线状态机，硬塞进去会把 f1- 与 s1- 两条分叉线搅乱。
      （注意：块注释里**不能出现星号斜杠**，那是注释终止符 —— 这条注释第一版写成
        "f1-*斜杠s1-*"，直接让整份文件解析失败。）
      完成记录记在 `save.chapters`（数组，就地补默认，不写存档迁移）。
   ============================================================ */
(function () {
  function has(s, n) { return ((s.items || {})[n] || 0) > 0; }
  function take(s, n, k) {
    k = k || 1;
    s.items[n] = (s.items[n] || 0) - k;
    if (s.items[n] <= 0) delete s.items[n];
  }
  function gain(s, n, k) { s.items[n] = (s.items[n] || 0) + k; }
  /* 道心：所有章节抉择都走这一个口子（另加一处就会分叉，结局判据立刻失真） */
  function heart(s, d) { s.daoHeart = Math.max(-10, Math.min(10, (s.daoHeart || 0) + d)); }

  var LIST = [
    { id: 'c1', n: '云州城', gl: 73, title: '云 州 城',
      lines: ['云州城比青溪镇大了十倍。城门口贴着告示：凡界九宗每三年一次「云州论道」，',
        '胜者可入灵界。你把离乡时刘掌柜给的半块干饼吃了，走进城门。'],
      choices: [
        { t: '先寻个落脚处', run: function (s) { heart(s, 1); s.qi = (s.qi || 0) + 1200; return '你在城西租了间静室，一住就是半年。灵气 +1200。'; } },
        { t: '直奔论道台', run: function (s) { heart(s, -1); s.stone = (s.stone || 0) + 900; return '你压了盘口，赢下第一场，也结下了第一个仇家。灵石 +900。'; } },
        { t: '先去打听血煞教', run: function (s) { heart(s, 0); gain(s, '灵品功法碎片', 4); return '茶楼里没人肯说。只有个瘸腿说书人塞给你几页残纸。'; } }
      ] },

    { id: 'c2', n: '丹成问心', gl: 109, title: '丹 成 问 心',
      lines: ['金丹在丹田里滚了七日。第八日清晨，你忽然想问一句：',
        '——修到今日，是为了什么？'],
      choices: [
        { t: '为活得久一点', run: function (s) { heart(s, 1); s.qi = (s.qi || 0) + 2600; return '你答得坦然。金丹稳了。灵气 +2600。'; } },
        { t: '为不再被人踩在脚下', run: function (s) { heart(s, -1); s.stone = (s.stone || 0) + 1800; return '你答得咬牙切齿。金丹更亮，也更冷。灵石 +1800。'; } },
        { t: '不知道', run: function (s) { heart(s, 0); s.qi = (s.qi || 0) + 1500; return '你答不出来。金丹却不恼，只静静转着。灵气 +1500。'; } }
      ] },

    { id: 'c3', n: '元婴出窍', gl: 145, title: '婴 儿 出 窍',
      lines: ['元婴初成，第一次离体。你飘在半空，低头看见自己的肉身坐在蒲团上，',
        '像一件脱下来的旧衣裳。'],
      choices: [
        { t: '远远看一会儿人间', run: function (s) { heart(s, 2); s.qi = (s.qi || 0) + 4200; return '你飞过青溪镇，看见刘记杂货还亮着灯。灵气 +4200。'; } },
        { t: '试试能不能夺舍', run: function (s) { heart(s, -2); s.stone = (s.stone || 0) + 3000; return '你盯上一个落单的修士，终究忍住了 —— 但那一念你记住了。'; } }
      ] },

    { id: 'c4', n: '神游太虚', gl: 181, title: '神 游 太 虚',
      lines: ['化神之后，识海能承天道只言片语。你第一次"听"到有人在很远的地方说：',
        '「……又一个。」'],
      choices: [
        { t: '顺着那声音追', run: function (s) { heart(s, -1); s.qi = (s.qi || 0) + 7000; return '你追了三千里，什么也没追到，却摸到了一线法则。灵气 +7000。'; } },
        { t: '守住自己识海', run: function (s) { heart(s, 2); s.ageBonus = (s.ageBonus || 0) + 1; return '你收束心神，只当没听见。稳妥，但老了一岁。'; } }
      ] },

    { id: 'c5', n: '身外身', gl: 253, title: '身 外 身',
      lines: ['合体之境，你炼出一具与己无二的身外身。它可以替你去死。',
        '问题只有一个：它算不算你？'],
      choices: [
        { t: '让它替我去闯秘境', run: function (s) { heart(s, -2); s.stone = (s.stone || 0) + 6000; return '身外身死在第九层。你替它收了尸，没有难过。灵石 +6000。'; } },
        { t: '与它同修同食', run: function (s) { heart(s, 3); s.qi = (s.qi || 0) + 12000; return '你把它当同门。三年后它主动散入你体内，道基反而更厚。灵气 +12000。'; } }
      ] },

    { id: 'c6', n: '渡劫', gl: 325, title: '雷 劫 之 下',
      lines: ['渡劫那日，天上黑云压到山顶。第一道雷落下时，你听见沈伯的声音：',
        '「孩子，扛住了。」'],
      choices: [
        { t: '硬扛九道雷', run: function (s) { heart(s, 2); s.qi = (s.qi || 0) + 26000; s.hp = 1; return '九道雷尽，你浑身焦黑地站在坑里。灵气 +26000，气血只余一线。'; } },
        { t: '借雷淬体，分一半给山下', run: function (s) { heart(s, 3); s.qi = (s.qi || 0) + 18000; return '你把雷气引向荒山，山下三百户人家安然。灵气 +18000。'; } },
        { t: '拿身外身去挡', run: function (s) { heart(s, -3); s.qi = (s.qi || 0) + 40000; return '身外身替你烧成了灰。你顺利渡劫，心里空了一块。灵气 +40000。'; } }
      ] },

    { id: 'c7', n: '灵界立足', gl: 397, title: '灵 界 立 足',
      lines: ['灵界的灵气浓得呛人，也贵得吓人。你刚到就被三家宗门盯上，',
        '他们开的价都一样：入我门墙，给你洞府。'],
      choices: [
        { t: '选一家大派', run: function (s) { heart(s, 0); s.sectRep = (s.sectRep || 0) + 80; return '你挂了个客卿名头，有洞府，也有差遣。宗门贡献 +80。'; } },
        { t: '谁也不入，自己开洞府', run: function (s) { heart(s, 2); s.stone = (s.stone || 0) - Math.min(s.stone || 0, 20000); return '你散尽灵石租下一座废洞府，从此自成一脉。'; } },
        { t: '去抢别人的洞府', run: function (s) { heart(s, -3); s.stone = (s.stone || 0) + 30000; return '你杀了洞主，占了灵脉。灵石 +30000 —— 那人的弟子记下了你的脸。'; } }
      ] },

    { id: 'c8', n: '金仙遗蜕', gl: 469, title: '仙 界 之 门',
      lines: ['仙界门户开在云海之上。守门的金甲神将只看了一眼你的道基，就让开了：',
        '「金仙以下，不得入内。你，够了。」'],
      choices: [
        { t: '按规矩入内', run: function (s) { heart(s, 2); s.qi = (s.qi || 0) + 60000; return '你规规矩矩递了名帖。灵气 +60000。'; } },
        { t: '顺手把名帖塞给身后的小修士', run: function (s) { heart(s, 3); s.qi = (s.qi || 0) + 30000; return '那修士跪下来磕头。你把他的份也让了，灵气只拿一半。灵气 +30000。'; } }
      ] },

    { id: 'c9', n: '道界残碑', gl: 577, title: '道 界 残 碑',
      lines: ['道界只有风与碎石。你在一块残碑前站了很久，上面刻着：',
        '「道则回廊九关，过者合道，不过者化尘。」'],
      choices: [
        { t: '入回廊', run: function (s) { heart(s, 1); s.daoCrystal = (s.daoCrystal || 0) + 200; return '你踏进回廊。风停了。道晶 +200。'; } },
        { t: '先在碑前坐三年', run: function (s) { heart(s, 3); s.ageBonus = (s.ageBonus || 0) + 3; return '你把碑上每一道裂纹都看了一遍。三年，换一份笃定。'; } }
      ] },

    { id: 'c10', n: '道祖', gl: 649, requiresDao: 9, title: '道 之 尽 头',
      lines: ['九关尽过，你站到了道的尽头。回头看，身后是一条从青溪镇开始的、',
        '窄得只容一人的路。',
        '天道的声音第一次离你这么近：「走到这里，你想做什么？」'],
      choices: [
        { t: '替了它', run: function (s) { heart(s, 4); return '你抬头，一字一句地说：我要做那个定规矩的人。'; } },
        { t: '把路让开，回去做个人', run: function (s) { heart(s, -4); return '你笑了笑：够了。我想回去看看刘记的灯。'; } },
        { t: '不答，一剑劈上去', run: function (s) { heart(s, -6); return '你什么都没说。剑已经出了。'; } }
      ],
      /* 第十章读完 → 进结局场景（这就是"完整闭环"的终点） */
      after: function () { G.game.changeScene('ending'); } }
  ];

  /* 三结局（`save.daoHeart` 是唯一分水岭） */
  var ENDINGS = {
    zheng: {
      id: 'zheng', n: '证道', gl: '金',
      lines: ['你替了天道。', '从此云海之上多了一道规矩，少了一个人。',
        '青溪镇的刘记杂货那年多了一笔无名汇款，账上写着四个字：「故人所寄」。'],
      tail: '证道 · 你成了规矩本身'
    },
    fan: {
      id: 'fan', n: '化凡', gl: '玉',
      lines: ['你把修为散得干干净净。', '回到青溪镇那天，刘掌柜已经老了，认了你半天才笑出来。',
        '你在他铺子后面种了三年药。夜里偶尔梦见自己在云上走，醒来只觉得是个好梦。'],
      tail: '化凡 · 你把人间的日子过完了'
    },
    ni: {
      id: 'ni', n: '逆天', gl: '血',
      lines: ['你的剑劈开了那道声音。', '然后你听见整个天地一起响了一下 —— 像什么很旧的东西碎了。',
        '没有人知道后来发生了什么。只知道那一年，四界的天，都下过一场黑雨。'],
      tail: '逆天 · 你赢了，也什么都没剩下'
    }
  };

  var index = {};
  LIST.forEach(function (c) { index[c.id] = c; });

  function doneIds(save) {
    if (!save.chapters) save.chapters = [];   /* 就地补默认（不写存档迁移） */
    return save.chapters;
  }
  function isDone(save, id) { return doneIds(save).indexOf(id) >= 0; }
  function markDone(save, id) {
    var a = doneIds(save);
    if (a.indexOf(id) < 0) a.push(id);
  }
  /* 道界九关的进度读取（**唯一口**）。`save.daoCleared` 是**本世**记录（每世重爬，
     见 storage.js:173），所以"九关尽过"永远指**本世真的打过九关** ——
     不能靠跨世继承的境界把它糊过去。 */
  function daoCleared(save) {
    var a = (save && save.daoCleared) || [], n = 0;
    for (var i = 0; i < a.length; i++) if (a[i]) n++;
    return n;
  }
  function daoTotal() {
    return (G.Data.dungeons && G.Data.dungeons.daoCount)
      ? G.Data.dungeons.daoCount() : 9;
  }

  /* 下一章：**必须按顺序**（前章未了不跳章）、境界达标、且**额外门槛**满足。
     ⚠️ v0.73.0 补上末章的 `requiresDao` 闸：此前 c10 只看 `gl >= 649`，
        而九关第 6 关的锚点恰是 gl 648 —— 玩家只打通六关、再闭关修进道祖境，
        就能看到末章那句「九关尽过，你站到了道的尽头」，**后三关（道则傀儡 /
        大道化身 / 合道）一关没打**。台词说九关，代码只看境界，这是纯静默的
        "剧情与数值分叉"（HANDOVER 记的"完整闭环不能销项"就是这条）。 */
  function pendingFor(save) {
    /* v0.84：旧十章链休眠，主线由 Arcs 情感世接管（诸世情感 v1.0 §9 E-G）。 */
    return null;
  }
  function _pendingForLegacy(save) {
    var gl = (save && save.globalLevel) || 1;
    for (var i = 0; i < LIST.length; i++) {
      var c = LIST[i];
      if (isDone(save, c.id)) continue;
      /* 前面还有没做完的 → 这一章先不弹 */
      for (var j = 0; j < i; j++) if (!isDone(save, LIST[j].id)) return null;
      if (gl < c.gl) return null;
      if (c.requiresDao && daoCleared(save) < c.requiresDao) return null;
      return c;
    }
    return null;
  }

  /* 下一章**为何不弹**（面板引导用）。返回 null 表示"没有待推进的章"，
     否则 `{ chapter, reason:'realm'|'dao', need, have }`。
     ⚠️ 必须与 pendingFor **同源**：pendingFor 每次 `return null` 都在这儿有对应支，
        两处判据要一起改 —— 否则会出现"面板说差 3 关、其实卡在境界"这种反向误导。 */
  function blockedBy(save) {
    /* v0.84：与 pendingFor 同源休眠。 */
    return null;
  }
  function _blockedByLegacy(save) {
    var gl = (save && save.globalLevel) || 1;
    for (var i = 0; i < LIST.length; i++) {
      var c = LIST[i];
      if (isDone(save, c.id)) continue;
      for (var j = 0; j < i; j++) if (!isDone(save, LIST[j].id)) return null;
      if (gl < c.gl) return { chapter: c, reason: 'realm', need: c.gl, have: gl };
      if (c.requiresDao && daoCleared(save) < c.requiresDao) {
        return { chapter: c, reason: 'dao', need: c.requiresDao, have: daoCleared(save) };
      }
      return null;
    }
    return null;
  }
  function progressOf(save) {
    var n = 0;
    LIST.forEach(function (c) { if (isDone(save, c.id)) n++; });
    return { done: n, total: LIST.length };
  }
  /* 三结局判据（**唯一口径**：只看道心） */
  function endingOf(save) {
    var h = (save && save.daoHeart) || 0;
    if (h >= 4) return ENDINGS.zheng;
    if (h <= -4) return ENDINGS.ni;
    return ENDINGS.fan;
  }

  G.Data = G.Data || {};
  G.Data.Chapters = {
    list: LIST,
    ENDINGS: ENDINGS,
    byId: function (id) { return index[id] || null; },
    isDone: isDone,
    markDone: markDone,
    pendingFor: pendingFor,
    blockedBy: blockedBy,
    daoCleared: daoCleared,
    daoTotal: daoTotal,
    progressOf: progressOf,
    endingOf: endingOf,
    heartOf: function (save) { return (save && save.daoHeart) || 0; }
  };
})();
