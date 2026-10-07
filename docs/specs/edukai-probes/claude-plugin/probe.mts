// Probe: logs each hook payload and answers the way the edukai spec says the real hook will.
import fs from 'node:fs';
import path from 'node:path';
const LOG: string = process.env.PROBE_LOG ?? '/tmp/probe.log';
const input: Record<string, any> = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
const ev: string = input.hook_event_name;
const env = { CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR, CLAUDE_PLUGIN_ROOT: process.env.CLAUDE_PLUGIN_ROOT, cwd: process.cwd() };
const brief = { ...input };
if (brief.tool_response) brief.tool_response = '[' + typeof brief.tool_response + ' omitted]';
if (brief.tool_output) brief.tool_output = '[omitted]';
if (brief.last_assistant_message) brief.last_assistant_message = String(brief.last_assistant_message).slice(0, 80);
fs.appendFileSync(LOG, JSON.stringify({ ev, keys: Object.keys(input), input: brief, env }) + '\n');
const ctx = (text: string) => console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: ev, additionalContext: text } }));
if (ev === 'SessionStart') ctx('edukai: the session token is BRIEF-7391.');
else if (ev === 'PostToolUse') {
  const file = path.basename(String(input.tool_input?.file_path ?? ''));
  ctx(input.tool_name === 'Read' ? `edukai: the read token for ${file} is CITES-4472.` : `edukai: the edit token for ${file} is EDITED-9038.`);
} else if (ev === 'Stop') {
  const flag = path.join(path.dirname(LOG), 'nudged-' + input.session_id);
  if (process.env.PROBE_NUDGE === '1' && !fs.existsSync(flag)) {
    fs.writeFileSync(flag, '');
    console.log(JSON.stringify({ decision: 'block', reason: 'edukai: before you finish, append the line NUDGE-5550 to your answer.' }));
  }
}
