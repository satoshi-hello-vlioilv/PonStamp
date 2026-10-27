// 画面と外（Rust の窓・ブラウザ）の窓口。画面はここだけを呼ぶ（どちらで動いているかを画面は知らなくてよい）。
//
// - 窓（Tauri）の中: Rust の命令を呼ぶ（desktop/src/commands.rs）。バイト列（PNG・ZIP）は JSON にせずそのまま渡し、引数は見出しに入れる
// - ふつうのブラウザ（撮影・試し）: この PC の localStorage に覚え、保存はダウンロード。常駐・更新・配布は「窓だけの機能」と答える
//
// 失敗はどちらも Error（message は利用者に見せる日本語）で返す。

const T = window.__TAURI__;

/** 窓の中で動いているか */
export const inWindow = !!T?.core?.invoke;

function tauriBackend() {
  const { invoke } = T.core;
  const call = async (cmd, args) => {
    try {
      return await invoke(cmd, args);
    } catch (e) {
      throw new Error(typeof e === 'string' ? e : e?.message || String(e));
    }
  };
  const raw = (cmd, bytes, headers) => call(cmd, bytes, { headers });
  return {
    load: () => call('load'),
    saveLast: (s) => call('save_last', { value: s }),
    savePresets: (list) => call('save_presets', { value: list }),
    setSettings: (patch) => call('set_settings', { patch }),
    savePng: (bytes, name, dpi) => raw('save_png', bytes, { 'x-name': encodeURIComponent(name), 'x-dpi': String(dpi) }),
    copyPng: (bytes, dpi) => raw('copy_png', bytes, { 'x-dpi': String(dpi) }),
    openFolder: () => call('open_folder'),
    reveal: (path) => call('reveal', { path }),
    pickFolder: (start) => call('pick_folder', { start }),
    setAutostart: (on) => call('set_autostart', { on }),
    updateStatus: () => call('update_status'),
    updateCheck: () => call('update_check'),
    updateApply: () => call('update_apply'),
    probeSource: (value) => call('probe_source', { value }),
    shortcutMake: () => call('shortcut_make'),
    shortcutDecline: () => call('shortcut_decline'),
    releaseView: () => call('release_view'),
    releasePlace: (name, bytes) => raw('release_place', bytes, { 'x-name': encodeURIComponent(name) }),
    releaseDistribute: (version) => call('release_distribute', { version }),
    releaseRemove: (version) => call('release_remove', { version }),
    ready: () => call('page_ready'),
    notify: (text) => call('notify', { text }),
    hide: () => call('hide_window'),
    quit: () => call('quit'),
    on: (name, fn) => T.event.listen(name, (e) => fn(e.payload)),
  };
}

/**
 * ふつうのブラウザ: 窓が無いので、覚えるのは localStorage、保存はダウンロード。
 * 撮影（tools/ui-harness.mjs）では、覚えの demo に窓の答え（版・常駐・ショートカット・更新・配布）を入れて、その状態の画面を見せる
 */
function browserBackend() {
  const KEY = 'ponstamp.state';
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
  };
  const write = (patch) => {
    const st = { ...read(), ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(st));
    } catch {
      /* 覚えられない（プライベートの窓など）。その回だけ使う */
    }
    return st;
  };
  const demo = () => read().demo || null;
  const windowOnly = async () => {
    if (demo()) return {};
    throw new Error('この機能はアプリ（exe）の中だけで使えます');
  };
  return {
    load: async () => {
      const st = read();
      return {
        presets: st.presets || [], last: st.last || null, outputDir: st.outputDir || 'ダウンロード',
        updateSource: st.updateSource || '', autostart: { on: false, can: false },
        info: { shell: 'browser', version: '', installed: false },
        shortcut: { ask: false }, update: { state: 'off' }, notes: [],
        ...(st.demo || {}),
      };
    },
    saveLast: async (s) => void write({ last: s }),
    savePresets: async (list) => void write({ presets: list }),
    setSettings: async (patch) => write(patch),
    savePng: async (bytes, name) => {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([bytes], { type: 'image/png' })), download: `${name}.png` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      return { path: `ダウンロード\\${name}.png` };
    },
    copyPng: async () => ({ native: false }),
    openFolder: windowOnly,
    reveal: windowOnly,
    pickFolder: windowOnly,
    setAutostart: async (on) => {
      if (!demo()) return windowOnly();
      const d = demo();
      write({ demo: { ...d, autostart: { ...d.autostart, on } } });
      return { ...d.autostart, on };
    },
    updateStatus: async () => demo()?.update || { state: 'off' },
    updateCheck: windowOnly,
    updateApply: windowOnly,
    probeSource: windowOnly,
    shortcutMake: windowOnly,
    shortcutDecline: windowOnly,
    releaseView: async () => demo()?.release || windowOnly(),
    releasePlace: windowOnly,
    releaseDistribute: windowOnly,
    releaseRemove: windowOnly,
    ready: async () => {},
    notify: async () => {},
    hide: async () => {},
    quit: async () => window.close(),
    on: async () => () => {},
  };
}

export const backend = inWindow ? tauriBackend() : browserBackend();
