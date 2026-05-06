/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentHostOTelCaptureContentSettingId, AgentHostOTelEnabledSettingId, AgentHostOTelEndpointSettingId, AgentHostOTelMaxAttributeSizeSettingId, AgentHostOTelVerboseTracingSettingId, IAgentHostService } from '../common/agentService.js';
import { InMemoryAgentHostOTelService } from '../common/otel/inMemoryAgentHostOTelService.js';
import type { AgentHostCompletedSpan, AgentHostOTelConfig } from '../common/otel/agentHostOTelService.js';
import { IConfigurationService } from '../../configuration/common/configuration.js';
import { ILogService } from '../../log/common/log.js';

export class BrowserAgentHostOTelService extends InMemoryAgentHostOTelService {

	constructor(
		@IConfigurationService configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@IAgentHostService private readonly _agentHostService: IAgentHostService,
	) {
		const config = resolveBrowserAgentHostOTelConfig(configurationService);
		super(config);
		if (config.enabled) {
			this._register(this.onDidCompleteSpan(span => this._exportSpan(span)));
		}
	}

	private async _exportSpan(span: AgentHostCompletedSpan): Promise<void> {
		try {
			await this._agentHostService.emitOTelSpan(span);
		} catch (error) {
			this._logService.warn('[AgentHostOTel] Failed to forward workbench span to agent host', error);
		}
	}
}

function resolveBrowserAgentHostOTelConfig(configurationService: IConfigurationService): AgentHostOTelConfig {
	return {
		enabled: configurationService.getValue<boolean>(AgentHostOTelEnabledSettingId) === true,
		verboseTracing: configurationService.getValue<boolean>(AgentHostOTelVerboseTracingSettingId) === true,
		captureContent: configurationService.getValue<boolean>(AgentHostOTelCaptureContentSettingId) === true,
		maxAttributeSizeChars: configurationService.getValue<number>(AgentHostOTelMaxAttributeSizeSettingId) || 4096,
		otlpEndpoint: configurationService.getValue<string>(AgentHostOTelEndpointSettingId),
		serviceName: 'vscode-agent-host-workbench',
	};
}
