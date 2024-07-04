import {
	buildSchema,
	type DeleteResolver,
	type ExtractTables,
	type GeneratedEntities,
	type InsertArrResolver,
	type InsertResolver,
	type SelectResolver,
	type SelectSingleResolver,
	type UpdateResolver,
} from '@/index';
import Docker from 'dockerode';
import { eq, inArray, type Relations, sql } from 'drizzle-orm';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import getPort from 'get-port';
import {
	GraphQLInputObjectType,
	GraphQLList,
	GraphQLNonNull,
	GraphQLObjectType,
	GraphQLScalarType,
	GraphQLSchema,
} from 'graphql';
import { createYoga } from 'graphql-yoga';
import { createServer, type Server } from 'http';
import * as mysql from 'mysql2/promise';
import { v4 as uuid } from 'uuid';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import z from 'zod';
import * as schema from './schema/mysql';
import { GraphQLClient } from './util/query';

interface Context {
	docker: Docker;
	mysqlContainer: Docker.Container;
	db: MySql2Database<typeof schema>;
	client: mysql.Connection;
	schema: GraphQLSchema;
	entities: GeneratedEntities<MySql2Database<typeof schema>>;
	server: Server;
	gql: GraphQLClient;
}

const ctx: Context = {} as any;

async function createDockerDB(): Promise<string> {
	const docker = (ctx.docker = new Docker());
	const port = await getPort({ port: 3306 });
	const image = 'mysql:8';

	const pullStream = await docker.pull(image);
	await new Promise((resolve, reject) =>
		docker.modem.followProgress(pullStream, (err) => (err ? reject(err) : resolve(err)))
	);

	ctx.mysqlContainer = await docker.createContainer({
		Image: image,
		Env: ['MYSQL_ROOT_PASSWORD=mysql', 'MYSQL_DATABASE=drizzle'],
		name: `drizzle-graphql-mysql-tests-${uuid()}`,
		HostConfig: {
			AutoRemove: true,
			PortBindings: {
				'3306/tcp': [{ HostPort: `${port}` }],
			},
		},
	});

	await ctx.mysqlContainer.start();

	return `mysql://root:mysql@127.0.0.1:${port}/drizzle`;
}

beforeAll(async (t) => {
	const connectionString = await createDockerDB();

	const sleep = 1000;
	let timeLeft = 20000;
	let connected = false;
	let lastError: unknown | undefined;
	do {
		try {
			ctx.client = await mysql.createConnection(connectionString);
			await ctx.client.connect();
			connected = true;
			break;
		} catch (e) {
			lastError = e;
			await new Promise((resolve) => setTimeout(resolve, sleep));
			timeLeft -= sleep;
		}
	} while (timeLeft > 0);
	if (!connected) {
		console.error('Cannot connect to MySQL');
		await ctx.client?.end().catch(console.error);
		await ctx.mysqlContainer?.stop().catch(console.error);
		throw lastError;
	}

	ctx.db = drizzle(ctx.client, {
		schema,
		logger: process.env['LOG_SQL'] ? true : false,
		mode: 'default',
	});

	const { schema: gqlSchema, entities } = buildSchema(ctx.db);
	const yoga = createYoga({
		schema: gqlSchema,
	});
	const server = createServer(yoga);

	const port = 4001;
	server.listen(port);
	const gql = new GraphQLClient(`http://localhost:${port}/graphql`);

	ctx.schema = gqlSchema;
	ctx.entities = entities;
	ctx.server = server;
	ctx.gql = gql;
});

afterAll(async (t) => {
	await ctx.client?.end().catch(console.error);
	await ctx.mysqlContainer?.stop().catch(console.error);
});

beforeEach(async (t) => {
	await ctx.db.execute(sql`CREATE TABLE IF NOT EXISTS \`customers\` (
		\`id\` int AUTO_INCREMENT NOT NULL,
		\`address\` text NOT NULL,
		\`is_confirmed\` boolean,
		\`registration_date\` timestamp NOT NULL DEFAULT (now()),
		\`user_id\` int NOT NULL,
		CONSTRAINT \`customers_id\` PRIMARY KEY(\`id\`)
	);`);

	await ctx.db.execute(sql`CREATE TABLE IF NOT EXISTS \`posts\` (
		\`id\` int AUTO_INCREMENT NOT NULL,
		\`content\` text,
		\`author_id\` int,
		CONSTRAINT \`posts_id\` PRIMARY KEY(\`id\`)
	);`);

	await ctx.db.execute(sql`CREATE TABLE \`users\` (
		\`id\` int AUTO_INCREMENT NOT NULL,
		\`name\` text NOT NULL,
		\`email\` text,
		\`big_int\` bigint unsigned,
		\`birthday_string\` date,
		\`birthday_date\` date,
		\`created_at\` timestamp NOT NULL DEFAULT (now()),
		\`role\` enum('admin','user'),
		\`role1\` text,
		\`role2\` text DEFAULT ('user'),
		\`profession\` varchar(20),
		\`initials\` char(2),
		\`is_confirmed\` boolean,
		CONSTRAINT \`users_id\` PRIMARY KEY(\`id\`)
	);`);

	await ctx.db.execute(
		sql`ALTER TABLE \`customers\` ADD CONSTRAINT \`customers_user_id_users_id_fk\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON DELETE no action ON UPDATE no action;`,
	);

	await ctx.db.insert(schema.Users).values([
		{
			id: 1,
			name: 'FirstUser',
			email: 'userOne@notmail.com',
			bigint: BigInt(10),
			birthdayString: '2024-04-02',
			birthdayDate: new Date('2024-04-02T06:44:41.785Z'),
			createdAt: new Date('2024-04-02T06:44:41.785Z'),
			role: 'admin',
			roleText: null,
			profession: 'FirstUserProf',
			initials: 'FU',
			isConfirmed: true,
		},
		{
			id: 2,
			name: 'SecondUser',
			createdAt: new Date('2024-04-02T06:44:41.785Z'),
		},
		{
			id: 5,
			name: 'FifthUser',
			createdAt: new Date('2024-04-02T06:44:41.785Z'),
		},
	]);

	await ctx.db.insert(schema.Posts).values([
		{
			id: 1,
			authorId: 1,
			content: '1MESSAGE',
		},
		{
			id: 2,
			authorId: 1,
			content: '2MESSAGE',
		},
		{
			id: 3,
			authorId: 1,
			content: '3MESSAGE',
		},
		{
			id: 4,
			authorId: 5,
			content: '1MESSAGE',
		},
		{
			id: 5,
			authorId: 5,
			content: '2MESSAGE',
		},
		{
			id: 6,
			authorId: 1,
			content: '4MESSAGE',
		},
	]);

	await ctx.db.insert(schema.Customers).values([
		{
			id: 1,
			address: 'AdOne',
			isConfirmed: false,
			registrationDate: new Date('2024-03-27T03:54:45.235Z'),
			userId: 1,
		},
		{
			id: 2,
			address: 'AdTwo',
			isConfirmed: false,
			registrationDate: new Date('2024-03-27T03:55:42.358Z'),
			userId: 2,
		},
	]);
});

afterEach(async (t) => {
	await ctx.db.execute(sql`SET FOREIGN_KEY_CHECKS = 0;`);
	await ctx.db.execute(sql`DROP TABLE IF EXISTS \`customers\` CASCADE;`);
	await ctx.db.execute(sql`DROP TABLE IF EXISTS \`posts\` CASCADE;`);
	await ctx.db.execute(sql`DROP TABLE IF EXISTS \`users\` CASCADE;`);
	await ctx.db.execute(sql`SET FOREIGN_KEY_CHECKS = 1;`);
});

