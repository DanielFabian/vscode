/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'child_process';
import { app } from 'electron';
import { constants } from 'fs';
import { access, chmod, mkdir, readdir, rename, rm, writeFile } from 'fs/promises';
import { Delayer } from '../../../base/common/async.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { CancellationToken } from '../../../base/common/cancellation.js';
import * as path from '../../../base/common/path.js';
import { transform } from '../../../base/common/stream.js';
import { URI } from '../../../base/common/uri.js';
import { checksum } from '../../../base/node/crypto.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { IEnvironmentMainService } from '../../environment/electron-main/environmentMainService.js';
import { IFileService } from '../../files/common/files.js';
import { ILifecycleMainService } from '../../lifecycle/electron-main/lifecycleMainService.js';
import { ILogService } from '../../log/common/log.js';
import { IMeteredConnectionService } from '../../meteredConnection/common/meteredConnection.js';
import { IProductService } from '../../product/common/productService.js';
import { asJson, IRequestService } from '../../request/common/request.js';
import { IApplicationStorageMainService } from '../../storage/electron-main/storageMainService.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';
import { AvailableForDownload, IUpdate, State, StateType, UpdateType } from '../common/update.js';
import { AbstractUpdateService, createUpdateURL, IUpdateURLOptions } from './abstractUpdateService.js';

interface IAvailableArchiveUpdate {
	readonly update: IUpdate;
	readonly archivePath: string;
	readonly extractedRoot: string;
}

export class LinuxUpdateService extends AbstractUpdateService {
	private availableUpdate: IAvailableArchiveUpdate | undefined;

	constructor(
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IConfigurationService configurationService: IConfigurationService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
		@IFileService private readonly fileService: IFileService,
		@IProductService productService: IProductService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IApplicationStorageMainService applicationStorageMainService: IApplicationStorageMainService,
		@IMeteredConnectionService meteredConnectionService: IMeteredConnectionService,
	) {
		super(lifecycleMainService, configurationService, environmentMainService, requestService, logService, productService, telemetryService, applicationStorageMainService, meteredConnectionService, false);
	}

	protected buildUpdateFeedUrl(quality: string, commit: string, options?: IUpdateURLOptions): string {
		return createUpdateURL(this.productService.updateUrl!, `linux-${process.arch}`, quality, commit, options);
	}

	protected doCheckForUpdates(explicit: boolean, _pendingCommit?: string): void {
		if (!this.quality) {
			return;
		}

		const internalOrg = this.getInternalOrg();
		const background = !explicit && !internalOrg;
		const url = this.buildUpdateFeedUrl(this.quality, this.productService.commit!, { background, internalOrg });
		this.setState(State.CheckingForUpdates(explicit));

		this.requestService.request({ url, callSite: 'updateService.linux.checkForUpdates' }, CancellationToken.None)
			.then<IUpdate | null>(asJson)
			.then(update => {
				if (!update || !update.url || !update.version || !update.productVersion) {
					this.setState(State.Idle(UpdateType.Archive, undefined, explicit || undefined));
					return undefined;
				} else {
					if (!explicit && this.meteredConnectionService.isConnectionMetered) {
						this.logService.info('update#doCheckForUpdates - update available but skipping download because connection is metered');
						this.setState(State.AvailableForDownload(update));
						return undefined;
					} else {
						return this.downloadArchiveUpdate(update, explicit);
					}
				}
			})
			.then(undefined, err => {
				this.logService.error(err);
				// only show message when explicitly checking for updates
				const message: string | undefined = explicit ? (err.message || err) : undefined;
				this.setState(State.Idle(UpdateType.Archive, message));
			});
	}

