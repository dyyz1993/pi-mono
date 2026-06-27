import type { ChannelContract } from "@dyyz1993/pi-coding-agent";
import type { RemoteSshConfigInput, RemoteSshStatus } from "./operations.ts";

export const REMOTE_SSH_CHANNEL_NAME = "remote-ssh";

export interface RemoteSshTestResult {
	ok: boolean;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	error?: string;
	status: RemoteSshStatus;
}

export interface RemoteSshSmokeResult {
	ok: boolean;
	steps: Array<{ name: string; ok: boolean; detail?: string }>;
	error?: string;
	status: RemoteSshStatus;
}

export interface RemoteSshChannelContract extends ChannelContract {
	methods: {
		getStatus: {
			params: Record<string, never>;
			return: RemoteSshStatus;
		};
		configure: {
			params: RemoteSshConfigInput & { persist?: boolean };
			return: RemoteSshStatus & { ok: boolean; error?: string };
		};
		disable: {
			params: { persist?: boolean };
			return: RemoteSshStatus & { ok: boolean; error?: string };
		};
		testConnection: {
			params: Partial<RemoteSshConfigInput> & { command?: string };
			return: RemoteSshTestResult;
		};
		smokeTest: {
			params: { subdir?: string; text?: string };
			return: RemoteSshSmokeResult;
		};
	};
	events: {
		status: RemoteSshStatus;
	};
}
