// Tests the two-way sync in sync.txt: pure helpers first, then an integration world (real sync.txt + real backend over fake sheets).
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..', '..', '..');
const syncSrc = fs.readFileSync(path.join(root, 'sync.txt'), 'utf8');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('FAIL: ' + msg); } }
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const props = {};
const ctx = vm.createContext({
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {}, removeAll: () => {} }) },
  console
});
vm.runInContext(syncSrc, ctx);
const M = (b, w, s, o) => JSON.parse(JSON.stringify(ctx.computeThreeWayMerge_(b, w, s, o)));

// readDayColumnMarks_
const ST = { presentText: '', presentBg: '', lateText: '', lateBg: '#ffff00', excusedText: '', excusedBg: '#ff9900', absentText: 'x', absentBg: '' };
const rd = ctx.readDayColumnMarks_(
  ['P', 'X', 'M', '', '', '', 'zzz', 'v', 'E'].map(v => [v]),
  ['', '', '', '', '#ffff00', '#ff9900', '', '', '#ff0000'].map(v => [v]),
  ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'], ST);
ok(eq(JSON.parse(JSON.stringify(rd)), { A: 'P', B: '-', C: 'L', D: 'BLANK', E: 'L', F: 'E', G: 'UNKNOWN', H: '-', I: 'RED_SKIP' }), 'readDayColumnMarks_ mapping: ' + JSON.stringify(rd));
ok(ctx.readDayColumnMarks_(['-', 'A'], ['', ''], ['s1', 's2'], {}).S1 === '-', 'flat arrays and A/- = absent');

// BLANK in/out of base
let r = M({ A: 'P' }, { A: 'P' }, { A: 'BLANK' });
ok(eq(r.toSheet, {}) && eq(r.toWeb, {}) && r.newBase.A === 'P', 'BLANK in base = P, no change');
r = M({ A: '-' }, { A: '-' }, { A: 'BLANK' });
ok(eq(r.toWeb, { A: 'P' }) && r.newBase.A === 'P', 'BLANK in base where base was absent -> sheet P wins');
r = M({}, { B: 'P' }, { B: 'BLANK' });
ok(eq(r.toSheet, {}) && eq(r.toWeb, {}) && !('B' in r.newBase), 'BLANK outside base ignored both ways');
// UNKNOWN / RED_SKIP
r = M({ A: 'P' }, { A: 'L' }, { A: 'UNKNOWN' });
ok(eq(r.toSheet, {}) && eq(r.toWeb, {}) && r.newBase.A === 'P', 'UNKNOWN skipped');
r = M({ A: 'P' }, { A: 'L' }, { A: 'RED_SKIP' });
ok(eq(r.toSheet, {}) && eq(r.toWeb, {}) && r.newBase.A === 'P', 'RED_SKIP skipped');
// web changed only / sheet changed only
r = M({ A: 'P' }, { A: 'L' }, { A: 'P' });
ok(eq(r.toSheet, { A: 'L' }) && eq(r.toWeb, {}) && r.newBase.A === 'L', 'web changed -> toSheet');
r = M({ A: 'P' }, { A: 'P' }, { A: 'E' });
ok(eq(r.toWeb, { A: 'E' }) && eq(r.toSheet, {}) && r.newBase.A === 'E', 'sheet changed -> toWeb');
// both changed differently
r = M({ A: 'P' }, { A: 'L' }, { A: 'E' });
ok(eq(r.toWeb, { A: 'E' }) && eq(r.toSheet, {}) && eq(r.conflicts, ['A']) && r.newBase.A === 'E', 'both changed: sheet wins + conflict');
// both same new value
r = M({ A: 'P' }, { A: 'L' }, { A: 'L' });
ok(eq(r.toWeb, {}) && eq(r.toSheet, {}) && eq(r.conflicts, []) && r.newBase.A === 'L', 'same new value -> newBase only');
// firstPush
r = M({}, { A: 'P', B: 'L', C: 'E', D: 'P' }, { A: 'E', B: 'L', C: 'BLANK', D: 'UNKNOWN' }, { firstPush: true });
ok(eq(r.toWeb, { A: 'E' }) && eq(r.toSheet, { C: 'E' }) && r.newBase.A === 'E' && r.newBase.B === 'L' && r.newBase.C === 'E' && !('D' in r.newBase), 'firstPush: ' + JSON.stringify(r));
// isDayEligibleForPull_
const el = ctx.isDayEligibleForPull_;
ok(el(true, true, false) === true && el(false, true, false) === false && el(true, false, false) === false && el(true, true, true) === false, 'isDayEligibleForPull_ truth table');
// styleHash_
const h1 = ctx.styleHash_({ a: '1', b: '2' }), h2 = ctx.styleHash_({ b: '2', a: '1' }), h3 = ctx.styleHash_({ a: '1', b: '3' });
ok(h1 === h2 && h1 !== h3 && typeof h1 === 'string', 'styleHash_ stable regardless of key order, changes with value');
// no mutation
const b = { A: 'P' }, w = { A: 'L' }, s = { A: 'E' };
const snap = JSON.stringify([b, w, s]);
ctx.computeThreeWayMerge_(b, w, s, { firstPush: false });
ok(JSON.stringify([b, w, s]) === snap, 'inputs not mutated');

// ============================================================================
// Integration world: real sync.txt + real backend (code<X.Y.Z>.text) over in-memory fake sheets.
// Only Drive/clock/Calendar and the target-file lookup are faked.
// ============================================================================
const backendFile = fs.readdirSync(root).filter(f => /^code\d+\.\d+\.\d+\.text$/.test(f)).sort((a, b) => {
  const pa = a.match(/\d+/g).map(Number), pb = b.match(/\d+/g).map(Number);
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}).pop();
const backendSrc = fs.readFileSync(path.join(root, backendFile), 'utf8');
const J = o => JSON.parse(JSON.stringify(o === undefined ? null : o));

class FakeSheet {
  constructor(name, rows) { this.name = name; this.v = (rows || []).map(r => r.slice()); this.bg = {}; this.hidden = false; this.onWrite = null; this.reads = 0; this.rl = []; this.writeOps = 0; }
  getName() { return this.name; }
  isSheetHidden() { return this.hidden; }
  hideSheet() { this.hidden = true; }
  getLastRow() { let n = this.v.length; while (n > 0 && this.v[n - 1].every(x => x === '' || x === undefined)) n--; return n; }
  getLastColumn() { return this.v.reduce((m, r) => Math.max(m, r.length), 0); }
  appendRow(r) { this.v.push(r.slice()); }
  deleteRow(r) { this.v.splice(r - 1, 1); }
  insertColumnBefore() {}
  insertColumnAfter() {}
  _touch() { this.writeOps++; if (this.onWrite) this.onWrite(); }
  _get(r, c) { const x = (this.v[r - 1] || [])[c - 1]; return x === undefined ? '' : x; }
  _set(r, c, val) { while (this.v.length < r) this.v.push([]); const row = this.v[r - 1]; while (row.length < c - 1) row.push(''); row[c - 1] = val; }
  getDataRange() { return this.getRange(1, 1, Math.max(this.getLastRow(), 1), Math.max(this.getLastColumn(), 1)); }
  getRange(r, c, nr, nc) {
    const sh = this;
    if (typeof r === 'string') return { setNumberFormat() { return this; }, setValue() { return this; } };
    nr = nr === undefined ? 1 : nr; nc = nc === undefined ? 1 : nc;
    const grid = f => { const o = []; for (let i = 0; i < nr; i++) { const line = []; for (let j = 0; j < nc; j++) line.push(f(r + i, c + j)); o.push(line); } return o; };
    const rg = {
      getValues() { sh.reads++; return grid((a, b) => sh._get(a, b)); },
      getDisplayValues() { sh.reads++; return grid((a, b) => String(sh._get(a, b))); },
      getBackgrounds() { return grid((a, b) => sh.bg[a + ',' + b] || '#ffffff'); },
      getFontColors() { return grid(() => '#000000'); },
      setValues(vals) { vals.forEach((line, i) => line.forEach((x, j) => sh._set(r + i, c + j, x))); sh._touch(); return rg; },
      setValue(x) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh._set(r + i, c + j, x); sh._touch(); return rg; },
      setBackground(x) { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh.bg[(r + i) + ',' + (c + j)] = x || '#ffffff'; sh._touch(); return rg; },
      setBackgrounds(a) { a.forEach((line, i) => line.forEach((x, j) => { sh.bg[(r + i) + ',' + (c + j)] = x || '#ffffff'; })); sh._touch(); return rg; },
      clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) sh._set(r + i, c + j, ''); return rg; },
      setNumberFormat() { return rg; }, setHorizontalAlignment() { return rg; }, setFontColor() { return rg; }, setFontWeight() { return rg; }, clearFormat() { return rg; }
    };
    return rg;
  }
  getRangeList(a1s) {
    const sh = this;
    const cells = a1s.map(a => { const m = a.match(/^([A-Z]+)(\d+)$/); let col = 0; for (const ch of m[1]) col = col * 26 + (ch.charCodeAt(0) - 64); return [Number(m[2]), col]; });
    const rl = {
      setValue(x) { cells.forEach(([a, b]) => sh._set(a, b, x)); sh.rl.push({ op: 'v', a1s, x }); sh._touch(); return rl; },
      setBackground(x) { cells.forEach(([a, b]) => { sh.bg[a + ',' + b] = x || '#ffffff'; }); sh.rl.push({ op: 'bg', a1s, x }); sh._touch(); return rl; },
      setHorizontalAlignment() { return rl; }
    };
    return rl;
  }
}
const mkSs = (id, sheets) => {
  const ss = { sheets, getId: () => id, getName: () => 'SS', getSheets: () => ss.sheets,
    getSheetByName: n => ss.sheets.find(s => s.name === n) || null,
    insertSheet: n => { const s = new FakeSheet(n, []); ss.sheets.push(s); return s; } };
  return ss;
};

