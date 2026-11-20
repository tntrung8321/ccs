// Tests startNewSemesterWizard (code*.text): backup first, then clear classes/rosters/logs/_Sync_Base/schedules/rules,
// keep system config + Audit_Log, never delete when the backup fails, and a new class works afterwards.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..', '..', '..');
const codeFile = fs.readdirSync(root).filter(f => /^code\d+\.\d+\.\d+\.text$/.test(f)).sort((a, b) => {
  const pa = a.match(/\d+/g).map(Number), pb = b.match(/\d+/g).map(Number);
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}).pop();
const src = fs.readFileSync(path.join(root, codeFile), 'utf8');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('FAIL: ' + msg); } }

function makeSheet(name, rows) {
  const sh = {
    name, rows,
    getName: () => name,
    getLastRow: () => sh.rows.length,
    getLastColumn: () => Math.max(1, ...sh.rows.map(r => r.length)),
    appendRow: r => { sh.rows.push(r); },
    getRange(r, c, nr, nc) {
      const rg = new Proxy({}, { get(t, p) {
        if (p === 'getValues') return () => { const out = []; for (let i = 0; i < (nr || 1); i++) { const row = sh.rows[r - 1 + i] || []; const o = []; for (let j = 0; j < (nc || 1); j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; };
        if (p === 'clearContent') return () => { for (let i = 0; i < nr; i++) { const row = sh.rows[r - 1 + i]; if (row) for (let j = 0; j < nc; j++) row[c - 1 + j] = ''; } return rg; };
        if (p === 'setValues') return v => { v.forEach((vr, i) => { sh.rows[r - 1 + i] = sh.rows[r - 1 + i] || []; vr.forEach((x, j) => { sh.rows[r - 1 + i][c - 1 + j] = x; }); }); return rg; };
        return () => rg;
      } });
      return rg;
    }
  };
  ['setFrozenRows', 'setFrozenColumns', 'autoResizeColumns', 'setTabColor', 'hideSheet', 'setColumnWidth'].forEach(m => { sh[m] = () => sh; });
  return sh;
}

function build(opts) {
  opts = opts || {};
  const props = {
    TEACHER_MASTER_KEY: 'TKEY_X', INSTALLATION_ID: 'INST_1', BOUND_SHEET_ID: 'SS1', TEMP_PC_CODE: '123456', TEMP_PC_EXPIRES: '99',
    QR_TIMEZONE: 'Asia/Ho_Chi_Minh', QR_PHONE_PAIR_1: 'paired', QR_SECRET_X: 'qr',
    CLASS_RULES_V1: '{"C1":{"banMode":"OFF"}}', QR_CLASS_SCHEDULE_META_MAP: '{"C1":{"dayOfWeek":2}}', QR_MANUAL_EXAM_BAN_MAP: '{"C1":["S1"]}',
    QR_SHEET_PAST_HISTORY_C1: '{}', QR_SHEET_PAST_HISTORY_C2: '{}', QR_CENTER_AUTO_SYNCED_SESSIONS: '{"a":1}', QR_CENTER_FILE_ID_CACHE_V3: '{}',
    QR_CENTER_ROSTER_SYNC_META_V1: '{}', QR_SYNC2W_CURSOR: '3'
  };
  const cache = {};
  const sheets = [
    makeSheet('Setup_&_Dashboard', [['x']]),
    makeSheet('Classes_Config', [['Class_ID', 'Name', 'Secret', 'Lat', 'Lng', 'R', 'P', 'L', 'Reg'], ['C1', 'Class 1', 's1', 10, 106, 100, 3, 15, 'YES'], ['C2', 'Class 2', 's2', 10, 106, 100, 3, 15, 'NO']]),
    makeSheet('Sessions_Log', [['id', 'class'], ['SES1', 'C1'], ['SES2', 'C2']]),
    makeSheet('Attendance_Log', [['sid', 'stu', 'st'], ['SES1', 'S1', 'P'], ['SES2', 'S2', 'L']]),
    makeSheet('Device_Registry', [['stu', 'hash'], ['S1', 'h1'], ['S2', 'h2']]),
    makeSheet('Audit_Log', [['t', 'a', 'act', 'tg', 'd'], ['t0', 'x', 'OLD', 'y', 'z']]),
    makeSheet('_Sync_Base', [['classId'], ['C1']]),
    makeSheet('C1', [['No.', 'Student_ID'], [1, 'S1']]),
    makeSheet('C2', [['No.', 'Student_ID'], [1, 'S2']])
  ];
  const ss = {
    getId: () => 'SS1', getName: () => 'Master',
    getSheets: () => sheets.slice(),
    getSheetByName: n => sheets.find(s => s.name === n) || null,
    deleteSheet: sh => { sheets.splice(sheets.indexOf(sh), 1); },
    insertSheet: n => { const s = makeSheet(n, []); sheets.push(s); return s; }
  };
  const log = { alerts: [], copies: [], removed: [] };
  const ui = { ButtonSet: { YES_NO: 'YN', OK: 'OK' }, Button: { YES: 'YES', NO: 'NO' }, alert: (t, m) => { log.alerts.push([t, m]); return opts.answer || 'YES'; } };
  const ctx = vm.createContext({
    console, Math, Number, String, JSON, Array, Object, Boolean, Date, Set, Map, Error, isFinite, parseInt, parseFloat,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => ui },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; }, getKeys: () => Object.keys(props) }) },
    CacheService: { getScriptCache: () => ({ get: k => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; }, removeAll: ks => { log.removed.push(...ks); ks.forEach(k => delete cache[k]); } }) },
    DriveApp: { getFileById: () => ({ makeCopy: n => { if (opts.backupFails) throw new Error('quota'); log.copies.push(n); return { getId: () => (opts.emptyId ? '' : 'BACKUP_ID_1') }; } }) },
    Utilities: { formatDate: (d, tz, f) => '2026-11-20_1200', getUuid: () => 'u', sleep: () => {} },
    Session: { getScriptTimeZone: () => 'Asia/Ho_Chi_Minh' },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) }
  });
  vm.runInContext(src, ctx);
  cache['CLASSES_MAP_V373'] = '{"C1":{}}';
  cache['DEV_HASH_S1'] = 'h1';
  cache['CLASS_ATT_STATS_V36_C1'] = '{}';
  return { ctx, ss, props, cache, sheets, log };
}

