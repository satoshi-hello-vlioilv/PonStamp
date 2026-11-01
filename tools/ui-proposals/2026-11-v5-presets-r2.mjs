// 改良案（2026-11・v5・2 回目）: 1 回目（1 位 C 66.6 点）の指摘を直し、案出しからやり直す。
//   node tools/ui-variants.mjs 出力 tools/ui-proposals/2026-11-v5-presets-r2.mjs --view 1728x1152 --states mitome,edited,check,organize
// 持ち越し: A2・C2（A・C を直した物）。新しい案: F（確かめを要るときに出す）・G（編集中を札そのものに）・H（整理の窓）
// 1 回目の指摘と全案の直し:
//   - 番号の札が見本の印に重なる → 番号は広い画面の大きな札だけ（札の角・絵の外）。狭い画面は札の「コピー」の説明（title）とコピーの説明に Ctrl+番号
//   - 上書きが赤い主ボタンでコピーと取り合う → 上書きは枠だけ（主ボタンにしない）
//   - 名前・並べ替えが見えない操作（ダブルクリック・ホバーのつまみ） → 札の「…」1 つの入口（呼び出す・いまの印で上書き・名前を変える・上へ・下へ・削除）
//   - × がコピーの隣で押し間違えやすい → 削除は「…」の中（区切り線の下・赤）
//   - B（押すとコピー）は今と逆の動きなのでやめる

import { SEED } from '../ui-harness.mjs';