describe.sequential('Query tests', async () => {
	it(`Select single`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				usersSingle {
					id
					name
					email
					bigint
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
				}

				postsSingle {
					id
					authorId
					content
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				usersSingle: {
					id: 1,
					name: 'FirstUser',
					email: 'userOne@notmail.com',
					bigint: '10',
					birthdayString: '2024-04-02',
					birthdayDate: '2024-04-02T00:00:00.000Z',
					createdAt: '2024-04-02T06:44:42.000Z',
					role: 'admin',
					roleText: null,
					roleText2: 'user',
					profession: 'FirstUserProf',
					initials: 'FU',
					isConfirmed: true,
				},
				postsSingle: {
					id: 1,
					authorId: 1,
					content: '1MESSAGE',
				},
			},
		});
	});

	it(`Select array`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				users {
					id
					name
					email
					bigint
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
				}

				posts {
					id
					authorId
					content
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				users: [
					{
						id: 1,
						name: 'FirstUser',
						email: 'userOne@notmail.com',
						bigint: '10',
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:42.000Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'FirstUserProf',
						initials: 'FU',
						isConfirmed: true,
					},
					{
						id: 2,
						name: 'SecondUser',
						email: null,
						bigint: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:42.000Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
					},
					{
						id: 5,
						name: 'FifthUser',
						email: null,
						bigint: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:42.000Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
					},
				],
				posts: [
					{
						id: 1,
						authorId: 1,
						content: '1MESSAGE',
					},
					{
						id: 2,
						authorId: 1,
						content: '2MESSAGE',
					},
					{
						id: 3,
						authorId: 1,
						content: '3MESSAGE',
					},
					{
						id: 4,
						authorId: 5,
						content: '1MESSAGE',
					},
					{
						id: 5,
						authorId: 5,
						content: '2MESSAGE',
					},
					{
						id: 6,
						authorId: 1,
						content: '4MESSAGE',
					},
				],
			},
		});
	});

	it(`Select single with relations`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				usersSingle {
					id
					name
					email
					bigint
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					posts {
						id
						authorId
						content
					}
				}

				postsSingle {
					id
					authorId
					content
					author {
						id
						name
						email
						bigint
						birthdayString
						birthdayDate
						createdAt
						role
						roleText
						roleText2
						profession
						initials
						isConfirmed
					}
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				usersSingle: {
					id: 1,
					name: 'FirstUser',
					email: 'userOne@notmail.com',
					bigint: '10',
					birthdayString: '2024-04-02',
					birthdayDate: '2024-04-02T00:00:00.000Z',
					createdAt: '2024-04-02T06:44:42.000Z',
					role: 'admin',
					roleText: null,
					roleText2: 'user',
					profession: 'FirstUserProf',
					initials: 'FU',
					isConfirmed: true,
					posts: [
						{
							id: 1,
							authorId: 1,
							content: '1MESSAGE',
						},
						{
							id: 2,
							authorId: 1,
							content: '2MESSAGE',
						},
						{
							id: 3,
							authorId: 1,
							content: '3MESSAGE',
						},

						{
							id: 6,
							authorId: 1,
							content: '4MESSAGE',
						},
					],
				},
				postsSingle: {
					id: 1,
					authorId: 1,
					content: '1MESSAGE',
					author: {
						id: 1,
						name: 'FirstUser',
						email: 'userOne@notmail.com',
						bigint: '10',
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:42.000Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'FirstUserProf',
						initials: 'FU',
						isConfirmed: true,
					},
				},
			},
		});
	});

	it(`Select array with relations`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				users {
					id
					name
					email
					bigint
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					posts {
						id
						authorId
						content
					}
				}

				posts {
					id
					authorId
					content
					author {
						id
						name
						email
						bigint
						birthdayString
						birthdayDate
						createdAt
						role
						roleText
						roleText2
						profession
						initials
						isConfirmed
					}
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				users: [
					{
						id: 1,
						name: 'FirstUser',
						email: 'userOne@notmail.com',
						bigint: '10',
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:42.000Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'FirstUserProf',
						initials: 'FU',
						isConfirmed: true,
						posts: [
							{
								id: 1,
								authorId: 1,
								content: '1MESSAGE',
							},
							{
								id: 2,
								authorId: 1,
								content: '2MESSAGE',
							},
							{
								id: 3,
								authorId: 1,
								content: '3MESSAGE',
							},
							{
								id: 6,
								authorId: 1,
								content: '4MESSAGE',
							},
						],
					},
					{
						id: 2,
						name: 'SecondUser',
						email: null,
						bigint: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:42.000Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						posts: [],
					},
					{
						id: 5,
						name: 'FifthUser',
						email: null,
						bigint: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:42.000Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						posts: [
							{
								id: 4,
								authorId: 5,
								content: '1MESSAGE',
							},
							{
								id: 5,
								authorId: 5,
								content: '2MESSAGE',
							},
						],
					},
				],
				posts: [
					{
						id: 1,
						authorId: 1,
						content: '1MESSAGE',
						author: {
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							bigint: '10',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:42.000Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
						},
					},
					{
						id: 2,
						authorId: 1,
						content: '2MESSAGE',
						author: {
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							bigint: '10',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:42.000Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
						},
					},
					{
						id: 3,
						authorId: 1,
						content: '3MESSAGE',
						author: {
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							bigint: '10',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:42.000Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
						},
					},
					{
						id: 4,
						authorId: 5,
						content: '1MESSAGE',
						author: {
							id: 5,
							name: 'FifthUser',
							email: null,
							bigint: null,
							birthdayString: null,
							birthdayDate: null,
							createdAt: '2024-04-02T06:44:42.000Z',
							role: null,
							roleText: null,
							roleText2: 'user',
							profession: null,
							initials: null,
							isConfirmed: null,
						},
					},
					{
						id: 5,
						authorId: 5,
						content: '2MESSAGE',
						author: {
							id: 5,
							name: 'FifthUser',
							email: null,
							bigint: null,
							birthdayString: null,
							birthdayDate: null,
							createdAt: '2024-04-02T06:44:42.000Z',
							role: null,
							roleText: null,
							roleText2: 'user',
							profession: null,
							initials: null,
							isConfirmed: null,
						},
					},
					{
						id: 6,
						authorId: 1,
						content: '4MESSAGE',
						author: {
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							bigint: '10',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:42.000Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
						},
					},
				],
			},
		});
	});

	it(`Insert single`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				insertIntoUsersSingle(
					values: {
						id: 3
						name: "ThirdUser"
						email: "userThree@notmail.com"
						bigint: "15"
						birthdayString: "2024-04-02"
						birthdayDate: "2024-04-02T06:44:41.785Z"
						createdAt: "2024-04-02T06:44:41.785Z"
						role: admin
						roleText: null
						profession: "ThirdUserProf"
						initials: "FU"
						isConfirmed: true
					}
				) {
					isSuccess
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				insertIntoUsersSingle: {
					isSuccess: true,
				},
			},
		});

		const data = await ctx.db.select().from(schema.Users).where(eq(schema.Users.id, 3));

		expect(data).toStrictEqual([
			{
				id: 3,
				name: 'ThirdUser',
				email: 'userThree@notmail.com',
				bigint: BigInt(15),
				birthdayString: '2024-04-02',
				birthdayDate: new Date('2024-04-02T00:00:00.000Z'),
				createdAt: new Date('2024-04-02T06:44:42.000Z'),
				role: 'admin',
				roleText: null,
				roleText2: 'user',
				profession: 'ThirdUserProf',
				initials: 'FU',
				isConfirmed: true,
			},
		]);
	});

	it(`Insert array`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				insertIntoUsers(
					values: [
						{
							id: 3
							name: "ThirdUser"
							email: "userThree@notmail.com"
							bigint: "15"
							birthdayString: "2024-04-02"
							birthdayDate: "2024-04-02T06:44:41.785Z"
							createdAt: "2024-04-02T06:44:41.785Z"
							role: admin
							roleText: null
							profession: "ThirdUserProf"
							initials: "FU"
							isConfirmed: true
						}
						{
							id: 4
							name: "FourthUser"
							email: "userFour@notmail.com"
							bigint: "42"
							birthdayString: "2024-04-04"
							birthdayDate: "2024-04-04T00:00:00.000Z"
							createdAt: "2024-04-04T06:44:41.785Z"
							role: user
							roleText: null
							roleText2: user
							profession: "FourthUserProf"
							initials: "SU"
							isConfirmed: false
						}
					]
				) {
					isSuccess
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				insertIntoUsers: {
					isSuccess: true,
				},
			},
		});

		const data = await ctx.db
			.select()
			.from(schema.Users)
			.where(inArray(schema.Users.id, [3, 4]));

		expect(data).toStrictEqual([
			{
				id: 3,
				name: 'ThirdUser',
				email: 'userThree@notmail.com',
				bigint: BigInt(15),
				birthdayString: '2024-04-02',
				birthdayDate: new Date('2024-04-02T00:00:00.000Z'),
				createdAt: new Date('2024-04-02T06:44:42.000Z'),
				role: 'admin',
				roleText: null,
				roleText2: 'user',
				profession: 'ThirdUserProf',
				initials: 'FU',
				isConfirmed: true,
			},
			{
				id: 4,
				name: 'FourthUser',
				email: 'userFour@notmail.com',
				bigint: BigInt(42),
				birthdayString: '2024-04-04',
				birthdayDate: new Date('2024-04-04T00:00:00.000Z'),
				createdAt: new Date('2024-04-04T06:44:42.000Z'),
				role: 'user',
				roleText: null,
				roleText2: 'user',
				profession: 'FourthUserProf',
				initials: 'SU',
				isConfirmed: false,
			},
		]);
	});

	it(`Update`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				updateCustomers(set: { isConfirmed: true, address: "Edited" }) {
					isSuccess
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				updateCustomers: {
					isSuccess: true,
				},
			},
		});

		const data = await ctx.db.select().from(schema.Customers);

		expect(data).toStrictEqual([
			{
				id: 1,
				address: 'Edited',
				isConfirmed: true,
				registrationDate: new Date('2024-03-27T03:54:45.000Z'),
				userId: 1,
			},
			{
				id: 2,
				address: 'Edited',
				isConfirmed: true,
				registrationDate: new Date('2024-03-27T03:55:42.000Z'),
				userId: 2,
			},
		]);
	});

	it(`Delete`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				deleteFromCustomers {
					isSuccess
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				deleteFromCustomers: {
					isSuccess: true,
				},
			},
		});

		const data = await ctx.db.select().from(schema.Customers);

		expect(data).toStrictEqual([]);
	});
});

