// 改良案（2026-10・v3・3 回目・最後の回）: 2 回目の採点（1 位 D2 76.2 点）の指摘を直し、案出しからやり直す。
//   node tools/ui-variants.mjs 出力 tools/ui-proposals/2026-10-v3-dist-r3.mjs --view 1728x1152 --states distribution,settings
// 持ち越し: D3（D2 を直した物）。新しい案: J・K・L・M
// 2 回目の指摘（D2）: 目の順（図の版の行 → 名前 → 置く）と手の順（名前 → 置く → 配る）が逆・「配布中」の札と灰色の「配っています」が同じことを 2 回言う・
//   名前の欄・ZIP の行・新しい PC への左の線がそろわない・版の行がボタンの分だけ倍の高さ
// 全案に同じ直し: 配っている版の行は札「配布中」だけ（灰色の「配っています」「消す」を出さない）・行のボタンを小さく・新しい PC へは全幅（名前を上に）

const ON_DIST = `const onDist = (fn) => { const t = setInterval(() => { const box = document.querySelector('.dist'); if (!box) return; clearInterval(t);
  let busy = false; const run = () => { if (busy || !box.querySelector('.dist-tree')) return; busy = true; try { fn(box); } finally { setTimeout(() => { busy = false; }, 0); } };
  new MutationObserver(run).observe(box, { childList: true }); run(); }, 20); };`;

/** 表の版の行の中身を図の版の行へ（配っている版は札だけ）・表を無くす */
const MERGE_JS = `
const mergeTable = (box) => {
  const table = box.querySelector('table.versions'); if (!table) return;
  const rows = [...table.querySelectorAll('tbody tr')];
  box.querySelectorAll('.dist-tree li.t3, .dist-tree li.t2').forEach((li) => {
    const v = li.querySelector('.tn').textContent.replace(/[\\\\/]$/, '');
    const tr = rows.find((r) => r.querySelector('td b')?.textContent === v); if (!tr) return;
    const tds = tr.querySelectorAll('td');
    li.classList.add('ver');
    li.querySelector('.tw').textContent = tds[1].textContent + '・' + tds[3].textContent + '・' + tds[2].textContent;
    const acts = document.createElement('span'); acts.className = 'acts';
    if (!tr.classList.contains('on')) acts.append(...tr.querySelector('.acts').childNodes);
    li.append(acts);
  });
  table.remove();
};
const fullEntry = (box) => { const row = box.querySelector('.dist-entry')?.closest('.set-row'); if (row) row.classList.add('full'); };
const inlineNames = (box) => {
  const names = box.querySelector('.dist-names'); if (!names) return null;
  const [app, ver] = names.querySelectorAll('input'); const save = names.querySelector('button');
  const lis = [...box.querySelectorAll('.dist-tree li')];
  const put = (li, inp) => { const tn = li.querySelector('.tn'); const sep = tn.textContent.slice(-1); tn.textContent = ''; tn.append(inp, sep); tn.classList.add('edit'); };
  put(lis[1], app); put(lis.find((l) => l.textContent.includes('版を置くフォルダ')), ver);
  return { names, save, hint: names.querySelector('.hint') };
};`;
const COMMON_CSS = `
.dist-tree li.ver { grid-template-columns: minmax(0, max-content) 1fr auto auto; }
.dist-tree li .acts { display: flex; gap: 4px; } .dist-tree li .acts .btn { height: 24px; padding: 0 10px; font-size: 12px; }
.dist .set-row.full { display: flex; flex-direction: column; gap: 6px; } .dist .set-row.full .set-label { font-size: 13px; color: var(--text); font-weight: 700; }
.dist-tree .tn.edit input { font: inherit; width: 140px; height: 24px; padding: 0 6px; border: 1px solid var(--line); border-radius: 5px; background: var(--panel); color: var(--text); }`;

