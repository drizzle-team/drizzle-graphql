import { buildSchema, type GeneratedEntities } from '@/index';
import Docker from 'dockerode';
import { eq, inArray, sql } from 'drizzle-orm';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import getPort from 'get-port';
import { GraphQLObjectType, GraphQLSchema } from 'graphql';
import { createYoga } from 'graphql-yoga';
import { createServer, type Server } from 'http';
import * as mysql from 'mysql2/promise';
import { v4 as uuid } from 'uuid';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
	const port = await getPort({ port: 3307 });
	const image = 'mysql:8';

	const pullStream = await docker.pull(image);
	await new Promise((resolve, reject) =>
		docker.modem.followProgress(pullStream, (err) => (err ? reject(err) : resolve(err)))
	);

	ctx.mysqlContainer = await docker.createContainer({
		Image: image,
		Env: ['MYSQL_ROOT_PASSWORD=mysql', 'MYSQL_DATABASE=drizzle'],
		name: `drizzle-graphql-mysql-custom-tests-${uuid()}`,
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
	let timeLeft = 30000;
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

	const { entities } = buildSchema(ctx.db);

	const customSchema = new GraphQLSchema({
		query: new GraphQLObjectType({
			name: 'Query',
			fields: {
				customUsersSingle: entities.queries.usersSingle,
				customUsers: entities.queries.users,
				customCustomersSingle: entities.queries.customersSingle,
				customCustomers: entities.queries.customers,
				customPostsSingle: entities.queries.postsSingle,
				customPosts: entities.queries.posts,
			},
		}),
		mutation: new GraphQLObjectType({
			name: 'Mutation',
			fields: {
				deleteFromCustomUsers: entities.mutations.deleteFromUsers,
				deleteFromCustomCustomers: entities.mutations.deleteFromCustomers,
				deleteFromCustomPosts: entities.mutations.deleteFromPosts,
				updateCustomUsers: entities.mutations.updateUsers,
				updateCustomCustomers: entities.mutations.updateCustomers,
				updateCustomPosts: entities.mutations.updatePosts,
				insertIntoCustomUsers: entities.mutations.insertIntoUsers,
				insertIntoCustomUsersSingle: entities.mutations.insertIntoUsersSingle,
				insertIntoCustomCustomers: entities.mutations.insertIntoCustomers,
				insertIntoCustomCustomersSingle: entities.mutations.insertIntoCustomersSingle,
				insertIntoCustomPosts: entities.mutations.insertIntoPosts,
				insertIntoCustomPostsSingle: entities.mutations.insertIntoPostsSingle,
			},
		}),
		types: [...Object.values(entities.types), ...Object.values(entities.inputs)],
	});

	const yoga = createYoga({
		schema: customSchema,
	});
	const server = createServer(yoga);

	const port = 5001;
	server.listen(port);
	const gql = new GraphQLClient(`http://localhost:${port}/graphql`);

	ctx.schema = customSchema;
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
				customUsersSingle {
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

				customPostsSingle {
					id
					authorId
					content
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				customUsersSingle: {
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
				customPostsSingle: {
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
				customUsers {
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

				customPosts {
					id
					authorId
					content
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				customUsers: [
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
				customPosts: [
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
				customUsersSingle {
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

				customPostsSingle {
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
				customUsersSingle: {
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
				customPostsSingle: {
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
				customUsers {
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

				customPosts {
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
				customUsers: [
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
				customPosts: [
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

	it(`Select single by fragment`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			query testQuery {
				customUsersSingle {
					...UsersFrag
				}

				customPostsSingle {
					...PostsFrag
				}
			}

			fragment UsersFrag on UsersSelectItem {
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

			fragment PostsFrag on PostsSelectItem {
				id
				authorId
				content
			}
		`);

		expect(res).toStrictEqual({
			data: {
				customUsersSingle: {
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
				customPostsSingle: {
					id: 1,
					authorId: 1,
					content: '1MESSAGE',
				},
			},
		});
	});

	it(`Select array by fragment`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			query testQuery {
				customUsers {
					...UsersFrag
				}

				customPosts {
					...PostsFrag
				}
			}

			fragment UsersFrag on UsersSelectItem {
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

			fragment PostsFrag on PostsSelectItem {
				id
				authorId
				content
			}
		`);

		expect(res).toStrictEqual({
			data: {
				customUsers: [
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
				customPosts: [
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

	it(`Select single with relations by fragment`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			query testQuery {
				customUsersSingle {
					...UsersFrag
				}

				customPostsSingle {
					...PostsFrag
				}
			}
			
			fragment UsersFrag on UsersSelectItem {
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

			fragment PostsFrag on PostsSelectItem {
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
		`);

		expect(res).toStrictEqual({
			data: {
				customUsersSingle: {
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
				customPostsSingle: {
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

	it(`Select array with relations by fragment`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			query testQuery {
				customUsers {
					...UsersFrag
				}

				customPosts {
					...PostsFrag
				}
			}
			
			fragment UsersFrag on UsersSelectItem {
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

			fragment PostsFrag on PostsSelectItem {
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
		`);

		expect(res).toStrictEqual({
			data: {
				customUsers: [
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
				customPosts: [
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
				insertIntoCustomUsersSingle(
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
				insertIntoCustomUsersSingle: {
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
				insertIntoCustomUsers(
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
				insertIntoCustomUsers: {
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
				updateCustomCustomers(set: { isConfirmed: true, address: "Edited" }) {
					isSuccess
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				updateCustomCustomers: {
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
				deleteFromCustomCustomers {
					isSuccess
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				deleteFromCustomCustomers: {
					isSuccess: true,
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
				customPosts(
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
				customPosts: [
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
				customPostsSingle(
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
				customPostsSingle: {
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
				customPosts(offset: 1, limit: 2) {
					id
					authorId
					content
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				customPosts: [
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
				customPostsSingle(offset: 1) {
					id
					authorId
					content
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				customPostsSingle: {
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
				customPosts(where: { id: { inArray: [2, 3, 4, 5, 6] }, authorId: { ne: 5 }, content: { ne: "3MESSAGE" } }) {
					id
					authorId
					content
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				customPosts: [
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
				customPosts(where: { OR: [{ id: { lte: 3 } }, { authorId: { eq: 5 } }] }) {
					id
					authorId
					content
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				customPosts: [
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
				updateCustomPosts(where: { OR: [{ id: { lte: 3 } }, { authorId: { eq: 5 } }] }, set: { content: "UPDATED" }) {
					isSuccess
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				updateCustomPosts: {
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
				deleteFromCustomPosts(where: { OR: [{ id: { lte: 3 } }, { authorId: { eq: 5 } }] }) {
					isSuccess
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				deleteFromCustomPosts: {
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
				customUsers {
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
				customUsers: [
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
				customUsers {
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
				customUsers: [
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
				customUsers {
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
				customUsers: [
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