describe.sequential('Aliased query tests', async () => {
	it(`Select single`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				user: usersSingle {
					id
					name
					email
					bigint
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
				}

				post: postsSingle {
					id
					user: authorId
					text: content
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				user: {
					id: 1,
					name: 'FirstUser',
					email: 'userOne@notmail.com',
					bigint: '10',
					birthdayString: '2024-04-02',
					birthdayDate: '2024-04-02T00:00:00.000Z',
					createdAt: '2024-04-02T06:44:42.000Z',
					role: 'admin',
					roleText: null,
					roleText2: 'user',
					profession: 'FirstUserProf',
					initials: 'FU',
					isConfirmed: true,
				},
				post: {
					id: 1,
					user: 1,
					text: '1MESSAGE',
				},
			},
		});
	});

	it(`Select array`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				user: users {
					id
					name
					email
					bigint
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
				}

				post: posts {
					id
					author: authorId
					text: content
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				user: [
					{
						id: 1,
						name: 'FirstUser',
						email: 'userOne@notmail.com',
						bigint: '10',
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:42.000Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'FirstUserProf',
						initials: 'FU',
						isConfirmed: true,
					},
					{
						id: 2,
						name: 'SecondUser',
						email: null,
						bigint: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:42.000Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
					},
					{
						id: 5,
						name: 'FifthUser',
						email: null,
						bigint: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:42.000Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
					},
				],
				post: [
					{
						id: 1,
						author: 1,
						text: '1MESSAGE',
					},
					{
						id: 2,
						author: 1,
						text: '2MESSAGE',
					},
					{
						id: 3,
						author: 1,
						text: '3MESSAGE',
					},
					{
						id: 4,
						author: 5,
						text: '1MESSAGE',
					},
					{
						id: 5,
						author: 5,
						text: '2MESSAGE',
					},
					{
						id: 6,
						author: 1,
						text: '4MESSAGE',
					},
				],
			},
		});
	});

	it(`Select single with relations`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				user: usersSingle {
					id
					name
					email
					bigint
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					messages: posts {
						id
						authorId
						text: content
					}
				}

				post: postsSingle {
					id
					authorId
					content
					user: author {
						id
						from: name
						email
						bigint
						birthdayString
						birthdayDate
						createdAt
						role
						roleText
						roleText2
						profession
						initials
						isConfirmed
					}
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				user: {
					id: 1,
					name: 'FirstUser',
					email: 'userOne@notmail.com',
					bigint: '10',
					birthdayString: '2024-04-02',
					birthdayDate: '2024-04-02T00:00:00.000Z',
					createdAt: '2024-04-02T06:44:42.000Z',
					role: 'admin',
					roleText: null,
					roleText2: 'user',
					profession: 'FirstUserProf',
					initials: 'FU',
					isConfirmed: true,
					messages: [
						{
							id: 1,
							authorId: 1,
							text: '1MESSAGE',
						},
						{
							id: 2,
							authorId: 1,
							text: '2MESSAGE',
						},
						{
							id: 3,
							authorId: 1,
							text: '3MESSAGE',
						},

						{
							id: 6,
							authorId: 1,
							text: '4MESSAGE',
						},
					],
				},
				post: {
					id: 1,
					authorId: 1,
					content: '1MESSAGE',
					user: {
						id: 1,
						from: 'FirstUser',
						email: 'userOne@notmail.com',
						bigint: '10',
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:42.000Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'FirstUserProf',
						initials: 'FU',
						isConfirmed: true,
					},
				},
			},
		});
	});

	it(`Select array with relations`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				user: users {
					id
					name
					email
					bigint
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					messages: posts {
						id
						authorId
						text: content
					}
				}

				post: posts {
					id
					authorId
					content
					user: author {
						id
						from: name
						email
						bigint
						birthdayString
						birthdayDate
						createdAt
						role
						roleText
						roleText2
						profession
						initials
						isConfirmed
					}
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				user: [
					{
						id: 1,
						name: 'FirstUser',
						email: 'userOne@notmail.com',
						bigint: '10',
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:42.000Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'FirstUserProf',
						initials: 'FU',
						isConfirmed: true,
						messages: [
							{
								id: 1,
								authorId: 1,
								text: '1MESSAGE',
							},
							{
								id: 2,
								authorId: 1,
								text: '2MESSAGE',
							},
							{
								id: 3,
								authorId: 1,
								text: '3MESSAGE',
							},
							{
								id: 6,
								authorId: 1,
								text: '4MESSAGE',
							},
						],
					},
					{
						id: 2,
						name: 'SecondUser',
						email: null,
						bigint: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:42.000Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						messages: [],
					},
					{
						id: 5,
						name: 'FifthUser',
						email: null,
						bigint: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:42.000Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						messages: [
							{
								id: 4,
								authorId: 5,
								text: '1MESSAGE',
							},
							{
								id: 5,
								authorId: 5,
								text: '2MESSAGE',
							},
						],
					},
				],
				post: [
					{
						id: 1,
						authorId: 1,
						content: '1MESSAGE',
						user: {
							id: 1,
							from: 'FirstUser',
							email: 'userOne@notmail.com',
							bigint: '10',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:42.000Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
						},
					},
					{
						id: 2,
						authorId: 1,
						content: '2MESSAGE',
						user: {
							id: 1,
							from: 'FirstUser',
							email: 'userOne@notmail.com',
							bigint: '10',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:42.000Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
						},
					},
					{
						id: 3,
						authorId: 1,
						content: '3MESSAGE',
						user: {
							id: 1,
							from: 'FirstUser',
							email: 'userOne@notmail.com',
							bigint: '10',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:42.000Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
						},
					},
					{
						id: 4,
						authorId: 5,
						content: '1MESSAGE',
						user: {
							id: 5,
							from: 'FifthUser',
							email: null,
							bigint: null,
							birthdayString: null,
							birthdayDate: null,
							createdAt: '2024-04-02T06:44:42.000Z',
							role: null,
							roleText: null,
							roleText2: 'user',
							profession: null,
							initials: null,
							isConfirmed: null,
						},
					},
					{
						id: 5,
						authorId: 5,
						content: '2MESSAGE',
						user: {
							id: 5,
							from: 'FifthUser',
							email: null,
							bigint: null,
							birthdayString: null,
							birthdayDate: null,
							createdAt: '2024-04-02T06:44:42.000Z',
							role: null,
							roleText: null,
							roleText2: 'user',
							profession: null,
							initials: null,
							isConfirmed: null,
						},
					},
					{
						id: 6,
						authorId: 1,
						content: '4MESSAGE',
						user: {
							id: 1,
							from: 'FirstUser',
							email: 'userOne@notmail.com',
							bigint: '10',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:42.000Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
						},
					},
				],
			},
		});
	});

	it(`Insert single`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				insertIntoUsersSingle(
					values: {
						id: 3
						name: "ThirdUser"
						email: "userThree@notmail.com"
						bigint: "15"
						birthdayString: "2024-04-02"
						birthdayDate: "2024-04-02T06:44:41.785Z"
						createdAt: "2024-04-02T06:44:41.785Z"
						role: admin
						roleText: null
						profession: "ThirdUserProf"
						initials: "FU"
						isConfirmed: true
					}
				) {
					success: isSuccess
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				insertIntoUsersSingle: {
					success: true,
				},
			},
		});

		const data = await ctx.db.select().from(schema.Users).where(eq(schema.Users.id, 3));

		expect(data).toStrictEqual([
			{
				id: 3,
				name: 'ThirdUser',
				email: 'userThree@notmail.com',
				bigint: BigInt(15),
				birthdayString: '2024-04-02',
				birthdayDate: new Date('2024-04-02T00:00:00.000Z'),
				createdAt: new Date('2024-04-02T06:44:42.000Z'),
				role: 'admin',
				roleText: null,
				roleText2: 'user',
				profession: 'ThirdUserProf',
				initials: 'FU',
				isConfirmed: true,
			},
		]);
	});

	it(`Insert array`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				insertIntoUsers(
					values: [
						{
							id: 3
							name: "ThirdUser"
							email: "userThree@notmail.com"
							bigint: "15"
							birthdayString: "2024-04-02"
							birthdayDate: "2024-04-02T06:44:41.785Z"
							createdAt: "2024-04-02T06:44:41.785Z"
							role: admin
							roleText: null
							profession: "ThirdUserProf"
							initials: "FU"
							isConfirmed: true
						}
						{
							id: 4
							name: "FourthUser"
							email: "userFour@notmail.com"
							bigint: "42"
							birthdayString: "2024-04-04"
							birthdayDate: "2024-04-04T00:00:00.000Z"
							createdAt: "2024-04-04T06:44:41.785Z"
							role: user
							roleText: null
							roleText2: user
							profession: "FourthUserProf"
							initials: "SU"
							isConfirmed: false
						}
					]
				) {
					success: isSuccess
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				insertIntoUsers: {
					success: true,
				},
			},
		});

		const data = await ctx.db
			.select()
			.from(schema.Users)
			.where(inArray(schema.Users.id, [3, 4]));

		expect(data).toStrictEqual([
			{
				id: 3,
				name: 'ThirdUser',
				email: 'userThree@notmail.com',
				bigint: BigInt(15),
				birthdayString: '2024-04-02',
				birthdayDate: new Date('2024-04-02T00:00:00.000Z'),
				createdAt: new Date('2024-04-02T06:44:42.000Z'),
				role: 'admin',
				roleText: null,
				roleText2: 'user',
				profession: 'ThirdUserProf',
				initials: 'FU',
				isConfirmed: true,
			},
			{
				id: 4,
				name: 'FourthUser',
				email: 'userFour@notmail.com',
				bigint: BigInt(42),
				birthdayString: '2024-04-04',
				birthdayDate: new Date('2024-04-04T00:00:00.000Z'),
				createdAt: new Date('2024-04-04T06:44:42.000Z'),
				role: 'user',
				roleText: null,
				roleText2: 'user',
				profession: 'FourthUserProf',
				initials: 'SU',
				isConfirmed: false,
			},
		]);
	});

	it(`Update`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				updateCustomers(set: { isConfirmed: true, address: "Edited" }) {
					success: isSuccess
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				updateCustomers: {
					success: true,
				},
			},
		});

		const data = await ctx.db.select().from(schema.Customers);

		expect(data).toStrictEqual([
			{
				id: 1,
				address: 'Edited',
				isConfirmed: true,
				registrationDate: new Date('2024-03-27T03:54:45.000Z'),
				userId: 1,
			},
			{
				id: 2,
				address: 'Edited',
				isConfirmed: true,
				registrationDate: new Date('2024-03-27T03:55:42.000Z'),
				userId: 2,
			},
		]);
	});

	it(`Delete`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				deleteFromCustomers {
					success: isSuccess
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				deleteFromCustomers: {
					success: true,
				},
			},
		});

		const data = await ctx.db.select().from(schema.Customers);

		expect(data).toStrictEqual([]);
	});
});

