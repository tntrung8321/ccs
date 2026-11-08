/**
 * TDD Test Suite for CCS v3.7.1:
 * 1. Removal of legacy Camera QR Scanner UI/Code & Student Advanced API Box (while preserving Lecturer API Box & Deep Links)
 * 2. Desktop 2-Column Split-View (>= 960px), Enter-to-Login, and Double-Click Floating PIN Spotlight Mode
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../../../..');
const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const scheduleJs = fs.readFileSync(path.join(ROOT, 'js/schedule-config.js'), 'utf8');
const studentJs = fs.readFileSync(path.join(ROOT, 'js/student.js'), 'utf8');
const teacherJs = fs.readFileSync(path.join(ROOT, 'js/teacher.js'), 'utf8');
const stylesCss = fs.readFileSync(path.join(ROOT, 'css/styles.css'), 'utf8');

const mode = process.argv[2] || 'all';

function runTask1Tests() {
  console.log('--- Running Task 1 Tests (QR Removal & Student/Lecturer API Config) ---');

  // 1.1: html5-qrcode CDN script & #ic-qr symbol & #camera-modal-box must be completely removed
  assert.ok(!indexHtml.includes('html5-qrcode'), 'html5-qrcode.min.js script must be removed from index.html');
  assert.ok(!indexHtml.includes('id="ic-qr"'), '#ic-qr SVG symbol must be removed from index.html');
  assert.ok(!indexHtml.includes('id="camera-modal-box"'), '#camera-modal-box must be removed from index.html');
  assert.ok(!indexHtml.includes('id="qr-reader"'), '#qr-reader must be removed from index.html');

  // 1.2: Student advanced API box & QR button must be removed, Lecturer API box must be KEPT
  assert.ok(!indexHtml.includes('id="box-advanced-api"'), 'Student #box-advanced-api must be removed from index.html');
  assert.ok(!indexHtml.includes('id="inp-onboard-api"'), 'Student #inp-onboard-api must be removed from index.html');
  assert.ok(!indexHtml.includes('toggleAdvancedApiBox'), 'toggleAdvancedApiBox must be removed from index.html and student.js');
  assert.ok(!studentJs.includes('toggleAdvancedApiBox'), 'toggleAdvancedApiBox function must be removed from js/student.js');
  assert.ok(!studentJs.includes('inp-onboard-api'), 'inp-onboard-api reference must be removed from js/student.js');
  assert.ok(studentJs.includes('window.customOnboardApiUrl || DEFAULT_LECTURER_API'), 'submitStudentOnboarding must fallback to window.customOnboardApiUrl || DEFAULT_LECTURER_API');

  // Lecturer API configuration must remain intact, without QR scan button
  assert.ok(indexHtml.includes('id="box-tea-api-advanced"'), 'Lecturer #box-tea-api-advanced must be preserved');
  assert.ok(indexHtml.includes('id="inp-tea-api"'), 'Lecturer #inp-tea-api must be preserved');
  assert.ok(!indexHtml.includes('startCameraScanner('), 'Lecturer/Student QR scan buttons must be removed');

  // 1.3: Camera scanner functions and variables must be removed from js/schedule-config.js, while handleUrlDeepLinks remains
  assert.ok(!scheduleJs.includes('html5QrScanner'), 'html5QrScanner must be removed from js/schedule-config.js');
  assert.ok(!scheduleJs.includes('activeScanPurpose'), 'activeScanPurpose must be removed from js/schedule-config.js');
  assert.ok(!scheduleJs.includes('startCameraScanner'), 'startCameraScanner must be removed from js/schedule-config.js');
  assert.ok(!scheduleJs.includes('stopCameraScanner'), 'stopCameraScanner must be removed from js/schedule-config.js');
  assert.ok(!scheduleJs.includes('handleScannedQrText'), 'handleScannedQrText must be removed from js/schedule-config.js');
  assert.ok(scheduleJs.includes('function handleUrlDeepLinks()'), 'handleUrlDeepLinks() must be preserved in js/schedule-config.js');
  assert.ok(scheduleJs.includes('window.customOnboardApiUrl = normApi'), 'handleUrlDeepLinks() must store window.customOnboardApiUrl = normApi');

  // 1.4: #qr-reader CSS must be removed from css/styles.css
  assert.ok(!stylesCss.includes('#qr-reader'), '#qr-reader CSS rule must be removed from css/styles.css');

  console.log('PASS: Task 1 tests passed.');
}

function runTask2Tests() {
  console.log('--- Running Task 2 Tests (Desktop 2-Column Split-View & Floating PIN Spotlight) ---');

  // 2.1: Enter keydown on #inp-tea-token
  assert.ok(
    indexHtml.includes('id="inp-tea-token"') && indexHtml.includes("if(event.key==='Enter'){event.preventDefault();loginTeacher();}"),
    '#inp-tea-token must trigger loginTeacher() on Enter keydown'
  );

  // 2.2: Double-Click Floating PIN Spotlight DOM in index.html
  assert.ok(
    indexHtml.includes('id="tea-p2-pin-projector-box"') && indexHtml.includes('ondblclick="togglePinSpotlightMode(event)"'),
    '#tea-p2-pin-projector-box must bind ondblclick="togglePinSpotlightMode(event)"'
  );
  assert.ok(indexHtml.includes('id="tea-pin-spotlight-meta"'), '#tea-pin-spotlight-meta must exist in index.html');
  assert.ok(indexHtml.includes('id="tea-pin-spot-timer"'), '#tea-pin-spot-timer must exist in index.html');
  assert.ok(indexHtml.includes('id="tea-pin-spot-count"'), '#tea-pin-spot-count must exist in index.html');
  assert.ok(indexHtml.includes('id="tea-pin-spotlight-hint"'), '#tea-pin-spotlight-hint must exist in index.html');

  // 2.3: Spotlight logic in js/teacher.js
  assert.ok(teacherJs.includes('function togglePinSpotlightMode('), 'togglePinSpotlightMode must be defined in js/teacher.js');
  assert.ok(teacherJs.includes('function exitPinSpotlightMode('), 'exitPinSpotlightMode must be defined in js/teacher.js');
  assert.ok(teacherJs.includes('pin-spotlight-active'), 'teacher.js must toggle pin-spotlight-active class');

  // 2.4: Desktop 2-Column Split-View & Spotlight CSS in css/styles.css
  assert.ok(stylesCss.includes('@media (min-width: 960px)'), 'css/styles.css must include @media (min-width: 960px) desktop split-view');
  assert.ok(stylesCss.includes('#main-container:has(#view-teacher:not(.hidden))'), 'css/styles.css must expand #main-container when #view-teacher is active');
  assert.ok(stylesCss.includes('grid-template-columns: 420px minmax(0, 1fr)'), 'css/styles.css must define 2-column grid for #box-teacher-dashboard');
  assert.ok(stylesCss.includes('.p2-projector-pin-card.pin-spotlight-active'), 'css/styles.css must define .p2-projector-pin-card.pin-spotlight-active');

  console.log('PASS: Task 2 tests passed.');
}

if (mode === '--task1') {
  runTask1Tests();
} else if (mode === '--task2') {
  runTask2Tests();
} else {
  runTask1Tests();
  runTask2Tests();
  console.log('ALL v3.7.1 UX & CLEANUP TESTS PASSED!');
}
