// 設定（保存とコピー・起動・更新・配布・このアプリについて）と、起動のときの知らせ（ショートカット・更新・写せなかった等）。
// 画面のどこに置いても動くよう、渡された箱の中に自分で組み立てる。外（Rust・ブラウザ）とは backend.js だけで話す。

import { bytes, fill, h, when } from './dom.js';

const DPIS = [[300, '軽い'], [600, '標準'], [1200, '高精細']];

/** 版を数で比べる（1.10.0 は 1.9.0 より新しい）。a が古ければ負 */
export function compareVersions(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
  return 0;
}

/** 更新の状態 → { tone, text }（tone: ok・info・warn・busy・off。色だけでなく言葉と印でも分かるように） */
export function updateLine(u) {
  const st = u?.state || 'off';
  if (st === 'ready') return { tone: 'info', mark: '↑', text: `新しい版 ${u.ready} を取り込みました。開き直すと入れ替わります` };
  if (st === 'latest') return { tone: 'ok', mark: '✓', text: u.detail || `いまの版 ${u.current} が最新です` };
  if (st === 'checking' || st === 'idle') return { tone: 'busy', mark: '…', text: '置き場を確かめています…' };
  if (st === 'staging') return { tone: 'busy', mark: '…', text: `新しい版 ${u.detail} を取り込んでいます…` };
  if (st === 'error') return { tone: 'warn', mark: '!', text: u.problem || '確かめられませんでした' };
  return { tone: 'off', mark: '–', text: u?.detail || '更新は確かめていません' };
}

/**
 * 設定の面。root に組み立てる。
 * deps: { backend, toast(msg, err), getDpi(), setDpi(n), onOutputDir(dir) }
 */
