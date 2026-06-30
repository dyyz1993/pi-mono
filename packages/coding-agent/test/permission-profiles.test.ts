import { describe, expect, it } from "vitest";
import {
	getPermissionProfile,
	isPermissionProfileInput,
	listPermissionProfiles,
	normalizePermissionProfile,
	registerPermissionProfile,
} from "../src/core/permissions/index.ts";

describe("permission profiles", () => {
	it("normalizes legacy permission profile names", () => {
		expect(normalizePermissionProfile("normal")).toBe("normal");
		expect(normalizePermissionProfile("auto")).toBe("normal");
		expect(normalizePermissionProfile("acceptEdits")).toBe("normal");
		expect(normalizePermissionProfile("always-deny")).toBe("normal");
		expect(normalizePermissionProfile("yolo")).toBe("yolo");
		expect(normalizePermissionProfile("dontAsk")).toBe("yolo");
		expect(normalizePermissionProfile("always-allow")).toBe("yolo");
	});

	it("recognizes supported profile inputs", () => {
		expect(isPermissionProfileInput("normal")).toBe(true);
		expect(isPermissionProfileInput("always-allow")).toBe(true);
		expect(isPermissionProfileInput("readonly")).toBe(true);
	});

	it("allows extensions to register custom permission profiles", () => {
		registerPermissionProfile({
			name: "company-safe",
			label: "Company Safe",
			source: "plugin:company-policy",
			preProviders: ["tool-gate", "stored-decision"],
			postProviders: ["path-access", "dangerous-command"],
			skipPathBoundaryApproval: false,
		});

		expect(isPermissionProfileInput("company-safe")).toBe(true);
		expect(normalizePermissionProfile("company-safe")).toBe("company-safe");
		expect(getPermissionProfile("company-safe")).toMatchObject({
			name: "company-safe",
			source: "plugin:company-policy",
		});
		expect(listPermissionProfiles().some((profile) => profile.name === "company-safe")).toBe(true);
	});

	it("defines explicit staged provider order for normal", () => {
		expect(getPermissionProfile("normal")).toMatchObject({
			name: "normal",
			preProviders: ["tool-gate", "stored-decision", "pi-hooks"],
			postProviders: ["path-access", "dangerous-command"],
			skipPathBoundaryApproval: false,
		});
	});

	it("defines yolo as an auto-approval profile without dangerous-command", () => {
		expect(getPermissionProfile("yolo")).toMatchObject({
			name: "yolo",
			preProviders: ["tool-gate", "stored-decision", "pi-hooks"],
			postProviders: ["path-access"],
			skipPathBoundaryApproval: true,
		});
	});

	it("defines readonly as a core profile with readonly enforcement", () => {
		expect(getPermissionProfile("readonly")).toMatchObject({
			name: "readonly",
			preProviders: ["tool-gate", "readonly", "stored-decision", "pi-hooks"],
			postProviders: ["path-access", "dangerous-command"],
			skipPathBoundaryApproval: false,
		});
	});

	it("defines autopilot as a core profile with auto approval before risky post checks", () => {
		expect(getPermissionProfile("autopilot")).toMatchObject({
			name: "autopilot",
			preProviders: ["tool-gate", "stored-decision", "auto-approver", "pi-hooks"],
			postProviders: ["path-access", "dangerous-command"],
			skipPathBoundaryApproval: true,
		});
	});
});
