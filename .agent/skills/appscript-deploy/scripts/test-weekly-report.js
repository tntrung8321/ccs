// Tests the weekly attendance report mail in sync.txt, running the real code3.*.text helpers
// (evaluateAttendanceRules_, getClassRules_) with fake sheet data.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..', '..', '..');
const codeFile = fs.readdirSync(root).filter(f => /^code\d+\.\d+\.\d+\.text$/.test(f)).sort().pop();
const codeSrc = fs.readFileSync(path.join(root, codeFile), 'utf8');
const syncSrc = fs.readFileSync(path.join(root, 'sync.txt'), 'utf8');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('FAIL: ' + msg); } }

const TZ = 'Asia/Ho_Chi_Minh';
let NOW = Date.parse('2026-11-23T11:30:00Z'); // Monday 18:30 ICT
class FakeDate extends Date {
  constructor(...a) { if (a.length) super(...a); else super(NOW); }
  static now() { return NOW; }
}
function fmt(d, f) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short' })
    .formatToParts(d).forEach(x => { p[x.type] = x.value; });
  if (f === 'u') return String({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[p.weekday]);
  if (f === 'H') return String(Number(p.hour));
  return f.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day);
}

const props = {};
let triggers = [];
let mails = [];
let mailFail = false;
let dialogHtml = '';
let menuItems = [];
const ctx = vm.createContext({
  console, Date: FakeDate,
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {}, removeAll: () => {} }) },
  Utilities: { formatDate: (d, tz, f) => fmt(d, f) },
  Session: { getScriptTimeZone: () => TZ, getEffectiveUser: () => ({ getEmail: () => 'owner@example.test' }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  MailApp: {
    sendEmail: m => { if (mailFail) throw new Error('mail quota'); mails.push(m); },
    getRemainingDailyQuota: () => 90
  },
  ScriptApp: {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: t => { triggers = triggers.filter(x => x !== t); },
    newTrigger: fn => {
      const t = { fn, getHandlerFunction: () => fn };
      return { timeBased: () => ({ everyHours: () => ({ create: () => { triggers.push(t); return t; } }) }) };
    }
  },
  HtmlService: { createHtmlOutput: h => { dialogHtml = h; return { setWidth() { return this; }, setHeight() { return this; } }; } },
  SpreadsheetApp: {
    getActiveSpreadsheet: () => ({}),
    getUi: () => ({
      alert: () => {}, showModalDialog: () => {},
      createMenu: () => { const m = { addItem: n => { menuItems.push(n); return m; }, addSeparator: () => m, addToUi: () => m }; return m; }
    })
  },
  Logger: { log: () => {} }
});
vm.runInContext(codeSrc, ctx);
vm.runInContext(syncSrc, ctx);

