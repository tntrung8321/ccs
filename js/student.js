/**
 * ============================================================================
 * STUDENT CONTROLLER (js/student.js)
 *  - Course & Lecturer Selector with Real-Time Period / Calendar Auto-Select
 *  - Pre-Check & Activate GPS Panel (#gps-panel: #gps-dot, #gps-readout, #btn-check-gps)
 *  - Fresh GPS Re-Verification on Check-In (No stale coordinate reuse)
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
  syncStudentViewportScrollLock();
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

  if (instIds.length === 0) {
    hasBox.classList.add('hidden');
    noBox.classList.remove('hidden');
    addBox.classList.remove('hidden');
    return;
  }

  hasBox.classList.remove('hidden');
  noBox.classList.add('hidden');

  const selInst = document.getElementById('sel-student-inst');
  const lblInst = document.getElementById('lbl-student-inst');
  const showMultiLecturer = instIds.length > 1;
  selInst.classList.toggle('hidden', !showMultiLecturer);
  if (lblInst) lblInst.classList.toggle('hidden', !showMultiLecturer);

  const activeInst = safeGetLocal('cc_active_inst', instIds[0]);
  selInst.innerHTML = instIds.map(id => {
    const p = profiles[id];
    return `<option value="${escapeHtml(id)}" ${id === activeInst ? 'selected' : ''}>${escapeHtml(p.lecturerName)} (${escapeHtml(p.studentId)})</option>`;
  }).join('');

  onStudentInstChange(false);
}

function onStudentInstChange(preserveManualSelection = false) {
  const profiles = getStudentProfiles();
  const selInstEl = document.getElementById('sel-student-inst');
  const selInst = selInstEl ? selInstEl.value : '';
  const p = profiles[selInst];
  if (!p) return;

  safeSetLocal('cc_active_inst', selInst);
  const selClass = document.getElementById('sel-student-class');
  const currentSelectedVal = preserveManualSelection ? selClass.value : '';

  const enrolled = (p.enrolledClasses || []).filter(
    c => c && !REMOVED_SAMPLE_CLASSES.includes(String(c.classId || '').trim().toUpperCase())
  );

  // Resolve real-time class from Google Calendar / Period Slots (123, 456, 789, 10-12, 13-15) / CLASS_SCHEDULE
  const scheduleMatch = resolveActiveClassBySchedule(enrolled, new Date());
  const autoClassId = preserveManualSelection && currentSelectedVal
    ? currentSelectedVal
    : scheduleMatch.matchedClassId; // "" when off-hours

  const unselectedLabel = I18N[currentLang].stu_unselected_class_opt || 'Chưa chọn lớp - Ngoài khung giờ';
  const optionsHtml = [
    `<option value="" ${autoClassId === '' ? 'selected' : ''}>${escapeHtml(unselectedLabel)}</option>`
  ].concat(
    enrolled.map(c => {
      const isSelected = c.classId === autoClassId;
      const openTag = c.sessionOpenNow ? ' [ĐANG MỞ ĐIỂM DANH]' : '';
      return `<option value="${escapeHtml(c.classId)}" ${isSelected ? 'selected' : ''}>${escapeHtml(formatClassOptionLabel(c) + openTag)}</option>`;
    })
  );

  selClass.innerHTML = optionsHtml.join('');
  updateStudentClassSelectionUI(selInst, scheduleMatch);

  selClass.onchange = () => {
    if (selClass.value) {
      safeSetLocal('cc_last_class_' + selInst, selClass.value);
    }
    updateStudentClassSelectionUI(selInst, scheduleMatch);
  };

  document.getElementById('stu-bound-info').textContent =
    `${p.fullName} — MSSV: ${p.studentId}`;
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
      hintBar.textContent = `Tự động khớp lịch học: ${scheduleMatch.label}`;
      hintBar.classList.remove('hidden');
    } else if (!selectedClassId) {
      hintBar.className = 'schedule-hint-bar off-hours';
      hintBar.textContent = scheduleMatch && scheduleMatch.label
        ? scheduleMatch.label
        : 'Chưa chọn lớp - Ngoài khung giờ học. Vui lòng chọn đúng lớp trước khi điểm danh.';
      hintBar.classList.remove('hidden');
    } else {
      hintBar.className = 'schedule-hint-bar';
      hintBar.textContent = `Đang chọn lớp: ${selectedClassId}`;
      hintBar.classList.remove('hidden');
    }
  }

  renderTodayStudentReceipt(selectedClassId);
}

function toggleAddCourseBox() {
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
 *  - Tests if student's phone/browser can acquire GPS even before session opens.
 *  - Shows feedback directly inside #gps-panel (#gps-readout & #gps-inline-status).
 *  - Does NOT cache/store old coordinates for attendance submission.
 * ============================================================================
 */
