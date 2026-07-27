import * as DB from './db.js';
import * as S from './settings.js';
import * as Drive from './drive.js';

/* ================= 유틸 ================= */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DOW_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const DOW_KO = ['일', '월', '화', '수', '목', '금', '토'];

const pad = n => String(n).padStart(2, '0');
function nowDT() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function dtParts(dt) {
  const [ymd, hm] = String(dt).split('T');
  const [y, m, d] = ymd.split('-').map(Number);
  const [H, M] = (hm || '00:00').split(':').map(Number);
  return { y, m, d, H, M, ymd, hm: hm || '00:00', dow: new Date(y, m - 1, d).getDay() };
}
function fmtFull(dt) {
  const p = dtParts(dt);
  const ampm = p.H < 12 ? '오전' : '오후';
  const h12 = p.H % 12 === 0 ? 12 : p.H % 12;
  return `${p.y}년 ${p.m}월 ${p.d}일 (${DOW_KO[p.dow]}) ${h12}:${pad(p.M)} ${ampm}`;
}
const todayYMD = () => nowDT().slice(0, 10);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), 2300);
}
function spin(text) {
  $('#spinText').textContent = text || '';
  $('#spinWrap').classList.remove('hidden');
}
function spinText(t) { $('#spinText').textContent = t; }
function spinOff() { $('#spinWrap').classList.add('hidden'); }

function bytes(n) {
  if (!n) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  return (n / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}
function relTime(ts) {
  if (!ts) return '한 적 없음';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return Math.floor(s / 60) + '분 전';
  if (s < 86400) return Math.floor(s / 3600) + '시간 전';
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  window.navigator.standalone === true ||
  window.matchMedia('(display-mode: standalone)').matches;

/** 브라우저가 저장 공간을 함부로 비우지 않도록 요청.
    특히 아이폰 Safari는 오래 안 쓰면 데이터를 정리할 수 있다. */
async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}

function parseTags(text) {
  const set = new Set();
  (String(text).match(/#[^\s#.,!?()[\]{}<>"']{1,30}/g) || [])
    .forEach(t => set.add(t.slice(1)));
  return [...set];
}

/* ================= 내비게이션 스택 (안드로이드 뒤로가기) ================= */
const navStack = [];
function pushPage(closeFn) {
  navStack.push(closeFn);
  history.pushState({ depth: navStack.length }, '');
}
function closeTop() { history.back(); }
window.addEventListener('popstate', () => {
  const fn = navStack.pop();
  if (fn) fn();
});

/* ================= 상태 ================= */
let entries = [];
let editing = null;         // 편집 중 entry 객체
let calCursor = new Date(); // 달력 표시 월
let calSelected = todayYMD();

/* ================= 초기화 ================= */
init();

async function init() {
  S.applyTheme();
  await DB.openDB();

  // 미리보기용: 주소 뒤에 ?demo 를 붙이면 샘플 일기를 채워 넣는다
  if (/[?&]demo\b/.test(location.search)) {
    spin('샘플 데이터를 넣는 중…');
    try {
      const { loadDemo } = await import('./demo.js');
      const r = await loadDemo();
      spinOff();
      toast(r.skipped ? r.reason : `샘플 일기 ${r.count}건을 넣었습니다.`);
    } catch (e) { spinOff(); console.error(e); }
  }

  entries = await DB.allEntries();

  bindTabs();
  bindList();
  bindCalendar();
  bindEditor();
  bindViewer();
  bindSearch();
  bindSettings();
  bindStats();

  await maybeLock();

  renderList();
  renderCalendar();
  refreshSettings();
  scheduleNotify();
  registerSW();
  requestPersistentStorage();
  showIOSBannerIfNeeded();

  // 자동 백업: 앱 시작 시 1회 조용히
  if (S.get('autoSync') && Drive.isConfigured()) {
    setTimeout(() => quietSync(), 2500);
  }
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW 등록 실패', e));
}

/* ================= 탭 ================= */
function bindTabs() {
  $$('#tabbar .tab').forEach(b => b.onclick = () => showTab(b.dataset.tab));
  $('#btnJumpCal').onclick = () => showTab('cal');
}
function showTab(name) {
  $$('#tabbar .tab').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
  ['list', 'cal', 'stat', 'set'].forEach(n => $('#view-' + n).classList.toggle('hidden', n !== name));
  $('#fab').classList.toggle('hidden', name === 'set' || name === 'stat');
  if (name === 'set') refreshSettings();
  if (name === 'stat') renderStats();
}

/* ================= 리스트 ================= */
function bindList() {
  $('#fab').onclick = () => openEditor(null);
  $('#btnSearch').onclick = openSearch;
}

async function renderList() {
  const body = $('#listBody');
  $('#listEmpty').classList.toggle('hidden', entries.length > 0);
  body.innerHTML = '';
  let curMonth = '';
  for (const e of entries) {
    const mk = e.dt.slice(0, 7);
    if (mk !== curMonth) {
      curMonth = mk;
      const h = document.createElement('div');
      h.className = 'month-label';
      h.textContent = `${mk.slice(0, 4)}/${Number(mk.slice(5, 7))}`;
      body.appendChild(h);
    }
    body.appendChild(await entryCard(e));
  }
}

async function entryCard(e, highlight = '') {
  const p = dtParts(e.dt);
  const btn = document.createElement('button');
  btn.className = 'entry';
  const preview = e.body || '';
  btn.innerHTML = `
    <div class="e-date">
      <div class="e-dow">${DOW_EN[p.dow]}</div>
      <div class="e-day">${p.d}</div>
      <div class="e-time">${p.H}:${pad(p.M)}</div>
    </div>
    <div class="e-main">
      ${e.title ? `<p class="e-title">${hl(e.title, highlight)}</p>` : ''}
      <p class="e-body">${hl(preview, highlight)}</p>
      ${routineBadges(e)}
      ${e.tags?.length ? `<div class="e-tags">${e.tags.slice(0, 6).map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>` : ''}
    </div>`;
  if (e.photos?.length) {
    const img = document.createElement('img');
    img.className = 'e-thumb';
    const u = await DB.photoURL(e.photos[0]);
    if (u) img.src = u;
    btn.appendChild(img);
  }
  btn.onclick = () => openViewer(e.id);
  return btn;
}

function routineBadges(e) {
  const ids = S.effectiveRoutines(e);
  if (!ids.length) return '';
  const items = ids.map(id => S.routineById(id)).filter(Boolean);
  if (!items.length) return '';
  return `<div class="e-routines">${items.map(r =>
    `<span class="rbadge" style="--cc:${r.color}">${r.emoji || ''} ${esc(r.name)}</span>`).join('')}</div>`;
}

function hl(text, q) {
  const t = esc(text);
  if (!q) return t;
  try {
    const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    return t.replace(re, '<mark>$1</mark>');
  } catch { return t; }
}

/* ================= 달력 ================= */
function bindCalendar() {
  $('#calPrev').onclick = () => { calCursor.setMonth(calCursor.getMonth() - 1); renderCalendar(); };
  $('#calNext').onclick = () => { calCursor.setMonth(calCursor.getMonth() + 1); renderCalendar(); };
  $('#calToday').onclick = () => { calCursor = new Date(); calSelected = todayYMD(); renderCalendar(); };
  $('#calTitle').onclick = pickMonth;
}

async function renderCalendar() {
  const y = calCursor.getFullYear(), m = calCursor.getMonth();
  $('#calTitle').textContent = `${y}년 ${m + 1}월`;

  const ws = S.get('weekStart');
  const byDate = new Map();
  entries.forEach(e => {
    const k = e.dt.slice(0, 10);
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k).push(e);
  });

  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() - ws + 7) % 7));

  const g = $('#calGrid');
  g.innerHTML = '';
  const head = document.createElement('div');
  head.className = 'cal-row';
  for (let i = 0; i < 7; i++) {
    const d = (ws + i) % 7;
    const c = document.createElement('div');
    c.className = 'cal-dow' + (d === 0 ? ' sun' : d === 6 ? ' sat' : '');
    c.textContent = DOW_KO[d];
    head.appendChild(c);
  }
  g.appendChild(head);

  const today = todayYMD();
  for (let w = 0; w < 6; w++) {
    const row = document.createElement('div');
    row.className = 'cal-row';
    for (let i = 0; i < 7; i++) {
      const dd = new Date(start);
      dd.setDate(start.getDate() + w * 7 + i);
      const ymd = `${dd.getFullYear()}-${pad(dd.getMonth() + 1)}-${pad(dd.getDate())}`;
      const dow = dd.getDay();
      const cell = document.createElement('div');
      cell.className = 'cal-cell'
        + (dd.getMonth() !== m ? ' out' : '')
        + (dow === 0 ? ' sun' : dow === 6 ? ' sat' : '')
        + (ymd === today ? ' today' : '')
        + (ymd === calSelected ? ' sel' : '');
      cell.innerHTML = `<span>${dd.getDate()}</span>`;
      const list = byDate.get(ymd);
      if (list?.length) {
        const withPhoto = list.find(e => e.photos?.length);
        if (withPhoto) {
          const img = document.createElement('img');
          img.className = 'mini';
          DB.photoURL(withPhoto.photos[0]).then(u => { if (u) img.src = u; });
          cell.appendChild(img);
        } else {
          const dot = document.createElement('i');
          dot.className = 'dot';
          cell.appendChild(dot);
        }
      }
      cell.onclick = () => { calSelected = ymd; renderCalendar(); };
      row.appendChild(cell);
    }
    g.appendChild(row);
    const nx = new Date(start); nx.setDate(start.getDate() + (w + 1) * 7);
    if (nx.getMonth() !== m && w >= 4) break;
  }

  const p = dtParts(calSelected + 'T00:00');
  $('#calDayBar').textContent = `${p.y}년 ${p.m}월 ${p.d}일 (${DOW_KO[p.dow]})`;
  const dayList = $('#calDayList');
  dayList.innerHTML = '';
  const items = (byDate.get(calSelected) || []);
  $('#calEmpty').classList.toggle('hidden', items.length > 0);
  for (const e of items) dayList.appendChild(await entryCard(e));
}

