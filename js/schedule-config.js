/**
 * ============================================================================
 * 0. MASTER SHEET CONNECTION SETTINGS & SCHEDULE ENGINE (v3.6.5)
 * ============================================================================
 */
const DEFAULT_LECTURER_API = 'https://script.google.com/macros/s/AKfycbyzXVAiaDpcvV4e8upgie6-yM_p7GOgjF5RhP3wmii6Hnx4s5xQZaPweZiPtbBYpO8q/exec';
const LEGACY_LECTURER_APIS = [
  'https://script.google.com/macros/s/AKfycbzZjnmd3XzGpdccZLPKzxRy84V9KTE8rdI3Y7oSFbZTfv_Fo9sfGbMDHmoG7_4itfmX/exec',
  'https://script.google.com/macros/s/AKfycbyoCPCVBPRuFgm82lwl090wLHgj-UPfj_GTH8EgOjaM_zQZ8OY22V19f1S1FS7KT-oH/exec',
  'https://script.google.com/macros/s/AKfycbxc9TUVcoQ9BFtcXl9_lSvI5c1AntDOn56DwpsDtDiK9p5P8blbutJmgLq_mHEJGWT2/exec',
  'https://script.google.com/macros/s/AKfycbwbpZhoQtQJjPhvmsVg8vNxhPL4v2bcXDWUewxSIlMgf8iGq75lr6vzZZwVMiQ-YaS7/exec',
  'https://script.google.com/macros/s/AKfycbzuSyHCUnHiMsLr6r-VEfPK8ghEHiWO0109azkoo1VstAMhfoBQ9v1agRj3gsHNXIw/exec',
  'https://script.google.com/macros/s/AKfycbz01o_3_O5PxuDq9V8uQ0cJy1ahCgEcM_QSlgNHLvkD8awXq0QCnf3HmoSRQl4PxBQM/exec'
];
const DEFAULT_LECTURER_NAME = 'Tran Nguyen Trung';
const DEFAULT_INST_ID = 'INST_KfweyxZcv4';

const KNOWN_CLASS_SECRETS = {
  '2610AVCB002': 'QR_2610AVCB002_CBGPRO',
  '2610AVCB003': 'QR_2610AVCB003_GJOEZR',
  '2610AVCB004': 'QR_2610AVCB004_DKH8QE'
};

const REMOVED_SAMPLE_CLASSES = ['ENG101_G1'];

/**
 * Early recognition buffer: allows auto-selecting a class 15 minutes before its start time.
 */
const SCHEDULE_EARLY_BUFFER_MINS = 15;

/**
 * Standard University Period Time Slots:
 *  - Tiết 123 (1-3):   06:30 - 09:00
 *  - Tiết 456 (4-6):   09:00 - 11:30
 *  - Tiết 789 (7-9):   12:30 - 15:00
 *  - Tiết 10-12:       15:00 - 17:30
 *  - Tiết 13-15:       17:30 - 20:00
 *  - Tiết 16-18:       20:00 - 22:30
 * Formula: Each period is 50 mins (3 periods = 150 mins = 2h30m).
 * Morning starts at 06:30 (390m); Afternoon/Evening starts at 12:30 (750m).
 */
const PERIOD_SLOTS_MAP = {
  '123':    { startPeriod: 1,  endPeriod: 3,  startTime: '06:30', endTime: '09:00', label: 'Tiết 1-3 (06:30 - 09:00)' },
  '1-3':    { startPeriod: 1,  endPeriod: 3,  startTime: '06:30', endTime: '09:00', label: 'Tiết 1-3 (06:30 - 09:00)' },
  '456':    { startPeriod: 4,  endPeriod: 6,  startTime: '09:00', endTime: '11:30', label: 'Tiết 4-6 (09:00 - 11:30)' },
  '4-6':    { startPeriod: 4,  endPeriod: 6,  startTime: '09:00', endTime: '11:30', label: 'Tiết 4-6 (09:00 - 11:30)' },
  '789':    { startPeriod: 7,  endPeriod: 9,  startTime: '12:30', endTime: '15:00', label: 'Tiết 7-9 (12:30 - 15:00)' },
  '7-9':    { startPeriod: 7,  endPeriod: 9,  startTime: '12:30', endTime: '15:00', label: 'Tiết 7-9 (12:30 - 15:00)' },
  '101112': { startPeriod: 10, endPeriod: 12, startTime: '15:00', endTime: '17:30', label: 'Tiết 10-12 (15:00 - 17:30)' },
  '10-12':  { startPeriod: 10, endPeriod: 12, startTime: '15:00', endTime: '17:30', label: 'Tiết 10-12 (15:00 - 17:30)' },
  '131415': { startPeriod: 13, endPeriod: 15, startTime: '17:30', endTime: '20:00', label: 'Tiết 13-15 (17:30 - 20:00)' },
  '13-15':  { startPeriod: 13, endPeriod: 15, startTime: '17:30', endTime: '20:00', label: 'Tiết 13-15 (17:30 - 20:00)' },
  '161718': { startPeriod: 16, endPeriod: 18, startTime: '20:00', endTime: '22:30', label: 'Tiết 16-18 (20:00 - 22:30)' },
  '16-18':  { startPeriod: 16, endPeriod: 18, startTime: '20:00', endTime: '22:30', label: 'Tiết 16-18 (20:00 - 22:30)' }
};

/**
 * Fallback / Local Class Schedule Configuration (`CLASS_SCHEDULE`).
 * Supports either `periods` ('123', '456', '789', '10-12', '13-15') or explicit `startTime`/`endTime`.
 * Note: Live Google Calendar events & Attendance Sheet period/date metadata automatically take priority when available.
 */
const CLASS_SCHEDULE = [
  {
    classId: '2610AVCB002',
    aliases: ['AVCB 002', 'AVCB002', '2610AVCB002'],
    daysOfWeek: [1, 5], // Thứ 2 & Thứ 6 (0 = CN, 1 = Thứ 2, ..., 6 = Thứ 7)
    dayOfWeek: 1,
    periods: '10-12',
    startTime: '15:00',
    endTime: '17:30',
    sessionDates: [
      '2026-10-23', '2026-10-26', '2026-10-30', '2026-11-02', '2026-11-06', '2026-11-09',
      '2026-11-13', '2026-11-16', '2026-11-20', '2026-11-23', '2026-11-27', '2026-11-30',
      '2026-12-04', '2026-12-07', '2026-12-11', '2026-12-14', '2026-12-18', '2026-12-21',
      '2026-12-25', '2026-12-28', '2027-01-01', '2027-01-04', '2027-01-08', '2027-01-11',
      '2027-01-15', '2027-01-18', '2027-01-22', '2027-01-25', '2027-01-29', '2027-02-01'
    ]
  },
  {
    classId: '2610AVCB003',
    aliases: ['AVCB 003', 'AVCB003', '2610AVCB003'],
    daysOfWeek: [1, 5], // Thứ 2 & Thứ 6
    dayOfWeek: 1,
    periods: '13-15',
    startTime: '17:30',
    endTime: '20:00',
    sessionDates: [
      '2026-10-19', '2026-10-23', '2026-10-26', '2026-10-30', '2026-11-02', '2026-11-06',
      '2026-11-09', '2026-11-13', '2026-11-16', '2026-11-20', '2026-11-23', '2026-11-27',
      '2026-11-30', '2026-12-04', '2026-12-07', '2026-12-11', '2026-12-14', '2026-12-18',
      '2026-12-21', '2026-12-25', '2026-12-28', '2027-01-01', '2027-01-04', '2027-01-08',
      '2027-01-11', '2027-01-15', '2027-01-18', '2027-01-22', '2027-01-25', '2027-01-29'
    ]
  },
  {
    classId: '2610AVCB004',
    aliases: ['AVCB 004', 'AVCB004', '2610AVCB004'],
    daysOfWeek: [2, 4], // Thứ 3 & Thứ 5
    dayOfWeek: 2,
    periods: '10-12',
    startTime: '15:00',
    endTime: '17:30',
    sessionDates: [
      '2026-10-20', '2026-10-22', '2026-10-27', '2026-10-29', '2026-11-03', '2026-11-05',
      '2026-11-10', '2026-11-12', '2026-11-17', '2026-11-19', '2026-11-24', '2026-11-26',
      '2026-12-01', '2026-12-03', '2026-12-08', '2026-12-10', '2026-12-15', '2026-12-17',
      '2026-12-22', '2026-12-24', '2026-12-29', '2026-12-31', '2027-01-05', '2027-01-07',
      '2027-01-12', '2027-01-14', '2027-01-19', '2027-01-21', '2027-01-26', '2027-01-28'
    ]
  }
];

// Stores live schedule metadata fetched from Backend (Google Calendar + Sheet Period Info)
window.liveServerSchedule = {
  updatedAt: 0,
  calendarEvents: [],
  classSchedules: {}
};

