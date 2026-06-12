# Zero-Downtime Migrations (Alias Swap)

Changing a mapping in place is often impossible — many mapping changes require a new
index. The standard zero-downtime pattern is: build a new index, reindex into it,
then atomically swap an alias so reads/writes never point at a half-built index.

## The pattern

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

## Why this is safe

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
