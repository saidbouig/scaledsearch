# Changelog

All notable changes to ScaledSearch are documented here.
This project follows [Keep a Changelog](https://keepachangelog.com/) and [Semantic Versioning](https://semver.org/).

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
