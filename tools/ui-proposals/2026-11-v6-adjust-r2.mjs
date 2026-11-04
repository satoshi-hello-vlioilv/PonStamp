// 改良案（2026-11・v6・2 回目）: 1 回目（1 位 B 79.1 点 < 80 点）の指摘を直し、案出しからやり直す。
//   node tools/ui-variants.mjs 出力 tools/ui-proposals/2026-11-v6-adjust-r2.mjs --view 1728x1152 --states mitome,date,advanced,datecustom
// 持ち越し: B2（B を直した物）・E2（E を直した物）。新しい案: F（右の端に縦の調整の列）・G（印の下に横長の調整）・H（入力と印の間に調整の列）
// 1 回目の指摘と直し（全案）:
//   - 「詳細を初期値に戻す」: 詳細の箱はもう無い → 「すべて初期値に戻す」
//   - 日付の例が一覧を開かないと見えない／札が多いと列が伸びる → よく使う 7 つを例の札（今日の日付・選んだ札は赤い縁）にし、残りと「自分で書く」は
//     札の並びの最後の「ほかの形 ▾」の一覧へ。自分で書くときだけ書く箱を出す
// B の指摘と直し:
//   - 1280 で印が 318→235px に小さい → 入力の列を少し細く（スライダーが抜けた分）・調整の札を 236→200px に。印は 1280 でも 300px ほど
//   - 1728 で印が左に寄り、コピーの行と中心がずれる → 印・寸法・コピーの行を 1 本の縦の並びにし、調整の札はその右に（印とコピーの中心がそろう）

import { BASE, COMMON_CSS, EXTRA_STATES as R1_STATES } from './2026-11-v6-adjust.mjs';

export const EXTRA_STATES = R1_STATES;

const BASE2 = `
$('#btnResetAdv').textContent = 'すべて初期値に戻す';
/** 日付: よく使う形の札（今日の日付）と、最後に「ほかの形 ▾」の一覧（残りの形・自分で書く） */
const dateQuick = () => {
  const keep = ["'yy.m.d", 'yy.m.d', 'yy/m/d', 'yyyy/m/d', 'yyyy/mm/dd', 'ge.m.d', 'ggge年m月d日'];
  const box = $('#datePresets'); const all = $$('[data-v]', box); const rest = all.filter((b) => !keep.includes(b.dataset.v));
  const w = mk('div', 'dp-chips'); w.append(...keep.map((v) => all.find((b) => b.dataset.v === v)));
  box.innerHTML = ''; box.append(w); const hide = mk('div'); hide.hidden = true; hide.append(...rest); box.append(hide);
  $('.row:has(> #inDatePreset)').style.display = 'none';
  const more = mk('select', 'more-fmt'); more.setAttribute('aria-label', 'ほかの形・自分で書く'); w.append(more);
  const custom = $('#dateCustom');
  const fill = () => { const cur = rest.find((b) => b.getAttribute('aria-pressed') === 'true'); const own = !all.some((b) => b.getAttribute('aria-pressed') === 'true');
    more.innerHTML = ''; more.add(new Option('ほかの形 ▾', '')); rest.forEach((b) => more.add(new Option(b.textContent, b.dataset.v))); more.add(new Option('自分で書く…', '__own'));
    more.value = cur ? cur.dataset.v : own ? '__own' : ''; more.classList.toggle('on', !!cur || own); custom.hidden = !own; };
  more.onchange = () => { if (more.value === '__own') { custom.hidden = false; $('#inDateTpl').focus(); } else rest.find((b) => b.dataset.v === more.value)?.click(); };
  new MutationObserver(() => setTimeout(fill)).observe(box, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] }); setTimeout(fill);
  const c = window.__ui.custom; window.__ui.custom = () => { c(); setTimeout(fill); };
};
/** 調整の札（見出し・6 本・模様を変える／すべて初期値に戻す）。名前と値が上・帯が下の縦の並び */
const tuneCard = (cls) => { const row = advRow(); row.classList.add('adjust-btns'); const t = mk('section', 'tune ' + (cls || ''));
  t.append(mk('div', 'tune-h', '大きさと風合い'), ...sliders(), row); return t; };
/** 印・寸法・地・コピーの行を 1 本の縦の並びにまとめる（調整を横に置いても、印とコピーの中心がそろう） */
const stack = () => { const p = $('.preview'); const s = mk('div', 'pstack'); s.append(...[...p.children]); p.append(s); return s; };
const fontToLook = () => { const font = field('inFont'); $('#sizeField').before(font); font.classList.add('line'); };
`;
const CSS2 = `
.panel { --lbl: 64px; }
@container (max-width: 760px) { .actions .btn.primary { min-width: 0; } .actions .btn { padding: 10px 14px; } .actions kbd, .bgrow .hint { display: none; } .bgrow .lbl { white-space: nowrap; } }
.datepats { display: block; } .datepats .dp-chips { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
.more-fmt { height: 28px; border: 1px solid var(--line); border-radius: 7px; background: var(--panel); color: var(--muted); font: inherit; font-size: 13px; padding: 0 6px; cursor: pointer; }
.more-fmt.on { border-color: var(--accent); color: var(--accent); font-weight: 700; box-shadow: inset 0 0 0 1px var(--accent); }
.tune { display: flex; flex-direction: column; gap: 8px; }
.tune .tune-h { font-size: 13px; font-weight: 700; color: var(--text); }
.tune .field.slider { grid-template-columns: 1fr auto; grid-template-areas: "l v" "b b" "t t"; row-gap: 2px; }
.tune #sizeField .val input { width: 56px; } .tune .ticks { margin-top: 0; }
.tune .adjust-btns { flex-direction: column; gap: 6px; } .tune .adjust-btns .btn { width: 100%; }
`;
/** 調整を印の横に置く案の、印の並び（印の幅 = 窓の高さと、調整の分を引いた横の幅の小さい方） */
const SIDE = (tune) => `
.preview { flex-direction: row; align-items: center; justify-content: center; gap: 24px; }
.pstack { display: flex; flex-direction: column; align-items: center; gap: 12px; width: min(640px, calc(100vh / var(--zoom) - 340px), calc(100cqw - ${tune + 24}px)); }
.pstack .stage { width: 100%; }
`;

