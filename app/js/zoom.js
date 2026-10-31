// 画面の文字の大きさ（画面全体の拡大。Windows の拡大・ブラウザの Ctrl＋＋と同じ動きで、押す所も一緒に大きくなる）。
//
// - 段は ZOOM_STEPS。上限は、拡大した後の画面が窓の最小の大きさ（MIN_VIEW）を下回らない所まで（下回ると縦に送りが出る）。
//   窓を狭めたら入る段に下げ、広げたら選んだ段に戻す
// - 倍率は CSS の zoom と変数 --zoom に入れる（100vh など窓の大きさで決める所は var(--zoom) で割る: style.css の .stage）
// - Ctrl＋＋（日本語の配列では Ctrl＋;）・Ctrl＋−・Ctrl＋0 でも変わる
// - この PC の画面の覚え（localStorage）。覚えられなくても使える

export const ZOOM_STEPS = [90, 100, 110, 125, 140];
/** 窓の最小の大きさ（desktop/src/main.rs の min_inner_size と同じ） */
const MIN_VIEW = { width: 900, height: 620 };
const KEY = 'ponstamp.zoom';

/** いまの窓で使える段（100 は必ず入る） */
export function zoomSteps(w = innerWidth, h = innerHeight) {
  const max = Math.floor(Math.min(w / MIN_VIEW.width, h / MIN_VIEW.height) * 100);
  return ZOOM_STEPS.filter((v) => v <= Math.max(100, max));
}

/**
 * onChange({ value: いまの倍率 %, steps: 使える段, capped: 窓が狭くて選んだ段より小さくしている・これ以上大きくできない }) を、変わるたびと最初に呼ぶ
 * → { value, set(%), step(±1) }
 */
export function createZoom(onChange = () => {}) {
  let want = 100;
  try { want = Number(localStorage.getItem(KEY)) || 100; } catch { /* 覚えられなくても使える */ }
  if (!ZOOM_STEPS.includes(want)) want = 100;
  let now = 0;
  const apply = () => {
    const steps = zoomSteps();
    const next = steps.includes(want) ? want : steps.filter((v) => v <= want).pop() || 100;
    const changed = next !== now;
    now = next;
    document.documentElement.style.zoom = String(now / 100);
    document.documentElement.style.setProperty('--zoom', String(now / 100));
    onChange({ value: now, steps, capped: now === steps.at(-1) && steps.at(-1) < ZOOM_STEPS.at(-1) });
    return changed;
  };
  const set = (v) => {
    want = v;
    try { localStorage.setItem(KEY, String(v)); } catch { /* 覚えられなくても使える */ }
    // 倍率が変わったら、窓の大きさで決める物（プレビューの細かさなど）を描き直させる
    if (apply()) dispatchEvent(new Event('resize'));
  };
  const step = (d) => {
    const steps = zoomSteps();
    const i = steps.indexOf(now);
    set(steps[Math.max(0, Math.min(steps.length - 1, (i < 0 ? steps.indexOf(100) : i) + d))]);
  };
  addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    if (e.key === '+' || e.key === ';' || e.key === '=') step(1);
    else if (e.key === '-') step(-1);
    else if (e.key === '0') set(100);
    else return;
    e.preventDefault();
  });
  addEventListener('resize', apply);
  apply();
  return { get value() { return now; }, set, step };
}