async function handleStudentPreCheckGps() {
  if (isCheckingGps) return;
  isCheckingGps = true;

  const dot = document.getElementById('gps-dot');
  const readout = document.getElementById('gps-readout');
  const btn = document.getElementById('btn-check-gps');
  const pill = document.getElementById('gps-live-pill');

  if (btn) btn.disabled = true;
  if (dot) dot.className = 'status-dot dot-busy';
  if (readout) {
    readout.textContent = currentLang === 'en'
      ? 'Requesting live GPS signal from device...'
      : 'Đang kiểm tra phần cứng & quyền truy cập GPS...';
  }
  if (pill) {
    pill.className = 'badge-warn';
    pill.textContent = currentLang === 'en' ? 'Testing GPS...' : 'Đang thử GPS...';
  }
  showInlineStatus(
    'gps-inline-status',
    currentLang === 'en' ? 'Testing device GPS sensor...' : 'Đang kiểm tra tín hiệu GPS của thiết bị...',
    'warn'
  );

  try {
    const pos = await getAccuratePosition();
    const spoofCheck = inspectGpsForSpoofing(pos);
    // Explicitly clear any cached coordinate so check-in always fetches fresh GPS
    window.cachedGPS = null;

    if (spoofCheck.hardBlock) {
      if (dot) dot.className = 'status-dot dot-err';
      if (readout) readout.textContent = 'Tín hiệu GPS không hợp lệ. Vui lòng tắt các công cụ can thiệp vị trí.';
      if (pill) {
        pill.className = 'badge-err';
        pill.textContent = 'GPS không hợp lệ';
      }
      showInlineStatus('gps-inline-status', 'Phát hiện tín hiệu GPS không hợp lệ.', 'err');
    } else {
      const latStr = Number(pos.coords.latitude).toFixed(5);
      const lngStr = Number(pos.coords.longitude).toFixed(5);
      const accVal = Math.round(pos.coords.accuracy);
      if (dot) dot.className = 'status-dot dot-ok';
      if (readout) {
        readout.textContent = currentLang === 'en'
          ? `GPS Ready (${latStr}, ${lngStr} | Accuracy ±${accVal}m)`
          : `GPS hoạt động tốt (${latStr}, ${lngStr} | Sai số ±${accVal}m)`;
      }
      if (pill) {
        pill.className = 'badge-ok';
        pill.textContent = `GPS OK (±${accVal}m)`;
      }
      showInlineStatus(
        'gps-inline-status',
        currentLang === 'en'
          ? `GPS verified (±${accVal}m). Position is not cached; fresh GPS will be checked on Check-In.`
          : `Thiết bị đã bật GPS thành công (±${accVal}m). Khi bấm Điểm danh hệ thống sẽ xác thực vị trí trực tiếp tại lớp.`,
        'success'
      );
    }
  } catch (err) {
    window.cachedGPS = null;
    if (dot) dot.className = 'status-dot dot-err';
    if (readout) {
      readout.textContent = currentLang === 'en'
        ? 'GPS Blocked / Off: Enable Location Services and browser permission.'
        : 'Chưa mở được GPS trên thiết bị này.';
    }
    if (pill) {
      pill.className = 'badge-err';
      pill.textContent = 'Lỗi GPS';
    }
    showInlineStatus(
      'gps-inline-status',
      currentLang === 'en'
        ? 'Cannot access GPS: Please turn on Location Services in phone Settings and allow browser location permission.'
        : 'Không lấy được GPS: Vui lòng bật Định vị (Location) trong Cài đặt điện thoại và cấp quyền Vị trí cho trình duyệt.',
      'err'
    );
  } finally {
    isCheckingGps = false;
    if (btn) btn.disabled = false;
  }
}

/**
 * ============================================================================
 * STUDENT ONBOARDING (LINK STUDENT ID)
 * ============================================================================
 */
