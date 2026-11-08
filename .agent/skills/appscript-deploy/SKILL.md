---
name: appscript-deploy
description: Use when modifying, pushing, or deploying Google Apps Script backend files (code<X.Y.Z>.text or sync.txt), or when the user asks to update Apps Script automatically without changing the Web App /exec URL.
---

# Automated Google Apps Script Push & In-Place Deployment (`appscript-deploy`)

## Overview

This skill automates pushing local backend files (`code<X.Y.Z>.text` and `sync.txt`) to the bound Google Apps Script project (`1KL0rnBXXhflTa1ErNuKt461lVxyX7gKx80qWq9V_VFrVGeN82jzuKKnF`) and publishing a **New version** directly onto the existing Web App Deployment ID (`AKfycbyzXVAiaDpcvV4e8upgie6-yM_p7GOgjF5RhP3wmii6Hnx4s5xQZaPweZiPtbBYpO8q`).

**Core Principle:** Always deploy in-place with `-i <Deployment_ID>` (equivalent to *Manage deployments $\rightarrow$ Edit $\rightarrow$ Version: New version $\rightarrow$ Deploy*) so the `/exec` Web App URL in `js/schedule-config.js` and the Master Sheet never changes.

## Quick Reference

| Item | Value / Path |
| :--- | :--- |
| **Script ID** | `1KL0rnBXXhflTa1ErNuKt461lVxyX7gKx80qWq9V_VFrVGeN82jzuKKnF` |
| **Deployment ID** | `AKfycbyzXVAiaDpcvV4e8upgie6-yM_p7GOgjF5RhP3wmii6Hnx4s5xQZaPweZiPtbBYpO8q` |
| **Active Web App URL** | `https://script.google.com/macros/s/AKfycbyzXVAiaDpcvV4e8upgie6-yM_p7GOgjF5RhP3wmii6Hnx4s5xQZaPweZiPtbBYpO8q/exec` |
| **Source Mapping** | `code<X.Y.Z>.text` $\rightarrow$ `.clasp/Code.gs`<br>`sync.txt` $\rightarrow$ `.clasp/Sync.gs` |
| **Deploy Command** | `node ".agent/skills/appscript-deploy/scripts/deploy-appscript.js"` |
| **Stage-Only / Dry Run** | `node ".agent/skills/appscript-deploy/scripts/deploy-appscript.js" --stage-only` |
| **Unit Test Suite** | `node ".agent/skills/appscript-deploy/scripts/test-deploy-appscript.js"` |

## Workflow

1. **Stage & Verify Locally (Sandboxed):**
   ```powershell
   node ".agent/skills/appscript-deploy/scripts/deploy-appscript.js" --stage-only
   ```
   Confirm the script picks the latest `code<X.Y.Z>.text`, copies it to `.clasp/Code.gs`, copies `sync.txt` to `.clasp/Sync.gs`, and prints the target `Script ID` and `Deployment ID`.

2. **Push & Re-Deploy In-Place (Requires Network / `BypassSandbox: true`):**
   ```powershell
   node ".agent/skills/appscript-deploy/scripts/deploy-appscript.js"
   ```
   Under the hood, the script:
   - Pulls remote `appsscript.json` once on first run (`.clasp/.manifest-synced`) so existing project OAuth scopes and Web App permissions are preserved.
   - Runs `clasp push -f` inside `.clasp/` (pushing only `Code.gs`, `Sync.gs`, and `appsscript.json`).
   - Runs `clasp deploy -i AKfycbyzXVAiaDpcvV4e8upgie6-yM_p7GOgjF5RhP3wmii6Hnx4s5xQZaPweZiPtbBYpO8q -d "v<X.Y.Z>"` to attach the new version to the existing Deployment ID.

## Troubleshooting One-Time Setup

| Error / Symptom | Fix |
| :--- | :--- |
| `No credentials found` / `not logged in` | Run `& "$env:APPDATA\npm\clasp.cmd" login` (with `BypassSandbox: true`) so the user can sign in once in their browser (`~/.clasprc.json`). |
| `User has not enabled the Apps Script API` | Ask the user to open https://script.google.com/home/usersettings and toggle **Google Apps Script API** to **ON**, then re-run `node ".agent/skills/appscript-deploy/scripts/deploy-appscript.js"`. |

## Common Mistakes & Red Flags

- **Never run bare `clasp deploy` without `-i <Deployment_ID>`:** Bare `clasp deploy` creates a brand-new Deployment ID and changes the `/exec` URL. Always run `node ".agent/skills/appscript-deploy/scripts/deploy-appscript.js"`, which enforces `-i <Deployment_ID>`.
- **Never run `clasp push` from the repository root:** Running `clasp` in the repo root would push frontend files (`index.html`, `js/student.js`, `js/teacher.js`) into the Apps Script project. Always use `.clasp/` via `deploy-appscript.js`.