const SIDS = ['20000001', '20000002', '20000003', '20000004', '20000005'];
const NOWH = (h, d) => new Date(2026, 10, d || 18, h, 0, 0).getTime();
const CLOCK_SRC = `(function(){ const RD = Date; class FD extends RD { constructor(...a) { if (a.length === 0) super(globalThis.__NOW); else super(...a); } static now() { return globalThis.__NOW; } } globalThis.Date = FD; })();`;

function makeWorld(o) {
  o = o || {};
  const w = { props: {}, cache: {}, lock: { busy: false, tries: 0, rel: 0, held: false }, alerts: [], rebuilds: [], extractCalls: 0, resolveCalls: 0, tNames: o.tNames || ['18/11', '25/11'] };
  const propsApi = { getProperty: k => (k in w.props ? w.props[k] : null), setProperty: (k, v) => { w.props[k] = String(v); }, deleteProperty: k => { delete w.props[k]; } };
  const cacheApi = { get: k => (k in w.cache ? w.cache[k] : null), put: (k, v) => { w.cache[k] = String(v); }, remove: k => { delete w.cache[k]; }, removeAll: ks => ks.forEach(k => delete w.cache[k]) };
  const lockApi = { getScriptLock: () => ({
    tryLock: () => { w.lock.tries++; if (w.lock.busy) return false; w.lock.held = true; return true; },
    releaseLock: () => { w.lock.rel++; w.lock.held = false; } }) };
  const clsRows = o.classes || ['C1'];
  w.master = mkSs('MASTER', [
    new FakeSheet('Classes_Config', [['classId', 'className', 'secret', 'lat', 'lng', 'radius', 'present', 'late', 'reg']].concat(clsRows.map(c => [c, 'Class ' + c, 'QR_' + c, 10.8, 106.6, 100, 3, 15, 'YES']))),
    new FakeSheet('Sessions_Log', [['id', 'classId', 'label', 'openedAt', 'presentUntil', 'closesAt', 'closedAt', 'lat', 'lng', 'radius', 'mode']]),
    new FakeSheet('Attendance_Log', [['id', 'req', 'session', 'class', 'student', 'status', 'time', 'dist', 'acc', 'source']]),
    new FakeSheet('Audit_Log', [['ts', 'actor', 'action', 'target', 'details']])
  ]);
  clsRows.forEach(c => w.master.sheets.push(new FakeSheet(c, [['No.', 'Student_ID', 'Full_Name', 'Total_Present', 'Total_Late']].concat(SIDS.map((s, i) => [i + 1, s, 'Student ' + (i + 1), 0, 0])))));
  // target file (Google Sheet): title row, header row with dates, one row per student
  const hdr = ['STT', 'MSSV', 'Họ và tên'].concat(w.tNames);
  w.target = { modified: 1000 };
  w.tsheet = new FakeSheet('C1', [['Class C1'], hdr].concat(SIDS.map((s, i) => [i + 1, s, 'Student ' + (i + 1)])));
  w.tsheet.onWrite = () => { w.target.modified += 1000; };
  w.tss = mkSs('F1', [w.tsheet]);
  const ui = { alert: (...a) => { w.alerts.push(a.join(' | ')); return 'YES'; }, ButtonSet: { YES_NO: 1, OK: 2 }, Button: { YES: 'YES', NO: 'NO' } };
  const ctx = vm.createContext({
    PropertiesService: { getScriptProperties: () => propsApi }, CacheService: { getScriptCache: () => cacheApi }, LockService: lockApi,
    SpreadsheetApp: { flush: () => {}, getActiveSpreadsheet: () => w.master, getUi: () => ui, openById: () => w.tss },
    DriveApp: { getFileById: () => ({ getLastUpdated: () => ({ getTime: () => w.target.modified }) }) },
    Utilities: { formatDate: (d, tz, fmt) => { const s = new Date(d).toISOString(); return /^yyyy-MM-dd$/.test(fmt) ? s.slice(0, 10) : s; } },
    Logger: { log() {} }, console
  });
  vm.runInContext(CLOCK_SRC, ctx);
  ctx.__NOW = o.now || NOWH(18);
  vm.runInContext(backendSrc, ctx);
  vm.runInContext(syncSrc, ctx);
  ctx.__w = w;
  vm.runInContext(`
    jsonResponse = o => o;
    rebuildSingleClassGrid = (ss, id) => { __w.rebuilds.push(id); };
    handleTeacherGetState = (ss, b) => ({ state: true, classId: b.classId });
    resolveClassTargetFile_ = () => { __w.resolveCalls++; return { fileId: 'F1', fileName: 't', isGoogleSheet: true, folderPath: '', lastUpdatedMs: __w.target.modified }; };
    (function() { const orig = extractRosterFromTargetFile_; extractRosterFromTargetFile_ = function() { __w.extractCalls++; return orig.apply(this, arguments); }; })();
  `, ctx);
  w.ctx = ctx;
  w.setNow = (h, d) => { ctx.__NOW = NOWH(h, d); };
  w.sheet = n => w.master.getSheetByName(n);
  w.att = () => w.sheet('Attendance_Log').v.slice(1);
  w.audit = () => w.sheet('Audit_Log').v.slice(1).map(r => ({ actor: r[1], action: r[2], target: r[3], details: r[4] }));
  w.auditN = a => w.audit().filter(x => x.action === a).length;
  w.ses = (id, cls, dayIso, label, closed) => w.sheet('Sessions_Log').appendRow([id, cls || 'C1', label || (dayIso + '_lbl'), dayIso + 'T03:00:00.000Z', dayIso + 'T03:10:00.000Z', dayIso + 'T04:00:00.000Z', closed === false ? '' : dayIso + 'T04:00:00.000Z', 10.8, 106.6, 100, 'STATIC']);
  w.scan = (sesId, sid, st, cls, src) => w.sheet('Attendance_Log').appendRow(['A' + Math.random(), 'R', sesId, cls || 'C1', sid, st, '10:00:00', 0, 10, src || 'STUDENT_APP']);
  w.baseAll = () => J(ctx.readSyncBaseAll_(w.master).map);
  w.base = (cls, day) => w.baseAll()[(cls || 'C1') + '|' + day] || null;
  w.group = (day, cls) => ctx.getGroupedSessionsByClassDate_(w.master).filter(g => g.classId === (cls || 'C1') && g.dayKey === day)[0];
  w.web = (day, cls) => J(ctx.getMergedAttendanceStatusMap_(w.master, cls || 'C1', w.group(day, cls)));
  w.col = n => 3 + n; // date column index (1-based) for the n-th date (1 = first)
  w.cell = (sid, n) => { const r = 3 + SIDS.indexOf(sid); return { v: w.tsheet._get(r, w.col(n)), bg: w.tsheet.bg[r + ',' + w.col(n)] || '#ffffff' }; };
  w.setCell = (sid, n, v, bg) => { const r = 3 + SIDS.indexOf(sid); w.tsheet._set(r, w.col(n), v); w.tsheet.bg[r + ',' + w.col(n)] = bg || '#ffffff'; w.target.modified += 1000; };
  w.clearCol = n => SIDS.forEach(s => w.setCell(s, n, '', ''));
  w.auto = () => ctx.autoSyncTodayAttendanceAfterClass();
  w.manual = () => ctx.syncTodayAttendance();
  w.webMark = (day, sid, st) => J(ctx.writeManualMarksForDay_(w.master, 'C1', day, { [sid]: st }, { actor: 'TEACHER_APP' }));
  w.style = st => { w.props.QR_UNIVERSAL_ATTENDANCE_STYLE = JSON.stringify(st); };
  w.sheetReads = () => w.tsheet.reads;
  // a normal class day: session + scans, today
  w.day = (day, marks, sesId) => {
    sesId = sesId || ('SES_C1_' + day.replace(/-/g, ''));
    w.ses(sesId, 'C1', day);
    Object.keys(marks).forEach(s => w.scan(sesId, s, marks[s]));
    return sesId;
  };
  return w;
}
const D1 = '2026-11-18';
const MARKS = { [SIDS[0]]: 'P', [SIDS[1]]: 'L', [SIDS[2]]: 'E' }; // S4,S5 absent
const PLA = { mode: 'PLA', presentText: 'P', presentBg: '', lateText: 'L', lateBg: '#ffff00', excusedText: 'E', excusedBg: '#ff9900', absentText: 'A', absentBg: '' };
const CUSTOM = { mode: 'CUSTOM', presentText: 'CM', presentBg: '#00ff00', lateText: 'TRE', lateBg: '#3366ff', excusedText: 'CP', excusedBg: '#9933cc', absentText: 'KP', absentBg: '#999999' };
function firstPushWorld(o) { const w = makeWorld(o); w.day(D1, MARKS); w.auto(); return w; }
function T(name, fn) { try { fn(); } catch (e) { fail++; console.log('FAIL (threw): ' + name + ' -> ' + (e && e.stack || e).split('\n').slice(0, 3).join(' | ')); } }

