/**
 * v3.11.0 GPS anchor / fallback tests (B1). Runs the REAL backend (newest code<X.Y.Z>.text) in a vm with in-memory
 * Sheets, Cache, Properties. Covers the 13 B1 scenarios from plan.md (PIN excluded).
 * Usage: node test-gps-anchor.js [path-to-backend.text]
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../../../..');
const newest = fs.readdirSync(ROOT).filter(f => /^code\d+\.\d+\.\d+\.text$/.test(f))
  .sort((a, b) => { const pa = a.match(/\d+/g).map(Number), pb = b.match(/\d+/g).map(Number); for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i]; return 0; }).pop();
const backendSrc = fs.readFileSync(process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, newest), 'utf8');

let failures = 0, assertions = 0;
function check(name, fn) {
  try { fn(); console.log('  OK   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + String(e.stack || e.message).split('\n').slice(0, 3).join('\n       ')); }
}
const eq = (a, b, m) => { assertions++; assert.strictEqual(a, b, m); };
const ok = (v, m) => { assertions++; assert.ok(v, m); };

const C = { lat: 10.8, lng: 106.6 };
const off = (n, e, base) => { const b = base || C; return { lat: b.lat + n / 111320, lng: b.lng + e / (111320 * Math.cos(b.lat * Math.PI / 180)) }; };

function fmtDate(d, tz, f) {
  const dt = new Date(d);
  if (f === "yyyy-MM-dd'T'HH:mm:ss") return dt.toISOString().slice(0, 19) + 'Z';
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(dt);
  const g = t => parts.find(p => p.type === t).value;
  const mon = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short' }).format(dt);
  return f.replace(/'([^']*)'|yyyy|MMM|MM|dd|HH|mm|ss/g, (m, lit) => lit !== undefined ? lit : ({ yyyy: g('year'), MMM: mon, MM: g('month'), dd: g('day'), HH: g('hour'), mm: g('minute'), ss: g('second') })[m]);
}

function grid(rows) {
  return {
    rows,
    getLastRow: () => rows.length + 1,
    getLastColumn: () => 11,
    appendRow: r => { rows.push(r.slice()); },
    getRange: (r, c, nr, nc) => ({
      getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = rows[r - 2 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
      setValues: vals => { for (let i = 0; i < nr; i++) { if (!rows[r - 2 + i]) rows[r - 2 + i] = []; for (let j = 0; j < nc; j++) rows[r - 2 + i][c - 1 + j] = vals[i][j]; } },
      getValue: () => '', setValue: () => {}
    })
  };
}

const STUDENTS = []; for (let i = 1; i <= 14; i++) STUDENTS.push({ id: 'S' + String(i).padStart(3, '0'), name: 'Student ' + i });

function buildEnv(opts) {
  opts = opts || {};
  const center = opts.center === undefined ? C : opts.center;
  const store = {};
  const cache = { get: k => (k in store ? store[k] : null), put: (k, v) => { store[k] = v; }, remove: k => { delete store[k]; }, removeAll: ks => ks.forEach(k => delete store[k]) };
  const props = Object.assign({}, opts.props || {});
  const classRows = [['C1', 'Class 1', 'QR_C1_SECRET', center ? center.lat : '', center ? center.lng : '', 100, 3, 15, 'YES']];
  const sheets = {
    Classes_Config: grid(classRows), Sessions_Log: grid([]), Attendance_Log: grid([]), Device_Registry: grid([]), Audit_Log: grid([]),
    'Setup_&_Dashboard': { getRange: () => ({ getValue: () => '', setValue: () => {} }) }
  };
  const ss = { getSheetByName: n => sheets[n] || null, getName: () => 'M', getId: () => 'X' };
  const sandbox = {
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    SpreadsheetApp: { flush: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
    Utilities: { formatDate: fmtDate },
    console
  };
  if (opts.scriptTz) sandbox.Session = { getScriptTimeZone: () => opts.scriptTz };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(backendSrc, ctx);
  const env = { ctx, ss, sheets, store, cache, props, classRows, audit: [], n: 0 };
  ctx.__env = env; ctx.__students = STUDENTS;
  ctx.__sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
  vm.runInContext(`
    jsonResponse = o => o;
    sha256Hex = s => __sha(s);
    logAudit = (s, actor, action, target, details) => __env.audit.push({ actor, action, target, details });
    getClassRosterMap = () => { const m = {}; __students.forEach(s => { m[normalizeId(s.id)] = { studentId: normalizeId(s.id), fullName: s.name }; }); return m; };
    getStoredClassSchedulesMap = () => ({});
    verifyClassroomQr = () => true;
    verifyStudentCredential = () => ({ ok: true });
    isStudentCredentialVerified_ = () => true;
    getTodayCalendarEventsCached = () => [];
    getActiveGroupSplitForClass_ = () => null;
  `, ctx);
  return env;
}

const start = (env, body) => env.ctx.handleTeacherStartSession(env.ss, Object.assign({ classId: 'C1', requestId: 'T' + (++env.n) }, body || {}));
const startFallback = env => start(env, { usePhoneGps: false, anchorMode: 'STUDENT_AVG_3' });
const state = env => env.ctx.handleTeacherGetState(env.ss, { classId: 'C1' });
const sesId = env => env.sheets.Sessions_Log.rows[env.sheets.Sessions_Log.rows.length - 1][0];
const anchor = env => JSON.parse(env.store['SES_ANCHOR_' + sesId(env)]);
function checkIn(env, sid, pos, extra) {
  env.n++;
  return env.ctx.handleStudentCheckIn(env.ss, Object.assign({
    studentId: sid, classId: 'C1', credential: 'cred_' + sid + '_xxxxxxxxxxxx', deviceFp: 'FP_' + sid, requestId: 'R' + env.n,
    lat: pos.lat, lng: pos.lng, accuracy: 10
  }, extra || {}), Date.now());
}
const rosterOf = (st, sid) => st.roster.find(r => r.studentId === sid);
const attRows = env => env.sheets.Attendance_Log.rows;
const sid = i => 'S' + String(i).padStart(3, '0');
const classroom = i => off(-15 + (i % 5) * 4, -10 + i * 3);

console.log('--- 1. teacher GPS near the center (D7) ---');
check('GPS 50 m from center -> LOCKED teacher anchor, Classes_Config D/E updated', () => {
  const env = buildEnv(); const g = off(50, 0);
  const st = start(env, { usePhoneGps: true, lat: g.lat, lng: g.lng });
  const ai = st.activeSession.anchorInfo;
  eq(ai.source, 'TEACHER_GPS'); eq(ai.locked, true);
  eq(env.classRows[0][3], g.lat); eq(env.classRows[0][4], g.lng);
});

console.log('--- 2. teacher GPS 20 km away (D4) ---');
check('far GPS -> D/E kept, fallback session, TEACHER_GPS_FAR, students in class check in', () => {
  const env = buildEnv(); const g = off(20000, 0);
  const st = start(env, { usePhoneGps: true, lat: g.lat, lng: g.lng });
  const ai = st.activeSession.anchorInfo;
  eq(env.classRows[0][3], C.lat); eq(env.classRows[0][4], C.lng);
  eq(ai.source, 'STUDENT_CLUSTER'); eq(ai.locked, false);
  eq(ai.warning.code, 'TEACHER_GPS_FAR'); ok(Math.abs(ai.warning.distM - 20000) < 100, 'distM ' + ai.warning.distM);
  for (let i = 1; i <= 3; i++) eq(checkIn(env, sid(i), classroom(i)).ok, true);
  eq(anchor(env).mode, 'LOCKED');
});

console.log('--- 3. class without a center (D2, D8) ---');
[['Hanoi', { lat: 21.03, lng: 105.85 }], ['Paris', { lat: 48.85, lng: 2.35 }]].forEach(([nm, pt]) => {
  check(nm + ': ERR_CENTER_REQUIRED, calibrate MAP, open session, nearby students accepted', () => {
    const env = buildEnv({ center: null });
    eq(start(env, { usePhoneGps: false }).code, 'ERR_CENTER_REQUIRED');
    eq(env.sheets.Sessions_Log.rows.length, 0);
    const cal = start(env, { calibrateOnly: true, lat: pt.lat, lng: pt.lng, source: 'MAP' });
    ok(cal.code !== 'ERR_INVALID_COORDS' && cal.ok !== false, 'calibrate failed ' + JSON.stringify(cal.code));
    eq(env.classRows[0][3], pt.lat);
    ok(env.audit.some(a => a.action === 'CLASS_CENTER_SET' && /MAP/.test(a.details)), 'audit');
    startFallback(env);
    for (let i = 1; i <= 3; i++) eq(checkIn(env, sid(i), off(i * 3, i * 2, pt)).ok, true);
    eq(anchor(env).mode, 'LOCKED');
  });
});
check('calibrate while a session is open updates the open session anchor', () => {
  const env = buildEnv(); startFallback(env);
  const pt = off(100, 100);
  start(env, { calibrateOnly: true, lat: pt.lat, lng: pt.lng, source: 'MANUAL' });
  const a = anchor(env); eq(a.mode, 'LOCKED'); eq(a.lat, pt.lat);
  eq(env.sheets.Sessions_Log.rows[0][7], pt.lat);
});

console.log('--- 4. two students at home scan first (D6) ---');
check('home pair reverted after the class cluster locks; rescan rejected; D/E unchanged', () => {
  const env = buildEnv(); startFallback(env);
  const home = off(150, 0);
  eq(checkIn(env, sid(1), home).ok, true);
  eq(checkIn(env, sid(2), off(150, 3)).ok, true);
  eq(anchor(env).mode, 'COLLECTING_AVG_3');
  for (let i = 3; i <= 5; i++) eq(checkIn(env, sid(i), off(-20 + i, i * 2)).ok, true);
  const a = anchor(env); eq(a.mode, 'LOCKED'); eq(a.source, 'STUDENT_CLUSTER');
  eq(env.audit.filter(x => x.action === 'ANCHOR_OUTLIER_REVERTED').length, 2);
  eq(env.classRows[0][3], C.lat); eq(env.classRows[0][4], C.lng);
  const st = state(env);
  eq(rosterOf(st, sid(1)).p1Status, '-'); eq(rosterOf(st, sid(2)).p1Status, '-');
  eq(rosterOf(st, sid(1)).code, 'ANCHOR_OUTLIER_REVERTED');
  eq(rosterOf(st, sid(3)).p1Status, 'P');
  eq(st.activeSession.anchorInfo.revertedCount, 2);
  const again = checkIn(env, sid(1), home);
  eq(again.code, 'ERR_LOCATION_OUT_OF_RANGE');
  const ping = env.ctx.handlePing(env.ss, { studentId: sid(1), credential: 'cred_' + sid(1) + '_xxxxxxxxxxxx' });
  ok(ping.classes.some(c => c.code === 'ANCHOR_OUTLIER_REVERTED'), 'ping notice');
});
check('manual mark made by the teacher on a provisional student is NOT reverted', () => {
  const env = buildEnv(); startFallback(env);
  eq(checkIn(env, sid(1), off(150, 0)).ok, true);
  env.ctx.handleTeacherManualMark(env.ss, { classId: 'C1', studentId: sid(1), status: 'P', requestId: 'M1' });
  for (let i = 3; i <= 5; i++) checkIn(env, sid(i), off(-20 + i, i * 2));
  eq(anchor(env).mode, 'LOCKED');
  eq(env.audit.filter(x => x.action === 'ANCHOR_OUTLIER_REVERTED').length, 0);
  const row = attRows(env).filter(r => r[4] === sid(1))[0];
  eq(row[5], 'P'); eq(row[9], 'TEACHER_MANUAL');
});

console.log('--- 5. canteen student first ---');
check('canteen (180 m) reverted after lock; rescan from class is accepted', () => {
  const env = buildEnv(); startFallback(env);
  eq(checkIn(env, sid(1), off(0, 180)).ok, true);
  for (let i = 2; i <= 4; i++) eq(checkIn(env, sid(i), classroom(i)).ok, true);
  eq(rosterOf(state(env), sid(1)).p1Status, '-');
  const r = checkIn(env, sid(1), classroom(9));
  eq(r.ok, true, JSON.stringify(r));
  eq(rosterOf(state(env), sid(1)).p1Status, 'P');
});

console.log('--- 6. scattered samples ---');
check('8 samples without a cluster -> still collecting, ANCHOR_NO_CLUSTER', () => {
  const env = buildEnv(); startFallback(env);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4;
    eq(checkIn(env, sid(i + 1), off(190 * Math.cos(a), 190 * Math.sin(a))).ok, true, 'student ' + i);
  }
  eq(anchor(env).mode, 'COLLECTING_AVG_3');
  const ai = state(env).activeSession.anchorInfo;
  eq(ai.locked, false); eq(ai.warning.code, 'ANCHOR_NO_CLUSTER');
});

console.log('--- 7. teacher GPS off by 300 m (D5) ---');
check('3 students rejected at the same spot -> TEACHER_GPS_SUSPECT', () => {
  const env = buildEnv(); const g = off(300, 0);
  start(env, { usePhoneGps: true, lat: g.lat, lng: g.lng });
  for (let i = 1; i <= 3; i++) eq(checkIn(env, sid(i), classroom(i)).code, 'ERR_LOCATION_OUT_OF_RANGE');
  const w = state(env).activeSession.anchorInfo.warning;
  eq(w.code, 'TEACHER_GPS_SUSPECT'); ok(Math.abs(w.distM - 300) < 30, 'distM ' + w.distM);
});

console.log('--- 8. invalid calibrate ---');
[[91, 0], [0, 0], [NaN, 10], [10, 181]].forEach(([la, ln]) => {
  check('calibrate ' + la + ',' + ln + ' -> ERR_INVALID_COORDS', () => {
    const env = buildEnv();
    eq(start(env, { calibrateOnly: true, lat: la, lng: ln, source: 'MAP' }).code, 'ERR_INVALID_COORDS');
    eq(env.classRows[0][3], C.lat);
  });
});
check('calibrate/start action requires teacher auth', () => {
  const env = buildEnv(); let called = false;
  const r = env.ctx.requireTeacherAuth(env.ss, { teacherToken: 'nope' }, () => { called = true; return { ok: true }; });
  eq(called, false); eq(r.ok, false);
});

console.log('--- 9. concurrent third sample ---');
check('stale pre-lock read: locks once, no double revert', () => {
  const env = buildEnv(); startFallback(env);
  checkIn(env, sid(1), off(150, 0));
  checkIn(env, sid(2), classroom(2)); checkIn(env, sid(3), classroom(3));
  const key = 'SES_ANCHOR_' + sesId(env), stale = env.store[key];
  eq(checkIn(env, sid(4), classroom(4)).ok, true);
  eq(anchor(env).mode, 'LOCKED');
  const reverts = env.audit.filter(x => x.action === 'ANCHOR_OUTLIER_REVERTED').length;
  const realGet = env.cache.get; let first = true;
  env.cache.get = k => { if (k === key && first) { first = false; return stale; } return realGet(k); };
  eq(checkIn(env, sid(5), classroom(5)).ok, true);
  env.cache.get = realGet;
  eq(env.audit.filter(x => x.action === 'ANCHOR_OUTLIER_REVERTED').length, reverts);
  eq(anchor(env).mode, 'LOCKED'); eq(anchor(env).clusterSize, 3);
});

console.log('--- 10. dormitory group at 500 m ---');
check('3 students 500 m away are rejected (fallbackMaxM 200), no cluster', () => {
  const env = buildEnv(); startFallback(env);
  for (let i = 1; i <= 3; i++) {
    const r = checkIn(env, sid(i), off(500 + i, i));
    eq(r.code, 'ERR_LOCATION_OUT_OF_RANGE'); eq(r.params.max, 200);
  }
  eq(anchor(env).samples.length, 0);
});

check('cluster 240 m out with accuracy 50 passes per-student check but must NOT lock (fallbackMaxM 200)', () => {
  const env = buildEnv(); startFallback(env);
  for (let i = 1; i <= 3; i++) checkIn(env, sid(i), off(240, i), { accuracy: 50 });
  ok(anchor(env).mode !== 'LOCKED', 'must not lock outside fallbackMaxM');
  eq(env.sheets.Classes_Config.rows[0][3], C.lat);
});

console.log('--- 11. fallback session state ---');
check('P1 fallback stays STATIC; roster has distM/provisional/suspectReasons', () => {
  const env = buildEnv(); startFallback(env);
  checkIn(env, sid(1), classroom(1));
  const st = state(env);
  eq(st.activeSession.qrMode, 'STATIC');
  eq(st.activeSession.anchorInfo.provisionalCount, 1);
  const r = rosterOf(st, sid(1));
  eq(r.provisional, true); eq(typeof r.distM, 'number'); ok(Array.isArray(r.suspectReasons));
  eq(rosterOf(st, sid(2)).provisional, false);
});

console.log('--- 12. duplicate coordinates (D11) ---');
check('same 6-decimal coords -> both DUPLICATE_COORDS, neither is a sample', () => {
  const env = buildEnv(); startFallback(env);
  const p = off(5, 5);
  checkIn(env, sid(1), p); checkIn(env, sid(2), p);
  const st = state(env);
  ok(rosterOf(st, sid(1)).suspectReasons.indexOf('DUPLICATE_COORDS') >= 0, 'first');
  ok(rosterOf(st, sid(2)).suspectReasons.indexOf('DUPLICATE_COORDS') >= 0, 'second');
  eq(anchor(env).samples.length, 0);
});
const env0 = buildEnv();
check('findAnchorCluster_ pure: needs 3 within radius, prefers larger cluster', () => {
  const f = env0.ctx.findAnchorCluster_;
  eq(f([{ studentId: 'a', lat: 1, lng: 1 }, { studentId: 'b', lat: 1, lng: 1.00001 }], 100), null);
  const cl = f([{ studentId: 'a', lat: 1, lng: 1 }, { studentId: 'b', lat: 1, lng: 1.00002 }, { studentId: 'c', lat: 1.00002, lng: 1 }, { studentId: 'x', lat: 2, lng: 2 }], 100);
  eq(cl.size, 3);
});

console.log('--- 13. timezone (D12) ---');
check('QR_TIMEZONE=Europe/Paris -> sessionId hour follows Paris', () => {
  const env = buildEnv({ props: { QR_TIMEZONE: 'Europe/Paris' } });
  eq(vm.runInContext('TIMEZONE', env.ctx), 'Europe/Paris');
  startFallback(env);
  const id = sesId(env);
  eq(id.slice(-6, -4), fmtDate(Date.now(), 'Europe/Paris', 'HH'));
});
check('invalid tz name falls back to default; Session tz used when property absent', () => {
  eq(vm.runInContext('TIMEZONE', buildEnv({ props: { QR_TIMEZONE: 'Mars/Phobos' } }).ctx), 'Asia/Ho_Chi_Minh');
  eq(vm.runInContext('TIMEZONE', buildEnv({ scriptTz: 'Asia/Tokyo' }).ctx), 'Asia/Tokyo');
  eq(vm.runInContext('TIMEZONE', buildEnv().ctx), 'Asia/Ho_Chi_Minh');
});
check('calibrate saves QR_TIMEZONE only with confirmTimeZone:true, valid name, and never overwrites', () => {
  const env = buildEnv({ center: null });
  const cal = extra => start(env, Object.assign({ calibrateOnly: true, lat: 48.85, lng: 2.35, source: 'MAP' }, extra));
  cal({ timeZone: 'Europe/Paris' });
  eq(env.props.QR_TIMEZONE, undefined);
  cal({ timeZone: 'Nowhere/City', confirmTimeZone: true });
  eq(env.props.QR_TIMEZONE, undefined);
  cal({ timeZone: 'Europe/Paris', confirmTimeZone: true });
  eq(env.props.QR_TIMEZONE, 'Europe/Paris');
  cal({ timeZone: 'Asia/Tokyo', confirmTimeZone: true });
  eq(env.props.QR_TIMEZONE, 'Europe/Paris');
});
check('todayKey in PING and teacher state follows TIMEZONE', () => {
  const env = buildEnv({ props: { QR_TIMEZONE: 'Pacific/Kiritimati' } });
  const want = fmtDate(Date.now(), 'Pacific/Kiritimati', 'yyyy-MM-dd');
  eq(state(env).todayKey, want);
  eq(env.ctx.handlePing(env.ss, {}).todayKey, want);
});

check('calibrate does NOT change QR_TIMEZONE once sessions already exist (keeps old dayKeys)', () => {
  const env = buildEnv({ center: null });
  env.sheets.Sessions_Log.rows.push(['SES_OLD', 'C1', 'x', '2026-11-10T01:00:00+07:00', '', '', '', 1, 1, 100, 'STATIC']);
  start(env, { calibrateOnly: true, lat: 48.85, lng: 2.35, source: 'MAP', timeZone: 'Europe/Paris', confirmTimeZone: true });
  eq(env.props.QR_TIMEZONE, undefined);
});

console.log('--- 14. teacher GPS 200-850 m from the stored center ---');
[['new session', false], ['open session', true]].forEach(([nm, open]) => {
  check(nm + ': GPS 400 m out -> LOCKED anchor, Classes_Config D/E NOT overwritten; 150 m -> D/E updated', () => {
    const env = buildEnv(); const g = off(400, 0);
    if (open) startFallback(env);
    const st = start(env, { usePhoneGps: true, lat: g.lat, lng: g.lng });
    const a = anchor(env);
    eq(a.mode, 'LOCKED'); eq(a.source, 'TEACHER_GPS'); eq(a.lat, g.lat); eq(a.lng, g.lng);
    if (!open) eq(st.activeSession.anchorInfo.locked, true);
    eq(env.classRows[0][3], C.lat); eq(env.classRows[0][4], C.lng);
    const env2 = buildEnv(); const n = off(150, 0);
    if (open) startFallback(env2);
    start(env2, { usePhoneGps: true, lat: n.lat, lng: n.lng });
    eq(env2.classRows[0][3], n.lat); eq(env2.classRows[0][4], n.lng);
  });
});

console.log('--- 15. open session lost its anchor (H/I empty, cache expired) ---');
[['empty', ['', '']], ['0,0', [0, 0]]].forEach(([nm, hi]) => {
  check('H/I ' + nm + ' + no SES_ANCHOR cache -> first student near center accepted, fallback anchor re-created', () => {
    const env = buildEnv(); startFallback(env);
    const row = env.sheets.Sessions_Log.rows[0]; row[7] = hi[0]; row[8] = hi[1];
    delete env.store['SES_ANCHOR_' + sesId(env)];
    try { env.cache.removeAll(['ALL_LATEST_SES_V373', 'ALL_LATEST_SES_V35']); } catch (e) {}
    const r = checkIn(env, sid(1), classroom(1));
    ok(r.code !== 'ERR_LOCATION_OUT_OF_RANGE' && r.ok === true, JSON.stringify(r));
    const a = anchor(env); eq(a.mode, 'COLLECTING_AVG_3'); eq(a.campusLat, C.lat);
  });
});

console.log('--- D1/D9 helpers ---');
check('QR_DEFAULT_CAMPUS_LATLNG, QR_CAMPUS_MAX_M, QR_FALLBACK_MAX_M', () => {
  const e = buildEnv({ props: { QR_DEFAULT_CAMPUS_LATLNG: '21.03, 105.85', QR_CAMPUS_MAX_M: '500', QR_FALLBACK_MAX_M: '120' } });
  eq(e.ctx.getDefaultCampusLatLng_().lat, 21.03); eq(e.ctx.getCampusMaxM_(), 500); eq(e.ctx.getFallbackMaxM_(), 120);
  eq(env0.ctx.getDefaultCampusLatLng_(), null); eq(env0.ctx.getCampusMaxM_(), 850); eq(env0.ctx.getFallbackMaxM_(), 200);
});

console.log('\n' + (failures ? 'GPS ANCHOR FAILURES: ' + failures : 'ALL GPS ANCHOR TESTS PASSED! (' + assertions + ' assertions)'));
process.exit(failures ? 1 : 0);
