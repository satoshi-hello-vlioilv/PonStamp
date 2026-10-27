// 画面の部品を作る小さな道具（文字は必ず文字として入れる。パスや名前を HTML として解釈させない）。

/** 要素を作る: h('button', { class: 'btn', onclick: f }, '押す', 子要素…)。null・false の子は飛ばす */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/** 中身を入れ替える */
export function fill(el, ...children) {
  el.replaceChildren();
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

/** バイト数を読みやすく（1.2 MB） */
export function bytes(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(i ? 1 : 0)} ${u[i]}`;
}

/** 「2026-10-27T12:34:56」→「2026/10/27 12:34」 */
export function when(t) {
  return t ? String(t).replace('T', ' ').replace(/-/g, '/').slice(0, 16) : '';
}
