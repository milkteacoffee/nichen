/* 青溪镇：探索引擎包装，建筑门触发覆盖层 */
(function () {
  var SHOP_ITEMS = [
    { id: '回春丹', n: '回春丹', price: 30, d: '回复35%气血' },
    { id: '解毒丹', n: '解毒丹', price: 20, d: '解除中毒' },
    { id: '甘霖丹', n: '甘霖丹', price: 20, d: '解除灼烧' },
    { id: '舒筋丹', n: '舒筋丹', price: 20, d: '解除麻痹' },
    { id: '解封符', n: '解封符', price: 25, d: '解除封印' },
    { id: '回春诀', n: '《回春诀》', price: 180, d: '治疗功法', skill: true },
    { id: '淬体突破丹', n: '淬体突破丹', price: 200, d: '突破所需' }
  ];
  var SP = { x: 50, y: 16, w: 380, h: 238 };

  var hooks = {};

  hooks.menu = function (scene) { G.TianDao.openSettings(scene); };

  /* 天道面板的点击/按键转发（输入框失焦、Esc 关闭） */
  hooks.overlayTap = G.TianDao.overlayTap;
  hooks.overlayKey = G.TianDao.overlayKey;

  /* 门 → 对应室内地图（镇内三栋房子都能走进去） */
  var DOOR_TO_MAP = { home: 'town_home', shop: 'town_shop', market: 'town_market' };

  hooks.onInteract = function (o, scene) {
    if (o.type !== 'door') return;
    var to = DOOR_TO_MAP[o.id];
    if (!to) { G.game.toast('门锁着，推不开'); return; }
    scene._transition({ to: to, spawn: G.Data.maps[to].spawn });
  };

  /* ============================================================
     NPC：站桩对话（探图 v0.2 §NPC —— 有任务挂标记，无任务聊 1-2 句风味台词）
     覆盖层名 → 台词内容。台词由 G.Overlays.dialog 渲染（立绘 + 名牌 + 自动折行）。
     ============================================================ */
  var DIALOGS = {
    shenbo1: {
      title: '药铺 · 沈伯', name: '沈伯', portrait: 'shenbo',
      lines: [
        '“你既在我药铺学徒，”',
        '“总不能不识山中险恶。”',
        '“从镇口往南上翠微山，打赢一头妖兽，”',
        '“便算出师第一步。”'
      ]
    },
    shenboIdle: function (save) {
      var t;
      if (save.quest.step === 'm0-2') t = '“雪夜将至，山神庙……去看看吧。”';
      else if (save.quest.step === 'm0-3') t = '“得了机缘，便好生消化，莫要声张。”';
      else t = '“修行在己，好生努力。”';
      return { title: '药铺 · 沈伯', name: '沈伯', portrait: 'shenbo', lines: [t] };
    },
    dream: function (save) {
      return {
        title: (save.world.vessel || '逆命珠') + ' · 珠内梦境',
        name: '尘逆残影', portrait: 'demon',
        lines: [
          '尘逆残影立于星河之下，回身看你。',
          '“逆命珠内一日，世上不过一瞬。”',
          '“此间灵气充足，先化开再说。”'
        ],
        reward: '灵气 +2500'
      };
    },
    chatWasher: {
      title: '青溪镇 · 井边', name: '浣衣妇', portrait: 'villager',
      lines: ['“这井水甜，比山泉还养人。”', '“后山近来不太平，”', '“莫要一个人往深处走。”']
    },
    chatWoodman: {
      title: '青溪镇 · 院外', name: '老樵夫', portrait: 'villager',
      lines: ['“柴砍得再多，也砍不过命。”', '“破庙那头的风，夜里听着不像风。”']
    }
  };

  function openChat(scene, key) {
    scene.setOverlay(key, [
      new G.UI.Btn({ x: 190, y: 214, w: 100, h: 24, small: true,
        label: '知道了', onClick: function () { scene.clearOverlay(); } })
    ]);
  }

  var NPC_ACTS = {
    shenbo: function (scene) { shenBo(scene); },
    market: function (scene) { openMarket(scene); },
    'chat.washer': function (scene) { openChat(scene, 'chatWasher'); },
    'chat.woodman': function (scene) { openChat(scene, 'chatWoodman'); }
  };

  function onNpc(npc, scene) {
    var fn = NPC_ACTS[npc.act];
    if (fn) { fn(scene); return; }
    G.game.toast(npc.name + '　没有说话');
  }

  /* 头顶任务标记：！有话可接 / ？可交付，无任务不挂 */
  function npcMark(npc) {
    if (npc.act !== 'shenbo') return null;
    var save = G.game.save, q = save.quest;
    if (q.step === 'm0-1') return q.flags.won1 ? '?' : '!';
    if (q.step === 'm0-4' && save.globalLevel >= 9 && !q.flags.gotBreakPill) return '?';
    return null;
  }

  hooks.onNpc = onNpc;
  hooks.npcMark = npcMark;

  /* ===== 沈家小院 ===== */
  /* 打坐（蒲团）：灵气 + 年龄推进（轮回 v0.4 §3.2） */
  function restOnBed(scene) {
    var save = G.game.save, st = G.Player.computeStats(save);
    save.hp = st.maxhp;
    G.Storage.saveCurrent(save);
    G.game.toast('榻上安歇，气血全复');
  }
  function meditateOnCushion(scene) {
    var save = G.game.save;
    var g = G.Player.meditate(save, 120);
    var yrs = G.Player.agePush(save, 'meditate', 120);
    G.game.toast('灵气 +' + g + (yrs ? '　岁月 +' + yrs : ''));
  }

  /* 突破入口：口径统一在 G.Overlays.doBreak（底栏「功法」页也调它）。
     珠内空间这里只是"另一个入口"，不另写一份规则。 */
  function doBreak(scene) {
    G.Overlays.doBreak(scene);
  }

  function openCult(scene) {
    var save = G.game.save, q = save.quest, btns = [];

    /* m0-3 珠内梦境：首次进入演一段、赠 2500 灵气，任务推进到 m0-4 */
    if (q.step === 'm0-3' && !q.flags.dream) {
      save.qi = (save.qi || 0) + 2500;
      q.flags.dream = true;
      q.step = 'm0-4';
      G.Player.chronicle(save, 'dream', '珠内空间，梦境点化');
      G.Storage.saveCurrent(save);
      scene.setOverlay('dream', [
        new G.UI.Btn({ x: 190, y: 216, w: 100, h: 24, small: true, variant: 'gold',
          label: '醒来', onClick: function () { openCult(scene); } })
      ]);
      return;
    }

    var bs = G.Player.breakState(save);
    btns.push(new G.UI.Btn({
      x: SP.x + SP.w - 152, y: 58, w: 134, h: 26,
      small: true, variant: bs.ready ? 'gold' : 'default',
      label: bs.big ? '突破 · 问心魔劫' : '突破 · ' + bs.next.n,
      disabled: !bs.ready,
      onClick: function () { doBreak(scene); }
    }));

    Object.keys(save.skills).forEach(function (id, i) {
      var sd = G.Data.skills[id], lv = save.skills[id].lv;
      var cost = G.Player.skillCost(sd, lv);
      btns.push(new G.UI.Btn({
        x: SP.x + SP.w - 110, y: 104 + i * 26, w: 92, h: 20,
        small: true, label: '修炼 ' + cost + '力',
        disabled: save.po < cost,
        onClick: function () {
          save.po -= cost; save.skills[id].lv += 1;
          G.Storage.saveCurrent(save);
          G.game.toast(sd.n + ' 精进至 Lv' + save.skills[id].lv);
          openCult(scene);
        }
      }));
    });
    btns.push(G.Overlays.closeBtn(scene, 216));
    scene.setOverlay('cult', btns);
  }

  /* ===== 沈伯 ===== */
  function shenBo(scene) {
    var save = G.game.save, q = save.quest;
    if (q.step === 'm0-1' && !q.flags.won1) {
      scene.setOverlay('shenbo1', [
        new G.UI.Btn({ x: 190, y: 214, w: 100, h: 24, small: true,
          variant: 'gold', label: '知道了',
          onClick: function () { scene.clearOverlay(); } })
      ]);
      return;
    }
    if (q.step === 'm0-1' && q.flags.won1) {
      save.stone += 50; q.step = 'm0-2';
      G.game.toast('灵石 +50；雪夜可去山神庙');
      scene.clearOverlay();
      return;
    }
    if (q.step === 'm0-4' && save.globalLevel >= 9 && !q.flags.gotBreakPill) {
      save.items['淬体突破丹'] = (save.items['淬体突破丹'] || 0) + 1;
      save.stone += 200;
      q.flags.gotBreakPill = true;
      G.game.toast('沈伯赠你淬体突破丹，灵石 +200');
      scene.clearOverlay();
      return;
    }
    scene.setOverlay('shenboIdle', [
      new G.UI.Btn({ x: 190, y: 214, w: 100, h: 24, small: true,
        variant: 'gold', label: '知道了',
        onClick: function () { scene.clearOverlay(); } })
    ]);
  }

  /* ===== 刘记杂货 ===== */
  function openMarket(scene) {
    var save = G.game.save, btns = [];
    SHOP_ITEMS.forEach(function (it, i) {
      var owned = it.skill && save.skills[it.id];
      btns.push(new G.UI.Btn({
        x: SP.x + SP.w - 76, y: 50 + i * 21, w: 60, h: 18,
        small: true, label: owned ? '已习得' : '购买',
        disabled: save.stone < it.price || owned,
        onClick: function () {
          save.stone -= it.price;
          if (it.skill) save.skills[it.id] = { lv: 1 };
          else save.items[it.id] = (save.items[it.id] || 0) + 1;
          openMarket(scene);
        }
      }));
    });
    /* 卖妖丹 */
    btns.push(new G.UI.Btn({
      x: SP.x + SP.w - 76, y: 50 + SHOP_ITEMS.length * 21, w: 60, h: 18,
      small: true, label: '卖妖丹', disabled: !save.items['妖丹'],
      onClick: function () {
        save.items['妖丹'] -= 1;
        if (!save.items['妖丹']) delete save.items['妖丹'];
        save.stone += 15;
        openMarket(scene);
      }
    }));
    btns.push(new G.UI.Btn({
      x: 190, y: 221, w: 100, h: 20, small: true,
      label: '离开', onClick: function () { scene.clearOverlay(); }
    }));
    scene.setOverlay('market', btns);
  }

  hooks.renderOverlay = function (x, scene) {
    var save = G.game.save;
    if (G.Overlays.route(x, scene)) return;
    /* 对话类覆盖层统一走 dialog（立绘 + 名牌 + 折行台词） */
    var d = DIALOGS[scene.overlay];
    if (d) {
      G.Overlays.dialog(x, typeof d === 'function' ? d(save) : d);
      return;
    }
    if (scene.overlay === 'cult') {
      var bs = G.Player.breakState(save);
      G.Overlays.dim(x);
      G.UI.frame(x, SP, save.world.vessel + ' · 珠内空间', { paper: true });
      G.UI.text(x, { x: SP.x + 18, y: 44 },
        '境界 ' + G.Player.realmInfo(save.globalLevel).n
          + '　灵气 ' + bs.have + ' / ' + bs.need, 12, G.UI.C.text);
      G.UI.textOut(x, { x: SP.x + SP.w - 18, y: 44 },
        '灵力 ' + Math.floor(save.po), 12, G.UI.C.text, 'right');
      G.UI.text(x, { x: SP.x + 18, y: 64 }, bs.reason || '气机圆融，可破境矣', 11,
        bs.ready ? G.UI.C.gold : G.UI.C.textDim);

      G.UI.text(x, { x: SP.x + 18, y: 92 }, '功 法', 11.5, G.UI.C.gold);
      G.UI.divider(x, SP.x + SP.w / 2, 99, SP.w - 36);
      Object.keys(save.skills).forEach(function (id, i) {
        var sd = G.Data.skills[id];
        var y = 108 + i * 26;
        G.UI.text(x, { x: SP.x + 18, y: y },
          (sd ? sd.n : id) + ' · Lv' + save.skills[id].lv, 12, G.UI.C.text);
        if (sd) {
          G.UI.text(x, { x: SP.x + 152, y: y + 1 }, sd.elem, 10,
            G.Data.elem.color[sd.elem] || G.UI.C.textDim);
        }
      });
    } else if (scene.overlay === 'market') {
      G.Overlays.dim(x);
      G.UI.panel(x, SP, '#141927');
      G.UI.text(x, { x: SP.x + 18, y: SP.y + 10 },
        '刘记杂货', 16, G.UI.C.goldHi);
      G.UI.text(x, { x: SP.x + SP.w - 18, y: SP.y + 12 },
        '灵石 ' + save.stone, 13, G.UI.C.text, 'right');
      SHOP_ITEMS.forEach(function (it, i) {
        var y = SP.y + 34 + i * 21;
        G.UI.text(x, { x: SP.x + 18, y: y }, it.n, 12, G.UI.C.text);
        G.UI.text(x, { x: SP.x + 120, y: y }, it.d, 11, G.UI.C.textDim);
        G.UI.text(x, { x: SP.x + SP.w - 92, y: y },
          it.price + ' 灵石', 11, G.UI.C.gold, 'right');
      });
      var y = SP.y + 34 + SHOP_ITEMS.length * 21;
      G.UI.text(x, { x: SP.x + 18, y: y }, '妖丹回收', 12, G.UI.C.text);
      G.UI.text(x, { x: SP.x + SP.w - 92, y: y },
        '15 灵石', 11, G.UI.C.gold, 'right');
    }
  };

  G.scenes.town = G.Explore.create('town', hooks);

  /* ============================================================
     室内场景：三栋房屋共用一套壳（同样的菜单 / 覆盖层渲染），
     只有"家具动作表"不同。
     ============================================================ */
  function makeInterior(mapId, acts) {
    return G.Explore.create(mapId, {
      menu: function (scene) { G.TianDao.openSettings(scene); },
      overlayTap: G.TianDao.overlayTap,
      overlayKey: G.TianDao.overlayKey,
      onInteract: function (o, scene) {
        if (o.type !== 'furn') return;
        var fn = acts[o.act];
        if (fn) { fn(scene); return; }
        G.game.toast(o.label ? (o.label + '　没什么可做的') : '没什么可做的');
      },
      /* 室内也站人：药铺柜台后是沈伯、杂货铺柜台后是刘掌柜。
         和家具动作分开走 —— 点人也行、点柜台也行，两条路都通。 */
      onNpc: onNpc,
      npcMark: npcMark,
      renderOverlay: hooks.renderOverlay
    });
  }

  /* 珠内空间：拿到逆命珠之前里面空空如也（等价于旧版 home 面板的 gated） */
  function useVessel(scene) {
    var q = G.game.save.quest;
    if (q.step === 'm0-1' || q.step === 'm0-2') {
      G.game.toast('珠中空空如也，尚无气机可引');
      return;
    }
    openCult(scene);
  }

  G.scenes.town_home = makeInterior('town_home', {
    rest: restOnBed,
    meditate: meditateOnCushion,
    cult: useVessel
  });
  G.scenes.town_shop = makeInterior('town_shop', {
    shenbo: function (scene) { shenBo(scene); }
  });
  G.scenes.town_market = makeInterior('town_market', {
    market: function (scene) { openMarket(scene); }
  });
})();
