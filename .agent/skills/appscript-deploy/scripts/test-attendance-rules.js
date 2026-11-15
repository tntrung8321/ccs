// Tests per-class attendance rules (js/attendance-rules.js) and parity with the backend copy in code*.text.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..', '..', '..');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('FAIL: ' + msg); } }

function load(file) {
  const ctx = vm.createContext({ console, Math, Number, String, JSON, Array, Object, Boolean });
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\n;this.__api = { normalizeAttendanceRules, evaluateAttendanceRules, effectiveBanAbsences, previewAttendanceRuleChange, parseAttendanceRulesJson, exportAttendanceRulesJson, mergeRulePresetList, DEFAULT_ATTENDANCE_RULES, BUILTIN_RULE_PRESETS };', ctx);
  return ctx.__api;
}

const fe = load(path.join(root, 'js', 'attendance-rules.js'));

// 1. Default rules must equal the legacy hardcoded formula for every combination.
function legacy(P, L, E, A, manual) {
  const equiv = Math.round((A + E * 0.5) * 10) / 10;
  const score = Math.round((10.0 - A * 1.0 - L * 0.5 - E * 0.5) * 10) / 10;
  const banned = Boolean(manual) || equiv > 6.0 || score < 0.0;
  const warn = !banned && ((equiv >= 5.5 && equiv <= 6.0) || (score >= 0.0 && score <= 1.0));
  return { equiv, score, status: banned ? 'BAN' : (warn ? 'WARN' : 'OK') };
}
let legacyMismatch = 0;
for (let A = 0; A <= 12; A++) for (let L = 0; L <= 12; L++) for (let E = 0; E <= 12; E++) for (const m of [false, true]) {
  const l = legacy(0, L, E, A, m);
  const n = fe.evaluateAttendanceRules(0, L, E, A, m, null);
  if (n.equivAbsences !== l.equiv || n.attendanceScore !== l.score || n.examStatus !== l.status) legacyMismatch++;
}
ok(legacyMismatch === 0, 'default rules equal legacy formula (mismatches: ' + legacyMismatch + ')');

// 2. Boundaries at default: 6.0 stays OK-warn, 6.5 bans.
ok(fe.evaluateAttendanceRules(0, 0, 0, 6, false, null).examStatus === 'WARN', '6 absences = WARN');
ok(fe.evaluateAttendanceRules(0, 0, 1, 6, false, null).examStatus === 'BAN', '6.5 equiv = BAN');

// 3. OFF mode: never warn/ban, manual ban still honored.
const off = { banMode: 'OFF' };
ok(fe.evaluateAttendanceRules(0, 0, 0, 20, false, off).examStatus === 'OK', 'OFF never bans');
ok(fe.evaluateAttendanceRules(0, 0, 0, 0, true, off).examStatus === 'BAN', 'OFF honors manual ban');

// 4. Percent threshold: 20% of 15 sessions = 3.
const pct = { banMode: 'ABSENCES', banAbsUnit: 'PERCENT', banAbsences: 20, totalSessions: 15 };
ok(fe.effectiveBanAbsences(pct) === 3, 'percent threshold 20% of 15 = 3');
ok(fe.evaluateAttendanceRules(0, 0, 0, 3, false, pct).examStatus === 'WARN', '3 of 15 at 20% = WARN (not over)');
ok(fe.evaluateAttendanceRules(0, 0, 0, 4, false, pct).examStatus === 'BAN', '4 of 15 at 20% = BAN');
ok(fe.evaluateAttendanceRules(0, 20, 0, 0, false, pct).examStatus === 'OK', 'ABSENCES mode ignores score');

