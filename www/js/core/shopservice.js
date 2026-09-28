/* 商店服务（R3 交易）：室内柜台 → 买/卖覆盖层，自带渲染，按钮走场景 overlay 自动绘制。
 * 由 interiorgen 的 act 'trade' 触发；renderOverlay 先问本服务再回退 Overlays.route。 */
(function () {
  var R = { x: 36, y: 14, w: 408, h: 244 };
  var LY = R.y + 36, ROW_H = 18, MAX_ROWS = 9;

  function worldId() { try { return G.Player.activeWorldId(G.game.meta); } catch (e) { return 'fan'; } }
  function itemName(id) {
    if (G.Data.shops.isGear(id)) { var eq = G.Data.equips.byId(id); return eq ? eq.n : id; }
    return id;
  }

  /* 可卖清单：背包内非装备中的材料/丹药 + 未装备的法宝（各一行，带持有数）。 */
  function sellables(save) {
    var out = [];
    save.items = save.items || {};
    Object.keys(save.items).forEach(function (id) {
      var n = save.items[id];
      if (!n) return;
      if (G.Data.shops.isGear(id)) {
        var eq = save.equip || {};
        if (eq.weapon === id || eq.armor === id || eq.accessory === id) return;
      }
      out.push({ id: id, n: n });
    });
    return out;
  }

  function tabButtons(scene, mode) {
    var ctx = scene._shop;
    return [
      new G.UI.Btn({ x: R.x + 12, y: R.y + 8, w: 56, h: 20, small: true,
        variant: mode === 'buy' ? 'gold' : 'default', label: '买　入',
        onClick: function () { buildBuy(scene); } }),
      new G.UI.Btn({ x: R.x + 74, y: R.y + 8, w: 56, h: 20, small: true,
        variant: mode === 'sell' ? 'gold' : 'default', label: '卖　出',
        onClick: function () { buildSell(scene); } })
    ];
  }
  function leaveBtn(scene) {
    return new G.UI.Btn({ x: R.x + R.w / 2 - 48, y: R.y + R.h - 26, w: 96, h: 20, small: true,
      label: '离　开', onClick: function () { scene.clearOverlay(); } });
  }

  function buildBuy(scene) {
    var save = G.game.save, ctx = scene._shop;
    var list = G.Data.shops.catalog(worldId(), ctx.kind);
    var btns = tabButtons(scene, 'buy');
    list.forEach(function (it, i) {
      if (i >= MAX_ROWS) return;
      btns.push(new G.UI.Btn({ x: R.x + R.w - 72, y: LY + i * ROW_H + 1, w: 58, h: 16, small: true,
        label: '购买', disabled: (save.stone || 0) < it.p,
        onClick: function () {
          if ((save.stone || 0) < it.p) return;
          save.stone -= it.p;
          save.items[it.id] = (save.items[it.id] || 0) + 1;
          G.Storage.saveCurrent(save);
          buildBuy(scene);
        } }));
    });
    btns.push(leaveBtn(scene));
    scene.setOverlay('shop.buy', btns);
  }

  function buildSell(scene) {
    var save = G.game.save, list = sellables(save);
    var btns = tabButtons(scene, 'sell');
    list.forEach(function (row, i) {
      if (i >= MAX_ROWS) return;
      var val = G.Data.shops.sellValue(row.id);
      btns.push(new G.UI.Btn({ x: R.x + R.w - 72, y: LY + i * ROW_H + 1, w: 58, h: 16, small: true,
        label: '售出',
        onClick: function () {
          save.items[row.id] -= 1;
          if (!save.items[row.id]) delete save.items[row.id];
          save.stone = (save.stone || 0) + val;
          G.Storage.saveCurrent(save);
          buildSell(scene);
        } }));
    });
    btns.push(leaveBtn(scene));
    scene.setOverlay('shop.sell', btns);
  }

  function open(scene, kind) {
    scene._shop = { kind: kind || 'shop' };
    buildBuy(scene);
  }

  function render(x, scene) {
    if (scene.overlay !== 'shop.buy' && scene.overlay !== 'shop.sell') return false;
    var ctx = scene._shop, save = G.game.save;
    G.Overlays.dim(x);
    G.UI.frame(x, R, ctx.kind === 'apothecary' ? '药　铺' : '坊　市', { tex: true });
    var i;
    if (scene.overlay === 'shop.buy') {
      var list = G.Data.shops.catalog(worldId(), ctx.kind);
      for (i = 0; i < Math.min(MAX_ROWS, list.length); i++) {
        var y = LY + i * ROW_H + 4;
        G.UI.textOut(x, { x: R.x + 14, y: y }, itemName(list[i].id), 11, G.UI.C.text);
        G.UI.text(x, { x: R.x + 150, y: y }, list[i].p + ' 灵石', 10, G.UI.C.textDim);
      }
    } else {
      var sl = sellables(save);
      if (!sl.length) G.UI.text(x, { x: R.x + 14, y: LY + 10 }, '背包空空，无物可卖', 11, G.UI.C.textDim);
      for (i = 0; i < Math.min(MAX_ROWS, sl.length); i++) {
        var sy = LY + i * ROW_H + 4, val = G.Data.shops.sellValue(sl[i].id);
        G.UI.textOut(x, { x: R.x + 14, y: sy }, itemName(sl[i].id), 11, G.UI.C.text);
        G.UI.text(x, { x: R.x + 150, y: sy }, '×' + sl[i].n + '　售 ' + val, 10, G.UI.C.textDim);
      }
    }
    return true;
  }

  G.ShopService = { open: open, render: render };
})();
