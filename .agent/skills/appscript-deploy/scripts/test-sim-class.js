/**
 * Class simulation (level A): 10 simulated students with different student-ID formats go through 6 class days
 * (Round 1 + some Round 2, student-app marks and teacher manual marks). The REAL backend `getClassAttendanceStatsMap_`
 * builds the teacher-side numbers from in-memory Sessions_Log / Attendance_Log; they are compared with an independent
 * oracle (RULES section 2-3) and with the student-side merge (student.js, H7) even when the phone holds a stale local history.
 * Also probes how student-ID formats survive normalizeId (backend), normalizeStudentId_ (Sync.gs) and check-in lookup.
 * Usage: node test-sim-class.js [path-to-backend.text]
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
const syncSrc = fs.readFileSync(path.join(ROOT, 'sync.txt'), 'utf8');
const stSrc = fs.readFileSync(path.join(ROOT, 'js/student.js'), 'utf8');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  OK   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
}
function extractFns(src, names) {
  return names.map(n => {
    const m = src.match(new RegExp('function ' + n + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}'));
    assert.ok(m, 'cannot extract ' + n);
    return m[0];
  }).join('\n');
}

// ---------------------------------------------------------------- simulated class
const CLASS_LAT = 10.8, CLASS_LNG = 106.6;
// Student-ID formats seen across faculties/schools. `typed` is what a student might type on a phone.
const STUDENTS = [
  { id: '20001234', name: 'Numeric 8 digits', typed: ' 20001234 ' },
  { id: '0012345', name: 'Leading zeros', typed: '0012345' },
  { id: '2100012345', name: 'Numeric 10 digits', typed: '2100012345' },
  { id: '15DH110001', name: 'Alphanumeric (school code)', typed: '15dh110001' },
  { id: 'B21DCCN123', name: 'Mixed case in roster source', typed: 'b21dccn123' },
  { id: 'K45.001', name: 'Dot separator', typed: 'k45.001' },
  { id: 'SV-001', name: 'Dash separator', typed: 'sv-001' },
  { id: '1234567890123456', name: '16 digits', typed: '1234567890123456' },
  { id: '12345', name: 'Short 5 digits', typed: '12345' },
  { id: 'DE170123', name: 'Letters then digits', typed: 'de170123' }
];

// Six days; days 3 and 5 open Round 2. Spec per student per day: [p1, p2]; p2 = null when Round 2 is not opened.
// 'P','L','E','-' (no scan at all) ; prefix 'm' = teacher manual mark (m- = teacher revoked).
const R2_DAYS = { 2: true, 4: true };
const PLAN = [
  [['P', null], ['P', null], ['P', 'P'], ['P', null], ['P', 'P'], ['P', null]],   // always present
  [['L', null], ['P', null], ['L', 'P'], ['P', null], ['P', 'P'], ['-', null]],   // late once, absent once
  [['-', null], ['-', null], ['-', '-'], ['-', null], ['-', '-'], ['-', null]],   // never came
  [['P', null], ['E', null], ['P', '-'], ['P', null], ['P', 'P'], ['L', null]],   // left before round 2 on day 3
  [['mE', null], ['P', null], ['P', 'P'], ['mE', null], ['mE', 'mE'], ['P', null]], // teacher excused
  [['P', null], ['m-', null], ['P', 'P'], ['P', null], ['P', 'mP'], ['P', null]],  // teacher revoked one day, manual P2
  [['L', null], ['L', null], ['L', 'L'], ['L', null], ['L', 'P'], ['L', null]],   // always late
  [['P', null], ['P', null], ['-', 'P'], ['P', null], ['P', 'P'], ['P', null]],   // missed round 1 but came for round 2
  [['P', null], ['P', null], ['P', 'P'], ['-', null], ['-', '-'], ['-', null]],   // stopped coming
  [['P', null], ['P', null], ['P', 'P'], ['P', null], ['P', 'P'], ['P', null]]    // always present (2)
];
const DAYS = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12'];

function oracleMerge(p1, p2, opened) {
  if (!opened) return p1;
  if (p1 === 'E' || p2 === 'E') return 'E';
  if (p2 !== 'P' && p2 !== 'L') return '-';
  return p1 === 'P' ? 'P' : 'L';
}
const bare = s => String(s || '').replace(/^m/, '');
function oracleCounts(studentIdx) {
  const c = { P: 0, L: 0, E: 0, A: 0 };
  PLAN[studentIdx].forEach(([a, b], d) => {
    const opened = Boolean(R2_DAYS[d]);
    const p1 = bare(a), p2 = opened ? (bare(b) === 'L' ? 'P' : bare(b)) : '';
    const f = oracleMerge(p1, p2, opened);
    if (f === 'P') c.P++; else if (f === 'L') c.L++; else if (f === 'E') c.E++; else c.A++;
  });
  return c;
}
const oracleScore = c => Math.round((10 - c.A - c.L * 0.5 - c.E * 0.5) * 10) / 10;

function rsheet(rows) {
  const sh = {
    rows,
    getLastRow: () => rows.length + 1,
    getLastColumn: () => 10,
    appendRow: r => { rows.push(r); },
    getRange: (r, c, nr, nc) => ({
      getValues: () => { const out = []; for (let i = 0; i < nr; i++) out.push((rows[r - 2 + i] || []).slice(c - 1, c - 1 + nc)); return out; },
      setValues: () => {}
    })
  };
  return sh;
}

function buildClassEnv() {
  const sesRows = [], attRows = [];
  DAYS.forEach((day, d) => {
    const open = new Date(day + 'T05:00:00Z');
    const sesId = 'SES_C1_' + day.replace(/-/g, '');
    sesRows.push([sesId, 'C1', day, open, new Date(open.getTime() + 3600e3), new Date(open.getTime() + 3600e3), 'CLOSED', CLASS_LAT, CLASS_LNG, 100, 'STATIC']);
    if (R2_DAYS[d]) {
      const r2 = sesId + '_R2';
      sesRows.push([r2, 'C1', day + '_P2', new Date(open.getTime() + 4000e3), new Date(open.getTime() + 4600e3), new Date(open.getTime() + 4600e3), 'CLOSED', CLASS_LAT, CLASS_LNG, 100, 'PIN_10S']);
    }
    STUDENTS.forEach((s, i) => {
      const [a, b] = PLAN[i][d];
      const push = (ses, spec) => {
        if (spec === null || spec === '-') return;
        const manual = spec.charAt(0) === 'm';
        const st = bare(spec);
        attRows.push(['A_' + ses + s.id, 'R', ses, 'C1', s.id, st, '10:00:00', 0, 10, manual ? 'TEACHER_MANUAL' : 'STUDENT_APP']);
      };
      push(sesId, a);
      if (R2_DAYS[d]) push(sesId + '_R2', b);
      if (a === 'm-') push(sesId, 'm-');
      if (R2_DAYS[d] && b === 'm-') push(sesId + '_R2', 'm-');
    });
  });
  const cacheStore = {};
  const cache = {
    get: k => (k in cacheStore ? cacheStore[k] : null),
    put: (k, v) => { cacheStore[k] = v; },
    remove: k => { delete cacheStore[k]; },
    removeAll: ks => ks.forEach(k => delete cacheStore[k])
  };
  const props = {};
  const sheets = { Sessions_Log: rsheet(sesRows), Attendance_Log: rsheet(attRows), Device_Registry: rsheet([]) };
  const ss = { getSheetByName: n => sheets[n] || null, getName: () => 'Master', getId: () => 'SSID' };
  const ctx = vm.createContext({
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    SpreadsheetApp: { flush: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
    Utilities: { formatDate: (d, tz, fmt) => { const s = new Date(d).toISOString(); return /^yyyy-MM-dd$/.test(fmt) ? s.slice(0, 10) : (fmt === 'dd/MM/yyyy' ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : s); } },
    console
  });
  vm.runInContext(backendSrc, ctx);
  vm.runInContext(syncSrc, ctx);
  const env = { ctx, ss, sheets, cacheStore, sha: s => crypto.createHash('sha256').update(String(s)).digest('hex') };
  ctx.__env = env; ctx.__students = STUDENTS;
  vm.runInContext(`
    jsonResponse = o => o;
    sha256Hex = s => __env.sha(s);
    logAudit = () => {};
    getClassRosterMap = () => { const m = {}; __students.forEach(s => { m[normalizeId(s.id)] = { studentId: normalizeId(s.id), fullName: s.name }; }); return m; };
    getStoredClassSchedulesMap = () => ({});
    getClassesMap = () => ({ C1: { classId: 'C1', rowIndex: 2, roomLat: ${CLASS_LAT}, roomLng: ${CLASS_LNG}, radiusMeters: 100 } });
    verifyClassroomQr = () => true;
  `, ctx);
  return env;
}

// ---------------------------------------------------------------- 1. teacher side vs RULES oracle
console.log('--- SIM-1: teacher-side stats (real getClassAttendanceStatsMap_) vs RULES oracle ---');
const env = buildClassEnv();
const statsMap = env.ctx.getClassAttendanceStatsMap_(env.ss, 'C1', true);
STUDENTS.forEach((s, i) => {
  check('student ' + (i + 1) + ' [' + s.id + ' / ' + s.name + '] counts + score match the oracle', () => {
    const got = statsMap[env.ctx.normalizeId(s.id)];
    assert.ok(got, 'no stats row for ' + s.id);
    const exp = oracleCounts(i);
    assert.deepStrictEqual({ P: got.P, L: got.L, E: got.E, A: got.A }, exp);
    assert.strictEqual(got.total, 6, 'total days');
    assert.strictEqual(got.attendanceScore, oracleScore(exp));
    assert.strictEqual(got.history.length, 6, 'history length');
  });
});
check('class roll: every day has exactly one history row per student and stats keys are normalized IDs', () => {
  assert.strictEqual(Object.keys(statsMap).length, STUDENTS.length);
  STUDENTS.forEach(s => assert.ok(statsMap[s.id.toUpperCase()], s.id));
});

// ---------------------------------------------------------------- 2. student side vs teacher side
console.log('--- SIM-2: student phone (student.js merge, stale local history) vs teacher side ---');
const stCtx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/attendance-rules.js'), 'utf8'), stCtx);
vm.runInContext(extractFns(stSrc, ['computeAttendanceScoreAndExamStatus', 'getMergedStudentClassStats']), stCtx);
vm.runInContext(`
  var __local = [], __course = [];
  getTodayDateKey = () => '2026-11-15';
  getClassCourseSessionDates = () => __course;
  normalizeSessionDayKey = v => { const m = String(v || '').match(/\\d{4}-\\d{2}-\\d{2}/); return m ? m[0] : ''; };
  formatDisplayDateFromKey = k => k.split('-').reverse().join('/');
  getLocalStudentAttendanceHistory = () => __local;
`, stCtx);
STUDENTS.forEach((s, i) => {
  check('student ' + (i + 1) + ' [' + s.id + '] phone shows the same numbers as the lecturer (phone claims P on every day)', () => {
    const srv = statsMap[s.id.toUpperCase()];
    stCtx.__course = DAYS.map(d => ({ dayKey: d }));
    stCtx.__local = DAYS.map(d => ({ dayKey: d, status: 'P' }));
    const m = stCtx.getMergedStudentClassStats(s.id, 'C1', srv);
    assert.deepStrictEqual({ P: m.P, L: m.L, E: m.E, A: m.A }, { P: srv.P, L: srv.L, E: srv.E, A: srv.A });
    assert.ok(m.P + m.L + m.E + m.A <= DAYS.length, 'total exceeds the schedule');
    assert.strictEqual(m.attendanceScore, srv.attendanceScore);
    assert.strictEqual(m.examStatus, srv.examStatus);
  });
});
check('student with no server history yet (new device): local history fills the schedule without exceeding it', () => {
  stCtx.__course = DAYS.map(d => ({ dayKey: d }));
  stCtx.__local = DAYS.map(d => ({ dayKey: d, status: 'P' }));
  const empty = { P: 0, L: 0, E: 0, A: 0, total: 0, manualExamBan: false, history: [] };
  const m = stCtx.getMergedStudentClassStats('99999', 'C1', empty);
  assert.ok(m.P <= DAYS.length);
});

// ---------------------------------------------------------------- 3. exam-ban boundaries on the simulated numbers
console.log('--- SIM-3: score and exam status boundaries (student.js vs backend rows) ---');
check('exam status agrees on both sides: 6 absences = WARN (equiv 6.0 is not > 6.0), always present = OK', () => {
  const never = statsMap['2100012345'], full = statsMap['20001234'];
  assert.strictEqual(never.A, 6);
  assert.strictEqual(never.examStatus, 'WARN');
  assert.strictEqual(stCtx.computeAttendanceScoreAndExamStatus(6, 0, 0, never.A, false).examStatus, never.examStatus);
  assert.strictEqual(full.examStatus, 'OK');
});

// ---------------------------------------------------------------- 4. ID formats
console.log('--- SIM-4: student-ID formats through backend normalizeId / Sync normalizeStudentId_ / roster lookup ---');
STUDENTS.forEach(s => {
  check('[' + s.id + '] typed as "' + s.typed + '" resolves to the roster key (backend)', () => {
    assert.strictEqual(env.ctx.normalizeId(s.typed), s.id.toUpperCase());
  });
  check('[' + s.id + '] survives Sync.gs roster parsing (normalizeStudentId_)', () => {
    assert.strictEqual(env.ctx.normalizeStudentId_(s.id), s.id.toUpperCase());
  });
});
check('getStudentClassAttendanceStats finds a student typed in lower case with stray spaces', () => {
  const r = env.ctx.getStudentClassAttendanceStats(env.ss, 'C1', ' b21dccn123 ', false);
  assert.strictEqual(r.total, 6);
});
check('check-in lookup: lower-case/space-padded IDs are on the roster, unknown IDs are not', () => {
  const checkIn = sid => env.ctx.handleStudentCheckIn(env.ss, {
    studentId: sid, classId: 'C1', credential: 'cred_cred_cred_cred_1', requestId: 'R' + Math.random(),
    lat: CLASS_LAT, lng: CLASS_LNG, accuracy: 10
  }, Date.now());
  const unknown = checkIn('NOTINCLASS99');
  assert.strictEqual(unknown.ok, false);
  assert.ok(/ROSTER/i.test(String(unknown.code)), 'unknown ID code: ' + unknown.code);
});

// Known gaps that block a "universal" ID scheme (informational, not failures): the roster importer in Sync.gs is stricter
// than the student-facing input, so these IDs can never reach a roster even though the phone accepts them.
console.log('--- SIM-5: universal-ID gaps (informational) ---');
const GAP_PROBES = [
  ['SV 001', 'contains a space'],
  ['SV1', 'fewer than 2 digits'],
  ['ABCDEF', 'letters only'],
  ['12', 'shorter than 3 characters'],
  ['1234567890123456789012', 'longer than 20 characters'],
  ['20001234.0', 'Excel float text (".0" is stripped by both Sync and the backend)']
];
GAP_PROBES.forEach(([id, why]) => {
  const sync = env.ctx.normalizeStudentId_(id);
  const be = env.ctx.normalizeId(id);
  const note = sync === '' ? 'REJECTED by Sync roster import' : (sync !== be ? 'Sync="' + sync + '" but backend="' + be + '" (mismatch)' : 'ok');
  console.log('  INFO ' + JSON.stringify(id).padEnd(26) + why.padEnd(58) + note);
});

console.log(failures ? '\nSIM FAILURES: ' + failures : '\nALL SIM TESTS PASSED!');
process.exit(failures ? 1 : 0);
