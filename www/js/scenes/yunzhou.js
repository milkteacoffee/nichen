/* 云州城（M2，v0.65.0，用户「M2 云州城主线」）
   ------------------------------------------------------------
   凡界第二座城。M1 结尾「离乡，往云州城去」指向的就是这里。
   主线三步（插在 m1-7 与 m1done 之间）：
     m2-1 云州城   —— 进城，见城主府执事，领「云州论道」的帖子
     m2-2 云州论道 —— 入一处秘境带回战果（判据 = 已通关过秘境，用**已有系统**判定）
     m2-3 灵界之讯 —— 回论道台复命，裁判告知灵界之门 → 推进到 m1done（分叉线在此接管）
   ⚠️ 判据一律用**可测量的状态**（`dungeonSlot`/`dungeonFarm`）——
      "去跟某人说话"这类无法自动判定的条件会让主线卡死且没有出口（设计稿 §6 的教训）。
   ⚠️ 建筑**不做室内**（本轮取舍，见 maps.js 的注释）；服务由街面 NPC 直接给：
      坊市 `G.ShopService.open` / 投宿 `G.RegionServices.innRest` /
      打造 `G.RegionServices.openForge` / 炼丹 `G.RegionServices.openAlchemy`。
   ⚠️ `hooks.overlayTap` 必须挂上 —— 地图面板的节点传送挂在 `G.TianDao.overlayTap`，
      场景不转发它就**在这张图里点不动地图节点**（且不报错）。
   ============================================================ */
