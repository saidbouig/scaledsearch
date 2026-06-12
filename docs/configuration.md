# Configuration

`migrate init` writes `.scaledsearch/config.yaml` in your project. Commit it to git.

```yaml
# .scaledsearch/config.yaml
engine: elasticsearch
connection:
  host: http://localhost:9200
migrations:
  location: ./migrations
history:
  index: .scaledsearch_history
```

| Key | Description |
|-----|-------------|
| `engine` | `elasticsearch` or `opensearch` |
| `connection.host` | Cluster URL |
| `connection.auth` | Optional auth block — see below |
| `migrations.location` | Directory holding migration files |
| `history.index` | Internal index that records applied migrations |

## History index

ScaledSearch tracks what has been applied in an internal index (default
`.scaledsearch_history`). `migrate init` derives a **per-project** history index
name, so multiple projects pointing at the same cluster keep separate histories and
don't overwrite each other's records.

The history index stores, per migration: the version, a checksum of the file, and
the applied timestamp. Failed migrations are **not** recorded as applied.

## Authentication

```yaml
# Basic auth
connection:
  host: https://my-cluster:9200
  auth:
    type: basic
    username: elastic
    password: changeme
```

```yaml
# API key
connection:
  host: https://my-cluster:9200
  auth:
    type: apikey
    apiKey: your-base64-api-key
```

```yaml
# No auth (default)
connection:
  host: http://localhost:9200
```

> Avoid committing plaintext credentials. Prefer environment-specific config or a
> secrets manager for production clusters.
