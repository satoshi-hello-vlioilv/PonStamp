// 自己診断（PONSTAMP_SELFTEST=<結果のファイル> で起こしたときだけ、画面が出たあとに窓が流す）。
// 本物の窓（Windows は WebView2・Linux は WebKitGTK）で、画面と Rust の命令が通しで動くかを確かめ、結果を selftest_done へ渡す。
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
      const r = await invoke('save_png', out.bytes, { headers: { 'x-name': encodeURIComponent(`selftest_${type}`), 'x-dpi': '600' } });
      saved.push({ type, path: r.path, dpi: 600 });
    }

    // 3. クリップボード（Windows は Rust が置く。ほかの OS は画面が置くので native=false）
    const one = await ps.exportStamp({ type: 'mitome', dpi: 300 });
    const c = await invoke('copy_png', one.bytes, { headers: { 'x-dpi': '300' } });
    check('クリップボードへ置ける', navigator.userAgent.includes('Windows') ? c.native === true : c.native === false, JSON.stringify(c));

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
