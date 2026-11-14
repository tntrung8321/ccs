const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT_DIR = path.resolve(__dirname, '../../../..');

const {
  parseSemver,
  resolveLatestCodeFile,
  resolveProjectMetadata,
  stageAppsScriptFiles,
  buildClaspCommands,
  diagnoseClaspOutput
} = require('./deploy-appscript.js');

// 1. Test semantic version comparison & multiple code*.text files
{
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccs-clasp-test-'));
  try {
    fs.writeFileSync(path.join(tmpDir, 'code3.6.6.text'), "const SYSTEM_VERSION = '3.6.6';\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'code3.10.0.text'), "const SYSTEM_VERSION = '3.10.0';\n", 'utf8');
    fs.writeFileSync(path.join(tmpDir, 'code3.7.0.text'), "const SYSTEM_VERSION = '3.7.0';\n", 'utf8');
    const picked = resolveLatestCodeFile(tmpDir);
    assert.strictEqual(picked.fileName, 'code3.10.0.text', 'Must pick highest semver code*.text file');
    assert.strictEqual(picked.version, '3.10.0', 'Must extract SYSTEM_VERSION 3.10.0');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// 2. Test resolveProjectMetadata on actual workspace root
{
  const meta = resolveProjectMetadata(ROOT_DIR);
  const latestOnDisk = resolveLatestCodeFile(ROOT_DIR);
  assert.strictEqual(meta.codeFile, latestOnDisk.fileName);
  assert.strictEqual(meta.version, latestOnDisk.version);
  assert.strictEqual(meta.codeFile, `code${meta.version}.text`, 'File name must match SYSTEM_VERSION');
  assert.strictEqual(meta.scriptId, '1KL0rnBXXhflTa1ErNuKt461lVxyX7gKx80qWq9V_VFrVGeN82jzuKKnF');
  assert.strictEqual(
    meta.deploymentId,
    'AKfycbyzXVAiaDpcvV4e8upgie6-yM_p7GOgjF5RhP3wmii6Hnx4s5xQZaPweZiPtbBYpO8q'
  );
  assert.strictEqual(meta.claspDir, fs.realpathSync(meta.claspDir), 'claspDir must match fs.realpathSync');
}

// 3. Test stageAppsScriptFiles copies Code.gs and Sync.gs identically
{
  const staged = stageAppsScriptFiles(ROOT_DIR);
  const srcCode = fs.readFileSync(path.join(ROOT_DIR, staged.codeFile), 'utf8');
  const srcSync = fs.readFileSync(path.join(ROOT_DIR, 'sync.txt'), 'utf8');
  const dstCode = fs.readFileSync(staged.codeGsPath, 'utf8');
  const dstSync = fs.readFileSync(staged.syncGsPath, 'utf8');
  assert.strictEqual(dstCode, srcCode, '.clasp/Code.gs must match code<X.Y.Z>.text');
  assert.strictEqual(dstSync, srcSync, '.clasp/Sync.gs must match sync.txt');
  assert.ok(fs.existsSync(path.join(ROOT_DIR, '.clasp', '.clasp.json')), '.clasp.json must exist');
  assert.ok(fs.existsSync(path.join(ROOT_DIR, '.clasp', 'appsscript.json')), 'appsscript.json must exist');
}

// 4. Test buildClaspCommands enforces -i <deploymentId> and rejects empty deploymentId
{
  const cmds = buildClaspCommands({
    version: '3.7.0',
    deploymentId: 'AKfycbyzXVAiaDpcvV4e8upgie6-yM_p7GOgjF5RhP3wmii6Hnx4s5xQZaPweZiPtbBYpO8q'
  });
  assert.deepStrictEqual(cmds.pushArgs, ['push', '-f']);
  assert.deepStrictEqual(cmds.deployArgs, [
    'deploy',
    '-i',
    'AKfycbyzXVAiaDpcvV4e8upgie6-yM_p7GOgjF5RhP3wmii6Hnx4s5xQZaPweZiPtbBYpO8q',
    '-d',
    'v3.7.0'
  ]);

  assert.throws(
    () => buildClaspCommands({ version: '3.7.0', deploymentId: '' }),
    /Deployment ID is required/,
    'Must refuse to deploy without a fixed deploymentId'
  );
}

// 5. Test diagnoseClaspOutput detects API disabled & unauthenticated errors
{
  const apiHint = diagnoseClaspOutput('User has not enabled the Apps Script API');
  assert.ok(apiHint.includes('https://script.google.com/home/usersettings'));

  const authHint = diagnoseClaspOutput('No credentials found. Please run clasp login');
  assert.ok(authHint.includes('clasp login'));
}

console.log('All appscript-deploy tests passed!');
