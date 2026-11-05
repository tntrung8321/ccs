/**
 * ============================================================================
 * LECTURER CONTROLLER (js/teacher.js — v3.6.0)
 *  - Sheet-Based Rotating 6-Digit Session Code & Master Key Authentication
 *  - Zero-Flicker Session & Class Restoration on Browser Refresh (F5)
 *  - Real-Time Class Auto-Selection (Google Calendar + Period Slots 123/456/789/10-12/13-15)
 *  - Instant 0.01s Optimistic UI for Manual Attendance Marks (P / L / E / -) & Past-Session Excuse Approval
 *  - Shuffle-Bag Random Student Caller (Projector ID Privacy) & Instant Classroom Group Maker
 *  - Isolated Session Control Block with Two-Step Inline Confirmation
 *  - Live Roster Quick Filters (All / Present / Absent / Suspect) & Projector Privacy Mode
 * ============================================================================
 */

let teacherState = null;
let teacherPollTimer = null;
let teacherCountdownTimer = null;
let isPollingTeacher = false;
let showRosterNames = true;
let activeRosterFilter = 'ALL'; // 'ALL' | 'PRESENT' | 'ABSENT' | 'SUSPECT'
let teacherHasManuallySelectedClass = false;
let selectedTeacherClassId = '';
let pendingManualMarks = {}; // Optimistic UI locks keyed by studentId so rapid clicks never wait or flicker
let randomCallerVisitedByClass = {}; // Per-class shuffle bag Set of studentIds already called
let currentDraftGroups = [];
let currentDraftGroupSize = 4;

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && currentMode === 'TEACHER' && getTeacherAuth()) {
    refreshTeacherState(true);
  }
});

function toggleTeacherApiBox() {
  document.getElementById('box-tea-api-advanced').classList.toggle('hidden');
}

function resetToDefaultLecturerApi() {
  document.getElementById('inp-tea-api').value = DEFAULT_LECTURER_API;
  safeRemoveLocal('cc_teacher_auth');
  safeRemoveSession('cc_teacher_auth');
  safeRemoveSession('cc_tea_state_cache');
  showStatus(
    currentLang === 'en' ? 'Restored default server URL.' : 'Đã khôi phục đường dẫn máy chủ mặc định.',
    'success'
  );
}

async function restoreTeacherSessionOnLoad(auth) {
  if (!auth) return;
  const apiInput = document.getElementById('inp-tea-api');
  const tokenInput = document.getElementById('inp-tea-token');
  const persistSelect = document.getElementById('sel-tea-persistence');
  if (apiInput) apiInput.value = normalizeApiUrl(auth.apiUrl);
  if (tokenInput) tokenInput.value = auth.token || '';
  if (persistSelect) persistSelect.value = auth.persistence || 'LOCAL';

  document.getElementById('card-teacher-login').classList.add('hidden');
  document.getElementById('box-teacher-dashboard').classList.remove('hidden');
  hideStatus();

  selectedTeacherClassId = safeGetSession('cc_tea_selected_class', safeGetLocal('cc_tea_selected_class', ''));
  teacherHasManuallySelectedClass = Boolean(selectedTeacherClassId);

  const cachedRaw = safeGetSession('cc_tea_state_cache', null);
  if (cachedRaw) {
    try {
      const cachedState = JSON.parse(cachedRaw);
      if (cachedState && cachedState.ok) {
        await applyTeacherState(cachedState, false);
      }
    } catch (e) {}
  }

  startTeacherPolling();
  await refreshTeacherState(true);
}

async function loginTeacher() {
  const apiUrl = normalizeApiUrl(document.getElementById('inp-tea-api').value);
  const token = document.getElementById('inp-tea-token').value.trim();
  const persistence = document.getElementById('sel-tea-persistence').value;

  document.getElementById('inp-tea-api').value = apiUrl;

  if (!apiUrl || !token) {
    showStatus(
      currentLang === 'en'
        ? 'Please enter the session code from Google Sheet or your Master Key.'
        : 'Vui lòng nhập mật khẩu phiên từ Google Sheet hoặc khóa chính (Master Key).',
      'err'
    );
    return;
  }

  showStatus(
    currentLang === 'en'
      ? 'Verifying session code with Google Sheet...'
      : 'Đang xác thực mật khẩu phiên với Google Sheet...',
    'warn'
  );
  const res = await callBackend(apiUrl, {
    action: 'TEACHER_AUTH',
    teacherToken: token
  });

  if (!res || !res.ok) {
    showStatus(res && res.message ? res.message : formatServerMessage(res ? res.code : 'ERR_UNAUTHORIZED', {}, ''), 'err');
    return;
  }

  saveTeacherAuth(apiUrl, token, persistence);
  teacherHasManuallySelectedClass = false;
  selectedTeacherClassId = '';
  safeSetSession('cc_tea_selected_class', '');
  safeSetLocal('cc_tea_selected_class', '');

  document.getElementById('card-teacher-login').classList.add('hidden');
  document.getElementById('box-teacher-dashboard').classList.remove('hidden');
  hideStatus();
  await applyTeacherState(res, true);
  startTeacherPolling();
}

function logoutTeacher() {
  safeRemoveLocal('cc_teacher_auth');
  safeRemoveSession('cc_teacher_auth');
  safeRemoveSession('cc_tea_state_cache');
  safeRemoveSession('cc_tea_selected_class');
  safeRemoveLocal('cc_tea_selected_class');
  safeSetLocal('cc_active_mode', 'STUDENT');
  document.getElementById('inp-tea-token').value = '';
  teacherHasManuallySelectedClass = false;
  selectedTeacherClassId = '';
  cancelOpenSessionConfirm();
  stopTeacherPolling();
  document.getElementById('box-teacher-dashboard').classList.add('hidden');
  document.getElementById('card-teacher-login').classList.remove('hidden');
}

async function refreshTeacherState(force = false) {
  const auth = getTeacherAuth();
  if (!auth || document.hidden) return;
  if (isPollingTeacher && !force) return;

  const selEl = document.getElementById('sel-tea-class');
  const selClass = (selEl && selEl.value) ? selEl.value : selectedTeacherClassId;

  try {
    isPollingTeacher = true;
    const res = await callBackend(auth.apiUrl, {
      action: 'TEACHER_GET_STATE',
      teacherToken: auth.token,
      classId: selClass
    }, 1);

    if (res && res.ok) {
      await applyTeacherState(res, false);
    } else if (res && res.code === 'ERR_UNAUTHORIZED') {
      logoutTeacher();
      showStatus(
        currentLang === 'en'
          ? 'Session code on Google Sheet has changed or expired. Please sign in again.'
          : 'Mã phiên trên Google Sheet đã thay đổi hoặc hết hạn. Vui lòng đăng nhập lại bằng mã mới trên Sheet.',
        'warn'
      );
    }
  } finally {
    isPollingTeacher = false;
  }
}