function pickMonth() {
  const y = calCursor.getFullYear();
  const opts = [];
  for (let i = y + 1; i >= y - 6; i--) opts.push({ label: `${i}년`, value: i });
  openSheet({
    title: '연도 선택',
    options: opts.map(o => ({ ...o, on: o.value === y })),
    onPick: (v) => {
      calCursor.setFullYear(Number(v));
      closeTop();
      setTimeout(renderCalendar, 60);
    },
  });
}

/* ================= 에디터 ================= */
function bindEditor() {
  $('#edBack').onclick = () => closeTop();
  $('#edSave').onclick = saveEditor;
  $('#edPhoto').onclick = () => $('#filePick').click();
  $('#edDate').onclick = pickDateTime;
  // 본문에 #헬스 라고 쓰면 칩이 바로 켜지도록
  let chipTimer = null;
  const onType = () => {
    clearTimeout(chipTimer);
    chipTimer = setTimeout(() => { if (editing) renderRoutineChips(); }, 350);
  };
  $('#edBody').addEventListener('input', onType);
  $('#edTitle').addEventListener('input', onType);
  $('#filePick').onchange = async (ev) => {
    const files = [...ev.target.files];
    ev.target.value = '';
    if (!files.length || !editing) return;
    const target = editing;           // 처리 중 화면이 닫혀도 안전하게
    spin(files.length > 1 ? `사진 처리 중… 0/${files.length}` : '사진 처리 중…');
    try {
      let n = 0;
      for (const f of files) {
        if (!f.type.startsWith('image/')) continue;
        const id = await DB.savePhotoFile(f, null, S.get('keepOriginal'));
        if (editing !== target) { await DB.delPhoto(id); return; }
        target.photos.push(id);
        if (files.length > 1) spinText(`사진 처리 중… ${++n}/${files.length}`);
      }
      await renderEditorPhotos();
    } catch (e) {
      toast('사진을 불러오지 못했습니다.');
      console.error(e);
    } finally { spinOff(); }
  };
}

function openEditor(entry) {
  editing = entry
    ? { ...entry, photos: [...(entry.photos || [])], routines: [...(entry.routines || [])] }
    : { id: DB.uid(), dt: nowDT(), title: '', body: '', photos: [], routines: [], tags: [], createdAt: Date.now() };
  editing._orig = entry ? entry.photos || [] : [];
  $('#edTitle').value = editing.title || '';
  $('#edBody').value = editing.body || '';
  renderRoutineChips();
  $('#edDate').textContent = fmtFull(editing.dt);
  const page = $('#page-edit');
  page.classList.remove('hidden');
  pushPage(() => {
    page.classList.add('hidden');
    editing = null;
  });
  renderEditorPhotos();
  if (!entry) setTimeout(() => $('#edBody').focus(), 120);
}

async function renderEditorPhotos() {
  if (!editing) return;
  const box = $('#edPhotos');
  box.innerHTML = '';
  for (const pid of editing.photos) {
    const div = document.createElement('div');
    div.className = 'ph';
    const img = document.createElement('img');
    const u = await DB.photoURL(pid);
    if (u) img.src = u;
    const x = document.createElement('button');
    x.className = 'x'; x.textContent = '✕';
    x.onclick = () => {
      editing.photos = editing.photos.filter(p => p !== pid);
      renderEditorPhotos();
    };
    div.append(img, x);
    box.appendChild(div);
  }
}

/** 편집 화면의 루틴 칩. 본문에 #헬스 라고 쓰면 자동으로 켜진 상태로 보인다 */
function renderRoutineChips() {
  const box = $('#edRoutines');
  box.innerHTML = '';
  const list = S.get('routines') || [];
  const autoOn = new Set(S.effectiveRoutines({
    routines: [],
    tags: parseTags(($('#edTitle').value || '') + ' ' + ($('#edBody').value || '')),
  }));

  for (const r of list) {
    const picked = editing.routines.includes(r.id);
    const auto = autoOn.has(r.id) && !picked;
    const b = document.createElement('button');
    b.className = 'chip' + (picked || auto ? ' on' : '') + (auto ? ' auto' : '');
    b.style.setProperty('--cc', r.color);
    b.innerHTML = `<span class="em">${r.emoji || '·'}</span><span>${esc(r.name)}</span>`
      + (auto ? '<span class="auto-mark">#</span>' : '');
    b.title = auto ? '본문 해시태그로 자동 인식됨' : '';
    b.onclick = () => {
      if (auto) { toast(`본문의 #${r.tag || r.name} 로 이미 기록됩니다.`); return; }
      editing.routines = picked
        ? editing.routines.filter(x => x !== r.id)
        : [...editing.routines, r.id];
      renderRoutineChips();
    };
    box.appendChild(b);
  }

  const add = document.createElement('button');
  add.className = 'chip chip-add';
  add.textContent = list.length ? '+ 편집' : '+ 루틴 만들기';
  add.onclick = () => manageRoutines(() => renderRoutineChips());
  box.appendChild(add);
}

function pickDateTime() {
  const wrap = openSheetHTML(`
    <h3>날짜 · 시간</h3>
    <input type="datetime-local" id="dtIn" value="${esc(editing.dt)}">
    <div class="sheet-actions">
      <button class="btn-ghost" data-x="cancel">취소</button>
      <button class="btn-main" data-x="ok">확인</button>
    </div>`);
  wrap.querySelector('[data-x="cancel"]').onclick = () => closeTop();
  wrap.querySelector('[data-x="ok"]').onclick = () => {
    const v = wrap.querySelector('#dtIn').value;
    if (v) { editing.dt = v.slice(0, 16); $('#edDate').textContent = fmtFull(editing.dt); }
    closeTop();
  };
}

