// 評価関数: 登録した印の並びを直す関数（app/js/presets.js）が正しく動くか（上書き・名前・並べ替え・削除・足す・変更の有無・Ctrl+番号）。
//
//   node tools/presets-eval.mjs
//
// 終了コード 0 = 合格。元の並びを変えないこと・断るべき物を断ることも確かめる。

import assert from 'node:assert/strict';
import { add, changed, cleanName, move, overwrite, remove, rename, shortcutIndex } from '../app/js/presets.js';

const L = Object.freeze([{ name: '認印 山田', s: { type: 'mitome', name: '山田' } }, { name: '日付印 総務', s: { type: 'date' } }, { name: '社印', s: { type: 'square' } }].map(Object.freeze));
const names = (l) => l.map((p) => p.name);
let n = 0;
const check = (title, f) => { f(); n++; console.log(`PASS: ${title}`); };

try {
  check('上書き: 名前はそのまま、中身だけ変わる・元の並びは変えない', () => {
    const o = overwrite(L, 0, { type: 'mitome', name: '山田太郎' });
    assert.deepEqual(o[0], { name: '認印 山田', s: { type: 'mitome', name: '山田太郎' } });
    assert.equal(L[0].s.name, '山田');
    assert.throws(() => overwrite(L, 3, {}), /見つかりません/);
  });
  check('名前: 空白を除く・空と同じ名前は断る・20 字まで', () => {
    assert.deepEqual(names(rename(L, 2, '  会社印 ')), ['認印 山田', '日付印 総務', '会社印']);
    assert.throws(() => rename(L, 2, '   '), /空/);
    assert.throws(() => rename(L, 2, '認印 山田'), /もうあります/);
    assert.deepEqual(names(rename(L, 0, '認印 山田')), names(L), '自分と同じ名前は変えないだけ');
    assert.equal(cleanName('あ'.repeat(30)).length, 20);
  });
  check('並べ替え: 上へ・下へ・端は動かない', () => {
    assert.deepEqual(names(move(L, 1, -1)), ['日付印 総務', '認印 山田', '社印']);
    assert.deepEqual(names(move(L, 1, 1)), ['認印 山田', '社印', '日付印 総務']);
    assert.deepEqual(names(move(L, 0, -1)), names(L));
    assert.deepEqual(names(move(L, 2, 1)), names(L));
  });
  check('削除・足す（同じ名前は足さずに断る）', () => {
    assert.deepEqual(names(remove(L, 1)), ['認印 山田', '社印']);
    assert.deepEqual(names(add(L, '角印 2', {})), [...names(L), '角印 2']);
    assert.throws(() => add(L, '社印', {}), /もうあります/);
  });
  check('変更の有無: 印の見た目に関わる値だけで比べる（地・解像度は数えない）', () => {
    const base = { type: 'mitome', name: '山田', size: { mitome: 10.5 }, bg: 'checker', dpi: 600 };
    assert.equal(changed(base, { ...base }), false);
    assert.equal(changed(base, { ...base, bg: 'paper', dpi: 1200 }), false);
    assert.equal(changed(base, { ...base, name: '山田太郎' }), true);
    assert.equal(changed(base, { ...base, size: { mitome: 12 } }), true);
  });
  check('Ctrl+番号: 1〜9 と登録した数の中だけ', () => {
    assert.equal(shortcutIndex('1', 3), 0);
    assert.equal(shortcutIndex('3', 3), 2);
    assert.equal(shortcutIndex('4', 3), -1);
    assert.equal(shortcutIndex('0', 12), -1);
    assert.equal(shortcutIndex('9', 12), 8);
    assert.equal(shortcutIndex('a', 3), -1);
  });
  console.log(`登録した印の操作: OK（${n} 項目）`);
} catch (e) {
  console.log(`FAIL: ${e.message}`);
  console.log('登録した印の操作: FAILED');
  process.exit(1);
}