// ---- fake class data (replaces the sheet readers only; rules/evaluation are the real ones) ----
let WORLD = {};
function mkStats(days, str, manual) {
  const h = [];
  let P = 0, L = 0, E = 0, A = 0;
  str.split('').forEach((c, i) => {
    const s = c === '-' ? '-' : c;
    if (c === 'P') P++; else if (c === 'L') L++; else if (c === 'E') E++; else A++;
    h.push({ dayKey: days[i], finalStatus: s });
  });
  return { P, L, E, A, manualExamBan: Boolean(manual), history: h };
}
function addStu(cls, sid, str, manual, nameOverride) {
  cls.stats[sid] = mkStats(cls.days, str, manual);
  cls.roster[sid] = { fullName: nameOverride || ('Name_' + sid) };
}
function buildWorld() {
  const A = { days: ['2026-10-31', '2026-11-03', '2026-11-06', '2026-11-09', '2026-11-12', '2026-11-15', '2026-11-18', '2026-11-21'], stats: {}, roster: {} };
  addStu(A, 'a1', 'P-------');
  addStu(A, 'a2', '--------', true);
  addStu(A, 'a3', 'PP------');
  addStu(A, 'a4', 'PP------');
  addStu(A, 'a5', '----PPPP');
  addStu(A, 'a6', 'PPPPPP--');
  addStu(A, 'a7', 'PPPPPLLL');
  addStu(A, 'a8', 'PPPPPPPP');
  addStu(A, 'a9', 'PPPPPPPE');
  const B = { days: ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-19', '2026-11-23'], stats: {}, roster: {} };
  addStu(B, 'b1', '--P--');
  addStu(B, 'b2', 'PP---');
  addStu(B, 'b3', 'PPPP-');
  const C = { days: ['2026-10-26', '2026-10-30', '2026-11-02', '2026-11-09', '2026-11-18', '2026-11-22'], stats: {}, roster: {} };
  addStu(C, 'c1', 'P-----');
  addStu(C, 'c2', '------');
  addStu(C, 'c3', 'PPPPPP');
  return { 'LOP-A': A, 'LOP-B': B, 'LOP-C': C };
}
ctx.getClassesMap = () => { const o = {}; Object.keys(WORLD).forEach(k => { o[k] = { classId: k, className: 'Class ' + k }; }); return o; };
ctx.getClassAttendanceStatsMap_ = (ss, cid) => JSON.parse(JSON.stringify(WORLD[cid].stats));
ctx.getClassRosterMap = (ss, cid) => WORLD[cid].roster;
function setRules() {
  props.CLASS_RULES_V1 = JSON.stringify({
    'LOP-B': { presetId: 'p-abs', banMode: 'ABSENCES', banAbsences: 3, banAbsUnit: 'COUNT', warnAbsMargin: 1 },
    'LOP-C': { presetId: 'p-score', banMode: 'SCORE', baseScore: 10, deductA: 1, banScoreBelow: 5, warnScoreMargin: 1 }
  });
}
function reset() {
  Object.keys(props).forEach(k => delete props[k]);
  triggers = []; mails = []; mailFail = false;
  NOW = Date.parse('2026-11-23T11:30:00Z');
  WORLD = buildWorld();
  setRules();
}
const enable = (over) => ctx.saveWeeklyReportSettings(Object.assign({ enabled: true, dow: 1, hour: 18, email: '', classIds: [] }, over || {}));
const tick = () => ctx.sendWeeklyAttendanceReportTick();

// ---- menu ----
ctx.buildCenterSyncMenuOnly_();
const i5 = menuItems.indexOf('5. Attendance Mark Settings');
ok(i5 >= 0 && menuItems[i5 + 1] === '6. Weekly Report' && menuItems.indexOf('Cấp quyền gửi báo cáo') > i5 + 1, 'menu has "6. Weekly Report" after 5 and the authorize item');
reset();
ctx.authorizeWeeklyReportMail();
ok(true, 'authorize function runs');

// ---- off by default ----
reset();
ok(tick() === 'DISABLED' && mails.length === 0 && triggers.length === 0, 'default: nothing configured -> no trigger, no mail');
ctx.saveWeeklyReportSettings({ enabled: false, dow: 1, hour: 18 });
ok(triggers.length === 0 && tick() === 'DISABLED' && mails.length === 0, 'saved but not ticked -> no trigger, no mail');
let threw = false;
try { ctx.saveWeeklyReportSettings({ enabled: true, email: 'not-an-email' }); } catch (e) { threw = true; }
ok(threw && !(JSON.parse(props.REPORT_CFG || '{}').enabled), 'invalid email rejected, nothing saved as enabled');

// ---- trigger management ----
reset();
const other = { fn: 'autoSyncTodayAttendanceAfterClass', getHandlerFunction: () => 'autoSyncTodayAttendanceAfterClass' };
triggers.push(other);
enable(); enable();
ok(triggers.filter(t => t.fn === 'sendWeeklyAttendanceReportTick').length === 1 && triggers.includes(other), 'enable twice -> exactly one report trigger, other trigger kept');
ctx.saveWeeklyReportSettings({ enabled: false });
ok(triggers.length === 1 && triggers[0] === other, 'untick removes only the report trigger');

// ---- day / hour / dedupe ----
reset(); enable();
NOW = Date.parse('2026-11-24T11:30:00Z'); // Tuesday
ok(tick() === 'NOT_YET' && mails.length === 0, 'wrong weekday -> no send');
NOW = Date.parse('2026-11-23T09:30:00Z'); // Monday 16:30
ok(tick() === 'NOT_YET' && mails.length === 0, 'right day, before hour -> no send');
NOW = Date.parse('2026-11-23T11:30:00Z'); // Monday 18:30
ok(tick() === 'SENT' && mails.length === 1, 'right day and hour -> sent once');
ok(tick() === 'ALREADY_SENT' && mails.length === 1, 'second tick same hour -> not duplicated');
NOW = Date.parse('2026-11-23T14:30:00Z');
ok(tick() === 'ALREADY_SENT' && mails.length === 1, 'later the same day -> not duplicated');
ok(props.REPORT_LAST_SENT_KEY === '2026-11-23', 'REPORT_LAST_SENT_KEY stored');

// ---- content ----
const m = mails[0];
ok(m.to === 'owner@example.test', 'default recipient = script owner');
ok(m.subject === '[CCS] Chuyên cần tuần 23/11: 3 cấm thi, 4 sát nút, 2 chú ý', 'subject counts: ' + m.subject);
ok(/Name_a1\b/.test(m.body) && /Name_b1\b/.test(m.body) && /Name_c2\b/.test(m.body), 'unmarked banned students listed (3 classes, 3 rule sets)');
ok(!/Name_a2\b/.test(m.body) && !/Name_a2\b/.test(m.htmlBody), 'manualExamBan student hidden');
const warnLine = m.body.split('\n').find(l => /Name_a3/.test(l));
ok(warnLine && /Name_a3, Name_a4/.test(warnLine) && /6\/6/.test(warnLine), 'warn students with same reason share one line');
ok(m.body.split('\n').filter(l => /Name_a3|Name_a4/.test(l)).length === 1, 'grouped (not repeated per student)');
ok(/Name_b2\b.*3\/3/.test(m.body) && /Name_c1\b.*điểm chuyên cần 5/.test(m.body), 'warn reasons follow each class rules (absences vs score)');
ok(/Name_a6\b.*vắng 2 buổi/.test(m.body) && /Name_a7\b.*trễ 3 buổi/.test(m.body), 'ongoing absence/late streaks listed');
ok(!/Name_a5\b/.test(m.body), 'past streak ignored');
ok(!/Name_a8\b|Name_a9\b|Name_b3\b|Name_c3\b/.test(m.body), 'fine students not listed');
ok(/LOP-A \| 9 \| /.test(m.body) && /LOP-B \| 3 \| /.test(m.body) && /LOP-C \| 3 \| /.test(m.body), 'summary has one row per class with headcount');
ok(/Lớp LOP-A: quy chế mặc định/.test(m.body) && /Lớp LOP-B: quy chế đã đặt/.test(m.body), 'default rules stated explicitly, custom rules named');
ok(/dữ liệu tính từ ngày 31\/10\/2026/.test(m.body), 'data-since date shown');
ok(/Vắng có phép tuần này: 1 lượt/.test(m.body), 'excused count in footer');
ok(!/MỚI/.test(m.body) && !/MỚI/.test(m.htmlBody), 'first mail has no NEW tags (nothing to compare)');
ok(!/Mr\.|Ms\.|Thầy|thầy|Cô /.test(m.body + m.htmlBody + m.subject), 'no hardcoded lecturer name/title');
ok(/max-width:560px/.test(m.htmlBody) && /<table/.test(m.htmlBody) && !/<table/.test(m.body), 'html is narrow; text version is plain');
ok(JSON.parse(props.REPORT_LAST_IDS).includes('LOP-A:a1') && !JSON.parse(props.REPORT_LAST_IDS).includes('LOP-A:a2'), 'REPORT_LAST_IDS stores listed students only');

// ---- NEW tag ----
props.REPORT_LAST_SENT_KEY = '';
addStu(WORLD['LOP-A'], 'a10', 'P-------', false, 'Name_a10');
addStu(WORLD['LOP-A'], 'a11', 'PPPPPP--', false, 'Name_a11');
tick();
const m2 = mails[1];
ok(m2 && /Name_a10\b.*\[MỚI\]/.test(m2.body) && /Name_a11\b.*\[MỚI\]/.test(m2.body), 'students absent from last mail get the NEW tag');
ok(!/Name_a1\b.*\[MỚI\]/.test(m2.body) && !/Name_a6\b.*\[MỚI\]/.test(m2.body), 'students already in last mail are not tagged');
ok(/>MỚI</.test(m2.htmlBody), 'html NEW badge present');

// ---- escaping ----
reset(); enable();
addStu(WORLD['LOP-A'], 'a12', 'P-------', false, 'X<b>Y</b>');
tick();
ok(!/X<b>Y/.test(mails[0].htmlBody) && /X&lt;b&gt;Y/.test(mails[0].htmlBody), 'names are HTML-escaped');

// ---- recipient + class filter ----
reset(); enable({ email: 'prof@example.test', classIds: ['LOP-B'] });
tick();
ok(mails[0].to === 'prof@example.test' && /Name_b1/.test(mails[0].body) && !/Name_a1\b|Name_c2\b/.test(mails[0].body), 'custom recipient and class filter respected');
ok(mails[0].subject === '[CCS] Chuyên cần tuần 23/11: 1 cấm thi, 1 sát nút, 0 chú ý', 'filtered subject counts: ' + mails[0].subject);

// ---- mail failure ----
reset(); enable();
triggers.push(other);
mailFail = true;
let r;
let t2 = false;
try { r = tick(); } catch (e) { t2 = true; }
ok(!t2 && r === 'ERROR' && mails.length === 0 && !props.REPORT_LAST_SENT_KEY && !props.REPORT_LAST_IDS, 'MailApp error: tick does not throw, nothing marked as sent');
ok(triggers.includes(other) && triggers.some(t => t.fn === 'sendWeeklyAttendanceReportTick'), 'MailApp error leaves all triggers intact');
mailFail = false;
NOW += 3600000;
ok(tick() === 'SENT' && mails.length === 1, 'next hourly tick retries and sends');

// ---- no sessions this week ----
reset(); enable();
Object.keys(WORLD).forEach(k => { WORLD[k].stats = {}; WORLD[k].roster = {}; addStu(WORLD[k], 's1', 'PPP', false); WORLD[k].days = ['2026-10-01', '2026-10-08', '2026-10-15']; WORLD[k].stats.s1 = mkStats(WORLD[k].days, 'PPP'); });
ok(tick() === 'NO_SESSIONS' && mails.length === 0 && !props.REPORT_LAST_SENT_KEY, 'no class had a session this week -> no mail');
// one class with sessions, others without -> sent, only that class present
reset(); enable();
WORLD['LOP-A'].stats = {}; WORLD['LOP-A'].roster = {}; addStu(WORLD['LOP-A'], 'x1', 'PPP'); WORLD['LOP-A'].stats.x1 = mkStats(['2026-10-01', '2026-10-08', '2026-10-15'], 'PPP');
tick();
ok(mails.length === 1 && !/LOP-A \|/.test(mails[0].body) && /LOP-B \|/.test(mails[0].body), 'class without sessions is left out, others still reported');

// ---- row limit ----
reset(); enable({ classIds: ['LOP-D'] });
const D = { days: ['2026-11-18', '2026-11-19', '2026-11-20'], stats: {}, roster: {} };
for (let i = 1; i <= 15; i++) addStu(D, 'd' + i, 'PP-', false);
for (let i = 16; i <= 30; i++) addStu(D, 'd' + i, '---', false);
WORLD['LOP-D'] = D;
props.CLASS_RULES_V1 = JSON.stringify({ 'LOP-D': { presetId: 'x', banMode: 'ABSENCES', banAbsences: 1, banAbsUnit: 'COUNT', warnAbsMargin: 0 } });
tick();
const body = mails[0].body;
const banRows = body.split('\n').filter(l => /^  - Name_d\d+ \(d\d+\) - /.test(l)).length;
ok(banRows === 10 && /\+5 sinh viên khác, xem trên web/.test(body), 'ban list capped at 10 rows with "+N sinh viên khác": ' + banRows);
ok(/\+\d+ sinh viên khác, xem trên web/.test(mails[0].htmlBody), 'html has overflow line');

// ---- dialog ----
reset();
ctx.openWeeklyReportDialog();
ok(/id="en"/.test(dialogHtml) && /id="dow"/.test(dialogHtml) && dialogHtml.indexOf('[[') < 0, "dialog renders with checkbox, day and hour");
ok(/saveWeeklyReportSettings/.test(dialogHtml) && /LOP-A/.test(dialogHtml), 'dialog posts to saveWeeklyReportSettings and lists classes');

console.log(`test-weekly-report: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
