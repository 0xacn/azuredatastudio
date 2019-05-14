/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the Source EULA. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import 'mocha';
import * as assert from 'assert';
import * as azdata from 'azdata';
import * as vscode from 'vscode';
import { context } from './testContext';
import { sqlNotebookContent, writeNotebookToFile, sqlKernelMetadata, getFileName, pySparkNotebookContent, pySpark3KernelMetadata, pythonKernelMetadata, sqlNotebookMultipleCellsContent } from './notebook.util';
import { getBdcServer, getConfigValue, EnvironmentVariable_PYTHON_PATH } from './testConfig';
import { connectToServer } from './utils';
import * as fs from 'fs';
import { stressify, sleep } from '../testfmks/src/stress';

const debug = require('debug')('test:nb');
const trace = require('debug')('testfmks:nb:trace');

if (context.RunTest) {
	suite('Notebook integration test suite', function () {
		setup(function () {
			sleep(20000);
			trace(`environment variable SuiteType is set to ${process.env.SuiteType}`);
			debug(`Start "${this.currentTest.title}"`);
		});
		teardown(async function () {
			await (new NotebookTester()).cleanup(this.currentTest.title);
		});

		test('Sql NB test', async function () {
			await (new NotebookTester()).sqlNbTest(this.test.title);
		});

		test('Sql NB multiple cells test', async function () {
			await (new NotebookTester()).sqlNbMultipleCellsTest(this.test.title);
		});

		test('Clear all outputs - SQL notebook ', async function () {
			await (new NotebookTester()).sqlNbClearAllOutputs(this.test.title);
		});

		if (process.env['RUN_PYTHON3_TEST'] === '1') {
			test('Python3 notebook test', async function () {
				await (new NotebookTester()).python3NbTest(this.test.title);
			});

			test('Clear all outputs - Python3 notebook ', async function () {
				await (new NotebookTester()).python3ClearAllOutputs(this.test.title);
			});
		}

		if (process.env['RUN_PYSPARK_TEST'] === '1') {
			test('PySpark3 notebook test', async function () {
				await (new NotebookTester()).pySpark3NbTest(this.test.title);
			});
		}
	});
}

class NotebookTester {
	invocationCount: number = 0;

	async pySpark3NbTest(title: string) {
		let notebook = await this.openNotebook(pySparkNotebookContent, pySpark3KernelMetadata, title+this.invocationCount++);
		let cellOutputs = notebook.document.cells[0].contents.outputs;
		let sparkResult = (<azdata.nb.IStreamResult>cellOutputs[3]).text;
		assert(sparkResult === '2', `Expected spark result: 2, Actual: ${sparkResult}`);
	}

	async python3ClearAllOutputs(title: string) {
		let notebook = await this.openNotebook(pySparkNotebookContent, pythonKernelMetadata, title+this.invocationCount++);
		await this.verifyClearAllOutputs(notebook);
	}

	async python3NbTest(title: string) {
		let notebook = await this.openNotebook(pySparkNotebookContent, pythonKernelMetadata, title+this.invocationCount++);
		let cellOutputs = notebook.document.cells[0].contents.outputs;
		debug('Got cell outputs ---');
		if (cellOutputs) {
			cellOutputs.forEach(o => debug(JSON.stringify(o,undefined,'\t')));
		}
		let result = (<azdata.nb.IExecuteResult>cellOutputs[0]).data['text/plain'];
		assert(result === '2', `Expected python result: 2, Actual: ${result}`);
	}

	async sqlNbClearAllOutputs(title: string) {
		let notebook = await this.openNotebook(sqlNotebookContent, sqlKernelMetadata, title+this.invocationCount++);
		await this.verifyClearAllOutputs(notebook);
	}

