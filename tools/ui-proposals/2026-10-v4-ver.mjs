// 改良案（2026-10・v4・1 回目）: 版を画面に出す（押すと更新履歴）・画面の文字の大きさを変えられる。
//   node tools/ui-variants.mjs 出力 tools/ui-proposals/2026-10-v4-ver.mjs --view 1728x1152 --states mitome,large,history
// 今の画面で見えたこと: 版は「設定」の一番下（送らないと見えない）にだけある・更新履歴もそこからしか開けない・
//   画面の字（灰色の説明が 12px）を大きくする手段が無い・「字の大きさ」（印の中の字）と画面の字の区別が付かない。
// 仕組みはどの案も同じ: 画面の文字の大きさ = 画面全体の拡大（zoom。Windows の拡大・ブラウザの Ctrl＋＋と同じ動き。押す所も大きくなる）。
//   Ctrl＋＋／Ctrl＋−／Ctrl＋0 でも変わる。版を押すと更新履歴（いまの版に札）。違うのは置き場と見せ方。

import { SEED } from '../ui-harness.mjs';

/** どの案も使う: 版の値・拡大・更新履歴を開く・状態を撮る口（window.__ui） */
const BASE = `
const ver = (() => { try { return JSON.parse(localStorage.getItem('ponstamp.state')).demo.info.version; } catch { return '1.0.0'; } })();
const ALL_STEPS = [90, 100, 110, 125, 140];
// 拡大の上限: 拡大した後の画面が窓の最小の大きさ（900×620）を下回らない所まで（下回ると縦に送りが出る）
const maxScale = () => Math.floor(Math.min(innerWidth / 900, innerHeight / 620) * 100);
const steps = () => ALL_STEPS.filter((v) => v <= Math.max(100, maxScale()));
let scale = 100;
const listeners = [];
const setScale = (v) => { const ok = steps(); scale = ok.includes(v) ? v : ok.filter((s) => s <= v).pop() || 100; document.documentElement.style.zoom = scale / 100; document.documentElement.style.setProperty('--zoom', scale / 100); dispatchEvent(new Event('resize')); listeners.forEach((f) => f(scale)); };
const step = (d) => { const ok = steps(); const i = ok.indexOf(scale); setScale(ok[Math.max(0, Math.min(ok.length - 1, (i < 0 ? 1 : i) + d))]); };
addEventListener('keydown', (e) => { if (!e.ctrlKey) return; if (e.key === '+' || e.key === ';' || e.key === '=') { e.preventDefault(); step(1); } else if (e.key === '-') { e.preventDefault(); step(-1); } else if (e.key === '0') { e.preventDefault(); setScale(100); } });
const openHistory = () => document.querySelector('#settings')?.querySelector('button:last-of-type') && [...document.querySelectorAll('#settings button')].find((b) => b.textContent === '更新履歴')?.click();
// 更新履歴: いまの版の見出しに札
new MutationObserver(() => { document.querySelectorAll('#history h2').forEach((h) => { if (h.textContent.startsWith('版 ' + ver) && !h.querySelector('.now')) { const t = document.createElement('span'); t.className = 'now'; t.textContent = 'いまの版'; h.append(t); } }); }).observe(document.body, { childList: true, subtree: true });
// 印の字と画面の字を言葉で分ける
const lbl = document.querySelector('label[for="rgText"]'); if (lbl) lbl.textContent = '字の大きさ';
window.__ui = { setScale, openHistory };
const verBtn = (cls) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.dataset.open = 'history'; b.title = '更新履歴を見る'; b.textContent = 'ver ' + ver; b.onclick = openHistory; return b; };
`;
const COMMON_CSS = `
:root { --zoom: 1; }
.stage { width: min(100%, 640px, calc(100vh / var(--zoom) - 340px)); }
body:has(.notices:not([hidden])) .stage { width: min(100%, 640px, calc(100vh / var(--zoom) - 410px)); }
#dlgHistory { width: min(640px, calc(100vw - 48px)); }
#history h2 .now { margin-left: 8px; padding: 1px 8px; border-radius: 999px; background: var(--accent); color: #fff; font-size: 11px; font-weight: 700; vertical-align: 2px; }
.verchip { border: 1px solid var(--line); background: var(--chip); color: var(--muted); font: inherit; font-size: 12px; font-weight: 600; padding: 2px 9px; border-radius: 999px; cursor: pointer; }
.verchip:hover { color: var(--text); border-color: var(--muted); }
.zoom { display: inline-flex; align-items: center; gap: 2px; }
.zoom .zb { width: 28px; height: 28px; border: 1px solid var(--line); background: var(--panel); color: var(--text); border-radius: 6px; font: inherit; font-size: 15px; cursor: pointer; line-height: 1; }
.zoom .zv { min-width: 46px; text-align: center; font-size: 13px; font-variant-numeric: tabular-nums; }
.zoom .zl { font-size: 12px; color: var(--muted); margin-right: 4px; }
`;

