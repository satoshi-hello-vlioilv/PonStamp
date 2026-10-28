// 改良案（2026-10・v3）: 設定の「配布」で、フォルダがどう作られて版がどう管理されるかを分からせ、フォルダの名前を決められるようにする。
//   node tools/ui-variants.mjs 出力 tools/ui-proposals/2026-10-v3-dist.mjs --view 1728x1152 --states distribution,settings
// 今の画面（作る前）で見えた問題: 「置き場: \\fs01\共有\Releases」の 1 行だけで、そこにどんなフォルダが作られ版がどこに並ぶかが見えない・
//   置き場（「更新」の所）と版を置く・配る所（「配布」）が離れている・フォルダの名前を決める所が無い・配る入口のアドレスがいちばん下にしか出ない
// 土台（app/js/settings.js）: 置き場のフォルダの形の図（いまのアドレスで）・フォルダの名前の欄。案はその並べ方・見せ方を変える。
// 案の方向: A 見せ方（図を上・名前は図の下）・B 図の中で名前を直す・C 流れ（手順の番号）・D 一覧と図をまとめる（図の版の行で配る・消す）・
//           F 置き場を配布の所へ（決める物を 1 か所に）

/** 配布の箱は版の一覧を読むたびに描き直す（fill）。描き直すたびに案の組み替えを当て直す */
const ON_DIST = `const onDist = (fn) => { const t = setInterval(() => { const box = document.querySelector('.dist'); if (!box) return; clearInterval(t);
  let busy = false; const run = () => { if (busy || !box.querySelector('.dist-tree')) return; busy = true; try { fn(box); } finally { setTimeout(() => { busy = false; }, 0); } };
  new MutationObserver(run).observe(box, { childList: true }); run(); }, 20); };`;

export const PROPOSALS = [
  {
    key: 'A', name: '図を上に、名前はその下（図を見てから名前を決める）',
    css: ``,
    ops: [],
  },
  {
    key: 'B', name: '図の中で名前を直す（アプリのフォルダ・版を置くフォルダの行が、そのまま名前の箱）',
    css: `.dist-tree li .tn input { font: inherit; width: 150px; height: 24px; padding: 0 6px; border: 1px solid var(--line); border-radius: 5px; background: var(--panel); color: var(--text); }
.dist-tree figcaption { display: flex; justify-content: space-between; align-items: center; }`,
    ops: [['script', `${ON_DIST}
onDist((box) => {
  const names = box.querySelector('.dist-names'); if (!names) return;
  const [app, ver] = names.querySelectorAll('input'); const save = names.querySelector('button');
  const lis = box.querySelectorAll('.dist-tree li');
  const put = (li, inp) => { const tn = li.querySelector('.tn'); const sep = tn.textContent.slice(-1); tn.textContent = ''; inp.placeholder = inp.placeholder; tn.append(inp, sep); };
  put(lis[1], app); put([...lis].find(l => l.textContent.includes('版を置くフォルダ')), ver);
  save.textContent = '名前を保存'; box.querySelector('.dist-tree figcaption').append(save);
  const hint = names.querySelector('.hint'); box.querySelector('.dist-tree').append(hint);
  names.remove();
});`]],
  },
  {
    key: 'C', name: '手順の番号で並べる（① 置き場 ② フォルダの名前 ③ 版を置く ④ 配る版を選ぶ ⑤ 新しい PC へ。図は一番上で全体を見せる）',
    css: `.step { margin: 6px 0 -2px; font-size: 13px; font-weight: 700; color: var(--text); }
.step b { display: inline-grid; place-items: center; width: 20px; height: 20px; margin-right: 6px; border-radius: 50%; background: var(--text); color: var(--panel); font-size: 12px; }`,
    ops: [['script', `${ON_DIST}
onDist((box) => {
  const step = (n, t, before) => { if (!before) return; const x = document.createElement('div'); x.className = 'step'; x.innerHTML = '<b>' + n + '</b>' + t; before.before(x); };
  const tree = box.querySelector('.dist-tree'); box.prepend(tree);
  step(1, '置き場（「更新」の「更新の置き場」で決める）', box.querySelector('.dist-found'));
  step(2, 'フォルダの名前', box.querySelector('.dist-names'));
  step(3, '版を置く', box.querySelector('.dist-place'));
  step(4, '配る版を選ぶ', box.querySelector('.versions') || box.querySelector('.dist-place').nextElementSibling);
  step(5, '新しい PC へ', box.querySelector('.dist-entry')?.closest('.set-row'));
});`]],
  },
  {
    key: 'D', name: '一覧と図をまとめる（図の版の行で、置いた日・配る・消す。表は無くす）',
    css: `.dist-tree li.t3 { grid-template-columns: minmax(0, max-content) 1fr auto auto; }
.dist-tree li .acts { display: flex; gap: 6px; } .dist-tree li .acts .btn { padding: 2px 10px; }
.dist-tree li .tw small { margin-left: 8px; }`,
    ops: [['script', `${ON_DIST}
onDist((box) => {
  const table = box.querySelector('table.versions'); if (!table) return;
  const rows = [...table.querySelectorAll('tbody tr')];
  box.querySelectorAll('.dist-tree li.t3').forEach((li) => {
    const v = li.querySelector('.tn').textContent.replace(/[\\\\/]$/, '');
    const tr = rows.find((r) => r.querySelector('td b')?.textContent === v); if (!tr) return;
    const tds = tr.querySelectorAll('td');
    li.querySelector('.tw').textContent = tds[1].textContent + '・' + tds[3].textContent;
    const acts = document.createElement('span'); acts.className = 'acts'; acts.append(...tr.querySelector('.acts').childNodes); li.append(acts);
  });
  table.remove();
  box.querySelector('.dist-tree').after(box.querySelector('.dist-place'));
});`]],
  },
  {
    key: 'F', name: '置き場を配布の所へ（置き場・フォルダの名前・図を 1 か所に。「更新」には今の置き場を出すだけ）',
    css: `.dist-src { margin-bottom: 4px; }`,
    ops: [['script', `
const t = setInterval(() => {
  const src = document.querySelector('#setSource'); const det = document.querySelector('#setDistribution'); if (!src || !det) return; clearInterval(t);
  const row = src.closest('.set-row'); row.classList.add('dist-src');
  det.before(row);
  row.querySelector('.set-label').textContent = '置き場';
  const p = document.createElement('p'); p.className = 'hint'; p.textContent = '更新の置き場は「配布」の「置き場」で決めます（いま: ' + (src.value || src.placeholder) + '）';
  document.querySelector('#set-update').closest('section').append(p);
}, 20);`]],
  },
];
