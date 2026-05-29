import type { EnvironmentResult, SkippedVariable } from '../environment';
import type { DashboardCounts, DashboardState, DashboardVariable, SourceLabel } from './types';

export const defaultState: DashboardState = {
	tab: 'all',
	query: '',
	sort: 'name',
	dense: false,
	pathsOnly: false,
	masked: false,
	expanded: {},
};

export function isSkipped(variable: DashboardVariable): variable is SkippedVariable {
	return 'reason' in variable;
}

export function getSourceLabel(variable: DashboardVariable): SourceLabel {
	return isSkipped(variable) ? 'skipped' : variable.source;
}

export function getVarKey(variable: DashboardVariable): string {
	return encodeURIComponent(`${variable.name}|${getSourceLabel(variable)}`);
}

export function isPathLike(name: string, value: string): boolean {
	if (!name || !value) {
		return false;
	}

	const knownNames = new Set([
		'PATH',
		'MANPATH',
		'INFOPATH',
		'PKG_CONFIG_PATH',
		'XDG_DATA_DIRS',
		'ACLOCAL_PATH',
		'CMAKE_PREFIX_PATH',
		'LD_LIBRARY_PATH',
		'LIBRARY_PATH',
		'C_INCLUDE_PATH',
		'CPLUS_INCLUDE_PATH',
		'PYTHONPATH',
		'PERL5LIB',
		'NODE_PATH',
		'GEM_PATH',
		'GOPATH',
	]);

	if (knownNames.has(name)) {
		return true;
	}

	return (
		(name.endsWith('_PATH') || name.endsWith('_DIRS')) &&
		splitPathValue(value).length > 1 &&
		(value.includes('/') || value.includes('\\'))
	);
}

export function splitPathValue(value: string): string[] {
	if (!value) {
		return [];
	}

	const delimiter = value.includes(';') ? ';' : ':';
	return value.split(delimiter).filter(Boolean);
}

export function maskValue(value: string): string {
	return '*'.repeat(Math.min(32, Math.max(8, value.length)));
}

export function truncate(value: string, maxLength: number): string {
	if (!value || value.length <= maxLength) {
		return value || '';
	}
	return `${value.slice(0, maxLength)}...`;
}

export function shellQuote(value: string): string {
	return `'${String(value).split("'").join("'\\''")}'`;
}

export function getCounts(data: EnvironmentResult | null): DashboardCounts {
	if (!data) {
		return { coverage: 0, direnv: 0, injected: 0, nix: 0, skipped: 0 };
	}

	const skipped = data.skipped ?? [];
	const nix = data.injected.filter((variable) => variable.source === 'nix').length;
	const direnv = data.injected.filter((variable) => variable.source === 'direnv').length;
	const totalSeen = data.injected.length + skipped.length;
	const coverage = totalSeen > 0 ? Math.round((data.injected.length / totalSeen) * 100) : 0;
	return { coverage, direnv, injected: data.injected.length, nix, skipped: skipped.length };
}

export function getFilteredVars(
	data: EnvironmentResult | null,
	state: DashboardState,
): DashboardVariable[] {
	if (!data) {
		return [];
	}

	let variables: DashboardVariable[] = [];
	if (state.tab === 'all') {
		variables = [...data.injected];
	}
	if (state.tab === 'nix') {
		variables = data.injected.filter((variable) => variable.source === 'nix');
	}
	if (state.tab === 'direnv') {
		variables = data.injected.filter((variable) => variable.source === 'direnv');
	}
	if (state.tab === 'skipped') {
		variables = [...(data.skipped ?? [])];
	}

	if (state.query) {
		const query = state.query.toLowerCase();
		variables = variables.filter((variable) => {
			return (
				variable.name.toLowerCase().includes(query) ||
				(variable.value ?? '').toLowerCase().includes(query)
			);
		});
	}

	if (state.pathsOnly) {
		variables = variables.filter((variable) => isPathLike(variable.name, variable.value));
	}

	return [...variables].sort((a, b) => {
		if (state.sort === 'length') {
			return (b.value ?? '').length - (a.value ?? '').length || a.name.localeCompare(b.name);
		}
		if (state.sort === 'source') {
			return getSourceLabel(a).localeCompare(getSourceLabel(b)) || a.name.localeCompare(b.name);
		}
		return a.name.localeCompare(b.name);
	});
}
