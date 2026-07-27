// 구글 드라이브 백업/복원 (OAuth 토큰 플로우, drive.file 범위)
import * as S from './settings.js';
import { DEFAULT_CLIENT_ID, FOLDER_NAME } from './config.js';
import * as DB from './db.js';

const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const ENTRIES_FILE = 'entries.json';

let tokenClient = null;
let token = null;        // { access_token, exp }
let gisReady = null;

export function clientId() {
  return (S.get('clientId') || DEFAULT_CLIENT_ID || '').trim();
}
export function isConfigured() { return !!clientId(); }
/** 앱에 클라이언트 ID 가 내장돼 있는지 (사용자가 직접 입력한 게 아니라) */
export function hasBuiltInClientId() { return !!(DEFAULT_CLIENT_ID || '').trim(); }
export function isSignedIn() { return !!(token && token.exp > Date.now() + 30000); }

function loadGIS() {
  if (gisReady) return gisReady;
  gisReady = new Promise((res, rej) => {
    if (window.google?.accounts?.oauth2) return res();
    const s = document.createElement('script');
    s.src = GIS_SRC; s.async = true; s.defer = true;
    s.onload = () => res();
    s.onerror = () => rej(new Error('구글 로그인 스크립트를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.'));
    document.head.appendChild(s);
  });
  return gisReady;
}

function restoreToken() {
  try {
    const t = JSON.parse(sessionStorage.getItem('diary.gtok') || 'null');
    if (t && t.exp > Date.now() + 30000) token = t;
  } catch { /* ignore */ }
}
restoreToken();

async function ensureClient() {
  if (!isConfigured()) throw new Error('먼저 구글 OAuth 클라이언트 ID를 입력해 주세요.');
  await loadGIS();
  if (!tokenClient) {
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: SCOPES,
      callback: () => {},
    });
  }
  return tokenClient;
}

/** 액세스 토큰 확보. interactive=true 면 필요 시 로그인 창을 띄움 */
export async function auth(interactive = true) {
  if (isSignedIn()) return token.access_token;
  const tc = await ensureClient();
  return new Promise((res, rej) => {
    tc.callback = (r) => {
      if (r.error) return rej(new Error(r.error_description || r.error));
      token = { access_token: r.access_token, exp: Date.now() + (r.expires_in - 60) * 1000 };
      sessionStorage.setItem('diary.gtok', JSON.stringify(token));
      res(token.access_token);
    };
    try {
      tc.requestAccessToken({ prompt: interactive ? '' : 'none' });
    } catch (e) { rej(e); }
  });
}

export function signOut() {
  if (token?.access_token && window.google?.accounts?.oauth2) {
    try { google.accounts.oauth2.revoke(token.access_token, () => {}); } catch { /* ignore */ }
  }
  token = null;
  sessionStorage.removeItem('diary.gtok');
  S.setMany({ driveEmail: '', autoSync: false });
}

async function api(url, opts = {}) {
  const t = await auth(true);
  const headers = { ...(opts.headers || {}), Authorization: 'Bearer ' + t };
  let r = await fetch(url, { ...opts, headers });
  if (r.status === 401) {                     // 토큰 만료 → 재발급 후 1회 재시도
    token = null; sessionStorage.removeItem('diary.gtok');
    const t2 = await auth(true);
    r = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: 'Bearer ' + t2 } });
  }
  if (!r.ok) {
    let msg = r.status + ' ' + r.statusText;
    try { const j = await r.json(); msg = j.error?.message || msg; } catch { /* ignore */ }
    throw new Error('구글 드라이브 오류: ' + msg);
  }
  return r;
}

export async function fetchEmail() {
  const r = await api('https://www.googleapis.com/oauth2/v3/userinfo');
  const j = await r.json();
  if (j.email) S.set('driveEmail', j.email);
  return j.email || '';
}

