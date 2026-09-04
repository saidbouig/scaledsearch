# Changelog

All notable changes to ScaledSearch are documented here.
This project follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- `migrate create` now uses the configured engine when generating migration
  files, including an OpenSearch-compatible default version constraint.

## [1.2.0] - 2026-06-18

### Added
- `reindex` operations accept `op_type`, `conflicts`, `version_type`, and `query`,
  enabling a delta-safe zero-downtime reindex while clients are still writing
  (backfill + delta catch-up) directly in YAML. Omitting these reproduces the
  previous behavior. The [zero-downtime guide](docs/guides/zero-downtime.md)
  documents the full live-writes sequence, including the `_refresh`-before-swap
  step required under a high `refresh_interval`.
  ([#20](https://github.com/saidbouig/scaledsearch/pull/20))

### Fixed
- Resolved TypeScript errors in cluster detection (`version.distribution` reads in
  `getClusterInfo`/`detectEngine`), so `tsc --noEmit` is clean. No behavior change.
  ([#20](https://github.com/saidbouig/scaledsearch/pull/20))

## [1.1.0] - 2026-06-12

### Added
- `migrate validate` now simulates the end-state from your migration files
  (offline), surfacing wildcard and reindex-destination resolution — not just
  file integrity. ([#12](https://github.com/saidbouig/scaledsearch/pull/12))
- `migrate import` captures more of the cluster: index templates, ingest
  pipelines, alias options, and closed-index state.
  ([#14](https://github.com/saidbouig/scaledsearch/pull/14))
- `migrate import` automatically excludes built-in/system-owned templates,
  pipelines, and indices (APM, Fleet, ML, ILM/SLM history, leading-dot system
  indices, and OpenSearch plugin state) so the generated baseline doesn't fight
  the cluster on replay. ([#14](https://github.com/saidbouig/scaledsearch/pull/14))

### Fixed
- Failed migrations are no longer recorded as applied.
  ([#9](https://github.com/saidbouig/scaledsearch/pull/9))
- `migrate init` now derives a per-project history index name, so multiple
  projects on one cluster no longer share history.
  ([#10](https://github.com/saidbouig/scaledsearch/pull/10))
- History index hashing resolves the real path of the cwd first, fixing
  symlink, long-name, and upgrade-path edge cases.
  ([#11](https://github.com/saidbouig/scaledsearch/pull/11))
- `migrate init` self-heals partial setups and reports filesystem errors
  with friendly messages. ([#13](https://github.com/saidbouig/scaledsearch/pull/13))
- `status`, `diff`, and `apply` handle corrupted migration files gracefully
  and surface orphaned history entries instead of crashing.
  ([#15](https://github.com/saidbouig/scaledsearch/pull/15),
  [#16](https://github.com/saidbouig/scaledsearch/pull/16),
  [#17](https://github.com/saidbouig/scaledsearch/pull/17))
- `apply` validates `--target`, honors it in dry-run, and reports friendly
  errors on corrupt files. ([#17](https://github.com/saidbouig/scaledsearch/pull/17))

## [1.0.5] - 2026-05-19

### Fixed
- CLI version is now read from `package.json` instead of a hardcoded string,
  so `--version` always matches the published release.

## [1.0.4] - 2026-05-19

### Fixed
- Race in stale-lock recovery in `acquireLock`.
  ([#8](https://github.com/saidbouig/scaledsearch/pull/8))

### Added
- Expanded test coverage: OpenSearch coverage, engine factory + status tests,
  import/diff/engine-extras, history, rollback, and migrate-apply edge cases.

## [1.0.3] - 2026-05-19

### Fixed
- 1.0.2 shipped with a stale `dist/` that did not include the bug fix below.
  Published with a `prepublishOnly` hook that rebuilds + retests before every
  publish, so this cannot happen again.

## [1.0.2] - 2026-05-19 [DEPRECATED]

Skipped. Tag exists in git but the npm tarball was built before the fix and
behaves identically to 1.0.1. Use 1.0.3 instead.

### Fixed (intended, not actually shipped in 1.0.2)
- `create_index` operations using Flyway-style `body: { mappings: ... }` were
  double-wrapped before being sent to the cluster, causing Elasticsearch to
  reject them with `mapper_parsing_exception: Root mapping definition has
  unsupported parameters`. Both `mappings:` and `body:` shapes now normalize
  correctly. ([#6](https://github.com/saidbouig/scaledsearch/pull/6))

### Added
- Test suite (Vitest): 42 unit tests + 26 integration tests = 68 total.
- Docker Compose harness with Elasticsearch 9.0 + OpenSearch 2.19 for
  integration tests.
- `npm test`, `test:unit`, `test:integration`, `test:all`, `test:watch`,
  `test:coverage`, `docker:up`, `docker:down` scripts.

## [1.0.1] - 2026-05-05

- Initial public release.
