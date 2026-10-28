// 改良案（2026-10・v2・2 回目）: 1 回目の採点（1 位 E 74.5 点・D は加点だけなら 76.3 点）の指摘を直し、案出しからやり直す。
//   node tools/ui-variants.mjs 出力 tools/ui-proposals/2026-10-v2-r2.mjs --view 1728x1152
// 持ち越し: E2（E を直した物）・D2（D を直した物）。新しい案: G・H・I。
// 1 回目の指摘: 印の見本が小さくなる（E: 1728 で 435px）・見出しが 2 重（「書体と風合い」の下に「調整する」）・作業台の 2 列の高さのずれ・
//   字の大きさが文字の入力から遠い・1728 の左の列の下の空き・1280 の日付印で入力の列の中を送る（D・F・A）
// 全案に同じ直し（COMMON）: 日付の欄を 2 行に詰める（常に今日・日・0埋め / 書式・区切り）。枠と風合いは名前の付いた 1 つの箱（D の形）で、書体もその中

const grp = `const grp = (t, before) => { const x = document.createElement('h3'); x.className = 'grp'; x.textContent = t; before.before(x); return x; };`;
const COMMON_CSS = `
.adv { border: 1px solid var(--line); border-radius: 10px; padding: 4px 12px 8px; }
.adv summary { font-size: 13px; color: var(--text); font-weight: 700; }
.adv .adv-now { font-weight: 400; }
.adv summary { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#dateSeps { flex: none; } #dateSeps button { min-width: 28px; padding: 0 8px; }
.field[data-for="date"] select { min-width: 0; flex: 1; }`;
/** 日付を 2 行に・枠と風合いの箱（書体を中へ・見出しの名前で中身が分かる）・開け閉めは背の高い窓だけ開く */
const COMMON_JS = `
try { localStorage.removeItem('ponstamp.advOpen'); } catch {}
const dateRows = document.querySelectorAll('.field[data-for="date"] .row');
dateRows[0].append(document.querySelector('[data-key="pad"]').closest('label'));
dateRows[1].append(document.querySelector('#dateSeps'));
dateRows[2].remove();
const adv = document.querySelector('details.adv');
adv.querySelector('.adv-body').prepend(document.querySelector('#inFont').closest('.field'));
adv.querySelector('summary').firstChild.textContent = '書体と風合い ';
// 開けるのは、いちばん欄の多い日付印で開いても入力の列に収まるときだけ（画面と同じ決め方。並べ替えの後に測る）
const fitAdv = () => {
  const panel = document.querySelector('.panel');
  const shown = [...document.querySelectorAll('[data-for]')].map(el => [el, el.classList.contains('hidden')]);
  shown.forEach(([el]) => el.classList.toggle('hidden', !el.dataset.for.split(' ').includes('date')));
  adv.open = true;
  const fits = panel.contains(adv) ? panel.scrollHeight <= panel.clientHeight + 1 : true;
  shown.forEach(([el, was]) => el.classList.toggle('hidden', was));
  adv.open = fits;
};
const textField = document.querySelector('#rgText').closest('.field');
const looks = () => [...document.querySelectorAll('.panel .grp')][1];`;
/** 印の下の帯（作業台）。印の見本は小さくしすぎない */
const STRIP_CSS = (cols, minus) => `
.preview .strip { width: min(100%, 680px); display: grid; grid-template-columns: ${cols}; gap: 10px 24px; align-items: start; padding: 12px 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
.stage { width: min(100%, 640px, calc(100vh - ${minus}px)); }
body:has(.notices:not([hidden])) .stage { width: min(100%, 640px, calc(100vh - ${minus + 70}px)); }`;
const STRIP_JS = `const strip = document.createElement('div'); strip.className = 'strip'; document.querySelector('#meta').after(strip);`;

