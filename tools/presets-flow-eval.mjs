// 評価関数: 登録した印の使い方を、本物の画面で押して確かめる（1 手でコピー・Ctrl+番号・上書き・名前・並べ替え・削除と元に戻す・ものさし）。
//
//   node tools/presets-flow-eval.mjs
//
// 画面はブラウザの代わり（backend.js）で動く。登録した印の並びは localStorage（窓では state.json）を読んで確かめる。終了コード 0 = 合格。

import { launch, parseView, ready, SEED } from './ui-harness.mjs';

const app = await launch();
const rows = [];
const check = (name, ok, info = '') => { rows.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${info ? ` -- ${info}` : ''}`); };
try {
  const page = await app.newPage({ name: 'flow', seed: SEED, run: async () => {} }, parseView('1536x864'));
  // ふつうのブラウザの代わりの道（ほかの OS の窓と同じ）はクリップボードへ書く。撮影の Chromium に許可を与える（窓の Windows は Rust が置く）
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app.base });
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('ponstamp.state')).presets.map((p) => ({ name: p.name, n: p.s.name })));
  const toastText = () => page.locator('#toastText').textContent();
  /** 知らせを空にしてから fn を動かし、新しい知らせが出るまで待つ（コピーは描いて PNG にする間かかる。決め打ちの待ちでは前の知らせを読む） */
  const fresh = async (fn) => { await page.evaluate(() => { document.querySelector('#toastText').textContent = ''; }); await fn();
    await page.waitForFunction(() => document.querySelector('#toastText').textContent !== '', null, { timeout: 3000 }).catch(() => {}); };
  const nowLine = () => page.locator('#nowLine').innerText();
  const menu = async (i, label) => { await page.locator('.pchip .more').nth(i).click(); await page.locator('#presetMenu button', { hasText: label }).click(); };
  let clicks = 0;
  const click = async (loc) => { clicks++; await loc.click(); };

  // 1. 登録した印を 1 手でコピー（呼び出さずに）・Ctrl+番号
  clicks = 0;
  await fresh(() => click(page.locator('.pchip .cp').nth(1)));
  check('登録した印を 1 手でコピー', clicks === 1 && (await toastText()).includes('「日付印 総務」をコピーしました'), `${clicks} 手・${await toastText()}`);
  await page.locator('body').click({ position: { x: 1000, y: 400 } });
  await fresh(() => page.keyboard.press('Control+3'));
  check('Ctrl+3 で 3 番目をコピー', (await toastText()).includes('「社印」をコピーしました'), await toastText());
  check('呼び出していなければ「新しい印」', (await nowLine()).includes('新しい印'), await nowLine());

  // 2. 呼び出して変える → 変更あり → 上書き
  await page.locator('.pchip .load').first().click();
  check('呼び出すと「登録したまま」', (await nowLine()).includes('認印 山田') && (await nowLine()).includes('登録したまま'), await nowLine());
  await page.fill('#inName', '山田太郎');
  check('変えると「変更あり」と上書き・札に「登録した形」', (await nowLine()).includes('変更あり') && (await page.locator('.pchip.on .reg-form').count()) === 1, await nowLine());
  await page.keyboard.press('Control+1');
  await page.waitForTimeout(100);
  check('変えている間も、札のコピーは登録した形（上書きしない）', (await stored())[0].n === '山田', JSON.stringify((await stored())[0]));
  await page.locator('#nowLine button', { hasText: '上書き' }).click();
  await page.waitForTimeout(100);
  check('上書きすると保存され、「登録したまま」に戻る', (await stored())[0].n === '山田太郎' && (await nowLine()).includes('登録したまま'), `${JSON.stringify((await stored())[0])}・${await nowLine()}`);

  // 3. 名前を変える（同じ名前は断る）
  await menu(2, '名前を変える');
  await page.fill('#inPresetName', '会社印');
  await page.locator('#btnPresetOk').click();
  await page.waitForTimeout(100);
  check('名前を変える', (await stored())[2].name === '会社印', JSON.stringify((await stored()).map((p) => p.name)));
  await menu(2, '名前を変える');
  await page.fill('#inPresetName', '認印 山田');
  await page.locator('#btnPresetOk').click();
  await page.waitForTimeout(100);
  check('同じ名前には変えない（断る）', (await stored())[2].name === '会社印' && (await toastText()).includes('もうあります'), await toastText());

  // 4. 並べ替え（呼び出した印を追う）
  await menu(0, '後ろへ');
  await page.waitForTimeout(100);
  const order = (await stored()).map((p) => p.name);
  check('後ろへ', order.join('|') === '日付印 総務|認印 山田|会社印', order.join('|'));
  check('並べ替えても、呼び出した印を指し続ける', (await page.locator('.pchip.on .nm').textContent()) === '認印 山田' && (await nowLine()).includes('認印 山田'), await nowLine());
  check('いちばん前の「前へ」は押せない', await page.evaluate(async () => { document.querySelectorAll('.pchip .more')[0].click(); await new Promise((r) => setTimeout(r, 50));
    const b = [...document.querySelectorAll('#presetMenu button')].find((x) => x.textContent === '前へ'); const off = b.disabled; document.body.click(); return off; }));

  // 5. 削除はすぐ消え、元に戻せる
  await menu(1, '削除');
  await page.waitForTimeout(100);
  const afterDel = (await stored()).map((p) => p.name).join('|');
  check('削除は 1 手で消える（呼び出した印なら「新しい印」に）', afterDel === '日付印 総務|会社印' && (await nowLine()).includes('新しい印'), `${afterDel}・${await nowLine()}`);
  check('消すと「元に戻す」が出る', await page.locator('#toastAct').isVisible(), await toastText());
  await page.locator('#toastAct').click();
  await page.waitForTimeout(100);
  const undone = (await stored()).map((p) => p.name).join('|');
  check('元に戻すと、同じ場所に戻り、呼び出しも戻る', undone === '日付印 総務|認印 山田|会社印' && (await nowLine()).includes('認印 山田'), `${undone}・${await nowLine()}`);

  // 6. 新しく登録（同じ名前は断る）
  await page.locator('#btnAddPreset').click();
  await page.fill('#inPresetName', '会社印');
  await page.locator('#btnPresetOk').click();
  await page.waitForTimeout(100);
  check('同じ名前では新しく登録しない（上書きは明示）', (await stored()).length === 3 && (await toastText()).includes('もうあります'), await toastText());

  // 7. ものさし
  await page.locator('#btnCheck').click();
  check('大きさを確かめる窓が開く', await page.locator('#dlgCheck').evaluate((d) => d.open));
  const w = await page.locator('#cvRuler').evaluate((c) => c.width);
  check('窓の見本は 300 dpi の 50mm（591px）', w === 591, `${w}px`);
  await fresh(() => page.locator('#btnRulerCopy').click());
  check('ものさしをコピー', (await toastText()).includes('ものさしをコピーしました'), await toastText());
  // 保存は窓口（backend.savePng）へ渡る名前と解像度を見る（窓では Rust がこの名前で保存する。撮影の Chromium は Blob のダウンロードに名前を返さない）
  const saved = await page.evaluate(async () => { const b = window.__ps.backend; const orig = b.savePng; let got = null;
    b.savePng = async (bytes, name, dpi) => { got = { name, dpi, bytes: bytes.length }; return { path: name }; };
    document.querySelector('#btnRulerSave').click(); await new Promise((r) => setTimeout(r, 300)); b.savePng = orig; return got; });
  check('ものさしを PNG で保存（名前に mm と dpi・いまの解像度）', saved?.name === 'ものさし_50mm_600dpi' && saved.dpi === 600 && saved.bytes > 1000, JSON.stringify(saved));

  // 8. 開き直しても並びが残る（保存した並びを読む）
  await page.reload();
  await ready(page);
  const names = await page.locator('.pchip .nm').allTextContents();
  check('開き直しても並びと名前が残る', names.join('|') === '日付印 総務|認印 山田|会社印', names.join('|'));
  await page.context().close();
} finally {
  await app.close();
}
const ok = rows.every(Boolean);
console.log(ok ? `登録した印の使い方: OK（${rows.length} 項目）` : '登録した印の使い方: FAILED');
process.exit(ok ? 0 : 1);
