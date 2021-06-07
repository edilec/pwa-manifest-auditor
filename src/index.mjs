export const TOOL_ID = 'pwa-manifest-auditor';
export const LIMITS = Object.freeze({ manifestBytes: 262_144, siteBytes: 1_048_576, icons: 100, pages: 1000, assets: 1000, shellPaths: 100, depth: 16, milliseconds: 5000 });
export const RULE_SEVERITY = Object.freeze({ 'manifest-invalid': 'error', 'site-invalid': 'error', 'input-unreadable': 'error', 'byte-limit': 'error', 'record-limit': 'error', 'depth-limit': 'error', 'time-limit': 'error', 'page-inventory-partial': 'error', 'asset-inventory-partial': 'error', 'offline-unverified': 'error', 'asset-duplicate': 'error', 'page-duplicate': 'error', 'icon-remote': 'error', 'icon-invalid': 'error', 'start-page-missing': 'error', 'start-outside-scope': 'error', 'icon-missing': 'error', 'icon-dimension-mismatch': 'error', 'icon-type-mismatch': 'error', 'service-worker-missing': 'error', 'shell-path-missing': 'error', 'offline-navigation-failed': 'error' });
const INCOMPLETE = new Set(['manifest-invalid', 'site-invalid', 'input-unreadable', 'byte-limit', 'record-limit', 'depth-limit', 'time-limit', 'page-inventory-partial', 'asset-inventory-partial', 'offline-unverified', 'asset-duplicate', 'page-duplicate', 'icon-remote', 'icon-invalid']);
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const cmp = (a, b) => a === b ? 0 : a < b ? -1 : 1;
const forbidden = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\p{Cf}]/u;
const label = x => typeof x === 'string' && x.length > 0 && x.length <= 200 && x.trim().length > 0 && !forbidden.test(x);
function canonicalPath(x) {
  if (typeof x !== 'string' || x.length === 0 || x.length > 256 || !x.startsWith('/') || x.startsWith('//') || /[?#\\]/.test(x) || forbidden.test(x)) return null;
  try {
    const parts = x.slice(1).split('/');
    const normalized = parts.map((part, i) => {
      if (part === '' && i !== parts.length - 1) throw new Error('empty segment');
      const decoded = decodeURIComponent(part);
      if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\') || forbidden.test(decoded)) throw new Error('unusable segment');
      return encodeURIComponent(decoded);
    });
    return `/${normalized.join('/')}`;
  } catch { return null; }
}
const localPath = x => canonicalPath(x) !== null;
function tooDeep(value) {
  const stack = [[value, 0]];
  while (stack.length) {
    const [item, depth] = stack.pop();
    if (depth > LIMITS.depth) return true;
    if (item && typeof item === 'object') for (const child of Object.values(item)) stack.push([child, depth + 1]);
  }
  return false;
}
function add(findings, ruleId, file, pointer, message) { if (!Object.hasOwn(RULE_SEVERITY, ruleId)) throw new Error('Unknown rule'); findings.push({ ruleId, severity: RULE_SEVERITY[ruleId], message, location: { file, pointer } }); }
function report(findings, checked, offlineEvidence) {
  findings.sort((a, b) => cmp(a.location.file, b.location.file) || cmp(a.location.pointer, b.location.pointer) || cmp(a.ruleId, b.ruleId));
  const status = findings.some(f => INCOMPLETE.has(f.ruleId)) ? 'incomplete' : findings.length ? 'fail' : 'pass';
  return { schemaVersion: '1', tool: TOOL_ID, status, summary: { checked, errors: findings.length, warnings: 0 }, offlineEvidence, findings };
}
export function incomplete(ruleId, message, file = '@manifest') { const findings = []; add(findings, ruleId, file, '', message); return report(findings, 0, 'unverified'); }
function originOf(value) {
  if (typeof value !== 'string') return null;
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && u.pathname === '/' && !u.search && !u.hash ? u.origin : null; }
  catch { return null; }
}
function resolveLocal(raw, base, origin) {
  if (typeof raw !== 'string' || raw.length > 256 || !raw || forbidden.test(raw)) return { invalid: true };
  try {
    const u = new URL(raw, base);
    if (u.origin !== origin) return { remote: true };
    if (u.search || u.hash) return { invalid: true };
    const path = canonicalPath(u.pathname);
    return path === null ? { invalid: true } : { path };
  } catch { return { invalid: true }; }
}
function keysUnique(values) { return new Set(values).size === values.length; }

export function evaluateManifest(manifest, site, { now = () => performance.now() } = {}) {
  const started = now(), findings = []; let checked = 0, offlineEvidence = 'unverified';
  const time = () => now() - started > LIMITS.milliseconds;
  if (tooDeep(manifest)) return incomplete('depth-limit', 'Manifest JSON nesting exceeds depth 16.');
  if (tooDeep(site)) return incomplete('depth-limit', 'Site JSON nesting exceeds depth 16.', '@site');
  if (!record(manifest) || !label(manifest.name) || !label(manifest.short_name) || !['standalone', 'fullscreen', 'minimal-ui', 'browser'].includes(manifest.display) || !Array.isArray(manifest.icons) || manifest.icons.length === 0 || typeof manifest.start_url !== 'string' || typeof manifest.scope !== 'string') return incomplete('manifest-invalid', 'Manifest fields are missing or unusable.');
  if (!record(site) || site.schemaVersion !== '1' || !originOf(site.origin) || !localPath(site.manifestPath) || !Array.isArray(site.pages) || !Array.isArray(site.assets) || typeof site.pagesComplete !== 'boolean' || typeof site.assetsComplete !== 'boolean') return incomplete('site-invalid', 'Built-site inventory is missing or unusable.', '@site');
  if (Object.hasOwn(site, 'complete') && site.complete !== true) return incomplete('site-invalid', 'Built-site inventory explicitly declares incomplete coverage.', '@site');
  if (manifest.icons.length > LIMITS.icons || site.pages.length > LIMITS.pages || site.assets.length > LIMITS.assets) return incomplete('record-limit', 'Manifest or inventory exceeds record limit.');
  if (site.pages.some(x => !localPath(x)) || site.assets.some(x => !record(x) || !localPath(x.path) || !label(x.mime) || (x.width !== undefined && (!Number.isInteger(x.width) || x.width < 1 || x.width > 10000)) || (x.height !== undefined && (!Number.isInteger(x.height) || x.height < 1 || x.height > 10000)))) return incomplete('site-invalid', 'Built-site inventory contains unusable paths or asset metadata.', '@site');
  const pages = site.pages.map(canonicalPath), assets = site.assets.map((x, ordinal) => ({ ...x, canonical: canonicalPath(x.path), ordinal }));
  if (!keysUnique(pages)) add(findings, 'page-duplicate', '@site', '/pages', 'Page inventory has duplicate identities.');
  if (!keysUnique(assets.map(x => x.canonical))) add(findings, 'asset-duplicate', '@site', '/assets', 'Asset inventory has duplicate identities.');
  if (!site.pagesComplete) add(findings, 'page-inventory-partial', '@site', '/pagesComplete', 'Page inventory is explicitly partial.');
  if (!site.assetsComplete) add(findings, 'asset-inventory-partial', '@site', '/assetsComplete', 'Asset inventory is explicitly partial.');
  const origin = originOf(site.origin), base = new URL(site.manifestPath, origin).href;
  const scope = resolveLocal(manifest.scope, base, origin), start = resolveLocal(manifest.start_url, base, origin);
  if (!scope.path || !scope.path.endsWith('/') || !start.path) add(findings, 'manifest-invalid', '@manifest', '', 'Start URL or scope cannot be evaluated locally.');
  else {
    checked++;
    if (!start.path.startsWith(scope.path)) add(findings, 'start-outside-scope', '@manifest', '/start_url', 'Start URL lies outside declared scope.');
    if (!pages.includes(start.path) && site.pagesComplete && keysUnique(pages)) add(findings, 'start-page-missing', '@manifest', '/start_url', 'Start page is absent from complete built-site inventory.');
  }
  for (const [i, icon] of manifest.icons.entries()) {
    if (time()) return incomplete('time-limit', 'Evaluation exceeded 5000 milliseconds.');
    const pointer = `/icons/${i}`;
    if (!record(icon) || typeof icon.sizes !== 'string' || !/^([1-9]\d{0,3})x([1-9]\d{0,3})$/.test(icon.sizes) || !['image/png', 'image/jpeg', 'image/webp'].includes(icon.type)) { add(findings, 'icon-invalid', '@manifest', pointer, 'Icon declaration is unsupported or invalid.'); continue; }
    const url = resolveLocal(icon.src, base, origin);
    if (url.remote) { add(findings, 'icon-remote', '@manifest', `${pointer}/src`, 'Remote icon cannot be verified from local inventory.'); continue; }
    if (!url.path) { add(findings, 'icon-invalid', '@manifest', pointer, 'Icon reference is invalid.'); continue; }
    checked++;
    const matches = assets.filter(a => a.canonical === url.path);
    if (matches.length > 1) continue;
    if (!matches.length) { if (site.assetsComplete) add(findings, 'icon-missing', '@manifest', `${pointer}/src`, 'Icon is absent from complete asset inventory.'); continue; }
    const asset = matches[0], [width, height] = icon.sizes.split('x').map(Number);
    if (asset.width === undefined || asset.height === undefined) add(findings, 'icon-invalid', '@site', `/assets/${asset.ordinal}`, 'Icon dimensions were not exported.');
    else if (asset.width !== width || asset.height !== height) add(findings, 'icon-dimension-mismatch', '@manifest', `${pointer}/sizes`, 'Icon dimensions differ from local asset metadata.');
    if (asset.mime !== icon.type) add(findings, 'icon-type-mismatch', '@manifest', `${pointer}/type`, 'Icon media type differs from local asset metadata.');
  }
  const offline = site.offline;
  if (!record(offline) || offline.complete !== true || !localPath(offline.serviceWorker) || !Array.isArray(offline.shellPaths) || offline.shellPaths.length === 0 || !['pass', 'fail', 'unobserved'].includes(offline.navigationResult)) add(findings, 'offline-unverified', '@site', '/offline', 'Offline shell evidence is absent or incomplete.');
  else if (offline.shellPaths.length > LIMITS.shellPaths || offline.shellPaths.some(x => !localPath(x))) add(findings, 'record-limit', '@site', '/offline/shellPaths', 'Offline shell path list exceeds declared limit or is unusable.');
  else {
    checked++;
    if (assets.filter(a => a.canonical === canonicalPath(offline.serviceWorker)).length === 0 && site.assetsComplete) add(findings, 'service-worker-missing', '@site', '/offline/serviceWorker', 'Declared service-worker file is absent from complete inventory.');
    for (const [i, shell] of offline.shellPaths.entries()) {
      if (time()) return incomplete('time-limit', 'Evaluation exceeded 5000 milliseconds.');
      const canonical = canonicalPath(shell);
      if (!pages.includes(canonical) && !assets.some(a => a.canonical === canonical) && site.pagesComplete && site.assetsComplete) add(findings, 'shell-path-missing', '@site', `/offline/shellPaths/${i}`, 'Declared offline shell path is absent from complete inventory.');
    }
    if (offline.navigationResult === 'unobserved') add(findings, 'offline-unverified', '@site', '/offline/navigationResult', 'Offline navigation was not observed in the export.');
    else if (offline.navigationResult === 'fail') { offlineEvidence = 'reported-fail'; add(findings, 'offline-navigation-failed', '@site', '/offline/navigationResult', 'Captured offline navigation failed.'); }
    else offlineEvidence = 'reported-pass';
  }
  if (time()) return incomplete('time-limit', 'Evaluation exceeded 5000 milliseconds.');
  return report(findings, checked, offlineEvidence);
}