async function applyTeacherState(state, isInitialLoad = false) {
  if (!state) return;
  ingestServerScheduleData(state);

  // Filter out removed test sample class ENG101_G1 while keeping 100% of real classes
  const cleanClasses = (state.classes || []).filter(
    c => c && c.classId && !REMOVED_SAMPLE_CLASSES.includes(String(c.classId).trim().toUpperCase())
  );
  state.classes = cleanClasses;
  if (Array.isArray(state.roster)) {
    overlayPendingManualMarksOnRoster(state.roster);
  }
  teacherState = state;
  safeSetSession('cc_tea_state_cache', JSON.stringify(state));

  cleanClasses.forEach(c => {
    if (c.classId && c.activeQrSecret) {
      KNOWN_CLASS_SECRETS[c.classId] = c.activeQrSecret;
    }
  });

  // Resolve real-time class from Google Calendar / Period Slots (123, 456, 789, 10-12, 13-15) / Open Session
  const scheduleMatch = resolveActiveClassBySchedule(cleanClasses, new Date());
  const openSesClass = cleanClasses.find(c => c.sessionOpenNow);
  const autoClassId = scheduleMatch.matchedClassId || (openSesClass ? openSesClass.classId : '');

  if (isInitialLoad && !teacherHasManuallySelectedClass) {
    // Auto-select the class matching the current period/calendar or active open session, or "" if outside teaching hours
    selectedTeacherClassId = autoClassId;
    safeSetSession('cc_tea_selected_class', selectedTeacherClassId);
    safeSetLocal('cc_tea_selected_class', selectedTeacherClassId);
    if (selectedTeacherClassId && selectedTeacherClassId !== state.selectedClassId) {
      const auth = getTeacherAuth();
      if (auth) {
        const switchedRes = await callBackend(auth.apiUrl, {
          action: 'TEACHER_GET_STATE',
          teacherToken: auth.token,
          classId: selectedTeacherClassId
        }, 1);
        if (switchedRes && switchedRes.ok) {
          teacherHasManuallySelectedClass = true;
          await applyTeacherState(switchedRes, false);
          return;
        }
      }
    }
  } else if (teacherHasManuallySelectedClass && selectedTeacherClassId) {
    // Keep lecturer's chosen class
  } else if (!teacherHasManuallySelectedClass) {
    selectedTeacherClassId = autoClassId;
    safeSetSession('cc_tea_selected_class', selectedTeacherClassId);
    safeSetLocal('cc_tea_selected_class', selectedTeacherClassId);
  }

  const sel = document.getElementById('sel-tea-class');
  const isEn = currentLang === 'en';
  const unselectedLabel = I18N[currentLang].tea_unselected_class_opt || '-- Chưa chọn lớp - Ngoài khung giờ --';

  const optionsHtml = [
    `<option value="" ${selectedTeacherClassId === '' ? 'selected' : ''}>${escapeHtml(unselectedLabel)}</option>`
  ].concat(
    cleanClasses.map(c => {
      const isSelected = c.classId === selectedTeacherClassId;
      const openTag = c.sessionOpenNow ? (isEn ? ' [OPEN]' : ' [ĐANG MỞ]') : '';
      return `<option value="${escapeHtml(c.classId)}" ${isSelected ? 'selected' : ''}>${escapeHtml(formatClassOptionLabel(c) + openTag)}</option>`;
    })
  );
  sel.innerHTML = optionsHtml.join('');
  sel.value = selectedTeacherClassId;
  sel.classList.toggle('unselected-warning', !selectedTeacherClassId);

  const activeCfg = cleanClasses.find(c => c.classId === selectedTeacherClassId) || null;
  const ses = activeCfg ? state.activeSession : null;

  // Update Real-Time Schedule & Class Overview Banner
  updateTeacherClassOverviewUI(activeCfg, ses, scheduleMatch);

  if (activeCfg) {
    document.getElementById('btn-reg-gate-toggle').textContent = isEn
      ? `Device Reg: ${activeCfg.regOpen ? 'OPEN' : 'LOCKED'}`
      : `ĐK thiết bị: ${activeCfg.regOpen ? 'MỞ' : 'KHÓA'}`;
  } else {
    document.getElementById('btn-reg-gate-toggle').textContent = isEn
      ? 'Device Reg: --'
      : 'ĐK thiết bị: --';
  }

  const roster = activeCfg ? (state.roster || []) : [];
  const pCount = roster.filter(r => r.status === 'P').length;
  const lCount = roster.filter(r => r.status === 'L').length;
  const eCount = roster.filter(r => r.status === 'E').length;
  const aCount = roster.filter(r => !r.status || r.status === '-').length;

  document.getElementById('tea-live-count').textContent = isEn
    ? `${pCount + lCount} / ${roster.length} Present`
    : `${pCount + lCount} / ${roster.length} Có mặt`;
  document.getElementById('tea-live-breakdown').textContent = `P: ${pCount} | L: ${lCount} | A: ${aCount} | E: ${eCount}`;

  // Sync live session marks to local student attendance summary store
  if (selectedTeacherClassId && ses && typeof recordLocalStudentSessionMark === 'function') {
    const sesKey = ses.sessionId || getTodayDateKey();
    roster.forEach(r => {
      if (!r || !r.studentId) return;
      if (r.status === 'P' || r.status === 'L' || r.status === 'E') {
        recordLocalStudentSessionMark(r.studentId, selectedTeacherClassId, sesKey, r.status, r.time || '');
      } else if (r.status === '-' && (!ses.isOpen || r.source === 'TEACHER_MANUAL')) {
        recordLocalStudentSessionMark(r.studentId, selectedTeacherClassId, sesKey, 'A', r.time || '');
      }
    });
  }

  setupTeacherCountdown(ses, Boolean(activeCfg));
  renderTeacherRoster();
  if (document.getElementById('hist-modal-rows')) {
    refreshHistoryModalDateOptionsIfNeeded();
    renderHistoryModalList();
  }
}

function updateTeacherClassOverviewUI(activeCfg, ses, scheduleMatch) {
  const hintBar = document.getElementById('tea-schedule-hint');
  const selectedNameEl = document.getElementById('tea-selected-class-display');
  const confirmBtn = document.getElementById('btn-tea-confirm-open');
  const isEn = currentLang === 'en';

  if (selectedNameEl) {
    if (activeCfg) {
      selectedNameEl.textContent = `${activeCfg.classId} — ${activeCfg.className || activeCfg.classId}`;
      selectedNameEl.style.color = 'var(--primary)';
    } else {
      selectedNameEl.textContent = isEn
        ? 'No class selected (Outside automatic schedule)'
        : 'Chưa chọn lớp (Ngoài khung giờ tự động)';
      selectedNameEl.style.color = 'var(--warn-text)';
    }
  }

  if (confirmBtn) {
    confirmBtn.textContent = isEn ? 'Confirm Open' : 'Xác nhận mở phiên';
  }

  if (hintBar) {
    if (scheduleMatch && !scheduleMatch.isOffHours && scheduleMatch.matchedClassId) {
      hintBar.className = 'schedule-hint-bar matched';
      hintBar.textContent = isEn
        ? `Scheduled class: ${scheduleMatch.label}`
        : `Theo lịch dạy: ${scheduleMatch.label}`;
    } else if (!activeCfg) {
      hintBar.className = 'schedule-hint-bar off-hours';
      hintBar.textContent = isEn
        ? 'Outside scheduled teaching hours — Select a class manually to open a make-up session.'
        : 'Ngoài khung giờ dạy — Vui lòng chọn lớp thủ công nếu mở điểm danh bù.';
    } else {
      hintBar.className = 'schedule-hint-bar';
      hintBar.textContent = isEn
        ? `Selected class: ${activeCfg.classId}`
        : `Lớp đang chọn: ${activeCfg.classId}`;
    }
  }
}

/**
 * ============================================================================
 * REQUIREMENT 5: TWO-STEP INLINE CONFIRMATION FOR OPENING SESSION
 *  - Prevents accidental 1-tap session start on touchscreens.
 *  - Shows two separate buttons: "Hủy" and "Xác nhận mở phiên".
 * ============================================================================
 */
function promptOpenSessionConfirm() {
  const classId = document.getElementById('sel-tea-class').value;
  const isEn = currentLang === 'en';
  if (!classId) {
    showStatus(
      isEn
        ? 'Please select a class section from the dropdown above before opening an attendance session.'
        : 'Vui lòng chọn một lớp học phần ở danh sách phía trên trước khi mở phiên điểm danh.',
      'warn'
    );
    document.getElementById('sel-tea-class').focus();
    return;
  }

  const triggerBtn = document.getElementById('btn-tea-open-trigger');
  const confirmBox = document.getElementById('tea-open-confirm-bar');
  const confirmLabel = document.getElementById('tea-open-confirm-text');
  const confirmBtn = document.getElementById('btn-tea-confirm-open');

  if (confirmLabel) {
    confirmLabel.textContent = isEn
      ? `You are about to open an attendance session for class [${classId}]. Please confirm:`
      : `Bạn chuẩn bị mở phiên điểm danh cho lớp [${classId}]. Vui lòng xác nhận:`;
  }
  if (confirmBtn) {
    confirmBtn.textContent = isEn ? 'Confirm Open' : 'Xác nhận mở phiên';
  }

  if (triggerBtn) triggerBtn.classList.add('hidden');
  if (confirmBox) confirmBox.classList.remove('hidden');
}

function cancelOpenSessionConfirm() {
  const triggerBtn = document.getElementById('btn-tea-open-trigger');
  const confirmBox = document.getElementById('tea-open-confirm-bar');
  if (confirmBox) confirmBox.classList.add('hidden');
  if (triggerBtn) triggerBtn.classList.remove('hidden');
}

async function confirmAndStartSession() {
  cancelOpenSessionConfirm();
  await teacherStartSession();
}

async function onTeacherClassChange() {
  const sel = document.getElementById('sel-tea-class');
  selectedTeacherClassId = sel ? sel.value : '';
  teacherHasManuallySelectedClass = true;
  safeSetSession('cc_tea_selected_class', selectedTeacherClassId);
  safeSetLocal('cc_tea_selected_class', selectedTeacherClassId);
  cancelOpenSessionConfirm();

  if (!selectedTeacherClassId) {
    if (teacherState) {
      await applyTeacherState(teacherState, false);
    }
    return;
  }
  await refreshTeacherState(true);
}

