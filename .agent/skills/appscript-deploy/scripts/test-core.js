/**
 * Core regression tests (backend run in a vm with stubbed Apps Script services).
 * Usage: node test-core.js [path-to-backend.text]   (default: newest code*.text at repo root)
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex');

const ROOT = path.resolve(__dirname, '../../../..');

function newestBackend() {
  const files = fs.readdirSync(ROOT).filter(f => /^code\d+\.\d+\.\d+\.text$/.test(f));
  files.sort((a, b) => {
    const pa = a.match(/\d+/g).map(Number), pb = b.match(/\d+/g).map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  });
  return path.join(ROOT, files[files.length - 1]);
}

const backendPath = process.argv[2] ? path.resolve(process.argv[2]) : newestBackend();
const backendSrc = fs.readFileSync(backendPath, 'utf8');
const syncSrc = fs.readFileSync(path.join(ROOT, 'sync.txt'), 'utf8');
const scSrc = fs.readFileSync(path.join(ROOT, 'js/schedule-config.js'), 'utf8');
const stSrc = fs.readFileSync(path.join(ROOT, 'js/student.js'), 'utf8');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  OK   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
}

// ---------------------------------------------------------------- env
const T0 = Date.now() - 60 * 1000;
const CLASS_LAT = 10.8, CLASS_LNG = 106.6;
const iso = ms => new Date(ms);

function sessionRow({ qrMode = 'STATIC' } = {}) {
  return ['SES_C1_1', 'C1', 'lbl', iso(T0), iso(T0 + 300e3), iso(T0 + 3600e3), '', CLASS_LAT, CLASS_LNG, 100, qrMode];
}

function mkSheet(rows) {
  return {
    appendRow: r => { rows.push(r); },
    getLastRow: () => rows.length + 1,
    getRange: (r, c, nr, nc) => ({
      getValues: () => {
        const out = [];
        for (let i = 0; i < nr; i++) out.push((rows[r - 2 + i] || []).slice(c - 1, c - 1 + nc));
        return out;
      },
      setValues: () => {}
    })
  };
}

function buildEnv({ sessionRows = [], deviceRows = [], c9 = '', props = {} } = {}) {
  const cacheStore = {};
  const cache = {
    get: k => (k in cacheStore ? cacheStore[k] : null),
    put: (k, v) => { cacheStore[k] = v; },
    remove: k => { delete cacheStore[k]; },
    removeAll: ks => ks.forEach(k => delete cacheStore[k])
  };
  const propStore = Object.assign({}, props);
  const propsApi = {
    getProperty: k => (k in propStore ? propStore[k] : null),
    setProperty: (k, v) => { propStore[k] = String(v); },
    deleteProperty: k => { delete propStore[k]; }
  };
  const sheets = {
    Sessions_Log: mkSheet(sessionRows),
    Device_Registry: mkSheet(deviceRows),
    'Setup_&_Dashboard': { getRange: () => ({ getValue: () => c9 }) }
  };
  const ss = { getSheetByName: n => sheets[n] || null };
  const ctx = vm.createContext({
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    SpreadsheetApp: { flush: () => {} },
    PropertiesService: { getScriptProperties: () => propsApi },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        const s = new Date(d).toISOString();
        return /^yyyy-MM-dd$/.test(fmt) ? s.slice(0, 10) : s;
      }
    },
    console
  });
  vm.runInContext(backendSrc, ctx);
  const env = { ctx, ss, cacheStore, propStore, pinLog: [], audit: [], sha: sha256 };
  ctx.__env = env;
  vm.runInContext(`
    jsonResponse = o => o;
    sha256Hex = s => __env.sha(s);
    logAudit = (...a) => __env.audit.push(a);
    getClassesMap = () => ({ C1: { classId: 'C1', rowIndex: 2, roomLat: ${CLASS_LAT}, roomLng: ${CLASS_LNG}, radiusMeters: 100 } });
    getClassRosterMap = () => ({ '12345678': { studentId: '12345678', fullName: 'Test Student' } });
    verifyClassroomQr = () => true;
    findExistingAttendance = (s, sid, stu, reqId) => ({ status: 'P', source: 'STUDENT_APP', requestId: reqId, attendanceStats: {} });
    logPinCheckAttempt_ = (...a) => __env.pinLog.push(a);
  `, ctx);
  return env;
}

function checkIn(env, body) {
  return env.ctx.handleStudentCheckIn(env.ss, Object.assign({
    studentId: '12345678', classId: 'C1', credential: 'cred', requestId: 'R' + Math.random(),
    lat: CLASS_LAT, lng: CLASS_LNG, accuracy: 10
  }, body), Date.now());
}

// ---------------------------------------------------------------- C1: GPS validation
console.log('--- C1: GPS gate (' + path.basename(backendPath) + ') ---');
const FAR_LAT = 10.85; // ~5.5 km from the room
check('inside the room is accepted', () => {
  assert.strictEqual(checkIn(buildEnv({ sessionRows: [sessionRow()] }), {}).ok, true);
});
check('missing accuracy (defaults to 999) inside the room is accepted', () => {
  assert.strictEqual(checkIn(buildEnv({ sessionRows: [sessionRow()] }), { accuracy: undefined }).ok, true);
});
check('5 km away is rejected', () => {
  const r = checkIn(buildEnv({ sessionRows: [sessionRow()] }), { lat: FAR_LAT });
  assert.strictEqual(r.code, 'ERR_LOCATION_OUT_OF_RANGE');
});
check('5 km away with non-numeric accuracy is rejected', () => {
  const r = checkIn(buildEnv({ sessionRows: [sessionRow()] }), { lat: FAR_LAT, accuracy: 'abc' });
  assert.strictEqual(r.ok, false, 'got ' + JSON.stringify(r.code));
});
check('lat "Infinity" is rejected', () => {
  const r = checkIn(buildEnv({ sessionRows: [sessionRow()] }), { lat: 'Infinity' });
  assert.strictEqual(r.ok, false, 'got ' + JSON.stringify(r.code));
});
check('lng "Infinity" is rejected', () => {
  const r = checkIn(buildEnv({ sessionRows: [sessionRow()] }), { lng: 'Infinity' });
  assert.strictEqual(r.ok, false, 'got ' + JSON.stringify(r.code));
});
check('out-of-range latitude (200) is rejected', () => {
  const r = checkIn(buildEnv({ sessionRows: [sessionRow()] }), { lat: 200 });
  assert.strictEqual(r.ok, false, 'got ' + JSON.stringify(r.code));
});
check('LOCKED anchor + 5 km + non-numeric accuracy is rejected', () => {
  const env = buildEnv({ sessionRows: [sessionRow()] });
  env.cacheStore['SES_ANCHOR_SES_C1_1'] = JSON.stringify({ mode: 'LOCKED', lat: CLASS_LAT, lng: CLASS_LNG, source: 'TEACHER_GPS' });
  const r = checkIn(env, { lat: FAR_LAT, accuracy: 'abc' });
  assert.strictEqual(r.ok, false, 'got ' + JSON.stringify(r.code));
});
check('negative accuracy is rejected as GPS unavailable', () => {
  assert.strictEqual(checkIn(buildEnv({ sessionRows: [sessionRow()] }), { accuracy: -5 }).code, 'ERR_GPS_UNAVAILABLE');
});

// ---------------------------------------------------------------- C2: STUDENT_AVG_3 first sample
console.log('--- C2: STUDENT_AVG_3 first-sample campus check ---');
function collectingEnv() {
  const env = buildEnv({ sessionRows: [sessionRow()] });
  env.cacheStore['SES_ANCHOR_SES_C1_1'] = JSON.stringify({
    mode: 'COLLECTING_AVG_3', campusLat: CLASS_LAT, campusLng: CLASS_LNG, maxCampusMeters: 850, samples: []
  });
  return env;
}
check('first sample 5 km away is rejected', () => {
  const r = checkIn(collectingEnv(), { lat: FAR_LAT });
  assert.strictEqual(r.code, 'ERR_LOCATION_OUT_OF_RANGE');
});
check('first sample ~500 m away (inside campus) is accepted', () => {
  assert.strictEqual(checkIn(collectingEnv(), { lat: 10.8045 }).ok, true);
});
check('first sample in the room is accepted', () => {
  assert.strictEqual(checkIn(collectingEnv(), {}).ok, true);
});
check('first sample ~800 m away is accepted, ~900 m away is rejected', () => {
  assert.strictEqual(checkIn(collectingEnv(), { lat: 10.8072 }).ok, true);
  const r = checkIn(collectingEnv(), { lat: 10.8081 });
  assert.strictEqual(r.code, 'ERR_LOCATION_OUT_OF_RANGE');
  assert.strictEqual(r.params.max, 850);
});
check('mock-GPS-flagged first sample is not stored', () => {
  const env = collectingEnv();
  checkIn(env, { clientMeta: { mockGpsSuspect: true } });
  assert.strictEqual(JSON.parse(env.cacheStore['SES_ANCHOR_SES_C1_1']).samples.length, 0);
});

// ---------------------------------------------------------------- H1: teacher auth
console.log('--- H1: teacher auth lockout ---');
const MASTER = 'TKEY_masterkeymasterkey';
function authEnv(extra = {}) {
  return buildEnv(Object.assign({
    props: { TEACHER_MASTER_KEY: MASTER, TEMP_PC_CODE: '123456', TEMP_PC_EXPIRES: String(Date.now() + 3600e3) },
    c9: 'Temp PC Code:\n123456\n(Valid 2 Hours)'
  }, extra));
}
const verify = (env, token, fp) => env.ctx.verifyTeacherToken(env.ss, token, { deviceFp: fp || 'fp0' });

check('valid 6-digit code and Master Key are accepted', () => {
  const env = authEnv();
  assert.strictEqual(verify(env, '123456').ok, true);
  assert.strictEqual(verify(env, MASTER).mode, 'MASTER');
});
check('wrong code is rejected', () => {
  assert.strictEqual(verify(authEnv(), '000000').ok, false);
});
check('rotating deviceFp does not bypass the lockout', () => {
  const env = authEnv();
  let last;
  for (let i = 0; i < 60; i++) last = verify(env, String(100000 + i), 'fp_' + i);
  assert.strictEqual(last.code, 'ERR_AUTH_LOCKED', 'got ' + last.code);
});
check('after global lockout the correct 6-digit code is refused', () => {
  const env = authEnv();
  for (let i = 0; i < 60; i++) verify(env, String(100000 + i), 'fp_' + i);
  assert.strictEqual(verify(env, '123456', 'fresh_fp').ok, false);
});
check('Master Key still works during global lockout', () => {
  const env = authEnv();
  for (let i = 0; i < 60; i++) verify(env, String(100000 + i), 'fp_' + i);
  assert.strictEqual(verify(env, MASTER, 'fresh_fp').ok, true);
});
check('audit log is not spammed during a brute-force run', () => {
  const env = authEnv();
  for (let i = 0; i < 60; i++) verify(env, String(100000 + i), 'fp_' + i);
  assert.ok(env.audit.length <= 3, 'audit rows: ' + env.audit.length);
});
check('missing TEMP_PC_EXPIRES means the code is not valid', () => {
  const env = authEnv();
  delete env.propStore.TEMP_PC_EXPIRES;
  assert.strictEqual(verify(env, '123456').ok, false);
});
check('expired code is rejected', () => {
  const env = authEnv();
  env.propStore.TEMP_PC_EXPIRES = String(Date.now() - 1000);
  assert.strictEqual(verify(env, '123456').ok, false);
});
check('non-6-digit text in C9 is not accepted as a password', () => {
  const env = authEnv({ c9: 'letmein' });
  env.propStore.TEMP_PC_CODE = '654321';
  assert.strictEqual(verify(env, 'letmein').ok, false);
});
check('6-digit code in C9 is still accepted', () => {
  const env = authEnv({ c9: 'Temp PC Code:\n777777\n(Valid 2 Hours)' });
  env.propStore.TEMP_PC_CODE = '654321';
  assert.strictEqual(verify(env, '777777').ok, true);
});

// ---------------------------------------------------------------- M5: credential before PIN guard
console.log('--- M5: PIN attempts must not touch other students ---');
function pinEnv(deviceRows) {
  const env = buildEnv({ sessionRows: [sessionRow({ qrMode: 'PIN_10S' })], deviceRows });
  env.ctx.verifyClassroomQr = (payload, cfg, ses) => {
    ses._lastPinEval = { code: 'PIN_WRONG', cleanedPin: '1234', serverBucket: 1, studentBucket: 1, offsetIntoBucketMs: 0, deltaMs: 0, graceMs: 0 };
    return false;
  };
  return env;
}
const dev = hash => ['12345678', 'Test Student', hash, '', 'ACTIVE', 0, ''];
check('foreign device with a wrong PIN gets ERR_CREDENTIAL_MISMATCH and no PIN log', () => {
  const env = pinEnv([dev(sha256('someone_elses_cred'))]);
  const r = checkIn(env, { qrPayload: 'PIN10:9999' });
  assert.strictEqual(r.code, 'ERR_CREDENTIAL_MISMATCH', 'got ' + r.code);
  assert.strictEqual(env.pinLog.length, 0, 'pin log rows: ' + env.pinLog.length);
});
check('owner device with a wrong PIN still gets PIN_WRONG and is logged', () => {
  const env = pinEnv([dev(sha256('cred'))]);
  const r = checkIn(env, { qrPayload: 'PIN10:9999' });
  assert.strictEqual(r.code, 'PIN_WRONG');
  assert.strictEqual(env.pinLog.length, 1);
});
check('unregistered student with a wrong PIN still gets PIN_WRONG', () => {
  const r = checkIn(pinEnv([]), { qrPayload: 'PIN10:9999' });
  assert.strictEqual(r.code, 'PIN_WRONG');
});
check('PIN_10S without a PIN still returns ERR_PIN_REQUIRED', () => {
  const r = checkIn(pinEnv([dev(sha256('cred'))]), { qrPayload: 'BUTTON_GPS_CHECKIN' });
  assert.strictEqual(r.code, 'ERR_PIN_REQUIRED');
});

// ---------------------------------------------------------------- parity
console.log('--- Parity: mergeAttendance / PIN / score formula ---');
function extractFns(src, names) {
  return names.map(n => {
    const m = src.match(new RegExp('function ' + n + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'));
    assert.ok(m, 'cannot extract ' + n);
    return m[0];
  }).join('\n');
}
const scCtx = vm.createContext({});
vm.runInContext(extractFns(scSrc, ['normalizeAttendanceStatusCode', 'mergeAttendance', 'computePin4FromSeed']), scCtx);
const syncCtx = vm.createContext({});
vm.runInContext(extractFns(syncSrc, ['normalizeAttendanceStatusCodeSync_', 'mergeAttendanceSync_']), syncCtx);
const beCtx = buildEnv().ctx;
const stCtx = vm.createContext({});
vm.runInContext(extractFns(stSrc, ['computeAttendanceScoreAndExamStatus']), stCtx);

function oracleMerge(p1, p2, opened) {
  if (!opened) return p1;
  if (p1 === 'E' || p2 === 'E') return 'E';
  if (p2 !== 'P' && p2 !== 'L') return '-';
  return p1 === 'P' ? 'P' : 'L';
}
check('mergeAttendance: frontend, backend and sync fallback match the RULES truth table', () => {
  const S = ['P', 'L', 'E', '-'];
  S.forEach(p1 => ['P', 'L', 'E', '-', ''].forEach(p2 => {
    const opened = p2 !== '';
    const expected = oracleMerge(p1, p2, opened);
    const tag = p1 + '/' + p2 + '/' + opened;
    assert.strictEqual(scCtx.mergeAttendance(p1, p2, opened), expected, 'frontend ' + tag);
    assert.strictEqual(beCtx.mergeAttendance(p1, p2, opened), expected, 'backend ' + tag);
    assert.strictEqual(syncCtx.mergeAttendanceSync_(p1, p2, opened), expected, 'sync ' + tag);
    // explicit "opened" with an empty P2 means the student did not show up in round 2
    assert.strictEqual(scCtx.mergeAttendance(p1, p2, true), oracleMerge(p1, p2, true), 'frontend opened ' + tag);
    assert.strictEqual(beCtx.mergeAttendance(p1, p2, true), oracleMerge(p1, p2, true), 'backend opened ' + tag);
    assert.strictEqual(syncCtx.mergeAttendanceSync_(p1, p2, true), oracleMerge(p1, p2, true), 'sync opened ' + tag);
  }));
});
check('mergeAttendance: undefined p2Opened with empty P2 returns Phien 1', () => {
  ['P', 'L', 'E', '-'].forEach(p1 => {
    assert.strictEqual(scCtx.mergeAttendance(p1, ''), p1);
    assert.strictEqual(beCtx.mergeAttendance(p1, ''), p1);
    assert.strictEqual(syncCtx.mergeAttendanceSync_(p1, ''), p1);
  });
});
check('computePin4FromSeed: frontend and backend agree', () => {
  ['seedA', 'abc123def456', 'QR_X_Y', ''].forEach(seed => [0, 1, 7, 170000000, 170000001].forEach(b => {
    const a = scCtx.computePin4FromSeed(seed, b);
    assert.ok(/^\d{4}$/.test(a), 'format ' + a);
    assert.strictEqual(beCtx.computePin4FromSeed(seed, b), a, seed + ':' + b);
  }));
});
check('score formula (student.js) matches RULES section 3', () => {
  for (let A = 0; A <= 8; A++) for (let L = 0; L <= 6; L++) for (let E = 0; E <= 8; E++) {
    const equiv = Math.round((A + E * 0.5) * 10) / 10;
    const score = Math.round((10 - A - L * 0.5 - E * 0.5) * 10) / 10;
    const banned = equiv > 6.0 || score < 0.0;
    const warn = !banned && ((equiv >= 5.5 && equiv <= 6.0) || (score >= 0.0 && score <= 1.0));
    const r = stCtx.computeAttendanceScoreAndExamStatus(1, L, E, A, false);
    const tag = 'A' + A + ' L' + L + ' E' + E;
    assert.strictEqual(r.attendanceScore, score, 'score ' + tag);
    assert.strictEqual(r.equivAbsences, equiv, 'equiv ' + tag);
    assert.strictEqual(r.examStatus, banned ? 'BAN' : (warn ? 'WARN' : 'OK'), 'status ' + tag);
  }
});
check('score formula: backend source still carries the same rules', () => {
  const warnExpr = '(equivAbsences >= 5.5 && equivAbsences <= 6.0) || (attendanceScore >= 0.0 && attendanceScore <= 1.0)';
  assert.ok(backendSrc.split(warnExpr).length - 1 >= 2, 'warn expression should appear in both backend score paths');
  assert.ok(backendSrc.split('(equivAbsences > 6.0) || (attendanceScore < 0.0)').length - 1 >= 2, 'ban expression');
});

console.log(failures ? '\n' + failures + ' CORE TEST(S) FAILED' : '\nALL CORE TESTS PASSED!');
process.exit(failures ? 1 : 0);