async function submitStudentOnboarding() {
  const check = evaluateStudentAntiCheat();
  if (!check.browserOk) {
    showStatus('Vui lòng mở bằng trình duyệt chính (Safari, Chrome, Cốc Cốc, Edge), không mở trong Zalo/Messenger.', 'err', 'onboard-inline-status');
    return;
  }

  const apiUrl = normalizeApiUrl(document.getElementById('inp-onboard-api').value);
  const studentId = document.getElementById('inp-student-id').value.trim().toUpperCase();

  if (!studentId) {
    showStatus('Vui lòng nhập Mã số sinh viên (MSSV).', 'err', 'onboard-inline-status');
    return;
  }

  showStatus('Đang xác thực MSSV với máy chủ...', 'warn', 'onboard-inline-status');

  const pingRes = await callBackend(apiUrl, { action: 'PING' });
  if (!pingRes || !pingRes.ok) {
    showStatus('Không kết nối được tới máy chủ. Vui lòng kiểm tra mạng.', 'err', 'onboard-inline-status');
    return;
  }

  const res = await callBackend(apiUrl, {
    action: 'STUDENT_ONBOARD',
    studentId: studentId,
    credential: getOrCreateDeviceCredential(),
    deviceFp: getHardwareFingerprint(),
    clientMeta: check
  });

  if (!res || !res.ok) {
    showStatus(formatServerMessage(res ? res.code : 'ERR_NETWORK', res ? res.params : {}, res ? res.message : ''), 'err', 'onboard-inline-status');
    return;
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
}

/**
 * ============================================================================
 * REQUIREMENT 3: STUDENT CHECK-IN WITH ANTI-SPAM LOCK & FRESH GPS RE-CHECK
 * ============================================================================
 */
async function handleOneTapGpsCheckIn() {
  if (isSubmitting) return;
  await executeStudentCheckIn('BUTTON_GPS_CHECKIN');
}

async function executeStudentCheckIn(qrString) {
  if (isSubmitting) return;

  const profiles = getStudentProfiles();
  const instId = document.getElementById('sel-student-inst').value;
  const classId = document.getElementById('sel-student-class').value;
  const profile = profiles[instId];

  if (!profile) {
    document.getElementById('box-add-course').classList.remove('hidden');
    syncStudentViewportScrollLock();
    showStatus('Vui lòng nhập và lưu MSSV trước khi điểm danh.', 'err', 'onboard-inline-status');
    return;
  }

  if (!classId) {
    showStatus('Bạn chưa chọn lớp học phần (Đang ở ngoài khung giờ tự động). Vui lòng chọn lớp học ở ô phía trên trước khi bấm Điểm danh.', 'warn', 'checkin-inline-status');
    const selClass = document.getElementById('sel-student-class');
    if (selClass) selClass.focus();
    return;
  }

  const check = evaluateStudentAntiCheat();
  if (!check.browserOk) {
    showStatus('Không điểm danh trong Zalo/Messenger. Hãy mở bằng trình duyệt đã đăng ký.', 'err', 'checkin-inline-status');
    return;
  }

  // Immediately lock button to block rapid spam taps
  isSubmitting = true;
  const btn = document.getElementById('btn-start-checkin');
  const btnLabel = document.getElementById('btn-start-checkin-label');
  const pill = document.getElementById('gps-live-pill');
  const tele = document.getElementById('stu-gps-telemetry');
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
      ? 'Acquiring fresh GPS coordinates for attendance verification...'
      : 'Đang kiểm tra lại tọa độ GPS thực tế để gửi điểm danh...';
  }
  pill.className = 'badge-warn';
  pill.textContent = currentLang === 'vi' ? 'Đang lấy GPS...' : 'Locating...';
  showStatus(currentLang === 'vi' ? 'Đang kiểm tra lại vị trí GPS và gửi dữ liệu điểm danh...' : 'Verifying live GPS location and submitting attendance...', 'warn');

  try {
    // Always acquire fresh GPS on check-in (never reuse old cached position)
    window.cachedGPS = null;
    let pos;
    try {
      pos = await getAccuratePosition();
    } catch (gpsErr) {
      if (dot) dot.className = 'status-dot dot-err';
      if (readout) {
        readout.textContent = 'Không lấy được tín hiệu GPS khi điểm danh. Hãy bấm "Kiểm tra & Kích hoạt GPS" hoặc bật quyền Vị trí.';
      }
      pill.className = 'badge-err';
      pill.textContent = 'Lỗi GPS';
      showStatus(I18N[currentLang].ERR_GPS_UNAVAILABLE, 'err');
      resetCheckInButtonImmediate();
      return;
    }

    const spoofCheck = inspectGpsForSpoofing(pos);
    if (spoofCheck.hardBlock) {
      if (dot) dot.className = 'status-dot dot-err';
      pill.className = 'badge-err';
      pill.textContent = 'Lỗi vị trí';
      showStatus('Tín hiệu GPS không hợp lệ.', 'err');
      resetCheckInButtonImmediate();
      return;
    }

    const latStr = Number(pos.coords.latitude).toFixed(5);
    const lngStr = Number(pos.coords.longitude).toFixed(5);
    const accVal = Math.round(pos.coords.accuracy);
    if (dot) dot.className = 'status-dot dot-ok';
    if (readout) {
      readout.textContent = `Đã xác thực GPS mới (${latStr}, ${lngStr} | ±${accVal}m) — Đang gửi về hệ thống...`;
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
      pill.className = 'badge-ok';
      pill.textContent = `${r.distanceMeters}m`;
      tele.classList.remove('hidden');
      tele.textContent = `Khoảng cách tới tâm phòng học: ${r.distanceMeters}m (Sai số ±${accVal}m)`;
      saveTodayStudentReceipt(classId, r);
      renderTodayStudentReceipt(classId);
      showStatus(formatServerMessage(res.code, {
        status: r.status,
        time: r.time,
        dist: r.distanceMeters
      }), 'success');
    } else if (res && res.code === 'ERR_NETWORK') {
      const checkRec = await callBackend(profile.apiUrl, {
        action: 'CHECK_RECEIPT',
        requestId: requestId,
        studentId: profile.studentId
      }, 1);
      if (checkRec && checkRec.ok && checkRec.receipt) {
        pill.className = 'badge-ok';
        pill.textContent = `${checkRec.receipt.distanceMeters}m`;
        saveTodayStudentReceipt(classId, checkRec.receipt);
        renderTodayStudentReceipt(classId);
        showStatus(formatServerMessage('CONFIRMED_' + (checkRec.receipt.status === 'P' ? 'PRESENT' : 'LATE'), {
          time: checkRec.receipt.time,
          dist: checkRec.receipt.distanceMeters
        }), 'success');
      } else {
        pill.className = 'badge-err';
        pill.textContent = 'Lỗi mạng';
        showStatus('Lỗi kết nối mạng, vui lòng thử bấm lại.', 'err');
      }
    } else {
      const errCode = res ? res.code : 'ERR_UNKNOWN';
      pill.className = 'badge-err';
      pill.textContent = (errCode === 'ERR_LOCATION_OUT_OF_RANGE' && res.params) ? `${res.params.dist}m` : 'Chưa đạt';
      if (errCode === 'ERR_LOCATION_OUT_OF_RANGE' && res.params && readout) {
        readout.textContent = `Ngoài phạm vi lớp học: Cách tâm ${res.params.dist}m (Cho phép tối đa ${res.params.max}m).`;
      }
      // Smart wrong-class hint: if this class is closed, check if another enrolled class is open or scheduled
      if (errCode === 'ERR_SESSION_CLOSED' && Array.isArray(profile.enrolledClasses) && profile.enrolledClasses.length > 1) {
        const sched = resolveActiveClassBySchedule(profile.enrolledClasses, new Date());
        if (sched.matchedClassId && sched.matchedClassId !== classId) {
          showStatus(
            `Cổng điểm danh lớp ${classId} đang đóng. Gợi ý: Theo khung giờ hiện tại, lớp ${sched.matchedClassId} đang trong ca học — hãy kiểm tra xem bạn có chọn nhầm lớp không.`,
            'warn'
          );
          return;
        }
      }
      showStatus(formatServerMessage(errCode, res ? res.params : {}, res ? res.message : ''), 'err');
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
      const waitText = currentLang === 'en' ? `Please wait ${rem}s...` : `Vui lòng chờ ${rem}s...`;
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
    const statusText = r.status === 'P' ? 'CÓ MẶT (P)' : (r.status === 'L' ? 'ĐI TRỄ (L)' : r.status);
    box.innerHTML = `
      <div class="receipt-title">
        <span>Biên lai điểm danh hôm nay (${escapeHtml(classId)})</span>
        <span>${escapeHtml(statusText)}</span>
      </div>
      <div class="receipt-meta">
        MSSV: ${escapeHtml(r.studentId || '')} | Giờ: ${escapeHtml(r.time || '')} | Khoảng cách: ${escapeHtml(r.distanceMeters !== undefined ? r.distanceMeters + 'm' : 'N/A')}
      </div>
    `;
    box.classList.remove('hidden');
  } catch (e) {
    box.classList.add('hidden');
  }
}

function toggleManualQrInput() {
  document.getElementById('box-manual-qr').classList.toggle('hidden');
}

function handleManualQrSubmit() {
  const code = document.getElementById('inp-manual-qr').value.trim();
  if (code) executeStudentCheckIn(code);
}
