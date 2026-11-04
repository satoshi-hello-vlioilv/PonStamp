// 評価関数: 日付の書式（app/js/stamp.js の formatDate・legacyDateTpl・merge）と、日付印の書式の選び方（本物の画面で押す）を確かめる。
//
//   node tools/date-eval.mjs
//
// 1. 書く: 記号ごとの値・元号の変わり目（平成 31 年 4 月 30 日 → 令和 1 年 5 月 1 日）・"…" の中はそのまま・決まった書式 14 通りの例
// 2. 引き継ぎ: 1.4 までの形（年の書き方 6 × 区切り 4 × 2 桁 2 = 48 通り）を書式に直して書いた字が、1.4 の描き方（下の old）と同じ
// 3. 画面: よく使う形の札を押す・ほかの形を選ぶ・自分で書く（記号の札で入れる・空にしても前の形のまま・離れると戻る）・1.4 の形で登録した印を呼び出す
// 終了コード 0 = 合格。

import { DATE_PRESETS, DEFAULTS, formatDate, legacyDateTpl, merge } from '../app/js/stamp.js';
import { launch, parseView, SEED } from './ui-harness.mjs';

const rows = [];
const check = (name, ok, info = '') => { rows.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${info ? ` -- ${info}` : ''}`); };

// 1. 書く
const d = new Date(2026, 10, 4); // 2026-11-04（水）
const want = {
  yyyy: '2026', yy: '26', e: '8', ee: '08', g: 'R', gg: '令', ggg: '令和', m: '11', mm: '11', d: '4', dd: '04', aaa: '水', aaaa: '水曜日',
  "'yy.m.d": "'26.11.4", 'yyyy/mm/dd': '2026/11/04', 'ge/m/d': 'R8/11/4', 'ggge年m月d日': '令和8年11月4日', '"Date:" yyyy': 'Date: 2026', 'YYYY/M/D': '2026/11/4',
};
const bad = Object.entries(want).filter(([t, v]) => formatDate(t, d) !== v).map(([t, v]) => `${t} → ${formatDate(t, d)}（${v}）`);
check('記号ごとの値（大文字も同じ・"…" の中はそのまま）', !bad.length, bad.join('・'));
const era = [formatDate('ggge年m月d日', new Date(2019, 3, 30)), formatDate('ggge年m月d日', new Date(2019, 4, 1)), formatDate('ge.m.d', new Date(1989, 0, 7)), formatDate('ge.m.d', new Date(1989, 0, 8))];
check('元号の変わり目', era.join('・') === '平成31年4月30日・令和1年5月1日・S64.1.7・H1.1.8', era.join('・'));
check('決まった書式は 14 通り・よく使う形は 7 つ・重ならない', DATE_PRESETS.length === 14 && DATE_PRESETS.filter((p) => p.quick).length === 7 && new Set(DATE_PRESETS.map((p) => p.v)).size === 14);
check('既定の書式は 1.4 の既定と同じ字（\'26.11.4）', formatDate(DEFAULTS.dateTpl, d) === "'26.11.4", formatDate(DEFAULTS.dateTpl, d));

// 2. 引き継ぎ（old は 1.4 の dateText をそのまま写した物）
function old(s, dt) {
  const y = dt.getFullYear(), m = dt.getMonth() + 1, dd = dt.getDate();
  const p = (v) => (s.pad ? String(v).padStart(2, '0') : String(v));
  const yy = String(y % 100).padStart(2, '0'), ry = y - 2018;
  const year = { y4: y, y2n: yy, r: `R${ry}`, rk: `令和${ry}`, rn: ry }[s.dateFmt] ?? `'${yy}`;
  if (s.dateSep === 'kanji') return `${year}年${p(m)}月${p(dd)}日`;
  const sep = ['/', '-'].includes(s.dateSep) ? s.dateSep : '.';
  return `${year}${sep}${p(m)}${sep}${p(dd)}`;
}
const miss = [];
let n = 0;
for (const dateFmt of ['y2', 'y2n', 'y4', 'r', 'rk', 'rn']) for (const dateSep of ['.', '/', '-', 'kanji']) for (const pad of [false, true]) {
  for (const dt of [new Date(2026, 10, 4), new Date(2027, 0, 9)]) {
    n++;
    const s = { dateFmt, dateSep, pad };
    const a = formatDate(merge(DEFAULTS, s).dateTpl, dt), b = old(s, dt);
    if (a !== b) miss.push(`${dateFmt}${dateSep}${pad ? '2桁' : ''}: ${a}（1.4: ${b}）`);
  }
}
check(`1.4 の形を引き継ぐ（${n} 通り）`, !miss.length, miss.slice(0, 4).join('・'));
check('書式があればそちらを使う・空の書式は既定に', merge(DEFAULTS, { dateTpl: 'yy/m/d', dateFmt: 'y4' }).dateTpl === 'yy/m/d' && merge(DEFAULTS, { dateTpl: '  ' }).dateTpl === DEFAULTS.dateTpl);
check('legacyDateTpl', legacyDateTpl({ dateFmt: 'rk', dateSep: 'kanji', pad: true }) === 'ggge年mm月dd日');

