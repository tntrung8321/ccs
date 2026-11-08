#!/usr/bin/env node
/**
 * CCS (ClassCheck System) — Automated Google Apps Script Staging & In-Place Deployer
 * Maps code<X.Y.Z>.text -> .clasp/Code.gs and sync.txt -> .clasp/Sync.gs,
 * pushes to Google Apps Script, and updates the existing Web App Deployment ID in-place
 * (Manage deployments -> Edit -> New version) so the /exec URL never changes.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const DEFAULT_SCRIPT_ID = '1KL0rnBXXhflTa1ErNuKt461lVxyX7gKx80qWq9V_VFrVGeN82jzuKKnF';
const DEFAULT_DEPLOYMENT_ID = 'AKfycbyzXVAiaDpcvV4e8upgie6-yM_p7GOgjF5RhP3wmii6Hnx4s5xQZaPweZiPtbBYpO8q';

const DEFAULT_MANIFEST = {
  timeZone: 'Asia/Ho_Chi_Minh',
  dependencies: {},
  webapp: {
    executeAs: 'USER_DEPLOYING',
    access: 'ANYONE_ANONYMOUS'
  },
  exceptionLogging: 'STACKDRIVER',
  runtimeVersion: 'V8'
};

function parseSemver(versionStr) {
  const parts = String(versionStr || '').trim().split('.').map(n => parseInt(n, 10));
  if (parts.length !== 3 || parts.some(n => Number.isNaN(n))) return [0, 0, 0];
  return parts;
}

function compareSemverDesc(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i++) {
    if (pb[i] !== pa[i]) return pb[i] - pa[i];
  }
  return 0;
}

function resolveLatestCodeFile(rootDir) {
  const entries = fs.readdirSync(rootDir);
  const candidates = [];

  for (const name of entries) {
    const m = /^code(\d+\.\d+\.\d+)\.text$/i.exec(name);
    if (!m) continue;
    const fullPath = path.join(rootDir, name);
    if (!fs.statSync(fullPath).isFile()) continue;

    const fileVer = m[1];
    const headChunk = fs.readFileSync(fullPath, 'utf8').slice(0, 2048);
    const sysMatch = /SYSTEM_VERSION\s*=\s*['"](\d+\.\d+\.\d+)['"]/.exec(headChunk);
    const version = sysMatch ? sysMatch[1] : fileVer;

    candidates.push({
      fileName: name,
      filePath: fullPath,
      version
    });
  }

  if (candidates.length === 0) {
    throw new Error(`No code<X.Y.Z>.text file found in ${rootDir}`);
  }

  candidates.sort((a, b) => compareSemverDesc(a.version, b.version));
  return candidates[0];
}

function extractDeploymentIdFromScheduleConfig(rootDir) {
  const configPath = path.join(rootDir, 'js', 'schedule-config.js');
  if (!fs.existsSync(configPath)) return DEFAULT_DEPLOYMENT_ID;

  const content = fs.readFileSync(configPath, 'utf8');
  const m = /DEFAULT_LECTURER_API\s*=\s*['"]https:\/\/script\.google\.com\/macros\/s\/([^/'"]+)\/exec['"]/.exec(content);
  return m && m[1] ? m[1].trim() : DEFAULT_DEPLOYMENT_ID;
}

function resolveProjectMetadata(rootDir) {
  const rawRoot = path.resolve(rootDir || path.resolve(__dirname, '../../../..'));
  const resolvedRoot = fs.existsSync(rawRoot) ? fs.realpathSync(rawRoot) : rawRoot;
  const claspDir = path.join(resolvedRoot, '.clasp');
  const claspJsonPath = path.join(claspDir, '.clasp.json');

  let scriptId = DEFAULT_SCRIPT_ID;
  if (fs.existsSync(claspJsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(claspJsonPath, 'utf8'));
      if (parsed && parsed.scriptId) scriptId = String(parsed.scriptId).trim();
    } catch (e) {}
  }

  const latestCode = resolveLatestCodeFile(resolvedRoot);
  const syncFilePath = path.join(resolvedRoot, 'sync.txt');
  if (!fs.existsSync(syncFilePath)) {
    throw new Error(`Missing sync.txt in ${resolvedRoot}`);
  }

  const deploymentId = extractDeploymentIdFromScheduleConfig(resolvedRoot);

  return {
    rootDir: resolvedRoot,
    claspDir,
    codeFile: latestCode.fileName,
    codeFilePath: latestCode.filePath,
    syncFilePath,
    version: latestCode.version,
    scriptId,
    deploymentId
  };
}

function stageAppsScriptFiles(rootDir) {
  const meta = resolveProjectMetadata(rootDir);
  fs.mkdirSync(meta.claspDir, { recursive: true });

  const claspJsonPath = path.join(meta.claspDir, '.clasp.json');
  fs.writeFileSync(
    claspJsonPath,
    JSON.stringify({ scriptId: meta.scriptId, rootDir: '.', allowSymlinks: true }, null, 2) + '\n',
    'utf8'
  );

  const manifestPath = path.join(meta.claspDir, 'appsscript.json');
  if (!fs.existsSync(manifestPath)) {
    fs.writeFileSync(manifestPath, JSON.stringify(DEFAULT_MANIFEST, null, 2) + '\n', 'utf8');
  }

  const codeGsPath = path.join(meta.claspDir, 'Code.gs');
  const syncGsPath = path.join(meta.claspDir, 'Sync.gs');

  fs.copyFileSync(meta.codeFilePath, codeGsPath);
  fs.copyFileSync(meta.syncFilePath, syncGsPath);

  return {
    ...meta,
    claspJsonPath,
    manifestPath,
    codeGsPath,
    syncGsPath
  };
}

function buildClaspCommands(meta) {
  const deploymentId = String((meta && meta.deploymentId) || '').trim();
  if (!deploymentId) {
    throw new Error(
      'Deployment ID is required for in-place update (-i <deploymentId>). Refusing to create a new /exec URL.'
    );
  }
  const version = String((meta && meta.version) || '1.0.0').trim();
  return {
    pushArgs: ['push', '-f'],
    deployArgs: ['deploy', '-i', deploymentId, '-d', `v${version}`]
  };
}

function diagnoseClaspOutput(outputText) {
  const text = String(outputText || '');
  if (/not enabled the Apps Script API|Apps Script API has not been used|script\.google\.com\/home\/usersettings/i.test(text)) {
    return (
      '⚠️ Google Apps Script API chưa được bật cho tài khoản của bạn.\n' +
      '👉 Hãy mở https://script.google.com/home/usersettings và gạt nút "Google Apps Script API" sang BẬT (ON), sau đó chạy lại.'
    );
  }
  if (/No credentials found|clasp login|not logged in|invalid_grant|unauthenticated/i.test(text)) {
    return (
      '⚠️ Chưa đăng nhập clasp hoặc phiên đăng nhập đã hết hạn.\n' +
      '👉 Hãy chạy lệnh: clasp login'
    );
  }
  return '';
}

function resolveClaspExecutable() {
  if (process.platform === 'win32') {
    const appDataNpm = process.env.APPDATA ? path.join(process.env.APPDATA, 'npm', 'clasp.cmd') : '';
    if (appDataNpm && fs.existsSync(appDataNpm)) return appDataNpm;
    return 'clasp.cmd';
  }
  return 'clasp';
}

function runClasp(args, cwd) {
  const bin = resolveClaspExecutable();
  const result = spawnSync(bin, args, {
    cwd,
    encoding: 'utf8',
    shell: process.platform === 'win32'
  });
  const combined = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined,
    error: result.error
  };
}

function main() {
  const args = process.argv.slice(2);
  const stageOnly = args.includes('--stage-only') || args.includes('--dry-run');
  const rootDir = path.resolve(__dirname, '../../../..');

  const staged = stageAppsScriptFiles(rootDir);
  const cmds = buildClaspCommands(staged);

  console.log(`[CCS Apps Script Deploy] Version: v${staged.version}`);
  console.log(`  Source Code.gs : ${staged.codeFile} -> .clasp/Code.gs`);
  console.log(`  Source Sync.gs : sync.txt -> .clasp/Sync.gs`);
  console.log(`  Script ID      : ${staged.scriptId}`);
  console.log(`  Deployment ID  : ${staged.deploymentId}`);

  if (stageOnly) {
    console.log(`[Stage Only] Planned commands in ${staged.claspDir}:`);
    console.log(`  1) clasp ${cmds.pushArgs.join(' ')}`);
    console.log(`  2) clasp ${cmds.deployArgs.join(' ')}`);
    return;
  }

  const clasprcPath = path.join(os.homedir(), '.clasprc.json');
  if (!fs.existsSync(clasprcPath)) {
    console.error(diagnoseClaspOutput('No credentials found. Please run clasp login'));
    process.exit(1);
  }

  // On first authenticated deploy, pull remote appsscript.json once so existing project scopes/settings are kept
  const manifestSyncMarker = path.join(staged.claspDir, '.manifest-synced');
  if (!fs.existsSync(manifestSyncMarker)) {
    console.log('🔄 Synchronizing remote appsscript.json manifest (first-time setup)...');
    const tmpPullDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-clasp-pull-'));
    try {
      fs.copyFileSync(staged.claspJsonPath, path.join(tmpPullDir, '.clasp.json'));
      const pullRes = runClasp(['pull'], tmpPullDir);
      const pulledManifest = path.join(tmpPullDir, 'appsscript.json');
      if (pullRes.status === 0 && fs.existsSync(pulledManifest)) {
        fs.copyFileSync(pulledManifest, staged.manifestPath);
        fs.writeFileSync(manifestSyncMarker, new Date().toISOString() + '\n', 'utf8');
        console.log('✅ Remote appsscript.json preserved.');
      } else if (pullRes.status !== 0) {
        const hint = diagnoseClaspOutput(pullRes.combined);
        if (hint) {
          console.error(hint);
          console.error(pullRes.combined);
          process.exit(1);
        }
      }
    } finally {
      fs.rmSync(tmpPullDir, { recursive: true, force: true });
    }
  }

  console.log('🚀 Step 1/2: Pushing Code.gs and Sync.gs to Google Apps Script...');
  const pushRes = runClasp(cmds.pushArgs, staged.claspDir);
  if (pushRes.status !== 0) {
    console.error('❌ clasp push failed:');
    console.error(pushRes.combined);
    const hint = diagnoseClaspOutput(pushRes.combined);
    if (hint) console.error(hint);
    process.exit(pushRes.status || 1);
  }
  console.log(pushRes.stdout.trim() || '✅ Pushed Code.gs & Sync.gs.');

  console.log(`🚀 Step 2/2: Updating existing Deployment (${staged.deploymentId}) to New Version (v${staged.version})...`);
  const deployRes = runClasp(cmds.deployArgs, staged.claspDir);
  if (deployRes.status !== 0) {
    console.error('❌ clasp deploy failed:');
    console.error(deployRes.combined);
    const hint = diagnoseClaspOutput(deployRes.combined);
    if (hint) console.error(hint);
    process.exit(deployRes.status || 1);
  }
  console.log(deployRes.stdout.trim() || '✅ Deployment updated in-place.');
  console.log(`🔗 Active Web App URL (unchanged): https://script.google.com/macros/s/${staged.deploymentId}/exec`);
}

if (require.main === module) {
  main();
}

module.exports = {
  parseSemver,
  resolveLatestCodeFile,
  extractDeploymentIdFromScheduleConfig,
  resolveProjectMetadata,
  stageAppsScriptFiles,
  buildClaspCommands,
  diagnoseClaspOutput
};
