# Operation Types

Every entry under a migration's `operations:` (or `rollback:`) list has a `type`.
ScaledSearch supports 15 operation types across 6 categories.

| Category | Operations |
|----------|-----------|
| Index | `create_index`, `delete_index`, `close_index`, `open_index` |
| Schema | `put_mapping`, `put_settings` |
| Data | `reindex` (async with progress) |
| Alias | `add_alias`, `remove_alias`, `swap_alias` |
| Template | `put_template`, `delete_template` |
| Pipeline | `put_pipeline`, `delete_pipeline` |
| Generic | `api_call` (any REST API) |

---

## Index

```yaml
- type: create_index
  index: products
  settings:
    number_of_shards: 2
    number_of_replicas: 1
  mappings:
    properties:
      title: { type: text }

- type: delete_index
  index: products_v1

- type: close_index
  index: archive-2023

- type: open_index
  index: archive-2023
```

> `create_index` accepts both the native `mappings:`/`settings:` shape and the
> Flyway-style `body: { mappings: ... }` shape — both are normalized correctly
> before being sent to the cluster.

## Schema

```yaml
- type: put_mapping
  index: products
  body:
    properties:
      in_stock: { type: boolean }

- type: put_settings
  index: products
  body:
    number_of_replicas: 2
```

## Data — reindex

Reindex runs **asynchronously** with real-time progress tracking. No configuration
needed. If the CLI disconnects, the reindex keeps running on the cluster.

```yaml
- type: reindex
  source: products_v1
  dest: products_v2
```

```
Applying V003 Migrate to products_v2... 45% (4,500,000/10,000,000 docs) done (42m)
```

## Alias

```yaml
# Add an alias
- type: add_alias
  index: products_v2
  alias: products

# Remove an alias
- type: remove_alias
  index: products_v1
  alias: products

# Atomic swap (remove + add in a single cluster call)
- type: swap_alias
  alias: products
  from: products_v1
  to: products_v2
```

See the [zero-downtime guide](guides/zero-downtime.md) for the full alias-swap
pattern.

## Template

```yaml
- type: put_template
  name: logs-template
  body:
    index_patterns: ["logs-*"]
    template:
      mappings:
        properties:
          message: { type: text }

- type: delete_template
  name: logs-template
```

## Pipeline

```yaml
- type: put_pipeline
  name: add-timestamp
  body:
    processors:
      - set: { field: ingested_at, value: "{{_ingest.timestamp}}" }

- type: delete_pipeline
  name: add-timestamp
```

## Generic — api_call

An escape hatch for any Elasticsearch/OpenSearch REST API not covered by a dedicated
operation:

```yaml
- type: api_call
  method: PUT
  path: /_cluster/settings
  body:
    persistent:
      cluster.routing.allocation.disk.watermark.high: "90%"
```

Works with any API: ILM policies, cluster settings, component templates, and more.
