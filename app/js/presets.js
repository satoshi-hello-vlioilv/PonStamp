// 登録した印の並び（[{ name, s }]）を直す小さな関数（画面にも窓にも依らない。tools/presets-eval.mjs が確かめる）。
//
// どれも元の並びを変えず、新しい並びを返す。番号がおかしい・名前が空などは Error（message は利用者に見せる日本語）。
// 並びの順は、通知領域・右クリックのメニューの順と Ctrl+1〜9 の番号でもある（Rust は受け取った順に並べる）。

export const NAME_MAX = 20;
/** Ctrl+番号でコピーできる数 */
export const SHORTCUT_COUNT = 9;

const at = (list, i) => {
  if (!Number.isInteger(i) || i < 0 || i >= list.length) throw new Error('その登録した印が見つかりません');
  return list[i];
};

/** 名前を整える（前後の空白を除き、長すぎれば切る）。空なら Error */
export function cleanName(name) {
  const n = String(name ?? '').trim().slice(0, NAME_MAX);
  if (!n) throw new Error('名前が空です');
  return n;
}

/** i 番目を、いまの印 s で上書き（名前はそのまま） */
export function overwrite(list, i, s) {
  at(list, i);
  return list.map((p, k) => (k === i ? { name: p.name, s } : p));
}

/** i 番目の名前を変える。ほかの印と同じ名前は断る（同じ名前は、どれを呼ぶか分からなくなる） */
export function rename(list, i, name) {
  at(list, i);
  const n = cleanName(name);
  if (list.some((p, k) => k !== i && p.name === n)) throw new Error(`「${n}」はもうあります。別の名前にしてください`);
  return list.map((p, k) => (k === i ? { ...p, name: n } : p));
}

/** i 番目を d（-1 = 上・+1 = 下）だけ動かす。端を越えるなら、そのままの並び */
export function move(list, i, d) {
  at(list, i);
  const j = i + d;
  if (j < 0 || j >= list.length) return list.slice();
  const out = list.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** i 番目を消す */
export function remove(list, i) {
  at(list, i);
  return list.filter((_, k) => k !== i);
}

/** いまの印を新しく足す（同じ名前があれば Error。上書きは overwrite で明示する） */
export function add(list, name, s) {
  const n = cleanName(name);
  if (list.some((p) => p.name === n)) throw new Error(`「${n}」はもうあります。上書きするときは、その印の「…」から選んでください`);
  return [...list, { name: n, s }];
}

/** 呼び出した後に変えたか: 呼び出した直後の印（控え）といまの印を、印の見た目に関わる値だけで比べる */
const IGNORE = new Set(['bg', 'dpi']);   // プレビューの地・解像度（設定）は印ごとの物ではない
export function changed(base, now) {
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(now || {})].filter((k) => !IGNORE.has(k)));
  for (const k of keys) if (JSON.stringify(base?.[k]) !== JSON.stringify(now?.[k])) return true;
  return false;
}

/** Ctrl+番号（'1'〜'9'）→ 登録した印の番号（無ければ -1） */
export function shortcutIndex(key, count) {
  const n = Number(key);
  return Number.isInteger(n) && n >= 1 && n <= Math.min(SHORTCUT_COUNT, count) ? n - 1 : -1;
}
