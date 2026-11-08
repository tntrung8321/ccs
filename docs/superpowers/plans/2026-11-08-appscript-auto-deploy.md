# Apps Script Auto-Deploy Skill (`appscript-deploy`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and install the `appscript-deploy` workspace skill and `@google/clasp` automation script that stages `code<X.Y.Z>.text` $\rightarrow$ `.clasp/Code.gs` and `sync.txt` $\rightarrow$ `.clasp/Sync.gs`, pushes them to Script ID `1KL0rnBXXhflTa1ErNuKt461lVxyX7gKx80qWq9V_VFrVGeN82jzuKKnF`, and updates existing Web App Deployment ID `AKfycbyzXVAiaDpcvV4e8upgie6-yM_p7GOgjF5RhP3wmii6Hnx4s5xQZaPweZiPtbBYpO8q` in-place (`New version`) without changing the `/exec` URL.

**Architecture:** An isolated `.clasp/` staging directory (gitignored) holds `.clasp.json`, `appsscript.json`, `Code.gs`, and `Sync.gs` so frontend web files (`index.html`, `js/*.js`, `css/*.css`) are never pushed to Google Apps Script. A Node.js automation script (`.agent/skills/appscript-deploy/scripts/deploy-appscript.js`) resolves the latest `code<X.Y.Z>.text` and `DEFAULT_LECTURER_API` deployment ID, stages `.gs` files, runs `clasp push -f`, and runs `clasp deploy -i <deploymentId> -d "v<X.Y.Z>"`.

**Tech Stack:** Node.js (`v26.13.0`), `@google/clasp` CLI, Antigravity Workspace Skills (`.agent/skills/appscript-deploy/SKILL.md`), and Workspace Rules (`.agent/rules/changelog-and-versioning.md`).

**Spec:** `docs/superpowers/specs/2026-11-08-appscript-auto-deploy-design.md`

## Global Constraints

- **Script ID:** `1KL0rnBXXhflTa1ErNuKt461lVxyX7gKx80qWq9V_VFrVGeN82jzuKKnF`
- **Deployment ID:** `AKfycbyzXVAiaDpcvV4e8upgie6-yM_p7GOgjF5RhP3wmii6Hnx4s5xQZaPweZiPtbBYpO8q` (automatically verified against `DEFAULT_LECTURER_API` in `js/schedule-config.js`)
- **Never change the `/exec` link:** `clasp deploy` MUST always include `-i <deploymentId>` so it updates the existing deployment in-place (`Manage deployments -> Edit -> New version`).
- **Preserve root backend file naming:** Keep `code<X.Y.Z>.text` and `sync.txt` at the repository root.

## Review Focus

- Multiple `code*.text` files accidentally present in root: `resolveLatestCodeFile(rootDir)` must pick the one with the highest semantic version matching `SYSTEM_VERSION`.
- Missing or unauthenticated `~/.clasprc.json`: `deploy-appscript.js` must detect missing credentials before running `clasp push` and print clear instructions (`clasp login` + `https://script.google.com/home/usersettings`).
-Apps Script API disabled (`User has not enabled the Apps Script API`): script must catch this exact error output and point directly to `https://script.google.com/home/usersettings`.
- Preserving live `appsscript.json` manifest: on first authenticated run, pull remote `appsscript.json` before pushing so existing OAuth scopes/webapp settings are kept intact.
- Preventing accidental new deployment ID creation: throw an error and abort if `deploymentId` is empty or invalid instead of calling bare `clasp deploy`.

---

### Task 1: Install `@google/clasp` & Initialize Isolated `.clasp/` Staging Config

**Files:**
- Create: `.gitignore`
- Create: `.clasp/.clasp.json`
- Create: `.clasp/appsscript.json`

**Interfaces:**
- Produces: `.clasp/.clasp.json` (`{"scriptId":"1KL0rnBXXhflTa1ErNuKt461lVxyX7gKx80qWq9V_VFrVGeN82jzuKKnF","rootDir":"."}`) and `.clasp/appsscript.json` (`Asia/Ho_Chi_Minh`, `V8`, `webapp: { executeAs: "USER_DEPLOYING", access: "ANYONE_ANONYMOUS" }`).

- [ ] **Step 1: Install `@google/clasp` globally via `npm.cmd`**
  - Run: `npm.cmd install -g @google/clasp` (with `BypassSandbox: true` for network access)
  - Expected: `clasp.cmd --version` prints version `2.x` or `3.x`.

- [ ] **Step 2: Create `.gitignore` and `.clasp/.clasp.json` + `.clasp/appsscript.json`**
  - Create `.gitignore` ignoring `.clasp/` and `node_modules/`.
  - Create `.clasp/.clasp.json` with `"scriptId": "1KL0rnBXXhflTa1ErNuKt461lVxyX7gKx80qWq9V_VFrVGeN82jzuKKnF"` and `"rootDir": "."`.
  - Create `.clasp/appsscript.json` with timezone `"Asia/Ho_Chi_Minh"`, runtimeVersion `"V8"`, and webapp settings `"executeAs": "USER_DEPLOYING"`, `"access": "ANYONE_ANONYMOUS"`.