const BASE = `
const $ = (s, r = document) => r.querySelector(s); const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const presets = () => { try { return JSON.parse(localStorage.getItem('ponstamp.state')).presets || []; } catch { return []; } };
let loaded = -1, dirty = false; const hooks = [];
const emit = () => hooks.forEach((f) => f({ loaded, dirty, name: presets()[loaded]?.name }));
document.addEventListener('click', (e) => { const b = e.target.closest('.pchip .load'); if (!b) return; loaded = $$('.pchip').indexOf(b.closest('.pchip')); dirty = false; setTimeout(emit); }, true);
const onEdit = (e) => { if (loaded >= 0 && e.target.closest('.panel')) { dirty = true; emit(); } };
document.addEventListener('input', onEdit, true); document.addEventListener('change', onEdit, true);
const drawRuler = (cv, wpx) => { const mm = 50, h = 16, k = wpx / mm; cv.width = wpx; cv.height = Math.round(h * k); const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.fillStyle = '#111'; const ln = Math.max(1, Math.round(k * 0.15));
  c.fillRect(0, 0, cv.width, ln); c.fillRect(0, cv.height - ln, cv.width, ln); c.fillRect(0, 0, ln, cv.height); c.fillRect(cv.width - ln, 0, ln, cv.height);
  for (let i = 1; i < mm; i++) { const len = (i % 10 === 0 ? 7 : i % 5 === 0 ? 5 : 3) * k; c.fillRect(Math.round(i * k - ln / 2), 0, ln, Math.round(len)); }
  c.textAlign = 'center'; c.font = (3.2 * k) + 'px sans-serif'; for (let cm = 1; cm < 5; cm++) c.fillText(String(cm), cm * 10 * k, 10.6 * k);
  c.font = 'bold ' + (2.6 * k) + 'px sans-serif'; c.fillText('枠の幅 50 mm', cv.width / 2, 14.4 * k); };
const checkDialog = () => { let d = $('#dlgCheck'); if (d) return d; d = mk('dialog', 'check-dlg'); d.id = 'dlgCheck';
  d.innerHTML = '<div class="dlg-head"><h1>貼り付けの大きさを確かめる</h1><button type="button" class="btn small quiet" data-x>閉じる</button></div>'
   + '<div class="ck"><canvas class="ruler"></canvas><ol><li>「ものさしをコピー」を押す</li><li>Word・Excel・PowerPoint に Ctrl+V で貼る</li><li>貼った図を選び、「図の形式」→「サイズ」の幅が <b>50 mm</b> か見る（定規を当ててもよい）</li></ol>'
   + '<div class="row"><button type="button" class="btn primary small">ものさしをコピー</button><button type="button" class="btn small">PNG で保存</button></div>'
   + '<p class="hint">いまの解像度（600 dpi）で、印と同じ道（コピー・保存）を通します。50 mm でなければ、PNG で保存してファイルから挿入してください。</p></div>';
  document.body.append(d); d.querySelector('[data-x]').onclick = () => d.close(); drawRuler(d.querySelector('canvas'), 560); return d; };
const openCheck = () => checkDialog().showModal();
window.__ui = { openCheck, organize: () => {}, load: (i) => $$('.pchip .load')[i]?.click() };
/** 札: 番号（広い画面の大きな札だけ・角）・「コピー」・「…」（× の代わり） */
const chips = () => { const run = () => $$('.pchip').forEach((chip, i) => { if (chip.querySelector('.cp')) return;
  if (i < 9) chip.append(mk('span', 'num', String(i + 1)));
  const b = mk('button', 'cp', 'コピー'); b.type = 'button'; b.title = 'コピー（Ctrl+' + (i + 1) + '）'; b.setAttribute('aria-label', '「' + (presets()[i]?.name || '') + '」をコピー');
  const d = chip.querySelector('.del'); d.className = 'more'; d.textContent = '…'; d.title = '上書き・名前・並べ替え・削除'; d.setAttribute('aria-label', '「' + (presets()[i]?.name || '') + '」のメニュー'); d.before(b); });
  new MutationObserver(run).observe($('#presetBar'), { childList: true }); run(); };
/** 「…」のメニュー（E を持ち越す。削除は区切り線の下・赤。押せない所は薄く） */
const menuFor = (i) => { $('.pmenu')?.remove(); const c = $$('.pchip')[i]; const r = c.getBoundingClientRect(); const n = presets().length;
  const m = mk('div', 'pmenu', '<button>いまの印で上書き</button><button>名前を変える…</button><hr><button' + (i === 0 ? ' class="off"' : '') + '>上へ</button><button' + (i === n - 1 ? ' class="off"' : '') + '>下へ</button><hr><button class="danger">削除…</button>');
  m.style.left = Math.min(r.right - 4, innerWidth - 220) + 'px'; m.style.top = r.top + 'px'; document.body.append(m); };
const tipCtrl = () => { const t = $('.preview > .hint.center'); if (t) t.textContent = 'Excel・Word などで Ctrl+V で貼り付け。登録した印は Ctrl+1〜9 でもコピー'; };
`;
const COMMON_CSS = `
:root { --rail: 256px; }
.check-dlg { width: min(640px, calc(100vw / var(--zoom) - 48px)); }
.check-dlg .ck { display: flex; flex-direction: column; gap: 12px; padding: 4px 18px 18px; }
.check-dlg canvas.ruler { width: 100%; height: auto; border-radius: 4px; box-shadow: 0 0 0 1px var(--line); }
.check-dlg ol { margin: 0; padding-left: 20px; } .check-dlg .hint { margin: 0; }
.pchip { position: relative; }
.pchip .num { display: none; }
.pchip .cp { flex: none; height: 26px; padding: 0 8px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel); color: var(--text); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.pchip .cp:hover { border-color: var(--accent); color: var(--accent); }
.pchip .more { flex: none; border: 0; background: none; color: var(--muted); width: 24px; height: 26px; border-radius: 6px; cursor: pointer; font-size: 16px; } .pchip .more:hover { background: var(--line); color: var(--text); }
.pchip.on { background: var(--panel); border-color: var(--accent); }
.pmenu { position: fixed; z-index: 5; min-width: 200px; padding: 6px; border-radius: 10px; background: var(--panel); border: 1px solid var(--line); box-shadow: 0 8px 24px rgba(0,0,0,.16); display: flex; flex-direction: column; }
.pmenu button { text-align: left; border: 0; background: none; color: var(--text); font: inherit; font-size: 13px; padding: 7px 10px; border-radius: 6px; cursor: pointer; }
.pmenu button:hover { background: var(--chip); } .pmenu hr { border: 0; border-top: 1px solid var(--line); margin: 4px 2px; } .pmenu .danger { color: var(--accent); } .pmenu .off { color: var(--muted); opacity: .55; }
.btn.outline { border-color: var(--accent); color: var(--accent); font-weight: 700; background: var(--panel); }
.dirty-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); margin-left: 6px; vertical-align: 2px; }
@media (min-width: 1600px) and (min-height: 1000px) { :root { --rail: 300px; } .rail .pchip .num { display: inline-grid; place-items: center; position: absolute; top: 6px; left: 6px; width: 18px; height: 18px; border-radius: 4px; border: 1px solid var(--line); background: var(--chip); font-size: 11px; font-weight: 700; color: var(--muted); }
  .rail .pchip .cp { width: 100%; height: 28px; } .rail .pchip .more { position: absolute; top: 2px; right: 2px; } }
`;
const EDIT_BAR = `
const editBar = (where) => { const bar = mk('div', 'editbar'); bar.hidden = true; where(bar);
  hooks.push(({ loaded: i, dirty: d, name }) => { bar.hidden = i < 0; $$('.pchip').forEach((c, k) => c.classList.toggle('on', k === i)); if (i < 0) return;
    bar.innerHTML = '<span class="eb-t">編集中: <b>' + name + '</b>' + (d ? '<span class="dirty-dot" aria-hidden="true"></span><small>変更あり</small>' : '<small class="same">登録したまま</small>') + '</span>';
    const acts = mk('span', 'eb-a'); if (d) { acts.append(mk('button', 'btn small outline', '「' + name + '」に上書き'), mk('button', 'btn small', '新しく登録')); } bar.append(acts); }); };
`;
const EDIT_CSS = `
.editbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 8px; background: var(--panel); font-size: 13px; }
.editbar[hidden] { display: none; } .editbar small { margin-left: 4px; font-size: 12px; color: var(--accent); font-weight: 700; } .editbar small.same { color: var(--muted); font-weight: 400; }
.editbar .eb-a { display: flex; gap: 6px; } .editbar .btn { white-space: nowrap; }
`;
const CHECK_LINK_CSS = `.checklink { border: 0; background: none; color: var(--focus); font: inherit; font-size: 12px; cursor: pointer; padding: 0; }`;

