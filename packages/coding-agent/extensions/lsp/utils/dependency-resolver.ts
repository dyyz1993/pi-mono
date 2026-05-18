import { readFile, readdir } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";

const SUPPORTED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", "coverage", "__pycache__"]);

const IMPORT_PATTERNS = [
	/import\s+(?:type\s+)?(?:[\w$*,\s{}]+)\s+from\s+['"]([^'"]+)['"]/g,
	/require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
];

export interface DependencyResolverOptions {
	cwd?: string;
	maxFilesToScan?: number;
	maxDependents?: number;
}

export interface DependencyResolver {
	resolveDependents(touchedFiles: string[]): Promise<string[]>;
}

export function createDependencyResolver(options: DependencyResolverOptions = {}): DependencyResolver {
	const cwd = options.cwd ?? process.cwd();
	const maxFilesToScan = options.maxFilesToScan ?? 300;
	const maxDependents = options.maxDependents ?? 20;

	return {
		async resolveDependents(touchedFiles: string[]): Promise<string[]> {
			if (touchedFiles.length === 0) return [];

			const specifiers = buildModuleSpecifiers(touchedFiles, cwd);
			if (specifiers.size === 0) return [];

			const projectFiles = await collectProjectFiles(cwd, maxFilesToScan);
			if (projectFiles.length === 0) return [];

			const dependents = new Set<string>();

			for (const projectFile of projectFiles) {
				if (dependents.size >= maxDependents) break;

				const normalized = projectFile.replace(/\\/g, "/");
				if (touchedFiles.some((tf) => tf.replace(/\\/g, "/") === normalized)) continue;

				try {
					const content = await readFile(resolve(cwd, projectFile), "utf8");
					const imports = extractImports(content);

					for (const imp of imports) {
						if (specifiers.has(imp)) {
							dependents.add(normalized);
							break;
						}
					}
				} catch {
					continue;
				}
			}

			return [...dependents];
		},
	};
}

function buildModuleSpecifiers(touchedFiles: string[], cwd: string): Set<string> {
	const specifiers = new Set<string>();

	for (const filePath of touchedFiles) {
		const absPath = resolve(cwd, filePath);
		const dir = dirname(absPath);
		const nameWithoutExt = basename(absPath, extname(absPath));
		const indexName = nameWithoutExt === "index" ? "" : undefined;

		const relDir = relative(cwd, dir).replace(/\\/g, "/");

		if (relDir === "" || relDir === ".") {
			specifiers.add(`./${nameWithoutExt}`);
			if (indexName !== undefined) specifiers.add("./");
		} else {
			specifiers.add(`./${relDir}/${nameWithoutExt}`);
			specifiers.add(`../${relDir}/${nameWithoutExt}`);
			specifiers.add(relDir + "/" + nameWithoutExt);
			if (indexName !== undefined) {
				specifiers.add(`./${relDir}/`);
				specifiers.add(`../${relDir}/`);
				specifiers.add(relDir + "/");
			}
		}

		if (nameWithoutExt === "index") {
			const parentDir = basename(dir);
			specifiers.add(`./${parentDir}`);
			specifiers.add(parentDir);
		}
	}

	return specifiers;
}

async function collectProjectFiles(cwd: string, maxFiles: number): Promise<string[]> {
	const files: string[] = [];

	async function walk(dir: string, depth: number): Promise<void> {
		if (files.length >= maxFiles || depth > 10) return;

		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (files.length >= maxFiles) return;

			if (entry.isDirectory()) {
				if (SKIP_DIRS.has(entry.name)) continue;
				await walk(join(dir, entry.name), depth + 1);
			} else if (entry.isFile()) {
				const ext = extname(entry.name).toLowerCase();
				if (SUPPORTED_EXTENSIONS.has(ext)) {
					files.push(relative(cwd, join(dir, entry.name)).replace(/\\/g, "/"));
				}
			}
		}
	}

	await walk(cwd, 0);
	return files;
}

function extractImports(content: string): string[] {
	const imports: string[] = [];

	for (const pattern of IMPORT_PATTERNS) {
		const regex = new RegExp(pattern.source, "g");
		let match: RegExpExecArray | null;
		while ((match = regex.exec(content)) !== null) {
			const specifier = match[1];
			if (specifier && (specifier.startsWith(".") || specifier.startsWith("/"))) {
				imports.push(specifier);
			}
		}
	}

	return imports;
}
