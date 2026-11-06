---
trigger: always_on
description: Enforce surgical code edits (modify only what is needed, no full rewrites or unsolicited introductory comments/text), use screenshot previews ONLY for UI/layout changes, and run real functional tests for code/logic changes.
---

# Surgical Code Edits & Context-Appropriate Verification Rule (`CCS - ClassCheck System`)

1. **Surgical Edits Only — No Unnecessary Rewrites or Boilerplate Comments**:
   - **Modify Only What Is Needed**: Edit only the exact lines/functions required by the task. Avoid rewriting entire functions, sections, or files when a targeted change suffices.
   - **No Unsolicited Introductory Comments or UI Text**: Never add multi-line introductory banner comments, docstrings, or extra instructional UI text that the user did not explicitly request.
   - **Concise, Direct Responses**: State exact file names, line numbers, and technical outcomes directly without rambling explanations.

2. **Verification & Preview Strategy (UI Screenshots vs. Functional Code Tests)**:
   - **UI / Layout / Styling Changes ONLY $\rightarrow$ Visual Screenshot Preview (`/tmp/ccs-demo`)**:
     - Use the isolated `/tmp/ccs-demo` + headless Chromium (`2x`) screenshot workflow **only** when the task modifies visual layout, styling, or UI components that need visual inspection.
   - **Code / Logic / Functional Changes $\rightarrow$ Real Functional Testing (No Unnecessary Screenshots)**:
     - When fixing bugs or updating logic/functionality (e.g., GPS acquisition, session state, scoring formulas, API handling, Sheet sync), do **not** generate UI screenshots. Instead, run **actual functional tests** (automated Node.js / headless browser test scripts exercising the exact code paths and edge cases) and verify the runtime output.
