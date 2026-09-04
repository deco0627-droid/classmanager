// Cloudflare Pages Function: POST /api/send-notification-absent
// body: { title, body }
//
// 오늘 CBT(cbt-program.pages.dev, 같은 Firebase 프로젝트를 씀)를 아직 안 본 학생에게만 푸시를
// 보낸다. ClassManager의 알림은 원래 완전히 익명이라(fcmTokens에 토큰만 저장) 어느 기기가
// 누구 것인지 몰랐는데, 학생이 알림을 켤 때 실명을 같이 저장해두게 바꿔서(index.html의
// ensureStudentNameForPush), 그 이름을 CBT 쪽 "오늘 미응시" 명단과 정확히 대조해 발송한다.
// 완벽하게 정확하진 않다(동명이인, 오타, 허위 입력 시 빗나갈 수 있음) — README/안내에 명시.
//
// 필요한 설정: send-notification.js와 동일한 FIREBASE_SERVICE_ACCOUNT_KEY 환경변수를 그대로
// 재사용한다(같은 프로젝트 안의 다른 컬렉션을 읽는 것뿐이라 추가 설정이 필요 없음).

const TEACHER_EMAIL = 'deco0627@nate.com';
const TARGET_SCHOOL = '유한공고'; // ClassManager는 이 학교 전용 배포라 CBT 쪽 필터도 고정한다
const PROJECT_ID = 'class-manager-3b85d';
const PROJECT_DOCS = `projects/${PROJECT_ID}/databases/(default)/documents`;

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}

function base64UrlEncode(input) {
  let binary;
  if (typeof input === 'string') binary = input;
  else {
    const bytes = new Uint8Array(input);
    binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken(serviceAccount) {
  const header = { alg: 'RS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const signingInput = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(claimSet))}`;
  const pemContents = serviceAccount.private_key
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s/g, '');
  const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryDer.buffer, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64UrlEncode(signature)}`;
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('OAuth 토큰 발급 실패: ' + JSON.stringify(tokenData));
  return tokenData.access_token;
}

// 이 함수 자체는 학생 결석 여부를 다루므로, 발송 요청자가 진짜 교사 본인인지 ID 토큰으로 검증한다
// (CBT 쪽 functions/api/*.js가 쓰는 것과 같은 방식). 전체 발송용 send-notification.js는
// 원래 인증이 없었는데, 그건 그대로 두고 이 새 엔드포인트에만 추가한다.
const FIREBASE_API_KEY = 'AIzaSyBl6Ler-fG-I9aauInrCNADs2s0EO3YztI';
async function verifyTeacher(request) {
  const authHeader = request.headers.get('Authorization') || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!idToken) return false;
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${FIREBASE_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    const user = data.users && data.users[0];
    return !!(user && user.email === TEACHER_EMAIL);
  } catch (e) {
    return false;
  }
}

function fsValueToJs(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fsValueToJs);
  if ('mapValue' in v) return fsFieldsToJs(v.mapValue.fields || {});
  return null;
}
function fsFieldsToJs(fields) {
  const obj = {};
  for (const key in fields) obj[key] = fsValueToJs(fields[key]);
  return obj;
}
async function firestoreRunQuery(accessToken, structuredQuery) {
  const res = await fetch(`https://firestore.googleapis.com/v1/${PROJECT_DOCS}:runQuery`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) throw new Error('Firestore 쿼리 실패: ' + (await res.text()).slice(0, 300));
  const rows = await res.json();
  return rows.filter(r => r.document).map(r => ({ id: r.document.name.split('/').pop(), ...fsFieldsToJs(r.document.fields || {}) }));
}

// Cloudflare Workers는 UTC로 돈다 — 한국 시간(UTC+9) 기준 "오늘" 날짜와 하루 경계를 직접 계산한다.
function todayKstStr() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function kstDayRangeMs(dateStr) {
  const startUtcMs = Date.parse(dateStr + 'T00:00:00.000Z') - 9 * 60 * 60 * 1000;
  return { startUtcMs, endUtcMs: startUtcMs + 24 * 60 * 60 * 1000 };
}

async function computeAbsentStudents(accessToken, dateStr) {
  const prefix = 'checkin_' + dateStr;
  const configDocs = await firestoreRunQuery(accessToken, {
    from: [{ collectionId: 'cbtSettings' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: '__name__' }, op: 'GREATER_THAN_OR_EQUAL', value: { referenceValue: `${PROJECT_DOCS}/cbtSettings/${prefix}` } } },
          { fieldFilter: { field: { fieldPath: '__name__' }, op: 'LESS_THAN', value: { referenceValue: `${PROJECT_DOCS}/cbtSettings/${prefix}` } } },
        ],
      },
    },
  });
  const activeConfigs = configDocs.map(d => d.examConfig).filter(c => c && c.school === TARGET_SCHOOL);
  if (!activeConfigs.length) return [];

  const allStudents = await firestoreRunQuery(accessToken, {
    from: [{ collectionId: 'cbtUsers' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: 'school' }, op: 'EQUAL', value: { stringValue: TARGET_SCHOOL } } },
          { fieldFilter: { field: { fieldPath: 'isStudent' }, op: 'EQUAL', value: { booleanValue: true } } },
          { fieldFilter: { field: { fieldPath: 'status' }, op: 'EQUAL', value: { stringValue: 'approved' } } },
        ],
      },
    },
  });

  const targetMap = new Map(); // uid -> student
  activeConfigs.forEach(c => {
    let matched = allStudents;
    if (c.targetDept) matched = matched.filter(u => (u.department || '') === c.targetDept);
    if (c.targetTrack) matched = matched.filter(u => (u.track || '') === c.targetTrack);
    matched.forEach(u => targetMap.set(u.id, u));
  });
  if (!targetMap.size) return [];

  const { startUtcMs, endUtcMs } = kstDayRangeMs(dateStr);
  const attempts = await firestoreRunQuery(accessToken, {
    from: [{ collectionId: 'cbtExamAttempts' }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { fieldFilter: { field: { fieldPath: 'finishedAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { integerValue: String(startUtcMs) } } },
          { fieldFilter: { field: { fieldPath: 'finishedAt' }, op: 'LESS_THAN', value: { integerValue: String(endUtcMs) } } },
        ],
      },
    },
  });
  const takenUids = new Set(attempts.map(a => a.ownerId));

  // 관리자가 미리보기에서 특정 학생을 빼고 보낼 수 있도록, 이름뿐 아니라 학년·반·번호가 붙은
  // 표시용 라벨(CBT의 studentRosterLabel과 같은 방식)도 같이 돌려준다.
  const absentStudents = [];
  targetMap.forEach((u, uid) => {
    if (takenUids.has(uid) || !u.displayName) return;
    const name = u.displayName.replace(/\s+/g, '');
    const label = (u.grade && u.classNum && u.studentNum)
      ? `${u.grade}${u.classNum}${String(u.studentNum).padStart(2, '0')}${u.displayName}`
      : u.displayName;
    absentStudents.push({ uid, name, label });
  });
  return absentStudents;
}

