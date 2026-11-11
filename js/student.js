/**
 * ============================================================================
 * STUDENT CONTROLLER (js/student.js — v3.7.5)
 *  - Course & Lecturer Selector with Real-Time Period / Calendar Auto-Select
 *  - Official Attendance Score (Base 10.0), Same-Day Session Merging, Near-Limit Warning & Exam Ban (CẤM THI)
 *  - Live Classroom Group Assignment Card (#stu-group-card)
 *  - Permanent Student ID Lock after first onboarding (hides input & button)
 *  - Pre-Check & Activate GPS Panel (#gps-panel) with Live High-Accuracy Warm-Up (No GPS Caching)
 *  - Instant 2-Step Address Bar Permission Guide (#gps-permission-guide-box) & Live Permission Recovery
 *  - Anti-Spam Submission Lock (`isSubmitting`) & Today's Verified Receipt Card
 * ============================================================================
 */

let isSubmitting = false;
let isCheckingGps = false;
let checkInCooldownTimer = null;
let stuAttHistoryExpanded = false;
let studentLivePollTimer = null;
let lastStudentWakeSyncMs = 0;
window.cachedGPS = null; // Kept null so check-in always verifies fresh live GPS
window.lockedRound2GpsPos = null; // Pre-locked live GPS coordinate during Round 2 10-second PIN entry
window.pinBoxOpenedAtMs = 0;
window.pinFirstKeyAtMs = 0;
window.pinLastCleanVal = '';

document.addEventListener('visibilitychange', () => {
  if (document.hidden && !isSubmitting) {
    const pinBox = document.getElementById('stu-p2-pin-box');
    if (pinBox && !pinBox.classList.contains('hidden')) {
      cancelStudentPin10sModal();
      showStatus(
        currentLang === 'en'
          ? 'PIN pad closed because you left the browser. Please check the projector and tap again.'
          : 'Đã đóng khung nhập PIN do bạn rời trình duyệt. Vui lòng nhìn bảng chiếu và bấm lại.',
        'warn',
        'checkin-inline-status'
      );
    }
  } else if (!document.hidden && currentMode === 'STUDENT') {
    const now = Date.now();
    if (now - lastStudentWakeSyncMs > 1000 && typeof syncStudentLiveScheduleFromServer === 'function') {
      lastStudentWakeSyncMs = now;
      syncStudentLiveScheduleFromServer();
    }
  }
});

window.addEventListener('pageshow', () => {
  if (!document.hidden && currentMode === 'STUDENT') {
    const now = Date.now();
    if (now - lastStudentWakeSyncMs > 1000 && typeof syncStudentLiveScheduleFromServer === 'function') {
      lastStudentWakeSyncMs = now;
      syncStudentLiveScheduleFromServer();
    }
  }
});

window.addEventListener('DOMContentLoaded', () => {
  getOrCreateDeviceCredential();
  if (typeof ensureDeviceVaultReady === 'function') {
    ensureDeviceVaultReady();
  }
  migrateStoredUrls();

  const teaApiInput = document.getElementById('inp-tea-api');
  if (teaApiInput) teaApiInput.value = DEFAULT_LECTURER_API;

  applyLanguage();
  checkIosStandaloneNotice();
  handleUrlDeepLinks();
  renderStudentCourseSelectors();
  if (typeof watchBrowserLocationPermission === 'function') {
    watchBrowserLocationPermission();
  }

  const urlParams = new URLSearchParams(window.location.search);
  if (!urlParams.get('onboard') && !urlParams.get('pair') && safeGetLocal('cc_active_mode', 'STUDENT') === 'TEACHER' && getTeacherAuth()) {
    switchMode('TEACHER');
  } else {
    syncStudentViewportScrollLock();
  }
  syncStudentLiveScheduleFromServer();
  startStudentLiveSessionPolling();
});

function startStudentLiveSessionPolling() {
  if (studentLivePollTimer) clearInterval(studentLivePollTimer);
  studentLivePollTimer = setInterval(() => {
    if (!document.hidden && currentMode === 'STUDENT' && !isSubmitting) {
      syncStudentLiveScheduleFromServer();
    }
  }, 5000);
}

/**
 * Fetches live Google Calendar & Period Schedule metadata from Backend in background
 * while preserving 100% of existing student profile data.
 */
async function syncStudentLiveScheduleFromServer() {
  const profiles = getStudentProfiles();
  const instIds = Object.keys(profiles);
  const activeInst = safeGetLocal('cc_active_inst', instIds[0] || '');
  const activeProfile = profiles[activeInst];
  const apiUrl = activeProfile ? activeProfile.apiUrl : DEFAULT_LECTURER_API;

  try {
    const pingPayload = { action: 'PING' };
    if (activeProfile && activeProfile.studentId) {
      pingPayload.studentId = activeProfile.studentId;
    }
    const pingRes = await callBackend(apiUrl, pingPayload, 1);
    if (pingRes && pingRes.ok) {
      ingestServerScheduleData(pingRes);
      // Merge any updated class metadata (such as scheduleInfo / sessionOpenNow / attendanceStats) into stored enrolledClasses
      if (activeProfile && Array.isArray(pingRes.classes) && Array.isArray(activeProfile.enrolledClasses)) {
        const serverClassMap = {};
        pingRes.classes.forEach(sc => {
          if (sc && sc.classId) serverClassMap[sc.classId] = sc;
        });
        const statsMap = (pingRes.studentStats && typeof pingRes.studentStats === 'object') ? pingRes.studentStats : {};
        activeProfile.enrolledClasses = activeProfile.enrolledClasses.map(ec => {
          const sc = serverClassMap[ec.classId];
          const st = statsMap[ec.classId] || ec.attendanceStats || null;
          return sc ? Object.assign({}, ec, {
            className: sc.className || ec.className,
            scheduleInfo: sc.scheduleInfo || ec.scheduleInfo,
            sessionOpenNow: Boolean(sc.sessionOpenNow),
            activeRound: Number(sc.activeRound || 1),
            activeSessionId: String(sc.activeSessionId || ''),
            activeQrMode: String(sc.activeQrMode || 'STATIC'),
            round2OpenedToday: Boolean(sc.round2OpenedToday),
            activeGroupSplit: sc.activeGroupSplit !== undefined ? sc.activeGroupSplit : (ec.activeGroupSplit || null),
            attendanceStats: st
          }) : Object.assign({}, ec, { attendanceStats: st });
        });
        saveStudentProfile(activeInst, activeProfile);
      }
      if (currentMode === 'STUDENT' && instIds.length > 0) {
        const pinBox = document.getElementById('stu-p2-pin-box');
        const isPinBoxOpen = Boolean(pinBox && !pinBox.classList.contains('hidden'));
        if (isPinBoxOpen) {
          const selClassEl = document.getElementById('sel-student-class');
          const curClassId = selClassEl ? selClassEl.value : '';
          const activeCls = (activeProfile && Array.isArray(activeProfile.enrolledClasses))
            ? activeProfile.enrolledClasses.find(c => c && c.classId === curClassId)
            : null;
          if (activeCls && activeCls.sessionOpenNow && Number(activeCls.activeRound || 1) === 2) {
            if (String(activeCls.activeQrMode || 'STATIC').toUpperCase() !== 'PIN_10S') {
              const savedGps = window.lockedRound2GpsPos;
              cancelStudentPin10sModal();
              if (!isSubmitting) {
                executeStudentCheckIn('BUTTON_GPS_CHECKIN', savedGps);
              }
            }
            return;
          }
          cancelStudentPin10sModal();
        }
        onStudentInstChange(true);
      }
    }
  } catch (e) {}
}

function renderStudentCourseSelectors() {
  const profiles = getStudentProfiles();
  const instIds = Object.keys(profiles);
  const hasBox = document.getElementById('student-has-courses');
  const noBox = document.getElementById('student-no-courses');
  const addBox = document.getElementById('box-add-course');
  const inpId = document.getElementById('inp-student-id');
  const lblId = document.getElementById('lbl-student-id');
  const btnSubmit = document.getElementById('btn-submit-onboard');
  const rulesBox = document.getElementById('onboard-compact-rules');

  if (instIds.length === 0) {
    hasBox.classList.add('hidden');
    noBox.classList.remove('hidden');
    addBox.classList.remove('hidden');
    if (rulesBox) rulesBox.classList.remove('hidden');
    if (inpId) {
      inpId.disabled = false;
      inpId.readOnly = false;
      inpId.classList.remove('hidden');
    }
    if (lblId) lblId.classList.remove('hidden');
    if (btnSubmit) {
      btnSubmit.disabled = false;
      btnSubmit.classList.remove('hidden');
    }
    renderStudentAttendanceSummary('', '');
    return;
  }

  // Once Student ID is entered and linked, permanently lock and hide the MSSV input & submit button
  hasBox.classList.remove('hidden');
  noBox.classList.add('hidden');
  addBox.classList.add('hidden');
  if (rulesBox) {
    const ac = evaluateStudentAntiCheat();
    rulesBox.classList.toggle('hidden', Boolean(ac && ac.browserOk));
  }
  if (inpId) {
    inpId.disabled = true;
    inpId.readOnly = true;
    inpId.classList.add('hidden');
  }
  if (lblId) lblId.classList.add('hidden');
  if (btnSubmit) {
    btnSubmit.disabled = true;
    btnSubmit.classList.add('hidden');
  }

  const selInst = document.getElementById('sel-student-inst');
  const lblInst = document.getElementById('lbl-student-inst');
  const showMultiLecturer = instIds.length > 1;
  selInst.classList.toggle('hidden', !showMultiLecturer);
  if (lblInst) lblInst.classList.toggle('hidden', !showMultiLecturer);

  let activeInst = safeGetLocal('cc_active_inst', instIds[0]);
  if (!profiles[activeInst]) activeInst = instIds[0];
  selInst.innerHTML = instIds.map(id => {
    const p = profiles[id];
    return `<option value="${escapeHtml(id)}" ${id === activeInst ? 'selected' : ''}>${escapeHtml(p.lecturerName)} (${escapeHtml(p.studentId)})</option>`;
  }).join('');
  selInst.value = activeInst;

  const hasExistingSel = Boolean(document.getElementById('sel-student-class') && document.getElementById('sel-student-class').value);
  onStudentInstChange(hasExistingSel);
}