async function saveEditor() {
  const title = $('#edTitle').value.trim();
  const body = $('#edBody').value;
  if (!title && !body.trim() && !editing.photos.length) {
    toast('내용을 입력해 주세요.');
    return;
  }
  // 삭제된 사진 정리
  for (const old of editing._orig) {
    if (!editing.photos.includes(old)) { DB.forgetPhotoURL(old); await DB.delPhoto(old); }
  }
  const e = {
    id: editing.id,
    dt: editing.dt,
    date: editing.dt.slice(0, 10),
    title,
    body,
    photos: editing.photos,
    routines: editing.routines,
    tags: parseTags(title + ' ' + body),
    createdAt: editing.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  await DB.putEntry(e);
  entries = await DB.allEntries();
  closeTop();
  renderList(); renderCalendar();
  toast('저장했습니다.');
  autoSyncSoon();
}

/* ================= 상세 보기 ================= */
let viewingId = null;
function bindViewer() {
  $('#vwBack').onclick = () => closeTop();
  $('#vwEdit').onclick = async () => {
    const e = await DB.getEntry(viewingId);
    closeTop();
    setTimeout(() => openEditor(e), 80);
  };
  $('#vwDel').onclick = () => {
    confirmSheet({
      title: '이 일기를 삭제할까요?',
      desc: '삭제하면 되돌릴 수 없습니다.',
      okText: '삭제',
      danger: true,
      onOk: async () => {
        const id = viewingId;
        await DB.delEntry(id);
        await Drive.markDeleted(id);
        entries = await DB.allEntries();
        closeTop();          // 시트 닫기
        setTimeout(() => {
          closeTop();        // 상세 닫기
          renderList(); renderCalendar();
          toast('삭제했습니다.');
          autoSyncSoon();
        }, 60);
      },
    });
  };
  bindLightbox();
}

/* ---------- 사진 확대 뷰어 ---------- */
let lbId = null;
let lbScale = 1, lbTx = 0, lbTy = 0;

function lbApply(animate) {
  const im = $('#lbImg');
  im.style.transition = animate ? 'transform .18s ease' : 'none';
  im.style.transform = `translate(${lbTx}px, ${lbTy}px) scale(${lbScale})`;
}
function lbReset(animate) { lbScale = 1; lbTx = 0; lbTy = 0; lbApply(animate); }

/* 사진은 flex 로 가운데 놓여 있고 transform-origin 은 좌상단이다.
   그래서 화면 좌표 ↔ 사진 좌표를 옮길 때 가운데 정렬로 생긴 여백(base)을 빼줘야 한다. */
function lbGeom() {
  const im = $('#lbImg');
  const st = $('#lbStage').getBoundingClientRect();
  return {
    iw: im.clientWidth, ih: im.clientHeight,
    W: st.width, H: st.height,
    baseL: (st.width - im.clientWidth) / 2,
    baseT: (st.height - im.clientHeight) / 2,
  };
}

/** 확대 배율을 바꾸되 화면상 (px,py) 지점이 제자리에 머물게 한다 */
function lbZoomAt(newScale, px, py) {
  const s = Math.min(6, Math.max(1, newScale));
  const g = lbGeom();
  const k = s / lbScale;
  // 사진 좌상단의 화면상 위치를 기준으로 계산
  lbTx = (px - g.baseL) - (px - g.baseL - lbTx) * k;
  lbTy = (py - g.baseT) - (py - g.baseT - lbTy) * k;
  lbScale = s;
  lbClamp();
}

/** 확대한 사진이 화면 밖으로 빠져나가지 않게 잡아준다 */
function lbClamp() {
  const g = lbGeom();
  if (!g.iw || !g.ih) return;
  const sw = g.iw * lbScale, sh = g.ih * lbScale;
  // 화면보다 작으면 가운데로, 크면 화면을 덮는 범위 안에서만 이동 허용
  lbTx = sw <= g.W ? (g.W - sw) / 2 - g.baseL
    : Math.min(-g.baseL, Math.max(g.W - g.baseL - sw, lbTx));
  lbTy = sh <= g.H ? (g.H - sh) / 2 - g.baseT
    : Math.min(-g.baseT, Math.max(g.H - g.baseT - sh, lbTy));
}

async function openLightbox(pid, fallbackURL) {
  lbId = pid;
  const im = $('#lbImg');
  im.src = fallbackURL || '';
  lbReset(false);
  $('#lightbox').classList.remove('hidden');
  pushPage(() => { $('#lightbox').classList.add('hidden'); lbId = null; });

  // 확대해도 뭉개지지 않도록 원본이 있으면 원본으로 교체
  const best = await DB.bestBlob(pid);
  if (lbId !== pid) return;
  const orig = await DB.photoURL(pid, 'orig');
  if (lbId === pid && orig) im.src = orig;
  $('#lbInfo').innerHTML = best
    ? `<b>${best.isOriginal ? '원본' : '저장본'}</b>${bytes(best.size)}`
    : '';
  $('#lbShare').hidden = !(navigator.share && navigator.canShare);
}

function bindLightbox() {
  const lb = $('#lightbox'), stage = $('#lbStage'), im = $('#lbImg');

  $('#lbClose').onclick = (e) => { e.stopPropagation(); closeTop(); };
  $('#lbDown').onclick = (e) => { e.stopPropagation(); downloadPhoto(lbId); };
  $('#lbShare').onclick = (e) => { e.stopPropagation(); sharePhoto(lbId); };

  const pts = new Map();
  let startDist = 0, startScale = 1, startMid = null;
  let panFrom = null;
  let lastTap = 0, movedFar = false;

  stage.addEventListener('pointerdown', (ev) => {
    // 포인터 캡처가 실패해도 확대/이동 로직은 계속 동작해야 한다
    try { stage.setPointerCapture(ev.pointerId); } catch { /* 무시 */ }
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    movedFar = false;
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      startDist = Math.hypot(a.x - b.x, a.y - b.y);
      startScale = lbScale;
      startMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    } else if (pts.size === 1 && lbScale > 1) {
      panFrom = { x: ev.clientX - lbTx, y: ev.clientY - lbTy };
    }
  });

  stage.addEventListener('pointermove', (ev) => {
    if (!pts.has(ev.pointerId)) return;
    const prev = pts.get(ev.pointerId);
    if (Math.hypot(ev.clientX - prev.x, ev.clientY - prev.y) > 6) movedFar = true;
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (pts.size === 2 && startDist) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      lbZoomAt(startScale * (d / startDist), startMid.x, startMid.y);
      lbApply(false);
    } else if (pts.size === 1 && panFrom && lbScale > 1) {
      lbTx = ev.clientX - panFrom.x;
      lbTy = ev.clientY - panFrom.y;
      lbClamp();
      lbApply(false);
    }
  });

  const up = (ev) => {
    pts.delete(ev.pointerId);
    if (pts.size < 2) { startDist = 0; startMid = null; }
    if (pts.size === 0) {
      panFrom = null;
      if (!movedFar) {
        const now = Date.now();
        if (now - lastTap < 300) {           // 더블탭 → 확대/원래대로
          lastTap = 0;
          if (lbScale > 1.05) lbReset(true);
          else { lbZoomAt(2.6, ev.clientX, ev.clientY); lbApply(true); }
        } else {
          lastTap = now;
          setTimeout(() => {                  // 싱글탭 → 확대 안 된 상태면 닫기
            if (lastTap && Date.now() - lastTap >= 290 && lbScale <= 1.05 && lbId) closeTop();
          }, 300);
        }
      }
    }
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);

  // PC 에서는 휠로 확대
  lb.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    lbZoomAt(lbScale * (ev.deltaY < 0 ? 1.15 : 1 / 1.15), ev.clientX, ev.clientY);
    lbApply(false);
  }, { passive: false });

  im.addEventListener('dragstart', e => e.preventDefault());
}

