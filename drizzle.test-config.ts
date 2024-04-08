import type { Config } from 'drizzle-kit'
const dbType = process.env['DB_TYPE']

let config
switch (dbType) {
	case 'pg':
		config = {
			driver: 'pg',
			schema: './Tests/Schema/pg.ts',
			out: './Tests/Migrations/pg/'
		} satisfies Config
		break
	case 'mysql':
		config = {
			driver: 'mysql2',
			schema: './Tests/Schema/mysql.ts',
			out: './Tests/Migrations/mysql/'
		} satisfies Config
		break
	case 'sqlite':
		config = {
			driver: 'libsql',
			schema: './Tests/Schema/sqlite.ts',
			out: './Tests/Migrations/sqlite/'
		} satisfies Config
		break
}

export default config