/** − 100% ＋ の部品（拡大の段を言葉と数で見せる） */
const STEPPER = `
const stepper = (label) => { const w = document.createElement('div'); w.className = 'zoom'; w.setAttribute('role', 'group'); w.setAttribute('aria-label', '画面の文字の大きさ');
  w.innerHTML = (label ? '<span class="zl">' + label + '</span>' : '') + '<button type="button" class="zb" aria-label="小さく" title="小さく（Ctrl＋−）">−</button><span class="zv">100%</span><button type="button" class="zb" aria-label="大きく" title="大きく（Ctrl＋＋）">＋</button>';
  const [minus, plus] = w.querySelectorAll('button'); minus.onclick = () => step(-1); plus.onclick = () => step(1);
  listeners.push((v) => { const ok = steps(); w.querySelector('.zv').textContent = v + '%'; minus.disabled = v === ok[0]; plus.disabled = v === ok[ok.length - 1]; }); return w; };
`;
/** 小・標準・大 の切替（3 段だけ。数は見せない） */
const SEG3 = `
const seg3 = () => { const w = document.createElement('div'); w.className = 'pills small zseg'; w.setAttribute('role', 'group'); w.setAttribute('aria-label', '画面の文字の大きさ');
  for (const [v, t] of [[90, '小'], [100, '標準'], [125, '大']]) { const b = document.createElement('button'); b.type = 'button'; b.textContent = t; b.setAttribute('aria-pressed', String(v === 100)); b.onclick = () => setScale(v); w.append(b); }
  listeners.push((v) => w.querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(i === (v < 100 ? 0 : v === 100 ? 1 : 2))))); return w; };
`;

export const EXTRA_STATES = [
  // 画面の文字を大きくした所（125%）・更新履歴を開いた所
  { name: 'large', seed: SEED, run: async (page) => { await page.evaluate(() => window.__ui?.setScale(125)); } },
  { name: 'history', seed: SEED, run: async (page) => { await page.locator('[data-open="history"]').first().click(); await page.waitForTimeout(200); } },
];

