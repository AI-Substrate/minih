#!/usr/bin/env node
// Diff two baseline directories produced by capture-p1-baseline.sh.
// Strips transient keys (timestamp, ts, runId, sessionId, duration, startedAt, completedAt, runDir)
// and compares every JSON file. Exits 0 on equivalence, 1 on diff.
//
// Usage:
//   node scripts/diff-baselines.mjs <pre-dir> <post-dir>

import * as fs from 'node:fs';
import * as path from 'node:path';

const IGNORE_KEYS = new Set([
  'timestamp',
  'ts',
  'runId',
  'sessionId',
  'duration',
  'startedAt',
  'completedAt',
  'runDir',
]);

function strip(value) {
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (IGNORE_KEYS.has(k)) continue;
      out[k] = strip(v);
    }
    return out;
  }
  return value;
}

function loadStripped(file) {
  return strip(JSON.parse(fs.readFileSync(file, 'utf8')));
}

function main() {
  const [pre, post] = process.argv.slice(2);
  if (!pre || !post) {
    console.error('Usage: diff-baselines.mjs <pre-dir> <post-dir>');
    process.exit(2);
  }
  const preFiles = fs
    .readdirSync(pre)
    .filter((f) => f.endsWith('.json'))
    .sort();
  const postFiles = fs
    .readdirSync(post)
    .filter((f) => f.endsWith('.json'))
    .sort();

  if (preFiles.join(',') !== postFiles.join(',')) {
    console.error('FAIL: file set differs');
    console.error('  pre: ', preFiles);
    console.error('  post:', postFiles);
    process.exit(1);
  }

  let diffs = 0;
  for (const f of preFiles) {
    const a = loadStripped(path.join(pre, f));
    const b = loadStripped(path.join(post, f));
    const aj = JSON.stringify(a);
    const bj = JSON.stringify(b);
    if (aj !== bj) {
      diffs++;
      console.error(`DIFF in ${f}`);
      // Emit a brief structural diff via length + first divergence
      const max = Math.min(aj.length, bj.length);
      let i = 0;
      while (i < max && aj[i] === bj[i]) i++;
      console.error(`  first divergence at char ${i}:`);
      console.error(`  pre:  ${aj.slice(Math.max(0, i - 40), i + 80)}`);
      console.error(`  post: ${bj.slice(Math.max(0, i - 40), i + 80)}`);
    }
  }

  if (diffs > 0) {
    console.error(`FAIL: ${diffs} file(s) differ`);
    process.exit(1);
  }
  console.error(`OK: ${preFiles.length} file(s) match (after key-strip)`);
}

main();