function photoFileName(best, ext) {
  if (best?.name) return best.name;
  const d = new Date();
  return `일기사진_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
}

async function downloadPhoto(pid) {
  if (!pid) return;
  const best = await DB.bestBlob(pid);
  if (!best) { toast('사진을 찾을 수 없습니다.'); return; }
  const ext = (best.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  saveBlob(best.blob, photoFileName(best, ext));
  toast(best.isOriginal ? '원본 화질로 저장했습니다.' : '저장했습니다.');
}

async function sharePhoto(pid) {
  if (!pid) return;
  const best = await DB.bestBlob(pid);
  if (!best) return;
  const ext = (best.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
  const file = new File([best.blob], photoFileName(best, ext), { type: best.type });
  try {
    if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
    else toast('이 기기에서는 공유를 지원하지 않습니다.');
  } catch (e) { if (e.name !== 'AbortError') toast('공유하지 못했습니다.'); }
}

async function openViewer(id) {
  const e = await DB.getEntry(id);
  if (!e) return;
  viewingId = id;
  $('#vwDate').textContent = fmtFull(e.dt);
  const box = $('#vwScroll');
  box.innerHTML = `
    ${e.title ? `<h2 class="vw-title">${esc(e.title)}</h2>` : ''}
    ${routineBadges(e)}
    <p class="vw-body">${esc(e.body)}</p>
    <div class="vw-photos" id="vwPhotos"></div>
    ${e.tags?.length ? `<div class="vw-tags">${e.tags.map(t => `<span class="tag">#${esc(t)}</span>`).join('')}</div>` : ''}`;
  // 사진을 붙이기 전에 화면을 먼저 띄운다.
  // 숨겨진(display:none) 상태에서 이미지를 붙이면 로딩이 지연돼 빈 칸으로 남는다.
  const page = $('#page-view');
  page.classList.remove('hidden');
  pushPage(() => { page.classList.add('hidden'); viewingId = null; });

  const ph = $('#vwPhotos');
  for (const pid of (e.photos || [])) {
    if (viewingId !== id) return;          // 그 사이 화면이 닫혔으면 중단
    const img = document.createElement('img');
    const u = await DB.photoURL(pid, 'full');
    if (u) img.src = u;
    img.onclick = () => openLightbox(pid, u);
    ph.appendChild(img);
  }
}

/* ================= 검색 ================= */
function bindSearch() {
  $('#sBack').onclick = () => closeTop();
  $('#sClear').onclick = () => { $('#sInput').value = ''; runSearch(); };
  $('#sInput').oninput = runSearch;
}
function openSearch() {
  $('#sInput').value = '';
  renderTagBar();
  runSearch();
  const page = $('#page-search');
  page.classList.remove('hidden');
  pushPage(() => page.classList.add('hidden'));
  setTimeout(() => $('#sInput').focus(), 140);
}
function renderTagBar() {
  const count = new Map();
  entries.forEach(e => (e.tags || []).forEach(t => count.set(t, (count.get(t) || 0) + 1)));
  const top = [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24);
  const bar = $('#sTags');
  bar.innerHTML = '';
  top.forEach(([t]) => {
    const b = document.createElement('button');
    b.className = 'tag';
    b.textContent = '#' + t;
    b.onclick = () => { $('#sInput').value = '#' + t; runSearch(); };
    bar.appendChild(b);
  });
}
async function runSearch() {
  const q = $('#sInput').value.trim();
  const box = $('#sResults');
  box.innerHTML = '';
  if (!q) { $('#sFound').textContent = ''; return; }
  const lower = q.toLowerCase();
  const hits = entries.filter(e => {
    if (q.startsWith('#')) return (e.tags || []).some(t => t.toLowerCase().includes(lower.slice(1)));
    return (e.title + ' ' + e.body).toLowerCase().includes(lower);
  });
  $('#sFound').textContent = `${hits.length}건 찾았습니다`;
  for (const e of hits) box.appendChild(await entryCard(e, q.startsWith('#') ? q.slice(1) : q));
}

/* ================= 시트 ================= */
function openSheetHTML(html) {
  const wrap = $('#sheetWrap');
  $('#sheet').innerHTML = html;
  wrap.classList.remove('hidden');
  wrap.onclick = (ev) => { if (ev.target === wrap) closeTop(); };
  pushPage(() => wrap.classList.add('hidden'));
  return $('#sheet');
}
/** 이미 열린 시트의 내용만 교체 (뒤로가기 단계를 늘리지 않음) */
function setSheet(html) {
  $('#sheet').innerHTML = html;
  $('#sheet').scrollTop = 0;
  return $('#sheet');
}
const sheetIsOpen = () => !$('#sheetWrap').classList.contains('hidden');
function openSheet({ title, desc, options, onPick }) {
  const html = `
    ${title ? `<h3>${esc(title)}</h3>` : ''}
    ${desc ? `<p class="desc">${esc(desc)}</p>` : ''}
    ${options.map((o, i) => `
      <button class="opt ${o.on ? 'on' : ''} ${o.danger ? 'danger' : ''}" data-i="${i}">
        ${o.color ? `<span class="swatch" style="background:${o.color}"></span>` : ''}
        <span>${esc(o.label)}</span>
        ${o.on ? '<span class="chk">✓</span>' : ''}
      </button>`).join('')}`;
  const sheet = openSheetHTML(html);
  $$('.opt', sheet).forEach(b => b.onclick = () => onPick(options[+b.dataset.i].value));
}
function confirmSheet({ title, desc, okText = '확인', danger = false, onOk }) {
  const sheet = openSheetHTML(`
    <h3>${esc(title)}</h3>
    ${desc ? `<p class="desc">${esc(desc)}</p>` : ''}
    <div class="sheet-actions">
      <button class="btn-ghost" data-x="c">취소</button>
      <button class="${danger ? 'btn-danger' : 'btn-main'}" data-x="o">${esc(okText)}</button>
    </div>`);
  sheet.querySelector('[data-x="c"]').onclick = () => closeTop();
  sheet.querySelector('[data-x="o"]').onclick = () => onOk();
}
function inputSheet({ title, desc, value = '', placeholder = '', type = 'text', okText = '확인', onOk }) {
  const sheet = openSheetHTML(`
    <h3>${esc(title)}</h3>
    ${desc ? `<p class="desc">${desc}</p>` : ''}
    <input type="${type}" id="ipIn" value="${esc(value)}" placeholder="${esc(placeholder)}">
    <div class="sheet-actions">
      <button class="btn-ghost" data-x="c">취소</button>
      <button class="btn-main" data-x="o">${esc(okText)}</button>
    </div>`);
  sheet.querySelector('[data-x="c"]').onclick = () => closeTop();
  sheet.querySelector('[data-x="o"]').onclick = () => onOk(sheet.querySelector('#ipIn').value.trim());
  setTimeout(() => sheet.querySelector('#ipIn').focus(), 120);
}

/* ================= 설정 ================= */
function bindSettings() {
  $('#rowTheme').onclick = () => openSheet({
    title: '테마 컬러',
    options: S.THEMES.map(t => ({ label: t.name, value: t.id, color: t.c, on: t.id === S.get('theme') })),
    onPick: v => { S.set('theme', v); S.applyTheme(); closeTop(); refreshSettings(); },
  });
  $('#rowAppearance').onclick = () => openSheet({
    title: '화면 모드',
    options: Object.entries(S.APPEARANCE_NAMES).map(([k, n]) => ({ label: n, value: k, on: k === S.get('appearance') })),
    onPick: v => { S.set('appearance', v); S.applyTheme(); closeTop(); refreshSettings(); },
  });
  $('#rowFont').onclick = () => openSheet({
    title: '글자 크기',
    options: Object.entries(S.FONT_NAMES).map(([k, n]) => ({ label: n, value: k, on: k === S.get('font') })),
    onPick: v => { S.set('font', v); S.applyTheme(); closeTop(); refreshSettings(); },
  });
  $('#rowLines').onclick = () => openSheet({
    title: '리스트에 보이는 줄 수',
    options: [1, 2, 3, 4, 6, 8, 12].map(n => ({ label: n + '줄', value: n, on: n === S.get('lines') })),
    onPick: v => { S.set('lines', v); S.applyTheme(); closeTop(); refreshSettings(); },
  });
  $('#rowWeekStart').onclick = () => openSheet({
    title: '달력 시작 요일',
    options: [{ label: '일요일', value: 0 }, { label: '월요일', value: 1 }]
      .map(o => ({ ...o, on: o.value === S.get('weekStart') })),
    onPick: v => { S.set('weekStart', v); closeTop(); refreshSettings(); renderCalendar(); },
  });
  $('#rowNotifyTime').onclick = () => inputSheet({
    title: '알림 시각',
    type: 'time',
    value: S.get('notifyTime'),
    onOk: v => { if (v) S.set('notifyTime', v); closeTop(); refreshSettings(); scheduleNotify(); },
  });

  $('#swNotify').onchange = async (ev) => {
    if (ev.target.checked) {
      if (!('Notification' in window)) {
        ev.target.checked = false;
        toast(isIOS() && !isStandalone()
          ? '아이폰은 홈 화면에 추가한 뒤에만 알림을 쓸 수 있습니다.'
          : '이 브라우저는 알림을 지원하지 않습니다.');
        return;
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        ev.target.checked = false;
        toast('알림 권한이 거부되었습니다.');
        return;
      }
    }
    S.set('notify', ev.target.checked);
    refreshSettings();
    scheduleNotify();
  };

  $('#swLock').onchange = (ev) => {
    if (ev.target.checked) { ev.target.checked = false; setupPin(); }
    else {
      S.setMany({ lockOn: false, pinHash: '', pinSalt: '', bioOn: false, bioCredId: '' });
      refreshSettings();
      toast('잠금을 해제했습니다.');
    }
  };
  $('#swBio').onchange = async (ev) => {
    if (ev.target.checked) {
      const ok = await registerBiometric();
      ev.target.checked = ok;
      S.set('bioOn', ok);
    } else { S.setMany({ bioOn: false, bioCredId: '' }); }
    refreshSettings();
  };

  $('#rowDriveAuth').onclick = driveAuthTap;
  $('#rowDriveOut').onclick = () => confirmSheet({
    title: '구글 연결을 해제할까요?',
    desc: '이 기기에서 로그아웃합니다. 드라이브에 올려둔 백업은 지워지지 않습니다.',
    okText: '로그아웃',
    danger: true,
    onOk: () => {
      Drive.signOut();
      closeTop();
      refreshSettings();
      toast('로그아웃했습니다.');
    },
  });
  $('#rowBackup').onclick = () => runSync('sync');
  $('#rowRestore').onclick = () => confirmSheet({
    title: '드라이브에서 복원할까요?',
    desc: '드라이브의 일기를 현재 기기로 가져옵니다. 기기에만 있는 일기는 지워지지 않습니다.',
    okText: '복원',
    onOk: () => { closeTop(); setTimeout(() => runSync('restore'), 80); },
  });
  $('#swAutoSync').onchange = async (ev) => {
    if (ev.target.checked && !Drive.isConfigured()) {
      ev.target.checked = false;
      toast('먼저 구글 계정을 연결해 주세요.');
      return;
    }
    S.set('autoSync', ev.target.checked);
    if (ev.target.checked) runSync('sync');
  };

  $('#swKeepOrig').onchange = (ev) => {
    if (ev.target.checked) { S.set('keepOriginal', true); refreshSettings(); toast('앞으로 넣는 사진은 원본도 함께 보관합니다.'); return; }
    ev.target.checked = true;      // 확인 전까지는 켠 상태 유지
    confirmSheet({
      title: '원본 화질 보관을 끌까요?',
      desc: '이미 저장된 원본도 함께 지워집니다. 지우면 되돌릴 수 없고, 앞으로는 줄어든 화질로만 남습니다.',
      okText: '끄고 원본 삭제',
      danger: true,
      onOk: async () => {
        closeTop();
        spin('원본 정리 중…');
        const freed = await DB.dropAllOriginals();
        S.set('keepOriginal', false);
        spinOff();
        refreshSettings();
        toast(`원본을 지워 ${bytes(freed)} 확보했습니다.`);
      },
    });
  };

  $('#rowExport').onclick = doExport;
  $('#rowImport').onclick = doImport;
  $('#rowWipe').onclick = () => confirmSheet({
    title: '모든 데이터를 삭제할까요?',
    desc: '이 기기에 저장된 일기와 사진이 전부 지워집니다. 구글 드라이브 백업은 남아 있습니다.',
    okText: '전부 삭제',
    danger: true,
    onOk: async () => {
      await DB.wipeAll();
      entries = [];
      closeTop();
      renderList(); renderCalendar(); renderStats(); refreshSettings();
      toast('삭제했습니다. 루틴과 D-DAY는 그대로 있습니다.');
    },
  });
  $('#rowAbout').onclick = () => openSheetHTML(`
    <h3>추억 일기</h3>
    <p class="desc">
      설치형 웹앱(PWA)입니다. 홈 화면에 추가하면 앱처럼 실행됩니다.<br>
      일기는 이 기기 안에 저장되며, 구글 드라이브에 백업하면 다른 기기에서도 볼 수 있습니다.<br><br>
      version 1.4.0
    </p>
    <div class="sheet-actions"><button class="btn-main" data-x="ok">닫기</button></div>`)
    .querySelector('[data-x="ok"]').onclick = () => closeTop();
}

async function refreshSettings() {
  $('#vTheme').textContent = (S.THEMES.find(t => t.id === S.get('theme')) || S.THEMES[0]).name;
  $('#vAppearance').textContent = S.APPEARANCE_NAMES[S.get('appearance')];
  $('#vFont').textContent = S.FONT_NAMES[S.get('font')];
  $('#vLines').textContent = S.get('lines');
  $('#vWeekStart').textContent = S.get('weekStart') ? '월요일' : '일요일';
  $('#vNotifyTime').textContent = S.get('notifyTime');
  $('#swNotify').checked = S.get('notify');
  $('#rowNotifyTime').hidden = !S.get('notify');
  $('#swLock').checked = S.get('lockOn');
  $('#rowBio').hidden = !S.get('lockOn') || !window.PublicKeyCredential;
  $('#swBio').checked = S.get('bioOn');
  $('#swAutoSync').checked = S.get('autoSync');

  const configured = Drive.isConfigured();
  $('#vDriveUser').textContent = configured
    ? (S.get('driveEmail') || (Drive.isSignedIn() ? '연결됨' : '로그인 필요'))
    : '설정 필요';
  const linked = configured && !!S.get('driveEmail');
  $('#tDriveAuth').textContent = configured
    ? (linked ? '다른 계정으로 바꾸기' : '구글 계정 연결하기')
    : '구글 클라이언트 ID 입력하기';
  $('#rowDriveOut').hidden = !linked;
  $('#driveNote').innerHTML = configured
    ? '드라이브의 <b>' + esc('추억일기 백업') + '</b> 폴더에 저장됩니다. 다른 기기에서 같은 계정으로 연결하면 일기가 합쳐집니다.'
    : '연동하려면 구글 OAuth 클라이언트 ID가 필요합니다. 함께 만든 <b>SETUP.md</b> 파일의 순서를 따라 발급받으세요.';

  $('#swKeepOrig').checked = S.get('keepOriginal');
  $('#vLastSync').textContent = relTime(await DB.getMeta('lastSync', 0));
  $('#vCount').textContent = (await DB.countEntries()) + '건';
  const ph = await DB.photoBytes();
  $('#vStorage').textContent = ph.orig
    ? `${bytes(ph.total)} (원본 ${bytes(ph.orig)})`
    : bytes(ph.total);

  const persisted = await requestPersistentStorage();
  $('#vPersist').textContent =
    persisted === true ? '보호됨' : persisted === false ? '보호 안 됨' : '알 수 없음';

  const note = $('#iosNote');
  if (isIOS() && !isStandalone()) {
    note.hidden = false;
    note.innerHTML = '아이폰에서는 <b>공유 → 홈 화면에 추가</b> 로 설치해서 쓰시는 걸 권합니다. '
      + '설치하지 않고 Safari로만 열면, 오래 안 썼을 때 저장된 일기가 정리될 수 있습니다. '
      + '<b>자동 백업</b>을 켜두면 더 안전합니다.';
  } else if (persisted === false) {
    note.hidden = false;
    note.innerHTML = '브라우저가 저장 공간 보호를 아직 허용하지 않았습니다. '
      + '홈 화면에 추가하거나 <b>자동 백업</b>을 켜두시길 권합니다.';
  } else {
    note.hidden = true;
  }
}

/* ================= 구글 드라이브 ================= */
async function doGoogleLogin() {
  try {
    spin('구글 로그인 중…');
    await Drive.auth(true);
    await Drive.fetchEmail();
    spinOff();
    refreshSettings();
    toast('연결되었습니다.');
  } catch (e) { spinOff(); toast(e.message); }
}

function driveAuthTap() {
  // 클라이언트 ID 가 앱에 들어 있으면 사용자는 그런 게 있는지도 몰라야 한다.
  // 연결 전이면 곧장 구글 로그인 창으로 보낸다.
  if (!Drive.isConfigured()) return askClientId();
  if (!S.get('driveEmail')) return doGoogleLogin();

  const opts = [
    { label: '다른 구글 계정으로 바꾸기', value: 'login' },
    { label: '연결 해제', value: 'out', danger: true },
  ];
  if (!Drive.hasBuiltInClientId()) opts.push({ label: '클라이언트 ID 다시 입력', value: 'id' });
  openSheet({
    title: '구글 드라이브',
    desc: S.get('driveEmail') || '',
    options: opts,
    onPick: async (v) => {
      closeTop();
      await new Promise(r => setTimeout(r, 80));
      if (v === 'id') return askClientId();
      if (v === 'out') { Drive.signOut(); refreshSettings(); toast('연결을 해제했습니다.'); return; }
      doGoogleLogin();
    },
  });
}

function askClientId() {
  inputSheet({
    title: '구글 OAuth 클라이언트 ID',
    desc: 'Google Cloud Console에서 발급받은 값을 붙여넣으세요.<br><code>...apps.googleusercontent.com</code> 으로 끝납니다.',
    value: S.get('clientId'),
    placeholder: '000000-xxxx.apps.googleusercontent.com',
    okText: '저장',
    onOk: (v) => {
      S.set('clientId', v);
      closeTop();
      refreshSettings();
      if (v) toast('저장했습니다. 이제 계정을 연결해 주세요.');
    },
  });
}

async function runSync(mode) {
  if (!Drive.isConfigured()) { askClientId(); return; }
  try {
    spin('준비 중…');
    const r = await Drive.sync(mode, spinText);
    entries = await DB.allEntries();
    spinOff();
    renderList(); renderCalendar(); renderStats(); refreshSettings();
    const bits = [];
    if (r.added) bits.push(`새 일기 ${r.added}건`);
    if (r.updated) bits.push(`갱신 ${r.updated}건`);
    if (r.pulled) bits.push(`사진 ${r.pulled}장 받음`);
    if (r.pushed) bits.push(`사진 ${r.pushed}장 올림`);
    if (r.catalog) bits.push('루틴 · D-DAY 갱신');
    toast(bits.length ? bits.join(' · ') : (mode === 'sync' ? '백업 완료 (변경 없음)' : '이미 최신입니다'));
  } catch (e) {
    spinOff();
    toast(e.message || '동기화에 실패했습니다.');
    console.error(e);
  }
}

let syncTimer = null;
function autoSyncSoon() {
  if (!S.get('autoSync') || !Drive.isConfigured()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(quietSync, 8000);
}
async function quietSync() {
  try {
    await Drive.sync('sync', () => {});
    entries = await DB.allEntries();
    renderList(); renderCalendar(); renderStats(); refreshSettings();
  } catch (e) { console.warn('자동 백업 실패', e.message); }
}

/* ================= 내보내기 / 가져오기 ================= */
function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 60).trim() || '무제';
}

