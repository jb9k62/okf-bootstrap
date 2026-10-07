# Harness probes for the edukai spec

Throwaway checks that Claude Code and pi behave the way
[the spec](../edukai-memory-bundle.md) assumes. Each one hands the agent a made-up token at the
moment a real hook would speak, and the prompt asks the agent to repeat it. They are not part of
the product and can be deleted once tasks C2 and C3 are done.

Make a scratch project first:

```bash
mkdir -p /tmp/edukai-probe/src && cd /tmp/edukai-probe
printf 'export const RETRIES = 5;\n' > src/retry.ts
PROBES=<this folder>
PROMPT='Do these four things. 1) Tell me any edukai session token you were given when this session started. 2) Read src/retry.ts and tell me any edukai token you were given after reading it. 3) Change RETRIES to 4 in src/retry.ts and tell me any edukai token you were given after the edit. 4) Say DONE. Answer in at most five short lines.'
```

**Claude Code** (expect `BRIEF-7391`, `CITES-4472`, `EDITED-9038`):

```bash
PROBE_LOG=/tmp/edukai-probe/claude.log claude -p "$PROMPT" --model claude-sonnet-5-5 \
  --plugin-dir $PROBES/claude-plugin --allowedTools Read Edit < /dev/null
```

Add `PROBE_NUDGE=1` to make the `Stop` hook block once; the answer then ends with `NUDGE-5550`.
Swap the model for `claude-haiku-4-5-20251001` to repeat it on Haiku.

**pi** 1.0 or later (same three tokens; `-ne` keeps other installed extensions out of the result):

```bash
PROBE_LOG=/tmp/edukai-probe/pi.log pi -p "$PROMPT" --provider deepinfra \
  --model deepseek-ai/DeepSeek-V4-Flash-0731 -ne -e $PROBES/pi/probe.ts --no-session < /dev/null
```

Add `PROBE_NUDGE=1` for the `agent_end` follow-up; the answer then ends with `NUDGE-5550`.
`PROBE_NUDGE=2` sends it 300 ms later instead, which was the only way that worked on pi 0.73.

Each log line is one event with the fields the harness sent.
