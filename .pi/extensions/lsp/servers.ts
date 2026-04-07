/**
 * LSP Extension - Server Definitions
 *
 * Built-in LSP server configurations with spawn logic, root detection,
 * and auto-installation for common language servers.
 * Based on opencode's lsp/server.ts
 */

import { spawn as spawnProc, type ChildProcessWithoutNullStreams } from "child_process";
import * as path from "path";
import * as fs from "fs/promises";
import os from "os";
import type { ServerInfo, ServerHandle } from "./types.js";

const spawn = (
	cmd: string,
	args?: string[],
	options?: { cwd?: string; env?: NodeJS.ProcessEnv },
): ChildProcessWithoutNullStreams => {
	return spawnProc(cmd, args ?? [], { ...(options ?? {}), windowsHide: true });
};

function which(bin: string, _extraPath?: string): string | undefined {
	const separator = path.delimiter;
	const pathEnv = process.env.PATH ?? "";
	const pathVar = _extraPath ? `${pathEnv}${separator}${_extraPath}` : pathEnv;

	const dirs = pathVar.split(separator);
	for (const dir of dirs) {
		const candidate = path.join(dir, bin);
		try {
			fs.access(candidate, fs.constants.X_OK);
			return candidate;
		} catch {
			continue;
		}
	}
	if (process.platform === "win32") {
		for (const ext of [".exe", ".cmd", ".bat"]) {
			for (const dir of dirs) {
				const candidate = path.join(dir, bin + ext);
				try {
					fs.access(candidate, fs.constants.X_OK);
					return candidate;
				} catch {
					continue;
				}
			}
		}
	}
	return undefined;
}

async function exists(p: string): Promise<boolean> {
	try {
		await fs.stat(p);
		return true;
	} catch {
		return false;
	}
}

async function findNearestRoot(
	file: string,
	includePatterns: string[],
	excludePatterns?: string[],
	stopDir?: string,
): Promise<string | undefined> {
	let current = path.dirname(file);

	while (true) {
		if (excludePatterns) {
			for (const pattern of excludePatterns) {
				const excluded = path.join(current, pattern);
				if (await exists(excluded)) return undefined;
			}
		}

		for (const pattern of includePatterns) {
			const target = path.join(current, pattern);
			if (await exists(target)) return current;
		}

		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;

		if (stopDir && current.length < stopDir.length) break;
		if (stopDir && current === stopDir) break;
	}

	return stopDir;
}

function runCommand(
	cmd: string[],
	opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	return new Promise((resolve) => {
		const proc = spawnProc(cmd[0], cmd.slice(1), {
			cwd: opts.cwd,
			env: opts.env ?? process.env,
			stdio: ["pipe", "pipe", "pipe"] as any,
		});
		let stdout = "";
		let stderr = "";
		proc.stdout?.on("data", (d: Buffer | string) => (stdout += d.toString()));
		proc.stderr?.on("data", (d: Buffer | string) => (stderr += d.toString()));
		proc.on("close", (code) => resolve({ code, stdout, stderr }));
	});
}

export const LspServers: Record<string, ServerInfo> = {};

const registerServer = (info: ServerInfo) => {
	LspServers[info.id] = info;
};

registerServer({
	id: "typescript",
	extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
	root: async (file) =>
		findNearestRoot(file, [
			"package-lock.json",
			"bun.lockb",
			"bun.lock",
			"pnpm-lock.yaml",
			"yarn.lock",
		], ["deno.json", "deno.jsonc"]),
	async spawn(root) {
		const tsServer = which("typescript-language-server");
		if (!tsServer) {
			const tsserverPath = path.resolve(root, "node_modules", "typescript", "lib", "tsserver.js");
			if (!(await exists(tsserverPath))) return undefined;

			const npxBin = which("npx");
			if (!npxBin) return undefined;

			return {
				process: spawn(npxBin, ["typescript-language-server", "--stdio"], {
					cwd: root,
					env: { ...process.env },
				}),
				initialization: { tsserver: { path: tsserverPath } },
			};
		}

		return {
			process: spawn(tsServer, ["--stdio"], { cwd: root }),
		};
	},
});