async function doExport() {
  try {
    spin('내보내는 중…');
    const list = await DB.allEntries();
    const files = [];
    const usedPhotos = new Set();

    for (const e of list) {
      (e.photos || []).forEach(p => usedPhotos.add(p));
      const rNames = S.effectiveRoutines(e).map(id => S.routineById(id)).filter(Boolean)
        .map(r => `${r.emoji || ''} ${r.name}`).join(', ');
      const md = [
        `# ${e.title || '(제목 없음)'}`,
        '',
        fmtFull(e.dt),
        ...(rNames ? ['', `루틴: ${rNames}`] : []),
        '',
        e.body || '',
        '',
        ...(e.photos || []).map(p => `![사진](../사진/p_${p}.jpg)`),
      ].join('\n');
      files.push({ name: `일기/${e.dt.slice(0, 10)}_${safeName(e.title)}.md`, data: md });
    }

    let i = 0;
    for (const pid of usedPhotos) {
      spinText(`사진 담는 중… ${++i}/${usedPhotos.size}`);
      const best = await DB.bestBlob(pid);          // 원본이 있으면 원본으로
      if (best?.blob) files.push({ name: `사진/p_${pid}.jpg`, data: best.blob });
    }

    files.push({
      name: 'backup.json',
      data: JSON.stringify({
        version: 1, app: 'simple-diary', exportedAt: new Date().toISOString(),
        entries: list, tombstones: await DB.getMeta('tombstones', []),
        catalog: S.getCatalog(),
      }, null, 1),
    });

    spinText('압축 중…');
    const zip = await ZipKit.makeZip(files);
    const d = new Date();
    saveBlob(zip, `추억일기_백업_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.zip`);
    spinOff();
    toast('내보내기 완료');
  } catch (e) {
    spinOff(); toast('내보내기에 실패했습니다.'); console.error(e);
  }
}

function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

function doImport() {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = '.zip,.json,application/zip,application/json';
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    try {
      spin('읽는 중…');
      let bundle = null;
      const photos = [];
      if (f.name.toLowerCase().endsWith('.zip')) {
        const items = await ZipKit.readZip(f);
        for (const it of items) {
          if (!it.blob) continue;
          if (it.name.endsWith('backup.json')) bundle = JSON.parse(await it.blob.text());
          else if (/사진\/p_(.+)\.jpg$/.test(it.name)) {
            photos.push({ id: it.name.match(/p_(.+)\.jpg$/)[1], blob: it.blob });
          }
        }
      } else {
        bundle = JSON.parse(await f.text());
      }
      if (!bundle?.entries) throw new Error('백업 데이터를 찾을 수 없습니다.');

      const have = new Set(await DB.allPhotoIds());
      let n = 0;
      for (const p of photos) {
        if (have.has(p.id)) continue;
        spinText(`사진 복원 중… ${++n}/${photos.length}`);
        await DB.savePhotoFile(p.blob, p.id, S.get('keepOriginal'));
      }

      spinText('일기 합치는 중…');
      const local = await DB.allEntries();
      const map = new Map(local.map(e => [e.id, e]));
      let added = 0, updated = 0;
      for (const e of bundle.entries) {
        const cur = map.get(e.id);
        if (!cur) { await DB.putEntry(e); added++; }
        else if ((e.updatedAt || 0) > (cur.updatedAt || 0)) { await DB.putEntry(e); updated++; }
      }
      // 루틴 · D-DAY 카탈로그도 최신 것으로
      let catMsg = '';
      const rc = bundle.catalog;
      if (rc && (rc.catalogAt || 0) > (S.getCatalog().catalogAt || 0)) {
        S.saveCatalog({ routines: rc.routines || [], ddays: rc.ddays || [] }, rc.catalogAt);
        catMsg = ' · 루틴/D-DAY 복원';
      }

      entries = await DB.allEntries();
      spinOff();
      renderList(); renderCalendar(); renderStats(); refreshSettings();
      toast(`가져오기 완료 · 새 일기 ${added}건, 갱신 ${updated}건${catMsg}`);
    } catch (e) {
      spinOff(); toast(e.message || '가져오기에 실패했습니다.'); console.error(e);
    }
  };
  inp.click();
}

