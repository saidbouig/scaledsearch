# Importing an Existing Cluster

If you already have indices in production, you don't have to recreate them as
migrations by hand. `migrate import` snapshots the live cluster into a baseline
migration and marks it as already applied — so you can start version-controlling
from where you are today.

## Usage

```bash
scaledsearch migrate init
scaledsearch migrate import
```

This writes `migrations/V000__baseline.yaml` and records it in the history index as
applied (so `apply` never tries to re-run it).

## What gets captured

- Indices, with their mappings and settings
- Aliases, including alias options
- Closed-index state (closed indices are captured as closed)
- Index templates
- Ingest pipelines

## What gets excluded

`import` deliberately skips engine-owned objects so your baseline is *your* schema,
not the cluster's internal plumbing. Importing them would produce a baseline that
fights the cluster on replay. Excluded:

- **Leading-dot system indices/templates** — universally system-owned in ES and
  OpenSearch
- **Elasticsearch built-ins** — APM, Fleet, ML, monitoring, ILM/SLM history,
  watcher, deprecation, connectors, behavioral analytics, and names following the
  `@template` / `@pipeline` / `@default-pipeline` conventions
- **OpenSearch plugin state** — `.opensearch-*`, `.opendistro-*`, `.plugins-*`,
  `top_queries-*`, `.tasks`

## After importing

```bash
# Continue versioning from the baseline
scaledsearch migrate create "add-vector-field"
scaledsearch migrate apply
```

`import` refuses to overwrite an existing `V000__baseline.yaml`. If you need to
re-baseline, remove the existing baseline file first (and reconcile history).