function setupTeacherCountdown(ses, hasSelectedClass = true) {
  if (teacherCountdownTimer) clearInterval(teacherCountdownTimer);
  const badge = document.getElementById('tea-session-badge');
  const timerEl = document.getElementById('tea-countdown');
  const isEn = currentLang === 'en';

  if (!hasSelectedClass) {
    badge.className = 'badge-neutral';
    badge.textContent = isEn ? 'NO CLASS SELECTED' : 'CHƯA CHỌN LỚP';
    timerEl.textContent = '--:--';
    return;
  }

  if (!ses || !ses.isOpen) {
    badge.className = 'badge-err';
    badge.textContent = isEn ? 'SESSION CLOSED' : 'PHIÊN ĐANG ĐÓNG';
    timerEl.textContent = '00:00';
    return;
  }

  const updateTick = () => {
    const now = Date.now();
    const enNow = currentLang === 'en';
    if (now > ses.closesAtMs) {
      badge.className = 'badge-err';
      badge.textContent = enNow ? 'SESSION ENDED' : 'ĐÃ HẾT GIỜ';
      timerEl.textContent = '00:00';
      clearInterval(teacherCountdownTimer);
      return;
    }
    if (now <= ses.presentUntilMs) {
      const remSec = Math.max(0, Math.floor((ses.presentUntilMs - now) / 1000));
      badge.className = 'badge-ok';
      badge.textContent = enNow ? 'OPEN — RECORDING PRESENT (P)' : 'ĐANG MỞ — GHI NHẬN CÓ MẶT (P)';
      timerEl.textContent = formatMmSs(remSec);
    } else {
      const remSec = Math.max(0, Math.floor((ses.closesAtMs - now) / 1000));
      badge.className = 'badge-warn';
      badge.textContent = enNow ? 'OPEN — RECORDING LATE (L)' : 'ĐANG MỞ — GHI NHẬN ĐI TRỄ (L)';
      timerEl.textContent = formatMmSs(remSec);
    }
  };
  updateTick();
  teacherCountdownTimer = setInterval(updateTick, 1000);
}

function toggleTeacherAdvGpsBox() {
  const box = document.getElementById('box-adv-gps-mode');
  if (box) box.classList.toggle('hidden');
}

function onAdvStudentGpsToggle() {
  const chk = document.getElementById('chk-use-student-avg3');
  const hint = document.getElementById('tea-gps-anchor-hint');
  if (!hint) return;
  const isEn = currentLang === 'en';
  if (chk && chk.checked) {
    hint.textContent = isEn
      ? 'Advanced mode enabled: Classroom center will be set to the average GPS location of the first 3 verified students.'
      : 'Chế độ nâng cao đang bật: Lấy trung bình vị trí định vị GPS của 3 sinh viên đầu tiên làm tâm phòng học.';
  } else {
    hint.textContent = isEn
      ? 'Default: Distance is evaluated from the Lecturer location (Only uses the average of the first 3 students if the Lecturer device has no GPS).'
      : 'Mặc định: Đánh giá khoảng cách theo vị trí của Giảng viên (Chỉ tự động lấy trung bình vị trí của 3 sinh viên đầu tiên nếu thiết bị Giảng viên không có định vị GPS).';
  }
}

function probeLecturerDeviceGpsFast() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 3500, maximumAge: 0 }
    );
  });
}

async function teacherStartSession() {
  const auth = getTeacherAuth();
  const classId = document.getElementById('sel-tea-class').value;
  const isEn = currentLang === 'en';
  if (!auth || !classId) {
    showStatus(
      isEn
        ? 'Please select a class section before opening an attendance session.'
        : 'Vui lòng chọn lớp học phần trước khi mở phiên điểm danh.',
      'warn',
      'tea-session-inline-status'
    );
    return;
  }

  const advChk = document.getElementById('chk-use-student-avg3');
  const forceStudentAvg3 = Boolean(advChk && advChk.checked);

  showStatus(
    isEn
      ? 'Locating classroom and opening attendance session...'
      : 'Đang định vị phòng học và mở phiên điểm danh...',
    'warn',
    'tea-session-inline-status'
  );
  const pos = forceStudentAvg3 ? null : await probeLecturerDeviceGpsFast();
  const hasTeacherGps = Boolean(
    !forceStudentAvg3 &&
    pos &&
    pos.coords &&
    typeof pos.coords.latitude === 'number' &&
    typeof pos.coords.longitude === 'number' &&
    pos.coords.latitude !== 0 &&
    pos.coords.longitude !== 0 &&
    Number(pos.coords.accuracy || 9999) <= 150
  );

  const lat = hasTeacherGps ? pos.coords.latitude : 0;
  const lng = hasTeacherGps ? pos.coords.longitude : 0;
  const acc = hasTeacherGps ? Math.round(pos.coords.accuracy) : 0;
  const anchorMode = hasTeacherGps ? 'TEACHER_GPS' : 'STUDENT_AVG_3';

  const anchorHintEl = document.getElementById('tea-gps-anchor-hint');
  if (anchorHintEl) {
    anchorHintEl.textContent = hasTeacherGps
      ? (isEn
          ? `Default: Evaluated from Lecturer location (Accuracy ±${acc}m).`
          : `Mặc định: Đánh giá khoảng cách theo vị trí của Giảng viên (Sai số ±${acc}m).`)
      : (isEn
          ? 'Active: Classroom center is averaged from the first 3 verified students.'
          : 'Đang bật: Lấy tâm phòng học theo trung bình vị trí của 3 sinh viên đầu tiên.');
  }

  await executeStartSessionRequest(auth, classId, hasTeacherGps, lat, lng, acc, anchorMode);
}

async function executeStartSessionRequest(auth, classId, useGps, lat, lng, gpsAccuracy = 0, anchorMode = 'TEACHER_GPS') {
  const isEn = currentLang === 'en';
  showStatus(
    isEn ? `Opening attendance session for ${classId}...` : `Đang mở phiên điểm danh cho lớp ${classId}...`,
    'warn',
    'tea-session-inline-status'
  );
  const res = await callBackend(auth.apiUrl, {
    action: 'TEACHER_START_SESSION',
    teacherToken: auth.token,
    classId: classId,
    usePhoneGps: useGps,
    lat: lat,
    lng: lng,
    gpsAccuracy: gpsAccuracy,
    anchorMode: anchorMode,
    qrMode: 'STATIC'
  });

  if (res && res.ok) {
    selectedTeacherClassId = classId;
    teacherHasManuallySelectedClass = true;
    safeSetSession('cc_tea_selected_class', selectedTeacherClassId);
    safeSetLocal('cc_tea_selected_class', selectedTeacherClassId);
    await applyTeacherState(res, false);
    showStatus(
      useGps
        ? (isEn
            ? `Opened session for ${classId} (Evaluated from Lecturer location ±${gpsAccuracy}m).`
            : `Đã mở phiên lớp ${classId} (Đánh giá theo vị trí Giảng viên ±${gpsAccuracy}m).`)
        : (isEn
            ? `Opened session for ${classId} (Averaging the first 3 verified students as classroom center).`
            : `Đã mở phiên lớp ${classId} (Chế độ lấy trung bình GPS 3 sinh viên đầu tiên làm tâm phòng học).`),
      'success',
      'tea-session-inline-status'
    );
  } else {
    showStatus(
      res && res.message ? res.message : (isEn ? 'Unable to open attendance session.' : 'Không thể mở phiên điểm danh.'),
      'err',
      'tea-session-inline-status'
    );
  }
}

async function teacherControlSession(subAction, extra = {}) {
  const auth = getTeacherAuth();
  const classId = document.getElementById('sel-tea-class').value;
  if (!auth || !classId) {
    showStatus(currentLang === 'en' ? 'Please select a class section first.' : 'Vui lòng chọn lớp học phần trước.', 'warn');
    return;
  }
  cancelOpenSessionConfirm();
  const res = await callBackend(auth.apiUrl, Object.assign({
    action: 'TEACHER_CONTROL_SESSION',
    teacherToken: auth.token,
    classId: classId,
    subAction: subAction
  }, extra));
  if (res && res.ok) {
    await applyTeacherState(res, false);
  }
}

function detectCoCheckInSuspects(roster) {
  const suspectMap = {};
  const isEn = currentLang === 'en';
  (roster || []).forEach(s => {
    if (s.source && String(s.source).startsWith('SUSPECT_WITH_')) {
      const parts = String(s.source).split('|');
      const partnerId = parts[0].replace('SUSPECT_WITH_', '');
      const defaultReason = isEn
        ? `Duplicate device or coordinates with ${partnerId}`
        : `Trùng thiết bị hoặc tọa độ với ${partnerId}`;
      suspectMap[s.studentId] = parts[1] || defaultReason;
      if (partnerId && partnerId !== 'DEVTOOLS' && !suspectMap[partnerId]) {
        suspectMap[partnerId] = isEn
          ? `Duplicate device or coordinates with ${s.studentId}`
          : `Trùng thiết bị hoặc tọa độ với ${s.studentId}`;
      }
    }
  });
  return suspectMap;
}

