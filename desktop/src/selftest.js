// 自己診断（PONSTAMP_SELFTEST=<結果のファイル> で起こしたときだけ、画面が出たあとに窓が流す）。
// 本物の窓（Windows は WebView2・Linux は WebKitGTK）で、画面と Rust の命令が通しで動くかを確かめ、結果を selftest_done へ渡す。
// 保存・コピーは、画面が使うのと同じ窓口（app/js/backend.js）と、本物のボタンを通す（窓口を飛ばして Rust を直に呼ぶと、
// 窓口の不具合〈見出しの値を落とす〉を見逃す。1.1.0 で、コピー・保存が「解像度の値が違います」で止まったのを見逃した）。
// 保存した PNG の解像度は画面からは読めないので、Rust（main.rs の selftest_finish）が読んで確かめる。
(async () => {
  const { invoke } = window.__TAURI__.core;
  const results = [];
  const saved = [];
  const check = (name, ok, info = '') => results.push({ name, ok: !!ok, info: String(info) });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const inked = (cv) => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4 * 31) if (d[i]) return true;
    return false;
  };
  try {
    // 1. 画面が描けた（プレビューに色が付く）
    let cv = null;
    for (let i = 0; i < 100 && !(cv && cv.width && inked(cv)); i++) {
      cv = document.querySelector('#pv');
      await wait(100);
    }
    check('プレビューが描ける', cv && inked(cv), cv ? `${cv.width}px` : '無い');

    // 2. 印の種類ごとに書き出し、Rust に保存させる（解像度つき）
    const ps = window.__ps;
    check('画面の試しの口がある', !!ps, typeof ps);
    for (const type of ['mitome', 'date', 'square']) {
      const out = await ps.exportStamp({ type, dpi: 600 });
      const want = Math.round((out.mm / 25.4) * 600);
      check(`${type} の画素の数が mm と dpi に合う`, out.px === want, `${out.px}px（${out.mm}mm・600dpi なら ${want}px）`);
      const r = await ps.backend.savePng(out.bytes, `selftest_${type}`, 600);
      saved.push({ type, path: r.path, dpi: 600 });
    }

    // 3. クリップボード（Windows は Rust が置く。ほかの OS は画面が置くので native=false）
    const one = await ps.exportStamp({ type: 'mitome', dpi: 300 });
    const c = await ps.backend.copyPng(one.bytes, 300);
    check('クリップボードへ置ける', navigator.userAgent.includes('Windows') ? c.native === true : c.native === false, JSON.stringify(c));
    // 3b. 本物の「コピー」のボタン: 押すと知らせが「コピーしました」になる（失敗の知らせが出ない）。
    //     Windows だけ（ほかの OS は画面がブラウザの仕組みで置き、それは人が押したときだけ許されるので、スクリプトの押しでは確かめられない）
    const toast = document.querySelector('#toast');
    if (navigator.userAgent.includes('Windows')) {
      toast.textContent = '';
      document.querySelector('#btnCopy').click();
      for (let i = 0; i < 50 && !toast.textContent; i++) await wait(100);
      check('コピーのボタンで、コピーできる', toast.textContent.startsWith('コピーしました') && !toast.classList.contains('err'), toast.textContent);
    }
    // 3c. 通知領域・右クリックのメニューからのコピー（窓の知らせ ps:copy と同じ道）
    const n = await ps.copyFor('last');
    check('メニューからのコピーができる', n.ok, n.text);

    // 4. 登録した印を覚え、読み直せる
    const before = await invoke('load');
    await invoke('save_presets', { value: [...before.presets, { name: '自己診断', s: { type: 'mitome', name: '試' } }] });
    const after = await invoke('load');
    check('登録した印を覚える', after.presets.some((p) => p.name === '自己診断'), after.presets.length);
    await invoke('save_presets', { value: before.presets });

    // 5. 画面のエラーが無い
    check('画面のエラーが無い', !(window.__psErrors || []).length, (window.__psErrors || []).join(' / '));
  } catch (e) {
    check('自己診断が最後まで動く', false, e && (e.message || e));
  }
  await invoke('selftest_done', { result: { ok: results.every((r) => r.ok), results, saved } });
})();
