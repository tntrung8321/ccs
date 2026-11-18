/**
 * Frontend tests for v3.11.0 GPS UI helpers (pure functions extracted from js/*.js and run in a vm).
 * Usage: node test-gps-ui.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../../../..');
const teaSrc = fs.readFileSync(path.join(ROOT, 'js/teacher.js'), 'utf8');
const scSrc = fs.readFileSync(path.join(ROOT, 'js/schedule-config.js'), 'utf8');
const stSrc = fs.readFileSync(path.join(ROOT, 'js/student.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let failures = 0;
function check(name, fn) {
  try { fn(); console.log('  OK   ' + name); }
  catch (e) { failures++; console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n')[0]); }
}

function extractFn(src, name) {
  const start = src.search(new RegExp('(?:async )?function ' + name + '\\('));
  assert.ok(start >= 0, 'cannot find ' + name);
  let i = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('unbalanced ' + name);
}

const teaCtx = vm.createContext({});
vm.runInContext(
  ['parseCoordinateInput', 'haversineMeters', 'formatMetersLabel', 'computeHeadcountExcess', 'headcountSuspectKey', 'rankHeadcountSuspects']
    .map(n => extractFn(teaSrc, n)).join('\n'),
  teaCtx
);
const scCtx = vm.createContext({ navigator: {} });
vm.runInContext(
  ['analyzeGpsReadingTrail', 'sampleGpsReadings', 'inspectGpsForSpoofing'].map(n => extractFn(scSrc, n)).join('\n'),
  scCtx
);

console.log('--- parseCoordinateInput ---');
const P = (s) => teaCtx.parseCoordinateInput(s);
const eq = (a, lat, lng) => { assert.ok(a, 'null'); assert.strictEqual(a.lat, lat); assert.strictEqual(a.lng, lng); };
check('plain "lat,lng"', () => eq(P('10.8221, 106.6868'), 10.8221, 106.6868));
check('plain with space only and negatives', () => eq(P('-33.8688 151.2093'), -33.8688, 151.2093));
check('semicolon separator', () => eq(P('48.85;2.35'), 48.85, 2.35));
check('Google Maps @lat,lng,zoom link', () => eq(P('https://www.google.com/maps/place/Foo/@21.0285,105.8542,17z/data=!3m1'), 21.0285, 105.8542));
check('q=lat,lng', () => eq(P('https://maps.google.com/?q=10.7769,106.7009'), 10.7769, 106.7009));
check('q=lat%2Clng (encoded)', () => eq(P('https://www.google.com/maps?q=48.8566%2C2.3522'), 48.8566, 2.3522));
check('ll=lat,lng', () => eq(P('https://maps.google.com/maps?ll=35.6762,139.6503&z=15'), 35.6762, 139.6503));
check('query=lat,lng', () => eq(P('https://www.google.com/maps/search/?api=1&query=10.5,106.5'), 10.5, 106.5));
check('out of range rejected', () => { assert.strictEqual(P('91,0'), null); assert.strictEqual(P('10,181'), null); assert.strictEqual(P('@95.1,10.2'), null); });
check('(0,0) rejected', () => { assert.strictEqual(P('0,0'), null); assert.strictEqual(P('0.0, 0.0'), null); });
check('garbage / empty rejected', () => { assert.strictEqual(P(''), null); assert.strictEqual(P('hello'), null); assert.strictEqual(P(null), null); assert.strictEqual(P('12'), null); });

console.log('--- haversine / label ---');
check('haversine ~111.2 km per degree latitude', () => {
  const d = teaCtx.haversineMeters(10, 106, 11, 106);
  assert.ok(Math.abs(d - 111195) < 300, String(d));
  assert.strictEqual(teaCtx.haversineMeters(10, 106, 10, 106), 0);
});
check('formatMetersLabel m vs km', () => {
  assert.strictEqual(teaCtx.formatMetersLabel(250.4), '250 m');
  assert.strictEqual(teaCtx.formatMetersLabel(20400), '20.4 km');
});

console.log('--- headcount (D10) ---');
check('excess only when counted < marked', () => {
  const f = teaCtx.computeHeadcountExcess;
  assert.strictEqual(f(30, '27'), 3);
  assert.strictEqual(f(30, '30'), 0);
  assert.strictEqual(f(30, '35'), 0);
  assert.strictEqual(f(30, ''), 0);
  assert.strictEqual(f(30, 'abc'), 0);
  assert.strictEqual(f(30, '-2'), 0);
  assert.strictEqual(f(30, null), 0);
  assert.strictEqual(f(30, '0'), 30);
});
check('ranking: spoof/duplicate > provisional > larger distM; unmarked last in original order', () => {
  const roster = [
    { studentId: 'U1', status: '-' },
    { studentId: 'A', status: 'P', distM: 10 },
    { studentId: 'B', status: 'P', distM: 90, provisional: true },
    { studentId: 'C', status: 'P', distM: 5, suspectReasons: ['DUPLICATE_COORDS'] },
    { studentId: 'D', status: 'P', distM: 120 },
    { studentId: 'E', status: 'L', distM: 3, suspectReasons: ['FROZEN_GPS'] },
    { studentId: 'U2', status: '-' }
  ];
  const out = Array.from(teaCtx.rankHeadcountSuspects(roster, s => s.status === 'P' || s.status === 'L').map(s => s.studentId));
  assert.deepStrictEqual(out, ['C', 'E', 'B', 'D', 'A', 'U1', 'U2']);
});
check('ranking tolerates missing fields (old backend)', () => {
  const roster = [{ studentId: 'A', status: 'P' }, { studentId: 'B', status: 'P' }];
  const out = Array.from(teaCtx.rankHeadcountSuspects(roster, s => s.status === 'P').map(s => s.studentId));
  assert.deepStrictEqual(out, ['A', 'B']);
});
check('ranking: suspectReasons given as string and mock reasons count', () => {
  const roster = [{ studentId: 'A', status: 'P', distM: 50 }, { studentId: 'B', status: 'P', distM: 1, suspectReasons: 'MOCK_ACCURACY_PATTERN' }];
  const out = Array.from(teaCtx.rankHeadcountSuspects(roster, () => true).map(s => s.studentId));
  assert.deepStrictEqual(out, ['B', 'A']);
});

console.log('--- FROZEN_GPS / ROUND_ACCURACY (D11) ---');
const R = (lat, lng, acc) => ({ lat, lng, acc });
const mkPos = (acc = 17.3) => ({ timestamp: Date.now(), coords: { latitude: 10.8, longitude: 106.6, accuracy: acc, altitude: 5, altitudeAccuracy: 3 } });
check('3 identical readings -> FROZEN_GPS', () => {
  assert.strictEqual(scCtx.analyzeGpsReadingTrail([R(10.8, 106.6, 12.5), R(10.8, 106.6, 12.5), R(10.8, 106.6, 12.5)]), 'FROZEN_GPS');
});
check('jittering readings -> no flag', () => {
  assert.strictEqual(scCtx.analyzeGpsReadingTrail([R(10.8, 106.6, 12.5), R(10.80001, 106.60002, 13.1), R(10.8, 106.6, 12.5)]), '');
});
check('round accuracy repeated with moving coords -> ROUND_ACCURACY', () => {
  assert.strictEqual(scCtx.analyzeGpsReadingTrail([R(10.8, 106.6, 10), R(10.80001, 106.6, 10), R(10.80002, 106.60001, 10)]), 'ROUND_ACCURACY');
});
check('same non-round accuracy with moving coords -> no flag', () => {
  assert.strictEqual(scCtx.analyzeGpsReadingTrail([R(10.8, 106.6, 12.4), R(10.80001, 106.6, 12.4), R(10.80002, 106.6, 12.4)]), '');
});
check('fewer than 3 readings / invalid input -> no flag', () => {
  assert.strictEqual(scCtx.analyzeGpsReadingTrail([R(10.8, 106.6, 10), R(10.8, 106.6, 10)]), '');
  assert.strictEqual(scCtx.analyzeGpsReadingTrail(null), '');
  assert.strictEqual(scCtx.analyzeGpsReadingTrail([]), '');
});
check('inspectGpsForSpoofing: soft flag, never hardBlock, real device untouched', () => {
  const frozen = scCtx.inspectGpsForSpoofing(mkPos(), [R(1, 2, 9), R(1, 2, 9), R(1, 2, 9)]);
  assert.deepStrictEqual([frozen.suspicious, frozen.hardBlock, frozen.reason], [true, false, 'FROZEN_GPS']);
  const round = scCtx.inspectGpsForSpoofing(mkPos(), [R(1, 2, 20), R(1.00001, 2, 20), R(1.00002, 2, 20)]);
  assert.deepStrictEqual([round.suspicious, round.hardBlock, round.reason], [true, false, 'ROUND_ACCURACY']);
  const real = scCtx.inspectGpsForSpoofing(mkPos(), [R(1, 2, 9.3), R(1.00001, 2.00001, 8.7), R(1.00002, 2, 9.0)]);
  assert.deepStrictEqual([real.suspicious, real.hardBlock], [false, false]);
  const noTrail = scCtx.inspectGpsForSpoofing(mkPos());
  assert.deepStrictEqual([noTrail.suspicious, noTrail.hardBlock], [false, false]);
});

(async () => {
  const mkNav = (emit) => {
    const nav = { geolocation: { watchPosition: (ok) => { const t = emit(ok); return t; }, clearWatch: () => {} } };
    return nav;
  };
  async function run(emit, windowMs) {
    const ctx = vm.createContext({ navigator: mkNav(emit), setTimeout, clearTimeout });
    vm.runInContext(extractFn(scSrc, 'sampleGpsReadings'), ctx);
    const t0 = Date.now();
    const out = await ctx.sampleGpsReadings(mkPos(10), windowMs);
    return { out, ms: Date.now() - t0 };
  }
  try {
    const frozen = await run((ok) => { setTimeout(() => ok(mkPos(10)), 20); setTimeout(() => ok(mkPos(10)), 40); return 1; }, 500);
    assert.strictEqual(frozen.out.length, 3);
    assert.strictEqual(scCtx.analyzeGpsReadingTrail(frozen.out), 'FROZEN_GPS');
    console.log('  OK   sampleGpsReadings frozen stream collects 3 readings');

    const jitter = await run((ok) => { setTimeout(() => ok({ coords: { latitude: 10.80002, longitude: 106.60003, accuracy: 7.7 } }), 20); return 1; }, 3000);
    assert.ok(jitter.ms < 500, 'early exit took ' + jitter.ms);
    assert.strictEqual(scCtx.analyzeGpsReadingTrail(jitter.out), '');
    console.log('  OK   sampleGpsReadings exits early on natural jitter (' + jitter.ms + 'ms)');

    const silent = await run(() => 1, 300);
    assert.ok(silent.ms >= 250 && silent.ms < 1000, String(silent.ms));
    assert.strictEqual(silent.out.length, 1);
    console.log('  OK   sampleGpsReadings bounded by window when the receiver is silent');
  } catch (e) {
    failures++;
    console.log('  FAIL sampleGpsReadings\n       ' + String(e.message).split('\n')[0]);
  }

  console.log('--- getTodayDateKey server offset ---');
  check('uses server todayKey when present, local clock otherwise, safe on bad field', () => {
    const win = {};
    const ctx = vm.createContext({ window: win });
    const ing = extractFn(scSrc, 'ingestServerScheduleData');
    const ingHead = ing.slice(0, ing.indexOf('if (Array.isArray(res.calendarEvents))')) + '}';
    vm.runInContext(extractFn(scSrc, 'formatLocalDateKey_') + extractFn(scSrc, 'getTodayDateKey') + ingHead, ctx);
    const local = ctx.getTodayDateKey();
    ctx.ingestServerScheduleData({ todayKey: 'garbage' });
    ctx.ingestServerScheduleData(null);
    assert.strictEqual(ctx.getTodayDateKey(), local);
    const d = new Date(); d.setDate(d.getDate() + 1);
    const tomorrow = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    ctx.ingestServerScheduleData({ todayKey: tomorrow });
    assert.strictEqual(ctx.getTodayDateKey(), tomorrow);
    ctx.ingestServerScheduleData({ todayKey: local });
    assert.strictEqual(ctx.getTodayDateKey(), local);
  });
  console.log('--- wiring (static) ---');
  check('index.html has center modal, alert, headcount ids used by teacher.js', () => {
    ['center-modal', 'center-map', 'inp-center-coords', 'btn-center-confirm', 'btn-center-mylocation', 'tea-anchor-alert', 'tea-headcount-box', 'inp-headcount', 'btn-open-center-modal']
      .forEach(id => assert.ok(html.includes('id="' + id + '"'), id));
  });
  check('Leaflet pinned to 1.9.4 on cdnjs, OSM tiles with attribution', () => {
    assert.ok(/cdnjs\.cloudflare\.com\/ajax\/libs\/leaflet\/1\.9\.4\//.test(teaSrc));
    assert.ok(/tile\.openstreetmap\.org/.test(teaSrc) && /OpenStreetMap/.test(teaSrc));
    assert.ok(!/<(script|link)[^>]*leaflet/i.test(html), 'Leaflet must not be loaded eagerly in index.html');
  });
  check('start-session flow reacts to ERR_CENTER_REQUIRED and calibrate payload shape', () => {
    assert.ok(/ERR_CENTER_REQUIRED/.test(teaSrc));
    const fn = extractFn(teaSrc, 'confirmCenterModal');
    ['calibrateOnly: true', 'TEACHER_START_SESSION', 'timeZone', 'confirmTimeZone', 'chk-center-tz', 'source'].forEach(k => assert.ok(fn.includes(k), k));
  });
  check('center modal opens on the saved class centre (teacherState.classCenter)', () => {
    const fn = extractFn(teaSrc, 'openCenterModal');
    ['classCenter', 'centerModalState.lat', 'inp.value'].forEach(k => assert.ok(fn.includes(k), k));
  });
  check('student.js handles ANCHOR_OUTLIER_REVERTED and passes trail to inspectGpsForSpoofing', () => {
    assert.ok(stSrc.includes('ANCHOR_OUTLIER_REVERTED'));
    assert.ok(/inspectGpsForSpoofing\(pos, trailReadings\)/.test(stSrc));
  });

  console.log(failures === 0 ? '\nAll GPS UI tests passed.' : '\n' + failures + ' GPS UI test(s) FAILED.');
  process.exit(failures === 0 ? 0 : 1);
})();