describe.sequential('Arguments tests', async () => {
	it('Order by', async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				posts(
					orderBy: { authorId: { priority: 1, direction: desc }, content: { priority: 0, direction: asc } }
				) {
					id
					authorId
					content
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				posts: [
					{
						id: 4,
						authorId: 5,
						content: '1MESSAGE',
					},
					{
						id: 5,
						authorId: 5,
						content: '2MESSAGE',
					},
					{
						id: 1,
						authorId: 1,
						content: '1MESSAGE',
					},
					{
						id: 2,
						authorId: 1,
						content: '2MESSAGE',
					},
					{
						id: 3,
						authorId: 1,
						content: '3MESSAGE',
					},

					{
						id: 6,
						authorId: 1,
						content: '4MESSAGE',
					},
				],
			},
		});
	});

	it('Order by on single', async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				postsSingle(
					orderBy: { authorId: { priority: 1, direction: desc }, content: { priority: 0, direction: asc } }
				) {
					id
					authorId
					content
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				postsSingle: {
					id: 4,
					authorId: 5,
					content: '1MESSAGE',
				},
			},
		});
	});

	it('Offset & limit', async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				posts(offset: 1, limit: 2) {
					id
					authorId
					content
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				posts: [
					{
						id: 2,
						authorId: 1,
						content: '2MESSAGE',
					},
					{
						id: 3,
						authorId: 1,
						content: '3MESSAGE',
					},
				],
			},
		});
	});

	it('Offset on single', async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				postsSingle(offset: 1) {
					id
					authorId
					content
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				postsSingle: {
					id: 2,
					authorId: 1,
					content: '2MESSAGE',
				},
			},
		});
	});

	it('Filters - top level AND', async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				posts(where: { id: { inArray: [2, 3, 4, 5, 6] }, authorId: { ne: 5 }, content: { ne: "3MESSAGE" } }) {
					id
					authorId
					content
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				posts: [
					{
						id: 2,
						authorId: 1,
						content: '2MESSAGE',
					},
					{
						id: 6,
						authorId: 1,
						content: '4MESSAGE',
					},
				],
			},
		});
	});

	it('Filters - top level OR', async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				posts(where: { OR: [{ id: { lte: 3 } }, { authorId: { eq: 5 } }] }) {
					id
					authorId
					content
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				posts: [
					{
						id: 1,
						authorId: 1,
						content: '1MESSAGE',
					},
					{
						id: 2,
						authorId: 1,
						content: '2MESSAGE',
					},
					{
						id: 3,
						authorId: 1,
						content: '3MESSAGE',
					},
					{
						id: 4,
						authorId: 5,
						content: '1MESSAGE',
					},
					{
						id: 5,
						authorId: 5,
						content: '2MESSAGE',
					},
				],
			},
		});
	});

	it('Update filters', async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				updatePosts(where: { OR: [{ id: { lte: 3 } }, { authorId: { eq: 5 } }] }, set: { content: "UPDATED" }) {
					isSuccess
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				updatePosts: {
					isSuccess: true,
				},
			},
		});

		const data = await ctx.db.select().from(schema.Posts);

		expect(data).toStrictEqual([
			{
				id: 1,
				authorId: 1,
				content: 'UPDATED',
			},
			{
				id: 2,
				authorId: 1,
				content: 'UPDATED',
			},
			{
				id: 3,
				authorId: 1,
				content: 'UPDATED',
			},
			{
				id: 4,
				authorId: 5,
				content: 'UPDATED',
			},
			{
				id: 5,
				authorId: 5,
				content: 'UPDATED',
			},
			{
				id: 6,
				authorId: 1,
				content: '4MESSAGE',
			},
		]);
	});

	it('Delete filters', async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				deleteFromPosts(where: { OR: [{ id: { lte: 3 } }, { authorId: { eq: 5 } }] }) {
					isSuccess
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				deleteFromPosts: {
					isSuccess: true,
				},
			},
		});

		const data = await ctx.db.select().from(schema.Posts);

		expect(data).toStrictEqual([
			{
				id: 6,
				authorId: 1,
				content: '4MESSAGE',
			},
		]);
	});

	it('Relations orderBy', async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				users {
					id
					posts(orderBy: { id: { priority: 1, direction: desc } }) {
						id
						authorId
						content
					}
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				users: [
					{
						id: 1,
						posts: [
							{
								id: 6,
								authorId: 1,
								content: '4MESSAGE',
							},
							{
								id: 3,
								authorId: 1,
								content: '3MESSAGE',
							},
							{
								id: 2,
								authorId: 1,
								content: '2MESSAGE',
							},
							{
								id: 1,
								authorId: 1,
								content: '1MESSAGE',
							},
						],
					},
					{
						id: 2,
						posts: [],
					},
					{
						id: 5,
						posts: [
							{
								id: 5,
								authorId: 5,
								content: '2MESSAGE',
							},
							{
								id: 4,
								authorId: 5,
								content: '1MESSAGE',
							},
						],
					},
				],
			},
		});
	});

	it('Relations offset & limit', async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				users {
					id
					posts(offset: 1, limit: 2) {
						id
						authorId
						content
					}
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				users: [
					{
						id: 1,
						posts: [
							{
								id: 2,
								authorId: 1,
								content: '2MESSAGE',
							},
							{
								id: 3,
								authorId: 1,
								content: '3MESSAGE',
							},
						],
					},
					{
						id: 2,
						posts: [],
					},
					{
						id: 5,
						posts: [
							{
								id: 5,
								authorId: 5,
								content: '2MESSAGE',
							},
						],
					},
				],
			},
		});
	});

	it('Relations filters', async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				users {
					id
					posts(where: { content: { like: "2%" } }) {
						id
						authorId
						content
					}
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				users: [
					{
						id: 1,
						posts: [
							{
								id: 2,
								authorId: 1,
								content: '2MESSAGE',
							},
						],
					},
					{
						id: 2,
						posts: [],
					},
					{
						id: 5,
						posts: [
							{
								id: 5,
								authorId: 5,
								content: '2MESSAGE',
							},
						],
					},
				],
			},
		});
	});
});

