declare module "better-sqlite3" {
	interface Database {
		prepare(sql: string): Statement;
		exec(sql: string): void;
		pragma(sql: string): void;
		close(): void;
		transaction<T extends (...args: any[]) => any>(fn: T): T;
	}

	interface Statement {
		run(...params: any[]): any;
		get(...params: any[]): any;
		all(...params: any[]): any[];
	}

	interface Options {
		readonly?: boolean;
		fileMustExist?: boolean;
		timeout?: number;
		verbose?: (message: string) => void;
	}

	const Database: {
		new (filename: string, options?: Options): Database;
	};

	export = Database;
}
