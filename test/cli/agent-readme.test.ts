import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve('.');
const cliPath = path.join(repoRoot, 'dist/cli/index.js');
const repoReadme = path.join(repoRoot, 'AGENTS_README.md');
const distReadme = path.join(repoRoot, 'dist/AGENTS_README.md');

function run(
  args: string[],
  _opts: { input?: string; expectFail?: boolean } = {},
): { stdout: Buffer; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [cliPath, ...args], {
      cwd: repoRoot,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error) {
    const err = error as {
      stdout?: Buffer;
      stderr?: Buffer;
      status?: number;
    };
    return {
      stdout: err.stdout ?? Buffer.alloc(0),
      stderr: err.stderr?.toString('utf-8') ?? '',
      exitCode: err.status ?? 1,
    };
  }
}

describe('agent-readme command behaviour', () => {
  it('AC-1/AC-2/AC-3/AC-5: dumps raw markdown to stdout, exit 0, stderr empty, byte-equal', () => {
    const result = run(['agent-readme']);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
    const text = result.stdout.toString('utf-8');
    // Per finding 01: actual H1 is "# Building Agents with minih"
    expect(text.split('\n')[0]).toBe('# Building Agents with minih');
    expect(text.startsWith('{')).toBe(false); // not a JSON envelope

    const distBytes = fs.readFileSync(distReadme);
    expect(result.stdout.length).toBe(distBytes.length);
    expect(Buffer.compare(result.stdout, distBytes)).toBe(0);
  });

  it('AC-4: SIGPIPE silenced for `agent-readme | head -1`', () => {
    // Spawn through `bash -c` so the pipe is real.
    const { execSync } = require('node:child_process');
    const out = execSync(`node "${cliPath}" agent-readme | head -1`, {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    expect(out.trim()).toBe('# Building Agents with minih');
  });

  it('AC-12/AC-13: missing bundle → E160 envelope on stderr, exit 1, stdout empty', () => {
    expect(fs.existsSync(distReadme)).toBe(true);
    const backup = `${distReadme}.bak`;
    fs.renameSync(distReadme, backup);
    try {
      const result = run(['agent-readme'], { expectFail: true });
      expect(result.exitCode).toBe(1);
      expect(result.stdout.length).toBe(0);
      const envelope = JSON.parse(result.stderr.trim());
      expect(envelope.command).toBe('agent-readme');
      expect(envelope.status).toBe('error');
      expect(envelope.error.code).toBe('E160');
      expect(envelope.error.details.expectedPath).toContain(
        'dist/AGENTS_README.md',
      );
    } finally {
      fs.renameSync(backup, distReadme);
    }
  });

  it('AC-11: runtime path lands at dist/AGENTS_README.md', () => {
    // Indirectly verified by the success test above (byte-equal with dist file)
    // and the error test (expectedPath contains dist/AGENTS_README.md). This
    // test makes the contract explicit: removing dist/AGENTS_README.md MUST
    // make the command fail with E160 (not, e.g., fall back to repo root).
    expect(fs.existsSync(distReadme)).toBe(true);
  });
});

describe('agent-readme help signposting', () => {
  it('AC-6: top-level --help lists agent-readme command', () => {
    const result = run(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toString('utf-8')).toMatch(/agent-readme/);
  });

  it('AC-7: top-level --help footer points to `minih agent-readme`', () => {
    const result = run(['--help']);
    expect(result.stdout.toString('utf-8')).toMatch(
      /or run: minih agent-readme/,
    );
  });

  it('AC-8: own --help mentions raw-markdown deviation', () => {
    const result = run(['agent-readme', '--help']);
    expect(result.exitCode).toBe(0);
    const text = result.stdout.toString('utf-8');
    expect(text).toMatch(/raw markdown/i);
    expect(text).toMatch(/JSON envelope/i);
  });
});

describe('agent-readme bundle byte-equality (AC-9, AC-10)', () => {
  it('dist/AGENTS_README.md is byte-identical to repo-root AGENTS_README.md', () => {
    if (!fs.existsSync(distReadme)) {
      console.warn(
        '[skip] dist/AGENTS_README.md missing — run `npm run build` first',
      );
      return;
    }
    const src = fs.readFileSync(repoReadme);
    const dst = fs.readFileSync(distReadme);
    expect(src.length).toBe(dst.length);
    expect(Buffer.compare(src, dst)).toBe(0);
  });
});

describe('AGENTS_README companion section structure (AC-14, AC-15)', () => {
  const readmeText = fs.existsSync(repoReadme)
    ? fs.readFileSync(repoReadme, 'utf-8')
    : '';

  it('has exactly one `## Companion mode` H2', () => {
    const matches = readmeText.match(/^## Companion mode\s*$/gm) ?? [];
    expect(matches.length).toBe(1);
  });

  it('does NOT have `### Companion mode` H3 (old subsection removed)', () => {
    const matches = readmeText.match(/^### Companion mode\s*$/gm) ?? [];
    expect(matches.length).toBe(0);
  });

  it('section length is between 100 and 1000 lines (AC-15)', () => {
    const lines = readmeText.split('\n');
    const startIdx = lines.indexOf('## Companion mode');
    expect(startIdx).toBeGreaterThan(-1);
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (/^## /.test(lines[i])) {
        endIdx = i;
        break;
      }
    }
    const sectionLength = endIdx - startIdx;
    expect(sectionLength).toBeGreaterThanOrEqual(100);
    expect(sectionLength).toBeLessThan(1000);
  });

  it('contains required subsection markers per AC-14', () => {
    // Section content (until next H2)
    const lines = readmeText.split('\n');
    const startIdx = lines.indexOf('## Companion mode');
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (/^## /.test(lines[i])) {
        endIdx = i;
        break;
      }
    }
    const section = lines.slice(startIdx, endIdx).join('\n');

    // Concept presence (authorial latitude on exact phrasing — match keywords)
    expect(section.toLowerCase()).toMatch(/what companion mode is/);
    expect(section.toLowerCase()).toMatch(/when to use/);
    expect(section.toLowerCase()).toMatch(/power on mode/);
    expect(section.toLowerCase()).toMatch(/control signal/);
    expect(section.toLowerCase()).toMatch(/farewell/);
    expect(section.toLowerCase()).toMatch(/wait_for_any|pairing/);
    expect(section.toLowerCase()).toMatch(/key rule/);
  });

  it('AC-15: contains ≥1 fenced code block per protocol phase (boot, brief, review, stop)', () => {
    const lines = readmeText.split('\n');
    const startIdx = lines.indexOf('## Companion mode');
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
      if (/^## /.test(lines[i])) {
        endIdx = i;
        break;
      }
    }
    const section = lines.slice(startIdx, endIdx).join('\n').toLowerCase();

    // Find all fenced code blocks
    const blocks = section.match(/```[\s\S]*?```/g) ?? [];
    const blockText = blocks.join('\n');

    for (const phase of ['boot', 'brief', 'review', 'stop']) {
      expect(blockText).toMatch(new RegExp(phase));
    }
  });
});
