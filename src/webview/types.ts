import type { EnvVariable, EnvironmentResult, SkippedVariable } from '../environment';

export type Tab = 'all' | 'nix' | 'direnv' | 'skipped';
export type SortKey = 'name' | 'source' | 'length';
export type SourceLabel = 'nix' | 'direnv' | 'skipped';
export type HeaderStatus = 'ok' | 'error' | 'loading';
export type DashboardVariable = EnvVariable | SkippedVariable;

export interface DashboardState {
	tab: Tab;
	query: string;
	sort: SortKey;
	dense: boolean;
	pathsOnly: boolean;
	masked: boolean;
	expanded: Record<string, boolean>;
}

export type ExtensionMessage =
	| { type: 'ready' }
	| { type: 'reload' }
	| { type: 'copy'; value: string }
	| { type: 'toggleAutoReload' };

export type WebviewMessage =
	| { type: 'loading' }
	| { type: 'update'; data: EnvironmentResult }
	| { type: 'autoReloadState'; enabled: boolean };

export interface VscodeApi<T> {
	getState(): T | undefined;
	setState(state: T): void;
	postMessage(message: ExtensionMessage): void;
}

export interface DashboardCounts {
	coverage: number;
	direnv: number;
	injected: number;
	nix: number;
	skipped: number;
}
