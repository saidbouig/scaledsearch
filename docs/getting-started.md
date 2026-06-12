# Getting Started

## Installation

```bash
npm install -g scaledsearch
```

This installs two equivalent commands — use whichever you prefer:

```bash
scaledsearch migrate apply    # full name
ss migrate apply              # shorthand
```

Requirements: Node.js >= 18. No cluster connection is needed for `status`, `diff`,
`validate`, or `apply --dry-run` — those work fully offline.

## Quick start — new project

```bash
# 1. Initialize ScaledSearch in your project
scaledsearch migrate init

# 2. Create a migration
scaledsearch migrate create "add-products-index"

# 3. Edit the generated YAML
#    migrations/V001__add-products-index.yaml

# 4. Preview the changes (offline, no cluster needed)
scaledsearch migrate apply --dry-run

# 5. Apply them
scaledsearch migrate apply

# 6. Check what's applied vs pending
scaledsearch migrate status
```

`init` creates a `.scaledsearch/config.yaml` and a `migrations/` directory. See
[Configuration](configuration.md) for the config file.

## Quick start — existing cluster

Already have indices in production? Capture them as a baseline first, then version
forward from there:

```bash
# 1. Initialize
scaledsearch migrate init

# 2. Import current cluster state as V000
scaledsearch migrate import

# 3. Start versioning from here
scaledsearch migrate create "add-vector-field"
scaledsearch migrate apply
```

`import` snapshots indices, mappings, settings, aliases, index templates, and
ingest pipelines into `V000__baseline.yaml` and marks it as already applied so it
never re-executes. System-owned objects (APM, Fleet, ML, ILM history, leading-dot
indices, OpenSearch plugin state) are excluded automatically. See the
[importing guide](guides/importing.md) for details.

## Next steps

- [Commands reference](commands.md)
- [Migration file format](migration-files.md)
- [Zero-downtime migrations](guides/zero-downtime.md)
