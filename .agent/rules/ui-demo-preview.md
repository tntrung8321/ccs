---
trigger: always_on
description: When making UI/UX changes, render an isolated demo in /tmp and show product screenshots of the updated interface for user approval before modifying main repository files when requested.
---

# Visual Product Screenshot Demo Rule (`CCS - ClassCheck System`)

Whenever the user asks to plan or preview UI/interface changes before coding (or when proposing noticeable layout changes on the Lecturer / Student screens):

1. **Isolated Demo First (`/tmp/ccs-demo`)**:
   - Copy the frontend files (`index.html`, `css/`, `js/`) into an isolated temporary directory (`/tmp/ccs-demo`) while keeping the main repository (`tntrung8321/ccs`) untouched.
   - Apply the proposed UI changes in `/tmp/ccs-demo` and inject realistic mock state (`applyTeacherState` / student profile state).

2. **High-DPI Product Screenshots via Headless Chromium**:
   - Render `/tmp/ccs-demo` in headless Chromium (`--force-device-scale-factor=2`) and capture full product screenshots of all affected views/modals (e.g., Lecturer Main Dashboard, Attendance Calendar & History Modal, Student Check-In Card).
   - Present the screenshots in a visual Artifact carousel (`demo_*.png`) so the user can inspect the exact product appearance before approving code changes in the main repository.