function setRosterFilter(filterMode) {
  activeRosterFilter = filterMode || 'ALL';
  document.querySelectorAll('[data-roster-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-roster-filter') === activeRosterFilter);
  });
  renderTeacherRoster();
}

function renderTeacherRoster() {
  const container = document.getElementById('tea-roster-container');
  const suspectBanner = document.getElementById('tea-suspect-banner');
  if (!container) return;
  const isEn = currentLang === 'en';

  if (!selectedTeacherClassId) {
    if (suspectBanner) suspectBanner.classList.add('hidden');
    container.innerHTML = `<div style="padding:16px; text-align:center; color:var(--muted);">${isEn ? 'Please select a class section to view the student roster.' : 'Vui lòng chọn một lớp học phần để xem danh sách sinh viên.'}</div>`;
    return;
  }

  const searchInput = document.getElementById('inp-roster-search');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';

  const list = (teacherState && teacherState.roster) || [];
  const suspectMap = detectCoCheckInSuspects(list);
  const suspectIds = Object.keys(suspectMap);

  // Update quick filter tab counters even when roster names are hidden on projector
  const countAll = list.length;
  const countPresent = list.filter(s => s.status === 'P' || s.status === 'L').length;
  const countAbsent = list.filter(s => !s.status || s.status === '-').length;
  const countSuspect = suspectIds.length;

  const tabAll = document.getElementById('tab-filter-all');
  const tabPresent = document.getElementById('tab-filter-present');
  const tabAbsent = document.getElementById('tab-filter-absent');
  const tabSuspect = document.getElementById('tab-filter-suspect');
  if (tabAll) tabAll.textContent = isEn ? `All (${countAll})` : `Tất cả (${countAll})`;
  if (tabPresent) tabPresent.textContent = isEn ? `Present (${countPresent})` : `Có mặt (${countPresent})`;
  if (tabAbsent) tabAbsent.textContent = isEn ? `Absent (${countAbsent})` : `Vắng (${countAbsent})`;
  if (tabSuspect) tabSuspect.textContent = isEn ? `Suspect (${countSuspect})` : `Nghi vấn (${countSuspect})`;

  if (!showRosterNames && !query) {
    if (suspectBanner) suspectBanner.classList.add('hidden');
    container.innerHTML = `<div style="padding:16px; text-align:center; color:var(--muted);">${isEn ? 'Student roster is hidden on projector (Type a name or Student ID in the search box above for quick attendance).' : 'Đã ẩn danh sách sinh viên trên màn hình chiếu (Gõ họ tên hoặc mã số sinh viên ở ô tìm kiếm phía trên để điểm danh nhanh).'}</div>`;
    return;
  }

  if (suspectIds.length > 0) {
    suspectBanner.classList.remove('hidden');
    suspectBanner.textContent = isEn
      ? `[VERIFICATION ALERT] Detected ${suspectIds.length} technical anomaly case(s) (duplicate hardware fingerprint, identical coordinates, or GPS tampering).`
      : `[CẢNH BÁO KIỂM TRA] Phát hiện ${suspectIds.length} trường hợp nghi vấn kỹ thuật (trùng cấu hình máy, trùng tọa độ tuyệt đối hoặc can thiệp định vị GPS).`;
  } else {
    suspectBanner.classList.add('hidden');
  }

  const filtered = list.filter(s => {
    const matchesSearch = s.studentId.toLowerCase().includes(query) || s.fullName.toLowerCase().includes(query);
    if (!matchesSearch) return false;
    if (activeRosterFilter === 'PRESENT') return s.status === 'P' || s.status === 'L';
    if (activeRosterFilter === 'ABSENT') return !s.status || s.status === '-';
    if (activeRosterFilter === 'SUSPECT') return Boolean(suspectMap[s.studentId]);
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `<div style="padding:16px; text-align:center; color:var(--muted);">${isEn ? 'No students match the current filter.' : 'Không có sinh viên nào khớp bộ lọc.'}</div>`;
    return;
  }

  const nameCounts = {};
  list.forEach(s => {
    const key = String(s.fullName || '').trim().toLowerCase();
    nameCounts[key] = (nameCounts[key] || 0) + 1;
  });

  function cleanRosterTimeStr(rawTime) {
    const s = String(rawTime || '').trim();
    if (!s) return '';
    const m = s.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
    if (m) {
      return `${m[1].padStart(2, '0')}:${m[2]}`;
    }
    const mLegacy = s.match(/^\d{4}\s+(\d{1,2}):$/);
    if (mLegacy) {
      const hh = mLegacy[1].padStart(2, '0');
      const ses = teacherState && teacherState.activeSession;
      if (ses) {
        if (ses.sessionLabel) {
          const mLbl = String(ses.sessionLabel).match(/_(\d{2})(\d{2})$/);
          if (mLbl && mLbl[1] === hh) return `${hh}:${mLbl[2]}`;
        }
        if (ses.openedAtMs) {
          const d = new Date(Number(ses.openedAtMs));
          if (!isNaN(d.getTime()) && String(d.getHours()).padStart(2, '0') === hh) {
            return `${hh}:${String(d.getMinutes()).padStart(2, '0')}`;
          }
        }
      }
      return `${hh}:00`;
    }
    return '';
  }

  container.innerHTML = filtered.map(st => {
    const suspectNote = suspectMap[st.studentId];
    const isDuplicateName = (nameCounts[String(st.fullName || '').trim().toLowerCase()] || 0) > 1;
    const maskedTail = isDuplicateName && st.studentId ? ` (***${String(st.studentId).slice(-3)})` : '';
    const cleanTime = st.status && st.status !== '-' ? cleanRosterTimeStr(st.time) : '';
    const hasDist =
      (st.status === 'P' || st.status === 'L') &&
      st.distance !== '' &&
      st.distance !== null &&
      st.distance !== undefined &&
      String(st.distance).trim() !== '' &&
      !isNaN(Number(st.distance));
    const distNum = hasDist ? Math.round(Number(st.distance)) : null;
    return `
      <div class="roster-item ${suspectNote ? 'suspect-row' : ''}">
        <div class="roster-student-info">
          <strong title="MSSV: ${escapeHtml(st.studentId)}">${escapeHtml(st.fullName)}${escapeHtml(maskedTail)}</strong>
          ${cleanTime ? `<span style="font-size:0.75rem; color:var(--muted); font-family:var(--font-mono);">${escapeHtml(cleanTime)}</span>` : ''}
          ${distNum !== null ? `<span style="font-size:0.74rem; color:#0f766e; font-weight:600; font-family:var(--font-mono);">(${distNum}m)</span>` : ''}
          ${suspectNote ? `<span class="suspect-tag">[${isEn ? 'SUSPECT' : 'NGHI VẤN'}] ${escapeHtml(suspectNote)}</span>` : ''}
        </div>
        <div class="roster-actions">
          <button class="btn btn-outline btn-sm ${st.status === 'P' ? 'btn-mark-active-P' : ''}" title="${isEn ? 'Mark Present (P)' : 'Đánh dấu Có mặt (P)'}" onclick="teacherManualMark('${escapeHtml(st.studentId)}','P')">P</button>
          <button class="btn btn-outline btn-sm ${st.status === 'L' ? 'btn-mark-active-L' : ''}" title="${isEn ? 'Mark Late (L)' : 'Đánh dấu Đi trễ (L)'}" onclick="teacherManualMark('${escapeHtml(st.studentId)}','L')">L</button>
          <button class="btn btn-outline btn-sm ${st.status === 'E' ? 'btn-mark-active-E' : ''}" title="${isEn ? 'Mark Excused (E)' : 'Đánh dấu Có phép (E)'}" onclick="teacherManualMark('${escapeHtml(st.studentId)}','E')">E</button>
          <button class="btn btn-outline btn-sm" title="${isEn ? 'Revoke attendance (-)' : 'Hủy điểm danh (-)'}" onclick="teacherManualMark('${escapeHtml(st.studentId)}','-')">-</button>
          <button class="btn btn-outline btn-sm" title="${isEn ? 'Reset device lock' : 'Đặt lại khóa thiết bị'}" onclick="teacherResetStudentDevice('${escapeHtml(st.studentId)}')">${isEn ? 'Unlock' : 'Mở khóa'}</button>
        </div>
      </div>
    `;
  }).join('');
}

async function handleRosterSearchKeydown(event) {
  if (!event || event.key !== 'Enter') return;
  event.preventDefault();
  const searchInput = document.getElementById('inp-roster-search');
  const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
  if (!query) return;

  const list = (teacherState && teacherState.roster) || [];
  const matches = list.filter(s =>
    s.studentId.toLowerCase().includes(query) || s.fullName.toLowerCase().includes(query)
  );
  if (matches.length === 1) {
    const target = matches[0];
    searchInput.value = '';
    await teacherManualMark(target.studentId, 'P');
    showStatus(
      currentLang === 'en'
        ? `Marked PRESENT (P) for ${target.fullName} (${target.studentId}).`
        : `Đã ghi nhận CÓ MẶT (P) nhanh cho ${target.fullName} (${target.studentId}).`,
      'success',
      'tea-session-inline-status'
    );
  }
}

function formatProjectorDisplayName(studentObj, fullRoster) {
  if (!studentObj) return '';
  const list = Array.isArray(fullRoster) ? fullRoster : [];
  const targetNameKey = String(studentObj.fullName || '').trim().toLowerCase();
  const dupCount = list.filter(s => String(s.fullName || '').trim().toLowerCase() === targetNameKey).length;
  const suffix = (dupCount > 1 && studentObj.studentId) ? ` (***${String(studentObj.studentId).slice(-3)})` : '';
  return `${studentObj.fullName}${suffix}`;
}

function triggerRandomSpotCheck() {
  const list = (teacherState && teacherState.roster) || [];
  const checkedIn = list.filter(s => s.status === 'P' || s.status === 'L');
  const isEn = currentLang === 'en';
  if (checkedIn.length === 0) {
    showStatus(
      isEn ? 'No students have checked in during this session yet.' : 'Chưa có sinh viên nào điểm danh trong phiên này.',
      'warn'
    );
    return;
  }

  const classKey = selectedTeacherClassId || 'DEFAULT';
  if (!randomCallerVisitedByClass[classKey]) {
    randomCallerVisitedByClass[classKey] = new Set();
  }
  const visitedSet = randomCallerVisitedByClass[classKey];

  let remainingPool = checkedIn.filter(s => !visitedSet.has(s.studentId));
  if (remainingPool.length === 0) {
    visitedSet.clear();
    remainingPool = checkedIn.slice();
  }

  const pick = remainingPool[Math.floor(Math.random() * remainingPool.length)];
  visitedSet.add(pick.studentId);

  const displayName = formatProjectorDisplayName(pick, list);
  const calledCount = visitedSet.size;
  const totalPresent = checkedIn.length;

  const htmlBody = `
    <div style="text-align:center; padding:10px 4px;">
      <div style="font-size:0.76rem; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em; margin-bottom:6px;">
        ${isEn ? `Called ${calledCount} / ${totalPresent} present students` : `Lượt gọi ${calledCount} / ${totalPresent} sinh viên có mặt`}
      </div>
      <div style="font-size:1.35rem; font-weight:800; color:var(--primary); line-height:1.3; margin-bottom:6px;">
        ${escapeHtml(displayName)}
      </div>
      <div style="font-size:0.8rem; color:var(--text-secondary); font-family:var(--font-mono);">
        ${isEn ? `Status: ${pick.status} • Checked in at: ${pick.time || 'N/A'}` : `Trạng thái: ${pick.status} • Điểm danh lúc: ${pick.time || 'N/A'}`}
      </div>
    </div>
  `;

  openAppModal(
    isEn ? 'Random Student Call' : 'Gọi Sinh viên Ngẫu nhiên',
    '',
    isEn ? 'Revoke & Lock (-)' : 'Hủy & Khóa (-)',
    async () => {
      await teacherManualMark(pick.studentId, '-');
      showStatus(
        isEn
          ? `Revoked attendance and locked re-submission in this session for ${displayName}.`
          : `Đã hủy điểm danh và khóa nộp lại trong phiên này đối với ${displayName}.`,
        'warn'
      );
    },
    {
      htmlBody: htmlBody,
      confirmClass: 'btn btn-danger',
      extraLabel: isEn ? 'Call Next' : 'Gọi tiếp',
      extraClass: 'btn btn-primary',
      keepOpenOnExtra: true,
      onExtra: () => {
        triggerRandomSpotCheck();
      }
    }
  );
}

function deriveActiveSessionDayMeta() {
  const ses = teacherState && teacherState.activeSession;
  if (!ses || !ses.sessionId) return null;
  if (selectedTeacherClassId && ses.classId && ses.classId !== selectedTeacherClassId) return null;

  let dayKey = '';
  let dateStr = '';
  const pad2 = n => String(n).padStart(2, '0');

  if (ses.openedAtMs && Number(ses.openedAtMs) > 0) {
    const d = new Date(Number(ses.openedAtMs));
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = pad2(d.getMonth() + 1);
      const dd = pad2(d.getDate());
      dayKey = `${yyyy}-${mm}-${dd}`;
      dateStr = `${dd}/${mm}/${yyyy}`;
    }
  }

  if (!dayKey) {
    const mSes = String(ses.sessionId).match(/_(\d{4})(\d{2})(\d{2})_/);
    if (mSes) {
      dayKey = `${mSes[1]}-${mSes[2]}-${mSes[3]}`;
      dateStr = `${mSes[3]}/${mSes[2]}/${mSes[1]}`;
    }
  }

  if (!dayKey) {
    dayKey = ses.sessionLabel || ses.sessionId;
    dateStr = dayKey;
  }

  return {
    dayKey: dayKey,
    date: dateStr || dayKey,
    label: ses.sessionLabel || '',
    sessionId: ses.sessionId || ''
  };
}

