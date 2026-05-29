import * as React from 'react';
import { createRoot } from 'react-dom/client';
import type { EnvironmentResult } from '../environment';
import type {
	DashboardCounts,
	DashboardState,
	DashboardVariable,
	HeaderStatus,
	SourceLabel,
	WebviewMessage,
	VscodeApi,
} from './types';
import type { EnvironmentChange } from '../environment';
import {
	defaultState,
	getCounts,
	getFilteredVars,
	getSourceLabel,
	getVarKey,
	isPathLike,
	isSkipped,
	maskValue,
	shellQuote,
	splitPathValue,
	truncate,
} from './utils';

declare function acquireVsCodeApi<T>(): VscodeApi<T>;

const vscode = acquireVsCodeApi<DashboardState>();

function App(): React.ReactElement {
	const [envData, setEnvData] = React.useState<EnvironmentResult | null>(null);
	const [isLoading, setIsLoading] = React.useState(true);
	const [isWaiting, setIsWaiting] = React.useState(false);
	const [notice, setNotice] = React.useState('');
	const [copiedKey, setCopiedKey] = React.useState('');
	const [autoReload, setAutoReload] = React.useState(true);
	const [uiState, setUiState] = React.useState<DashboardState>(restoreState);
	const dataRef = React.useRef<EnvironmentResult | null>(null);
	const searchRef = React.useRef<HTMLInputElement | null>(null);
	const noticeTimerRef = React.useRef<number | undefined>(undefined);
	const copiedTimerRef = React.useRef<number | undefined>(undefined);

	React.useEffect(() => {
		dataRef.current = envData;
	}, [envData]);

	const updateUiState = React.useCallback(
		(update: (previous: DashboardState) => DashboardState) => {
			setUiState((previous) => {
				const next = update(previous);
				vscode.setState(next);
				return next;
			});
		},
		[],
	);

	const flash = React.useCallback((message: string) => {
		setNotice(message);
		if (noticeTimerRef.current !== undefined) {
			window.clearTimeout(noticeTimerRef.current);
		}
		noticeTimerRef.current = window.setTimeout(() => setNotice(''), 1400);
	}, []);

	const markCopied = React.useCallback((key: string) => {
		setCopiedKey(key);
		if (copiedTimerRef.current !== undefined) {
			window.clearTimeout(copiedTimerRef.current);
		}
		copiedTimerRef.current = window.setTimeout(() => setCopiedKey(''), 1000);
	}, []);

	const requestReload = React.useCallback(() => {
		setIsLoading(true);
		setIsWaiting(false);
		flash('Reloading environment...');
		vscode.postMessage({ type: 'reload' });
	}, [flash]);

	React.useEffect(() => {
		const onMessage = (event: MessageEvent<WebviewMessage>) => {
			const message = event.data;
			if (message.type === 'loading') {
				setIsLoading(true);
				setIsWaiting(false);
				return;
			}
			if (message.type === 'update') {
				setEnvData(message.data);
				setIsLoading(false);
				setIsWaiting(false);
			}
			if (message.type === 'autoReloadState') {
				setAutoReload(message.enabled);
			}
		};

		window.addEventListener('message', onMessage);
		vscode.postMessage({ type: 'ready' });

		const waitingTimer = window.setTimeout(() => {
			if (!dataRef.current) {
				setIsWaiting(true);
			}
		}, 2500);

		return () => {
			window.removeEventListener('message', onMessage);
			window.clearTimeout(waitingTimer);
			if (noticeTimerRef.current !== undefined) {
				window.clearTimeout(noticeTimerRef.current);
			}
			if (copiedTimerRef.current !== undefined) {
				window.clearTimeout(copiedTimerRef.current);
			}
		};
	}, []);

	React.useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const target = event.target;
			const isTyping =
				target instanceof HTMLInputElement ||
				target instanceof HTMLTextAreaElement ||
				target instanceof HTMLSelectElement;

			if (event.key === '/' && !isTyping && !(event.metaKey || event.ctrlKey || event.altKey)) {
				event.preventDefault();
				searchRef.current?.focus();
				return;
			}

			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'r') {
				event.preventDefault();
				requestReload();
				return;
			}

			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault();
				updateUiState((previous) => ({ ...previous, query: '' }));
				searchRef.current?.focus();
			}
		};

		window.addEventListener('keydown', onKeyDown);
		return () => window.removeEventListener('keydown', onKeyDown);
	}, [requestReload, updateUiState]);

	const filteredVars = React.useMemo(() => getFilteredVars(envData, uiState), [envData, uiState]);

	const counts = React.useMemo(() => getCounts(envData), [envData]);

	const findVariable = React.useCallback(
		(name: string, source: SourceLabel): DashboardVariable | undefined => {
			if (!envData) {
				return undefined;
			}

			return [...envData.injected, ...(envData.skipped ?? [])].find((variable) => {
				return variable.name === name && getSourceLabel(variable) === source;
			});
		},
		[envData],
	);

	const toggleExpanded = React.useCallback(
		(key: string) => {
			updateUiState((previous) => ({
				...previous,
				expanded: {
					...previous.expanded,
					[key]: !previous.expanded[key],
				},
			}));
		},
		[updateUiState],
	);

	const toggleAll = React.useCallback(
		(expand: boolean) => {
			updateUiState((previous) => {
				const expanded = { ...previous.expanded };
				for (const variable of filteredVars) {
					expanded[getVarKey(variable)] = expand;
				}
				return { ...previous, expanded };
			});
		},
		[filteredVars, updateUiState],
	);

	const copyVisible = React.useCallback(() => {
		if (!filteredVars.length) {
			flash('No visible variables to copy');
			return;
		}

		const payload = filteredVars
			.map((variable) => `${variable.name}=${variable.value ?? ''}`)
			.join('\n');
		vscode.postMessage({ type: 'copy', value: payload });
		flash(`Copied ${filteredVars.length} visible variable${filteredVars.length === 1 ? '' : 's'}`);
	}, [filteredVars, flash]);

	const copyVariable = React.useCallback(
		(name: string, source: SourceLabel, mode: 'value' | 'export') => {
			const variable = findVariable(name, source);
			if (!variable) {
				flash(`Could not find ${name}`);
				return;
			}

			const value = variable.value ?? '';
			const payload = mode === 'export' ? `export ${variable.name}=${shellQuote(value)}` : value;
			vscode.postMessage({ type: 'copy', value: payload });
			flash(mode === 'export' ? `Copied export statement for ${name}` : `Copied value for ${name}`);
			markCopied(`${getVarKey(variable)}:${mode}`);
		},
		[findVariable, flash, markCopied],
	);

	const headerStatus: HeaderStatus = isLoading
		? 'loading'
		: envData?.status === 'error'
			? 'error'
			: 'ok';
	const hasInspectableData =
		envData?.status === 'ok' && (envData.injected.length > 0 || (envData.skipped?.length ?? 0) > 0);
	const reloadDisabled = isLoading && envData !== null;

	return (
		<main className="dashboard">
			<div className={`notice ${notice ? 'show' : ''}`} aria-live="polite">
				{notice}
			</div>

			<Header
				status={headerStatus}
				autoReload={autoReload}
				canUseDataActions={hasInspectableData}
				reloadDisabled={reloadDisabled}
				onCollapse={() => toggleAll(false)}
				onCopyVisible={copyVisible}
				onExpand={() => toggleAll(true)}
				onReload={requestReload}
				onToggleAutoReload={() => vscode.postMessage({ type: 'toggleAutoReload' })}
			/>

			{isLoading && envData && (
				<div className="loading-strip" role="status">
					<span>Reloading environment from Nix and direnv.</span>
					<span>Controls stay live with the last loaded snapshot.</span>
				</div>
			)}

			{envData?.changes && !isLoading && <ChangesBanner changes={envData.changes} />}

			{renderContent({
				copiedKey,
				counts,
				envData,
				filteredVars,
				isLoading,
				isWaiting,
				searchRef,
				uiState,
				copyVariable,
				requestReload,
				toggleExpanded,
				updateUiState,
			})}
		</main>
	);
}

