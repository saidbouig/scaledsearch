# Contributing to ScaledSearch

Thank you for your interest in contributing to ScaledSearch!

## Getting Started

1. Fork the repo
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/scaledsearch.git`
3. Install dependencies: `npm install`
4. Run the CLI in development: `npx tsx src/index.ts <command>`

## Development

```bash
# Run any command in dev mode
npx tsx src/index.ts init
npx tsx src/index.ts create "my-migration"
npx tsx src/index.ts status

# Build
npm run build

# Test against a local ES cluster
docker run -d -p 9200:9200 -e "discovery.type=single-node" -e "xpack.security.enabled=false" elasticsearch:9.0.0
npx tsx src/index.ts migrate
```

## Pull Requests

1. Create a branch from `main`
2. Make your changes
3. Test against ES 8.x and ES 9.x if touching engine code
4. Submit a PR with a clear description of what and why

## What We Need Help With

- Additional engine support (Solr, Meilisearch, Typesense)
- Migration operation types (aliases, templates, pipelines)
- Better error messages
- Documentation and examples
- Testing against different ES/OpenSearch versions

## Code Style

- TypeScript strict mode
- No `any` where avoidable
- Functions over classes where possible
- Clear error messages with actionable suggestions

## Reporting Issues

- Use GitHub Issues
- Include: OS, Node version, ES/OpenSearch version, full error output
- Reproduction steps if possible

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
