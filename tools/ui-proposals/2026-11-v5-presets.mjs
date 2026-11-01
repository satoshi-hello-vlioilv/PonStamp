// 改良案（2026-11・v5・1 回目）: ① 貼り付けの大きさを確かめる ② 登録した印を 1 手でコピー ③ 登録した印を直す（上書き・名前・並べ替え）。
//   node tools/ui-variants.mjs 出力 tools/ui-proposals/2026-11-v5-presets.mjs --view 1728x1152 --states mitome,edited,check,organize
// 今の画面で見えたこと・作りから分かったこと:
//   - 登録した印は押すと呼び出すだけ。コピーには「コピー」をもう 1 手（いちばん多い使い方が 2 手）
//   - 上書きは「＋ いまの印を登録」で同じ名前を打ち直したときだけ（登録の窓はいまの印から名前を作るので、上書きしたい印の名前を思い出して打つ）。
//     名前の変更・並べ替えの手段は無い（削除して登録し直す）
//   - Office に貼ったとき決めた mm になるかは確かめていない（README）。確かめる手段が画面に無い
// 案の方向: A 札に並べる・B 押すとコピー（流れを変える）・C 編集中の帯・D 整理の場を分ける・E 右クリックの型

import { SEED } from '../ui-harness.mjs';

/** どの案も使う: 呼び出した印と変更の追い方・ものさしの絵・撮影の口（window.__ui） */
const BASE = `
const $ = (s, r = document) => r.querySelector(s); const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const presets = () => { try { return JSON.parse(localStorage.getItem('ponstamp.state')).presets || []; } catch { return []; } };
let loaded = -1, dirty = false; const hooks = [];
const emit = () => hooks.forEach((f) => f({ loaded, dirty, name: presets()[loaded]?.name }));
document.addEventListener('click', (e) => { const b = e.target.closest('.pchip .load'); if (!b) return; loaded = $$('.pchip').indexOf(b.closest('.pchip')); dirty = false; setTimeout(emit); }, true);
const onEdit = (e) => { if (loaded >= 0 && e.target.closest('.panel')) { dirty = true; emit(); } };
document.addEventListener('input', onEdit, true); document.addEventListener('change', onEdit, true);
/** ものさし（試しの絵）: 50mm の目盛り。1mm ごとの短い線・5mm の中くらい・10mm に数（cm） */
const drawRuler = (cv, wpx) => { const mm = 50, h = 16, k = wpx / mm; cv.width = wpx; cv.height = Math.round(h * k); const c = cv.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, cv.width, cv.height); c.strokeStyle = '#111'; c.fillStyle = '#111'; c.lineWidth = Math.max(1, k * 0.15);
  c.strokeRect(c.lineWidth / 2, c.lineWidth / 2, cv.width - c.lineWidth, cv.height - c.lineWidth);
  for (let i = 0; i <= mm; i++) { const x = Math.min(cv.width - c.lineWidth / 2, Math.max(c.lineWidth / 2, i * k)); const len = i % 10 === 0 ? 7 : i % 5 === 0 ? 5 : 3; c.beginPath(); c.moveTo(x, 0); c.lineTo(x, len * k); c.stroke();
    if (i % 10 === 0 && i > 0 && i < mm) { c.font = (3.2 * k) + 'px sans-serif'; c.textAlign = 'center'; c.fillText(String(i / 10), x, 10.6 * k); } }
  c.font = 'bold ' + (2.4 * k) + 'px sans-serif'; c.textAlign = 'center'; c.fillText('枠の幅 50 mm', cv.width / 2, 14.2 * k); };
/** 試しの窓（どの案も同じ中身。開く所が違う） */
const checkDialog = () => { let d = $('#dlgCheck'); if (d) return d; d = mk('dialog', 'check-dlg'); d.id = 'dlgCheck';
  d.innerHTML = '<div class="dlg-head"><h1>貼り付けの大きさを確かめる</h1><button type="button" class="btn small quiet" data-x>閉じる</button></div>'
   + '<div class="ck"><canvas class="ruler"></canvas><ol><li>「ものさしをコピー」を押す</li><li>Word・Excel・PowerPoint に Ctrl+V で貼る</li><li>貼った図を選び、「図の形式」→「サイズ」の幅が <b>50 mm</b> か見る（定規を当ててもよい）</li></ol>'
   + '<div class="row"><button type="button" class="btn primary small">ものさしをコピー</button><button type="button" class="btn small">PNG で保存</button></div>'
   + '<p class="hint">いまの解像度（600 dpi）で、印と同じ道（コピー・保存）を通します。50 mm でなければ、PNG で保存してファイルから挿入してください。</p></div>';
  document.body.append(d); d.querySelector('[data-x]').onclick = () => d.close(); drawRuler(d.querySelector('canvas'), 560); return d; };
const openCheck = () => checkDialog().showModal();
const CHECK_CSS_ONCE = true;
window.__ui = { openCheck, organize: () => {}, load: (i) => $$('.pchip .load')[i]?.click() };
/** 札に番号とコピーのボタンを足す（A・C・D・E） */
const chipCopy = (opts = {}) => { const run = () => $$('.pchip').forEach((chip, i) => { if (chip.querySelector('.cp')) return;
  if (i < 9) chip.prepend(mk('span', 'num', String(i + 1)));
  const b = mk('button', 'cp' + (opts.icon ? ' icon' : ''), opts.icon ? '⧉' : 'コピー'); b.type = 'button'; b.title = 'コピー（Ctrl+' + (i + 1) + '）'; b.setAttribute('aria-label', '「' + (presets()[i]?.name || '') + '」をコピー');
  chip.querySelector('.del').before(b); });
  new MutationObserver(run).observe($('#presetBar'), { childList: true }); run(); };
`;
const COMMON_CSS = `
.check-dlg { width: min(640px, calc(100vw / var(--zoom) - 48px)); }
.check-dlg .ck { display: flex; flex-direction: column; gap: 12px; padding: 4px 18px 18px; }
.check-dlg canvas.ruler { width: 100%; height: auto; border-radius: 4px; box-shadow: 0 0 0 1px var(--line); }
.check-dlg ol { margin: 0; padding-left: 20px; } .check-dlg .hint { margin: 0; }
:root { --rail: 256px; }
.pchip { position: relative; }
.pchip .num { position: absolute; left: 2px; top: 2px; z-index: 1; width: 16px; height: 16px; display: inline-grid; place-items: center; border-radius: 4px; background: var(--panel); border: 1px solid var(--line); font-size: 11px; font-weight: 700; color: var(--muted); font-variant-numeric: tabular-nums; }
.pchip .cp { flex: none; height: 26px; padding: 0 8px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel); color: var(--text); font: inherit; font-size: 12px; font-weight: 700; cursor: pointer; }
.pchip .cp:hover { border-color: var(--accent); color: var(--accent); }
.pchip.on { background: var(--panel); border-color: var(--accent); }
.dirty-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--accent); margin-left: 6px; vertical-align: 2px; }
@media (min-width: 1600px) and (min-height: 1000px) { :root { --rail: 300px; } .rail .pchip .num { top: 4px; left: 4px; } .rail .pchip .cp { width: 100%; } }
`;
/** 編集中の帯（B・C）: 入力の列の上 */
const EDIT_BAR = `
const editBar = (labels) => { const bar = mk('div', 'editbar'); bar.hidden = true; $('.panel').prepend(bar);
  hooks.push(({ loaded: i, dirty: d, name }) => { bar.hidden = i < 0; if (i < 0) return;
    bar.innerHTML = '<span class="eb-t">編集中: <b>' + name + '</b>' + (d ? '<span class="dirty-dot" aria-hidden="true"></span><small>変更あり</small>' : '') + '</span>';
    const acts = mk('span', 'eb-a'); for (const [t, cls] of labels(d)) { const b = mk('button', cls, t); b.type = 'button'; acts.append(b); } bar.append(acts);
    $$('.pchip').forEach((c, k) => c.classList.toggle('on', k === i)); }); };
`;
const EDIT_CSS = `
.editbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 8px 10px; border: 1px solid var(--accent); border-radius: 10px; background: color-mix(in srgb, var(--accent) 7%, var(--panel)); font-size: 13px; }
.editbar[hidden] { display: none; }
.editbar small { margin-left: 4px; font-size: 12px; color: var(--accent); font-weight: 700; } .editbar .eb-a { display: flex; gap: 6px; } .editbar .btn { white-space: nowrap; }
`;

