/* 输入：触屏/鼠标 + 键盘，统一换算到 480×272 内坐标 */
(function () {
  var Input = {
    canvas: null,
    keys: {},
    pressed: {},   // 本帧按下
    taps: [],      // 本帧点击 {x,y}
    holds: {},     // 持续按住的虚拟键（方向键用）

    init: function (canvas) {
      this.canvas = canvas;
      var self = this;

      function toInternal(e) {
        var rect = canvas.getBoundingClientRect();
        var cx = (e.clientX - rect.left) / rect.width * 480;
        var cy = (e.clientY - rect.top) / rect.height * 272;
        return { x: cx, y: cy };
      }
      canvas.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        var p = toInternal(e);
        self.taps.push(p);
        self._down = p;
      });
      canvas.addEventListener('pointermove', function (e) {
        if (self._down) { var p = toInternal(e); self._down = p; self.drag = p; }
      });
      function up() { self._down = null; self.drag = null; }
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
      canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

      window.addEventListener('keydown', function (e) {
        if (!self.keys[e.code]) self.pressed[e.code] = true;
        self.keys[e.code] = true;
        if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].indexOf(e.code) >= 0) e.preventDefault();
      });
      window.addEventListener('keyup', function (e) { self.keys[e.code] = false; });
    },

    /* 由 game 每帧末调用，清理瞬时状态 */
    endFrame: function () {
      this.taps.length = 0;
      this.pressed = {};
      this.drag = null;
    }
  };

  G.Input = Input;
})();
