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

  hooks.menu = function (scene) { G.Overlays.openChar(scene); };

  /* 门 → 对应室内地图（镇内三栋房子都能走进去） */
  var DOOR_TO_MAP = { home: 'town_home', shop: 'town_shop', market: 'town_market' };

  hooks.onInteract = function (o, scene) {
    if (o.type !== 'door') return;
    var to = DOOR_TO_MAP[o.id];
    if (!to) { G.game.toast('门锁着，推不开'); return; }
    scene._transition({ to: to, spawn: G.Data.maps[to].spawn });
  };

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

  /* 突破入口：小境界直接升；大境界扣丹后进心魔战 */
  function doBreak(scene) {
    var save = G.game.save;
    var r = G.Player.breakthrough(save);
    if (r.ok) {
      G.game.toast('突破成功 —— ' + r.info.n);
      openCult(scene);
      return;
    }
    if (r.big) {
      var b = G.Player.startBigBreak(save);
      if (!b.ok) { G.game.toast(b.reason); openCult(scene); return; }
      G.game.toast('「' + b.pill + '」已服下……问心魔劫起');
      scene.clearOverlay();
      G.game.changeScene('battle', { script: 'heartDemon', mapId: 'town' });
      return;
    }
    G.game.toast(r.reason);
    openCult(scene);
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
    if (scene.overlay === 'dream') {
      G.Overlays.frame(x, save.world.vessel + ' · 珠内梦境');
      var dl = [
        '尘逆残影立于星河之下，回身看你。',
        '“逆命珠内一日，世上不过一瞬。”',
        '“此间灵气充足，先化开再说。”'
      ];
      dl.forEach(function (l, i) {
        G.UI.text(x, { x: 84, y: 76 + i * 28 }, l, 13.5, G.UI.C.text);
      });
      G.UI.textOut(x, { x: 240, y: 172 }, '灵气 +2500', 16, G.UI.C.goldHi, 'center');
    } else if (scene.overlay === 'cult') {
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
    } else if (scene.overlay === 'shenbo1') {
      G.Overlays.frame(x, '药铺 · 沈伯');
      var lines = [
        '“你既在我药铺学徒，总不能不识山中险恶。”',
        '“从镇口往南上翠微山，打赢一头妖兽，',
        '便算出师第一步。”'
      ];
      lines.forEach(function (l, i) {
        G.UI.text(x, { x: 96, y: 80 + i * 28 }, l, 14, G.UI.C.text);
      });
    } else if (scene.overlay === 'shenboIdle') {
      G.Overlays.frame(x, '药铺 · 沈伯');
      var t;
      if (save.quest.step === 'm0-2') t = '“雪夜将至，山神庙……去看看吧。”';
      else if (save.quest.step === 'm0-3') t = '“得了机缘，便好生消化，莫要声张。”';
      else t = '“修行在己，好生努力。”';
      G.UI.text(x, { x: 96, y: 110 }, t, 14, G.UI.C.text);
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
    } else if (scene.overlay === 'char') {
      G.Overlays.renderChar(x);
    }
  };

  G.scenes.town = G.Explore.create('town', hooks);

  /* ============================================================
     室内场景：三栋房屋共用一套壳（同样的菜单 / 覆盖层渲染），
     只有"家具动作表"不同。
     ============================================================ */
  function makeInterior(mapId, acts) {
    return G.Explore.create(mapId, {
      menu: function (scene) { G.Overlays.openChar(scene); },
      onInteract: function (o, scene) {
        if (o.type !== 'furn') return;
        var fn = acts[o.act];
        if (fn) { fn(scene); return; }
        G.game.toast(o.label ? (o.label + '　没什么可做的') : '没什么可做的');
      },
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
