/* 随机数：支持种子复现（世界种子、抽卡） */
(function () {
  function RNG(seed) {
    this.s = (seed >>> 0) || 1;
  }
  RNG.prototype.next = function () {
    // mulberry32
    this.s |= 0; this.s = (this.s + 0x6D2B79F5) | 0;
    var t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  RNG.prototype.range = function (a, b) { return a + this.next() * (b - a); };
  RNG.prototype.int = function (a, b) { return Math.floor(this.range(a, b + 1)); }; // 含两端
  RNG.prototype.pick = function (arr) { return arr[this.int(0, arr.length - 1)]; };
  RNG.prototype.shuffle = function (arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = this.int(0, i), t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  };
  /* 按权重抽取：items=[{w:权重,...}]，返回 index */
  RNG.prototype.weighted = function (items) {
    var total = 0, i;
    for (i = 0; i < items.length; i++) total += items[i].w;
    var r = this.next() * total;
    for (i = 0; i < items.length; i++) { r -= items[i].w; if (r < 0) return i; }
    return items.length - 1;
  };
  /* 无放回抽取 n 个 index */
  RNG.prototype.sampleIndices = function (count, total) {
    var idx = [];
    for (var i = 0; i < total; i++) idx.push(i);
    this.shuffle(idx);
    return idx.slice(0, Math.min(count, total));
  };

  G.RNG = RNG;
  G.rng = new RNG((Date.now() & 0xffffffff) ^ 0x9e3779b9);
})();
