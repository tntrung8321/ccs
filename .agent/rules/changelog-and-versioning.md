---
trigger: always_on
description: Always update changelog.md (EN/VI + Quick Comparison table), bump version numbers in code, and rename the backend code<X.Y.Z>.text file locally and on Google Drive whenever fixing bugs or adding features.
---

# Changelog & Versioning Rule (`CCS - ClassCheck System`)

Whenever you fix bugs, add features, or modify system behavior in `d:\CCS - ClassCheck System`, you **MUST ALWAYS**:

1. **Update `changelog.md` (`d:\CCS - ClassCheck System\changelog.md`)**:
   - Document all changes clearly in **both** the **English (`## 🇬🇧 ENGLISH VERSION`)** and **Vietnamese (`## 🇻🇳 PHIÊN BẢN TIẾNG VIỆT`)** sections.
   - Update the **Quick Comparison table (`## 📊 Quick Comparison / Bảng Đối Chiếu Nhanh`)** at the bottom of `changelog.md` to reflect the latest version number and capabilities.
   - If Google Drive sync is active for release notes (`changelog.md` on Drive, ID: `18y2_402KSn4KfRZ0LExDlnCmB6UsqGPz`), keep the Drive copy synchronized when requested or during release packaging.

2. **Bump the Version Number in Code & Rename the Versioned Backend File**:
   - Increment the semantic version (`PATCH` for bug fixes, `MINOR` for new features, `MAJOR` for breaking architectural changes, e.g. `X.Y.Z`) across all version constants and UI/backend headers:
     - **Rename** the local backend file `code<old>.text` to `code<X.Y.Z>.text` (`d:\CCS - ClassCheck System\code<X.Y.Z>.text`) so the filename always matches the current `SYSTEM_VERSION = '<X.Y.Z>'`, and **rename** the corresponding Google Drive file (`14mEoxJJ1_USzlYorIvnZBHJwzzK1KDOj`) via `gdrive mutate rename 14mEoxJJ1_USzlYorIvnZBHJwzzK1KDOj "code<X.Y.Z>.text"`.
     - Update `SYSTEM_VERSION` and header comments in `code<X.Y.Z>.text` and `sync.txt` (`d:\CCS - ClassCheck System\sync.txt`, Drive ID: `1TA3scTqHwz8btQYJbzDSPiP6K3QCsxyA`).
     - Update release version badges / query-string cache busters (`?v=<X.Y.Z>`) / comments in frontend modules (`index.html`, `js/schedule-config.js`, `js/student.js`, `js/teacher.js`, `css/styles.css`).

3. **Surgical Edits & Verification (`ui-demo-preview.md`)**:
   - Modify only the exact lines needed; avoid rewriting whole functions/files or adding unsolicited introductory comments/UI text.
   - Use `/tmp/ccs-demo` screenshot previews **only** for UI/layout changes; for code/logic/functional changes, run actual functional tests instead of taking screenshots.
