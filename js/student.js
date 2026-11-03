/**
 * ============================================================================
 * STUDENT CONTROLLER (js/student.js — v3.4.9)
 *  - Course & Lecturer Selector with Real-Time Period / Calendar Auto-Select
 *  - Permanent Student ID Lock after first onboarding (hides input & button)
 *  - Pre-Check & Activate GPS Panel (#gps-panel) with Live High-Accuracy Warm-Up (No GPS Caching)
 *  - Instant 2-Step Address Bar Permission Guide (#gps-permission-guide-box) & Live Permission Recovery
 *  - Anti-Spam Submission Lock (`isSubmitting`) & Today's Verified Receipt Card
 * ============================================================================
 */

let isSubmitting = false;
let isCheckingGps = false;
let checkInCooldownTimer = null;
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
    const pingRes = await callBackend(apiUrl, { action: 'PING' }, 1);
    if (pingRes && pingRes.ok) {
      ingestServerScheduleData(pingRes);
      // Merge any updated class metadata (such as scheduleInfo / sessionOpenNow) into stored enrolledClasses
      if (activeProfile && Array.isArray(pingRes.classes) && Array.isArray(activeProfile.enrolledClasses)) {
        const serverClassMap = {};
        pingRes.classes.forEach(sc => {
          if (sc && sc.classId) serverClassMap[sc.classId] = sc;
        });
        activeProfile.enrolledClasses = activeProfile.enrolledClasses.map(ec => {
          const sc = serverClassMap[ec.classId];
          return sc ? Object.assign({}, ec, {
            className: sc.className || ec.className,
            scheduleInfo: sc.scheduleInfo || ec.scheduleInfo,
            sessionOpenNow: Boolean(sc.sessionOpenNow)
          }) : ec;
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
  // If student is enrolled in only 1 class, always auto-select that class so they are never blocked by unselected dropdown
  const scheduleMatch = resolveActiveClassBySchedule(enrolled, new Date());
  const autoClassId = preserveManualSelection && currentSelectedVal
    ? currentSelectedVal
    : (scheduleMatch.matchedClassId || (enrolled.length === 1 ? enrolled[0].classId : ''));

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

  renderTodayStudentReceipt(selectedClassId);
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
    if (readout) {
      readout.textContent = currentLang === 'en'
        ? 'GPS unavailable — Please allow location permission in browser'
        : 'Chưa lấy được định vị GPS — Vui lòng cấp quyền vị trí cho trình duyệt';
    }
    if (typeof formatGpsErrorGuide === 'function') {
      showStatus(formatGpsErrorGuide(err), 'err', 'checkin-inline-status');
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
      if (readout) {
        readout.textContent = currentLang === 'en'
          ? 'GPS unavailable — Please allow location permission'
          : 'Chưa lấy được định vị GPS';
      }
      if (gpsErr && gpsErr.code === 1 && typeof showGpsPermissionGuideBox === 'function') {
        showGpsPermissionGuideBox();
      }
      const errMsg = typeof formatGpsErrorGuide === 'function'
        ? formatGpsErrorGuide(gpsErr)
        : I18N[currentLang].ERR_GPS_UNAVAILABLE;
      showStatus(errMsg, 'err', 'checkin-inline-status');
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
      saveTodayStudentReceipt(recordedClassId, r);
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
        saveTodayStudentReceipt(recordedClassId, checkRec.receipt);
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
}

function renderTodayStudentReceipt(classId) {
  const box = document.getElementById('student-today-receipt');
  if (!box) return;
  if (!classId) {
    box.classList.add('hidden');
    return;
  }
  const key = `cc_receipt_${classId}_${getTodayDateKey()}`;
  const raw = safeGetLocal(key, null);
  if (!raw) {
    box.classList.add('hidden');
    return;
  }
  try {
    const r = JSON.parse(raw);
    const isEn = currentLang === 'en';
    const statusText = r.status === 'P'
      ? (isEn ? 'PRESENT (P)' : 'CÓ MẶT (P)')
      : (r.status === 'L' ? (isEn ? 'LATE (L)' : 'ĐI TRỄ (L)') : r.status);
    box.innerHTML = `
      <div class="receipt-title">
        <span>${isEn ? `Today's Attendance Receipt (${escapeHtml(classId)})` : `Biên lai điểm danh hôm nay (${escapeHtml(classId)})`}</span>
        <span>${escapeHtml(statusText)}</span>
      </div>
      <div class="receipt-meta">
        ${isEn ? 'Student ID' : 'Mã số sinh viên'}: ${escapeHtml(r.studentId || '')} | ${isEn ? 'Time' : 'Giờ'}: ${escapeHtml(r.time || '')} | ${isEn ? 'Distance' : 'Khoảng cách'}: ${escapeHtml(r.distanceMeters !== undefined ? r.distanceMeters + 'm' : 'N/A')}
      </div>
    `;
    box.classList.remove('hidden');
  } catch (e) {
    box.classList.add('hidden');
  }
}
