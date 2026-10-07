/* 天道之战 · 编排场景（v0.86，v0.88 文案富化）
   ------------------------------------------------------------
   驱动五阶段战斗：每阶段先 brief（读冷语 + 机制）→ 进 battle（script 'tiandao'）
   → 胜：落阶段检查点、过场短句、进下一阶段；败：自当前阶段重试（保底），
   系统层不嘲讽。五阶段尽破 → 解锁并自动进入第三结局「斩天道·燃尽」。
   进度存 save.tdWar（检查点，跨退出保留）。
   ============================================================ */
(function () {
  var scene = {
    smooth: true,
    t: 0,
    phase: 'brief',      /* brief | won | lost | finale */
    stage: 1,
    line: '',
    buttons: [],

    enter: function () {
      var save = G.game.save, meta = G.game.meta;
      save.tdWar = save.tdWar || { stage: 1, done: false };
      this.t = 0;
      var res = G.game._tdResult;
      G.game._tdResult = null;

      if (res && res.win) {
        save.tdWar.stage = Math.max(save.tdWar.stage, res.stage);
        G.Storage.saveCurrent(save);
        if (res.stage >= 5) { this._finale(); return; }
        this.stage = res.stage + 1;
        save.tdWar.stage = this.stage;
        this.phase = 'won';
      } else if (res && !res.win) {
        this.stage = res.stage;
        this.phase = 'lost';
      } else {
        this.stage = save.tdWar.stage || 1;
        this.phase = 'brief';
      }
      this._build();
    },

    _info: function () { return G.Data.tiandaowar.stageInfo(this.stage); },

    _launch: function () {
      G.game.changeScene('battle', {
        script: 'tiandao', tdStage: this.stage, mapId: 'tiandaowar'
      });
    },

    _finale: function () {
      var save = G.game.save, meta = G.game.meta;
      save.tdWar.done = true;
      meta.tdWarCleared = true;
      G.Player.chronicle(save, 'tdWar', '斩天道——云幕冷眼碎');
      G.Storage.saveCurrent(save);
      G.Storage.saveMeta(meta);
      /* 自动进入第三结局 */
      G.game._autoEnding = 'defy';
      G.game.changeScene('ending');
    },

    _build: function () {
      var self = this;
      this.buttons = [];
      if (this.phase === 'brief' || this.phase === 'won') {
        this.buttons.push(new G.UI.Btn({
          x: 152, y: 208, w: 96, h: 26, small: true, variant: 'gold',
          label: this.phase === 'won' ? '继续迎战' : '开　战',
          onClick: function () { self._launch(); }
        }));
        this.buttons.push(new G.UI.Btn({
          x: 258, y: 210, w: 92, h: 22, small: true, variant: 'ghost',
          label: '退回抉择', onClick: function () { G.game.changeScene('ending'); }
        }));
      } else if (this.phase === 'lost') {
        this.buttons.push(new G.UI.Btn({
          x: 152, y: 208, w: 96, h: 26, small: true, variant: 'gold',
          label: '重整再战', onClick: function () { self._launch(); }
        }));
        this.buttons.push(new G.UI.Btn({
          x: 258, y: 210, w: 92, h: 22, small: true, variant: 'ghost',
          label: '退回抉择', onClick: function () { G.game.changeScene('ending'); }
        }));
      }
    },

    onTap: function () { /* 按钮驱动 */ },

    update: function (dt) { this.t += dt; },

    render: function (x) {
      var info = this._info();
      /* 暗空底 */
      var g = x.createLinearGradient(0, 0, 0, 272);
      g.addColorStop(0, '#070a14'); g.addColorStop(0.5, '#0d1424'); g.addColorStop(1, '#070a14');
      x.fillStyle = g; x.fillRect(0, 0, 480, 272);

      /* 中央冷眼虚影（随阶段睁开）*/
      var openP = this.stage / 5;
      x.save();
      x.globalAlpha = 0.5 + 0.1 * Math.sin(this.t * 1.6);
      x.translate(240, 88);
      x.strokeStyle = 'rgba(170,195,240,0.5)'; x.lineWidth = 1.2;
      x.beginPath();
      x.moveTo(-70 * openP - 14, 0);
      x.quadraticCurveTo(0, -34 * openP - 6, 70 * openP + 14, 0);
      x.quadraticCurveTo(0, 34 * openP + 6, -70 * openP - 14, 0);
      x.stroke();
      x.fillStyle = 'rgba(120,150,220,0.25)';
      x.beginPath(); x.arc(0, 0, 12 + openP * 8, 0, 6.2832); x.fill();
      x.restore();

      /* 阶段进度点 */
      for (var i = 1; i <= 5; i++) {
        x.fillStyle = i < this.stage ? '#d8b868' : (i === this.stage ? '#f0e2b0' : '#3a4258');
        x.beginPath(); x.arc(240 + (i - 3) * 30, 140, 4, 0, 6.2832); x.fill();
      }

      /* 阶段标题 */
      G.UI.textOut(x, { x: 240, y: 162 }, '第 ' + this.stage + ' 阶段 · ' + info.n,
        20, '#ece2c8', 'center', 'rgba(0,0,0,0.7)', 3);

      if (this.phase === 'brief') {
        /* 天道冷语（冷漠成谶）*/
        G.UI.text(x, { x: 240, y: 188 }, '「' + info.quote + '」', 11, '#9fb2d0', 'center');
        G.UI.text(x, { x: 240, y: 246 }, info.sub, 10.5, '#aab2c4', 'center');
      } else if (this.phase === 'won') {
        G.UI.text(x, { x: 240, y: 188 }, '冷眼睁得更开了。', 11, '#aeb8cc', 'center');
        G.UI.text(x, { x: 240, y: 246 }, '第 ' + (this.stage - 1) + ' 阶段已破，前路更险。',
          10.5, '#c8b888', 'center');
      } else if (this.phase === 'lost') {
        G.UI.text(x, { x: 240, y: 242 }, '云幕冷漠：再强一线，便可。', 10.5, '#9aa2b4', 'center');
        G.UI.text(x, { x: 240, y: 258 }, '你将自第 ' + this.stage + ' 阶段重整再战，不必从头。',
          10, '#7e8698', 'center');
      }

      for (var b = 0; b < this.buttons.length; b++) this.buttons[b].render(x);
    }
  };

  G.scenes.tiandaowar = scene;
})();