/* ================= 통계 ================= */
let statCursor = new Date();

function bindStats() {
  $('#statPrev').onclick = () => { statCursor.setMonth(statCursor.getMonth() - 1); renderStats(); };
  $('#statNext').onclick = () => { statCursor.setMonth(statCursor.getMonth() + 1); renderStats(); };
  $('#statTitle').onclick = () => { statCursor = new Date(); renderStats(); };
  $('#statCfg').onclick = statsConfigSheet;
  $('#rowStatCfg').onclick = statsConfigSheet;
  $('#rowManageRoutine').onclick = () => manageRoutines(() => renderStats());
  $('#rowManageDday').onclick = () => manageDdays(() => renderStats());
}

/* 날짜 계산 (시차·서머타임 영향 없게 UTC 기준으로) */
function ymdToUTC(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}
function diffDays(a, b) { return Math.round((ymdToUTC(b) - ymdToUTC(a)) / 86400000); }
function fmtYMD(s) {
  const [y, m, d] = String(s).split('-');
  return `${y}.${Number(m)}.${Number(d)}`;
}
function shiftYMD(s, n) {
  const d = new Date(ymdToUTC(s) + n * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function visibleRoutines() {
  const hidden = new Set(S.get('hiddenRoutines') || []);
  return (S.get('routines') || []).filter(r => !hidden.has(r.id));
}

function renderStats() {
  const y = statCursor.getFullYear(), m = statCursor.getMonth();
  const mk = `${y}-${pad(m + 1)}`;
  $('#statTitle').textContent = `${y}년 ${m + 1}월`;
  const sec = S.get('statsSections') || {};
  const monthEntries = entries.filter(e => e.dt.slice(0, 7) === mk);

  renderStatSummary(sec.summary !== false, monthEntries);
  renderStatCounts(sec.counts !== false, monthEntries);
  renderStatHeatmap(sec.heatmap !== false, y, m);
  renderStatDday(sec.dday !== false);

  $('#vRoutineCount').textContent = (S.get('routines') || []).length + '개';
  $('#vDdayCount').textContent = (S.get('ddays') || []).length + '개';
}

function renderStatSummary(show, monthEntries) {
  const box = $('#statSummary');
  if (!show) { box.innerHTML = ''; return; }
  const days = new Set(monthEntries.map(e => e.dt.slice(0, 10))).size;
  const photos = monthEntries.reduce((n, e) => n + (e.photos?.length || 0), 0);

  // 오늘(또는 어제)부터 거꾸로 이어진 작성 일수
  const written = new Set(entries.map(e => e.dt.slice(0, 10)));
  let cur = todayYMD(), streak = 0;
  if (!written.has(cur)) cur = shiftYMD(cur, -1);
  while (written.has(cur)) { streak++; cur = shiftYMD(cur, -1); }

  box.innerHTML = `
    <div class="tiles">
      <div class="tile"><b>${days}</b><span>이번 달 쓴 날</span></div>
      <div class="tile"><b>${streak}</b><span>연속 기록</span></div>
      <div class="tile"><b>${photos}</b><span>사진</span></div>
    </div>`;
}

function renderStatCounts(show, monthEntries) {
  const box = $('#statCounts');
  const list = visibleRoutines();
  if (!show || !list.length) { box.innerHTML = ''; return; }

  const cnt = new Map(), dayset = new Map();
  for (const e of monthEntries) {
    for (const id of S.effectiveRoutines(e)) {
      cnt.set(id, (cnt.get(id) || 0) + 1);
      if (!dayset.has(id)) dayset.set(id, new Set());
      dayset.get(id).add(e.dt.slice(0, 10));
    }
  }
  const max = Math.max(1, ...list.map(r => cnt.get(r.id) || 0));
  const rows = list.map(r => {
    const n = cnt.get(r.id) || 0;
    const d = dayset.get(r.id)?.size || 0;
    return `<div class="barrow" style="--cc:${r.color}">
      <span class="em">${r.emoji || '·'}</span>
      <span class="nm">${esc(r.name)}</span>
      <span class="track"><span class="fill" style="width:${(n / max) * 100}%"></span></span>
      <span class="cnt">${n}번<br><s>${d}일</s></span>
    </div>`;
  }).join('');
  box.innerHTML = `<div class="sec-label">이번 달 루틴</div><div class="barlist">${rows}</div>`;
}

function renderStatHeatmap(show, y, m) {
  const box = $('#statHeatmap');
  const list = visibleRoutines();
  if (!show || !list.length) { box.innerHTML = ''; return; }

  const byDay = new Map();
  for (const e of entries) {
    const d = e.dt.slice(0, 10);
    if (d.slice(0, 7) !== `${y}-${pad(m + 1)}`) continue;
    if (!byDay.has(d)) byDay.set(d, new Set());
    S.effectiveRoutines(e).forEach(id => byDay.get(d).add(id));
  }
  const colorOf = new Map(list.map(r => [r.id, r.color]));

  const ws = S.get('weekStart');
  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(1 - ((first.getDay() - ws + 7) % 7));

  let html = '<div class="heat-row">';
  for (let i = 0; i < 7; i++) html += `<div class="heat-dow">${DOW_KO[(ws + i) % 7]}</div>`;
  html += '</div>';

  for (let w = 0; w < 6; w++) {
    let row = '';
    let anyIn = false;
    for (let i = 0; i < 7; i++) {
      const dd = new Date(start);
      dd.setDate(start.getDate() + w * 7 + i);
      const key = `${dd.getFullYear()}-${pad(dd.getMonth() + 1)}-${pad(dd.getDate())}`;
      const out = dd.getMonth() !== m;
      if (!out) anyIn = true;
      const ids = [...(byDay.get(key) || [])].filter(id => colorOf.has(id)).slice(0, 4);
      row += `<div class="heat-cell ${out ? 'out' : ''} ${ids.length ? 'hasday' : ''}">
        <span>${dd.getDate()}</span>
        <span class="dots">${ids.map(id => `<i style="--cc:${colorOf.get(id)}"></i>`).join('')}</span>
      </div>`;
    }
    if (!anyIn) break;
    html += `<div class="heat-row">${row}</div>`;
  }
  box.innerHTML = `<div class="sec-label">루틴 달력</div><div class="heat">${html}</div>`;
}

function ddayText(d) {
  const today = todayYMD();
  if (d.end) {
    const total = diffDays(d.start, d.end) + 1;
    return { big: `총 ${total}일`, sub: `${fmtYMD(d.start)} ~ ${fmtYMD(d.end)}`, chip: '종료', done: true };
  }
  const n = diffDays(d.start, today);
  if (n >= 0) return { big: `D+${n}`, sub: `${fmtYMD(d.start)}부터 · ${n + 1}일째`, chip: '진행 중', done: false };
  return { big: `D${n}`, sub: `${fmtYMD(d.start)} 시작 예정`, chip: '예정', done: false };
}

function renderStatDday(show) {
  const box = $('#statDday');
  const list = S.get('ddays') || [];
  if (!show) { box.innerHTML = ''; return; }
  if (!list.length) {
    box.innerHTML = `<div class="sec-label">D-DAY</div>
      <button class="mini-add" id="ddAddEmpty">+ D-DAY 만들기 (연애·금연·기념일…)</button>`;
    $('#ddAddEmpty').onclick = () => manageDdays(() => renderStats(), true);
    return;
  }
  const sorted = [...list].sort((a, b) => (a.end ? 1 : 0) - (b.end ? 1 : 0) || (a.start < b.start ? 1 : -1));
  box.innerHTML = `<div class="sec-label">D-DAY</div><div class="dday-list">${sorted.map(d => {
    const t = ddayText(d);
    return `<button class="dcard ${t.done ? 'done' : ''}" data-id="${d.id}" style="--cc:${d.color}">
      <span class="dchip">${t.chip}</span>
      <span class="dn">${d.emoji || '📌'} ${esc(d.name)}</span>
      <div class="dbig">${t.big}</div>
      <div class="dsub">${t.sub}</div>
    </button>`;
  }).join('')}</div>
  <button class="mini-add" id="ddAdd">+ D-DAY 추가</button>`;
  $$('#statDday .dcard').forEach(b => b.onclick = () => {
    const d = (S.get('ddays') || []).find(x => x.id === b.dataset.id);
    if (d) editDday(d, () => renderStats());
  });
  $('#ddAdd').onclick = () => manageDdays(() => renderStats(), true);
}

/* ---------- 통계 표시 항목 ---------- */
function statsConfigSheet() {
  const SECTIONS = [
    ['summary', '요약 (쓴 날 · 연속 기록 · 사진)'],
    ['counts', '이번 달 루틴 횟수'],
    ['heatmap', '루틴 달력'],
    ['dday', 'D-DAY'],
  ];
  const draw = () => {
    const sec = S.get('statsSections') || {};
    const hidden = new Set(S.get('hiddenRoutines') || []);
    const routines = S.get('routines') || [];
    const html = `
      <h3>통계 표시 항목</h3>
      <p class="desc">보고 싶지 않은 항목을 꺼두면 통계 화면에서 사라집니다.</p>
      ${SECTIONS.map(([k, label]) =>
        `<button class="opt ${sec[k] !== false ? 'on' : ''}" data-sec="${k}">
           <span>${label}</span>${sec[k] !== false ? '<span class="chk">✓</span>' : '<span class="chk" style="opacity:.35">숨김</span>'}
         </button>`).join('')}
      ${routines.length ? `<div class="field-label">통계에 넣을 루틴</div>` : ''}
      ${routines.map(r =>
        `<button class="opt ${!hidden.has(r.id) ? 'on' : ''}" data-rt="${r.id}">
           <span class="swatch" style="background:${r.color}"></span>
           <span>${r.emoji || ''} ${esc(r.name)}</span>
           ${!hidden.has(r.id) ? '<span class="chk">✓</span>' : '<span class="chk" style="opacity:.35">숨김</span>'}
         </button>`).join('')}
      <div class="sheet-actions"><button class="btn-main" data-x="ok">완료</button></div>`;
    const s = sheetIsOpen() ? setSheet(html) : openSheetHTML(html);
    $$('[data-sec]', s).forEach(b => b.onclick = () => {
      const cur = { ...(S.get('statsSections') || {}) };
      cur[b.dataset.sec] = cur[b.dataset.sec] === false;
      S.set('statsSections', cur);
      renderStats(); draw();
    });
    $$('[data-rt]', s).forEach(b => b.onclick = () => {
      const h = new Set(S.get('hiddenRoutines') || []);
      h.has(b.dataset.rt) ? h.delete(b.dataset.rt) : h.add(b.dataset.rt);
      S.set('hiddenRoutines', [...h]);
      renderStats(); draw();
    });
    s.querySelector('[data-x="ok"]').onclick = () => closeTop();
  };
  draw();
}

/* ---------- 루틴 카탈로그 ---------- */
function manageRoutines(onDone = () => {}) {
  const draw = () => {
    const list = S.get('routines') || [];
    const html = `
      <h3>루틴 카탈로그</h3>
      <p class="desc">일기 쓸 때 탭해서 붙일 수 있습니다.<br>본문에 <b>#이름</b> 을 써도 자동으로 기록됩니다.</p>
      ${list.map(r => `
        <button class="mrow" data-id="${r.id}">
          <span class="em">${r.emoji || '·'}</span>
          <span class="nm">${esc(r.name)}<span class="sub">#${esc(r.tag || r.name)} 로도 인식</span></span>
          <span class="dot-c" style="--cc:${r.color}"></span>
        </button>`).join('')
      || '<p class="desc">아직 루틴이 없습니다.</p>'}
      <div class="sheet-actions">
        <button class="btn-ghost" data-x="add">+ 새 루틴</button>
        <button class="btn-main" data-x="ok">완료</button>
      </div>`;
    const s = sheetIsOpen() ? setSheet(html) : openSheetHTML(html);
    $$('.mrow', s).forEach(b => b.onclick = () => {
      const r = (S.get('routines') || []).find(x => x.id === b.dataset.id);
      editRoutine(r, draw, onDone);
    });
    s.querySelector('[data-x="add"]').onclick = () => editRoutine(null, draw, onDone);
    s.querySelector('[data-x="ok"]').onclick = () => closeTop();
  };
  draw();
}

function editRoutine(routine, back, onDone) {
  const isNew = !routine;
  let draft = routine
    ? { ...routine }
    : { id: S.newId('r'), name: '', emoji: '💪', color: S.THEMES[0].c, tag: '' };

  const draw = () => {
    const html = `
      <h3>${isNew ? '새 루틴' : '루틴 편집'}</h3>
      <div class="field-label">이름</div>
      <input type="text" id="rtName" value="${esc(draft.name)}" placeholder="예: 헬스">
      <div class="field-label">해시태그 (본문에 이렇게 쓰면 자동 인식)</div>
      <input type="text" id="rtTag" value="${esc(draft.tag)}" placeholder="비워두면 이름과 같게">
      <div class="field-label">아이콘</div>
      <div class="emoji-grid">${S.ROUTINE_EMOJIS.map(e =>
        `<button data-em="${e}" class="${e === draft.emoji ? 'on' : ''}">${e}</button>`).join('')}</div>
      <div class="field-label">색</div>
      <div class="color-grid">${S.THEMES.map(t =>
        `<button data-col="${t.c}" style="background:${t.c}" class="${t.c === draft.color ? 'on' : ''}"></button>`).join('')}</div>
      <div class="sheet-actions">
        ${isNew ? '' : '<button class="btn-danger" data-x="del">삭제</button>'}
        <button class="btn-ghost" data-x="cancel">취소</button>
        <button class="btn-main" data-x="save">저장</button>
      </div>`;
    const s = setSheet(html);
    const sync = () => { draft.name = s.querySelector('#rtName').value; draft.tag = s.querySelector('#rtTag').value; };
    $$('[data-em]', s).forEach(b => b.onclick = () => { sync(); draft.emoji = b.dataset.em; draw(); });
    $$('[data-col]', s).forEach(b => b.onclick = () => { sync(); draft.color = b.dataset.col; draw(); });
    s.querySelector('[data-x="cancel"]').onclick = back;
    s.querySelector('[data-x="save"]').onclick = () => {
      sync();
      const name = draft.name.trim();
      if (!name) { toast('이름을 입력해 주세요.'); return; }
      draft.name = name;
      draft.tag = (draft.tag || '').trim().replace(/^#/, '') || name;
      const list = [...(S.get('routines') || [])];
      const i = list.findIndex(x => x.id === draft.id);
      if (i >= 0) list[i] = draft; else list.push(draft);
      S.saveCatalog({ routines: list });
      onDone(); renderList(); autoSyncSoon();
      back();
    };
    if (!isNew) s.querySelector('[data-x="del"]').onclick = () => {
      const list = (S.get('routines') || []).filter(x => x.id !== draft.id);
      S.saveCatalog({ routines: list });
      S.set('hiddenRoutines', (S.get('hiddenRoutines') || []).filter(x => x !== draft.id));
      onDone(); renderList(); autoSyncSoon();
      toast('삭제했습니다. 기존 일기 내용은 그대로 있습니다.');
      back();
    };
  };
  draw();
}

/* ---------- D-DAY ---------- */
function manageDdays(onDone = () => {}, straightToNew = false) {
  const draw = () => {
    const list = S.get('ddays') || [];
    const html = `
      <h3>D-DAY</h3>
      <p class="desc">시작일부터 며칠 됐는지 세어 줍니다.<br>종료일을 넣으면 총 며칠이었는지로 바뀝니다.</p>
      ${list.map(d => {
        const t = ddayText(d);
        return `<button class="mrow" data-id="${d.id}">
          <span class="em">${d.emoji || '📌'}</span>
          <span class="nm">${esc(d.name)}<span class="sub">${t.big} · ${t.sub}</span></span>
          <span class="dot-c" style="--cc:${d.color}"></span>
        </button>`;
      }).join('') || '<p class="desc">아직 없습니다.</p>'}
      <div class="sheet-actions">
        <button class="btn-ghost" data-x="add">+ 새 D-DAY</button>
        <button class="btn-main" data-x="ok">완료</button>
      </div>`;
    const s = sheetIsOpen() ? setSheet(html) : openSheetHTML(html);
    $$('.mrow', s).forEach(b => b.onclick = () => {
      const d = (S.get('ddays') || []).find(x => x.id === b.dataset.id);
      editDdayForm(d, draw, onDone);
    });
    s.querySelector('[data-x="add"]').onclick = () => editDdayForm(null, draw, onDone);
    s.querySelector('[data-x="ok"]').onclick = () => closeTop();
  };
  draw();
  if (straightToNew) editDdayForm(null, draw, onDone);
}

/** 통계 카드를 바로 눌렀을 때: 목록 시트를 연 뒤 곧장 편집 폼으로 */
function editDday(d, onDone) {
  manageDdays(onDone);
  editDdayForm(d, () => manageDdays(onDone), onDone);
}

function editDdayForm(dday, back, onDone) {
  const isNew = !dday;
  let draft = dday
    ? { ...dday }
    : { id: S.newId('d'), name: '', emoji: '❤️', color: S.THEMES[6].c, start: todayYMD(), end: '' };

  const draw = () => {
    const html = `
      <h3>${isNew ? '새 D-DAY' : 'D-DAY 편집'}</h3>
      <div class="field-label">이름</div>
      <input type="text" id="ddName" value="${esc(draft.name)}" placeholder="예: 민지와 연애">
      <div class="field-label">시작일</div>
      <input type="date" id="ddStart" value="${esc(draft.start)}">
      <div class="field-label">종료일 (진행 중이면 비워 두세요)</div>
      <input type="date" id="ddEnd" value="${esc(draft.end || '')}">
      <div class="field-label">아이콘</div>
      <div class="emoji-grid">${['❤️', '💍', '🎂', '✈️', '🚭', '💪', '📚', '💼', '🏠', '🐶', '🎓', '💰', '🎯', '⏰', '📌', '🌱'].map(e =>
        `<button data-em="${e}" class="${e === draft.emoji ? 'on' : ''}">${e}</button>`).join('')}</div>
      <div class="field-label">색</div>
      <div class="color-grid">${S.THEMES.map(t =>
        `<button data-col="${t.c}" style="background:${t.c}" class="${t.c === draft.color ? 'on' : ''}"></button>`).join('')}</div>
      <div class="sheet-actions">
        ${isNew ? '' : '<button class="btn-danger" data-x="del">삭제</button>'}
        <button class="btn-ghost" data-x="cancel">취소</button>
        <button class="btn-main" data-x="save">저장</button>
      </div>`;
    const s = setSheet(html);
    const sync = () => {
      draft.name = s.querySelector('#ddName').value;
      draft.start = s.querySelector('#ddStart').value;
      draft.end = s.querySelector('#ddEnd').value;
    };
    $$('[data-em]', s).forEach(b => b.onclick = () => { sync(); draft.emoji = b.dataset.em; draw(); });
    $$('[data-col]', s).forEach(b => b.onclick = () => { sync(); draft.color = b.dataset.col; draw(); });
    s.querySelector('[data-x="cancel"]').onclick = back;
    s.querySelector('[data-x="save"]').onclick = () => {
      sync();
      const name = draft.name.trim();
      if (!name) { toast('이름을 입력해 주세요.'); return; }
      if (!draft.start) { toast('시작일을 골라 주세요.'); return; }
      if (draft.end && diffDays(draft.start, draft.end) < 0) { toast('종료일이 시작일보다 빠릅니다.'); return; }
      draft.name = name;
      const list = [...(S.get('ddays') || [])];
      const i = list.findIndex(x => x.id === draft.id);
      if (i >= 0) list[i] = draft; else list.push(draft);
      S.saveCatalog({ ddays: list });
      onDone(); autoSyncSoon();
      back();
    };
    if (!isNew) s.querySelector('[data-x="del"]').onclick = () => {
      S.saveCatalog({ ddays: (S.get('ddays') || []).filter(x => x.id !== draft.id) });
      onDone(); autoSyncSoon();
      toast('삭제했습니다.');
      back();
    };
  };
  draw();
}

/* ================= 패스코드 잠금 ================= */
let pinBuf = '';
let pinMode = 'unlock';   // unlock | set | confirm
let pinFirst = '';

async function maybeLock() {
  if (!S.get('lockOn') || !S.get('pinHash')) { $('#lockScreen').classList.add('hidden'); return; }
  return new Promise(res => {
    pinMode = 'unlock'; pinBuf = ''; pinFirst = '';
    $('#lockHint').textContent = '';
    $('.lock-title').textContent = '패스코드를 입력';
    drawDots();
    $('#lockScreen').classList.remove('hidden');
    $('#bioBtn').hidden = !S.get('bioOn');
    lockResolve = res;
    bindKeypad();
    if (S.get('bioOn')) setTimeout(tryBiometric, 350);
  });
}
let lockResolve = null;

function bindKeypad() {
  if (bindKeypad._done) return;
  bindKeypad._done = true;
  $('#keypad').onclick = (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    const k = b.dataset.k;
    if (k === 'del') { pinBuf = pinBuf.slice(0, -1); drawDots(); return; }
    if (k === 'bio') { tryBiometric(); return; }
    if (pinBuf.length >= 4) return;
    pinBuf += k;
    drawDots();
    if (pinBuf.length === 4) setTimeout(submitPin, 130);
  };
}
function drawDots() {
  $$('#pinDots i').forEach((d, i) => d.classList.toggle('on', i < pinBuf.length));
}
function shake(msg) {
  const d = $('#pinDots');
  d.classList.add('shake');
  $('#lockHint').textContent = msg;
  setTimeout(() => { d.classList.remove('shake'); pinBuf = ''; drawDots(); }, 380);
}

async function submitPin() {
  if (pinMode === 'set') {
    pinFirst = pinBuf; pinBuf = ''; drawDots();
    pinMode = 'confirm';
    $('.lock-title').textContent = '한 번 더 입력';
    $('#lockHint').textContent = '';
    return;
  }
  if (pinMode === 'confirm') {
    if (pinBuf !== pinFirst) {
      pinMode = 'set'; pinFirst = '';
      $('.lock-title').textContent = '새 패스코드를 입력';
      shake('일치하지 않습니다. 다시 설정해 주세요.');
      return;
    }
    const salt = S.newSalt();
    S.setMany({ pinSalt: salt, pinHash: await S.hashPin(pinBuf, salt), lockOn: true });
    $('#lockScreen').classList.add('hidden');
    pinBuf = ''; drawDots();
    refreshSettings();
    toast('패스코드를 설정했습니다.');
    return;
  }
  // unlock
  const h = await S.hashPin(pinBuf, S.get('pinSalt'));
  if (h === S.get('pinHash')) {
    $('#lockScreen').classList.add('hidden');
    pinBuf = ''; drawDots();
    if (lockResolve) { lockResolve(); lockResolve = null; }
  } else {
    shake('패스코드가 올바르지 않습니다.');
  }
}

function setupPin() {
  pinMode = 'set'; pinBuf = ''; pinFirst = '';
  $('.lock-title').textContent = '새 패스코드를 입력';
  $('#lockHint').textContent = '잊어버리면 복구할 수 없습니다.';
  $('#bioBtn').hidden = true;
  drawDots();
  bindKeypad();
  $('#lockScreen').classList.remove('hidden');
}

/* 생체 인증: 이 기기 안에서만 쓰는 잠금 해제용 */
function b64u(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64u(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(t + '='.repeat((4 - t.length % 4) % 4)), c => c.charCodeAt(0));
}
async function registerBiometric() {
  if (!window.PublicKeyCredential) { toast('이 기기는 생체 인증을 지원하지 않습니다.'); return false; }
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: '추억 일기', id: location.hostname },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'diary', displayName: '추억 일기' },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60000,
        attestation: 'none',
      },
    });
    S.set('bioCredId', b64u(cred.rawId));
    toast('생체 인증을 등록했습니다.');
    return true;
  } catch (e) {
    console.warn(e);
    toast('생체 인증 등록에 실패했습니다.');
    return false;
  }
}
async function tryBiometric() {
  const id = S.get('bioCredId');
  if (!id) return;
  try {
    await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: unb64u(id) }],
        userVerification: 'required',
        timeout: 60000,
      },
    });
    $('#lockScreen').classList.add('hidden');
    pinBuf = ''; drawDots();
    if (lockResolve) { lockResolve(); lockResolve = null; }
  } catch (e) { /* 사용자가 취소 → 패스코드 입력 */ }
}