// ---- step 3: updateTargetAttendanceFile_ writes only the cells it is given
T('step3', () => {
  const w = makeWorld(); w.day(D1, MARKS);
  w.setCell(SIDS[4], 1, 'keep', '#abcdef');
  const before = w.tsheet.writeOps;
  const res = J(w.ctx.updateTargetAttendanceFile_({ fileId: 'F1', isGoogleSheet: true }, 'C1', 'Class C1', 18, 11, { [SIDS[1]]: 'L', [SIDS[3]]: '-' }, null));
  ok(res.previousCells.length === 2 && res.previousCells.every(p => p.sid && p.row), 'step3: previousCells only holds the touched cells ' + JSON.stringify(res.previousCells));
  ok(res.afterModifiedMs === w.target.modified && res.afterModifiedMs > 1000, 'step3: afterModifiedMs returned from the file modified time');
  ok(w.cell(SIDS[1], 1).bg === '#ffff00' && w.cell(SIDS[3], 1).v === 'x', 'step3: late = yellow, absent = x');
  ok(w.cell(SIDS[4], 1).v === 'keep' && w.cell(SIDS[4], 1).bg === '#abcdef' && w.cell(SIDS[0], 1).v === '', 'step3: cells that were not given are untouched');
  ok(w.tsheet.rl.filter(x => x.op === 'v').length === 2, 'step3: RangeList writes are grouped by target value (2 values -> 2 calls) ' + JSON.stringify(w.tsheet.rl));
  ok(w.tsheet.writeOps > before, 'step3: wrote through RangeList');
  // restore mode (Undo) still cell by cell
  w.ctx.updateTargetAttendanceFile_({ fileId: 'F1', isGoogleSheet: true }, 'C1', 'Class C1', 18, 11, {}, res.previousCells.map(p => ({ row: p.row, val: p.val, bg: p.bg })));
  ok(w.cell(SIDS[1], 1).bg === '#ffffff' && w.cell(SIDS[3], 1).v === '', 'step3: restoreCells mode unchanged');
});

// ---- first push (today, class ended) + idle path
T('first push', () => {
  const w = firstPushWorld();
  ok(w.cell(SIDS[0], 1).v === '' && w.cell(SIDS[0], 1).bg === '#ffffff', 'first push: P = blank');
  ok(w.cell(SIDS[1], 1).bg === '#ffff00' && w.cell(SIDS[2], 1).bg === '#ff9900' && w.cell(SIDS[3], 1).v === 'x' && w.cell(SIDS[4], 1).v === 'x', 'first push: L yellow, E orange, absent x');
  const b = w.base('C1', D1);
  ok(b && eq(b.base, { [SIDS[0]]: 'P', [SIDS[1]]: 'L', [SIDS[2]]: 'E', [SIDS[3]]: '-', [SIDS[4]]: '-' }), 'first push: base = web ' + JSON.stringify(b));
  ok(b.sheetModifiedMs === w.target.modified && b.paused === 0 && /^S/.test(b.styleHash), 'first push: base stores afterModifiedMs + styleHash');
  ok(w.sheet('_Sync_Base').hidden === true, '_Sync_Base is hidden');
  ok(w.auditN('ATTENDANCE_SYNC_SUCCESS') === 1, 'first push: audited');
  ok(J(w.ctx.readSyncBaseAll_(w.master)).order.length === 1, 'one base row');
  // idle: nothing changed anywhere -> no conversion, no read of the target, no write
  const reads = w.sheetReads(), writes = w.tsheet.writeOps, extr = w.extractCalls, attN = w.att().length;
  w.auto();
  ok(w.extractCalls === extr && w.sheetReads() === reads && w.tsheet.writeOps === writes && w.att().length === attN, 'idle run: no extract/read/write when the file is unchanged and the web has no diff');
  ok(w.cache.SYNC2W_RUNNING === undefined, 'SYNC2W_RUNNING cleared after the run');
});

// ---- empty-column rules
T('today not ended / blank column', () => {
  const w = makeWorld(); w.setNow(10); w.day(D1, MARKS); w.auto();
  ok(w.tsheet.writeOps === 0 && w.base('C1', D1) === null && w.extractCalls === 0, 'today before class end: nothing is pushed/pulled');
  w.setNow(18); w.auto();
  ok(w.base('C1', D1) !== null, 'after class end the first push happens');
  // blank column of an eligible day (session + base) = whole class present
  w.clearCol(1); w.auto();
  const web = w.web(D1);
  ok(SIDS.every(s => web[s] === 'P'), 'fully blank column of an eligible day -> whole class P: ' + JSON.stringify(web));
  ok(w.att().filter(r => r[9] === 'TEACHER_MANUAL' && r[5] === 'P').length >= 3, 'pull wrote TEACHER_MANUAL rows');
  ok(w.auditN('SHEET_PULL_APPLIED') === 1, 'pull audited');
});
T('future day / no session never pulled', () => {
  const w = makeWorld(); w.day(D1, MARKS); w.auto();
  w.setCell(SIDS[1], 2, 'x', ''); // 25/11: no session at all, has a mark
  const attN = w.att().length; w.auto();
  ok(w.att().length === attN && w.base('C1', '2026-11-25') === null, 'future column without a session is not pulled');
});

