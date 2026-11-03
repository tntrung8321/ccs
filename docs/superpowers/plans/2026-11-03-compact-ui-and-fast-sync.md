# Compact UI & Fast Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:dispatching-parallel-agents to implement this plan across 3 non-overlapping file domains in parallel. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Declutter the Lecturer and Student UIs (remove Fullscreen/Refresh buttons, hide Advanced GPS behind a toggle, shorten all text readouts), speed up Lecturer live polling to 2.5s, and prevent page refresh (F5) or session close (`CLOSE_NOW`) from logging out or kicking the Lecturer back to the Student screen.

**Architecture:** Split across 3 strictly disjoint file domains: (1) HTML & CSS layout decluttering (`index.html`, `css/styles.css`), (2) Frontend JS state persistence, 2.5s non-overlapping polling, and concise bilingual copy (`js/schedule-config.js`, `js/student.js`, `js/teacher.js`), and (3) Backend token grace/rotation & cache-assisted state polling plus `v3.4.4` release notes (`code3.3.0.text`, `sync.txt`, `changelog.md`).

**Tech Stack:** Vanilla HTML5, CSS3, ES6 JavaScript, Google Apps Script (`code3.3.0.text`, `sync.txt`).

**Spec:** `docs/superpowers/specs/2026-11-03-compact-ui-and-fast-sync-design.md`

---

### Task 1: HTML & CSS Decluttering (`index.html`, `css/styles.css`)
- [ ] Remove `Toàn màn hình` and `Làm mới` buttons, redundant class display rows, and visible GPS anchor explanation paragraph from `index.html`.
- [ ] Hide `#box-adv-gps-mode` (containing `#chk-use-student-avg3` and `#tea-gps-anchor-hint`) until `#btn-toggle-adv-gps` (`GPS nâng cao`) is clicked.
- [ ] Shorten Student `#gps-panel` labels (`Chưa kiểm tra GPS`, `Kiểm tra GPS`) and tighten card spacing in `css/styles.css`.

### Task 2: Frontend JS Fast Sync, F5 Persistence & Concise Text (`js/schedule-config.js`, `js/student.js`, `js/teacher.js`)
- [ ] Persist `cc_active_mode`, `cc_teacher_selected_class`, and `cc_teacher_state_cache` so F5 / reload stays in Lecturer Dashboard without flashing Student view or login card.
- [ ] Reduce `teacherPollTimer` to `2500ms` with an in-flight lock (`isRefreshingTeacher`) and immediate refresh on `visibilitychange`.
- [ ] Update stored token when `res.rotatedTempCode` is returned, and shorten all status/readout texts across Student and Lecturer controllers.

### Task 3: Backend Token Rotation Grace, Fast Polling & Changelog `v3.4.4` (`code3.3.0.text`, `sync.txt`, `changelog.md`)
- [ ] Keep `PREV_TEMP_PC_CODE` valid during session rotation and return `rotatedTempCode` on `CLOSE_NOW` in `code3.3.0.text`.
- [ ] Use row-aware cached `getClassesMap(ss, false)` and `getClassRosterMap(ss, selectedId, false)` in `handleTeacherGetState` for fast 2.5s polling.
- [ ] Bump version to `v3.4.4` in `code3.3.0.text`, `sync.txt`, and `changelog.md` (EN + VI + Quick Comparison table).
