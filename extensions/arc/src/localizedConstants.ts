/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vscode-nls';
const localize = nls.loadMessageBundle();

export const overview = localize('arc.overview', "Overview");
export const backup = localize('arc.backup', "Backup");
export const connectionStrings = localize('arc.connectionStrings', "Connection Strings");
export const networking = localize('arc.networking', "Networking");
export const properties = localize('arc.properties', "Properties");

export const postgresDashboard = localize('arc.postgresDashboard', "Postgres Dashboard (Preview)");
export const computeAndStorage = localize('arc.computeAndStorage', 'Compute + Storage');

export const nameColumn = localize('name', "Name");
export const resourceTypeColumn = localize('resourceType', "Resource type");
export const resourceGroupColumn = localize('resourceGroup', "Resource group");
export const locationColumn = localize('location', "Location");
export const subscriptionColumn = localize('subscription', "Subscription");
