import { describe, expect, it } from "vitest";
import type { PathMetadata } from "../src/core/package-manager.js";
import {
	createSourceInfo,
	createSyntheticSourceInfo,
	type SourceInfo,
	type SourceOrigin,
	type SourceScope,
} from "../src/core/source-info.js";

describe("createSourceInfo", () => {
	it("should create SourceInfo from path and metadata", () => {
		const metadata: PathMetadata = {
			source: "my-extension",
			scope: "project",
			origin: "package",
		};
		const info = createSourceInfo("/path/to/ext", metadata);

		expect(info.path).toBe("/path/to/ext");
		expect(info.source).toBe("my-extension");
		expect(info.scope).toBe("project");
		expect(info.origin).toBe("package");
		expect(info.baseDir).toBeUndefined();
	});

	it("should include baseDir when present in metadata", () => {
		const metadata: PathMetadata = {
			source: "pkg",
			scope: "user",
			origin: "top-level",
			baseDir: "/base",
		};
		const info = createSourceInfo("/path", metadata);

		expect(info.baseDir).toBe("/base");
	});

	it("should preserve user scope", () => {
		const info = createSourceInfo("/x", {
			source: "s",
			scope: "user",
			origin: "top-level",
		});
		expect(info.scope).toBe("user");
	});

	it("should preserve temporary scope", () => {
		const info = createSourceInfo("/x", {
			source: "s",
			scope: "temporary",
			origin: "top-level",
		});
		expect(info.scope).toBe("temporary");
	});

	it("should preserve package origin", () => {
		const info = createSourceInfo("/x", {
			source: "s",
			scope: "project",
			origin: "package",
		});
		expect(info.origin).toBe("package");
	});
});

describe("createSyntheticSourceInfo", () => {
	it("should create SourceInfo with defaults", () => {
		const info = createSyntheticSourceInfo("/some/path", { source: "synth" });

		expect(info.path).toBe("/some/path");
		expect(info.source).toBe("synth");
		expect(info.scope).toBe("temporary");
		expect(info.origin).toBe("top-level");
		expect(info.baseDir).toBeUndefined();
	});

	it("should allow overriding scope", () => {
		const info = createSyntheticSourceInfo("/p", {
			source: "test",
			scope: "user",
		});
		expect(info.scope).toBe("user");
	});

	it("should allow overriding origin", () => {
		const info = createSyntheticSourceInfo("/p", {
			source: "test",
			origin: "package",
		});
		expect(info.origin).toBe("package");
	});

	it("should allow setting baseDir", () => {
		const info = createSyntheticSourceInfo("/p", {
			source: "test",
			baseDir: "/base",
		});
		expect(info.baseDir).toBe("/base");
	});

	it("should allow setting all options", () => {
		const info = createSyntheticSourceInfo("/full", {
			source: "full-source",
			scope: "project",
			origin: "package",
			baseDir: "/base/dir",
		});

		expect(info).toEqual({
			path: "/full",
			source: "full-source",
			scope: "project",
			origin: "package",
			baseDir: "/base/dir",
		});
	});
});

describe("SourceInfo types", () => {
	it("should accept all valid scope values", () => {
		const scopes: SourceScope[] = ["user", "project", "temporary"];
		expect(scopes).toHaveLength(3);
	});

	it("should accept all valid origin values", () => {
		const origins: SourceOrigin[] = ["package", "top-level"];
		expect(origins).toHaveLength(2);
	});
});