function onStudentInstChange(preserveManualSelection = false) {
  const profiles = getStudentProfiles();
  const instIds = Object.keys(profiles);
  const selInstEl = document.getElementById('sel-student-inst');
  const selInst = (selInstEl && selInstEl.value && profiles[selInstEl.value]) ? selInstEl.value : (instIds[0] || '');
  const p = profiles[selInst];
  if (!p) return;

  safeSetLocal('cc_active_inst', selInst);
  const selClass = document.getElementById('sel-student-class');
  const currentSelectedVal = preserveManualSelection ? selClass.value : '';

  const enrolled = (p.enrolledClasses || []).filter(
    c => c && !REMOVED_SAMPLE_CLASSES.includes(String(c.classId || '').trim().toUpperCase())
  );

  // Resolve real-time class from Google Calendar / Period Slots (123, 456, 789, 10-12, 13-15) / CLASS_SCHEDULE
  // If outside scheduled hours and no session is open, default to "" (-- Chưa chọn lớp - Ngoài khung giờ --)
  const scheduleMatch = resolveActiveClassBySchedule(enrolled, new Date());
  const openSesClass = enrolled.find(c => c && c.sessionOpenNow);
  const autoClassId = preserveManualSelection && currentSelectedVal
    ? currentSelectedVal
    : (scheduleMatch.matchedClassId || (openSesClass ? openSesClass.classId : ''));

  const unselectedLabel = I18N[currentLang].stu_unselected_class_opt || '-- Chưa chọn lớp - Ngoài khung giờ --';
  const optionsHtml = [
    `<option value="" ${autoClassId === '' ? 'selected' : ''}>${escapeHtml(unselectedLabel)}</option>`
  ].concat(
    enrolled.map(c => {
      const isSelected = c.classId === autoClassId;
      const openTag = c.sessionOpenNow
        ? (currentLang === 'en' ? ' [SESSION OPEN]' : ' [ĐANG MỞ ĐIỂM DANH]')
        : '';
      return `<option value="${escapeHtml(c.classId)}" ${isSelected ? 'selected' : ''}>${escapeHtml(formatClassOptionLabel(c) + openTag)}</option>`;
    })
  );

  selClass.innerHTML = optionsHtml.join('');
  selClass.value = autoClassId;
  updateStudentClassSelectionUI(selInst, scheduleMatch);

  selClass.onchange = () => {
    if (selClass.value) {
      safeSetLocal('cc_last_class_' + selInst, selClass.value);
    }
    updateStudentClassSelectionUI(selInst, scheduleMatch);
  };

  document.getElementById('stu-bound-info').textContent =
    currentLang === 'en'
      ? `${p.fullName} — Student ID: ${p.studentId}`
      : `${p.fullName} — Mã số sinh viên: ${p.studentId}`;
}

function updateStudentClassSelectionUI(instId, scheduleMatch) {
  const selClass = document.getElementById('sel-student-class');
  const hintBar = document.getElementById('stu-schedule-hint');
  const selectedClassId = selClass ? selClass.value : '';

  if (selClass) {
    selClass.classList.toggle('unselected-warning', !selectedClassId);
  }

  if (hintBar) {
    if (scheduleMatch && !scheduleMatch.isOffHours && scheduleMatch.matchedClassId) {
      hintBar.className = 'schedule-hint-bar matched';
      hintBar.textContent = currentLang === 'en'
        ? `Scheduled class: ${scheduleMatch.label}`
        : `Theo lịch học: ${scheduleMatch.label}`;
      hintBar.classList.remove('hidden');
    } else if (!selectedClassId) {
      hintBar.className = 'schedule-hint-bar off-hours';
      hintBar.textContent = currentLang === 'en'
        ? 'Outside scheduled hours — Please select a class section manually.'
        : 'Ngoài giờ lịch học — Vui lòng chọn lớp học phần thủ công.';
      hintBar.classList.remove('hidden');
    } else {
      hintBar.className = 'schedule-hint-bar';
      hintBar.textContent = currentLang === 'en'
        ? `Selected class: ${selectedClassId}`
        : `Lớp đang chọn: ${selectedClassId}`;
      hintBar.classList.remove('hidden');
    }
  }

  renderStudentAttendanceSummary(instId, selectedClassId);
  renderTodayStudentReceipt(selectedClassId);
}

function normalizeSessionDayKey(sessionKey) {
  const raw = String(sessionKey || '').trim();
  if (!raw) return getTodayDateKey();
  // Match SES_<classId>_20261103_151600 or HIST_<classId>_20261020 -> 2026-11-03
  const mSes = raw.match(/_(\d{4})(\d{2})(\d{2})(?:_|$)/);
  if (mSes) return `${mSes[1]}-${mSes[2]}-${mSes[3]}`;
  // Match 2026-11-03
  const mIso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (mIso) return `${mIso[1]}-${mIso[2]}-${mIso[3]}`;
  // Match 03/11/2026
  const mDmy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mDmy) {
    return `${mDmy[3]}-${String(mDmy[2]).padStart(2, '0')}-${String(mDmy[1]).padStart(2, '0')}`;
  }
  return raw;
}

