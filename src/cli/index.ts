#!/usr/bin/env node

/**
 * minih CLI entry point.
 *
 * Registers all commands via commander.
 * Version read from package.json via fs (DYK #3: ESM can't require JSON).
 * --agents-dir resolved to absolute path once (DYK #5).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { registerCheckCommand } from './commands/check.js';
import { registerConnectCommand } from './commands/connect.js';
import { registerDifficultiesCommand } from './commands/difficulties.js';
import { registerDoctorCommand } from './commands/doctor.js';
import { registerHistoryCommand } from './commands/history.js';
import { registerInitCommand } from './commands/init.js';
import { registerInsideCommand } from './commands/inside.js';
import { registerInspectCommand } from './commands/inspect.js';
import { registerLastRunCommand } from './commands/last-run.js';
import { registerListCommand } from './commands/list.js';
import { registerOutsideCommand } from './commands/outside.js';
import { registerQuickstartCommand } from './commands/quickstart.js';
import { registerResumeCommand } from './commands/resume.js';
import { registerRetrosCommand } from './commands/retros.js';
import { registerRunCommand } from './commands/run.js';
import { registerStateCommand } from './commands/state.js';
import { registerStatusCommand } from './commands/status.js';
import { registerTailCommand } from './commands/tail.js';
import { registerValidateCommand } from './commands/validate.js';

// Read version from package.json (DYK #3: fs.readFileSync, not require)
const thisDir = path.dirname(fileURLToPath(import.meta.url));
const pkgPath = path.resolve(thisDir, '..', '..', 'package.json');
let version = '0.0.0';
try {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  version = pkg.version ?? '0.0.0';
} catch {
  // Fallback if package.json not found (shouldn't happen)
}

const program = new Command()
  .name('minih')
  .description(
    'Standalone declarative agent runner with self-improving feedback',
  )
  .version(version)
  .option('--agents-dir <path>', 'Agents directory', 'agents')
  .addHelpText(
    'after',
    '\nDocs: https://github.com/AI-Substrate/minih/blob/main/AGENTS_README.md',
  );

// Resolve --agents-dir to absolute once (DYK #5)
program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.opts();
  if (opts.agentsDir) {
    opts.agentsDir = path.resolve(opts.agentsDir);
  }
});

registerQuickstartCommand(program);
registerListCommand(program);
registerRunCommand(program);
registerResumeCommand(program);
registerOutsideCommand(program);
registerInsideCommand(program);
registerStateCommand(program);
registerRetrosCommand(program);
registerConnectCommand(program);
registerHistoryCommand(program);
registerInspectCommand(program);
registerValidateCommand(program);
registerLastRunCommand(program);
registerStatusCommand(program);
registerTailCommand(program);
registerDoctorCommand(program);
registerDifficultiesCommand(program);
registerCheckCommand(program);
registerInitCommand(program);

program.parse();