describe.sequential('Returned data tests', () => {
	it('Schema', () => {
		expect(ctx.schema instanceof GraphQLSchema).toBe(true);
	});

	it('Entities', () => {
		ctx.entities.mutations;
		const schema = z
			.object({
				queries: z
					.object({
						users: z
							.object({
								args: z
									.object({
										orderBy: z
											.object({
												type: z.instanceof(GraphQLInputObjectType),
											})
											.strict(),
										offset: z
											.object({
												type: z.instanceof(GraphQLScalarType),
											})
											.strict(),
										limit: z
											.object({
												type: z.instanceof(GraphQLScalarType),
											})
											.strict(),
										where: z
											.object({
												type: z.instanceof(GraphQLInputObjectType),
											})
											.strict(),
									})
									.strict(),
								resolve: z.function(),
								type: z.instanceof(GraphQLNonNull),
							})
							.strict(),
						usersSingle: z
							.object({
								args: z
									.object({
										orderBy: z
											.object({
												type: z.instanceof(GraphQLInputObjectType),
											})
											.strict(),
										offset: z
											.object({
												type: z.instanceof(GraphQLScalarType),
											})
											.strict(),
										where: z
											.object({
												type: z.instanceof(GraphQLInputObjectType),
											})
											.strict(),
									})
									.strict(),
								resolve: z.function(),
								type: z.instanceof(GraphQLObjectType),
							})
							.strict(),
						posts: z
							.object({
								args: z
									.object({
										orderBy: z
											.object({
												type: z.instanceof(GraphQLInputObjectType),
											})
											.strict(),
										offset: z
											.object({
												type: z.instanceof(GraphQLScalarType),
											})
											.strict(),
										limit: z
											.object({
												type: z.instanceof(GraphQLScalarType),
											})
											.strict(),
										where: z
											.object({
												type: z.instanceof(GraphQLInputObjectType),
											})
											.strict(),
									})
									.strict(),
								resolve: z.function(),
								type: z.instanceof(GraphQLNonNull),
							})
							.strict(),
						postsSingle: z
							.object({
								args: z
									.object({
										orderBy: z
											.object({
												type: z.instanceof(GraphQLInputObjectType),
											})
											.strict(),
										offset: z
											.object({
												type: z.instanceof(GraphQLScalarType),
											})
											.strict(),
										where: z
											.object({
												type: z.instanceof(GraphQLInputObjectType),
											})
											.strict(),
									})
									.strict(),
								resolve: z.function(),
								type: z.instanceof(GraphQLObjectType),
							})
							.strict(),
						customers: z
							.object({
								args: z
									.object({
										orderBy: z
											.object({
												type: z.instanceof(GraphQLInputObjectType),
											})
											.strict(),
										offset: z
											.object({
												type: z.instanceof(GraphQLScalarType),
											})
											.strict(),
										limit: z
											.object({
												type: z.instanceof(GraphQLScalarType),
											})
											.strict(),
										where: z
											.object({
												type: z.instanceof(GraphQLInputObjectType),
											})
											.strict(),
									})
									.strict(),
								resolve: z.function(),
								type: z.instanceof(GraphQLNonNull),
							})
							.strict(),
						customersSingle: z
							.object({
								args: z
									.object({
										orderBy: z
											.object({
												type: z.instanceof(GraphQLInputObjectType),
											})
											.strict(),
										offset: z
											.object({
												type: z.instanceof(GraphQLScalarType),
											})
											.strict(),
										where: z
											.object({
												type: z.instanceof(GraphQLInputObjectType),
											})
											.strict(),
									})
									.strict(),
								resolve: z.function(),
								type: z.instanceof(GraphQLObjectType),
							})
							.strict(),
					})
					.strict(),
				mutations: z
					.object({
						insertIntoUsers: z
							.object({
								args: z
									.object({
										values: z
											.object({
												type: z.instanceof(GraphQLNonNull),
											})
											.strict(),
									})
									.strict(),
								resolve: z.function(),
								type: z.instanceof(GraphQLObjectType),
							})
							.strict(),
						insertIntoUsersSingle: z
							.object({
								args: z
									.object({
										values: z
											.object({
												type: z.instanceof(GraphQLNonNull),
											})
											.strict(),
									})
									.strict(),
								resolve: z.function(),
								type: z.instanceof(GraphQLObjectType),
							})
							.strict(),
						updateUsers: z
							.object({
								args: z
									.object({
										set: z
											.object({
												type: z.instanceof(GraphQLNonNull),
											})
											.strict(),
										where: z
											.object({
												type: z.instanceof(GraphQLInputObjectType),
											})
											.strict(),
									})
									.strict(),
								resolve: z.function(),
								type: z.instanceof(GraphQLObjectType),
							})
							.strict(),
						deleteFromUsers: z
							.object({
								args: z
									.object({
										where: z
											.object({
												type: z.instanceof(GraphQLInputObjectType),
											})
											.strict(),
									})
									.strict(),
								resolve: z.function(),
								type: z.instanceof(GraphQLObjectType),
							})
							.strict(),
						insertIntoPosts: z
							.object({
								args: z
									.object({
										values: z
											.object({
												type: z.instanceof(GraphQLNonNull),
											})
											.strict(),
									})
									.strict(),
								resolve: z.function(),
								type: z.instanceof(GraphQLObjectType),
							})
							.strict(),
						insertIntoPostsSingle: z
							.object({
								args: z
									.object({
										values: z
											.object({
												type: z.instanceof(GraphQLNonNull),
											})
											.strict(),
									})
									.strict(),
								resolve: z.function(),
								type: z.instanceof(GraphQLObjectType),
							})
							.strict(),
						updatePosts: z
							.object({
								args: z
									.object({
										set: z
											.object({
												type: z.instanceof(GraphQLNonNull),
											})
											.strict(),
										where: z
											.object({
												type: z.instanceof(GraphQLInputObjectType),
											})
											.strict(),
									})
									.strict(),
								resolve: z.function(),
								type: z.instanceof(GraphQLObjectType),
							})
							.strict(),
						deleteFromPosts: z
							.object({
								args: z
									.object({
										where: z
											.object({
												type: z.instanceof(GraphQLInputObjectType),
											})
											.strict(),
									})
									.strict(),
								resolve: z.function(),
								type: z.instanceof(GraphQLObjectType),
							})
							.strict(),
						insertIntoCustomers: z
							.object({
								args: z
									.object({
										values: z
											.object({
												type: z.instanceof(GraphQLNonNull),
											})
											.strict(),
									})
									.strict(),
								resolve: z.function(),
								type: z.instanceof(GraphQLObjectType),
							})
							.strict(),
						insertIntoCustomersSingle: z
							.object({
								args: z
									.object({
										values: z
											.object({
												type: z.instanceof(GraphQLNonNull),
											})
											.strict(),
									})
									.strict(),
								resolve: z.function(),
								type: z.instanceof(GraphQLObjectType),
							})
							.strict(),
						updateCustomers: z
							.object({
								args: z
									.object({
										set: z
											.object({
												type: z.instanceof(GraphQLNonNull),
											})
											.strict(),
										where: z
											.object({
												type: z.instanceof(GraphQLInputObjectType),
											})
											.strict(),
									})
									.strict(),
								resolve: z.function(),
								type: z.instanceof(GraphQLObjectType),
							})
							.strict(),
						deleteFromCustomers: z
							.object({
								args: z
									.object({
										where: z
											.object({
												type: z.instanceof(GraphQLInputObjectType),
											})
											.strict(),
									})
									.strict(),
								resolve: z.function(),
								type: z.instanceof(GraphQLObjectType),
							})
							.strict(),
					})
					.strict(),
				types: z
					.object({
						UsersSelectItem: z.instanceof(GraphQLObjectType),
						PostsSelectItem: z.instanceof(GraphQLObjectType),
						CustomersSelectItem: z.instanceof(GraphQLObjectType),
						MutationReturn: z.instanceof(GraphQLObjectType),
					})
					.strict(),
				inputs: z
					.object({
						UsersFilters: z.instanceof(GraphQLInputObjectType),
						UsersOrderBy: z.instanceof(GraphQLInputObjectType),
						UsersInsertInput: z.instanceof(GraphQLInputObjectType),
						UsersUpdateInput: z.instanceof(GraphQLInputObjectType),
						PostsFilters: z.instanceof(GraphQLInputObjectType),
						PostsOrderBy: z.instanceof(GraphQLInputObjectType),
						PostsInsertInput: z.instanceof(GraphQLInputObjectType),
						PostsUpdateInput: z.instanceof(GraphQLInputObjectType),
						CustomersFilters: z.instanceof(GraphQLInputObjectType),
						CustomersOrderBy: z.instanceof(GraphQLInputObjectType),
						CustomersInsertInput: z.instanceof(GraphQLInputObjectType),
						CustomersUpdateInput: z.instanceof(GraphQLInputObjectType),
					})
					.strict(),
			})
			.strict();

		const parseRes = schema.safeParse(ctx.entities);

		if (!parseRes.success) console.log(parseRes.error);

		expect(parseRes.success).toEqual(true);
	});
});

