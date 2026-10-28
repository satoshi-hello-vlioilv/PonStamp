// 改良案（2026-10・v2）: 大きさのスライダー・字の大きさ・日付の区切りを足した土台に、並べ方の案を当てる。
//   node tools/ui-variants.mjs 出力 tools/ui-proposals/2026-10-v2.mjs --view 1728x1152
// 今の画面（作る前）で見えた問題: 大きさは決まった札の間を「その他…」→ 打ち込む 2 手・字の大きさを変える所が無い・
// 日付の区切りが「.」だけ・見た目の調整（かすれ・太さ）は「詳細設定」を開く 1 手の奥・1728 で入力の列と左の帯の下が空く。
// 案の方向: A 見せ方（調整を全部表に）・B 置き場（大きさを印のそばへ）・C 流れ（文字／見た目の 2 面）・
//           D まとまり替え（字の物は文字へ・風合いは 1 つの箱に）・E 置き場（印の下に作業台・入力は文字だけ）・F 減らし方（よく触る 3 つだけ表・残りは開く）

const when = `const when = (sel, f) => { const t = setInterval(() => { const el = document.querySelector(sel); if (el) { clearInterval(t); f(el); } }, 20); };`;
const grp = `const grp = (t, before) => { const x = document.createElement('h3'); x.className = 'grp'; x.textContent = t; before.before(x); return x; };`;
/** 詳細設定の開け閉めの記憶を消して、案の形で撮る（案が開け閉めを決める） */
const OPEN_ADV = `try { localStorage.removeItem('ponstamp.advOpen'); } catch {} document.querySelector('details.adv').open = true;`;
/** 詳細設定を「見出しの無い、いつも開いた箱」にする */
const FLAT_ADV_CSS = `.adv > summary { display: none; } .adv-body { padding-top: 0; }`;
const textField = `document.querySelector('#rgText').closest('.field')`;
const fontField = `document.querySelector('#inFont').closest('.field')`;

