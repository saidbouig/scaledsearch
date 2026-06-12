# Supported Engines

| Engine | Versions | Status |
|--------|----------|--------|
| Elasticsearch | 7.x, 8.x, 9.x | ✅ Verified |
| OpenSearch | 1.x, 2.x, 3.x | ✅ Verified |
| Solr | 8.x, 9.x | Coming soon |

Tested against: ES 7.17, ES 8.17, ES 9.0, OpenSearch 2.19, OpenSearch 3.0.

## How it works

ScaledSearch talks to clusters through a single `SearchEngine` interface, with one
adapter per engine. Elasticsearch and OpenSearch both use the official
`@elastic/elasticsearch` client, which is wire-compatible across ES 7–9 and
OpenSearch.

Set the engine in your [config](configuration.md):

```yaml
engine: elasticsearch   # or: opensearch
```

## Version constraints

A migration may declare a `target_version` constraint that is checked at apply time:

```yaml
target_version: ">=8.0"
```

If the connected cluster doesn't satisfy the constraint, the migration won't be
applied — useful for version-gated features like `dense_vector`.

## System-object filtering on import

When importing an existing cluster, ScaledSearch excludes engine-owned objects so
your baseline contains only *your* schema, not the cluster's plumbing:

- Leading-dot system indices/templates (universal to ES and OpenSearch)
- Elasticsearch built-ins: APM, Fleet, ML, monitoring, ILM/SLM history, watcher,
  connectors, behavioral analytics, and `@template`/`@pipeline` convention names
- OpenSearch plugin state: `.opensearch-*`, `.opendistro-*`, `.plugins-*`,
  `top_queries-*`, `.tasks`

See the [importing guide](guides/importing.md).
