/**
 * ============================================================================
 * LECTURER CONTROLLER (js/teacher.js — v3.7.0)
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
let lastPulsedManualMark = null; // { studentId, status, dayKey, expiresAt } for P/L/E/- button pulse across re-renders
let randomCallerVisitedByClass = {}; // Per-class shuffle bag Set of studentIds already called
let currentDraftGroups = [];
let reopen5mCapBySession = {}; // Maps sessionId -> presentUntilMs cap when Reopen 5m is clicked
let currentDraftGroupSize = 4;
let activeRosterRoundView = 'FINAL'; // 'P1' | 'P2' | 'FINAL'
let expandedP2DetailStudentIds = {}; // studentId -> boolean
let teacherClockOffsetMs = 0; // serverNowMs - Date.now() (RTT/2 compensated)
let teacherLastClockSyncAtMs = 0;
let teacherClockSyncTimer = null;
let teacherPin10sTicker = null;
let teacherPin10sClockSyncedForSesId = '';

function updateTeacherClockOffsetFromServer(serverNowMs, rttMs = 0) {
  const srv = Number(serverNowMs || 0);
  if (!srv || isNaN(srv) || srv <= 0) return;
  const halfRtt = Math.round(Math.max(0, Number(rttMs || 0)) / 2);
  teacherClockOffsetMs = (srv + halfRtt) - Date.now();
  teacherLastClockSyncAtMs = Date.now();
}

function getTeacherSyncedNowMs() {
  return Date.now() + Number(teacherClockOffsetMs || 0);
}

async function syncTeacherServerClockOffset() {
  const auth = getTeacherAuth();
  const apiUrl = auth && auth.apiUrl ? auth.apiUrl : DEFAULT_LECTURER_API;
  const t0 = Date.now();
  try {
    const res = await callBackend(apiUrl, { action: 'PING' }, 1);
    const t1 = Date.now();
    if (res && res.ok && (res.serverNowMs || res.serverTimeMs)) {
      updateTeacherClockOffsetFromServer(res.serverNowMs || res.serverTimeMs, t1 - t0);
      updateProjectorPin10sUI();
    }
  } catch (e) {}
}

function stopTeacherPin10sProjectorLoop() {
  if (teacherPin10sTicker) {
    clearInterval(teacherPin10sTicker);
    teacherPin10sTicker = null;
  }
  if (teacherClockSyncTimer) {
    clearInterval(teacherClockSyncTimer);
    teacherClockSyncTimer = null;
  }
}

function updateProjectorPin10sUI() {
  const box = document.getElementById('tea-p2-pin-projector-box');
  if (!box) return;
  const ses = teacherState && teacherState.activeSession;
  const isPin10sOpen = Boolean(
    ses &&
    ses.isOpen &&
    Number(ses.round || 1) === 2 &&
    String(ses.qrMode || '').toUpperCase() === 'PIN_10S'
  );
  if (!isPin10sOpen) {
    box.classList.add('hidden');
    stopTeacherPin10sProjectorLoop();
    return;
  }

  box.classList.remove('hidden');
  const activeCfg = (teacherState && Array.isArray(teacherState.classes))
    ? teacherState.classes.find(c => c && c.classId === selectedTeacherClassId)
    : null;
  const seed = String(
    (ses && ses.pinSeed) ||
    (activeCfg && activeCfg.activeQrSecret) ||
    KNOWN_CLASS_SECRETS[selectedTeacherClassId] ||
    (ses && ses.sessionId) ||
    ''
  );
  const syncedNowMs = getTeacherSyncedNowMs();
  const bucket10s = Math.floor(syncedNowMs / 10000);
  const pin4 = typeof computePin4FromSeed === 'function'
    ? computePin4FromSeed(seed, bucket10s)
    : '0000';

  for (let i = 0; i < 4; i++) {
    const dEl = document.getElementById('tea-pin10s-d' + i);
    if (dEl) dEl.textContent = pin4.charAt(i) || '0';
  }

  const elapsedInBucketMs = ((syncedNowMs % 10000) + 10000) % 10000;
  const remMs = 10000 - elapsedInBucketMs;
  const pct = Math.max(0, Math.min(100, (remMs / 10000) * 100));
  const barFill = document.getElementById('tea-pin10s-bar-fill');
  if (barFill) {
    barFill.style.width = pct.toFixed(1) + '%';
  }
  const subEl = document.getElementById('tea-pin10s-sub');
  if (subEl) {
    const remSec = Math.ceil(remMs / 1000);
    subEl.textContent = currentLang === 'en'
      ? `Next PIN in: ${remSec}s`
      : `Đổi mã mới sau: ${remSec}s`;
  }
}

function syncProjectorPin10sLifecycle(ses) {
  const isPin10sOpen = Boolean(
    ses &&
    ses.isOpen &&
    Number(ses.round || 1) === 2 &&
    String(ses.qrMode || '').toUpperCase() === 'PIN_10S'
  );
  const box = document.getElementById('tea-p2-pin-projector-box');
  if (!isPin10sOpen) {
    if (box) box.classList.add('hidden');
    stopTeacherPin10sProjectorLoop();
    teacherPin10sClockSyncedForSesId = '';
    return;
  }

  if (teacherPin10sClockSyncedForSesId !== String(ses.sessionId || '')) {
    teacherPin10sClockSyncedForSesId = String(ses.sessionId || '');
    syncTeacherServerClockOffset();
  }
  updateProjectorPin10sUI();
  if (!teacherPin10sTicker) {
    teacherPin10sTicker = setInterval(updateProjectorPin10sUI, 100);
  }
  if (!teacherClockSyncTimer) {
    teacherClockSyncTimer = setInterval(syncTeacherServerClockOffset, 60000);
  }
}

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

  safeRemoveLocal('cc_tea_selected_class');
  safeRemoveSession('cc_tea_selected_class');
  selectedTeacherClassId = '';
  teacherHasManuallySelectedClass = false;

  const cachedRaw = safeGetSession('cc_tea_state_cache', null);
  if (cachedRaw) {
    try {
      const cachedState = JSON.parse(cachedRaw);
      if (cachedState && cachedState.ok) {
        await applyTeacherState(cachedState, false, true);
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

  if (typeof pulseButtonConfirm === 'function') {
    await pulseButtonConfirm('btn-tea-login', currentLang === 'en' ? 'VERIFIED' : 'ĐÃ XÁC THỰC', 'success', 420);
  }

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

function extractSessionDayKey(ses) {
  if (!ses) return '';
  const pad2 = n => String(n).padStart(2, '0');
  if (ses.openedAtMs && Number(ses.openedAtMs) > 0) {
    const d = new Date(Number(ses.openedAtMs));
    if (!isNaN(d.getTime())) {
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }
  }
  if (ses.sessionId) {
    const mSes = String(ses.sessionId).match(/_(\d{4})(\d{2})(\d{2})_/);
    if (mSes) return `${mSes[1]}-${mSes[2]}-${mSes[3]}`;
  }
  return '';
}

function splitVietnameseNameParts(fullName) {
  const clean = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!clean) return { givenName: '', familyMiddle: '' };
  const parts = clean.split(' ');
  const givenName = parts[parts.length - 1] || '';
  const familyMiddle = parts.slice(0, -1).join(' ');
  return { givenName, familyMiddle };
}

function compareStudentsVietnameseAZ(a, b) {
  const na = splitVietnameseNameParts(a && a.fullName);
  const nb = splitVietnameseNameParts(b && b.fullName);
  const cmpGiven = na.givenName.localeCompare(nb.givenName, 'vi', { sensitivity: 'base' });
  if (cmpGiven !== 0) return cmpGiven;
  const cmpAccent = na.givenName.localeCompare(nb.givenName, 'vi');
  if (cmpAccent !== 0) return cmpAccent;
  const cmpFam = na.familyMiddle.localeCompare(nb.familyMiddle, 'vi', { sensitivity: 'base' });
  if (cmpFam !== 0) return cmpFam;
  return String((a && a.studentId) || '').localeCompare(String((b && b.studentId) || ''), 'vi');
}

async function applyTeacherState(state, isInitialLoad = false, isFromCache = false) {
  if (!state) return;
  if (!isFromCache && (state.serverNowMs || state.serverTimeMs)) {
    updateTeacherClockOffsetFromServer(state.serverNowMs || state.serverTimeMs, 0);
  }
  ingestServerScheduleData(state);

  // Filter out removed test sample class ENG101_G1 while keeping 100% of real classes
  const isStaleCache = isFromCache && state.serverTimeMs && (Date.now() - Number(state.serverTimeMs) > 15 * 60 * 1000);
  const cleanClasses = (state.classes || []).filter(
    c => c && c.classId && !REMOVED_SAMPLE_CLASSES.includes(String(c.classId).trim().toUpperCase())
  ).map(c => isStaleCache ? Object.assign({}, c, { sessionOpenNow: false }) : c);
  state.classes = cleanClasses;

  // Reset live dashboard UI if the returned session is a closed session from a previous day (e.g. Monday's session viewed on Friday)
  if (state.activeSession && !state.activeSession.isOpen) {
    const sesDayKey = extractSessionDayKey(state.activeSession);
    const todayKey = getTodayDateKey();
    if (sesDayKey && sesDayKey !== todayKey) {
      state.activeSession = null;
      state.round2OpenedToday = false;
      state.round1Session = null;
      state.round2Session = null;
      if (Array.isArray(state.roster)) {
        state.roster.forEach(st => {
          if (!st) return;
          st.status = '-';
          st.p1Status = '-';
          st.p2Status = '';
          st.finalStatus = '-';
          st.time = '';
          st.p1Time = '';
          st.p2Time = '';
          st.distance = '';
          st.p1Distance = '';
          st.p2Distance = '';
          st.accuracy = '';
          st.source = '';
          st.p1Source = '';
          st.p2Source = '';
        });
      }
    }
  }

  if (state.activeSession && state.activeSession.sessionId && reopen5mCapBySession[state.activeSession.sessionId]) {
    const capMs = reopen5mCapBySession[state.activeSession.sessionId];
    if (Date.now() <= capMs) {
      state.activeSession.closesAtMs = capMs;
    } else {
      delete reopen5mCapBySession[state.activeSession.sessionId];
    }
  }

  if (Array.isArray(state.roster)) {
    state.roster.sort(compareStudentsVietnameseAZ);
    overlayPendingManualMarksOnRoster(state.roster);
  }
  if (state.activeSession && (state.activeSession.round2OpenedToday || Number(state.activeSession.round) === 2)) {
    state.round2OpenedToday = true;
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

  if (!teacherHasManuallySelectedClass) {
    // Auto-select the class matching the current period/calendar or active open session, or "" if outside teaching hours
    selectedTeacherClassId = autoClassId;
    if (selectedTeacherClassId && selectedTeacherClassId !== state.selectedClassId && !isFromCache) {
      const auth = getTeacherAuth();
      if (auth) {
        const switchedRes = await callBackend(auth.apiUrl, {
          action: 'TEACHER_GET_STATE',
          teacherToken: auth.token,
          classId: selectedTeacherClassId
        }, 1);
        if (switchedRes && switchedRes.ok) {
          await applyTeacherState(switchedRes, false, false);
          return;
        }
      }
    }
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

  updateTeacherRoundSegmentedControlUI();
  updateTeacherLiveCountersFromRoster();
  const roster = activeCfg ? (state.roster || []) : [];

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
  renderTeacherCourseProgressStrip(activeCfg, ses);
  if (document.getElementById('hist-modal-rows')) {
    refreshHistoryModalDateOptionsIfNeeded();
    renderHistoryCalendarWidget();
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
  const makeUpWrap = document.getElementById('tea-makeup-confirm-wrap');
  const makeUpChk = document.getElementById('chk-confirm-makeup-session');
  const makeUpLbl = document.getElementById('lbl-confirm-makeup-session');

  const activeCfg = (teacherState && Array.isArray(teacherState.classes))
    ? teacherState.classes.find(c => c && c.classId === classId)
    : null;
  const courseDates = typeof getClassCourseSessionDates === 'function'
    ? getClassCourseSessionDates(classId, activeCfg ? activeCfg.scheduleInfo : null)
    : [];
  const todayKey = getTodayDateKey();
  const isTodayOnSheet = courseDates.length === 0 || courseDates.some(cd => cd.dayKey === todayKey);

  if (makeUpChk) {
    makeUpChk.checked = false;
  }

  if (!isTodayOnSheet) {
    const todayShort = `${todayKey.slice(8, 10)}/${todayKey.slice(5, 7)}`;
    if (confirmLabel) {
      confirmLabel.textContent = isEn
        ? `[WARNING] Today (${todayShort}) is NOT in the regular Sheet schedule for [${classId}]. If you selected the wrong class, click Cancel:`
        : `[CẢNH BÁO] Hôm nay (${todayShort}) KHÔNG nằm trong lịch trình cột ngày trên Sheet của lớp [${classId}]. Nếu chọn nhầm lớp, vui lòng bấm Hủy:`;
    }
    if (makeUpLbl) {
      makeUpLbl.textContent = isEn
        ? `I confirm opening a MAKE-UP session for [${classId}] (Auto-add column ${todayShort} to schedule & Sheet)`
        : `Tôi xác nhận mở phiên DẠY BÙ cho lớp [${classId}] (Tự động thêm cột ngày ${todayShort} vào lịch & Sheet)`;
    }
    if (makeUpWrap) makeUpWrap.classList.remove('hidden');
    if (confirmBtn) {
      confirmBtn.textContent = isEn ? 'Confirm Make-up Session' : 'Xác nhận mở phiên dạy bù';
      confirmBtn.disabled = true;
    }
  } else {
    if (confirmLabel) {
      confirmLabel.textContent = isEn
        ? `You are about to open an attendance session for class [${classId}]. Please confirm:`
        : `Bạn chuẩn bị mở phiên điểm danh cho lớp [${classId}]. Vui lòng xác nhận:`;
    }
    if (makeUpWrap) makeUpWrap.classList.add('hidden');
    if (confirmBtn) {
      confirmBtn.textContent = isEn ? 'Confirm Open' : 'Xác nhận mở phiên';
      confirmBtn.disabled = false;
    }
  }

  if (triggerBtn) triggerBtn.classList.add('hidden');
  if (confirmBox) confirmBox.classList.remove('hidden');
}

function onMakeUpConfirmCheckboxChange() {
  const makeUpChk = document.getElementById('chk-confirm-makeup-session');
  const confirmBtn = document.getElementById('btn-tea-confirm-open');
  if (confirmBtn && makeUpChk) {
    confirmBtn.disabled = !makeUpChk.checked;
  }
}

function cancelOpenSessionConfirm() {
  const triggerBtn = document.getElementById('btn-tea-open-trigger');
  const confirmBox = document.getElementById('tea-open-confirm-bar');
  const makeUpWrap = document.getElementById('tea-makeup-confirm-wrap');
  const makeUpChk = document.getElementById('chk-confirm-makeup-session');
  const confirmBtn = document.getElementById('btn-tea-confirm-open');
  if (makeUpChk) makeUpChk.checked = false;
  if (makeUpWrap) makeUpWrap.classList.add('hidden');
  if (confirmBtn) confirmBtn.disabled = false;
  if (confirmBox) confirmBox.classList.add('hidden');
  if (triggerBtn) triggerBtn.classList.remove('hidden');
}

async function confirmAndStartSession() {
  const makeUpWrap = document.getElementById('tea-makeup-confirm-wrap');
  const makeUpChk = document.getElementById('chk-confirm-makeup-session');
  const requiresMakeUpConfirm = Boolean(makeUpWrap && !makeUpWrap.classList.contains('hidden'));
  if (requiresMakeUpConfirm && (!makeUpChk || !makeUpChk.checked)) {
    return;
  }
  const isMakeUpConfirmed = Boolean(requiresMakeUpConfirm && makeUpChk && makeUpChk.checked);
  if (typeof pulseButtonConfirm === 'function') {
    pulseButtonConfirm(
      'btn-tea-confirm-open',
      currentLang === 'en' ? 'OPENING SESSION...' : 'ĐANG MỞ PHIÊN...',
      'success',
      1500
    );
  }
  await teacherStartSession(isMakeUpConfirmed);
  cancelOpenSessionConfirm();
  if (typeof pulseButtonConfirm === 'function') {
    pulseButtonConfirm(
      'btn-tea-open-trigger',
      currentLang === 'en' ? 'SESSION OPENED' : 'ĐÃ MỞ PHIÊN ĐIỂM DANH',
      'success',
      1400
    );
  }
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
  await refreshTeacherState(true);
}

function syncSessionControlButtonsState(ses, hasSelectedClass = true) {
  const btnOpenTrigger = document.getElementById('btn-tea-open-trigger');
  const confirmBox = document.getElementById('tea-open-confirm-bar');
  const p2LaunchStrip = document.getElementById('tea-p2-launch-strip');
  const btnExtend = document.getElementById('btn-tea-extend');
  const btnReopen = document.getElementById('btn-tea-reopen');
  const btnCancelMistaken = document.getElementById('btn-tea-cancel-mistaken');
  const btnClose = document.getElementById('btn-tea-close');
  const isEn = currentLang === 'en';

  const hasTodaySession = Boolean(hasSelectedClass && ses && ses.sessionId);
  const isOpenNow = Boolean(hasTodaySession && ses.isOpen);
  const p2Opened = Boolean(teacherState && teacherState.round2OpenedToday);
  const isP1ClosedReadyForP2 = Boolean(
    hasTodaySession &&
    !isOpenNow &&
    !p2Opened &&
    Number(ses.round || 1) === 1
  );

  if (p2LaunchStrip && btnOpenTrigger) {
    const isConfirmVisible = Boolean(confirmBox && !confirmBox.classList.contains('hidden'));
    if (isP1ClosedReadyForP2 && !isConfirmVisible) {
      btnOpenTrigger.classList.add('hidden');
      p2LaunchStrip.classList.remove('hidden');
    } else {
      p2LaunchStrip.classList.add('hidden');
      if (!isConfirmVisible) {
        btnOpenTrigger.classList.remove('hidden');
      }
      btnOpenTrigger.disabled = Boolean(isOpenNow || (hasTodaySession && p2Opened));
    }
  }

  if (btnExtend) btnExtend.disabled = !hasTodaySession;
  if (btnReopen) {
    if (p2Opened) {
      btnReopen.disabled = true;
      btnReopen.title = isEn
        ? 'Cannot reopen Round 1 because Round 2 has already been opened today'
        : 'Không thể mở lại Phiên 1 vì Phiên 2 đã được mở trong buổi học này';
      btnReopen.textContent = isEn ? 'Reopen P1 (Locked: P2 opened)' : 'Mở lại 5p (Khóa: Đã mở P2)';
    } else {
      btnReopen.disabled = !hasTodaySession;
      btnReopen.title = '';
      btnReopen.textContent = isEn ? 'Reopen 5 Mins' : 'Mở lại 5 phút';
    }
  }
  if (btnCancelMistaken) btnCancelMistaken.disabled = !hasTodaySession;
  if (btnClose) btnClose.disabled = !isOpenNow;

  syncProjectorPin10sLifecycle(hasSelectedClass ? ses : null);
}

function setupTeacherCountdown(ses, hasSelectedClass = true) {
  if (teacherCountdownTimer) clearInterval(teacherCountdownTimer);
  const badge = document.getElementById('tea-session-badge');
  const timerEl = document.getElementById('tea-countdown');
  const isEn = currentLang === 'en';

  syncSessionControlButtonsState(ses, hasSelectedClass);

  if (!hasSelectedClass) {
    badge.className = 'badge-neutral';
    badge.textContent = isEn ? 'NO CLASS SELECTED' : 'CHƯA CHỌN LỚP';
    timerEl.textContent = '--:--';
    return;
  }

  if (!ses) {
    badge.className = 'badge-neutral';
    badge.textContent = isEn ? 'NO SESSION TODAY' : 'CHƯA MỞ PHIÊN HÔM NAY';
    timerEl.textContent = '00:00';
    return;
  }

  const isRound2Ses = Number(ses.round || 1) === 2 || Boolean(teacherState && teacherState.round2OpenedToday);
  if (!ses.isOpen) {
    badge.className = 'badge-err';
    badge.textContent = isRound2Ses
      ? (isEn ? 'ROUND 2 CLOSED' : 'ĐÃ ĐÓNG PHIÊN 2')
      : (isEn ? 'ROUND 1 CLOSED' : 'ĐÃ ĐÓNG PHIÊN 1');
    timerEl.textContent = '00:00';
    return;
  }

  const updateTick = () => {
    const now = Date.now();
    const enNow = currentLang === 'en';
    const isR2 = Number(ses.round || 1) === 2;
    if (now > ses.closesAtMs) {
      const wasReopen5mCapped = Boolean(ses.sessionId && reopen5mCapBySession[ses.sessionId]);
      if (ses.sessionId) delete reopen5mCapBySession[ses.sessionId];
      ses.isOpen = false;
      syncSessionControlButtonsState(ses, hasSelectedClass);
      badge.className = 'badge-err';
      badge.textContent = isR2
        ? (enNow ? 'ROUND 2 CLOSED' : 'ĐÃ ĐÓNG PHIÊN 2')
        : (enNow ? 'ROUND 1 CLOSED' : 'ĐÃ ĐÓNG PHIÊN 1');
      timerEl.textContent = '00:00';
      clearInterval(teacherCountdownTimer);
      if (wasReopen5mCapped) {
        teacherControlSession('CLOSE_NOW');
      } else {
        setTimeout(() => refreshTeacherState(true), 1200);
      }
      return;
    }
    if (isR2) {
      const remSec = Math.max(0, Math.floor((ses.closesAtMs - now) / 1000));
      badge.className = 'badge-ok';
      badge.textContent = enNow ? 'ROUND 2 OPEN (VERIFICATION)' : 'ĐANG MỞ ĐIỂM DANH LẦN 2';
      timerEl.textContent = formatMmSs(remSec);
    } else if (now <= ses.presentUntilMs) {
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

async function teacherStartSession(isMakeUpConfirmed = false) {
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

  await executeStartSessionRequest(auth, classId, hasTeacherGps, lat, lng, acc, anchorMode, isMakeUpConfirmed);
}

async function executeStartSessionRequest(auth, classId, useGps, lat, lng, gpsAccuracy = 0, anchorMode = 'TEACHER_GPS', isMakeUpConfirmed = false) {
  const isEn = currentLang === 'en';
  showStatus(
    isEn ? `Opening attendance session for ${classId}...` : `Đang mở phiên điểm danh cho lớp ${classId}...`,
    'warn',
    'tea-session-inline-status'
  );

  if (isMakeUpConfirmed) {
    const todayKey = getTodayDateKey();
    if (window.liveServerSchedule && window.liveServerSchedule.classSchedules) {
      if (!window.liveServerSchedule.classSchedules[classId]) {
        window.liveServerSchedule.classSchedules[classId] = { sessionDates: [todayKey] };
      } else if (Array.isArray(window.liveServerSchedule.classSchedules[classId].sessionDates)) {
        const arr = window.liveServerSchedule.classSchedules[classId].sessionDates;
        if (!arr.includes(todayKey)) {
          arr.push(todayKey);
          arr.sort((a, b) => String(a).localeCompare(String(b)));
        }
      }
    }
  }

  const res = await callBackend(auth.apiUrl, {
    action: 'TEACHER_START_SESSION',
    teacherToken: auth.token,
    classId: classId,
    usePhoneGps: useGps,
    lat: lat,
    lng: lng,
    gpsAccuracy: gpsAccuracy,
    anchorMode: anchorMode,
    qrMode: 'STATIC',
    isMakeUpSession: Boolean(isMakeUpConfirmed)
  });

  if (res && res.ok) {
    selectedTeacherClassId = classId;
    teacherHasManuallySelectedClass = true;
    safeSetSession('cc_tea_selected_class', selectedTeacherClassId);
    safeSetLocal('cc_tea_selected_class', selectedTeacherClassId);
    await applyTeacherState(res, false);
    if (typeof pulseButtonConfirm === 'function') {
      pulseButtonConfirm(
        'btn-tea-open-trigger',
        isEn ? 'SESSION OPENED' : 'ĐÃ MỞ PHIÊN ĐIỂM DANH',
        'success',
        1400
      );
    }
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

async function openRound2Session() {
  const minsInput = document.getElementById('inp-tea-p2-mins');
  const pinChk = document.getElementById('chk-tea-p2-pin10s');
  const rawMins = minsInput ? parseInt(minsInput.value, 10) : 3;
  const durationMinutes = Math.min(15, Math.max(1, isNaN(rawMins) ? 3 : rawMins));
  const qrMode = (pinChk && pinChk.checked) ? 'PIN_10S' : 'STATIC';
  if (minsInput) minsInput.value = String(durationMinutes);

  if (qrMode === 'PIN_10S') {
    syncTeacherServerClockOffset();
  }
  await teacherControlSession('OPEN_ROUND_2', {
    durationMinutes: durationMinutes,
    qrMode: qrMode
  });
}

async function switchRound2QrMode(newMode) {
  const mode = String(newMode || 'STATIC').trim().toUpperCase();
  await teacherControlSession('SET_QR_MODE', { qrMode: mode });
}

async function teacherControlSession(subAction, extra = {}) {
  const auth = getTeacherAuth();
  const classId = document.getElementById('sel-tea-class').value;
  const isEn = currentLang === 'en';
  if (!auth || !classId) {
    showStatus(isEn ? 'Please select a class section first.' : 'Vui lòng chọn lớp học phần trước.', 'warn');
    return;
  }
  if (subAction === 'REOPEN_5M' && teacherState && teacherState.round2OpenedToday) {
    showStatus(
      formatServerMessage('ERR_REOPEN_BLOCKED_BY_P2', {}, isEn
        ? 'Cannot reopen Round 1 because Round 2 has already been opened today.'
        : 'Không thể mở lại Phiên 1 vì Phiên 2 đã được mở trong buổi học này.'),
      'err',
      'tea-session-inline-status'
    );
    return;
  }
  const prevSesId = (teacherState && teacherState.activeSession && teacherState.activeSession.sessionId)
    ? String(teacherState.activeSession.sessionId)
    : '';
  cancelOpenSessionConfirm();
  let res = await callBackend(auth.apiUrl, Object.assign({
    action: 'TEACHER_CONTROL_SESSION',
    teacherToken: auth.token,
    classId: classId,
    subAction: subAction
  }, extra));
  if (res && res.ok) {
    // Fallback if the deployed Google Apps Script Web App is still on an older Code.gs (< v3.6.1) that ignored CANCEL_MISTAKEN_SESSION
    if (
      subAction === 'CANCEL_MISTAKEN_SESSION' &&
      prevSesId &&
      res.activeSession &&
      String(res.activeSession.sessionId) === prevSesId
    ) {
      const markedStudents = Array.isArray(res.roster)
        ? res.roster.filter(s => s && s.studentId && s.status && s.status !== '-')
        : [];
      for (let i = 0; i < markedStudents.length; i++) {
        await callBackend(auth.apiUrl, {
          action: 'TEACHER_MANUAL_MARK',
          teacherToken: auth.token,
          classId: classId,
          studentId: markedStudents[i].studentId,
          status: '-',
          targetSessionId: prevSesId
        });
      }
      if (res.activeSession.isOpen) {
        res = await callBackend(auth.apiUrl, {
          action: 'TEACHER_CONTROL_SESSION',
          teacherToken: auth.token,
          classId: classId,
          subAction: 'CLOSE_NOW'
        }) || res;
      } else {
        await callBackend(auth.apiUrl, {
          action: 'TEACHER_REBUILD_SHEET',
          teacherToken: auth.token,
          classId: classId
        });
      }
      if (res && Array.isArray(res.roster)) {
        res.roster.forEach(s => {
          s.status = '-';
          s.time = '';
          s.distance = '';
        });
      }
      if (res && res.activeSession) {
        res.activeSession.isOpen = false;
      }
      await applyTeacherState(res, false);
      showStatus(
        isEn
          ? `Closed session & cleared marks, but your Google Sheet's Apps Script (Code.gs) is still on an older deployment (v3.6.0). Please paste the latest code3.6.6.text into Apps Script -> Deploy -> Manage deployments -> Edit -> New version to completely delete mistaken session rows.`
          : `Đã dừng phiên và xóa điểm danh tạm thời, nhưng Apps Script (Code.gs) trên Google Sheet của bạn đang ở bản Deploy cũ (v3.6.0) chưa có lệnh xóa dòng phiên. Vui lòng dán bản code3.6.6.text mới vào Apps Script -> Deploy -> Manage deployments -> Edit -> New version!`,
        'warn',
        'tea-session-inline-status'
      );
      return;
    }

    if (subAction === 'REOPEN_5M' && res.activeSession && res.activeSession.sessionId) {
      const targetEndMs = Number(res.activeSession.presentUntilMs || (Date.now() + 5 * 60 * 1000));
      reopen5mCapBySession[res.activeSession.sessionId] = targetEndMs;
      res.activeSession.closesAtMs = targetEndMs;
    } else if ((subAction === 'CLOSE_NOW' || subAction === 'CANCEL_MISTAKEN_SESSION') && prevSesId) {
      delete reopen5mCapBySession[prevSesId];
    }
    await applyTeacherState(res, false);
    if (typeof pulseButtonConfirm === 'function') {
      if (subAction === 'EXTEND_2M') {
        pulseButtonConfirm('btn-tea-extend', isEn ? '+2 MINS ADDED' : 'ĐÃ +2 PHÚT', 'success', 1200);
      } else if (subAction === 'REOPEN_5M') {
        pulseButtonConfirm('btn-tea-reopen', isEn ? 'REOPENED 5M' : 'ĐÃ MỞ LẠI 5 PHÚT', 'success', 1200);
      } else if (subAction === 'OPEN_ROUND_2') {
        showStatus(
          isEn
            ? `Opened Round 2 verification check-in (${extra.qrMode === 'PIN_10S' ? '10s Rotating PIN' : '1-Tap GPS'}).`
            : `Đã mở điểm danh Lần 2 (${extra.qrMode === 'PIN_10S' ? 'Mã PIN 10 giây' : '1-Chạm GPS'}).`,
          'success',
          'tea-session-inline-status'
        );
      } else if (subAction === 'SET_QR_MODE') {
        showStatus(
          isEn
            ? 'Switched Round 2 to 1-Tap GPS (No PIN required). Previous PIN check-ins are preserved.'
            : 'Đã chuyển Phiên 2 về chế độ 1-Chạm (Không cần PIN). Sinh viên đã nhập đúng PIN trước đó được giữ nguyên.',
          'success',
          'tea-session-inline-status'
        );
      } else if (subAction === 'CLOSE_NOW') {
        pulseButtonConfirm('btn-tea-close', isEn ? 'SESSION CLOSED' : 'ĐÃ ĐÓNG PHIÊN', 'danger', 1200);
      } else if (subAction === 'CANCEL_MISTAKEN_SESSION') {
        pulseButtonConfirm('btn-tea-cancel-mistaken', isEn ? 'SESSION DELETED' : 'ĐÃ HỦY PHIÊN NHẦM', 'danger', 1300);
      }
    }
    if (subAction === 'CANCEL_MISTAKEN_SESSION') {
      showStatus(
        isEn
          ? `Cancelled and removed the mistaken session for ${classId}.`
          : `Đã hủy và xóa bỏ hoàn toàn phiên mở nhầm của lớp ${classId}.`,
        'success',
        'tea-session-inline-status'
      );
    }
  } else if (res && res.code) {
    showStatus(
      formatServerMessage(res.code, res.params || {}, res.message || ''),
      'err',
      'tea-session-inline-status'
    );
  }
}

function promptCancelMistakenSession() {
  const classId = document.getElementById('sel-tea-class').value;
  const isEn = currentLang === 'en';
  if (!classId) {
    showStatus(isEn ? 'Please select a class section first.' : 'Vui lòng chọn lớp học phần trước.', 'warn');
    return;
  }
  const ses = teacherState && teacherState.activeSession;
  if (!ses || !ses.sessionId) {
    showStatus(
      isEn ? 'No recent session found to cancel for this class.' : 'Không có phiên nào gần đây để hủy cho lớp này.',
      'warn',
      'tea-session-inline-status'
    );
    return;
  }
  openAppModal(
    isEn ? 'Cancel Mistaken Session' : 'Xác nhận Hủy Phiên Mở Nhầm',
    isEn
      ? `Are you sure you want to CANCEL and DELETE session [${ses.sessionLabel || ses.sessionId}] of class [${classId}]? This session will be completely removed from history and students will not be marked absent.`
      : `Bạn có chắc chắn muốn HỦY và XÓA BỎ phiên [${ses.sessionLabel || ses.sessionId}] vừa mở nhầm của lớp [${classId}] không? Phiên này sẽ được gỡ hoàn toàn khỏi lịch sử và không tính vắng sinh viên.`,
    isEn ? 'Delete Mistaken Session' : 'Xóa phiên mở nhầm',
    async () => {
      await teacherControlSession('CANCEL_MISTAKEN_SESSION');
    },
    { confirmClass: 'btn btn-danger' }
  );
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

function updateTeacherRoundSegmentedControlUI() {
  const segWrap = document.getElementById('tea-round-segmented');
  if (!segWrap) return;
  const p2Opened = Boolean(teacherState && teacherState.round2OpenedToday);
  const isEn = currentLang === 'en';
  if (!p2Opened) {
    segWrap.classList.add('hidden');
    return;
  }
  segWrap.classList.remove('hidden');
  const btnP1 = document.getElementById('seg-round-p1');
  const btnP2 = document.getElementById('seg-round-p2');
  const btnFinal = document.getElementById('seg-round-final');
  if (btnP1) {
    btnP1.textContent = isEn ? 'Round 1' : 'Phiên 1';
    btnP1.classList.toggle('active', activeRosterRoundView === 'P1');
  }
  if (btnP2) {
    btnP2.textContent = isEn ? 'Round 2' : 'Phiên 2';
    btnP2.classList.toggle('active', activeRosterRoundView === 'P2');
  }
  if (btnFinal) {
    btnFinal.textContent = isEn ? 'Final Result' : 'Kết quả cuối';
    btnFinal.classList.toggle('active', activeRosterRoundView === 'FINAL');
  }
}

function setTeacherRosterRoundView(roundView) {
  if (roundView === 'P1' || roundView === 'P2' || roundView === 'FINAL') {
    activeRosterRoundView = roundView;
  } else {
    activeRosterRoundView = 'FINAL';
  }
  updateTeacherRoundSegmentedControlUI();
  updateTeacherLiveCountersFromRoster();
  renderTeacherRoster();
}

function toggleStudentRowP2Detail(studentId) {
  const sid = String(studentId || '').trim();
  if (!sid) return;
  if (!(teacherState && teacherState.round2OpenedToday)) return;
  expandedP2DetailStudentIds[sid] = !expandedP2DetailStudentIds[sid];
  renderTeacherRoster();
}

function getStudentStatusForRoundView(st, viewMode, p2Opened) {
  if (!st) return '-';
  if (!p2Opened || viewMode === 'P1') {
    const rawP1 = st.p1Status !== undefined ? st.p1Status : st.status;
    return normalizeAttendanceStatusCode(rawP1);
  }
  if (viewMode === 'P2') {
    return normalizeAttendanceStatusCode(st.p2Status !== undefined ? st.p2Status : '-');
  }
  return mergeAttendance(
    st.p1Status !== undefined ? st.p1Status : st.status,
    st.p2Status !== undefined ? st.p2Status : '-',
    true
  );
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
  const p2Opened = Boolean(teacherState && teacherState.round2OpenedToday);
  const viewMode = p2Opened ? activeRosterRoundView : 'P1';
  updateTeacherRoundSegmentedControlUI();

  const suspectMap = detectCoCheckInSuspects(list);
  const suspectIds = Object.keys(suspectMap);

  // Update quick filter tab counters based on the active view (P1, P2, or Final)
  const countAll = list.length;
  const countPresent = list.filter(s => {
    const stCode = getStudentStatusForRoundView(s, viewMode, p2Opened);
    return stCode === 'P' || stCode === 'L';
  }).length;
  const countAbsent = list.filter(s => {
    const stCode = getStudentStatusForRoundView(s, viewMode, p2Opened);
    return !stCode || stCode === '-';
  }).length;
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
    const stCode = getStudentStatusForRoundView(s, viewMode, p2Opened);
    if (activeRosterFilter === 'PRESENT') return stCode === 'P' || stCode === 'L';
    if (activeRosterFilter === 'ABSENT') return !stCode || stCode === '-';
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

  const nowPulseTs = Date.now();
  const activePulse = (lastPulsedManualMark && !lastPulsedManualMark.dayKey && nowPulseTs < lastPulsedManualMark.expiresAt)
    ? lastPulsedManualMark
    : null;

  function formatRoundTimeAndSourceBadge(statusVal, rawTime, rawDist, rawSource) {
    if (!statusVal || statusVal === '-') return { cleanTime: '', badgeText: '' };
    const cleanTime = cleanRosterTimeStr(rawTime);
    const isManual = String(rawSource || '').toUpperCase() === 'TEACHER_MANUAL';
    if (isManual) {
      return { cleanTime: cleanTime, badgeText: '(m)' };
    }
    const hasDist =
      (statusVal === 'P' || statusVal === 'L') &&
      rawDist !== '' &&
      rawDist !== null &&
      rawDist !== undefined &&
      String(rawDist).trim() !== '' &&
      !isNaN(Number(rawDist));
    const badgeText = hasDist ? `(${Math.round(Number(rawDist))}m)` : '';
    return { cleanTime: cleanTime, badgeText: badgeText };
  }

  function formatCompactRoundDetailPart(roundLabel, statusVal, rawTime, rawDist, rawSource) {
    const stNorm = normalizeAttendanceStatusCode(statusVal);
    if (stNorm === '-') return `${roundLabel}: -`;
    const meta = formatRoundTimeAndSourceBadge(stNorm, rawTime, rawDist, rawSource);
    const timePart = meta.cleanTime ? ` ${meta.cleanTime}` : '';
    const srcPart = meta.badgeText ? ` ${meta.badgeText}` : '';
    return `${roundLabel}: ${stNorm}${timePart}${srcPart}`;
  }

  const isFinalReadOnly = Boolean(p2Opened && viewMode === 'FINAL');
  const readOnlyTitle = isEn
    ? 'Final Result tab is read-only. Switch to Round 1 or Round 2 tab to mark manually.'
    : 'Tab Kết quả cuối chỉ để xem. Chuyển sang tab Phiên 1 hoặc Phiên 2 để chấm tay.';

  container.innerHTML = filtered.map(st => {
    const suspectNote = suspectMap[st.studentId];
    const isDuplicateName = (nameCounts[String(st.fullName || '').trim().toLowerCase()] || 0) > 1;
    const maskedTail = isDuplicateName && st.studentId ? ` (***${String(st.studentId).slice(-3)})` : '';

    const rowSt = getStudentStatusForRoundView(st, viewMode, p2Opened);
    let cleanTime = '';
    let badgeText = '';
    let inlineP2DetailHtml = '';

    if (!p2Opened || viewMode === 'P1') {
      const p1Time = st.p1Time !== undefined ? st.p1Time : st.time;
      const p1Dist = st.p1Distance !== undefined ? st.p1Distance : st.distance;
      const p1Src = st.p1Source !== undefined ? st.p1Source : st.source;
      const meta = formatRoundTimeAndSourceBadge(rowSt, p1Time, p1Dist, p1Src);
      cleanTime = meta.cleanTime;
      badgeText = meta.badgeText;
    } else if (viewMode === 'P2') {
      const meta = formatRoundTimeAndSourceBadge(rowSt, st.p2Time, st.p2Distance, st.p2Source);
      cleanTime = meta.cleanTime;
      badgeText = meta.badgeText;
    } else {
      // FINAL view: clean row by default; clicking student info toggles P1 | P2 breakdown
      if (expandedP2DetailStudentIds[st.studentId]) {
        const p1Part = formatCompactRoundDetailPart(
          'P1',
          st.p1Status !== undefined ? st.p1Status : st.status,
          st.p1Time !== undefined ? st.p1Time : st.time,
          st.p1Distance !== undefined ? st.p1Distance : st.distance,
          st.p1Source !== undefined ? st.p1Source : st.source
        );
        const p2Part = formatCompactRoundDetailPart(
          'P2',
          st.p2Status !== undefined ? st.p2Status : '-',
          st.p2Time,
          st.p2Distance,
          st.p2Source
        );
        inlineP2DetailHtml = `<span class="roster-p2-detail-inline">${escapeHtml(p1Part)} | ${escapeHtml(p2Part)}</span>`;
      }
    }

    const isRowPulsing = Boolean(activePulse && activePulse.studentId === st.studentId);
    const pulseP = isRowPulsing && activePulse.status === 'P' ? 'mark-pulse-P' : '';
    const pulseL = isRowPulsing && activePulse.status === 'L' ? 'mark-pulse-L' : '';
    const pulseE = isRowPulsing && activePulse.status === 'E' ? 'mark-pulse-E' : '';
    const pulseDash = isRowPulsing && activePulse.status === '-' ? 'mark-pulse-dash' : '';
    const safeSid = escapeHtml(st.studentId);
    const targetRoundArg = !p2Opened ? 'P1' : viewMode;
    const disabledAttr = isFinalReadOnly ? 'disabled' : '';
    const readOnlyClass = isFinalReadOnly ? 'btn-mark-readonly' : '';

    return `
      <div class="roster-item ${suspectNote ? 'suspect-row' : ''}">
        <div class="roster-student-info ${p2Opened ? 'roster-info-clickable' : ''}" ${p2Opened ? `onclick="toggleStudentRowP2Detail('${safeSid}')"` : ''}>
          <strong title="MSSV: ${safeSid}">${escapeHtml(st.fullName)}${escapeHtml(maskedTail)}</strong>
          ${cleanTime ? `<span style="font-size:0.75rem; color:var(--muted); font-family:var(--font-mono);">${escapeHtml(cleanTime)}</span>` : ''}
          ${badgeText ? `<span style="font-size:0.74rem; color:#0f766e; font-weight:600; font-family:var(--font-mono);">${escapeHtml(badgeText)}</span>` : ''}
          ${inlineP2DetailHtml}
          ${suspectNote ? `<span class="suspect-tag">[${isEn ? 'SUSPECT' : 'NGHI VẤN'}] ${escapeHtml(suspectNote)}</span>` : ''}
        </div>
        <div class="roster-actions">
          <button type="button" class="btn btn-outline btn-sm ${rowSt === 'P' ? 'btn-mark-active-P' : ''} ${readOnlyClass} ${pulseP}" ${disabledAttr} title="${isFinalReadOnly ? escapeHtml(readOnlyTitle) : (isEn ? 'Mark Present (P)' : 'Đánh dấu Có mặt (P)')}" onclick="teacherManualMark('${safeSid}','P','${targetRoundArg}')">P</button>
          <button type="button" class="btn btn-outline btn-sm ${rowSt === 'L' ? 'btn-mark-active-L' : ''} ${readOnlyClass} ${pulseL}" ${disabledAttr} title="${isFinalReadOnly ? escapeHtml(readOnlyTitle) : (isEn ? 'Mark Late (L)' : 'Đánh dấu Đi trễ (L)')}" onclick="teacherManualMark('${safeSid}','L','${targetRoundArg}')">L</button>
          <button type="button" class="btn btn-outline btn-sm ${rowSt === 'E' ? 'btn-mark-active-E' : ''} ${readOnlyClass} ${pulseE}" ${disabledAttr} title="${isFinalReadOnly ? escapeHtml(readOnlyTitle) : (isEn ? 'Mark Excused (E)' : 'Đánh dấu Có phép (E)')}" onclick="teacherManualMark('${safeSid}','E','${targetRoundArg}')">E</button>
          <button type="button" class="btn btn-outline btn-sm ${rowSt === '-' && isFinalReadOnly ? 'btn-mark-active--' : ''} ${readOnlyClass} ${pulseDash}" ${disabledAttr} title="${isFinalReadOnly ? escapeHtml(readOnlyTitle) : (isEn ? 'Revoke attendance (-)' : 'Hủy điểm danh (-)')}" onclick="teacherManualMark('${safeSid}','-','${targetRoundArg}')">-</button>
          <button type="button" id="btn-unlock-${safeSid}" class="btn btn-outline btn-sm" title="${isEn ? 'Reset device lock' : 'Đặt lại khóa thiết bị'}" onclick="teacherResetStudentDevice('${safeSid}', this)">${isEn ? 'Unlock' : 'Mở khóa'}</button>
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
    const p2Opened = Boolean(teacherState && teacherState.round2OpenedToday);
    if (p2Opened && activeRosterRoundView === 'FINAL') {
      showStatus(formatServerMessage('ERR_FINAL_READ_ONLY'), 'warn', 'tea-session-inline-status');
      return;
    }
    searchInput.value = '';
    await teacherManualMark(target.studentId, 'P', p2Opened ? activeRosterRoundView : 'P1');
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

async function copyPresentStudentsList() {
  const list = (teacherState && teacherState.roster) || [];
  const p2Opened = Boolean(teacherState && teacherState.round2OpenedToday);
  const presentPool = typeof getFinalPresentStudentsPool === 'function'
    ? getFinalPresentStudentsPool(list, p2Opened)
    : list.filter(s => s.status === 'P' || s.status === 'L');
  const isEn = currentLang === 'en';

  if (presentPool.length === 0) {
    showStatus(
      isEn ? 'No present (P/L) students to copy yet.' : 'Chưa có sinh viên nào có mặt (P/L) để sao chép.',
      'warn',
      'tea-session-inline-status'
    );
    return '';
  }

  const lines = presentPool.map((st, idx) => {
    const finalSt = typeof getStudentEffectiveFinalStatus === 'function'
      ? getStudentEffectiveFinalStatus(st, p2Opened)
      : (st.status || 'P');
    return `${idx + 1}. ${st.studentId} - ${st.fullName} (${finalSt})`;
  });
  const textOut = lines.join('\n');

  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(textOut);
    }
  } catch (e) {}

  if (typeof pulseButtonConfirm === 'function') {
    pulseButtonConfirm(
      'btn-copy-present-list',
      isEn ? `COPIED (${presentPool.length})` : `ĐÃ CHÉP (${presentPool.length})`,
      'success',
      1200
    );
  }
  showStatus(
    isEn
      ? `Copied ${presentPool.length} present/late (P/L) students from Final Result.`
      : `Đã sao chép danh sách ${presentPool.length} sinh viên có mặt/đi trễ (P/L) theo Kết quả cuối.`,
    'success',
    'tea-session-inline-status'
  );
  return textOut;
}

function triggerRandomSpotCheck() {
  const list = (teacherState && teacherState.roster) || [];
  const p2Opened = Boolean(teacherState && teacherState.round2OpenedToday);
  const checkedIn = typeof getFinalPresentStudentsPool === 'function'
    ? getFinalPresentStudentsPool(list, p2Opened)
    : list.filter(s => s.status === 'P' || s.status === 'L');
  const isEn = currentLang === 'en';
  if (checkedIn.length === 0) {
    showStatus(
      isEn ? 'No students have checked in during this session yet.' : 'Chưa có sinh viên nào có mặt (P/L) trong buổi này.',
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
  const effectiveStatus = typeof getStudentEffectiveFinalStatus === 'function'
    ? getStudentEffectiveFinalStatus(pick, p2Opened)
    : pick.status;
  const displayTime = p2Opened ? (pick.p2Time || pick.p1Time || pick.time || 'N/A') : (pick.time || 'N/A');

  const htmlBody = `
    <div style="text-align:center; padding:10px 4px;">
      <div style="font-size:0.76rem; font-weight:600; color:var(--muted); text-transform:uppercase; letter-spacing:0.04em; margin-bottom:6px;">
        ${isEn ? `Called ${calledCount} / ${totalPresent} present students` : `Lượt gọi ${calledCount} / ${totalPresent} sinh viên có mặt`}
      </div>
      <div style="font-size:1.35rem; font-weight:800; color:var(--primary); line-height:1.3; margin-bottom:6px;">
        ${escapeHtml(displayName)}
      </div>
      <div style="font-size:0.8rem; color:var(--text-secondary); font-family:var(--font-mono);">
        ${isEn ? `Final Status: ${effectiveStatus} • Checked in at: ${displayTime}` : `Kết quả: ${effectiveStatus} • Điểm danh lúc: ${displayTime}`}
      </div>
    </div>
  `;

  openAppModal(
    isEn ? 'Random Student Call' : 'Gọi Sinh viên Ngẫu nhiên',
    '',
    isEn ? 'Revoke & Lock (-)' : 'Hủy & Khóa (-)',
    async () => {
      if (typeof pulseButtonConfirm === 'function') {
        await pulseButtonConfirm('app-modal-confirm', isEn ? 'REVOKED' : 'ĐÃ HỦY ĐIỂM DANH', 'danger', 480);
      }
      closeAppModal();
      await teacherManualMark(pick.studentId, '-', p2Opened ? 'P2' : 'P1');
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
      keepOpenOnConfirm: true,
      keepOpenOnExtra: true,
      onExtra: () => {
        if (typeof pulseButtonConfirm === 'function') {
          pulseButtonConfirm('app-modal-extra', '', 'neutral', 380);
        }
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
  const rawHist = (st && st.attendanceStats && Array.isArray(st.attendanceStats.history))
    ? st.attendanceStats.history.slice()
    : [];

  const activeCfg = (teacherState && Array.isArray(teacherState.classes))
    ? teacherState.classes.find(c => c && c.classId === selectedTeacherClassId)
    : null;
  const courseDates = (selectedTeacherClassId && typeof getClassCourseSessionDates === 'function')
    ? getClassCourseSessionDates(selectedTeacherClassId, activeCfg ? activeCfg.scheduleInfo : null)
    : [];
  const allowedSheetSet = new Set(courseDates.map(cd => cd.dayKey));
  const hasSheetSchedule = allowedSheetSet.size > 0;

  const ses = teacherState && teacherState.activeSession;
  const isSesOpen = Boolean(ses && ses.isOpen);
  const activeMeta = deriveActiveSessionDayMeta();
  const openDayKey = (isSesOpen && activeMeta) ? activeMeta.dayKey : '';

  const hist = hasSheetSchedule
    ? rawHist.filter(h => h && h.dayKey && (allowedSheetSet.has(h.dayKey) || h.dayKey === openDayKey))
    : rawHist;

  if (activeMeta && activeMeta.dayKey) {
    const isAllowed = isSesOpen || !hasSheetSchedule || allowedSheetSet.has(activeMeta.dayKey);
    if (isAllowed) {
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
  }
  return hist;
}

let historyModalCalendarYear = new Date().getFullYear();
let historyModalCalendarMonth = new Date().getMonth() + 1;
let historyModalSelectedDayKey = '';

function collectClassSessionDaysFromRoster() {
  const list = (teacherState && teacherState.roster) || [];
  const dayMap = {};
  list.forEach(st => {
    const hist = getEffectiveStudentHistory(st);
    hist.forEach(h => {
      if (!h || !h.dayKey) return;
      if (!dayMap[h.dayKey]) {
        const mIso = String(h.dayKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
        const shortDate = mIso ? `${mIso[3]}/${mIso[2]}` : (h.date || h.dayKey).slice(0, 5);
        dayMap[h.dayKey] = {
          dayKey: h.dayKey,
          date: h.date || h.dayKey,
          shortDate: shortDate,
          label: h.label || '',
          sessionId: h.sessionId || '',
          P: 0,
          L: 0,
          E: 0,
          A: 0,
          total: 0
        };
      }
      const dObj = dayMap[h.dayKey];
      const curSt = h.status === 'OPEN' ? '-' : (h.status || '-');
      dObj.total++;
      if (curSt === 'P') dObj.P++;
      else if (curSt === 'L') dObj.L++;
      else if (curSt === 'E') dObj.E++;
      else dObj.A++;
    });
  });
  return Object.values(dayMap).sort((a, b) => b.dayKey.localeCompare(a.dayKey));
}

function renderTeacherCourseProgressStrip(activeCfg, ses) {
  const stripEl = document.getElementById('tea-course-progress-strip');
  if (!stripEl) return;

  if (!activeCfg || !activeCfg.classId) {
    stripEl.classList.add('hidden');
    stripEl.innerHTML = '';
    return;
  }

  const isEn = currentLang === 'en';
  const recordedDays = collectClassSessionDaysFromRoster();
  const recordedMap = {};
  recordedDays.forEach(d => {
    recordedMap[d.dayKey] = d;
  });

  const activeMeta = (ses && ses.isOpen) ? deriveActiveSessionDayMeta() : null;
  const openDayKey = activeMeta ? activeMeta.dayKey : '';

  const courseSchedule = typeof getClassCourseSessionDates === 'function'
    ? getClassCourseSessionDates(activeCfg.classId, activeCfg.scheduleInfo)
    : [];

  const mergedByKey = {};
  courseSchedule.forEach(item => {
    mergedByKey[item.dayKey] = {
      dayKey: item.dayKey,
      displayDate: item.displayDate,
      shortDate: item.shortDate,
      isScheduled: true,
      recorded: recordedMap[item.dayKey] || null
    };
  });

  // Only merge non-sheet dates if the class has no Sheet schedule OR if the session is currently open right now
  recordedDays.forEach(rec => {
    if (!mergedByKey[rec.dayKey] && (courseSchedule.length === 0 || rec.dayKey === openDayKey)) {
      mergedByKey[rec.dayKey] = {
        dayKey: rec.dayKey,
        displayDate: rec.date,
        shortDate: rec.shortDate,
        isScheduled: false,
        recorded: rec
      };
    }
  });

  const allSessionItems = Object.values(mergedByKey).sort((a, b) => a.dayKey.localeCompare(b.dayKey));
  if (allSessionItems.length === 0) {
    stripEl.classList.add('hidden');
    stripEl.innerHTML = '';
    return;
  }

  const todayKey = getTodayDateKey();
  let completedCount = 0;
  let activeOrUpcomingCount = 0;

  allSessionItems.forEach((item) => {
    item.isOpenNow = (item.dayKey === openDayKey);
    item.isDone = Boolean(item.recorded) && !item.isOpenNow;
    item.isSkippedPast = !item.isDone && !item.isOpenNow && item.dayKey < todayKey;
    item.isMakeUp = Boolean(item.recorded) && !item.isScheduled && courseSchedule.length > 0;

    if (item.isSkippedPast) {
      item.sessionNumber = null;
    } else {
      activeOrUpcomingCount++;
      item.sessionNumber = activeOrUpcomingCount;
    }

    if (item.isDone || item.isOpenNow) {
      completedCount++;
    }
  });

  const totalSessions = Math.max(completedCount, activeOrUpcomingCount);
  const pct = totalSessions > 0 ? Math.min(100, Math.round((completedCount / totalSessions) * 100)) : 0;

  stripEl.innerHTML = `
    <div class="course-progress-header">
      <div class="course-progress-title">
        <span>${isEn ? 'Course Progress:' : 'Tiến độ học phần:'} <strong>${completedCount} / ${totalSessions}</strong> ${isEn ? 'sessions' : 'buổi'}</span>
        <div class="course-progress-bar-track">
          <div class="course-progress-bar-fill" style="width:${pct}%;"></div>
        </div>
      </div>
    </div>
  `;
  stripEl.classList.remove('hidden');
}

function refreshHistoryModalDateOptionsIfNeeded() {
  const days = collectClassSessionDaysFromRoster();
  if (days.length === 0) return;

  const hasCurrent = Boolean(historyModalSelectedDayKey) && days.some(d => d.dayKey === historyModalSelectedDayKey);
  if (!hasCurrent) {
    historyModalSelectedDayKey = days[0].dayKey;
  }
}

function openAttendanceHistoryManagerModal(initialDayKey) {
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
  const hasInitial = initialDayKey && days.some(d => d.dayKey === initialDayKey);
  const defaultDayKey = hasInitial ? initialDayKey : (days.length > 0 ? days[0].dayKey : 'ALL');
  historyModalSelectedDayKey = defaultDayKey;

  const refKey = defaultDayKey !== 'ALL' ? defaultDayKey : (days.length > 0 ? days[0].dayKey : getTodayDateKey());
  const mRef = String(refKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (mRef) {
    historyModalCalendarYear = parseInt(mRef[1], 10);
    historyModalCalendarMonth = parseInt(mRef[2], 10);
  } else {
    const now = new Date();
    historyModalCalendarYear = now.getFullYear();
    historyModalCalendarMonth = now.getMonth() + 1;
  }

  const htmlBody = `
    <div id="hist-calendar-box" class="hist-calendar-card"></div>
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:10px;">
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <input type="text" id="inp-hist-search" oninput="renderHistoryModalList()" placeholder="${isEn ? 'Search student name or ID...' : 'Tìm họ tên hoặc MSSV...'}" style="margin-bottom:0; padding:7px 10px; flex:1; min-width:180px;" />
      </div>
      <div id="hist-selected-day-summary" class="hist-day-summary-bar"></div>
    </div>
    <div id="hist-modal-rows" class="past-ses-list"></div>
  `;

  openAppModal(
    isEn ? `Attendance Calendar & History — ${selectedTeacherClassId}` : `Lịch Điểm Danh & Lịch Sử — ${selectedTeacherClassId}`,
    '',
    '',
    null,
    {
      wide: true,
      htmlBody: htmlBody,
      hideConfirm: true
    }
  );

  renderHistoryCalendarWidget();
  renderHistoryModalList();

  // If full attendanceStats history was not yet loaded in cache, trigger a fresh sync in the background
  if (!list[0] || !list[0].attendanceStats || !Array.isArray(list[0].attendanceStats.history)) {
    refreshTeacherState(true);
  }
}

function onHistorySelectDateDropdownChange() {
  if (historyModalSelectedDayKey && historyModalSelectedDayKey !== 'ALL') {
    const m = String(historyModalSelectedDayKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      historyModalCalendarYear = parseInt(m[1], 10);
      historyModalCalendarMonth = parseInt(m[2], 10);
    }
  }
  renderHistoryCalendarWidget();
  renderHistoryModalList();
}

function changeHistoryCalendarMonth(delta) {
  let m = historyModalCalendarMonth + Number(delta || 0);
  let y = historyModalCalendarYear;
  if (m < 1) {
    m = 12;
    y--;
  } else if (m > 12) {
    m = 1;
    y++;
  }
  historyModalCalendarYear = y;
  historyModalCalendarMonth = m;
  renderHistoryCalendarWidget();
}

function selectHistoryCalendarDay(dayKey) {
  historyModalSelectedDayKey = dayKey || 'ALL';
  if (dayKey && dayKey !== 'ALL') {
    const m = String(dayKey).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) {
      historyModalCalendarYear = parseInt(m[1], 10);
      historyModalCalendarMonth = parseInt(m[2], 10);
    }
  }
  renderHistoryCalendarWidget();
  renderHistoryModalList();
}

function renderHistoryCalendarWidget() {
  const calBox = document.getElementById('hist-calendar-box');
  if (!calBox) return;

  const isEn = currentLang === 'en';
  const selectedDayKey = historyModalSelectedDayKey || 'ALL';

  const days = collectClassSessionDaysFromRoster();
  const recordedMap = {};
  days.forEach(d => {
    recordedMap[d.dayKey] = d;
  });

  const activeCfg = (teacherState && Array.isArray(teacherState.classes))
    ? teacherState.classes.find(c => c && c.classId === selectedTeacherClassId)
    : null;
  const courseDates = typeof getClassCourseSessionDates === 'function'
    ? getClassCourseSessionDates(selectedTeacherClassId, activeCfg ? activeCfg.scheduleInfo : null)
    : [];
  const scheduledMap = {};
  courseDates.forEach(cd => {
    scheduledMap[cd.dayKey] = cd;
  });

  const activeMeta = (teacherState && teacherState.activeSession && teacherState.activeSession.isOpen)
    ? deriveActiveSessionDayMeta()
    : null;
  const openDayKey = activeMeta ? activeMeta.dayKey : '';
  const todayKey = getTodayDateKey();

  // Compute dynamic session numbers across both scheduled and make-up sessions
  const allKeysMap = {};
  courseDates.forEach(cd => { allKeysMap[cd.dayKey] = true; });
  days.forEach(d => { allKeysMap[d.dayKey] = true; });
  const sortedAllKeys = Object.keys(allKeysMap).sort((a, b) => a.localeCompare(b));
  const dynamicSesNumByDay = {};
  let runningSesNum = 0;
  sortedAllKeys.forEach(k => {
    const hasRec = Boolean(recordedMap[k]) || (k === openDayKey);
    const isSkippedPast = !hasRec && k < todayKey;
    if (!isSkippedPast) {
      runningSesNum++;
      dynamicSesNumByDay[k] = runningSesNum;
    }
  });

  const yr = historyModalCalendarYear;
  const mo = historyModalCalendarMonth;
  const monthNamesVi = ['Tháng 01', 'Tháng 02', 'Tháng 03', 'Tháng 04', 'Tháng 05', 'Tháng 06', 'Tháng 07', 'Tháng 08', 'Tháng 09', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
  const monthNamesEn = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const monthTitle = isEn ? `${monthNamesEn[mo - 1]} ${yr}` : `${monthNamesVi[mo - 1]} / ${yr}`;

  const weekdays = isEn ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] : ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
  const weekdayHeaderHtml = weekdays.map(w => `<div class="hist-cal-weekday">${w}</div>`).join('');

  const firstDate = new Date(yr, mo - 1, 1);
  const daysInMonth = new Date(yr, mo, 0).getDate();
  // Convert Sunday (0) .. Saturday (6) to Monday-first (0..6)
  const startOffset = (firstDate.getDay() + 6) % 7;

  const cells = [];
  for (let i = 0; i < startOffset; i++) {
    cells.push(`<div class="hist-cal-cell cal-empty"></div>`);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const dd = String(d).padStart(2, '0');
    const mm = String(mo).padStart(2, '0');
    const dayKey = `${yr}-${mm}-${dd}`;
    const rec = recordedMap[dayKey] || null;
    const sched = scheduledMap[dayKey] || null;
    const isSelected = (selectedDayKey === dayKey);
    const isOpenNow = (dayKey === openDayKey);
    const sesNum = dynamicSesNumByDay[dayKey] || (sched ? sched.sessionNumber : null);

    if (rec || isOpenNow) {
      const pPlusL = rec ? (rec.P + rec.L) : 0;
      const tot = rec ? rec.total : 0;
      const dotClass = isOpenNow ? 'chip-dot dot-open' : 'chip-dot dot-done';
      const cellClass = [
        'hist-cal-cell',
        isOpenNow ? 'cal-day-open' : 'cal-day-done',
        isSelected ? 'cal-day-selected' : ''
      ].filter(Boolean).join(' ');
      cells.push(`
        <button type="button" class="${cellClass}" onclick="selectHistoryCalendarDay('${dayKey}')" title="${isEn ? `Session B${sesNum || ''} (${dayKey}): ${pPlusL}/${tot} Present` : `Buổi B${sesNum || ''} (${dd}/${mm}/${yr}): Có mặt ${pPlusL}/${tot}`}">
          <div class="cal-day-top">
            <span class="cal-day-num">${d}</span>
            <span class="${dotClass}"></span>
          </div>
          <div class="cal-day-meta">${pPlusL}/${tot}</div>
        </button>
      `);
    } else if (sched) {
      const isPastOff = dayKey < todayKey;
      if (isPastOff) {
        cells.push(`
          <div class="hist-cal-cell cal-day-skipped" title="${isEn ? `No session opened on ${sched.displayDate} (Holiday / Rescheduled)` : `Ngày ${sched.displayDate} không mở điểm danh (Nghỉ lễ / Đổi lịch dạy bù)`}">
            <div class="cal-day-top">
              <span class="cal-day-num">${d}</span>
              <span class="chip-dot dot-skipped"></span>
            </div>
            <div class="cal-day-meta">${isEn ? 'Off' : 'Nghỉ'}</div>
          </div>
        `);
      } else {
        cells.push(`
          <div class="hist-cal-cell cal-day-scheduled" title="${isEn ? `Scheduled Session #${sesNum} (${sched.displayDate})` : `Lịch học Buổi ${sesNum} (${sched.displayDate}) — Chưa mở phiên`}">
            <div class="cal-day-top">
              <span class="cal-day-num">${d}</span>
              <span class="chip-dot dot-upcoming"></span>
            </div>
            <div class="cal-day-meta">B${sesNum}</div>
          </div>
        `);
      }
    } else {
      cells.push(`
        <div class="hist-cal-cell">
          <div class="cal-day-top"><span class="cal-day-num">${d}</span></div>
        </div>
      `);
    }
  }

  calBox.innerHTML = `
    <div class="hist-cal-toolbar">
      <div class="hist-cal-nav">
        <button type="button" class="btn btn-outline btn-sm hist-cal-nav-btn" onclick="changeHistoryCalendarMonth(-1)">◀</button>
        <span class="hist-cal-month-title">${escapeHtml(monthTitle)}</span>
        <button type="button" class="btn btn-outline btn-sm hist-cal-nav-btn" onclick="changeHistoryCalendarMonth(1)">▶</button>
      </div>
      <div class="hist-cal-legend">
        <span><span class="chip-dot dot-done"></span>${isEn ? 'Attended' : 'Đã điểm danh'}</span>
        <span><span class="chip-dot dot-upcoming"></span>${isEn ? 'Scheduled' : 'Lịch sắp tới'}</span>
      </div>
    </div>
    <div class="hist-cal-grid">
      ${weekdayHeaderHtml}
      ${cells.join('')}
    </div>
  `;
}

function renderHistoryModalList() {
  const container = document.getElementById('hist-modal-rows');
  if (!container) return;
  const isEn = currentLang === 'en';
  const searchEl = document.getElementById('inp-hist-search');
  const summaryBar = document.getElementById('hist-selected-day-summary');
  const selectedDayKey = historyModalSelectedDayKey || 'ALL';
  const query = searchEl ? searchEl.value.trim().toLowerCase() : '';

  const list = (teacherState && teacherState.roster) || [];
  const days = collectClassSessionDaysFromRoster();
  if (days.length === 0) {
    if (summaryBar) summaryBar.innerHTML = '';
    container.innerHTML = `<div style="padding:12px 0; color:var(--muted); font-size:0.82rem; text-align:center;">${isEn ? 'No attendance sessions recorded for this class yet.' : 'Lớp học phần này chưa có lịch sử buổi điểm danh nào.'}</div>`;
    return;
  }

  if (summaryBar) {
    if (selectedDayKey !== 'ALL') {
      const dObj = days.find(d => d.dayKey === selectedDayKey);
      if (dObj) {
        summaryBar.innerHTML = `
          <span><strong>${escapeHtml(dObj.date)}</strong></span>
          <span>${isEn ? 'Present' : 'Có mặt'} (P): <strong style="color:var(--ok-text);">${dObj.P}</strong></span>
          <span>${isEn ? 'Late' : 'Đi trễ'} (L): <strong style="color:var(--warn-text);">${dObj.L}</strong></span>
          <span>${isEn ? 'Excused' : 'Có phép'} (E): <strong style="color:#c2410c;">${dObj.E}</strong></span>
          <span>${isEn ? 'Absent' : 'Vắng'} (-): <strong style="color:var(--err-text);">${dObj.A}</strong></span>
        `;
        summaryBar.classList.remove('hidden');
      } else {
        summaryBar.classList.add('hidden');
      }
    } else {
      summaryBar.innerHTML = `
        <span><strong>${isEn ? `Showing all ${days.length} completed sessions` : `Đang hiển thị tất cả ${days.length} buổi đã điểm danh`}</strong></span>
      `;
      summaryBar.classList.remove('hidden');
    }
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

  const nowHistPulseTs = Date.now();
  const activeHistPulse = (lastPulsedManualMark && lastPulsedManualMark.dayKey && nowHistPulseTs < lastPulsedManualMark.expiresAt)
    ? lastPulsedManualMark
    : null;

  container.innerHTML = items.map(item => {
    const rowDomId = `${escapeHtml(item.studentId)}_${escapeHtml(item.dayKey)}`;
    const safeSid = escapeHtml(item.studentId);
    const safeName = escapeHtml(item.fullName);
    const safeDayKey = escapeHtml(item.dayKey);
    const safeDate = escapeHtml(item.date);
    const safeSesId = escapeHtml(item.sessionId);
    const curSt = item.status;
    const isHistRowPulsing = Boolean(
      activeHistPulse &&
      activeHistPulse.studentId === item.studentId &&
      activeHistPulse.dayKey === item.dayKey
    );
    const hPulseP = isHistRowPulsing && activeHistPulse.status === 'P' ? 'mark-pulse-P' : '';
    const hPulseL = isHistRowPulsing && activeHistPulse.status === 'L' ? 'mark-pulse-L' : '';
    const hPulseE = isHistRowPulsing && activeHistPulse.status === 'E' ? 'mark-pulse-E' : '';
    const hPulseDash = isHistRowPulsing && activeHistPulse.status === '-' ? 'mark-pulse-dash' : '';

    return `
      <div class="past-ses-row" id="past-row-${rowDomId}">
        <div class="past-ses-row-main">
          <div>
            <strong>${safeName}</strong>
            <span style="font-size:0.75rem; color:var(--muted); margin-left:6px; font-family:var(--font-mono);">${safeDate}</span>
            <span id="past-pill-${rowDomId}" class="status-pill st-${curSt}" style="margin-left:6px;">${escapeHtml(curSt)}</span>
          </div>
          <div style="display:flex; gap:4px;">
            <button type="button" class="btn btn-outline btn-sm ${curSt === 'P' ? 'btn-mark-active-P' : ''} ${hPulseP}" onclick="promptPastSessionConfirm('${safeSid}','${safeName}','${safeDayKey}','${safeDate}','${safeSesId}','${curSt}','P')">P</button>
            <button type="button" class="btn btn-outline btn-sm ${curSt === 'L' ? 'btn-mark-active-L' : ''} ${hPulseL}" onclick="promptPastSessionConfirm('${safeSid}','${safeName}','${safeDayKey}','${safeDate}','${safeSesId}','${curSt}','L')">L</button>
            <button type="button" class="btn btn-outline btn-sm ${curSt === 'E' ? 'btn-mark-active-E' : ''} ${hPulseE}" onclick="promptPastSessionConfirm('${safeSid}','${safeName}','${safeDayKey}','${safeDate}','${safeSesId}','${curSt}','E')">E</button>
            <button type="button" class="btn btn-outline btn-sm ${curSt === '-' ? 'btn-mark-active--' : ''} ${hPulseDash}" onclick="promptPastSessionConfirm('${safeSid}','${safeName}','${safeDayKey}','${safeDate}','${safeSesId}','${curSt}','-')">-</button>
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

  lastPulsedManualMark = {
    studentId: studentId,
    status: newStatus,
    dayKey: dayKey,
    expiresAt: Date.now() + 680
  };
  if (navigator.vibrate) {
    try {
      navigator.vibrate(newStatus === 'L' ? [35, 45, 35] : 25);
    } catch (e) {}
  }

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
  renderHistoryCalendarWidget();
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
    renderHistoryCalendarWidget();
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
  const p2Opened = Boolean(teacherState && teacherState.round2OpenedToday);
  const presentStudents = typeof getFinalPresentStudentsPool === 'function'
    ? getFinalPresentStudentsPool(list, p2Opened)
    : list.filter(s => s.status === 'P' || s.status === 'L');
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
      if (typeof pulseButtonConfirm === 'function') {
        await pulseButtonConfirm('app-modal-confirm', isEn ? 'GROUPS SENT' : 'ĐÃ GỬI NHÓM', 'success', 480);
      }
      closeAppModal();
      await publishClassroomGroupsToStudents(false);
    },
    {
      wide: true,
      htmlBody: htmlBody,
      extraLabel: isEn ? 'Reshuffle' : 'Trộn lại',
      extraClass: 'btn btn-outline',
      keepOpenOnConfirm: true,
      keepOpenOnExtra: true,
      onExtra: () => {
        if (typeof pulseButtonConfirm === 'function') {
          pulseButtonConfirm('app-modal-extra', '', 'neutral', 380);
        }
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
  const p2Opened = Boolean(teacherState && teacherState.round2OpenedToday);
  Object.keys(pendingManualMarks).forEach(sid => {
    if (!pendingManualMarks[sid] || now >= pendingManualMarks[sid].expiresAt) {
      delete pendingManualMarks[sid];
    }
  });
  rosterList.forEach(st => {
    const pending = st && pendingManualMarks[st.studentId];
    if (pending && now < pending.expiresAt) {
      const tRound = pending.targetRound || 'P1';
      if (tRound === 'P2') {
        const effP2St = pending.status === 'L' ? 'P' : pending.status;
        st.p2Status = effP2St;
        st.p2Time = pending.time;
        st.p2Distance = pending.distance;
        st.p2Source = 'TEACHER_MANUAL';
      } else {
        st.p1Status = pending.status;
        st.p1Time = pending.time;
        st.p1Distance = pending.distance;
        st.p1Source = 'TEACHER_MANUAL';
      }
      if (p2Opened) {
        st.finalStatus = mergeAttendance(
          st.p1Status !== undefined ? st.p1Status : st.status,
          st.p2Status !== undefined ? st.p2Status : '-',
          true
        );
        st.status = st.finalStatus;
      } else {
        st.status = st.p1Status;
        st.finalStatus = st.p1Status;
        st.time = pending.time;
        st.distance = pending.distance;
        st.source = 'TEACHER_MANUAL';
      }
    }
  });
}

function updateTeacherLiveCountersFromRoster() {
  if (!teacherState || !Array.isArray(teacherState.roster)) return;
  const isEn = currentLang === 'en';
  const roster = selectedTeacherClassId ? teacherState.roster : [];
  const p2Opened = Boolean(teacherState && teacherState.round2OpenedToday);
  const viewMode = p2Opened ? activeRosterRoundView : 'P1';

  const pCount = roster.filter(r => getStudentStatusForRoundView(r, viewMode, p2Opened) === 'P').length;
  const lCount = roster.filter(r => getStudentStatusForRoundView(r, viewMode, p2Opened) === 'L').length;
  const eCount = roster.filter(r => getStudentStatusForRoundView(r, viewMode, p2Opened) === 'E').length;
  const aCount = roster.filter(r => {
    const st = getStudentStatusForRoundView(r, viewMode, p2Opened);
    return !st || st === '-';
  }).length;

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

async function teacherManualMark(studentId, status, explicitTargetRound = '') {
  const auth = getTeacherAuth();
  const classId = document.getElementById('sel-tea-class').value || selectedTeacherClassId;
  if (!auth || !classId) return;
  if (teacherState && !teacherState.activeSession) {
    showStatus(
      currentLang === 'en'
        ? 'No attendance session opened today yet. Please open a session first (or click History to edit a past session).'
        : 'Hôm nay chưa mở phiên điểm danh cho lớp này. Vui lòng mở phiên trước (hoặc bấm nút Lịch sử để sửa buổi học trước).',
      'warn',
      'tea-session-inline-status'
    );
    return;
  }

  const p2Opened = Boolean(teacherState && teacherState.round2OpenedToday);
  const targetRound = String(explicitTargetRound || (p2Opened ? activeRosterRoundView : 'P1')).trim().toUpperCase();

  // Requirement 1: Tab "Kết quả cuối" is strictly READ-ONLY
  if (p2Opened && targetRound === 'FINAL') {
    showStatus(
      formatServerMessage('ERR_FINAL_READ_ONLY'),
      'warn',
      'tea-session-inline-status'
    );
    return;
  }

  // 1. Instant 0.01s Optimistic UI Update (updates only the targeted round P1 or P2, then computes Final via mergeAttendance)
  const nowD = new Date();
  const pad2 = n => String(n).padStart(2, '0');
  const nowTimeStr = `${pad2(nowD.getHours())}:${pad2(nowD.getMinutes())}`;
  let prevSnapshot = null;

  if (teacherState && Array.isArray(teacherState.roster)) {
    const targetRow = teacherState.roster.find(r => r && r.studentId === studentId);
    if (targetRow) {
      prevSnapshot = Object.assign({}, targetRow);
    }
  }

  pendingManualMarks[studentId] = {
    targetRound: targetRound,
    status: status,
    time: status === '-' ? '' : nowTimeStr,
    distance: status === '-' ? '' : 0,
    expiresAt: Date.now() + 10000
  };
  lastPulsedManualMark = {
    studentId: studentId,
    status: status,
    dayKey: '',
    expiresAt: Date.now() + 680
  };
  if (navigator.vibrate) {
    try {
      navigator.vibrate(status === 'L' ? [35, 45, 35] : 25);
    } catch (e) {}
  }

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

  const updatedRow = (teacherState && Array.isArray(teacherState.roster))
    ? teacherState.roster.find(r => r && r.studentId === studentId)
    : null;
  const effectiveFinalStatus = updatedRow
    ? getStudentEffectiveFinalStatus(updatedRow, p2Opened)
    : status;

  const sesKey = (teacherState && teacherState.activeSession && teacherState.activeSession.sessionId)
    ? teacherState.activeSession.sessionId
    : getTodayDateKey();
  if (typeof recordLocalStudentSessionMark === 'function') {
    recordLocalStudentSessionMark(studentId, classId, sesKey, effectiveFinalStatus === '-' ? 'A' : effectiveFinalStatus, effectiveFinalStatus === '-' ? '' : nowTimeStr);
  }
  safeSetLocal('cc_tea_last_preview_mark', JSON.stringify({
    studentId: String(studentId || '').trim().toUpperCase(),
    classId: classId,
    status: effectiveFinalStatus
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
    status: status,
    targetRound: targetRound
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
      res && res.code ? formatServerMessage(res.code, res.params || {}, res.message || '') : (currentLang === 'en' ? 'Error updating status.' : 'Lỗi cập nhật trạng thái.'),
      'err',
      'tea-session-inline-status'
    );
  }
}

async function teacherResetStudentDevice(studentId, btnEl = null) {
  const auth = getTeacherAuth();
  const isEn = currentLang === 'en';
  if (!auth || !studentId) return;
  const targetBtn = btnEl || document.getElementById(`btn-unlock-${studentId}`);
  if (targetBtn && typeof pulseButtonConfirm === 'function') {
    pulseButtonConfirm(targetBtn, isEn ? 'UNLOCKED' : 'ĐÃ MỞ KHÓA', 'success', 1100);
  }
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
      res && res.message ? res.message : (isEn ? 'Unable to unlock device.' : 'Không thể mở khóa thiết bị.'),
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
    const updatedCfg = (res.classes || []).find(c => c && c.classId === classId);
    const isRegOpen = Boolean(updatedCfg && updatedCfg.regOpen);
    if (typeof pulseButtonConfirm === 'function') {
      pulseButtonConfirm(
        'btn-reg-gate-toggle',
        isEn ? `Device Reg: ${isRegOpen ? 'OPEN' : 'LOCKED'}` : `ĐK thiết bị: ${isRegOpen ? 'MỞ' : 'KHÓA'}`,
        isRegOpen ? 'success' : 'warn',
        1100
      );
    }
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
    if (typeof pulseButtonConfirm === 'function') {
      pulseButtonConfirm('btn-tea-rebuild-sheet', isEn ? 'SYNCED' : 'ĐÃ ĐỒNG BỘ', 'success', 1300);
    }
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
