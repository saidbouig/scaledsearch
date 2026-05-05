# ScaledSearch

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![npm version](https://img.shields.io/npm/v/scaledsearch.svg)](https://www.npmjs.com/package/scaledsearch)

**The Search Engineer's Toolkit** — Open source CLI tools for Elasticsearch, OpenSearch, and Solr.

Migrate, audit, benchmark, monitor, tune, and optimize your search infrastructure. One install, all tools.

## Install

```bash
npm install -g scaledsearch
```

## The Toolkit

| Tool | Description | Status |
|------|-------------|--------|
| `ss migrate` | Version-controlled schema migrations | ✅ Available |
| `ss audit` | Cluster health, security, and performance scan | Coming soon |
| `ss bench` | Query latency and throughput benchmarking | Coming soon |
| `ss monitor` | Continuous search quality monitoring | Coming soon |
| `ss tune` | Relevance tuning and optimization | Coming soon |
| `ss cost` | Cost analysis and optimization | Coming soon |

## Quick Start — New Project

```bash
# 1. Initialize in your project
ss migrate init

# 2. Create a migration
ss migrate create "add-products-index"

# 3. Edit the generated YAML file
# migrations/V001__add-products-index.yaml

# 4. Preview changes
ss migrate apply --dry-run

# 5. Apply
ss migrate apply

# 6. Check status
ss migrate status
```

## Quick Start — Existing Cluster

Already have indices in production? Import them as a baseline:

```bash
# 1. Initialize
ss migrate init

# 2. Import current cluster state as V000
ss migrate import

# 3. Start versioning from here
ss migrate create "add-vector-field"
ss migrate apply
```

`ss migrate import` snapshots all indices, mappings, settings, and aliases into `V000__baseline.yaml` and marks it as already applied.

## Migration Commands

| Command | Description |
|---------|-------------|
| `ss migrate init` | Initialize ScaledSearch in current directory |
| `ss migrate create <name>` | Create a new versioned migration file |
| `ss migrate status` | Show applied vs pending migrations |
| `ss migrate apply` | Apply pending migrations to cluster |
| `ss migrate apply --dry-run` | Preview without applying (works offline) |
| `ss migrate diff` | Show detailed pending changes |
| `ss migrate validate` | Check migration file integrity |
| `ss migrate rollback` | Undo last migration |
| `ss migrate import` | Import existing cluster as V000 baseline |

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
rollback:
  - type: delete_index
    index: products
```

### Zero-Downtime Migration (Alias Swap)

```yaml
description: "Migrate to products_v2 with zero downtime"
operations:
  - type: create_index
    index: products_v2
    mappings:
      properties:
        title:
          type: text
        embedding:
          type: dense_vector
          dims: 768
  - type: reindex
    source: products_v1
    dest: products_v2
  - type: swap_alias
    alias: products
    from: products_v1
    to: products_v2
```

### Alias Operations

```yaml
# Add alias
- type: add_alias
  index: products_v2
  alias: products

# Remove alias
- type: remove_alias
  index: products_v1
  alias: products

# Atomic swap (remove + add in one call)
- type: swap_alias
  alias: products
  from: products_v1
  to: products_v2
```

### Templates & Pipelines

```yaml
# Index template
- type: put_template
  name: logs-template
  body:
    index_patterns: ["logs-*"]
    template:
      mappings:
        properties:
          message: { type: text }

# Ingest pipeline
- type: put_pipeline
  name: add-timestamp
  body:
    processors:
      - set: { field: ingested_at, value: "{{_ingest.timestamp}}" }
```

### Generic API Calls

Use `api_call` as an escape hatch for any ES/OpenSearch REST API:

```yaml
- type: api_call
  method: PUT
  path: /_cluster/settings
  body:
    persistent:
      cluster.routing.allocation.disk.watermark.high: "90%"
```

Works with any API: index templates, ingest pipelines, ILM policies, cluster settings, and more.

## Supported Engines

| Engine | Versions | Status |
|--------|----------|--------|
| Elasticsearch | 7.x, 8.x, 9.x | ✅ Verified |
| OpenSearch | 1.x, 2.x, 3.x | ✅ Verified |
| Solr | 8.x, 9.x | Coming soon |

Tested against: ES 7.17, ES 8.17, ES 9.0, OpenSearch 2.19, OpenSearch 3.0

## Why ScaledSearch?

| | ScaledSearch | elasticsearch-evolution | opensearch-migrations |
|---|---|---|---|
| Install | `npm i -g` | Maven + Spring Boot | Docker + K8s |
| Language | Any (standalone CLI) | Java only | Java/Python |
| Engines | ES + OpenSearch + Solr | ES + OpenSearch | ES → OpenSearch only |
| Dry-run | ✅ (works offline) | ❌ | ❌ |
| Rollback | ✅ | ❌ | ❌ |
| Schema versioning | ✅ | ✅ | ❌ |
| Migration locking | ✅ | ✅ | ❌ |
| Checksum validation | ✅ | ✅ | ❌ |

## Configuration

```yaml
# .scaledsearch/config.yaml
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

### Migrations
- [x] Core CLI (init, create, status, migrate, diff, validate, rollback)
- [x] Elasticsearch 7-9 support
- [x] OpenSearch 2-3 support
- [x] Migration locking
- [x] Checksum validation
- [ ] Solr support
- [ ] CI/CD integration (GitHub Actions)
- [ ] Multi-cluster environments

### Toolkit
- [ ] `ss audit` — cluster health check
- [ ] `ss bench` — performance benchmarking
- [ ] `ss monitor` — continuous monitoring
- [ ] `ss tune` — relevance tuning
- [ ] `ss cost` — cost optimization
