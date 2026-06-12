# Migration File Format

Migrations are YAML files in your `migrations/` directory, named with an
auto-incrementing version prefix:

```
migrations/
├── V000__baseline.yaml      # optional, created by `import`
├── V001__add-products.yaml
└── V002__add-vector-field.yaml
```

## Structure

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

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `description` | recommended | Human-readable summary of the migration |
| `engine` | optional | `elasticsearch` or `opensearch` |
| `target_version` | optional | Version constraint (e.g. `">=8.0"`) checked at apply time |
| `operations` | **yes** | Ordered list of operations to apply — see [Operations](operations.md) |
| `rollback` | optional | Ordered list of operations to undo this migration |

## Versioning

Files are applied in ascending version order (`V001`, `V002`, …). The version is
parsed from the `V<number>__` prefix. Use `migrate create <name>` to get the next
version automatically.

## Checksums

When a migration is applied, ScaledSearch records a checksum of the file in the
history index. On every subsequent run it re-checks that checksum: if an
already-applied file has been modified, the run fails loudly rather than silently
diverging from what was actually applied to the cluster. This catches accidental
edits to history.

## Rollback sections

The optional `rollback:` block is a list of operations run (in order) by
`migrate rollback` to undo the migration. For zero-downtime alias patterns, the
safest rollback is often just swapping the alias back — see the
[zero-downtime guide](guides/zero-downtime.md).

If a migration has no `rollback:` section, `migrate rollback` refuses to undo it.