export function createSettings(root, deps) {
  const { backend, toast } = deps;
  let st = {};
  let release = null;
  let releaseBusy = false;

  const sec = (id, title, ...body) => h('section', { class: 'set-sec', 'aria-labelledby': `set-${id}` }, h('h2', { id: `set-${id}` }, title), ...body);
  const row = (label, ...ctl) => h('div', { class: 'set-row' }, h('div', { class: 'set-label' }, label), h('div', { class: 'set-ctl' }, ...ctl));
  const btn = (text, onclick, cls = 'btn small') => h('button', { type: 'button', class: cls, onclick }, text);
  const act = async (fn, ok) => {
    try {
      const r = await fn();
      if (ok) toast(typeof ok === 'function' ? ok(r) : ok);
      return r;
    } catch (e) {
      toast(e.message, true);
      return null;
    }
  };

  // ---------- 保存とコピー
  function output() {
    const path = h('input', { type: 'text', id: 'setOutDir', value: st.outputDir || '', spellcheck: 'false', 'aria-label': 'PNG の保存先フォルダ' });
    const save = async () => {
      const r = await act(() => backend.setSettings({ outputDir: path.value }), '保存先を変えました');
      if (r) { st.outputDir = r.outputDir; path.value = r.outputDir; deps.onOutputDir?.(r.outputDir); }
    };
    path.addEventListener('change', save);
    const pick = async () => {
      const dir = await act(() => backend.pickFolder(path.value));
      if (dir) { path.value = dir; await save(); }
    };
    const dpi = h('div', { class: 'seg small', role: 'group', 'aria-label': '解像度' },
      DPIS.map(([v, note]) => h('button', { type: 'button', 'aria-pressed': String(deps.getDpi() === v), onclick: () => { deps.setDpi(v); render(); } },
        `${v} dpi`, h('small', {}, note))));
    return sec('out', '保存とコピー',
      row('PNG の保存先', h('div', { class: 'row' }, path, btn('参照…', pick), btn('開く', () => act(() => backend.openFolder())))),
      row('解像度', dpi, h('p', { class: 'hint' }, '貼り付け先では、どの解像度でも決めた大きさ（mm）で貼られます。高いほど拡大してもきれいで、ファイルは大きくなります。')));
  }

  // ---------- 起動
  function startup() {
    const a = st.autostart || {};
    const sc = st.shortcut || {};
    const can = !!a.can;
    const toggle = h('input', { type: 'checkbox', id: 'setAutostart', role: 'switch', checked: !!a.on, disabled: !can });
    toggle.addEventListener('change', async () => {
      const r = await act(() => backend.setAutostart(toggle.checked), toggle.checked ? 'Windows 起動時に常駐します' : '常駐をやめました');
      if (r) st.autostart = r;
      render();
    });
    const links = (sc.links || []).length;
    return sec('start', '起動',
      row('常駐', h('label', { class: 'switch' }, toggle, h('span', {}, 'Windows 起動時に、通知領域（右下）に常駐する')),
        h('p', { class: 'hint' }, can ? '窓を閉じても通知領域に残ります。終了は通知領域のアイコンを右クリック。'
          : 'この PC へ写したアプリで開くと設定できます（配られた exe から一度開いてください）。')),
      row('ショートカット', h('div', { class: 'row' },
        h('span', { class: `state ${links ? 'ok' : 'off'}` }, links ? `✓ ${links} か所にあります` : '– まだありません'),
        st.info?.installed ? btn(links ? '作り直す' : 'デスクトップとスタートに作る', async () => {
          const r = await act(() => backend.shortcutMake(), (x) => (x.problems?.length ? `作れなかった所: ${x.problems.join('・')}` : 'ショートカットを作りました'));
          if (r) { st.shortcut = { ...sc, ask: false, links: r.made }; render(); deps.onChange?.(); }
        }) : null)));
  }

  // ---------- 更新
  function updates() {
    const u = st.update || {};
    const line = updateLine(u);
    const src = h('input', { type: 'text', id: 'setSource', value: st.updateSource || '', placeholder: st.updateSourceUsed || '例: \\\\server\\共有\\Releases', spellcheck: 'false', 'aria-label': '更新の置き場' });
    const probeOut = h('p', { class: 'hint', 'aria-live': 'polite' });
    const probe = async () => {
      probeOut.textContent = '確かめています…';
      const r = await act(() => backend.probeSource(src.value || st.updateSourceUsed || ''));
      probeOut.textContent = r ? `${r.ok ? '✓' : '!'} ${r.message}` : '';
      probeOut.className = `hint ${r?.ok ? 'ok' : 'warn'}`;
    };
    const saveSrc = async () => {
      const r = await act(() => backend.setSettings({ updateSource: src.value }), '更新の置き場を変えました。いま確かめています');
      if (r) st.updateSource = r.updateSource;
    };
    return sec('update', '更新',
      h('div', { class: `status ${line.tone}`, role: 'status' }, h('b', { 'aria-hidden': 'true' }, line.mark), h('span', {}, line.text),
        u.state === 'ready' ? btn('開き直して更新する', () => act(() => backend.updateApply()), 'btn small primary') : null),
      row('いまの版', h('span', {}, `${st.info?.version || '—'}`), u.checkedAt ? h('span', { class: 'hint' }, `確かめた時刻 ${u.checkedAt}`) : null,
        st.info?.installed ? btn('今すぐ確かめる', () => act(() => backend.updateCheck(), '確かめています')) : null),
      row('更新の置き場', h('div', { class: 'row' }, src, btn('確かめる', probe), btn('保存', saveSrc)), probeOut,
        h('p', { class: 'hint' }, '共有フォルダや BOX の、版を置くフォルダ。起動したとき・30 分ごとに確かめ、新しい版を裏で取り込みます。'
          + '「;」で区切って候補を複数書けます。空なら、配る入口から入れたときの場所を使います。')));
  }

  // ---------- 配布（配る人向け）
  function distribution() {
    const box = h('div', { class: 'dist' });
    const det = h('details', { class: 'set-more', id: 'setDistribution' }, h('summary', {}, '版を置く・配る版を選ぶ（配る人向け）'), box);
    det.addEventListener('toggle', () => { if (det.open && !release) loadRelease(box); });
    if (release) drawRelease(box);
    return sec('dist', '配布', det);
  }

  async function loadRelease(box) {
    fill(box, h('p', { class: 'hint' }, '置き場をたどっています…'));
    release = await act(() => backend.releaseView());
    drawRelease(box);
  }

  function drawRelease(box) {
    const r = release;
    if (!r) return fill(box, h('p', { class: 'hint warn' }, '置き場を読めませんでした。'));
    if (!r.reachable) return fill(box, h('p', { class: 'status warn' }, h('b', {}, '!'), h('span', {}, r.why || '置き場に届きません')),
      h('p', { class: 'hint' }, '先に「更新」の「更新の置き場」を決めてください。'));
    const dist = r.distributed?.version;
    const file = h('input', { type: 'file', accept: '.zip', hidden: true });
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f) return;
      releaseBusy = true;
      drawRelease(box);
      const res = await act(async () => backend.releasePlace(f.name, new Uint8Array(await f.arrayBuffer())), (x) => `版 ${x.version} を置きました（まだ配っていません）`);
      releaseBusy = false;
      if (res) release = await act(() => backend.releaseView());
      drawRelease(box);
    });
    const versionRow = (v) => {
      const on = v.version === dist;
      const choose = btn(on ? '配っています' : (dist && compareVersions(v.version, dist) < 0 ? 'この版に戻す' : 'この版を配る'), async () => {
        const res = await act(() => backend.releaseDistribute(v.version), (x) => (x.notes?.length ? x.notes.join(' ') : `版 ${x.version} を配りました`));
        if (res) { release = await act(() => backend.releaseView()); drawRelease(box); }
      }, on ? 'btn small' : 'btn small primary');
      choose.disabled = on || releaseBusy;
      let armed = 0;
      const del = btn('消す', async () => {
        if (!armed) { armed = setTimeout(() => { armed = 0; del.textContent = '消す'; }, 4000); del.textContent = 'もう一度押すと消す'; return; }
        clearTimeout(armed);
        const res = await act(() => backend.releaseRemove(v.version), `版 ${v.version} を消しました`);
        if (res) { release = await act(() => backend.releaseView()); drawRelease(box); }
      }, 'btn small quiet');
      del.disabled = on || releaseBusy;
      return h('tr', { class: on ? 'on' : '' },
        h('td', {}, h('b', {}, v.version), on ? h('span', { class: 'tag' }, '配布中') : null),
        h('td', {}, when(v.placedAt)), h('td', {}, [v.placedBy, v.placedPc].filter(Boolean).join('・')), h('td', { class: 'num' }, bytes(v.bytes)),
        h('td', { class: 'acts' }, choose, del));
    };
    const entry = r.entry?.path;
    fill(box,
      h('p', { class: 'hint' }, `置き場: ${r.found}${r.adjusted ? '（この PC での見え方に合わせて探しました）' : ''}`),
      h('div', { class: 'row' }, btn(releaseBusy ? '置いています…' : 'ZIP から版を置く…', () => file.click(), 'btn small'), file,
        h('span', { class: 'hint' }, 'GitHub の Releases の PonStamp-<版>-windows.zip を選びます。置いただけでは配りません。')),
      r.versions.length
        ? h('table', { class: 'versions' }, h('thead', {}, h('tr', {}, ['版', '置いた日', '置いた人', '大きさ', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, r.versions.map(versionRow)))
        : h('p', { class: 'hint' }, 'まだ版を置いていません。'),
      entry ? row('新しい PC へ', h('div', { class: 'row' }, h('code', {}, entry),
        btn('アドレスをコピー', () => act(() => navigator.clipboard.writeText(entry), 'アドレスをコピーしました'))),
        h('p', { class: 'hint' }, 'このアドレスを渡し、ダブルクリックしてもらうだけで、その PC に入ります。')) : null,
      r.problems?.length ? h('p', { class: 'hint warn' }, `読めない物: ${r.problems.join('・')}`) : null);
  }

  // ---------- このアプリについて
  function about() {
    const i = st.info || {};
    return sec('about', 'このアプリについて',
      row('版', h('span', {}, i.version || '—'), btn('更新履歴', () => deps.openHistory?.())),
      i.installed ? row('作業場所', h('code', {}, i.root || '')) : row('動き方', h('span', { class: 'hint' }, i.shell === 'browser' ? 'ブラウザで試しています（保存はダウンロード）' : 'この PC へ写さずに動いています')));
  }

  function render() {
    fill(root, output(), startup(), updates(), distribution(), about());
  }

  return {
    /** 起動のときの読み込み（backend.load の答え） */
    refresh(state) { st = { ...st, ...state }; render(); },
    setUpdate(u) { st.update = u; if (!root.contains(document.activeElement)) render(); },
    get state() { return st; },
  };
}

