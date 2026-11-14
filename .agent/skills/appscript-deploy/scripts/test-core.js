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

// ---------------------------------------------------------------- C3: no key in Sheet, private pairing dialog, QR encoder
console.log('--- C3: pairing QR is not stored in the Sheet; dialog + QR encoder ---');
const LINK_B64 = s => Buffer.from(s, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
function dashRecorder(vals) {
  const log = [];
  const mk = a1 => {
    const o = { getValue: () => (vals[a1] === undefined ? '' : vals[a1]) };
    ['setFormula', 'setValue'].forEach(m => { o[m] = v => { log.push({ m, a1, v }); return o; }; });
    ['clearContent', 'setFontColor', 'setFontSize', 'setFontWeight'].forEach(m => { o[m] = () => { log.push({ m, a1 }); return o; }; });
    return o;
  };
  return { log, getRange: a1 => mk(a1) };
}
function c3Env(lecturer) {
  const env = buildEnv({ props: { TEACHER_MASTER_KEY: MASTER } });
  env.ctx.Utilities.base64EncodeWebSafe = LINK_B64;
  const dash = dashRecorder({
    B2: lecturer || 'Dr. Test', B3: 'INST123', B4: 'https://script.google.com/macros/s/AKfake/exec', B5: 'https://example.github.io/ccs/'
  });
  env.dash = dash;
  env.ssDash = { getSheetByName: n => (n === 'Setup_&_Dashboard' ? dash : env.ss.getSheetByName(n)) };
  return env;
}
const hasSecret = s => s.indexOf(MASTER) >= 0 || /tkey/i.test(s);
check('B9 after updateDashboardQRs has no IMAGE formula, quickchart, master key or tkey', () => {
  const env = c3Env();
  env.ctx.updateDashboardQRs(env.ssDash);
  const b9 = env.dash.log.filter(e => e.a1 === 'B9');
  assert.ok(b9.length > 0, 'B9 was never written');
  const s = JSON.stringify(b9);
  assert.ok(!/IMAGE\s*\(/i.test(s) && !/quickchart/i.test(s) && !hasSecret(s), s);
  assert.ok(!b9.some(e => e.m === 'setFormula'), 'B9 has a formula');
});
check('A9 student QR formula contains no master key or tkey (including decoded payload)', () => {
  const env = c3Env();
  env.ctx.updateDashboardQRs(env.ssDash);
  const a9 = env.dash.log.filter(e => e.a1 === 'A9' && e.m === 'setFormula');
  assert.strictEqual(a9.length, 1);
  const f = a9[0].v;
  assert.ok(!hasSecret(f), 'raw formula leaks');
  const m = decodeURIComponent(f).match(/onboard=([A-Za-z0-9_\-=]+)/);
  assert.ok(m, 'onboard param not found');
  const payload = Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  assert.ok(!hasSecret(payload), 'payload leaks: ' + payload);
  assert.strictEqual(JSON.parse(payload).type, 'ONBOARD');
});
check('no Sheet write at all (any cell) contains the master key or tkey', () => {
  const env = c3Env();
  env.ctx.updateDashboardQRs(env.ssDash);
  assert.ok(!hasSecret(JSON.stringify(env.dash.log)));
});
const stripScripts = h => h.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
check('pairing dialog HTML has no img, external script, http src or quickchart', () => {
  const env = c3Env();
  const link = env.ctx.buildTeacherPairingLink_(env.ssDash);
  assert.ok(link.indexOf('/?pair=') > 0, 'link: ' + link);
  const html = env.ctx.buildTeacherPairingDialogHtml_(link, '123456', MASTER);
  assert.ok(!/<img/i.test(html), 'img');
  assert.ok(!/<script[^>]*\ssrc=/i.test(html), 'script src');
  assert.ok(!/src\s*=\s*["']?https?:/i.test(html), 'http src');
  assert.ok(!/quickchart/i.test(html), 'quickchart');
  assert.ok(html.indexOf('123456') >= 0, 'temp code missing');
});
check('master key only appears once, inside the hidden element (not in visible text before Show)', () => {
  const env = c3Env();
  const html = env.ctx.buildTeacherPairingDialogHtml_(env.ctx.buildTeacherPairingLink_(env.ssDash), '123456', MASTER);
  assert.strictEqual(html.split(MASTER).length - 1, 1, 'master key occurrences');
  const hidden = html.match(/<p id="mk" style="display:none">([^<]*)<\/p>/);
  assert.ok(hidden && hidden[1] === MASTER, 'hidden element');
  const visible = stripScripts(html).replace(hidden[0], '');
  assert.ok(visible.indexOf(MASTER) < 0, 'visible text leaks master key');
  assert.ok(!/tkey/i.test(visible), 'tkey in visible markup');
});
check('hostile lecturer name / key cannot terminate the inline script', () => {
  const env = c3Env('</script><b>x');
  const evil = '</script><b>x';
  const link = env.ctx.buildTeacherPairingLink_(env.ssDash);
  const h1 = env.ctx.buildTeacherPairingDialogHtml_(link, evil, evil);
  const h2 = env.ctx.buildTeacherPairingDialogHtml_('https://x/?n=' + evil, '123456', MASTER);
  [h1, h2].forEach((h, i) => {
    assert.strictEqual(h.split('</script>').length - 1, 1, 'closers in html ' + (i + 1));
    assert.ok(h.indexOf('<b>x') < 0, 'raw <b>x in html ' + (i + 1));
  });
  assert.ok(h2.indexOf('\\u003c/script\\u003e\\u003cb\\u003ex') > 0, 'link not JSON-escaped in script');
  assert.strictEqual(env.ctx.toInlineScriptJson_(evil).indexOf('<'), -1);
});
check('showTeacherPairingDialog renders the dialog with the key only hidden and no Sheet leakage', () => {
  const env = c3Env();
  let shown = null, outHtml = '';
  env.ctx.SpreadsheetApp.getActiveSpreadsheet = () => env.ssDash;
  env.ctx.SpreadsheetApp.getUi = () => ({ showModalDialog: (o, t) => { shown = { o, t }; } });
  env.ctx.HtmlService = { createHtmlOutput: h => { outHtml = h; const o = { setWidth: () => o, setHeight: () => o }; return o; } };
  env.ctx.showTeacherPairingDialog();
  assert.ok(shown, 'dialog not shown');
  assert.ok(outHtml.indexOf('?pair=') > 0 && outHtml.split(MASTER).length - 1 === 1);
  assert.ok(!hasSecret(JSON.stringify(env.dash.log)), 'Sheet leak');
});

const QR_SRC = vm.runInContext('QR_ENCODER_JS_', buildEnv().ctx);
const qrCtx = vm.createContext({});
vm.runInContext(QR_SRC, qrCtx);
const qrM = t => qrCtx.qrEncode(t).map(r => Array.from(r));
const bchRem = (val, poly, deg) => { let n = val; for (let i = 31; i >= deg; i--) if ((n >>> i) & 1) n ^= poly << (i - deg); return n; };
check('QR encoder source has no "</" (safe to inline in a script element)', () => {
  assert.ok(QR_SRC.indexOf('</') < 0);
});
check('QR ~450-char link: square n=17+4v, v=16, finders, timing, valid BCH format bits, copies agree', () => {
  const link = 'https://example.github.io/ccs/?pair=' + 'Ab9-_'.repeat(82);
  assert.ok(link.length >= 440 && link.length <= 450);
  const m = qrM(link), n = m.length, v = (n - 17) / 4;
  assert.ok(Number.isInteger(v) && v === 16, 'version ' + v);
  m.forEach(r => assert.strictEqual(r.length, n));
  [[0, 0], [0, n - 7], [n - 7, 0]].forEach(([r0, c0]) => {
    for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
      const d = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      assert.strictEqual(m[r0 + r][c0 + c], d !== 2, 'finder ' + r0 + ',' + c0 + ' @' + r + ',' + c);
    }
  });
  for (let i = 8; i < n - 8; i++) {
    assert.strictEqual(m[6][i], i % 2 === 0, 'timing row ' + i);
    assert.strictEqual(m[i][6], i % 2 === 0, 'timing col ' + i);
  }
  const A = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const B = []; for (let r = n - 1; r >= n - 7; r--) B.push([r, 8]); for (let c = n - 8; c < n; c++) B.push([8, c]);
  const rd = l => parseInt(l.map(([r, c]) => (m[r][c] ? '1' : '0')).join(''), 2);
  const fa = rd(A), fb = rd(B);
  assert.strictEqual(fa, fb, 'format copies differ');
  assert.strictEqual(bchRem(fa ^ 0x5412, 0x537, 10), 0, 'format BCH');
  assert.strictEqual(((fa ^ 0x5412) >>> 13), 0, 'ECL must be M');
  assert.strictEqual(m[n - 8][8], true, 'dark module');
});
check('QR encoder: short string works (v1, 21x21) and is deterministic', () => {
  const m = qrM('hello');
  assert.strictEqual(m.length, 21);
  assert.deepStrictEqual(qrM('hello'), m);
});
check('QR encoder: text over capacity throws "Text too long" (no silent garbage)', () => {
  assert.throws(() => qrCtx.qrEncode('q'.repeat(800)), /too long/i);
  assert.throws(() => qrCtx.qrEncode('q'.repeat(667)), /too long/i);
  assert.strictEqual(qrCtx.qrEncode('q'.repeat(666)).length, 97);
});

// ---------------------------------------------------------------- H3: PING data minimisation, receipts
console.log('--- H3: PING / receipt data minimisation ---');
const GOOD_CRED = 'c'.repeat(24);
function pingEnv(deviceRows) {
  const env = buildEnv({ deviceRows: deviceRows || [] });
  vm.runInContext(`
    getClassesMap = () => ({ C1: { classId: 'C1', className: 'Class One', regOpen: true, activeQrSecret: 'QR_C1_SECRETXX' } });
    getAllLatestSessionsMap = () => ({});
    getStoredClassSchedulesMap = () => ({});
    getTodayCalendarEventsCached = () => [{ title: 'C1', startTime: 'S', endTime: 'E' }, { title: 'nomatch', startTime: 'S', endTime: 'E' }];
    getStudentAttendanceStatsMap = () => ({ C1: { present: 1 } });
    getActiveGroupSplitForClass_ = () => ({ groups: 2 });
    getLatestOpenSession = () => null;
    getStudentClassAttendanceStats = () => ({});
  `, env.ctx);
  return env;
}
const ping = (env, body) => env.ctx.handlePing(env.ss, Object.assign({ action: 'PING' }, body));
const devRow = (hash, status) => ['12345678', 'Test Student', hash, '', status || 'ACTIVE', 0, ''];
check('PING without credential: classes present, no studentStats / activeGroupSplit, studentAuth false', () => {
  const r = ping(pingEnv(), {});
  assert.strictEqual(r.ok, true);
  assert.ok(Array.isArray(r.classes) && r.classes.length === 1);
  assert.ok(!('studentStats' in r), 'studentStats');
  assert.ok(!r.classes.some(c => 'activeGroupSplit' in c), 'activeGroupSplit');
  assert.strictEqual(r.studentAuth, false);
});
check('legacy PING with only studentId gets no private data', () => {
  const r = ping(pingEnv([devRow(sha256(GOOD_CRED))]), { studentId: '12345678' });
  assert.ok(!('studentStats' in r) && !r.classes.some(c => 'activeGroupSplit' in c));
  assert.strictEqual(r.studentAuth, false);
});
check('PING with wrong credential gets no stats', () => {
  const r = ping(pingEnv([devRow(sha256(GOOD_CRED))]), { studentId: '12345678', credential: 'x'.repeat(24) });
  assert.ok(!('studentStats' in r) && r.studentAuth === false);
});
check('PING with credential matching cached DEV_HASH is authed with studentStats', () => {
  const env = pingEnv();
  env.cacheStore['DEV_HASH_12345678'] = sha256(GOOD_CRED);
  const r = ping(env, { studentId: '12345678', credential: GOOD_CRED });
  assert.strictEqual(r.studentAuth, true);
  assert.ok(r.studentStats && r.studentStats.C1);
  assert.ok(r.classes.some(c => 'activeGroupSplit' in c), 'on-roster student gets group split');
});
check('PING authed via Device_Registry ACTIVE row caches DEV_HASH afterwards', () => {
  const env = pingEnv([devRow(sha256(GOOD_CRED))]);
  assert.ok(!('DEV_HASH_12345678' in env.cacheStore));
  const r = ping(env, { studentId: '12345678', credential: GOOD_CRED });
  assert.strictEqual(r.studentAuth, true);
  assert.ok('studentStats' in r);
  assert.strictEqual(env.cacheStore['DEV_HASH_12345678'], sha256(GOOD_CRED));
});
check('credential shorter than 16 chars is never authed (even if the hash matches)', () => {
  const short = 'c'.repeat(15);
  const env = pingEnv([devRow(sha256(short))]);
  env.cacheStore['DEV_HASH_12345678'] = sha256(short);
  const r = ping(env, { studentId: '12345678', credential: short });
  assert.strictEqual(r.studentAuth, false);
  assert.ok(!('studentStats' in r));
});
check('REVOKED registry row is never authed', () => {
  const r = ping(pingEnv([devRow(sha256(GOOD_CRED), 'REVOKED')]), { studentId: '12345678', credential: GOOD_CRED });
  assert.strictEqual(r.studentAuth, false);
  assert.ok(!('studentStats' in r));
});
check('authed student NOT on the class roster gets no activeGroupSplit key', () => {
  const env = pingEnv([devRow(sha256(GOOD_CRED))]);
  vm.runInContext('getClassRosterMap = () => ({ "99999999": { studentId: "99999999", fullName: "Other" } });', env.ctx);
  const r = ping(env, { studentId: '12345678', credential: GOOD_CRED });
  assert.strictEqual(r.studentAuth, true);
  assert.ok(!r.classes.some(c => 'activeGroupSplit' in c), 'activeGroupSplit leaked');
});
check('PING public class entries never carry activeQrSecret', () => {
  const env = pingEnv([devRow(sha256(GOOD_CRED))]);
  const r = ping(env, { studentId: '12345678', credential: GOOD_CRED });
  assert.ok(!JSON.stringify(r).includes('QR_C1_SECRETXX') && !r.classes.some(c => 'activeQrSecret' in c));
});
check('filterCalendarEventsForPing_: matching event -> {classId,startTime,endTime} without title; unmatched dropped', () => {
  const env = pingEnv();
  const out = env.ctx.filterCalendarEventsForPing_(
    [{ title: 'C1', startTime: 'S1', endTime: 'E1' }, { title: 'unrelated meeting', startTime: 'S2', endTime: 'E2' }],
    [{ classId: 'C1', className: 'Class One' }]);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual(Object.keys(out[0]).sort(), ['classId', 'endTime', 'startTime']);
  assert.ok(!('title' in out[0]));
  assert.strictEqual(out[0].classId, 'C1');
  const ping1 = ping(env, {});
  assert.ok(ping1.calendarEvents.length === 1 && !('title' in ping1.calendarEvents[0]));
});
check('collectStudentEnrolledClasses_ items have no activeQrSecret', () => {
  const env = pingEnv();
  const classes = { C1: { classId: 'C1', className: 'Class One', regOpen: true, activeQrSecret: 'QR_C1_SECRETXX' } };
  const res = env.ctx.collectStudentEnrolledClasses_(env.ss, classes, {}, '12345678');
  assert.strictEqual(res.enrolledClasses.length, 1);
  res.enrolledClasses.forEach(c => assert.ok(!('activeQrSecret' in c)));
  assert.ok(!JSON.stringify(res).includes('QR_C1_SECRETXX'));
});
function receiptEnv() {
  const env = buildEnv({ sessionRows: [sessionRow()] });
  const att = mkSheet([]);
  env.ssAtt = { getSheetByName: n => (n === 'Attendance_Log' ? att : env.ss.getSheetByName(n)) };
  return env;
}
const RECEIPT = sid => JSON.stringify({ attendanceId: 'A1', requestId: 'RQ1', studentId: sid, status: 'P', classId: 'C1' });
check('CHECK_RECEIPT: cached receipt of another student is not returned', () => {
  const env = receiptEnv();
  env.cacheStore['REQ_REC_RQ1'] = RECEIPT('99999999');
  const r = env.ctx.handleCheckReceipt(env.ssAtt, { requestId: 'RQ1', studentId: '12345678' });
  assert.strictEqual(r.ok, false);
  assert.ok(!r.receipt && !JSON.stringify(r).includes('99999999'));
});
check('CHECK_RECEIPT: same-student cache hit still returns RECEIPT_FOUND', () => {
  const env = receiptEnv();
  env.cacheStore['REQ_REC_RQ1'] = RECEIPT('12345678');
  const r = env.ctx.handleCheckReceipt(env.ssAtt, { requestId: 'RQ1', studentId: '12345678' });
  assert.strictEqual(r.code, 'RECEIPT_FOUND');
  assert.strictEqual(r.receipt.studentId, '12345678');
});
check('check-in pre-lock cache: another student\'s cached receipt is not returned as CONFIRMED_*', () => {
  const env = buildEnv({ sessionRows: [sessionRow()] });
  env.cacheStore['REQ_REC_RQX'] = RECEIPT('99999999');
  const r = checkIn(env, { requestId: 'RQX' });
  assert.ok(!(r.receipt && r.receipt.studentId === '99999999'), 'leaked other student receipt');
  assert.ok(!/^CONFIRMED_/.test(String(r.code)) || !r.receipt || r.receipt.studentId !== '99999999');
});
check('check-in pre-lock cache: same student\'s cached receipt still returns CONFIRMED_PRESENT', () => {
  const env = buildEnv({ sessionRows: [sessionRow()] });
  env.cacheStore['REQ_REC_RQY'] = RECEIPT('12345678');
  const r = checkIn(env, { requestId: 'RQY' });
  assert.strictEqual(r.code, 'CONFIRMED_PRESENT');
});

// ---------------------------------------------------------------- H4: no static class secrets / PIN seed fallback (frontend)
console.log('--- H4: frontend carries no class secrets ---');
const jsDir = path.join(ROOT, 'js');
const feFiles = fs.readdirSync(jsDir).filter(f => /\.js$/.test(f)).map(f => ['js/' + f, fs.readFileSync(path.join(jsDir, f), 'utf8')])
  .concat([['index.html', fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')]]);
const teaSrc = fs.readFileSync(path.join(jsDir, 'teacher.js'), 'utf8');
check('no KNOWN_CLASS_SECRETS anywhere in js/*.js or index.html', () => {
  feFiles.forEach(([f, s]) => assert.ok(s.indexOf('KNOWN_CLASS_SECRETS') < 0, f));
});
check('no literal QR_<CLASS>_<TOKEN> secret in js/*.js or index.html', () => {
  feFiles.forEach(([f, s]) => {
    const m = s.match(/QR_[A-Z0-9]+_[A-Z0-9]{4,}/);
    assert.ok(!m, f + ': ' + (m && m[0]));
  });
});
check('teacher.js PIN seed does not fall back to activeQrSecret', () => {
  assert.ok(!/activeQrSecret/.test(teaSrc), 'activeQrSecret referenced in teacher.js');
  assert.ok(/const seed = String\(\(ses && ses\.pinSeed\) \|\| ''\)/.test(teaSrc), 'seed expression');
});
check('projector shows ---- when pinSeed is missing, real PIN when present (extracted code)', () => {
  const m = teaSrc.match(/const seed = [\s\S]*?: '0000'\);/);
  assert.ok(m, 'cannot extract PIN expression');
  const run = new Function('ses', 'getTeacherSyncedNowMs', 'computePin4FromSeed',
    m[0] + '\nreturn pin4;');
  const f = (ses) => run(ses, () => 1700000000000, scCtx.computePin4FromSeed);
  assert.strictEqual(f({}), '----');
  assert.strictEqual(f({ activeQrSecret: 'QR_C1_SECRETXX' }), '----');
  assert.strictEqual(f({ pinSeed: '' }), '----');
  assert.strictEqual(f(null), '----');
  const pin = f({ pinSeed: 'abc123def456' });
  assert.ok(/^\d{4}$/.test(pin), pin);
});

// ---------------------------------------------------------------- M16: Master Key does not linger in the DOM / URL
console.log('--- M16: teacher token handling in the browser ---');
const fnBody = (src, name) => {
  const m = src.match(new RegExp('(?:async )?function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'));
  assert.ok(m, 'cannot extract ' + name);
  return m[0];
};
check('?pair= deep link: URL is cleaned (replaceState) BEFORE loginTeacher runs (extracted function)', () => {
  const events = [];
  const payload = LINK_B64(JSON.stringify({ type: 'TEACHER_PAIR', api: 'https://script.google.com/macros/s/AKfake/exec', tkey: MASTER }));
  const els = { 'inp-tea-api': { value: '' }, 'inp-tea-token': { value: '' } };
  const win = { location: { search: '?pair=' + payload, pathname: '/ccs/', hash: '' } };
  const sandbox = {
    window: win, location: win.location, URLSearchParams, atob: s => Buffer.from(s, 'base64').toString('binary'),
    history: { replaceState: (a, b, url) => { events.push('replaceState:' + url); } },
    document: { getElementById: id => els[id] || null },
    switchMode: m => events.push('switchMode:' + m),
    normalizeApiUrl: u => u,
    loginTeacher: () => { events.push('loginTeacher:' + els['inp-tea-token'].value); },
    getStudentProfiles: () => ({}), safeSetLocal: () => {}
  };
  const c = vm.createContext(sandbox);
  vm.runInContext(fnBody(scSrc, 'handleUrlDeepLinks') + '\nhandleUrlDeepLinks();', c);
  assert.deepStrictEqual(events.map(e => e.split(':')[0]), ['replaceState', 'switchMode', 'loginTeacher'], events.join(' | '));
  assert.strictEqual(events[0], 'replaceState:/ccs/', 'replaceState must drop the query string');
  assert.strictEqual(events[2], 'loginTeacher:' + MASTER);
});
check('schedule-config.js ?pair= branch: replaceState precedes loginTeacher() (static)', () => {
  const branch = scSrc.slice(scSrc.indexOf('else if (pairB64)'));
  const a = branch.indexOf('history.replaceState'), b = branch.indexOf('loginTeacher()');
  assert.ok(a > 0 && b > 0 && a < b, 'order ' + a + '/' + b);
});
check('restoreTeacherSessionOnLoad no longer copies the stored token into inp-tea-token', () => {
  const body = fnBody(teaSrc, 'restoreTeacherSessionOnLoad');
  assert.ok(!/tokenInput\.value\s*=/.test(body), 'assigns tokenInput.value');
  assert.ok(!/inp-tea-token['"]\)\.value\s*=/.test(body), 'assigns inp-tea-token value');
  assert.ok(!/auth\.token/.test(body), 'reads auth.token');
});
check('loginTeacher clears the token input after a successful login (after saveTeacherAuth)', () => {
  const body = fnBody(teaSrc, 'loginTeacher');
  const a = body.indexOf('saveTeacherAuth('), b = body.indexOf("getElementById('inp-tea-token').value = ''");
  assert.ok(a > 0 && b > a, 'clear must follow saveTeacherAuth: ' + a + '/' + b);
});
check('logoutTeacher also clears the token input', () => {
  assert.ok(/inp-tea-token'\)\.value = ''/.test(fnBody(teaSrc, 'logoutTeacher')));
});

console.log(failures ? '\n' + failures + ' CORE TEST(S) FAILED' : '\nALL CORE TESTS PASSED!');
process.exit(failures ? 1 : 0);