export const PROPOSALS = [
  {
    key: 'A', name: '見出しの右に並べる（ver・画面の文字「小・標準・大」・設定）',
    css: COMMON_CSS + `.top .tools { display: flex; align-items: center; gap: 12px; } .top .zlabel { font-size: 12px; color: var(--muted); }
.top .verlink { border: 0; background: none; color: var(--muted); font: inherit; font-size: 13px; cursor: pointer; padding: 4px 6px; border-radius: 6px; } .top .verlink:hover { color: var(--text); background: var(--chip); }`,
    ops: [['script', `${BASE}${SEG3}
const tools = document.createElement('div'); tools.className = 'tools';
const zl = document.createElement('span'); zl.className = 'zlabel'; zl.textContent = '画面の文字';
tools.append(verBtn('verlink'), zl, seg3()); document.querySelector('#btnSettings').before(tools); tools.append(document.querySelector('#btnSettings'));`]],
  },
  {
    key: 'B', name: '名前の隣に ver の札・画面の文字は「設定」の先頭の「表示」（一度決める物は設定へ）',
    css: COMMON_CSS + `.brand .verchip { margin-left: 4px; }`,
    ops: [['script', `${BASE}${SEG3}
document.querySelector('.brand').append(verBtn('verchip'));
const put = () => { const box = document.querySelector('#settings'); if (!box || box.querySelector('.sec-view')) return;
  const sec = document.createElement('section'); sec.className = 'set-sec sec-view'; sec.innerHTML = '<h2>表示</h2>';
  const row = document.createElement('div'); row.className = 'set-row'; row.innerHTML = '<span class="set-label">画面の文字の大きさ</span>';
  const v = document.createElement('div'); v.append(seg3()); const hnt = document.createElement('p'); hnt.className = 'hint'; hnt.textContent = '画面全体を大きくします（Ctrl＋＋・Ctrl＋−でも変わります）。印の大きさは変わりません。'; v.append(hnt); row.append(v); sec.append(row); box.prepend(sec); };
new MutationObserver(put).observe(document.querySelector('#settings'), { childList: true }); put();`]],
  },
  {
    key: 'C', name: '左の帯の下に「このアプリ」の欄（ver・更新履歴・画面の文字 − 100% ＋）',
    css: COMMON_CSS + `.appbox { margin-top: auto; padding: 10px; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px; font-size: 13px; color: var(--text); }
.appbox .r { display: flex; align-items: center; justify-content: space-between; gap: 6px; } .appbox .verlink { border: 0; background: none; color: var(--focus); font: inherit; cursor: pointer; padding: 0; }`,
    ops: [['script', `${BASE}${STEPPER}
const box = document.createElement('div'); box.className = 'appbox';
const r1 = document.createElement('div'); r1.className = 'r'; r1.innerHTML = '<span>PonStamp <b style="color:var(--text)">ver ' + ver + '</b></span>'; const hl = verBtn('verlink'); hl.textContent = '更新履歴'; r1.append(hl);
const r2 = document.createElement('div'); r2.className = 'r'; r2.innerHTML = '<span>画面の文字</span>'; r2.append(stepper(''));
box.append(r1, r2); document.querySelector('.rail').append(box);`]],
  },
  {
    key: 'D', name: '名前の隣に ver の札・見出しの「文字」ボタンで小さな箱（ふだんは隠す）',
    css: COMMON_CSS + `.brand .verchip { margin-left: 4px; } .top .tools { display: flex; align-items: center; gap: 8px; position: relative; }
.zpop { position: absolute; top: calc(100% + 8px); right: 0; z-index: 5; width: 260px; padding: 12px; border-radius: 10px; background: var(--panel); border: 1px solid var(--line); box-shadow: 0 8px 24px rgba(0,0,0,.14); display: flex; flex-direction: column; gap: 8px; }
.zpop[hidden] { display: none; } .zpop p { margin: 0; font-size: 12px; color: var(--muted); }`,
    ops: [['script', `${BASE}${STEPPER}
document.querySelector('.brand').append(verBtn('verchip'));
const tools = document.createElement('div'); tools.className = 'tools';
const a = document.createElement('button'); a.type = 'button'; a.className = 'btn small'; a.textContent = 'Aa 文字'; a.title = '画面の文字の大きさ';
const pop = document.createElement('div'); pop.className = 'zpop'; pop.hidden = true; pop.innerHTML = '<b>画面の文字の大きさ</b>'; pop.append(stepper('')); const p = document.createElement('p'); p.textContent = 'Ctrl＋＋・Ctrl＋−でも変わります'; pop.append(p);
a.onclick = () => { pop.hidden = !pop.hidden; }; listeners.push(() => { pop.hidden = false; });
document.querySelector('#btnSettings').before(tools); tools.append(a, document.querySelector('#btnSettings'), pop);`]],
  },
  {
    key: 'E', name: '窓の下の帯（左に PonStamp ver・更新履歴、右に画面の文字 − 100% ＋。Word・Excel の拡大と同じ場所）',
    css: COMMON_CSS + `.foot { flex: none; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 16px; background: var(--panel); border-top: 1px solid var(--line); font-size: 13px; color: var(--text); }
.foot .verlink { border: 0; background: none; color: var(--text); font: inherit; cursor: pointer; padding: 2px 6px; border-radius: 6px; } .foot .verlink:hover { background: var(--chip); color: var(--text); }
.foot .zoom .zb { width: 24px; height: 24px; font-size: 14px; }`,
    ops: [['script', `${BASE}${STEPPER}
const foot = document.createElement('footer'); foot.className = 'foot';
const left = document.createElement('div'); const v = verBtn('verlink'); v.textContent = 'PonStamp ver ' + ver + ' ・ 更新履歴'; left.append(v);
foot.append(left, stepper('画面の文字')); document.querySelector('.shell').after(foot);`]],
  },
];
