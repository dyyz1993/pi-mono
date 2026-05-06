import { describe, expect, test } from "vitest";
import type { ResourceCollision, ResourceDiagnostic } from "../src/core/diagnostics.js";

describe("ResourceCollision type", () => {
	test("can construct a valid collision", () => {
		const collision: ResourceCollision = {
			resourceType: "skill",
			name: "my-skill",
			winnerPath: "/a/skill.js",
			loserPath: "/b/skill.js",
			winnerSource: "npm:pkg",
			loserSource: "local",
		};
		expect(collision.resourceType).toBe("skill");
		expect(collision.name).toBe("my-skill");
	});

	test("supports all resource types", () => {
		const types: ResourceCollision["resourceType"][] = ["extension", "skill", "prompt", "theme"];
		expect(types).toHaveLength(4);
	});

	test("source fields are optional", () => {
		const collision: ResourceCollision = {
			resourceType: "extension",
			name: "ext",
			winnerPath: "/a",
			loserPath: "/b",
		};
		expect(collision.winnerSource).toBeUndefined();
		expect(collision.loserSource).toBeUndefined();
	});
});

describe("ResourceDiagnostic type", () => {
	test("can construct a warning diagnostic", () => {
		const diag: ResourceDiagnostic = {
			type: "warning",
			message: "something is off",
		};
		expect(diag.type).toBe("warning");
		expect(diag.path).toBeUndefined();
		expect(diag.collision).toBeUndefined();
	});

	test("can construct an error diagnostic with path", () => {
		const diag: ResourceDiagnostic = {
			type: "error",
			message: "failed to load",
			path: "/tmp/foo.js",
		};
		expect(diag.type).toBe("error");
		expect(diag.path).toBe("/tmp/foo.js");
	});

	test("can construct a collision diagnostic", () => {
		const diag: ResourceDiagnostic = {
			type: "collision",
			message: "duplicate skill",
			path: "/tmp/skill.js",
			collision: {
				resourceType: "skill",
				name: "sk",
				winnerPath: "/a",
				loserPath: "/b",
			},
		};
		expect(diag.type).toBe("collision");
		expect(diag.collision?.resourceType).toBe("skill");
	});

	test("supports all diagnostic types", () => {
		const types: ResourceDiagnostic["type"][] = ["warning", "error", "collision"];
		expect(types).toHaveLength(3);
	});
});
