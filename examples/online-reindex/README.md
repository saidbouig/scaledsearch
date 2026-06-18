# Example — Zero-downtime reindex with live writes

A delta-safe online reindex: copy `products_v1 → products_v2` and flip the
`products` alias **while clients keep writing**, without losing in-flight writes.

See [`migrations/V001__online-reindex-products.yaml`](migrations/V001__online-reindex-products.yaml)
— it is heavily commented and is the canonical reference for the pattern.

## When you actually need this

You usually **don't**. To add a field, `put_mapping` does it in place — no reindex.
Reindex is the expensive exception, for changes you can't make in place:

- a field **type** or **analyzer** change
- a **shard count** change (you can't reshard in place)
- a **version / cluster** upgrade (reindex-from-remote)

## The sequence

```
watermark = now()                      # before the bulk copy
reindex v1 → v2   op_type:create       # bulk — never clobbers a live write
POST /v1/_refresh                      # make buffered writes visible
reindex v1 → v2   query: updated_at >= watermark   # delta catch-up
POST /v1/_refresh
swap_alias products  v1 → v2           # atomic cutover
reindex v1 → v2   query: updated_at >= watermark   # final delta after swap
```

## Requirements (or you lose data)

- Every write **sets `updated_at`** and goes **through the alias**, never the
  concrete index name.
- The `_refresh` calls are **not optional** on a busy index — without them a high
  `refresh_interval` hides recent writes from the delta query.
- **Deletes are not propagated** (reindex only copies docs). Use soft deletes if
  you delete during a migration.

## Run it

The watermark timestamp is captured by hand: note the time you start the bulk
copy and paste it into the `gte` of the two delta passes in the migration file.

```bash
cd examples/online-reindex
scaledsearch migrate init            # if starting fresh
scaledsearch migrate import          # baseline an existing cluster (so the
                                     # validator knows products_v1 / products_v2)
scaledsearch migrate apply
```

For very large indexes, add throttling/slicing to the bulk copy via an
`api_call` to `/_reindex?requests_per_second=...` with `slices`. Reindex is an
hours-long, resource-heavy operation — plan for it.

See the [zero-downtime guide](../../docs/guides/zero-downtime.md) for the full
write-up.
