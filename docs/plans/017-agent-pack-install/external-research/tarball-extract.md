# R2 Deepresearch — Tarball Extract Library Choice

**Generated**: 2026-05-03
**Question**: For a Node.js 20+ ESM-only TypeScript CLI that downloads a `.tar.gz` from `api.github.com/repos/{owner}/{repo}/tarball/{ref}` and extracts it safely with adversarial-input guards, which tar parser dep is the right pick?
**Tool**: Perplexity (sonar-reasoning-pro) + empirical `npm install` verification
**Plan**: 017-agent-pack-install § Phase 3 (Task 3.1 / dossier T001)

---

## TL;DR

**`tar` (node-tar) wins** — fewer transitive deps in practice, full ESM + TypeScript types, single-author trust chain (isaacs), and the low-level `Parser` API exposes raw header metadata so we can validate every entry ourselves.

Hand-rolled minimal reader is rejected — tar header parsing has a long tail of edge cases (ustar, pax, GNU long-name extensions, sparse files) that aren't worth re-implementing. Library-handles-format-parsing + we-handle-policy is the right boundary.

---

## Candidates evaluated

| Candidate | Verdict | Why |
|---|---|---|
| **`tar` (node-tar) v7.5.13** | ✅ **CHOSEN** | 6 transitive packages; pure-ESM with import/require dual exports; built-in TS types; isaacs-authored deps |
| `tar-stream` v3.2.0 | rejected | 13 transitive packages once `bare-*` ecosystem expands; CJS-first export shape; no built-in gzip |
| Hand-rolled minimal reader | rejected | Tar format edge cases (long-name `'L'`, pax `'x'`/`'g'`, sparse `'S'`, ustar checksums) are not worth re-implementing; library = format-parsing, we = policy |

---

## Empirical data (`npm install` in a fresh `type: "module"` project)

### `tar-stream@3.2.0`

```
added 13 packages, audited 14 packages in 3s — 0 vulnerabilities
└─┬ tar-stream@3.2.0
  ├─┬ b4a@1.8.1                          # Bare runtime cross-platform Buffer
  │ └── UNMET OPTIONAL react-native-b4a
  ├─┬ bare-fs@4.7.1                      # Bare runtime fs shim
  │ ├── UNMET OPTIONAL bare-buffer
  │ ├─┬ bare-events@2.8.2
  │ │ └── UNMET OPTIONAL bare-abort-controller
  │ ├─┬ bare-path@3.0.0
  │ │ └── bare-os@3.9.1
  │ ├─┬ bare-stream@2.13.1
  │ │ ├── streamx@2.25.0 deduped
  │ │ └─┬ teex@1.0.1 → streamx@2.25.0 deduped
  │ ├─┬ bare-url@2.4.2 → bare-path@3.0.0 deduped
  │ └── fast-fifo@1.3.2 deduped
  ├── fast-fifo@1.3.2
  └── streamx@2.25.0
```

ESM import: works, but exports are CJS-shaped (`'default'`, `'module.exports'`, `'extract'`, `'pack'` — the `module.exports` symbol is a smell).

### `tar@7.5.13`

```
added 6 packages, audited 7 packages in 385ms — 0 vulnerabilities
└─┬ tar@7.5.13
  ├─┬ @isaacs/fs-minipass@4.0.1
  │ └── minipass@7.1.3 deduped
  ├── chownr@3.0.0
  ├── minipass@7.1.3
  ├─┬ minizlib@3.1.0
  │ └── minipass@7.1.3 deduped
  └── yallist@5.0.0
```

ESM import: native ESM with explicit `exports` map (`./dist/esm/index.min.js` for import, `./dist/commonjs/index.min.js` for require). Built-in TypeScript types via `./dist/esm/index.d.ts`. All transitive deps are isaacs-authored.

---

## Decision criteria — scored