// ---- new student outside the base stays untouched
T('student outside base', () => {
  const w = firstPushWorld();
  const cls = w.sheet('C1'); cls.appendRow([6, '20000006', 'Student 6', 0, 0]);
  w.tsheet.appendRow([6, '20000006', 'Student 6']); w.target.modified += 1000;
  w.setCell(SIDS[3], 1, '', ''); // teacher clears S4's x (-> P)
  w.auto();
  const b = w.base('C1', D1).base;
  ok(!('20000006' in b), 'student not in base is ignored');
  ok(w.att().every(r => r[4] !== '20000006'), 'no web rows written for the student outside the base');
  ok(w.web(D1)[SIDS[3]] === 'P', 'other cell changes are still pulled');
});

// ---- conflicts / same value / other cells
T('both sides changed', () => {
  const w = firstPushWorld();
  w.webMark(D1, SIDS[1], 'E');           // web: L -> E
  w.setCell(SIDS[1], 1, '', '');         // sheet: L -> P
  w.auto();
  ok(w.web(D1)[SIDS[1]] === 'P' && w.base('C1', D1).base[SIDS[1]] === 'P', 'both changed: Sheet wins');
  ok(w.cell(SIDS[1], 1).bg === '#ffffff', 'both changed: the Sheet cell is not overwritten');
  ok(w.auditN('SYNC_CONFLICT_SHEET_WINS') === 1, 'conflict audited');
});
T('same new value', () => {
  const w = firstPushWorld();
  w.webMark(D1, SIDS[2], 'L'); w.setCell(SIDS[2], 1, '', '#ffff00'); // both E -> L
  const writes = w.tsheet.writeOps, attN = w.att().length;
  w.auto();
  ok(w.tsheet.writeOps === writes && w.att().length === attN, 'same value on both sides: no write on either side');
  ok(w.base('C1', D1).base[SIDS[2]] === 'L', 'same value: base updated');
});
T('web changes one cell, teacher edited another', () => {
  const w = firstPushWorld();
  w.webMark(D1, SIDS[0], 'L');           // web: P -> L
  w.setCell(SIDS[4], 1, '', '');         // teacher: S5 x -> blank (P) by hand
  w.setCell(SIDS[3], 1, 'x', '#123456'); // teacher also restyled S4's cell
  w.auto();
  ok(w.cell(SIDS[0], 1).bg === '#ffff00', 'web edit pushed to the Sheet');
  ok(w.cell(SIDS[3], 1).bg === '#123456', 'unrelated hand-made edit kept');
  ok(w.web(D1)[SIDS[4]] === 'P', 'the Sheet edit was pulled to the web');
  const last = JSON.parse(w.props.QR_CENTER_LAST_SYNC_BATCH);
  ok(last.length === 1 && last[0].previousCells.length === 1 && last[0].previousCells[0].sid === SIDS[0], 'undo log holds only the touched cell');
});

// ---- first push with a pre-filled Sheet
T('first push, sheet already marked', () => {
  const w = makeWorld(); w.day(D1, { [SIDS[0]]: 'P', [SIDS[1]]: 'P' });
  w.setCell(SIDS[4], 1, 'x', ''); w.setCell(SIDS[1], 1, '', '#ffff00'); // teacher pre-marked S5 absent and S2 late
  w.auto();
  const web = w.web(D1);
  ok(web[SIDS[4]] === '-' && web[SIDS[1]] === 'L', 'first push: clear Sheet marks win over the web: ' + JSON.stringify(web));
  ok(w.cell(SIDS[1], 1).bg === '#ffff00' && w.cell(SIDS[0], 1).v === '', 'first push: Sheet marks not overwritten, blanks written from web');
  ok(w.base('C1', D1) !== null, 'first push creates the base');
});

// ---- loops produce an empty diff
T('push->pull and pull->push loops', () => {
  const w = firstPushWorld();
  w.target.modified += 5000;             // file "modified" but content identical
  let attN = w.att().length, writes = w.tsheet.writeOps;
  w.auto();
  ok(w.att().length === attN && w.tsheet.writeOps === writes, 'push then pull: empty diff, nothing written');
  ok(w.base('C1', D1).sheetModifiedMs === w.target.modified, 'stamp refreshed after the empty pull');
  w.setCell(SIDS[3], 1, '', '#ffff00'); w.auto();      // pull S4 -> L
  attN = w.att().length; writes = w.tsheet.writeOps; const extr = w.extractCalls;
  w.auto();
  ok(w.att().length === attN && w.tsheet.writeOps === writes && w.extractCalls === extr, 'pull then push: nothing bounces back');
  w.target.modified += 5000; w.auto();
  ok(w.att().length === attN && w.tsheet.writeOps === writes, 'pull then (modified) pull: empty diff');
});

// ---- P1 + P2
T('P1+P2 day', () => {
  const w = makeWorld();
  w.ses('SES_C1_P1', 'C1', D1); w.ses('SES_C1_P1_R2', 'C1', D1, '1811_P2');
  w.scan('SES_C1_P1', SIDS[0], 'P'); w.scan('SES_C1_P1_R2', SIDS[0], 'P'); w.scan('SES_C1_P1', SIDS[1], 'P'); w.scan('SES_C1_P1_R2', SIDS[1], 'P');
  w.auto();
  w.setCell(SIDS[1], 1, '', '#ffff00'); w.auto();    // sheet: S2 -> L
  const rows = w.att().filter(r => r[4] === SIDS[1] && r[9] === 'TEACHER_MANUAL');
  ok(rows.length === 2 && rows.every(r => r[5] === 'L') && eq(rows.map(r => r[2]).sort(), ['SES_C1_P1', 'SES_C1_P1_R2']), 'pull L is written for BOTH sessions: ' + JSON.stringify(rows));
  ok(w.web(D1)[SIDS[1]] === 'L', 'merged result stays L');
  const attN = w.att().length; w.target.modified += 1000; w.auto();
  ok(w.att().length === attN, 'P1+P2: no ping-pong after the pull');
});

// ---- styleHash
T('styleHash', () => {
  const w = firstPushWorld();
  w.style(PLA);
  w.auto();
  ok(w.auditN('SYNC_STYLE_CHANGED') === 1 && w.base('C1', D1).paused === 2, 'style change pauses the class and audits');
  const ex0 = w.extractCalls; w.setCell(SIDS[3], 1, '', ''); w.auto();
  ok(w.auditN('SYNC_STYLE_CHANGED') === 1 && w.extractCalls === ex0, 'paused class: no read, no repeated audit');
  ok(w.web(D1)[SIDS[3]] === '-', 'paused class: Sheet edit not pulled');
  w.manual();
  ok(w.base('C1', D1).paused === 0 && w.base('C1', D1).styleHash === 'S' + w.ctx.styleHash_(J(w.ctx.getAttendanceStyle_())), 'manual Sync resumes and stores the new style hash');
});

// ---- red rows
T('red rows', () => {
  const w = makeWorld(); w.day(D1, MARKS);
  w.tsheet.bg['5,2'] = '#ff0000';                    // S3 identity cell red = exam ban row
  w.setCell(SIDS[3], 1, '', '#ff0000');              // S4 date cell red = no information
  w.auto();
  const bans = JSON.parse(w.props.QR_MANUAL_EXAM_BAN_MAP || '{}').C1 || {};
  ok(bans[SIDS[2]] === true, 'red identity cell is saved as an exam ban');
  ok(w.cell(SIDS[3], 1).bg === '#ff0000' && w.cell(SIDS[3], 1).v === '', 'red date cell: not overwritten on the first push');
  ok(w.web(D1)[SIDS[3]] === '-' && !('S4' in w.base('C1', D1).base) && !(SIDS[3] in w.base('C1', D1).base), 'red date cell: no information, not in base');
  const res = J(w.ctx.updateTargetAttendanceFile_({ fileId: 'F1', isGoogleSheet: true }, 'C1', 'Class C1', 18, 11, { [SIDS[3]]: '-' }, null));
  ok(w.cell(SIDS[3], 1).v === 'x' && w.cell(SIDS[3], 1).bg === '#ff0000' && res.previousCells.length === 1, 'writing onto a red cell keeps the red background');
});