// 5. SCORE mode with custom scale.
const sc = { banMode: 'SCORE', baseScore: 100, deductA: 10, deductL: 5, deductE: 0, banScoreBelow: 50, warnScoreMargin: 10 };
ok(fe.evaluateAttendanceRules(0, 0, 0, 5, false, sc).examStatus === 'WARN', 'score 50 = WARN');
ok(fe.evaluateAttendanceRules(0, 0, 0, 6, false, sc).examStatus === 'BAN', 'score 40 = BAN');
ok(fe.evaluateAttendanceRules(0, 0, 9, 0, false, sc).attendanceScore === 100, 'E deduct 0');

// 6. Sanitizing garbage input.
const g = fe.normalizeAttendanceRules({ baseScore: 'abc', deductA: -5, banMode: 'x', banAbsences: Infinity, totalSessions: 99999 });
ok(g.baseScore === 10 && g.deductA === 0 && g.banMode === 'BOTH' && g.banAbsences === 6 && g.totalSessions === 200, 'normalize clamps garbage');

// 7. Preview lists only status changes.
const roster = [
  { studentId: 'A1', fullName: 'A', attendanceStats: { P: 5, L: 0, E: 0, A: 4 } },
  { studentId: 'B1', fullName: 'B', attendanceStats: { P: 5, L: 0, E: 0, A: 1 } }
];
const pv = fe.previewAttendanceRuleChange(roster, null, { banMode: 'ABSENCES', banAbsences: 3 });
ok(pv.length === 1 && pv[0].studentId === 'A1' && pv[0].to === 'BAN', 'preview shows only changed students');

// 8. Export/import round trip and rejection of foreign JSON.
const exp = fe.exportAttendanceRulesJson(sc, 'Lop X');
const imp = fe.parseAttendanceRulesJson(exp);
ok(imp && imp.rules.baseScore === 100 && imp.name === 'Lop X', 'export/import round trip');
ok(fe.parseAttendanceRulesJson('{"a":1}') === null && fe.parseAttendanceRulesJson('not json') === null, 'import rejects foreign json');

// 9. Preset list merge ignores duplicate ids.
ok(fe.mergeRulePresetList([{ id: 'iuh', label: { vi: 'x' } }, { id: 'abc', label: { vi: 'ABC' } }]).length === fe.BUILTIN_RULE_PRESETS.length + 1, 'preset merge dedupes by id');

// 9b. Accent-insensitive roster search helper.
{
  const src = fs.readFileSync(path.join(root, 'js', 'schedule-config.js'), 'utf8');
  const m = src.match(/function foldSearchText\(str\) \{[\s\S]*?\n\}/);
  ok(Boolean(m), 'foldSearchText exists');
  const c = vm.createContext({ String });
  vm.runInContext((m ? m[0] : '') + ';this.f = foldSearchText;', c);
  ok(c.f('Bảo').includes('ba') && c.f('Chiến') === 'chien' && c.f('Đặng Văn Ý') === 'dang van y', 'fold removes Vietnamese accents');
  ok(c.f('Bảo'.normalize('NFD')) === 'bao' && c.f('  MSSV01 ') === 'mssv01', 'fold handles NFD input, trim and case');
  ok(c.f('chie') && c.f('Chiến').includes(c.f('chie')), '"chie" finds Chiến');
}

// 9c. Strict validation before saving (typos must never become a punitive policy).
{
  const src = fs.readFileSync(path.join(root, 'js', 'attendance-rules.js'), 'utf8');
  const c = vm.createContext({ Object, String, Number, Array });
  vm.runInContext(src + ';this.v = validateAttendanceRules;', c);
  const good = Object.assign({}, fe.DEFAULT_ATTENDANCE_RULES);
  ok(c.v(good) === '', 'default rules are valid');
  ok(c.v(Object.assign({}, good, { banAbsences: -1 })) === 'banAbsences', 'negative threshold rejected (was clamped to 0 = ban on 1 absence)');
  ok(c.v(Object.assign({}, good, { totalSessions: '' })) === 'totalSessions', 'blank totalSessions rejected (was coerced to 1)');
  ok(c.v(Object.assign({}, good, { baseScore: 'abc' })) === 'baseScore' && c.v(Object.assign({}, good, { deductA: Infinity })) === 'deductA', 'non-numeric / infinite rejected');
  ok(c.v(Object.assign({}, good, { banMode: 'X' })) === 'banMode' && c.v(Object.assign({}, good, { banAbsUnit: '' })) === 'banAbsUnit', 'bad enums rejected');
  ok(c.v(null) === 'rules' && c.v(Object.assign({}, good, { warnScoreMargin: undefined })) === 'warnScoreMargin', 'missing fields rejected');
}