function getClassCourseSessionDates(classId, scheduleInfo) {
  const cid = String(classId || '').trim();
  const meta =
    scheduleInfo ||
    (window.liveServerSchedule && window.liveServerSchedule.classSchedules && window.liveServerSchedule.classSchedules[cid]) ||
    null;

  const localEntry = CLASS_SCHEDULE.find(e => e.classId === cid || (e.aliases || []).includes(cid));
  let rawDates = (meta && Array.isArray(meta.sessionDates) && meta.sessionDates.length > 0)
    ? meta.sessionDates
    : (localEntry && Array.isArray(localEntry.sessionDates) ? localEntry.sessionDates : []);

  if (!rawDates || rawDates.length === 0) return [];

  const out = [];
  let runningYear = 2026;
  let prevMonth = null;

  rawDates.forEach((raw, idx) => {
    const s = String(raw || '').trim();
    if (!s) return;
    let y = null, m = null, d = null;
    const mIso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (mIso) {
      y = parseInt(mIso[1], 10);
      m = parseInt(mIso[2], 10);
      d = parseInt(mIso[3], 10);
      runningYear = y;
      prevMonth = m;
    } else {
      const mDm = s.match(/^(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?$/);
      if (mDm) {
        d = parseInt(mDm[1], 10);
        m = parseInt(mDm[2], 10);
        if (mDm[3]) {
          y = parseInt(mDm[3], 10);
          if (y < 100) y += 2000;
          runningYear = y;
        } else {
          if (prevMonth !== null && m < prevMonth && (prevMonth - m) >= 6) {
            runningYear++;
          }
          y = runningYear;
        }
        prevMonth = m;
      }
    }
    if (y && m && d) {
      const dd = String(d).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      out.push({
        sessionNumber: idx + 1,
        dayKey: `${y}-${mm}-${dd}`,
        displayDate: `${dd}/${mm}/${y}`,
        shortDate: `${dd}/${mm}`
      });
    }
  });

  return out;
}

function minsToHhMm(totalMins) {
  const clamped = Math.max(0, Math.min(1439, Math.round(totalMins)));
  const h = String(Math.floor(clamped / 60)).padStart(2, '0');
  const m = String(clamped % 60).padStart(2, '0');
  return `${h}:${m}`;
}

function parseHhMmToMins(hhmm) {
  if (!hhmm) return null;
  const m = String(hhmm).trim().match(/^(\d{1,2})[:h](\d{2})$/i);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Calculates exact [startTime, endTime] from any startPeriod..endPeriod:
 *  - Morning (period 1..6): base 06:30 (390 mins), +50 mins per period
 *  - Afternoon/Evening (period >= 7): base 12:30 (750 mins), +50 mins per period
 */
function getTimeWindowFromPeriodNumbers(startPeriod, endPeriod) {
  const s = Number(startPeriod);
  const e = Number(endPeriod || startPeriod);
  if (isNaN(s) || s < 1 || e < s || e > 20) return null;

  const startMins = s <= 6 ? 390 + (s - 1) * 50 : 750 + (s - 7) * 50;
  const endMins = e <= 6 ? 390 + e * 50 : 750 + (e - 6) * 50;
  const startTime = minsToHhMm(startMins);
  const endTime = minsToHhMm(endMins);

  const isEn = typeof currentLang !== 'undefined' && currentLang === 'en';
  return {
    startPeriod: s,
    endPeriod: e,
    startTime,
    endTime,
    startMins,
    endMins,
    label: isEn ? `Periods ${s}-${e} (${startTime} - ${endTime})` : `Tiết ${s}-${e} (${startTime} - ${endTime})`
  };
}

/**
 * Parses period notation from a code or text string:
 * Supports "123", "456", "789", "101112", "131415", "1-3", "Tiết 7-9", "Tiết 123", "Ca 1".."Ca 5".
 */
function parsePeriodSlotFromText(rawText) {
  if (!rawText) return null;
  const clean = String(rawText).trim();
  if (PERIOD_SLOTS_MAP[clean]) {
    const slot = PERIOD_SLOTS_MAP[clean];
    return getTimeWindowFromPeriodNumbers(slot.startPeriod, slot.endPeriod);
  }

  // Match contiguous digit groups like "123", "456", "789", "101112", "131415"
  const compactMatch = clean.match(/(?:ti[eế]t|t|ca|periods?)?\s*\b(123|456|789|101112|131415|161718)\b/i);
  if (compactMatch && PERIOD_SLOTS_MAP[compactMatch[1]]) {
    const slot = PERIOD_SLOTS_MAP[compactMatch[1]];
    return getTimeWindowFromPeriodNumbers(slot.startPeriod, slot.endPeriod);
  }

  // Match range like "Tiết 1-3", "Tiết 7 - 9", "T10-12", "13-15"
  const rangeMatch = clean.match(/(?:ti[eế]t|t|periods?)?\s*\b(\d{1,2})\s*[-–→to]\s*(\d{1,2})\b/i);
  if (rangeMatch) {
    const sp = parseInt(rangeMatch[1], 10);
    const ep = parseInt(rangeMatch[2], 10);
    if (sp >= 1 && ep >= sp && ep <= 18 && (ep - sp) <= 6) {
      return getTimeWindowFromPeriodNumbers(sp, ep);
    }
  }

  // Match "Ca 1" .. "Ca 5"
  const shiftMatch = clean.match(/\bca\s*([1-6])\b/i);
  if (shiftMatch) {
    const ca = parseInt(shiftMatch[1], 10);
    const sp = (ca - 1) * 3 + 1;
    return getTimeWindowFromPeriodNumbers(sp, sp + 2);
  }

  return null;
}

/**
 * Parses all days of week (0 = Sunday .. 6 = Saturday) from Vietnamese or English text.
 * Supports multi-day patterns such as "T2&6", "T2&T6", "T3&T5", "Thứ 2 & 6", "T2,4,6", "T2-T6".
 */
function parseDaysOfWeekFromText(rawText) {
  if (!rawText) return [];
  const s = String(rawText);
  const days = [];
  const addDay = d => {
    if (typeof d === 'number' && d >= 0 && d <= 6 && !days.includes(d)) {
      days.push(d);
    }
  };

  const thuRegex = /(?:^|[\s,;|(\[/])(?:th[uứ]\s*|t)([2-7](?:\s*(?:[&,+]\s*(?:th[uứ]\s*|t)?|[-–]\s*(?:th[uứ]\s*|t))[2-7])*)\b(?!\s*[-–→to]\s*\d)/ig;
  let m;
  while ((m = thuRegex.exec(s)) !== null) {
    const digits = m[1].match(/[2-7]/g) || [];
    digits.forEach(d => addDay(parseInt(d, 10) - 1)); // Thứ 2 -> 1, Thứ 7 -> 6
  }

  if (/\b(ch[uủ]\s*nh[aậ]t|cn|sunday|sun)\b/i.test(s)) addDay(0);
  if (/\b(monday|mon)\b/i.test(s)) addDay(1);
  if (/\b(tuesday|tue)\b/i.test(s)) addDay(2);
  if (/\b(wednesday|wed)\b/i.test(s)) addDay(3);
  if (/\b(thursday|thu)\b/i.test(s)) addDay(4);
  if (/\b(friday|fri)\b/i.test(s)) addDay(5);
  if (/\b(saturday|sat)\b/i.test(s)) addDay(6);

  return days;
}

/**
 * Parses the first day of week (0 = Sunday .. 6 = Saturday) from Vietnamese or English text.
 */
function parseDayOfWeekFromText(rawText) {
  const days = parseDaysOfWeekFromText(rawText);
  return days.length > 0 ? days[0] : null;
}

function normalizeClassCodeKey(str) {
  return String(str || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function doesClassMatchIdentifier(classObj, targetIdOrAlias) {
  if (!classObj || !targetIdOrAlias) return false;
  const cidNorm = normalizeClassCodeKey(classObj.classId);
  const cnameNorm = normalizeClassCodeKey(classObj.className);
  const targetNorm = normalizeClassCodeKey(targetIdOrAlias);
  if (!targetNorm) return false;
  if (cidNorm === targetNorm || cnameNorm === targetNorm) return true;
  if (cidNorm.endsWith(targetNorm) || targetNorm.endsWith(cidNorm)) return true;
  if (cnameNorm.includes(targetNorm)) return true;
  return false;
}

/**
 * Updates live schedule information returned by Backend (Google Calendar + Sheet metadata).
 */
function ingestServerScheduleData(res) {
  if (!res) return;
  if (Array.isArray(res.calendarEvents)) {
    window.liveServerSchedule.calendarEvents = res.calendarEvents;
    window.liveServerSchedule.updatedAt = Date.now();
  }
  if (res.classSchedules && typeof res.classSchedules === 'object') {
    window.liveServerSchedule.classSchedules = Object.assign(
      {},
      window.liveServerSchedule.classSchedules,
      res.classSchedules
    );
  }
  if (Array.isArray(res.classes)) {
    res.classes.forEach(c => {
      if (c && c.classId && c.scheduleInfo) {
        window.liveServerSchedule.classSchedules[c.classId] = c.scheduleInfo;
      }
    });
  }
}

/**
 * Resolves which class should be auto-selected right now based on:
 *  1. Currently open attendance session (`isOpen`)
 *  2. Google Calendar live events for today (with 15-min early buffer)
 *  3. Period / Day metadata extracted from Attendance Sheet or `Class_Name` (123, 456, 789, 10-12, 13-15)
 *  4. Local `CLASS_SCHEDULE` configuration (with 15-min early buffer)
 * Returns `{ matchedClassId, matchedClass, source, label, isOffHours }`.
 */
function resolveActiveClassBySchedule(availableClasses, now = new Date()) {
  const list = (availableClasses || []).filter(
    c => c && c.classId && !REMOVED_SAMPLE_CLASSES.includes(String(c.classId).trim().toUpperCase())
  );
  if (list.length === 0) {
    return { matchedClassId: '', matchedClass: null, source: 'EMPTY', label: '', isOffHours: true };
  }

  const currentDay = now.getDay(); // 0..6
  const currentMins = now.getHours() * 60 + now.getMinutes();
  const todayDdMm = `${now.getDate()}/${now.getMonth() + 1}`;

  // Priority 0: Any class with an actively open attendance session right now
  const openClass = list.find(c => Boolean(c.sessionOpenNow));
  if (openClass) {
    return {
      matchedClassId: openClass.classId,
      matchedClass: openClass,
      source: 'OPEN_SESSION',
      label: currentLang === 'en'
        ? `${openClass.classId} — Attendance session is open`
        : `${openClass.classId} — Đang mở phiên điểm danh`,
      isOffHours: false
    };
  }

  // Priority 1: Live Google Calendar Events from Backend
  const calEvents = (window.liveServerSchedule && window.liveServerSchedule.calendarEvents) || [];
  for (let i = 0; i < calEvents.length; i++) {
    const ev = calEvents[i];
    const startMins = parseHhMmToMins(ev.startTime);
    const endMins = parseHhMmToMins(ev.endTime);
    if (startMins !== null && endMins !== null) {
      if (currentMins >= (startMins - SCHEDULE_EARLY_BUFFER_MINS) && currentMins <= endMins) {
        const matched = list.find(
          c => doesClassMatchIdentifier(c, ev.classId) || doesClassMatchIdentifier(c, ev.title)
        );
        if (matched) {
          return {
            matchedClassId: matched.classId,
            matchedClass: matched,
            source: 'GOOGLE_CALENDAR',
            label: currentLang === 'en'
              ? `Google Calendar: ${matched.classId} (${ev.startTime} - ${ev.endTime})`
              : `Lịch Google Calendar: ${matched.classId} (${ev.startTime} - ${ev.endTime})`,
            isOffHours: false
          };
        }
      }
    }
  }

  // Priority 2: Attendance Sheet Metadata / Class_Name Period & Date Detection (123, 456, 789, 10-12, 13-15)
  const sheetMatches = [];
  for (let i = 0; i < list.length; i++) {
    const cls = list[i];
    const meta =
      cls.scheduleInfo ||
      (window.liveServerSchedule.classSchedules && window.liveServerSchedule.classSchedules[cls.classId]) ||
      null;

    const combinedText = [
      cls.className || '',
      meta && meta.rawText ? meta.rawText : '',
      meta && meta.periods ? String(meta.periods) : ''
    ].join(' ');

    const periodWindow =
      (meta && meta.startPeriod ? getTimeWindowFromPeriodNumbers(meta.startPeriod, meta.endPeriod) : null) ||
      parsePeriodSlotFromText(combinedText);

    if (periodWindow) {
      const parsedDaysSet = new Set();
      if (meta && Array.isArray(meta.daysOfWeek)) {
        meta.daysOfWeek.forEach(d => {
          if (typeof d === 'number') parsedDaysSet.add(d);
        });
      }
      if (meta && typeof meta.dayOfWeek === 'number') {
        parsedDaysSet.add(meta.dayOfWeek);
      }
      parseDaysOfWeekFromText(combinedText).forEach(d => parsedDaysSet.add(d));
      const parsedDays = Array.from(parsedDaysSet);

      const todayIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const todayPadDdMm = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}`;
      const hasTodayInAttendanceSheet =
        meta &&
        Array.isArray(meta.sessionDates) &&
        (meta.sessionDates.includes(todayDdMm) || meta.sessionDates.includes(todayPadDdMm) || meta.sessionDates.includes(todayIso));

      const dayMatches =
        hasTodayInAttendanceSheet ||
        (parsedDays.length > 0 && parsedDays.includes(currentDay)) ||
        (parsedDays.length === 0 && (!meta || !meta.sessionDates));

      if (
        dayMatches &&
        currentMins >= (periodWindow.startMins - SCHEDULE_EARLY_BUFFER_MINS) &&
        currentMins <= periodWindow.endMins
      ) {
        sheetMatches.push({
          matchedClassId: cls.classId,
          matchedClass: cls,
          source: 'SHEET_PERIODS',
          label: `${cls.classId} — ${periodWindow.label}`,
          isOffHours: false,
          startMins: periodWindow.startMins,
          endMins: periodWindow.endMins,
          isStartingWindow: currentMins >= (periodWindow.startMins - SCHEDULE_EARLY_BUFFER_MINS) && currentMins < periodWindow.startMins,
          isEndingWindow: currentMins >= (periodWindow.endMins - SCHEDULE_EARLY_BUFFER_MINS)
        });
      }
    }
  }

  if (sheetMatches.length > 0) {
    sheetMatches.sort((a, b) => {
      if (a.isEndingWindow !== b.isEndingWindow) return a.isEndingWindow ? 1 : -1;
      if (a.isStartingWindow !== b.isStartingWindow) return a.isStartingWindow ? -1 : 1;
      return b.startMins - a.startMins;
    });
    const best = sheetMatches[0];
    return {
      matchedClassId: best.matchedClassId,
      matchedClass: best.matchedClass,
      source: best.source,
      label: best.label,
      isOffHours: false
    };
  }

  // Priority 3: Local CLASS_SCHEDULE Array (Supports `periods: '123' | '456' | '789' | '10-12' | '13-15'` or startTime/endTime)
  const scheduleMatches = [];
  for (let i = 0; i < CLASS_SCHEDULE.length; i++) {
    const entry = CLASS_SCHEDULE[i];
    const entryDays = Array.isArray(entry.daysOfWeek)
      ? entry.daysOfWeek
      : (typeof entry.dayOfWeek === 'number' ? [entry.dayOfWeek] : []);
    if (entryDays.length > 0 && !entryDays.includes(currentDay)) continue;

    let startMins = parseHhMmToMins(entry.startTime);
    let endMins = parseHhMmToMins(entry.endTime);
    let slotLabel = `${entry.startTime} - ${entry.endTime}`;

    if (entry.periods) {
      const pWin = parsePeriodSlotFromText(entry.periods);
      if (pWin) {
        startMins = pWin.startMins;
        endMins = pWin.endMins;
        slotLabel = pWin.label;
      }
    }

    if (startMins !== null && endMins !== null) {
      if (currentMins >= (startMins - SCHEDULE_EARLY_BUFFER_MINS) && currentMins <= endMins) {
        const candidates = [entry.classId].concat(entry.aliases || []);
        const matched = list.find(c => candidates.some(alias => doesClassMatchIdentifier(c, alias)));
        if (matched) {
          scheduleMatches.push({
            matchedClassId: matched.classId,
            matchedClass: matched,
            source: 'CLASS_SCHEDULE',
            label: `${matched.classId} — ${slotLabel}`,
            isOffHours: false,
            startMins,
            endMins,
            isStartingWindow: currentMins >= (startMins - SCHEDULE_EARLY_BUFFER_MINS) && currentMins < startMins,
            isEndingWindow: currentMins >= (endMins - SCHEDULE_EARLY_BUFFER_MINS)
          });
        }
      }
    }
  }

  if (scheduleMatches.length > 0) {
    scheduleMatches.sort((a, b) => {
      if (a.isEndingWindow !== b.isEndingWindow) return a.isEndingWindow ? 1 : -1;
      if (a.isStartingWindow !== b.isStartingWindow) return a.isStartingWindow ? -1 : 1;
      return b.startMins - a.startMins;
    });
    const best = scheduleMatches[0];
    return {
      matchedClassId: best.matchedClassId,
      matchedClass: best.matchedClass,
      source: best.source,
      label: best.label,
      isOffHours: false
    };
  }

  return {
    matchedClassId: '',
    matchedClass: null,
    source: 'OFF_HOURS',
    label: currentLang === 'en' ? 'Off-schedule — Select class manually' : 'Ngoài giờ lịch — Chọn lớp thủ công',
    isOffHours: true
  };
}

/**
 * ============================================================================
 * 1. BILINGUAL DICTIONARY (VI / EN) — ZERO EMOJI, PROFESSIONAL TECHNICAL UI
 * ============================================================================
 */
const I18N = {
  vi: {
    nav_student: "Sinh viên",
    nav_teacher: "Giảng viên",
    cam_modal_title: "Quét mã QR",
    stu_course_title: "Thông tin Sinh viên",
    stu_add_course_btn: "Đổi mã số sinh viên",
    stu_select_lecturer: "Giảng viên:",
    stu_select_class: "Lớp học phần:",
    stu_unselected_class_opt: "-- Chưa chọn lớp - Ngoài khung giờ --",
    stu_no_course_desc: "Nhập mã số sinh viên để liên kết lớp học (chỉ cần thực hiện 1 lần đầu học kỳ).",
    stu_scan_onboard_qr: "Quét mã QR Khóa học",
    stu_toggle_api_link: "Cài đặt kết nối nâng cao",
    stu_api_url_label: "Đường dẫn máy chủ (Web App URL):",
    stu_id_label: "Mã số sinh viên:",
    stu_id_placeholder: "Nhập mã số sinh viên...",
    stu_register_btn: "Lưu và Liên kết thiết bị",
    stu_checkin_title: "Điểm danh Lớp học",
    stu_gps_readout_idle: "Chưa kiểm tra GPS",
    stu_btn_check_gps: "Kiểm tra GPS",
    btn_cancel_scan: "Đóng",
    modal_confirm_title: "Xác nhận",
    modal_confirm_btn: "Đồng ý",
    stu_one_tap_checkin_btn: "ĐIỂM DANH NGAY",
    stu_submitting_btn: "Đang gửi dữ liệu...",
    tea_login_title: "Đăng nhập Giảng viên",
    tea_login_desc: "Nhập mã phiên 6 chữ số trên Google Sheet hoặc khóa chính (Master Key).",
    tea_scan_pair_qr: "Quét mã QR Ghép nối",
    tea_config_url_link: "Cấu hình đường dẫn kết nối",
    tea_reset_url_btn: "Khôi phục đường dẫn mặc định",
    tea_api_url_label: "Đường dẫn máy chủ (Ô B4 trên Google Sheet):",
    tea_token_label: "Mã phiên (6 chữ số) hoặc Khóa chính (Master Key):",
    tea_token_placeholder: "Nhập mã phiên 6 chữ số hoặc Master Key...",
    tea_session_type_label: "Chế độ lưu đăng nhập:",
    tea_persist_phone: "Thiết bị cá nhân của Giảng viên (Giữ đăng nhập)",
    tea_persist_pc: "Máy tính phòng học (Tự động đăng xuất sau 60 phút)",
    tea_login_btn: "Đăng nhập Giảng viên",
    tea_panel1_title: "1. Điều khiển Phiên điểm danh",
    tea_fullscreen_btn: "Toàn màn hình",
    tea_select_class: "Lớp học phần đang điều khiển:",
    tea_unselected_class_opt: "-- Chưa chọn lớp - Ngoài khung giờ --",
    tea_open_trigger_btn: "Mở phiên điểm danh",
    tea_confirm_open_prompt: "Xác nhận mở phiên điểm danh cho lớp học phần này?",
    tea_confirm_open_btn: "Xác nhận mở phiên",
    tea_cancel_open_btn: "Hủy",
    tea_adv_gps_link: "Chế độ định vị GPS nâng cao",
    tea_adv_gps_label: "Sử dụng định vị GPS của sinh viên (Lấy trung bình vị trí 3 sinh viên đầu tiên làm tâm phòng học)",
    tea_extend_btn: "+2 Phút",
    tea_reopen_btn: "Mở lại 5 phút",
    tea_close_btn: "Đóng phiên",
    tea_panel2_title: "2. Danh sách Sinh viên",
    tea_spot_check_btn: "Gọi ngẫu nhiên",
    tea_group_maker_btn: "Chia nhóm",
    tea_history_btn: "Lịch sử",
    tea_show_hide_names: "Ẩn/Hiện tên",
    tea_search_placeholder: "Tìm họ tên hoặc mã số sinh viên (Nhấn Enter để đánh dấu Có mặt)...",
    tea_panel4_title: "3. Quản trị và Đồng bộ dữ liệu",
    tea_rebuild_sheet_btn: "Đồng bộ Sheet",
    tea_logout_btn: "Đăng xuất",
    ONBOARD_CONFIRMED: "[HOÀN TẤT] Đã liên kết sinh viên: {name} ({id}).",
    CONFIRMED_PRESENT: "[THÀNH CÔNG] Ghi nhận CÓ MẶT lúc {time} (Khoảng cách: {dist}m).",
    CONFIRMED_LATE: "[THÀNH CÔNG] Ghi nhận ĐI TRỄ lúc {time} (Khoảng cách: {dist}m).",
    ALREADY_RECORDED: "[ĐÃ GHI NHẬN] Bạn đã điểm danh buổi này rồi (Trạng thái: {status} lúc {time}).",
    ERR_NOT_ON_ROSTER: "[LỖI] Không tìm thấy mã số sinh viên {id} trong danh sách lớp.",
    ERR_DEVICE_BOUND_OTHER: "[KHÓA THIẾT BỊ] Trình duyệt này đã được gắn cố định với một MSSV khác.",
    ERR_CREDENTIAL_MISMATCH: "[SAI THIẾT BỊ] Thiết bị/trình duyệt không khớp với đăng ký gốc của MSSV {id}. Vui lòng báo Giảng viên mở khóa nếu đổi điện thoại.",
    ERR_REG_LOCKED: "[ĐANG KHÓA] Giảng viên hiện đang khóa cổng đăng ký thiết bị mới.",
    ERR_SESSION_CLOSED: "[ĐANG ĐÓNG] Cổng điểm danh của lớp này hiện đang đóng.",
    ERR_INVALID_QR: "[LỖI] Mã phiên điểm danh không hợp lệ.",
    ERR_LOCATION_OUT_OF_RANGE: "[NGOÀI PHẠM VI] Bạn đang cách tâm phòng học {dist}m (Cho phép tối đa {max}m). Vui lòng di chuyển vào lớp và thử lại.",
    ERR_GPS_UNAVAILABLE: "[LỖI TÍN HIỆU GPS] Trình duyệt đã có quyền Vị trí nhưng điện thoại chưa bắt được sóng định vị trong phòng. Vui lòng bật biểu tượng Wi-Fi (để hỗ trợ định vị trong nhà) và bật Dịch vụ định vị trên điện thoại rồi bấm lại.",
    ERR_SERVER_BUSY: "Hệ thống đang xử lý, vui lòng chờ giây lát...",
    ERR_UNAUTHORIZED: "[TỪ CHỐI] Mật khẩu phiên không đúng hoặc đã hết hạn. Hãy kiểm tra lại ô C9 trên Google Sheet.",
    DEVICE_RESET_OK: "[ĐÃ MỞ KHÓA] Đã đặt lại khóa thiết bị cho sinh viên {id}.",
    btn_open_external_browser: "Mở ngay bằng trình duyệt chính",
    btn_copy_browser_url: "Sao chép link mở Safari / Chrome",
    stu_onboard_rule_title: "Lưu ý tránh bị khóa máy:",
    stu_onboard_rule_1: "• Không mở từ Zalo hoặc Trình quét mã của iPhone.",
    stu_onboard_rule_2: "• Chỉ dùng cố định 1 trình duyệt (Safari hoặc Chrome).",
    perm_guide_title: "Cách mở quyền Vị trí trên thanh địa chỉ:",
    perm_guide_retry_btn: "Kiểm tra lại GPS",
    stu_att_summary_label: "Chuyên cần:",
    stu_att_p: "Có mặt",
    stu_att_l: "Đi trễ",
    stu_att_e: "Có phép",
    stu_att_a: "Vắng"
  },
  en: {
    nav_student: "Student",
    nav_teacher: "Lecturer",
    cam_modal_title: "Scan QR Code",
    stu_course_title: "Student Information",
    stu_add_course_btn: "Change Student ID",
    stu_select_lecturer: "Lecturer:",
    stu_select_class: "Course Section:",
    stu_unselected_class_opt: "-- No class selected - Outside scheduled hours --",
    stu_no_course_desc: "Enter your Student ID to link your enrolled classes (only required once per semester).",
    stu_scan_onboard_qr: "Scan Course QR Code",
    stu_toggle_api_link: "Advanced Connection Settings",
    stu_api_url_label: "Server Endpoint (Web App URL):",
    stu_id_label: "Student ID:",
    stu_id_placeholder: "Enter your Student ID...",
    stu_register_btn: "Save and Link Device",
    stu_checkin_title: "Class Attendance",
    stu_gps_readout_idle: "GPS not checked",
    stu_btn_check_gps: "Check GPS",
    btn_cancel_scan: "Close",
    modal_confirm_title: "Confirmation",
    modal_confirm_btn: "Confirm",
    stu_one_tap_checkin_btn: "CHECK IN NOW",
    stu_submitting_btn: "Submitting attendance...",
    tea_login_title: "Lecturer Sign In",
    tea_login_desc: "Enter the 6-digit session code from Google Sheet or your Master Key.",
    tea_scan_pair_qr: "Scan Pairing QR Code",
    tea_config_url_link: "Configure Connection URL",
    tea_reset_url_btn: "Restore Default URL",
    tea_api_url_label: "Server Endpoint (Cell B4 in Google Sheet):",
    tea_token_label: "Session Code (6 digits) or Master Key:",
    tea_token_placeholder: "Enter 6-digit code or Master Key...",
    tea_session_type_label: "Sign-In Persistence Mode:",
    tea_persist_phone: "Personal Lecturer Device (Keep Signed In)",
    tea_persist_pc: "Classroom Computer (Auto Sign-Out After 60 Minutes)",
    tea_login_btn: "Sign In as Lecturer",
    tea_panel1_title: "1. Attendance Session Control",
    tea_fullscreen_btn: "Fullscreen",
    tea_select_class: "Active Class Section:",
    tea_unselected_class_opt: "-- No class selected - Outside scheduled hours --",
    tea_open_trigger_btn: "Open Attendance Session",
    tea_confirm_open_prompt: "Confirm opening attendance session for this class section?",
    tea_confirm_open_btn: "Confirm Open",
    tea_cancel_open_btn: "Cancel",
    tea_adv_gps_link: "Advanced GPS Location Mode",
    tea_adv_gps_label: "Use Student GPS (Average the first 3 verified students as the classroom center)",
    tea_extend_btn: "+2 Mins",
    tea_reopen_btn: "Reopen 5 Mins",
    tea_close_btn: "Close Session",
    tea_panel2_title: "2. Student Roster",
    tea_spot_check_btn: "Random Check",
    tea_group_maker_btn: "Split Groups",
    tea_history_btn: "History",
    tea_show_hide_names: "Show/Hide Names",
    tea_search_placeholder: "Search full name or Student ID (Press Enter to mark Present)...",
    tea_panel4_title: "3. Administration and Data Sync",
    tea_rebuild_sheet_btn: "Sync Sheet",
    tea_logout_btn: "Sign Out",
    ONBOARD_CONFIRMED: "[LINKED] Student verified: {name} ({id}).",
    CONFIRMED_PRESENT: "[CONFIRMED] Recorded PRESENT at {time} (Distance: {dist}m).",
    CONFIRMED_LATE: "[CONFIRMED] Recorded LATE at {time} (Distance: {dist}m).",
    ALREADY_RECORDED: "[RECORDED] Attendance already logged ({status} at {time}).",
    ERR_NOT_ON_ROSTER: "[ERROR] Student ID {id} was not found on the class roster.",
    ERR_DEVICE_BOUND_OTHER: "[DEVICE LOCKED] This browser is already bound to another Student ID.",
    ERR_CREDENTIAL_MISMATCH: "[DEVICE MISMATCH] Browser does not match original registration for {id}. Ask your lecturer to unlock your device if you changed phones.",
    ERR_REG_LOCKED: "[LOCKED] New device registration is currently closed.",
    ERR_SESSION_CLOSED: "[CLOSED] Attendance session is currently closed.",
    ERR_INVALID_QR: "[INVALID] Invalid session token.",
    ERR_LOCATION_OUT_OF_RANGE: "[OUT OF RANGE] You are {dist}m away from classroom center (Maximum allowed: {max}m). Please move into the classroom and try again.",
    ERR_GPS_UNAVAILABLE: "[GPS SIGNAL ERROR] Browser has Location permission, but your phone could not lock onto an indoor GPS signal. Please turn on Wi-Fi (for indoor positioning) and Location Services on your phone, then try again.",
    ERR_SERVER_BUSY: "System is processing requests, please wait a moment...",
    ERR_UNAUTHORIZED: "[UNAUTHORIZED] Invalid or expired session code. Please check Cell C9 in your Google Sheet.",
    DEVICE_RESET_OK: "[UNLOCKED] Device lock has been reset for Student ID {id}.",
    btn_open_external_browser: "Open in main browser",
    btn_copy_browser_url: "Copy link for Safari / Chrome",
    stu_onboard_rule_title: "Avoid device lock:",
    stu_onboard_rule_1: "• Do not open inside Zalo or iPhone Code Scanner.",
    stu_onboard_rule_2: "• Always use 1 fixed browser (Safari or Chrome).",
    perm_guide_title: "How to allow Location on the address bar:",
    perm_guide_retry_btn: "Re-check GPS",
    stu_att_summary_label: "Attendance:",
    stu_att_p: "Present",
    stu_att_l: "Late",
    stu_att_e: "Excused",
    stu_att_a: "Absent"
  }
};

/**
 * ============================================================================
 * 2. STORAGE, DATA MIGRATION (PRESERVING USER DATA) & FINGERPRINT
 * ============================================================================
 */
function safeGetLocal(key, fallback = null) {
  try {
    const val = localStorage.getItem(key);
    return val !== null ? val : fallback;
  } catch (e) {
    return fallback;
  }
}

function safeSetLocal(key, val) {
  try { localStorage.setItem(key, val); } catch (e) {}
}

function safeRemoveLocal(key) {
  try { localStorage.removeItem(key); } catch (e) {}
}

function safeGetSession(key, fallback = null) {
  try {
    const val = sessionStorage.getItem(key);
    return val !== null ? val : fallback;
  } catch (e) {
    return fallback;
  }
}

function safeSetSession(key, val) {
  try { sessionStorage.setItem(key, val); } catch (e) {}
}

function safeRemoveSession(key) {
  try { sessionStorage.removeItem(key); } catch (e) {}
}

function normalizeApiUrl(url) {
  const clean = String(url || '').trim();
  if (
    !clean ||
    LEGACY_LECTURER_APIS.includes(clean) ||
    !clean.startsWith('https://script.google.com/macros/s/') ||
    !clean.endsWith('/exec')
  ) {
    return DEFAULT_LECTURER_API;
  }
  return clean;
}

/**
 * Preserves 100% of existing student & lecturer profiles while normalizing URLs
 * and stripping the obsolete test sample class `ENG101_G1`.
 */
function migrateStoredUrls() {
  const profiles = getStudentProfiles();
  let changed = false;
  Object.keys(profiles).forEach(k => {
    const p = profiles[k];
    const norm = normalizeApiUrl(p.apiUrl);
    if (p.apiUrl !== norm) {
      p.apiUrl = norm;
      changed = true;
    }
    if (Array.isArray(p.enrolledClasses)) {
      const filtered = p.enrolledClasses.filter(
        c => c && !REMOVED_SAMPLE_CLASSES.includes(String(c.classId || '').trim().toUpperCase())
      );
      if (filtered.length !== p.enrolledClasses.length) {
        p.enrolledClasses = filtered;
        changed = true;
      }
    }
  });
  if (changed) safeSetLocal('cc_student_profiles', JSON.stringify(profiles));

  const tAuth = getTeacherAuth();
  if (tAuth) {
    const norm = normalizeApiUrl(tAuth.apiUrl);
    if (tAuth.apiUrl !== norm) {
      tAuth.apiUrl = norm;
      safeSetLocal('cc_teacher_auth', JSON.stringify(tAuth));
    }
  }

  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(regs => {
        (regs || []).forEach(r => r.unregister());
      });
    }
    if (window.caches && typeof window.caches.keys === 'function') {
      window.caches.keys().then(keys => {
        (keys || []).forEach(k => window.caches.delete(k));
      });
    }
  } catch (e) {}
}

let currentLang = safeGetLocal('cc_lang', 'vi');
let currentMode = 'STUDENT';
let html5QrScanner = null;
let activeScanPurpose = null;

function getOrCreateDeviceCredential() {
  let cred = safeGetLocal('cc_device_cred', '');
  if (!cred || cred.length < 20) {
    const arr = new Uint8Array(24);
    window.crypto.getRandomValues(arr);
    cred = 'CRED_' + Array.from(arr, b => ('0' + b.toString(16)).slice(-2)).join('');
    safeSetLocal('cc_device_cred', cred);
  }
  return cred;
}

function getHardwareFingerprint() {
  try {
    const scr = window.screen || {};
    const nav = window.navigator || {};
    let glRenderer = '';
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        if (dbg) glRenderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '';
      }
    } catch (e) {}

    return [
      nav.platform || '',
      scr.width + 'x' + scr.height,
      scr.colorDepth || '',
      window.devicePixelRatio || 1,
      nav.hardwareConcurrency || '',
      nav.deviceMemory || '',
      Intl.DateTimeFormat().resolvedOptions().timeZone || '',
      glRenderer
    ].join('|');
  } catch (e) {
    return 'FP_DEFAULT';
  }
}

function getStudentProfiles() {
  try { return JSON.parse(safeGetLocal('cc_student_profiles', '{}')); } catch (e) { return {}; }
}

function saveStudentProfile(instId, profileObj) {
  if (profileObj && Array.isArray(profileObj.enrolledClasses)) {
    profileObj.enrolledClasses = profileObj.enrolledClasses.filter(
      c => c && !REMOVED_SAMPLE_CLASSES.includes(String(c.classId || '').trim().toUpperCase())
    );
  }
  const all = getStudentProfiles();
  all[instId] = profileObj;
  safeSetLocal('cc_student_profiles', JSON.stringify(all));
  safeSetLocal('cc_active_inst', instId);
}

function getTeacherAuth() {
  try {
    const localData = safeGetLocal('cc_teacher_auth', null);
    if (localData) return JSON.parse(localData);
    const sesData = safeGetSession('cc_teacher_auth', null);
    if (sesData) {
      const parsed = JSON.parse(sesData);
      if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
        safeRemoveSession('cc_teacher_auth');
        return null;
      }
      return parsed;
    }
  } catch (e) {}
  return null;
}

function saveTeacherAuth(apiUrl, token, persistence) {
  const payloadObj = {
    apiUrl: normalizeApiUrl(apiUrl),
    token,
    persistence: persistence || 'LOCAL',
    expiresAt: persistence === 'SESSION' ? (Date.now() + 60 * 60 * 1000) : null
  };
  const payload = JSON.stringify(payloadObj);
  if (persistence === 'LOCAL') {
    safeSetLocal('cc_teacher_auth', payload);
  } else {
    safeSetSession('cc_teacher_auth', payload);
  }
}

/**
 * ============================================================================
 * 3. ANTI-CHEAT & GPS INTEGRITY / FRESHNESS INSPECTION
 * ============================================================================
 */
function evaluateStudentAntiCheat() {
  const ua = navigator.userAgent || '';
  const isIos =
    /iPhone|iPad|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1);
  const isZaloOrSocial = /Zalo|FBAN|FBAV|Messenger|Instagram|BytedanceWebview|TikTok|Line\/|MicroMessenger/i.test(ua);
  const isIosMainBrowser =
    /Version\/[\d.]+.*Safari\/|CriOS\/|FxiOS\/|EdgiOS\/|OPiOS\/|CocCoc|DuckDuckGo/i.test(ua) ||
    Boolean(window.navigator && window.navigator.standalone);
  const isAppleCodeScanner = isIos && !isZaloOrSocial && !isIosMainBrowser && /AppleWebKit/i.test(ua);
  const isInApp = isZaloOrSocial || isAppleCodeScanner;
  const webViewType = isZaloOrSocial ? 'ZALO_SOCIAL' : (isAppleCodeScanner ? 'APPLE_CODE_SCANNER' : '');

  return {
    isInApp,
    webViewType,
    isAppleCodeScanner,
    isSecondaryMobileBrowser: false,
    browserOk: !isInApp,
    deviceOk: true
  };
}

function inspectGpsForSpoofing(pos) {
  if (!pos || !pos.coords) return { suspicious: true, hardBlock: true, reason: 'No GPS' };
  const c = pos.coords;
  if (
    typeof c.latitude !== 'number' ||
    typeof c.longitude !== 'number' ||
    isNaN(c.latitude) ||
    isNaN(c.longitude) ||
    (c.latitude === 0 && c.longitude === 0) ||
    typeof c.accuracy !== 'number' ||
    c.accuracy <= 0
  ) {
    return { suspicious: true, hardBlock: true, reason: 'Invalid coordinates or accuracy' };
  }
  // Check if geolocation API was overridden in DevTools console
  try {
    const fnStr = Function.prototype.toString.call(navigator.geolocation.getCurrentPosition);
    if (!fnStr.includes('[native code]')) {
      return { suspicious: true, hardBlock: false, reason: 'F12_GEO_OVERRIDE' };
    }
  } catch (e) {}

  // Check timestamp freshness (flag if browser returned a stale coordinate > 3 mins old)
  if (pos.timestamp && Math.abs(Date.now() - Number(pos.timestamp)) > 180000) {
    return { suspicious: true, hardBlock: false, reason: 'STALE_GPS_TIMESTAMP' };
  }

  // Flag unnatural mock accuracy (e.g. exact 1m or 0.5m with null altitudeAccuracy on mobile)
  if (c.accuracy <= 1.2 && c.altitude === null && c.altitudeAccuracy === null) {
    return { suspicious: true, hardBlock: false, reason: 'MOCK_ACCURACY_PATTERN' };
  }

  return { suspicious: false, hardBlock: false, reason: '' };
}

/**
 * ============================================================================
 * 4. TRANSPORT LAYER, CAMERA QR SCANNER & SHARED UI HELPERS
 * ============================================================================
 */
function stripRemainingEmojis(text) {
  if (!text) return '';
  return String(text)
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function callBackend(apiUrl, payload, retries = 2) {
  const targetUrl = normalizeApiUrl(apiUrl);
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(targetUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload),
        redirect: 'follow'
      });
      const data = await response.json();
      if (data && (data.calendarEvents || data.classSchedules || data.classes)) {
        ingestServerScheduleData(data);
      }
      if (data.code === 'ERR_SERVER_BUSY' && attempt < retries) {
        showStatus(I18N[currentLang].ERR_SERVER_BUSY, 'warn');
        await new Promise(r => setTimeout(r, 1100 + Math.random() * 800));
        continue;
      }
      return data;
    } catch (err) {
      if (attempt === retries) {
        return { ok: false, code: 'ERR_NETWORK', message: err.message };
      }
      await new Promise(r => setTimeout(r, 900));
    }
  }
}

async function startCameraScanner(purpose) {
  activeScanPurpose = purpose;
  const modalBox = document.getElementById('camera-modal-box');
  modalBox.classList.remove('hidden');

  if (html5QrScanner) {
    try { await html5QrScanner.stop(); } catch (e) {}
  }

  html5QrScanner = new Html5Qrcode('qr-reader');
  try {
    await html5QrScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 240, height: 240 } },
      async (decodedText) => {
        await stopCameraScanner();
        handleScannedQrText(decodedText, purpose);
      },
      () => {}
    );
  } catch (err) {
    modalBox.classList.add('hidden');
    showStatus(
      currentLang === 'en'
        ? 'Unable to open camera. Please grant camera permission in your browser.'
        : 'Không mở được máy ảnh. Vui lòng cấp quyền máy ảnh cho trình duyệt.',
      'warn'
    );
  }
}

async function stopCameraScanner() {
  const modalBox = document.getElementById('camera-modal-box');
  if (modalBox) modalBox.classList.add('hidden');
  if (html5QrScanner) {
    try { await html5QrScanner.stop(); } catch (e) {}
  }
}

function handleScannedQrText(text, purpose) {
  const isEn = currentLang === 'en';
  if (text.includes('?onboard=') || text.includes('?pair=')) {
    try {
      const url = new URL(text);
      if (url.searchParams.get('onboard')) {
        const obj = JSON.parse(atob(url.searchParams.get('onboard').replace(/-/g, '+').replace(/_/g, '/')));
        document.getElementById('inp-onboard-api').value = normalizeApiUrl(obj.api);
        showStatus(
          isEn ? 'Course configuration loaded. Please enter your Student ID.' : 'Đã nạp cấu hình khóa học. Vui lòng nhập mã số sinh viên.',
          'success'
        );
        return;
      }
      if (url.searchParams.get('pair')) {
        const obj = JSON.parse(atob(url.searchParams.get('pair').replace(/-/g, '+').replace(/_/g, '/')));
        document.getElementById('inp-tea-api').value = normalizeApiUrl(obj.api);
        document.getElementById('inp-tea-token').value = obj.tkey || '';
        loginTeacher();
        return;
      }
    } catch (e) {}
  }

  try {
    const obj = JSON.parse(text);
    if (obj.type === 'ONBOARD' && obj.api) {
      document.getElementById('inp-onboard-api').value = normalizeApiUrl(obj.api);
      showStatus(
        isEn ? 'Course configuration loaded. Please enter your Student ID.' : 'Đã nạp cấu hình khóa học. Vui lòng nhập mã số sinh viên.',
        'success'
      );
      return;
    }
    if (obj.type === 'TEACHER_PAIR' && obj.api && obj.tkey) {
      document.getElementById('inp-tea-api').value = normalizeApiUrl(obj.api);
      document.getElementById('inp-tea-token').value = obj.tkey;
      loginTeacher();
      return;
    }
  } catch (e) {}

  if (purpose === 'CHECKIN') {
    executeStudentCheckIn(text);
  } else {
    showStatus(isEn ? 'Invalid QR code.' : 'Mã QR không hợp lệ.', 'warn');
  }
}

function openAppModal(title, bodyText, confirmLabel, onConfirm, options = {}) {
  const cardEl = document.getElementById('app-modal-card');
  if (cardEl) {
    cardEl.classList.toggle('modal-wide', Boolean(options && options.wide));
  }
  document.getElementById('app-modal-title').textContent = stripRemainingEmojis(title);
  const bodyEl = document.getElementById('app-modal-body');
  if (options && options.htmlBody) {
    bodyEl.innerHTML = options.htmlBody;
  } else {
    bodyEl.textContent = stripRemainingEmojis(bodyText);
  }

  const extraBtn = document.getElementById('app-modal-extra');
  if (extraBtn) {
    if (options && options.extraLabel && typeof options.onExtra === 'function') {
      extraBtn.textContent = stripRemainingEmojis(options.extraLabel);
      extraBtn.className = options.extraClass || 'btn btn-primary';
      extraBtn.onclick = async () => {
        if (!options.keepOpenOnExtra) closeAppModal();
        await options.onExtra();
      };
      extraBtn.classList.remove('hidden');
    } else {
      extraBtn.classList.add('hidden');
      extraBtn.onclick = null;
    }
  }

  const confirmBtn = document.getElementById('app-modal-confirm');
  if (options && options.hideConfirm) {
    confirmBtn.classList.add('hidden');
    confirmBtn.onclick = null;
  } else {
    confirmBtn.classList.remove('hidden');
    const defaultConfirm = currentLang === 'en' ? 'Confirm' : 'Đồng ý';
    confirmBtn.textContent = stripRemainingEmojis(confirmLabel || defaultConfirm);
    confirmBtn.className = (options && options.confirmClass) ? options.confirmClass : 'btn btn-primary';
    confirmBtn.onclick = async () => {
      if (!(options && options.keepOpenOnConfirm)) closeAppModal();
      if (typeof onConfirm === 'function') await onConfirm();
    };
  }
  document.getElementById('app-modal').classList.remove('hidden');
}

function closeAppModal() {
  document.getElementById('app-modal').classList.add('hidden');
  const cardEl = document.getElementById('app-modal-card');
  if (cardEl) cardEl.classList.remove('modal-wide');
  const extraBtn = document.getElementById('app-modal-extra');
  if (extraBtn) extraBtn.classList.add('hidden');
  const confirmBtn = document.getElementById('app-modal-confirm');
  if (confirmBtn) {
    confirmBtn.classList.remove('hidden');
    confirmBtn.className = 'btn btn-primary';
  }
}

window.cachedGPS = null;
window.activeGpsPromise = null;
window.lastVerifiedLiveGps = null; // { pos, verifiedAtMs } — 15s live handshake between Check GPS / Onboard and Check-In

function isValidGpsPos(pos) {
  return Boolean(
    pos &&
    pos.coords &&
    typeof pos.coords.latitude === 'number' &&
    typeof pos.coords.longitude === 'number' &&
    !isNaN(pos.coords.latitude) &&
    !isNaN(pos.coords.longitude) &&
    !(pos.coords.latitude === 0 && pos.coords.longitude === 0) &&
    typeof pos.coords.accuracy === 'number' &&
    pos.coords.accuracy > 0
  );
}

/**
 * Live High-Accuracy GPS Acquisition (`maximumAge: 0`, zero coordinate caching):
 *  - NEVER stores or reuses old GPS coordinates (`window.cachedGPS = null`), preventing walk-away / pre-load cheating.
 *  - Step 1 (Synchronous User-Gesture Trigger): Calls `navigator.geolocation.getCurrentPosition` synchronously
 *    inside the Promise executor so iOS Safari and Android Chrome preserve `userActivation` and ALWAYS display
 *    the native "Allow Location" dialog when site permission is in `'prompt'` state.
 *  - Step 2 (Sequential Hardware Warm-Up): If the initial fix is already accurate (`<= 65m`), resolves immediately.
 *    If the initial fix is a coarse cell-tower seed (`> 65m`), starts `watchPosition` (`enableHighAccuracy: true, maximumAge: 0`)
 *    for up to 3.5s so the GPS chip can lock onto satellites without colliding with Step 1.
 */
function acquireLiveHighAccuracyGps(maxWaitMs = 4500, settleAfterFirstFixMs = 2500, targetAccuracyMeters = 100) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject({ code: 2, message: 'No Geolocation API' });
    }

    let bestPos = null;
    let settled = false;
    let watchId = null;
    let refineTimer = null;

    const cleanup = () => {
      if (watchId !== null && typeof navigator.geolocation.clearWatch === 'function') {
        try { navigator.geolocation.clearWatch(watchId); } catch (e) {}
        watchId = null;
      }
      if (refineTimer) {
        clearTimeout(refineTimer);
        refineTimer = null;
      }
      if (hardTimer) {
        clearTimeout(hardTimer);
        hardTimer = null;
      }
    };

    const finishResolve = (pos) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(pos);
    };

    const finishReject = (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    let hardTimer = setTimeout(() => {
      if (bestPos) {
        finishResolve(bestPos);
      } else {
        finishReject({ code: 3, message: 'GPS timeout' });
      }
    }, maxWaitMs);

    const startRefinementWatch = () => {
      if (settled || typeof navigator.geolocation.watchPosition !== 'function') {
        if (bestPos) finishResolve(bestPos);
        return;
      }
      if (!refineTimer) {
        refineTimer = setTimeout(() => {
          if (bestPos) finishResolve(bestPos);
        }, settleAfterFirstFixMs);
      }
      try {
        watchId = navigator.geolocation.watchPosition(
          (pos) => {
            if (!isValidGpsPos(pos)) return;
            if (!bestPos || pos.coords.accuracy < bestPos.coords.accuracy) {
              bestPos = pos;
            }
            if (bestPos.coords.accuracy <= targetAccuracyMeters) {
              finishResolve(bestPos);
            }
          },
          () => {
            if (bestPos) finishResolve(bestPos);
          },
          {
            enableHighAccuracy: true,
            timeout: settleAfterFirstFixMs,
            maximumAge: 0
          }
        );
      } catch (e) {
        if (bestPos) finishResolve(bestPos);
      }
    };

    // Synchronous call on the click stack guarantees the browser's native Permission Dialog pops up
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (!isValidGpsPos(pos)) {
          startRefinementWatch();
          return;
        }
        bestPos = pos;
        if (pos.coords.accuracy <= targetAccuracyMeters) {
          finishResolve(pos);
        } else {
          // Initial reading was a coarse cell-tower seed (> 65m); warm up satellite sensor briefly
          startRefinementWatch();
        }
      },
      (err) => {
        if (err && err.code === 1) {
          finishReject(err);
          return;
        }
        if (bestPos) {
          finishResolve(bestPos);
          return;
        }
        finishReject(err);
      },
      {
        enableHighAccuracy: true,
        timeout: maxWaitMs,
        maximumAge: 0
      }
    );
  });
}

function getAccuratePosition() {
  window.cachedGPS = null;

  if (
    window.lastVerifiedLiveGps &&
    window.lastVerifiedLiveGps.pos &&
    (Date.now() - Number(window.lastVerifiedLiveGps.verifiedAtMs || 0)) <= 15000 &&
    isValidGpsPos(window.lastVerifiedLiveGps.pos)
  ) {
    const freshVerifiedPos = window.lastVerifiedLiveGps.pos;
    window.lastVerifiedLiveGps = null;
    hideGpsPermissionGuideBox();
    return Promise.resolve(freshVerifiedPos);
  }
  window.lastVerifiedLiveGps = null;

  if (window.activeGpsPromise) {
    return window.activeGpsPromise;
  }

  window.activeGpsPromise = (async () => {
    try {
      const pos = await acquireLiveHighAccuracyGps(4500, 2500, 100);
      window.cachedGPS = null;
      hideGpsPermissionGuideBox();
      return pos;
    } catch (err1) {
      if (err1 && err1.code === 1) {
        showGpsPermissionGuideBox(err1);
        throw err1;
      }
      // Indoor live fallback: switch to Wi-Fi / cellular positioning (enableHighAccuracy: false) while keeping maximumAge: 0
      return await new Promise((resolve, reject) => {
        if (!navigator.geolocation) return reject(err1);
        navigator.geolocation.getCurrentPosition(
          (pos2) => {
            window.cachedGPS = null;
            if (isValidGpsPos(pos2)) {
              hideGpsPermissionGuideBox();
              resolve(pos2);
            } else {
              reject(err1);
            }
          },
          (err2) => {
            if (err2 && err2.code === 1) showGpsPermissionGuideBox(err2);
            reject(err2 || err1);
          },
          { enableHighAccuracy: false, timeout: 4500, maximumAge: 0 }
        );
      });
    } finally {
      window.activeGpsPromise = null;
      window.cachedGPS = null;
    }
  })();

  return window.activeGpsPromise;
}

function formatGpsErrorGuide(err) {
  const isEn = currentLang === 'en';
  const ua = navigator.userAgent || '';
  const isIos = /iPhone|iPad|iPod/i.test(ua);
  const code = err && typeof err.code === 'number' ? err.code : 0;

  if (code === 1) {
    if (isIos) {
      return isEn
        ? '[LOCATION BLOCKED IN BROWSER] Tap the three-dots (•••) or Page Menu icon on the Safari address bar (or "AA" on older iOS) -> Website Settings -> Location -> Allow.'
        : '[CHƯA CẤP QUYỀN TRÊN TRÌNH DUYỆT] Bấm nút dấu 3 chấm (•••) hoặc biểu tượng Menu bên trái thanh địa chỉ Safari (hoặc chữ "AA" trên iOS cũ) -> Cài đặt trang web -> Vị trí -> Cho phép.';
    }
    return isEn
      ? '[LOCATION BLOCKED IN BROWSER] Tap the Tune/Sliders (or Lock) icon on the left of the address bar -> Permissions -> Location -> Allow.'
      : '[CHƯA CẤP QUYỀN TRÊN TRÌNH DUYỆT] Bấm biểu tượng 2 thanh trượt (hoặc Ổ khóa) ngay bên trái thanh địa chỉ phía trên -> Quyền (Permissions) -> Vị trí (Location) -> Cho phép.';
  }

  return isEn
    ? '[GPS SIGNAL ERROR] Browser has Location permission, but your phone could not lock onto an indoor GPS signal. Please turn on Wi-Fi (for indoor positioning) and Location Services on your phone, then try again.'
    : '[LỖI TÍN HIỆU GPS] Trình duyệt đã có quyền Vị trí nhưng điện thoại chưa bắt được sóng định vị trong phòng. Vui lòng bật biểu tượng Wi-Fi (để hỗ trợ định vị trong nhà) và bật Dịch vụ định vị trên điện thoại rồi bấm lại.';
}

function showGpsPermissionGuideBox() {
  const box = document.getElementById('gps-permission-guide-box');
  if (!box) return;
  const isEn = currentLang === 'en';
  const ua = navigator.userAgent || '';
  const isIos = /iPhone|iPad|iPod/i.test(ua);

  const titleEl = document.getElementById('perm-guide-title');
  const step1El = document.getElementById('perm-guide-step1');
  const step2El = document.getElementById('perm-guide-step2');

  if (titleEl) {
    titleEl.textContent = I18N[currentLang].perm_guide_title;
  }

  if (isIos) {
    if (step1El) {
      step1El.textContent = isEn
        ? 'On Safari address bar: Tap ••• (or "AA") -> "Website Settings" -> "Location" -> "Allow".'
        : 'Trên Safari: Bấm ••• (hoặc chữ AA) trên thanh địa chỉ -> "Cài đặt trang web" -> "Vị trí" -> "Cho phép".';
    }
    if (step2El) {
      step2El.textContent = isEn
        ? 'If still blocked: Open iPhone Settings -> Privacy & Security -> Location Services -> Safari Websites -> Select "While Using the App" & turn ON "Precise Location".'
        : 'Nếu đã Cho phép mà vẫn lỗi: Vào Cài đặt iPhone -> Quyền riêng tư & Bảo mật -> Dịch vụ định vị -> Trang web Safari -> Chọn "Khi dùng ứng dụng" & bật "Vị trí chính xác".';
    }
  } else {
    if (step1El) {
      step1El.textContent = isEn
        ? 'Tap the Tune/Sliders (or Lock) icon on the left of the address bar.'
        : 'Bấm biểu tượng 2 thanh trượt (hoặc Ổ khóa) bên trái thanh địa chỉ.';
    }
    if (step2El) {
      step2El.textContent = isEn
        ? 'Select "Permissions" -> Turn ON "Location".'
        : 'Chọn "Quyền" (Permissions) -> Bật "Vị trí" (Location) sang Cho phép.';
    }
  }

  box.classList.remove('hidden');
  hideStatus('checkin-inline-status');
}

function hideGpsPermissionGuideBox() {
  const box = document.getElementById('gps-permission-guide-box');
  if (box) box.classList.add('hidden');
}

let hasBoundPermissionWatcher = false;
function watchBrowserLocationPermission() {
  if (hasBoundPermissionWatcher) return;
  if (!navigator.permissions || typeof navigator.permissions.query !== 'function') return;
  hasBoundPermissionWatcher = true;

  navigator.permissions.query({ name: 'geolocation' }).then((permStatus) => {
    if (permStatus.state === 'denied' && currentMode === 'STUDENT') {
      showGpsPermissionGuideBox();
    }
    permStatus.onchange = () => {
      if (permStatus.state === 'granted') {
        hideGpsPermissionGuideBox();
        hideStatus('checkin-inline-status');
        if (currentMode === 'STUDENT' && typeof handleStudentPreCheckGps === 'function') {
          handleStudentPreCheckGps();
        }
      } else if (permStatus.state === 'denied' && currentMode === 'STUDENT') {
        showGpsPermissionGuideBox();
      }
    };
  }).catch(() => {});
}

function pulseButtonConfirm(btnOrId, confirmLabel = '', variant = 'success', durationMs = 1200, options = {}) {
  const btn = typeof btnOrId === 'string' ? document.getElementById(btnOrId) : btnOrId;
  if (!btn) return Promise.resolve();

  const opts = options && typeof options === 'object' ? options : {};
  const lockAfterPulse = Boolean(opts.lockAfterPulse);

  if (navigator.vibrate) {
    try {
      if (variant === 'danger') navigator.vibrate([55, 45, 55]);
      else if (variant === 'warn') navigator.vibrate([45, 60, 45]);
      else if (variant === 'neutral') navigator.vibrate(20);
      else navigator.vibrate([35, 50, 65]);
    } catch (e) {}
  }

  const pulseCls = variant === 'warn'
    ? 'btn-pulse-warn'
    : variant === 'danger'
      ? 'btn-pulse-danger'
      : variant === 'neutral'
        ? 'btn-pulse-neutral'
        : 'btn-pulse-success';

  if (!btn._origPulseHtml && !opts.skipSaveOrig) {
    btn._origPulseHtml = btn.innerHTML;
  }

  btn.classList.remove('btn-pulse-success', 'btn-pulse-warn', 'btn-pulse-danger', 'btn-pulse-neutral');
  void btn.offsetWidth;
  btn.classList.add(pulseCls);

  if (confirmLabel) {
    const isSmallBtn = btn.classList.contains('btn-sm');
    const iconCls = btn.id === 'btn-start-checkin' ? 'icon icon-lg' : (isSmallBtn ? 'icon icon-sm' : 'icon');
    let svgIcon = `<svg class="${iconCls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path class="pulse-draw-path" d="M20 6L9 17l-5-5"></path></svg>`;
    if (variant === 'warn') {
      svgIcon = `<svg class="${iconCls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path class="pulse-draw-path" d="M12 7v5l3 2"></path></svg>`;
    } else if (variant === 'danger') {
      svgIcon = `<svg class="${iconCls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path class="pulse-draw-path" d="M15 9l-6 6M9 9l6 6"></path></svg>`;
    } else if (variant === 'neutral') {
      svgIcon = '';
    }
    const hasHeroLabel = btn.id === 'btn-start-checkin';
    btn.innerHTML = hasHeroLabel
      ? `${svgIcon}<span id="btn-start-checkin-label">${escapeHtml(confirmLabel)}</span>`
      : `${svgIcon}<span>${escapeHtml(confirmLabel)}</span>`;
  }

  if (btn._pulseRestoreTimer) {
    clearTimeout(btn._pulseRestoreTimer);
  }

  return new Promise((resolve) => {
    if (durationMs <= 0 || lockAfterPulse) {
      if (lockAfterPulse) {
        btn.disabled = true;
      }
      resolve();
      return;
    }
    btn._pulseRestoreTimer = setTimeout(() => {
      btn.classList.remove('btn-pulse-success', 'btn-pulse-warn', 'btn-pulse-danger', 'btn-pulse-neutral');
      if (btn._origPulseHtml && btn.id !== 'btn-start-checkin') {
        btn.innerHTML = btn._origPulseHtml;
      }
      delete btn._origPulseHtml;
      btn._pulseRestoreTimer = null;
      resolve();
    }, durationMs);
  });
}

function copyCurrentUrlForMainBrowser() {
  const url = window.location.href;
  const isEn = currentLang === 'en';
  const doneMsg = isEn ? 'LINK COPIED — PASTE IN SAFARI / CHROME' : 'ĐÃ CHÉP LINK — DÁN VÀO SAFARI / CHROME';

  const fallbackCopy = () => {
    try {
      const ta = document.createElement('textarea');
      ta.value = url;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) {}
  };

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(url).catch(() => fallbackCopy());
  } else {
    fallbackCopy();
  }

  pulseButtonConfirm('btn-copy-browser-url', doneMsg, 'success', 1600);
}

function openInExternalMainBrowser() {
  const url = window.location.href;
  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIos = /iPhone|iPad|iPod/i.test(ua);

  if (isAndroid) {
    const cleanUrl = url.replace(/^https?:\/\//i, '');
    window.location.href = `intent://${cleanUrl}#Intent;scheme=https;package=com.android.chrome;end`;
    return;
  }
  if (isIos) {
    const safariUrl = url.replace(/^https:\/\//i, 'x-safari-https://').replace(/^http:\/\//i, 'x-safari-http://');
    window.location.href = safariUrl;
  }
}

async function sha256Browser(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => ('00' + b.toString(16)).slice(-2)).join('');
}

function syncStudentViewportScrollLock() {
  document.body.classList.remove('student-locked-scroll');
}

function switchMode(mode) {
  currentMode = mode;
  safeSetLocal('cc_active_mode', mode);
  stopCameraScanner();
  hideStatus();
  checkIosStandaloneNotice();

  const stuBtn = document.getElementById('btn-mode-student');
  const teaBtn = document.getElementById('btn-mode-teacher');
  const stuView = document.getElementById('view-student');
  const teaView = document.getElementById('view-teacher');

  if (mode === 'TEACHER') {
    stuBtn.classList.remove('active');
    teaBtn.classList.add('active');
    stuView.classList.add('hidden');
    teaView.classList.remove('hidden');

    const auth = getTeacherAuth();
    if (auth && typeof restoreTeacherSessionOnLoad === 'function') {
      restoreTeacherSessionOnLoad(auth);
    }
  } else {
    if (typeof stopTeacherPolling === 'function') stopTeacherPolling();
    teaBtn.classList.remove('active');
    stuBtn.classList.add('active');
    teaView.classList.add('hidden');
    stuView.classList.remove('hidden');
    if (typeof renderStudentCourseSelectors === 'function') renderStudentCourseSelectors();
    if (typeof renderStudentAttendanceSummary === 'function') {
      const selEl = document.getElementById('sel-student-class');
      renderStudentAttendanceSummary('', selEl ? selEl.value : '');
    }
    if (typeof syncStudentLiveScheduleFromServer === 'function') syncStudentLiveScheduleFromServer();
  }
  syncStudentViewportScrollLock();
}

function toggleLanguage() {
  currentLang = currentLang === 'en' ? 'vi' : 'en';
  safeSetLocal('cc_lang', currentLang);
  applyLanguage();
  if (typeof renderStudentCourseSelectors === 'function') renderStudentCourseSelectors();
  if (typeof onAdvStudentGpsToggle === 'function') onAdvStudentGpsToggle();
  if (typeof teacherState !== 'undefined' && teacherState && typeof applyTeacherState === 'function') {
    applyTeacherState(teacherState, false);
  }
}

function applyLanguage() {
  document.documentElement.lang = currentLang;
  document.getElementById('btn-lang').textContent = currentLang === 'en' ? 'EN / VI' : 'VI / EN';
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (I18N[currentLang][key]) {
      el.textContent = I18N[currentLang][key];
    }
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (I18N[currentLang][key]) {
      el.setAttribute('placeholder', I18N[currentLang][key]);
    }
  });
  if (typeof onAdvStudentGpsToggle === 'function') onAdvStudentGpsToggle();
  const permBox = document.getElementById('gps-permission-guide-box');
  if (permBox && !permBox.classList.contains('hidden') && typeof showGpsPermissionGuideBox === 'function') {
    showGpsPermissionGuideBox();
  }
  checkIosStandaloneNotice();
}

function checkIosStandaloneNotice() {
  const banner = document.getElementById('ios-install-banner');
  if (!banner) return;
  if (currentMode === 'TEACHER') {
    banner.classList.add('hidden');
    return;
  }
  const check = evaluateStudentAntiCheat();
  const isEn = currentLang === 'en';
  const titleEl = document.getElementById('t-ios-guard');
  const step1El = document.getElementById('t-ios-guard-step1');
  const step2El = document.getElementById('t-ios-guard-step2');

  if (!check.browserOk) {
    const isAppleQr = check.webViewType === 'APPLE_CODE_SCANNER';
    banner.classList.toggle('guard-apple-qr', isAppleQr);

    if (isAppleQr) {
      if (titleEl) {
        titleEl.textContent = isEn
          ? 'Do not use iPhone "Code Scanner" (Auto-wipes storage)'
          : 'Không dùng "Trình quét mã" của iPhone (Tự xóa bộ nhớ)';
      }
      if (step1El) {
        step1El.textContent = isEn
          ? 'Tap the Safari icon at the bottom-right corner.'
          : 'Bấm biểu tượng Safari ở góc dưới phải màn hình.';
      }
      if (step2El) {
        step2El.textContent = isEn
          ? 'Or copy link below and paste into Safari:'
          : 'Hoặc chép link bên dưới dán vào ứng dụng Safari:';
      }
    } else {
      if (titleEl) {
        titleEl.textContent = isEn
          ? 'Do not use Zalo / Messenger in-app browser'
          : 'Không dùng trình duyệt trong Zalo / Messenger';
      }
      if (step1El) {
        step1El.textContent = isEn
          ? 'Tap ••• at top-right → select Open in Browser.'
          : 'Bấm ••• góc trên phải → chọn Mở bằng trình duyệt.';
      }
      if (step2El) {
        step2El.textContent = isEn
          ? 'Or copy link below and paste into Safari / Chrome:'
          : 'Hoặc chép link bên dưới dán vào Safari / Chrome:';
      }
    }
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

function handleUrlDeepLinks() {
  const params = new URLSearchParams(window.location.search);
  const onboardB64 = params.get('onboard');
  const pairB64 = params.get('pair');

  if (onboardB64) {
    try {
      const decoded = JSON.parse(atob(onboardB64.replace(/-/g, '+').replace(/_/g, '/')));
      if (decoded.api) {
        const normApi = normalizeApiUrl(decoded.api);
        const onboardInput = document.getElementById('inp-onboard-api');
        if (onboardInput) onboardInput.value = normApi;
        const profiles = getStudentProfiles();
        const instIds = Object.keys(profiles);
        if (instIds.length === 0) {
          const addBox = document.getElementById('box-add-course');
          if (addBox) addBox.classList.remove('hidden');
        } else {
          // Student already bound their MSSV on this device: keep MSSV input hidden and update API URL silently
          instIds.forEach(k => {
            profiles[k].apiUrl = normApi;
          });
          safeSetLocal('cc_student_profiles', JSON.stringify(profiles));
          const addBox = document.getElementById('box-add-course');
          if (addBox) addBox.classList.add('hidden');
        }
      }
    } catch (e) {}
  } else if (pairB64) {
    try {
      const decoded = JSON.parse(atob(pairB64.replace(/-/g, '+').replace(/_/g, '/')));
      if (decoded.api && decoded.tkey) {
        switchMode('TEACHER');
        document.getElementById('inp-tea-api').value = normalizeApiUrl(decoded.api);
        document.getElementById('inp-tea-token').value = decoded.tkey;
        loginTeacher();
      }
    } catch (e) {}
  }
}

function formatServerMessage(code, params = {}, fallback = '') {
  let tpl = I18N[currentLang][code] || stripRemainingEmojis(fallback) || code;
  Object.keys(params || {}).forEach(k => {
    tpl = tpl.replace(new RegExp('\\{' + k + '\\}', 'g'), params[k]);
  });
  return stripRemainingEmojis(tpl);
}

const INLINE_STATUS_IDS = [
  'onboard-inline-status',
  'gps-inline-status',
  'checkin-inline-status',
  'tea-login-inline-status',
  'tea-session-inline-status',
  'tea-admin-inline-status'
];

function showInlineStatus(targetId, msg, type = 'warn') {
  const topBox = document.getElementById('status-box');
  if (topBox) topBox.classList.add('hidden');

  const el = document.getElementById(targetId);
  if (!el) return;
  const variant = type === 'success' ? 'success' : type === 'err' ? 'err' : 'warn';
  el.className = 'inline-feedback alert-' + variant;
  el.textContent = stripRemainingEmojis(msg);
  el.classList.remove('hidden');
}

function showStatus(msg, type = 'warn', preferredTargetId = '') {
  if (preferredTargetId && document.getElementById(preferredTargetId)) {
    showInlineStatus(preferredTargetId, msg, type);
    return;
  }

  if (currentMode === 'STUDENT') {
    const addBox = document.getElementById('box-add-course');
    const isOnboardingVisible = addBox && !addBox.classList.contains('hidden');
    const targetId = isOnboardingVisible && !isSubmitting ? 'onboard-inline-status' : 'checkin-inline-status';
    if (document.getElementById(targetId)) {
      showInlineStatus(targetId, msg, type);
      return;
    }
  } else if (currentMode === 'TEACHER') {
    const loginCard = document.getElementById('card-teacher-login');
    const isLoginVisible = loginCard && !loginCard.classList.contains('hidden');
    const targetId = isLoginVisible ? 'tea-login-inline-status' : 'tea-session-inline-status';
    if (document.getElementById(targetId)) {
      showInlineStatus(targetId, msg, type);
      return;
    }
  }

  const box = document.getElementById('status-box');
  if (!box) return;
  box.className = 'alert alert-' + (type === 'success' ? 'success' : type === 'err' ? 'err' : 'warn');
  box.textContent = stripRemainingEmojis(msg);
  box.classList.remove('hidden');
}

function hideStatus(targetId = '') {
  if (targetId) {
    const el = document.getElementById(targetId);
    if (el) el.classList.add('hidden');
    return;
  }
  const box = document.getElementById('status-box');
  if (box) box.classList.add('hidden');
  INLINE_STATUS_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });
}

function formatMmSs(totalSec) {
  const m = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const s = String(totalSec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function formatClassOptionLabel(c) {
  if (!c) return '';
  const id = String(c.classId || '').trim();
  const name = String(c.className || '').trim();
  if (!name || name === id) return id;
  if (name.toUpperCase().startsWith(id.toUpperCase())) return name;
  return `${id} — ${name}`;
}

function escapeHtml(str) {
  return String(str === null || str === undefined ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getTodayDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
