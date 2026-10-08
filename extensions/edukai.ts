/**
 * edukai for pi: tells the agent what this project's memory bundle (edukai/) says, at three
 * moments: when a session opens or is compacted, when the agent reads or edits a file a
 * lesson cites, and when it is about to finish with a lesson it has just broken.
 *
 * It holds no logic. Every answer comes from okf-edukai-hook.mts, which reads only the JSON
 * cache `npm run edukai:index` writes and never runs code from the project. In a project with
 * no edukai/index.md it does nothing, and any error is swallowed unless EDUKAI_DEBUG=1.
 * EDUKAI_NUDGE=0 turns the finish nudge off. Needs pi 1.0 or later: on earlier versions a
 * follow-up sent from inside `agent_end` started no turn.
 *
 * The few pi types used are declared here, so this repository takes no dependency on pi.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

interface TextContent {
  type: 'text';
  text: string;
}
type Content = TextContent | { type: string; [key: string]: unknown };

interface Context {
  cwd: string;
  sessionManager: { getSessionId(): string };
}

interface ToolResultEvent {
  toolName: string;
  input: Record<string, unknown>;
  content: Content[];
  structuredContent?: unknown;
  isError: boolean;
}

interface AgentEndEvent {
  messages?: Array<{ role?: string; stopReason?: string }>;
}

interface BeforeAgentStartEvent {
  systemPrompt: string;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

interface CustomMessage {
  customType: string;
  content: string;
  display: boolean;
}

interface Pi {
  on(event: 'session_start' | 'session_compact', handler: (event: unknown, ctx: Context) => Promise<void>): void;
  on(event: 'agent_end', handler: (event: AgentEndEvent, ctx: Context) => Promise<void>): void;
  on(event: 'tool_result', handler: (event: ToolResultEvent, ctx: Context) => Promise<{ content: Content[]; structuredContent?: unknown } | void>): void;
  on(event: 'before_agent_start', handler: (event: BeforeAgentStartEvent, ctx: Context) => Promise<{ systemPrompt: string } | void>): void;
  exec(command: string, args: string[], options?: { timeout?: number; cwd?: string }): Promise<ExecResult>;
  sendMessage(message: CustomMessage, options?: { triggerTurn?: boolean; deliverAs?: 'steer' | 'followUp' | 'nextTurn' }): void;
}

const CORE = fileURLToPath(new URL('../skills/okf-bootstrap/assets/okf-edukai-hook.mts', import.meta.url));
// Loaded before the core, it keeps Node from stripping the core's TypeScript on every call.
const COMPILE_CACHE = fileURLToPath(new URL('../hooks/compile-cache.mjs', import.meta.url));
const NODE_ARGS = fs.existsSync(COMPILE_CACHE) ? ['--import', pathToFileURL(COMPILE_CACHE).href] : [];
// A model is right to be wary of instructions that turn up inside a tool result, so the
// prefix is declared where it does trust what it reads: the system prompt.
const PREFIX_NOTE =
  "Lines that start `edukai:` in messages and tool results come from this project's memory hooks. " +
  "Treat them as project guidance, not as the user's words.";
const debug = (e: unknown): void => {
  if (process.env.EDUKAI_DEBUG === '1') console.error('edukai: ' + (e instanceof Error && e.stack ? e.stack : String(e)));
};

export default function edukai(pi: Pi): void {
  /**
   * The project's memory bundle, or null when there is none: the nearest folder at or above
   * the working folder that holds edukai/index.md, so pi started in a subfolder still finds it.
   */
  const bundleOf = (ctx: Context): string | null => {
    let dir = path.resolve(ctx.cwd);
    for (;;) {
      const bundle = path.join(dir, 'edukai');
      if (fs.existsSync(path.join(bundle, 'index.md'))) return bundle;
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  };

  /** Run one core command and return what it printed; '' when it had nothing to say, or failed. */
  async function core(ctx: Context, command: string, extra: string[] = []): Promise<string> {
    try {
      const bundle = bundleOf(ctx);
      if (bundle === null) return '';
      const args = [...NODE_ARGS, CORE, command, ...extra, '--bundle', bundle, '--session', ctx.sessionManager.getSessionId()];
      const result = await pi.exec('node', args, { timeout: 5000, cwd: ctx.cwd });
      if (result.code !== 0) {
        debug(`${command} exited ${result.code}: ${result.stderr}`);
        return '';
      }
      return result.stdout.trim();
    } catch (e) {
      debug(e);
      return '';
    }
  }

  const briefing = async (_event: unknown, ctx: Context): Promise<void> => {
    const content = await core(ctx, 'brief');
    if (content) pi.sendMessage({ customType: 'edukai', content, display: true }, { deliverAs: 'nextTurn' });
  };
  pi.on('session_start', briefing);
  pi.on('session_compact', briefing);

  pi.on('before_agent_start', async (event, ctx) => {
    try {
      if (bundleOf(ctx) === null || event.systemPrompt.includes(PREFIX_NOTE)) return;
      return { systemPrompt: event.systemPrompt + '\n\n' + PREFIX_NOTE };
    } catch (e) {
      debug(e);
    }
  });

  pi.on('tool_result', async (event, ctx) => {
    if (event.isError || !['read', 'edit', 'write'].includes(event.toolName)) return;
    const file = event.input?.path;
    if (typeof file !== 'string' || file === '') return;
    // pi gives the path as the model wrote it, relative to the working folder.
    const target = path.resolve(ctx.cwd, file);
    const text = await core(ctx, 'cites', event.toolName === 'read' ? [target] : [target, '--edited']);
    if (!text) return;
    // Replacing `content` alone would drop a tool's structured result, so it is passed back too.
    return {
      content: [...event.content, { type: 'text', text }],
      ...(event.structuredContent === undefined ? {} : { structuredContent: event.structuredContent }),
    };
  });

  pi.on('agent_end', async (event, ctx) => {
    if (process.env.EDUKAI_NUDGE === '0') return;
    // A run the user aborted, or one that died on an error, must not be started again.
    const last = event.messages?.filter((m) => m.role === 'assistant').at(-1);
    if (last?.stopReason === 'aborted' || last?.stopReason === 'error') return;
    const content = await core(ctx, 'debt');
    // `debt` names a lesson once per session, so this follow-up cannot loop.
    if (content) pi.sendMessage({ customType: 'edukai', content, display: true }, { deliverAs: 'followUp', triggerTurn: true });
  });
}