describe.sequential('Type tests', () => {
	it('Schema', () => {
		expectTypeOf(ctx.schema).toEqualTypeOf<GraphQLSchema>();
	});

	it('Queries', () => {
		expectTypeOf(ctx.entities.queries).toEqualTypeOf<
			{
				readonly customers: {
					type: GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLObjectType>>>;
					args: {
						orderBy: { type: GraphQLInputObjectType };
						offset: { type: GraphQLScalarType<number, number> };
						limit: { type: GraphQLScalarType<number, number> };
						where: { type: GraphQLInputObjectType };
					};
					resolve: SelectResolver<
						typeof schema.Customers,
						ExtractTables<typeof schema>,
						typeof schema.customersRelations extends Relations<any, infer RelConf> ? RelConf : never
					>;
				};
				readonly posts: {
					type: GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLObjectType>>>;
					args: {
						orderBy: { type: GraphQLInputObjectType };
						offset: { type: GraphQLScalarType<number, number> };
						limit: { type: GraphQLScalarType<number, number> };
						where: { type: GraphQLInputObjectType };
					};
					resolve: SelectResolver<
						typeof schema.Posts,
						ExtractTables<typeof schema>,
						typeof schema.postsRelations extends Relations<any, infer RelConf> ? RelConf : never
					>;
				};
				readonly users: {
					type: GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLObjectType>>>;
					args: {
						orderBy: { type: GraphQLInputObjectType };
						offset: { type: GraphQLScalarType<number, number> };
						limit: { type: GraphQLScalarType<number, number> };
						where: { type: GraphQLInputObjectType };
					};
					resolve: SelectResolver<
						typeof schema.Users,
						ExtractTables<typeof schema>,
						typeof schema.usersRelations extends Relations<any, infer RelConf> ? RelConf : never
					>;
				};
			} & {
				readonly customersSingle: {
					type: GraphQLObjectType;
					args: {
						orderBy: { type: GraphQLInputObjectType };
						offset: { type: GraphQLScalarType<number, number> };
						where: { type: GraphQLInputObjectType };
					};
					resolve: SelectSingleResolver<
						typeof schema.Customers,
						ExtractTables<typeof schema>,
						typeof schema.customersRelations extends Relations<any, infer RelConf> ? RelConf : never
					>;
				};
				readonly postsSingle: {
					type: GraphQLObjectType;
					args: {
						orderBy: { type: GraphQLInputObjectType };
						offset: { type: GraphQLScalarType<number, number> };
						where: { type: GraphQLInputObjectType };
					};
					resolve: SelectSingleResolver<
						typeof schema.Posts,
						ExtractTables<typeof schema>,
						typeof schema.postsRelations extends Relations<any, infer RelConf> ? RelConf : never
					>;
				};
				readonly usersSingle: {
					type: GraphQLObjectType;
					args: {
						orderBy: { type: GraphQLInputObjectType };
						offset: { type: GraphQLScalarType<number, number> };
						where: { type: GraphQLInputObjectType };
					};
					resolve: SelectSingleResolver<
						typeof schema.Users,
						ExtractTables<typeof schema>,
						typeof schema.usersRelations extends Relations<any, infer RelConf> ? RelConf : never
					>;
				};
			}
		>();
	});

	it('Mutations', () => {
		expectTypeOf(ctx.entities.mutations).toEqualTypeOf<
			{
				readonly insertIntoCustomers: {
					type: GraphQLObjectType;
					args: {
						values: {
							type: GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLInputObjectType>>>;
						};
					};
					resolve: InsertArrResolver<typeof schema.Customers, true>;
				};
				readonly insertIntoPosts: {
					type: GraphQLObjectType;
					args: {
						values: {
							type: GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLInputObjectType>>>;
						};
					};
					resolve: InsertArrResolver<typeof schema.Posts, true>;
				};
				readonly insertIntoUsers: {
					type: GraphQLObjectType;
					args: {
						values: {
							type: GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLInputObjectType>>>;
						};
					};
					resolve: InsertArrResolver<typeof schema.Users, true>;
				};
			} & {
				readonly insertIntoCustomersSingle: {
					type: GraphQLObjectType;
					args: {
						values: {
							type: GraphQLNonNull<GraphQLInputObjectType>;
						};
					};
					resolve: InsertResolver<typeof schema.Customers, true>;
				};
				readonly insertIntoPostsSingle: {
					type: GraphQLObjectType;
					args: {
						values: {
							type: GraphQLNonNull<GraphQLInputObjectType>;
						};
					};
					resolve: InsertResolver<typeof schema.Posts, true>;
				};
				readonly insertIntoUsersSingle: {
					type: GraphQLObjectType;
					args: {
						values: {
							type: GraphQLNonNull<GraphQLInputObjectType>;
						};
					};
					resolve: InsertResolver<typeof schema.Users, true>;
				};
			} & {
				readonly updateCustomers: {
					type: GraphQLObjectType;
					args: {
						set: {
							type: GraphQLNonNull<GraphQLInputObjectType>;
						};
						where: { type: GraphQLInputObjectType };
					};
					resolve: UpdateResolver<typeof schema.Customers, true>;
				};
				readonly updatePosts: {
					type: GraphQLObjectType;
					args: {
						set: {
							type: GraphQLNonNull<GraphQLInputObjectType>;
						};
						where: { type: GraphQLInputObjectType };
					};
					resolve: UpdateResolver<typeof schema.Posts, true>;
				};
				readonly updateUsers: {
					type: GraphQLObjectType;
					args: {
						set: {
							type: GraphQLNonNull<GraphQLInputObjectType>;
						};
						where: { type: GraphQLInputObjectType };
					};
					resolve: UpdateResolver<typeof schema.Users, true>;
				};
			} & {
				readonly deleteFromCustomers: {
					type: GraphQLObjectType;
					args: {
						where: { type: GraphQLInputObjectType };
					};
					resolve: DeleteResolver<typeof schema.Customers, true>;
				};
				readonly deleteFromPosts: {
					type: GraphQLObjectType;
					args: {
						where: { type: GraphQLInputObjectType };
					};
					resolve: DeleteResolver<typeof schema.Posts, true>;
				};
				readonly deleteFromUsers: {
					type: GraphQLObjectType;
					args: {
						where: { type: GraphQLInputObjectType };
					};
					resolve: DeleteResolver<typeof schema.Users, true>;
				};
			}
		>();
	});

	it('Types', () => {
		expectTypeOf(ctx.entities.types).toEqualTypeOf<
			{
				MutationReturn: GraphQLObjectType;
			} & {
				readonly CustomersSelectItem: GraphQLObjectType;
				readonly PostsSelectItem: GraphQLObjectType;
				readonly UsersSelectItem: GraphQLObjectType;
			}
		>();
	});

	it('Inputs', () => {
		expectTypeOf(ctx.entities.inputs).toEqualTypeOf<
			{
				readonly UsersFilters: GraphQLInputObjectType;
				readonly CustomersFilters: GraphQLInputObjectType;
				readonly PostsFilters: GraphQLInputObjectType;
			} & {
				readonly UsersOrderBy: GraphQLInputObjectType;
				readonly CustomersOrderBy: GraphQLInputObjectType;
				readonly PostsOrderBy: GraphQLInputObjectType;
			} & {
				readonly UsersInsertInput: GraphQLInputObjectType;
				readonly CustomersInsertInput: GraphQLInputObjectType;
				readonly PostsInsertInput: GraphQLInputObjectType;
			} & {
				readonly UsersUpdateInput: GraphQLInputObjectType;
				readonly CustomersUpdateInput: GraphQLInputObjectType;
				readonly PostsUpdateInput: GraphQLInputObjectType;
			}
		>();
	});
});