| Criterion | `tar-stream` | `tar` (node-tar) | Hand-rolled |
|-----------|---|---|---|
| Transitive deps (lower better) | ❌ 13 packages | ✅ 6 packages | ✅ 0 |
| Audit posture (vulns) | ✅ 0 high/critical | ✅ 0 high/critical | ✅ N/A |
| ESM-first | ⚠️ CJS-shaped | ✅ Native ESM exports | ✅ N/A |
| TypeScript types built-in | ❌ Not bundled (uses `@types/tar-stream` separately) | ✅ Bundled `.d.ts` | ✅ N/A |
| Streaming entry-by-entry | ✅ Event-based | ✅ Class-based parser | ✅ Custom |
| Provides raw header metadata | ✅ Yes (`header` event arg) | ✅ Yes (low-level `Parser`) | ✅ N/A |
| Built-in gzip handling | ❌ Need separate `gunzip-maybe` or `node:zlib` | ✅ Yes (uses `minizlib`) | ❌ Need `node:zlib` |
| Maintainer trust chain | tar-stream by mafintosh; deps by holepunchto/Bare team | All deps by isaacs (npm core author) | self |
| Last release | recent (2024) | recent (2025) | n/a |
| Bundle size estimate | ~5 KB tar-stream itself, but ~50+ KB once Bare deps install | ~50–100 KB | smallest |

---

## Why we override Perplexity's preliminary recommendation

Perplexity's reasoning (medium search context) recommended `tar` based on the assumption that `tar-stream` pulls in `gunzip-maybe` (a transitive). The actual `npm view tar-stream dependencies` shows `tar-stream` does NOT depend on `gunzip-maybe`; it leaves gzip handling to the consumer (which is fine — we use `node:zlib`).

However, the empirical install data still favors `tar`: `tar-stream`'s deps on the **Bare runtime ecosystem** (`b4a`, `bare-fs`, `bare-stream`, `bare-path`, `bare-os`, `bare-url`, `bare-events`, `teex`) double the install footprint compared to `tar`'s clean isaacs-stack. That makes the real-world supply-chain surface bigger, even though it audits clean today.

`tar`'s `Parser` class (low-level) gives us the same raw-entry control as `tar-stream`'s `extract` event, with native ESM, bundled types, and a smaller install footprint.

---

## DECISION

**Library: `tar` (npm package `tar`, version `^7.5.13`)**

**API choice**: low-level `Parser` (named export). We will:
1. Stream the response body through `node:zlib.createGunzip()` ourselves (keeps gunzip in stdlib so we don't depend on `tar`'s `minizlib` for our pipeline).
2. Pipe the gunzipped stream into `new tar.Parser()`.
3. Listen for `entry` events; reject entries that violate any of our 38+ guards before piping to disk; resume non-extractable entries (pax/long-name/global headers) to skip them.
4. Listen for `end` event; resolve with the list of files written.

**Rationale**: smaller install footprint, native ESM, built-in TS types, isaacs trust chain, no gzip dependency from the tar lib. We retain full control over per-entry validation — the lib is the format parser, we are the policy engine.

**Rejected**:
- `tar-stream`: bigger install footprint via Bare-runtime deps; CJS-shaped exports.
- Hand-rolled: not worth the long-tail edge-case risk.

---

## Risks accepted

- node-tar is a single-author dependency chain (isaacs). If isaacs's account is compromised, the entire chain is at risk. **Mitigation**: we lock to a specific minor version in `package.json`; `just fft` audit catches new advisories; we never call `tar.x()` (the shell-out filesystem-extraction high-level API), so even a compromised version landing a malicious extractor doesn't auto-execute against our user's filesystem — we only consume the raw `Parser` events.
- Future major version (`tar` v8+) may break `Parser` API. **Mitigation**: pin to `^7.x.x`; integration tests in T004 + T009 catch breakage.

---

## References

1. Perplexity reasoning thread (sonar-reasoning-pro, 2026-05-03)
2. `npm view tar dependencies` — verified 2026-05-03
3. `npm view tar-stream dependencies` — verified 2026-05-03
4. Empirical `npm install` in fresh `type: "module"` project — verified 2026-05-03
5. node-tar GitHub repo — `lib/parse.js` low-level `Parser` class
