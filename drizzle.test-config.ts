import type { Config } from 'drizzle-kit';
const dbType = process.env['DB_TYPE'];

let config;
switch (dbType) {
	case 'pg':
		config = {
			dialect: 'postgresql',
			schema: './tests/schema/pg.ts',
			out: './tests/migrations/pg/',
		} satisfies Config;
		break;
	case 'mysql':
		config = {
			dialect: 'mysql',
			schema: './tests/schema/mysql.ts',
			out: './tests/migrations/mysql/',
		} satisfies Config;
		break;
	case 'sqlite':
		config = {
			dialect: 'sqlite',
			schema: './tests/schema/sqlite.ts',
			out: './tests/migrations/sqlite/',
		} satisfies Config;
		break;
}

export default config;