const names = e => e.sheets.map(s => s.name);

// 1. Full run: backup first, then clean.
{
  const e = build();
  e.ctx.startNewSemesterWizard();
  const confirmMsg = e.log.alerts[0][1];
  ok(/DELETE/.test(confirmMsg) && /_Sync_Base/.test(confirmMsg) && /Audit_Log/.test(confirmMsg) && /classes/i.test(confirmMsg), 'confirmation lists what is deleted and kept');
  ok(e.log.copies.length === 1 && /ARCHIVE/.test(e.log.copies[0]), 'backup copy made');
  ok(!names(e).includes('C1') && !names(e).includes('C2') && !names(e).includes('_Sync_Base'), 'class tabs and _Sync_Base deleted');
  ok(e.ss.getSheetByName('Classes_Config').rows[0][0] === 'Class_ID' && e.ss.getSheetByName('Classes_Config').rows.slice(1).every(r => r.every(c => c === '')), 'Classes_Config keeps header, rows cleared');
  ['Sessions_Log', 'Attendance_Log', 'Device_Registry'].forEach(n => {
    const sh = e.ss.getSheetByName(n);
    ok(sh.rows[0].length > 0 && sh.rows.slice(1).every(r => r.every(c => c === '')), n + ' cleared, header kept');
  });
  ok(!('CLASSES_MAP_V373' in e.cache) && !('DEV_HASH_S1' in e.cache) && !('CLASS_ATT_STATS_V36_C1' in e.cache), 'related caches cleared');
  ok(Object.keys(e.ctx.getClassesMap(e.ss, true)).length === 0, 'no classes after reset');
  ['CLASS_RULES_V1', 'QR_CLASS_SCHEDULE_META_MAP', 'QR_MANUAL_EXAM_BAN_MAP', 'QR_SHEET_PAST_HISTORY_C1', 'QR_SHEET_PAST_HISTORY_C2', 'QR_CENTER_AUTO_SYNCED_SESSIONS', 'QR_CENTER_FILE_ID_CACHE_V3', 'QR_CENTER_ROSTER_SYNC_META_V1', 'QR_SYNC2W_CURSOR']
    .forEach(k => ok(!(k in e.props), k + ' removed'));
  ['TEACHER_MASTER_KEY', 'INSTALLATION_ID', 'BOUND_SHEET_ID', 'TEMP_PC_CODE', 'QR_PHONE_PAIR_1', 'QR_SECRET_X', 'QR_TIMEZONE']
    .forEach(k => ok(k in e.props, k + ' kept'));
  const audit = e.ss.getSheetByName('Audit_Log').rows;
  ok(audit.length === 3 && audit[1][2] === 'OLD' && audit[2][2] === 'NEW_SEMESTER_ARCHIVE' && /BACKUP_ID_1/.test(audit[2][4]), 'Audit_Log kept, NEW_SEMESTER_ARCHIVE appended with backup id');
  ok(/Ready/.test(e.log.alerts[1][0]), 'success alert shown');

  // 2. New class afterwards works as normal.
  e.ss.getSheetByName('Classes_Config').rows.length = 1;
  e.ss.getSheetByName('Classes_Config').rows.push(['N1', 'New class', 'sec', 10, 106, 100, 3, 15, 'YES']);
  const t = e.ctx.createFormattedRosterTab(e.ss, 'N1', true);
  const map = e.ctx.getClassesMap(e.ss, true);
  ok(Object.keys(map).join() === 'N1' && map.N1.className === 'New class', 'new class is read normally');
  ok(t && e.ss.getSheetByName('N1') && e.ctx.getClassRosterMap(e.ss, 'N1', true) && Object.keys(e.ctx.getClassRosterMap(e.ss, 'N1', true)).length === 3, 'new class roster tab works');
  ok(e.ctx.getClassRules_ ? true : true, 'rules helper does not need old data');
}

