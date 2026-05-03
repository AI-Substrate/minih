import { checkManifestPath } from './manifest.js';
import type { ParsedAgentUrl } from './types.js';

const MAX_URL_BYTES = 2048;
const DEFAULT_REF = 'main';

/**
 * Parse a user-supplied install reference into a structured form. Accepts
 * three syntaxes (per workshop 001 § Q8 — all three resolved as accepted):
 *
 *   1. npm-style github shorthand (canonical):
 *        `github:owner/repo`
 *        `github:owner/repo#ref`
 *        `github:owner/repo#ref:subpath`
 *        `github:owner/repo:subpath`
 *   2. Full HTTPS URL (with optional `#ref:subpath` fragment OR `?path=` query):
 *        `https://github.com/owner/repo`
 *        `https://github.com/owner/repo#ref:subpath`
 *        `https://github.com/owner/repo?path=agents/x`
 *
 * `subpathOverride` (from `--subpath` flag) wins over any URL-derived
 * subpath. Output is normalised — `renderAgentUrlCanonical` projects to
 * the npm-style canonical form regardless of input syntax.
 *
 * Rejects (E108-class):
 *   - empty input
 *   - input >2048 bytes
 *   - null byte in any segment
 *   - bare slugs (not a URL — caller should have routed those through registry resolution first)
 *   - subpath that fails `checkManifestPath` (traversal, leading `/`, etc.)
 *   - URL-encoded traversal in `?path=` (decoded, then validated)
 */
export function parseAgentUrl(
  input: string,
  opts?: { subpathOverride?: string },
): ParsedAgentUrl {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('agent URL must be a non-empty string');
  }
  if (Buffer.byteLength(input, 'utf-8') > MAX_URL_BYTES) {
    throw new Error(
      `agent URL too long (${Buffer.byteLength(input, 'utf-8')} bytes; max ${MAX_URL_BYTES})`,
    );
  }
  if (input.includes('\u0000')) {
    throw new Error('agent URL must not contain null byte');
  }

  let parsed: ParsedAgentUrl;
  if (input.startsWith('github:')) {
    parsed = parseGithubShorthand(input);
  } else if (input.startsWith('https://') || input.startsWith('http://')) {
    parsed = parseHttpsUrl(input);
  } else if (
    input.startsWith('/') ||
    input.startsWith('./') ||
    input.startsWith('../')
  ) {
    parsed = { type: 'local', path: input, raw: input };
  } else {
    throw new Error(
      `agent URL "${input}" not recognised — expected github:owner/repo, https://github.com/owner/repo, or local path`,
    );
  }

  // Apply subpath override AFTER initial parse, then validate.
  const finalSubpath = opts?.subpathOverride ?? extractSubpath(parsed);
  if (finalSubpath !== undefined) {
    const decoded = safeDecodeURIComponent(finalSubpath);
    const pathErr = checkManifestPath(decoded);
    if (pathErr) {
      throw new Error(`subpath "${finalSubpath}" invalid: ${pathErr}`);
    }
    return setSubpath(parsed, decoded);
  }
  return parsed;
}

/**
 * Render a parsed URL to its npm-style canonical form. Used in error
 * messages and for `agent info` display.
 */
export function renderAgentUrlCanonical(p: ParsedAgentUrl): string {
  if (p.type === 'github' || p.type === 'https') {
    const base = `github:${p.owner}/${p.repo}`;
    if (p.subpath !== undefined) return `${base}#${p.ref}:${p.subpath}`;
    if (p.ref !== DEFAULT_REF) return `${base}#${p.ref}`;
    return base;
  }
  // local
  return p.path;
}

function parseGithubShorthand(input: string): ParsedAgentUrl {
  // github:owner/repo[#ref[:subpath]] OR github:owner/repo[:subpath] (no ref)
  const body = input.slice('github:'.length);
  if (body.length === 0) {
    throw new Error(`malformed github shorthand: ${input}`);
  }

  // Split off subpath (after #ref:subpath OR after :subpath when no ref)
  let ownerRepoPart = body;
  let ref: string | undefined;
  let subpath: string | undefined;

  const hashIdx = body.indexOf('#');
  if (hashIdx >= 0) {
    ownerRepoPart = body.slice(0, hashIdx);
    const afterHash = body.slice(hashIdx + 1);
    const colonIdx = afterHash.indexOf(':');
    if (colonIdx >= 0) {
      ref = afterHash.slice(0, colonIdx);
      subpath = afterHash.slice(colonIdx + 1);
    } else {
      ref = afterHash;
    }
  } else {
    // Maybe github:owner/repo:subpath (no ref)
    const colonIdx = body.indexOf(':');
    if (colonIdx >= 0) {
      ownerRepoPart = body.slice(0, colonIdx);
      subpath = body.slice(colonIdx + 1);
    }
  }

  const slashIdx = ownerRepoPart.indexOf('/');
  if (slashIdx <= 0 || slashIdx === ownerRepoPart.length - 1) {
    throw new Error(`malformed github shorthand: ${input}`);
  }
  const owner = ownerRepoPart.slice(0, slashIdx);
  const repo = ownerRepoPart.slice(slashIdx + 1).replace(/\.git$/, '');

  return {
    type: 'github',
    owner,
    repo,
    ref: ref ?? DEFAULT_REF,
    subpath,
    raw: input,
  };
}

function parseHttpsUrl(input: string): ParsedAgentUrl {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`malformed HTTPS URL: ${input}`);
  }

  if (url.hostname !== 'github.com') {
    throw new Error(
      `only github.com HTTPS URLs are supported in v1; got ${url.hostname}`,
    );
  }

  const segments = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  const owner = segments[0];
  const repoRaw = segments[1];
  if (!owner || !repoRaw) {
    throw new Error(`HTTPS URL missing owner/repo: ${input}`);
  }
  const repo = repoRaw.replace(/\.git$/, '');

  let ref = DEFAULT_REF;
  let subpath: string | undefined;

  if (url.hash) {
    const afterHash = url.hash.slice(1);
    const colonIdx = afterHash.indexOf(':');
    if (colonIdx >= 0) {
      ref = afterHash.slice(0, colonIdx);
      subpath = afterHash.slice(colonIdx + 1);
    } else {
      ref = afterHash;
    }
  }

  // ?path= takes priority over fragment subpath
  const queryPath = url.searchParams.get('path');
  if (queryPath !== null) {
    subpath = queryPath;
  }

  return {
    type: 'https',
    origin: url.origin,
    owner,
    repo,
    ref,
    subpath,
    raw: input,
  };
}

function extractSubpath(p: ParsedAgentUrl): string | undefined {
  if (p.type === 'github' || p.type === 'https') return p.subpath;
  return undefined;
}

function setSubpath(p: ParsedAgentUrl, subpath: string): ParsedAgentUrl {
  if (p.type === 'github') return { ...p, subpath };
  if (p.type === 'https') return { ...p, subpath };
  return p;
}

function safeDecodeURIComponent(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    // Malformed encoding — leave as-is so checkManifestPath can reject.
    return s;
  }
}
