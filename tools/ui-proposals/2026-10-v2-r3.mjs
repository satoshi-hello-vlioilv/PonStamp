// 改良案（2026-10・v2・3 回目・最後の回）: 2 回目の採点（1 位 H 76.1 点・D2 は加点だけなら 78.1 点）の指摘を直し、案出しからやり直す。
//   node tools/ui-variants.mjs 出力 tools/ui-proposals/2026-10-v2-r3.mjs --view 1728x1152
// 持ち越し: D3（D2 を直した物）・H2（H を直した物）。新しい案: K・L・M。
// 2 回目の指摘: スライダーの形が 3 通り（縦・列幅いっぱい・名前が左の短い帯）・縦の帯の上下に目盛りの無い長い所・
//   見た目の物が 2 か所に分かれる・大きさの名前が弱い・D2 は 1280 で箱を開くと列の中を送る・1728 で左の列の下が空く
// 全案に同じ直し: スライダーは 1 つの形（名前 ｜ 帯 ｜ 値 を 1 行。大きさは帯の下に目盛り）・帯の幅は目盛りの少し外まで（app/js/stamp.js の range）・
//   日付は 2 行・枠と風合いは名前の付いた 1 つの箱（書体も中）・字の大きさは「印の文字」の下・箱を開くかは日付印で列に収まるかを測って決める

const COMMON_CSS = `
.adv { border: 1px solid var(--line); border-radius: 10px; padding: 4px 12px 8px; }
.adv summary { font-size: 13px; color: var(--text); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.adv .adv-now { font-weight: 400; }
#dateSeps { flex: none; } #dateSeps button { min-width: 28px; padding: 0 8px; }
.field[data-for="date"] select { min-width: 0; flex: 1; }
/* スライダーは 1 つの形: 名前 ｜ 帯 ｜ 値（詳細の 4 本と同じ列の幅） */
.panel { --cols: 76px 1fr 92px; }
.field.slider .val { white-space: nowrap; }
.field.slider { display: grid; grid-template-columns: var(--cols); grid-template-areas: "l b v" ". t ."; align-items: center; column-gap: 8px; }
.field.slider .lblrow { display: contents; }
.field.slider label { grid-area: l; font-size: 13px; color: var(--text); }
.field.slider .val, .field.slider output { grid-area: v; justify-self: end; font-size: 13px; }
.field.slider input[type=range] { grid-area: b; margin: 0; }
.field.slider .ticks { grid-area: t; }
.field.slider .val input { width: 52px; height: 26px; padding: 0 6px; -moz-appearance: textfield; }
.field.slider .val input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.panel { gap: 10px; } .adv-body { gap: 6px; padding-top: 6px; }
.adv-body .range { grid-template-columns: 63px 1fr 79px; }   /* 箱の内側の余白（13px）を引き、外のスライダーと帯の左右をそろえる */
.adv-body .range output { font-size: 13px; color: var(--text); font-weight: 700; }`;
const COMMON_JS = `
try { localStorage.removeItem('ponstamp.advOpen'); } catch {}
const dateRows = document.querySelectorAll('.field[data-for="date"] .row');
dateRows[0].append(document.querySelector('[data-key="pad"]').closest('label'));
dateRows[1].append(document.querySelector('#dateSeps'));
dateRows[2].remove();
const adv = document.querySelector('details.adv');
adv.querySelector('.adv-body').prepend(document.querySelector('#inFont').closest('.field'));
adv.querySelector('summary').firstChild.textContent = '書体と風合い ';
const textField = document.querySelector('#rgText').closest('.field');
const looks = () => [...document.querySelectorAll('.panel .grp')][1];
looks().before(textField);
document.querySelector('#sizeField label').textContent = '大きさ';
const fitAdv = () => {
  const panel = document.querySelector('.panel');
  const shown = [...document.querySelectorAll('[data-for]')].map(el => [el, el.classList.contains('hidden')]);
  shown.forEach(([el]) => el.classList.toggle('hidden', !el.dataset.for.split(' ').includes('date')));
  adv.open = true;
  const fits = panel.scrollHeight <= panel.clientHeight + 1;
  shown.forEach(([el, was]) => el.classList.toggle('hidden', was));
  adv.open = fits;
};`;

