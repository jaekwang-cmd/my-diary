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
  root.style.setProperty('--fs', FONT_SIZES[S.font] || FONT_SIZES.md);
  root.style.setProperty('--lines', String(S.lines));
  root.dataset.dark = isDark() ? '1' : '0';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', isDark() ? '#15181c' : t.c);
}

window.matchMedia('(prefers-color-scheme: dark)')
  .addEventListener('change', () => { if (S.appearance === 'system') applyTheme(); });

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