export const PROPOSALS = [
  {
    key: 'B2', name: '調整（6 本）を印の右の札に縦に並べる。印・寸法・コピーの行は 1 本の縦の並びで中心がそろう。入力の列は文字・日付・色・書体だけで少し細く。日付はよく使う 7 つの例の札と「ほかの形 ▾」（B を直した物）',
    css: COMMON_CSS + CSS2 + SIDE(200) + `.layout { grid-template-columns: minmax(360px, 400px) 1fr; }
.tune.card { flex: 0 0 200px; padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); }`,
    ops: [['script', `${BASE}${BASE2}
relabel(); fontToLook(); const s = stack(); s.after(tuneCard('card')); dropAdv(); dateQuick();`]],
  },
  {
    key: 'F', name: '調整（6 本）を窓の右の端の縦の列に置く（入力｜印｜調整。よくある設計の道具の型）。列は上から下まで通し、入力の列と同じ見た目。日付はよく使う 7 つの例の札と「ほかの形 ▾」',
    css: COMMON_CSS + CSS2 + `.layout { grid-template-columns: minmax(360px, 400px) 1fr 232px; }
.tune.dock { min-height: 0; overflow-y: auto; padding: 16px; background: var(--panel); border-left: 1px solid var(--line); gap: 10px; }`,
    ops: [['script', `${BASE}${BASE2}
relabel(); fontToLook(); $('.layout').append(tuneCard('dock')); dropAdv(); dateQuick();`]],
  },
  {
    key: 'G', name: '調整（6 本）を印のすぐ下に横長の札で置く（3 列 × 2 段。名前と値が上・帯が下）。印・調整・コピーが上から順に 1 本の流れ。日付はよく使う 7 つの例の札と「ほかの形 ▾」',
    css: COMMON_CSS + CSS2 + `.tune.wide { width: min(100%, 640px); display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px 18px; padding: 10px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); }
.tune.wide .tune-h { grid-column: 1 / -1; display: flex; justify-content: space-between; align-items: center; } .tune.wide .adjust-btns { flex-direction: row; } .tune.wide .adjust-btns .btn { width: auto; }
.stage { width: min(100%, 640px, calc(100vh / var(--zoom) - 470px)); }`,
    ops: [['script', `${BASE}${BASE2}
relabel(); fontToLook(); const t = tuneCard('wide'); const row = t.querySelector('.adjust-btns'); t.querySelector('.tune-h').append(row); $('#meta').after(t); dropAdv(); dateQuick();`]],
  },
  {
    key: 'H', name: '調整（6 本）を入力の列と印の間に縦の列で置く（入力 → 調整 → 印と、左から右へ手と目が進む）。日付はよく使う 7 つの例の札と「ほかの形 ▾」',
    css: COMMON_CSS + CSS2 + `.layout { grid-template-columns: minmax(360px, 400px) 232px 1fr; }
.tune.mid { min-height: 0; overflow-y: auto; padding: 16px; background: var(--chip); border-right: 1px solid var(--line); gap: 10px; }`,
    ops: [['script', `${BASE}${BASE2}
relabel(); fontToLook(); $('.panel').after(tuneCard('mid')); dropAdv(); dateQuick();`]],
  },
  {
    key: 'E2', name: '入力の列の「大きさと風合い」に 6 本を 2 列の格子で常に出す（6 つの枡の形と高さをそろえ、目盛りは格子の外）。書体は色の隣。日付はよく使う 7 つの例の札と「ほかの形 ▾」（E を直した物）',
    css: COMMON_CSS + CSS2 + `.grid6 { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; }
.grid6 .field.slider { grid-template-columns: 1fr auto; grid-template-areas: "l v" "b b"; row-gap: 2px; }
.grid6 #sizeField .val input { width: 56px; } .grid6 .ticks { display: none; } .grid6 .adjust-btns { grid-column: 1 / -1; }`,
    ops: [['script', `${BASE}${BASE2}
relabel(); fontToLook(); const h = mk('h3', 'grp', '大きさと風合い'); field('inFont').after(h); const g = mk('div', 'grid6'); h.after(g);
const row = advRow(); row.classList.add('adjust-btns'); g.append(...sliders(), row); dropAdv(); dateQuick();`]],
  },
];