/* 백그라운드로 갔다 오면 다시 잠금 */
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (S.get('lockOn') && S.get('pinHash') && hiddenAt && Date.now() - hiddenAt > 60000) {
    maybeLock();
  }
  checkNotifyNow();
});

/* ================= 아이폰 설치 안내 ================= */
function showIOSBannerIfNeeded() {
  const banner = $('#iosBanner');
  const forced = /[?&]iosbanner\b/.test(location.search);   // PC에서 미리 보기용
  if (!forced) {
    if (!isIOS() || isStandalone()) return;
    if (localStorage.getItem('diary.iosBannerOff') === '1') return;
  }

  banner.classList.remove('hidden');
  document.body.classList.add('ios-banner-on');
  $('#iosClose').onclick = () => {
    banner.classList.add('hidden');
    document.body.classList.remove('ios-banner-on');
    localStorage.setItem('diary.iosBannerOff', '1');
  };
  $('#iosHow').onclick = () => {
    const isSafari = !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent);
    const sheet = openSheetHTML(`
      <h3>홈 화면에 추가하기</h3>
      ${isSafari ? '' : '<p class="desc" style="color:var(--danger)">지금 브라우저로는 추가할 수 없습니다.<br>주소를 복사해 <b>Safari</b>로 열어 주세요.</p>'}
      <ol class="share-steps">
        <li>화면 아래 <b>공유 버튼 (□↑)</b> 누르기</li>
        <li>목록을 내려서 <b>홈 화면에 추가</b> 누르기</li>
        <li>오른쪽 위 <b>추가</b> 누르기</li>
      </ol>
      <p class="desc">추가하면 아이콘으로 실행되고, 주소창 없이 앱처럼 뜹니다.</p>
      <div class="sheet-actions">
        <button class="btn-ghost" data-x="copy">주소 복사</button>
        <button class="btn-main" data-x="ok">알겠습니다</button>
      </div>`);
    sheet.querySelector('[data-x="ok"]').onclick = () => closeTop();
    sheet.querySelector('[data-x="copy"]').onclick = async () => {
      try { await navigator.clipboard.writeText(location.href); toast('주소를 복사했습니다.'); }
      catch { toast('복사에 실패했습니다. 주소창에서 직접 복사해 주세요.'); }
    };
  };
}