export const PROPOSALS = [
  {
    key: 'D3', name: '名前 → 版を置く → 図（版の行で配る・消す）の順に（手の順どおり上から）（D2 を直した物）',
    css: COMMON_CSS,
    ops: [['script', `${ON_DIST} ${MERGE_JS}
onDist((box) => { mergeTable(box); fullEntry(box); const tree = box.querySelector('.dist-tree'); box.querySelector('.dist-place').after(tree); });`]],
  },
  {
    key: 'J', name: '図の中で全部（名前は図の行の箱・「版を置く」は versions の行・配る・消すは版の行）。図の外は新しい PC へだけ',
    css: COMMON_CSS + `.dist-tree li.place { grid-template-columns: auto 1fr; padding-left: 42px; } .dist-tree li.place .hint { margin: 0; }
.dist-tree figcaption { display: flex; justify-content: space-between; align-items: center; } .dist-tree figcaption .btn { height: 24px; font-size: 12px; }
.dist-tree > .hint { margin: 6px 0 0; }`,
    ops: [['script', `${ON_DIST} ${MERGE_JS}
onDist((box) => {
  mergeTable(box); fullEntry(box);
  const n = inlineNames(box); if (!n) return;
  const tree = box.querySelector('.dist-tree');
  n.save.textContent = '名前を保存'; tree.querySelector('figcaption').append(n.save); tree.append(n.hint); n.names.remove();
  const place = box.querySelector('.dist-place'); const vli = [...tree.querySelectorAll('li')].find((l) => l.querySelector('.tn.edit') && l !== tree.querySelectorAll('li')[1]);
  const li = document.createElement('li'); li.className = 'place'; li.append(...place.childNodes); vli.after(li); place.remove();
});`]],
  },
  {
    key: 'K', name: '上は形（図・名前はその場の箱）、下は版の一覧（行ごとに配る・消す）。形と管理を分けて 1 回ずつ',
    css: COMMON_CSS + `.dist-tree li.t3 { display: none; } .dist-tree li.more .tw { font-style: normal; }
.vlist { display: flex; flex-direction: column; border-top: 1px solid var(--line); }
.vlist .vr .tag { margin-left: 6px; } .vlist .vr td { white-space: nowrap; }
.vlist .vr { display: grid; grid-template-columns: 110px 1fr auto; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--line); font-size: 13px; }
.vlist .vr .meta { color: var(--muted); font-size: 12px; } .vlist .vr .acts { display: flex; gap: 4px; } .vlist .vr .acts .btn { height: 26px; font-size: 12px; }
.vlist .vr.on { background: var(--ok-bg); }`,
    ops: [['script', `${ON_DIST} ${MERGE_JS}
onDist((box) => {
  fullEntry(box);
  const n = inlineNames(box); const tree = box.querySelector('.dist-tree');
  if (n) { n.save.textContent = '名前を保存'; const r = document.createElement('div'); r.className = 'row'; r.append(n.save, n.hint); n.hint.style.margin = '0'; tree.after(r); n.names.remove(); }
  const t3 = [...tree.querySelectorAll('li.t3')]; const vli = t3[0]?.previousElementSibling;
  if (vli && t3.length) { const c = document.createElement('li'); c.className = 't3 more'; c.style.display = 'grid';
    c.innerHTML = '<span class="tn">' + t3.length + ' つの版\\\\</span><span class="tw">下の一覧で配る・消す</span>'; vli.after(c); }
  const table = box.querySelector('table.versions'); if (!table) return;
  const list = document.createElement('div'); list.className = 'vlist';
  table.querySelectorAll('tbody tr').forEach((tr) => { const tds = tr.querySelectorAll('td'); const r = document.createElement('div'); r.className = 'vr' + (tr.classList.contains('on') ? ' on' : '');
    r.append(tds[0].cloneNode(true)); const m = document.createElement('span'); m.className = 'meta'; m.textContent = tds[1].textContent + '・' + tds[2].textContent + '・' + tds[3].textContent; r.append(m);
    const a = document.createElement('span'); a.className = 'acts'; if (!tr.classList.contains('on')) a.append(...tr.querySelector('.acts').childNodes); r.append(a); list.append(r); });
  table.replaceWith(list);
});`]],
  },
  {
    key: 'L', name: '「版を置く」を主に一番上（置くと versions\\<版>\\ に作ると言う）・図で版を配る・フォルダの名前は「名前を変える…」で開く',
    css: COMMON_CSS + `.dist-place.lead { padding: 10px 12px; border: 1px dashed var(--line); border-radius: 10px; } .dist-place.lead .btn { font-weight: 700; }
.namesbox summary { cursor: pointer; font-size: 13px; color: var(--text); } .namesbox .dist-names { margin-top: 6px; }`,
    ops: [['script', `${ON_DIST} ${MERGE_JS}
onDist((box) => {
  mergeTable(box); fullEntry(box);
  const place = box.querySelector('.dist-place'); place.classList.add('lead'); box.prepend(place);
  const names = box.querySelector('.dist-names'); const d = document.createElement('details'); d.className = 'namesbox';
  d.innerHTML = '<summary>フォルダの名前を変える…（いま: ' + names.querySelector('input').placeholder + ' ・ ' + names.querySelectorAll('input')[1].placeholder + '）</summary>';
  names.replaceWith(d); d.append(names);
});`]],
  },
  {
    key: 'M', name: '左に見出しの列をそろえる（フォルダの形 ｜ フォルダの名前 ｜ 版を置く ｜ 新しい PC へ。中身は右の列で左の線がそろう）',
    css: COMMON_CSS + `.dist > .lrow { display: grid; grid-template-columns: 124px 1fr; gap: 10px; align-items: start; }
.dist > .lrow > .lh { font-size: 13px; font-weight: 700; color: var(--text); padding-top: 6px; } .dist > .lrow .dist-names { grid-template-columns: 1fr 1fr auto; }
.dist > .lrow .set-row { display: block; } .dist > .lrow .set-row .set-label { display: none; } .dist > .lrow .dist-place { flex-wrap: wrap; }`,
    ops: [['script', `${ON_DIST} ${MERGE_JS}
onDist((box) => {
  mergeTable(box);
  const wrap = (title, el) => { if (!el) return; const r = document.createElement('div'); r.className = 'lrow'; const h = document.createElement('div'); h.className = 'lh'; h.textContent = title; el.replaceWith(r); r.append(h, el); };
  const tree = box.querySelector('.dist-tree'); tree.querySelector('figcaption').remove();
  wrap('フォルダの名前', box.querySelector('.dist-names'));
  wrap('版を置く', box.querySelector('.dist-place'));
  wrap('フォルダの形と版', tree);
  wrap('新しい PC へ', box.querySelector('.dist-entry')?.closest('.set-row'));
  const order = ['フォルダの名前', '版を置く', 'フォルダの形と版', '新しい PC へ'];
  const rows = [...box.querySelectorAll(':scope > .lrow')].sort((a, b) => order.indexOf(a.firstChild.textContent) - order.indexOf(b.firstChild.textContent));
  rows.forEach((r) => box.append(r)); [...box.children].filter((e) => !e.classList.contains('lrow')).forEach((e) => box.append(e));
});`]],
  },
];