// 3. 画面
const app = await launch();
try {
  // 1.4 の形で登録した日付印（令和・漢字・2 桁）を足しておく
  const seed = { ...SEED, presets: [...SEED.presets, { name: '日付印 旧', s: { type: 'date', name: '佐藤', dept: '経理', dateFmt: 'rk', dateSep: 'kanji', pad: true, size: { mitome: 10.5, date: 15, square: 21 } } }] };
  const page = await app.newPage({ name: 'date', seed, run: async () => {} }, parseView('1536x864'));
  await page.locator('[data-type="date"]').first().click();
  const tpl = () => page.locator('#inDateTpl').inputValue();
  const pressed = () => page.locator('#datePresets button[aria-pressed="true"]').allTextContents();
  const custom = () => page.locator('#dateCustom').isVisible();
  const more = () => page.evaluate(() => { const s = document.querySelector('#inDateMore'); return { v: s.value, on: s.classList.contains('on'), text: s.selectedOptions[0]?.textContent }; });

  check('よく使う形の札は 7 つ・例は今日の日付・既定の札が選ばれている', (await page.locator('#datePresets button[data-v]').count()) === 7 && (await pressed()).length === 1 && !(await custom()), (await pressed()).join('・'));
  await page.locator('#datePresets button[data-v="yyyy/m/d"]').click();
  check('札を押すとその形（赤い縁は 1 つ・書く箱は出ない）', (await tpl()) === 'yyyy/m/d' && (await pressed()).length === 1 && !(await custom()) && !(await more()).on, `${await tpl()}・${(await pressed()).join('・')}`);
  await page.selectOption('#inDateMore', 'e.m.d');
  const m1 = await more();
  check('ほかの形を選ぶと、その形（一覧が赤い縁で選んだ形を出す・札は選ばれない）', (await tpl()) === 'e.m.d' && m1.on && m1.v === 'e.m.d' && (await pressed()).length === 0, JSON.stringify(m1));
  await page.selectOption('#inDateMore', '__own');
  check('自分で書く…を選ぶと書く箱が出て、いまの書式が入っている', (await custom()) && (await tpl()) === 'e.m.d' && (await more()).on);
  await page.fill('#inDateTpl', 'ggge年m月d日');
  await page.locator('#inDateTpl').press('End');
  await page.locator('#dateTokens button[data-token="aaa"]').click();
  check('記号の札を押すと、書いている所に入る', (await tpl()) === 'ggge年m月d日aaa', await tpl());
  await page.fill('#inDateTpl', '');
  await page.locator('#inName').click();
  check('空にして離れると、前の書式に戻る（空の書式は使わない）', (await tpl()) === 'ggge年m月d日aaa' && (await custom()), await tpl());
  await page.locator("#datePresets button[data-v=\"'yy.m.d\"]").click();
  check('札を押すと書く箱は閉じる', !(await custom()) && (await tpl()) === "'yy.m.d");
  await page.locator('.pchip .load').nth(3).click();
  await page.waitForTimeout(150);
  check('1.4 の形で登録した印を呼び出すと、書式に直して出す（決まった形に無いので書く箱）', (await tpl()) === 'ggge年mm月dd日' && (await custom()) && (await more()).v === '__own', await tpl());
  await page.selectOption('#inDateMore', '__own');
  await page.locator('.pchip .load').nth(1).click();
  await page.waitForTimeout(150);
  check('自分で書くを開いたまま、決まった形の印を呼び出すと書く箱は閉じる', !(await custom()) && (await pressed()).length === 1, (await pressed()).join('・'));
} finally {
  await app.close();
}
const ok = rows.every(Boolean);
console.log(`日付の書式: ${ok ? 'OK' : 'FAIL'}（${rows.filter(Boolean).length}/${rows.length} 項目）`);
process.exit(ok ? 0 : 1);
