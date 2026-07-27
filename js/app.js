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
  entries = await DB.allEntries();

  bindTabs();
  bindList();
  bindCalendar();
  bindEditor();
  bindViewer();
  bindSearch();
  bindSettings();

  await maybeLock();

  renderList();
  renderCalendar();
  refreshSettings();
  scheduleNotify();
  registerSW();

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
  ['list', 'cal', 'set'].forEach(n => $('#view-' + n).classList.toggle('hidden', n !== name));
  $('#fab').classList.toggle('hidden', name === 'set');
  if (name === 'set') refreshSettings();
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
        const id = await DB.savePhotoFile(f);
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
    ? { ...entry, photos: [...(entry.photos || [])] }
    : { id: DB.uid(), dt: nowDT(), title: '', body: '', photos: [], tags: [], createdAt: Date.now() };
  editing._orig = entry ? entry.photos || [] : [];
  $('#edTitle').value = editing.title || '';
  $('#edBody').value = editing.body || '';
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
  $('#lightbox').onclick = () => closeTop();
}

async function openViewer(id) {
  const e = await DB.getEntry(id);
  if (!e) return;
  viewingId = id;
  $('#vwDate').textContent = fmtFull(e.dt);
  const box = $('#vwScroll');
  box.innerHTML = `
    ${e.title ? `<h2 class="vw-title">${esc(e.title)}</h2>` : ''}
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
    img.onclick = () => {
      $('#lbImg').src = u;
      $('#lightbox').classList.remove('hidden');
      pushPage(() => $('#lightbox').classList.add('hidden'));
    };
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
        toast('이 브라우저는 알림을 지원하지 않습니다.');
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
      renderList(); renderCalendar(); refreshSettings();
      toast('삭제했습니다.');
    },
  });
  $('#rowAbout').onclick = () => openSheetHTML(`
    <h3>심플 일기장</h3>
    <p class="desc">
      설치형 웹앱(PWA)입니다. 홈 화면에 추가하면 앱처럼 실행됩니다.<br>
      일기는 이 기기 안에 저장되며, 구글 드라이브에 백업하면 다른 기기에서도 볼 수 있습니다.<br><br>
      version 1.0.0
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
  $('#tDriveAuth').textContent = configured
    ? (S.get('driveEmail') ? '다른 계정으로 바꾸기 / 연결 해제' : '구글 계정 연결하기')
    : '구글 클라이언트 ID 입력하기';
  $('#driveNote').innerHTML = configured
    ? '드라이브의 <b>' + esc('심플일기장 백업') + '</b> 폴더에 저장됩니다. 다른 기기에서 같은 계정으로 연결하면 일기가 합쳐집니다.'
    : '연동하려면 구글 OAuth 클라이언트 ID가 필요합니다. 함께 만든 <b>SETUP.md</b> 파일의 순서를 따라 발급받으세요.';

  $('#vLastSync').textContent = relTime(await DB.getMeta('lastSync', 0));
  $('#vCount').textContent = (await DB.countEntries()) + '건';
  $('#vStorage').textContent = bytes(await DB.photoBytes());
}

/* ================= 구글 드라이브 ================= */
function driveAuthTap() {
  if (!Drive.isConfigured()) return askClientId();
  const opts = [{ label: '구글 계정 연결 / 다시 로그인', value: 'login' }];
  if (S.get('driveEmail')) opts.push({ label: '연결 해제', value: 'out', danger: true });
  opts.push({ label: '클라이언트 ID 다시 입력', value: 'id' });
  openSheet({
    title: '구글 드라이브',
    desc: S.get('driveEmail') || '',
    options: opts,
    onPick: async (v) => {
      closeTop();
      await new Promise(r => setTimeout(r, 80));
      if (v === 'id') return askClientId();
      if (v === 'out') { Drive.signOut(); refreshSettings(); toast('연결을 해제했습니다.'); return; }
      try {
        spin('구글 로그인 중…');
        await Drive.auth(true);
        await Drive.fetchEmail();
        spinOff();
        refreshSettings();
        toast('연결되었습니다.');
      } catch (e) { spinOff(); toast(e.message); }
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
    renderList(); renderCalendar(); refreshSettings();
    const bits = [];
    if (r.added) bits.push(`새 일기 ${r.added}건`);
    if (r.updated) bits.push(`갱신 ${r.updated}건`);
    if (r.pulled) bits.push(`사진 ${r.pulled}장 받음`);
    if (r.pushed) bits.push(`사진 ${r.pushed}장 올림`);
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
    renderList(); renderCalendar(); refreshSettings();
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
      const md = [
        `# ${e.title || '(제목 없음)'}`,
        '',
        fmtFull(e.dt),
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
      const p = await DB.getPhoto(pid);
      if (p?.blob) files.push({ name: `사진/p_${pid}.jpg`, data: p.blob });
    }

    files.push({
      name: 'backup.json',
      data: JSON.stringify({
        version: 1, app: 'simple-diary', exportedAt: new Date().toISOString(),
        entries: list, tombstones: await DB.getMeta('tombstones', []),
      }, null, 1),
    });

    spinText('압축 중…');
    const zip = await ZipKit.makeZip(files);
    const d = new Date();
    saveBlob(zip, `일기장백업_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.zip`);
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
        await DB.savePhotoFile(p.blob, p.id);
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
      entries = await DB.allEntries();
      spinOff();
      renderList(); renderCalendar(); refreshSettings();
      toast(`가져오기 완료 · 새 일기 ${added}건, 갱신 ${updated}건`);
    } catch (e) {
      spinOff(); toast(e.message || '가져오기에 실패했습니다.'); console.error(e);
    }
  };
  inp.click();
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
        rp: { name: '심플 일기장', id: location.hostname },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: 'diary', displayName: '일기장' },
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

/* ================= 알림 ================= */
function scheduleNotify() {
  clearTimeout(scheduleNotify._t);
  if (!S.get('notify')) return;
  checkNotifyNow();
  scheduleNotify._t = setTimeout(scheduleNotify, 60000);
}
async function checkNotifyNow() {
  if (!S.get('notify') || Notification?.permission !== 'granted') return;
  const [h, m] = S.get('notifyTime').split(':').map(Number);
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  if (mins < h * 60 + m) return;
  const today = todayYMD();
  if (localStorage.getItem('diary.notified') === today) return;
  if (entries.some(e => e.dt.slice(0, 10) === today)) return;
  localStorage.setItem('diary.notified', today);
  try {
    new Notification('오늘의 일기', { body: '오늘 하루를 기록해 보세요.', icon: './icons/icon-192.png', tag: 'diary-daily' });
  } catch { /* 무시 */ }
}
