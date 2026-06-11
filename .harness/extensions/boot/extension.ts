import type {
  HarnessVerb,
  VerbContext,
} from '@ai-substrate/engineering-harness/contract';

type Outcome = 'pass' | 'warn' | 'fail' | 'skipped';

interface SensorResult {
  sensor: string;
  command: string;
  outcome: Outcome;
  detail: string;
}

const NETWORK_ERRORS =
  /ENOTFOUND|EAI_AGAIN|ENETUNREACH|ECONNREFUSED|ETIMEDOUT|EAUDITNOREGISTRY/i;

function tail(text: string, lines = 5): string {
  const trimmed = text.trim();
  if (trimmed === '') return '';
  return trimmed.split('\n').slice(-lines).join('\n');
}

async function runSimple(
  ctx: VerbContext,
  sensor: string,
  command: string,
  args: string[],
): Promise<SensorResult> {
  const r = await ctx.exec(command, args);
  return {
    sensor,
    command: [command, ...args].join(' '),
    outcome: r.ok ? 'pass' : 'fail',
    detail: r.ok ? 'clean' : tail(r.stderr || r.stdout) || `exit ${r.code}`,
  };
}

// minih doctor has no --json envelope yet (observed as DL-001), so warnings
// are detected deterministically via exit codes: a plain run catches hard
// errors, a --strict run turns warnings into a non-zero exit.
async function runMinihDoctor(ctx: VerbContext): Promise<SensorResult> {
  const command = 'minih doctor (+ --strict for warning detection)';
  const plain = await ctx.exec('minih', ['doctor']);
  if (!plain.ok) {
    return {
      sensor: 'minih-doctor',
      command,
      outcome: 'fail',
      detail: tail(plain.stderr || plain.stdout) || `exit ${plain.code}`,
    };
  }
  const strict = await ctx.exec('minih', ['doctor', '--strict']);
  if (!strict.ok) {
    return {
      sensor: 'minih-doctor',
      command,
      outcome: 'warn',
      detail: 'warnings present — run `minih doctor` for the list',
    };
  }
  return { sensor: 'minih-doctor', command, outcome: 'pass', detail: 'clean' };
}

interface AuditJson {
  error?: { code?: string; summary?: string };
  metadata?: { vulnerabilities?: Record<string, number> };
}

// Findings are never masked; an unreachable registry soft-skips instead of
// failing (the repo's sdk-check recipe sets the offline-tolerance precedent).
async function runAudit(ctx: VerbContext): Promise<SensorResult> {
  const command = 'npm audit --audit-level=high --json';
  const r = await ctx.exec('npm', ['audit', '--audit-level=high', '--json']);
  let parsed: AuditJson | null = null;
  try {
    parsed = JSON.parse(r.stdout) as AuditJson;
  } catch {
    parsed = null;
  }
  if (parsed?.error) {
    return {
      sensor: 'audit',
      command,
      outcome: 'skipped',
      detail: `registry unavailable (${parsed.error.code ?? 'unknown'}) — soft-skipped`,
    };
  }
  if (!parsed) {
    if (NETWORK_ERRORS.test(r.stderr)) {
      return {
        sensor: 'audit',
        command,
        outcome: 'skipped',
        detail: 'offline — soft-skipped',
      };
    }
    return {
      sensor: 'audit',
      command,
      outcome: 'fail',
      detail: tail(r.stderr) || 'unparseable npm audit output',
    };
  }
  const vulns = parsed.metadata?.vulnerabilities ?? {};
  const high = vulns.high ?? 0;
  const critical = vulns.critical ?? 0;
  if (high + critical > 0) {
    return {
      sensor: 'audit',
      command,
      outcome: 'warn',
      detail: `${critical} critical, ${high} high — run \`npm audit --audit-level=high\` for detail`,
    };
  }
  return {
    sensor: 'audit',
    command,
    outcome: 'pass',
    detail: 'no high/critical vulnerabilities',
  };
}

const boot: HarnessVerb = {
  name: 'boot',
  summary:
    'Read-only readiness proof: biome check, tsc --noEmit, just check, minih doctor, npm audit.',
  description:
    'Composite session-start sensor for developing minih. Runs five read-only checks and returns one honest envelope: ok (all pass), degraded (doctor warnings or high/critical audit findings), error (any sensor hard-fails). The audit sensor soft-skips when the registry is unreachable. Never mutates the tree — the mutating gate (`just fft`) belongs at commit time.',
  async run(ctx) {
    const sensors: SensorResult[] = [];
    sensors.push(await runSimple(ctx, 'lint', 'npx', ['biome', 'check', '.']));
    sensors.push(await runSimple(ctx, 'typecheck', 'npx', ['tsc', '--noEmit']));
    sensors.push(await runSimple(ctx, 'build+test', 'just', ['check']));
    sensors.push(await runMinihDoctor(ctx));
    sensors.push(await runAudit(ctx));

    const orientation = {
      what: 'session-level engineering harness for developing minih — distinct from the minih product harness that writes docs/retros/',
      branch: ctx.git.currentBranch(),
      governance: ctx.fs.exists('.harness/engineering-harness.md')
        ? '.harness/engineering-harness.md'
        : 'owed — migrating from docs/project-rules/harness.md (plan 024-core-harness)',
      capture_friction: 'harness observe "<what>" --kind <kind>',
      pre_commit_gate:
        'just fft (mutating — runs biome format --write); boot itself never writes',
      briefing: 'harness instructions boot',
    };

    const failed = sensors.filter((s) => s.outcome === 'fail');
    const warned = sensors.filter((s) => s.outcome === 'warn');

    if (failed.length > 0) {
      return ctx.error(
        'E1',
        `boot failed: ${failed.map((s) => s.sensor).join(', ')}`,
        {
          details: { sensors, orientation },
          next_action: `Fix the failing sensor(s) first: ${failed
            .map((s) => `${s.sensor} (${s.command})`)
            .join('; ')}`,
        },
      );
    }
    if (warned.length > 0) {
      return ctx.degraded(
        { sensors, orientation },
        `Ready to work, with caveats: ${warned
          .map((s) => `${s.sensor} — ${s.detail}`)
          .join('; ')}`,
      );
    }
    return ctx.ok({ sensors, orientation });
  },
};

export default boot;
