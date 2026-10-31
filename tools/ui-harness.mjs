// 画面の撮影と測定の共通部（ui-check.mjs・ui-variants.mjs・評価関数が使う）。
//
// - app/ を手元の小さなサーバーで出し（ES モジュールは file:// では読めない）、本物の Chromium で開く
// - 窓（Tauri）は無いので、画面は backend.js のブラウザの代わりで動く。覚えた状態（よく使う印など）は localStorage に入れてから開く
// - 撮る状態は STATES（名前 → 頁でする操作）。測る量は measure（頁の中で動かす）

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// playwright は入れた場所（NODE_PATH・全体の node_modules）から読む（import は NODE_PATH を見ない）
export const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon', '.png': 'image/png', '.svg': 'image/svg+xml' };

/** 撮る大きさ（CLAUDE.md）: 利用者の PC・フル HD 125%・表示の下限 */
export const VIEWS = { '1728x1152': { width: 1728, height: 1152 }, '1536x864': { width: 1536, height: 864 }, '1280x720': { width: 1280, height: 720 } };

export function parseView(text) {
  if (!text) return VIEWS['1728x1152'];
  const m = /^(\d+)x(\d+)$/.exec(text);
  if (!m) throw new Error(`大きさは 幅x高さ（例 1536x864）: ${text}`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

/** いまの版（app/version.json）と次の版。見本の版はこれに合わせる（更新履歴の先頭といまの版が食い違わないように） */
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).version;
const NEXT = VERSION.replace(/\d+$/, (n) => String(Number(n) + 1));

/** 窓の答えの代わり（backend.js のブラウザの代わりが読む）: この PC へ写したアプリ・常駐あり・ショートカットあり・最新の版 */
const DEMO = {
  info: { shell: 'tauri', name: 'PonStamp', version: VERSION, installed: true, root: 'C:\\Users\\yamada\\AppData\\Local\\PonStamp' },
  autostart: { on: true, can: true },
  shortcut: { ask: false, links: ['C:\\Users\\yamada\\Desktop\\PonStamp.lnk', 'C:\\Users\\yamada\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\PonStamp.lnk'] },
  update: { state: 'latest', current: VERSION, checkedAt: '2026-10-27 09:30', source: '\\\\fs01\\共有\\Releases' },
  updateSource: '\\\\fs01\\共有\\Releases',
  updateSourceUsed: '\\\\fs01\\共有\\Releases',
  release: {
    reachable: true, found: '\\\\fs01\\共有\\Releases', adjusted: false,
    appFolder: '\\\\fs01\\共有\\Releases\\PonStamp', versionsFolder: '\\\\fs01\\共有\\Releases\\PonStamp\\versions',
    names: { app: 'PonStamp', versions: 'versions', appSet: false },
    distributed: { version: VERSION, entry: 'PonStamp.exe' },
    versions: [
      { version: NEXT, placedAt: '2026-10-27T10:12:00', placedBy: 'sato', placedPc: 'PC-0123', bytes: 9437184, inVersions: true },
      { version: VERSION, placedAt: '2026-10-20T16:40:00', placedBy: 'sato', placedPc: 'PC-0123', bytes: 9332736, inVersions: true },
    ],
    entry: { exists: true, path: '\\\\fs01\\共有\\Releases\\PonStamp\\PonStamp.exe' },
    problems: [],
  },
  notes: [],
};

/** よく使う印を 3 つ登録した、使い込んだ状態（撮影の既定） */
export const SEED = {
  presets: [
    { name: '認印 山田', s: { type: 'mitome', name: '山田', color: '#d6343a', size: { mitome: 10.5, date: 15, square: 21 } } },
    { name: '日付印 総務', s: { type: 'date', name: '山田', dept: '総務課', color: '#d6343a', size: { mitome: 10.5, date: 15, square: 21 } } },
    { name: '社印', s: { type: 'square', square: '株式会社見本之印', color: '#d6343a', size: { mitome: 10.5, date: 15, square: 21 } } },
  ],
  outputDir: 'C:\\Users\\yamada\\Pictures\\電子印',
  demo: DEMO,
};
/** 初めて開いた PC（登録した印なし・ショートカットを尋ねる） */
const FIRST = { demo: { ...DEMO, shortcut: { ask: true, links: [] }, autostart: { on: false, can: true } } };
/** 新しい版を取り込んだ所 */
const UPDATE = { ...SEED, demo: { ...DEMO, update: { ...DEMO.update, state: 'ready', ready: NEXT, direction: 'up' } } };

/** 撮る状態。順に流す（前の状態からの続き）。seed: 開く前に入れる覚え（null なら何も覚えていない初めての状態） */
export const STATES = [
  { name: 'first', seed: FIRST, run: async () => {} },
  { name: 'mitome', seed: SEED, run: async () => {} },
  { name: 'date', seed: SEED, run: async (page) => clickType(page, 'date') },
  { name: 'square', seed: SEED, run: async (page) => clickType(page, 'square') },
  { name: 'advanced', seed: SEED, run: async (page) => openAdvanced(page) },
  { name: 'update', seed: UPDATE, run: async () => {} },
  { name: 'settings', seed: UPDATE, run: async (page) => openSettings(page) },
  { name: 'distribution', seed: SEED, run: async (page) => openDistribution(page) },
];
export const STATE_NAMES = STATES.map((s) => s.name);

async function clickType(page, type) {
  await page.locator(`[data-type="${type}"]`).first().click();
}

async function openAdvanced(page) {
  // data-open="advanced" の札があれば押す（面を切り替える案）。無ければ <details class="adv"> を開く（最初から開いている案では閉じない）
  const tab = page.locator('[data-open="advanced"]').first();
  if (await tab.count()) await tab.click();
  else await page.evaluate(() => { const d = document.querySelector('details.adv'); if (d) d.open = true; });
}

/** 設定を開き、配布（配る人向け）を開いて、そこまで引き出しの中を送る（置き場のフォルダの形・版の一覧を見る） */
async function openDistribution(page) {
  await openSettings(page);
  await page.evaluate(() => {
    const sec = document.querySelector('#setDistribution')?.closest('section');
    if (!sec) return;
    sec.scrollIntoView({ block: 'start' });
    // 引き出しの見出し（上に貼り付く）に隠れないよう、送る箱を少し戻す
    for (let el = sec.parentElement; el; el = el.parentElement) if (el.scrollHeight > el.clientHeight + 1) { el.scrollTop -= 72; break; }
  });
  await page.waitForTimeout(150);
}

async function openSettings(page) {
  await page.locator('[data-open="settings"]').first().click();
  const more = page.locator('#setDistribution > summary');
  if (await more.count()) await more.click();
  await page.waitForTimeout(150);
}

function serve() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = path.join(ROOT, url === '/' ? 'index.html' : url);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/** Chromium と画面のサーバーを起こす */
export async function launch() {
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  return {
    browser,
    base,
    /** 状態 state の覚えを入れて画面を開く（読み込みと描画を待つ）。init: 読み込むたびに頁の中で先に動かす文（案を当てる） */
    async newPage(state, view, theme = 'light', init = '') {
      const context = await browser.newContext({ viewport: view, deviceScaleFactor: 1, colorScheme: theme, locale: 'ja-JP' });
      const page = await context.newPage();
      if (init) await page.addInitScript(init);
      page.on('pageerror', (e) => console.error(`[画面のエラー] ${e.message}`));
      await page.addInitScript((seed) => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        localStorage.clear();
        if (seed) localStorage.setItem('ponstamp.state', JSON.stringify(seed));
      }, state.seed);
      await page.goto(base);
      await ready(page);
      await state.run(page);
      await page.waitForTimeout(250);
      return page;
    },
    async close() {
      await browser.close();
      server.close();
    },
  };
}

