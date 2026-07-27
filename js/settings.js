// 설정값(localStorage) + 테마
export const THEMES = [
  { id: 'blue',      name: '심플 블루',  c: '#35C5CF' },
  { id: 'ocean',     name: '오션',      c: '#2E8BC0' },
  { id: 'sky',       name: '스카이',    c: '#3BA9F0' },
  { id: 'indigo',    name: '인디고',    c: '#5C6BC0' },
  { id: 'violet',    name: '바이올렛',  c: '#8E7CC3' },
  { id: 'lavender',  name: '라벤더',    c: '#A98BD8' },
  { id: 'rose',      name: '로즈',      c: '#EC5F8E' },
  { id: 'cherry',    name: '체리',      c: '#E2555B' },
  { id: 'coral',     name: '코랄',      c: '#FF7B6B' },
  { id: 'orange',    name: '오렌지',    c: '#F58634' },
  { id: 'amber',     name: '앰버',      c: '#EFA00B' },
  { id: 'lemon',     name: '레몬',      c: '#D4B012' },
  { id: 'lime',      name: '라임',      c: '#7CB342' },
  { id: 'forest',    name: '포레스트',  c: '#3E9E70' },
  { id: 'mint',      name: '민트',      c: '#3FB3A6' },
  { id: 'teal',      name: '틸',        c: '#159A8C' },
  { id: 'brown',     name: '브라운',    c: '#9C7B6B' },
  { id: 'gray',      name: '그레이',    c: '#7A8894' },
  { id: 'midnight',  name: '미드나잇',  c: '#455A64' },
];

// 처음 실행할 때 들어가는 기본 루틴
export const SEED_ROUTINES = [
  { id: 'r_gym',    name: '헬스',   emoji: '💪', color: '#EC5F8E', tag: '헬스' },
  { id: 'r_date',   name: '데이트', emoji: '❤️', color: '#F06292', tag: '데이트' },
  { id: 'r_study',  name: '공부',   emoji: '✏️', color: '#5C6BC0', tag: '공부' },
  { id: 'r_book',   name: '독서',   emoji: '📚', color: '#3E9E70', tag: '독서' },
  { id: 'r_walk',   name: '산책',   emoji: '🚶', color: '#3BA9F0', tag: '산책' },
  { id: 'r_drink',  name: '술',     emoji: '🍺', color: '#EFA00B', tag: '술' },
];

export const ROUTINE_EMOJIS = [
  '💪', '❤️', '✏️', '📚', '🚶', '🍺', '🏃', '🧘', '🎬', '🎮', '☕', '🍚',
  '🎸', '✈️', '🛒', '🧹', '💊', '😴', '🐶', '🎧', '💻', '🚭', '💰', '⛪',
];

const DEFAULTS = {
  theme: 'blue',
  appearance: 'system',   // system | light | dark
  font: 'md',             // sm | md | lg | xl
  lines: 4,
  weekStart: 0,           // 0=일, 1=월
  notify: false,
  notifyTime: '21:00',
  lockOn: false,
  pinHash: '',
  pinSalt: '',
  bioOn: false,
  bioCredId: '',
  autoSync: false,
  clientId: '',
  driveEmail: '',

  // ── 루틴 / D-DAY / 통계 ──
  routines: SEED_ROUTINES,          // [{id,name,emoji,color,tag}]
  ddays: [],                        // [{id,name,emoji,color,start,end}]
  catalogAt: 0,                     // 루틴·D-DAY 마지막 수정 시각 (기기 간 병합용)
  statsSections: { summary: true, counts: true, heatmap: true, dday: true },
  hiddenRoutines: [],               // 통계에서 뺄 루틴 id
};

const KEY = 'diary.settings';
let S = load();

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
export function get(k) { return S[k]; }
export function all() { return { ...S }; }
export function set(k, v) { S[k] = v; localStorage.setItem(KEY, JSON.stringify(S)); }
export function setMany(o) { Object.assign(S, o); localStorage.setItem(KEY, JSON.stringify(S)); }

export const FONT_SIZES = { sm: '14px', md: '16px', lg: '18px', xl: '20.5px' };
export const FONT_NAMES = { sm: '작게', md: '보통', lg: '크게', xl: '아주 크게' };
export const APPEARANCE_NAMES = { system: '시스템', light: '라이트', dark: '다크' };

function isDark() {
  const a = S.appearance;
  if (a === 'dark') return true;
  if (a === 'light') return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme() {
  const t = THEMES.find(x => x.id === S.theme) || THEMES[0];
  const root = document.documentElement;
  root.style.setProperty('--accent', t.c);
  root.style.setProperty('--lines', String(S.lines));
  // 화면 크기는 전부 rem 으로 잡혀 있으므로 html 의 font-size 를 바꿔야 실제로 반영된다.
  // (body 에 걸면 rem 기준이 그대로라 글자 크기 설정이 먹지 않는다)
  root.style.fontSize = FONT_SIZES[S.font] || FONT_SIZES.md;
  root.dataset.dark = isDark() ? '1' : '0';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isDark() ? '#15181c' : t.c);
}

window.matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', () => { if (S.appearance === 'system') applyTheme(); });

/* ---------- 루틴 / D-DAY 카탈로그 ---------- */
export function getCatalog() {
  return { routines: S.routines || [], ddays: S.ddays || [], catalogAt: S.catalogAt || 0 };
}
/** 카탈로그를 바꾸면 수정 시각을 올려 다른 기기와 병합할 수 있게 한다 */
export function saveCatalog({ routines, ddays }, stamp) {
  const o = {};
  if (routines) o.routines = routines;
  if (ddays) o.ddays = ddays;
  o.catalogAt = stamp || Date.now();
  setMany(o);
}
export function routineById(id) {
  return (S.routines || []).find(r => r.id === id) || null;
}
export function newId(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 9);
}

/** 일기에 실제로 걸린 루틴 id 목록 = 직접 고른 칩 + 본문 해시태그로 걸린 것 */
export function effectiveRoutines(entry) {
  const out = new Set(entry.routines || []);
  const tags = (entry.tags || []).map(t => t.toLowerCase());
  for (const r of (S.routines || [])) {
    const key = (r.tag || r.name || '').toLowerCase();
    if (key && tags.includes(key)) out.add(r.id);
  }
  return [...out];
}

/* ---------- 패스코드 해시 ---------- */
export async function hashPin(pin, salt) {
  const buf = new TextEncoder().encode(salt + '|' + pin + '|diary');
  const d = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function newSalt() {
  return [...crypto.getRandomValues(new Uint8Array(8))]
    .map(b => b.toString(16).padStart(2, '0')).join('');
}
