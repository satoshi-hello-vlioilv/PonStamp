// 改良案（2026-10・v3・2 回目）: 1 回目の採点（1 位 D 70.4 点）の指摘を直し、案出しからやり直す。
//   node tools/ui-variants.mjs 出力 tools/ui-proposals/2026-10-v3-dist-r2.mjs --view 1728x1152 --states distribution,settings
// 土台で直した（全案）: 図の説明を短くして 1 段に・「置き場:」の行を無くして図の根だけに・名前の欄を「版を置く」の前に
// 持ち越し: D2（D を直した物）・C2（D2 に C の手順の番号を軽く）。新しい案: G・H・I
// 1 回目の指摘: D は表を無くして置いた人・PC が消えた・図の中の「この版を配る」が小さく窮屈・B は図の中の名前の箱がちぐはぐ・F は言葉の食い違い

const ON_DIST = `const onDist = (fn) => { const t = setInterval(() => { const box = document.querySelector('.dist'); if (!box) return; clearInterval(t);
  let busy = false; const run = () => { if (busy || !box.querySelector('.dist-tree')) return; busy = true; try { fn(box); } finally { setTimeout(() => { busy = false; }, 0); } };
  new MutationObserver(run).observe(box, { childList: true }); run(); }, 20); };`;

/** D の組み替え: 表の版の行の中身（置いた日・人・大きさ・配る・消す）を図の版の行へ移し、表を無くす */
const MERGE_JS = `
const mergeTable = (box) => {
  const table = box.querySelector('table.versions'); if (!table) return;
  const rows = [...table.querySelectorAll('tbody tr')];
  box.querySelectorAll('.dist-tree li.t3, .dist-tree li.t2').forEach((li) => {
    const v = li.querySelector('.tn').textContent.replace(/[\\\\/]$/, '');
    const tr = rows.find((r) => r.querySelector('td b')?.textContent === v); if (!tr) return;
    const tds = tr.querySelectorAll('td');
    li.classList.add('ver');
    li.querySelector('.tw').innerHTML = '';
    li.querySelector('.tw').append(tds[1].textContent + '・' + tds[3].textContent, Object.assign(document.createElement('small'), { textContent: tds[2].textContent }));
    const acts = document.createElement('span'); acts.className = 'acts'; acts.append(...tr.querySelector('.acts').childNodes); li.append(acts);
  });
  table.remove();
};`;
const MERGE_CSS = `
.dist-tree li.ver { grid-template-columns: minmax(0, max-content) 1fr auto auto; padding: 4px 0; border-top: 1px dashed var(--line); }
.dist-tree li.ver .tw small { display: block; font-size: 11px; }
.dist-tree li .acts { display: flex; gap: 6px; } .dist-tree li .acts .btn { height: 30px; }`;

