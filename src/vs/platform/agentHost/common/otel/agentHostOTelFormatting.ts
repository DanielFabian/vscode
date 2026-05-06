/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function truncateForAgentHostOTel(value: string, maxAttributeSizeChars: number): string {
	if (maxAttributeSizeChars <= 0 || value.length <= maxAttributeSizeChars) {
		return value;
	}

	return value.substring(0, maxAttributeSizeChars);
}

