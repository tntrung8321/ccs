/**
 * ============================================================================
 * LECTURER CONTROLLER (js/teacher.js — v3.4.5)
 *  - Sheet-Based Rotating 6-Digit Session Code & Master Key Authentication
 *  - Zero-Flicker Session & Class Restoration on Browser Refresh (F5)
 *  - Real-Time Class Auto-Selection (Google Calendar + Period Slots 123/456/789/10-12/13-15)
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
  teacherState = state;
  safeSetSession('cc_tea_state_cache', JSON.stringify(state));

  cleanClasses.forEach(c => {
    if (c.classId && c.activeQrSecret) {
      KNOWN_CLASS_SECRETS[c.classId] = c.activeQrSecret;
    }
  });

  // Resolve real-time class from Google Calendar / Period Slots (123, 456, 789, 10-12, 13-15) / Open Session
  const scheduleMatch = resolveActiveClassBySchedule(cleanClasses, new Date());

  if (isInitialLoad && !teacherHasManuallySelectedClass) {
    // Auto-select the class matching the current period/calendar, or "" if outside teaching hours
    selectedTeacherClassId = scheduleMatch.matchedClassId || '';
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
    selectedTeacherClassId = scheduleMatch.matchedClassId || '';
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
  sel.classList.toggle('unselected-warning', !selectedTeacherClassId);

  const activeCfg = cleanClasses.find(c => c.classId === selectedTeacherClassId) || null;
  const ses = activeCfg ? state.activeSession : null;

  // Update Real-Time Schedule & Class Overview Banner
  updateTeacherClassOverviewUI(activeCfg, ses, scheduleMatch);

  if (activeCfg) {
    document.getElementById('btn-reg-gate-toggle').textContent = isEn
      ? `New Device Registration: ${activeCfg.regOpen ? 'OPEN' : 'LOCKED'}`
      : `Đăng ký thiết bị mới: ${activeCfg.regOpen ? 'Đang mở' : 'Đang khóa'}`;
  } else {
    document.getElementById('btn-reg-gate-toggle').textContent = isEn
      ? 'New Device Registration: No class selected'
      : 'Đăng ký thiết bị mới: Chưa chọn lớp';
  }

  const roster = activeCfg ? (state.roster || []) : [];
  const pCount = roster.filter(r => r.status === 'P').length;
  const lCount = roster.filter(r => r.status === 'L').length;
  const eCount = roster.filter(r => r.status === 'E').length;
  const aCount = roster.filter(r => !r.status || r.status === '-').length;

  document.getElementById('tea-live-count').textContent = isEn
    ? `${pCount + lCount} / ${roster.length} Present`
    : `${pCount + lCount} / ${roster.length} Có mặt`;
  document.getElementById('tea-live-breakdown').textContent = isEn
    ? `Present: ${pCount} | Late: ${lCount} | Absent: ${aCount} | Excused: ${eCount}`
    : `Có mặt: ${pCount} | Đi trễ: ${lCount} | Vắng mặt: ${aCount} | Có phép: ${eCount}`;

  setupTeacherCountdown(ses, Boolean(activeCfg));
  renderTeacherRoster();
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
    const codeLabel = activeCfg ? activeCfg.classId : '';
    confirmBtn.textContent = isEn
      ? `Confirm Open ${codeLabel}`
      : `Xác nhận mở lớp ${codeLabel}`;
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
 *  - Shows two separate buttons: "Hủy" and "Xác nhận mở lớp [Mã Lớp]".
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
    confirmBtn.textContent = isEn
      ? `Confirm Open ${classId}`
      : `Xác nhận mở lớp ${classId}`;
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
    pos.coords.longitude !== 0
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
  if (tabAbsent) tabAbsent.textContent = isEn ? `Absent (${countAbsent})` : `Vắng mặt (${countAbsent})`;
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

  container.innerHTML = filtered.map(st => {
    const suspectNote = suspectMap[st.studentId];
    return `
      <div class="roster-item ${suspectNote ? 'suspect-row' : ''}">
        <div>
          <strong>${escapeHtml(st.fullName)}</strong>
          <span style="color:var(--muted); font-size:0.8rem; font-family:var(--font-mono);">(${escapeHtml(st.studentId)})</span>
          <span class="status-pill st-${st.status}">${escapeHtml(st.status)}</span>
          ${st.time ? `<span style="font-size:0.75rem; color:var(--muted); font-family:var(--font-mono);">${escapeHtml(st.time)}</span>` : ''}
          ${st.distance !== '' && st.distance !== undefined ? `<span style="font-size:0.74rem; color:#0f766e; font-weight:600; font-family:var(--font-mono);">(${escapeHtml(st.distance)}m)</span>` : ''}
          ${suspectNote ? `<span class="suspect-tag">[${isEn ? 'SUSPECT' : 'NGHI VẤN'}] ${escapeHtml(suspectNote)}</span>` : ''}
        </div>
        <div style="display:flex; gap:4px; flex-wrap:wrap;">
          <button class="btn btn-outline btn-sm" onclick="teacherManualMark('${escapeHtml(st.studentId)}','P')">${isEn ? 'Present' : 'Có mặt'}</button>
          <button class="btn btn-outline btn-sm" onclick="teacherManualMark('${escapeHtml(st.studentId)}','L')">${isEn ? 'Late' : 'Đi trễ'}</button>
          <button class="btn btn-outline btn-sm" onclick="teacherManualMark('${escapeHtml(st.studentId)}','E')">${isEn ? 'Excused' : 'Có phép'}</button>
          <button class="btn btn-outline btn-sm" title="${isEn ? 'Revoke attendance' : 'Hủy điểm danh'}" onclick="teacherManualMark('${escapeHtml(st.studentId)}','-')">${isEn ? 'Absent' : 'Vắng'}</button>
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

  const pick = checkedIn[Math.floor(Math.random() * checkedIn.length)];
  openAppModal(
    isEn ? 'Random Attendance Spot-Check' : 'Kiểm tra Ngẫu nhiên Sĩ số',
    isEn
      ? `Full Name: ${pick.fullName}\nStudent ID: ${pick.studentId} (Checked in at: ${pick.time || 'N/A'})`
      : `Họ và tên: ${pick.fullName}\nMã số sinh viên: ${pick.studentId} (Điểm danh lúc: ${pick.time || 'N/A'})`,
    isEn ? 'Mark Absent (Revoke & Lock)' : 'Vắng mặt (Hủy và Khóa điểm danh)',
    async () => {
      await teacherManualMark(pick.studentId, '-');
      showStatus(
        isEn
          ? `Revoked attendance and locked re-submission in this session for ${pick.fullName} (${pick.studentId}).`
          : `Đã hủy điểm danh và khóa nộp lại trong phiên này đối với ${pick.fullName} (${pick.studentId}).`,
        'warn'
      );
    }
  );
}

async function teacherManualMark(studentId, status) {
  const auth = getTeacherAuth();
  const classId = document.getElementById('sel-tea-class').value;
  if (!auth || !classId) return;
  if (!showRosterNames) {
    const searchInput = document.getElementById('inp-roster-search');
    if (searchInput) searchInput.value = '';
  }
  const res = await callBackend(auth.apiUrl, {
    action: 'TEACHER_MANUAL_MARK',
    teacherToken: auth.token,
    classId: classId,
    studentId: studentId,
    status: status
  });
  if (res && res.ok) await applyTeacherState(res, false);
  else showStatus(res && res.message ? res.message : (currentLang === 'en' ? 'Error updating status.' : 'Lỗi cập nhật trạng thái.'), 'err');
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
