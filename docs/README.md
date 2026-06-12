# ScaledSearch Documentation

Version-controlled schema migrations for Elasticsearch and OpenSearch — "Flyway for search engines."

This is the full documentation. For a quick overview, see the [project README](../README.md).

## Getting Started

- [Installation](getting-started.md#installation)
- [Quick start — new project](getting-started.md#quick-start--new-project)
- [Quick start — existing cluster](getting-started.md#quick-start--existing-cluster)

## Reference

- [Commands](commands.md) — every `scaledsearch migrate` subcommand and its flags
- [Migration file format](migration-files.md) — YAML structure, versioning, checksums, rollback
- [Operation types](operations.md) — all 15 operations with examples
- [Configuration](configuration.md) — `config.yaml`, authentication, history index
- [Engines](engines.md) — Elasticsearch & OpenSearch support matrix

## Guides

- [Zero-downtime migrations (alias swap)](guides/zero-downtime.md)
- [Importing an existing cluster](guides/importing.md)
- [Validating migrations offline](guides/validation.md)

## Project

- [Changelog](../CHANGELOG.md)
- [Contributing](../CONTRIBUTING.md)
- [License (MIT)](../LICENSE)