	protected override async doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		await this.downloadArchiveUpdate(state.update, true);
	}

	protected override doQuitAndInstall(): void {
		if ((this.state.type !== StateType.Ready && this.state.type !== StateType.Restarting) || !this.availableUpdate) {
			return;
		}

		const appRoot = this.getCurrentAppRoot();
		const nextRoot = this.availableUpdate.extractedRoot;
		const backupRoot = `${appRoot}.old-${Date.now()}`;
		const executableName = path.basename(process.execPath);
		const scriptPath = path.join(path.dirname(nextRoot), 'apply-linux-update.sh');
		const script = `#!/usr/bin/env bash
set -euo pipefail
sleep 1
target=${shellQuote(appRoot)}
next=${shellQuote(nextRoot)}
backup=${shellQuote(backupRoot)}
exe=${shellQuote(executableName)}
if [[ ! -x "$next/$exe" ]]; then
	echo "Updated executable not found: $next/$exe" >&2
	exit 1
fi
rm -rf "$backup"
mv "$target" "$backup"
mv "$next" "$target"
rm -rf "$backup" &
nohup "$target/$exe" >/dev/null 2>&1 &
`;

		writeFile(scriptPath, script, { mode: 0o700 })
			.then(() => chmod(scriptPath, 0o700))
			.then(() => {
				spawn('/bin/bash', [scriptPath], {
					detached: true,
					stdio: ['ignore', 'ignore', 'ignore']
				}).unref();
			})
			.then(undefined, error => this.logService.error(error));
	}

	private async downloadArchiveUpdate(update: IUpdate, explicit: boolean): Promise<void> {
		if (!update.url) {
			this.setState(State.Idle(UpdateType.Archive));
			return;
		}

		await access(path.dirname(this.getCurrentAppRoot()), constants.W_OK);

		const updateCachePath = path.join(app.getPath('userData'), 'CachedUpdates', update.version);
		const archivePath = path.join(updateCachePath, 'archive.tar.gz');
		const downloadPath = `${archivePath}.tmp`;
		const extractPath = path.join(updateCachePath, 'extract');

		await rm(updateCachePath, { recursive: true, force: true });
		await mkdir(extractPath, { recursive: true });

		const startTime = Date.now();
		this.setState(State.Downloading(update, explicit, false, 0, undefined, startTime));

		const context = await this.requestService.request({ url: update.url, callSite: 'updateService.linux.downloadUpdate' }, CancellationToken.None);
		const contentLengthHeader = context.res.headers['content-length'];
		const contentLength = typeof contentLengthHeader === 'string' ? contentLengthHeader : undefined;
		const totalBytes = contentLength ? parseInt(contentLength, 10) : undefined;

		let downloadedBytes = 0;
		const progressDelayer = new Delayer<void>(500);
		const progressStream = transform<VSBuffer, VSBuffer>(
			context.stream,
			{
				data: data => {
					downloadedBytes += data.byteLength;
					progressDelayer.trigger(() => {
						this.setState(State.Downloading(update, explicit, false, downloadedBytes, totalBytes, startTime));
					});
					return data;
				}
			},
			chunks => VSBuffer.concat(chunks)
		);

		try {
			await this.fileService.writeFile(URI.file(downloadPath), progressStream);
		} finally {
			progressDelayer.dispose();
		}

		if (update.sha256hash) {
			await checksum(downloadPath, update.sha256hash);
		}

		await rename(downloadPath, archivePath);
		await this.extractArchive(archivePath, extractPath);

		const extractedRoot = await this.findExtractedRoot(extractPath);
		const executablePath = path.join(extractedRoot, path.basename(process.execPath));
		await access(executablePath, constants.X_OK);

		this.availableUpdate = { update, archivePath, extractedRoot };
		this.setState(State.Ready(update, explicit, false));
	}

	private getCurrentAppRoot(): string {
		return path.dirname(process.execPath);
	}

	private async extractArchive(archivePath: string, destination: string): Promise<void> {
		await runProcess('tar', ['-xzf', archivePath, '-C', destination]);
	}

	private async findExtractedRoot(extractPath: string): Promise<string> {
		const entries = await readdir(extractPath, { withFileTypes: true });
		const directories = entries.filter(entry => entry.isDirectory());
		if (directories.length !== 1) {
			throw new Error(`Expected update archive to contain exactly one root directory, found ${directories.length}`);
		}

		return path.join(extractPath, directories[0].name);
	}
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function runProcess(command: string, args: string[]): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
		let stderr = '';
		child.stderr?.on('data', data => stderr += String(data));
		child.on('error', reject);
		child.on('exit', code => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`${command} exited with code ${code}: ${stderr}`));
			}
		});
	});
}
