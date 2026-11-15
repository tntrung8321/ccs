/* CCS attendance rules: per-class scoring and exam-ban configuration.
   Backend (code*.text) keeps an identical copy of normalize/evaluate; test-core.js checks parity. */

const DEFAULT_ATTENDANCE_RULES = {
  version: 1,
  presetId: 'iuh',
  baseScore: 10,
  deductA: 1,
  deductL: 0.5,
  deductE: 0.5,
  eToAbsence: 0.5,
  banMode: 'BOTH',
  banAbsences: 6,
  banAbsUnit: 'COUNT',
  totalSessions: 30,
  banScoreBelow: 0,
  warnAbsMargin: 0.5,
  warnScoreMargin: 1
};

const BUILTIN_RULE_PRESETS = [
  {
    id: 'iuh',
    label: { vi: 'Chuyên cần – Đại học Công nghiệp TP.HCM (IUH)', en: 'Attendance – Industrial University of HCMC (IUH)' },
    note: { vi: 'Cộng đồng đóng góp, 11/2026. Hãy đối chiếu quy chế trường.', en: 'Community-contributed, 11/2026. Check your school policy.' },
    rules: {}
  },
  {
    id: 'none',
    label: { vi: 'Chỉ điểm danh, không cấm thi', en: 'Attendance only, no exam ban' },
    note: { vi: 'Vẫn tính điểm chuyên cần nhưng không hiện cảnh báo hay cấm thi.', en: 'Score is still computed; no warning or exam ban shown.' },
    rules: { banMode: 'OFF' }
  }
];

function arClamp_(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function normalizeAttendanceRules(raw) {
  const d = DEFAULT_ATTENDANCE_RULES;
  const r = (raw && typeof raw === 'object') ? raw : {};
  const modes = ['BOTH', 'ABSENCES', 'SCORE', 'OFF'];
  const mode = String(r.banMode || '').toUpperCase();
  const unit = String(r.banAbsUnit || '').toUpperCase();
  return {
    version: 1,
    presetId: String(r.presetId || d.presetId).slice(0, 40),
    baseScore: arClamp_(r.baseScore, 1, 1000, d.baseScore),
    deductA: arClamp_(r.deductA, 0, 100, d.deductA),
    deductL: arClamp_(r.deductL, 0, 100, d.deductL),
    deductE: arClamp_(r.deductE, 0, 100, d.deductE),
    eToAbsence: arClamp_(r.eToAbsence, 0, 5, d.eToAbsence),
    banMode: modes.indexOf(mode) >= 0 ? mode : d.banMode,
    banAbsences: arClamp_(r.banAbsences, 0, 1000, d.banAbsences),
    banAbsUnit: (unit === 'PERCENT' || unit === 'COUNT') ? unit : d.banAbsUnit,
    totalSessions: Math.round(arClamp_(r.totalSessions, 1, 200, d.totalSessions)),
    banScoreBelow: arClamp_(r.banScoreBelow, -1000, 1000, d.banScoreBelow),
    warnAbsMargin: arClamp_(r.warnAbsMargin, 0, 100, d.warnAbsMargin),
    warnScoreMargin: arClamp_(r.warnScoreMargin, 0, 1000, d.warnScoreMargin)
  };
}

function effectiveBanAbsences(rulesIn) {
  const r = normalizeAttendanceRules(rulesIn);
  const v = r.banAbsUnit === 'PERCENT' ? (r.totalSessions * r.banAbsences / 100) : r.banAbsences;
  return Math.round(v * 100) / 100;
}

function evaluateAttendanceRules(countP, countL, countE, countA, manualExamBan, rulesIn) {
  const r = normalizeAttendanceRules(rulesIn);
  const p = Number(countP || 0);
  const l = Number(countL || 0);
  const e = Number(countE || 0);
  const a = Number(countA || 0);
  const equivAbsences = Math.round((a + e * r.eToAbsence) * 100) / 100;
  const attendanceScore = Math.round((r.baseScore - a * r.deductA - l * r.deductL - e * r.deductE) * 100) / 100;
  const banAbs = effectiveBanAbsences(r);
  const useAbs = r.banMode === 'BOTH' || r.banMode === 'ABSENCES';
  const useScore = r.banMode === 'BOTH' || r.banMode === 'SCORE';
  const isBanned = Boolean(manualExamBan) ||
    (useAbs && equivAbsences > banAbs) ||
    (useScore && attendanceScore < r.banScoreBelow);
  const isWarn = !isBanned && (
    (useAbs && equivAbsences >= banAbs - r.warnAbsMargin && equivAbsences <= banAbs) ||
    (useScore && attendanceScore >= r.banScoreBelow && attendanceScore <= r.banScoreBelow + r.warnScoreMargin)
  );
  return {
    P: p, L: l, E: e, A: a,
    total: p + l + e + a,
    equivAbsences,
    attendanceScore,
    manualExamBan: Boolean(manualExamBan),
    examStatus: isBanned ? 'BAN' : (isWarn ? 'WARN' : 'OK')
  };
}

function previewAttendanceRuleChange(roster, oldRules, newRules) {
  const out = [];
  (Array.isArray(roster) ? roster : []).forEach(s => {
    const st = s && s.attendanceStats;
    if (!st) return;
    const before = evaluateAttendanceRules(st.P, st.L, st.E, st.A, st.manualExamBan, oldRules).examStatus;
    const after = evaluateAttendanceRules(st.P, st.L, st.E, st.A, st.manualExamBan, newRules).examStatus;
    if (before !== after) out.push({ studentId: s.studentId, fullName: s.fullName, from: before, to: after });
  });
  return out;
}

function exportAttendanceRulesJson(rulesIn, name) {
  return JSON.stringify({ ccsRules: 1, name: String(name || ''), rules: normalizeAttendanceRules(rulesIn) }, null, 2);
}

function parseAttendanceRulesJson(text) {
  let obj;
  try { obj = JSON.parse(String(text || '')); } catch (e) { return null; }
  if (!obj || obj.ccsRules !== 1 || !obj.rules || typeof obj.rules !== 'object') return null;
  return { name: String(obj.name || '').slice(0, 120), rules: normalizeAttendanceRules(obj.rules) };
}

function mergeRulePresetList(extra) {
  const list = BUILTIN_RULE_PRESETS.slice();
  (Array.isArray(extra) ? extra : []).forEach(p => {
    if (!p || !p.id || !p.label || list.some(x => x.id === p.id)) return;
    list.push({ id: String(p.id), label: p.label, note: p.note || {}, rules: (p.rules && typeof p.rules === 'object') ? p.rules : {} });
  });
  return list;
}

function describeAttendanceRules(rulesIn, isEn) {
  const r = normalizeAttendanceRules(rulesIn);
  const ban = effectiveBanAbsences(r);
  if (r.banMode === 'OFF') return isEn ? `Score ${r.baseScore} · no exam ban` : `Điểm gốc ${r.baseScore} · không cấm thi`;
  const parts = [];
  if (r.banMode !== 'SCORE') parts.push(isEn ? `ban above ${ban} absences` : `cấm thi khi vắng quá ${ban} buổi quy đổi`);
  if (r.banMode !== 'ABSENCES') parts.push(isEn ? `score below ${r.banScoreBelow}` : `điểm dưới ${r.banScoreBelow}`);
  return (isEn ? `Score ${r.baseScore} · ` : `Điểm gốc ${r.baseScore} · `) + parts.join(isEn ? ' or ' : ' hoặc ');
}