interface HeaderProps {
	status: HeaderStatus;
	autoReload: boolean;
	canUseDataActions: boolean;
	reloadDisabled: boolean;
	onCollapse: () => void;
	onCopyVisible: () => void;
	onExpand: () => void;
	onReload: () => void;
	onToggleAutoReload: () => void;
}

function Header(props: HeaderProps): React.ReactElement {
	return (
		<header className="header">
			<div className="logo" aria-hidden="true">
				FE
			</div>
			<div className="title">
				<h1>FlakeEnv Dashboard</h1>
				<p>
					Inspect, filter, copy, and reload the environment VS Code receives from Nix and direnv.
				</p>
			</div>
			<div className="actions">
				<StatusPill status={props.status} />
				<button
					className={`toggle ${props.autoReload ? 'active' : ''}`}
					type="button"
					aria-pressed={props.autoReload}
					onClick={props.onToggleAutoReload}
					title={props.autoReload ? 'Auto-reload is ON' : 'Auto-reload is OFF'}
				>
					Auto-reload: {props.autoReload ? 'ON' : 'OFF'}
				</button>
				{props.canUseDataActions && (
					<>
						<button className="btn ghost" type="button" onClick={props.onExpand}>
							Expand
						</button>
						<button className="btn ghost" type="button" onClick={props.onCollapse}>
							Collapse
						</button>
						<button className="btn ghost" type="button" onClick={props.onCopyVisible}>
							Copy Visible
						</button>
					</>
				)}
				<button
					className="btn primary"
					type="button"
					disabled={props.reloadDisabled}
					onClick={props.onReload}
				>
					{props.status === 'loading' ? 'Reloading...' : 'Reload'}
				</button>
			</div>
		</header>
	);
}

