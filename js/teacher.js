/**
 * ============================================================================
 * LECTURER CONTROLLER (js/teacher.js)
 *  - Sheet-Based Rotating 6-Digit Session Code & Master Key Authentication
 *  - Real-Time Class Auto-Selection (Google Calendar + Period Slots 123/456/789/10-12/13-15)
 *  - Isolated Session Control Block with Two-Step Inline Confirmation
 *  - Live Roster Quick Filters (All / Present / Absent / Suspect) & Projector Privacy Mode
 * ============================================================================
 */

let teacherState = null;
let teacherPollTimer = null;
let teacherCountdownTimer = null;
let teacherRotatingQrTimer = null;
let showRosterNames = true;
let maskStudentIdsOnProjector = false;
let activeRosterFilter = 'ALL'; // 'ALL' | 'PRESENT' | 'ABSENT' | 'SUSPECT'
let teacherHasManuallySelectedClass = false;
let selectedTeacherClassId = '';

function toggleTeacherApiBox() {
  document.getElementById('box-tea-api-advanced').classList.toggle('hidden');
}

function resetToDefaultLecturerApi() {
  document.getElementById('inp-tea-api').value = DEFAULT_LECTURER_API;
  safeRemoveLocal('cc_teacher_auth');
  safeRemoveSession('cc_teacher_auth');
  showStatus('Đã đặt lại URL mặc định.', 'success');
}

async function loginTeacher() {
  const apiUrl = normalizeApiUrl(document.getElementById('inp-tea-api').value);
  const token = document.getElementById('inp-tea-token').value.trim();
  const persistence = document.getElementById('sel-tea-persistence').value;

  document.getElementById('inp-tea-api').value = apiUrl;

  if (!apiUrl || !token) {
    showStatus('Vui lòng nhập mật khẩu phiên từ Google Sheet hoặc Master Key.', 'err');
    return;
  }

  showStatus('Đang xác thực mật khẩu phiên với Google Sheet...', 'warn');
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

  document.getElementById('card-teacher-login').classList.add('hidden');
  document.getElementById('box-teacher-dashboard').classList.remove('hidden');
  hideStatus();
  await applyTeacherState(res, true);
  startTeacherPolling();
}

function logoutTeacher() {
  safeRemoveLocal('cc_teacher_auth');
  safeRemoveSession('cc_teacher_auth');
  document.getElementById('inp-tea-token').value = '';
  teacherHasManuallySelectedClass = false;
  selectedTeacherClassId = '';
  cancelOpenSessionConfirm();
  stopTeacherPolling();
  document.getElementById('box-teacher-dashboard').classList.add('hidden');
  document.getElementById('card-teacher-login').classList.remove('hidden');
}

async function refreshTeacherState() {
  const auth = getTeacherAuth();
  if (!auth || document.hidden) return;
  const selEl = document.getElementById('sel-tea-class');
  const selClass = selEl ? selEl.value : selectedTeacherClassId;

  const res = await callBackend(auth.apiUrl, {
    action: 'TEACHER_GET_STATE',
    teacherToken: auth.token,
    classId: selClass
  }, 1);

  if (res && res.ok) {
    await applyTeacherState(res, false);
  } else if (res && res.code === 'ERR_UNAUTHORIZED') {
    logoutTeacher();
    showStatus('Mã phiên trên Sheet đã thay đổi hoặc hết hạn. Vui lòng đăng nhập lại bằng mã mới trên Sheet.', 'warn');
  }
}

