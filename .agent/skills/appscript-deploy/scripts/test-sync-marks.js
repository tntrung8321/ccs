// Tests that Sync.gs reads date-column cells back using the lecturer's own mark settings (CUSTOM symbols/colors)
// and that the class schedule (day of week / periods) is detected from free-form header text.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..', '..', '..', '..');
const syncSrc = fs.readFileSync(path.join(root, 'sync.txt'), 'utf8');
let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('FAIL: ' + msg); } }

const props = {};
const ctx = vm.createContext({
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; } }) },
  CacheService: { getScriptCache: () => ({ get: () => null, put: () => {}, remove: () => {}, removeAll: () => {} }) },
  console
});
vm.runInContext(syncSrc, ctx);
const mark = (text, bg, style) => ctx.classifyMarkFromStyle_(String(text).toUpperCase(), bg, style);

const CENTER = { presentText: '', presentBg: '', lateText: '', lateBg: '#ffff00', excusedText: '', excusedBg: '#ff9900', absentText: 'x', absentBg: '' };
ok(mark('X', '#ffffff', CENTER) === 'A_MANUAL', 'CENTER: x = absent');
ok(mark('', '#ffff00', CENTER) === 'L', 'CENTER: yellow = late');
ok(mark('', '#ff9900', CENTER) === 'E', 'CENTER: orange = excused');
ok(mark('', '#ffffff', CENTER) === '', 'CENTER: blank white cell is not a mark (caller treats as present)');

const PLA = { presentText: 'P', presentBg: '', lateText: 'L', lateBg: '#ffff00', excusedText: 'E', excusedBg: '#ff9900', absentText: 'A', absentBg: '' };
ok(mark('p', '', PLA) === 'P' && mark('A', '', PLA) === 'A_MANUAL' && mark('e', '', PLA) === 'E' && mark('L', '', PLA) === 'L', 'PLA symbols read back (case-insensitive)');

// CUSTOM: words and colors outside the built-in yellow/orange families.
const CUSTOM = { presentText: 'CM', presentBg: '#00ff00', lateText: 'Trễ', lateBg: '#3366ff', excusedText: 'CP', excusedBg: '#9933cc', absentText: 'KP', absentBg: '#999999' };
ok(mark('KP', '', CUSTOM) === 'A_MANUAL', 'CUSTOM: "KP" reads as absent (used to be misread as present)');
ok(mark('trễ', '', CUSTOM) === 'L' && mark('cp', '', CUSTOM) === 'E' && mark('cm', '', CUSTOM) === 'P', 'CUSTOM: words read back');
ok(mark('', '#3366ff', CUSTOM) === 'L', 'CUSTOM: blue background = late (not in the yellow family)');
ok(mark('', '#9933CC', CUSTOM) === 'E' && mark('', '#999999', CUSTOM) === 'A_MANUAL', 'CUSTOM: purple = excused, grey = absent');
ok(mark('', 'FF3366FF', CUSTOM) === 'L' && mark('', '#36f', { lateBg: '#3366ff' }) === 'L', 'hex written as ARGB or short form still matches');
ok(mark('', '#ffffff', { absentBg: '#ffffff' }) === '', 'white background is never a mark');
ok(mark('', '#00ff00', CUSTOM) === '', 'a Present background alone does not create a mark');

// Legacy recognizers still work when nothing matches the configured style.
const legacy = ctx.classifySheetCellColor_;
ok(legacy('#ffe599') === 'YELLOW' && legacy('#f9cb9c') === 'ORANGE' && legacy('#ff0000') === 'RED', 'built-in colour families unchanged');

// Day of week / periods are read from free text, so the schedule cell can sit anywhere above the date row.
function schedule(text) {
  delete props.QR_CLASS_SCHEDULE_META_MAP;
  ctx.saveClassScheduleMetaFromSheet_('K1', text, []);
  const m = JSON.parse(props.QR_CLASS_SCHEDULE_META_MAP || '{}').K1 || {};
  return { dow: m.dayOfWeek, start: m.startPeriod, end: m.endPeriod };
}
let s = schedule('Lớp ABC | Thứ 3 | Tiết 123');
ok(s.dow === 2 && s.start === 1 && s.end === 3, 'Thứ 3 / Tiết 123');
s = schedule('Học vào T5, tiết 4-6');
ok(s.dow === 4 && s.start === 4 && s.end === 6, 'T5 / tiết 4-6');
s = schedule('Thursday period 7-9');
ok(s.dow === 4 && s.start === 7 && s.end === 9, 'Thursday / period 7-9');
s = schedule('Thu 2 | 456');
ok(s.dow === 1 && s.start === 4 && s.end === 6, 'Thu 2 (Thứ 2) / 456');
s = schedule('Chủ nhật');
ok(s.dow === 0, 'Chủ nhật = Sunday');

console.log(`test-sync-marks: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