(function () {
  var hooks = {};
  hooks.menu = function (scene) { G.TianDao.openSettings(scene); };
  hooks.overlayTap = G.TianDao.overlayTap;
  hooks.overlayKey = G.TianDao.overlayKey;

  /* 对话表：键 = overlay 名，值 = G.Overlays.dialog 的入参。
     ⚠️ 排版约束：台词列从 y≈81 起、每行 20px，底部按钮在 214 ——
        所以**每段最多 5 个折行**。写长了会压到按钮上，而且这是静默的。 */
  var D = {
    m2_1: {
      title: '云州城 · 城主府', name: '城主府执事', portrait: 'villager',
      lines: [
        '执事把一枚木牌推到你面前：',
        '“云州论道，三年一度。胜者可问一句——灵界的门，往哪开。”',
        '“你从青溪镇来？那更该去。那儿的人，一辈子出不了山。”'
      ]
    },
    m2_1b: {
      title: '云州城 · 城主府', name: '城主府执事', portrait: 'villager',
      lines: ['“木牌已给你了。”', '“论道台在西街尽头，去罢。”']
    },
    m2_2: {
      title: '云州论道台', name: '论道台裁判', portrait: 'keeper',
      lines: [
        '裁判看了一眼你的木牌，没接。',
        '“空手来的？先去秘境里拿点东西出来给我看。”',
        '“能活着回来的，才配站上台。”'
      ]
    },
    m2_3: {
      title: '云州论道台', name: '论道台裁判', portrait: 'keeper',
      lines: [
        '裁判接过战果，沉默半晌，忽然笑了。',
        '“你比我想的能扛。”',
        '“灵界之门不在天上——在落霞镇西边那座废矿底下。”',
        '“去罢。云州留不住你这种人。”'
      ]
    },
    m2_done: {
      title: '云州论道台', name: '论道台裁判', portrait: 'keeper',
      lines: ['“路已经告诉你了。”', '“剩下的，是你自己的事。”']
    },
    yz_story: {
      title: '云州城 · 街口', name: '说书人', portrait: 'villager',
      lines: [
        '“话说三百年前，云州城还没城墙。”',
        '“那时天上掉下来一块碑，砸出个坑——就是如今的论道台。”',
        '“碑上八个字：修为可夺，道心难偷。”'
      ]
    },
    yz_smith: {
      title: '云州铁坊', name: '铁坊匠人', portrait: 'villager',
      lines: ['“有材料就自己上砧。”', '“手底下见真章，别跟我讲什么道法。”']
    },
    yz_dan: {
      title: '丹霞坊', name: '丹霞坊主', portrait: 'villager',
      lines: ['“丹炉借你用，材料自备。”', '“炸了别怪我没提醒。”']
    },
    yz_inn: {
      title: '云州客栈', name: '客栈小二', portrait: 'keeper',
      lines: ['“投宿？灵石给够就行。”', '“云州的夜，比别处冷。”']
    },
    yz_market: {
      title: '云州西市', name: '西市掌柜', portrait: 'keeper',
      lines: ['“看看要什么。”', '“云州的货，比镇上全。”']
    }
  };

  /* 弹一段对话：**按钮类型只有一个**（`G.UI.Btn`），别去发明第二个。
     ⚠️ overlay 名必须与 `D` 的键一致 —— 写错的话 `renderOverlay` 找不到对话表，
        结果是"点了 NPC 只有按钮、没有台词"（静默，只有肉眼能看出来）。 */
  function sayBtn(scene, key) {
    scene.setOverlay(key, [
      new G.UI.Btn({
        x: 190, y: 214, w: 100, h: 24, small: true,
        label: '知道了', onClick: function () { scene.clearOverlay(); }
      })
    ]);
  }

  /* 主线推进：只在这里改 `quest.step`（一处口径） */
  function advanceTo(save, step) {
    save.quest = save.quest || { step: 'm0-1', flags: {} };
    if (save.quest.step === step) return false;
    save.quest.step = step;
    G.Storage.saveCurrent(save);
    return true;
  }

  var ACTS = {
    /* —— 主线：城主府执事（m2-1）—— */
    steward: function (scene) {
      var save = G.game.save, st = save.quest.step;
      if (st === 'm2-1') {
        advanceTo(save, 'm2-2');
        G.game.toast('主线推进 —— 云州论道');
        sayBtn(scene, 'm2_1');
        return;
      }
      sayBtn(scene, 'm2_1b');
    },
    /* —— 主线：论道台裁判（m2-2 交差 / m2-3 收束）—— */
    judge: function (scene) {
      var save = G.game.save, st = save.quest.step;
      var hasRun = (save.dungeonSlot || 0) > 0 || (save.dungeonFarm || 0) > 0;
      if (st === 'm2-2') {
        if (!hasRun) { sayBtn(scene, 'm2_2'); return; }
        advanceTo(save, 'm2-3');
        G.game.toast('主线推进 —— 灵界之讯');
        sayBtn(scene, 'm2_3');
        /* m2-3 是最后一步：读完就交给分叉线（tickQuest 看到 m1done 会自动分叉） */
        advanceTo(save, 'm1done');
        return;
      }
      if (st === 'm2-3') { sayBtn(scene, 'm2_3'); return; }
      sayBtn(scene, 'm2_done');
    },
    /* —— 服务：复用已有服务，不另写一套 —— */
    market: function (scene) { G.ShopService.open(scene, 'shop'); },
    inn: function (scene) { G.RegionServices.innRest(scene); },
    smith: function (scene) { G.RegionServices.openForge(scene); sayBtn(scene, 'yz_smith'); },
    dan: function (scene) { G.RegionServices.openAlchemy(scene); sayBtn(scene, 'yz_dan'); },
    story: function (scene) { sayBtn(scene, 'yz_story'); }
  };

  hooks.onInteract = function (o, scene) {
    if (o.type === 'door') {
      /* 建筑门 → 程序化室内（#47 原地精细化）：服务类室内给真实交易/投宿/打造/炼丹。 */
      var md = G.Data.maps.yunzhou, st = null;
      (md.structures || []).forEach(function (x) { if (x.id === o.id) st = x; });
      if (!st) return;
      var iid = 'int.yunzhou.' + st.id;
      var imd = G.InteriorGen.ensure(G.game.save, iid, st, { id: 'yunzhou', map: 'yunzhou', n: '云州城' });
      if (!imd) { G.game.toast('门锁着，推不开'); return; }
      scene._transition({ to: iid, spawn: imd.spawn });
      return;
    }
    if (o.type !== 'npc') return;
    var fn = ACTS[o.act];
    /* ⚠️ 顺序（v0.92.0）：**主线 > 支线 > 服务**，与青溪镇**完全一致**。
       青溪镇刘掌柜的既有实现就是这个次序（`if (!mainBeat && sideTalk(...)) return;
       openMarket();` 见 town.js）—— 两镇次序不同会让玩家困惑
       （"甲镇先接任务、乙镇却直接开店"）。
       · **主线优先**：执事/裁判该推进剧情时不能被支线挡住（回归实测抓到过）；
       · **支线次之**：有可谈的支线就先谈（谈完 `talk` 返回 false，自然落到服务）；
       · **服务兜底**：支线谈完/没有时，才开店/投宿/打造/炼丹。 */
    if (fn && mainlinePending(o.act)) { fn(scene); return; }
    if (G.Data.sideQuests && G.Data.sideQuests.talk) {
      if (G.Data.sideQuests.talk(scene, o.id, '云州城 · 支线', 'villager')) return;
    }
    if (fn) { fn(scene); return; }
    G.game.toast((o.name || '路人') + '　没什么可说的');
  };

  /* 该 act 现在有没有**主线**要推进（有 → 主线优先于支线）。
     只列"既挂主线又可能挂支线"的那两个：执事在 m2-1、裁判在 m2-2/m2-3。 */
  function mainlinePending(act) {
    var st = (G.game.save && G.game.save.quest && G.game.save.quest.step) || '';
    if (act === 'steward') return st === 'm2-1';
    if (act === 'judge') return st === 'm2-2' || st === 'm2-3';
    return false;
  }

  hooks.renderOverlay = function (x, scene) {
    if (G.Overlays.route(x, scene)) return;
    /* 支线对话（v0.92.0）：与青溪镇共用 `sideQuests.dialogOf` 生成文案 */
    if (scene.overlay === 'sideq') {
      var SQ = G.Data.sideQuests;
      var sq = SQ && SQ.byId(G.SideCur);
      var nm = '', npcs = (G.Data.maps.yunzhou.npcs || []);
      for (var ni = 0; ni < npcs.length; ni++) {
        if (sq && npcs[ni].id === sq.giver) { nm = npcs[ni].name; break; }
      }
      G.Overlays.dialog(x, SQ.dialogOf(G.game.save, '云州城 · 支线', nm || '城中人', 'villager'));
      return;
    }
    var d = D[scene.overlay];
    if (d) G.Overlays.dialog(x, d);
  };

  G.scenes.yunzhou = G.Explore.create('yunzhou', hooks);
})();