	async sqlNbMultipleCellsTest(title: string) {
		let notebook = await this.openNotebook(sqlNotebookMultipleCellsContent, sqlKernelMetadata, title+this.invocationCount++, true);
		const expectedOutput0 = '(1 row affected)';
		for (let i = 0; i < 3; i++) {
			let cellOutputs = notebook.document.cells[i].contents.outputs;
			debug(`Got cell outputs --- ${i}`);
			if (cellOutputs) {
				cellOutputs.forEach(o => debug(o));
			}
			assert(cellOutputs.length === 3, `Expected length: 3, Actual: '${cellOutputs.length}'`);
			let actualOutput0 = (<azdata.nb.IDisplayData>cellOutputs[0]).data['text/html'];
			debug('Got first output');
			assert(actualOutput0 === expectedOutput0, `Expected row count: '${expectedOutput0}', Actual: '${actualOutput0}'`);
			let actualOutput2 = (<azdata.nb.IExecuteResult>cellOutputs[2]).data['application/vnd.dataresource+json'].data[0];
			assert(actualOutput2[0] === i.toString(), `Expected result: ${i.toString()}, Actual: '${actualOutput2[0]}'`);
			debug('Sql multiple cells NB done');
		}
	}

	@stressify({dop:1, iterations:1})
	async sqlNbTest(title: string) {
		let notebook = await this.openNotebook(sqlNotebookContent, sqlKernelMetadata, title+this.invocationCount++);
		const expectedOutput0 = '(1 row affected)';
		let cellOutputs = notebook.document.cells[0].contents.outputs;
		debug('Got cell outputs ---');
		if (cellOutputs) {
			cellOutputs.forEach(o => debug(o));
		}
		assert(cellOutputs.length === 3, `Expected length: 3, Actual: ${cellOutputs.length}`);
		let actualOutput0 = (<azdata.nb.IDisplayData>cellOutputs[0]).data['text/html'];
		debug('Got first output');
		assert(actualOutput0 === expectedOutput0, `Expected row count: ${expectedOutput0}, Actual: ${actualOutput0}`);
		let actualOutput2 = (<azdata.nb.IExecuteResult>cellOutputs[2]).data['application/vnd.dataresource+json'].data[0];
		assert(actualOutput2[0] === '1', `Expected result: 1, Actual: '${actualOutput2[0]}'`);
	}

	async cleanup(testName: string) {
		try {
			let fileName = getFileName(testName+this.invocationCount++);
			if (fs.existsSync(fileName)) {
				fs.unlinkSync(fileName);
				debug(`"${fileName}" is deleted.`);
			}
			await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
		}
		catch (err) {
			debug(err);
		}
		finally {
			debug(`"${testName}" is done`);
		}
	}

	async openNotebook(content: azdata.nb.INotebookContents, kernelMetadata: any, testName: string, runAllCells?: boolean): Promise<azdata.nb.NotebookEditor> {
		let notebookConfig = vscode.workspace.getConfiguration('notebook');
		testName += this.invocationCount++;
		notebookConfig.update('pythonPath', getConfigValue(EnvironmentVariable_PYTHON_PATH), 1);
		let server = await getBdcServer();
		assert(server && server.serverName, 'No server could be found in openNotebook');
		await connectToServer(server, 6000);
		let notebookJson = Object.assign({}, content, { metadata: kernelMetadata });
		let uri = writeNotebookToFile(notebookJson, testName);
		debug(uri);
		let notebook = await azdata.nb.showNotebookDocument(uri);
		debug('Notebook is opened');

		if (!runAllCells) {
			assert(notebook.document.cells.length === 1, 'Notebook should have 1 cell');
			debug('Before run notebook cell');
			let ran = await notebook.runCell(notebook.document.cells[0]);
			debug('After run notebook cell');
			assert(ran, 'Notebook runCell should succeed');
		} else {
			debug('Before run all notebook cells');
			let ran = await notebook.runAllCells();
			assert(ran, 'Notebook runCell should succeed');
			assert(notebook !== undefined && notebook !== null, 'Expected notebook object is defined');
		}

		return notebook;
	}
	async verifyClearAllOutputs(notebook: azdata.nb.NotebookEditor) {
		let cellWithOutputs = notebook.document.cells.find(cell => cell.contents && cell.contents.outputs && cell.contents.outputs.length > 0);
		assert(cellWithOutputs !== undefined, 'Could not find notebook cells with outputs');
		debug('Before clearing cell outputs');
		let clearedOutputs = await notebook.clearAllOutputs();
		let cells = notebook.document.cells;
		cells.forEach(cell => {
			assert(cell.contents && cell.contents.outputs && cell.contents.outputs.length === 0, `Expected Output: 0, Actual: '${cell.contents.outputs.length}'`);
		});
		assert(clearedOutputs, 'Outputs of all the code cells from Python notebook should be cleared');
		debug('After clearing cell outputs');
	}
}