function getEffectiveStudentHistory(st) {
  const hist = (st && st.attendanceStats && Array.isArray(st.attendanceStats.history))
    ? st.attendanceStats.history.slice()
    : [];
  const activeMeta = deriveActiveSessionDayMeta();
  if (activeMeta && activeMeta.dayKey) {
    const exists = hist.some(h => h && h.dayKey === activeMeta.dayKey);
    if (!exists) {
      hist.push({
        dayKey: activeMeta.dayKey,
        date: activeMeta.date,
        label: activeMeta.label,
        sessionId: activeMeta.sessionId,
        status: (st && st.status) ? st.status : '-'
      });
    }
  }
  return hist;
}

function collectClassSessionDaysFromRoster() {
  const list = (teacherState && teacherState.roster) || [];
  const dayMap = {};
  list.forEach(st => {
    const hist = getEffectiveStudentHistory(st);
    hist.forEach(h => {
      if (h && h.dayKey && !dayMap[h.dayKey]) {
        dayMap[h.dayKey] = {
          dayKey: h.dayKey,
          date: h.date || h.dayKey,
          label: h.label || '',
          sessionId: h.sessionId || ''
        };
      }
    });
  });
  return Object.values(dayMap).sort((a, b) => b.dayKey.localeCompare(a.dayKey));
}

function refreshHistoryModalDateOptionsIfNeeded() {
  const selDateEl = document.getElementById('sel-hist-date');
  if (!selDateEl) return;
  const isEn = currentLang === 'en';
  const currentVal = selDateEl.value;
  const days = collectClassSessionDaysFromRoster();
  if (days.length === 0) return;

  const hasCurrent = days.some(d => d.dayKey === currentVal);
  const selectedVal = (currentVal && currentVal !== 'ALL' && hasCurrent)
    ? currentVal
    : (currentVal === 'ALL' && selDateEl.options.length > 1 ? 'ALL' : days[0].dayKey);

  const dateOptsHtml = [
    `<option value="ALL" ${selectedVal === 'ALL' ? 'selected' : ''}>${isEn ? '-- All Sessions --' : '-- Tất cả các buổi học --'}</option>`
  ].concat(
    days.map(d => {
      const lbl = d.label ? `${d.date} (${d.label})` : d.date;
      return `<option value="${escapeHtml(d.dayKey)}" ${d.dayKey === selectedVal ? 'selected' : ''}>${escapeHtml(lbl)}</option>`;
    })
  ).join('');
  selDateEl.innerHTML = dateOptsHtml;
  selDateEl.value = selectedVal;
}