export const PROPOSALS = [
  {
    key: 'D2', name: '図の版の行で配る・消す（置いた日・大きさ・人も行の中に。表は無くす）（D を直した物）',
    css: MERGE_CSS,
    ops: [['script', `${ON_DIST} ${MERGE_JS}
onDist((box) => mergeTable(box));`]],
  },
  {
    key: 'C2', name: 'D2 に手順の番号を軽く（① 名前 ② 版を置く ③ 図の版の行で配る ④ 新しい PC へ。見出しは増やさず欄の頭に）',
    css: MERGE_CSS + `.no { display: inline-grid; place-items: center; width: 18px; height: 18px; margin-right: 6px; border-radius: 50%; background: var(--text); color: var(--panel); font-size: 11px; font-weight: 700; flex: none; }
.dist-names { grid-template-columns: auto 1fr 1fr auto; } .dist-names > .no { align-self: end; margin-bottom: 8px; }`,
    ops: [['script', `${ON_DIST} ${MERGE_JS}
onDist((box) => {
  mergeTable(box);
  const no = (n, el) => { if (!el) return; const b = document.createElement('b'); b.className = 'no'; b.textContent = n; el.prepend(b); };
  no('1', box.querySelector('.dist-names'));
  no('2', box.querySelector('.dist-place'));
  const cap = box.querySelector('.dist-tree figcaption'); cap.textContent = '置き場のフォルダの形（版の行で配る・消す）'; no('3', cap);
  no('4', box.querySelector('.dist-entry')?.closest('.set-row')?.querySelector('.set-label'));
});`]],
  },
  {
    key: 'G', name: '図は名前だけ・番号で下の説明（凡例）と結ぶ（図の行は短く 1 段、説明はまとめて読む）',
    css: `.dist-tree .tw { display: none; } .dist-tree .mk { display: inline-grid; place-items: center; width: 18px; height: 18px; margin-left: 6px; border-radius: 50%; background: var(--chip); color: var(--text); font-size: 11px; font-weight: 700; }
.dist-tree .tag { justify-self: start; }
.legend { margin: 6px 0 0; padding: 6px 0 0; border-top: 1px solid var(--line); display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; font-size: 12px; color: var(--muted); }
.legend b { display: inline-grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; background: var(--chip); color: var(--text); font-size: 11px; }`,
    ops: [['script', `${ON_DIST}
onDist((box) => {
  const fig = box.querySelector('.dist-tree'); const lis = [...fig.querySelectorAll('li')];
  const notes = ['更新の置き場（「更新」で決める）', 'アプリのフォルダ（下で名前を決める）', '配る入口。「この版を配る」で配る版の exe に替わる。新しい PC へはこのアドレスを渡す', '配る版の覚え（どの版を配っているか）', '版を置くフォルダ（下で名前を決める）。「ZIP から版を置く」で版ごとのフォルダを作る'];
  const leg = document.createElement('div'); leg.className = 'legend';
  lis.slice(0, 5).forEach((li, i) => { const m = document.createElement('span'); m.className = 'mk'; m.textContent = i + 1; li.querySelector('.tn').after(m);
    const b = document.createElement('b'); b.textContent = i + 1; const s = document.createElement('span'); s.textContent = notes[i]; leg.append(b, s); });
  fig.append(leg);
});`]],
  },
  {
    key: 'H', name: 'カード 3 枚に分ける（フォルダの形と名前 ｜ 版を置く・配る ｜ 新しい PC へ）',
    css: `.dcard { display: flex; flex-direction: column; gap: 8px; padding: 10px 0 12px; border-top: 1px solid var(--line); }
.dcard > h3 { margin: 0; font-size: 13px; } .dcard .dist-tree { border: 0; padding: 0; background: none; } .dcard .set-row { margin: 0; }`,
    ops: [['script', `${ON_DIST}
onDist((box) => {
  const card = (title, ...els) => { const c = document.createElement('div'); c.className = 'dcard'; c.innerHTML = '<h3>' + title + '</h3>'; els.filter(Boolean).forEach((e) => c.append(e)); return c; };
  const tree = box.querySelector('.dist-tree'), names = box.querySelector('.dist-names'), place = box.querySelector('.dist-place');
  const list = box.querySelector('table.versions') || place.nextElementSibling, entry = box.querySelector('.dist-entry')?.closest('.set-row');
  const rest = [...box.children].filter((e) => ![tree, names, place, list, entry].includes(e));
  box.replaceChildren(card('置き場のフォルダの形と名前', tree, names), card('版を置く・配る', place, list), entry ? card('新しい PC へ', entry) : null, ...rest);
  box.querySelector('.dcard .dist-tree figcaption').remove();
});`]],
  },
  {
    key: 'I', name: '道筋を 1 行で（置き場 › アプリのフォルダ › 版を置くフォルダ › 版。名前はその場の箱）・下は版の一覧',
    css: `.crumb { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--bg); font: 12px/1.6 Consolas, "BIZ UDGothic", monospace; }
.crumb .sep { color: var(--muted); } .crumb input { font: inherit; width: 110px; height: 26px; padding: 0 6px; border: 1px solid var(--line); border-radius: 6px; background: var(--panel); color: var(--text); }
.crumb .v { color: var(--muted); } .crumb-hint { margin: -4px 0 0; }`,
    ops: [['script', `${ON_DIST}
onDist((box) => {
  const fig = box.querySelector('.dist-tree'), names = box.querySelector('.dist-names'); if (!names) return;
  const [app, ver] = names.querySelectorAll('input'); const save = names.querySelector('button');
  const root = fig.querySelector('li .tn').textContent;
  const c = document.createElement('div'); c.className = 'crumb'; c.setAttribute('aria-label', '置き場のフォルダの道筋');
  const sp = (t, cls = 'sep') => Object.assign(document.createElement('span'), { className: cls, textContent: t });
  c.append(sp(root, ''), app, sp('\\\\'), ver, sp('\\\\'), sp('<版>\\\\', 'v'), save);
  const hint = names.querySelector('.hint'); hint.className = 'hint crumb-hint';
  hint.textContent = '版を置くと、置き場の下に「アプリのフォルダ」と「版を置くフォルダ」を作り、その下に版ごとのフォルダを作ります。配る入口（exe）と distribute.json はアプリのフォルダの直下。箱が空なら既定の名前（PonStamp・versions）。';
  fig.replaceWith(c); c.after(hint); names.remove();
});`]],
  },
];