export const EXTRA_STATES = [
  // 登録した印を呼び出して変えた所（上書きの出し方を見る）
  { name: 'edited', seed: SEED, run: async (page) => { await page.evaluate(() => window.__ui.load(0)); await page.fill('#inName', '山田太郎'); await page.waitForTimeout(150); } },
  // 貼り付けの大きさを確かめる窓
  { name: 'check', seed: SEED, run: async (page) => { await page.evaluate(() => window.__ui.openCheck()); await page.waitForTimeout(150); } },
  // 名前・並べ替え・削除の操作を出した所（案ごとの出し方）
  { name: 'organize', seed: SEED, run: async (page) => { await page.evaluate(() => window.__ui.organize()); await page.waitForTimeout(150); } },
];

export const PROPOSALS = [
  {
    key: 'A', name: '札に並べる（番号・コピーのボタン・…で名前/順/削除）。呼び出して変えると登録が「上書き／新しく登録」に分かれる。確かめはコピーの列の下から',
    css: COMMON_CSS + `.reg2 { display: grid; grid-template-columns: 1fr; gap: 4px; } .reg2 .btn { width: 100%; }
.pchip .more { border: 0; background: none; color: var(--muted); width: 24px; height: 24px; border-radius: 6px; cursor: pointer; font-size: 16px; } .pchip .more:hover { background: var(--line); }
.pmenu { position: absolute; z-index: 5; min-width: 180px; padding: 6px; border-radius: 10px; background: var(--panel); border: 1px solid var(--line); box-shadow: 0 8px 24px rgba(0,0,0,.16); display: flex; flex-direction: column; }
.pmenu button { text-align: left; border: 0; background: none; color: var(--text); font: inherit; font-size: 13px; padding: 7px 10px; border-radius: 6px; cursor: pointer; } .pmenu button:hover { background: var(--chip); } .pmenu .danger { color: var(--accent); }
.preview .checklink { border: 0; background: none; color: var(--focus); font: inherit; font-size: 12px; cursor: pointer; padding: 0; }`,
    ops: [['script', `${BASE}
chipCopy();
const more = () => $$('.pchip').forEach((c) => { const d = c.querySelector('.del'); if (!d || d.dataset.m) return; d.dataset.m = 1; d.className = 'more'; d.textContent = '…'; d.title = '名前・並べ替え・削除'; });
new MutationObserver(more).observe($('#presetBar'), { childList: true }); more();
const add = $('#btnAddPreset'); const reg = mk('div', 'reg2'); add.before(reg); reg.append(add);
hooks.push(({ loaded: i, dirty: d, name }) => { $$('.pchip').forEach((c, k) => c.classList.toggle('on', k === i));
  reg.querySelector('.ow')?.remove(); if (i >= 0 && d) { const b = mk('button', 'btn small primary ow', '「' + name + '」に上書き'); b.type = 'button'; reg.prepend(b); add.textContent = '＋ 新しく登録'; } else add.textContent = '＋ いまの印を登録'; });
const hint = $('.preview > .hint.center'); const l = mk('button', 'checklink', '貼った大きさが違うときは → 大きさを確かめる'); l.type = 'button'; l.onclick = openCheck; hint.after(l);
window.__ui.organize = () => { const c = $$('.pchip')[1]; const r = c.getBoundingClientRect(); const m = mk('div', 'pmenu', '<button>名前を変える</button><button>上へ</button><button>下へ</button><button class="danger">削除</button>');
  m.style.left = (r.right - 4) + 'px'; m.style.top = (r.top) + 'px'; document.body.append(m); };`]],
  },
  {
    key: 'B', name: '札を押すとコピー（いちばん多い使い方を 1 手に）・鉛筆で呼び出して直す。直すときは入力の上に編集中の帯（上書き・別名で登録・やめる）。確かめは設定の「保存とコピー」',
    css: COMMON_CSS + EDIT_CSS + `.pchip .edit { flex: none; border: 1px solid var(--line); background: var(--panel); color: var(--text); width: 28px; height: 26px; border-radius: 7px; cursor: pointer; font-size: 13px; }
.pchip .load::after { content: 'コピー'; margin-left: auto; font-size: 11px; font-weight: 700; color: var(--accent); opacity: 0; } .pchip:hover .load::after { opacity: 1; }
.rail-h::after { content: '（押すとコピー）'; font-weight: 400; margin-left: 4px; }
.set-check { display: flex; align-items: center; gap: 10px; }`,
    ops: [['script', `${BASE}${EDIT_BAR}
const pen = () => $$('.pchip').forEach((c, i) => { if (c.querySelector('.edit')) return; const b = mk('button', 'edit', '✎'); b.type = 'button'; b.title = '呼び出して直す'; b.onclick = () => { loaded = i; dirty = false; emit(); }; c.querySelector('.del').before(b); c.querySelector('.load').title = 'コピー（Ctrl+' + (i + 1) + '）'; });
new MutationObserver(pen).observe($('#presetBar'), { childList: true }); pen();
editBar((d) => [[d ? '上書き' : '上書き', 'btn small primary'], ['別名で登録', 'btn small'], ['やめる', 'btn small quiet']]);
window.__ui.load = (i) => { $$('.pchip .edit')[i]?.click(); };
const put = () => { const out = $('#settings')?.querySelector('section'); if (!out || out.querySelector('.set-check')) return; const row = mk('div', 'set-row'); row.innerHTML = '<span class="set-label">貼り付けの大きさ</span>';
  const v = mk('div', 'set-check'); const b = mk('button', 'btn small', '大きさを確かめる…'); b.type = 'button'; b.onclick = openCheck; v.append(b, mk('span', 'hint', 'Office に貼って 50mm になるか確かめます')); row.append(v); out.append(row); };
new MutationObserver(put).observe($('#settings'), { childList: true }); put();`]],
  },
  {
    key: 'C', name: '札に番号とコピーのボタン。呼び出すと入力の上に「編集中」の帯（変更ありの印・上書き・新しく登録）。並べ替えはドラッグ（つまみ）・名前は札をダブルクリック。確かめはプレビューの寸法の隣',
    css: COMMON_CSS + EDIT_CSS + `.pchip .grip { position: absolute; left: -8px; top: 50%; transform: translateY(-50%); color: var(--muted); cursor: grab; font-size: 12px; letter-spacing: -2px; opacity: 0; } .pchip:hover .grip { opacity: 1; }
.meta .checklink { margin-left: 8px; border: 0; background: none; color: var(--focus); font: inherit; font-size: 12px; cursor: pointer; padding: 0; }
.rail .rail-tip2 { margin: 0; padding: 0 6px; font-size: 11.5px; color: var(--muted); }`,
    ops: [['script', `${BASE}${EDIT_BAR}
chipCopy();
const grip = () => $$('.pchip').forEach((c) => { if (c.querySelector('.grip')) return; const g = mk('span', 'grip', '⋮⋮'); g.title = 'ドラッグで並べ替え'; c.prepend(g); });
new MutationObserver(grip).observe($('#presetBar'), { childList: true }); grip();
$('#presetBar').after(mk('p', 'rail-tip2', 'ドラッグで並べ替え・名前はダブルクリックで変える'));
editBar((d) => d ? [['上書き', 'btn small primary'], ['新しく登録', 'btn small']] : [['閉じる', 'btn small quiet']]);
const meta = $('#meta'); const l = mk('button', 'checklink', '大きさを確かめる'); l.type = 'button'; l.onclick = openCheck;
new MutationObserver(() => { if (!meta.contains(l)) meta.append(l); }).observe(meta, { childList: true, characterData: true, subtree: true }); meta.append(l);`]],
  },
  {
    key: 'D', name: '札は番号とコピーだけにして軽く。「整理」で帯が編集の一覧になる（名前の欄・▲▼・削除）。上書きは登録の窓で選ぶ。確かめは設定の「保存とコピー」',
    css: COMMON_CSS + `.rail-hrow { display: flex; align-items: center; justify-content: space-between; } .rail-hrow .btn { height: 24px; padding: 0 10px; font-size: 12px; }
.org .pchip .load canvas { display: none; } .org .pchip .num, .org .pchip .cp { display: none; }
.org .pchip input { width: 100%; height: 28px; padding: 0 8px; border: 1px solid var(--line); border-radius: 6px; font: inherit; font-size: 13px; background: var(--panel); color: var(--text); }
.org .pchip .ud { display: flex; gap: 2px; } .org .pchip .ud button { width: 26px; height: 26px; border: 1px solid var(--line); background: var(--panel); border-radius: 6px; cursor: pointer; color: var(--text); }
.org .pchip { background: var(--panel); border-color: var(--line); }
.rail.org .presets { display: flex !important; flex-direction: column; gap: 4px; } .rail.org .pchip { flex-direction: row !important; padding: 4px 6px !important; } .rail.org .pchip .load { flex-direction: row !important; }
.rail.org .pchip .del { position: static !important; }
.set-check { display: flex; align-items: center; gap: 10px; }`,
    ops: [['script', `${BASE}
chipCopy();
$$('.pchip .del').forEach((d) => { d.style.display = 'none'; });
const h = $('.rail-h'); const row = mk('div', 'rail-hrow'); h.before(row); row.append(h); const ob = mk('button', 'btn small', '整理'); ob.type = 'button'; row.append(ob);
window.__ui.organize = () => { $('.rail').classList.add('org'); ob.textContent = '終わる'; $$('.pchip').forEach((c, i) => { const nm = c.querySelector('.nm'); const inp = mk('input'); inp.value = nm.textContent; nm.replaceWith(inp);
  const ud = mk('span', 'ud', '<button title="上へ">▲</button><button title="下へ">▼</button>'); const del = c.querySelector('.del'); del.style.display = ''; del.textContent = '削除'; del.style.width = 'auto'; del.style.fontSize = '12px'; c.querySelector('.cp').before(ud); }); };
ob.onclick = () => window.__ui.organize();
const put = () => { const out = $('#settings')?.querySelector('section'); if (!out || out.querySelector('.set-check')) return; const r = mk('div', 'set-row'); r.innerHTML = '<span class="set-label">貼り付けの大きさ</span>';
  const v = mk('div', 'set-check'); const b = mk('button', 'btn small', '大きさを確かめる…'); b.type = 'button'; b.onclick = openCheck; v.append(b, mk('span', 'hint', 'Office に貼って 50mm になるか確かめます')); r.append(v); out.append(r); };
new MutationObserver(put).observe($('#settings'), { childList: true }); put();
hooks.push(({ loaded: i }) => $$('.pchip').forEach((c, k) => c.classList.toggle('on', k === i)));`]],
  },
  {
    key: 'E', name: '札に番号とコピーのボタン。直すのは札の右クリック／… のメニュー（呼び出す・上書き・名前を変える・上へ・下へ・削除。Windows で慣れた型）。確かめは初回の知らせと設定',
    css: COMMON_CSS + `.pchip .more { border: 0; background: none; color: var(--muted); width: 24px; height: 24px; border-radius: 6px; cursor: pointer; font-size: 16px; } .pchip .more:hover { background: var(--line); }
.pmenu { position: absolute; z-index: 5; min-width: 200px; padding: 6px; border-radius: 10px; background: var(--panel); border: 1px solid var(--line); box-shadow: 0 8px 24px rgba(0,0,0,.16); display: flex; flex-direction: column; }
.pmenu button { display: flex; justify-content: space-between; gap: 16px; text-align: left; border: 0; background: none; color: var(--text); font: inherit; font-size: 13px; padding: 7px 10px; border-radius: 6px; cursor: pointer; }
.pmenu button:hover { background: var(--chip); } .pmenu kbd { margin: 0; } .pmenu hr { border: 0; border-top: 1px solid var(--line); margin: 4px 2px; } .pmenu .danger { color: var(--accent); } .pmenu .off { color: var(--muted); }`,
    ops: [['script', `${BASE}
chipCopy();
const more = () => $$('.pchip').forEach((c) => { const d = c.querySelector('.del'); if (!d || d.dataset.m) return; d.dataset.m = 1; d.className = 'more'; d.textContent = '…'; d.title = 'メニュー（右クリックでも）'; });
new MutationObserver(more).observe($('#presetBar'), { childList: true }); more();
hooks.push(({ loaded: i, dirty: d }) => $$('.pchip').forEach((c, k) => { c.classList.toggle('on', k === i); c.querySelector('.dirty-dot')?.remove(); if (k === i && d) c.querySelector('.nm').append(mk('span', 'dirty-dot')); }));
window.__ui.organize = () => { const c = $$('.pchip')[0]; window.__ui.load(0); const r = c.getBoundingClientRect();
  const m = mk('div', 'pmenu', '<button>呼び出す</button><button>コピー<kbd>Ctrl+1</kbd></button><button>いまの印で上書き</button><hr><button>名前を変える…</button><button class="off">上へ</button><button>下へ</button><hr><button class="danger">削除</button>');
  m.style.left = (r.right - 4) + 'px'; m.style.top = r.top + 'px'; document.body.append(m); };
const notices = $('#notices'); const n = mk('div', 'notice info', '<b aria-hidden="true">i</b><span>Office に貼ったとき、決めた大きさ（mm）になるかを一度確かめてください（50mm のものさしで確かめられます）</span>');
const acts = mk('div', 'acts'); const b = mk('button', 'btn small', '大きさを確かめる'); b.type = 'button'; b.onclick = openCheck; acts.append(b, mk('button', 'btn small quiet', 'あとで')); n.append(acts); notices.append(n); notices.hidden = false;`]],
  },
];