function openAttendanceHistoryManagerModal() {
  const isEn = currentLang === 'en';
  const list = (teacherState && teacherState.roster) || [];
  if (!selectedTeacherClassId || list.length === 0) {
    showStatus(
      isEn ? 'Please select a class section first.' : 'Vui lòng chọn lớp học phần trước.',
      'warn'
    );
    return;
  }

  const days = collectClassSessionDaysFromRoster();
  const defaultDayKey = days.length > 0 ? days[0].dayKey : 'ALL';

  const dateOptsHtml = [
    `<option value="ALL" ${defaultDayKey === 'ALL' ? 'selected' : ''}>${isEn ? '-- All Sessions --' : '-- Tất cả các buổi học --'}</option>`
  ].concat(
    days.map(d => {
      const lbl = d.label ? `${d.date} (${d.label})` : d.date;
      return `<option value="${escapeHtml(d.dayKey)}" ${d.dayKey === defaultDayKey ? 'selected' : ''}>${escapeHtml(lbl)}</option>`;
    })
  ).join('');

  const htmlBody = `
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:10px;">
      <div>
        <label for="sel-hist-date" style="font-size:0.77rem; margin-bottom:3px;">${isEn ? 'Select Session Date:' : 'Chọn ngày điểm danh:'}</label>
        <select id="sel-hist-date" onchange="renderHistoryModalList()" style="margin-bottom:0; padding:7px 10px;">${dateOptsHtml}</select>
      </div>
      <div>
        <input type="text" id="inp-hist-search" oninput="renderHistoryModalList()" placeholder="${isEn ? 'Search student name or Student ID...' : 'Gõ họ tên hoặc mã số sinh viên...'}" style="margin-bottom:0; padding:7px 10px;" />
      </div>
    </div>
    <div id="hist-modal-rows" class="past-ses-list"></div>
  `;

  openAppModal(
    isEn ? 'Attendance History' : 'Lịch sử Điểm danh',
    '',
    '',
    null,
    {
      wide: true,
      htmlBody: htmlBody,
      hideConfirm: true
    }
  );

  renderHistoryModalList();

  // If full attendanceStats history was not yet loaded in cache, trigger a fresh sync in the background
  if (!list[0] || !list[0].attendanceStats || !Array.isArray(list[0].attendanceStats.history)) {
    refreshTeacherState(true);
  }
}

function renderHistoryModalList() {
  const container = document.getElementById('hist-modal-rows');
  if (!container) return;
  const isEn = currentLang === 'en';
  const selDateEl = document.getElementById('sel-hist-date');
  const searchEl = document.getElementById('inp-hist-search');
  const selectedDayKey = selDateEl ? selDateEl.value : 'ALL';
  const query = searchEl ? searchEl.value.trim().toLowerCase() : '';

  const list = (teacherState && teacherState.roster) || [];
  const days = collectClassSessionDaysFromRoster();
  if (days.length === 0) {
    container.innerHTML = `<div style="padding:12px 0; color:var(--muted); font-size:0.82rem; text-align:center;">${isEn ? 'No attendance sessions recorded for this class yet.' : 'Lớp học phần này chưa có lịch sử buổi điểm danh nào.'}</div>`;
    return;
  }

  const matchedStudents = list.filter(st =>
    !query || st.fullName.toLowerCase().includes(query) || st.studentId.toLowerCase().includes(query)
  );

  const items = [];
  matchedStudents.forEach(st => {
    const hist = getEffectiveStudentHistory(st).slice().reverse();
    hist.forEach(h => {
      if (!h || !h.dayKey) return;
      if (selectedDayKey !== 'ALL' && h.dayKey !== selectedDayKey) return;
      const curSt = h.status === 'OPEN' ? '-' : (h.status || '-');
      items.push({
        studentId: st.studentId,
        fullName: formatProjectorDisplayName(st, list),
        dayKey: h.dayKey,
        date: h.date || h.dayKey,
        label: h.label || '',
        sessionId: h.sessionId || '',
        status: curSt
      });
    });
  });

  if (selectedDayKey === 'ALL' && !query) {
    const rank = { '-': 0, 'E': 1, 'L': 2, 'P': 3 };
    items.sort((a, b) => {
      const ra = rank[a.status] !== undefined ? rank[a.status] : 4;
      const rb = rank[b.status] !== undefined ? rank[b.status] : 4;
      if (ra !== rb) return ra - rb;
      return b.dayKey.localeCompare(a.dayKey);
    });
  }

  if (items.length === 0) {
    container.innerHTML = `<div style="padding:12px 0; color:var(--muted); font-size:0.82rem; text-align:center;">${isEn ? 'No matching attendance records found.' : 'Không có bản ghi nào khớp điều kiện lọc.'}</div>`;
    return;
  }

  container.innerHTML = items.map(item => {
    const rowDomId = `${escapeHtml(item.studentId)}_${escapeHtml(item.dayKey)}`;
    const safeSid = escapeHtml(item.studentId);
    const safeName = escapeHtml(item.fullName);
    const safeDayKey = escapeHtml(item.dayKey);
    const safeDate = escapeHtml(item.date);
    const safeSesId = escapeHtml(item.sessionId);
    const curSt = item.status;

    return `
      <div class="past-ses-row" id="past-row-${rowDomId}">
        <div class="past-ses-row-main">
          <div>
            <strong>${safeName}</strong>
            <span style="font-size:0.75rem; color:var(--muted); margin-left:6px; font-family:var(--font-mono);">${safeDate}</span>
            <span id="past-pill-${rowDomId}" class="status-pill st-${curSt}" style="margin-left:6px;">${escapeHtml(curSt)}</span>
          </div>
          <div style="display:flex; gap:4px;">
            <button type="button" class="btn btn-outline btn-sm ${curSt === 'P' ? 'btn-mark-active-P' : ''}" onclick="promptPastSessionConfirm('${safeSid}','${safeName}','${safeDayKey}','${safeDate}','${safeSesId}','${curSt}','P')">P</button>
            <button type="button" class="btn btn-outline btn-sm ${curSt === 'L' ? 'btn-mark-active-L' : ''}" onclick="promptPastSessionConfirm('${safeSid}','${safeName}','${safeDayKey}','${safeDate}','${safeSesId}','${curSt}','L')">L</button>
            <button type="button" class="btn btn-outline btn-sm ${curSt === 'E' ? 'btn-mark-active-E' : ''}" onclick="promptPastSessionConfirm('${safeSid}','${safeName}','${safeDayKey}','${safeDate}','${safeSesId}','${curSt}','E')">E</button>
            <button type="button" class="btn btn-outline btn-sm ${curSt === '-' ? 'btn-mark-active--' : ''}" onclick="promptPastSessionConfirm('${safeSid}','${safeName}','${safeDayKey}','${safeDate}','${safeSesId}','${curSt}','-')">-</button>
          </div>
        </div>
        <div id="past-confirm-${rowDomId}" class="past-ses-confirm-box hidden"></div>
      </div>
    `;
  }).join('');
}

function promptPastSessionConfirm(studentId, fullName, dayKey, dateLabel, sessionId, oldStatus, newStatus) {
  const rowDomId = `${studentId}_${dayKey}`;
  const confirmEl = document.getElementById(`past-confirm-${rowDomId}`);
  if (!confirmEl) return;
  if (oldStatus === newStatus) {
    confirmEl.classList.add('hidden');
    return;
  }

  const isEn = currentLang === 'en';
  const safeSid = escapeHtml(studentId);
  const safeDayKey = escapeHtml(dayKey);
  const safeSesId = escapeHtml(sessionId);
  const safeNew = escapeHtml(newStatus);

  confirmEl.innerHTML = `
    <span>${isEn ? `Confirm changing ${dateLabel} for ${fullName}: ${oldStatus} -> ${newStatus}?` : `Xác nhận đổi ngày ${escapeHtml(dateLabel)} của ${escapeHtml(fullName)}: ${escapeHtml(oldStatus)} -> ${safeNew}?`}</span>
    <div style="display:flex; gap:6px;">
      <button type="button" class="btn btn-outline btn-sm" onclick="cancelPastSessionConfirm('${safeSid}','${safeDayKey}')">${isEn ? 'Cancel' : 'Hủy'}</button>
      <button type="button" class="btn btn-primary btn-sm" onclick="teacherMarkPastSession('${safeSid}','${safeDayKey}','${safeSesId}','${safeNew}')">${isEn ? 'Confirm' : 'Xác nhận'}</button>
    </div>
  `;
  confirmEl.classList.remove('hidden');
}

function cancelPastSessionConfirm(studentId, dayKey) {
  const confirmEl = document.getElementById(`past-confirm-${studentId}_${dayKey}`);
  if (confirmEl) confirmEl.classList.add('hidden');
}

