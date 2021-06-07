import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateManifest, TOOL_ID, LIMITS } from '../src/index.mjs';

const manifest = { name: 'Synthetic app', short_name: 'App', start_url: '/app/home', scope: '/app/', display: 'standalone', icons: [{ src: '/app/icon.png', sizes: '192x192', type: 'image/png' }] };
const site = { schemaVersion: '1', origin: 'https://example.invalid', manifestPath: '/app/manifest.webmanifest', pagesComplete: true, assetsComplete: true, pages: ['/app/home'], assets: [{ path: '/app/icon.png', width: 192, height: 192, mime: 'image/png' }, { path: '/app/sw.js', mime: 'application/javascript' }], offline: { complete: true, serviceWorker: '/app/sw.js', shellPaths: ['/app/home'], navigationResult: 'pass' } };

test('valid manifest and separately observed offline shell pass without claiming live capability', () => {
  const r = evaluateManifest(manifest, site);
  assert.equal(TOOL_ID, 'pwa-manifest-auditor');
  assert.equal(r.status, 'pass'); assert.deepEqual(r.findings, []);
  assert.equal(r.offlineEvidence, 'reported-pass');
  assert.equal(JSON.stringify(r).includes('example.invalid'), false);
});
test('start URL outside declared scope fails', () => {
  const r = evaluateManifest({ ...manifest, start_url: '/other/home' }, { ...site, pages: ['/app/home', '/other/home'] });
  assert.equal(r.status, 'fail'); assert.deepEqual(r.findings.map(f => f.ruleId), ['start-outside-scope']);
});
test('missing linked icon in complete inventory fails', () => {
  const d = structuredClone(site); d.assets = d.assets.filter(a => a.path !== '/app/icon.png');
  const r = evaluateManifest(manifest, d);
  assert.equal(r.status, 'fail'); assert.equal(r.findings[0].ruleId, 'icon-missing');
});
test('missing icon in partial asset inventory is incomplete instead of asserted missing', () => {
  const d = structuredClone(site); d.assetsComplete = false; d.assets = d.assets.filter(a => a.path !== '/app/icon.png');
  const r = evaluateManifest(manifest, d);
  assert.equal(r.status, 'incomplete'); assert.equal(r.findings.some(f => f.ruleId === 'asset-inventory-partial'), true);
  assert.equal(r.findings.some(f => f.ruleId === 'icon-missing'), false);
});
test('explicitly partial whole-site export cannot pass through complete sublists', () => {
  const r = evaluateManifest(manifest, { ...site, complete: false });
  assert.equal(r.status, 'incomplete');
});
test('declared icon size differs from exported local metadata', () => {
  const d = structuredClone(site); d.assets[0].width = 256;
  const r = evaluateManifest(manifest, d);
  assert.equal(r.status, 'fail'); assert.equal(r.findings[0].ruleId, 'icon-dimension-mismatch');
});
test('missing icon dimensions report the real source asset ordinal', () => {
  const d = structuredClone(site); delete d.assets[0].width;
  const r = evaluateManifest(manifest, d);
  assert.equal(r.status, 'incomplete');
  assert.equal(r.findings[0].ruleId, 'icon-invalid');
  assert.deepEqual(r.findings[0].location, { file: '@site', pointer: '/assets/0' });
});
test('manifest correctness alone does not assert an offline-capable verdict', () => {
  const d = structuredClone(site); delete d.offline;
  const r = evaluateManifest(manifest, d);
  assert.equal(r.status, 'incomplete'); assert.equal(r.offlineEvidence, 'unverified');
});
test('captured offline failure is reported as failure', () => {
  const d = structuredClone(site); d.offline.navigationResult = 'fail';
  const r = evaluateManifest(manifest, d);
  assert.equal(r.status, 'fail'); assert.equal(r.offlineEvidence, 'reported-fail');
});
test('offline pass without any declared shell path is incomplete', () => {
  const d = structuredClone(site); d.offline.shellPaths = [];
  const r = evaluateManifest(manifest, d);
  assert.equal(r.status, 'incomplete'); assert.equal(r.offlineEvidence, 'unverified');
  assert.equal(r.findings.some(f => f.ruleId === 'offline-unverified'), true);
});
test('duplicate or ambiguous asset identity cannot prove icon exists', () => {
  const d = structuredClone(site); d.assets.push({ ...d.assets[0] });
  const r = evaluateManifest(manifest, d);
  assert.equal(r.status, 'incomplete'); assert.equal(r.findings.some(f => f.ruleId === 'asset-duplicate'), true);
});
test('relative start and scope resolve beside manifest without a false finding', () => {
  const r = evaluateManifest({ ...manifest, start_url: 'home', scope: './', icons: [{ ...manifest.icons[0], src: 'icon.png' }] }, site);
  assert.equal(r.status, 'pass'); assert.deepEqual(r.findings, []);
});
test('Unicode and equivalent percent-encoded inventory paths match URL references', () => {
  const m = structuredClone(manifest), d = structuredClone(site);
  m.start_url = '/app/caf\u00e9';
  m.icons[0].src = '/app/ic\u00f4ne.png';
  d.pages[0] = '/app/caf\u00e9';
  d.assets[0].path = '/app/ic%C3%B4ne.png';
  d.offline.shellPaths[0] = '/app/caf%C3%A9';
  const r = evaluateManifest(m, d);
  assert.equal(r.status, 'pass'); assert.deepEqual(r.findings, []);
});
test('unusable control or bidi inventory paths are incomplete evidence', () => {
  for (const bad of ['/app/other\u0000', '/app/other\u202e', '/app/other%00']) {
    const d = structuredClone(site); d.pages.push(bad);
    const r = evaluateManifest(manifest, d);
    assert.equal(r.status, 'incomplete');
    assert.equal(r.findings[0].ruleId, 'site-invalid');
  }
  const d = structuredClone(site); d.assets[0].path = '/app/ic\u00f4ne\u202e.png';
  assert.equal(evaluateManifest(manifest, d).status, 'incomplete');
  d.assets[0].path = '/app/icon.png'; d.offline.shellPaths[0] = '/app/other%00';
  assert.equal(evaluateManifest(manifest, d).status, 'incomplete');
});
test('equivalent encoded and Unicode page identities are incomplete duplicates', () => {
  const d = structuredClone(site);
  d.pages.push('/app/caf\u00e9', '/app/caf%C3%A9');
  const r = evaluateManifest(manifest, d);
  assert.equal(r.status, 'incomplete');
  assert.ok(r.findings.some(f => f.ruleId === 'page-duplicate'));
});
test('JSON nesting accepts the declared depth and refuses the next level on either input', () => {
  assert.equal(LIMITS.depth, 16);
  for (const side of ['manifest', 'site']) {
    const m = structuredClone(manifest), d = structuredClone(site);
    let cursor = side === 'manifest' ? m : d;
    for (let i = 0; i < LIMITS.depth; i++) { cursor.extra = {}; cursor = cursor.extra; }
    assert.equal(evaluateManifest(m, d).status, 'pass');
    cursor.extra = {};
    const r = evaluateManifest(m, d);
    assert.equal(r.status, 'incomplete');
    assert.equal(r.findings[0].ruleId, 'depth-limit');
  }
});
test('legal display name whitespace does not create a false incomplete result', () => {
  const r = evaluateManifest({ ...manifest, name: ' Synthetic app ' }, site);
  assert.equal(r.status, 'pass'); assert.deepEqual(r.findings, []);
});
test('remote icon is unverified, never fetched or asserted missing', () => {
  const r = evaluateManifest({ ...manifest, icons: [{ ...manifest.icons[0], src: 'https://outside.invalid/icon.png' }] }, site);
  assert.equal(r.status, 'incomplete'); assert.equal(r.findings.some(f => f.ruleId === 'icon-remote'), true);
  assert.equal(JSON.stringify(r).includes('outside.invalid'), false);
});
test('icon count accepts 100 and refuses 101', () => {
  const icons = Array.from({ length: 100 }, () => ({ ...manifest.icons[0] }));
  assert.equal(evaluateManifest({ ...manifest, icons }, site).status, 'pass');
  icons.push({ ...manifest.icons[0] });
  const over = evaluateManifest({ ...manifest, icons }, site);
  assert.equal(over.status, 'incomplete'); assert.equal(over.findings[0].ruleId, 'record-limit');
});
test('page and asset record bounds accept 1000 and refuse 1001', () => {
  const d = structuredClone(site);
  d.pages = ['/app/home', ...Array.from({ length: 999 }, (_, i) => `/app/p${i}`)];
  assert.equal(evaluateManifest(manifest, d).status, 'pass');
  d.pages.push('/app/extra');
  assert.equal(evaluateManifest(manifest, d).findings[0].ruleId, 'record-limit');
  d.pages.pop();
  d.assets = [...site.assets, ...Array.from({ length: 998 }, (_, i) => ({ path: `/app/a${i}.txt`, mime: 'text/plain' }))];
  assert.equal(evaluateManifest(manifest, d).status, 'pass');
  d.assets.push({ path: '/app/extra.txt', mime: 'text/plain' });
  assert.equal(evaluateManifest(manifest, d).findings[0].ruleId, 'record-limit');
});
test('offline shell path count accepts 100 and refuses 101', () => {
  const d = structuredClone(site); d.offline.shellPaths = Array.from({ length: 100 }, () => '/app/home');
  assert.equal(evaluateManifest(manifest, d).status, 'pass');
  d.offline.shellPaths.push('/app/home');
  const over = evaluateManifest(manifest, d); assert.equal(over.status, 'incomplete');
  assert.equal(over.findings[0].ruleId, 'record-limit');
});
test('injected evaluation time accepts 5000 and refuses 5001 milliseconds', () => {
  const clock = limit => { let first = true; return () => { if (first) { first = false; return 0; } return limit; }; };
  assert.equal(evaluateManifest(manifest, site, { now: clock(5000) }).status, 'pass');
  const over = evaluateManifest(manifest, site, { now: clock(5001) });
  assert.equal(over.status, 'incomplete'); assert.equal(over.findings[0].ruleId, 'time-limit');
});
test('display name bound accepts 200 and refuses 201 UTF-16 units', () => {
  assert.equal(evaluateManifest({ ...manifest, name: 'x'.repeat(200) }, site).status, 'pass');
  const over = evaluateManifest({ ...manifest, name: 'x'.repeat(201) }, site);
  assert.equal(over.status, 'incomplete'); assert.equal(over.findings[0].ruleId, 'manifest-invalid');
});
