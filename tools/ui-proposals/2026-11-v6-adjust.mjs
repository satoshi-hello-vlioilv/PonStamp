// 改良案（2026-11・v6）: スライダーで変える所を 1 か所に集め、日付の書式を増やして自分でも書けるようにする。
//   node tools/ui-variants.mjs 出力 tools/ui-proposals/2026-11-v6-adjust.mjs --view 1728x1152 --states mitome,date,advanced,datecustom
//
// 今の画面で見えたこと（ui-check.mjs の date・advanced を 3 つの大きさで撮った）:
//   - スライダーが 3 か所に分かれる: 「印の字の大きさ」は印の文字の下・「大きさ」は印の見た目の中・枠の太さ／字の太さ／かすれ／傾きは
//     閉じた「書体と風合い」の中。変えたい物を探させる（閉じていると中に何があるか思い出させる）
//   - 日付は 3 つの部品の組み合わせ（年の書き方の一覧・区切りの札・月日を 2 桁）。一覧の例が区切りで変わり、出来上がりを推測させる。
//     スラッシュの形（2026/11/4）は 2 つを組み合わせないと出ない。自分で書く手段が無い
// 案の方向（何で解くか）: A まとめて常に見せる（置き場）・B 結果の隣に置く（置き場）・C 2 段に分けて元に戻す口を付ける（見せ方）・
//   D 面を分ける（流れ）・E 格子に詰める（減らし方）。日付は A・E 札で選ぶ／B 一覧／C 打てる箱が主／D 例の一覧（2 列）
// 道具: 日付の部品（一覧 #inDatePreset・札 #datePresets・自分で書く #dateCustom）は今の画面にそろえてあり、案は見せ方だけを変える。

import { SEED } from '../ui-harness.mjs';

export const BASE = `
const $ = (s, r = document) => r.querySelector(s); const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const mk = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const field = (id) => $('#' + id).closest('.field');
const SL = ['sizeField', 'rgText', 'rgBorder', 'rgBold', 'rgKasure', 'rgTilt'];
const sliders = () => SL.map((id) => (id === 'sizeField' ? $('#sizeField') : field(id)));
const advRow = () => $('#btnReseed').closest('.row');
const relabel = () => { $('label[for=rgSize]').textContent = '印の大きさ'; $('label[for=rgText]').textContent = '字の大きさ'; };
const dropAdv = () => { const d = $('details.adv'); const now = $('#advNow'); now.style.display = 'none'; document.body.append(now); d.remove(); };
window.__ui = { adjust: () => {}, custom: () => { const s = $('#inDatePreset'); s.value = ''; s.dispatchEvent(new Event('change')); const b = $('#inDateTpl'); b.value = 'ggge年m月d日(aaa)'; b.dispatchEvent(new Event('input')); } };
/** 日付の札をまとまりごとに見出しを付けて並べる（data-group） */
const groupChips = () => { const box = $('#datePresets'); const groups = {}; $$('[data-v]', box).forEach((b) => { (groups[b.dataset.group] ||= []).push(b); });
  box.innerHTML = ''; for (const [g, list] of Object.entries(groups)) { const row = mk('div', 'dp-row'); row.append(mk('span', 'dp-g', g)); const wrap = mk('div', 'dp-chips'); wrap.append(...list); row.append(wrap); box.append(row); } };
/** 「自分で書く」の札（押すと書く箱を開く。いまの書式が決まった物に無ければ開いている） */
const customChip = (where) => { const b = mk('button', 'dp-custom', '自分で書く'); b.type = 'button'; where(b); const box = $('#dateCustom');
  const sync = () => { const own = !$$('#datePresets [data-v]').some((x) => x.getAttribute('aria-pressed') === 'true'); const on = String(own || box.classList.contains('open')); if (b.getAttribute('aria-pressed') !== on) b.setAttribute('aria-pressed', on); box.hidden = on !== 'true'; };
  b.onclick = () => { box.classList.add('open'); sync(); $('#inDateTpl').focus(); };
  new MutationObserver(sync).observe($('#datePresets'), { attributes: true, subtree: true, attributeFilter: ['aria-pressed'] }); sync();
  const c = window.__ui.custom; window.__ui.custom = () => { box.classList.add('open'); c(); sync(); }; };
`;
export const COMMON_CSS = `
.datepats .dp-row { display: grid; grid-template-columns: 64px 1fr; align-items: start; gap: 6px; margin-top: 6px; }
.datepats .dp-g { font-size: 12px; color: var(--muted); padding-top: 6px; }
.datepats .dp-chips { display: flex; flex-wrap: wrap; gap: 4px; }
.datepats button, .dp-custom { height: 28px; padding: 0 10px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel); color: var(--text); font: inherit; font-size: 13px; font-variant-numeric: tabular-nums; cursor: pointer; white-space: nowrap; }
.datepats button:hover, .dp-custom:hover { border-color: var(--muted); }
.datepats button[aria-pressed="true"], .dp-custom[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); font-weight: 700; box-shadow: inset 0 0 0 1px var(--accent); }
.datecustom[hidden] { display: none; }
.adjust-btns { display: flex; gap: 8px; }
`;