export const PROPOSALS = [
  {
    key: 'E2', name: '印の下に大きさと字の大きさを 1 段で（色と風合いは左・印は小さくしない）（E を直した物）',
    css: COMMON_CSS + STRIP_CSS('1fr 1fr', 440),
    ops: [['script', `${COMMON_JS} ${STRIP_JS}
strip.append(document.querySelector('#sizeField'), textField);
document.querySelector('#sizeField label').textContent = '大きさ';
fitAdv();`]],
  },
  {
    key: 'D2', name: '字の物は「印の文字」へ・見た目は色と大きさだけ・風合いは 1 つの箱（D を直した物。1280 でも列の中を送らない）',
    css: COMMON_CSS + `.panel { gap: 12px; }`,
    ops: [['script', `${COMMON_JS}
looks().before(textField);
fitAdv();`]],
  },
  {
    key: 'G', name: '字の大きさは文字のすぐ下・色と大きさは印のすぐ下（変える物を、変わる所のそばに）',
    css: COMMON_CSS + STRIP_CSS('auto 1fr', 400) + `.strip .field { margin: 0; } .strip #sizeField label { white-space: nowrap; }
@media (max-width: 1499px) {
  .preview .strip { grid-template-columns: 1fr; gap: 8px; }
  .stage { width: min(100%, 640px, calc(100vh - 470px)); }
  body:has(.notices:not([hidden])) .stage { width: min(100%, 640px, calc(100vh - 540px)); }
}`,
    ops: [['script', `${COMMON_JS} ${STRIP_JS}
looks().before(textField);
strip.append(document.querySelector('#swatches').closest('.field'), document.querySelector('#sizeField'));
document.querySelector('#sizeField label').textContent = '大きさ';
looks().remove();
fitAdv();`]],
  },
  {
    key: 'H', name: '大きさのスライダーを印の右に縦に（ものさしのように、上が大きい）・字の大きさは文字の下',
    css: COMMON_CSS + `
.preview .stagebox { --side: min(100% - 106px, 640px, calc(100vh - 340px)); width: 100%; display: flex; justify-content: center; align-items: stretch; gap: 14px; }
.stagebox .stage { width: var(--side); flex: none; }
body:has(.notices:not([hidden])) .stagebox { --side: min(100% - 106px, 640px, calc(100vh - 410px)); }
.stagebox #sizeField { display: grid; grid-template-rows: auto 1fr; justify-items: center; gap: 8px; width: 92px; flex: none; padding: 8px 0; }
.stagebox .lblrow { flex-direction: column; align-items: center; gap: 4px; }
.stagebox .lblrow .val { white-space: nowrap; }
.stagebox .lblrow label { font-size: 12px; }
.stagebox .sizebar { position: relative; width: 100%; min-height: 0; }
.stagebox #rgSize { position: absolute; top: 0; bottom: 0; left: 30%; writing-mode: vertical-lr; direction: rtl; width: auto; height: auto; margin: 0; }
.stagebox .ticks { position: absolute; inset: calc(var(--thumb) / 2) auto calc(var(--thumb) / 2) calc(30% + 22px); height: auto; margin: 0; width: 40px; }
.stagebox .ticks button { left: 0; top: calc((1 - var(--at)) * 100%); transform: translateY(-50%); }
.stagebox .ticks button::before { left: -6px; top: 50%; width: 5px; height: 1px; }`,
    ops: [['script', `${COMMON_JS}
looks().before(textField);
const stage = document.querySelector('#stage');
const box = document.createElement('div'); box.className = 'stagebox'; stage.before(box);
const size = document.querySelector('#sizeField');
const bar = document.createElement('div'); bar.className = 'sizebar';
bar.append(document.querySelector('#rgSize'), document.querySelector('#sizeTicks'));
size.append(bar);
size.querySelector('label').textContent = '大きさ';
box.append(stage, size);
fitAdv();`]],
  },
  {
    key: 'I', name: '広い画面は 3 列（文字 ｜ 印 ｜ 見た目）・狭い画面は見た目を印の下へ（1728 の空きを使う）',
    css: COMMON_CSS + `
.layout { grid-template-columns: minmax(340px, 380px) 1fr 370px; grid-template-areas: "panel preview look"; }
.panel { grid-area: panel; } .preview { grid-area: preview; } .look { grid-area: look; }
.look { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding: 16px; background: var(--panel); border-left: 1px solid var(--line); }
@media (max-width: 1499px) {
  .layout { grid-template-columns: minmax(360px, 400px) 1fr; grid-template-rows: 1fr auto; grid-template-areas: "panel preview" "panel look"; }
  .look { display: grid; grid-template-columns: auto 1fr; gap: 10px 24px; padding: 12px 20px; border-left: 0; border-top: 1px solid var(--line); overflow: visible; }
  .look .swatches { flex-wrap: nowrap; }
  .look > .grp, .look > .adv { display: none; }
  .stage { width: min(100%, 640px, calc(100vh - 470px)); }
}`,
    ops: [['script', `${COMMON_JS}
looks().before(textField);
const look = document.createElement('section'); look.className = 'look'; look.setAttribute('aria-label', '印の見た目');
document.querySelector('.layout').append(look);
const h = looks(); look.append(h, document.querySelector('#swatches').closest('.field'), document.querySelector('#sizeField'), adv);
if (innerWidth < 1500) document.querySelector('.panel').append(adv);
fitAdv();`]],
  },
];
