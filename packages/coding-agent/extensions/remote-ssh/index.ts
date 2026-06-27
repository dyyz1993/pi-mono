import { createTypedChannel, type ExtensionAPI, type ToolOperationsProvider } from "@dyyz1993/pi-coding-agent";
import {
	createRemoteSshOperations,
	createSshRunner,
	loadRemoteSshConfig,
	normalizeRemoteSshConfig,
	saveRemoteSshConfig,
	toRemoteSshStatus,
	type RemoteSshConfig,
	type RemoteSshConfigInput,
} from "./operations.ts";
import { REMOTE_SSH_CHANNEL_NAME, type RemoteSshChannelContract, type RemoteSshSmokeResult } from "./contract.ts";

export { createRemoteSshOperations, loadRemoteSshConfig };
export type { RemoteSshConfig, RemoteSshConfigInput, SshRunner, SshRunResult } from "./operations.ts";
export { REMOTE_SSH_CHANNEL_NAME };
export type { RemoteSshChannelContract, RemoteSshTestResult } from "./contract.ts";

export default function remoteSshExtension(pi: ExtensionAPI): void {
	pi.setName("remote-ssh");

	let cwd = "";
	let activeConfig: RemoteSshConfig | undefined;
	let activeProvider: ToolOperationsProvider | undefined;

	const applyConfig = (config: RemoteSshConfig | undefined): void => {
		activeConfig = config;
		if (!config?.enabled) {
			if (activeProvider && pi.getToolOperationsProvider() === activeProvider) {
				pi.setToolOperationsProvider(undefined);
			}
			activeProvider = undefined;
			return;
		}
		activeProvider = createRemoteSshOperations(config);
		pi.setToolOperationsProvider(activeProvider);
	};

	const getStatus = () => toRemoteSshStatus(activeConfig);
	const emitStatus = () => channel?.emit("status", getStatus());

	let channel: ReturnType<typeof createTypedChannel<RemoteSshChannelContract>>["server"] | undefined;
	try {
		const raw = pi.registerChannel(REMOTE_SSH_CHANNEL_NAME);
		channel = createTypedChannel<RemoteSshChannelContract>(raw).server;
		channel.handle("getStatus", () => getStatus());
		channel.handle("configure", async (params) => {
			try {
				const config =
					params.persist ?? true
						? await saveRemoteSshConfig(cwd || process.cwd(), { ...params, enabled: params.enabled ?? true })
						: normalizeRemoteSshConfig({ ...params, enabled: params.enabled ?? true }, cwd || process.cwd());
				applyConfig(config);
				emitStatus();
				return { ...getStatus(), ok: true };
			} catch (error) {
				return { ...getStatus(), ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		});
		channel.handle("disable", async (params) => {
			try {
				if (params.persist ?? true) {
					await saveRemoteSshConfig(cwd || process.cwd(), { enabled: false });
				}
				applyConfig(undefined);
				emitStatus();
				return { ...getStatus(), ok: true };
			} catch (error) {
				return { ...getStatus(), ok: false, error: error instanceof Error ? error.message : String(error) };
			}
		});
		channel.handle("testConnection", async (params) => {
			const config = normalizeRemoteSshConfig({ ...activeConfig, ...params, enabled: true }, cwd || process.cwd());
			if (!config) {
				return {
					ok: false,
					exitCode: null,
					stdout: "",
					stderr: "",
					error: "Remote SSH is not configured.",
					status: getStatus(),
				};
			}
			const command =
				params.command ??
				`printf 'host=%s\\nuser=%s\\npwd=%s\\n' "$(hostname)" "$(whoami)" "$(pwd)"; cd ${JSON.stringify(config.remoteCwd)} && pwd`;
			try {
				const result = await createSshRunner(config).run(command);
				return {
					ok: result.exitCode === 0,
					exitCode: result.exitCode,
					stdout: result.stdout.toString("utf-8"),
					stderr: result.stderr.toString("utf-8"),
					status: toRemoteSshStatus(config),
				};
			} catch (error) {
				return {
					ok: false,
					exitCode: null,
					stdout: "",
					stderr: "",
					error: error instanceof Error ? error.message : String(error),
					status: toRemoteSshStatus(config),
				};
			}
		});
		channel.handle("smokeTest", async (params) => runSmokeTest(cwd || process.cwd(), activeConfig, params));
	} catch {
		// registerChannel is only available in RPC mode. The extension still works in
		// interactive mode by loading project/env config on session_start.
	}

	pi.on("session_start", (_event, ctx) => {
		cwd = ctx.cwd;
		applyConfig(loadRemoteSshConfig(ctx.cwd));
		emitStatus();
	});

	pi.on("session_shutdown", () => {
		if (activeProvider && pi.getToolOperationsProvider() === activeProvider) {
			pi.setToolOperationsProvider(undefined);
		}
		activeProvider = undefined;
		activeConfig = undefined;
	});
}

async function runSmokeTest(
	cwd: string,
	config: RemoteSshConfig | undefined,
	params: { subdir?: string; text?: string },
): Promise<RemoteSshSmokeResult> {
	const steps: RemoteSshSmokeResult["steps"] = [];
	const record = (name: string, ok: boolean, detail?: string) => {
		steps.push({ name, ok, detail });
	};
	if (!config?.enabled) {
		return { ok: false, steps, error: "Remote SSH is not configured.", status: toRemoteSshStatus(config) };
	}
	try {
		const ops = createRemoteSshOperations(config);
		const subdir = params.subdir ?? ".pi-remote-ssh-smoke";
		const text = params.text ?? `remote-ssh-smoke ${Date.now()}`;
		const localDir = `${cwd.replace(/\/+$/, "")}/${subdir}`;
		const localFile = `${localDir}/marker.txt`;

		await ops.write?.mkdir(localDir);
		record("write.mkdir", true, localDir);
		await ops.write?.writeFile(localFile, `${text}\n`);
		record("write.writeFile", true, localFile);

		const readBuffer = await ops.read?.readFile(localFile);
		const readText = readBuffer?.toString("utf-8") ?? "";
		record("read.readFile", readText === `${text}\n`, readText.trim());

		const entries = await ops.ls?.readdir(localDir);
		record("ls.readdir", Boolean(entries?.includes("marker.txt")), entries?.join(", "));

		const found = await ops.find?.glob("marker.txt", cwd, { ignore: [], limit: 20 });
		record("find.glob", Boolean(found?.some((item) => item.endsWith("marker.txt"))), found?.join(", "));

		const grepNeedle = text.split(/\r?\n/)[0] || "remote-ssh-smoke";
		const grepOutput = await ops.grep?.search?.(grepNeedle, localDir, { literal: true });
		record("grep.search", Boolean(grepOutput?.includes(grepNeedle)), grepOutput?.split("\n")[0]);

		const bashChunks: string[] = [];
		const bashResult = await ops.bash?.exec(`pwd && cat ${subdir}/marker.txt`, cwd, {
			onData: (data) => bashChunks.push(data.toString("utf-8")),
		});
		record("bash.exec", bashResult?.exitCode === 0 && bashChunks.join("").includes(text), bashChunks.join("").trim());

		return { ok: steps.every((step) => step.ok), steps, status: toRemoteSshStatus(config) };
	} catch (error) {
		return {
			ok: false,
			steps,
			error: error instanceof Error ? error.message : String(error),
			status: toRemoteSshStatus(config),
		};
	}
}
