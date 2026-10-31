// 改良案（2026-10・v4・2 回目）: 1 回目の採点（1 位 C 72.3 点）の指摘を直し、案出しからやり直す。
//   node tools/ui-variants.mjs 出力 tools/ui-proposals/2026-10-v4-ver-r2.mjs --view 1728x1152 --states mitome,large,history
// 持ち越し: C2・E2（C・E を直した物）。新しい案: F・G・H（どれも見出しの右＝目と手の近く。見せ方が違う）
// 1 回目の指摘（全案）: 1280 の 110% でコピーの列の「保存フォルダ」と下の説明が 2 段に折れる・版の言葉がばらばら（ver／版／いまの版、
//   電子印メーカー／PonStamp）・版が押せる物に見えない・拡大の操作が小さく薄い（12px の灰色・24px のボタン）
// 全案に同じ直し: 版の数はどこでも「ver 1.2.0」（更新履歴の見出し・設定の版も）・名前は見出しと同じ「電子印メーカー」・
//   版は枠のある札に「更新履歴」の言葉を添える・拡大の操作は 13px の本文の色・−／＋ は 30px・
//   コピーの列は狭いとき主のボタンの最小の幅を外して 1 段に（説明も短く 1 行に）

import { SEED } from '../ui-harness.mjs';

const BASE = `
const ver = (() => { try { return JSON.parse(localStorage.getItem('ponstamp.state')).demo.info.version; } catch { return '1.0.0'; } })();
const ALL_STEPS = [90, 100, 110, 125, 140];
const maxScale = () => Math.floor(Math.min(innerWidth / 900, innerHeight / 620) * 100);
const steps = () => ALL_STEPS.filter((v) => v <= Math.max(100, maxScale()));
let scale = 100;
const listeners = [];
const setScale = (v) => { const ok = steps(); scale = ok.includes(v) ? v : ok.filter((s) => s <= v).pop() || 100; document.documentElement.style.zoom = scale / 100; document.documentElement.style.setProperty('--zoom', scale / 100); dispatchEvent(new Event('resize')); listeners.forEach((f) => f(scale)); };
const step = (d) => { const ok = steps(); const i = ok.indexOf(scale); setScale(ok[Math.max(0, Math.min(ok.length - 1, (i < 0 ? 1 : i) + d))]); };
addEventListener('keydown', (e) => { if (!e.ctrlKey) return; if (e.key === '+' || e.key === ';' || e.key === '=') { e.preventDefault(); step(1); } else if (e.key === '-') { e.preventDefault(); step(-1); } else if (e.key === '0') { e.preventDefault(); setScale(100); } });
const openHistory = () => [...document.querySelectorAll('#settings button')].find((b) => b.textContent === '更新履歴')?.click();
// 言葉をそろえる: 版の数はどこでも「ver 1.2.0」。更新履歴のいまの版に札
const words = () => {
  document.querySelectorAll('#history h2').forEach((h) => { const t = h.firstChild; if (t && t.nodeType === 3 && t.textContent.startsWith('版 ')) t.textContent = 'ver ' + t.textContent.slice(2);
    if (h.textContent.startsWith('ver ' + ver) && !h.querySelector('.now')) { const s = document.createElement('span'); s.className = 'now'; s.textContent = 'いまの版'; h.append(s); } });
  document.querySelectorAll('#settings span, #settings b').forEach((s) => { if (/^\\d+\\.\\d+\\.\\d+$/.test(s.textContent)) s.textContent = 'ver ' + s.textContent; });
};
new MutationObserver(words).observe(document.body, { childList: true, subtree: true });
const hint = document.querySelector('.preview > .hint.center'); if (hint) hint.textContent = 'コピーしたら、貼り付け先（Excel・Word・PDF など）で Ctrl+V';
window.__ui = { setScale, openHistory };
/** 版の札（枠つき・押すと更新履歴） */
const verChip = (withWord = true) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'verchip'; b.dataset.open = 'history'; b.title = '更新履歴を見る';
  b.innerHTML = '<b>ver ' + ver + '</b>' + (withWord ? '<span>更新履歴</span>' : ''); b.onclick = openHistory; return b; };
/** − 100% ＋（label: 前に置く見出し） */
const stepper = (label, glyph) => { const w = document.createElement('div'); w.className = 'zoom'; w.setAttribute('role', 'group'); w.setAttribute('aria-label', '画面の文字の大きさ');
  const [lo, hi] = glyph ? ['<span class="a-s">A</span>', '<span class="a-l">A</span>'] : ['−', '＋'];
  w.innerHTML = (label ? '<span class="zl">' + label + '</span>' : '') + '<button type="button" class="zb" aria-label="画面の文字を小さく" title="小さく（Ctrl＋−）">' + lo + '</button><span class="zv">100%</span><button type="button" class="zb" aria-label="画面の文字を大きく" title="大きく（Ctrl＋＋）">' + hi + '</button>';
  const [minus, plus] = w.querySelectorAll('button'); minus.onclick = () => step(-1); plus.onclick = () => step(1);
  w.querySelector('.zv').title = '押すと 100% に戻す（Ctrl＋0）'; w.querySelector('.zv').onclick = () => setScale(100);
  listeners.push((v) => { const ok = steps(); w.querySelector('.zv').textContent = v + '%'; minus.disabled = v === ok[0]; plus.disabled = v === ok[ok.length - 1]; }); return w; };
`;
const COMMON_CSS = `
:root { --zoom: 1; }
.stage { width: min(100%, 640px, calc(100vh / var(--zoom) - 340px)); }
body:has(.notices:not([hidden])) .stage { width: min(100%, 640px, calc(100vh / var(--zoom) - 410px)); }
.preview { container-type: inline-size; }
@container (max-width: 560px) { .actions { flex-wrap: nowrap; } .actions .btn { padding: 10px 12px; } .actions .btn.primary { min-width: 0; } }
#dlgHistory { width: min(640px, calc(100vw - 48px)); }
#history h2 .now { margin-left: 8px; padding: 1px 8px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 11px; font-weight: 700; vertical-align: 2px; }
.verchip { display: inline-flex; align-items: center; gap: 8px; height: 30px; border: 1px solid var(--line); background: var(--panel); color: var(--text); font: inherit; font-size: 13px; padding: 0 12px; border-radius: 999px; cursor: pointer; white-space: nowrap; }
.verchip b { font-weight: 700; } .verchip span { color: var(--focus); }
.verchip:hover { border-color: var(--muted); }
.zoom { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.zoom .zl { font-size: 13px; color: var(--text); margin-right: 4px; }
.zoom .zb { width: 30px; height: 30px; border: 1px solid var(--line); background: var(--panel); color: var(--text); border-radius: 7px; font: inherit; font-size: 16px; cursor: pointer; line-height: 1; display: inline-grid; place-items: center; }
.zoom .zb:hover:not(:disabled) { border-color: var(--muted); } .zoom .zb:disabled { opacity: .4; cursor: default; }
.zoom .zv { min-width: 48px; text-align: center; font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums; cursor: pointer; }
.zoom .a-s { font-size: 12px; font-weight: 700; } .zoom .a-l { font-size: 18px; font-weight: 700; }
.top .tools { display: flex; align-items: center; gap: 12px; }
.top .sep { width: 1px; height: 22px; background: var(--line); }
`;

