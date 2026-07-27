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
  let shown = 0, orig = 0;
  for (const p of all) {
    shown += (p.blob?.size || 0) + (p.thumb?.size || 0);
    orig += p.orig?.size || 0;
  }
  return { total: shown + orig, shown, orig };
}

/** 원본 보관을 껐을 때 이미 저장된 원본들을 지운다 */
export async function dropAllOriginals() {
  const st = await tx('photos', 'readwrite');
  const all = await wrap(st.getAll());
  let freed = 0;
  for (const p of all) {
    if (!p.orig) continue;
    freed += p.orig.size;
    delete p.orig; delete p.origType; delete p.origName; delete p.origSize;
    await wrap(st.put(p));
  }
  return freed;
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
// 화면 표시용 크기. 요즘 폰 화면(S26 울트라 등)에서 확대해도 뭉개지지 않도록 넉넉하게 잡는다.
const MAX_EDGE = 2560;
const QUALITY = 0.92;
const THUMB_EDGE = 400;

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

/**
 * 파일/blob을 리사이즈해 저장하고 photo id 반환.
 * - blob  : 화면 표시용 (최대 1600px)
 * - thumb : 목록용 (최대 320px)
 * - orig  : 원본 그대로. keepOriginal=false 면 저장하지 않음
 * forceId 를 주면 그 id 로 저장(복원용)
 */
export async function savePhotoFile(file, forceId, keepOriginal = true) {
  const img = await loadImage(file);
  const full = await drawTo(img, MAX_EDGE, QUALITY);
  const th = await drawTo(img, THUMB_EDGE, 0.72);
  if (img.close) img.close();
  const id = forceId || uid();

  const rec = { id, blob: full.blob, thumb: th.blob, w: full.w, h: full.h, at: Date.now() };
  if (keepOriginal) {
    // 줄인 것이 원본보다 크면(작은 사진) 원본을 따로 둘 이유가 없다
    const worth = file.size > full.blob.size * 1.15;
    if (worth) {
      rec.orig = file instanceof Blob ? file : new Blob([file]);
      rec.origType = file.type || 'image/jpeg';
      rec.origName = file.name || '';
      rec.origSize = file.size;
    }
  }
  await putPhoto(rec);
  return id;
}

/** 원본이 있으면 원본, 없으면 표시용 blob */
export async function bestBlob(id) {
  const p = await getPhoto(id);
  if (!p) return null;
  return {
    blob: p.orig || p.blob,
    type: p.orig ? (p.origType || 'image/jpeg') : 'image/jpeg',
    name: p.origName || '',
    isOriginal: !!p.orig,
    size: (p.orig || p.blob).size,
  };
}

const urlCache = new Map();
export async function photoURL(id, kind = 'thumb') {
  const key = id + ':' + kind;
  if (urlCache.has(key)) return urlCache.get(key);
  const p = await getPhoto(id);
  if (!p) return null;
  const pick = kind === 'orig' ? (p.orig || p.blob)
    : kind === 'full' ? p.blob
      : (p.thumb || p.blob);
  const url = URL.createObjectURL(pick);
  urlCache.set(key, url);
  return url;
}
export function forgetPhotoURL(id) {
  for (const kind of ['thumb', 'full', 'orig']) {
    const key = id + ':' + kind;
    if (urlCache.has(key)) { URL.revokeObjectURL(urlCache.get(key)); urlCache.delete(key); }
  }
}