async function applyTeacherState(state, isInitialLoad = false) {
  ingestServerScheduleData(state);

  // Filter out removed test sample class ENG101_G1 while keeping 100% of real classes
  const cleanClasses = (state.classes || []).filter(
    c => c && c.classId && !REMOVED_SAMPLE_CLASSES.includes(String(c.classId).trim().toUpperCase())
  );
  state.classes = cleanClasses;
  teacherState = state;

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
  }

  const sel = document.getElementById('sel-tea-class');
  const unselectedLabel = I18N[currentLang].tea_unselected_class_opt || '-- Chưa chọn lớp - Ngoài khung giờ --';

  const optionsHtml = [
    `<option value="" ${selectedTeacherClassId === '' ? 'selected' : ''}>${escapeHtml(unselectedLabel)}</option>`
  ].concat(
    cleanClasses.map(c => {
      const isSelected = c.classId === selectedTeacherClassId;
      const openTag = c.sessionOpenNow ? ' [ĐANG MỞ]' : '';
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
    document.getElementById('btn-reg-gate-toggle').textContent =
      `Đăng ký Thiết bị Mới: ${activeCfg.regOpen ? 'ĐANG MỞ' : 'ĐANG KHÓA'}`;
    document.getElementById('poster-class-title').textContent =
      `${activeCfg.classId} — ${activeCfg.className || ''}`;
  } else {
    document.getElementById('btn-reg-gate-toggle').textContent = 'Đăng ký Thiết bị Mới: Chưa chọn lớp';
    document.getElementById('poster-class-title').textContent = 'Chưa chọn lớp học phần';
  }

  const roster = activeCfg ? (state.roster || []) : [];
  const pCount = roster.filter(r => r.status === 'P').length;
  const lCount = roster.filter(r => r.status === 'L').length;
  const eCount = roster.filter(r => r.status === 'E').length;
  const aCount = roster.filter(r => !r.status || r.status === '-').length;

  document.getElementById('tea-live-count').textContent = `${pCount + lCount} / ${roster.length} Có mặt`;
  document.getElementById('tea-live-breakdown').textContent = `Có mặt (P): ${pCount} | Đi trễ (L): ${lCount} | Vắng (-): ${aCount} | Phép (E): ${eCount}`;

  const qrMode = ses ? ses.qrMode : 'STATIC';
  renderClassroomQr(activeCfg, qrMode);
  setupTeacherCountdown(ses, Boolean(activeCfg));
  renderTeacherRoster();
}

function updateTeacherClassOverviewUI(activeCfg, ses, scheduleMatch) {
  const hintBar = document.getElementById('tea-schedule-hint');
  const selectedNameEl = document.getElementById('tea-selected-class-display');
  const confirmBtn = document.getElementById('btn-tea-confirm-open');

  if (selectedNameEl) {
    if (activeCfg) {
      selectedNameEl.textContent = `${activeCfg.classId} — ${activeCfg.className || activeCfg.classId}`;
      selectedNameEl.style.color = 'var(--primary)';
    } else {
      selectedNameEl.textContent = 'Chưa chọn lớp (Ngoài khung giờ tự động)';
      selectedNameEl.style.color = 'var(--warn-text)';
    }
  }

  if (confirmBtn) {
    const codeLabel = activeCfg ? activeCfg.classId : '';
    confirmBtn.textContent = `Xác nhận mở lớp ${codeLabel}`;
  }

  if (hintBar) {
    if (scheduleMatch && !scheduleMatch.isOffHours && scheduleMatch.matchedClassId) {
      hintBar.className = 'schedule-hint-bar matched';
      hintBar.textContent = `Tự động nhận diện theo giờ thực: ${scheduleMatch.label}`;
    } else if (!activeCfg) {
      hintBar.className = 'schedule-hint-bar off-hours';
      hintBar.textContent = 'Hiện đang ngoài khung giờ dạy trên Lịch / Số tiết — Vui lòng chọn lớp thủ công nếu muốn mở điểm danh bù.';
    } else {
      hintBar.className = 'schedule-hint-bar';
      hintBar.textContent = `Lớp đang chọn thủ công: ${activeCfg.classId}`;
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
  if (!classId) {
    showStatus('Vui lòng chọn một lớp học phần ở danh sách phía trên trước khi mở phiên điểm danh.', 'warn');
    document.getElementById('sel-tea-class').focus();
    return;
  }

  const triggerBtn = document.getElementById('btn-tea-open-trigger');
  const confirmBox = document.getElementById('tea-open-confirm-bar');
  const confirmLabel = document.getElementById('tea-open-confirm-text');
  const confirmBtn = document.getElementById('btn-tea-confirm-open');

  if (confirmLabel) {
    confirmLabel.textContent = `Bạn chuẩn bị mở phiên điểm danh cho lớp [${classId}]. Vui lòng xác nhận:`;
  }
  if (confirmBtn) {
    confirmBtn.textContent = `Xác nhận mở lớp ${classId}`;
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
  cancelOpenSessionConfirm();

  if (!selectedTeacherClassId) {
    if (teacherState) {
      await applyTeacherState(teacherState, false);
    }
    return;
  }
  await refreshTeacherState();
}

async function teacherCalibrateRoomGpsNow() {
  const auth = getTeacherAuth();
  const classId = document.getElementById('sel-tea-class').value;
  if (!auth || !classId) {
    showStatus('Vui lòng chọn lớp học phần trước khi cập nhật Tâm GPS.', 'warn');
    return;
  }

  showStatus('Đang lấy tọa độ GPS của thiết bị này làm Tâm phòng học...', 'warn');
  try {
    const pos = await getAccuratePosition();
    const res = await callBackend(auth.apiUrl, {
      action: 'TEACHER_START_SESSION',
      teacherToken: auth.token,
      classId: classId,
      usePhoneGps: true,
      calibrateOnly: true,
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      qrMode: 'STATIC'
    });
    if (res && res.ok) {
      await applyTeacherState(res, false);
      showStatus('Đã cập nhật tọa độ Tâm điểm danh thành công.', 'success');
    } else {
      showStatus(res && res.message ? res.message : 'Không cập nhật được tọa độ.', 'err');
    }
  } catch (e) {
    showStatus('Không lấy được GPS. Hãy cấp quyền Vị trí trên trình duyệt.', 'err');
  }
}

function setupTeacherCountdown(ses, hasSelectedClass = true) {
  if (teacherCountdownTimer) clearInterval(teacherCountdownTimer);
  const badge = document.getElementById('tea-session-badge');
  const timerEl = document.getElementById('tea-countdown');

  if (!hasSelectedClass) {
    badge.className = 'badge-neutral';
    badge.textContent = 'CHƯA CHỌN LỚP';
    timerEl.textContent = '--:--';
    return;
  }

  if (!ses || !ses.isOpen) {
    badge.className = 'badge-err';
    badge.textContent = 'PHIÊN ĐANG ĐÓNG';
    timerEl.textContent = '00:00';
    return;
  }

  const updateTick = () => {
    const now = Date.now();
    if (now > ses.closesAtMs) {
      badge.className = 'badge-err';
      badge.textContent = 'ĐÃ HẾT GIỜ';
      timerEl.textContent = '00:00';
      clearInterval(teacherCountdownTimer);
      return;
    }
    if (now <= ses.presentUntilMs) {
      const remSec = Math.max(0, Math.floor((ses.presentUntilMs - now) / 1000));
      badge.className = 'badge-ok';
      badge.textContent = 'ĐANG MỞ — GHI NHẬN CÓ MẶT (P)';
      timerEl.textContent = formatMmSs(remSec);
    } else {
      const remSec = Math.max(0, Math.floor((ses.closesAtMs - now) / 1000));
      badge.className = 'badge-warn';
      badge.textContent = 'ĐANG MỞ — GHI NHẬN ĐI TRỄ (L)';
      timerEl.textContent = formatMmSs(remSec);
    }
  };
  updateTick();
  teacherCountdownTimer = setInterval(updateTick, 1000);
}

async function renderClassroomQr(classCfg, qrMode) {
  if (teacherRotatingQrTimer) clearInterval(teacherRotatingQrTimer);
  const container = document.getElementById('teacher-qr-canvas');
  if (!container) return;
  if (!classCfg) {
    container.innerHTML = '';
    return;
  }

  const drawQr = async () => {
    container.innerHTML = '';
    let payloadText = classCfg.activeQrSecret;
    if (qrMode === 'ROTATING') {
      const bucket = Math.floor(Date.now() / 15000);
      const tok = (await sha256Browser(classCfg.activeQrSecret + '|' + bucket)).slice(0, 12);
      payloadText = JSON.stringify({ cid: classCfg.classId, mode: 'ROTATING', tok: tok });
    }
    new QRCode(container, {
      text: payloadText,
      width: 160,
      height: 160,
      colorDark: '#0f172a',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  };

  await drawQr();
  if (qrMode === 'ROTATING') {
    teacherRotatingQrTimer = setInterval(drawQr, 5000);
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
  if (!auth || !classId) {
    showStatus('Vui lòng chọn lớp học phần trước khi mở phiên điểm danh.', 'warn', 'tea-session-inline-status');
    return;
  }

  showStatus('Đang định vị phòng học và mở phiên điểm danh...', 'warn', 'tea-session-inline-status');
  const pos = await probeLecturerDeviceGpsFast();
  const hasAccurateGps = Boolean(
    pos &&
    pos.coords &&
    typeof pos.coords.latitude === 'number' &&
    typeof pos.coords.longitude === 'number' &&
    pos.coords.accuracy <= 85
  );

  const lat = hasAccurateGps ? pos.coords.latitude : 0;
  const lng = hasAccurateGps ? pos.coords.longitude : 0;
  const acc = hasAccurateGps ? Math.round(pos.coords.accuracy) : 0;
  const anchorMode = hasAccurateGps ? 'TEACHER_GPS' : 'CAMPUS_CLUSTER';

  const anchorHintEl = document.getElementById('tea-gps-anchor-hint');
  if (anchorHintEl) {
    anchorHintEl.textContent = hasAccurateGps
      ? `Tâm phòng học buổi này: Đã khóa theo GPS thiết bị Giảng viên (±${acc}m)`
      : 'Tâm phòng học buổi này: Tự động khóa theo Cụm Sinh viên tại phòng học (Campus Cluster Anchor)';
  }

  await executeStartSessionRequest(auth, classId, hasAccurateGps, lat, lng, acc, anchorMode);
}

async function executeStartSessionRequest(auth, classId, useGps, lat, lng, gpsAccuracy = 0, anchorMode = 'TEACHER_GPS') {
  showStatus(`Đang mở phiên điểm danh cho lớp ${classId}...`, 'warn', 'tea-session-inline-status');
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
    await applyTeacherState(res, false);
    showStatus(
      useGps
        ? `Đã mở phiên lớp ${classId} (Tâm GPS theo thiết bị Giảng viên ±${gpsAccuracy}m).`
        : `Đã mở phiên lớp ${classId} (Tự động khóa tâm phòng mới theo Cụm Sinh viên tại trường).`,
      'success',
      'tea-session-inline-status'
    );
  } else {
    showStatus(res && res.message ? res.message : 'Không thể mở phiên điểm danh.', 'err', 'tea-session-inline-status');
  }
}

async function teacherControlSession(subAction, extra = {}) {
  const auth = getTeacherAuth();
  const classId = document.getElementById('sel-tea-class').value;
  if (!auth || !classId) {
    showStatus('Vui lòng chọn lớp học phần trước.', 'warn');
    return;
  }
  cancelOpenSessionConfirm();
  const res = await callBackend(auth.apiUrl, Object.assign({
    action: 'TEACHER_CONTROL_SESSION',
    teacherToken: auth.token,
    classId: classId,
    subAction: subAction
  }, extra));
  if (res && res.ok) await applyTeacherState(res, false);
}

async function toggleQrMode() {
  const cur = (teacherState && teacherState.activeSession && teacherState.activeSession.qrMode) || 'STATIC';
  const next = cur === 'STATIC' ? 'ROTATING' : 'STATIC';
  await teacherControlSession('SET_QR_MODE', { qrMode: next });
}

function parseTimeSec(timeStr) {
  if (!timeStr) return null;
  const m = String(timeStr).match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3] || '0', 10);
}

function detectCoCheckInSuspects(roster) {
  const checked = (roster || [])
    .filter(s => (s.status === 'P' || s.status === 'L') && s.time)
    .map(s => ({ ...s, sec: parseTimeSec(s.time) }))
    .filter(s => s.sec !== null)
    .sort((a, b) => a.sec - b.sec);

  const suspectMap = {};
  (roster || []).forEach(s => {
    if (s.source && String(s.source).startsWith('SUSPECT_WITH_')) {
      const parts = String(s.source).split('|');
      const partnerId = parts[0].replace('SUSPECT_WITH_', '');
      suspectMap[s.studentId] = parts[1] || `Trùng thiết bị/giờ với ${partnerId}`;
      if (partnerId && partnerId !== 'DEVTOOLS' && !suspectMap[partnerId]) {
        suspectMap[partnerId] = `Trùng thiết bị/giờ với ${s.studentId}`;
      }
    }
  });
  for (let i = 0; i < checked.length; i++) {
    for (let j = i + 1; j < checked.length; j++) {
      const diff = Math.abs(checked[j].sec - checked[i].sec);
      if (diff <= 2) {
        if (!suspectMap[checked[i].studentId]) suspectMap[checked[i].studentId] = `Cùng lúc (${diff}s) với ${checked[j].fullName}`;
        if (!suspectMap[checked[j].studentId]) suspectMap[checked[j].studentId] = `Cùng lúc (${diff}s) với ${checked[i].fullName}`;
      }
    }
  }
  return suspectMap;
}

function setRosterFilter(filterMode) {
  activeRosterFilter = filterMode || 'ALL';
  document.querySelectorAll('[data-roster-filter]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-roster-filter') === activeRosterFilter);
  });
  renderTeacherRoster();
}

function toggleProjectorPrivacy() {
  maskStudentIdsOnProjector = !maskStudentIdsOnProjector;
  const btn = document.getElementById('btn-toggle-privacy');
  if (btn) {
    btn.classList.toggle('btn-primary', maskStudentIdsOnProjector);
    btn.classList.toggle('btn-outline', !maskStudentIdsOnProjector);
  }
  renderTeacherRoster();
}

function formatDisplayedStudentId(studentId) {
  const s = String(studentId || '');
  if (!maskStudentIdsOnProjector || s.length < 5) return s;
  return s.slice(0, 3) + '***' + s.slice(-2);
}

function renderTeacherRoster() {
  const container = document.getElementById('tea-roster-container');
  const suspectBanner = document.getElementById('tea-suspect-banner');
  if (!container) return;

  if (!selectedTeacherClassId) {
    if (suspectBanner) suspectBanner.classList.add('hidden');
    container.innerHTML = '<div style="padding:16px; text-align:center; color:var(--muted);">Vui lòng chọn một lớp học phần để xem danh sách sinh viên.</div>';
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
  if (tabAll) tabAll.textContent = `Tất cả (${countAll})`;
  if (tabPresent) tabPresent.textContent = `Có mặt (${countPresent})`;
  if (tabAbsent) tabAbsent.textContent = `Vắng (${countAbsent})`;
  if (tabSuspect) tabSuspect.textContent = `Nghi vấn (${countSuspect})`;

  if (!showRosterNames && !query) {
    if (suspectBanner) suspectBanner.classList.add('hidden');
    container.innerHTML = '<div style="padding:16px; text-align:center; color:var(--muted);">Đã ẩn danh sách sinh viên trên màn hình chiếu (Gõ tên hoặc 3-4 số cuối MSSV vào ô tìm kiếm phía trên để điểm danh nhanh).</div>';
    return;
  }

  if (suspectIds.length > 0 && !maskStudentIdsOnProjector) {
    suspectBanner.classList.remove('hidden');
    suspectBanner.textContent = `[CẢNH BÁO KIỂM TRA] Phát hiện ${suspectIds.length} trường hợp trùng thiết bị hoặc bấm sát nhau <= 2 giây (đánh dấu vàng).`;
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
    container.innerHTML = '<div style="padding:16px; text-align:center; color:var(--muted);">Không có sinh viên nào khớp bộ lọc.</div>';
    return;
  }

  container.innerHTML = filtered.map(st => {
    const suspectNote = suspectMap[st.studentId];
    const shownId = formatDisplayedStudentId(st.studentId);
    return `
      <div class="roster-item ${suspectNote ? 'suspect-row' : ''}">
        <div>
          <strong>${escapeHtml(st.fullName)}</strong>
          <span style="color:var(--muted); font-size:0.8rem; font-family:var(--font-mono);">(${escapeHtml(shownId)})</span>
          <span class="status-pill st-${st.status}">${escapeHtml(st.status)}</span>
          ${st.time ? `<span style="font-size:0.75rem; color:var(--muted); font-family:var(--font-mono);">${escapeHtml(st.time)}</span>` : ''}
          ${st.distance !== '' && st.distance !== undefined ? `<span style="font-size:0.74rem; color:#0f766e; font-weight:600; font-family:var(--font-mono);">(${escapeHtml(st.distance)}m)</span>` : ''}
          ${suspectNote && !maskStudentIdsOnProjector ? `<span class="suspect-tag">[NGHI VẤN] ${escapeHtml(suspectNote)}</span>` : ''}
        </div>
        <div style="display:flex; gap:4px;">
          <button class="btn btn-outline btn-sm" onclick="teacherManualMark('${escapeHtml(st.studentId)}','P')">P</button>
          <button class="btn btn-outline btn-sm" onclick="teacherManualMark('${escapeHtml(st.studentId)}','L')">L</button>
          <button class="btn btn-outline btn-sm" onclick="teacherManualMark('${escapeHtml(st.studentId)}','E')">E</button>
          <button class="btn btn-outline btn-sm" title="Hủy điểm danh" onclick="teacherManualMark('${escapeHtml(st.studentId)}','-')">-</button>
          <button class="btn btn-outline btn-sm" title="Đặt lại khóa thiết bị" onclick="teacherResetStudentDevice('${escapeHtml(st.studentId)}')">Mở khóa</button>
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
    showStatus(`Đã ghi nhận CÓ MẶT (P) nhanh cho ${target.fullName} (${target.studentId}).`, 'success', 'tea-session-inline-status');
  }
}

function triggerRandomSpotCheck() {
  const list = (teacherState && teacherState.roster) || [];
  const checkedIn = list.filter(s => s.status === 'P' || s.status === 'L');
  if (checkedIn.length === 0) {
    showStatus('Chưa có sinh viên nào điểm danh trong phiên này.', 'warn');
    return;
  }

  const pick = checkedIn[Math.floor(Math.random() * checkedIn.length)];
  openAppModal(
    'Kiểm tra Ngẫu nhiên Sĩ số',
    `Họ tên: ${pick.fullName}\nMSSV: ${pick.studentId} (Điểm danh lúc: ${pick.time || 'N/A'})`,
    'Vắng mặt (Hủy & Khóa điểm danh)',
    async () => {
      await teacherManualMark(pick.studentId, '-');
      showStatus(`Đã hủy điểm danh và khóa nộp lại trong phiên này đối với ${pick.fullName} (${pick.studentId}).`, 'warn');
    }
  );
}

async function teacherManualMark(studentId, status) {
  const auth = getTeacherAuth();
  const classId = document.getElementById('sel-tea-class').value;
  if (!auth || !classId) return;
  const res = await callBackend(auth.apiUrl, {
    action: 'TEACHER_MANUAL_MARK',
    teacherToken: auth.token,
    classId: classId,
    studentId: studentId,
    status: status
  });
  if (res && res.ok) await applyTeacherState(res, false);
  else showStatus(res && res.message ? res.message : 'Lỗi cập nhật trạng thái.', 'err');
}

function teacherResetStudentDevice(studentId) {
  openAppModal(
    'Mở khóa Thiết bị Sinh viên',
    `Xác nhận đặt lại khóa thiết bị cho MSSV ${studentId}? Sinh viên sẽ có thể liên kết lại trên trình duyệt mới.`,
    'Xác nhận mở khóa',
    async () => {
      const auth = getTeacherAuth();
      const res = await callBackend(auth.apiUrl, {
        action: 'TEACHER_RESET_DEVICE',
        teacherToken: auth.token,
        studentId: studentId
      });
      if (res && res.ok) {
        showStatus(formatServerMessage('DEVICE_RESET_OK', { id: studentId }), 'success');
      } else {
        showStatus(res && res.message ? res.message : 'Không thể mở khóa thiết bị.', 'warn');
      }
    }
  );
}

function teacherRotateStaticQr() {
  openAppModal(
    'Đổi mã khóa QR Lớp học',
    'Tạo mã khóa bí mật mới cho lớp này?',
    'Đổi mã khóa',
    async () => {
      const auth = getTeacherAuth();
      const classId = document.getElementById('sel-tea-class').value;
      if (!auth || !classId) return;
      const res = await callBackend(auth.apiUrl, {
        action: 'TEACHER_ROTATE_STATIC_QR',
        teacherToken: auth.token,
        classId: classId
      });
      if (res && res.ok) await applyTeacherState(res, false);
    }
  );
}

async function teacherToggleRegGate() {
  const auth = getTeacherAuth();
  const classId = document.getElementById('sel-tea-class').value;
  if (!auth || !classId) {
    showStatus('Vui lòng chọn lớp học phần trước.', 'warn', 'tea-admin-inline-status');
    return;
  }
  const res = await callBackend(auth.apiUrl, {
    action: 'TEACHER_TOGGLE_REG',
    teacherToken: auth.token,
    classId: classId
  });
  if (res && res.ok) {
    await applyTeacherState(res, false);
    showStatus('Đã cập nhật trạng thái cổng đăng ký thiết bị mới.', 'success', 'tea-admin-inline-status');
  }
}

async function teacherRebuildSheet() {
  const auth = getTeacherAuth();
  const classId = document.getElementById('sel-tea-class').value;
  if (!auth) return;
  showStatus('Đang kiểm tra danh sách Drive & đồng bộ kết quả vào Google Sheet...', 'warn', 'tea-admin-inline-status');
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
      showStatus(`Đã bổ sung ${res.newStudentsAdded} sinh viên mới từ Drive${namesStr} và đồng bộ Google Sheet thành công.`, 'success', 'tea-admin-inline-status');
    } else {
      showStatus('Đã đồng bộ dữ liệu vào Google Sheet thành công.', 'success', 'tea-admin-inline-status');
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
  teacherPollTimer = setInterval(refreshTeacherState, 4500);
}

function stopTeacherPolling() {
  if (teacherPollTimer) clearInterval(teacherPollTimer);
}