export const EXTRA_STATES = [
  { name: 'edited', seed: SEED, run: async (page) => { await page.evaluate(() => window.__ui.load(0)); await page.fill('#inName', '山田太郎'); await page.waitForTimeout(3000); } },
  { name: 'check', seed: SEED, run: async (page) => { await page.evaluate(() => window.__ui.openCheck()); await page.waitForTimeout(150); } },
  { name: 'organize', seed: SEED, run: async (page) => { await page.evaluate(() => window.__ui.organize()); await page.waitForTimeout(150); } },
];

export const PROPOSALS = [
  {
    key: 'A2', name: '札にコピーと「…」。呼び出して変えると、左の帯の登録の所が「上書き（枠）／新しく登録」に分かれる。確かめはコピーの説明の下（A を直した物）',
    css: COMMON_CSS + CHECK_LINK_CSS + `.reg2 { display: grid; gap: 4px; } .reg2 .btn { width: 100%; } .reg2 .note { margin: 0; padding: 0 4px; font-size: 12px; color: var(--accent); font-weight: 700; }`,
    ops: [['script', `${BASE}
chips(); tipCtrl();
const add = $('#btnAddPreset'); const reg = mk('div', 'reg2'); add.before(reg); reg.append(add);
hooks.push(({ loaded: i, dirty: d, name }) => { $$('.pchip').forEach((c, k) => c.classList.toggle('on', k === i)); reg.querySelectorAll('.ow,.note').forEach((e) => e.remove());
  if (i >= 0 && d) { reg.prepend(mk('p', 'note', '「' + name + '」から変えています'), mk('button', 'btn small outline ow', '「' + name + '」に上書き')); add.textContent = '＋ 新しく登録'; } else add.textContent = '＋ いまの印を登録'; });
const hint = $('.preview > .hint.center'); const l = mk('button', 'checklink', '貼った大きさが違うときは → 大きさを確かめる'); l.type = 'button'; l.onclick = openCheck; hint.after(l);
window.__ui.organize = () => menuFor(1);`]],
  },
  {
    key: 'C2', name: '札にコピーと「…」。呼び出すと入力の上に「編集中」の帯（変えたら 変更あり・上書き（枠）・新しく登録）。確かめはプレビューの寸法の隣（C を直した物）',
    css: COMMON_CSS + EDIT_CSS + CHECK_LINK_CSS + `.meta .checklink { margin-left: 8px; }`,
    ops: [['script', `${BASE}${EDIT_BAR}
chips(); tipCtrl(); editBar((bar) => $('.panel').prepend(bar));
const meta = $('#meta'); const l = mk('button', 'checklink', '大きさを確かめる'); l.type = 'button'; l.onclick = openCheck;
new MutationObserver(() => { if (!meta.contains(l)) meta.append(l); }).observe(meta, { childList: true, characterData: true, subtree: true }); meta.append(l);
window.__ui.organize = () => menuFor(1);`]],
  },
  {
    key: 'F', name: '確かめは要るときに出す（コピーした直後の知らせに「大きさを確かめる」・寸法の隣にも）。編集中の帯・札のコピーと「…」は C2 と同じ',
    css: COMMON_CSS + EDIT_CSS + CHECK_LINK_CSS + `.meta .checklink { margin-left: 8px; }
.toast2 { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); display: flex; align-items: center; gap: 12px; padding: 10px 14px; border-radius: 10px; background: var(--text); color: var(--panel); font-size: 13px; box-shadow: 0 8px 24px rgba(0,0,0,.2); z-index: 4; }
.toast2 button { border: 1px solid color-mix(in srgb, var(--panel) 40%, transparent); background: none; color: var(--panel); font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 6px; cursor: pointer; }`,
    ops: [['script', `${BASE}${EDIT_BAR}
chips(); tipCtrl(); editBar((bar) => $('.panel').prepend(bar));
const meta = $('#meta'); const l = mk('button', 'checklink', '大きさを確かめる'); l.type = 'button'; l.onclick = openCheck;
new MutationObserver(() => { if (!meta.contains(l)) meta.append(l); }).observe(meta, { childList: true, characterData: true, subtree: true }); meta.append(l);
const t = mk('div', 'toast2', '<span>コピーしました。貼り付け先で Ctrl+V</span>'); const tb = mk('button', '', '貼った大きさを確かめる'); tb.onclick = openCheck; t.append(tb); document.body.append(t);
window.__ui.organize = () => menuFor(1);`]],
  },
  {
    key: 'G', name: '編集中を札そのものに出す（呼び出した札が広がり、変えたら「変更あり・上書き（枠）・新しく登録」）。札のコピーと「…」。確かめはコピーの説明の下',
    css: COMMON_CSS + CHECK_LINK_CSS + `.pchip.open { flex-wrap: wrap; } .pchip .ed { flex-basis: 100%; display: flex; flex-direction: column; gap: 4px; padding: 6px 2px 2px; border-top: 1px dashed var(--line); margin-top: 4px; }
.pchip .ed p { margin: 0; font-size: 12px; color: var(--accent); font-weight: 700; } .pchip .ed .btn { width: 100%; }
@media (min-width: 1600px) and (min-height: 1000px) { .rail .pchip.open { grid-column: 1 / -1; } }`,
    ops: [['script', `${BASE}
chips(); tipCtrl();
hooks.push(({ loaded: i, dirty: d, name }) => { $$('.pchip').forEach((c, k) => { c.classList.toggle('on', k === i); c.classList.toggle('open', k === i && d); c.querySelector('.ed')?.remove();
  if (k === i && d) { const ed = mk('div', 'ed', '<p>変更あり（呼び出した後に変えました）</p>'); ed.append(mk('button', 'btn small outline', 'この印に上書き'), mk('button', 'btn small', '新しく登録')); c.append(ed); } }); });
const hint = $('.preview > .hint.center'); const l = mk('button', 'checklink', '貼った大きさが違うときは → 大きさを確かめる'); l.type = 'button'; l.onclick = openCheck; hint.after(l);
window.__ui.organize = () => menuFor(1);`]],
  },
  {
    key: 'H', name: 'ふだんの札は静か（コピーだけ）。帯の見出しの「整理…」で窓を開き、名前・並べ替え・削除をまとめて直す。編集中の帯（C2 と同じ）。確かめはコピーの説明の下',
    css: COMMON_CSS + EDIT_CSS + CHECK_LINK_CSS + `.pchip .more { display: none; }
.rail-hrow { display: flex; align-items: center; justify-content: space-between; } .rail-hrow .btn { height: 24px; padding: 0 10px; font-size: 12px; }
.org-dlg { width: min(520px, calc(100vw / var(--zoom) - 48px)); } .org-dlg .lst { display: flex; flex-direction: column; gap: 6px; padding: 4px 18px 6px; }
.org-dlg .it { display: grid; grid-template-columns: 40px 1fr auto auto; gap: 8px; align-items: center; } .org-dlg canvas { width: 36px; height: 36px; }
.org-dlg input { height: 30px; padding: 0 8px; border: 1px solid var(--line); border-radius: 6px; font: inherit; font-size: 13px; background: var(--panel); color: var(--text); }
.org-dlg .ud { display: flex; gap: 2px; } .org-dlg .ud button { width: 28px; height: 28px; border: 1px solid var(--line); background: var(--panel); border-radius: 6px; cursor: pointer; color: var(--text); } .org-dlg .ud button:disabled { opacity: .4; }
.org-dlg .del2 { border: 0; background: none; color: var(--accent); font: inherit; font-size: 12px; cursor: pointer; } .org-dlg .foot { display: flex; justify-content: flex-end; gap: 8px; padding: 10px 18px 18px; }`,
    ops: [['script', `${BASE}${EDIT_BAR}
chips(); tipCtrl(); editBar((bar) => $('.panel').prepend(bar));
const h = $('.rail-h'); const row = mk('div', 'rail-hrow'); h.before(row); row.append(h); const ob = mk('button', 'btn small', '整理…'); ob.type = 'button'; ob.title = '名前・並べ替え・削除'; row.append(ob);
const hint = $('.preview > .hint.center'); const l = mk('button', 'checklink', '貼った大きさが違うときは → 大きさを確かめる'); l.type = 'button'; l.onclick = openCheck; hint.after(l);
window.__ui.organize = () => { const d = mk('dialog', 'org-dlg', '<div class="dlg-head"><h1>登録した印の整理</h1><button type="button" class="btn small quiet">閉じる</button></div>'); const lst = mk('div', 'lst'); const ps = presets();
  $$('.pchip canvas').forEach((src, i) => { const it = mk('div', 'it'); const cv = mk('canvas'); cv.width = src.width; cv.height = src.height; cv.getContext('2d').drawImage(src, 0, 0); const inp = mk('input'); inp.value = ps[i].name;
    const ud = mk('span', 'ud', '<button title="上へ"' + (i === 0 ? ' disabled' : '') + '>▲</button><button title="下へ"' + (i === ps.length - 1 ? ' disabled' : '') + '>▼</button>'); it.append(cv, inp, ud, mk('button', 'del2', '削除')); lst.append(it); });
  d.append(lst, mk('div', 'foot', '<button class="btn small">やめる</button><button class="btn small primary">保存</button>')); document.body.append(d); d.showModal(); };
ob.onclick = () => window.__ui.organize();`]],
  },
];
