/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IDisposable, combinedDisposable, toDisposable, Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { Event, Emitter } from 'vs/base/common/event';
import { isArray } from 'vs/base/common/types';
import { IConnectionManagementService } from 'sql/platform/connection/common/connectionManagement';
import { Iterable } from 'vs/base/common/iterator';

export const IQueryService = createDecorator<IQueryService>('queryService');

export interface IFetchSubsetParams {
	readonly resultIndex: number;
	readonly batchIndex: number;
	readonly startIndex: number;
	readonly rowCount: number;
}

export interface IQueryProvider {
	readonly id: string;
	readonly onMessage: Event<IQueryProviderEvent & { messages: IResultMessage | ReadonlyArray<IResultMessage> }>;
	readonly onResultSetAvailable: Event<IQueryProviderEvent & IResultSetSummary>;
	readonly onResultSetUpdated: Event<IQueryProviderEvent & IResultSetSummary>;
	readonly onBatchStart: Event<IQueryProviderEvent & { executionStart: number, index: number }>;
	readonly onBatchComplete: Event<IQueryProviderEvent & { executionEnd: number }>;
	readonly onQueryComplete: Event<IQueryProviderEvent>;
	/**
	 * Run a query
	 * @param connectionId connection to use for running the query
	 * @param file file to use for running the query
	 */
	runQuery(connectionId: string): Promise<void>;
	/**
	 * Cancel an actively running query
	 * @param connectionId
	 * @returns Possibly retuns messages about the cancel?
	 */
	cancelQuery(connectionId: string): Promise<string>;
	/**
	 * Fetch a subset of a query result
	 * @param connectionId connection for the results
	 * @param resultSetId result set requesting for
	 * @param batchId batch requesting for
	 * @param offset index into the result set to start returning
	 * @param count number of rows to return
	 */
	fetchSubset(connectionId: string, params: IFetchSubsetParams): Promise<IFetchResponse>;
	/**
	 * Set the execution options for a query
	 * @param connectionId connection for the results
	 * @param options a key value map of the options to be set
	 */
	setExecutionOptions(connectionId: string, options: { [key: string]: number | string | boolean }): Promise<void>;
}

export interface IQueryService {
	_serviceBrand: undefined;
	readonly providers: ReadonlyArray<string>;
	registerProvider(provider: IQueryProvider): IDisposable;
	/**
	 * Create a new query or return on if it already exists given the uri
	 * Will return undefined if the connection is not connected
	 * @param connection
	 * @param forceNew force create a new query even if one already exists for the given connection
	 * This should only be done if it is known that the connection supports multiple queries on the same connection (unlikely)
	 */
	createOrGetQuery(associatedURI: URI, forceNew?: boolean): IQuery | undefined;
}

export interface IResultMessage {
	readonly message: string;
	readonly isError?: boolean;
}

export interface IResultSetSummary {
	readonly resultIndex: number;
	readonly batchIndex: number;
	readonly rowCount: number;
	readonly columns: ReadonlyArray<IColumn>;
	readonly completed: boolean;
}

interface IResultSetInternal {
	rowCount: number;
	completed?: boolean;
}

export interface IResultSet extends IResultSetInternal {
	readonly rowCount: number;
	readonly completed?: boolean;
	readonly columns: ReadonlyArray<IColumn>;
	fetch(offset: number, count: number): Promise<IFetchResponse>;

	//TBD
	readonly id: string;
}

export interface IFetchResponse {
	readonly rowCount: number;
	readonly rows: ReadonlyArray<ReadonlyArray<string>>;
}

export interface IColumn {
	readonly title: string;
	readonly type: ColumnType;
}

export enum ColumnType {
	XML,
	JSON,
	UNKNOWN
}

export enum QueryState {
	EXECUTING,
	NOT_EXECUTING
}

export interface IQuery {
	/**
	 * File associated with this query
	 */
	readonly associatedFile: URI;
	/**
	 * State of the query
	 */
	readonly state: QueryState;
	readonly onDidStateChange: Event<QueryState>;

	/**
	 * Execute the query with the associatedFile for this query
	 */
	execute(): Promise<void>;

	/**
	 * Cancel the query if currently executing, otherwise it will throw
	 */
	cancel(): Promise<void>;

	/**
	 * Set execution options
	 */
	setExecutionOptions(options: { [key: string]: string | number | boolean }): Promise<void>;

	/**
	 * Messages returned from the query
	 */
	readonly messages: ReadonlyArray<IResultMessage>;
	/**
	 * Result sets returned from the query
	 */
	readonly resultSets: ReadonlyArray<IResultSet>;
	/**
	 * Time that the query started
	 */
	readonly startTime?: number;
	/**
	 * Time that the query finished
	 */
	readonly endTime?: number;

