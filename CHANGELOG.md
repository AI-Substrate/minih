# Changelog

## [0.1.3](https://github.com/AI-Substrate/minih/compare/minih-v0.1.2...minih-v0.1.3) (2026-04-11)


### Features

* MCP config support — auto-discovery + --mcp-config flag ([#9](https://github.com/AI-Substrate/minih/issues/9)) ([c64cde7](https://github.com/AI-Substrate/minih/commit/c64cde7e29a66742c8260f128eeda72c91047a5b))


### Bug Fixes

* biome lint errors + merge main (v0.1.2) ([fbe9c49](https://github.com/AI-Substrate/minih/commit/fbe9c499992b429c6b8393551d8b5f289a70af5c))

## [0.1.2](https://github.com/AI-Substrate/minih/compare/minih-v0.1.1...minih-v0.1.2) (2026-04-10)


### Features

* make agents reusable — parameterized code-review + design guidance ([66d377b](https://github.com/AI-Substrate/minih/commit/66d377b6bf056bfbd68b8189c41e6971e5f33897))


### Bug Fixes

* inline retrospective schema — remove unresolvable $ref ([#4](https://github.com/AI-Substrate/minih/issues/4)) ([170d38a](https://github.com/AI-Substrate/minih/commit/170d38af903c74de309ae1d44433fe668278710a))

## [0.1.1](https://github.com/AI-Substrate/minih/compare/minih-v0.1.0...minih-v0.1.1) (2026-04-08)


### Features

* add code-review dogfood agent — exemplar of minih-powered code review ([a84b3a1](https://github.com/AI-Substrate/minih/commit/a84b3a1d3ca9ff197b1850728ad88a2c7dd3b05d))
* add first-time-experience dogfood agent ([df20299](https://github.com/AI-Substrate/minih/commit/df20299ecb1334f9103b31dcfaf60b1b0610590e))
* default model claude-opus-4.6 + MINIH_DEFAULT_MODEL env var ([950d444](https://github.com/AI-Substrate/minih/commit/950d444301bc23c24916c6d65bd69f8ddf627fa3))
* mandatory self-validation + cleanup instructions for agents ([266cc4d](https://github.com/AI-Substrate/minih/commit/266cc4d5e2797ad7a35bf21df979ee4d2344f4d7))
* minih inspect &lt;slug&gt; — show fully composed agent prompt ([#2](https://github.com/AI-Substrate/minih/issues/2)) ([452fccf](https://github.com/AI-Substrate/minih/commit/452fccfe0dae9acc1a5d5dee32e6702c55f990c4))
* minih quickstart — zero-to-success in 60 seconds ([8a18c7e](https://github.com/AI-Substrate/minih/commit/8a18c7e6ae62b97ebfa43cf420a358cf8fdc180f))
* minih status &lt;slug&gt; — one-shot liveness check for running agents ([8809ddc](https://github.com/AI-Substrate/minih/commit/8809ddc8cba85807e137b34f878a3cadf6389ae1))
* per-agent model + reasoning in prompt.md frontmatter ([cdce3dc](https://github.com/AI-Substrate/minih/commit/cdce3dc8e20fe05671941b95b5efb26030b8ee33))
* per-agent timeout in frontmatter, default 15min ([9369f38](https://github.com/AI-Substrate/minih/commit/9369f3830b33368853bd1d8ebf5009ce38df2ccb))
* Phase 1 — project scaffold + types ([eb4e9f6](https://github.com/AI-Substrate/minih/commit/eb4e9f65605708eaf31411b04b9ebc7d2d6b9e30))
* Phase 2 — runner core ([a2a90f5](https://github.com/AI-Substrate/minih/commit/a2a90f51b3f68f9f6cfed621cfe69bd57ff4c153))
* Phase 3 — SDK adapter ([b8b6591](https://github.com/AI-Substrate/minih/commit/b8b6591e0ee9cf9a75fae15cffa743bd132aac40))
* Phase 4 — CLI + first run 🎉 ([5179d2a](https://github.com/AI-Substrate/minih/commit/5179d2afa72ccc62cd47e2b6f31658cde439d381))
* Phase 5 — system output enforcement + doctor/check/init/dry-run ([90a2060](https://github.com/AI-Substrate/minih/commit/90a20606496654abcdc57d40c419277db2c15cae))
* Phase 6 — dogfood agents + README + feedback loop ([c33a91a](https://github.com/AI-Substrate/minih/commit/c33a91ab755940b9822200b9dc464a43a4682e00))
* pretty mode — clean streaming display (default) ([056d679](https://github.com/AI-Substrate/minih/commit/056d67924d2c7624992d28d91384ab56076f3d04))
* session isolation — SDK CWD set to run folder ([0accb16](https://github.com/AI-Substrate/minih/commit/0accb16df470f349bd8113738cf4496365a326c3))
* session resume + connect commands ([4c9c132](https://github.com/AI-Substrate/minih/commit/4c9c1329a67df728e422838d982ba022d08bf3b7))
* show AGENTS_README.md link in --help output ([37b61f3](https://github.com/AI-Substrate/minih/commit/37b61f3e55d12b5053860803eae300f023e065ed))


### Bug Fixes

* add prepare script for npx from GitHub ([90f3ff9](https://github.com/AI-Substrate/minih/commit/90f3ff9a4cf3fb58aa98b0b79bcbdcf2f473ba68))
* address Phase 1 review findings ([6d0505c](https://github.com/AI-Substrate/minih/commit/6d0505cf81558452fdda1ca88888a049646f31bf))
* address Phase 2 review findings ([29af6d5](https://github.com/AI-Substrate/minih/commit/29af6d50698f0aca42f405624343b0c1443a6242))
* address Phase 3 review findings ([e4f4acb](https://github.com/AI-Substrate/minih/commit/e4f4acb60c21f48f9e8b4f84747666d86c2c2a5f))
* address Phase 5 review findings ([d4bf60b](https://github.com/AI-Substrate/minih/commit/d4bf60bf8c1a672033f2fd404044cf94c3d06d9e))
* address Phase 6 review findings ([01fd106](https://github.com/AI-Substrate/minih/commit/01fd106401637924e4bf11f81763497c77e983cd))
* address pretty-mode review findings ([6f0936e](https://github.com/AI-Substrate/minih/commit/6f0936e856165533c1052f9f3722d2d48452cb54))
* address resume review findings (FT-001 through FT-011) ([cf3bdcd](https://github.com/AI-Substrate/minih/commit/cf3bdcd5443ff64109a65e2962d218d157663f44))
* agent UX improvements (FX002 — 4 fixes from dogfood feedback) ([c01f2c8](https://github.com/AI-Substrate/minih/commit/c01f2c86f22e1e08bf5beea7cc2fc712271435b8))
* biome lint and format issues for CI ([b8c8f5a](https://github.com/AI-Substrate/minih/commit/b8c8f5aafe2b572064243d7a1bcfda4d22ff05d0))
* combine lint+format into single biome check step ([b130d90](https://github.com/AI-Substrate/minih/commit/b130d9025b50be54d9479a9f7925d28df513f1a5))
* cross-platform build scripts for Windows support ([5dcb064](https://github.com/AI-Substrate/minih/commit/5dcb064513781f2023c039972073c0839e25e4ec))
* normalize CRLF line endings in frontmatter parser ([#1](https://github.com/AI-Substrate/minih/issues/1)) ([0efb271](https://github.com/AI-Substrate/minih/commit/0efb27144d1c03ec288fcd8f42b3f1c34c3e3b0f))
* resolve @github/copilot-sdk from project root when running via npx ([ac50d29](https://github.com/AI-Substrate/minih/commit/ac50d2993a6d3cb18e125e7c3aafab44d3a9f9f9))
* use v0.x.y placeholder in docs until first release exists ([6ea7b3d](https://github.com/AI-Substrate/minih/commit/6ea7b3d250b4d00f044f5e637c372c053777f5c5))
