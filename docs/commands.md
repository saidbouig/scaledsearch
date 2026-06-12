# Commands

All commands are subcommands of `scaledsearch migrate` (or `ss migrate`).

| Command | Description |
|---------|-------------|
| `migrate init` | Initialize ScaledSearch in the current directory |
| `migrate create <name>` | Create a new versioned migration file |
| `migrate status` | Show applied vs pending migrations |
| `migrate apply` | Apply pending migrations to the cluster |
| `migrate diff` | Show detailed pending changes |
| `migrate validate` | Validate files and simulate their end-state (offline) |
| `migrate import` | Import an existing cluster as a `V000` baseline |
| `migrate rollback` | Undo the last applied migration |

Commands that work **offline** (no cluster connection): `init`, `create`,
`status`, `diff`, `validate`, and `apply --dry-run`.

---

## `migrate init`

Initializes ScaledSearch in the current directory: writes `.scaledsearch/config.yaml`
and creates the `migrations/` directory. Safe to re-run — it self-heals a partial
setup (e.g. recreates `migrations/` if it was deleted) without clobbering existing
migration files. The history index name is derived per-project, so multiple projects
sharing one cluster don't collide.

```bash
scaledsearch migrate init
```

## `migrate create <name>`

Creates the next versioned migration file, e.g. `migrations/V001__<name>.yaml`,
pre-filled with a template. Version numbers auto-increment.

```bash
scaledsearch migrate create "add-products-index"
```

## `migrate status`

Lists applied vs pending migrations. Reads the history from the cluster's internal
history index (or works offline against local files). Surfaces corrupted migration
files and orphaned history entries (history rows whose file is missing) instead of
crashing.

```bash
scaledsearch migrate status
```

## `migrate apply`

Applies all pending migrations in version order. Each migration is checksum-validated
against the recorded history before running, and a lock prevents concurrent runs.

```bash
scaledsearch migrate apply                 # apply all pending
scaledsearch migrate apply --dry-run       # preview only, no changes (offline)
scaledsearch migrate apply --target V003   # apply up to and including V003
```

- `--dry-run` prints what *would* run without touching the cluster, and honors
  `--target`.
- `--target <version>` stops after the given version. It is validated — an unknown
  or already-applied target produces a friendly error.
- A migration that fails is **not** recorded as applied, so re-running resumes
  correctly.

## `migrate diff`

Shows detailed, field-level pending changes between your migration files and the
recorded state. Handles corrupted files gracefully and displays alias options and
reindex scripts where relevant.

```bash
scaledsearch migrate diff
```

## `migrate validate`

Validates migration file integrity **and simulates the end-state** the migrations
would produce — entirely offline. The simulator resolves wildcards and reindex
destinations so you can catch problems (e.g. an operation targeting an index that
won't exist yet) before touching a cluster. See the
[validation guide](guides/validation.md).

```bash
scaledsearch migrate validate
```

## `migrate import`

Snapshots the current cluster into `V000__baseline.yaml` and marks it as already
applied. Captures indices, mappings, settings, aliases, index templates, ingest
pipelines, alias options, and closed-index state. System-owned objects are excluded
automatically. Refuses to overwrite an existing `V000`. See the
[importing guide](guides/importing.md).

```bash
scaledsearch migrate import
```

## `migrate rollback`

Undoes the last applied migration by running its `rollback:` section. Refuses to run
when nothing is applied, or when the last migration has no `rollback:` section
defined.

```bash
scaledsearch migrate rollback
```

> Rollback is part of the open-source CLI. Multi-cluster, audit logging, and CI/CD
> integrations are part of the commercial tier — see the project README.
