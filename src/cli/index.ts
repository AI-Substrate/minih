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
import { registerDoctorCommand } from './commands/doctor.js';
import { registerHistoryCommand } from './commands/history.js';
import { registerInitCommand } from './commands/init.js';
import { registerLastRunCommand } from './commands/last-run.js';
import { registerListCommand } from './commands/list.js';
import { registerRunCommand } from './commands/run.js';
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
  .option('--agents-dir <path>', 'Agents directory', 'agents');

// Resolve --agents-dir to absolute once (DYK #5)
program.hook('preAction', (thisCommand) => {
  const opts = thisCommand.opts();
  if (opts.agentsDir) {
    opts.agentsDir = path.resolve(opts.agentsDir);
  }
});

registerListCommand(program);
registerRunCommand(program);
registerHistoryCommand(program);
registerValidateCommand(program);
registerLastRunCommand(program);
registerTailCommand(program);
registerDoctorCommand(program);
registerCheckCommand(program);
registerInitCommand(program);

program.parse();
