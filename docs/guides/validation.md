# Validating Migrations Offline

`migrate validate` does two things, entirely offline (no cluster connection):

1. **Checks file integrity** — that every migration file parses, has the required
   fields, and uses known operation types.
2. **Simulates the end-state** — it replays your migrations in order against an
   in-memory model of the cluster, so it can catch ordering and reference problems
   *before* you touch a real cluster.

```bash
scaledsearch migrate validate
```

## What the simulator catches

By building up the state your migrations would produce, validation can surface
problems that pure file-linting would miss, for example:

- An operation that targets an index which won't exist yet at that point in the
  sequence
- A `reindex` whose destination is never created
- Wildcard targets that don't resolve to anything in the simulated state
- An alias swap referencing an index that was already deleted

The simulator resolves **wildcards** and **reindex destinations** as it goes, so the
simulated state reflects what would actually happen at apply time.

## Where this fits

`validate` is ideal in CI: it gives you fast, cluster-free confidence that a pull
request's migrations are internally consistent before they're ever applied. Pair it
with `apply --dry-run` (also offline) when you want to preview the concrete actions a
specific apply would take.

```bash
scaledsearch migrate validate          # is the whole set consistent?
scaledsearch migrate apply --dry-run   # what would the next apply do?
```
