/* 输入：触屏/鼠标 + 键盘，统一换算到 480×272 内坐标 */
(function () {
  var Input = {
    canvas: null,
    keys: {},
    pressed: {},   // 本帧按下
    taps: [],      // 本帧点击 {x,y}
    holds: {},     // 持续按住的虚拟键（方向键用）
    mouse: null,   // 指针当前位置（触屏恒为 null）—— 悬浮说明用

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
        self.mouse = e.pointerType === 'touch' ? null : p;
      });
      /* 悬浮说明（tooltip）需要"没按下也知道指针在哪"，所以这里**无条件**记录位置。
         触屏没有悬浮语义 → pointerType==='touch' 时置 null，免得手指离开后
         提示条永远挂在最后一处触摸位置（手机上会像一块去不掉的膏药）。 */
      canvas.addEventListener('pointermove', function (e) {
        var p = toInternal(e);
        self.mouse = e.pointerType === 'touch' ? null : p;
        if (self._down) { self._down = p; self.drag = p; }
      });
      function up() { self._down = null; self.drag = null; }
      canvas.addEventListener('pointerup', up);
      canvas.addEventListener('pointercancel', up);
      canvas.addEventListener('pointerleave', function () { self.mouse = null; });
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
