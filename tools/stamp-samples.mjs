// 印影の見本（見本帳 stamp-sheet.mjs と評価関数 stamp-eval.mjs が同じ物を使う）。
// 文字数（1〜15）・平たい字（一・ノ）・込み入った字（鬱・嵐）・長い上段・英字を混ぜる。
export const SAMPLES = [
  { type: 'mitome', name: '林' }, { type: 'mitome', name: '山田' }, { type: 'mitome', name: '佐々木' }, { type: 'mitome', name: '一ノ瀬' },
  { type: 'mitome', name: '長谷川' }, { type: 'mitome', name: '勅使河原' }, { type: 'mitome', name: '五十嵐太郎' }, { type: 'mitome', name: '小鳥遊' },
  { type: 'date', dept: '総務課', name: '山田' }, { type: 'date', dept: '株式会社見本商事', name: '長谷川' }, { type: 'date', dept: '経理', name: '一' },
  { type: 'date', dept: 'ABC', name: 'Smith', dateFmt: 'y4' },
  { type: 'square', square: '社印' }, { type: 'square', square: '見本之印' }, { type: 'square', square: '株式会社見本之印' },
  { type: 'square', square: '株式会社見本商事代表取締役之印' },
];
