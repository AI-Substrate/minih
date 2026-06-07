import type { Command } from 'commander';
import { exitWithEnvelope, formatSuccess } from '../output.js';
import { hasSkillErrors, resolveSkillsConfig } from '../skills.js';

export function registerSkillsCommand(program: Command): void {
  const skills = program
    .command('skills')
    .description('Discover and diagnose local skills for SDK-backed agents')
    .addHelpText(
      'after',
      '\nExamples:\n' +
        '  minih skills discover\n' +
        '  minih skills doctor\n' +
        '  minih run test-skills --skill-source .agents --skill minih-test-skill\n',
    );

  skills
    .command('discover')
    .description(
      'List configured skill sources and discovered SKILL.md directories',
    )
    .option(
      '--skill-source <alias-or-path>',
      'Source alias/path to inspect (repeatable)',
      collect,
      [] as string[],
    )
    .option(
      '--skill <name>',
      'Only select a named skill (repeatable)',
      collect,
      [] as string[],
    )
    .option(
      '--disable-skill <name>',
      'Disable/exclude a skill by name (repeatable)',
      collect,
      [] as string[],
    )
    .option('--no-skills', 'Disable skills for this invocation')
    .action((opts: SkillCommandOpts) => {
      const resolved = resolveSkillsConfig({
        cwd: process.cwd(),
        sourceOverrides: opts.skillSource,
        includeOverrides: opts.skill,
        excludeOverrides: opts.disableSkill,
        noSkills: opts.skills === false,
      });
      printHumanSummary('discover', resolved);
      exitWithEnvelope(
        formatSuccess(
          'skills.discover',
          resolved,
          hasSkillErrors(resolved) ? 'degraded' : 'ok',
        ),
      );
    });

  skills
    .command('doctor')
    .description(
      'Validate .minih.json skills config without starting an SDK session',
    )
    .option(
      '--skill-source <alias-or-path>',
      'Source alias/path to inspect (repeatable)',
      collect,
      [] as string[],
    )
    .option(
      '--skill <name>',
      'Only select a named skill (repeatable)',
      collect,
      [] as string[],
    )
    .option(
      '--disable-skill <name>',
      'Disable/exclude a skill by name (repeatable)',
      collect,
      [] as string[],
    )
    .option('--no-skills', 'Disable skills for this invocation')
    .action((opts: SkillCommandOpts) => {
      const resolved = resolveSkillsConfig({
        cwd: process.cwd(),
        sourceOverrides: opts.skillSource,
        includeOverrides: opts.skill,
        excludeOverrides: opts.disableSkill,
        noSkills: opts.skills === false,
      });
      printHumanSummary('doctor', resolved);
      exitWithEnvelope(
        formatSuccess(
          'skills.doctor',
          resolved,
          hasSkillErrors(resolved) ? 'degraded' : 'ok',
        ),
      );
    });
}

interface SkillCommandOpts {
  skillSource?: string[];
  skill?: string[];
  disableSkill?: string[];
  skills?: boolean;
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function printHumanSummary(
  command: string,
  resolved: ReturnType<typeof resolveSkillsConfig>,
): void {
  process.stderr.write(
    `skills ${command}: ${resolved.enabled ? 'enabled' : 'disabled'}\n`,
  );
  if (resolved.configPath)
    process.stderr.write(`config: ${resolved.configPath}\n`);
  for (const diagnostic of resolved.diagnostics) {
    const prefix = diagnostic.level === 'error' ? 'error' : 'warning';
    process.stderr.write(`${prefix}: ${diagnostic.message}\n`);
  }
  for (const source of resolved.sources) {
    process.stderr.write(
      `${source.exists ? '✓' : '!'} ${source.alias} -> ${source.path}\n`,
    );
  }
  for (const skill of resolved.discovered) {
    process.stderr.write(`- ${skill.name} (${skill.dir})\n`);
  }
  if (resolved.skillDirectories?.length) {
    process.stderr.write(
      `skillDirectories: ${resolved.skillDirectories.length}\n`,
    );
  }
  if (resolved.disabledSkills?.length) {
    process.stderr.write(
      `disabledSkills: ${resolved.disabledSkills.join(', ')}\n`,
    );
  }
}
