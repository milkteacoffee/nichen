# -*- coding: utf-8 -*-
"""E-C：reincarnation 增加「命途」步（life≥2 时天道命定/浮世轮回二选一）。"""
import io

p = r'D:\Projects\nichen\www\js\scenes\reincarnation.js'
s = io.open(p, encoding='utf-8').read()

def rep(a, b):
    global s
    assert s.count(a) == 1, a[:70]
    s = s.replace(a, b)

# enter 重置 arcChoice
rep("""      this.step = 'linggen'; this._finished = false;""",
"""      this.step = 'linggen'; this._finished = false;
      this.arcChoice = null;""")

# talent 步 primary：有下一命定世 → 先进 arcpath
rep("""        /* 每世仅一项先天禀赋，返回、刷新均不能重新抽取。 */
        primary('入世', function () {
          /* v0.71.0：先播「6 岁 → 10 岁 → 16 岁」成长演出，播完才真正入世。 */
          self.step = 'grow'; self.grow = 0; self.growT = 0;
          self._buildButtons();
        });""",
"""        /* 每世仅一项先天禀赋，返回、刷新均不能重新抽取。 */
        primary(G.Arcs.next(G.game.meta) ? '择命途' : '入世', function () {
          var next = G.Arcs.next(G.game.meta);
          if (next) { self.step = 'arcpath'; self._buildButtons(); return; }
          self._beginGrow();
        });""")

# 在 _buildButtons 末尾的 if/else 链中加入 arcpath 分支（插在 grow 分支前）
rep("""      } else if (this.step === 'grow') {""",
"""      } else if (this.step === 'arcpath') {
        back('返回禀赋', function () { self.step = 'talent'; self._buildButtons(); });
        var nextArc = G.Arcs.next(G.game.meta);
        self.buttons.push(new G.UI.Btn({ x: 150, y: 150, w: 168, h: 40,
          variant: 'gold',
          label: '天道命定 · ' + nextArc.n,
          onClick: function () {
            self.arcChoice = nextArc.id;
            self._beginGrow();
          } }));
        self.buttons.push(new G.UI.Btn({ x: 330, y: 150, w: 120, h: 40,
          label: '浮世轮回',
          onClick: function () {
            self.arcChoice = null;
            self._beginGrow();
          } }));
      } else if (this.step === 'grow') {""")

# 增加 _beginGrow 辅助（放在 finish 前）
rep("""    /* ===== 结算：生成当世档 ===== */""",
"""    _beginGrow: function () {
      this.step = 'grow'; this.grow = 0; this.growT = 0;
      this._buildButtons();
    },

    /* ===== 结算：生成当世档 ===== */""")

# render 增加 arcpath
rep("""      if (this.step === 'linggen') this.renderLinggen(x);
      else if (this.step === 'grow') this.renderGrow(x);
      else this.renderTalents(x);""",
"""      if (this.step === 'linggen') this.renderLinggen(x);
      else if (this.step === 'grow') this.renderGrow(x);
      else if (this.step === 'arcpath') this.renderArcPath(x);
      else this.renderTalents(x);""")

# renderArcPath 方法（插在 renderTalents 前）
rep("""    renderTalents: function (x) {""",
"""    renderArcPath: function (x) {
      var next = G.Arcs.next(G.game.meta);
      this._header(x, '降世 · 命途', '命定之世沿天道因果而行；浮世轮回则此世随机、无主线牵挂。');
      x.save();
      x.fillStyle = 'rgba(216,183,104,0.12)';
      G.UI.rr(x, 150, 150, 168, 40, 6); x.fill();
      x.fillStyle = 'rgba(120,150,190,0.1)';
      G.UI.rr(x, 330, 150, 120, 40, 6); x.fill();
      G.UI.text(x, { x: 234, y: 208 }, '命定：' + next.n + '（' + next.theme + '）', 11, G.UI.C.goldHi, 'center');
      var hint = '命定之世有固定牵挂与失去，是主线必经之途。';
      G.UI.wrap(x, hint, 10, 150).slice(0, 2).forEach(function (l, i) {
        G.UI.text(x, { x: 234, y: 222 + i * 12 }, l, 10, G.UI.C.textDim, 'center');
      });
      G.UI.text(x, { x: 390, y: 208 }, '随机世界 · 自由修行', 10, G.UI.C.text, 'center');
      G.UI.text(x, { x: 390, y: 224 }, '无主线，死后照常结算仙力。', 9.5, G.UI.C.textDim, 'center');
      x.restore();
    },

    renderTalents: function (x) {""")

io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('reincarnation arcpath patched')