registerServer({
	id: "python",
	extensions: [".py", ".pyi"],
	root: async (file) =>
		findNearestRoot(file, [
			"pyproject.toml",
			"setup.py",
			"setup.cfg",
			"requirements.txt",
			"Pipfile",
			"pyrightconfig.json",
		]),
	async spawn(root) {
		let binary = which("pyright-langserver");
		const args: string[] = [];

		if (!binary) {
			binary = which("pyright");
			if (binary) {
				args.push("langserver");
			} else {
				binary = which("npx");
				if (!binary) return undefined;
				args.push("pyright-langserver", "--stdio");
			}
		}
		args.push("--stdio");

		const initialization: Record<string, string> = {};
		const venvPaths = [
			process.env.VIRTUAL_ENV,
			path.join(root, ".venv"),
			path.join(root, "venv"),
		].filter((p): p is string => p !== undefined);

		for (const venv of venvPaths) {
			const isWin = process.platform === "win32";
			const pythonPath = isWin
				? path.join(venv, "Scripts", "python.exe")
				: path.join(venv, "bin", "python");
			if (await exists(pythonPath)) {
				initialization.pythonPath = pythonPath;
				break;
			}
		}

		return {
			process: spawn(binary, args.slice(1), {
				cwd: root,
				env: { ...process.env },
			}),
			initialization,
		};
	},
});

registerServer({
	id: "gopls",
	extensions: [".go"],
	root: async (file) => {
		const workRoot = await findNearestRoot(file, ["go.work"]);
		if (workRoot) return workRoot;
		return findNearestRoot(file, ["go.mod", "go.sum"]);
	},
	async spawn(root) {
		let bin = which("gopls");
		if (!bin) {
			if (!which("go")) return undefined;

			const installResult = await runCommand(["go", "install", "golang.org/x/tools/gopls@latest"], {
				env: { ...process.env, GOBIN: path.join(os.tmpdir(), "pi-lsp-bin") },
			});
			if (installResult.code !== 0) return undefined;

			bin = path.join(os.tmpdir(), "pi-lsp-bin", process.platform === "win32" ? "gopls.exe" : "gopls");
		}

		return { process: spawn(bin!, [], { cwd: root }) };
	},
});

registerServer({
	id: "rust-analyzer",
	extensions: [".rs"],
	root: async (file) => {
		const crateRoot = await findNearestRoot(file, ["Cargo.toml", "Cargo.lock"]);
		if (!crateRoot) return undefined;

		let currentDir = crateRoot;
		while (currentDir !== path.dirname(currentDir)) {
			const cargoToml = path.join(currentDir, "Cargo.toml");
			try {
				const content = await fs.readFile(cargoToml, "utf-8");
				if (content.includes("[workspace]")) return currentDir;
			} catch {}

			const parent = path.dirname(currentDir);
			if (parent === currentDir) break;
			currentDir = parent;
		}

		return crateRoot;
	},
	async spawn(root) {
		const bin = which("rust-analyzer");
		if (!bin) return undefined;
		return { process: spawn(bin, [], { cwd: root }) };
	},
});

registerServer({
	id: "clangd",
	extensions: [".c", ".cpp", ".cc", ".cxx", ".c++", ".h", ".hpp", ".hh", ".hxx", ".h++"],
	root: async (file) =>
		findNearestRoot(file, [
			"compile_commands.json",
			"compile_flags.txt",
			".clangd",
			"CMakeLists.txt",
			"Makefile",
		]),
	async spawn(root) {
		const bin = which("clangd");
		if (!bin) return undefined;
		return {
			process: spawn(bin, ["--background-index", "--clang-tidy"], { cwd: root }),
		};
	},
});

registerServer({
	id: "vue",
	extensions: [".vue"],
	root: async (file) =>
		findNearestRoot(file, [
			"package-lock.json",
			"bun.lockb",
			"bun.lock",
			"pnpm-lock.yaml",
			"yarn.lock",
		]),
	async spawn(root) {
		let binary = which("vue-language-server");
		const args: string[] = [];

		if (!binary) {
			const js = path.resolve(root, "node_modules", "@vue", "language-server", "bin", "vue-language-server.js");
			if (!(await exists(js))) {
				binary = which("npx");
				if (!binary) return undefined;
				args.push("@vue/language-server", js, "--stdio");
				return {
					process: spawn(binary, args, { cwd: root, env: { ...process.env } }),
				};
			}
			binary = which("node") || which("nodejs");
			if (!binary) return undefined;
			args.push(js);
		}
		args.push("--stdio");

		return {
			process: spawn(binary, args, { cwd: root, env: { ...process.env } }),
		};
	},
});

registerServer({
	id: "svelte",
	extensions: [".svelte"],
	root: async (file) =>
		findNearestRoot(file, [
			"package-lock.json",
			"bun.lockb",
			"bun.lock",
			"pnpm-lock.yaml",
			"yarn.lock",
		]),
	async spawn(root) {
		let binary = which("svelteserver");
		const args: string[] = [];

		if (!binary) {
			const js = path.resolve(root, "node_modules", "svelte-language-server", "bin", "server.js");
			if (!(await exists(js))) {
				binary = which("npx");
				if (!binary) return undefined;
				args.push("svelte-language-server", "--stdio");
				return {
					process: spawn(binary, args, { cwd: root, env: { ...process.env } }),
				};
			}
			binary = which("node") || which("nodejs");
			if (!binary) return undefined;
			args.push(js);
		}
		args.push("--stdio");

		return {
			process: spawn(binary, args, { cwd: root, env: { ...process.env } }),
		};
	},
});

