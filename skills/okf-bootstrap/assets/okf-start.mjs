// Loaded before a tool with `node --import ./scripts/okf-start.mjs scripts/okf-search.mts`.
// Node strips a tool's TypeScript on every start, which is most of what a cached search costs;
// this turns on Node's compile cache so that is done once. The cache holds code Node will
// run, so it lives under the project's own node_modules, or else in a temp folder that is ours
// and private, never in the shared default. On any error there is no cache and the tool runs
// as before. Plain JavaScript, because it has to load before anything can be stripped.
import fs from 'node:fs';
import module from 'node:module';
import os from 'node:os';
import path from 'node:path';

try {
  let dir = null;
  const modules = path.resolve('node_modules');
  if (fs.existsSync(modules)) {
    dir = path.join(modules, '.cache', 'okf-compile');
  } else {
    const uid = process.getuid?.();
    const own = path.join(os.tmpdir(), `okf-search-${uid ?? 'user'}`);
    fs.mkdirSync(own, { recursive: true, mode: 0o700 });
    const st = fs.lstatSync(own);
    if (st.isDirectory() && (uid === undefined || st.uid === uid) && (st.mode & 0o077) === 0) dir = path.join(own, 'compile');
  }
  if (dir) module.enableCompileCache?.(dir);
} catch {
  // No cache: slower, never wrong.
}