describe.sequential('__typename only tests', async () => {
	it(`Select single`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				usersSingle {
					__typename
				}

				postsSingle {
					__typename
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				usersSingle: {
					__typename: 'UsersSelectItem',
				},
				postsSingle: {
					__typename: 'PostsSelectItem',
				},
			},
		});
	});

	it(`Select array`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				users {
					__typename
				}

				posts {
					__typename
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				users: [
					{
						__typename: 'UsersSelectItem',
					},
					{
						__typename: 'UsersSelectItem',
					},
					{
						__typename: 'UsersSelectItem',
					},
				],
				posts: [
					{
						__typename: 'PostsSelectItem',
					},
					{
						__typename: 'PostsSelectItem',
					},
					{
						__typename: 'PostsSelectItem',
					},
					{
						__typename: 'PostsSelectItem',
					},
					{
						__typename: 'PostsSelectItem',
					},
					{
						__typename: 'PostsSelectItem',
					},
				],
			},
		});
	});

	it(`Select single with relations`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				usersSingle {
					__typename
					posts {
						__typename
					}
				}

				postsSingle {
					__typename
					author {
						__typename
					}
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				usersSingle: {
					__typename: 'UsersSelectItem',
					posts: [
						{
							__typename: 'UsersPostsRelation',
						},
						{
							__typename: 'UsersPostsRelation',
						},
						{
							__typename: 'UsersPostsRelation',
						},
						{
							__typename: 'UsersPostsRelation',
						},
					],
				},
				postsSingle: {
					__typename: 'PostsSelectItem',
					author: {
						__typename: 'PostsAuthorRelation',
					},
				},
			},
		});
	});

	it(`Select array with relations`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				users {
					__typename
					posts {
						__typename
					}
				}

				posts {
					__typename
					author {
						__typename
					}
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				users: [
					{
						__typename: 'UsersSelectItem',
						posts: [
							{
								__typename: 'UsersPostsRelation',
							},
							{
								__typename: 'UsersPostsRelation',
							},
							{
								__typename: 'UsersPostsRelation',
							},
							{
								__typename: 'UsersPostsRelation',
							},
						],
					},
					{
						__typename: 'UsersSelectItem',
						posts: [],
					},
					{
						__typename: 'UsersSelectItem',
						posts: [
							{
								__typename: 'UsersPostsRelation',
							},
							{
								__typename: 'UsersPostsRelation',
							},
						],
					},
				],
				posts: [
					{
						__typename: 'PostsSelectItem',
						author: {
							__typename: 'PostsAuthorRelation',
						},
					},
					{
						__typename: 'PostsSelectItem',
						author: {
							__typename: 'PostsAuthorRelation',
						},
					},
					{
						__typename: 'PostsSelectItem',
						author: {
							__typename: 'PostsAuthorRelation',
						},
					},
					{
						__typename: 'PostsSelectItem',
						author: {
							__typename: 'PostsAuthorRelation',
						},
					},
					{
						__typename: 'PostsSelectItem',
						author: {
							__typename: 'PostsAuthorRelation',
						},
					},
					{
						__typename: 'PostsSelectItem',
						author: {
							__typename: 'PostsAuthorRelation',
						},
					},
				],
			},
		});
	});

	it(`Insert single`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				insertIntoUsersSingle(
					values: {
						id: 3
						name: "ThirdUser"
						email: "userThree@notmail.com"
						bigint: "15"
						birthdayString: "2024-04-02"
						birthdayDate: "2024-04-02T06:44:41.785Z"
						createdAt: "2024-04-02T06:44:41.785Z"
						role: admin
						roleText: null
						profession: "ThirdUserProf"
						initials: "FU"
						isConfirmed: true
					}
				) {
					__typename
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				insertIntoUsersSingle: {
					__typename: 'MutationReturn',
				},
			},
		});

		const data = await ctx.db.select().from(schema.Users).where(eq(schema.Users.id, 3));

		expect(data).toStrictEqual([
			{
				id: 3,
				name: 'ThirdUser',
				email: 'userThree@notmail.com',
				bigint: BigInt(15),
				birthdayString: '2024-04-02',
				birthdayDate: new Date('2024-04-02T00:00:00.000Z'),
				createdAt: new Date('2024-04-02T06:44:42.000Z'),
				role: 'admin',
				roleText: null,
				roleText2: 'user',
				profession: 'ThirdUserProf',
				initials: 'FU',
				isConfirmed: true,
			},
		]);
	});

	it(`Insert array`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				insertIntoUsers(
					values: [
						{
							id: 3
							name: "ThirdUser"
							email: "userThree@notmail.com"
							bigint: "15"
							birthdayString: "2024-04-02"
							birthdayDate: "2024-04-02T06:44:41.785Z"
							createdAt: "2024-04-02T06:44:41.785Z"
							role: admin
							roleText: null
							profession: "ThirdUserProf"
							initials: "FU"
							isConfirmed: true
						}
						{
							id: 4
							name: "FourthUser"
							email: "userFour@notmail.com"
							bigint: "42"
							birthdayString: "2024-04-04"
							birthdayDate: "2024-04-04T00:00:00.000Z"
							createdAt: "2024-04-04T06:44:41.785Z"
							role: user
							roleText: null
							roleText2: user
							profession: "FourthUserProf"
							initials: "SU"
							isConfirmed: false
						}
					]
				) {
					__typename
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				insertIntoUsers: {
					__typename: 'MutationReturn',
				},
			},
		});

		const data = await ctx.db
			.select()
			.from(schema.Users)
			.where(inArray(schema.Users.id, [3, 4]));

		expect(data).toStrictEqual([
			{
				id: 3,
				name: 'ThirdUser',
				email: 'userThree@notmail.com',
				bigint: BigInt(15),
				birthdayString: '2024-04-02',
				birthdayDate: new Date('2024-04-02T00:00:00.000Z'),
				createdAt: new Date('2024-04-02T06:44:42.000Z'),
				role: 'admin',
				roleText: null,
				roleText2: 'user',
				profession: 'ThirdUserProf',
				initials: 'FU',
				isConfirmed: true,
			},
			{
				id: 4,
				name: 'FourthUser',
				email: 'userFour@notmail.com',
				bigint: BigInt(42),
				birthdayString: '2024-04-04',
				birthdayDate: new Date('2024-04-04T00:00:00.000Z'),
				createdAt: new Date('2024-04-04T06:44:42.000Z'),
				role: 'user',
				roleText: null,
				roleText2: 'user',
				profession: 'FourthUserProf',
				initials: 'SU',
				isConfirmed: false,
			},
		]);
	});

	it(`Update`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				updateCustomers(set: { isConfirmed: true, address: "Edited" }) {
					__typename
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				updateCustomers: {
					__typename: 'MutationReturn',
				},
			},
		});

		const data = await ctx.db.select().from(schema.Customers);

		expect(data).toStrictEqual([
			{
				id: 1,
				address: 'Edited',
				isConfirmed: true,
				registrationDate: new Date('2024-03-27T03:54:45.000Z'),
				userId: 1,
			},
			{
				id: 2,
				address: 'Edited',
				isConfirmed: true,
				registrationDate: new Date('2024-03-27T03:55:42.000Z'),
				userId: 2,
			},
		]);
	});

	it(`Delete`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				deleteFromCustomers {
					__typename
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				deleteFromCustomers: {
					__typename: 'MutationReturn',
				},
			},
		});

		const data = await ctx.db.select().from(schema.Customers);

		expect(data).toStrictEqual([]);
	});
});

