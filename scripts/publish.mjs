#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const packages = [
	{ directory: "packages/ai", name: "@dyyz1993/pi-ai" },
	{ directory: "packages/agent", name: "@dyyz1993/pi-agent-core" },
	{ directory: "packages/tui", name: "@dyyz1993/pi-tui" },
	{ directory: "packages/coding-agent", name: "@dyyz1993/pi-coding-agent" },
];

const dryRun = process.argv.includes("--dry-run");
const selectedPackages = [];
const unknownArgs = [];
for (let i = 2; i < process.argv.length; i += 1) {
	const arg = process.argv[i];
	if (arg === "--dry-run") continue;
	if (arg === "--package") {
		const packageName = process.argv[i + 1];
		if (!packageName) {
			unknownArgs.push(arg);
			continue;
		}
		selectedPackages.push(packageName);
		i += 1;
		continue;
	}
	unknownArgs.push(arg);
}

if (unknownArgs.length > 0) {
	console.error(`Usage: node scripts/publish.mjs [--dry-run] [--package <name>]`);
	process.exit(1);
}

const packagesToPublish =
	selectedPackages.length === 0 ? packages : packages.filter((pkg) => selectedPackages.includes(pkg.name));
const missingPackages = selectedPackages.filter((name) => !packages.some((pkg) => pkg.name === name));
if (missingPackages.length > 0) {
	console.error(`Unknown package(s): ${missingPackages.join(", ")}`);
	process.exit(1);
}

function commandForPlatform(command) {
	return process.platform === "win32" ? `${command}.cmd` : command;
}

function run(command, args, options = {}) {
	console.log(`$ ${[command, ...args].join(" ")}`);
	const result = spawnSync(commandForPlatform(command), args, {
		cwd: options.cwd,
		encoding: "utf8",
		stdio: options.capture ? ["inherit", "pipe", "pipe"] : "inherit",
	});

	if (result.status !== 0) {
		const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
		throw new Error(output ? `Command failed: ${command} ${args.join(" ")}\n${output}` : `Command failed: ${command} ${args.join(" ")}`);
	}

	return result;
}

function readPackageJson(directory) {
	return JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
}

function assertBuildOutputExists(directory) {
	if (!existsSync(join(directory, "dist"))) {
		throw new Error(`${directory}/dist does not exist. Run npm run build before publishing.`);
	}
}

function validatePack(directory) {
	const result = run("npm", ["pack", "--dry-run", "--ignore-scripts", "--json"], { capture: true, cwd: directory });
	const packed = JSON.parse(result.stdout)[0];
	console.log(`  ${packed.filename}: ${packed.files.length} files, ${packed.size} bytes packed, ${packed.unpackedSize} bytes unpacked`);
}

function isPublished(name, version) {
	const result = spawnSync(commandForPlatform("npm"), ["view", `${name}@${version}`, "version", "--json"], {
		encoding: "utf8",
		stdio: ["inherit", "pipe", "pipe"],
	});

	if (result.status === 0 && result.stdout.trim()) {
		return true;
	}

	const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
	if (result.status !== 0 && (output.includes("E404") || output.includes("404 Not Found"))) {
		return false;
	}

	throw new Error(output ? `Failed to query ${name}@${version}\n${output}` : `Failed to query ${name}@${version}`);
}

const packageVersions = new Map();
for (const pkg of packages) {
	const packageJson = readPackageJson(pkg.directory);
	if (packageJson.name !== pkg.name) {
		throw new Error(`${pkg.directory}/package.json has name ${packageJson.name}, expected ${pkg.name}`);
	}
	packageVersions.set(pkg.name, packageJson.version);
}

const publishVersions = [...new Set(packagesToPublish.map((pkg) => packageVersions.get(pkg.name)))];
if (selectedPackages.length === 0 && publishVersions.length !== 1) {
	throw new Error(`Publish packages are not lockstep versioned: ${publishVersions.join(", ")}`);
}

const versionLabel =
	publishVersions.length === 1 ? publishVersions[0] : packagesToPublish.map((pkg) => `${pkg.name}@${packageVersions.get(pkg.name)}`).join(", ");
console.log(`Publishing pi packages at ${versionLabel}${dryRun ? " (dry run)" : ""}\n`);

for (const pkg of packagesToPublish) {
	const version = packageVersions.get(pkg.name);
	assertBuildOutputExists(pkg.directory);
	const published = isPublished(pkg.name, version);

	if (dryRun) {
		if (published) {
			console.log(`${pkg.name}@${version} is already published; validating package contents only.`);
		} else {
			console.log(`${pkg.name}@${version} is not published; validating package contents before publish.`);
		}
		validatePack(pkg.directory);
		console.log();
		continue;
	}

	if (published) {
		console.log(`Skipping ${pkg.name}@${version}: already published\n`);
		continue;
	}

	run("npm", ["publish", "--access", "public", "--provenance", "--ignore-scripts"], { cwd: pkg.directory });
	console.log();
}