/* ================= 알림 ================= */
function scheduleNotify() {
  clearTimeout(scheduleNotify._t);
  if (!S.get('notify')) return;
  checkNotifyNow();
  scheduleNotify._t = setTimeout(scheduleNotify, 60000);
}
async function checkNotifyNow() {
  // 아이폰 Safari는 Notification 자체가 없을 수 있어 typeof 로 확인해야 한다
  if (!S.get('notify')) return;
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const [h, m] = S.get('notifyTime').split(':').map(Number);
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins < h * 60 + m) return;
  const today = todayYMD();
  if (localStorage.getItem('diary.notified') === today) return;
  if (entries.some(e => e.dt.slice(0, 10) === today)) return;
  localStorage.setItem('diary.notified', today);
  showNotification('오늘의 일기', '오늘 하루를 기록해 보세요.');
}

/** 아이폰은 new Notification() 을 지원하지 않아 서비스워커 쪽을 먼저 쓴다 */
async function showNotification(title, body) {
  const opts = { body, icon: './icons/icon-192.png', badge: './icons/icon-192.png', tag: 'diary-daily' };
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg?.showNotification) { await reg.showNotification(title, opts); return; }
  } catch { /* 아래로 */ }
  try { new Notification(title, opts); } catch (e) { console.warn('알림 표시 실패', e); }
}