/* ---------- 파일 조작 ---------- */
async function findFolder() {
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const r = await api(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`);
  const j = await r.json();
  return j.files?.[0]?.id || null;
}
async function ensureFolder() {
  let id = await DB.getMeta('driveFolderId');
  if (id) {
    try { await api(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,trashed`); return id; }
    catch { id = null; }
  }
  id = await findFolder();
  if (!id) {
    const r = await api('https://www.googleapis.com/drive/v3/files?fields=id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
    });
    id = (await r.json()).id;
  }
  await DB.setMeta('driveFolderId', id);
  return id;
}

async function listFiles(folderId) {
  const map = new Map();
  let pageToken = '';
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=nextPageToken,files(id,name,size)&pageSize=1000`
      + (pageToken ? `&pageToken=${pageToken}` : '');
    const j = await (await api(url)).json();
    (j.files || []).forEach(f => map.set(f.name, f));
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return map;
}

async function uploadNew(folderId, name, blob, mime) {
  const meta = { name, parents: [folderId] };
  const b = '===diary' + Math.random().toString(36).slice(2) + '===';
  const body = new Blob([
    `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n`,
    JSON.stringify(meta),
    `\r\n--${b}\r\nContent-Type: ${mime}\r\n\r\n`,
    blob,
    `\r\n--${b}--\r\n`,
  ]);
  const r = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${b}` },
    body,
  });
  return (await r.json()).id;
}
async function updateContent(fileId, blob, mime) {
  await api(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`, {
    method: 'PATCH',
    headers: { 'Content-Type': mime },
    body: blob,
  });
  return fileId;
}
async function download(fileId) {
  const r = await api(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
  return r.blob();
}

/* ---------- 병합 ---------- */
function mergeEntries(local, remote, tombstones) {
  const dead = new Set(tombstones.map(t => t.id));
  const byId = new Map();
  for (const e of remote) if (!dead.has(e.id)) byId.set(e.id, e);
  for (const e of local) {
    const r = byId.get(e.id);
    if (!r || (e.updatedAt || 0) >= (r.updatedAt || 0)) byId.set(e.id, e);
  }
  for (const id of dead) byId.delete(id);
  return [...byId.values()];
}

async function readRemoteBundle(files) {
  const f = files.get(ENTRIES_FILE);
  if (!f) return { entries: [], tombstones: [], catalog: null };
  try {
    const txt = await (await download(f.id)).text();
    const j = JSON.parse(txt);
    return { entries: j.entries || [], tombstones: j.tombstones || [], catalog: j.catalog || null };
  } catch {
    return { entries: [], tombstones: [], catalog: null };
  }
}

/** 루틴·D-DAY 카탈로그는 통째로 최신 수정본이 이긴다 */
function mergeCatalog(remoteCatalog) {
  const local = S.getCatalog();
  if (remoteCatalog && (remoteCatalog.catalogAt || 0) > (local.catalogAt || 0)) {
    S.saveCatalog(
      { routines: remoteCatalog.routines || [], ddays: remoteCatalog.ddays || [] },
      remoteCatalog.catalogAt
    );
    return { catalog: S.getCatalog(), changed: true };
  }
  return { catalog: local, changed: false };
}

/**
 * 동기화.
 * mode 'sync'    : 병합 후 드라이브에 업로드 + 로컬 반영 (기본 백업)
 * mode 'restore' : 드라이브 → 로컬만 반영 (업로드 안 함)
 * onProgress(text)
 */
export async function sync(mode = 'sync', onProgress = () => {}) {
  onProgress('구글 드라이브 연결 중…');
  await auth(true);
  if (!S.get('driveEmail')) { try { await fetchEmail(); } catch { /* 무시 */ } }

  const folderId = await ensureFolder();
  onProgress('백업 목록 확인 중…');
  const files = await listFiles(folderId);

  const localEntries = await DB.allEntries();
  const localTomb = await DB.getMeta('tombstones', []);
  const remote = await readRemoteBundle(files);

  const tombstones = dedupeTomb([...localTomb, ...remote.tombstones]);
  const merged = mergeEntries(localEntries, remote.entries, tombstones);
  const cat = mergeCatalog(remote.catalog);

  // 1) 원격 → 로컬 반영
  const localMap = new Map(localEntries.map(e => [e.id, e]));
  let added = 0, updated = 0;
  for (const e of merged) {
    const l = localMap.get(e.id);
    if (!l) { await DB.putEntry(e); added++; }
    else if ((e.updatedAt || 0) > (l.updatedAt || 0)) { await DB.putEntry(e); updated++; }
  }
  // 원격에서 삭제된 항목 로컬에도 반영
  const mergedIds = new Set(merged.map(e => e.id));
  let removed = 0;
  for (const l of localEntries) {
    if (!mergedIds.has(l.id)) { await DB.delEntry(l.id); removed++; }
  }
  await DB.setMeta('tombstones', tombstones);

  // 2) 필요한 사진 내려받기
  const havePhotos = new Set(await DB.allPhotoIds());
  const needed = new Set();
  merged.forEach(e => (e.photos || []).forEach(p => needed.add(p)));
  const toPull = [...needed].filter(p => !havePhotos.has(p) && files.has('p_' + p + '.jpg'));
  let pulled = 0;
  for (const pid of toPull) {
    onProgress(`사진 내려받는 중… ${++pulled}/${toPull.length}`);
    try {
      const blob = await download(files.get('p_' + pid + '.jpg').id);
      // 받은 것을 원본으로 두고 표시용·썸네일을 다시 만든다
      await DB.savePhotoFile(blob, pid, S.get('keepOriginal'));
      havePhotos.add(pid);
    } catch (e) { console.warn('사진 복원 실패', pid, e); }
  }

  let pushed = 0;
  if (mode === 'sync') {
    // 3) 새 사진 올리기
    const toPush = [...needed].filter(p => havePhotos.has(p) && !files.has('p_' + p + '.jpg'));
    for (const pid of toPush) {
      onProgress(`사진 올리는 중… ${++pushed}/${toPush.length}`);
      // 원본이 있으면 원본을 올린다. 다른 기기에서도 원본 화질로 받아볼 수 있게.
      const best = await DB.bestBlob(pid);
      if (!best?.blob) continue;
      await uploadNew(folderId, 'p_' + pid + '.jpg', best.blob, best.type || 'image/jpeg');
    }
    // 4) entries.json 올리기
    onProgress('일기 데이터 올리는 중…');
    const bundle = new Blob([JSON.stringify({
      version: 1, app: 'simple-diary', savedAt: new Date().toISOString(),
      entries: merged, tombstones, catalog: cat.catalog,
    })], { type: 'application/json' });
    const ex = files.get(ENTRIES_FILE);
    if (ex) await updateContent(ex.id, bundle, 'application/json');
    else await uploadNew(folderId, ENTRIES_FILE, bundle, 'application/json');

    // 5) 아무도 참조하지 않는 원격 사진 정리
    for (const [name, f] of files) {
      if (!name.startsWith('p_') || !name.endsWith('.jpg')) continue;
      const pid = name.slice(2, -4);
      if (!needed.has(pid)) {
        try { await api(`https://www.googleapis.com/drive/v3/files/${f.id}`, { method: 'DELETE' }); }
        catch { /* 무시 */ }
      }
    }
  }

  const now = Date.now();
  await DB.setMeta('lastSync', now);
  return { added, updated, removed, pulled, pushed, catalog: cat.changed, total: merged.length, at: now };
}

function dedupeTomb(list) {
  const m = new Map();
  for (const t of list) if (!m.has(t.id) || t.at > m.get(t.id).at) m.set(t.id, t);
  // 180일 지난 삭제 기록은 정리
  const cutoff = Date.now() - 180 * 864e5;
  return [...m.values()].filter(t => t.at > cutoff);
}

export async function markDeleted(id) {
  const list = await DB.getMeta('tombstones', []);
  list.push({ id, at: Date.now() });
  await DB.setMeta('tombstones', dedupeTomb(list));
}
