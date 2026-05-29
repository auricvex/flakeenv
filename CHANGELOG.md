# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/), and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.1] - 2026-05-29

### Fixed
- Dashboard CSS not loading — the `.css: 'text'` esbuild loader was missing from the extension host build, causing the inlined stylesheet to be `undefined` at runtime

## [0.2.0] - 2026-05-29

### Added
- ESLint + Prettier for code quality and consistent formatting
- Vitest unit test infrastructure with 67 tests across parsers, filtering, runner, and webview utils
- CI workflow for pull request checks (typecheck, lint, format, build, test)
- Contributing guide (`CONTRIBUTING.md`) with setup, build, test, and PR instructions
- GitHub issue templates (bug report, feature request) and PR template
- User-configurable settings:
  - `flakeenv.autoReload` — watch files and auto-reload (default: true)
  - `flakeenv.autoReloadDebounceMs` — debounce interval (default: 1000ms)
  - `flakeenv.additionalBlockedVars` — extra variable names to skip
  - `flakeenv.additionalBlockedPrefixes` — extra variable prefixes to skip
  - `flakeenv.languageServers` — additional language servers to restart
  - `flakeenv.execTimeoutMs` — command timeout (default: 120000ms)
- Auto-reload when `flake.nix` or `.envrc` changes on disk (with debouncing)
- Auto-reload toggle in dashboard header
- Environment change diff banner showing added/removed/changed variables since last load
- VS Code Marketplace publishing enabled
- Installation instructions in README

### Changed
- Decomposed monolithic source files into focused modules:
  - `src/parsers.ts` — pure parsing functions (nix, direnv, env output)
  - `src/filtering.ts` — variable filtering logic
  - `src/runner.ts` — child process spawning
  - `src/language-servers.ts` — language server restart logic
  - `src/webview/utils.ts` — webview utility functions
  - `src/webview/types.ts` — shared type definitions
- Extracted inline CSS into `src/webview/dashboard.css`
- `environment.ts` reduced from 543 to ~300 lines
- `webview/index.tsx` reduced from 782 to ~500 lines
- `dashboard-ui.ts` reduced from 655 to ~30 lines
- Auto-reload now queues reloads instead of showing warning when load is in progress

## [0.1.0] - 2026-05-29

### Added
- Initial release
- Load environment variables from `flake.nix` via `nix print-dev-env . --json`
- Load environment variables from `.envrc` via `direnv export json`
- Inject variables into VS Code via `EnvironmentVariableCollection`
- React-based dashboard for inspecting, filtering, copying, and masking variables
- Status bar item with load state indicator
- Automatic language server restart (rust-analyzer, CodeLLDB)
- Filtering of unsafe/noisy variables (shell internals, VS Code internals, Nix build internals)
- Binary discovery with fallback paths for Nix and direnv
- Keyboard shortcuts in dashboard (`/`, `Cmd/Ctrl+R`, `Cmd/Ctrl+K`)