	// events
	onResultSetAvailable: Event<IResultSet>;
	onResultSetUpdated: Event<IResultSet>;
	onQueryComplete: Event<void>;
	onMessage: Event<IResultMessage | ReadonlyArray<IResultMessage>>;

	//TBD
	// onBatchStart: Event<void>;
	// onBatchComplete: Event<void>;
}

class Query extends Disposable implements IQuery {

	private _state: QueryState = QueryState.NOT_EXECUTING;
	public get state(): QueryState { return this._state; }

	private readonly _onDidStateChange = new Emitter<QueryState>();
	public readonly onDidStateChange = this._onDidStateChange.event;

	private readonly _onMessage = new Emitter<IResultMessage | ReadonlyArray<IResultMessage>>();
	public readonly onMessage = this._onMessage.event;

	private readonly _onResultSetAvailable = new Emitter<IResultSet>();
	public readonly onResultSetAvailable = this._onResultSetAvailable.event;

	private readonly _onResultSetUpdated = new Emitter<IResultSet>();
	public readonly onResultSetUpdated = this._onResultSetUpdated.event;

	private readonly _onQueryComplete = new Emitter<void>();
	public readonly onQueryComplete = this._onQueryComplete.event;

	private _startTime?: number;
	public get startTime(): number | undefined {
		return this._startTime;
	}

	private _endTime?: number;
	public get endTime(): number | undefined {
		if (this.state === QueryState.EXECUTING) {
			return undefined; // the end time is unreliable until we know the query has been completed
		}
		return this._endTime;
	}

	//#region TBD
	// private _onBatchStart = new Emitter<void>();
	// public readonly onBatchStart = this._onBatchStart.event;

	// private _onBatchComplete = new Emitter<void>();
	// public readonly onBatchComplete = this._onBatchComplete.event;
	//#endregion

	private _messages: Array<IResultMessage> = [];
	public get messages(): ReadonlyArray<IResultMessage> {
		return this._messages;
	}

	private _resultSets: Array<IResultSet> = [];
	public get resultSets(): ReadonlyArray<IResultSet> {
		return this._resultSets;
	}

	constructor(
		private readonly queryService: QueryService,
		public readonly associatedFile: URI
	) {
		super();
	}

	private setState(state: QueryState) {
		if (state !== this.state) {
			this._state = state;
			this._onDidStateChange.fire(this.state);
		}
	}

	async execute(): Promise<void> {
		if (this.state === QueryState.EXECUTING) {
			throw new Error('Query already executing');
		} else {
			this._resultSets = [];
			this._messages = [];
			this._startTime = undefined;
			this._endTime = undefined;
			await this.queryService.executeQuery(this.associatedFile);
			this._startTime = Date.now(); // create a bogus start time and we will do our best to update when we get a time from the provider
			this.setState(QueryState.EXECUTING);
		}
	}

	async cancel(): Promise<void> {
		const message = await this.queryService.cancelQuery(this.associatedFile);
		this.handleMessage({ message }); // should we be doing this?
		this.setState(QueryState.NOT_EXECUTING); // no sure if this is needed or if querycomplete gets called, but this is just being safe
	}

	async setExecutionOptions(options: { [key: string]: boolean | number | string }): Promise<void> {

	}

	private fetch(params: IFetchSubsetParams): Promise<IFetchResponse> {
		return this.queryService.fetchData(this.associatedFile, params);
	}

	public handleMessage(e: IResultMessage | ReadonlyArray<IResultMessage>): void {
		if (isArray(e)) {
			this._messages.push(...e);
		} else {
			this._messages.push(e as IResultMessage);
		}
		this._onMessage.fire(e);
	}

	private encodeId(resultId: number, batchId: number): string {
		return `${resultId}_${batchId}`;
	}

	// private decodeId(id: string): { resultId: number, batchId: number } {
	// 	const id_split = id.split('_');
	// 	return {
	// 		resultId: Number(id_split[0]),
	// 		batchId: Number(id_split[1])
	// 	};
	// }

	public handleResultSetAvailable(e: IResultSetSummary): void {
		const resultSet: IResultSet = {
			columns: e.columns.slice(),
			id: this.encodeId(e.resultIndex, e.batchIndex),
			rowCount: e.rowCount,
			completed: e.completed,
			fetch: (offset, count): Promise<IFetchResponse> => {
				return this.fetch({ resultIndex: e.resultIndex, batchIndex: e.batchIndex, startIndex: offset, rowCount: count });
			}
		};
		this._resultSets.push(resultSet);
		this._onResultSetAvailable.fire(resultSet);
	}

