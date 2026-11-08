# Complete `v3.7.1` Implementation Plan: QR Code Removal, Desktop 2-Column Split-View & Double-Click Floating PIN Spotlight

> **For agentic workers:** Execute inline (Native) in the main session with a dedicated **Reviewer Subagent (`research`)** after each task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) Completely remove legacy in-app camera QR scanner UI & code (`html5-qrcode`, `startCameraScanner`, `stopCameraScanner`, `handleScannedQrText`, `toggleAdvancedApiBox`, Student `#box-advanced-api`) while keeping Lecturer's `#box-tea-api-advanced` and URL deep-link parsing; (2) Upgrade Lecturer Laptop/PC UX (`>= 960px`) with a 2-column Split-View layout (`1140px`) and `Enter`-to-login; (3) Add **Double-Click Floating PIN Spotlight** (Option A) with dark privacy backdrop and live timer/attendance counters; and (4) Release `v3.7.1` with automated Apps Script deployment via `appscript-deploy`.

**Architecture & Multi-Agent Coordination:**
- **Main Agent (Native Executor):** Implements each task using TDD (writes automated test first $\rightarrow$ watches it fail $\rightarrow$ implements minimal surgical edits $\rightarrow$ watches test pass) and generates `1440x900` visual previews in `/tmp/ccs-demo`.
- **Subagent 1 (`Task 1 Code Reviewer` — `research`):** Audits Task 1 changes across `index.html`, `js/schedule-config.js`, `js/student.js`, and `css/styles.css` to guarantee zero orphaned references to removed QR functions/DOM nodes and intact Lecturer URL config & `?onboard=` / `?pair=` deep links.
- **Subagent 2 (`Task 2 Code Reviewer` — `research`):** Audits Task 2 changes across `index.html`, `js/teacher.js`, and `css/styles.css` for Desktop 2-Column Grid (`>= 960px`), mobile `< 960px` preservation, `#inp-tea-token` `Enter` key, and Floating PIN Spotlight lifecycle (`dblclick`, `Escape`, button `stopPropagation`, auto-exit on session close).
- **Subagent 3 (`Task 3 Release Reviewer` — `research`):** Audits Task 3 version consistency (`3.7.1`), `changelog.md` (EN/VI + Quick Comparison table), and `appscript-deploy` execution.

**Spec:** `docs/superpowers/specs/2026-11-08-desktop-lecturer-ux-and-pin-spotlight-design.md`

---

### Task 1: Remove Legacy Camera QR Scanner UI/Code & Student URL Box (`index.html`, `js/schedule-config.js`, `js/student.js`, `css/styles.css`)

**Files:**
- Modify: `index.html`
- Modify: `js/schedule-config.js`
- Modify: `js/student.js`
- Modify: `css/styles.css`
- Test: `.agent/skills/appscript-deploy/scripts/test-v371-ux.js`

- [ ] **Step 1 (RED): Write automated verification test (`test-v371-ux.js`)**
  - Assert `index.html` has no `html5-qrcode`, `#ic-qr`, `#camera-modal-box`, `#qr-reader`, `#box-advanced-api`, `#inp-onboard-api`, or `startCameraScanner`.
  - Assert `index.html` retains `#box-tea-api-advanced` and `#inp-tea-api` for the Lecturer.
  - Assert `js/schedule-config.js` and `js/student.js` have no `html5QrScanner`, `startCameraScanner`, `stopCameraScanner`, `handleScannedQrText`, or `toggleAdvancedApiBox`, while `handleUrlDeepLinks()` sets `window.customOnboardApiUrl` and `submitStudentOnboarding()` uses `normalizeApiUrl(window.customOnboardApiUrl || DEFAULT_LECTURER_API)`.
- [ ] **Step 2: Run test and confirm RED failure**
- [ ] **Step 3 (GREEN): Remove QR scanner code & Student URL box in `index.html`, `js/schedule-config.js`, `js/student.js`, and `css/styles.css`**
- [ ] **Step 4: Run test and confirm Task 1 assertions PASS**
- [ ] **Step 5 (Review Gate 1): Dispatch `Task 1 Code Reviewer` subagent (`research`) and verify `Ready: Yes`**

---

### Task 2: Desktop 2-Column Split-View (`>= 960px`), `Enter` Login & Double-Click Floating PIN Spotlight (`index.html`, `js/teacher.js`, `css/styles.css`)

**Files:**
- Modify: `index.html`
- Modify: `js/teacher.js`
- Modify: `css/styles.css`
- Test: `.agent/skills/appscript-deploy/scripts/test-v371-ux.js`

- [ ] **Step 1 (RED): Extend `test-v371-ux.js` with Task 2 assertions & run to confirm RED**
  - Assert `#inp-tea-token` handles `Enter` keydown to call `loginTeacher()`.
  - Assert `#tea-p2-pin-projector-box` has `ondblclick="togglePinSpotlightMode(event)"`, `#tea-pin-spotlight-meta` (`#tea-pin-spot-timer`, `#tea-pin-spot-count`), `#tea-pin-spotlight-hint`, and `#btn-tea-switch-1tap` has `ondblclick="event.stopPropagation()"`.
  - Assert `togglePinSpotlightMode()` toggles `.pin-spotlight-active`, `exitPinSpotlightMode()` removes `.pin-spotlight-active`, `Escape` key exits Spotlight, and closing Round 2 / switching away from `PIN_10S` in `updateProjectorPin10sUI()` automatically calls `exitPinSpotlightMode()`.
  - Assert `css/styles.css` defines `@media (min-width: 960px)` 2-column grid for `#box-teacher-dashboard:not(.hidden)` and `.p2-projector-pin-card.pin-spotlight-active`.
- [ ] **Step 2 (GREEN): Implement HTML, JS, and CSS for Desktop 2-Column Split-View & Floating PIN Spotlight**
- [ ] **Step 3: Run `test-v371-ux.js` to confirm all Task 1 + Task 2 assertions PASS, and capture `1440x900` visual preview screenshots**
- [ ] **Step 4 (Review Gate 2): Dispatch `Task 2 Code Reviewer` subagent (`research`) and verify `Ready: Yes`**

---

### Task 3: Version Bump `v3.7.1`, Bilingual `changelog.md` & Automated Apps Script Deployment

**Files:**
- Rename & Modify: `code3.7.0.text` $\rightarrow$ `code3.7.1.text`
- Modify: `sync.txt`, `changelog.md`, `index.html`, `js/schedule-config.js`, `js/student.js`, `js/teacher.js`

- [ ] **Step 1: Rename `code3.7.0.text` $\rightarrow$ `code3.7.1.text`, update `SYSTEM_VERSION = '3.7.1'`, `sync.txt`, frontend `?v=3.7.1`, and `changelog.md` (EN + VI + Quick Comparison table)**
- [ ] **Step 2: Run `test-deploy-appscript.js` + `deploy-appscript.js` to push `v3.7.1` to Google Apps Script in-place (`@11`) and sync Drive backup files**
- [ ] **Step 3 (Review Gate 3): Dispatch `Task 3 Release Reviewer` subagent (`research`) and verify `Ready: Yes`**