---

### Task 2: Build & Test Automated Staging and In-Place Deployment Script

**Files:**
- Create: `.agent/skills/appscript-deploy/scripts/deploy-appscript.js`
- Test: `.agent/skills/appscript-deploy/scripts/test-deploy-appscript.js`

**Interfaces:**
- Consumes: `.clasp/.clasp.json`, `code<X.Y.Z>.text`, `sync.txt`, `js/schedule-config.js`
- Produces:
  - `resolveProjectMetadata(rootDir)` $\rightarrow$ `{ codeFile, version, deploymentId, scriptId }`
  - `stageAppsScriptFiles(rootDir)` $\rightarrow$ `{ codeGsPath, syncGsPath, version, deploymentId }`
  - CLI flags: `--stage-only` (copies `.gs` files and prints planned `clasp` commands without network calls) and default deploy mode (`clasp push -f` + `clasp deploy -i <deploymentId> -d "v<version>"`).

- [ ] **Step 1: Write the failing test in `.agent/skills/appscript-deploy/scripts/test-deploy-appscript.js`**
  - Assert `resolveProjectMetadata` extracts `version === '3.7.0'`, `codeFile === 'code3.7.0.text'`, `deploymentId === 'AKfycbyzXVAiaDpcvV4e8upgie6-yM_p7GOgjF5RhP3wmii6Hnx4s5xQZaPweZiPtbBYpO8q'`, and `scriptId === '1KL0rnBXXhflTa1ErNuKt461lVxyX7gKx80qWq9V_VFrVGeN82jzuKKnF'`.
  - Assert `stageAppsScriptFiles` writes `.clasp/Code.gs` (byte-identical to `code3.7.0.text`) and `.clasp/Sync.gs` (byte-identical to `sync.txt`), and builds the exact command `clasp deploy -i AKfycbyzXVAiaDpcvV4e8upgie6-yM_p7GOgjF5RhP3wmii6Hnx4s5xQZaPweZiPtbBYpO8q -d "v3.7.0"`.
  - Assert missing `deploymentId` throws an explicit error refusing to create a new deployment link.

- [ ] **Step 2: Run test to verify it fails**
  - Run: `node ".agent/skills/appscript-deploy/scripts/test-deploy-appscript.js"`
  - Expected: FAIL (`Cannot find module './deploy-appscript.js'`).

- [ ] **Step 3: Implement `.agent/skills/appscript-deploy/scripts/deploy-appscript.js`**
  - Implement `resolveProjectMetadata(rootDir)`, `stageAppsScriptFiles(rootDir)`, `buildClaspCommands(meta)`, and CLI runner supporting `--stage-only` and live `clasp push -f` + `clasp deploy -i <deploymentId> -d "v<version>"`.

- [ ] **Step 4: Run test to verify it passes**
  - Run: `node ".agent/skills/appscript-deploy/scripts/test-deploy-appscript.js"`
  - Expected: PASS (`All appscript-deploy tests passed`).

---

### Task 3: Author `SKILL.md`, Update Workspace Rules & Verify Live Clasp Auth/Deploy

**Files:**
- Create: `.agent/skills/appscript-deploy/SKILL.md`
- Modify: `.agent/rules/changelog-and-versioning.md`

**Interfaces:**
- Consumes: `.agent/skills/appscript-deploy/scripts/deploy-appscript.js`
- Produces: Discoverable skill `appscript-deploy` and updated rule in `.agent/rules/changelog-and-versioning.md`.

- [ ] **Step 1: Create `.agent/skills/appscript-deploy/SKILL.md`**
  - Frontmatter with `name: appscript-deploy` and `description: Use when updating, pushing, or deploying Google Apps Script backend files (code<X.Y.Z>.text or sync.txt) so changes are automatically pushed to Apps Script and re-deployed to the existing Web App Deployment ID without changing the /exec URL.`
  - Step-by-step instructions for running `node ".agent/skills/appscript-deploy/scripts/deploy-appscript.js"`, handling first-time `clasp login` / Apps Script API enablement, and verifying the live `/exec` endpoint.

- [ ] **Step 2: Update `.agent/rules/changelog-and-versioning.md`**
  - Add instruction under section 2 to invoke the `appscript-deploy` skill (`node ".agent/skills/appscript-deploy/scripts/deploy-appscript.js"`) whenever `code<X.Y.Z>.text` or `sync.txt` is modified.

- [ ] **Step 3: Verify `clasp` authentication & execute live push/deploy**
  - Check `clasp login` status; if not logged in yet, start `clasp login` and guide user to complete one-time Google sign-in & run `node ".agent/skills/appscript-deploy/scripts/deploy-appscript.js"`.
