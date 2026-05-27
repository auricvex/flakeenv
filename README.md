# FlakeEnv

FlakeEnv automatically loads environment variables from `flake.nix` and `.envrc` into your VS Code workspace, so integrated terminals, tasks, debuggers, and language servers see the same tools your shell sees.

## Features

- Loads `flake.nix` with `nix print-dev-env . --json`.
- Loads `.envrc` with `direnv export json`, layered on top of the Nix environment.
- Injects variables through VS Code's `EnvironmentVariableCollection`.
- Updates `process.env` in the extension host so already-running extensions can pick up the environment sooner.
- Provides a React dashboard for inspecting, filtering, copying, masking, and reloading variables.
- Restarts known language servers after a successful load so tools like `rust-analyzer` can find the new PATH.

## How It Works

1. If `flake.nix` exists, FlakeEnv runs `nix print-dev-env . --json` and reads exported variables.
2. If `.envrc` exists, FlakeEnv runs `direnv export json` using the Nix environment as a base.
3. VS Code and shell internals are filtered out.
4. The remaining variables are injected into VS Code and shown in the dashboard.

Reloads are safe to run repeatedly: FlakeEnv restores its previous `process.env` changes and clears its VS Code environment collection before calculating the next environment snapshot.

## Requirements

- [Nix](https://nixos.org/) with flakes enabled if you use `flake.nix`.
- [direnv](https://direnv.net/) if you use `.envrc`.

The extension also searches common Nix and direnv install paths, which helps when VS Code is launched from Finder and does not inherit your shell PATH.

## Commands

| Command | Description |
|---|---|
| `FlakeEnv: Reload Environment` | Re-run Nix and direnv detection, then refresh injected variables. |
| `FlakeEnv: Open Dashboard` | Open the React dashboard. |

## Dashboard

Open the dashboard from the command palette or by clicking the FlakeEnv status bar item.

The dashboard includes:

- Summary cards for total, Nix, direnv, skipped, and coverage counts.
- Tabs for all variables, Nix variables, direnv variables, and skipped variables.
- Search by variable name or value.
- Sorting by name, source, or value length.
- Path-like filtering, dense mode, and value masking.
- Expand/collapse controls and copy actions for values, exports, or the visible filtered set.
- A reload button with immediate loading feedback.

Keyboard shortcuts inside the dashboard:

| Shortcut | Action |
|---|---|
| `/` | Focus search. |
| `Cmd/Ctrl+R` | Reload environment. |
| `Cmd/Ctrl+K` | Clear search. |

## Status Bar

The status bar item opens the dashboard and reflects the current load state:

| Status | Meaning |
|---|---|
| `$(sync~spin) FlakeEnv` | Loading or reloading environment variables. |
| `$(check) FlakeEnv: N vars` | Loaded `N` injected variables. |
| `$(warning) FlakeEnv` | Loading failed. Check the `FlakeEnv` output channel. |

## Filtering Rules

FlakeEnv blocks variables that are usually unsafe or noisy to inject into VS Code, including:

- Shell and user identity variables such as `HOME`, `USER`, `SHELL`, and `PWD`.
- VS Code and Electron internals such as `VSCODE_*` and `ELECTRON_RUN_AS_NODE`.
- Nix build internals such as `__*`, `NIX_BUILD_*`, and `IN_NIX_SHELL`.

Skipped variables are still visible in the dashboard with their skip reason.

## License

[MIT](LICENSE)