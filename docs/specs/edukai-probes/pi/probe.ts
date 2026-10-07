// Probe: mimics the planned edukai pi extension and logs what pi gives it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LOG = process.env.PROBE_LOG ?? "/tmp/pi-probe.log";
const log = (o: unknown) => fs.appendFileSync(LOG, JSON.stringify(o) + "\n");

let self = "unresolved";
try { self = fileURLToPath(import.meta.url); } catch (e) { self = "import.meta.url failed: " + String(e); }
let dirnameSeen = "n/a";
try { dirnameSeen = typeof __dirname === "string" ? __dirname : "undefined"; } catch { dirnameSeen = "throws"; }
log({ ev: "load", self, dirnameSeen });

export default function (pi: any) {
  let nudged = false;
  pi.on("session_start", async (event: any, ctx: any) => {
    let node = "?";
    try { const r = await pi.exec("node", ["--version"], { timeout: 5000 }); node = r.stdout.trim() + " code=" + r.code; } catch (e) { node = "exec failed: " + String(e); }
    let sid = "?";
    try { sid = ctx.sessionManager.getSessionId(); } catch (e) { sid = "getSessionId failed: " + String(e); }
    log({ ev: "session_start", reason: event.reason, cwd: ctx.cwd, hasUI: ctx.hasUI, sid, node });
    pi.sendMessage({ customType: "edukai", content: "edukai: the session token is BRIEF-7391.", display: true }, { deliverAs: "nextTurn" });
  });
  pi.on("tool_result", async (event: any) => {
    log({ ev: "tool_result", toolName: event.toolName, input: event.input, isError: event.isError, contentTypes: (event.content ?? []).map((c: any) => c.type) });
    if (event.isError || !["read", "edit", "write"].includes(event.toolName)) return;
    const file = path.basename(String(event.input?.path ?? ""));
    const text = event.toolName === "read" ? `edukai: the read token for ${file} is CITES-4472.` : `edukai: the edit token for ${file} is EDITED-9038.`;
    return { content: [...event.content, { type: "text", text }] };
  });
  pi.on("agent_end", async (event: any) => {
    log({ ev: "agent_end", messages: (event.messages ?? []).length, nudged });
    if (process.env.PROBE_NUDGE === "2" && !nudged) {
      nudged = true;
      // Variant: wait until the agent is idle, then send.
      setTimeout(() => {
        log({ ev: "deferred_send" });
        pi.sendMessage({ customType: "edukai", content: "edukai: before you finish, append the line NUDGE-5550 to your answer.", display: true }, { triggerTurn: true });
      }, 300);
    }
    if (process.env.PROBE_NUDGE === "1" && !nudged) {
      nudged = true;
      pi.sendMessage({ customType: "edukai", content: "edukai: before you finish, append the line NUDGE-5550 to your answer.", display: true }, { deliverAs: "followUp", triggerTurn: true });
    }
  });
  pi.on("session_shutdown", async (event: any) => log({ ev: "session_shutdown", reason: event.reason }));
}