/** 画面の描画が済むまで待つ（プレビューの canvas に色が付く） */
export async function ready(page) {
  await page.waitForFunction(() => {
    const cv = document.querySelector('#pv');
    if (!cv || !cv.width) return false;
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4 * 97) if (d[i]) return true;
    return false;
  }, null, { timeout: 15000 });
}

/** 迷いやすさに関わる量（頁の中で動かす） */
export function measure() {
  const vw = innerWidth;
  const vh = innerHeight;
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const controls = [...document.querySelectorAll('button, input, select, textarea, summary, [role="tab"]')].filter(shown);
  // はみ出し: 窓の外へ出た操作（px の合計）と、字が枠から出ている要素
  let cut = 0;
  for (const el of controls) {
    const r = el.getBoundingClientRect();
    cut += Math.max(0, r.right - vw) + Math.max(0, -r.left);
  }
  const clipped = [...document.querySelectorAll('button, label, .lbl, h1, h2, h3, .meta, .hint, kbd')]
    .filter(shown)
    .filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible').length;
  // 小さい字（11px 未満）の見える要素
  const small = [...document.querySelectorAll('body *')]
    .filter((el) => el.childElementCount === 0 && el.textContent.trim() && shown(el))
    .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 11).length;
  const primaries = controls.filter((el) => el.matches('.primary, .btn.primary, [data-primary]')).length;
  const scroll = Math.max(0, document.documentElement.scrollHeight - vh);
  const stage = document.querySelector('#pv')?.getBoundingClientRect();
  return {
    controls: controls.length,
    primaries,
    cut: Math.round(cut),
    clipped,
    small,
    scroll,
    preview: stage ? Math.round(stage.width) : 0,
  };
}
