import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["**/node_modules/**", "**/dist/**"],
	},
	js.configs.recommended,
	...tseslint.configs.recommended,
	{
		files: ["extensions/**/*.ts"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: ["../../src/**", "../../../src/**", "../../../../src/**", "../src/**"],
							message:
								"Extensions must import from package names (e.g. '@dyyz1993/pi-coding-agent') instead of relative paths to src/. Relative imports will break when extensions are loaded independently.",
						},
					],
				},
			],
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unused-vars": "off",
			"no-empty": "off",
			"no-useless-assignment": "off",
		},
	},
);
