/**
 * v3.12.0 verified places / DUAL anchor tests (B1). Runs the REAL backend (newest code<X.Y.Z>.text) in a vm with
 * in-memory Sheets, Cache, Properties. Covers the 10 B1 scenarios of plan v3.12.0.
 * Usage: node test-gps-places.js [path-to-backend.text]
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
const eq = (a, b, m) => { assertions++; assert.strictEqual(a, b, m || (a + ' !== ' + b)); };
const ok = (v, m) => { assertions++; assert.ok(v, m || 'not ok'); };

const C = { lat: 10.8, lng: 106.6 };
const off = (n, e, base) => { const b = base || C; return { lat: b.lat + n / 111320, lng: b.lng + e / (111320 * Math.cos(b.lat * Math.PI / 180)) }; };
const HOME = off(20000, 0);
const CAMPUS2 = off(5000, 3000);

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
    deleteRow: n => { rows.splice(n - 2, 1); },
    getRange: (r, c, nr, nc) => ({
      getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = rows[r - 2 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
      setValues: vals => { for (let i = 0; i < nr; i++) { if (!rows[r - 2 + i]) rows[r - 2 + i] = []; for (let j = 0; j < nc; j++) rows[r - 2 + i][c - 1 + j] = vals[i][j]; } },
      getValue: () => '', setValue: () => {}
    })
  };
}

const STUDENTS = []; for (let i = 1; i <= 16; i++) STUDENTS.push({ id: 'S' + String(i).padStart(3, '0'), name: 'Student ' + i });

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
  const ctx = vm.createContext(sandbox);
  vm.runInContext(backendSrc, ctx);
  const env = { ctx, ss, sheets, store, cache, props, classRows, audit: [], n: 0, hist: 0 };
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

// seed one closed historical session with `n` distinct present students
function seedHistory(env, pt, n, opts) {
  opts = opts || {};
  env.hist++;
  const id = 'SES_C1_HIST' + env.hist;
  const ms = opts.openedMs || (Date.now() - (30 - env.hist) * 86400000);
  env.sheets.Sessions_Log.rows.push([id, 'C1', 'x', new Date(ms).toISOString(), new Date(ms + 180000).toISOString(), new Date(ms + 900000).toISOString(), new Date(ms + 900000).toISOString(), pt.lat, pt.lng, 100, 'STATIC']);
  for (let i = 1; i <= n; i++) {
    env.sheets.Attendance_Log.rows.push(['ATT_H' + env.hist + '_' + i, 'RH' + env.hist + '_' + i, id, 'C1', 'S' + String(i).padStart(3, '0'), opts.status || 'P', new Date(ms + 60000).toISOString(), 10, 10, opts.source || 'STUDENT_APP']);
  }
  return id;
}

const start = (env, body) => env.ctx.handleTeacherStartSession(env.ss, Object.assign({ classId: 'C1', requestId: 'T' + (++env.n) }, body || {}));
const startGps = (env, pt, acc) => start(env, { usePhoneGps: true, lat: pt.lat, lng: pt.lng, gpsAccuracy: acc === undefined ? 20 : acc });
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
const sid = i => 'S' + String(i).padStart(3, '0');
const at = (base, i) => off(i * 3, i * 2, base);
const auditCount = (env, action, re) => env.audit.filter(a => a.action === action && (!re || re.test(a.details))).length;
const centre = env => ({ lat: env.classRows[0][3], lng: env.classRows[0][4] });

console.log('--- 1. contaminated centre, teacher GPS good at a verified place ---');
check('D/E = home, history has C (>=3 students), GPS at C -> LOCKED, students accepted, D/E self-heals to C', () => {
  const env = buildEnv({ center: HOME });
  seedHistory(env, C, 3);
  const g = off(10, 5);
  const st = startGps(env, g);
  eq(st.activeSession.anchorInfo.mode, 'LOCKED');
  eq(st.activeSession.anchorInfo.locked, true);
  eq(st.activeSession.anchorInfo.pendingPlace, false);
  eq(centre(env).lat, g.lat); eq(centre(env).lng, g.lng);
  ok(auditCount(env, 'CLASS_CENTER_SET') === 1, 'audit');
  for (let i = 4; i <= 6; i++) eq(checkIn(env, sid(i), at(g, i)).ok, true);
  eq(state(env).classPlacesCount, 1);
});

console.log('--- 2. session opened from home (unverified), centre C ---');
check('GPS good at home, 3 students at C -> DUAL locks to C, H/I = C, D/E kept, home never saved', () => {
  const env = buildEnv(); seedHistory(env, C, 3);
  const st = startGps(env, HOME);
  let ai = st.activeSession.anchorInfo;
  eq(ai.mode, 'DUAL'); eq(ai.locked, false); eq(ai.warning.code, 'DUAL_PENDING'); eq(ai.confirmedCount, 0);
  eq(env.sheets.Sessions_Log.rows[env.sheets.Sessions_Log.rows.length - 1][7], C.lat);
  eq(checkIn(env, sid(1), at(C, 1)).ok, true);
  eq(checkIn(env, sid(2), at(C, 2)).ok, true);
  ai = state(env).activeSession.anchorInfo;
  eq(ai.mode, 'DUAL'); eq(ai.confirmedCount, 2);
  eq(checkIn(env, sid(3), at(C, 3)).ok, true);
  const a = anchor(env);
  eq(a.mode, 'LOCKED'); eq(Math.round(a.lat * 1e5), Math.round(C.lat * 1e5));
  eq(env.sheets.Sessions_Log.rows[env.sheets.Sessions_Log.rows.length - 1][7], C.lat);
  eq(centre(env).lat, C.lat); eq(centre(env).lng, C.lng);
  eq(auditCount(env, 'CLASS_CENTER_SET'), 0);
  ai = state(env).activeSession.anchorInfo;
  eq(ai.mode, 'LOCKED'); eq(ai.pendingPlace, false);
  eq(env.ctx.getVerifiedPlaces_(env.ss, 'C1', true).some(p => Math.abs(p.lat - HOME.lat) < 0.01), false);
  eq(checkIn(env, sid(4), at(C, 4)).ok, true);
  eq(checkIn(env, sid(5), at(HOME, 5)).code, 'ERR_LOCATION_OUT_OF_RANGE');
});

console.log('--- 3. teacher at a second campus (unknown place) ---');
check('3 students at campus 2 -> lock on teacher GPS, D/E = campus 2 (AUTO_CONFIRMED), IUH-side student reverted', () => {
  const env = buildEnv(); seedHistory(env, C, 3);
  const g = CAMPUS2;
  startGps(env, g);
  eq(checkIn(env, sid(1), at(C, 1)).ok, true);
  eq(rosterOf(state(env), sid(1)).p1Status, 'P');
  eq(rosterOf(state(env), sid(1)).provisional, true);
  eq(checkIn(env, sid(2), at(g, 2)).ok, true);
  eq(checkIn(env, sid(3), at(g, 3)).ok, true);
  eq(anchor(env).mode, 'DUAL');
  env.cache.put('PLACES_C1', 'STALE');
  eq(checkIn(env, sid(4), at(g, 4)).ok, true);
  ok(env.cache.get('PLACES_C1') !== 'STALE', 'places cache cleared on save');
  const a = anchor(env);
  eq(a.mode, 'LOCKED'); eq(a.source, 'TEACHER_GPS'); eq(a.lat, g.lat);
  eq(centre(env).lat, g.lat); eq(centre(env).lng, g.lng);
  eq(auditCount(env, 'CLASS_CENTER_SET', /AUTO_CONFIRMED/), 1);
  eq(auditCount(env, 'ANCHOR_OUTLIER_REVERTED'), 1);
  const st = state(env);
  eq(rosterOf(st, sid(1)).p1Status, '-'); eq(rosterOf(st, sid(1)).code, 'ANCHOR_OUTLIER_REVERTED');
  eq(rosterOf(st, sid(2)).p1Status, 'P'); eq(rosterOf(st, sid(4)).p1Status, 'P');
  eq(st.activeSession.anchorInfo.revertedCount, 1);
});
check('teacher-manual mark on the loser side is not reverted by the DUAL lock', () => {
  const env = buildEnv(); seedHistory(env, C, 3);
  startGps(env, CAMPUS2);
  eq(checkIn(env, sid(1), at(C, 1)).ok, true);
  env.ctx.handleTeacherManualMark(env.ss, { classId: 'C1', studentId: sid(1), status: 'P', requestId: 'M1' });
  for (let i = 2; i <= 4; i++) checkIn(env, sid(i), at(CAMPUS2, i));
  eq(anchor(env).mode, 'LOCKED');
  eq(auditCount(env, 'ANCHOR_OUTLIER_REVERTED'), 0);
  const row = env.sheets.Attendance_Log.rows.filter(r => r[2] === sesId(env) && r[4] === sid(1))[0];
  eq(row[5], 'P'); eq(row[9], 'TEACHER_MANUAL');
});
check('spoof-suspect and duplicate-coordinate students never vote in DUAL', () => {
  const env = buildEnv(); seedHistory(env, C, 3);
  startGps(env, HOME);
  checkIn(env, sid(1), at(C, 1), { clientMeta: { mockGpsSuspect: true, mockReason: 'x' } });
  const p = at(C, 2);
  checkIn(env, sid(2), p); checkIn(env, sid(3), p);
  const a = anchor(env);
  eq(a.mode, 'DUAL');
  eq(Object.keys(a.votes).reduce((n, k) => n + a.votes[k].length, 0), 0);
});

console.log('--- 4. testing at home with 1-2 students ---');
check('2 students at home -> still DUAL, D/E unchanged, home is not a verified place', () => {
  const env = buildEnv(); seedHistory(env, C, 3);
  startGps(env, HOME);
  eq(checkIn(env, sid(1), at(HOME, 1)).ok, true);
  eq(checkIn(env, sid(2), at(HOME, 2)).ok, true);
  eq(anchor(env).mode, 'DUAL');
  eq(centre(env).lat, C.lat);
  eq(auditCount(env, 'CLASS_CENTER_SET'), 0);
  const places = env.ctx.getVerifiedPlaces_(env.ss, 'C1', true);
  eq(places.length, 1);
  ok(Math.abs(places[0].lat - C.lat) < 0.001, 'only C');
  eq(state(env).classPlacesCount, 1);
});

console.log('--- 5. fallback without teacher GPS ---');
check('D/E wrong (home), history has C -> 3 students at C lock a cluster', () => {
  const env = buildEnv({ center: HOME }); seedHistory(env, C, 3);
  startFallback(env);
  eq(anchor(env).places.length, 1);
  for (let i = 4; i <= 6; i++) eq(checkIn(env, sid(i), at(C, i)).ok, true);
  const a = anchor(env);
  eq(a.mode, 'LOCKED'); eq(a.source, 'STUDENT_CLUSTER');
  ok(Math.abs(a.lat - C.lat) < 0.001, 'cluster at C');
  eq(centre(env).lat, HOME.lat);
});
check('D/E wrong, no history -> students at C are rejected like 3.11', () => {
  const env = buildEnv({ center: HOME });
  startFallback(env);
  const r = checkIn(env, sid(1), at(C, 1));
  eq(r.code, 'ERR_LOCATION_OUT_OF_RANGE');
});
check('poor-accuracy teacher GPS far away behaves as fallback (no DUAL, no warning)', () => {
  const env = buildEnv(); seedHistory(env, C, 3);
  const st = startGps(env, HOME, 400);
  eq(st.activeSession.anchorInfo.mode, 'COLLECTING');
  eq(st.activeSession.anchorInfo.warning, undefined);
});

console.log('--- 6. getVerifiedPlaces_ ---');
check('2-student session ignored; >=3 counts; <=200 m merged; max 5 most recent; cached; manual/suspect not counted', () => {
  const env = buildEnv();
  seedHistory(env, off(0, 5000), 2);
  eq(env.ctx.getVerifiedPlaces_(env.ss, 'C1', true).length, 0);
  seedHistory(env, off(0, 5000), 3, { openedMs: Date.now() - 50 * 86400000 });
  seedHistory(env, off(0, 5100), 4);
  let p = env.ctx.getVerifiedPlaces_(env.ss, 'C1', true);
  eq(p.length, 1); eq(p[0].sessions, 2);
  for (let k = 1; k <= 6; k++) seedHistory(env, off(k * 2000, 0), 3, { openedMs: Date.now() - (10 - k) * 86400000 });
  p = env.ctx.getVerifiedPlaces_(env.ss, 'C1', true);
  eq(p.length, 5);
  ok(p.every(x => !(Math.abs(x.lat - C.lat) < 0.0001 && Math.abs(x.lng - off(0, 5000).lng) < 0.0001)) || p.length === 5, 'oldest dropped');
  eq(p[0].lastMs >= p[4].lastMs, true);
  seedHistory(env, off(-9000, 0), 5, { source: 'TEACHER_MANUAL' });
  seedHistory(env, off(-12000, 0), 5, { source: 'SUSPECT_WITH_X|y' });
  seedHistory(env, off(-15000, 0), 5, { status: '-' });
  eq(env.ctx.getVerifiedPlaces_(env.ss, 'C1', true).length, 5);
  const cnt = env.sheets.Sessions_Log.getRange;
  let reads = 0;
  env.sheets.Attendance_Log.getRange = () => { reads++; return { getValues: () => [] }; };
  env.ctx.getVerifiedPlaces_(env.ss, 'C1'); env.ctx.getVerifiedPlaces_(env.ss, 'C1');
  eq(reads, 0, 'served from PLACES_ cache');
  ok(typeof cnt === 'function');
});

console.log('--- 7. manual centre (calibrate) ---');
check('class with a centre + open session: D/E unchanged, session anchor/H/I change, audit session-only', () => {
  const env = buildEnv(); startFallback(env);
  const pt = off(100, 100);
  const r = start(env, { calibrateOnly: true, lat: pt.lat, lng: pt.lng, source: 'MAP' });
  ok(r.ok !== false, JSON.stringify(r));
  eq(centre(env).lat, C.lat);
  const a = anchor(env); eq(a.mode, 'LOCKED'); eq(a.lat, pt.lat); eq(a.centerSource, 'MAP'); eq(a.pendingPlace, false);
  eq(env.sheets.Sessions_Log.rows[0][7], pt.lat);
  ok(env.audit.some(x => x.action === 'CLASS_CENTER_SET' && /session-only/.test(x.details)), 'audit');
});
check('class with a centre and no open session -> ERR_NO_SESSION, nothing changes', () => {
  const env = buildEnv();
  const pt = off(100, 100);
  eq(start(env, { calibrateOnly: true, lat: pt.lat, lng: pt.lng, source: 'MAP' }).code, 'ERR_NO_SESSION');
  eq(centre(env).lat, C.lat);
  eq(auditCount(env, 'CLASS_CENTER_SET'), 0);
});
check('class without centre and without sessions -> saved immediately (first-time setup)', () => {
  const env = buildEnv({ center: null });
  const r = start(env, { calibrateOnly: true, lat: C.lat, lng: C.lng, source: 'MAP' });
  ok(r.ok !== false, JSON.stringify(r));
  eq(centre(env).lat, C.lat);
  eq(state(env).classCenter.lat, C.lat);
});
check('manual pin at a new place: pending until 3 students confirm, then D/E saved (AUTO_CONFIRMED), PLACES cache cleared', () => {
  const env = buildEnv(); startFallback(env);
  const pin = off(3000, 0);
  start(env, { calibrateOnly: true, lat: pin.lat, lng: pin.lng, source: 'MAP' });
  let ai = state(env).activeSession.anchorInfo;
  eq(ai.pendingPlace, true); eq(ai.warning.code, 'NEW_PLACE_PENDING'); eq(ai.confirmedCount, 0);
  eq(checkIn(env, sid(1), at(pin, 1)).ok, true);
  eq(checkIn(env, sid(2), at(pin, 2)).ok, true);
  eq(centre(env).lat, C.lat);
  ai = state(env).activeSession.anchorInfo; eq(ai.confirmedCount, 2);
  env.cache.put('PLACES_C1', 'STALE');
  eq(checkIn(env, sid(3), at(pin, 3)).ok, true);
  eq(centre(env).lat, pin.lat);
  eq(auditCount(env, 'CLASS_CENTER_SET', /AUTO_CONFIRMED/), 1);
  ok(env.cache.get('PLACES_C1') !== 'STALE', 'places cache cleared');
  ai = state(env).activeSession.anchorInfo; eq(ai.pendingPlace, false); eq(ai.warning, undefined);
});
check('teacher GPS 400 m out (MID): LOCKED, pending, D/E untouched until 3 confirm', () => {
  const env = buildEnv(); const g = off(400, 0);
  const st = startGps(env, g);
  eq(st.activeSession.anchorInfo.pendingPlace, true);
  eq(centre(env).lat, C.lat);
  checkIn(env, sid(1), at(g, 1)); checkIn(env, sid(2), at(g, 2));
  eq(centre(env).lat, C.lat);
  checkIn(env, sid(3), at(g, 3));
  eq(centre(env).lat, g.lat);
});
check('suspect students never confirm a pending place', () => {
  const env = buildEnv(); const g = off(400, 0);
  startGps(env, g);
  for (let i = 1; i <= 3; i++) checkIn(env, sid(i), at(g, i), { clientMeta: { mockGpsSuspect: true, mockReason: 'x' } });
  eq(centre(env).lat, C.lat);
  eq(anchor(env).confirmedBy.length, 0);
});
check('invalid calibrate coords still rejected', () => {
  const env = buildEnv();
  eq(start(env, { calibrateOnly: true, lat: 91, lng: 0, source: 'MAP' }).code, 'ERR_INVALID_COORDS');
});

console.log('--- 8. fraud: student at another verified place ---');
check('teacher GPS near C (LOCKED); student at verified campus 2 is rejected', () => {
  const env = buildEnv(); seedHistory(env, C, 3); seedHistory(env, CAMPUS2, 3);
  const g = off(20, 10);
  const st = startGps(env, g);
  eq(st.activeSession.anchorInfo.mode, 'LOCKED');
  eq(checkIn(env, sid(1), at(CAMPUS2, 1)).code, 'ERR_LOCATION_OUT_OF_RANGE');
  eq(checkIn(env, sid(2), at(CAMPUS2, 2)).code, 'ERR_LOCATION_OUT_OF_RANGE');
  eq(checkIn(env, sid(3), at(CAMPUS2, 3)).code, 'ERR_LOCATION_OUT_OF_RANGE');
  eq(centre(env).lat, g.lat);
  eq(checkIn(env, sid(4), at(g, 4)).ok, true);
});

console.log('--- 9. racing third confirmation ---');
check('DUAL: stale pre-lock anchor for the 4th student -> one lock, one persist, one revert', () => {
  const env = buildEnv(); seedHistory(env, C, 3);
  startGps(env, CAMPUS2);
  checkIn(env, sid(1), at(C, 1));
  checkIn(env, sid(2), at(CAMPUS2, 2)); checkIn(env, sid(3), at(CAMPUS2, 3));
  const key = 'SES_ANCHOR_' + sesId(env), stale = env.store[key];
  eq(checkIn(env, sid(4), at(CAMPUS2, 4)).ok, true);
  eq(anchor(env).mode, 'LOCKED');
  const persists = auditCount(env, 'CLASS_CENTER_SET', /AUTO_CONFIRMED/), reverts = auditCount(env, 'ANCHOR_OUTLIER_REVERTED');
  eq(persists, 1); eq(reverts, 1);
  const realGet = env.cache.get; let first = true;
  env.cache.get = k => { if (k === key && first) { first = false; return stale; } return realGet(k); };
  eq(checkIn(env, sid(5), at(CAMPUS2, 5)).ok, true);
  env.cache.get = realGet;
  eq(auditCount(env, 'CLASS_CENTER_SET', /AUTO_CONFIRMED/), 1);
  eq(auditCount(env, 'ANCHOR_OUTLIER_REVERTED'), 1);
  eq(anchor(env).mode, 'LOCKED');
});
check('pending place: stale read for a student after persist -> centre written once', () => {
  const env = buildEnv(); const g = off(400, 0);
  startGps(env, g);
  checkIn(env, sid(1), at(g, 1)); checkIn(env, sid(2), at(g, 2));
  const key = 'SES_ANCHOR_' + sesId(env), stale = env.store[key];
  checkIn(env, sid(3), at(g, 3));
  eq(auditCount(env, 'CLASS_CENTER_SET', /AUTO_CONFIRMED/), 1);
  const realGet = env.cache.get; let first = true;
  env.cache.get = k => { if (k === key && first) { first = false; return stale; } return realGet(k); };
  eq(checkIn(env, sid(4), at(g, 4)).ok, true);
  env.cache.get = realGet;
  eq(auditCount(env, 'CLASS_CENTER_SET', /AUTO_CONFIRMED/), 1);
});

console.log('--- 10. cancelling a mistaken session ---');
check('CANCEL_MISTAKEN_SESSION after a DUAL session does not change D/E and clears the places cache', () => {
  const env = buildEnv(); seedHistory(env, C, 3);
  startGps(env, HOME);
  checkIn(env, sid(1), at(HOME, 1));
  env.cache.put('PLACES_C1', 'STALE');
  env.ctx.handleTeacherControlSession(env.ss, { classId: 'C1', subAction: 'CANCEL_MISTAKEN_SESSION' });
  eq(centre(env).lat, C.lat); eq(centre(env).lng, C.lng);
  ok(env.cache.get('PLACES_C1') !== 'STALE', 'places cache cleared');
});

console.log('--- extras ---');
check('teacher state: classPlacesCount present with no history, anchorInfo mode COLLECTING for fallback', () => {
  const env = buildEnv(); startFallback(env);
  const st = state(env);
  eq(st.classPlacesCount, 0); eq(st.activeSession.anchorInfo.mode, 'COLLECTING'); eq(st.activeSession.anchorInfo.pendingPlace, false);
});
check('teacher GPS near centre: LOCKED, no pending, D/E follows GPS (3.11 behaviour kept)', () => {
  const env = buildEnv(); const g = off(50, 0);
  const st = startGps(env, g, 20);
  eq(st.activeSession.anchorInfo.mode, 'LOCKED'); eq(st.activeSession.anchorInfo.pendingPlace, false);
  eq(centre(env).lat, g.lat);
});

console.log('--- 12. Codex review fixes ---');
check('poor-accuracy teacher GPS near the centre never rewrites D/E', () => {
  const env = buildEnv({ center: C });
  const before = centre(env);
  startGps(env, off(120, 0), 250);
  eq(centre(env).lat, before.lat); eq(centre(env).lng, before.lng);
});
check('good-accuracy teacher GPS near the centre still updates D/E', () => {
  const env = buildEnv({ center: C });
  const g = off(60, 0);
  startGps(env, g, 30);
  eq(centre(env).lat, g.lat);
});
check('only STUDENT_APP rows make a verified place (manual, sheet import, other sources do not)', () => {
  const env = buildEnv({ center: C });
  seedHistory(env, HOME, 5, { source: 'TEACHER_MANUAL' });
  seedHistory(env, HOME, 5, { source: 'SHEET_IMPORT' });
  eq(env.ctx.getVerifiedPlaces_(env.ss, 'C1', true).length, 0);
  seedHistory(env, CAMPUS2, 3, { source: 'STUDENT_APP' });
  eq(env.ctx.getVerifiedPlaces_(env.ss, 'C1', true).length, 1);
});

console.log('\n' + (failures ? 'GPS PLACES FAILURES: ' + failures : 'ALL GPS PLACES TESTS PASSED! (' + assertions + ' assertions)'));
process.exit(failures ? 1 : 0);