// ---- symbols and styles round-trip (write with the style, read back, merge is empty)
T('style round-trip', () => {
  [['CENTER', null], ['PLA', PLA], ['CUSTOM', CUSTOM]].forEach(([nm, st]) => {
    const w = makeWorld(); w.day(D1, MARKS);
    if (st) w.style(st);
    const web = { [SIDS[0]]: 'P', [SIDS[1]]: 'L', [SIDS[2]]: 'E', [SIDS[3]]: '-', [SIDS[4]]: 'P' };
    w.ctx.updateTargetAttendanceFile_({ fileId: 'F1', isGoogleSheet: true }, 'C1', 'Class C1', 18, 11, web, null);
    const ex = J(w.ctx.extractRosterFromTargetFile_({ fileId: 'F1', isGoogleSheet: true }, 'C1', 'Class C1'));
    const col = ex.dateColumns.filter(c => c.dayKey === D1)[0];
    ok(!!col, nm + ': date column is returned by extractRosterFromTargetFile_');
    const m = w.ctx.computeThreeWayMerge_(web, web, col.marks, {});
    ok(Object.keys(m.toSheet).length === 0 && Object.keys(m.toWeb).length === 0, nm + ': write -> read -> merge is empty ' + JSON.stringify(col.marks));
    ok(col.marks[SIDS[1]] === 'L' && col.marks[SIDS[2]] === 'E' && col.marks[SIDS[3]] === '-', nm + ': L/E/- are read back');
  });
  const rd = J(ctxRead(['A', 'x', 'V', '-', 'M', 'P', '']));
  ok(eq(rd, ['-', '-', '-', '-', 'L', 'P', 'BLANK']), 'A/x/V/- = absent, M = late, P, blank: ' + JSON.stringify(rd));
});
function ctxRead(vals) {
  const m = ctx.readDayColumnMarks_(vals.map(v => [v]), vals.map(() => ['']), vals.map((_, i) => 'id' + i), ST);
  return vals.map((_, i) => m['ID' + i]);
}

// ---- past day without a session: marks create a fake session; blank column ignored
T('past day import', () => {
  const w = makeWorld({ tNames: ['04/11', '11/11', '18/11'] });
  w.day(D1, MARKS);
  w.setCell(SIDS[1], 2, 'x', ''); w.setCell(SIDS[2], 2, '', '#ffff00');   // 11/11 has marks, 04/11 stays blank
  w.auto();
  const ses = w.sheet('Sessions_Log').v.slice(1).map(r => r[0]);
  ok(ses.indexOf('SES_C1_20261111_150000') !== -1 && !ses.some(s => /20261104/.test(s)), 'fake session created only for the day that has marks: ' + ses.join(','));
  const rows = w.att().filter(r => r[2] === 'SES_C1_20261111_150000');
  ok(rows.length === 5 && rows.every(r => r[9] === 'TEACHER_MANUAL'), 'every student gets a TEACHER_MANUAL row');
  const st = {}; rows.forEach(r => { st[r[4]] = r[5]; });
  ok(st[SIDS[0]] === 'P' && st[SIDS[1]] === '-' && st[SIDS[2]] === 'L', 'blank = P, x = absent, yellow = late: ' + JSON.stringify(st));
  ok(w.base('C1', '2026-11-11') !== null && w.base('C1', '2026-11-04') === null, 'base only for the imported day');
  ok(w.props['QR_SHEET_PAST_HISTORY_C1'] === undefined, 'the old overlay property is no longer written');
});

// ---- lock busy
T('lock busy', () => {
  const w = makeWorld(); w.day(D1, MARKS);
  w.lock.busy = true; w.auto();
  ok(w.auditN('AUTO_SYNC_LOCK_BUSY') === 1, 'lock busy logged once per run');
  ok(w.base('C1', D1) === null && w.att().every(r => r[9] !== 'TEACHER_MANUAL'), 'lock busy: base and Attendance_Log untouched');
  w.lock.busy = false; w.auto();
  ok(w.base('C1', D1) !== null, 'next run completes the class');
  ok(w.cell(SIDS[1], 1).bg === '#ffff00' && w.cell(SIDS[3], 1).v === 'x', 'result after the retry is correct');
  // busy during a pull: nothing applied, applied on the retry
  w.setCell(SIDS[3], 1, '', ''); w.lock.busy = true; const attN = w.att().length; w.auto();
  ok(w.att().length === attN && w.base('C1', D1).base[SIDS[3]] === '-', 'pull with a busy lock changes nothing');
  w.lock.busy = false; w.auto();
  ok(w.web(D1)[SIDS[3]] === 'P', 'pull applied after the lock is free');
});

// ---- deadline + cursor
T('deadline + cursor', () => {
  const w = makeWorld({ classes: ['C1', 'C2', 'C3'] });
  vm.runInContext(`
    __seen = [];
    getGroupedSessionsByClassDate_ = () => ['C1', 'C2', 'C3'].map(c => ({ classId: c, dayKey: '2026-11-18', dateKey: '2026-11-18', groupKey: c + '__2026-11-18', day: 18, month: 11, sessionIds: [], allClosed: true, maxClosesAtMs: 0 }));
    syncClassDays_ = (ss, env, classId) => { __seen.push(classId); __NOW += 200000; return { undoEntries: [], busy: false, lines: [], pushed: 0, pulled: 0, errors: 0, worked: false, days: [] }; };
  `, w.ctx);
  const seen = () => J(w.ctx.__seen);
  w.auto();
  ok(eq(seen(), ['C1', 'C2']) && w.props.QR_SYNC2W_CURSOR === '2', 'first run stops at the deadline, cursor -> 2: ' + JSON.stringify(seen()) + ' ' + w.props.QR_SYNC2W_CURSOR);
  w.ctx.__seen = []; w.auto();
  ok(eq(seen(), ['C3', 'C1']) && w.props.QR_SYNC2W_CURSOR === '1', 'second run continues from the cursor and wraps: ' + JSON.stringify(seen()));
  ok(w.audit().some(a => a.action === 'SYNC2W_RUN' && /DEADLINE_HIT/.test(a.details)), 'run time + deadline logged to Audit_Log');
  ok(w.cache.SYNC2W_RUNNING === undefined, 'running flag cleared');
  w.cache.SYNC2W_RUNNING = '1'; w.ctx.__seen = []; w.auto();
  ok(seen().length === 0, 'SYNC2W_RUNNING flag blocks an overlapping run');
});

// ---- undo + PAUSED, manual sync resumes
T('undo + paused', () => {
  const w = firstPushWorld();
  const batch = JSON.parse(w.props.QR_CENTER_LAST_SYNC_BATCH);
  w.ctx.executeAttendanceSyncUndo_(w.master, w.ctx.PropertiesService.getScriptProperties(), batch, false);
  ok(w.cell(SIDS[1], 1).bg === '#ffffff' && w.cell(SIDS[3], 1).v === '', 'undo restored the previous cells');
  const b = w.base('C1', D1);
  ok(b.paused === 1 && b.base[SIDS[1]] === 'P' && b.base[SIDS[3]] === 'P', 'base follows the restored column (blank = P) and the day is PAUSED: ' + JSON.stringify(b));
  ok(w.props.QR_CENTER_LAST_SYNC_BATCH === undefined, 'undo log consumed');
  const writes = w.tsheet.writeOps, attN = w.att().length; w.target.modified += 5000;
  w.auto();
  ok(w.tsheet.writeOps === writes && w.att().length === attN, 'paused day: neither pushed again nor pulled');
  w.manual();
  ok(w.base('C1', D1).paused === 0 && w.cell(SIDS[1], 1).bg === '#ffff00' && w.cell(SIDS[3], 1).v === 'x', 'manual Sync resumes and pushes the web values again');
});

