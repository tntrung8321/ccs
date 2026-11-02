/**
 * ============================================================================
 * 0. MASTER SHEET CONNECTION SETTINGS & SCHEDULE ENGINE
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
    endTime: '17:30'
  },
  {
    classId: '2610AVCB003',
    aliases: ['AVCB 003', 'AVCB003', '2610AVCB003'],
    daysOfWeek: [1, 5], // Thứ 2 & Thứ 6
    dayOfWeek: 1,
    periods: '13-15',
    startTime: '17:30',
    endTime: '20:00'
  },
  {
    classId: '2610AVCB004',
    aliases: ['AVCB 004', 'AVCB004', '2610AVCB004'],
    daysOfWeek: [2, 4], // Thứ 3 & Thứ 5
    dayOfWeek: 2,
    periods: '10-12',
    startTime: '15:00',
    endTime: '17:30'
  }
];

// Stores live schedule metadata fetched from Backend (Google Calendar + Sheet Period Info)
window.liveServerSchedule = {
  updatedAt: 0,
  calendarEvents: [],
  classSchedules: {}
};

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

  return {
    startPeriod: s,
    endPeriod: e,
    startTime,
    endTime,
    startMins,
    endMins,
    label: `Tiết ${s}-${e} (${startTime} - ${endTime})`
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
      label: `${openClass.classId} — Đang mở phiên điểm danh`,
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
            label: `Lịch Google Calendar: ${matched.classId} (${ev.startTime} - ${ev.endTime})`,
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

      const hasTodayInAttendanceSheet =
        meta && Array.isArray(meta.sessionDates) && meta.sessionDates.includes(todayDdMm);

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
    label: currentLang === 'en' ? 'Off-schedule hours — Please select a class manually' : 'Ngoài khung giờ học — Vui lòng chọn lớp thủ công',
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
    cam_modal_title: "Quét mã QR",
    stu_course_title: "Thông tin Sinh viên",
    stu_add_course_btn: "Đổi / Liên kết MSSV",
    stu_select_lecturer: "Giảng viên:",
    stu_select_class: "Lớp học phần:",
    stu_unselected_class_opt: "-- Chưa chọn lớp - Ngoài khung giờ --",
    stu_no_course_desc: "Nhập MSSV để liên kết lớp học (chỉ cần thực hiện 1 lần đầu kỳ).",
    stu_scan_onboard_qr: "Quét QR Khóa học",
    stu_toggle_api_link: "Cài đặt kết nối nâng cao",
    stu_api_url_label: "URL Web App:",
    stu_id_label: "Mã số sinh viên (MSSV):",
    stu_register_btn: "Lưu & Liên kết Thiết bị",
    stu_checkin_title: "Điểm danh Lớp học",
    stu_gps_readout_idle: "Chưa kiểm tra GPS (Bấm nút bên cạnh để kiểm tra thiết bị trước giờ học)",
    stu_btn_check_gps: "Kiểm tra & Kích hoạt GPS",
    btn_cancel_scan: "Đóng",
    stu_one_tap_checkin_btn: "ĐIỂM DANH NGAY",
    stu_submitting_btn: "Đang gửi dữ liệu...",
    stu_scan_checkin_btn: "Quét mã QR phòng học",
    stu_submit_manual_qr: "Gửi mã",
    tea_login_title: "Đăng nhập Giảng viên",
    tea_login_desc: "Nhập Mã phiên 6 số hiển thị trong Google Sheet (tự động đổi mới theo phiên) hoặc Master Key.",
    tea_scan_pair_qr: "Quét QR Ghép nối",
    tea_api_url_label: "URL Web App (ô B4):",
    tea_token_label: "Mật khẩu phiên (trên Sheet) hoặc Master Key:",
    tea_session_type_label: "Chế độ lưu đăng nhập:",
    tea_persist_phone: "Thiết bị cá nhân của Giảng viên (Giữ đăng nhập)",
    tea_persist_pc: "Máy tính phòng học (Tự đăng xuất khi đóng tab / 60p)",
    tea_login_btn: "Đăng nhập Giảng viên",
    tea_panel1_title: "1. Trạm Định vị & Thông tin Lớp học",
    tea_fullscreen_btn: "Toàn màn hình",
    tea_select_class: "Lớp học phần đang điều khiển:",
    tea_unselected_class_opt: "-- Chưa chọn lớp - Ngoài khung giờ --",
    tea_calibrate_gps_chk: "Cập nhật Tâm phòng học theo GPS thiết bị này khi Mở phiên",
    tea_open_trigger_btn: "Mở phiên điểm danh",
    tea_cancel_open_btn: "Hủy",
    tea_extend_btn: "+2 Phút",
    tea_reopen_btn: "Mở lại 5 phút",
    tea_close_btn: "Đóng phiên ngay",
    tea_panel2_title: "2. Danh sách Lớp & Kiểm tra Ngẫu nhiên",
    tea_spot_check_btn: "Gọi ngẫu nhiên 1 SV",
    tea_privacy_btn: "Che MSSV",
    tea_show_hide_names: "Ẩn/Hiện danh sách",
    tea_panel4_title: "3. Quản trị & Đồng bộ",
    tea_print_qr_btn: "In bảng QR",
    tea_replace_qr_btn: "Đổi khóa QR",
    tea_rebuild_sheet_btn: "Đồng bộ vào Google Sheet",
    tea_logout_btn: "Đăng xuất",
    ONBOARD_CONFIRMED: "[HOÀN TẤT] Đã liên kết sinh viên: {name} ({id}).",
    CONFIRMED_PRESENT: "[THÀNH CÔNG] Ghi nhận CÓ MẶT lúc {time} (Khoảng cách: {dist}m).",
    CONFIRMED_LATE: "[THÀNH CÔNG] Ghi nhận ĐI TRỄ lúc {time} (Khoảng cách: {dist}m).",
    ALREADY_RECORDED: "[ĐÃ GHI NHẬN] Bạn đã điểm danh buổi này rồi (Trạng thái: {status} lúc {time}).",
    ERR_NOT_ON_ROSTER: "[LỖI] Không tìm thấy MSSV {id} trong danh sách lớp.",
    ERR_DEVICE_BOUND_OTHER: "[KHÓA THIẾT BỊ] Trình duyệt này đã được gắn cố định với một MSSV khác.",
    ERR_CREDENTIAL_MISMATCH: "[SAI THIẾT BỊ] Thiết bị/trình duyệt không khớp với đăng ký gốc của MSSV {id}. Vui lòng báo Giảng viên mở khóa nếu đổi điện thoại.",
    ERR_REG_LOCKED: "[ĐANG KHÓA] Giảng viên hiện đang khóa cổng đăng ký thiết bị mới.",
    ERR_SESSION_CLOSED: "[ĐANG ĐÓNG] Cổng điểm danh của lớp này hiện đang đóng.",
    ERR_INVALID_QR: "[LỖI] Mã phiên điểm danh không hợp lệ.",
    ERR_LOCATION_OUT_OF_RANGE: "[NGOÀI PHẠM VI] Bạn đang cách tâm phòng học {dist}m (Cho phép tối đa {max}m). Vui lòng di chuyển vào lớp và thử lại.",
    ERR_GPS_UNAVAILABLE: "[LỖI ĐỊNH VỊ] Chưa lấy được tín hiệu GPS. Vui lòng bật quyền Vị trí (Location) cho trình duyệt rồi thử lại.",
    ERR_SERVER_BUSY: "Hệ thống đang xử lý, vui lòng chờ giây lát...",
    ERR_UNAUTHORIZED: "[TỪ CHỐI] Mật khẩu phiên không đúng hoặc đã hết hạn. Hãy kiểm tra lại ô C9 trên Google Sheet.",
    DEVICE_RESET_OK: "[ĐÃ MỞ KHÓA] Đã đặt lại khóa thiết bị cho MSSV {id}."
  },
  en: {
    cam_modal_title: "Scan QR Code",
    stu_course_title: "Student Profile",
    stu_add_course_btn: "Change / Link ID",
    stu_select_lecturer: "Lecturer:",
    stu_select_class: "Course Section:",
    stu_unselected_class_opt: "-- No class selected - Off-schedule hours --",
    stu_no_course_desc: "Enter your Student ID once to link your enrolled classes.",
    stu_scan_onboard_qr: "Scan Course QR",
    stu_toggle_api_link: "Advanced Connection Settings",
    stu_api_url_label: "Web App URL:",
    stu_id_label: "Student ID (MSSV):",
    stu_register_btn: "Verify & Bind Device",
    stu_checkin_title: "Class Attendance",
    stu_gps_readout_idle: "GPS not checked yet (Click button to verify GPS before class)",
    stu_btn_check_gps: "Test & Activate GPS",
    btn_cancel_scan: "Close",
    stu_one_tap_checkin_btn: "CHECK IN NOW",
    stu_submitting_btn: "Sending data...",
    stu_scan_checkin_btn: "Scan Classroom QR",
    stu_submit_manual_qr: "Submit",
    tea_login_title: "Lecturer Sign In",
    tea_login_desc: "Enter the rotating 6-digit session code from your Google Sheet or your Master Key.",
    tea_scan_pair_qr: "Scan Pairing QR",
    tea_api_url_label: "Web App URL (Cell B4):",
    tea_token_label: "Rotating Sheet Code or Master Key:",
    tea_session_type_label: "Session Persistence:",
    tea_persist_phone: "Personal Lecturer Device (Keep Signed In)",
    tea_persist_pc: "Classroom Shared PC (Auto-Logout on close / 60m)",
    tea_login_btn: "Sign In",
    tea_panel1_title: "1. GPS Station & Class Overview",
    tea_fullscreen_btn: "Fullscreen",
    tea_select_class: "Selected Class Section:",
    tea_unselected_class_opt: "-- No class selected - Off-schedule hours --",
    tea_calibrate_gps_chk: "Update Room GPS Center from this device on Session Start",
    tea_open_trigger_btn: "Open Attendance Session",
    tea_cancel_open_btn: "Cancel",
    tea_extend_btn: "+2 Mins",
    tea_reopen_btn: "Reopen 5m",
    tea_close_btn: "Close Session Now",
    tea_panel2_title: "2. Live Roster & Random Spot-Check",
    tea_spot_check_btn: "Random Spot-Check",
    tea_privacy_btn: "Mask IDs",
    tea_show_hide_names: "Show/Hide Roster",
    tea_panel4_title: "3. Administration & Sync",
    tea_print_qr_btn: "Print QR",
    tea_replace_qr_btn: "Rotate Secret",
    tea_rebuild_sheet_btn: "Sync to Google Sheet",
    tea_logout_btn: "Sign Out",
    ONBOARD_CONFIRMED: "[LINKED] Student verified: {name} ({id}).",
    CONFIRMED_PRESENT: "[CONFIRMED] Recorded PRESENT at {time} (Distance: {dist}m).",
    CONFIRMED_LATE: "[CONFIRMED] Recorded LATE at {time} (Distance: {dist}m).",
    ALREADY_RECORDED: "[RECORDED] Attendance already logged ({status} at {time}).",
    ERR_NOT_ON_ROSTER: "[ERROR] Student ID {id} was not found on the class roster.",
    ERR_DEVICE_BOUND_OTHER: "[DEVICE LOCKED] This browser is already bound to another Student ID.",
    ERR_CREDENTIAL_MISMATCH: "[DEVICE MISMATCH] Browser does not match original registration for {id}. Ask your lecturer to reset your device lock.",
    ERR_REG_LOCKED: "[LOCKED] New device registration is currently closed.",
    ERR_SESSION_CLOSED: "[CLOSED] Attendance session is currently closed.",
    ERR_INVALID_QR: "[INVALID] Invalid session token.",
    ERR_LOCATION_OUT_OF_RANGE: "[OUT OF RANGE] You are {dist}m away from classroom center (Max allowed: {max}m).",
    ERR_GPS_UNAVAILABLE: "[GPS ERROR] Unable to acquire GPS coordinates. Please enable Location permission and retry.",
    ERR_SERVER_BUSY: "Processing request, please wait...",
    ERR_UNAUTHORIZED: "[UNAUTHORIZED] Invalid or expired session code. Check Cell C9 in Google Sheet.",
    DEVICE_RESET_OK: "[UNLOCKED] Device lock reset for Student ID {id}."
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
  const isInApp = /Zalo|FBAN|FBAV|Messenger|Instagram|BytedanceWebview|TikTok|Line\/|MicroMessenger/i.test(ua);
  return {
    isInApp,
    isSecondaryMobileBrowser: false,
    browserOk: !isInApp,
    deviceOk: true
  };
}

function inspectGpsForSpoofing(pos) {
  if (!pos || !pos.coords) return { suspicious: true, hardBlock: true, reason: 'No GPS' };
  const c = pos.coords;
  if (typeof c.accuracy !== 'number' || c.accuracy <= 0) {
    return { suspicious: true, hardBlock: true, reason: 'Invalid accuracy' };
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
    showStatus('Không mở được Camera. Vui lòng cấp quyền Camera cho trình duyệt.', 'warn');
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
  if (text.includes('?onboard=') || text.includes('?pair=')) {
    try {
      const url = new URL(text);
      if (url.searchParams.get('onboard')) {
        const obj = JSON.parse(atob(url.searchParams.get('onboard').replace(/-/g, '+').replace(/_/g, '/')));
        document.getElementById('inp-onboard-api').value = normalizeApiUrl(obj.api);
        showStatus('Đã nạp cấu hình khóa học. Vui lòng nhập MSSV.', 'success');
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
      showStatus('Đã nạp cấu hình khóa học. Vui lòng nhập MSSV.', 'success');
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
    showStatus('Mã QR không hợp lệ.', 'warn');
  }
}

function openAppModal(title, bodyText, confirmLabel, onConfirm) {
  document.getElementById('app-modal-title').textContent = stripRemainingEmojis(title);
  document.getElementById('app-modal-body').textContent = stripRemainingEmojis(bodyText);
  const confirmBtn = document.getElementById('app-modal-confirm');
  confirmBtn.textContent = stripRemainingEmojis(confirmLabel || 'Đồng ý');
  confirmBtn.onclick = async () => {
    closeAppModal();
    if (typeof onConfirm === 'function') await onConfirm();
  };
  document.getElementById('app-modal').classList.remove('hidden');
}

function closeAppModal() {
  document.getElementById('app-modal').classList.add('hidden');
}

function getAccuratePosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('No Geolocation'));
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 12000,
      maximumAge: 0
    });
  });
}

async function sha256Browser(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => ('00' + b.toString(16)).slice(-2)).join('');
}

function syncStudentViewportScrollLock() {
  const camBox = document.getElementById('camera-modal-box');
  const advBox = document.getElementById('box-advanced-api');
  const camOpen = camBox && !camBox.classList.contains('hidden');
  const advOpen = advBox && !advBox.classList.contains('hidden');
  const lockScroll = currentMode === 'STUDENT' && !camOpen && !advOpen;
  document.body.classList.toggle('student-locked-scroll', lockScroll);
}

function switchMode(mode) {
  currentMode = mode;
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
    if (auth) {
      document.getElementById('inp-tea-api').value = normalizeApiUrl(auth.apiUrl);
      document.getElementById('inp-tea-token').value = auth.token;
      loginTeacher();
    }
  } else {
    if (typeof stopTeacherPolling === 'function') stopTeacherPolling();
    teaBtn.classList.remove('active');
    stuBtn.classList.add('active');
    teaView.classList.add('hidden');
    stuView.classList.remove('hidden');
  }
  syncStudentViewportScrollLock();
}

function toggleLanguage() {
  currentLang = currentLang === 'en' ? 'vi' : 'en';
  safeSetLocal('cc_lang', currentLang);
  applyLanguage();
  if (typeof renderStudentCourseSelectors === 'function') renderStudentCourseSelectors();
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
  if (!check.browserOk) {
    document.getElementById('t-ios-guard').textContent =
      currentLang === 'vi'
        ? '[CẢNH BÁO TRÌNH DUYỆT] Vui lòng mở bằng trình duyệt chính (Safari, Chrome, Cốc Cốc, Edge), không mở trực tiếp trong Zalo/Messenger.'
        : '[BROWSER WARNING] Please open in Safari, Chrome, CocCoc, or Edge (not inside Zalo/Messenger).';
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
        document.getElementById('inp-onboard-api').value = normalizeApiUrl(decoded.api);
        document.getElementById('box-add-course').classList.remove('hidden');
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
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getTodayDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