export const EXTRA_STATES = [
  { name: 'datecustom', seed: SEED, run: async (page) => { await page.locator('[data-type="date"]').first().click(); await page.evaluate(() => window.__ui.custom()); await page.waitForTimeout(150); } },
];

export const PROPOSALS = [
  {
    key: 'A', name: '「大きさと風合い」のまとまりに 6 本のスライダー（印の大きさ・字の大きさ・枠・字の太さ・かすれ・傾き）を常に並べる。書体は色の隣（印の見た目）。日付は例の札（西暦・スラッシュ・和暦・漢字）と「自分で書く」',
    css: COMMON_CSS + `.datepats { display: block; } #inDatePreset { display: none; } .row:has(> #inDatePreset) { display: none; }`,
    ops: [['script', `${BASE}
relabel(); const font = field('inFont'); $('#sizeField').before(font); font.classList.add('line');
const h = mk('h3', 'grp', '大きさと風合い'); font.after(h); h.after(...sliders(), advRow()); advRow().classList.add('adjust-btns'); dropAdv();
groupChips(); customChip((b) => $('#datePresets').append(b));`]],
  },
  {
    key: 'B', name: 'スライダーをプレビューの横へ（変えた結果のすぐ隣・印の大きさから傾きまで 6 本を縦に）。左の列は文字・日付・色・書体だけ。日付は例の一覧（今日の日付で）と、一覧の「自分で書く…」で開く書く箱',
    css: COMMON_CSS + `.stagewrap { display: flex; gap: 20px; align-items: flex-start; justify-content: center; width: 100%; }
.tune { flex: 0 0 236px; display: flex; flex-direction: column; gap: 8px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); }
.tune .tune-h { font-size: 13px; font-weight: 700; }
.tune .field.slider { grid-template-columns: 1fr auto; grid-template-areas: "l v" "b b" "t t"; row-gap: 2px; }
.tune #sizeField .val input { width: 56px; } .tune .ticks { margin-top: 0; }
.tune .adjust-btns { flex-direction: column; gap: 6px; } .tune .adjust-btns .btn { width: 100%; }
.stage { width: min(100% - 256px, 640px, calc(100vh / var(--zoom) - 340px)); }`,
    ops: [['script', `${BASE}
relabel(); const font = field('inFont'); $('#sizeField').before(font); font.classList.add('line');
const row = advRow(); row.classList.add('adjust-btns'); const t = mk('section', 'tune'); t.append(mk('div', 'tune-h', '大きさと風合い'), ...sliders(), row);
const wrap = mk('div', 'stagewrap'); $('#stage').before(wrap); wrap.append($('#stage'), t); dropAdv();
const sel = $('#inDatePreset'); const box = $('#dateCustom'); const sync = () => { box.hidden = sel.value !== ''; }; sel.addEventListener('change', sync); new MutationObserver(sync).observe(sel, { subtree: true, childList: true, characterData: true }); setTimeout(sync); document.addEventListener('input', () => setTimeout(sync)); document.addEventListener('click', () => setTimeout(sync));
const c = window.__ui.custom; window.__ui.custom = () => { c(); box.hidden = false; };`]],
  },
  {
    key: 'C', name: '「大きさ」（印・字）と「風合い」（枠・字の太さ・かすれ・傾き）の 2 段を 1 つのまとまりに。行ごとに初期値へ戻す ↺。書体は印の文字の中。日付は書式の箱が主で、よく使う形 6 つの札と「ほかの形 ▾」',
    css: COMMON_CSS + `.panel { --cols: var(--lbl) 1fr 68px 24px; } .field.slider { grid-template-areas: "l b v r" ". t . ."; } .rs { grid-area: r; border: 0; background: none; color: var(--muted); width: 24px; height: 24px; border-radius: 6px; cursor: pointer; font-size: 14px; } .rs:hover { background: var(--chip); color: var(--text); }
.sub { font-size: 12px; color: var(--muted); margin: 2px 0 -2px; } .datecustom { margin-top: 0; } .row:has(> #inDatePreset) { display: none; }
.quick { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }`,
    ops: [['script', `${BASE}
relabel(); const font = field('inFont'); field('inName').after(font); $('#inDept').closest('.field').before(...[]);
const h = mk('h3', 'grp', '大きさと風合い'); $('#swatches').closest('.field').after(h);
const s = sliders(); h.after(mk('p', 'sub', '大きさ'), s[0], s[1], mk('p', 'sub', '風合い'), s[2], s[3], s[4], s[5], advRow()); advRow().classList.add('adjust-btns'); dropAdv();
s.forEach((f) => { const b = mk('button', 'rs', '↺'); b.type = 'button'; b.title = '初期値に戻す'; f.append(b); });
$('#btnResetAdv').textContent = 'すべて初期値に戻す';
const custom = $('#dateCustom'); custom.querySelector('label').textContent = '書式'; const q = mk('div', 'quick'); custom.querySelector('input').after(q);
['yy/m/d', 'yyyy/m/d', 'yyyy/mm/dd', "'yy.m.d", 'ge.m.d', 'ggge年m月d日'].forEach((v) => { const src = $('#datePresets [data-v="' + v + '"]'); if (src) q.append(src); });
const more = mk('button', 'dp-custom', 'ほかの形 ▾'); more.type = 'button'; q.append(more); $('#datePresets').hidden = true;`]],
  },
  {
    key: 'D', name: '入力の列を「文字」「見た目」の 2 面に分ける。見た目の面に色・書体・6 本のスライダーをまとめる。日付は例の一覧（2 列の選ぶ札）と「自分で書く」',
    css: COMMON_CSS + `.facets { display: flex; gap: 2px; border-bottom: 1px solid var(--line); } .facets button { flex: 1; height: 36px; border: 0; border-bottom: 3px solid transparent; background: none; color: var(--muted); font: inherit; font-size: 14px; cursor: pointer; }
.facets button[aria-selected="true"] { color: var(--text); font-weight: 700; border-bottom-color: var(--accent); }
.facet[hidden] { display: none !important; } .facet { display: flex; flex-direction: column; gap: 12px; }
.datepats { display: block; } .datepats .dp-chips { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; } .datepats .dp-row { grid-template-columns: 1fr; gap: 2px; } .datepats .dp-g { padding-top: 0; }
.row:has(> #inDatePreset) { display: none; }`,
    ops: [['script', `${BASE}
relabel(); const panel = $('.panel'); const tabs = $('#typeTabs');
const bar = mk('div', 'facets', '<button type="button" aria-selected="true">文字</button><button type="button" data-open="advanced" aria-selected="false">見た目と大きさ</button>');
const f1 = mk('div', 'facet'), f2 = mk('div', 'facet'); f2.hidden = true;
const grpText = $$('.grp')[0], grpLook = $$('.grp')[1];
tabs.after(bar); bar.after(f1, f2);
let n = grpText; const take = []; while (n && n !== grpLook) { take.push(n); n = n.nextElementSibling; } f1.append(...take.filter((e) => e !== grpText));
grpText.remove(); f2.append(field('inFont'), $('#swatches').closest('.field'), ...sliders(), advRow()); advRow().classList.add('adjust-btns'); grpLook.remove(); dropAdv();
const show = (i) => { [f1, f2].forEach((f, k) => { f.hidden = k !== i; }); $$('button', bar).forEach((b, k) => b.setAttribute('aria-selected', String(k === i))); };
$$('button', bar).forEach((b, i) => { b.onclick = () => show(i); });
groupChips(); customChip((b) => $('#datePresets').append(b));`]],
  },
  {
    key: 'E', name: '「大きさと風合い」を 2 列の格子に詰める（名前と値が上・帯が下の 6 つの枡）。印の見た目の下に常に出す。書体は色の隣。日付は 2 行の札（よく使う形）と「ほかの形・自分で書く ▾」の一覧',
    css: COMMON_CSS + `.grid6 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px; }
.grid6 .field.slider { grid-template-columns: 1fr auto; grid-template-areas: "l v" "b b" "t t"; row-gap: 2px; }
.grid6 #sizeField .val input { width: 56px; } .grid6 .ticks { margin-top: 0; } .grid6 .adjust-btns { grid-column: 1 / -1; }
.datepats { display: block; } .datepats .dp-row { grid-template-columns: 1fr; } .datepats .dp-g { display: none; }
.more-fmt { height: 28px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel); color: var(--muted); font: inherit; font-size: 13px; padding: 0 6px; } .more-fmt.on { border-color: var(--accent); color: var(--accent); font-weight: 700; }`,
    ops: [['script', `${BASE}
relabel(); const font = field('inFont'); $('#sizeField').before(font); font.classList.add('line');
const h = mk('h3', 'grp', '大きさと風合い'); font.after(h); const g = mk('div', 'grid6'); h.after(g); g.append(...sliders(), advRow()); advRow().classList.add('adjust-btns'); dropAdv();
const keep = ["'yy.m.d", 'yy.m.d', 'yy/m/d', 'yyyy/m/d', 'yyyy/mm/dd', 'ge.m.d', 'ggge年m月d日'];
const box = $('#datePresets'); const w = mk('div', 'dp-chips'); const rest = $$('[data-v]', box).filter((b) => !keep.includes(b.dataset.v)); w.append(...$$('[data-v]', box).filter((b) => keep.includes(b.dataset.v)));
box.innerHTML = ''; box.append(w); const hide = mk('div'); hide.hidden = true; hide.append(...rest); box.append(hide);
$('.row:has(> #inDatePreset)').style.display = 'none'; const more = mk('select', 'more-fmt'); more.setAttribute('aria-label', 'ほかの形・自分で書く'); w.append(more);
const custom = $('#dateCustom');
const fillMore = () => { const cur = rest.find((b) => b.getAttribute('aria-pressed') === 'true'); const own = !$$('[data-v]', box).some((b) => b.getAttribute('aria-pressed') === 'true');
  more.innerHTML = ''; more.add(new Option('ほかの形 ▾', '')); rest.forEach((b) => more.add(new Option(b.textContent, b.dataset.v))); more.add(new Option('自分で書く…', '__own'));
  more.value = cur ? cur.dataset.v : own ? '__own' : ''; more.classList.toggle('on', !!cur || own); custom.hidden = !own; };
more.onchange = () => { if (more.value === '__own') { custom.hidden = false; $('#inDateTpl').focus(); } else rest.find((b) => b.dataset.v === more.value)?.click(); };
new MutationObserver(() => setTimeout(fillMore)).observe(box, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] }); setTimeout(fillMore);
const c = window.__ui.custom; window.__ui.custom = () => { c(); setTimeout(fillMore); };`]],
  },
];