function StatusPill({ status }: { status: HeaderStatus }): React.ReactElement {
	const label = status === 'ok' ? 'Loaded' : status === 'error' ? 'Error' : 'Loading';
	return (
		<span className={`pill ${status}`}>
			<span className="dot" />
			{label}
		</span>
	);
}

function ChangesBanner({ changes }: { changes: EnvironmentChange }): React.ReactElement {
	const total = changes.added.length + changes.removed.length + changes.changed.length;
	if (total === 0) {
		return <></>;
	}

	const parts: string[] = [];
	if (changes.added.length > 0) {
		parts.push(`+${changes.added.length} added`);
	}
	if (changes.removed.length > 0) {
		parts.push(`-${changes.removed.length} removed`);
	}
	if (changes.changed.length > 0) {
		parts.push(`~${changes.changed.length} changed`);
	}

	return (
		<div className="changes-banner" role="status">
			<span className="changes-label">Since last load:</span>
			{changes.added.length > 0 && (
				<span className="changes-tag added">{changes.added.length} added</span>
			)}
			{changes.removed.length > 0 && (
				<span className="changes-tag removed">{changes.removed.length} removed</span>
			)}
			{changes.changed.length > 0 && (
				<span className="changes-tag changed">{changes.changed.length} changed</span>
			)}
		</div>
	);
}

interface RenderContentProps {
	copiedKey: string;
	counts: DashboardCounts;
	envData: EnvironmentResult | null;
	filteredVars: DashboardVariable[];
	isLoading: boolean;
	isWaiting: boolean;
	searchRef: React.RefObject<HTMLInputElement | null>;
	uiState: DashboardState;
	copyVariable: (name: string, source: SourceLabel, mode: 'value' | 'export') => void;
	requestReload: () => void;
	toggleExpanded: (key: string) => void;
	updateUiState: (update: (previous: DashboardState) => DashboardState) => void;
}

function renderContent(props: RenderContentProps): React.ReactElement {
	const {
		copiedKey,
		counts,
		envData,
		filteredVars,
		isLoading,
		isWaiting,
		searchRef,
		uiState,
		copyVariable,
		requestReload,
		toggleExpanded,
		updateUiState,
	} = props;

	if (!envData) {
		return (
			<StatePanel
				action={
					isWaiting ? (
						<button className="btn primary" type="button" onClick={requestReload}>
							Reload
						</button>
					) : undefined
				}
				code={isWaiting ? 'WAIT' : 'LOAD'}
				detail={
					isWaiting
						? 'No snapshot has reached the dashboard yet. Reload asks the extension host for a fresh environment run.'
						: 'Waiting for the extension host to send the first environment snapshot.'
				}
				title={isWaiting ? 'Still waiting for environment data' : 'Loading environment'}
			/>
		);
	}

	if (envData.status === 'error') {
		return (
			<StatePanel
				action={
					<button
						className="btn primary"
						type="button"
						disabled={isLoading}
						onClick={requestReload}
					>
						Retry
					</button>
				}
				code="ERR"
				detail={envData.errorMessage ?? 'Unknown error'}
				title="Failed to load environment"
			/>
		);
	}

	if (
		envData.status === 'empty' ||
		(envData.injected.length === 0 && (envData.skipped?.length ?? 0) === 0)
	) {
		return (
			<StatePanel
				action={
					<button
						className="btn primary"
						type="button"
						disabled={isLoading}
						onClick={requestReload}
					>
						Reload
					</button>
				}
				code="EMPTY"
				detail="No flake.nix or .envrc variables were produced in this workspace."
				title="No environment data yet"
			/>
		);
	}

	return (
		<>
			<Stats counts={counts} updateUiState={updateUiState} />
			<Controls
				counts={counts}
				filteredCount={filteredVars.length}
				searchRef={searchRef}
				uiState={uiState}
				updateUiState={updateUiState}
			/>
			<div className="list" aria-label="Environment variables">
				{filteredVars.length > 0 ? (
					filteredVars.map((variable) => (
						<VariableRow
							copiedKey={copiedKey}
							dense={uiState.dense}
							expanded={!!uiState.expanded[getVarKey(variable)]}
							key={getVarKey(variable)}
							masked={uiState.masked}
							variable={variable}
							copyVariable={copyVariable}
							toggleExpanded={toggleExpanded}
						/>
					))
				) : (
					<StatePanel
						code="NONE"
						detail="No variables match the current filters."
						title="No results"
					/>
				)}
			</div>
			<div className="footer">
				{envData.loadedAt ? `Last loaded at ${new Date(envData.loadedAt).toLocaleString()}` : ''}
			</div>
		</>
	);
}