describe.sequential('__typename with data tests', async () => {
	it(`Select single`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				usersSingle {
					id
					name
					email
					bigint
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					__typename
				}

				postsSingle {
					id
					authorId
					content
					__typename
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				usersSingle: {
					id: 1,
					name: 'FirstUser',
					email: 'userOne@notmail.com',
					bigint: '10',
					birthdayString: '2024-04-02',
					birthdayDate: '2024-04-02T00:00:00.000Z',
					createdAt: '2024-04-02T06:44:42.000Z',
					role: 'admin',
					roleText: null,
					roleText2: 'user',
					profession: 'FirstUserProf',
					initials: 'FU',
					isConfirmed: true,
					__typename: 'UsersSelectItem',
				},
				postsSingle: {
					id: 1,
					authorId: 1,
					content: '1MESSAGE',
					__typename: 'PostsSelectItem',
				},
			},
		});
	});

	it(`Select array`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				users {
					id
					name
					email
					bigint
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					__typename
				}

				posts {
					id
					authorId
					content
					__typename
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				users: [
					{
						id: 1,
						name: 'FirstUser',
						email: 'userOne@notmail.com',
						bigint: '10',
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:42.000Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'FirstUserProf',
						initials: 'FU',
						isConfirmed: true,
						__typename: 'UsersSelectItem',
					},
					{
						id: 2,
						name: 'SecondUser',
						email: null,
						bigint: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:42.000Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						__typename: 'UsersSelectItem',
					},
					{
						id: 5,
						name: 'FifthUser',
						email: null,
						bigint: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:42.000Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						__typename: 'UsersSelectItem',
					},
				],
				posts: [
					{
						id: 1,
						authorId: 1,
						content: '1MESSAGE',
						__typename: 'PostsSelectItem',
					},
					{
						id: 2,
						authorId: 1,
						content: '2MESSAGE',
						__typename: 'PostsSelectItem',
					},
					{
						id: 3,
						authorId: 1,
						content: '3MESSAGE',
						__typename: 'PostsSelectItem',
					},
					{
						id: 4,
						authorId: 5,
						content: '1MESSAGE',
						__typename: 'PostsSelectItem',
					},
					{
						id: 5,
						authorId: 5,
						content: '2MESSAGE',
						__typename: 'PostsSelectItem',
					},
					{
						id: 6,
						authorId: 1,
						content: '4MESSAGE',
						__typename: 'PostsSelectItem',
					},
				],
			},
		});
	});

	it(`Select single with relations`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				usersSingle {
					id
					name
					email
					bigint
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					__typename
					posts {
						id
						authorId
						content
						__typename
					}
				}

				postsSingle {
					id
					authorId
					content
					__typename
					author {
						id
						name
						email
						bigint
						birthdayString
						birthdayDate
						createdAt
						role
						roleText
						roleText2
						profession
						initials
						isConfirmed
						__typename
					}
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				usersSingle: {
					id: 1,
					name: 'FirstUser',
					email: 'userOne@notmail.com',
					bigint: '10',
					birthdayString: '2024-04-02',
					birthdayDate: '2024-04-02T00:00:00.000Z',
					createdAt: '2024-04-02T06:44:42.000Z',
					role: 'admin',
					roleText: null,
					roleText2: 'user',
					profession: 'FirstUserProf',
					initials: 'FU',
					isConfirmed: true,
					__typename: 'UsersSelectItem',
					posts: [
						{
							id: 1,
							authorId: 1,
							content: '1MESSAGE',
							__typename: 'UsersPostsRelation',
						},
						{
							id: 2,
							authorId: 1,
							content: '2MESSAGE',
							__typename: 'UsersPostsRelation',
						},
						{
							id: 3,
							authorId: 1,
							content: '3MESSAGE',
							__typename: 'UsersPostsRelation',
						},
						{
							id: 6,
							authorId: 1,
							content: '4MESSAGE',
							__typename: 'UsersPostsRelation',
						},
					],
				},
				postsSingle: {
					id: 1,
					authorId: 1,
					content: '1MESSAGE',
					__typename: 'PostsSelectItem',
					author: {
						id: 1,
						name: 'FirstUser',
						email: 'userOne@notmail.com',
						bigint: '10',
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:42.000Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'FirstUserProf',
						initials: 'FU',
						isConfirmed: true,
						__typename: 'PostsAuthorRelation',
					},
				},
			},
		});
	});

	it(`Select array with relations`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				users {
					id
					name
					email
					bigint
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					__typename
					posts {
						id
						authorId
						content
						__typename
					}
				}

				posts {
					id
					authorId
					content
					__typename
					author {
						id
						name
						email
						bigint
						birthdayString
						birthdayDate
						createdAt
						role
						roleText
						roleText2
						profession
						initials
						isConfirmed
						__typename
					}
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				users: [
					{
						id: 1,
						name: 'FirstUser',
						email: 'userOne@notmail.com',
						bigint: '10',
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:42.000Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'FirstUserProf',
						initials: 'FU',
						isConfirmed: true,
						__typename: 'UsersSelectItem',
						posts: [
							{
								id: 1,
								authorId: 1,
								content: '1MESSAGE',
								__typename: 'UsersPostsRelation',
							},
							{
								id: 2,
								authorId: 1,
								content: '2MESSAGE',
								__typename: 'UsersPostsRelation',
							},
							{
								id: 3,
								authorId: 1,
								content: '3MESSAGE',
								__typename: 'UsersPostsRelation',
							},
							{
								id: 6,
								authorId: 1,
								content: '4MESSAGE',
								__typename: 'UsersPostsRelation',
							},
						],
					},
					{
						id: 2,
						name: 'SecondUser',
						email: null,
						bigint: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:42.000Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						__typename: 'UsersSelectItem',
						posts: [],
					},
					{
						id: 5,
						name: 'FifthUser',
						email: null,
						bigint: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:42.000Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						__typename: 'UsersSelectItem',
						posts: [
							{
								id: 4,
								authorId: 5,
								content: '1MESSAGE',
								__typename: 'UsersPostsRelation',
							},
							{
								id: 5,
								authorId: 5,
								content: '2MESSAGE',
								__typename: 'UsersPostsRelation',
							},
						],
					},
				],
				posts: [
					{
						id: 1,
						authorId: 1,
						content: '1MESSAGE',
						__typename: 'PostsSelectItem',
						author: {
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							bigint: '10',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:42.000Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
							__typename: 'PostsAuthorRelation',
						},
					},
					{
						id: 2,
						authorId: 1,
						content: '2MESSAGE',
						__typename: 'PostsSelectItem',
						author: {
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							bigint: '10',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:42.000Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
							__typename: 'PostsAuthorRelation',
						},
					},
					{
						id: 3,
						authorId: 1,
						content: '3MESSAGE',
						__typename: 'PostsSelectItem',
						author: {
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							bigint: '10',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:42.000Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
							__typename: 'PostsAuthorRelation',
						},
					},
					{
						id: 4,
						authorId: 5,
						content: '1MESSAGE',
						__typename: 'PostsSelectItem',
						author: {
							id: 5,
							name: 'FifthUser',
							email: null,
							bigint: null,
							birthdayString: null,
							birthdayDate: null,
							createdAt: '2024-04-02T06:44:42.000Z',
							role: null,
							roleText: null,
							roleText2: 'user',
							profession: null,
							initials: null,
							isConfirmed: null,
							__typename: 'PostsAuthorRelation',
						},
					},
					{
						id: 5,
						authorId: 5,
						content: '2MESSAGE',
						__typename: 'PostsSelectItem',
						author: {
							id: 5,
							name: 'FifthUser',
							email: null,
							bigint: null,
							birthdayString: null,
							birthdayDate: null,
							createdAt: '2024-04-02T06:44:42.000Z',
							role: null,
							roleText: null,
							roleText2: 'user',
							profession: null,
							initials: null,
							isConfirmed: null,
							__typename: 'PostsAuthorRelation',
						},
					},
					{
						id: 6,
						authorId: 1,
						content: '4MESSAGE',
						__typename: 'PostsSelectItem',
						author: {
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							bigint: '10',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:42.000Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
							__typename: 'PostsAuthorRelation',
						},
					},
				],
			},
		});
	});

	it(`Insert single`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				insertIntoUsersSingle(
					values: {
						id: 3
						name: "ThirdUser"
						email: "userThree@notmail.com"
						bigint: "15"
						birthdayString: "2024-04-02"
						birthdayDate: "2024-04-02T06:44:41.785Z"
						createdAt: "2024-04-02T06:44:41.785Z"
						role: admin
						roleText: null
						profession: "ThirdUserProf"
						initials: "FU"
						isConfirmed: true
					}
				) {
					isSuccess
					__typename
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				insertIntoUsersSingle: {
					isSuccess: true,
					__typename: 'MutationReturn',
				},
			},
		});

		const data = await ctx.db.select().from(schema.Users).where(eq(schema.Users.id, 3));

		expect(data).toStrictEqual([
			{
				id: 3,
				name: 'ThirdUser',
				email: 'userThree@notmail.com',
				bigint: BigInt(15),
				birthdayString: '2024-04-02',
				birthdayDate: new Date('2024-04-02T00:00:00.000Z'),
				createdAt: new Date('2024-04-02T06:44:42.000Z'),
				role: 'admin',
				roleText: null,
				roleText2: 'user',
				profession: 'ThirdUserProf',
				initials: 'FU',
				isConfirmed: true,
			},
		]);
	});

	it(`Insert array`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				insertIntoUsers(
					values: [
						{
							id: 3
							name: "ThirdUser"
							email: "userThree@notmail.com"
							bigint: "15"
							birthdayString: "2024-04-02"
							birthdayDate: "2024-04-02T06:44:41.785Z"
							createdAt: "2024-04-02T06:44:41.785Z"
							role: admin
							roleText: null
							profession: "ThirdUserProf"
							initials: "FU"
							isConfirmed: true
						}
						{
							id: 4
							name: "FourthUser"
							email: "userFour@notmail.com"
							bigint: "42"
							birthdayString: "2024-04-04"
							birthdayDate: "2024-04-04T00:00:00.000Z"
							createdAt: "2024-04-04T06:44:41.785Z"
							role: user
							roleText: null
							roleText2: user
							profession: "FourthUserProf"
							initials: "SU"
							isConfirmed: false
						}
					]
				) {
					isSuccess
					__typename
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				insertIntoUsers: {
					isSuccess: true,
					__typename: 'MutationReturn',
				},
			},
		});

		const data = await ctx.db
			.select()
			.from(schema.Users)
			.where(inArray(schema.Users.id, [3, 4]));

		expect(data).toStrictEqual([
			{
				id: 3,
				name: 'ThirdUser',
				email: 'userThree@notmail.com',
				bigint: BigInt(15),
				birthdayString: '2024-04-02',
				birthdayDate: new Date('2024-04-02T00:00:00.000Z'),
				createdAt: new Date('2024-04-02T06:44:42.000Z'),
				role: 'admin',
				roleText: null,
				roleText2: 'user',
				profession: 'ThirdUserProf',
				initials: 'FU',
				isConfirmed: true,
			},
			{
				id: 4,
				name: 'FourthUser',
				email: 'userFour@notmail.com',
				bigint: BigInt(42),
				birthdayString: '2024-04-04',
				birthdayDate: new Date('2024-04-04T00:00:00.000Z'),
				createdAt: new Date('2024-04-04T06:44:42.000Z'),
				role: 'user',
				roleText: null,
				roleText2: 'user',
				profession: 'FourthUserProf',
				initials: 'SU',
				isConfirmed: false,
			},
		]);
	});

	it(`Update`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				updateCustomers(set: { isConfirmed: true, address: "Edited" }) {
					isSuccess
					__typename
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				updateCustomers: {
					isSuccess: true,
					__typename: 'MutationReturn',
				},
			},
		});

		const data = await ctx.db.select().from(schema.Customers);

		expect(data).toStrictEqual([
			{
				id: 1,
				address: 'Edited',
				isConfirmed: true,
				registrationDate: new Date('2024-03-27T03:54:45.000Z'),
				userId: 1,
			},
			{
				id: 2,
				address: 'Edited',
				isConfirmed: true,
				registrationDate: new Date('2024-03-27T03:55:42.000Z'),
				userId: 2,
			},
		]);
	});

	it(`Delete`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				deleteFromCustomers {
					isSuccess
					__typename
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				deleteFromCustomers: {
					isSuccess: true,
					__typename: 'MutationReturn',
				},
			},
		});

		const data = await ctx.db.select().from(schema.Customers);

		expect(data).toStrictEqual([]);
	});
});