registerServer({
	id: "yaml",
	extensions: [".yaml", ".yml"],
	root: async (file) =>
		findNearestRoot(file, [
			"package-lock.json",
			"bun.lockb",
			"bun.lock",
			"pnpm-lock.yaml",
			"yarn.lock",
		]),
	async spawn(root) {
		let binary = which("yaml-language-server");
		const args: string[] = [];

		if (!binary) {
			binary = which("npx");
			if (!binary) return undefined;
			args.push("yaml-language-server", "--stdio");
		} else {
			args.push("--stdio");
		}

		return {
			process: spawn(binary, args, { cwd: root, env: { ...process.env } }),
		};
	},
});

registerServer({
	id: "html",
	extensions: [".html", ".htm"],
	root: async () => undefined,
	async spawn(root) {
		let binary = which("vscode-html-language-server");
		const args: string[] = [];

		if (!binary) {
			binary = which("npx");
			if (!binary) return undefined;
			args.push("@vscode/vscode-languagedetection", "vscode-html-language-server", "--stdio");
		} else {
			args.push("--stdio");
		}

		return {
			process: spawn(binary, args, { cwd: root, env: { ...process.env } }),
		};
	},
});

registerServer({
	id: "css",
	extensions: [".css", ".scss", ".sass", ".less"],
	root: async () => undefined,
	async spawn(root) {
		let binary = which("vscode-css-language-server");
		const args: string[] = [];

		if (!binary) {
			binary = which("npx");
			if (!binary) return undefined;
			args.push("@vscode/vscode-languagedetection", "vscode-css-language-server", "--stdio");
		} else {
			args.push("--stdio");
		}

		return {
			process: spawn(binary, args, { cwd: root, env: { ...process.env } }),
		};
	},
});

registerServer({
	id: "json",
	extensions: [".json", ".jsonc"],
	root: async () => undefined,
	async spawn(root) {
		let binary = which("vscode-json-language-server");
		const args: string[] = [];

		if (!binary) {
			binary = which("npx");
			if (!binary) return undefined;
			args.push("vscode-json-language-server", "--stdio");
		} else {
			args.push("--stdio");
		}

		return {
			process: spawn(binary, args, { cwd: root, env: { ...process.env } }),
		};
	},
});

registerServer({
	id: "bash",
	extensions: [".sh", ".bash", ".zsh", ".ksh"],
	root: async () => undefined,
	async spawn(root) {
		let binary = which("bash-language-server");
		const args: string[] = [];

		if (!binary) {
			binary = which("npx");
			if (!binary) return undefined;
			args.push("bash-language-server", "start");
		} else {
			args.push("start");
		}

		return {
			process: spawn(binary, args, { cwd: root, env: { ...process.env } }),
		};
	},
});

registerServer({
	id: "dockerfile",
	extensions: [".dockerfile"],
	root: async () => undefined,
	async spawn(root) {
		let binary = which("docker-langserver");
		const args: string[] = [];

		if (!binary) {
			binary = which("npx");
			if (!binary) return undefined;
			args.push("dockerfile-language-server-nodejs", "--stdio");
		} else {
			args.push("--stdio");
		}

		return {
			process: spawn(binary, args, { cwd: root, env: { ...process.env } }),
		};
	},
});

registerServer({
	id: "lua",
	extensions: [".lua"],
	root: async (file) =>
		findNearestRoot(file, [
			".luarc.json",
			".luarc.jsonc",
			".luacheckrc",
			".stylua.toml",
		]),
	async spawn(root) {
		const bin = which("lua-language-server");
		if (!bin) return undefined;
		return { process: spawn(bin, [], { cwd: root }) };
	},
});

registerServer({
	id: "terraform",
	extensions: [".tf", ".tfvars"],
	root: async (file) =>
		findNearestRoot(file, [".terraform.lock.hcl", "terraform.tfstate"]),
	async spawn(root) {
		const bin = which("terraform-ls");
		if (!bin) return undefined;
		return {
			process: spawn(bin, ["serve"], { cwd: root }),
			initialization: {
				experimentalFeatures: { prefillRequiredFields: true, validateOnSave: true },
			},
		};
	},
});