	public handleResultSetUpdated(e: IResultSetSummary): void {
		const id = this.encodeId(e.resultIndex, e.batchIndex);
		const resultSet = this._resultSets.find(e => e.id === id);
		(resultSet as IResultSetInternal).rowCount = e.rowCount;
		(resultSet as IResultSetInternal).completed = e.completed;
		this._onResultSetUpdated.fire(resultSet);
	}

	public handleQueryComplete(): void {
		this.setState(QueryState.NOT_EXECUTING);
		this._onQueryComplete.fire();
	}

	public handleBatchStart(e: { index: number, executionStart: number }): void {
		if (e.index === 0) { // only accept the first one
			this._startTime = e.executionStart;
		}
	}

	public handleBatchEnd(e: { executionEnd: number }): void {
		this._endTime = e.executionEnd; // continously overwrite this and assume the last one we get is the correct one
	}
}

export interface IQueryProviderEvent {
	connectionId: string;
}

export class QueryService extends Disposable implements IQueryService {
	_serviceBrand: undefined;

	private readonly queryProviders = new Map<string, { provider: IQueryProvider, disposable: IDisposable }>(); // providers that have been registered
	private readonly queries = new Map<string, Query>();

	public get providers(): ReadonlyArray<string> {
		return Iterable.consume(this.queryProviders.keys())[0];
	}

	constructor(
		@IConnectionManagementService private readonly connectionManagementService: IConnectionManagementService
	) {
		super();
	}

	createOrGetQuery(associatedURI: URI): IQuery | undefined {
		const existing = this.queries.get(associatedURI.toString());
		if (existing) {
			return existing;
		}
		const query = new Query(this, associatedURI);
		if (query) {
			this.queries.set(associatedURI.toString(), query);
		}
		return query;
	}

	registerProvider(provider: IQueryProvider): IDisposable {
		const disposable = combinedDisposable(
			provider.onMessage(e => this.onMessage(e)),
			provider.onResultSetAvailable(e => this.onResultSetAvailable(e)),
			provider.onResultSetUpdated(e => this.onResultSetUpdated(e)),
			provider.onBatchStart(e => this.onBatchStart(e)),
			provider.onBatchComplete(e => this.onBatchComplete(e)),
			provider.onQueryComplete(e => this.onQueryComplete(e)),
			toDisposable(() => this.queryProviders.delete(provider.id))
		);
		const providerStub = {
			disposable,
			provider
		};
		this.queryProviders.set(provider.id, providerStub);
		return disposable;
	}

	private findQuery(connectionId: string): Query {
		const query = this.queries.get(connectionId);
		if (query) {
			return query;
		}
		throw new Error(`Could not find query with connection ${connectionId}`);
	}

	private onMessage(e: IQueryProviderEvent & { messages: IResultMessage | ReadonlyArray<IResultMessage> }): void {
		this.findQuery(e.connectionId).handleMessage(e.messages);
	}

	private onResultSetAvailable(e: IQueryProviderEvent & IResultSetSummary): void {
		this.findQuery(e.connectionId).handleResultSetAvailable(e);
	}

	private onResultSetUpdated(e: IQueryProviderEvent & IResultSetSummary): void {
		this.findQuery(e.connectionId).handleResultSetUpdated(e);
	}

	private onBatchStart(e: IQueryProviderEvent & { executionStart: number, index: number }): void {
		this.findQuery(e.connectionId).handleBatchStart(e);
	}

	private onBatchComplete(e: IQueryProviderEvent & { executionEnd: number }): void {
		this.findQuery(e.connectionId).handleBatchEnd(e);
	}

	private onQueryComplete(e: IQueryProviderEvent): void {
		this.findQuery(e.connectionId).handleQueryComplete();
	}

	//#region @type{Query} helpers
	executeQuery(file: URI): Promise<void> {
		const provider = this.withProvider(file);
		return provider.runQuery(file.toString());
	}

	cancelQuery(file: URI): Promise<string> {
		const provider = this.withProvider(file);
		return provider.cancelQuery(file.toString());
	}

	fetchData(file: URI, params: IFetchSubsetParams): Promise<IFetchResponse> {
		const provider = this.withProvider(file);
		return provider.fetchSubset(file.toString(), params);
	}

	setExecutionOptions(file: URI, options: { [key: string]: number | boolean | string }): Promise<void> {
		const provider = this.withProvider(file);
		return provider.setExecutionOptions(file.toString(), options);
	}
	//#endregion

	private withProvider(file: URI): IQueryProvider {
		const provider = this.connectionManagementService.getProviderIdFromUri(file.toString());
		const providerStub = this.queryProviders.get(provider);
		if (!providerStub) {
			throw new Error(`Query provider could not be found: ${provider}`);
		}
		return providerStub.provider;
	}
}

registerSingleton(IQueryService, QueryService, true);
