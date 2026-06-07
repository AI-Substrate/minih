import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface MinihSkillsConfig {
  sources?: string[];
  include?: string[];
  exclude?: string[];
}

export interface MinihConfig {
  skills?: MinihSkillsConfig;
}

export type SkillDiagnosticLevel = 'warning' | 'error';

export interface SkillDiagnostic {
  level: SkillDiagnosticLevel;
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ResolvedSkillSource {
  alias: string;
  path: string;
  exists: boolean;
}

export interface DiscoveredSkill {
  name: string;
  dir: string;
  sourceAlias: string;
  sourcePath: string;
  metadataName?: string;
}

export interface ResolvedSkillsConfig {
  enabled: boolean;
  sources: ResolvedSkillSource[];
  discovered: DiscoveredSkill[];
  selected: DiscoveredSkill[];
  skillDirectories?: string[];
  disabledSkills?: string[];
  diagnostics: SkillDiagnostic[];
  configPath: string | null;
}

export interface ResolveSkillsOptions {
  cwd?: string;
  homeDir?: string;
  configPath?: string;
  sourceOverrides?: string[];
  includeOverrides?: string[];
  excludeOverrides?: string[];
  noSkills?: boolean;
}

export function readMinihConfig(cwd = process.cwd()): {
  config: MinihConfig;
  configPath: string | null;
  diagnostics: SkillDiagnostic[];
} {
  const configPath = path.join(cwd, '.minih.json');
  if (!fs.existsSync(configPath)) {
    return { config: {}, configPath: null, diagnostics: [] };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as unknown;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      return {
        config: {},
        configPath,
        diagnostics: [
          {
            level: 'error',
            code: 'E210',
            message: '.minih.json must contain a JSON object.',
            details: { configPath },
          },
        ],
      };
    }
    const rec = raw as Record<string, unknown>;
    const skills = rec.skills;
    if (skills === undefined)
      return { config: {}, configPath, diagnostics: [] };
    const diagnostics = validateSkillsBlock(skills, configPath);
    if (diagnostics.length > 0) {
      return { config: {}, configPath, diagnostics };
    }
    return {
      config: { skills: skills as MinihSkillsConfig },
      configPath,
      diagnostics: [],
    };
  } catch (err) {
    return {
      config: {},
      configPath,
      diagnostics: [
        {
          level: 'error',
          code: 'E210',
          message: `Could not parse .minih.json: ${(err as Error).message}`,
          details: { configPath },
        },
      ],
    };
  }
}

function validateSkillsBlock(
  value: unknown,
  configPath: string,
): SkillDiagnostic[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [
      {
        level: 'error',
        code: 'E210',
        message: '.minih.json skills must be an object.',
        details: { configPath },
      },
    ];
  }
  const diagnostics: SkillDiagnostic[] = [];
  const rec = value as Record<string, unknown>;
  for (const key of ['sources', 'include', 'exclude']) {
    const item = rec[key];
    if (item === undefined) continue;
    if (
      !Array.isArray(item) ||
      item.some((v) => typeof v !== 'string' || v.trim() === '')
    ) {
      diagnostics.push({
        level: 'error',
        code: 'E210',
        message: `.minih.json skills.${key} must be an array of non-empty strings.`,
        details: { configPath, key },
      });
    }
  }
  return diagnostics;
}

export function resolveSkillsConfig(
  opts: ResolveSkillsOptions = {},
): ResolvedSkillsConfig {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const homeDir = opts.homeDir ?? os.homedir();
  const configRead = opts.configPath
    ? readMinihConfig(path.dirname(opts.configPath))
    : readMinihConfig(cwd);
  const diagnostics = [...configRead.diagnostics];

  if (opts.noSkills) {
    return {
      enabled: false,
      sources: [],
      discovered: [],
      selected: [],
      diagnostics,
      configPath: configRead.configPath,
    };
  }

  const configured = configRead.config.skills ?? {};
  const sourcesInput = opts.sourceOverrides?.length
    ? opts.sourceOverrides
    : (configured.sources ?? []);
  const includeInput = opts.includeOverrides?.length
    ? opts.includeOverrides
    : (configured.include ?? []);
  const excludeInput = opts.excludeOverrides?.length
    ? opts.excludeOverrides
    : (configured.exclude ?? []);

  if (
    sourcesInput.length === 0 &&
    includeInput.length === 0 &&
    excludeInput.length === 0
  ) {
    return {
      enabled: false,
      sources: [],
      discovered: [],
      selected: [],
      diagnostics,
      configPath: configRead.configPath,
    };
  }

  const sources = uniqueStrings(sourcesInput).map((alias) => {
    const resolvedPath = resolveSkillSourceAlias(alias, { cwd, homeDir });
    return { alias, path: resolvedPath, exists: fs.existsSync(resolvedPath) };
  });

  for (const source of sources) {
    if (!source.exists) {
      diagnostics.push({
        level: 'warning',
        code: 'W210',
        message: `Skill source not found: ${source.alias} (${source.path})`,
        details: { alias: source.alias, path: source.path },
      });
    }
  }

  const discovered = discoverSkillsFromSources(sources);
  const exclude = new Set(excludeInput);
  let selected: DiscoveredSkill[];
  let skillDirectories: string[] | undefined;
  let disabledSkills: string[] | undefined;

  if (includeInput.length > 0) {
    selected = [];
    const byName = new Map<string, DiscoveredSkill>();
    for (const skill of discovered) {
      if (!byName.has(skill.name)) byName.set(skill.name, skill);
    }
    for (const name of uniqueStrings(includeInput)) {
      const match = byName.get(name);
      if (!match) {
        diagnostics.push({
          level: 'error',
          code: 'E211',
          message: `Skill "${name}" was requested but not found. Run \`minih skills discover\` to inspect available skills.`,
          details: { name, searchedSources: sources.map((s) => s.path) },
        });
        continue;
      }
      if (!exclude.has(name)) selected.push(match);
    }
    skillDirectories = selected.map((skill) => skill.dir);
  } else {
    selected = discovered.filter((skill) => !exclude.has(skill.name));
    skillDirectories = sources
      .filter((source) => source.exists)
      .map((source) => source.path);
    disabledSkills =
      excludeInput.length > 0 ? uniqueStrings(excludeInput) : undefined;
  }

  const directories = uniqueStrings(skillDirectories ?? []);
  return {
    enabled:
      directories.length > 0 || diagnostics.some((d) => d.level === 'error'),
    sources,
    discovered,
    selected,
    skillDirectories: directories.length > 0 ? directories : undefined,
    disabledSkills,
    diagnostics,
    configPath: configRead.configPath,
  };
}