/**
 * 起動のときの知らせ（ショートカットを作るか・新しい版・写せなかった等）。root に並べる。
 * deps: { backend, toast(msg, err), onChange() }
 */
export function createNotices(root, deps) {
  const { backend, toast } = deps;
  let st = {};
  let hidden = new Set();

  const note = (id, tone, mark, text, ...actions) => (hidden.has(id) ? null
    : h('div', { class: `notice ${tone}`, role: 'status', dataset: { id } }, h('b', { 'aria-hidden': 'true' }, mark), h('span', {}, text), h('div', { class: 'acts' }, ...actions)));
  const btn = (text, onclick, cls = 'btn small') => h('button', { type: 'button', class: cls, onclick }, text);

  function render() {
    const u = st.update || {};
    fill(root,
      u.state === 'ready' ? note('update', 'info', '↑', `新しい版 ${u.ready} があります。開き直すと入れ替わります（いまの作業はそのまま覚えています）。`,
        btn('開き直して更新する', () => backend.updateApply().catch((e) => toast(e.message, true)), 'btn small primary'),
        btn('あとで', () => { hidden.add('update'); render(); }, 'btn small quiet')) : null,
      st.shortcut?.ask ? note('shortcut', 'info', '★', 'デスクトップとスタートに PonStamp のショートカットを作りますか？',
        btn('作る', async () => {
          try {
            await backend.shortcutMake();
            st.shortcut = { ...st.shortcut, ask: false };
            toast('ショートカットを作りました');
            render();
            deps.onChange?.();
          } catch (e) { toast(e.message, true); }
        }, 'btn small primary'),
        btn('今回は作らない', () => { hidden.add('shortcut'); render(); }, 'btn small quiet'),
        btn('今後たずねない', async () => { await backend.shortcutDecline().catch(() => {}); st.shortcut = { ...st.shortcut, ask: false }; render(); }, 'btn small quiet')) : null,
      (st.notes || []).map((t, i) => note(`n${i}`, 'warn', '!', t, btn('閉じる', () => { hidden.add(`n${i}`); render(); }, 'btn small quiet'))));
    root.hidden = !root.childElementCount;
  }

  return {
    refresh(state) { st = { ...st, ...state }; render(); },
    setUpdate(u) { st.update = u; render(); },
  };
}

/** 更新履歴（app/version.json）を読む */
export async function loadHistory() {
  try {
    const r = await fetch('version.json');
    return (await r.json()).changelog || [];
  } catch {
    return [];
  }
}
