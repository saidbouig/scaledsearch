# Zero-Downtime Migrations (Alias Swap)

Changing a mapping in place is often impossible — many mapping changes require a new
index. The standard zero-downtime pattern is: build a new index, reindex into it,
then atomically swap an alias so reads/writes never point at a half-built index.

> ⚠️ **The delta problem.** A plain `reindex` copies a point-in-time snapshot. If
> clients keep **writing** during the copy, every write that lands after the snapshot
> but before the swap is **lost**. The naive pattern below is only safe when the index
> is read-only (or you can tolerate losing in-flight writes). For a live index, use
> the [backfill + delta catch-up](#live-writes-backfill--delta-catch-up-no-special-op-needed)
> sequence below.

## The pattern (read-only / quiet index)

```yaml
description: "Migrate to products_v2 with zero downtime"
operations:
  # 1. Create the new index with the updated mapping
  - type: create_index
    index: products_v2
    mappings:
      properties:
        title: { type: text }
        embedding:
          type: dense_vector
          dims: 768

  # 2. Reindex existing data (runs async with progress)
  #    ⚠️ writes to products_v1 during this step are NOT carried over.
  - type: reindex
    source: products_v1
    dest: products_v2

  # 3. Atomically point the `products` alias at the new index
  - type: swap_alias
    alias: products
    from: products_v1
    to: products_v2

# Safe rollback: just swap the alias back. Both indices still exist.
rollback:
  - type: swap_alias
    alias: products
    from: products_v2
    to: products_v1
```

## Live writes: backfill + delta catch-up (no special op needed)

When clients are writing during the migration, express the whole sequence with the
ops you already have. The key fields are `op_type: create` + `conflicts: proceed`
(so the copy never clobbers a live write) and a `query` watermark (so delta passes
copy only what changed). This is done **entirely in YAML** — no custom operation.

```yaml
description: "Online reindex products_v1 -> products_v2 (live writes)"
operations:
  # 1. Create dest tuned for bulk load. Set the REAL reason you reindex here
  #    (new shard count, changed field types, etc.).
  - type: create_index
    index: products_v2
    settings:
      number_of_shards: 6          # e.g. resharding — the real reason to reindex
      number_of_replicas: 0        # no replica writes during bulk load
      refresh_interval: -1         # don't refresh mid-bulk (big speedup)
    mappings:
      properties:
        title: { type: text }

  # 2. Bulk copy. Note the start time — it's your delta watermark.
  #    op_type:create so a live write already in dest is never overwritten.
  - type: reindex
    source: products_v1
    dest: products_v2
    op_type: create
    conflicts: proceed

  # 3. Force a refresh so writes buffered under refresh_interval become visible
  #    to the delta query below. WITHOUT THIS, a 60s refresh_interval silently
  #    hides recent writes and the delta pass misses them.
  - type: api_call
    method: POST
    path: /products_v1/_refresh

  # 4. Delta catch-up — only docs changed since the bulk copy started.
  #    Paste the timestamp you noted in step 2.
  - type: reindex
    source: products_v1
    dest: products_v2
    op_type: create
    conflicts: proceed
    query:
      range:
        updated_at: { gte: "2026-06-18T10:00:00Z" }

  # 5. Refresh again right before the swap to catch the last buffered writes.
  - type: api_call
    method: POST
    path: /products_v1/_refresh

  # 6. Atomic cutover.
  - type: swap_alias
    alias: products
    from: products_v1
    to: products_v2

  # 7. Final delta pass after the swap — catches writes between step 5 and 6.
  - type: reindex
    source: products_v1
    dest: products_v2
    op_type: create
    conflicts: proceed
    query:
      range:
        updated_at: { gte: "2026-06-18T10:00:00Z" }

  # 8. Restore production settings once bulk load is done.
  - type: put_settings
    index: products_v2
    settings:
      number_of_replicas: 1
      refresh_interval: 1s
```

This is **delta-safe for inserts and updates**, with important caveats:

- **Deletes are NOT propagated.** `reindex` only copies documents; a doc deleted from
  `products_v1` during the window stays alive in `products_v2`. Use soft deletes (a
  `deleted` flag + bumped `updated_at`) if you delete during migrations.
- **Every write must set `updated_at`** (the watermark field) and go **through the
  alias**, never the concrete index name.
- **`refresh_interval` matters.** The `_refresh` calls in steps 3 and 5 are not
  optional on a busy index — they're what make the delta query see recent writes.
- For very large indexes, add throttling/slicing to step 2 via `api_call`
  (`/_reindex?requests_per_second=2000`, `source.size`, `slices`) instead of the typed
  op, and accept that this is an hours-long, resource-heavy operation — reindex is the
  expensive exception, not the routine migration.

> **You usually don't need any of this.** Adding a field to a mapping is done in place
> with `put_mapping` — no reindex. Reindex is only for changes you *can't* make in
> place: field **type** changes, **shard count** changes, analyzer changes, or
> version/cluster migrations.

## Why the alias swap is safe

- **`swap_alias` is atomic** — it removes the old alias target and adds the new one
  in a single cluster call, so there is no moment where `products` resolves to
  nothing.
- **Rollback is instant and lossless** — because the old index is left in place, the
  rollback is just the reverse swap. No data is deleted by the migration itself.
- **Reads/writes use the alias**, never the concrete index name, so clients are
  unaffected by the swap.

## Tips

- Have your application read and write through the **alias** (`products`), never the
  versioned index (`products_v1`).
- Keep the old index around until you've verified the new one in production; delete
  it in a *later* migration once you're confident.
- For large indices, the reindex runs asynchronously — see
  [reindex](../operations.md#data--reindex).