// ---- migrate the old synced map
T('migrate syncedMap', () => {
  const w = makeWorld();
  w.props.QR_CENTER_AUTO_SYNCED_SESSIONS = JSON.stringify({
    'C1__2026-11-4': JSON.stringify({ [SIDS[0]]: 'P', [SIDS[1]]: 'L' }),
    'C1__2026-11-5': 'SKIPPED_ZERO_CHECKINS',
    'C1__2026-11-6': 'SKIPPED_NO_DATE_COL'
  });
  w.auto();
  const all = w.baseAll();
  ok(Object.keys(all).length === 1 && eq(all['C1|2026-11-04'].base, { [SIDS[0]]: 'P', [SIDS[1]]: 'L' }), 'signature migrated to a padded dayKey, SKIPPED_* ignored: ' + JSON.stringify(all));
  ok(all['C1|2026-11-04'].sheetModifiedMs === 0 && all['C1|2026-11-04'].styleHash === '', 'migrated rows force one pull and adopt the style');
  ok(w.props.QR_SYNC_BASE_MIGRATED === '1', 'migration flag set');
  w.props.QR_CENTER_AUTO_SYNCED_SESSIONS = JSON.stringify({ 'C1__2026-11-9': JSON.stringify({ [SIDS[0]]: 'P' }) });
  w.auto();
  ok(Object.keys(w.baseAll()).length === 1, 'migration runs only once');
});

// ---- cancel mistaken session
T('cancel mistaken session', () => {
  const w = makeWorld(); w.setNow(10);
  w.ctx.__NOW = Date.UTC(2026, 10, 18, 5, 0, 0);
  w.sheet('Sessions_Log').appendRow(['SES_C1_X', 'C1', 'lblX', D1 + 'T03:00:00.000Z', D1 + 'T03:10:00.000Z', D1 + 'T09:00:00.000Z', '', 10.8, 106.6, 100, 'STATIC']);
  w.scan('SES_C1_X', SIDS[0], 'P');
  w.ctx.writeSyncBaseBatch_(w.master, [{ classId: 'C1', dayKey: D1, fileId: 'F1', base: { [SIDS[0]]: 'P' }, sheetModifiedMs: 5, styleHash: 'S1', paused: 0 }, { classId: 'C1', dayKey: '2026-11-11', fileId: 'F1', base: {}, sheetModifiedMs: 5, styleHash: 'S1', paused: 0 }], []);
  const r = J(w.ctx.handleTeacherControlSession(w.master, { classId: 'C1', subAction: 'CANCEL_MISTAKEN_SESSION' }));
  ok(r.state === true, 'cancel ran: ' + JSON.stringify(r));
  ok(w.base('C1', D1) === null && w.base('C1', '2026-11-11') !== null, 'cancel removes only the base of that day');
  // cancelling only a round-2 session keeps the base
  const w2 = makeWorld(); w2.ctx.__NOW = Date.UTC(2026, 10, 18, 5, 0, 0);
  w2.sheet('Sessions_Log').appendRow(['SES_C1_A', 'C1', 'a', D1 + 'T03:00:00.000Z', D1 + 'T03:10:00.000Z', D1 + 'T04:00:00.000Z', D1 + 'T04:00:00.000Z', 1, 1, 100, 'STATIC']);
  w2.sheet('Sessions_Log').appendRow(['SES_C1_A_R2', 'C1', 'a_P2', D1 + 'T03:30:00.000Z', D1 + 'T03:40:00.000Z', D1 + 'T09:00:00.000Z', '', 1, 1, 100, 'STATIC']);
  w2.ctx.writeSyncBaseBatch_(w2.master, [{ classId: 'C1', dayKey: D1, fileId: 'F1', base: {}, sheetModifiedMs: 5, styleHash: 'S1', paused: 0 }], []);
  w2.ctx.handleTeacherControlSession(w2.master, { classId: 'C1', subAction: 'CANCEL_MISTAKEN_SESSION' });
  ok(w2.base('C1', D1) !== null, 'cancelling a round-2 session keeps the base (diff-only push updates the Sheet)');
});

