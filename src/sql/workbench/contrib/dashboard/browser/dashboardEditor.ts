/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { EditorOptions } from 'vs/workbench/common/editor';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IWorkbenchThemeService } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';

import { DashboardInput } from 'sql/workbench/browser/editor/profiler/dashboardInput';
import { DashboardModule } from './dashboard.module';
import { bootstrapAngular } from 'sql/workbench/services/bootstrap/browser/bootstrapService';
import { IDashboardComponentParams } from 'sql/workbench/services/bootstrap/common/bootstrapParams';
import { DASHBOARD_SELECTOR } from 'sql/workbench/contrib/dashboard/browser/dashboard.component';
import { ConnectionContextKey } from 'sql/workbench/services/connection/common/connectionContextKey';
import { IDashboardService } from 'sql/platform/dashboard/browser/dashboardService';
import { ConnectionProfile } from 'sql/platform/connection/common/connectionProfile';
import { IConnectionProfile } from 'sql/platform/connection/common/interfaces';
import { IConnectionManagementService } from 'sql/platform/connection/common/connectionManagement';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IQueryService } from 'sql/platform/query/common/queryService';

export class DashboardEditor extends BaseEditor {

	public static ID: string = 'workbench.editor.connectiondashboard';
	private _dashboardContainer: HTMLElement;
	protected _input: DashboardInput;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkbenchThemeService themeService: IWorkbenchThemeService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IDashboardService private readonly dashboardService: IDashboardService,
		@IConnectionManagementService private readonly connMan: IConnectionManagementService,
		@IStorageService storageService: IStorageService,
		@IQueryService private readonly queryService: IQueryService
	) {
		super(DashboardEditor.ID, telemetryService, themeService, storageService);
	}

	public get input(): DashboardInput {
		return this._input;
	}

	/**
	 * Called to create the editor in the parent element.
	 */
	public createEditor(parent: HTMLElement): void {
	}

	/**
	 * Sets focus on this editor. Specifically, it sets the focus on the hosted text editor.
	 */
	public focus(): void {

		let profile: IConnectionProfile;
		if (this.input.connectionProfile instanceof ConnectionProfile) {
			profile = this.input.connectionProfile.toIConnectionProfile();
		} else {
			profile = this.input.connectionProfile;
		}
		const serverInfo = this.connMan.getConnectionInfo(this.input.uri).serverInfo;
		this.dashboardService.changeToDashboard({ profile, serverInfo });
	}

	/**
	 * Updates the internal variable keeping track of the editor's size, and re-calculates the sash position.
	 * To be called when the container of this editor changes size.
	 */
	public layout(dimension: DOM.Dimension): void {
		this.dashboardService.layout(dimension);
	}

	public async setInput(input: DashboardInput, options: EditorOptions): Promise<void> {
		if (this.input && this.input.matches(input)) {
			return Promise.resolve(undefined);
		}

		const parentElement = this.getContainer();

		super.setInput(input, options, CancellationToken.None);

		DOM.clearNode(parentElement);

		if (!input.hasBootstrapped) {
			const container = DOM.$<HTMLElement>('.dashboardEditor');
			container.style.height = '100%';
			this._dashboardContainer = DOM.append(parentElement, container);
			this.input.container = this._dashboardContainer;
			await input.initializedPromise;
			this.bootstrapAngular(input);
		} else {
			this._dashboardContainer = DOM.append(parentElement, this.input.container);
		}
	}

	/**
	 * Load the angular components and record for this input that we have done so
	 */
	private bootstrapAngular(input: DashboardInput): void {
		// Get the bootstrap params and perform the bootstrap
		let profile: IConnectionProfile;
		if (input.connectionProfile instanceof ConnectionProfile) {
			profile = input.connectionProfile.toIConnectionProfile();
		} else {
			profile = this.input.connectionProfile;
		}
		const serverInfo = this.connMan.getConnectionInfo(this.input.uri).serverInfo;
		this.dashboardService.changeToDashboard({ profile, serverInfo });
		const scopedContextService = this.contextKeyService.createScoped(input.container);
		const connectionContextKey = new ConnectionContextKey(scopedContextService, this.queryService);
		connectionContextKey.set(input.connectionProfile);

		const params: IDashboardComponentParams = {
			connection: input.connectionProfile,
			ownerUri: input.uri,
			scopedContextService,
			connectionContextKey
		};

		input.hasBootstrapped = true;

		const uniqueSelector = this.instantiationService.invokeFunction(bootstrapAngular,
			DashboardModule,
			this._dashboardContainer,
			DASHBOARD_SELECTOR,
			params,
			input);
		input.setUniqueSelector(uniqueSelector);
	}

	public dispose(): void {
		super.dispose();
	}
}
