/**
 * Test Suite for CCS v3.7.6: session state consistency + legacy endpoint redirect.
 * Usage: node test-v376-session.js [path-to-backend.text]   (default: newest code*.text at repo root)
 * Set EXPECT_LEGACY_BUG=1 to assert the OLD behaviour (used to prove the bug reproduces on v3.7.5).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../../../..');
const EXPECT_BUG = process.env.EXPECT_LEGACY_BUG === '1';

function newestBackend() {
  const files = fs.readdirSync(ROOT).filter(f => /^code\d+\.\d+\.\d+\.text$/.test(f));
  files.sort((a, b) => {
    const pa = a.match(/\d+/g).map(Number), pb = b.match(/\d+/g).map(Number);
    for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
    return 0;
  });
  return path.join(ROOT, files[files.length - 1]);
}

const backendPath = process.argv[2] ? path.resolve(process.argv[2]) : newestBackend();
const backendSrc = fs.readFileSync(backendPath, 'utf8');

// ---------- Test 1: legacy endpoint redirect (frontend) ----------
function testLegacyEndpoints() {
  console.log('--- Test 1: normalizeApiUrl redirects old deployments ---');
  const js = fs.readFileSync(path.join(ROOT, 'js/schedule-config.js'), 'utf8');
  const defMatch = js.match(/const DEFAULT_LECTURER_API = '[^']+';/);
  const legMatch = js.match(/const LEGACY_LECTURER_APIS = \[[\s\S]*?\];/);
  const fnMatch = js.match(/function normalizeApiUrl\(url\) \{[\s\S]*?\n\}/);
  assert.ok(defMatch && legMatch && fnMatch, 'must find API constants + normalizeApiUrl');
  const ctx = vm.createContext({});
  vm.runInContext(defMatch[0] + legMatch[0] + fnMatch[0] + ';this.n = normalizeApiUrl; this.D = DEFAULT_LECTURER_API;', ctx);
  const base = 'https://script.google.com/macros/s/';
  const oldIds = [
    'AKfycbzLMWcHD7SZbgN4r0vMO2fC1_9okxL7peI3ZnbBt3YIP_4xPDxqkVjN0TIHJuiPwZEQ',
    'AKfycbzZP20_1lPpHyQl-bxl9-yVmT01pk_4B8U0mojao1agPnOjLHaK3UipsTmv3AKQvpe3',
    'AKfycbzST3i7sFqJhmiufFGJAYaEvXSbo9XbqyXI4Ihnpmc'
  ];
  oldIds.forEach(id => assert.strictEqual(ctx.n(base + id + '/exec'), ctx.D, 'old deployment must redirect: ' + id));
  assert.strictEqual(ctx.n(ctx.D), ctx.D, 'current endpoint stays');
  assert.strictEqual(ctx.n(''), ctx.D, 'empty -> default');
  assert.strictEqual(ctx.n(base + 'AKfycbzSomeOtherLecturerOwnDeployment/exec'), base + 'AKfycbzSomeOtherLecturerOwnDeployment/exec', 'unrelated lecturer deployment is not touched');
  console.log('OK');
}

// ---------- Test 2: check-in vs stale cache (backend) ----------
function buildEnv(sessionRows) {
  const cacheStore = {};
  const cache = {
    get: k => (k in cacheStore ? cacheStore[k] : null),
    put: (k, v) => { cacheStore[k] = v; },
    remove: k => { delete cacheStore[k]; },
    removeAll: ks => ks.forEach(k => delete cacheStore[k])
  };
  const sheet = {
    getLastRow: () => sessionRows.length + 1,
    getRange: (r, c, nr, nc) => ({
      getValues: () => {
        const out = [];
        for (let i = 0; i < nr; i++) {
          const row = sessionRows[r - 2 + i] || [];
          out.push(row.slice(c - 1, c - 1 + nc));
        }
        return out;
      }
    })
  };
  const ss = { getSheetByName: n => (n === 'Sessions_Log' ? sheet : null) };
  const ctx = vm.createContext({
    CacheService: { getScriptCache: () => cache },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    SpreadsheetApp: { flush: () => {} },
    PropertiesService: { getScriptProperties: () => ({ getProperty: () => null }) },
    Utilities: {},
    console
  });
  vm.runInContext(backendSrc, ctx);
  ctx.__cache = cacheStore;
  vm.runInContext(`
    jsonResponse = o => o;
    sha256Hex = s => 'hash_' + s;
    getClassesMap = () => ({ C1: { classId: 'C1', rowIndex: 2, roomLat: 10.8, roomLng: 106.6, radiusMeters: 100 } });
    getClassRosterMap = () => ({ '12345678': { studentId: '12345678', fullName: 'Test Student' } });
    verifyClassroomQr = () => true;
    verifyStudentCredential = () => ({ ok: false, code: 'REACHED_CREDENTIAL_CHECK' });
  `, ctx);
  return { ctx, ss, cacheStore };
}

const T0 = Date.now() - 60 * 1000;                    // session opened 60s ago
const iso = ms => new Date(ms);
function row({ id = 'SES_C1_1', closesAt = T0 + 3600e3, manual = '' } = {}) {
  return [id, 'C1', 'lbl', iso(T0), iso(T0 + 300e3), iso(closesAt), manual, 10.8, 106.6, 100, 'STATIC'];
}
const sesCacheObj = (id, closesAtMs) => JSON.stringify({ _lastRow: 2, map: { C1: {
  _lastRow: 2, rowIndex: 2, sessionId: id, classId: 'C1', sessionLabel: 'lbl', openedAtMs: T0,
  presentUntilMs: T0 + 300e3, closesAtMs, closedManual: '', isOpen: true, roomLat: 10.8, roomLng: 106.6, radiusMeters: 100, qrMode: 'STATIC'
} } });

function checkIn(env, arrivalMs) {
  return env.ctx.handleStudentCheckIn(env.ss, {
    studentId: '12345678', classId: 'C1', credential: 'cred', requestId: 'R' + Math.random(),
    lat: 10.8, lng: 106.6, accuracy: 10
  }, arrivalMs);
}

function testSessionConsistency() {
  console.log('--- Test 2: check-in vs stale session cache (' + path.basename(backendPath) + ') ---');
  const NOW = Date.now();
  // A. Cache says OPEN, Sheet says teacher already closed -> must be rejected
  {
    const closedAt = NOW - 5000;
    const env = buildEnv([row({ closesAt: closedAt, manual: iso(closedAt) })]);
    env.cacheStore['ALL_LATEST_SES_V373'] = sesCacheObj('SES_C1_1', NOW + 3600e3);
    const res = checkIn(env, NOW);
    if (EXPECT_BUG) assert.strictEqual(res.code, 'REACHED_CREDENTIAL_CHECK', 'legacy bug: stale cache accepted check-in after close');
    else assert.strictEqual(res.code, 'ERR_SESSION_CLOSED', 'A: closed session must reject even if cache says open');
  }
  // B. Cache says NO session, Sheet has an open one -> must be accepted
  {
    const env = buildEnv([row()]);
    env.cacheStore['ALL_LATEST_SES_V373'] = JSON.stringify({ _lastRow: 1, map: {} });
    const res = checkIn(env, NOW);
    if (EXPECT_BUG) assert.strictEqual(res.code, 'ERR_SESSION_CLOSED', 'legacy bug: freshly opened session reported as closed');
    else assert.strictEqual(res.code, 'REACHED_CREDENTIAL_CHECK', 'B: open session must be accepted even if cache says none');
  }
  // C. Normal open session, no cache -> accepted
  {
    const env = buildEnv([row()]);
    assert.strictEqual(checkIn(env, NOW).code, 'REACHED_CREDENTIAL_CHECK', 'C: normal open session accepted');
  }
  // D. Closed session, no cache -> rejected
  {
    const env = buildEnv([row({ closesAt: NOW - 5000, manual: iso(NOW - 5000) })]);
    assert.strictEqual(checkIn(env, NOW).code, 'ERR_SESSION_CLOSED', 'D: closed session rejected');
  }
  if (EXPECT_BUG) { console.log('OK (legacy bug reproduced)'); return; }
  // E. Request arrived BEFORE the manual close but waited for the lock -> still accepted
  {
    const closedAt = NOW;
    const env = buildEnv([row({ closesAt: closedAt, manual: iso(closedAt) })]);
    env.cacheStore['ALL_LATEST_SES_V373'] = sesCacheObj('SES_C1_1', NOW + 3600e3);
    assert.strictEqual(checkIn(env, NOW - 2000).code, 'REACHED_CREDENTIAL_CHECK', 'E: request arriving before close is honoured');
  }
  // F. Cached sessionId no longer matches the row (session deleted/replaced) -> rejected
  {
    const env = buildEnv([row({ id: 'SES_C1_OTHER' })]);
    env.cacheStore['ALL_LATEST_SES_V373'] = sesCacheObj('SES_C1_1', NOW + 3600e3);
    assert.strictEqual(checkIn(env, NOW).code, 'ERR_SESSION_CLOSED', 'F: mismatched session id rejected');
  }
  // G. Window expired by time though not manually closed -> rejected
  {
    const env = buildEnv([row({ closesAt: NOW - 1000 })]);
    env.cacheStore['ALL_LATEST_SES_V373'] = sesCacheObj('SES_C1_1', NOW + 3600e3);
    assert.strictEqual(checkIn(env, NOW).code, 'ERR_SESSION_CLOSED', 'G: expired window rejected');
  }
  console.log('OK');
}

// ---------- Test 3: static checks ----------
function testStatic() {
  console.log('--- Test 3: flush-before-invalidate + version consistency ---');
  const flushed = (backendSrc.match(/SpreadsheetApp\.flush\(\);\s*\n\s*invalidateClassCache\(classId\);/g) || []).length;
  assert.ok(flushed >= 7, 'flush() must precede invalidateClassCache in start/close/R2/extend/reopen/set-mode/cancel (found ' + flushed + ')');
  const ver = (backendSrc.match(/SYSTEM_VERSION = '([\d.]+)'/) || [])[1];
  assert.ok(path.basename(backendPath) === 'code' + ver + '.text', 'file name must match SYSTEM_VERSION (' + ver + ')');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  (html.match(/\?v=[\d.]+/g) || []).forEach(v => assert.strictEqual(v, '?v=' + ver, 'cache buster must match ' + ver));
  console.log('OK');
}

if (!EXPECT_BUG) { testLegacyEndpoints(); }
testSessionConsistency();
if (!EXPECT_BUG) { testStatic(); }
console.log(EXPECT_BUG ? 'LEGACY BUG REPRODUCTION DONE' : 'ALL v3.7.6 SESSION TESTS PASSED!');
