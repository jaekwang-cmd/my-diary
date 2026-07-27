// 미리보기용 샘플 데이터. 주소 뒤에 ?demo 를 붙였을 때만 실행됩니다.
// 필요 없어지면 이 파일과 app.js 의 loadDemo() 호출부를 지우면 됩니다.
import * as DB from './db.js';
import * as S from './settings.js';

const pad = n => String(n).padStart(2, '0');

function ymdOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d; }

async function makePhoto(text, c1, c2) {
  const c = document.createElement('canvas');
  c.width = 1200; c.height = 800;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 1200, 800);
  g.addColorStop(0, c1); g.addColorStop(1, c2);
  x.fillStyle = g; x.fillRect(0, 0, 1200, 800);
  x.fillStyle = 'rgba(255,255,255,.92)';
  x.font = 'bold 78px -apple-system, sans-serif';
  x.textAlign = 'center';
  x.fillText(text, 600, 430);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
  return DB.savePhotoFile(blob);
}

const PLAN = [
  [0,  '오늘도 헬스장',     '스쿼트 5세트. 다리가 후들거린다. 그래도 뿌듯함.', ['r_gym'], null],
  [1,  '민지와 저녁',       '오랜만에 파스타 먹으러 갔다. 웃긴 얘기 많이 했다. #데이트', [], ['DINNER', '#f7a072', '#eb6f92']],
  [2,  '',                  '자기 전에 30분 독서. 요즘 이 습관이 제일 좋다. #독서', [], null],
  [3,  '비 오는 날 산책',   '우산 쓰고 천천히 걸었다. 공기가 좋았다.', ['r_walk'], null],
  [4,  '헬스 + 공부',       '운동하고 카페에서 두 시간 공부.', ['r_gym', 'r_study'], null],
  [6,  '회식',             '조금 과했다. 내일이 걱정.', ['r_drink'], null],
  [7,  '주말 데이트',       '한강 갔다가 사진 많이 찍었다.', ['r_date'], ['HANGANG', '#7fd8e8', '#a5e6c3']],
  [8,  '',                  '가볍게 3km. 페이스가 좋아졌다. #헬스', [], null],
  [10, '책 다 읽음',        '드디어 완독. 다음 책 고르는 중이다.', ['r_book'], null],
  [11, '헬스',             '어깨 운동. 무게를 조금 올렸다.', ['r_gym'], null],
  [13, '영화 보러',         '팝콘이 제일 맛있었다. #데이트', [], null],
  [14, '늦잠 잔 토요일',    '아무것도 안 했다. 이런 날도 필요하지.', [], null],
  [16, '헬스 + 산책',      '운동하고 저녁에 동네 한 바퀴.', ['r_gym', 'r_walk'], null],
  [18, '공부한 하루',       '집중이 잘 됐다. 계획한 만큼 끝냈다.', ['r_study'], null],
  [20, '헬스',             '가슴 운동. 꾸준히 하니까 확실히 는다.', ['r_gym'], null],
  [22, '기념일',           '작은 케이크를 샀다. 좋아해줘서 다행이다. #데이트', [], ['CAKE', '#f6c1d9', '#f0a6ca']],
  [25, '헬스',             '오랜만에 갔더니 힘들었다.', ['r_gym'], null],
  [28, '독서 모임',         '처음 나가봤는데 생각보다 재밌었다. #독서', [], null],
];

export async function loadDemo() {
  const already = await DB.countEntries();
  if (already > 0) return { skipped: true, reason: '이미 일기가 있어 샘플을 넣지 않았습니다.' };

  let n = 0;
  for (const [ago, title, body, routines, photo] of PLAN) {
    const d = daysAgo(ago);
    const hour = 19 + (ago % 3);
    const dt = `${ymdOf(d)}T${pad(hour)}:${pad((ago * 7) % 60)}`;
    const photos = [];
    if (photo) photos.push(await makePhoto(photo[0], photo[1], photo[2]));
    await DB.putEntry({
      id: 'demo_' + ago,
      dt, date: dt.slice(0, 10),
      title, body,
      photos, routines,
      tags: (String(title + ' ' + body).match(/#[^\s#]+/g) || []).map(t => t.slice(1)),
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    n++;
  }

  // 샘플 D-DAY
  const start = daysAgo(412);
  const oldS = daysAgo(1240), oldE = daysAgo(900);
  S.saveCatalog({
    routines: S.get('routines'),
    ddays: [
      { id: 'demo_d1', name: '민지와 연애', emoji: '❤️', color: '#EC5F8E', start: ymdOf(start), end: '' },
      { id: 'demo_d2', name: '금연', emoji: '🚭', color: '#3E9E70', start: ymdOf(daysAgo(63)), end: '' },
      { id: 'demo_d3', name: '이전 연애', emoji: '💔', color: '#7A8894', start: ymdOf(oldS), end: ymdOf(oldE) },
    ],
  });

  return { skipped: false, count: n };
}
