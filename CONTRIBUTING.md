# Contributing to openclaw-node

Thanks for your interest in contributing! Here's how to get started.

## Development

```bash
git clone https://github.com/heypinchy/openclaw-node.git
cd openclaw-node
npm install
npm run dev     # Watch mode
npm test        # Run tests
npm run typecheck  # Type checking
```

## Pull Requests

1. Fork the repo and create your branch from `main`
2. Add tests for any new functionality
3. Ensure `npm test` and `npm run typecheck` pass
4. Keep PRs focused — one feature or fix per PR

## Reporting Issues

Open an issue at [github.com/heypinchy/openclaw-node/issues](https://github.com/heypinchy/openclaw-node/issues).

Include:

- Node.js version
- OpenClaw version
- Steps to reproduce
- Expected vs. actual behavior

## Code Style

- TypeScript strict mode
- No `any` types (use `unknown` + type guards)
- Prefer async/await over raw promises

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
