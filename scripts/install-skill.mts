#!/usr/bin/env node
/**
 * Link this clone's skill into the agents' personal skill directories, so a `git pull` here
 * updates every agent at once.
 *
 *   node scripts/install-skill.mts [--claude] [--pi] [--agents] [--copy] [--force]
 *
 *   --claude  ~/.claude/skills/okf-bootstrap       (Claude Code; CLAUDE_CONFIG_DIR is honoured)
 *   --pi      ~/.pi/agent/skills/okf-bootstrap     (pi; PI_CODING_AGENT_DIR is honoured)
 *   --agents  ~/.agents/skills/okf-bootstrap       (the shared Agent Skills location; pi reads it)
 *   --copy    copy instead of symlinking (for a clone you will delete)
 *   --force   replace whatever is already at the destination
 *
 * With no target flags it installs for each agent whose home directory exists.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = path.join(ROOT, 'skills', 'okf-bootstrap');
const HOME = os.homedir();

const args = new Set(process.argv.slice(2));
for (const arg of args) {
  if (!['--claude', '--pi', '--agents', '--copy', '--force'].includes(arg)) {
    console.error(`Unknown flag: ${arg}`);
    process.exit(2);
  }
}

const claudeHome = process.env.CLAUDE_CONFIG_DIR ?? path.join(HOME, '.claude');
const piHome =
  process.env.PI_CODING_AGENT_DIR ?? process.env.PI_AGENT_DIR ?? path.join(HOME, '.pi', 'agent');
const targets = [
  { flag: '--claude', name: 'Claude Code', home: claudeHome },
  { flag: '--pi', name: 'pi', home: piHome },
  { flag: '--agents', name: 'Agent Skills', home: path.join(HOME, '.agents') },
];
const explicit = targets.some((t) => args.has(t.flag));
const chosen = targets.filter((t) =>
  explicit ? args.has(t.flag) : t.flag !== '--agents' && fs.existsSync(t.home),
);
if (chosen.length === 0) {
  console.error('No agent home found (~/.claude, ~/.pi/agent). Pass --claude, --pi or --agents.');
  process.exit(2);
}

let failed = false;
for (const target of chosen) {
  const dest = path.join(target.home, 'skills', 'okf-bootstrap');
  const existing = fs.lstatSync(dest, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink() && fs.realpathSync(dest) === fs.realpathSync(SKILL)) {
    console.log(`  ${target.name}: already linked (${dest})`);
    continue;
  }
  if (existing) {
    if (!args.has('--force')) {
      console.error(`  ${target.name}: ${dest} already exists; pass --force to replace it`);
      failed = true;
      continue;
    }
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (args.has('--copy')) {
    fs.cpSync(SKILL, dest, {
      recursive: true,
      filter: (from) => !/[\\/](node_modules|dist)([\\/]|$)/.test(path.relative(SKILL, from)),
    });
    console.log(`  ${target.name}: copied to ${dest}`);
  } else {
    fs.symlinkSync(SKILL, dest, 'dir');
    console.log(`  ${target.name}: linked ${dest} -> ${SKILL}`);
  }
}
console.log('\nStart a new session (or /reload in pi) and ask to "bootstrap an okf for this project".');
process.exit(failed ? 1 : 0);
