# ScaledSearch

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/scaledsearch.svg)](https://www.npmjs.com/package/scaledsearch)

**Flyway for Search Engines** — Version-controlled schema migrations for Elasticsearch, OpenSearch, and Solr.

Every database has Flyway or Liquibase. Search engines have had... nothing. Until now.

## The Problem

- ES upgrades break things. 40% codebase rewrite per major version.
- No way to version-control index mappings across environments.
- Teams lose data during migrations ("we lost 35K docs even though reindex succeeded").
- No rollback. No dry-run. No safety net.

## The Solution

```bash
npm install -g scaledsearch

ss init                          # Initialize project
ss create "add-products-index"   # Create versioned migration
ss status                        # See what's pending
ss migrate --dry-run             # Preview changes safely
ss migrate                       # Apply to cluster
ss validate                      # Check integrity
```

## Quick Start

```bash
# 1. Install
npm install -g scaledsearch

# 2. Initialize in your project
ss init

# 3. Create your first migration
ss create "initial-schema"

# 4. Edit the generated YAML file
# migrations/V001__initial-schema.yaml

# 5. Apply
ss migrate
```

## Migration File Format

```yaml
description: "Create products index with vector search"
engine: elasticsearch
target_version: ">=8.0"
operations:
  - type: create_index
    index: products
    settings:
      number_of_shards: 2
      number_of_replicas: 1
    mappings:
      properties:
        title:
          type: text
          analyzer: standard
        embedding:
          type: dense_vector
          dims: 768
        price:
          type: float
        created_at:
          type: date
```

## Commands

| Command | Description |
|---------|-------------|
| `ss init` | Initialize ScaledSearch in current directory |
| `ss create <name>` | Create a new versioned migration file |
| `ss status` | Show applied vs pending migrations |
| `ss migrate` | Apply pending migrations to cluster |
| `ss migrate --dry-run` | Preview without applying (works offline) |
| `ss diff` | Show detailed pending changes |
| `ss validate` | Check migration file integrity |
| `ss rollback` | Undo last migration |

## Supported Engines

| Engine | Versions | Status |
|--------|----------|--------|
| Elasticsearch | 7.x, 8.x, 9.x | ✅ Supported |
| OpenSearch | 1.x, 2.x, 3.x | ✅ Supported |
| Solr | 8.x, 9.x | 🔜 Coming soon |

## Why ScaledSearch?

| | ScaledSearch | elasticsearch-evolution | opensearch-migrations |
|---|---|---|---|
| Install | `npm i -g` | Maven + Spring Boot | Docker + K8s |
| Language | Any (standalone CLI) | Java only | Java/Python |
| Engines | ES + OpenSearch + Solr | ES + OpenSearch | ES → OpenSearch only |
| Direction | Any → Any | Same-engine only | One-way |
| Dry-run | ✅ (works offline) | ❌ | ❌ |
| Schema versioning | ✅ | ✅ | ❌ |

## Configuration

ScaledSearch stores config in `.scaledsearch/config.yaml`:

```yaml
engine: elasticsearch
connection:
  host: http://localhost:9200
migrations:
  location: ./migrations
history:
  index: .scaledsearch_history
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

[MIT](LICENSE) — free for commercial and personal use.

## Roadmap

- [x] Core CLI (init, create, status, migrate, diff, validate)
- [x] Elasticsearch 7-9 support
- [x] OpenSearch 2-3 support
- [x] Rollback support
- [ ] Solr support
- [ ] CI/CD integration (GitHub Actions)
- [ ] Multi-cluster environments
- [ ] Web dashboard
- [ ] AI-powered migration suggestions