// 10. Backend parity (only once the backend copy exists).
const codeFile = fs.readdirSync(root).filter(f => /^code\d+\.\d+\.\d+\.text$/.test(f)).sort().pop();
const codeSrc = fs.readFileSync(path.join(root, codeFile), 'utf8');
if (/function evaluateAttendanceRules_\(/.test(codeSrc)) {
  const grab = name => {
    const i = codeSrc.indexOf('function ' + name);
    let depth = 0, j = codeSrc.indexOf('{', i);
    for (let k = j; k < codeSrc.length; k++) {
      if (codeSrc[k] === '{') depth++;
      else if (codeSrc[k] === '}' && --depth === 0) return codeSrc.slice(i, k + 1);
    }
    return '';
  };
  const dm = codeSrc.match(/const DEFAULT_ATTENDANCE_RULES_ = \{[\s\S]*?\};/);
  const be = vm.createContext({ Math, Number, String, JSON, Array, Object, Boolean });
  vm.runInContext([dm ? dm[0] : '', grab('clampRule_'), grab('normalizeAttendanceRules_'), grab('effectiveBanAbsences_'), grab('evaluateAttendanceRules_'),
    ';this.__api = { normalizeAttendanceRules_, evaluateAttendanceRules_ };'].join('\n'), be);
  const variants = [null, off, pct, sc, { banMode: 'BOTH', banAbsences: 4.5, deductE: 0.25, eToAbsence: 1 }, { banMode: 'SCORE', banScoreBelow: -2, warnScoreMargin: 0 }];
  let diff = 0;
  variants.forEach(v => {
    for (let A = 0; A <= 8; A++) for (let L = 0; L <= 8; L++) for (let E = 0; E <= 8; E++) for (const m of [false, true]) {
      const a = fe.evaluateAttendanceRules(3, L, E, A, m, v);
      const b = be.__api.evaluateAttendanceRules_(3, L, E, A, m, v);
      if (JSON.stringify(a) !== JSON.stringify(b)) diff++;
    }
  });
  ok(diff === 0, 'backend and frontend rules agree (diffs: ' + diff + ')');

  const rm = codeSrc.match(/const ATTENDANCE_RULE_RANGES_ = \{[\s\S]*?\};/);
  const bv = vm.createContext({ Object, String, Number, Array, isFinite });
  vm.runInContext((rm ? rm[0] : '') + '\n' + grab('validateAttendanceRules_') + ';this.v = validateAttendanceRules_;', bv);
  const fv = vm.createContext({ Object, String, Number, Array });
  vm.runInContext(fs.readFileSync(path.join(root, 'js', 'attendance-rules.js'), 'utf8') + ';this.v = validateAttendanceRules;', fv);
  const base = Object.assign({}, fe.DEFAULT_ATTENDANCE_RULES);
  const bad = [null, {}, Object.assign({}, base, { banAbsences: -1 }), Object.assign({}, base, { totalSessions: '' }), Object.assign({}, base, { baseScore: 'x' }),
    Object.assign({}, base, { banMode: 'Z' }), Object.assign({}, base, { deductL: 101 }), Object.assign({}, base, { banScoreBelow: -1001 }), base];
  ok(bad.every(b => bv.v(b) === fv.v(b)), 'backend and frontend validation agree');
  ok(codeSrc.indexOf('ERR_INVALID_RULES') > 0, 'backend rejects invalid rules instead of saving a clamped policy');
}

console.log(`test-attendance-rules: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