interface StatePanelProps {
	code: string;
	title: string;
	detail: string;
	action?: React.ReactNode;
}

function StatePanel({ action, code, detail, title }: StatePanelProps): React.ReactElement {
	return (
		<section className="state">
			<div className="big" aria-hidden="true">
				{code}
			</div>
			<strong>{title}</strong>
			<div className="state-detail">{detail}</div>
			{action && <div className="state-action">{action}</div>}
		</section>
	);
}

function Stats({
	counts,
	updateUiState,
}: {
	counts: DashboardCounts;
	updateUiState: (update: (previous: DashboardState) => DashboardState) => void;
}): React.ReactElement {
	const setTab = (tab: import('./types').Tab) =>
		updateUiState((previous) => ({ ...previous, tab }));

	return (
		<section className="stats" aria-label="Environment summary">
			<button className="card" type="button" onClick={() => setTab('all')}>
				<h2>{counts.injected}</h2>
				<p>Injected total</p>
			</button>
			<button className="card nix" type="button" onClick={() => setTab('nix')}>
				<h2>{counts.nix}</h2>
				<p>From Nix</p>
			</button>
			<button className="card direnv" type="button" onClick={() => setTab('direnv')}>
				<h2>{counts.direnv}</h2>
				<p>From direnv</p>
			</button>
			<button className="card skipped" type="button" onClick={() => setTab('skipped')}>
				<h2>{counts.skipped}</h2>
				<p>Skipped</p>
			</button>
			<article className="card">
				<h2>{counts.coverage}%</h2>
				<p>Injection coverage</p>
			</article>
		</section>
	);
}

interface ControlsProps {
	counts: DashboardCounts;
	filteredCount: number;
	searchRef: React.RefObject<HTMLInputElement | null>;
	uiState: DashboardState;
	updateUiState: (update: (previous: DashboardState) => DashboardState) => void;
}

function Controls({
	counts,
	filteredCount,
	searchRef,
	uiState,
	updateUiState,
}: ControlsProps): React.ReactElement {
	const setTab = (tab: import('./types').Tab) =>
		updateUiState((previous) => ({ ...previous, tab }));

	return (
		<section className="control-panel">
			<div className="search-row">
				<label className="search">
					<span className="icon" aria-hidden="true">
						/
					</span>
					<input
						ref={searchRef}
						aria-label="Search by name or value"
						placeholder="Search by name or value ( / to focus )"
						value={uiState.query}
						onChange={(event) =>
							updateUiState((previous) => ({ ...previous, query: event.target.value }))
						}
					/>
				</label>
				<select
					aria-label="Sort variables"
					value={uiState.sort}
					onChange={(event) =>
						updateUiState((previous) => ({
							...previous,
							sort: event.target.value as import('./types').SortKey,
						}))
					}
				>
					<option value="name">Sort: Name</option>
					<option value="source">Sort: Source</option>
					<option value="length">Sort: Length</option>
				</select>
				<button
					aria-pressed={uiState.pathsOnly}
					className={`toggle ${uiState.pathsOnly ? 'active' : ''}`}
					type="button"
					onClick={() =>
						updateUiState((previous) => ({ ...previous, pathsOnly: !previous.pathsOnly }))
					}
				>
					Path-like only
				</button>
				<button
					aria-pressed={uiState.masked}
					className={`toggle ${uiState.masked ? 'active' : ''}`}
					type="button"
					onClick={() => updateUiState((previous) => ({ ...previous, masked: !previous.masked }))}
				>
					Mask values
				</button>
			</div>
			<div className="tabs" role="tablist" aria-label="Variable sources">
				<TabButton
					active={uiState.tab === 'all'}
					count={counts.injected}
					label="All"
					onClick={() => setTab('all')}
				/>
				<TabButton
					active={uiState.tab === 'nix'}
					count={counts.nix}
					label="Nix"
					onClick={() => setTab('nix')}
				/>
				<TabButton
					active={uiState.tab === 'direnv'}
					count={counts.direnv}
					label="direnv"
					onClick={() => setTab('direnv')}
				/>
				<TabButton
					active={uiState.tab === 'skipped'}
					count={counts.skipped}
					label="Skipped"
					onClick={() => setTab('skipped')}
				/>
			</div>
			<div className="count-line">
				<span>
					{filteredCount} visible variable{filteredCount === 1 ? '' : 's'}
				</span>
				<button
					className="btn"
					type="button"
					onClick={() => updateUiState((previous) => ({ ...previous, dense: !previous.dense }))}
				>
					{uiState.dense ? 'Comfortable mode' : 'Dense mode'}
				</button>
			</div>
		</section>
	);
}

