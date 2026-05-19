# Tests

## Layout
- `test/unit/` — pure functions, no I/O, runs in <1s
- `test/integration/` — requires live ES + OpenSearch clusters
- `test/helpers/` — shared fixtures and cluster utilities

## Running

```bash
# Unit tests only (fast, no docker)
npm run test:unit

# Integration tests (needs docker compose up)
npm run docker:up
npm run test:integration

# Everything
npm run test:all

# Watch mode during development
npm run test:watch

# Coverage report
npm run test:coverage
```

## Integration test behavior

Integration tests check whether the cluster is reachable before running. If neither ES (9200) nor OpenSearch (9201) responds, the affected `describe` blocks are skipped — they do not fail the suite.

Override hosts with env vars:

```bash
ES_TEST_HOST=http://localhost:9200 OS_TEST_HOST=http://localhost:9201 npm run test:integration
```

## What's covered

| Layer | Coverage |
|---|---|
| `src/config/` | Init, load, validation, defaults |
| `src/migration/parser.ts` | Filename parsing, YAML parsing, checksums, sorting |
| `src/migration/validator.ts` | Duplicates, gaps, operation field requirements, checksum integrity |
| `src/engine/elasticsearch.ts` | Connect, CRUD, mappings, aliases (integration) |
| `src/engine/opensearch.ts` | Connect, CRUD, mappings (integration) |
