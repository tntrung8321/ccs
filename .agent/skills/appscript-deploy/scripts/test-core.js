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
    'Setup_&_Dashboard': { getRange: () => ({ getValue: () => c9, clearContent: () => {} }) }
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
check('6-digit code typed into C9 is NOT accepted any more', () => {
  const env = authEnv({ c9: 'Temp PC Code:\n777777\n(Valid 2 Hours)' });
  env.propStore.TEMP_PC_CODE = '654321';
  assert.strictEqual(verify(env, '777777').ok, false);
  assert.strictEqual(verify(env, '654321').ok, true);
});
check('refreshTempPcCode(forceNew) rotates the code and clears C9; old code stops working', () => {
  const env = authEnv();
  const fresh = env.ctx.refreshTempPcCode(env.ss, true);
  assert.notStrictEqual(fresh, '123456');
  assert.strictEqual(verify(env, '123456').ok, false);
  assert.strictEqual(verify(env, fresh).ok, true);
  assert.strictEqual(verify(env, MASTER).mode, 'MASTER');
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
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/attendance-rules.js'), 'utf8'), stCtx);
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
check('score formula: backend uses the shared rules evaluator in both stats paths', () => {
  assert.ok(backendSrc.split('applyRulesToStatEntry_(').length - 1 >= 3, 'both stats paths call applyRulesToStatEntry_');
  assert.ok(!/equivAbsences > 6\.0/.test(backendSrc), 'no hardcoded 6.0 threshold left in backend');
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

// ================================================================ v3.7.9 phase 3 regression tests
// Infra: recording sheets, lock/cache spies, and an env that loads the REAL backend + sync.txt in one vm context
// (they share one global namespace in production) WITHOUT overriding getClassesMap/getClassRosterMap.
function rsheet(rows, o) {
  o = o || {};
  const sh = { rows, header: o.header || [], writes: [], reads: [], deleted: [], events: [], ncols: o.ncols || 11, boom: false };
  const cell = (r, c) => {
    const v = r === 1 ? sh.header[c - 1] : (rows[r - 2] || [])[c - 1];
    return v === undefined ? '' : v;
  };
  const grid = (r, c, nr, nc) => {
    const out = [];
    for (let i = 0; i < nr; i++) { const line = []; for (let j = 0; j < nc; j++) line.push(cell(r + i, c + j)); out.push(line); }
    return out;
  };
  sh.getLastRow = () => rows.length + 1;
  sh.getLastColumn = () => sh.ncols;
  sh.getName = () => o.name || '';
  sh.appendRow = r => { rows.push(r); };
  sh.deleteRow = r => { rows.splice(r - 2, 1); sh.deleted.push(r); };
  sh.getRange = (r, c, nr, nc) => {
    nr = nr === undefined ? 1 : nr; nc = nc === undefined ? 1 : nc;
    const rg = {};
    rg.getValues = () => { if (sh.boom) throw new Error('sheet boom'); sh.reads.push([r, c, nr, nc]); return grid(r, c, nr, nc); };
    rg.getDisplayValues = () => grid(r, c, nr, nc).map((line, i) => line.map((v, j) => {
      const k = (r + i) + ',' + (c + j);
      return o.disp && o.disp[k] !== undefined ? o.disp[k] : String(v);
    }));
    rg.setValues = vals => {
      sh.writes.push({ r, c, nr, nc, v: vals }); sh.events.push('set:' + r + ',' + c);
      vals.forEach((line, i) => line.forEach((v, j) => {
        if (r + i === 1) { sh.header[c - 1 + j] = v; return; }
        const row = rows[r + i - 2] || (rows[r + i - 2] = []);
        row[c - 1 + j] = v;
      }));
      return rg;
    };
    rg.setValue = v => { sh.writes.push({ r, c, nr, nc, v: [[v]] }); return rg; };
    rg.setNumberFormat = f => { sh.events.push('fmt:' + r + ',' + c + ':' + f); return rg; };
    ['clearContent', 'clearFormat', 'setBackground', 'setFontColor', 'setFontWeight'].forEach(m => { rg[m] = () => rg; });
    return rg;
  };
  return sh;
}

function p3Env(opts) {
  opts = opts || {};
  const cacheStore = {}, ttl = {}, removed = [];
  const cache = {
    get: k => (k in cacheStore ? cacheStore[k] : null),
    put: (k, v, t) => { cacheStore[k] = v; ttl[k] = t; },
    remove: k => { delete cacheStore[k]; },
    removeAll: ks => { removed.push(ks.slice()); ks.forEach(k => delete cacheStore[k]); }
  };
  const propStore = Object.assign({}, opts.props || {});
  const propsApi = {
    getProperty: k => (k in propStore ? propStore[k] : null),
    setProperty: (k, v) => { propStore[k] = String(v); },
    deleteProperty: k => { delete propStore[k]; }
  };
  const lock = { held: false, tryCalls: 0, releaseCalls: 0, busy: false };
  const lockSvc = { getScriptLock: () => ({
    tryLock: () => { lock.tryCalls++; if (lock.busy) return false; lock.held = true; return true; },
    releaseLock: () => { lock.releaseCalls++; lock.held = false; }
  }) };
  const sheets = Object.assign({}, opts.sheets || {});
  const ss = { getSheetByName: n => (n in sheets ? sheets[n] : null), getName: () => 'Master', getId: () => 'SSID' };
  const alerts = [];
  const ui = { alert: (...a) => { alerts.push(a); return 'YES'; }, ButtonSet: { YES_NO: 1, OK: 2 }, Button: { YES: 'YES', NO: 'NO' } };
  const ctx = vm.createContext({
    CacheService: { getScriptCache: () => cache },
    LockService: lockSvc,
    SpreadsheetApp: { flush: () => {}, getActiveSpreadsheet: () => ss, getUi: () => ui },
    PropertiesService: { getScriptProperties: () => propsApi },
    DriveApp: { getFileById: () => ({ makeCopy: () => ({ getId: () => 'BKP' }) }) },
    Utilities: {
      formatDate: (d, tz, fmt) => { const s = new Date(d).toISOString(); return /^yyyy-MM-dd$/.test(fmt) ? s.slice(0, 10) : s; }
    },
    console
  });
  vm.runInContext(backendSrc, ctx);
  if (opts.sync !== false) vm.runInContext(syncSrc, ctx);
  const env = { ctx, ss, sheets, cacheStore, ttl, removed, propStore, lock, alerts, ev: [], audit: [], sha: sha256 };
  ctx.__env = env;
  vm.runInContext(`
    jsonResponse = o => o;
    sha256Hex = s => __env.sha(s);
    logAudit = (...a) => __env.audit.push(a);
    ${opts.sync === false ? '' : 'appendAuditLog_ = (...a) => __env.audit.push(a);'}
  `, ctx);
  return env;
}
const hookState = env => vm.runInContext(`
  rebuildSingleClassGrid = (ss, id) => __env.ev.push(['rebuild', id, __env.lock.held]);
  handleTeacherGetState = (ss, b) => { __env.ev.push(['state', b.classId, __env.lock.held]); return { state: true, classId: b.classId }; };
`, env.ctx);
const classRow = (id, regOpen) => [id, 'Class ' + id, 'QR_' + id + '_XXXX', CLASS_LAT, CLASS_LNG, 100, 3, 15, regOpen === false ? 'NO' : 'YES'];
const sesRowP3 = (id, cls, extra) => {
  const now = Date.now();
  return Object.assign([id, cls, 'lbl', iso(now - 60e3), iso(now + 300e3), iso(now + 3600e3), '', CLASS_LAT, CLASS_LNG, 100, 'STATIC'], extra || {});
};
const attRowP3 = (sesId, sid, status) => ['A_' + sesId + sid, 'R', sesId, 'C1', sid, status || '-', '10:00:00', 0, 10, 'STUDENT_APP'];
const fnSrc = (src, name) => extractFns(src, [name]);

// ---------------------------------------------------------------- M3: manual mark / cancel / cache invalidation
console.log('--- M3: manual mark row re-verification, CANCEL cache hygiene, invalidateSessionAttendanceMaps_ ---');
function manualEnv(attRows, cachedMapForStudent) {
  const env = p3Env({ sheets: { Attendance_Log: rsheet(attRows), Sessions_Log: rsheet([sesRowP3('SES_C1_1', 'C1')]) } });
  hookState(env);
  vm.runInContext(`getTodayClassSessionsBundle_ = () => ({ p1Session: { sessionId: 'SES_C1_1', isOpen: true }, p2Session: null, activeSession: null, round2OpenedToday: false });`, env.ctx);
  if (cachedMapForStudent) env.cacheStore['SES_ATT_MAP_V36_SES_C1_1'] = JSON.stringify({ '12345678': cachedMapForStudent });
  return env;
}
const markP = env => env.ctx.handleTeacherManualMark(env.ss, { classId: 'C1', studentId: '12345678', status: 'L' });
check('manual mark: stale cached rowIndex pointing to another STUDENT is ignored (row untouched, scan updates the right row)', () => {
  const rows = [attRowP3('SES_C1_1', '99999999', 'P'), attRowP3('SES_C1_1', '12345678', '-')];
  const env = manualEnv(rows, { rowIndex: 2, status: 'P', studentId: '12345678' });
  const before = JSON.stringify(rows[0]);
  markP(env);
  assert.strictEqual(JSON.stringify(rows[0]), before, 'other student row was overwritten');
  assert.strictEqual(rows[1][5], 'L');
  assert.strictEqual(rows[1][9], 'TEACHER_MANUAL');
  assert.ok(env.sheets.Attendance_Log.reads.some(r => r[3] === 10), 'should have fallen back to the full scan');
});
check('manual mark: stale cached rowIndex pointing to another SESSION is ignored', () => {
  const rows = [attRowP3('SES_OTHER', '12345678', 'P'), attRowP3('SES_C1_1', '12345678', '-')];
  const env = manualEnv(rows, { rowIndex: 2 });
  const before = JSON.stringify(rows[0]);
  markP(env);
  assert.strictEqual(JSON.stringify(rows[0]), before, 'other session row was overwritten');
  assert.strictEqual(rows[1][5], 'L');
});
check('manual mark: cached rowIndex beyond the sheet is ignored and a new row is appended when nothing matches', () => {
  const rows = [attRowP3('SES_OTHER', '99999999', 'P')];
  const env = manualEnv(rows, { rowIndex: 40 });
  const before = JSON.stringify(rows[0]);
  markP(env);
  assert.strictEqual(JSON.stringify(rows[0]), before);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[1][2], 'SES_C1_1'); assert.strictEqual(rows[1][4], '12345678'); assert.strictEqual(rows[1][5], 'L');
});
check('manual mark: stale rowIndex + no matching row anywhere appends instead of clobbering', () => {
  const rows = [attRowP3('SES_C1_1', '99999999', 'P'), attRowP3('SES_C1_1', '88888888', 'P')];
  const env = manualEnv(rows, { rowIndex: 3 });
  const snap = JSON.stringify(rows);
  markP(env);
  assert.strictEqual(JSON.stringify(rows.slice(0, 2)), JSON.stringify(JSON.parse(snap)));
  assert.strictEqual(rows.length, 3);
});
check('manual mark regression: a VALID cached rowIndex still updates that row in place (no full scan)', () => {
  const rows = [attRowP3('SES_C1_1', '99999999', 'P'), attRowP3('SES_C1_1', '12345678', '-')];
  const env = manualEnv(rows, { rowIndex: 3 });
  markP(env);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[1][5], 'L');
  assert.strictEqual(rows[0][5], 'P');
  assert.ok(!env.sheets.Attendance_Log.reads.some(r => r[3] === 10), 'valid cached row should avoid the full scan');
  assert.strictEqual(env.sheets.Attendance_Log.writes.filter(w => w.c === 6).length, 1);
});
check('manual mark past day with P1+P2 and no rows: writes a row for EVERY session (P must not merge into L)', () => {
  const env = p3Env({ sheets: { Attendance_Log: rsheet([]), Sessions_Log: rsheet([sesRowP3('SES_C1_1', 'C1'), sesRowP3('SES_C1_1_R2', 'C1')]) } });
  hookState(env);
  const dayKey = vm.runInContext(`Utilities.formatDate(new Date(Date.now() - 60e3), TIMEZONE, 'yyyy-MM-dd')`, env.ctx);
  env.ctx.handleTeacherManualMark(env.ss, { classId: 'C1', studentId: '12345678', status: 'P', targetDayKey: dayKey });
  const rows = env.sheets.Attendance_Log.rows;
  assert.strictEqual(rows.length, 2);
  assert.deepStrictEqual(rows.map(r => r[2]).sort(), ['SES_C1_1', 'SES_C1_1_R2']);
  assert.ok(rows.every(r => r[5] === 'P' && r[9] === 'TEACHER_MANUAL'));
});
check('CANCEL_MISTAKEN_SESSION clears SES_ATT_MAP_V36_ of sessions of OTHER classes too,keeps unknown keys, deletes only the class rows', () => {
  const ses = rsheet([sesRowP3('SES_C1_1', 'C1'), sesRowP3('SES_C2_1', 'C2')]);
  const att = rsheet([attRowP3('SES_C1_1', '12345678', 'P'), attRowP3('SES_C2_1', '12345678', 'P')]);
  const env = p3Env({ sheets: { Sessions_Log: ses, Attendance_Log: att, Classes_Config: rsheet([classRow('C1'), classRow('C2')]) } });
  hookState(env);
  ['SES_C1_1', 'SES_C2_1', 'SES_GHOST'].forEach(id => { env.cacheStore['SES_ATT_MAP_V36_' + id] = '{}'; });
  env.cacheStore['SES_ANCHOR_SES_C1_1'] = 'x';
  const r = env.ctx.handleTeacherControlSession(env.ss, { classId: 'C1', subAction: 'CANCEL_MISTAKEN_SESSION' });
  assert.strictEqual(r.state, true, JSON.stringify(r));
  assert.ok(!('SES_ATT_MAP_V36_SES_C1_1' in env.cacheStore), 'own session map still cached');
  assert.ok(!('SES_ATT_MAP_V36_SES_C2_1' in env.cacheStore), 'other class session map still cached');
  assert.ok(!('SES_ANCHOR_SES_C1_1' in env.cacheStore));
  assert.ok('SES_ATT_MAP_V36_SES_GHOST' in env.cacheStore, 'unrelated key must survive');
  assert.deepStrictEqual(ses.rows.map(x => x[0]), ['SES_C2_1']);
  assert.deepStrictEqual(att.rows.map(x => x[2]), ['SES_C2_1']);
});
check('L7: CANCEL on a Round 2 session deletes only that R2 session + its attendance; Phiên 1 and its marks stay', () => {
  const ses = rsheet([sesRowP3('SES_C1_1', 'C1'), sesRowP3('SES_C1_1_R2', 'C1')]);
  const att = rsheet([attRowP3('SES_C1_1', '12345678', 'P'), attRowP3('SES_C1_1_R2', '12345678', 'P'), attRowP3('SES_C1_1_R2', '87654321', 'P')]);
  const env = p3Env({ sheets: { Sessions_Log: ses, Attendance_Log: att, Classes_Config: rsheet([classRow('C1')]) } });
  hookState(env);
  const r = env.ctx.handleTeacherControlSession(env.ss, { classId: 'C1', subAction: 'CANCEL_MISTAKEN_SESSION' });
  assert.strictEqual(r.state, true, JSON.stringify(r));
  assert.deepStrictEqual(ses.rows.map(x => x[0]), ['SES_C1_1']);
  assert.deepStrictEqual(att.rows.map(x => x[2]), ['SES_C1_1']);
});
check('L7: CANCEL on a Phiên 1 target still deletes the whole day (P1 + R2 of the same day)', () => {
  const ses = rsheet([sesRowP3('SES_C1_1_R2', 'C1'), sesRowP3('SES_C1_1', 'C1')]);
  const att = rsheet([attRowP3('SES_C1_1', '12345678', 'P'), attRowP3('SES_C1_1_R2', '12345678', 'P')]);
  const env = p3Env({ sheets: { Sessions_Log: ses, Attendance_Log: att, Classes_Config: rsheet([classRow('C1')]) } });
  hookState(env);
  env.ctx.handleTeacherControlSession(env.ss, { classId: 'C1', subAction: 'CANCEL_MISTAKEN_SESSION' });
  assert.strictEqual(ses.rows.length, 0);
  assert.strictEqual(att.rows.length, 0);
});
check('invalidateSessionAttendanceMaps_: clears only given ids, trims, dedupes, ignores empty/invalid entries', () => {
  const env = p3Env({ sync: false });
  ['a', 'b', 'c'].forEach(id => { env.cacheStore['SES_ATT_MAP_V36_' + id] = '{}'; });
  env.ctx.invalidateSessionAttendanceMaps_(['a', 'a', ' b ', null, '', undefined]);
  assert.strictEqual(JSON.stringify(env.removed), JSON.stringify([['SES_ATT_MAP_V36_a', 'SES_ATT_MAP_V36_b']]));
  assert.ok('SES_ATT_MAP_V36_c' in env.cacheStore && !('SES_ATT_MAP_V36_a' in env.cacheStore) && !('SES_ATT_MAP_V36_b' in env.cacheStore));
});
check('invalidateSessionAttendanceMaps_: empty / non-array / invalid input does nothing and never throws', () => {
  const env = p3Env({ sync: false });
  env.cacheStore['SES_ATT_MAP_V36_a'] = '{}';
  [[], undefined, null, 'a', 5, {}, [null, '', undefined]].forEach(v => env.ctx.invalidateSessionAttendanceMaps_(v));
  assert.strictEqual(env.removed.length, 0);
  assert.ok('SES_ATT_MAP_V36_a' in env.cacheStore);
});
check('invalidateSessionAttendanceMaps_: >100 ids are removed in chunks of at most 100', () => {
  const env = p3Env({ sync: false });
  const ids = Array.from({ length: 250 }, (_, i) => 's' + i);
  env.ctx.invalidateSessionAttendanceMaps_(ids);
  assert.deepStrictEqual(env.removed.map(a => a.length), [100, 100, 50]);
});

// ---------------------------------------------------------------- M2: session row re-check, cache keys, semester reset
console.log('--- M2: isSessionRowStillOpen_, roster/classes cache keys, new semester ---');
function stillOpenEnv(row, noSheet) {
  const sh = rsheet(row ? [row] : []);
  return p3Env({ sync: false, sheets: noSheet ? {} : { Sessions_Log: sh } });
}
const OPEN_ROW = () => sesRowP3('SES_C1_1', 'C1');
check('isSessionRowStillOpen_: sheet exception -> false', () => {
  const env = stillOpenEnv(OPEN_ROW()); env.sheets.Sessions_Log.boom = true;
  assert.strictEqual(env.ctx.isSessionRowStillOpen_(env.ss, { rowIndex: 2, sessionId: 'SES_C1_1' }, Date.now()), false);
});
check('isSessionRowStillOpen_: missing Sessions_Log sheet -> false', () => {
  const env = stillOpenEnv(null, true);
  assert.strictEqual(env.ctx.isSessionRowStillOpen_(env.ss, { rowIndex: 2, sessionId: 'SES_C1_1' }, Date.now()), false);
});
check('isSessionRowStillOpen_: empty activeSession -> false; no rowIndex -> true (no sheet read)', () => {
  const env = stillOpenEnv(null, true);
  assert.strictEqual(env.ctx.isSessionRowStillOpen_(env.ss, null, Date.now()), false);
  assert.strictEqual(env.ctx.isSessionRowStillOpen_(env.ss, undefined, Date.now()), false);
  assert.strictEqual(env.ctx.isSessionRowStillOpen_(env.ss, { sessionId: 'SES_C1_1' }, Date.now()), true);
});
check('isSessionRowStillOpen_: session id mismatch (row reused) -> false', () => {
  const env = stillOpenEnv(OPEN_ROW());
  assert.strictEqual(env.ctx.isSessionRowStillOpen_(env.ss, { rowIndex: 2, sessionId: 'SES_C1_OTHER' }, Date.now()), false);
});
check('isSessionRowStillOpen_: manually closed row -> false', () => {
  const row = OPEN_ROW(); row[6] = iso(Date.now() - 1000);
  const env = stillOpenEnv(row);
  assert.strictEqual(env.ctx.isSessionRowStillOpen_(env.ss, { rowIndex: 2, sessionId: 'SES_C1_1' }, Date.now()), false);
});
check('isSessionRowStillOpen_: unparsable manual-close text counts as closed', () => {
  const row = OPEN_ROW(); row[6] = 'garbage';
  const env = stillOpenEnv(row);
  assert.strictEqual(env.ctx.isSessionRowStillOpen_(env.ss, { rowIndex: 2, sessionId: 'SES_C1_1' }, Date.now()), false);
});
check('isSessionRowStillOpen_: open row -> true; arrival after closesAt -> false; arrival before closesAt (late request) -> true', () => {
  const env = stillOpenEnv(OPEN_ROW());
  const act = { rowIndex: 2, sessionId: 'SES_C1_1' };
  assert.strictEqual(env.ctx.isSessionRowStillOpen_(env.ss, act, Date.now()), true);
  assert.strictEqual(env.ctx.isSessionRowStillOpen_(env.ss, act, Date.now() + 2 * 3600e3), false);
  assert.strictEqual(env.ctx.isSessionRowStillOpen_(env.ss, act, 0), true);
});
function rosterEnv() {
  const roster = rsheet([[1, 123456789, 'Alice'], [2, 'AB12345', 'Bob']], { ncols: 5, disp: { '2,2': '0123456789' } });
  const env = p3Env({ sync: false, sheets: { C1: roster, Classes_Config: rsheet([classRow('C1')]) } });
  return { env, roster };
}
check('getClassRosterMap / getClassesMap write only the single V373 keys (no ROSTER_MAP_<id>_<n>, no CLASSES_MAP_V32_)', () => {
  const { env } = rosterEnv();
  env.ctx.getClassRosterMap(env.ss, 'C1', false);
  env.ctx.getClassesMap(env.ss, false);
  const keys = Object.keys(env.cacheStore).sort();
  assert.deepStrictEqual(keys, ['CLASSES_MAP_V373', 'ROSTER_MAP_V373_C1']);
  assert.ok(!keys.some(k => /^ROSTER_MAP_C1_\d+/.test(k) || /^CLASSES_MAP_V32_/.test(k)));
});
check('getClassRosterMap keeps leading-zero MSSV via the display value', () => {
  const { env } = rosterEnv();
  const m = env.ctx.getClassRosterMap(env.ss, 'C1', true);
  assert.deepStrictEqual(Object.keys(m).sort(), ['0123456789', 'AB12345']);
  assert.strictEqual(m['0123456789'].fullName, 'Alice');
});
check('roster edit with unchanged lastRow becomes visible after invalidateClassCache (and was stale before)', () => {
  const { env, roster } = rosterEnv();
  assert.strictEqual(env.ctx.getClassRosterMap(env.ss, 'C1', false)['AB12345'].fullName, 'Bob');
  roster.rows[1][2] = 'Bobby';
  assert.strictEqual(env.ctx.getClassRosterMap(env.ss, 'C1', false)['AB12345'].fullName, 'Bob', 'precondition: cache serves old data');
  env.ctx.invalidateClassCache('C1');
  assert.strictEqual(env.ctx.getClassRosterMap(env.ss, 'C1', false)['AB12345'].fullName, 'Bobby');
});
check('getClassRosterMap bypassCache always reads the sheet', () => {
  const { env, roster } = rosterEnv();
  env.ctx.getClassRosterMap(env.ss, 'C1', false);
  roster.rows[1][2] = 'Robert';
  assert.strictEqual(env.ctx.getClassRosterMap(env.ss, 'C1', true)['AB12345'].fullName, 'Robert');
});
check('startNewSemesterWizard (run): clears DEV_HASH_ for registered students and SES_ATT_MAP_V36_ for old sessions', () => {
  const dev = rsheet([['12345678', 'A', 'h', '', 'ACTIVE', 0, ''], ['sv0002', 'B', 'h', '', 'ACTIVE', 0, '']], { ncols: 7 });
  const ses = rsheet([sesRowP3('SES_C1_1', 'C1'), sesRowP3('SES_C2_1', 'C2')]);
  const att = rsheet([attRowP3('SES_C1_1', '12345678', 'P')], { ncols: 10 });
  const env = p3Env({ sheets: { Device_Registry: dev, Sessions_Log: ses, Attendance_Log: att, Classes_Config: rsheet([classRow('C1')]) } });
  ['12345678', 'SV0002', 'KEEP9999'].forEach(id => { env.cacheStore['DEV_HASH_' + id] = 'h'; });
  ['SES_C1_1', 'SES_C2_1'].forEach(id => { env.cacheStore['SES_ATT_MAP_V36_' + id] = '{}'; });
  env.cacheStore['ROSTER_MAP_V373_C1'] = '{}';
  env.ctx.startNewSemesterWizard();
  assert.ok(!('DEV_HASH_12345678' in env.cacheStore) && !('DEV_HASH_SV0002' in env.cacheStore), 'DEV_HASH left behind');
  assert.ok('DEV_HASH_KEEP9999' in env.cacheStore, 'unrelated student hash was removed');
  assert.ok(!('SES_ATT_MAP_V36_SES_C1_1' in env.cacheStore) && !('SES_ATT_MAP_V36_SES_C2_1' in env.cacheStore), 'session maps left behind');
  assert.ok(!('ROSTER_MAP_V373_C1' in env.cacheStore), 'roster cache left behind');
});
check('startNewSemesterWizard (static): reads ids before clearing, clears DEV_HASH_ and calls invalidateSessionAttendanceMaps_', () => {
  const body = fnSrc(backendSrc, 'startNewSemesterWizard');
  assert.ok(body.indexOf("'DEV_HASH_'") > 0 && body.indexOf('invalidateSessionAttendanceMaps_(') > 0);
  assert.ok(body.indexOf('devIds.push') < body.indexOf('.clearContent()'), 'ids must be collected before clearContent');
});
check('syncSingleClassRosterFromDrive_ (static): roster import invalidates the class cache', () => {
  assert.ok(/invalidateClassCache\(classId\)/.test(fnSrc(syncSrc, 'syncSingleClassRosterFromDrive_')));
});

// ---------------------------------------------------------------- M4: lock released before rebuild / state, onboard rescue
console.log('--- M4: deferred rebuild + state run outside the lock; onboard Drive rescue ---');
function ctrlEnv(rows) {
  const env = p3Env({ sheets: { Sessions_Log: rsheet(rows), Attendance_Log: rsheet([]), Classes_Config: rsheet([classRow('C1')]) } });
  hookState(env);
  return env;
}
const evKinds = env => env.ev.map(e => e[0] + ':' + e[2]);
check('CLOSE_NOW: lock released before rebuildSingleClassGrid and handleTeacherGetState', () => {
  const env = ctrlEnv([sesRowP3('SES_C1_1', 'C1')]);
  const r = env.ctx.handleTeacherControlSession(env.ss, { classId: 'C1', subAction: 'CLOSE_NOW' });
  assert.strictEqual(r.state, true, JSON.stringify(r));
  assert.deepStrictEqual(evKinds(env), ['rebuild:false', 'state:false']);
  assert.strictEqual(env.lock.tryCalls, 1); assert.strictEqual(env.lock.releaseCalls, 1);
  assert.ok(env.sheets.Sessions_Log.rows[0][6], 'manual close time not written');
});
check('CANCEL_MISTAKEN_SESSION: rebuild and state run with the lock already released', () => {
  const env = ctrlEnv([sesRowP3('SES_C1_1', 'C1')]);
  env.ctx.handleTeacherControlSession(env.ss, { classId: 'C1', subAction: 'CANCEL_MISTAKEN_SESSION' });
  assert.deepStrictEqual(evKinds(env), ['rebuild:false', 'state:false']);
  assert.strictEqual(env.lock.releaseCalls, 1);
});
check('OPEN_ROUND_2: R2 row appended, rebuild and state run with the lock released', () => {
  const row = sesRowP3('SES_C1_1', 'C1'); row[6] = iso(Date.now() - 5000);
  const env = ctrlEnv([row]);
  vm.runInContext(`getTodayClassSessionsBundle_ = () => ({ p1Session: { sessionId: 'SES_C1_1', isOpen: false, roomLat: ${CLASS_LAT}, roomLng: ${CLASS_LNG}, radiusMeters: 100 }, p2Session: null, round2OpenedToday: false });`, env.ctx);
  const r = env.ctx.handleTeacherControlSession(env.ss, { classId: 'C1', subAction: 'OPEN_ROUND_2', durationMinutes: 3 });
  assert.strictEqual(r.state, true, JSON.stringify(r));
  assert.strictEqual(env.sheets.Sessions_Log.rows.length, 2);
  assert.ok(/_R2$/.test(env.sheets.Sessions_Log.rows[1][0]));
  assert.deepStrictEqual(evKinds(env), ['rebuild:false', 'state:false']);
});
check('manual mark: safe rebuild and state run with the lock released', () => {
  const env = manualEnv([attRowP3('SES_C1_1', '12345678', '-')]);
  const r = markP(env);
  assert.strictEqual(r.state, true);
  assert.deepStrictEqual(evKinds(env), ['rebuild:false', 'state:false']);
  assert.strictEqual(env.lock.releaseCalls, 1);
});
check('manual mark: rebuild failure is swallowed (rebuildSafe) and state is still returned', () => {
  const env = manualEnv([attRowP3('SES_C1_1', '12345678', '-')]);
  vm.runInContext(`rebuildSingleClassGrid = () => { throw new Error('grid boom'); };`, env.ctx);
  assert.strictEqual(markP(env).state, true);
});
check('EXTEND_2M / SET_QR_MODE: no rebuild, state still runs after the lock is released', () => {
  const env = ctrlEnv([sesRowP3('SES_C1_1', 'C1')]);
  env.ctx.handleTeacherControlSession(env.ss, { classId: 'C1', subAction: 'EXTEND_2M' });
  assert.deepStrictEqual(evKinds(env), ['state:false']);
});
check('start session: new session appended, state runs outside the lock, no rebuild', () => {
  const env = ctrlEnv([]);
  vm.runInContext(`getLatestOpenSession = () => null;`, env.ctx);
  const r = env.ctx.handleTeacherStartSession(env.ss, { classId: 'C1', qrMode: 'STATIC' });
  assert.strictEqual(r.state, true, JSON.stringify(r));
  assert.strictEqual(env.sheets.Sessions_Log.rows.length, 1);
  assert.deepStrictEqual(evKinds(env), ['state:false']);
});
check('error paths (unknown class, no session, lock busy, invalid class) return without rebuild or state', () => {
  const env = ctrlEnv([sesRowP3('SES_C1_1', 'C1')]);
  assert.strictEqual(env.ctx.handleTeacherControlSession(env.ss, { classId: 'NOPE', subAction: 'CLOSE_NOW' }).code, 'ERR_NO_SESSION');
  assert.strictEqual(env.ctx.handleTeacherStartSession(env.ss, { classId: 'NOPE' }).code, 'ERR_INVALID_CLASS');
  assert.strictEqual(env.lock.releaseCalls, env.lock.tryCalls, 'lock leaked on an error path');
  assert.strictEqual(env.ev.length, 0, JSON.stringify(env.ev));
  env.lock.busy = true;
  assert.strictEqual(env.ctx.handleTeacherControlSession(env.ss, { classId: 'C1', subAction: 'CLOSE_NOW' }).code, 'ERR_SERVER_BUSY');
  assert.strictEqual(env.ctx.handleTeacherStartSession(env.ss, { classId: 'C1' }).code, 'ERR_SERVER_BUSY');
  assert.strictEqual(env.ctx.handleTeacherManualMark(env.ss, { classId: 'C1', studentId: '12345678' }).code, 'ERR_SERVER_BUSY');
  assert.strictEqual(env.ev.length, 0);
});
check('manual mark error (no session today / final read-only) returns without rebuild or state', () => {
  const env = manualEnv([]);
  vm.runInContext(`getTodayClassSessionsBundle_ = () => ({ p1Session: null, p2Session: null, round2OpenedToday: false });`, env.ctx);
  assert.strictEqual(markP(env).code, 'ERR_NO_SESSION');
  vm.runInContext(`getTodayClassSessionsBundle_ = () => ({ p1Session: { sessionId: 'SES_C1_1' }, p2Session: null, round2OpenedToday: true });`, env.ctx);
  assert.strictEqual(markP(env).code, 'ERR_FINAL_READ_ONLY');
  assert.strictEqual(env.ev.length, 0);
  assert.strictEqual(env.lock.releaseCalls, env.lock.tryCalls);
});
check('runDeferredTeacherState_: non-deferred results pass through untouched', () => {
  const env = ctrlEnv([]);
  const obj = { ok: false, code: 'X' };
  assert.strictEqual(env.ctx.runDeferredTeacherState_(env.ss, obj), obj);
  assert.strictEqual(env.ctx.runDeferredTeacherState_(env.ss, null), null);
  assert.strictEqual(env.ev.length, 0);
});

const GOOD_CRED2 = 'd'.repeat(24);
function onboardEnv(o) {
  o = o || {};
  const roster = rsheet([[1, '12345678', 'Test Student']], { ncols: 5 });
  const dev = rsheet(o.devRows || [], { ncols: 7 });
  const sheets = { C1: roster, Classes_Config: rsheet([classRow('C1')]) };
  if (!o.noDev) sheets.Device_Registry = dev;
  const env = p3Env({ sync: false, sheets });
  env.drive = [];
  env.driveAdds = Boolean(o.driveAdds);
  vm.runInContext(`
    getStoredClassSchedulesMap = () => ({});
    getLatestOpenSession = () => null;
    getStudentClassAttendanceStats = () => ({});
    syncSingleClassRosterFromDrive_ = function (ss, cid, name, opts) {
      __env.drive.push({ cid, opts, held: __env.lock.held, tries: __env.lock.tryCalls });
      if (__env.driveAdds) { __env.sheets[cid].rows.push([2, '87654321', 'Rescued']); return { ok: true, newStudentsAdded: 1 }; }
      return { ok: true, newStudentsAdded: 0 };
    };
  `, env.ctx);
  env.dev = dev;
  return env;
}
const onb = (env, sid, cred) => env.ctx.handleStudentOnboard(env.ss, { studentId: sid, credential: cred || GOOD_CRED2 });
check('onboard: Drive rescue for an unknown MSSV runs BEFORE tryLock (lock-free), then onboarding proceeds', () => {
  const env = onboardEnv({ driveAdds: true });
  const r = onb(env, '87654321');
  assert.strictEqual(env.drive.length, 1);
  assert.strictEqual(env.drive[0].held, false); assert.strictEqual(env.drive[0].tries, 0, 'lock taken before Drive call');
  assert.strictEqual(env.drive[0].opts.onlyIfModified, true);
  assert.strictEqual(r.code, 'ONBOARD_CONFIRMED', JSON.stringify(r));
  assert.strictEqual(r.fullName, 'Rescued');
  assert.strictEqual(env.lock.tryCalls, 1); assert.strictEqual(env.lock.releaseCalls, 1);
});
check('onboard: second unknown MSSV within 5 min skips Drive for the same class (ONB_RESCUE_<cid> flag, 300 s TTL)', () => {
  const env = onboardEnv();
  assert.strictEqual(onb(env, '55555555', 'e'.repeat(24)).code, 'ERR_NOT_ON_ROSTER');
  assert.strictEqual(env.drive.length, 1);
  assert.strictEqual(env.cacheStore['ONB_RESCUE_C1'], '1');
  assert.strictEqual(env.ttl['ONB_RESCUE_C1'], 300);
  assert.strictEqual(onb(env, '66666666', 'f'.repeat(24)).code, 'ERR_NOT_ON_ROSTER');
  assert.strictEqual(env.drive.length, 1, 'Drive hit twice for the same class');
  assert.strictEqual(env.lock.tryCalls, 0, 'not-on-roster must never take the lock');
  delete env.cacheStore['ONB_RESCUE_C1'];
  onb(env, '77777777', 'g'.repeat(24));
  assert.strictEqual(env.drive.length, 2, 'after the flag expires Drive is checked again');
});
check('onboard: a known MSSV never calls Drive', () => {
  const env = onboardEnv();
  assert.strictEqual(onb(env, '12345678').code, 'ONBOARD_CONFIRMED');
  assert.strictEqual(env.drive.length, 0);
});
check('onboard regression: ACTIVE student with another credential still gets ERR_CREDENTIAL_MISMATCH (lock released)', () => {
  const env = onboardEnv({ devRows: [['12345678', 'Test Student', sha256('someone_elses_credential_x'), '', 'ACTIVE', 0, '']] });
  const r = onb(env, '12345678');
  assert.strictEqual(r.code, 'ERR_CREDENTIAL_MISMATCH', JSON.stringify(r));
  assert.strictEqual(env.lock.releaseCalls, 1);
  assert.strictEqual(env.dev.rows.length, 1, 'registry must not be modified');
});
check('onboard regression: credential already bound to another student -> ERR_DEVICE_BOUND_OTHER', () => {
  const env = onboardEnv({ devRows: [['99999999', 'Other', sha256(GOOD_CRED2), '', 'ACTIVE', 0, '']] });
  assert.strictEqual(onb(env, '12345678').code, 'ERR_DEVICE_BOUND_OTHER');
});
check('onboard regression: the 11th onboard with the same credential is rate limited (ERR_SERVER_BUSY)', () => {
  const env = onboardEnv();
  for (let i = 1; i <= 10; i++) assert.strictEqual(onb(env, '12345678').code, 'ONBOARD_CONFIRMED', 'attempt ' + i);
  assert.strictEqual(onb(env, '12345678').code, 'ERR_SERVER_BUSY');
  assert.notStrictEqual(onb(env, '12345678', 'z'.repeat(24)).code, 'ERR_SERVER_BUSY', 'other credential is not rate limited');
});
check('onboard: lock busy after a successful roster match returns ERR_SERVER_BUSY', () => {
  const env = onboardEnv(); env.lock.busy = true;
  assert.strictEqual(onb(env, '12345678').code, 'ERR_SERVER_BUSY');
});
check('L6 onboard: no undefined spamKey in handleStudentOnboard (static) and finally releases the lock without ReferenceError (run)', () => {
  const body = fnSrc(backendSrc, 'handleStudentOnboard').replace(/\/\/.*$/gm, '');
  assert.ok(!/\bspamKey\b/.test(body), 'spamKey referenced in handleStudentOnboard');
  const env = onboardEnv({ noDev: true });
  let err = null;
  try { onb(env, '12345678'); } catch (e) { err = e; }
  assert.ok(err, 'missing Device_Registry should surface as an error');
  assert.notStrictEqual(err.name, 'ReferenceError', err.message);
  assert.strictEqual(env.lock.releaseCalls, 1, 'finally must release the lock');
  const ok = onboardEnv();
  assert.doesNotThrow(() => onb(ok, '12345678'));
  assert.strictEqual(ok.lock.releaseCalls, 1);
});

check('writeManualMarksForDay_ batch: 3 students x P1+P2 -> every row written, few sheet writes, ONE audit row', () => {
  const att = rsheet([attRowP3('SES_C1_1', '11111111', '-'), attRowP3('SES_C1_1_R2', '22222222', '-'), attRowP3('SES_C1_1', '99999999', 'P')]);
  const env = p3Env({ sheets: { Attendance_Log: att, Sessions_Log: rsheet([sesRowP3('SES_C1_1', 'C1'), sesRowP3('SES_C1_1_R2', 'C1')]) } });
  const dayKey = vm.runInContext(`Utilities.formatDate(new Date(Date.now() - 60e3), TIMEZONE, 'yyyy-MM-dd')`, env.ctx);
  const r = env.ctx.writeManualMarksForDay_(env.ss, 'C1', dayKey, { '11111111': 'P', '22222222': 'L', '33333333': 'E' }, { lockHeld: true, actor: 'T', requestTag: 'tag1' });
  assert.strictEqual(r.ok, true, JSON.stringify(r));
  const got = {};
  att.rows.forEach(x => { if (x[9] === 'TEACHER_MANUAL') got[x[4] + '|' + x[2]] = x[5]; });
  assert.deepStrictEqual(got, { '11111111|SES_C1_1': 'P', '11111111|SES_C1_1_R2': 'P', '22222222|SES_C1_1': 'L', '22222222|SES_C1_1_R2': 'L', '33333333|SES_C1_1': 'E', '33333333|SES_C1_1_R2': 'E' });
  assert.strictEqual(att.rows.find(x => x[4] === '99999999')[5], 'P', 'unrelated student touched');
  assert.strictEqual(att.rows.length, 7);
  assert.strictEqual(att.writes.length, 2, 'expected 1 in-place block + 1 append block, got ' + att.writes.length);
  assert.strictEqual(env.lock.tryCalls, 0, 'lockHeld must skip the lock');
  assert.strictEqual(env.audit.length, 1);
  assert.strictEqual(env.audit[0][1], 'T');
  assert.ok(env.audit[0][4].includes('tag1'));
  assert.ok('SES_ATT_SES_C1_1_R2_33333333' in env.cacheStore);
});
check('writeManualMarksForDay_: no session for the day creates the HIST session; empty marks is a no-op', () => {
  const ses = rsheet([]);
  const env = p3Env({ sheets: { Attendance_Log: rsheet([]), Sessions_Log: ses, Classes_Config: rsheet([classRow('C1')]) } });
  assert.strictEqual(env.ctx.writeManualMarksForDay_(env.ss, 'C1', '2026-01-05', {}, {}).written, 0);
  const r = env.ctx.writeManualMarksForDay_(env.ss, 'C1', '2026-01-05', { '11111111': 'P', '22222222': '-' }, {});
  assert.strictEqual(r.ok, true);
  assert.strictEqual(ses.rows.length, 1);
  assert.strictEqual(env.sheets.Attendance_Log.rows.length, 2);
  assert.strictEqual(env.lock.tryCalls, 1); assert.strictEqual(env.lock.releaseCalls, 1);
  assert.strictEqual(env.ctx.writeManualMarksForDay_(env.ss, 'C1', 'bad', { '1': 'P' }, { lockHeld: true }).code, 'ERR_NO_SESSION');
});
const onbAud = env => env.audit.filter(a => a[2] === 'ONBOARD_REJECTED');
check('onboard audit: rejections log ONBOARD_REJECTED with code + MSSV, never the credential/hash, and are rate limited per code+MSSV', () => {
  const env = onboardEnv({ devRows: [['12345678', 'Test Student', sha256('someone_elses_credential_x'), '', 'ACTIVE', 0, '']] });
  onb(env, '55555555'); onb(env, '55555555'); onb(env, '12345678');
  const a = onbAud(env);
  assert.deepStrictEqual(a.map(x => x[4]), ['ERR_NOT_ON_ROSTER', 'ERR_CREDENTIAL_MISMATCH']);
  assert.strictEqual(a[0][3], '55555555', JSON.stringify(a));
  assert.ok(!JSON.stringify(env.audit).includes(GOOD_CRED2) && !JSON.stringify(env.audit).includes(sha256(GOOD_CRED2)), 'credential leaked into audit');
  assert.strictEqual(env.ttl['AUD_ONB_ERR_NOT_ON_ROSTER_55555555'], 600, JSON.stringify(env.ttl));
  const e2 = onboardEnv({ devRows: [['99999999', 'Other', sha256(GOOD_CRED2), '', 'ACTIVE', 0, '']] });
  onb(e2, '12345678');
  assert.deepStrictEqual(onbAud(e2).map(x => x[4]), ['ERR_DEVICE_BOUND_OTHER']);
  const e3 = onboardEnv({ devRows: [] }); e3.lock.busy = true;
  onb(e3, '12345678');
  assert.deepStrictEqual(onbAud(e3).map(x => x[4]), ['ERR_SERVER_BUSY']);
});
check('onboard audit: rate-limit ERR_SERVER_BUSY audited at most once per minute system-wide; REG_LOCKED audited; audit failure never breaks the reply', () => {
  const env = onboardEnv();
  for (let i = 0; i < 10; i++) onb(env, '12345678');
  onb(env, '12345678'); onb(env, '12345678');
  assert.strictEqual(onbAud(env).filter(x => x[4] === 'ERR_SERVER_BUSY').length, 1);
  assert.strictEqual(env.ttl['AUD_ONB_BUSY_RL'], 60);
  const lk = onboardEnv(); lk.sheets.Classes_Config.rows[0][8] = 'NO';
  assert.strictEqual(onb(lk, '12345678').code, 'ERR_REG_LOCKED');
  assert.deepStrictEqual(onbAud(lk).map(x => x[4]), ['ERR_REG_LOCKED']);
  const bad = onboardEnv();
  vm.runInContext(`logAudit = () => { throw new Error('audit boom'); };`, bad.ctx);
  assert.strictEqual(onb(bad, '55555555').code, 'ERR_NOT_ON_ROSTER');
});
check('onboard audit: formula-looking MSSV is neutralised (leading apostrophe) and truncated to 20 chars', () => {
  const env = onboardEnv();
  onb(env, '=HYPERLINK("http://x.example","a")');
  const a = onbAud(env)[0];
  assert.strictEqual(a[3][0], "'");
  assert.ok(a[3].length <= 21);
  assert.strictEqual(a[3], "'" + '=HYPERLINK("http://x.example","a")'.toUpperCase().slice(0, 20));
});

// ---------------------------------------------------------------- H6: master write lock in sync.txt
console.log('--- H6: withMasterWriteLock_ and its callers ---');
check('withMasterWriteLock_: busy lock -> fn not called, returns {busy:true}, nothing to release', () => {
  const env = p3Env(); env.lock.busy = true;
  let called = 0;
  const r = env.ctx.withMasterWriteLock_({}, 1000, () => { called++; return { busy: false }; });
  assert.strictEqual(called, 0); assert.strictEqual(r.busy, true);
  assert.strictEqual(env.lock.releaseCalls, 0);
});
check('withMasterWriteLock_: lockHeld -> no tryLock/releaseLock at all and the fn result is returned', () => {
  const env = p3Env();
  const r = env.ctx.withMasterWriteLock_({ lockHeld: true }, 1000, () => ({ busy: false, v: 42 }));
  assert.strictEqual(r.v, 42);
  assert.strictEqual(env.lock.tryCalls, 0); assert.strictEqual(env.lock.releaseCalls, 0);
  env.lock.busy = true;
  assert.strictEqual(env.ctx.withMasterWriteLock_({ lockHeld: true }, 1, () => 'ran'), 'ran', 'lockHeld must ignore a busy lock');
});
check('withMasterWriteLock_: normal run acquires once, releases once; lock is released when fn throws and the error propagates', () => {
  const env = p3Env();
  assert.strictEqual(env.ctx.withMasterWriteLock_({}, 1000, () => 'x'), 'x');
  assert.strictEqual(env.lock.tryCalls, 1); assert.strictEqual(env.lock.releaseCalls, 1);
  assert.throws(() => env.ctx.withMasterWriteLock_({}, 1000, () => { throw new Error('inner'); }), /inner/);
  assert.strictEqual(env.lock.releaseCalls, 2); assert.strictEqual(env.lock.held, false);
});
check('deleteSelectedClasses (static): the lock is taken only after the confirmation ui.alert', () => {
  const body = fnSrc(syncSrc, 'deleteSelectedClasses');
  const a = body.indexOf('ui.alert('), b = body.indexOf('withMasterWriteLock_(');
  assert.ok(a > 0 && b > a, 'alert ' + a + ' / lock ' + b);
  assert.ok(body.indexOf('tryLock') < 0 || body.indexOf('tryLock') > a);
});
check('deleteSelectedClasses (run): declined confirmation never touches the lock; busy lock aborts before any deletion', () => {
  const cfg = rsheet([classRow('C1')], { ncols: 9 });
  const env = p3Env({ sheets: { Classes_Config: cfg } });
  env.ctx.SpreadsheetApp.getUi = () => ({ alert: () => 'NO', ButtonSet: { YES_NO: 1 }, Button: { YES: 'YES' } });
  assert.deepStrictEqual(Object.assign({}, env.ctx.deleteSelectedClasses(['C1'])), { cancelled: true });
  assert.strictEqual(env.lock.tryCalls, 0);
  env.ctx.SpreadsheetApp.getUi = () => ({ alert: () => 'YES', ButtonSet: { YES_NO: 1 }, Button: { YES: 'YES' } });
  vm.runInContext(`showAlert_ = (m) => __env.audit.push(['alert', m]); collectMasterClassStudentIds_ = () => { throw new Error('must not run'); };`, env.ctx);
  env.lock.busy = true;
  assert.strictEqual(env.ctx.deleteSelectedClasses(['C1']).cancelled, true);
  assert.strictEqual(env.lock.tryCalls, 1);
  assert.ok(env.audit.some(a => a[0] === 'alert'), 'user not told that nothing was deleted');
});
// v3.10.0: autoSyncTodayAttendanceAfterClass / syncTodayAttendance / executeAttendanceSyncUndo_ now run the two-way merge;
// their lock, base and undo behaviour is covered in test-two-way-sync.js (the old synced-map tests were retired).
check('syncClassRosterForReport_ runs the Drive roster sync with lockHeld:false and returns the added students', () => {
  const env = p3Env();
  let seen = null;
  env.ctx.__spy = (o) => { seen = o; };
  vm.runInContext(`
    syncSingleClassRosterFromDrive_ = (ss, cid, name, opts) => { __spy(opts); return { newStudentsAdded: 2, newStudentNames: ['a', 'b'] }; };
  `, env.ctx);
  const r = env.ctx.syncClassRosterForReport_(env.ss, 'C1', 'Class One');
  assert.strictEqual(seen.lockHeld, false); assert.strictEqual(seen.onlyIfModified, true);
  assert.strictEqual(r.newStudentsAdded, 2); assert.deepStrictEqual(Array.from(r.newStudentNames), ['a', 'b']);
});
function driveSyncEnv() {
  const cls = rsheet([], { ncols: 5, header: ['No.', 'Student_ID', 'Full_Name', 'Total_Present', 'Total_Late'] });
  const env = p3Env({ sheets: { C1: cls } });
  env.cls = cls; env.calls = { rebuild: 0, invalidate: [] };
  vm.runInContext(`
    resolveClassTargetFile_ = () => ({ fileId: 'F1', lastUpdatedMs: 5, isGoogleSheet: true, folderPath: 'x' });
    extractRosterFromTargetFile_ = () => ({ roster: [[1, '12345678', 'Alice'], [2, '23456789', 'Bob']], sheetName: 'S1' });
    collectMasterClassStudentIds_ = () => ({ upperMap: {}, count: 0, rawMap: {} });
    rebuildSingleClassGrid = () => { __env.calls.rebuild++; };
    const __origInv = invalidateClassCache;
  `.replace('const __origInv = invalidateClassCache;', ''), env.ctx);
  const origInv = env.ctx.invalidateClassCache;
  env.ctx.invalidateClassCache = c => { env.calls.invalidate.push(c); return origInv(c); };
  return env;
}
check('syncSingleClassRosterFromDrive_: busy master lock -> {ok:false, busy:true}, nothing written, no sync meta, no rebuild', () => {
  const env = driveSyncEnv(); env.lock.busy = true;
  const r = env.ctx.syncSingleClassRosterFromDrive_(env.ss, 'C1', 'Class One', {});
  assert.strictEqual(r.busy, true); assert.strictEqual(r.ok, false); assert.strictEqual(r.newStudentsAdded, 0);
  assert.strictEqual(env.cls.writes.length, 0); assert.strictEqual(env.cls.rows.length, 0);
  assert.ok(!(vm.runInContext('ROSTER_SYNC_META_PROP_KEY', env.ctx) in env.propStore), 'sync meta saved although nothing was imported');
  assert.strictEqual(env.calls.rebuild, 0);
});
check('syncSingleClassRosterFromDrive_: free lock -> full import, lock released, class cache invalidated, grid rebuilt', () => {
  const env = driveSyncEnv();
  const r = env.ctx.syncSingleClassRosterFromDrive_(env.ss, 'C1', 'Class One', {});
  assert.strictEqual(r.ok, true); assert.strictEqual(r.newStudentsAdded, 2);
  assert.strictEqual(env.cls.rows.length, 2);
  assert.strictEqual(env.lock.releaseCalls, 1);
  assert.deepStrictEqual(env.calls.invalidate, ['C1']);
  assert.strictEqual(env.calls.rebuild, 1);
});
check('syncSingleClassRosterFromDrive_: lockHeld caller (teacher rebuild) imports without touching the lock', () => {
  const env = driveSyncEnv(); env.lock.busy = true;
  const r = env.ctx.syncSingleClassRosterFromDrive_(env.ss, 'C1', 'Class One', { lockHeld: true });
  assert.strictEqual(r.ok, true); assert.strictEqual(env.lock.tryCalls, 0);
});

// ---------------------------------------------------------------- M9: leading-zero MSSV, caps, text format
console.log('--- M9: pickStudentIdCell_, 2000-row caps, text format on the id column ---');
check('pickStudentIdCell_: display with leading zeros wins only when it equals the stripped raw value', () => {
  const p = (a, b) => beCtx.pickStudentIdCell_(a, b);
  assert.strictEqual(p(123456789, '0123456789'), '0123456789');
  assert.strictEqual(p(2610123456, '2,610,123,456'), 2610123456);
  assert.strictEqual(p(124, '00123'), 124);
  assert.strictEqual(p('AB12', 'AB12'), 'AB12');
  assert.strictEqual(p(undefined, ''), undefined);
  assert.strictEqual(p('0123456789', '0123456789'), '0123456789');
  assert.strictEqual(p(5, 5), 5, 'non-string display is ignored');
});
check('sync.txt: no 250-row cap left on getLastRow(), and the roster/attendance scans are capped at 2000', () => {
  assert.ok(!/getLastRow\(\)\s*,\s*250\b/.test(syncSrc), 'getLastRow(), 250 still present');
  assert.ok(syncSrc.split('Math.min(sheet.getLastRow(), 2000)').length - 1 >= 2, 'expected the 2000 cap in extractRosterFromTargetFile_ and the attendance writer');
  assert.ok(/Math\.min\(sheet\.getLastRow\(\), 2000\)/.test(fnSrc(syncSrc, 'extractRosterFromTargetFile_')));
});
check('roster creation: insertSheet is followed by the "@" text format on the Student_ID column (sync + createFormattedRosterTab)', () => {
  assert.ok(/insertSheet\(classId\);\s*classSheet\.getRange\('B:B'\)\.setNumberFormat\('@'\)/.test(fnSrc(syncSrc, 'syncSingleClassRosterFromDrive_')));
  assert.ok(/insertSheet\(classId\)[\s\S]*?getRange\('B:B'\)\.setNumberFormat\('@'\)/.test(fnSrc(backendSrc, 'createFormattedRosterTab')));
});
check('rebuildSingleClassGrid (run): "@" format is applied to the id column BEFORE the rows are written, ids keep leading zeros', () => {
  const roster = rsheet([[1, 123456789, 'Alice'], [2, 'AB12345', 'Bob']], { ncols: 5, disp: { '2,2': '0123456789' } });
  const env = p3Env({ sync: false, sheets: { C1: roster } });
  vm.runInContext(`buildGroupedClassDayRecords_ = () => [];`, env.ctx);
  env.ctx.rebuildSingleClassGrid(env.ss, 'C1');
  const fmt = roster.events.indexOf('fmt:2,2:@'), data = roster.events.indexOf('set:2,1');
  assert.ok(fmt >= 0 && data > fmt, roster.events.join(' | '));
  assert.strictEqual(roster.rows[0][1], '0123456789');
  assert.strictEqual(roster.rows[1][1], 'AB12345');
});

// ---------------------------------------------------------------- M10: normalizeStudentId_ vs normalizeId
console.log('--- M10: normalizeStudentId_ (sync) agrees with normalizeId (backend) ---');
const synCtx = p3Env().ctx;
check('normalizeStudentId_ canonical output equals Code.gs normalizeId for valid MSSV shapes', () => {
  ['2610123456', 2610123456, '0261012345', 'ab12345', ' SV-2026-01 ', 'B21DCCN015', 12345678.0].forEach(v => {
    const a = synCtx.normalizeStudentId_(v);
    assert.ok(a, 'rejected valid id ' + JSON.stringify(v));
    assert.strictEqual(a, synCtx.normalizeId(v), JSON.stringify(v));
  });
  assert.strictEqual(synCtx.normalizeStudentId_('ab12345'), 'AB12345');
  assert.strictEqual(synCtx.normalizeStudentId_(' SV-2026-01 '), 'SV-2026-01');
});
check('normalizeStudentId_ rejects row numbers, dates, footer words and empties (returns "")', () => {
  ['5', 5, '28-10-2026', '28/10', 'Tổng cộng', 'Giáo viên', 'ab', 'ABCDEF', '', null, undefined, 'x'.repeat(25), '12 345 678'].forEach(v => {
    assert.strictEqual(synCtx.normalizeStudentId_(v), '', 'accepted ' + JSON.stringify(v));
  });
});
check('normalizeStudentId_ with a name cell rejects footer rows and empty names but keeps real students', () => {
  assert.strictEqual(synCtx.normalizeStudentId_('12345678', 'Tổng cộng'), '');
  assert.strictEqual(synCtx.normalizeStudentId_('12345678', 'Giảng viên: A'), '');
  assert.strictEqual(synCtx.normalizeStudentId_('12345678', ''), '');
  assert.strictEqual(synCtx.normalizeStudentId_('12345678', 'Nguyễn Văn A'), '12345678');
});

// ---------------------------------------------------------------- phase 3b: rebuild report lock scope + synced-sessions map atomicity
console.log('--- P3b: handleTeacherRebuildReport lock scope, AUTO_SYNCED_SESSIONS_KEY atomic merge ---');
function rebuildReportEnv(busy) {
  const env = p3Env({ sheets: { Classes_Config: rsheet([classRow('C1'), classRow('C2')], { ncols: 9 }) } });
  env.lock.busy = busy;
  vm.runInContext(`
    syncSingleClassRosterFromDrive_ = (ss, cid, name, opts) => { __env.ev.push(['drive', cid, __env.lock.held, opts.lockHeld]); return { newStudentsAdded: cid === 'C1' ? 1 : 0, newStudentNames: cid === 'C1' ? ['s1'] : [] }; };
    rebuildSingleClassGrid = (ss, cid) => __env.ev.push(['rebuild', cid, __env.lock.held]);
    invalidateClassAttendanceStatsCache_ = (cid) => __env.ev.push(['stats', cid, __env.lock.held]);
  `, env.ctx);
  return env;
}
check('handleTeacherRebuildReport: Drive sync runs with the lock NOT held, grid rebuild + stats invalidation under the lock, response shape kept', () => {
  const env = rebuildReportEnv(false);
  const r = env.ctx.handleTeacherRebuildReport(env.ss, {});
  assert.strictEqual(r.ok, true); assert.strictEqual(r.code, 'REPORT_REBUILT');
  assert.strictEqual(r.newStudentsAdded, 1); assert.deepStrictEqual(Array.from(r.newStudentNames), ['s1']);
  const drive = env.ev.filter(e => e[0] === 'drive');
  assert.strictEqual(drive.length, 2);
  drive.forEach(e => { assert.strictEqual(e[2], false, 'Drive sync ran while holding the script lock'); assert.strictEqual(e[3], false); });
  env.ev.filter(e => e[0] === 'rebuild' || e[0] === 'stats').forEach(e => assert.strictEqual(e[2], true, e[0] + ' ran outside the lock'));
  assert.strictEqual(env.ev.filter(e => e[0] === 'rebuild').length, 2);
  assert.ok(env.ev.findIndex(e => e[0] === 'rebuild') > env.ev.map(e => e[0]).lastIndexOf('drive'), 'rebuild before Drive sync finished');
  assert.strictEqual(env.lock.tryCalls, 1); assert.strictEqual(env.lock.releaseCalls, 1); assert.strictEqual(env.lock.held, false);
});
check('handleTeacherRebuildReport: single classId only syncs/rebuilds that class', () => {
  const env = rebuildReportEnv(false);
  env.ctx.handleTeacherRebuildReport(env.ss, { classId: 'C2' });
  assert.deepStrictEqual(env.ev.map(e => e[0] + ':' + e[1]), ['drive:C2', 'rebuild:C2', 'stats:C2']);
});
check('handleTeacherRebuildReport: busy lock -> ERR_SERVER_BUSY, no grid rebuild', () => {
  const env = rebuildReportEnv(true);
  const r = env.ctx.handleTeacherRebuildReport(env.ss, {});
  assert.deepStrictEqual(Object.assign({}, r), { ok: false, code: 'ERR_SERVER_BUSY' });
  assert.strictEqual(env.ev.filter(e => e[0] === 'rebuild').length, 0);
  assert.strictEqual(env.lock.releaseCalls, 0);
});
check('handleTeacherRebuildReport: rebuild error propagates and the lock is still released; Drive sync error is swallowed', () => {
  const env = rebuildReportEnv(false);
  vm.runInContext(`rebuildSingleClassGrid = () => { throw new Error('grid boom'); };`, env.ctx);
  assert.throws(() => env.ctx.handleTeacherRebuildReport(env.ss, {}), /grid boom/);
  assert.strictEqual(env.lock.releaseCalls, 1); assert.strictEqual(env.lock.held, false);
  const env2 = rebuildReportEnv(false);
  vm.runInContext(`syncSingleClassRosterFromDrive_ = () => { throw new Error('drive boom'); };`, env2.ctx);
  const r = env2.ctx.handleTeacherRebuildReport(env2.ss, {});
  assert.strictEqual(r.ok, true); assert.strictEqual(r.newStudentsAdded, 0);
});

check('sync.txt: no raw setProperty(AUTO_SYNCED_SESSIONS_KEY) left outside updateSyncedSessionsMap_', () => {
  const total = syncSrc.split('setProperty(AUTO_SYNCED_SESSIONS_KEY').length - 1;
  assert.strictEqual(total, 1);
  assert.ok(fnSrc(syncSrc, 'updateSyncedSessionsMap_').indexOf('setProperty(AUTO_SYNCED_SESSIONS_KEY') > 0);
});

// ================================================================ v3.7.11 phase 4 regression tests
const p4Async = [];
const acheck = (name, fn) => p4Async.push([name, fn]);
const sesLog = env => env.sheets.Sessions_Log.rows;
const ctl = (env, sub, extra) => env.ctx.handleTeacherControlSession(env.ss, Object.assign({ classId: 'C1', subAction: sub }, extra || {}));
const ms = v => new Date(v).getTime();
const near = (a, b, tol) => Math.abs(a - b) <= (tol || 5000);

console.log('--- P4-1: EXTEND_2M four branches ---');
check('EXTEND_2M on a closed session (same day): reopens from now + 2m, present = close', () => {
  const row = sesRowP3('SES_C1_1', 'C1'); row[4] = iso(Date.now() - 20e3); row[5] = iso(Date.now() - 10e3); row[6] = iso(Date.now() - 5e3);
  const env = ctrlEnv([row]);
  const r = ctl(env, 'EXTEND_2M'); assert.strictEqual(r.state, true, JSON.stringify(r));
  const w = sesLog(env)[0];
  assert.ok(near(ms(w[4]), Date.now() + 120e3), 'present ' + w[4]);
  assert.strictEqual(ms(w[4]), ms(w[5]));
  assert.strictEqual(w[6], '', 'manual close must be cleared');
});
check('EXTEND_2M on Round 2 (_R2): close +2m, present = close', () => {
  const row = sesRowP3('SES_C1_2_R2', 'C1'); const base = Date.now() + 120e3; row[4] = iso(base); row[5] = iso(base);
  const env = ctrlEnv([row]);
  ctl(env, 'EXTEND_2M');
  const w = sesLog(env)[0];
  assert.strictEqual(ms(w[5]), base + 120e3);
  assert.strictEqual(ms(w[4]), ms(w[5]));
});
check('EXTEND_2M on Round 1 still within Present window: present +2m, late tail length kept', () => {
  const row = sesRowP3('SES_C1_1', 'C1'); const pres = Date.now() + 300e3, cls = Date.now() + 900e3; row[4] = iso(pres); row[5] = iso(cls);
  const env = ctrlEnv([row]);
  ctl(env, 'EXTEND_2M');
  const w = sesLog(env)[0];
  assert.strictEqual(ms(w[4]), pres + 120e3);
  assert.strictEqual(ms(w[5]) - ms(w[4]), cls - pres, 'late tail changed');
});
check('EXTEND_2M on Round 1 past Present window (in late): present = now+2m, close kept when later', () => {
  const row = sesRowP3('SES_C1_1', 'C1'); const cls = Date.now() + 600e3; row[4] = iso(Date.now() - 10e3); row[5] = iso(cls);
  const env = ctrlEnv([row]);
  ctl(env, 'EXTEND_2M');
  const w = sesLog(env)[0];
  assert.ok(near(ms(w[4]), Date.now() + 120e3));
  assert.strictEqual(ms(w[5]), cls);
});
check('EXTEND_2M on Round 1 past Present window with close before new present: close = new present', () => {
  const row = sesRowP3('SES_C1_1', 'C1'); row[4] = iso(Date.now() - 10e3); row[5] = iso(Date.now() + 30e3);
  const env = ctrlEnv([row]);
  ctl(env, 'EXTEND_2M');
  const w = sesLog(env)[0];
  assert.strictEqual(ms(w[5]), ms(w[4]));
  assert.ok(near(ms(w[4]), Date.now() + 120e3));
});

console.log('--- P4-2: requestId idempotency ---');
const rowEnd = env => ms(sesLog(env)[0][5]);
check('EXTEND_2M twice with the same requestId adds +2m only once', () => {
  const env = ctrlEnv([sesRowP3('SES_C1_1', 'C1')]);
  const c0 = rowEnd(env);
  ctl(env, 'EXTEND_2M', { requestId: 'RQ_A' });
  const c1 = rowEnd(env);
  const r = ctl(env, 'EXTEND_2M', { requestId: 'RQ_A' });
  assert.strictEqual(r.state, true, 'duplicate must still return state: ' + JSON.stringify(r));
  assert.strictEqual(c1 - c0, 120e3);
  assert.strictEqual(rowEnd(env), c1, 'second call extended again');
  assert.ok('TEA_REQ_RQ_A' in env.cacheStore);
});
check('EXTEND_2M twice with different requestIds adds +4m', () => {
  const env = ctrlEnv([sesRowP3('SES_C1_1', 'C1')]);
  const c0 = rowEnd(env);
  ctl(env, 'EXTEND_2M', { requestId: 'RQ_A' }); ctl(env, 'EXTEND_2M', { requestId: 'RQ_B' });
  assert.strictEqual(rowEnd(env) - c0, 240e3);
});
check('EXTEND_2M without requestId is never deduplicated', () => {
  const env = ctrlEnv([sesRowP3('SES_C1_1', 'C1')]);
  const c0 = rowEnd(env);
  ctl(env, 'EXTEND_2M'); ctl(env, 'EXTEND_2M');
  assert.strictEqual(rowEnd(env) - c0, 240e3);
  assert.ok(!Object.keys(env.cacheStore).some(k => k.indexOf('TEA_REQ_') === 0));
});
check('START_SESSION twice with the same requestId appends one row only', () => {
  const env = ctrlEnv([]);
  vm.runInContext(`getLatestOpenSession = () => null;`, env.ctx);
  env.ctx.handleTeacherStartSession(env.ss, { classId: 'C1', requestId: 'RQ_S' });
  const r = env.ctx.handleTeacherStartSession(env.ss, { classId: 'C1', requestId: 'RQ_S' });
  assert.strictEqual(r.state, true, JSON.stringify(r));
  assert.strictEqual(sesLog(env).length, 1);
});
check('START_SESSION twice without requestId is not blocked by the guard', () => {
  const env = ctrlEnv([]);
  vm.runInContext(`getLatestOpenSession = () => null;`, env.ctx);
  env.ctx.handleTeacherStartSession(env.ss, { classId: 'C1' });
  env.ctx.handleTeacherStartSession(env.ss, { classId: 'C1' });
  assert.strictEqual(sesLog(env).length, 2);
});
check('failed call (ERR_NO_SESSION) does not write the TEA_REQ_ cache key (retry stays possible)', () => {
  const env = ctrlEnv([]);
  const r = ctl(env, 'EXTEND_2M', { requestId: 'RQ_F' });
  assert.strictEqual(r.code, 'ERR_NO_SESSION');
  assert.ok(!('TEA_REQ_RQ_F' in env.cacheStore));
  const env2 = ctrlEnv([sesRowP3('SES_C1_1', 'C1')]);
  assert.strictEqual(env2.ctx.handleTeacherStartSession(env2.ss, { classId: 'NOPE', requestId: 'RQ_G' }).code, 'ERR_INVALID_CLASS');
  assert.ok(!('TEA_REQ_RQ_G' in env2.cacheStore));
});

console.log('--- P4-3: M6 PIN_10S only on Round 2 ---');
check('SET_QR_MODE PIN_10S on Round 1 -> ERR_PIN_ROUND1, column 11 untouched, no dedupe mark', () => {
  const env = ctrlEnv([sesRowP3('SES_C1_1', 'C1')]);
  const r = ctl(env, 'SET_QR_MODE', { qrMode: 'PIN_10S', requestId: 'RQ_Q' });
  assert.strictEqual(r.code, 'ERR_PIN_ROUND1', JSON.stringify(r));
  assert.ok(!env.sheets.Sessions_Log.writes.some(w => w.c === 11), 'column 11 written');
  assert.strictEqual(sesLog(env)[0][10], 'STATIC');
  assert.ok(!('TEA_REQ_RQ_Q' in env.cacheStore));
});
check('SET_QR_MODE PIN_10S on Round 2 (_R2) is written to column 11', () => {
  const env = ctrlEnv([sesRowP3('SES_C1_2_R2', 'C1')]);
  const r = ctl(env, 'SET_QR_MODE', { qrMode: 'PIN_10S' });
  assert.strictEqual(r.state, true, JSON.stringify(r));
  assert.ok(env.sheets.Sessions_Log.writes.some(w => w.c === 11 && w.v[0][0] === 'PIN_10S'));
});
check('SET_QR_MODE PIN_10S on a _P2-labelled session is accepted too', () => {
  const row = sesRowP3('SES_C1_X', 'C1'); row[2] = '15Nov_0900_P2';
  const env = ctrlEnv([row]);
  assert.strictEqual(ctl(env, 'SET_QR_MODE', { qrMode: 'PIN_10S' }).state, true);
});
check('SET_QR_MODE ROTATING on Round 1 still allowed', () => {
  const env = ctrlEnv([sesRowP3('SES_C1_1', 'C1')]);
  assert.strictEqual(ctl(env, 'SET_QR_MODE', { qrMode: 'ROTATING' }).state, true);
  assert.strictEqual(env.sheets.Sessions_Log.writes.filter(w => w.c === 11).pop().v[0][0], 'ROTATING');
});
check('START_SESSION Round 1 with qrMode PIN_10S is stored as STATIC', () => {
  const env = ctrlEnv([]);
  vm.runInContext(`getLatestOpenSession = () => null;`, env.ctx);
  env.ctx.handleTeacherStartSession(env.ss, { classId: 'C1', qrMode: 'PIN_10S' });
  assert.strictEqual(sesLog(env)[0][10], 'STATIC');
});

console.log('--- P4-4: L3 ERR_AUTH_LOCKED carries params.mins ---');
check('lockout response has numeric params.mins in 1..10', () => {
  const env = authEnv();
  let last;
  for (let i = 0; i < 8; i++) last = verify(env, String(100000 + i), 'fp_same');
  assert.strictEqual(last.code, 'ERR_AUTH_LOCKED', JSON.stringify(last));
  assert.ok(last.params && Number.isInteger(last.params.mins) && last.params.mins >= 1 && last.params.mins <= 10, JSON.stringify(last.params));
  const again = verify(env, '123456', 'fp_same');
  assert.strictEqual(again.code, 'ERR_AUTH_LOCKED');
  assert.ok(again.params && again.params.mins >= 1 && again.params.mins <= 10, JSON.stringify(again.params));
});
check('global lockout response has params.mins', () => {
  const env = authEnv();
  let last;
  for (let i = 0; i < 60; i++) last = verify(env, String(100000 + i), 'fp_' + i);
  assert.strictEqual(last.code, 'ERR_AUTH_LOCKED');
  assert.ok(last.params && last.params.mins === 10, JSON.stringify(last.params));
});

console.log('--- P4-5: H7 getMergedStudentClassStats ---');
const h7Ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/attendance-rules.js'), 'utf8'), h7Ctx);
vm.runInContext(extractFns(stSrc, ['computeAttendanceScoreAndExamStatus', 'getMergedStudentClassStats']), h7Ctx);
vm.runInContext(`
  var __local = [], __course = [], __localCalls = 0;
  getTodayDateKey = () => '2026-11-15';
  getClassCourseSessionDates = () => __course;
  normalizeSessionDayKey = v => { const m = String(v || '').match(/\\d{4}-\\d{2}-\\d{2}/); return m ? m[0] : ''; };
  formatDisplayDateFromKey = k => k.split('-').reverse().join('/');
  getLocalStudentAttendanceHistory = () => { __localCalls++; return __local; };
`, h7Ctx);
const H7_DAYS = ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11'];
function h7(srv, local, course) {
  h7Ctx.__local = local || []; h7Ctx.__course = (course || H7_DAYS).map(d => ({ dayKey: d })); h7Ctx.__localCalls = 0;
  return h7Ctx.getMergedStudentClassStats('12345678', 'C1', srv);
}
const hs = (P, L, E, A, history) => ({ P, L, E, A, total: P + L + E + A, manualExamBan: false, history });
check('H7: server "-" (absent) + local P on the same day stays A', () => {
  const r = h7(hs(0, 0, 0, 1, [{ dayKey: '2026-11-08', status: '-' }]), [{ dayKey: '2026-11-08', status: 'P' }]);
  assert.strictEqual(r.A, 1); assert.strictEqual(r.P, 0);
  assert.strictEqual(r.history.find(x => x.dayKey === '2026-11-08').status, 'A');
});
check('H7: server A + local P on the same day stays A', () => {
  const r = h7(hs(0, 0, 0, 1, [{ dayKey: '2026-11-08', status: 'A' }]), [{ dayKey: '2026-11-08', status: 'P' }]);
  assert.strictEqual(r.A, 1); assert.strictEqual(r.P, 0);
});
check('H7: server E + local P on the same day stays E', () => {
  const r = h7(hs(0, 0, 1, 0, [{ dayKey: '2026-11-08', status: 'E' }]), [{ dayKey: '2026-11-08', status: 'P' }]);
  assert.strictEqual(r.E, 1); assert.strictEqual(r.P, 0);
});
check('H7: day present only locally is supplemented', () => {
  const r = h7(hs(1, 0, 0, 0, [{ dayKey: '2026-11-08', status: 'P' }]), [{ dayKey: '2026-11-09', status: 'P' }, { dayKey: '2026-11-10', status: 'L' }]);
  assert.strictEqual(r.P, 2); assert.strictEqual(r.L, 1);
  assert.strictEqual(r.history.length, 3);
});
check('H7: total P+L+E+A never exceeds the number of schedule days (off-schedule local days ignored)', () => {
  const local = ['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'].map(d => ({ dayKey: d, status: 'P' }));
  const r = h7(hs(1, 0, 0, 0, [{ dayKey: '2026-11-08', status: 'P' }]), local);
  assert.ok(r.P + r.L + r.E + r.A <= H7_DAYS.length, 'total ' + r.total);
  assert.strictEqual(r.P, 4);
});
check('H7: server history empty but total > 0 -> server counts only, local not consulted', () => {
  const r = h7(hs(3, 0, 0, 1, []), [{ dayKey: '2026-11-09', status: 'P' }]);
  assert.strictEqual(r.P, 3); assert.strictEqual(r.A, 1); assert.strictEqual(r.total, 4);
  assert.strictEqual(h7Ctx.__localCalls, 0);
});
check('H7: server OPEN day does not block the local supplement', () => {
  const r = h7(hs(1, 0, 0, 0, [{ dayKey: '2026-11-08', status: 'P' }, { dayKey: '2026-11-09', status: 'OPEN' }]), [{ dayKey: '2026-11-09', status: 'P' }]);
  assert.strictEqual(r.P, 2);
  assert.strictEqual(r.history.find(x => x.dayKey === '2026-11-09').status, 'P');
});
check('H7: no history, no counts -> local history is used fully', () => {
  const r = h7(hs(0, 0, 0, 0, []), [{ dayKey: '2026-11-08', status: 'P' }, { dayKey: '2026-11-09', status: '-' }]);
  assert.strictEqual(r.P, 1); assert.strictEqual(r.A, 1);
});

console.log('--- P4-6: callBackend (retry / requestId / timeout) ---');
const cbCtx = vm.createContext({});
vm.runInContext('async ' + extractFns(scSrc, ['callBackend']) + '\n' + extractFns(scSrc, ['getBackendTimeoutMs']), cbCtx);
const cbRun = async (payload, script, retries) => {
  const calls = []; let i = 0;
  Object.assign(cbCtx, {
    normalizeApiUrl: u => u, ingestServerScheduleData: () => {}, showStatus: () => {},
    I18N: { en: { ERR_SERVER_BUSY: 'busy' } }, currentLang: 'en',
    AbortController: class { constructor() { this.signal = {}; } abort() {} },
    setTimeout: (fn, t) => { if (t < 5000) { fn(); } return 1; },
    clearTimeout: () => {},
    fetch: async (url, opts) => {
      calls.push(JSON.parse(opts.body));
      const s = script[Math.min(i++, script.length - 1)];
      if (s.throw) throw s.throw;
      return { ok: s.ok !== false, status: s.status || 200, json: async () => { if (s.badJson) throw new Error('bad json'); return s.body; } };
    }
  });
  const res = await (retries === undefined ? cbCtx.callBackend('u', payload) : cbCtx.callBackend('u', payload, retries));
  return { res, calls };
};
const netErr = { throw: new Error('Failed to fetch') };
acheck('callBackend: TEACHER_CONTROL_SESSION without requestId + network error -> exactly 1 fetch', async () => {
  const { res, calls } = await cbRun({ action: 'TEACHER_CONTROL_SESSION' }, [netErr]);
  assert.strictEqual(calls.length, 1); assert.strictEqual(res.code, 'ERR_NETWORK');
});
acheck('callBackend: PING + network error -> 3 fetches', async () => {
  const { res, calls } = await cbRun({ action: 'PING' }, [netErr]);
  assert.strictEqual(calls.length, 3); assert.strictEqual(res.code, 'ERR_NETWORK');
});
acheck('callBackend: command with requestId retries with the same requestId and succeeds', async () => {
  const { res, calls } = await cbRun({ action: 'TEACHER_CONTROL_SESSION', requestId: 'RQ1' }, [netErr, { body: { ok: true } }]);
  assert.strictEqual(calls.length, 2); assert.strictEqual(res.ok, true);
  assert.ok(calls.every(c => c.requestId === 'RQ1'));
});
acheck('callBackend: response !ok with non-JSON body -> ERR_NETWORK', async () => {
  const { res } = await cbRun({ action: 'STUDENT_CHECKIN' }, [{ ok: false, status: 500, badJson: true }], 0);
  assert.strictEqual(res.code, 'ERR_NETWORK');
});
acheck('callBackend: invalid JSON -> ERR_NETWORK', async () => {
  const { res } = await cbRun({ action: 'TEACHER_CONTROL_SESSION' }, [{ badJson: true }]);
  assert.strictEqual(res.code, 'ERR_NETWORK');
});
acheck('callBackend: abort -> ERR_TIMEOUT', async () => {
  const e = new Error('aborted'); e.name = 'AbortError';
  const { res, calls } = await cbRun({ action: 'TEACHER_CONTROL_SESSION' }, [{ throw: e }]);
  assert.strictEqual(res.code, 'ERR_TIMEOUT'); assert.strictEqual(calls.length, 1);
});
acheck('callBackend: TEACHER_AUTH network error is never retried (even with requestId)', async () => {
  const { calls } = await cbRun({ action: 'TEACHER_AUTH', requestId: 'RQ2' }, [netErr]);
  assert.strictEqual(calls.length, 1);
});
acheck('callBackend: ERR_SERVER_BUSY is retried for every action (incl. no requestId)', async () => {
  const { res, calls } = await cbRun({ action: 'TEACHER_CONTROL_SESSION' }, [{ body: { ok: false, code: 'ERR_SERVER_BUSY' } }, { body: { ok: true } }]);
  assert.strictEqual(calls.length, 2); assert.strictEqual(res.ok, true);
});
acheck('callBackend: ERR_SERVER_BUSY on the last attempt is returned to the caller', async () => {
  const { res, calls } = await cbRun({ action: 'TEACHER_AUTH' }, [{ body: { ok: false, code: 'ERR_SERVER_BUSY' } }]);
  assert.strictEqual(calls.length, 3); assert.strictEqual(res.code, 'ERR_SERVER_BUSY');
});
check('getBackendTimeoutMs: per-action timeouts', () => {
  assert.strictEqual(cbCtx.getBackendTimeoutMs('TEACHER_REBUILD_REPORT'), 90000);
  assert.strictEqual(cbCtx.getBackendTimeoutMs('STUDENT_CHECKIN'), 25000);
  assert.strictEqual(cbCtx.getBackendTimeoutMs('TEACHER_CONTROL_SESSION'), 45000);
  assert.strictEqual(cbCtx.getBackendTimeoutMs('TEACHER_GET_STATE'), 15000);
  assert.strictEqual(cbCtx.getBackendTimeoutMs('TEACHER_AUTH'), 15000);
  assert.strictEqual(cbCtx.getBackendTimeoutMs('PING'), 15000);
});

console.log('--- P4-7: static checks (teacher.js / schedule-config.js) ---');
check('teacher.js: rebuild button i18n key used, TEACHER_REBUILD_SHEET gone everywhere in js/', () => {
  assert.ok(/tea_rebuild_sheet_btn/.test(teaSrc));
  assert.ok(!/TEACHER_REBUILD_SHEET/.test(teaSrc));
  feFiles.forEach(([n, s]) => assert.ok(!/TEACHER_REBUILD_SHEET/.test(s), n));
});
check('teacher.js: fullscreenchange listener exits the pin spotlight', () => {
  assert.ok(/addEventListener\('fullscreenchange'[\s\S]{0,120}exitPinSpotlightMode\(\)/.test(teaSrc));
});
check('teacher.js: logoutTeacher calls stopAllTeacherTimers', () => {
  assert.ok(/stopAllTeacherTimers\(\)/.test(fnBody(teaSrc, 'logoutTeacher')));
});
check('teacher.js: stopAllTeacherTimers stops polling, countdown and the PIN projector loop', () => {
  const b = fnBody(teaSrc, 'stopAllTeacherTimers');
  assert.ok(/stopTeacherPolling/.test(b) && /teacherCountdownTimer/.test(b) && /stopTeacherPin10sProjectorLoop/.test(b));
});
check('escapeJsArg("O\'Neil") is safe inside onclick="f(\'...\')" after HTML-entity decoding', () => {
  const c = vm.createContext({}); vm.runInContext(extractFns(scSrc, ['escapeHtml', 'escapeJsArg']), c);
  const enc = c.escapeJsArg("O'Neil");
  assert.ok(!/'/.test(enc), 'raw quote left in attribute: ' + enc);
  const decoded = enc.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  let got; c.f = v => { got = v; };
  vm.runInContext("f('" + decoded + "')", c);
  assert.strictEqual(got, "O'Neil");
  const evil = c.escapeJsArg("x');alert(1);//\\");
  const dec2 = evil.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
  got = undefined; vm.runInContext("f('" + dec2 + "')", c);
  assert.strictEqual(got, "x');alert(1);//\\");
});
check('escapeHtml escapes & < > " \' and null/undefined -> empty', () => {
  const c = vm.createContext({}); vm.runInContext(extractFns(scSrc, ['escapeHtml']), c);
  assert.strictEqual(c.escapeHtml('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.strictEqual(c.escapeHtml(null), ''); assert.strictEqual(c.escapeHtml(undefined), '');
});
check('stripRemainingEmojis keeps newlines but removes emojis', () => {
  const c = vm.createContext({}); vm.runInContext(extractFns(scSrc, ['stripRemainingEmojis']), c);
  assert.strictEqual(c.stripRemainingEmojis('a\n\nb'), 'a\n\nb');
  assert.strictEqual(c.stripRemainingEmojis('a\nb'), 'a\nb');
  assert.strictEqual(c.stripRemainingEmojis('a\n\n\n\nb'), 'a\n\nb');
  assert.strictEqual(c.stripRemainingEmojis('ok \u{1F680}'), 'ok');
});

(async () => {
  for (const [name, fn] of p4Async) {
    try { await fn(); console.log('  OK   ' + name); }
    catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
  }
  console.log(failures ? '\n' + failures + ' CORE TEST(S) FAILED' : '\nALL CORE TESTS PASSED!');
  process.exit(failures ? 1 : 0);
})();
