# ScaledSearch

**Flyway for Search Engines** — Version-controlled schema migrations for Elasticsearch, OpenSearch, and Solr.

## Quick Start

```bash
npm install -g @scaledsearch/cli

# Initialize in your project
ss init

# Create a migration
ss create "add-products-index"

# Edit the migration file, then apply
ss migrate

# Check status
ss status
```

## Commands

| Command | Description |
|---------|-------------|
| `ss init` | Initialize ScaledSearch in current directory |
| `ss create <name>` | Create a new versioned migration file |
| `ss status` | Show applied vs pending migrations |
| `ss migrate` | Apply pending migrations to cluster |
| `ss migrate --dry-run` | Preview changes without applying |
| `ss diff` | Show detailed pending changes |
| `ss rollback` | Undo last migration (coming soon) |

## Migration File Format

```yaml
description: "Add products index with vector field"
engine: elasticsearch
target_version: ">=8.0"
operations:
  - type: create_index
    index: products
    settings:
      number_of_shards: 1
    mappings:
      properties:
        title:
          type: text
        embedding:
          type: dense_vector
          dims: 768
```

## Supported Engines

- Elasticsearch 7.x, 8.x, 9.x
- OpenSearch 1.x, 2.x, 3.x
- Solr 8.x, 9.x (coming soon)

## Why ScaledSearch?

Every database has Flyway or Liquibase. Search engines have... nothing. Until now.

- **Version-controlled** — track every schema change in git
- **Engine-agnostic** — ES, OpenSearch, Solr with one tool
- **Safe** — dry-run, validation, rollback
- **Standalone** — no Java, no Spring Boot, just a CLI

## License

MIT