export const EXTRA_STATES = [
  { name: 'large', seed: SEED, run: async (page) => { await page.evaluate(() => window.__ui?.setScale(125)); } },
  { name: 'history', seed: SEED, run: async (page) => { await page.locator('[data-open="history"]').first().click(); await page.waitForTimeout(200); } },
];

export const PROPOSALS = [
  {
    key: 'C2', name: '左の帯の下に「このアプリ」の欄（ver の札・更新履歴／画面の文字 − 100% ＋）（C を直した物）',
    css: COMMON_CSS + `.appbox { margin-top: auto; padding: 12px 6px 4px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 10px; }
.appbox .h { margin: 0; font-size: 12px; font-weight: 700; color: var(--muted); letter-spacing: .06em; }`,
    ops: [['script', `${BASE}
const box = document.createElement('div'); box.className = 'appbox';
const h = document.createElement('h2'); h.className = 'h'; h.textContent = 'このアプリ'; box.append(h, verChip(), stepper('画面の文字'));
document.querySelector('.rail').append(box);`]],
  },
  {
    key: 'E2', name: '窓の下の帯（左に電子印メーカー ver の札、右に画面の文字 − 100% ＋）（E を直した物）',
    css: COMMON_CSS + `.foot { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 5px 16px; background: var(--panel); border-top: 1px solid var(--line); font-size: 13px; }
.foot .left { display: flex; align-items: center; gap: 8px; color: var(--muted); }`,
    ops: [['script', `${BASE}
const foot = document.createElement('footer'); foot.className = 'foot';
const left = document.createElement('div'); left.className = 'left'; left.append('電子印メーカー', verChip());
foot.append(left, stepper('画面の文字')); document.querySelector('.shell').after(foot);`]],
  },
  {
    key: 'F', name: '見出しの右に 2 つのまとまり（画面の文字 − 100% ＋ ｜ ver の札・更新履歴）と設定',
    css: COMMON_CSS,
    ops: [['script', `${BASE}
const tools = document.createElement('div'); tools.className = 'tools';
const sep = () => Object.assign(document.createElement('span'), { className: 'sep' });
tools.append(stepper('画面の文字'), sep(), verChip(), document.querySelector('#btnSettings')); document.querySelector('.top').append(tools);`]],
  },
  {
    key: 'G', name: '名前のすぐ隣に ver の札（アプリの名前と版を 1 つに）・見出しの右に画面の文字 − 100% ＋ と設定',
    css: COMMON_CSS + `.brand { gap: 10px; }`,
    ops: [['script', `${BASE}
document.querySelector('.brand').append(verChip());
const tools = document.createElement('div'); tools.className = 'tools';
tools.append(stepper('画面の文字'), document.querySelector('#btnSettings')); document.querySelector('.top').append(tools);`]],
  },
  {
    key: 'H', name: '名前の隣に ver の札・見出しの右に小さい A／大きい A の拡大（Web でよく見る字の大きさの型）と設定',
    css: COMMON_CSS + `.brand { gap: 10px; }`,
    ops: [['script', `${BASE}
document.querySelector('.brand').append(verChip());
const tools = document.createElement('div'); tools.className = 'tools';
tools.append(stepper('画面の文字', true), document.querySelector('#btnSettings')); document.querySelector('.top').append(tools);`]],
  },
];