registerServer({
	id: "swift",
	extensions: [".swift"],
	root: async (file) =>
		findNearestRoot(file, ["Package.swift"]),
	async spawn(root) {
		const sourcekit = which("sourcekit-lsp");
		if (sourcekit) {
			return { process: spawn(sourcekit, [], { cwd: root }) };
		}

		if (!which("xcrun")) return undefined;

		const result = await runCommand(["xcrun", "--find", "sourcekit-lsp"]);
		if (result.code !== 0 || !result.stdout.trim()) return undefined;

		return { process: spawn(result.stdout.trim(), [], { cwd: root }) };
	},
});

registerServer({
	id: "elixir",
	extensions: [".ex", ".exs"],
	root: async (file) => findNearestRoot(file, ["mix.exs", "mix.lock"]),
	async spawn(root) {
		const bin = which("elixir-ls");
		if (!bin) return undefined;
		return { process: spawn(bin, [], { cwd: root }) };
	},
});

registerServer({
	id: "clojure",
	extensions: [".clj", ".cljs", ".cljc", ".edn"],
	root: async (file) =>
		findNearestRoot(file, ["deps.edn", "project.clj", "shadow-cljs.edn"]),
	async spawn(root) {
		const bin = which("clojure-lsp");
		if (!bin && process.platform === "win32") {
			const winBin = which("clojure-lsp.exe");
			if (winBin) return { process: spawn(winBin, ["listen"], { cwd: root }) };
		}
		if (!bin) return undefined;
		return { process: spawn(bin, ["listen"], { cwd: root }) };
	},
});

registerServer({
	id: "dart",
	extensions: [".dart"],
	root: async (file) => findNearestRoot(file, ["pubspec.yaml"]),
	async spawn(root) {
		const dart = which("dart");
		if (!dart) return undefined;
		return { process: spawn(dart, ["language-server", "--lsp"], { cwd: root }) };
	},
});

registerServer({
	id: "ruby",
	extensions: [".rb", ".rake", ".gemspec"],
	root: async (file) => findNearestRoot(file, ["Gemfile"]),
	async spawn(root) {
		const rubocop = which("rubocop");
		if (!rubocop) {
			if (!(which("ruby") && which("gem"))) return undefined;
		}
		if (!rubocop) return undefined;
		return { process: spawn(rubocop, ["--lsp"], { cwd: root }) };
	},
});

registerServer({
	id: "php",
	extensions: [".php"],
	root: async (file) => findNearestRoot(file, ["composer.json"]),
	async spawn(root) {
		let binary = which("intelephense");
		const args: string[] = [];
		if (!binary) {
			binary = which("npx");
			if (!binary) return undefined;
			args.push("intelephense", "--stdio");
		} else {
			args.push("--stdio");
		}
		return {
			process: spawn(binary, args, {
				cwd: root,
				env: { ...process.env },
			}),
			initialization: { telemetry: { enabled: false } },
		};
	},
});

registerServer({
	id: "zig",
	extensions: [".zig", ".zon"],
	root: async (file) => findNearestRoot(file, ["build.zig"]),
	async spawn(root) {
		const bin = which("zls");
		if (!bin) return undefined;
		return { process: spawn(bin, [], { cwd: root }) };
	},
});

registerServer({
	id: "gleam",
	extensions: [".gleam"],
	root: async (file) => findNearestRoot(file, ["gleam.toml"]),
	async spawn(root) {
		const gleam = which("gleam");
		if (!gleam) return undefined;
		return { process: spawn(gleam, ["lsp"], { cwd: root }) };
	},
});

registerServer({
	id: "prisma",
	extensions: [".prisma"],
	root: async (file) =>
		findNearestRoot(file, ["schema.prisma", "prisma/schema.prisma"]),
	async spawn(root) {
		const prisma = which("prisma");
		if (!prisma) return undefined;
		return { process: spawn(prisma, ["language-server"], { cwd: root }) };
	},
});

registerServer({
	id: "nix",
	extensions: [".nix"],
	root: async (file) => {
		const flakeRoot = await findNearestRoot(file, ["flake.nix"]);
		if (flakeRoot) return flakeRoot;
		return undefined;
	},
	async spawn(root) {
		const nixd = which("nixd");
		if (!nixd) return undefined;
		return { process: spawn(nixd, [], { cwd: root, env: { ...process.env } }) };
	},
});

export function getServerIds(): string[] {
	return Object.keys(LspServers);
}

export function getServer(id: string): ServerInfo | undefined {
	return LspServers[id];
}

export function getServersForExtension(ext: string): ServerInfo[] {
	return Object.values(LspServers).filter((s) => s.extensions.includes(ext));
}
