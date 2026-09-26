import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = new URL('../bin/pwa-manifest-auditor.mjs', import.meta.url).pathname;
const manifest = { name: 'Synthetic app', short_name: 'App', start_url: '/app/home', scope: '/app/', display: 'standalone', icons: [{ src: '/app/icon.png', sizes: '192x192', type: 'image/png' }] };
const site = { schemaVersion: '1', origin: 'https://example.invalid', manifestPath: '/app/manifest.webmanifest', pagesComplete: true, assetsComplete: true, pages: ['/app/home'], assets: [{ path: '/app/icon.png', width: 192, height: 192, mime: 'image/png' }, { path: '/app/sw.js', mime: 'application/javascript' }], offline: { complete: true, serviceWorker: '/app/sw.js', shellPaths: ['/app/home'], navigationResult: 'pass' } };
async function fixture(fn, m = manifest, s = site) {
  const root = await mkdtemp(join(tmpdir(), 'pwa-audit-'));
  try {
    await writeFile(join(root, 'manifest.webmanifest'), typeof m === 'string' ? m : JSON.stringify(m));
    await writeFile(join(root, 'site.json'), typeof s === 'string' ? s : JSON.stringify(s));
    return await fn(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
const run = (root, more = []) => spawnSync(process.execPath, [cli, '--root', root, '--manifest', 'manifest.webmanifest', '--site', 'site.json', ...more], { encoding: 'utf8', maxBuffer: 4_194_304 });

test('valid local export passes and invalid scope fails with fixed pointers', async () => {
  await fixture(async root => { const p = run(root); assert.equal(p.status, 0); assert.equal(JSON.parse(p.stdout).status, 'pass'); });
  await fixture(async root => { const p = run(root); assert.equal(p.status, 1); assert.equal(JSON.parse(p.stdout).findings.some(f => f.ruleId === 'start-outside-scope'), true); }, { ...manifest, start_url: '/other/home' });
});
test('missing inventory is incomplete, not manifest-only offline pass', async () => {
  await fixture(async root => {
    const p = spawnSync(process.execPath, [cli, '--root', root, '--manifest', 'manifest.webmanifest', '--site', 'missing.json'], { encoding: 'utf8' });
    assert.equal(p.status, 2); assert.equal(JSON.parse(p.stdout).status, 'incomplete');
  });
});
test('escaping input symlink is refused without disclosing target', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'pwa-outside-'));
  try {
    await writeFile(join(outside, 'private.json'), 'private-sentinel');
    await fixture(async root => {
      await symlink(join(outside, 'private.json'), join(root, 'escape.json'));
      const p = spawnSync(process.execPath, [cli, '--root', root, '--manifest', 'manifest.webmanifest', '--site', 'escape.json'], { encoding: 'utf8' });
      assert.equal(p.status, 2); assert.equal(JSON.parse(p.stdout).status, 'incomplete');
      assert.equal(p.stdout.includes('private-sentinel'), false);
    });
  } finally { await rm(outside, { recursive: true, force: true }); }
});
test('invalid usage exits two with empty stdout', async () => {
  await fixture(async root => { const p = run(root, ['--unknown']); assert.equal(p.status, 2); assert.equal(p.stdout, ''); });
});
test('manifest byte bound accepts 262144 and rejects 262145', async () => {
  const base = JSON.stringify(manifest), exact = base + ' '.repeat(262_144 - Buffer.byteLength(base));
  await fixture(async root => { assert.equal(run(root).status, 0); }, exact);
  await fixture(async root => { const p = run(root); assert.equal(p.status, 2); assert.equal(JSON.parse(p.stdout).findings[0].ruleId, 'byte-limit'); }, exact + ' ');
});
test('site byte bound accepts 1048576 and rejects 1048577', async () => {
  const base = JSON.stringify(site), exact = base + ' '.repeat(1_048_576 - Buffer.byteLength(base));
  await fixture(async root => { assert.equal(run(root).status, 0); }, manifest, exact);
  await fixture(async root => { const p = run(root); assert.equal(p.status, 2); assert.equal(JSON.parse(p.stdout).findings[0].ruleId, 'byte-limit'); }, manifest, exact + ' ');
});
