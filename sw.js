/* 오프라인 캐시 서비스 워커 */
const CACHE = 'diary-v1.3.0';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/db.js',
  './js/settings.js',
  './js/drive.js',
  './js/config.js',
  './js/vendor/zip.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 네트워크 우선 + 캐시 대체.
   캐시 우선으로 하면 코드를 고쳐 배포해도 폰에서 옛 화면이 계속 보입니다.
   온라인이면 항상 최신을 받고, 오프라인이면 캐시로 동작합니다. */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;   // 구글 API 등 외부 요청은 건드리지 않음

  // cache:'no-cache' 를 줘야 브라우저 HTTP 캐시에 갇히지 않고
  // 서버에 변경 여부를 물어본다. 이게 없으면 배포해도 옛 화면이 남는다.
  e.respondWith(
    fetch(req, { cache: 'no-cache' })
      .then(res => {
        if (res && res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone));
        }
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(req);
        if (hit) return hit;
        if (req.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 504, statusText: 'offline' });
      })
  );
});