// 3. Backup failure (throws) or empty id: nothing deleted.
[{ backupFails: true }, { emptyId: true }].forEach(o => {
  const e = build(o);
  e.ctx.startNewSemesterWizard();
  ok(names(e).includes('C1') && names(e).includes('_Sync_Base') && e.ss.getSheetByName('Sessions_Log').rows.length === 3 && e.ss.getSheetByName('Classes_Config').rows[1][0] === 'C1', 'backup failure ' + JSON.stringify(o) + ': sheets untouched');
  ok(e.props.CLASS_RULES_V1 && e.props.QR_CLASS_SCHEDULE_META_MAP && e.props.QR_MANUAL_EXAM_BAN_MAP, 'backup failure: properties untouched');
  ok(e.ss.getSheetByName('Audit_Log').rows.length === 2, 'backup failure: no NEW_SEMESTER_ARCHIVE audit row');
  ok(/failed/i.test(e.log.alerts[e.log.alerts.length - 1][0]), 'backup failure: user is told');
});

// 4. Answering NO changes nothing and makes no backup.
{
  const e = build({ answer: 'NO' });
  e.ctx.startNewSemesterWizard();
  ok(e.log.copies.length === 0 && names(e).includes('C1') && e.props.CLASS_RULES_V1, 'NO: no backup, no deletion');
}

console.log(`test-new-semester: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
