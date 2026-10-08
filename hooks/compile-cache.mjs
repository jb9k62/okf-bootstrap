// Turns on Node's compile cache for the edukai hooks. Node strips the hook's TypeScript on every
// start, and that is most of what a hook costs; the cache keeps the stripped code between runs.
// It holds code Node will run, so it lives only in a folder that is ours and private (the rule
// the hook's own cache follows), never in the shared default under the temp dir. Plain
// JavaScript that an old Node parses; on any error there is no cache, and the hook runs as before.
try {
  const fs = process.getBuiltinModule('node:fs');
  const os = process.getBuiltinModule('node:os');
  const path = process.getBuiltinModule('node:path');
  const uid = process.getuid ? process.getuid() : undefined;
  const dir = path.join(os.tmpdir(), 'edukai-' + (uid === undefined ? 'user' : uid));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  if (st.isDirectory() && (uid === undefined || st.uid === uid) && (st.mode & 0o077) === 0) {
    process.getBuiltinModule('node:module').enableCompileCache(path.join(dir, 'compile'));
  }
} catch (e) {
  if (process.env.EDUKAI_DEBUG === '1') console.error('edukai: no compile cache: ' + e);
}