// ---- XLSX: modifiedTime guard (M11) and afterModifiedMs
T('xlsx guard', () => {
  function xlsxWorld(times) {
    const w = makeWorld(); w.day(D1, MARKS);
    const calls = [];
    let ti = 0;
    const resp = (code, body, bytes) => ({ getResponseCode: () => code, getContentText: () => JSON.stringify(body || {}), getBlob: () => ({ getBytes: () => bytes || [1, 2, 3] }) });
    w.ctx.UrlFetchApp = { fetch: (url, o) => {
      calls.push(url);
      if (/fields=modifiedTime/.test(url)) return resp(200, { modifiedTime: new Date(times[Math.min(ti++, times.length - 1)]).toISOString() });
      if (/\/copy\?/.test(url)) return resp(200, { id: 'TMP' });
      if (/\/export\?/.test(url)) return resp(200, {});
      if (/\/upload\//.test(url)) return resp(200, {});
      return resp(404, {});
    } };
    w.ctx.ScriptApp = { getOAuthToken: () => 'tok' };
    w.ctx.DriveApp.getFileById = () => ({ setTrashed() {}, getLastUpdated: () => ({ getTime: () => 0 }) });
    w.calls = calls;
    return w;
  }
  let w = xlsxWorld([5000, 5000, 7000]);
  const res = J(w.ctx.updateTargetAttendanceFile_({ fileId: 'XF', isGoogleSheet: false }, 'C1', 'Class C1', 18, 11, { [SIDS[1]]: 'L' }, null));
  ok(res.afterModifiedMs === 7000 && w.calls.some(u => /\/upload\//.test(u)), 'xlsx write: uploaded and afterModifiedMs = modifiedTime after the upload');
  w = xlsxWorld([5000, 6000, 6000]);
  let err = '';
  try { w.ctx.updateTargetAttendanceFile_({ fileId: 'XF', isGoogleSheet: false }, 'C1', 'Class C1', 18, 11, { [SIDS[1]]: 'L' }, null); } catch (e) { err = String(e.message); }
  ok(/XLSX_MODIFIED_DURING_SYNC/.test(err) && !w.calls.some(u => /\/upload\//.test(u)), 'xlsx edited while converting: nothing is uploaded');
});

// ---- trigger revision
T('trigger rev', () => {
  const w = makeWorld(); const log = [];
  w.ctx.__trg = [{ fn: 'autoSyncTodayAttendanceAfterClass', d: false }, { fn: 'setupCenterSyncMenu', d: false }];
  w.ctx.ScriptApp = {
    getProjectTriggers: () => w.ctx.__trg.map(t => ({ getHandlerFunction: () => t.fn, t })),
    deleteTrigger: x => { log.push('del:' + x.t.fn); w.ctx.__trg = w.ctx.__trg.filter(t => t !== x.t); },
    newTrigger: fn => ({ timeBased: () => ({ everyMinutes: n => ({ create: () => { log.push('new:' + fn + ':' + n); w.ctx.__trg.push({ fn }); } }) }), forSpreadsheet: () => ({ onOpen: () => ({ create: () => { log.push('open'); } }) }) })
  };
  w.ctx.ensureBackgroundTriggers_();
  ok(eq(log, ['del:autoSyncTodayAttendanceAfterClass', 'new:autoSyncTodayAttendanceAfterClass:5']) && w.props.QR_TRIGGER_REV === '3.10', 'old 15-minute trigger replaced by a 5-minute one: ' + JSON.stringify(log));
  log.length = 0; w.ctx.ensureBackgroundTriggers_();
  ok(log.length === 0, 'trigger kept once the revision matches');
});

// ---- review fixes A-D
T('A: check-in between snapshot and lock is not overwritten', () => {
  const w = firstPushWorld();
  w.setCell(SIDS[3], 1, '', '#ffff00');                 // sheet: S4 x -> L (pull)
  w.ctx.__hook = () => { w.ctx.writeManualMarksForDay_(w.master, 'C1', D1, { [SIDS[3]]: 'P' }, { lockHeld: true, actor: 'STUDENT' }); };
  vm.runInContext(`(function(){ const o = withMasterWriteLock_; let done = false; withMasterWriteLock_ = function(a, b, f) { if (!done) { done = true; __hook(); } return o(a, b, f); }; })();`, w.ctx);
  w.auto();
  ok(w.web(D1)[SIDS[3]] === 'P', 'A: web value that changed after the snapshot is not overwritten by the old Sheet value: ' + w.web(D1)[SIDS[3]]);
  ok(w.base('C1', D1).base[SIDS[3]] === '-', 'A: skipped cell keeps its old base');
  w.auto();
  ok(w.web(D1)[SIDS[3]] === 'L', 'A: next run converges (Sheet wins): ' + w.web(D1)[SIDS[3]]);
});
T('B: cell edited between extract and write is skipped', () => {
  const w = makeWorld(); w.day(D1, MARKS);
  const res = J(w.ctx.updateTargetAttendanceFile_({ fileId: 'F1', isGoogleSheet: true }, 'C1', 'Class C1', 18, 11, { [SIDS[1]]: 'L', [SIDS[3]]: '-' }, null, { [SIDS[1]]: 'BLANK', [SIDS[3]]: '-' }));
  ok(true, 'B setup');
  const w2 = makeWorld(); w2.day(D1, MARKS); w2.setCell(SIDS[1], 1, 'x', '');
  const r2 = J(w2.ctx.updateTargetAttendanceFile_({ fileId: 'F1', isGoogleSheet: true }, 'C1', 'Class C1', 18, 11, { [SIDS[1]]: 'L', [SIDS[3]]: '-' }, null, { [SIDS[1]]: 'BLANK', [SIDS[3]]: 'BLANK' }));
  ok(eq(r2.skippedSids, [SIDS[1]]) && w2.cell(SIDS[1], 1).v === 'x' && w2.cell(SIDS[3], 1).v === 'x', 'B: changed cell skipped, other written: ' + JSON.stringify(r2.skippedSids));
  ok(r2.previousCells.length === 1 && r2.previousCells[0].sid === SIDS[3], 'B: skipped cell not in previousCells');
  const w3 = firstPushWorld();
  w3.webMark(D1, SIDS[0], 'L');
  vm.runInContext(`(function(){ const o = updateTargetAttendanceFile_; updateTargetAttendanceFile_ = function() { __w.setCell('${SIDS[0]}', 1, 'x', ''); return o.apply(this, arguments); }; })();`, w3.ctx);
  w3.auto();
  ok(w3.cell(SIDS[0], 1).v === 'x' && w3.cell(SIDS[0], 1).bg === '#ffffff', 'B: concurrent teacher edit is not overwritten');
  ok(w3.base('C1', D1).base[SIDS[0]] === 'P', 'B: skipped cell not added to the new base');
  w3.auto();
  ok(w3.web(D1)[SIDS[0]] === '-', 'B: next run merges again, Sheet wins: ' + w3.web(D1)[SIDS[0]]);
});
T('C: deadline between days', () => {
  const w = makeWorld({ tNames: ['11/11', '18/11'] });
  w.day('2026-11-11', MARKS); w.day(D1, MARKS);
  vm.runInContext(`(function(){ const o = updateTargetAttendanceFile_; updateTargetAttendanceFile_ = function() { const r = o.apply(this, arguments); __NOW += 300000; return r; }; })();`, w.ctx);
  w.auto();
  ok(w.base('C1', '2026-11-11') !== null && w.base('C1', D1) === null, 'C: written day has its base, the next day is left for the next run');
  ok(w.cell(SIDS[3], 2).v === '', 'C: second day untouched');
  w.setNow(18); w.auto();
  ok(w.base('C1', D1) !== null && w.cell(SIDS[3], 2).v === 'x', 'C: next run finishes the second day');
});
T('D: manual mark status whitelist', () => {
  const w = makeWorld(); w.day(D1, MARKS);
  const n = w.att().length;
  const r = J(w.ctx.handleTeacherManualMark(w.master, { classId: 'C1', studentId: SIDS[0], status: '=HYPERLINK("http://x","a")', targetDayKey: D1 }));
  ok(r.ok === false && r.code === 'ERR_INVALID_INPUT' && w.att().length === n, 'D: formula status rejected, no row written: ' + JSON.stringify(r));
  w.ctx.writeManualMarksForDay_(w.master, 'C1', D1, { [SIDS[1]]: '=1+1', [SIDS[2]]: 'l' }, { actor: 'T' });
  ok(w.att().every(x => /^[PLE-]$/.test(String(x[5]))), 'D: writeManualMarksForDay_ never stores a foreign value');
  ok(w.att().some(x => x[4] === SIDS[2] && x[5] === 'L' && x[9] === 'TEACHER_MANUAL'), 'D: lower case is normalised');
});

// ---- run gate (ACTIVE / IDLE) in front of the 5-minute trigger
const LOC = (h, mi, d) => new Date(2026, 10, d || 18, h, mi || 0, 0).getTime();
const SCHED = (o) => JSON.stringify({ C1: Object.assign({ startPeriod: 7, endPeriod: 9, dayOfWeek: 3, daysOfWeek: [3], sessionDates: ['2026-11-18'], makeUpDates: [] }, o || {}) });
function gateWorld(o) {
  const w = makeWorld(o);
  const c = { drive: 0, fetch: 0, open: 0, cal: 0, names: [] };
  const gd = w.ctx.DriveApp.getFileById; w.ctx.DriveApp.getFileById = function() { c.drive++; return gd.apply(this, arguments); };
  const so = w.ctx.SpreadsheetApp.openById; w.ctx.SpreadsheetApp.openById = function() { c.open++; return so.apply(this, arguments); };
  w.ctx.UrlFetchApp = { fetch: () => { c.fetch++; throw new Error('UrlFetch must not be called'); } };
  w.ctx.CalendarApp = { getDefaultCalendar: () => { c.cal++; throw new Error('CalendarApp must not be called'); } };
  const gs = w.master.getSheetByName.bind(w.master); w.master.getSheetByName = n => { c.names.push(n); return gs(n); };
  vm.runInContext(`__full = 0; (function(){ const o = runTwoWayAutoSync_; runTwoWayAutoSync_ = function() { __full++; return o.apply(this, arguments); }; })();`, w.ctx);
  w.c = c; w.full = () => w.ctx.__full;
  w.at = (h, mi, d) => { w.ctx.__NOW = LOC(h, mi, d); };
  w.gate = () => w.ctx.getSync2wGate_(w.master, w.ctx.PropertiesService.getScriptProperties(), w.ctx.__NOW);
  w.sesLocal = (id, openH, closesH, closedH) => w.sheet('Sessions_Log').appendRow([id, 'C1', 'lbl', new Date(LOC(openH)).toISOString(), new Date(LOC(openH, 10)).toISOString(), new Date(LOC(closesH)).toISOString(), closedH ? new Date(LOC(closedH)).toISOString() : '', 10.8, 106.6, 100, 'STATIC']);
  return w;
}
T('gate: session today within 3h is ACTIVE, later is IDLE', () => {
  const w = gateWorld(); w.props.QR_CLASS_SCHEDULE_META_MAP = SCHED({ sessionDates: ['2026-11-25'] }); // not scheduled today
  w.sesLocal('S_A', 9, 11, 12);
  w.at(14); ok(w.gate() === 'active', 'gate: session closed 12:00, now 14:00 -> active');
  w.at(15); ok(w.gate() === 'active', 'gate: exactly +3h after the close -> still active');
  w.at(16); ok(w.gate() === 'idle', 'gate: more than 3h after the close -> idle');
  const w2 = gateWorld(); w2.props.QR_CLASS_SCHEDULE_META_MAP = SCHED({ sessionDates: ['2026-11-25'] });
  w2.sesLocal('S_OPEN', 9, 11, 0); w2.at(10); ok(w2.gate() === 'active', 'gate: session still open -> active');
  const w3 = gateWorld(); w3.props.QR_CLASS_SCHEDULE_META_MAP = SCHED({ sessionDates: ['2026-11-25'] });
  w3.sheet('Sessions_Log').appendRow(['S_Y', 'C1', 'l', new Date(LOC(9, 0, 17)).toISOString(), '', new Date(LOC(11, 0, 17)).toISOString(), '', 1, 1, 100, 'STATIC']);
  w3.at(12); ok(w3.gate() === 'idle', 'gate: a session from yesterday does not count');
});
T('gate: scheduled class today within [-45m, +3h]', () => {
  const w = gateWorld(); w.props.QR_CLASS_SCHEDULE_META_MAP = SCHED(); // periods 7-9 = 12:30-15:00 -> window 11:45-18:00
  w.ctx.__NOW = LOC(11, 44); ok(w.gate() === 'idle', 'gate: 11:44 -> idle');
  w.ctx.__NOW = LOC(11, 45); ok(w.gate() === 'active', 'gate: 11:45 (start - 45m) -> active');
  w.at(18); ok(w.gate() === 'active', 'gate: 18:00 (end + 3h) -> active');
  w.ctx.__NOW = LOC(18, 1); ok(w.gate() === 'idle', 'gate: 18:01 -> idle');
  const w2 = gateWorld(); w2.props.QR_CLASS_SCHEDULE_META_MAP = SCHED({ sessionDates: [], makeUpDates: [] }); w2.at(13);
  ok(w2.gate() === 'active', 'gate: no dates but weekday matches today -> active');
  const w3 = gateWorld(); w3.props.QR_CLASS_SCHEDULE_META_MAP = SCHED({ sessionDates: [], makeUpDates: [], daysOfWeek: [1], dayOfWeek: 1 }); w3.at(13);
  ok(w3.gate() === 'idle', 'gate: other weekday -> idle');
  const w4 = gateWorld(); w4.props.QR_CLASS_SCHEDULE_META_MAP = SCHED({ sessionDates: ['2026-11-25'], makeUpDates: ['2026-11-18'] }); w4.at(13);
  ok(w4.gate() === 'active', 'gate: make-up date today -> active');
});
T('gate: IDLE within 30 minutes exits without any heavy call', () => {
  const w = gateWorld(); w.props.QR_CLASS_SCHEDULE_META_MAP = SCHED(); w.at(20);
  w.props.QR_SYNC2W_LAST_FULL_MS = String(LOC(19, 40));
  w.day('2026-11-17', MARKS);
  const auditN = w.audit().length, last = w.props.QR_SYNC2W_LAST_FULL_MS;
  w.c.names.length = 0; w.auto();
  ok(w.full() === 0, 'idle <30m: full run not started');
  ok(w.c.drive === 0 && w.c.fetch === 0 && w.c.open === 0 && w.c.cal === 0, 'idle <30m: no Drive/UrlFetch/openById/Calendar call ' + JSON.stringify(w.c));
  ok(w.c.names.every(n => n === 'Sessions_Log') && w.c.names.length <= 1, 'idle <30m: only Sessions_Log touched: ' + JSON.stringify(w.c.names));
  ok(w.audit().length === auditN, 'idle exit: no Audit_Log row');
  ok(w.props.QR_SYNC2W_LAST_FULL_MS === last && w.cache.SYNC2W_RUNNING === undefined, 'idle exit: marker unchanged, no lock flag');
  ok(w.base('C1', '2026-11-17') === null && w.tsheet.writeOps === 0, 'idle exit: nothing synced');
});
T('gate: IDLE after 30 minutes runs fully and records the marker', () => {
  const w = gateWorld({ tNames: ['17/11', '25/11'] }); w.props.QR_CLASS_SCHEDULE_META_MAP = SCHED(); w.at(20);
  w.props.QR_SYNC2W_LAST_FULL_MS = String(LOC(19, 29));
  w.day('2026-11-17', MARKS);
  w.auto();
  ok(w.full() === 1, 'idle >=30m: full run started');
  ok(w.props.QR_SYNC2W_LAST_FULL_MS === String(LOC(20)), 'idle >=30m: marker updated to now: ' + w.props.QR_SYNC2W_LAST_FULL_MS);
  ok(w.base('C1', '2026-11-17') !== null, 'idle full run keeps the sync logic (yesterday pushed)');
  ok(w.audit().some(a => a.action === 'SYNC2W_RUN' && /gate=idle/.test(a.details)), 'SYNC2W_RUN carries gate=idle: ' + JSON.stringify(w.audit().filter(a => a.action === 'SYNC2W_RUN')));
  const n = w.full(); w.at(20, 10); w.auto();
  ok(w.full() === n, 'right after a full idle run the next trigger exits again');
});
T('gate: ACTIVE runs every time and logs gate=active', () => {
  const w = gateWorld(); w.props.QR_CLASS_SCHEDULE_META_MAP = SCHED({ startPeriod: 10, endPeriod: 12 });
  w.day(D1, MARKS); w.at(18); w.props.QR_SYNC2W_LAST_FULL_MS = String(LOC(17, 59));
  w.auto(); w.at(18, 5); w.auto();
  ok(w.full() === 2, 'active: two consecutive triggers both run fully');
  ok(w.audit().some(a => a.action === 'SYNC2W_RUN' && /gate=active/.test(a.details)), 'SYNC2W_RUN carries gate=active');
});
T('gate: unknown schedule fails open 06-23h, IDLE outside', () => {
  const w = gateWorld(); // no QR_CLASS_SCHEDULE_META_MAP at all, no session today
  w.at(6); ok(w.gate() === 'active', 'fail-open: 06:00 active');
  w.at(22); ok(w.gate() === 'active', 'fail-open: 22:00 active');
  w.at(23); ok(w.gate() === 'idle', 'fail-open: 23:00 idle');
  w.at(3); ok(w.gate() === 'idle', 'fail-open: 03:00 idle');
  w.props.QR_CLASS_SCHEDULE_META_MAP = '{bad json'; w.at(10); ok(w.gate() === 'active', 'fail-open: corrupt map at 10:00 active');
  w.props.QR_CLASS_SCHEDULE_META_MAP = JSON.stringify({ C1: { sessionDates: [], makeUpDates: [] } }); w.at(10); ok(w.gate() === 'active', 'fail-open: empty entry at 10:00 active');
  w.at(3); w.props.QR_SYNC2W_LAST_FULL_MS = String(LOC(2, 55)); w.auto();
  ok(w.full() === 0, 'fail-open: 03:00 idle trigger exits');
});
T('gate: manual Sync is never gated', () => {
  const w = gateWorld({ tNames: ['18/11', '25/11'] }); w.props.QR_CLASS_SCHEDULE_META_MAP = SCHED(); w.at(20);
  w.sesLocal('SES_C1_G', 9, 10, 10); w.scan('SES_C1_G', SIDS[0], 'P'); w.scan('SES_C1_G', SIDS[1], 'L');
  w.props.QR_SYNC2W_LAST_FULL_MS = String(LOC(19, 50));
  ok(w.gate() === 'idle', 'manual setup: gate is idle');
  w.auto(); ok(w.base('C1', D1) === null, 'manual setup: the trigger run is gated');
  w.manual(); ok(w.base('C1', D1) !== null && w.cell(SIDS[1], 1).bg === '#ffff00', 'manual Sync runs although the gate is idle');
});

console.log(`test-two-way-sync: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