export const PROPOSALS = [
  {
    key: 'A', name: '見た目の調整を全部表に出す（詳細設定をやめ、書体と 4 本の帯も同じ列に）',
    css: FLAT_ADV_CSS + `.adv-body { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 18px; } .adv-body > .field, .adv-body > .row { grid-column: 1 / -1; } .adv-body .range { grid-template-columns: 64px 1fr 30px; gap: 6px; } .panel { gap: 12px; }`,
    ops: [['script', `${grp} ${OPEN_ADV}
const adv = document.querySelector('details.adv');
grp('書体と風合い', adv);
adv.querySelector('.adv-body').prepend(${fontField});`]],
  },
  {
    key: 'B', name: '大きさと字の大きさを印のすぐ下へ（変えた物と、変わる物を並べる）',
    css: `
.preview .sizebox { width: min(100%, 560px); display: flex; flex-direction: column; gap: 10px; padding: 12px 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
.stage { width: min(100%, 560px, calc(100vh - 470px)); }
body:has(.notices:not([hidden])) .stage { width: min(100%, 560px, calc(100vh - 540px)); }`,
    ops: [['script', `
const box = document.createElement('div'); box.className = 'sizebox';
document.querySelector('#meta').after(box);
box.append(document.querySelector('#sizeField'), ${textField});
document.querySelector('#meta').textContent;`]],
  },
  {
    key: 'C', name: '入力を「文字」「見た目」の 2 面に分ける（面ごとに欄が少なく、見た目の面では調整を全部出す）',
    css: FLAT_ADV_CSS + `
.facets { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid var(--line); }
.facets button { border: 0; background: none; font: inherit; font-size: 14px; padding: 8px 0; color: var(--muted); cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -1px; }
.facets button[aria-selected="true"] { color: var(--text); font-weight: 700; border-bottom-color: var(--accent); }
.panel[data-facet="text"] .f-look, .panel[data-facet="look"] .f-text { display: none !important; }`,
    ops: [['script', `${OPEN_ADV}
const panel = document.querySelector('.panel');
const bar = document.createElement('div'); bar.className = 'facets'; bar.setAttribute('role', 'tablist');
bar.innerHTML = '<button type="button" role="tab" data-f="text">文字</button><button type="button" role="tab" data-f="look" data-open="advanced">見た目</button>';
document.querySelector('#typeTabs').after(bar);
const kids = [...panel.children];
const look = kids.indexOf([...panel.querySelectorAll('.grp')][1]);
kids.forEach((el, i) => { if (el !== bar && el.id !== 'typeTabs') el.classList.add(i >= look ? 'f-look' : 'f-text'); });
panel.querySelectorAll('.grp').forEach(g => g.remove());
const set = (f) => { panel.dataset.facet = f; bar.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.f === f))); };
bar.addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) set(b.dataset.f); });
set('text');`]],
  },
  {
    key: 'D', name: '字の物は「印の文字」へ（字の大きさ・書体）・枠と風合いは 1 つの箱に（名前で中身が分かる）',
    css: `.adv { border: 1px solid var(--line); border-radius: 10px; padding: 4px 12px 8px; } .adv summary { font-size: 13px; color: var(--text); font-weight: 700; }`,
    ops: [['script', `${OPEN_ADV}
const look = [...document.querySelectorAll('.panel .grp')][1];
look.before(${textField}); look.before(${fontField});
const sum = document.querySelector('details.adv > summary');
sum.firstChild.textContent = '枠と風合い（太さ・かすれ・傾き） ';
const now = document.querySelector('#advNow');
new MutationObserver(() => { const t = now.textContent.replace(/^[^・]*・/, ''); if (t !== now.textContent) now.textContent = t; }).observe(now, { childList: true, characterData: true, subtree: true });
now.textContent = now.textContent.replace(/^[^・]*・/, '');
if (innerHeight < 860) document.querySelector('details.adv').open = false;`]],
  },
  {
    key: 'E', name: '印の下を作業台にする（色・大きさ・字の大きさは印の下、左は文字と風合いだけ）',
    css: `
.layout { grid-template-columns: minmax(360px, 400px) 1fr; }
.preview .bench { width: min(100%, 600px); display: grid; grid-template-columns: 1fr 1fr; gap: 10px 20px; padding: 12px 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
.preview .bench > .color { grid-column: 1 / -1; }
.stage { width: min(100%, 520px, calc(100vh - 450px)); }
body:has(.notices:not([hidden])) .stage { width: min(100%, 520px, calc(100vh - 520px)); }
.bench #sizeField label { white-space: nowrap; }`,
    ops: [['script', `${OPEN_ADV}
const bench = document.createElement('div'); bench.className = 'bench';
document.querySelector('#meta').after(bench);
const color = document.querySelector('#swatches').closest('.field'); color.classList.add('color');
bench.append(color, document.querySelector('#sizeField'), ${textField});
const look = [...document.querySelectorAll('.panel .grp')][1]; look.textContent = '書体と風合い';
document.querySelector('details.adv > summary').firstChild.textContent = '調整する ';
document.querySelector('#sizeField label').textContent = '大きさ';
if (innerHeight < 860) document.querySelector('details.adv').open = false;`]],
  },
  {
    key: 'F', name: 'よく触る 3 つ（色・大きさ・かすれ）だけ表に、ほかは「細かい調整」に（字の大きさは文字の下）',
    css: ``,
    ops: [['script', `
try { localStorage.removeItem('ponstamp.advOpen'); } catch {}
const kas = document.querySelector('#rgKasure').closest('.range');
const field = document.createElement('div'); field.className = 'field slider';
field.innerHTML = '<div class="lblrow"><label for="rgKasure">かすれ</label></div>';
const out = kas.querySelector('output'); field.querySelector('.lblrow').append(out); field.append(document.querySelector('#rgKasure'));
kas.remove();
document.querySelector('details.adv').before(field);
const look = [...document.querySelectorAll('.panel .grp')][1];
look.before(${textField});
document.querySelector('details.adv > summary').firstChild.textContent = '細かい調整 ';
document.querySelector('details.adv').open = innerHeight >= 860;`]],
  },
];