/** 縦のものさし（H の形。帯は目盛りの少し外まで・名前は強く） */
const RULER_CSS = `
.preview .stagebox { --side: min(100% - 112px, 640px, calc(100vh - 340px)); width: 100%; display: flex; justify-content: center; align-items: stretch; gap: 14px; }
.stagebox .stage { width: var(--side); flex: none; }
body:has(.notices:not([hidden])) .stagebox { --side: min(100% - 112px, 640px, calc(100vh - 410px)); }
.stagebox #sizeField { display: grid; grid-template-rows: auto 1fr; grid-template-columns: none; grid-template-areas: none; justify-items: center; align-items: stretch; gap: 8px; width: 98px; flex: none; padding: 8px 0; }
.stagebox #sizeField .lblrow { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.stagebox #sizeField label { font-size: 14px; font-weight: 700; color: var(--text); }
.stagebox .lblrow .val { white-space: nowrap; }
.stagebox .sizebar { position: relative; width: 100%; min-height: 0; }
.stagebox #rgSize { position: absolute; top: 0; bottom: 0; left: 30%; writing-mode: vertical-lr; direction: rtl; width: auto; height: auto; margin: 0; }
.stagebox .ticks { position: absolute; inset: calc(var(--thumb) / 2) auto calc(var(--thumb) / 2) calc(30% + 22px); height: auto; margin: 0; width: 44px; }
.stagebox .ticks button { left: 0; top: calc((1 - var(--at)) * 100%); transform: translateY(-50%); }
.stagebox .ticks button::before { left: -6px; top: 50%; width: 5px; height: 1px; }`;
const RULER_JS = `
const stage = document.querySelector('#stage');
const box = document.createElement('div'); box.className = 'stagebox'; stage.before(box);
const size = document.querySelector('#sizeField');
const bar = document.createElement('div'); bar.className = 'sizebar';
bar.append(document.querySelector('#rgSize'), document.querySelector('#sizeTicks'));
size.append(bar);
box.append(stage, size);`;

/** 大きさの − ＋（押すたびに、よく使う大きさの次・前へ。間の値は 0.5mm ずつ） */
const STEP_JS = `
const val = document.querySelector('#sizeField .val');
const mk = (t, d) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'step'; b.textContent = t; b.title = d > 0 ? '大きくする（0.5mm）' : '小さくする（0.5mm）';
  b.addEventListener('click', () => { const n = document.querySelector('#inSize'); n.value = (Number(n.value) + d * 0.5).toFixed(1).replace(/\\.0$/, ''); n.dispatchEvent(new Event('change')); }); return b; };
val.prepend(mk('−', -1)); val.querySelector('input').after(mk('＋', 1));`;
const STEP_CSS = `
.panel { --cols: 76px 1fr 128px; }
.field.slider .val { display: inline-flex; align-items: center; gap: 2px; }
.step { width: 26px; height: 26px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--text); font: inherit; font-size: 14px; line-height: 1; cursor: pointer; }
.step:hover { background: var(--chip); }`;

export const PROPOSALS = [
  {
    key: 'D3', name: '左の 1 列で使う順に（種類 → 文字 → 字の大きさ → 色 → 大きさ → 書体と風合い）・スライダーは 1 つの形（D2 を直した物）',
    css: COMMON_CSS,
    ops: [['script', `${COMMON_JS}
fitAdv();`]],
  },
  {
    key: 'H2', name: '大きさは印の右の縦のものさし（目盛りに合わせた帯・名前を強く）・ほかは左の 1 列（H を直した物）',
    css: COMMON_CSS + RULER_CSS,
    ops: [['script', `${COMMON_JS} ${RULER_JS}
fitAdv();`]],
  },
  {
    key: 'K', name: '大きさに − ＋ を付ける（帯・目盛り・打ち込み・− ＋ のどれでも。0.5mm ずつ確かに動かせる）',
    css: COMMON_CSS + STEP_CSS,
    ops: [['script', `${COMMON_JS} ${STEP_JS}
fitAdv();`]],
  },
  {
    key: 'L', name: '左の帯を広げ、登録した印を大きな見本で並べる（広い画面の空きを、呼び出しやすさに使う）',
    css: COMMON_CSS + `
.shell { grid-template-columns: var(--rail) 1fr; }
@media (min-width: 1600px) and (min-height: 1000px) {
  :root { --rail: 300px; }
  .rail .presets { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .rail .pchip { flex-direction: column; position: relative; padding: 10px 6px 8px; background: var(--panel); border: 1px solid var(--line); border-radius: 10px; }
  .rail .pchip .load { flex-direction: column; gap: 6px; width: 100%; }
  .rail .pchip canvas { width: 72px; height: 72px; }
  .rail .pchip .del { position: absolute; top: 2px; right: 2px; }
}`,
    ops: [['script', `${COMMON_JS}
fitAdv();`]],
  },
  {
    key: 'M', name: '入力をまとまりごとのカードに（文字・見た目・書体と風合い。背の高い画面ではカードが縦に伸びて空きを埋める）',
    css: COMMON_CSS + `
.panel { background: var(--chip); gap: 12px; }
.card { display: flex; flex-direction: column; gap: 12px; padding: 12px 14px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
.card > .grp { margin: 0; }
.panel .adv { background: var(--panel); }`,
    ops: [['script', `${COMMON_JS}
const panel = document.querySelector('.panel');
const [g1, g2] = [...panel.querySelectorAll('.grp')];
const card = (from, to) => { const c = document.createElement('div'); c.className = 'card'; from.before(c); let n = from; while (n && n !== to) { const nx = n.nextElementSibling; c.append(n); n = nx; } return c; };
card(g1, g2); card(g2, adv);
fitAdv();`]],
  },
];
