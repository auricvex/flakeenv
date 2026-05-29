# Contributing to FlakeEnv

Thanks for your interest in contributing! This guide will help you get started.

## Prerequisites

- [Nix](https://nixos.org/) with flakes enabled
- A Nix-aware shell (the dev shell provides pnpm, Node.js, and TypeScript)

If you don't use Nix, you'll need:
- Node.js (v20+)
- pnpm (v10+)

## Setup

```bash
# Clone the repo
git clone https://github.com/auricvex/flakeenv.git
cd flakeenv

# Enter the Nix dev shell (provides pnpm, node, typescript)
nix develop

# Install dependencies
pnpm install
```

## Development

### Build

```bash
# One-shot typecheck + esbuild
pnpm run compile

# Watch mode (run in separate terminals)
pnpm run watch:esbuild
pnpm run watch:tsc
```

### Run the extension

Press `F5` in VS Code to launch the Extension Development Host. The `.vscode/launch.json` is pre-configured.

### Lint & Format

```bash
# Check for lint errors
pnpm run lint

# Auto-fix lint errors
pnpm run lint -- --fix

# Check formatting
pnpm run format:check

# Auto-format
pnpm run format
```

### Test

```bash
# Run all tests
pnpm run test

# Watch mode
pnpm run test:watch

# With coverage
pnpm run test:coverage
```

## Project Structure

```
src/
  extension.ts          # Extension entry point (activate/deactivate, commands)
  environment.ts        # Core: run nix/direnv, parse, filter, inject
  binary.ts             # Binary discovery with fallback paths
  dashboard.ts          # Webview panel singleton controller
  dashboard-ui.ts       # HTML template for the webview
  parsers.ts            # Pure parsers for nix/direnv output
  filtering.ts          # Variable filtering logic
  runner.ts             # Child process spawning
  language-servers.ts   # Language server restart logic
  webview/
    index.tsx           # React dashboard app
    utils.ts            # Pure utility functions
    types.ts            # Type definitions
    dashboard.css       # Dashboard styles
```

The extension has two esbuild entry points:
1. `src/extension.ts` → `dist/extension.js` (CJS, Node platform, `vscode` externalized)
2. `src/webview/index.tsx` → `dist/dashboard.js` (IIFE, browser platform)

## Pull Request Process

1. Fork the repo and create a branch from `main`.
2. Make your changes.
3. Ensure all checks pass:
   ```bash
   pnpm run check-types
   pnpm run lint
   pnpm run format:check
   pnpm run test
   pnpm run compile
   ```
4. Open a PR against `main`.

## Code Style

- TypeScript with strict mode
- Tabs for indentation
- Single quotes
- Trailing commas
- 100-char line width

The project uses ESLint + Prettier. Run `pnpm run format` before committing.

## Reporting Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.md). Include:
- VS Code version
- OS and Nix version
- Steps to reproduce
- FlakeEnv output channel logs (View → Output → FlakeEnv)

## Requesting Features

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.md).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
