/**
 * ============================================================================
 * STUDENT CONTROLLER (js/student.js — v3.6.0)
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
window.cachedGPS = null; // Kept null so check-in always verifies fresh live GPS

window.addEventListener('DOMContentLoaded', () => {
  getOrCreateDeviceCredential();
  migrateStoredUrls();

  const onboardApiInput = document.getElementById('inp-onboard-api');
  const teaApiInput = document.getElementById('inp-tea-api');
  if (onboardApiInput) onboardApiInput.value = DEFAULT_LECTURER_API;
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
});

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
            activeGroupSplit: sc.activeGroupSplit !== undefined ? sc.activeGroupSplit : (ec.activeGroupSplit || null),
            attendanceStats: st
          }) : Object.assign({}, ec, { attendanceStats: st });
        });
        saveStudentProfile(activeInst, activeProfile);
      }
      if (currentMode === 'STUDENT' && instIds.length > 0) {
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

  if (instIds.length === 0) {
    hasBox.classList.add('hidden');
    noBox.classList.remove('hidden');
    addBox.classList.remove('hidden');
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

  onStudentInstChange(false);
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
  if (!sid || !split || !Array.isArray(split.groups) || split.groups.length === 0) {
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
          if (!targetStudentId || !targetClassId || preview.classId === targetClassId || preview.studentId === targetStudentId) {
            targetStudentId = preview.studentId;
            targetClassId = preview.classId;
            if (p && p.studentId !== preview.studentId) {
              serverStats = null;
            }
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

function toggleAdvancedApiBox() {
  document.getElementById('box-advanced-api').classList.toggle('hidden');
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
    if (dot) dot.className = 'status-dot dot-err';
    if (readout) {
      readout.textContent = currentLang === 'en'
        ? 'Unsupported in-app browser (Open Safari/Chrome)'
        : 'Đang mở trong Zalo/Messenger (Hãy mở bằng Safari/Chrome)';
    }
    showStatus(
      currentLang === 'en'
        ? 'Do not check in inside Zalo or Messenger. Please open your main browser (Safari, Chrome).'
        : 'Không điểm danh trong Zalo/Messenger. Hãy mở bằng trình duyệt chính (Safari, Chrome).',
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
      } else {
        if (dot) dot.className = 'status-dot dot-ok';
        if (readout) {
          readout.textContent = currentLang === 'en'
            ? `GPS ready (Accuracy ±${accVal}m)`
            : `Đã bật GPS (Sai số ±${accVal}m)`;
        }
        hideStatus('checkin-inline-status');
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
          ? 'GPS unavailable'
          : 'Chưa lấy được định vị GPS';
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
async function submitStudentOnboarding() {
  const existingProfiles = getStudentProfiles();
  if (Object.keys(existingProfiles).length > 0) {
    renderStudentCourseSelectors();
    return true;
  }

  const check = evaluateStudentAntiCheat();
  if (!check.browserOk) {
    showStatus(
      currentLang === 'en'
        ? 'Please open in your main browser (Safari, Chrome, Edge), not inside Zalo or Messenger.'
        : 'Vui lòng mở bằng trình duyệt chính (Safari, Chrome, Cốc Cốc, Edge), không mở trong Zalo/Messenger.',
      'err',
      'onboard-inline-status'
    );
    return false;
  }

  const apiUrl = normalizeApiUrl(document.getElementById('inp-onboard-api').value);
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

  // Trigger native browser location permission prompt synchronously while user click gesture (userActivation) is active
  if (navigator.geolocation && typeof navigator.geolocation.getCurrentPosition === 'function') {
    try {
      navigator.geolocation.getCurrentPosition(
        () => {
          window.cachedGPS = null;
          if (typeof hideGpsPermissionGuideBox === 'function') hideGpsPermissionGuideBox();
        },
        (err) => {
          if (err && err.code === 1 && typeof showGpsPermissionGuideBox === 'function') {
            showGpsPermissionGuideBox();
          }
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
      );
    } catch (e) {}
  }

  showStatus(
    currentLang === 'en' ? 'Verifying Student ID with server...' : 'Đang xác thực mã số sinh viên với máy chủ...',
    'warn',
    'onboard-inline-status'
  );

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
async function handleOneTapGpsCheckIn() {
  if (isSubmitting) return;
  await executeStudentCheckIn('BUTTON_GPS_CHECKIN');
}

async function executeStudentCheckIn(qrString) {
  if (isSubmitting) return;

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
    showStatus(
      currentLang === 'en'
        ? 'Do not check in inside Zalo or Messenger. Please open your registered browser.'
        : 'Không điểm danh trong Zalo/Messenger. Hãy mở bằng trình duyệt đã đăng ký.',
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
    // Always acquire fresh live GPS on check-in (never reuse old cached position)
    window.cachedGPS = null;
    let pos;
    try {
      pos = await getAccuratePosition();
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
            ? 'GPS unavailable'
            : 'Chưa lấy được định vị GPS';
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
        mockReason: spoofCheck.reason
      }
    };

    const res = await callBackend(profile.apiUrl, payload, 2);
    startCheckInButtonCooldown(4);

    if (res && res.ok && res.receipt) {
      const r = res.receipt;
      const recordedClassId = r.classId || classId;
      if (recordedClassId !== classId && selClassEl) {
        selClassEl.value = recordedClassId;
      }
      if (r.attendanceStats) {
        updateStoredStudentClassStats(instId, recordedClassId, r.attendanceStats);
      }
      saveTodayStudentReceipt(recordedClassId, r);
      renderStudentAttendanceSummary(instId, recordedClassId);
      renderTodayStudentReceipt(recordedClassId);
      showStatus(formatServerMessage(res.code, {
        status: r.status,
        time: r.time,
        dist: r.distanceMeters
      }), 'success', 'checkin-inline-status');
    } else if (res && res.code === 'ERR_NETWORK') {
      const checkRec = await callBackend(profile.apiUrl, {
        action: 'CHECK_RECEIPT',
        requestId: requestId,
        studentId: profile.studentId
      }, 1);
      if (checkRec && checkRec.ok && checkRec.receipt) {
        const recordedClassId = checkRec.receipt.classId || classId;
        if (checkRec.receipt.attendanceStats) {
          updateStoredStudentClassStats(instId, recordedClassId, checkRec.receipt.attendanceStats);
        }
        saveTodayStudentReceipt(recordedClassId, checkRec.receipt);
        renderStudentAttendanceSummary(instId, recordedClassId);
        renderTodayStudentReceipt(recordedClassId);
        showStatus(formatServerMessage('CONFIRMED_' + (checkRec.receipt.status === 'P' ? 'PRESENT' : 'LATE'), {
          time: checkRec.receipt.time,
          dist: checkRec.receipt.distanceMeters
        }), 'success', 'checkin-inline-status');
      } else {
        showStatus(
          currentLang === 'en' ? 'Network connection error, please try again.' : 'Lỗi kết nối mạng, vui lòng thử bấm lại.',
          'err',
          'checkin-inline-status'
        );
      }
    } else {
      const errCode = res ? res.code : 'ERR_UNKNOWN';
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
  const btnLabel = document.getElementById('btn-start-checkin-label');
  if (btn) btn.disabled = false;
  const defaultText = I18N[currentLang].stu_one_tap_checkin_btn || 'ĐIỂM DANH NGAY';
  if (btnLabel) {
    btnLabel.textContent = defaultText;
  } else if (btn) {
    btn.textContent = defaultText;
  }
}

function startCheckInButtonCooldown(seconds) {
  const btn = document.getElementById('btn-start-checkin');
  const btnLabel = document.getElementById('btn-start-checkin-label');
  if (checkInCooldownTimer) clearInterval(checkInCooldownTimer);
  let rem = seconds;
  btn.disabled = true;
  checkInCooldownTimer = setInterval(() => {
    rem--;
    if (rem <= 0) {
      clearInterval(checkInCooldownTimer);
      resetCheckInButtonImmediate();
    } else {
      const waitText = currentLang === 'en' ? `Please wait ${rem} seconds...` : `Vui lòng chờ ${rem} giây...`;
      if (btnLabel) btnLabel.textContent = waitText;
      else btn.textContent = waitText;
    }
  }, 1000);
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

function renderTodayStudentReceipt(classId) {
  const box = document.getElementById('student-today-receipt');
  if (box) box.classList.add('hidden');
  if (!classId) return;
  const key = `cc_receipt_${classId}_${getTodayDateKey()}`;
  const raw = safeGetLocal(key, null);
  if (!raw) return;
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