function TabButton({
	active,
	count,
	label,
	onClick,
}: {
	active: boolean;
	count: number;
	label: string;
	onClick: () => void;
}): React.ReactElement {
	return (
		<button
			aria-selected={active}
			className={`tab ${active ? 'active' : ''}`}
			role="tab"
			type="button"
			onClick={onClick}
		>
			{label} ({count})
		</button>
	);
}

interface VariableRowProps {
	copiedKey: string;
	dense: boolean;
	expanded: boolean;
	masked: boolean;
	variable: DashboardVariable;
	copyVariable: (name: string, source: SourceLabel, mode: 'value' | 'export') => void;
	toggleExpanded: (key: string) => void;
}

function VariableRow(props: VariableRowProps): React.ReactElement {
	const { copiedKey, dense, expanded, masked, variable, copyVariable, toggleExpanded } = props;
	const key = getVarKey(variable);
	const source = getSourceLabel(variable);
	const pathLike = isPathLike(variable.name, variable.value);
	const displayValue = masked ? maskValue(variable.value ?? '') : (variable.value ?? '');
	const pathEntries = pathLike && !masked ? splitPathValue(variable.value) : [];
	const valueCopyKey = `${key}:value`;
	const exportCopyKey = `${key}:export`;

	return (
		<article className={`item ${expanded ? 'expanded' : ''} ${dense ? 'dense' : ''}`}>
			<button className="item-header" type="button" onClick={() => toggleExpanded(key)}>
				<span className="chev" aria-hidden="true">
					&gt;
				</span>
				<span className="name">{variable.name}</span>
				<span className={`badge ${source}`}>{source}</span>
				<span className="preview">{truncate(displayValue, 90)}</span>
				<span className="len">{(variable.value ?? '').length}ch</span>
			</button>
			<div className="item-body">
				{pathEntries.length > 0 ? (
					<ul className="paths">
						{pathEntries.map((entry, entryIndex) => (
							<li key={`${entry}-${entryIndex}`}>{entry}</li>
						))}
					</ul>
				) : (
					<pre className="value">{displayValue}</pre>
				)}
				<div className="item-actions">
					<button
						className={`btn ${copiedKey === valueCopyKey ? 'copied' : ''}`}
						type="button"
						onClick={() => copyVariable(variable.name, source, 'value')}
					>
						{copiedKey === valueCopyKey ? 'Copied' : 'Copy value'}
					</button>
					<button
						className={`btn ${copiedKey === exportCopyKey ? 'copied' : ''}`}
						type="button"
						onClick={() => copyVariable(variable.name, source, 'export')}
					>
						{copiedKey === exportCopyKey ? 'Copied' : 'Copy as export'}
					</button>
					<span className="meta">
						Source: {source} | Length: {(variable.value ?? '').length} chars
						{pathLike ? ` | ${splitPathValue(variable.value).length} path entries` : ''}
					</span>
				</div>
				{isSkipped(variable) && variable.reason && (
					<div className="skip-note">Skip reason: {variable.reason}</div>
				)}
			</div>
		</article>
	);
}

function restoreState(): DashboardState {
	const restored = vscode.getState();
	return {
		...defaultState,
		...(restored ?? {}),
		expanded: {
			...defaultState.expanded,
			...(restored?.expanded ?? {}),
		},
	};
}

const root = document.getElementById('root');
if (!root) {
	throw new Error('FlakeEnv dashboard root element was not found.');
}

createRoot(root).render(<App />);
