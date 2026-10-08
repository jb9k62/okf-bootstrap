// The command Claude Code runs for every edukai hook. Plain JavaScript, so it starts on any
// Node: the hook file itself is TypeScript, which Node runs directly only from 22.18. On an
// older Node, or on any error, it exits 0 and says nothing: a hook must never get in the
// agent's way (set EDUKAI_DEBUG=1 to see why it is silent).
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
const debug = (message) => {
  if (process.env.EDUKAI_DEBUG === '1') console.error('edukai: ' + message);
};
if (major < 22 || (major === 22 && minor < 18)) {
  debug(`Node ${process.versions.node} cannot run the hook; it needs 22.18 or later`);
  process.exit(0);
}
// The compile cache first, so the hook file's TypeScript is stripped once, not on every call.
import('./compile-cache.mjs')
  .catch((e) => debug(e && e.stack ? e.stack : String(e)))
  .then(() => import('../skills/okf-bootstrap/assets/okf-edukai-hook.mts'))
  .then((hook) => {
    process.exitCode = hook.runHook();
  })
  .catch((e) => {
    debug(e && e.stack ? e.stack : String(e));
    process.exitCode = 0;
  });
