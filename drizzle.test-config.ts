import type { Config } from 'drizzle-kit';
const dbType = process.env['DB_TYPE'];

let config;
switch (dbType) {
	case 'pg':
		config = {
			driver: 'pg',
			schema: './tests/schema/pg.ts',
			out: './tests/migrations/pg/',
		} satisfies Config;
		break;
	case 'mysql':
		config = {
			driver: 'mysql2',
			schema: './tests/schema/mysql.ts',
			out: './tests/migrations/mysql/',
		} satisfies Config;
		break;
	case 'sqlite':
		config = {
			driver: 'libsql',
			schema: './tests/schema/sqlite.ts',
			out: './tests/migrations/sqlite/',
		} satisfies Config;
		break;
}

export default config;
