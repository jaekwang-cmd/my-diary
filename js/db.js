// IndexedDB 저장소: 일기 / 사진 / 메타
const DB_NAME = 'simple-diary';
const DB_VER = 1;
let _db = null;

export function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('entries')) {
        const s = db.createObjectStore('entries', { keyPath: 'id' });
        s.createIndex('dt', 'dt');
        s.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('photos')) {
        db.createObjectStore('photos', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'k' });
      }
    };
    req.onsuccess = () => { _db = req.result; res(_db); };
    req.onerror = () => rej(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return openDB().then(db => db.transaction(store, mode).objectStore(store));
}
function wrap(req) {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

/* ---------- 일기 ---------- */
export const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID()
    : Date.now().toString(36) + Math.random().toString(36).slice(2, 10));

export async function allEntries() {
  const st = await tx('entries');
  const list = await wrap(st.getAll());
  // 최신순
  return list.sort((a, b) => (a.dt < b.dt ? 1 : a.dt > b.dt ? -1 : 0));
}
export async function getEntry(id) {
  const st = await tx('entries');
  return wrap(st.get(id));
}
export async function putEntry(e) {
  const st = await tx('entries', 'readwrite');
  await wrap(st.put(e));
  return e;
}
export async function delEntry(id) {
  const e = await getEntry(id);
  if (e?.photos?.length) for (const pid of e.photos) await delPhoto(pid);
  const st = await tx('entries', 'readwrite');
  return wrap(st.delete(id));
}
export async function countEntries() {
  const st = await tx('entries');
  return wrap(st.count());
}

/* ---------- 사진 ---------- */
export async function getPhoto(id) {
  const st = await tx('photos');
  return wrap(st.get(id));
}
export async function putPhoto(p) {
  const st = await tx('photos', 'readwrite');
  return wrap(st.put(p));
}
export async function delPhoto(id) {
  const st = await tx('photos', 'readwrite');
  return wrap(st.delete(id));
}
export async function allPhotoIds() {
  const st = await tx('photos');
  return wrap(st.getAllKeys());
}
export async function photoBytes() {
  const st = await tx('photos');
  const all = await wrap(st.getAll());
  return all.reduce((n, p) => n + (p.blob?.size || 0) + (p.thumb?.size || 0), 0);
}

/* ---------- 메타 (동기화 상태 등) ---------- */
export async function getMeta(k, dflt = null) {
  const st = await tx('meta');
  const r = await wrap(st.get(k));
  return r === undefined ? dflt : (r?.v ?? dflt);
}
export async function setMeta(k, v) {
  const st = await tx('meta', 'readwrite');
  return wrap(st.put({ k, v }));
}

export async function wipeAll() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction(['entries', 'photos', 'meta'], 'readwrite');
    t.objectStore('entries').clear();
    t.objectStore('photos').clear();
    t.objectStore('meta').clear();
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}

/* ---------- 이미지 처리 ---------- */
const MAX_EDGE = 1600;
const THUMB_EDGE = 320;

function drawTo(img, maxEdge, quality) {
  let { width: w, height: h } = img;
  const scale = Math.min(1, maxEdge / Math.max(w, h));
  w = Math.round(w * scale); h = Math.round(h * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise(res => c.toBlob(b => res({ blob: b, w, h }), 'image/jpeg', quality));
}

async function loadImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file); } catch (_) { /* fallthrough */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = url;
    });
  } finally { setTimeout(() => URL.revokeObjectURL(url), 3000); }
}

/** 파일/blob을 리사이즈해 저장하고 photo id 반환. forceId 주면 그 id로 저장(복원용) */
export async function savePhotoFile(file, forceId) {
  const img = await loadImage(file);
  const full = await drawTo(img, MAX_EDGE, 0.82);
  const th = await drawTo(img, THUMB_EDGE, 0.7);
  if (img.close) img.close();
  const id = forceId || uid();
  await putPhoto({ id, blob: full.blob, thumb: th.blob, w: full.w, h: full.h, at: Date.now() });
  return id;
}

const urlCache = new Map();
export async function photoURL(id, kind = 'thumb') {
  const key = id + ':' + kind;
  if (urlCache.has(key)) return urlCache.get(key);
  const p = await getPhoto(id);
  if (!p) return null;
  const url = URL.createObjectURL(kind === 'full' ? p.blob : (p.thumb || p.blob));
  urlCache.set(key, url);
  return url;
}
export function forgetPhotoURL(id) {
  for (const kind of ['thumb', 'full']) {
    const key = id + ':' + kind;
    if (urlCache.has(key)) { URL.revokeObjectURL(urlCache.get(key)); urlCache.delete(key); }
  }
}
