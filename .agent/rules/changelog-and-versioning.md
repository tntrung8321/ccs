---
trigger: always_on
description: Always update changelog.md (EN/VI + Quick Comparison table) and bump version numbers in code whenever fixing bugs or adding features.
---

# Changelog & Versioning Rule (`CCS - ClassCheck System`)

Whenever you fix bugs, add features, or modify system behavior in `d:\CCS - ClassCheck System`, you **MUST ALWAYS**:

1. **Update `changelog.md` (`d:\CCS - ClassCheck System\changelog.md`)**:
   - Document all changes clearly in **both** the **English (`## 🇬🇧 ENGLISH VERSION`)** and **Vietnamese (`## 🇻🇳 PHIÊN BẢN TIẾNG VIỆT`)** sections.
   - Update the **Quick Comparison table (`## 📊 Quick Comparison / Bảng Đối Chiếu Nhanh`)** at the bottom of `changelog.md` to reflect the latest version number and capabilities.
   - If Google Drive sync is active for release notes (`changelog.md` on Drive), keep the Drive copy synchronized when requested or during release packaging.

2. **Bump the Version Number in Code**:
   - Increment the semantic version (`PATCH` for bug fixes, `MINOR` for new features, `MAJOR` for breaking architectural changes) across all version constants and UI/backend headers:
     - `SYSTEM_VERSION` and header comments in `code3.3.0.text` / `code3.2.0.text` (`d:\CCS - ClassCheck System\code3.3.0.text`) and `sync.txt` (`d:\CCS - ClassCheck System\sync.txt`)
     - Release version badges / footers / comments in frontend modules (`index.html`, `js/schedule-config.js`, `js/student.js`, `js/teacher.js`, `css/styles.css`) if applicable.