async function teacherMarkPastSession(studentId, dayKey, sessionId, newStatus) {
  const auth = getTeacherAuth();
  const classId = document.getElementById('sel-tea-class').value || selectedTeacherClassId;
  const isEn = currentLang === 'en';
  if (!auth || !classId || !studentId) return;

  const rowDomId = `${studentId}_${dayKey}`;
  cancelPastSessionConfirm(studentId, dayKey);

  // Instant 0.01s visual update inside the modal & local teacherState
  const pillEl = document.getElementById(`past-pill-${rowDomId}`);
  if (pillEl) {
    pillEl.className = `status-pill st-${newStatus}`;
    pillEl.textContent = newStatus;
  }

  if (teacherState && Array.isArray(teacherState.roster)) {
    const st = teacherState.roster.find(r => r && r.studentId === studentId);
    if (st) {
      const activeMeta = deriveActiveSessionDayMeta();
      if (activeMeta && activeMeta.dayKey === dayKey) {
        st.status = newStatus;
      }
      if (st.attendanceStats && Array.isArray(st.attendanceStats.history)) {
        const hItem = st.attendanceStats.history.find(h => h && h.dayKey === dayKey);
        if (hItem) hItem.status = newStatus;
      }
    }
    renderTeacherRoster();
  }
  renderHistoryModalList();

  if (typeof recordLocalStudentSessionMark === 'function') {
    recordLocalStudentSessionMark(studentId, classId, dayKey, newStatus === '-' ? 'A' : newStatus, '');
  }

  const res = await callBackend(auth.apiUrl, {
    action: 'TEACHER_MANUAL_MARK',
    teacherToken: auth.token,
    classId: classId,
    studentId: studentId,
    status: newStatus,
    targetDayKey: dayKey,
    targetSessionId: sessionId
  });

  if (res && res.ok) {
    await applyTeacherState(res, false);
    renderHistoryModalList();
    showStatus(
      isEn
        ? `Updated session ${dayKey} -> ${newStatus} for ${studentId}.`
        : `Đã cập nhật buổi ${dayKey} -> ${newStatus} cho MSSV ${studentId}.`,
      'success',
      'tea-session-inline-status'
    );
  }
}

function buildShuffledGroups(pool, groupSize) {
  const arr = pool.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  const size = Math.max(2, Number(groupSize || 4));
  const groups = [];
  for (let i = 0; i < arr.length; i += size) {
    groups.push({
      groupNumber: groups.length + 1,
      members: arr.slice(i, i + size)
    });
  }
  // If the last group has only 1 student and there are other groups, merge that student into the previous group
  if (groups.length > 1 && groups[groups.length - 1].members.length === 1) {
    const lone = groups.pop().members[0];
    groups[groups.length - 1].members.push(lone);
  }
  return groups;
}

function renderGroupMakerModalContent(groupSize, reshuffle = false) {
  const isEn = currentLang === 'en';
  const list = (teacherState && teacherState.roster) || [];
  const presentStudents = list.filter(s => s.status === 'P' || s.status === 'L');
  const pool = presentStudents.length > 0 ? presentStudents : list;
  const usingFullRoster = presentStudents.length === 0;

  if (groupSize) currentDraftGroupSize = Number(groupSize);
  if (reshuffle || currentDraftGroups.length === 0) {
    currentDraftGroups = buildShuffledGroups(pool, currentDraftGroupSize);
  }

  const sizeOptionsHtml = [2, 3, 4, 5].map(sz => `
    <button type="button" class="btn ${currentDraftGroupSize === sz ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="changeGroupMakerSize(${sz})">
      ${sz} ${isEn ? 'per group' : 'SV/nhóm'}
    </button>
  `).join('');

  const groupsGridHtml = currentDraftGroups.map(g => {
    const membersHtml = g.members.map((m, idx) =>
      `<div class="group-box-member">${idx + 1}. ${escapeHtml(formatProjectorDisplayName(m, list))}</div>`
    ).join('');
    return `
      <div class="group-box">
        <div class="group-box-title">${isEn ? `Group #${g.groupNumber}` : `Nhóm ${g.groupNumber}`} (${g.members.length})</div>
        ${membersHtml}
      </div>
    `;
  }).join('');

  const poolNote = usingFullRoster
    ? (isEn
        ? `No active check-ins yet — splitting all ${pool.length} students on roster`
        : `Chưa có SV điểm danh phiên này — Đang chia theo danh sách lớp (${pool.length} SV)`)
    : (isEn
        ? `Splitting ${pool.length} present students into ${currentDraftGroups.length} groups`
        : `Đang chia ${pool.length} sinh viên có mặt thành ${currentDraftGroups.length} nhóm`);

  return `
    <div class="group-maker-toolbar">
      <div style="font-size:0.78rem; font-weight:600; color:var(--text-secondary);">${escapeHtml(poolNote)}</div>
      <div style="display:flex; gap:4px; flex-wrap:wrap;">${sizeOptionsHtml}</div>
    </div>
    <div class="group-maker-grid">${groupsGridHtml}</div>
  `;
}

function changeGroupMakerSize(newSize) {
  currentDraftGroupSize = Number(newSize || 4);
  const bodyEl = document.getElementById('app-modal-body');
  if (bodyEl) {
    bodyEl.innerHTML = renderGroupMakerModalContent(currentDraftGroupSize, true);
  }
}

function openGroupMakerModal() {
  const isEn = currentLang === 'en';
  const list = (teacherState && teacherState.roster) || [];
  if (!selectedTeacherClassId || list.length === 0) {
    showStatus(
      isEn ? 'Please select a class with students first.' : 'Vui lòng chọn lớp học phần có danh sách sinh viên trước.',
      'warn'
    );
    return;
  }

  const existingPublished = teacherState && teacherState.activeGroupSplit && Array.isArray(teacherState.activeGroupSplit.groups)
    ? teacherState.activeGroupSplit
    : null;
  if (existingPublished && existingPublished.groups.length > 0 && currentDraftGroups.length === 0) {
    currentDraftGroups = existingPublished.groups;
    currentDraftGroupSize = Number(existingPublished.groupSize || 4);
  } else {
    currentDraftGroups = [];
  }

  const htmlBody = renderGroupMakerModalContent(currentDraftGroupSize, currentDraftGroups.length === 0);

  openAppModal(
    isEn ? 'Classroom Group Maker' : 'Chia nhóm Thảo luận trên lớp',
    '',
    isEn ? 'Send Groups to Student Phones' : 'Gửi nhóm về ĐT Sinh viên',
    async () => {
      await publishClassroomGroupsToStudents(false);
    },
    {
      wide: true,
      htmlBody: htmlBody,
      extraLabel: isEn ? 'Reshuffle' : 'Trộn lại',
      extraClass: 'btn btn-outline',
      keepOpenOnExtra: true,
      onExtra: () => {
        const bodyEl = document.getElementById('app-modal-body');
        if (bodyEl) {
          bodyEl.innerHTML = renderGroupMakerModalContent(currentDraftGroupSize, true);
        }
      }
    }
  );
}

async function publishClassroomGroupsToStudents(clearGroups = false) {
  const auth = getTeacherAuth();
  const classId = document.getElementById('sel-tea-class').value || selectedTeacherClassId;
  const isEn = currentLang === 'en';
  if (!auth || !classId) return;

  const res = await callBackend(auth.apiUrl, {
    action: 'TEACHER_PUBLISH_GROUPS',
    teacherToken: auth.token,
    classId: classId,
    clear: Boolean(clearGroups),
    groupSize: currentDraftGroupSize,
    groups: clearGroups ? [] : currentDraftGroups.map(g => ({
      groupNumber: g.groupNumber,
      members: (g.members || []).map(m => ({
        studentId: m.studentId,
        fullName: m.fullName
      }))
    }))
  });

  if (res && res.ok) {
    if (teacherState) {
      teacherState.activeGroupSplit = res.activeGroupSplit || null;
    }
    showStatus(
      clearGroups
        ? (isEn ? 'Cleared classroom groups.' : 'Đã xóa danh sách chia nhóm.')
        : (isEn
            ? `Published ${currentDraftGroups.length} groups to students' phones.`
            : `Đã gửi danh sách ${currentDraftGroups.length} nhóm về màn hình điện thoại của sinh viên.`),
      'success',
      'tea-session-inline-status'
    );
  }
}

function overlayPendingManualMarksOnRoster(rosterList) {
  if (!Array.isArray(rosterList)) return;
  const now = Date.now();
  Object.keys(pendingManualMarks).forEach(sid => {
    if (!pendingManualMarks[sid] || now >= pendingManualMarks[sid].expiresAt) {
      delete pendingManualMarks[sid];
    }
  });
  rosterList.forEach(st => {
    const pending = st && pendingManualMarks[st.studentId];
    if (pending && now < pending.expiresAt) {
      st.status = pending.status;
      st.time = pending.time;
      st.distance = pending.distance;
      st.source = 'TEACHER_MANUAL';
    }
  });
}

function updateTeacherLiveCountersFromRoster() {
  if (!teacherState || !Array.isArray(teacherState.roster)) return;
  const isEn = currentLang === 'en';
  const roster = teacherState.roster;
  const pCount = roster.filter(r => r.status === 'P').length;
  const lCount = roster.filter(r => r.status === 'L').length;
  const eCount = roster.filter(r => r.status === 'E').length;
  const aCount = roster.filter(r => !r.status || r.status === '-').length;

  const countEl = document.getElementById('tea-live-count');
  const breakEl = document.getElementById('tea-live-breakdown');
  if (countEl) {
    countEl.textContent = isEn
      ? `${pCount + lCount} / ${roster.length} Present`
      : `${pCount + lCount} / ${roster.length} Có mặt`;
  }
  if (breakEl) {
    breakEl.textContent = `P: ${pCount} | L: ${lCount} | A: ${aCount} | E: ${eCount}`;
  }
}

