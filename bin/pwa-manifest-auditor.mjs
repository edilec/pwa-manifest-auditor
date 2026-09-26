#!/usr/bin/env node
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep } from 'node:path';
import { evaluateManifest, incomplete, LIMITS } from '../src/index.mjs';

const argv = process.argv.slice(2);
if (argv.length === 1 && argv[0] === '--help') {
  process.stdout.write('Usage: pwa-manifest-auditor --root DIR --manifest FILE --site FILE\nReads local exports and writes one JSON report to stdout.\n');
} else {
  let root, manifestName, siteName;
  try {
    for (let i = 0; i < argv.length; i++) {
      const option = argv[i];
      if (!['--root', '--manifest', '--site'].includes(option) || i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error('invalid option');
      const value = argv[++i];
      if (option === '--root') { if (root) throw new Error('repeat root'); root = value; }
      if (option === '--manifest') { if (manifestName) throw new Error('repeat manifest'); manifestName = value; }
      if (option === '--site') { if (siteName) throw new Error('repeat site'); siteName = value; }
    }
    if (!root || !manifestName || !siteName || isAbsolute(manifestName) || isAbsolute(siteName)) throw new Error('required options');
    root = await realpath(root);
    if (!(await stat(root)).isDirectory()) throw new Error('root');
  } catch { process.stderr.write('Invalid configuration. Use --help.\n'); process.exit(2); }

  const inside = file => { const rel = relative(root, file); return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)); };
  async function document(name, limit) {
    const path = await realpath(resolve(root, name));
    if (!inside(path)) throw new Error('input-unreadable');
    const metadata = await stat(path);
    if (!metadata.isFile()) throw new Error('input-unreadable');
    if (metadata.size > limit) throw new Error('byte-limit');
    const bytes = await readFile(path, { signal: AbortSignal.timeout(LIMITS.milliseconds) });
    if (bytes.length > limit) throw new Error('byte-limit');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  }
  let manifest, site, result;
  try { manifest = await document(manifestName, LIMITS.manifestBytes); }
  catch (error) { result = incomplete(error.message === 'byte-limit' ? 'byte-limit' : 'input-unreadable', error.message === 'byte-limit' ? 'Manifest exceeds 262144 bytes.' : 'Manifest could not be read or decoded.'); }
  if (!result) {
    try { site = await document(siteName, LIMITS.siteBytes); }
    catch (error) { result = incomplete(error.message === 'byte-limit' ? 'byte-limit' : 'input-unreadable', error.message === 'byte-limit' ? 'Site inventory exceeds 1048576 bytes.' : 'Site inventory could not be read or decoded.', '@site'); }
  }
  if (!result) result = evaluateManifest(manifest, site);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === 'pass' ? 0 : result.status === 'fail' ? 1 : 2;
}