async function getFcmTokensWithNames(accessToken) {
  const res = await fetch(
    `https://firestore.googleapis.com/v1/${PROJECT_DOCS}/fcmTokens?pageSize=1000`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json();
  return (data.documents || []).map(doc => ({
    token: fsValueToJs(doc.fields && doc.fields.token),
    name: fsValueToJs(doc.fields && doc.fields.name),
  })).filter(t => t.token);
}

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const isTeacherReq = await verifyTeacher(request);
    if (!isTeacherReq) return jsonResponse({ error: '권한이 없습니다.' }, 401);

    const body = await request.json().catch(() => ({}));
    const dryRun = !!body.dryRun;
    const title = (body.title || '').toString().slice(0, 200);
    const message = (body.body || '').toString().slice(0, 500);
    if (!dryRun && !title) return jsonResponse({ error: '제목이 없습니다.' }, 400);

    const saJson = env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!saJson) return jsonResponse({ error: 'FIREBASE_SERVICE_ACCOUNT_KEY 환경변수가 설정되지 않았습니다.' }, 500);
    const serviceAccount = JSON.parse(saJson);
    const accessToken = await getAccessToken(serviceAccount);

    const absentStudents = await computeAbsentStudents(accessToken, todayKstStr());
    if (!absentStudents.length) {
      return jsonResponse({ sent: 0, totalAbsent: 0, students: [], message: '오늘 미응시 대상 학생이 없습니다 (QR 미발급 또는 전원 응시 완료).' });
    }

    // 미리보기 요청이면 보내지 않고 명단만 돌려준다 — 관리자가 화면에서 특정 학생을 빼고
    // 다시 요청할 수 있게 한다.
    if (dryRun) {
      return jsonResponse({ students: absentStudents.map(s => ({ name: s.name, label: s.label })) });
    }

    // names가 오면(미리보기에서 일부 제외 가능) 그 이름들로만 좁히고, 없으면(과거 호출 호환) 전원 대상.
    // 서버가 직접 계산한 오늘의 미응시 명단과 교집합만 취해서, 클라이언트가 엉뚱한 이름을 끼워 넣어도
    // 실제 미응시자가 아니면 걸러지게 한다.
    const requestedNames = Array.isArray(body.names) ? new Set(body.names.map(n => String(n).replace(/\s+/g, ''))) : null;
    const targetNames = new Set(
      absentStudents
        .filter(s => !requestedNames || requestedNames.has(s.name))
        .map(s => s.name)
    );
    if (!targetNames.size) return jsonResponse({ sent: 0, totalAbsent: absentStudents.length, matchedNames: 0, message: '선택된 학생이 없습니다.' });

    const tokensWithNames = await getFcmTokensWithNames(accessToken);
    const matched = tokensWithNames.filter(t => t.name && targetNames.has(String(t.name).replace(/\s+/g, '')));

    let sent = 0;
    const invalidTokens = [];
    for (const { token } of matched) {
      const sendRes = await fetch(`https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token, notification: { title, body: message }, webpush: { fcmOptions: { link: '/' } } } }),
      });
      if (sendRes.ok) {
        sent++;
      } else {
        const errData = await sendRes.json().catch(() => ({}));
        const errCode = errData.error && errData.error.status;
        if (errCode === 'NOT_FOUND' || errCode === 'INVALID_ARGUMENT') invalidTokens.push(token);
      }
    }
    for (const token of invalidTokens) {
      await fetch(`https://firestore.googleapis.com/v1/${PROJECT_DOCS}/fcmTokens/${token}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` },
      }).catch(() => {});
    }

    return jsonResponse({
      sent,
      totalAbsent: absentStudents.length,
      matchedNames: matched.length,
      removedInvalid: invalidTokens.length,
    });
  } catch (err) {
    return jsonResponse({ error: err.message }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