function formatDisplayDateFromKey(dayKey) {
  const norm = normalizeSessionDayKey(dayKey);
  const m = norm.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatNowTimeHhMmSs() {
  const d = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function recordLocalStudentSessionMark(studentId, classId, sessionKey, status, timeStr = '') {
  const sid = String(studentId || '').trim().toUpperCase();
  const cid = String(classId || '').trim();
  const dayKey = normalizeSessionDayKey(sessionKey);
  const st = String(status || '').trim().toUpperCase();
  if (!sid || !cid || !dayKey) return;

  const storageKey = `cc_stu_att_marks_${sid}_${cid}`;
  let map = {};
  try {
    const raw = safeGetLocal(storageKey, null);
    if (raw) map = JSON.parse(raw) || {};
  } catch (e) {
    map = {};
  }

  if (st === 'P' || st === 'L' || st === 'E' || st === 'A' || st === '-') {
    const normalizedStatus = st === '-' ? 'A' : st;
    const prev = map[dayKey];
    const prevTime = (prev && typeof prev === 'object' && prev.time) ? prev.time : '';
    map[dayKey] = {
      status: normalizedStatus,
      date: formatDisplayDateFromKey(dayKey),
      time: timeStr || prevTime || formatNowTimeHhMmSs(),
      ts: (prev && typeof prev === 'object' && prev.ts) ? prev.ts : Date.now()
    };
    safeSetLocal(storageKey, JSON.stringify(map));
  }
}

function getLocalStudentAttendanceHistory(studentId, classId) {
  const sid = String(studentId || '').trim().toUpperCase();
  const cid = String(classId || '').trim();
  if (!sid || !cid) return [];

  // Ensure today's receipt (if any) is synced into local marks
  try {
    const todayRecRaw = safeGetLocal(`cc_receipt_${cid}_${getTodayDateKey()}`, null);
    if (todayRecRaw) {
      const rec = JSON.parse(todayRecRaw);
      if (rec && (!rec.studentId || String(rec.studentId).trim().toUpperCase() === sid) && rec.status) {
        recordLocalStudentSessionMark(sid, cid, getTodayDateKey(), rec.status, rec.time || '');
      }
    }
  } catch (e) {}

  let localMap = {};
  try {
    const raw = safeGetLocal(`cc_stu_att_marks_${sid}_${cid}`, null);
    if (raw) localMap = JSON.parse(raw) || {};
  } catch (e) {
    localMap = {};
  }

  const list = [];
  Object.keys(localMap).forEach(k => {
    const item = localMap[k];
    if (!item) return;
    if (typeof item === 'string') {
      list.push({
        dayKey: k,
        status: item === '-' ? 'A' : item,
        date: formatDisplayDateFromKey(k),
        time: '',
        ts: 0
      });
    } else if (typeof item === 'object' && item.status) {
      list.push({
        dayKey: k,
        status: item.status === '-' ? 'A' : item.status,
        date: item.date || formatDisplayDateFromKey(k),
        time: item.time || '',
        ts: Number(item.ts || 0)
      });
    }
  });

  list.sort((a, b) => {
    if (b.dayKey !== a.dayKey) return b.dayKey.localeCompare(a.dayKey);
    return b.ts - a.ts;
  });
  return list;
}

function computeAttendanceScoreAndExamStatus(countP, countL, countE, countA, manualExamBan = false) {
  const p = Number(countP || 0);
  const l = Number(countL || 0);
  const e = Number(countE || 0);
  const a = Number(countA || 0);
  const equivAbsences = Math.round((a + (e * 0.5)) * 10) / 10;
  const attendanceScore = Math.round((10.0 - (a * 1.0) - (l * 0.5) - (e * 0.5)) * 10) / 10;
  const isBanned = Boolean(manualExamBan) || (equivAbsences > 6.0) || (attendanceScore < 0.0);
  const isWarn = !isBanned && ((equivAbsences >= 5.5 && equivAbsences <= 6.0) || (attendanceScore >= 0.0 && attendanceScore <= 1.0));
  return {
    P: p,
    L: l,
    E: e,
    A: a,
    total: p + l + e + a,
    equivAbsences,
    attendanceScore,
    manualExamBan: Boolean(manualExamBan),
    examStatus: isBanned ? 'BAN' : (isWarn ? 'WARN' : 'OK')
  };
}

function getMergedStudentClassStats(studentId, classId, serverStats) {
  const sid = String(studentId || '').trim().toUpperCase();
  const cid = String(classId || '').trim();
  const srv = (serverStats && typeof serverStats === 'object')
    ? serverStats
    : { P: 0, L: 0, E: 0, A: 0, total: 0, manualExamBan: false, history: [] };

  if (!sid || !cid) {
    const base = computeAttendanceScoreAndExamStatus(srv.P, srv.L, srv.E, srv.A, srv.manualExamBan);
    base.history = [];
    return base;
  }

  // Merge sheet history (already deduplicated by dayKey on backend) + local device history by calendar dayKey
  // Strictly show only past/completed sessions that exist on the Sheet schedule, hiding future & accidental dates
  const todayKey = getTodayDateKey();
  const courseDates = (typeof getClassCourseSessionDates === 'function')
    ? getClassCourseSessionDates(cid, null)
    : [];
  const allowedSheetSet = new Set(courseDates.map(cd => cd.dayKey));
  const hasSheetSchedule = allowedSheetSet.size > 0;

  const dayMap = {};
  if (Array.isArray(srv.history)) {
    srv.history.forEach(item => {
      if (!item) return;
      const dKey = normalizeSessionDayKey(item.dayKey || item.date || item.sessionId || '');
      if (!dKey) return;
      const rawSt = String(item.status || '-').trim().toUpperCase();
      if (rawSt === 'OPEN') return;
      if (/^\d{4}-\d{2}-\d{2}$/.test(dKey) && dKey > todayKey && rawSt !== 'P' && rawSt !== 'L' && rawSt !== 'E') {
        return;
      }
      if (hasSheetSchedule && /^\d{4}-\d{2}-\d{2}$/.test(dKey) && !allowedSheetSet.has(dKey)) {
        return;
      }
      const normSt = (rawSt === '-' || rawSt === 'X') ? 'A' : rawSt;
      dayMap[dKey] = {
        dayKey: dKey,
        status: normSt,
        date: item.date || formatDisplayDateFromKey(dKey),
        time: item.time || '',
        ts: 0,
        fromServer: true
      };
    });
  }

  const localHistory = getLocalStudentAttendanceHistory(sid, cid);
  localHistory.forEach(item => {
    if (!item || !item.dayKey) return;
    const dKey = normalizeSessionDayKey(item.dayKey);
    if (hasSheetSchedule && /^\d{4}-\d{2}-\d{2}$/.test(dKey) && !allowedSheetSet.has(dKey)) {
      return;
    }
    const localSt = item.status === '-' ? 'A' : item.status;
    const existing = dayMap[dKey];
    if (!existing) {
      dayMap[dKey] = {
        dayKey: dKey,
        status: localSt,
        date: item.date || formatDisplayDateFromKey(dKey),
        time: item.time || '',
        ts: Number(item.ts || 0),
        fromServer: false
      };
    } else {
      // Server 'E' or 'P' approved on sheet takes priority; local check-in upgrades 'A' if checked in today
      let mergedSt = existing.status;
      if (localSt === 'P' || existing.status === 'P') mergedSt = 'P';
      else if (localSt === 'E' || existing.status === 'E') mergedSt = 'E';
      else if (localSt === 'L' || existing.status === 'L') mergedSt = 'L';
      dayMap[dKey] = {
        dayKey: dKey,
        status: mergedSt,
        date: existing.date || item.date || formatDisplayDateFromKey(dKey),
        time: item.time || existing.time || '',
        ts: Math.max(Number(item.ts || 0), Number(existing.ts || 0)),
        fromServer: true
      };
    }
  });

  const mergedHistory = Object.values(dayMap).sort((a, b) => {
    if (b.dayKey !== a.dayKey) return b.dayKey.localeCompare(a.dayKey);
    return b.ts - a.ts;
  });

  let histP = 0, histL = 0, histE = 0, histA = 0;
  mergedHistory.forEach(item => {
    const v = item.status;
    if (v === 'P') histP++;
    else if (v === 'L') histL++;
    else if (v === 'E') histE++;
    else if (v === 'A') histA++;
  });

  const srvTotal = Number(srv.P || 0) + Number(srv.L || 0) + Number(srv.E || 0) + Number(srv.A || 0);
  const histTotal = histP + histL + histE + histA;

  const finalP = srvTotal > histTotal ? Math.max(Number(srv.P || 0), histP) : (histTotal > 0 ? histP : Number(srv.P || 0));
  const finalL = srvTotal > histTotal ? Math.max(Number(srv.L || 0), histL) : (histTotal > 0 ? histL : Number(srv.L || 0));
  const finalE = srvTotal > histTotal ? Math.max(Number(srv.E || 0), histE) : (histTotal > 0 ? histE : Number(srv.E || 0));
  const finalA = srvTotal > histTotal ? Math.max(Number(srv.A || 0), histA) : (histTotal > 0 ? histA : Number(srv.A || 0));

  const computed = computeAttendanceScoreAndExamStatus(finalP, finalL, finalE, finalA, srv.manualExamBan);
  computed.history = mergedHistory;
  return computed;
}

function updateStoredStudentClassStats(instId, classId, statsObj) {
  if (!instId || !classId || !statsObj) return;
  const profiles = getStudentProfiles();
  const p = profiles[instId];
  if (!p || !Array.isArray(p.enrolledClasses)) return;
  p.enrolledClasses = p.enrolledClasses.map(ec =>
    ec && ec.classId === classId ? Object.assign({}, ec, { attendanceStats: statsObj }) : ec
  );
  saveStudentProfile(instId, p);
}

function toggleStudentAttendanceHistory() {
  stuAttHistoryExpanded = !stuAttHistoryExpanded;
  const selClassEl = document.getElementById('sel-student-class');
  renderStudentAttendanceSummary('', selClassEl ? selClassEl.value : '');
}

function renderStudentGroupCard(studentId, classObj) {
  const card = document.getElementById('stu-group-card');
  if (!card) return;
  const sid = String(studentId || '').trim().toUpperCase();
  const split = classObj && classObj.activeGroupSplit ? classObj.activeGroupSplit : null;
  const splitDayKey = split && split.publishedAt ? String(split.publishedAt).slice(0, 10) : '';
  if (!sid || !split || !Array.isArray(split.groups) || split.groups.length === 0 || (splitDayKey && splitDayKey !== getTodayDateKey())) {
    card.classList.add('hidden');
    card.innerHTML = '';
    return;
  }

  const myGroup = split.groups.find(g =>
    g && Array.isArray(g.members) && g.members.some(m => String(m.studentId || '').trim().toUpperCase() === sid)
  );
  if (!myGroup) {
    card.classList.add('hidden');
    card.innerHTML = '';
    return;
  }

  const isEn = currentLang === 'en';
  const memberNames = (myGroup.members || []).map(m => {
    const isMe = String(m.studentId || '').trim().toUpperCase() === sid;
    return isMe ? `<strong>${escapeHtml(m.fullName)} (${isEn ? 'You' : 'Bạn'})</strong>` : escapeHtml(m.fullName);
  }).join(' • ');

  card.innerHTML = `
    <div class="stu-group-header">
      <span>${isEn ? `Assigned Discussion Group: Group #${myGroup.groupNumber}` : `Nhóm thảo luận trên lớp: Nhóm ${myGroup.groupNumber}`}</span>
      <span>${(myGroup.members || []).length} ${isEn ? 'members' : 'thành viên'}</span>
    </div>
    <div class="stu-group-members">${memberNames}</div>
  `;
  card.classList.remove('hidden');
}

function renderStudentAttendanceSummary(instId, classId) {
  const bar = document.getElementById('stu-attendance-summary');
  if (!bar) return;

  const profiles = getStudentProfiles();
  const instIds = Object.keys(profiles);
  // Support both renderStudentAttendanceSummary(instId, classId) and renderStudentAttendanceSummary(classId)
  if (classId === undefined && instId && !profiles[instId]) {
    classId = instId;
    instId = '';
  }
  const activeInst = (instId && profiles[instId]) ? instId : safeGetLocal('cc_active_inst', instIds[0] || '');
  const p = profiles[activeInst];

  let targetStudentId = p ? p.studentId : '';
  let targetClassId = classId || '';
  let serverStats = null;
  let activeClassObj = null;

  if (p && Array.isArray(p.enrolledClasses) && p.enrolledClasses.length > 0) {
    if (!targetClassId) {
      targetClassId = safeGetLocal('cc_last_class_' + activeInst, '') || p.enrolledClasses[0].classId;
    }
    const cls = p.enrolledClasses.find(c => c && c.classId === targetClassId) || p.enrolledClasses[0];
    if (cls) {
      activeClassObj = cls;
      targetClassId = cls.classId;
      serverStats = cls.attendanceStats || null;
    }
  }

  // If Lecturer is testing on the same browser and just marked a student in Lecturer mode, allow live preview sync
  if (typeof getTeacherAuth === 'function' && getTeacherAuth()) {
    try {
      const lastPreviewRaw = safeGetLocal('cc_tea_last_preview_mark', null);
      if (lastPreviewRaw) {
        const preview = JSON.parse(lastPreviewRaw);
        if (preview && preview.studentId && preview.classId) {
          if (p && p.studentId === preview.studentId && (!targetClassId || preview.classId === targetClassId)) {
            targetClassId = preview.classId;
          }
        }
      }
    } catch (e) {}
  }

  renderStudentGroupCard(targetStudentId, activeClassObj);

  const st = getMergedStudentClassStats(targetStudentId, targetClassId, serverStats);
  const countP = Number(st.P || 0);
  const countL = Number(st.L || 0);
  const countE = Number(st.E || 0);
  const countA = Number(st.A || 0);
  const scoreVal = typeof st.attendanceScore === 'number' ? st.attendanceScore : 10.0;
  const equivVal = typeof st.equivAbsences === 'number' ? st.equivAbsences : 0;
  const examStatus = st.examStatus || 'OK';
  const isEn = currentLang === 'en';
  const historyList = Array.isArray(st.history) ? st.history : [];

  bar.classList.remove('att-warn-light', 'att-ban-solid');
  if (examStatus === 'BAN') {
    bar.classList.add('att-ban-solid');
  } else if (examStatus === 'WARN') {
    bar.classList.add('att-warn-light');
  }

  let warningBannerHtml = '';
  if (examStatus === 'BAN') {
    const banReason = st.manualExamBan
      ? (isEn
          ? `Marked ineligible for exam on official class sheet (Score: ${scoreVal}/10 • Equiv. absences: ${equivVal}x)`
          : `Đã xử lý cấm thi trên danh sách lớp (Điểm CC: ${scoreVal}đ • Vắng quy đổi: ${equivVal} buổi)`)
      : (isEn
          ? `Score: ${scoreVal}/10 • Equivalent absences: ${equivVal}/6.0 sessions (Exceeds permitted limit)`
          : `Điểm chuyên cần: ${scoreVal}đ • Vắng quy đổi: ${equivVal}/6 buổi (Vượt mức quy định)`);
    warningBannerHtml = `
      <div id="stu-att-warning-banner" class="stu-att-warning-banner">
        <span class="exam-ban-badge">${isEn ? 'EXAM BANNED (CẤM THI)' : 'CẤM THI'}</span>
        <span>${escapeHtml(banReason)}</span>
      </div>
    `;
  } else if (examStatus === 'WARN') {
    const warnText = isEn
      ? `Score: ${scoreVal}/10 • Equiv. absences: ${equivVal}/6.0 sessions — Near exam ban threshold!`
      : `Điểm chuyên cần: ${scoreVal}đ • Vắng quy đổi: ${equivVal}/6 buổi — Cảnh báo sát mức cấm thi!`;
    warningBannerHtml = `
      <div id="stu-att-warning-banner" class="stu-att-warning-banner">
        <span class="exam-warn-badge">${isEn ? 'WARNING' : 'CẢNH BÁO'}</span>
        <span>${escapeHtml(warnText)}</span>
      </div>
    `;
  } else {
    warningBannerHtml = `<div id="stu-att-warning-banner" class="stu-att-warning-banner hidden"></div>`;
  }

  function formatStatusRowBadge(statusChar) {
    if (statusChar === 'P') {
      return `<span class="att-dot dot-p"></span><span>${isEn ? 'Present' : 'Có mặt'}</span>`;
    }
    if (statusChar === 'L') {
      return `<span class="att-dot dot-l"></span><span>${isEn ? 'Late (-0.5pt)' : 'Đi trễ (-0.5đ)'}</span>`;
    }
    if (statusChar === 'E') {
      return `<span class="att-dot dot-e"></span><span>${isEn ? 'Excused (-0.5pt, 0.5x)' : 'Có phép (-0.5đ, 0.5x)'}</span>`;
    }
    return `<span class="att-dot dot-a"></span><span>${isEn ? 'Absent (-1.0pt, 1x)' : 'Vắng (-1.0đ, 1x)'}</span>`;
  }

  const scoreMetaRowHtml = `
    <div class="att-history-row" style="font-weight:700;">
      <span class="att-history-time">${isEn ? 'Attendance Score' : 'Điểm chuyên cần'}: ${scoreVal} / 10</span>
      <span class="att-history-status">${isEn ? 'Equiv. Absences' : 'Vắng quy đổi'}: ${equivVal} / 6.0</span>
    </div>
  `;

  const historyRowsHtml = historyList.length > 0
    ? historyList.map(item => {
        const timePart = item.time ? ` • ${escapeHtml(item.time)}` : '';
        return `
          <div class="att-history-row">
            <span class="att-history-time">${escapeHtml(item.date)}${timePart}</span>
            <span class="att-history-status">${formatStatusRowBadge(item.status)}</span>
          </div>
        `;
      }).join('')
    : `<div class="att-history-empty">${isEn ? 'No attendance sessions recorded yet.' : 'Chưa có dữ liệu buổi điểm danh nào.'}</div>`;

  const historyHtml = scoreMetaRowHtml + historyRowsHtml;

  bar.classList.toggle('expanded', stuAttHistoryExpanded);
  bar.innerHTML = `
    <div class="stu-att-header-row">
      <div class="stu-att-chips">
        <span class="att-stat-item"><span class="att-dot dot-p"></span><span>${isEn ? 'Present' : 'Có mặt'}:</span> <strong>${countP}</strong></span>
        <span class="att-stat-item"><span class="att-dot dot-l"></span><span>${isEn ? 'Late' : 'Đi trễ'}:</span> <strong>${countL}</strong></span>
        <span class="att-stat-item"><span class="att-dot dot-e"></span><span>${isEn ? 'Excused' : 'Có phép'}:</span> <strong>${countE}</strong></span>
        <span class="att-stat-item"><span class="att-dot dot-a"></span><span>${isEn ? 'Absent' : 'Vắng'}:</span> <strong>${countA}</strong></span>
      </div>
      <svg class="att-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
    </div>
    ${warningBannerHtml}
    <div id="stu-att-history-drawer" class="stu-att-history-drawer ${stuAttHistoryExpanded ? '' : 'hidden'}">
      ${historyHtml}
    </div>
  `;
  bar.classList.remove('hidden');
}

function toggleAddCourseBox() {
  const profiles = getStudentProfiles();
  if (Object.keys(profiles).length > 0) {
    // Once MSSV is bound, do not allow opening the MSSV input box again
    document.getElementById('box-add-course').classList.add('hidden');
    return;
  }
  document.getElementById('box-add-course').classList.toggle('hidden');
  syncStudentViewportScrollLock();
}

/**
 * ============================================================================
 * REQUIREMENT 3: PRE-CHECK & ACTIVATE GPS PANEL (#gps-panel)
 *  - Streamlined single-line GPS status readout (#gps-dot + #gps-readout) with zero repetition.
 *  - Does NOT cache/store old coordinates (`window.cachedGPS = null`), preventing walk-away cheating.
 *  - Checks browser environment and warns if Precise Location (Vị trí chính xác) is off (`accuracy > 100m`).
 * ============================================================================
 */
async function handleStudentPreCheckGps() {
  if (isCheckingGps) return;
  isCheckingGps = true;

  const dot = document.getElementById('gps-dot');
  const readout = document.getElementById('gps-readout');
  const btn = document.getElementById('btn-check-gps');

  const check = evaluateStudentAntiCheat();
  if (!check.browserOk) {
    isCheckingGps = false;
    checkIosStandaloneNotice();
    if (dot) dot.className = 'status-dot dot-err';
    const isAppleQr = check.webViewType === 'APPLE_CODE_SCANNER';
    if (readout) {
      readout.textContent = currentLang === 'en'
        ? (isAppleQr ? 'iPhone Code Scanner blocked (Open Safari)' : 'In-app browser blocked (Open Safari/Chrome)')
        : (isAppleQr ? 'Đang mở bằng Trình quét mã iPhone (Hãy mở Safari)' : 'Đang mở trong Zalo/Messenger (Hãy mở Safari/Chrome)');
    }
    showStatus(
      currentLang === 'en'
        ? (isAppleQr
            ? 'Do not use iPhone Code Scanner (auto-wipes storage). Please copy link above and open in Safari.'
            : 'Do not check in inside Zalo or Messenger. Please open your main browser (Safari, Chrome).')
        : (isAppleQr
            ? 'Không dùng "Trình quét mã" của iPhone (tự xóa bộ nhớ). Hãy bấm Sao chép link phía trên và mở bằng Safari.'
            : 'Không điểm danh trong Zalo/Messenger. Hãy mở bằng trình duyệt chính (Safari, Chrome).'),
      'err',
      'checkin-inline-status'
    );
    return;
  }

  if (btn) btn.disabled = true;
  if (dot) dot.className = 'status-dot dot-busy';
  if (readout) {
    readout.textContent = currentLang === 'en'
      ? 'Checking GPS location...'
      : 'Đang kiểm tra định vị GPS...';
  }

  try {
    const pos = await getAccuratePosition();
    const spoofCheck = inspectGpsForSpoofing(pos);
    // Explicitly clear any cached coordinate so check-in always fetches fresh live GPS
    window.cachedGPS = null;

    if (spoofCheck.hardBlock) {
      if (dot) dot.className = 'status-dot dot-err';
      if (readout) {
        readout.textContent = currentLang === 'en'
          ? 'Invalid GPS signal detected.'
          : 'Tín hiệu định vị GPS không hợp lệ.';
      }
    } else {
      const accVal = Math.round(pos.coords.accuracy);
      if (accVal > 100) {
        if (dot) dot.className = 'status-dot dot-busy';
        if (readout) {
          readout.textContent = currentLang === 'en'
            ? `GPS accuracy is low (±${accVal}m) — Enable Precise Location`
            : `Sai số GPS đang lớn (±${accVal}m) — Hãy bật Vị trí chính xác`;
        }
        showStatus(
          currentLang === 'en'
            ? `Location is on, but accuracy is too coarse (±${accVal}m). Please enable "Precise Location" in your browser/phone settings and turn on Wi-Fi.`
            : `Đã mở Vị trí nhưng sai số đang quá lớn (±${accVal}m). Vui lòng bật mục "Vị trí chính xác" (Precise Location) trong cài đặt trình duyệt và bật Wi-Fi để điểm danh.`,
          'warn',
          'checkin-inline-status'
        );
        if (typeof pulseButtonConfirm === 'function') {
          pulseButtonConfirm(
            'btn-check-gps',
            currentLang === 'en' ? `LOW ACC (±${accVal}m)` : `SAI SỐ (±${accVal}m)`,
            'warn',
            1300
          );
        }
      } else {
        window.lastVerifiedLiveGps = { pos: pos, verifiedAtMs: Date.now() };
        if (dot) dot.className = 'status-dot dot-ok';
        if (readout) {
          readout.textContent = currentLang === 'en'
            ? `GPS ready (Accuracy ±${accVal}m)`
            : `Đã bật GPS (Sai số ±${accVal}m)`;
        }
        hideStatus('checkin-inline-status');
        if (typeof pulseButtonConfirm === 'function') {
          pulseButtonConfirm(
            'btn-check-gps',
            currentLang === 'en' ? `GPS OK (±${accVal}m)` : `GPS TỐT (±${accVal}m)`,
            'success',
            1300
          );
        }
      }
    }
  } catch (err) {
    window.cachedGPS = null;
    if (dot) dot.className = 'status-dot dot-err';
    if (err && err.code === 1) {
      if (readout) {
        readout.textContent = currentLang === 'en'
          ? 'Location permission blocked'
          : 'Chưa cấp quyền Vị trí';
      }
      if (typeof showGpsPermissionGuideBox === 'function') {
        showGpsPermissionGuideBox();
      }
      hideStatus('checkin-inline-status');
    } else {
      if (readout) {
        readout.textContent = currentLang === 'en'
          ? 'Weak GPS signal — Turn on Wi-Fi & Location'
          : 'Sóng GPS yếu — Hãy bật Wi-Fi & Vị trí';
      }
      if (typeof formatGpsErrorGuide === 'function') {
        showStatus(formatGpsErrorGuide(err), 'err', 'checkin-inline-status');
      }
    }
  } finally {
    isCheckingGps = false;
    if (btn) btn.disabled = false;
  }
}

/**
 * ============================================================================
 * STUDENT ONBOARDING (LINK STUDENT ID — ONE-TIME PERMANENT LOCK)
 * ============================================================================
 */
function promptStudentOnboardConfirm() {
  const existingProfiles = getStudentProfiles();
  if (Object.keys(existingProfiles).length > 0) {
    renderStudentCourseSelectors();
    return;
  }
  const check = evaluateStudentAntiCheat();
  if (!check.browserOk) {
    submitStudentOnboarding();
    return;
  }
  const studentId = document.getElementById('inp-student-id').value.trim().toUpperCase();
  if (!studentId) {
    showStatus(
      currentLang === 'en' ? 'Please enter your Student ID.' : 'Vui lòng nhập mã số sinh viên.',
      'err',
      'onboard-inline-status'
    );
    document.getElementById('inp-student-id').focus();
    return;
  }
  const isEn = currentLang === 'en';
  openConfirmModal(
    isEn ? 'Confirm Device Link' : 'Xác nhận Liên kết Thiết bị',
    isEn
      ? `Permanently bind this browser to Student ID [${studentId}]? Each phone/browser can only link to 1 Student ID.`
      : `Xác nhận liên kết cố định trình duyệt này với MSSV [${studentId}]? Mỗi thiết bị chỉ được gắn với 1 MSSV duy nhất.`,
    isEn ? 'Confirm Link' : 'Xác nhận liên kết',
    async () => {
      await submitStudentOnboarding();
    },
    {
      busyLabel: isEn ? 'Confirmed — Linking...' : 'Đã xác nhận — Đang liên kết...'
    }
  );
}

async function submitStudentOnboarding() {
  const existingProfiles = getStudentProfiles();
  if (Object.keys(existingProfiles).length > 0) {
    renderStudentCourseSelectors();
    return true;
  }

  const check = evaluateStudentAntiCheat();
  if (!check.browserOk) {
    checkIosStandaloneNotice();
    const isAppleQr = check.webViewType === 'APPLE_CODE_SCANNER';
    showStatus(
      currentLang === 'en'
        ? (isAppleQr
            ? 'Do not link your device inside iPhone Code Scanner (auto-wipes storage). Please copy link above and open in Safari.'
            : 'Please open in your main browser (Safari, Chrome, Edge), not inside Zalo or Messenger.')
        : (isAppleQr
            ? 'Không liên kết thiết bị trong "Trình quét mã" của iPhone (tự xóa bộ nhớ khi đóng). Hãy chép link phía trên và mở bằng Safari.'
            : 'Vui lòng mở bằng trình duyệt chính (Safari, Chrome, Cốc Cốc, Edge), không mở trong Zalo/Messenger.'),
      'err',
      'onboard-inline-status'
    );
    return false;
  }

  const apiUrl = normalizeApiUrl(window.customOnboardApiUrl || DEFAULT_LECTURER_API);
  const studentId = document.getElementById('inp-student-id').value.trim().toUpperCase();

  if (!studentId) {
    showStatus(
      currentLang === 'en' ? 'Please enter your Student ID.' : 'Vui lòng nhập mã số sinh viên.',
      'err',
      'onboard-inline-status'
    );
    return false;
  }

  const btnSubmit = document.getElementById('btn-submit-onboard');
  if (btnSubmit) btnSubmit.disabled = true;

  // Start getAccuratePosition() synchronously on click stack and retain in window.lastVerifiedLiveGps (15s max)
  // so if student tapped "ĐIỂM DANH NGAY" directly, line 1100 reuses this exact fix without firing a 2nd GPS call
  if (typeof getAccuratePosition === 'function') {
    getAccuratePosition()
      .then((pos) => {
        if (pos && pos.coords && pos.coords.accuracy <= 100) {
          window.lastVerifiedLiveGps = { pos: pos, verifiedAtMs: Date.now() };
        }
      })
      .catch(() => {});
  }

  showStatus(
    currentLang === 'en' ? 'Verifying Student ID with server...' : 'Đang xác thực mã số sinh viên với máy chủ...',
    'warn',
    'onboard-inline-status'
  );

  if (typeof ensureDeviceVaultReady === 'function') {
    await ensureDeviceVaultReady();
  }
  if (typeof detectPrivateBrowsingMode === 'function') {
    const privCheck = await detectPrivateBrowsingMode();
    if (privCheck && privCheck.isPrivate) {
      if (btnSubmit) btnSubmit.disabled = false;
      showStatus(I18N[currentLang].ERR_PRIVATE_BROWSING, 'err', 'onboard-inline-status');
      return false;
    }
  }

  const pingRes = await callBackend(apiUrl, { action: 'PING' });
  if (!pingRes || !pingRes.ok) {
    if (btnSubmit) btnSubmit.disabled = false;
    showStatus(
      currentLang === 'en' ? 'Cannot connect to server. Please check your network.' : 'Không kết nối được tới máy chủ. Vui lòng kiểm tra mạng.',
      'err',
      'onboard-inline-status'
    );
    return false;
  }

  const res = await callBackend(apiUrl, {
    action: 'STUDENT_ONBOARD',
    studentId: studentId,
    credential: getOrCreateDeviceCredential(),
    deviceFp: getHardwareFingerprint(),
    clientMeta: check
  });

  if (!res || !res.ok) {
    if (btnSubmit) btnSubmit.disabled = false;
    showStatus(formatServerMessage(res ? res.code : 'ERR_NETWORK', res ? res.params : {}, res ? res.message : ''), 'err', 'onboard-inline-status');
    return false;
  }

  saveStudentProfile(pingRes.installationId || DEFAULT_INST_ID, {
    installationId: pingRes.installationId || DEFAULT_INST_ID,
    lecturerName: pingRes.lecturerName || DEFAULT_LECTURER_NAME,
    apiUrl: apiUrl,
    studentId: res.studentId,
    fullName: res.fullName,
    enrolledClasses: res.enrolledClasses
  });

  hideStatus('onboard-inline-status');
  if (typeof pulseButtonConfirm === 'function') {
    await pulseButtonConfirm(
      'btn-submit-onboard',
      currentLang === 'en' ? 'DEVICE LINKED' : 'ĐÃ LIÊN KẾT THIẾT BỊ',
      'success',
      550
    );
  }
  document.getElementById('box-add-course').classList.add('hidden');
  renderStudentCourseSelectors();
  syncStudentViewportScrollLock();
  showStatus(formatServerMessage('ONBOARD_CONFIRMED', {
    name: res.fullName,
    id: res.studentId,
    count: (res.enrolledClasses || []).length
  }), 'success', 'checkin-inline-status');
  return true;
}

/**
 * ============================================================================
 * REQUIREMENT 3: STUDENT CHECK-IN WITH ANTI-SPAM LOCK & SEAMLESS GPS REUSE
 * ============================================================================
 */
function getSelectedStudentEnrolledClassObj(classId) {
  const profiles = getStudentProfiles();
  const instIds = Object.keys(profiles);
  const selInstEl = document.getElementById('sel-student-inst');
  const instId = (selInstEl && selInstEl.value && profiles[selInstEl.value]) ? selInstEl.value : safeGetLocal('cc_active_inst', instIds[0] || '');
  const p = profiles[instId];
  if (!p || !Array.isArray(p.enrolledClasses)) return null;
  const targetCid = classId || (document.getElementById('sel-student-class') ? document.getElementById('sel-student-class').value : '');
  return p.enrolledClasses.find(c => c && c.classId === targetCid) || null;
}

function focusStudentPin10Input() {
  const inp = document.getElementById('inp-stu-pin10');
  if (inp) {
    inp.focus();
  }
}

function renderStudentPin10Slots(val) {
  const clean = String(val || '').replace(/\D/g, '').slice(0, 4);
  for (let i = 0; i < 4; i++) {
    const slot = document.getElementById('stu-pin-slot-' + i);
    if (!slot) continue;
    const ch = clean.charAt(i) || '';
    slot.textContent = ch;
    slot.classList.toggle('filled', Boolean(ch));
    slot.classList.toggle('active', i === clean.length || (clean.length === 4 && i === 3));
  }
}

function openStudentPin10sBox(pos) {
  if (pos) {
    window.lockedRound2GpsPos = pos;
  }
  window.pinBoxOpenedAtMs = Date.now();
  window.pinFirstKeyAtMs = 0;
  window.pinLastCleanVal = '';
  const box = document.getElementById('stu-p2-pin-box');
  const banner = document.getElementById('stu-p2-pin-gps-banner');
  const inp = document.getElementById('inp-stu-pin10');
  const isEn = currentLang === 'en';
  const accVal = (window.lockedRound2GpsPos && window.lockedRound2GpsPos.coords && window.lockedRound2GpsPos.coords.accuracy)
    ? Math.round(window.lockedRound2GpsPos.coords.accuracy)
    : null;
  if (banner) {
    banner.textContent = isEn
      ? `GPS Locked${accVal ? ` (±${accVal}m)` : ''} • Enter 4 digits on projector`
      : `Đã khóa tọa độ GPS${accVal ? ` (±${accVal}m)` : ''} • Nhập 4 số trên bảng chiếu`;
  }
  if (inp) inp.value = '';
  renderStudentPin10Slots('');
  const heroBtn = document.getElementById('btn-start-checkin');
  if (heroBtn) heroBtn.classList.add('hidden');
  if (box) box.classList.remove('hidden');
  setTimeout(() => focusStudentPin10Input(), 40);
}

function cancelStudentPin10sModal() {
  const box = document.getElementById('stu-p2-pin-box');
  const inp = document.getElementById('inp-stu-pin10');
  if (inp) inp.value = '';
  window.pinBoxOpenedAtMs = 0;
  window.pinFirstKeyAtMs = 0;
  window.pinLastCleanVal = '';
  renderStudentPin10Slots('');
  if (box) box.classList.add('hidden');
  const heroBtn = document.getElementById('btn-start-checkin');
  if (heroBtn) heroBtn.classList.remove('hidden');
  window.lockedRound2GpsPos = null;
  const selClassEl = document.getElementById('sel-student-class');
  syncStudentCheckInButtonState(selClassEl ? selClassEl.value : '', false);
}

async function onStudentPin10Input(rawVal) {
  const clean = String(rawVal || '').replace(/\D/g, '').slice(0, 4);
  const inp = document.getElementById('inp-stu-pin10');
  const prevLen = (window.pinLastCleanVal || '').length;
  if (clean.length - prevLen > 1) {
    if (inp) inp.value = '';
    window.pinLastCleanVal = '';
    window.pinFirstKeyAtMs = 0;
    renderStudentPin10Slots('');
    showStatus(
      currentLang === 'en'
        ? 'Please type each digit directly from the projector (pasting is disabled).'
        : 'Vui lòng bấm trực tiếp từng chữ số trên bảng chiếu (không dán mã).',
      'warn',
      'checkin-inline-status'
    );
    return;
  }
  if (clean.length === 0) {
    window.pinFirstKeyAtMs = 0;
  } else if (clean.length === 1 && !window.pinFirstKeyAtMs) {
    window.pinFirstKeyAtMs = Date.now();
  }
  window.pinLastCleanVal = clean;
  if (inp && inp.value !== clean) {
    inp.value = clean;
  }
  renderStudentPin10Slots(clean);
  if (clean.length === 4 && !isSubmitting) {
    const nowMs = Date.now();
    const firstKeyMs = window.pinFirstKeyAtMs || nowMs;
    const openedMs = window.pinBoxOpenedAtMs || firstKeyMs;
    const pinTimingMeta = {
      firstKeyIdleMs: Math.max(0, firstKeyMs - openedMs),
      pinTypedDurationMs: Math.max(0, nowMs - firstKeyMs)
    };
    await executeStudentCheckIn('PIN10:' + clean, window.lockedRound2GpsPos, pinTimingMeta);
  }
}

async function handleOneTapGpsCheckIn() {
  if (isSubmitting) return;
  const selClassEl = document.getElementById('sel-student-class');
  const classId = selClassEl ? selClassEl.value : '';
  const clsObj = getSelectedStudentEnrolledClassObj(classId);

  if (
    clsObj &&
    clsObj.sessionOpenNow &&
    Number(clsObj.activeRound || 1) === 2 &&
    String(clsObj.activeQrMode || '').toUpperCase() === 'PIN_10S'
  ) {
    // Step 1: Lock live GPS before opening 4-digit PIN pad so submitting the 4th digit has 0ms GPS delay
    const dot = document.getElementById('gps-dot');
    const readout = document.getElementById('gps-readout');
    const btn = document.getElementById('btn-start-checkin');
    if (btn) btn.disabled = true;
    if (dot) dot.className = 'status-dot dot-busy';
    if (readout) {
      readout.textContent = currentLang === 'en'
        ? 'Locking live GPS before PIN entry...'
        : 'Đang khóa vị trí GPS trước khi nhập PIN...';
    }
    try {
      if (typeof ensureDeviceVaultReady === 'function') {
        try { ensureDeviceVaultReady(); } catch (e) {}
      }
      const pos = await getAccuratePosition();
      const spoofCheck = inspectGpsForSpoofing(pos);
      if (spoofCheck.hardBlock) {
        if (dot) dot.className = 'status-dot dot-err';
        showStatus(currentLang === 'en' ? 'Invalid GPS signal.' : 'Tín hiệu định vị GPS không hợp lệ.', 'err', 'checkin-inline-status');
        if (btn) btn.disabled = false;
        return;
      }
      const accVal = Math.round(pos.coords.accuracy);
      if (dot) dot.className = 'status-dot dot-ok';
      if (readout) {
        readout.textContent = currentLang === 'en'
          ? `GPS locked (±${accVal}m) — Enter 4-digit PIN`
          : `Đã khóa GPS (±${accVal}m) — Nhập 4 số PIN`;
      }
      hideStatus('checkin-inline-status');
      openStudentPin10sBox(pos);
    } catch (gpsErr) {
      if (btn) btn.disabled = false;
      if (dot) dot.className = 'status-dot dot-err';
      showStatus(formatGpsErrorGuide(gpsErr), 'err', 'checkin-inline-status');
    }
    return;
  }

  await executeStudentCheckIn('BUTTON_GPS_CHECKIN');
}

async function executeStudentCheckIn(qrString, preLockedGpsPos = null, pinTimingMeta = null) {
  if (isSubmitting) return;
  const isPin10Attempt = String(qrString || '').startsWith('PIN10:');

  let profiles = getStudentProfiles();
  let instIds = Object.keys(profiles);

  // If student typed their MSSV into #inp-student-id and tapped "ĐIỂM DANH NGAY" directly without tapping "Lưu" first, auto-onboard them seamlessly
  if (instIds.length === 0) {
    const inpIdEl = document.getElementById('inp-student-id');
    const typedId = inpIdEl ? inpIdEl.value.trim() : '';
    if (typedId) {
      const onboardedOk = await submitStudentOnboarding();
      if (!onboardedOk) return;
      profiles = getStudentProfiles();
      instIds = Object.keys(profiles);
    }
  }

  const selInstEl = document.getElementById('sel-student-inst');
  const instId = (selInstEl && selInstEl.value) ? selInstEl.value : (instIds[0] || '');
  const profile = profiles[instId];

  if (!profile) {
    document.getElementById('box-add-course').classList.remove('hidden');
    syncStudentViewportScrollLock();
    showStatus(
      currentLang === 'en' ? 'Please enter and save your Student ID before checking in.' : 'Vui lòng nhập và lưu mã số sinh viên ở khung phía trên trước khi điểm danh.',
      'err',
      'checkin-inline-status'
    );
    const inpIdEl = document.getElementById('inp-student-id');
    if (inpIdEl) inpIdEl.focus();
    return;
  }

  const selClassEl = document.getElementById('sel-student-class');
  let classId = selClassEl ? selClassEl.value : '';

  // Auto-resolve class if dropdown was left unselected (e.g. page opened before class started, or student only has 1 class)
  if (!classId) {
    const enrolled = (profile.enrolledClasses || []).filter(
      c => c && !REMOVED_SAMPLE_CLASSES.includes(String(c.classId || '').trim().toUpperCase())
    );
    const liveMatch = resolveActiveClassBySchedule(enrolled, new Date());
    if (liveMatch && liveMatch.matchedClassId) {
      classId = liveMatch.matchedClassId;
    } else if (enrolled.length === 1) {
      classId = enrolled[0].classId;
    } else {
      const lastSaved = safeGetLocal('cc_last_class_' + instId, '');
      if (lastSaved && enrolled.some(c => c.classId === lastSaved)) {
        classId = lastSaved;
      }
    }
    if (classId && selClassEl) {
      selClassEl.value = classId;
      updateStudentClassSelectionUI(instId, resolveActiveClassBySchedule(enrolled, new Date()));
    }
  }

  if (!classId) {
    showStatus(
      currentLang === 'en'
        ? 'No class section selected. Please select your class above before checking in.'
        : 'Bạn chưa chọn lớp học phần. Vui lòng chọn lớp học ở ô phía trên trước khi bấm Điểm danh.',
      'warn',
      'checkin-inline-status'
    );
    if (selClassEl) selClassEl.focus();
    return;
  }

  const check = evaluateStudentAntiCheat();
  if (!check.browserOk) {
    checkIosStandaloneNotice();
    const isAppleQr = check.webViewType === 'APPLE_CODE_SCANNER';
    showStatus(
      currentLang === 'en'
        ? (isAppleQr
            ? 'Do not check in inside iPhone Code Scanner (auto-wipes storage). Please copy link above and open in Safari.'
            : 'Do not check in inside Zalo or Messenger. Please open your registered browser.')
        : (isAppleQr
            ? 'Không điểm danh trong "Trình quét mã" của iPhone (tự xóa bộ nhớ). Hãy chép link phía trên và mở bằng Safari.'
            : 'Không điểm danh trong Zalo/Messenger. Hãy mở bằng trình duyệt đã đăng ký.'),
      'err',
      'checkin-inline-status'
    );
    return;
  }

  // Immediately lock button to block rapid spam taps
  isSubmitting = true;
  const btn = document.getElementById('btn-start-checkin');
  const btnLabel = document.getElementById('btn-start-checkin-label');
  const dot = document.getElementById('gps-dot');
  const readout = document.getElementById('gps-readout');

  btn.disabled = true;
  if (btnLabel) {
    btnLabel.textContent = I18N[currentLang].stu_submitting_btn || 'Đang gửi dữ liệu...';
  } else {
    btn.textContent = I18N[currentLang].stu_submitting_btn || 'Đang gửi dữ liệu...';
  }

  if (dot) dot.className = 'status-dot dot-busy';
  if (readout) {
    readout.textContent = currentLang === 'en'
      ? 'Verifying live GPS location...'
      : 'Đang lấy tọa độ định vị GPS...';
  }
  showStatus(
    currentLang === 'en'
      ? 'Verifying GPS location and submitting attendance...'
      : 'Đang kiểm tra vị trí định vị GPS và gửi điểm danh...',
    'warn',
    'checkin-inline-status'
  );

  try {
    // Always acquire fresh live GPS on check-in (or use the just-locked Round 2 GPS fix during 10s PIN entry)
    window.cachedGPS = null;
    let pos = (preLockedGpsPos && isValidGpsPos(preLockedGpsPos)) ? preLockedGpsPos : null;
    try {
      if (!pos) {
        pos = await getAccuratePosition();
      }
      if (typeof hideGpsPermissionGuideBox === 'function') hideGpsPermissionGuideBox();
    } catch (gpsErr) {
      if (dot) dot.className = 'status-dot dot-err';
      if (gpsErr && gpsErr.code === 1) {
        if (readout) {
          readout.textContent = currentLang === 'en'
            ? 'Location permission blocked'
            : 'Chưa cấp quyền Vị trí';
        }
        if (typeof showGpsPermissionGuideBox === 'function') {
          showGpsPermissionGuideBox();
        }
        hideStatus('checkin-inline-status');
      } else {
        if (readout) {
          readout.textContent = currentLang === 'en'
            ? 'Weak GPS signal — Turn on Wi-Fi & Location'
            : 'Sóng GPS yếu — Hãy bật Wi-Fi & Vị trí';
        }
        const errMsg = typeof formatGpsErrorGuide === 'function'
          ? formatGpsErrorGuide(gpsErr)
          : I18N[currentLang].ERR_GPS_UNAVAILABLE;
        showStatus(errMsg, 'err', 'checkin-inline-status');
      }
      resetCheckInButtonImmediate();
      return;
    }

    const spoofCheck = inspectGpsForSpoofing(pos);
    if (spoofCheck.hardBlock) {
      if (dot) dot.className = 'status-dot dot-err';
      showStatus(currentLang === 'en' ? 'Invalid GPS signal.' : 'Tín hiệu định vị GPS không hợp lệ.', 'err', 'checkin-inline-status');
      resetCheckInButtonImmediate();
      return;
    }

    const accVal = Math.round(pos.coords.accuracy);
    if (dot) dot.className = 'status-dot dot-ok';
    if (readout) {
      readout.textContent = currentLang === 'en'
        ? `GPS ready (Accuracy ±${accVal}m)`
        : `Đã bật GPS thành công (Sai số ±${accVal}m)`;
    }

    if (!isPin10Attempt) {
      if (typeof ensureDeviceVaultReady === 'function') {
        await ensureDeviceVaultReady();
      }
      if (typeof detectPrivateBrowsingMode === 'function') {
        const privCheck = await detectPrivateBrowsingMode();
        if (privCheck && privCheck.isPrivate) {
          showStatus(I18N[currentLang].ERR_PRIVATE_BROWSING, 'err', 'checkin-inline-status');
          resetCheckInButtonImmediate();
          return;
        }
      }
    }

    const requestId = 'REQ_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const payload = {
      action: 'STUDENT_CHECKIN',
      studentId: profile.studentId,
      classId: classId,
      credential: getOrCreateDeviceCredential(),
      deviceFp: getHardwareFingerprint(),
      qrPayload: qrString || 'BUTTON_GPS_CHECKIN',
      requestId: requestId,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy,
      clientMeta: {
        isInApp: check.isInApp,
        isSecondaryMobileBrowser: false,
        deviceOk: true,
        mockGpsSuspect: spoofCheck.suspicious,
        mockReason: spoofCheck.reason,
        firstKeyIdleMs: (pinTimingMeta && typeof pinTimingMeta.firstKeyIdleMs === 'number') ? pinTimingMeta.firstKeyIdleMs : 0,
        pinTypedDurationMs: (pinTimingMeta && typeof pinTimingMeta.pinTypedDurationMs === 'number') ? pinTimingMeta.pinTypedDurationMs : 0
      }
    };

    const res = await callBackend(profile.apiUrl, payload, isPin10Attempt ? 0 : 2);

    if (res && res.ok && res.receipt) {
      const r = res.receipt;
      const recordedClassId = r.classId || classId;
      const isLate = r.status === 'L';
      const pinBox = document.getElementById('stu-p2-pin-box');
      if (pinBox) pinBox.classList.add('hidden');
      if (btn) btn.classList.remove('hidden');
      window.lockedRound2GpsPos = null;
      if (recordedClassId !== classId && selClassEl) {
        selClassEl.value = recordedClassId;
      }
      if (r.attendanceStats) {
        updateStoredStudentClassStats(instId, recordedClassId, r.attendanceStats);
      }
      saveTodayStudentReceipt(recordedClassId, r);
      renderStudentAttendanceSummary(instId, recordedClassId);
      renderTodayStudentReceipt(recordedClassId, true);
      showStatus(formatServerMessage(res.code, {
        status: r.status,
        time: r.time,
        dist: r.distanceMeters
      }), isLate ? 'warn' : 'success', 'checkin-inline-status');
    } else if (res && res.code === 'ERR_NETWORK') {
      const checkRec = await callBackend(profile.apiUrl, {
        action: 'CHECK_RECEIPT',
        requestId: requestId,
        studentId: profile.studentId
      }, 1);
      if (checkRec && checkRec.ok && checkRec.receipt) {
        const recordedClassId = checkRec.receipt.classId || classId;
        const isLate = checkRec.receipt.status === 'L';
        const pinBox = document.getElementById('stu-p2-pin-box');
        if (pinBox) pinBox.classList.add('hidden');
        if (btn) btn.classList.remove('hidden');
        window.lockedRound2GpsPos = null;
        if (checkRec.receipt.attendanceStats) {
          updateStoredStudentClassStats(instId, recordedClassId, checkRec.receipt.attendanceStats);
        }
        saveTodayStudentReceipt(recordedClassId, checkRec.receipt);
        renderStudentAttendanceSummary(instId, recordedClassId);
        renderTodayStudentReceipt(recordedClassId, true);
        showStatus(formatServerMessage('CONFIRMED_' + (checkRec.receipt.status === 'P' ? 'PRESENT' : 'LATE'), {
          time: checkRec.receipt.time,
          dist: checkRec.receipt.distanceMeters
        }), isLate ? 'warn' : 'success', 'checkin-inline-status');
      } else {
        const pinBox = document.getElementById('stu-p2-pin-box');
      if (pinBox && !pinBox.classList.contains('hidden')) {
        cancelStudentPin10sModal();
      }
      startCheckInButtonCooldown(3);
        if (typeof pulseButtonConfirm === 'function') {
          pulseButtonConfirm(
            'btn-start-checkin',
            currentLang === 'en' ? 'NETWORK ERROR — RETRY' : 'LỖI MẠNG — THỬ LẠI',
            'danger',
            1150,
            { skipSaveOrig: true }
          );
        }
        showStatus(
          currentLang === 'en' ? 'Network connection error, please try again.' : 'Lỗi kết nối mạng, vui lòng thử bấm lại.',
          'err',
          'checkin-inline-status'
        );
      }
    } else {
      const errCode = res ? res.code : 'ERR_UNKNOWN';
      if (errCode === 'ERR_PIN_REQUIRED' || errCode === 'PIN_EXPIRED' || errCode === 'PIN_WRONG' || errCode === 'PIN_LOCKED') {
        // Keep GPS locked, keep 4-digit PIN pad open, clear digits for instant retry without cooldown
        openStudentPin10sBox(pos);
        const slotsWrap = document.getElementById('stu-p2-pin-slots-wrap');
        if (slotsWrap && (errCode === 'PIN_EXPIRED' || errCode === 'PIN_WRONG' || errCode === 'PIN_LOCKED')) {
          slotsWrap.classList.remove('pin-shake');
          void slotsWrap.offsetWidth;
          slotsWrap.classList.add('pin-shake');
        }
        showStatus(
          formatServerMessage(errCode, res ? res.params : {}, res ? res.message : ''),
          errCode === 'PIN_EXPIRED' ? 'warn' : 'err',
          'checkin-inline-status'
        );
        return;
      }
      const pinBox = document.getElementById('stu-p2-pin-box');
      if (pinBox && !pinBox.classList.contains('hidden')) {
        cancelStudentPin10sModal();
      }
      startCheckInButtonCooldown(3);
      const shortErrBtnLabel = errCode === 'ERR_SESSION_CLOSED'
        ? (currentLang === 'en' ? 'SESSION IS CLOSED' : 'PHIÊN ĐIỂM DANH ĐANG ĐÓNG')
        : (errCode === 'ERR_LOCATION_OUT_OF_RANGE' || errCode === 'ERR_OUT_OF_RANGE')
          ? (currentLang === 'en' ? 'OUTSIDE CLASSROOM RADIUS' : 'NGOÀI BÁN KÍNH PHÒNG HỌC')
          : (currentLang === 'en' ? 'CHECK-IN NOT COMPLETED' : 'CHƯA ĐIỂM DANH ĐƯỢC');
      if (typeof pulseButtonConfirm === 'function') {
        pulseButtonConfirm('btn-start-checkin', shortErrBtnLabel, 'danger', 1150, { skipSaveOrig: true });
      }
      // Smart wrong-class hint: if this class is closed, check if another enrolled class is open or scheduled
      if (errCode === 'ERR_SESSION_CLOSED' && Array.isArray(profile.enrolledClasses) && profile.enrolledClasses.length > 1) {
        const sched = resolveActiveClassBySchedule(profile.enrolledClasses, new Date());
        if (sched.matchedClassId && sched.matchedClassId !== classId) {
          showStatus(
            currentLang === 'en'
              ? `Attendance for ${classId} is closed. Hint: ${sched.matchedClassId} is currently scheduled — please check your selected class.`
              : `Cổng điểm danh lớp ${classId} đang đóng. Gợi ý: Theo khung giờ hiện tại, lớp ${sched.matchedClassId} đang trong ca học — hãy kiểm tra xem bạn có chọn nhầm lớp không.`,
            'warn',
            'checkin-inline-status'
          );
          return;
        }
      }
      showStatus(formatServerMessage(errCode, res ? res.params : {}, res ? res.message : ''), 'err', 'checkin-inline-status');
    }
  } finally {
    isSubmitting = false;
  }
}

function resetCheckInButtonImmediate() {
  isSubmitting = false;
  const btn = document.getElementById('btn-start-checkin');
  const defaultText = I18N[currentLang].stu_one_tap_checkin_btn || 'ĐIỂM DANH NGAY';
  if (btn) {
    btn.disabled = false;
    btn.classList.remove('btn-pulse-success', 'btn-pulse-warn', 'btn-pulse-danger', 'btn-pulse-neutral', 'btn-checkin-done-P', 'btn-checkin-done-L');
    btn.innerHTML = `<svg class="icon icon-lg"><use href="#ic-check"></use></svg><span id="btn-start-checkin-label">${escapeHtml(defaultText)}</span>`;
  }
}

function startCheckInButtonCooldown(seconds) {
  const btn = document.getElementById('btn-start-checkin');
  if (checkInCooldownTimer) clearInterval(checkInCooldownTimer);
  let rem = seconds;
  if (btn) btn.disabled = true;
  checkInCooldownTimer = setInterval(() => {
    rem--;
    if (rem <= 0) {
      clearInterval(checkInCooldownTimer);
      const selClassEl = document.getElementById('sel-student-class');
      syncStudentCheckInButtonState(selClassEl ? selClassEl.value : '', false);
    }
  }, 1000);
}

function syncStudentCheckInButtonState(classId, animatePulse = false) {
  const btn = document.getElementById('btn-start-checkin');
  if (!btn) return;
  if (checkInCooldownTimer) {
    clearInterval(checkInCooldownTimer);
    checkInCooldownTimer = null;
  }

  const isEn = currentLang === 'en';
  const todayKey = getTodayDateKey();
  let todayRec = null;

  if (classId) {
    const raw = safeGetLocal(`cc_receipt_${classId}_${todayKey}`, null);
    if (raw) {
      try {
        todayRec = JSON.parse(raw);
      } catch (e) {
        todayRec = null;
      }
    }
    if (!todayRec) {
      try {
        const profiles = getStudentProfiles();
        const instIds = Object.keys(profiles);
        const activeInst = safeGetLocal('cc_active_inst', instIds[0] || '');
        const p = profiles[activeInst];
        if (p && p.studentId) {
          const localHist = getLocalStudentAttendanceHistory(p.studentId, classId);
          const foundToday = localHist.find(h => h && h.dayKey === todayKey && (h.status === 'P' || h.status === 'L'));
          if (foundToday) {
            todayRec = { status: foundToday.status, time: foundToday.time || '' };
          }
        }
      } catch (e) {}
    }
  }

  const clsObj = getSelectedStudentEnrolledClassObj(classId);
  const isRound2OpenNow = Boolean(
    clsObj &&
    clsObj.sessionOpenNow &&
    Number(clsObj.activeRound || 1) === 2
  );
  const hasCheckedInRound2 = Boolean(
    todayRec &&
    (todayRec.status === 'P' || todayRec.status === 'L') &&
    (Number(todayRec.round || 1) === 2 || (clsObj && clsObj.activeSessionId && todayRec.sessionId === clsObj.activeSessionId))
  );

  // If Round 2 is currently open and student has only checked in Round 1 (or not at all), unlock button for Round 2
  if (isRound2OpenNow && !hasCheckedInRound2) {
    isSubmitting = false;
    const r2Label = I18N[currentLang].stu_round2_checkin_btn || (isEn ? 'CHECK-IN ROUND 2' : 'ĐIỂM DANH LẦN 2');
    btn.disabled = false;
    btn.classList.remove('btn-pulse-success', 'btn-pulse-warn', 'btn-pulse-danger', 'btn-pulse-neutral', 'btn-checkin-done-P', 'btn-checkin-done-L');
    btn.classList.add('btn-checkin-round2');
    btn.innerHTML = `<svg class="icon icon-lg"><use href="#ic-check"></use></svg><span id="btn-start-checkin-label">${escapeHtml(r2Label)}</span>`;
    return;
  }

  btn.classList.remove('btn-checkin-round2');
  if (todayRec && (todayRec.status === 'P' || todayRec.status === 'L')) {
    const isLate = todayRec.status === 'L';
    const shortTime = todayRec.time ? String(todayRec.time).slice(0, 5) : '';
    const timeSuffix = shortTime ? ` • ${shortTime}` : '';
    const isR2Rec = Number(todayRec.round || 1) === 2;
    const labelText = isR2Rec
      ? (isEn ? `CHECKED IN ROUND 2${timeSuffix}` : `ĐÃ ĐIỂM DANH LẦN 2${timeSuffix}`)
      : isLate
        ? (isEn ? `RECORDED LATE (L)${timeSuffix}` : `ĐÃ GHI NHẬN ĐI TRỄ (L)${timeSuffix}`)
        : (isEn ? `CHECKED IN PRESENT (P)${timeSuffix}` : `ĐÃ ĐIỂM DANH CÓ MẶT (P)${timeSuffix}`);
    const svgHtml = '<svg class="icon icon-lg"><use href="#ic-check"></use></svg>';

    btn.disabled = true;
    btn.classList.remove('btn-pulse-success', 'btn-pulse-warn', 'btn-pulse-danger', 'btn-pulse-neutral', 'btn-checkin-done-P', 'btn-checkin-done-L');
    btn.classList.add((isLate && !isR2Rec) ? 'btn-checkin-done-L' : 'btn-checkin-done-P');
    if (animatePulse) {
      void btn.offsetWidth;
      btn.classList.add((isLate && !isR2Rec) ? 'btn-pulse-warn' : 'btn-pulse-success');
    }
    btn.innerHTML = `${svgHtml}<span id="btn-start-checkin-label">${escapeHtml(labelText)}</span>`;
  } else {
    resetCheckInButtonImmediate();
  }
}

/**
 * Saves and displays today's attendance receipt locally so students can verify or show
 * their receipt to the lecturer even if they refresh the page.
 */
function saveTodayStudentReceipt(classId, receiptObj) {
  if (!classId || !receiptObj) return;
  const key = `cc_receipt_${classId}_${getTodayDateKey()}`;
  safeSetLocal(key, JSON.stringify(receiptObj));
  if (receiptObj.studentId && receiptObj.status) {
    recordLocalStudentSessionMark(
      receiptObj.studentId,
      classId,
      receiptObj.sessionId || getTodayDateKey(),
      receiptObj.status,
      receiptObj.time || ''
    );
  }
}

function renderTodayStudentReceipt(classId, animatePulse = false) {
  const box = document.getElementById('student-today-receipt');
  if (box) box.classList.add('hidden');
  if (classId) {
    const key = `cc_receipt_${classId}_${getTodayDateKey()}`;
    const raw = safeGetLocal(key, null);
    if (raw) {
      try {
        const r = JSON.parse(raw);
        if (r && r.studentId && r.status) {
          recordLocalStudentSessionMark(
            r.studentId,
            classId,
            r.sessionId || getTodayDateKey(),
            r.status,
            r.time || ''
          );
        }
      } catch (e) {}
    }
  }
  syncStudentCheckInButtonState(classId, animatePulse);
}