export function resolveSkillSourceAlias(
  alias: string,
  opts: { cwd?: string; homeDir?: string } = {},
): string {
  const cwd = path.resolve(opts.cwd ?? process.cwd());
  const homeDir = opts.homeDir ?? os.homedir();
  const source = alias.trim();
  const repoSkills = (dir: string) => path.join(cwd, dir, 'skills');
  const homeSkills = (dir: string) => path.join(homeDir, dir, 'skills');
  switch (source) {
    case '.agents':
    case 'repo:.agents':
      return repoSkills('.agents');
    case '.claude':
    case 'repo:.claude':
      return repoSkills('.claude');
    case '.github':
    case 'repo:.github':
      return repoSkills('.github');
    case 'global:agents':
    case '~/.agents':
      return homeSkills('.agents');
    case 'global:copilot':
    case '~/.copilot':
      return homeSkills('.copilot');
    case 'global:claude':
    case '~/.claude':
      return homeSkills('.claude');
    case 'global:pi':
      return path.join(homeDir, '.pi', 'agent', 'skills');
    default:
      if (source.startsWith('path:')) {
        return resolvePossiblyTildePath(
          source.slice('path:'.length),
          cwd,
          homeDir,
        );
      }
      return resolvePossiblyTildePath(source, cwd, homeDir);
  }
}

export function discoverSkillsFromSources(
  sources: ResolvedSkillSource[],
): DiscoveredSkill[] {
  const skills: DiscoveredSkill[] = [];
  const seenDirs = new Set<string>();
  for (const source of sources) {
    if (!source.exists) continue;
    const sourceStat = safeStat(source.path);
    if (!sourceStat?.isDirectory()) continue;
    if (isSkillDir(source.path)) {
      const skill = readSkill(source.path, source);
      if (!seenDirs.has(skill.dir)) {
        seenDirs.add(skill.dir);
        skills.push(skill);
      }
      continue;
    }
    const entries = fs
      .readdirSync(source.path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const dir = path.join(source.path, entry.name);
      if (!isSkillDir(dir)) continue;
      const skill = readSkill(dir, source);
      if (!seenDirs.has(skill.dir)) {
        seenDirs.add(skill.dir);
        skills.push(skill);
      }
    }
  }
  return skills;
}

function readSkill(dir: string, source: ResolvedSkillSource): DiscoveredSkill {
  const folderName = path.basename(dir);
  const metadataName = readSkillMetadataName(path.join(dir, 'SKILL.md'));
  return {
    name: metadataName ?? folderName,
    dir,
    sourceAlias: source.alias,
    sourcePath: source.path,
    ...(metadataName && { metadataName }),
  };
}

function readSkillMetadataName(skillPath: string): string | undefined {
  try {
    const text = fs.readFileSync(skillPath, 'utf-8');
    const firstLines = text.split('\n').slice(0, 30);
    for (const line of firstLines) {
      const match = /^name:\s*["']?([^"'\n]+)["']?\s*$/.exec(line.trim());
      if (match?.[1]) return match[1].trim();
    }
  } catch {
    // ignore unreadable skill metadata
  }
  return undefined;
}

function isSkillDir(dir: string): boolean {
  return fs.existsSync(path.join(dir, 'SKILL.md'));
}

function safeStat(target: string): fs.Stats | null {
  try {
    return fs.statSync(target);
  } catch {
    return null;
  }
}

function resolvePossiblyTildePath(
  value: string,
  cwd: string,
  homeDir: string,
): string {
  if (value === '~') return homeDir;
  if (value.startsWith('~/')) return path.join(homeDir, value.slice(2));
  return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))];
}

export function hasSkillErrors(resolved: ResolvedSkillsConfig): boolean {
  return resolved.diagnostics.some(
    (diagnostic) => diagnostic.level === 'error',
  );
}