async function teacherManualMark(studentId, status) {
  const auth = getTeacherAuth();
  const classId = document.getElementById('sel-tea-class').value || selectedTeacherClassId;
  if (!auth || !classId) return;
  if (teacherState && !teacherState.activeSession) {
    showStatus(
      currentLang === 'en'
        ? 'Please open an attendance session first before marking students.'
        : 'Vui lòng mở phiên điểm danh cho lớp này trước khi chấm tay.',
      'warn',
      'tea-session-inline-status'
    );
    return;
  }

  // 1. Instant 0.01s Optimistic UI Update (updates badge, counters, and roster immediately before network round-trip)
  const nowD = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  const nowTimeStr = `${pad2(nowD.getHours())}:${pad2(nowD.getMinutes())}`;
  let prevSnapshot = null;

  if (teacherState && Array.isArray(teacherState.roster)) {
    const targetRow = teacherState.roster.find(r => r && r.studentId === studentId);
    if (targetRow) {
      prevSnapshot = {
        status: targetRow.status,
        time: targetRow.time,
        distance: targetRow.distance,
        source: targetRow.source
      };
    }
  }

  pendingManualMarks[studentId] = {
    status: status,
    time: status === '-' ? '' : nowTimeStr,
    distance: status === '-' ? '' : 0,
    expiresAt: Date.now() + 10000
  };

  if (!showRosterNames) {
    const searchInput = document.getElementById('inp-roster-search');
    if (searchInput) searchInput.value = '';
  }

  if (teacherState && Array.isArray(teacherState.roster)) {
    overlayPendingManualMarksOnRoster(teacherState.roster);
    updateTeacherLiveCountersFromRoster();
    safeSetSession('cc_tea_state_cache', JSON.stringify(teacherState));
    renderTeacherRoster();
  }

  // Immediately update local student attendance summary so switching to Student tab reflects the manual mark in 0ms
  const sesKey = (teacherState && teacherState.activeSession && teacherState.activeSession.sessionId)
    ? teacherState.activeSession.sessionId
    : getTodayDateKey();
  if (typeof recordLocalStudentSessionMark === 'function') {
    recordLocalStudentSessionMark(studentId, classId, sesKey, status === '-' ? 'A' : status, status === '-' ? '' : nowTimeStr);
  }
  try {
    const profiles = getStudentProfiles();
    Object.keys(profiles).forEach(instKey => {
      const prof = profiles[instKey];
      if (prof && String(prof.studentId || '').trim().toUpperCase() === String(studentId || '').trim().toUpperCase() && Array.isArray(prof.enrolledClasses)) {
        const ec = prof.enrolledClasses.find(c => c && c.classId === classId);
        if (ec && ec.attendanceStats && typeof ec.attendanceStats === 'object') {
          const stObj = Object.assign({ P: 0, L: 0, E: 0, A: 0, total: 0 }, ec.attendanceStats);
          const oldSt = prevSnapshot ? prevSnapshot.status : '';
          if (oldSt === 'P' && stObj.P > 0) stObj.P--;
          else if (oldSt === 'L' && stObj.L > 0) stObj.L--;
          else if (oldSt === 'E' && stObj.E > 0) stObj.E--;
          else if (oldSt === '-' && stObj.A > 0) stObj.A--;

          if (status === 'P') stObj.P++;
          else if (status === 'L') stObj.L++;
          else if (status === 'E') stObj.E++;
          else if (status === '-') stObj.A++;

          stObj.total = stObj.P + stObj.L + stObj.E + stObj.A;
          ec.attendanceStats = stObj;
          saveStudentProfile(instKey, prof);
        }
      }
    });
  } catch (e) {}
  safeSetLocal('cc_tea_last_preview_mark', JSON.stringify({
    studentId: String(studentId || '').trim().toUpperCase(),
    classId: classId,
    status: status
  }));
  if (typeof renderStudentAttendanceSummary === 'function') {
    renderStudentAttendanceSummary('', classId);
  }

  // 2. Background Server Sync
  const res = await callBackend(auth.apiUrl, {
    action: 'TEACHER_MANUAL_MARK',
    teacherToken: auth.token,
    classId: classId,
    studentId: studentId,
    status: status
  });
  delete pendingManualMarks[studentId];

  if (res && res.ok) {
    await applyTeacherState(res, false);
  } else {
    if (prevSnapshot && teacherState && Array.isArray(teacherState.roster)) {
      const targetRow = teacherState.roster.find(r => r && r.studentId === studentId);
      if (targetRow) Object.assign(targetRow, prevSnapshot);
      updateTeacherLiveCountersFromRoster();
      renderTeacherRoster();
    }
    showStatus(
      res && res.message ? res.message : (currentLang === 'en' ? 'Error updating status.' : 'Lỗi cập nhật trạng thái.'),
      'err',
      'tea-session-inline-status'
    );
  }
}

async function teacherResetStudentDevice(studentId) {
  const auth = getTeacherAuth();
  if (!auth || !studentId) return;
  if (!showRosterNames) {
    const searchInput = document.getElementById('inp-roster-search');
    if (searchInput) searchInput.value = '';
    renderTeacherRoster();
  }
  const res = await callBackend(auth.apiUrl, {
    action: 'TEACHER_RESET_DEVICE',
    teacherToken: auth.token,
    studentId: studentId
  });
  if (res && res.ok) {
    showStatus(formatServerMessage('DEVICE_RESET_OK', { id: studentId }), 'success', 'tea-session-inline-status');
  } else {
    showStatus(
      res && res.message ? res.message : (currentLang === 'en' ? 'Unable to unlock device.' : 'Không thể mở khóa thiết bị.'),
      'warn',
      'tea-session-inline-status'
    );
  }
}

async function teacherToggleRegGate() {
  const auth = getTeacherAuth();
  const classId = document.getElementById('sel-tea-class').value;
  const isEn = currentLang === 'en';
  if (!auth || !classId) {
    showStatus(isEn ? 'Please select a class section first.' : 'Vui lòng chọn lớp học phần trước.', 'warn', 'tea-admin-inline-status');
    return;
  }
  const res = await callBackend(auth.apiUrl, {
    action: 'TEACHER_TOGGLE_REG',
    teacherToken: auth.token,
    classId: classId
  });
  if (res && res.ok) {
    await applyTeacherState(res, false);
    showStatus(
      isEn ? 'Updated new device registration gate status.' : 'Đã cập nhật trạng thái cổng đăng ký thiết bị mới.',
      'success',
      'tea-admin-inline-status'
    );
  }
}

async function teacherRebuildSheet() {
  const auth = getTeacherAuth();
  const classId = document.getElementById('sel-tea-class').value;
  const isEn = currentLang === 'en';
  if (!auth) return;
  showStatus(
    isEn
      ? 'Checking Drive rosters and syncing attendance to Google Sheet...'
      : 'Đang kiểm tra danh sách Drive và đồng bộ kết quả vào Google Sheet...',
    'warn',
    'tea-admin-inline-status'
  );
  const res = await callBackend(auth.apiUrl, {
    action: 'TEACHER_REBUILD_REPORT',
    teacherToken: auth.token,
    classId: classId
  });
  if (res && res.ok) {
    if (res.newStudentsAdded && res.newStudentsAdded > 0) {
      await refreshTeacherState();
      const namesStr = Array.isArray(res.newStudentNames) && res.newStudentNames.length > 0
        ? ` (${res.newStudentNames.join(', ')})`
        : '';
      showStatus(
        isEn
          ? `Added ${res.newStudentsAdded} new student(s) from Drive${namesStr} and synced Google Sheet.`
          : `Đã bổ sung ${res.newStudentsAdded} sinh viên mới từ Drive${namesStr} và đồng bộ Google Sheet thành công.`,
        'success',
        'tea-admin-inline-status'
      );
    } else {
      showStatus(
        isEn ? 'Successfully synced attendance data to Google Sheet.' : 'Đã đồng bộ dữ liệu vào Google Sheet thành công.',
        'success',
        'tea-admin-inline-status'
      );
    }
  }
}

function toggleRosterVisibility() {
  showRosterNames = !showRosterNames;
  renderTeacherRoster();
}

function toggleProjectorFullscreen() {
  const main = document.getElementById('main-container');
  main.classList.toggle('wide');
  if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else if (document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
}

function startTeacherPolling() {
  stopTeacherPolling();
  teacherPollTimer = setInterval(() => refreshTeacherState(false), 2500);
}

function stopTeacherPolling() {
  if (teacherPollTimer) clearInterval(teacherPollTimer);
}
