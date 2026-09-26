/* 天道三协议「真机」探测（本地手动跑，不参与无头回归）
 *
 * 用法：
 *   NICHEN_TEST_KEY=sk-xxx node tools/api-probe.js
 *   NICHEN_TEST_KEY=sk-xxx NICHEN_TEST_ENDPOINT=https://host/v1 node tools/api-probe.js
 *   NICHEN_TEST_KEY=sk-xxx NICHEN_TEST_MODEL=gpt-4o-mini node tools/api-probe.js
 *
 * 为什么需要它：`smoke.js` 的 `tiandao.protocol.contract` 只能钉住请求的**形状**
 *   （url / 鉴权头 / 请求体 / 取文本路径），打不了真实网络。
 *   "形状全对但端到端不通"这类问题（端点被中转站改过、模型名不对、
 *   推理模型把 max_tokens 全烧在 reasoning 上导致取不到正文……）只有真机能发现。
 *
 * 它跑的是**游戏自己的** buildRequest / extractText —— 不是另写一套请求，
 *   所以测的就是线上那条代码路径。
 *
 * ⚠️ 密钥只从环境变量读，**绝不写进任何文件**（仓库是公开的）。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const KEY = process.env.NICHEN_TEST_KEY;
if (!KEY) {
  console.error('缺 NICHEN_TEST_KEY 环境变量。例：NICHEN_TEST_KEY=sk-xxx node tools/api-probe.js');
  process.exit(2);
}
const HOST = process.env.NICHEN_TEST_ENDPOINT || 'http://localhost:11434/v1';
/* 故意用"完整路径"形态当默认基址之一 —— 很多中转站控制台给的就是完整 URL，
   这正是 joinUrl 曾经拼错的那个坑（填完整路径再切协议 → 路径叠加）。 */
const FULLPATH = HOST.replace(/\/+$/, '').replace(/\/(chat\/completions|messages|responses)$/, '') + '/chat/completions';
const SYS = '你是《逆尘》里的天道意志，只回一句 20 字以内的中文谶语，不要解释，不要引号。';
const USR = '一个炼气三重的修士第一次踏进赤牙洞，降一句低语。';
const TIMEOUT = Number(process.env.NICHEN_TEST_TIMEOUT || 90000);

const WWW = path.join(__dirname, '..', 'www');

/* ---- 最小桩：让 tiandao.js（IIFE，挂 G.TianDao）能在 Node 里加载 ---- */
const G = {};
const sandbox = {
  window: { G: G }, G: G, console: console,
  setTimeout: setTimeout, clearTimeout: clearTimeout, fetch: fetch,
  location: { origin: 'http://127.0.0.1:8173' },
  document: {
    createElement: () => ({ style: {}, addEventListener() {}, focus() {}, remove() {}, parentNode: null }),
    body: { appendChild() {}, removeChild() {} }
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  navigator: { userAgent: 'node', language: 'zh-CN' }
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
['js/core/ns.js', 'js/core/rng.js', 'js/core/tiandao.js'].forEach(function (f) {
  vm.runInContext(fs.readFileSync(path.join(WWW, f), 'utf8'), sandbox, { filename: f });
});

const TD = G.TianDao;
if (!TD) { console.error('tiandao.js 没挂上 G.TianDao'); process.exit(2); }

async function post(spec) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT);
  const t0 = Date.now();
  try {
    const r = await fetch(spec.url, {
      method: 'POST', headers: spec.headers,
      body: JSON.stringify(spec.body), signal: ctl.signal
    });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch (e) {}
    return { status: r.status, ok: r.ok, json: j, ms: Date.now() - t0, raw: txt };
  } finally { clearTimeout(t); }
}

(async function () {
  console.log('端点基址：' + HOST);
  console.log('\n=== 0) 端点拼接（joinUrl 幂等 + 切协议不叠加路径）===');
  console.log('  基址            + /chat/completions →', TD.joinUrl(HOST, '/chat/completions'));
  console.log('  完整路径        + /messages         →', TD.joinUrl(FULLPATH, '/messages'));
  console.log('  完整路径        + /responses        →', TD.joinUrl(FULLPATH, '/responses'));

  console.log('\n=== 1) 模型清单 GET /models ===');
  let model = process.env.NICHEN_TEST_MODEL || '';
  try {
    const r = await fetch(HOST.replace(/\/+$/, '') + '/models', { headers: { Authorization: 'Bearer ' + KEY } });
    const j = await r.json();
    const ids = (j.data || j.models || []).map(x => x.id || x.name).filter(Boolean);
    console.log('  HTTP', r.status, '· 共', ids.length, '个');
    if (ids.length) console.log('  前 12 个：', ids.slice(0, 12).join(', '));
    if (!model) {
      model = ids.find(x => /4o-mini|haiku|flash|lite|mini|3\.5|7b|8b/i.test(x)) || ids[0];
    }
  } catch (e) { console.log('  取模型清单失败：', e.message); }
  if (!model) model = 'gpt-4o-mini';
  console.log('  实测选用模型：', model);

  /* openai 用"完整路径"形态测 —— 顺手把 joinUrl 那个坑一起验了 */
  const CASES = [
    ['openai',   FULLPATH, '完整路径形态'],
    ['claude',   HOST,     '基址形态'],
    ['response', HOST,     '基址形态']
  ];

  const result = {};
  for (const [proto, endpoint, note] of CASES) {
    console.log('\n=== 协议 ' + proto + '（' + note + '）===');
    const spec = TD.buildRequest(
      { protocol: proto, endpoint: endpoint, model: model, apiKey: KEY, temp: 0.8 }, SYS, USR);
    console.log('  POST', spec.url);
    console.log('  headers', JSON.stringify(spec.headers).replace(KEY, 'sk-***'));
    console.log('  body keys', Object.keys(spec.body).join(','));
    try {
      const r = await post(spec);
      const text = TD.extractText(r.json, proto);
      result[proto] = r.ok && !!text;
      console.log('  → HTTP', r.status, '·', r.ms + 'ms', r.ok ? 'OK' : 'FAIL');
      console.log('  extractText →', text === null ? '(null，取不到文本)' : JSON.stringify(String(text).slice(0, 140)));
      if (!r.ok) console.log('  响应体片段：', String(r.raw).replace(/\s+/g, ' ').slice(0, 300));
    } catch (e) {
      result[proto] = false;
      console.log('  → 抛错：', e && e.name === 'AbortError' ? ('超时（>' + TIMEOUT + 'ms）') : e.message);
      console.log('  ⚠️ 中转站首字延迟波动很大（实测同一模型 4s / 5s / 6.5s / 8.5s，也见过 60s+），');
      console.log('     单次超时不等于不支持 —— 建议重跑一次再下结论。');
    }
  }

  console.log('\n=== 小结 ===');
  Object.keys(result).forEach(function (p) {
    console.log('  ' + (result[p] ? '✅' : '❌') + '  ' + p);
  });
  const allOk = Object.keys(result).every(k => result[k]);
  console.log(allOk ? '\n三协议全部打通。' : '\n有协议未通 —— 注意中转站可能只兼容其中一两种，属正常现象。');
  process.exit(allOk ? 0 : 1);
})();
