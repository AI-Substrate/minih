import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  resolveSkillSourceAlias,
  resolveSkillsConfig,
} from '../../src/cli/skills.js';

let tmp: string;
let home: string;

function skill(dir: string, body = '# Skill\n'): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), body);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minih-skills-'));
  home = path.join(tmp, 'home');
  fs.mkdirSync(home, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('skills resolver', () => {
  it('resolves v1 aliases deterministically', () => {
    expect(
      resolveSkillSourceAlias('.agents', { cwd: tmp, homeDir: home }),
    ).toBe(path.join(tmp, '.agents', 'skills'));
    expect(
      resolveSkillSourceAlias('repo:.github', { cwd: tmp, homeDir: home }),
    ).toBe(path.join(tmp, '.github', 'skills'));
    expect(
      resolveSkillSourceAlias('global:agents', { cwd: tmp, homeDir: home }),
    ).toBe(path.join(home, '.agents', 'skills'));
    expect(
      resolveSkillSourceAlias('global:pi', { cwd: tmp, homeDir: home }),
    ).toBe(path.join(home, '.pi', 'agent', 'skills'));
    expect(
      resolveSkillSourceAlias('path:local-skills', { cwd: tmp, homeDir: home }),
    ).toBe(path.join(tmp, 'local-skills'));
  });

  it('loads no skills when config and flags are absent', () => {
    const resolved = resolveSkillsConfig({ cwd: tmp, homeDir: home });
    expect(resolved.enabled).toBe(false);
    expect(resolved.skillDirectories).toBeUndefined();
    expect(resolved.disabledSkills).toBeUndefined();
  });

  it('selects direct skill directories for include by name', () => {
    skill(path.join(home, '.agents', 'skills', 'grill-me'));
    skill(path.join(home, '.agents', 'skills', 'other-skill'));
    const resolved = resolveSkillsConfig({
      cwd: tmp,
      homeDir: home,
      sourceOverrides: ['global:agents'],
      includeOverrides: ['grill-me'],
    });
    expect(resolved.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
    expect(resolved.skillDirectories).toEqual([
      path.join(home, '.agents', 'skills', 'grill-me'),
    ]);
  });

  it('passes parent source dirs and disabledSkills without include', () => {
    skill(path.join(tmp, '.agents', 'skills', 'one'));
    const resolved = resolveSkillsConfig({
      cwd: tmp,
      homeDir: home,
      sourceOverrides: ['.agents'],
      excludeOverrides: ['one'],
    });
    expect(resolved.skillDirectories).toEqual([
      path.join(tmp, '.agents', 'skills'),
    ]);
    expect(resolved.disabledSkills).toEqual(['one']);
  });

  it('warns for missing sources and errors for missing includes', () => {
    const resolved = resolveSkillsConfig({
      cwd: tmp,
      homeDir: home,
      sourceOverrides: ['global:agents'],
      includeOverrides: ['grill-me'],
    });
    expect(resolved.diagnostics.map((d) => d.code)).toEqual(['W210', 'E211']);
    expect(resolved.diagnostics.at(-1)?.message).toContain(
      'minih skills discover',
    );
  });
});
