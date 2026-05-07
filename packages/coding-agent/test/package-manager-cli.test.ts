import { describe, expect, it } from "vitest";
import { getPackageCommandUsage, type PackageCommandOptions, parsePackageCommand } from "../src/package-manager-cli.js";

describe("parsePackageCommand", () => {
	it("parses install command with source", () => {
		const result = parsePackageCommand(["install", "npm:@foo/bar"]);
		expect(result).toEqual<PackageCommandOptions>({
			command: "install",
			source: "npm:@foo/bar",
			local: false,
			help: false,
			invalidOption: undefined,
		});
	});

	it("aliases uninstall to remove", () => {
		const result = parsePackageCommand(["uninstall", "npm:@foo/bar"]);
		expect(result?.command).toBe("remove");
		expect(result?.source).toBe("npm:@foo/bar");
	});

	it("parses --local flag for install", () => {
		const result = parsePackageCommand(["install", "npm:@foo/bar", "--local"]);
		expect(result?.local).toBe(true);
		expect(result?.source).toBe("npm:@foo/bar");
	});

	it("parses -l flag for remove", () => {
		const result = parsePackageCommand(["remove", "npm:@foo/bar", "-l"]);
		expect(result?.local).toBe(true);
	});

	it("rejects --local for update command", () => {
		const result = parsePackageCommand(["update", "--local"]);
		expect(result?.local).toBe(false);
		expect(result?.invalidOption).toBe("--local");
	});

	it("rejects --local for list command", () => {
		const result = parsePackageCommand(["list", "-l"]);
		expect(result?.local).toBe(false);
		expect(result?.invalidOption).toBe("-l");
	});

	it("parses --help flag", () => {
		const result = parsePackageCommand(["install", "--help"]);
		expect(result?.help).toBe(true);
	});

	it("parses -h flag", () => {
		const result = parsePackageCommand(["remove", "-h"]);
		expect(result?.help).toBe(true);
	});

	it("returns undefined for unknown command", () => {
		const result = parsePackageCommand(["foobar"]);
		expect(result).toBeUndefined();
	});

	it("returns undefined for empty args", () => {
		const result = parsePackageCommand([]);
		expect(result).toBeUndefined();
	});

	it("captures unknown options", () => {
		const result = parsePackageCommand(["install", "npm:@foo/bar", "--unknown"]);
		expect(result?.invalidOption).toBe("--unknown");
	});

	it("captures only first unknown option", () => {
		const result = parsePackageCommand(["install", "--a", "--b"]);
		expect(result?.invalidOption).toBe("--a");
	});

	it("parses update command with source", () => {
		const result = parsePackageCommand(["update", "npm:@foo/bar"]);
		expect(result?.command).toBe("update");
		expect(result?.source).toBe("npm:@foo/bar");
	});

	it("parses update command without source", () => {
		const result = parsePackageCommand(["update"]);
		expect(result?.command).toBe("update");
		expect(result?.source).toBeUndefined();
	});

	it("parses list command", () => {
		const result = parsePackageCommand(["list"]);
		expect(result?.command).toBe("list");
		expect(result?.source).toBeUndefined();
	});

	it("captures first positional argument as source", () => {
		const result = parsePackageCommand(["install", "npm:@foo/bar"]);
		expect(result?.source).toBe("npm:@foo/bar");
	});

	it("ignores extra positional arguments", () => {
		const result = parsePackageCommand(["install", "first", "second"]);
		expect(result?.source).toBe("first");
	});
});

describe("getPackageCommandUsage", () => {
	it("returns install usage", () => {
		expect(getPackageCommandUsage("install")).toContain("install <source>");
	});

	it("returns remove usage", () => {
		expect(getPackageCommandUsage("remove")).toContain("remove <source>");
	});

	it("returns update usage", () => {
		expect(getPackageCommandUsage("update")).toContain("update [source]");
	});

	it("returns list usage", () => {
		expect(getPackageCommandUsage("list")).toContain("list");
	});
});
