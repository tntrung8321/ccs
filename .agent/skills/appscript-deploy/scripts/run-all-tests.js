const { spawnSync } = require('child_process');
const path = require('path');

const scripts = ['test-deploy-appscript.js', 'test-v371-ux.js', 'test-v376-session.js', 'test-core.js', 'test-sim-class.js', 'test-attendance-rules.js', 'test-sync-marks.js'];

const results = scripts.map((name) => {
  const r = spawnSync(process.execPath, [path.join(__dirname, name)], { stdio: 'inherit' });
  return { name, code: r.status === null ? 1 : r.status };
});

console.log('');
for (const r of results) {
  console.log(`${r.code === 0 ? 'PASS' : 'FAIL'} ${r.name} (exit ${r.code})`);
}

process.exit(results.some((r) => r.code !== 0) ? 1 : 0);
