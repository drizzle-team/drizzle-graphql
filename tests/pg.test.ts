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
import { type Relations, sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
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
import { createServer, type Server } from 'node:http';
import postgres, { type Sql } from 'postgres';
import { v4 as uuid } from 'uuid';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import z from 'zod';
import * as schema from './schema/pg';
import { GraphQLClient } from './util/query';

interface Context {
	docker: Docker;
	pgContainer: Docker.Container;
	db: PostgresJsDatabase<typeof schema>;
	client: Sql;
	schema: GraphQLSchema;
	entities: GeneratedEntities<PostgresJsDatabase<typeof schema>>;
	server: Server;
	gql: GraphQLClient;
}

const ctx: Context = {} as any;

async function createDockerDB(ctx: Context): Promise<string> {
	const docker = (ctx.docker = new Docker());
	const port = await getPort({ port: 5432 });
	const image = 'joshuasundance/postgis_pgvector';

	const pullStream = await docker.pull(image);
	await new Promise((resolve, reject) =>
		docker.modem.followProgress(pullStream, (err) => (err ? reject(err) : resolve(err)))
	);

	const pgContainer = (ctx.pgContainer = await docker.createContainer({
		Image: image,
		Env: ['POSTGRES_PASSWORD=postgres', 'POSTGRES_USER=postgres', 'POSTGRES_DB=postgres'],
		name: `drizzle-graphql-pg-tests-${uuid()}`,
		HostConfig: {
			AutoRemove: true,
			PortBindings: {
				'5432/tcp': [{ HostPort: `${port}` }],
			},
		},
	}));

	await pgContainer.start();

	return `postgres://postgres:postgres@localhost:${port}/postgres`;
}

beforeAll(async () => {
	const connectionString = await createDockerDB(ctx);

	const sleep = 250;
	let timeLeft = 5000;
	let connected = false;
	let lastError: unknown | undefined;

	do {
		try {
			ctx.client = postgres(connectionString, {
				max: 1,
				onnotice: () => {
					// disable notices
				},
			});
			await ctx.client`select 1`;
			connected = true;
			break;
		} catch (e) {
			lastError = e;
			await new Promise((resolve) => setTimeout(resolve, sleep));
			timeLeft -= sleep;
		}
	} while (timeLeft > 0);
	if (!connected) {
		console.error('Cannot connect to Postgres');
		throw lastError;
	}

	ctx.db = drizzle(ctx.client, {
		schema,
		logger: process.env['LOG_SQL'] ? true : false,
	});

	const { schema: gqlSchema, entities } = buildSchema(ctx.db);
	const yoga = createYoga({
		schema: gqlSchema,
	});
	const server = createServer(yoga);

	const port = 4002;
	server.listen(port);
	const gql = new GraphQLClient(`http://localhost:${port}/graphql`);

	ctx.schema = gqlSchema;
	ctx.entities = entities;
	ctx.server = server;
	ctx.gql = gql;

	await ctx.db.execute(
		sql`
		DO $$ BEGIN
		CREATE TYPE "role" AS ENUM('admin', 'user');
	   	EXCEPTION
		WHEN duplicate_object THEN null;
	   	END $$;
		`,
	);
});

afterAll(async () => {
	await ctx.client?.end().catch(console.error);
	await ctx.pgContainer?.stop().catch(console.error);
});

beforeEach(async () => {
	await ctx.db.execute(
		sql`CREATE TABLE IF NOT EXISTS "customers" (
			"id" serial PRIMARY KEY NOT NULL,
			"address" text NOT NULL,
			"is_confirmed" boolean,
			"registration_date" timestamp DEFAULT now() NOT NULL,
			"user_id" integer NOT NULL
		);`,
	);

	await ctx.db.execute(sql`CREATE TABLE IF NOT EXISTS "posts" (
		"id" serial PRIMARY KEY NOT NULL,
		"content" text,
		"author_id" integer
	);`);

	await ctx.db.execute(sql`CREATE TABLE IF NOT EXISTS "users" (
		"a" integer[],
		"id" serial PRIMARY KEY NOT NULL,
		"name" text NOT NULL,
		"email" text,
		"config_array" jsonb,
		"config_object" jsonb,
		"birthday_string" date,
		"birthday_date" date,
		"created_at" timestamp DEFAULT now() NOT NULL,
		"role" "role",
		"role1" text,
		"role2" text DEFAULT 'user',
		"profession" varchar(20),
		"initials" char(2),
		"is_confirmed" boolean,
		"vector_column" vector(5),
		"geometry_xy" geometry(point),
		"geometry_tuple" geometry(point)
	);`);

	await ctx.db.execute(sql`DO $$ BEGIN
			ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE no action ON UPDATE no action;
		EXCEPTION
			WHEN duplicate_object THEN null;
		END $$;
   `);

	await ctx.db.insert(schema.Users).values([
		{
			a: [1, 5, 10, 25, 40],
			id: 1,
			name: 'FirstUser',
			email: 'userOne@notmail.com',
			configArray: ['a', 'b'],
			configObject: {
				darkMode: true,
			},
			birthdayString: '2024-04-02T06:44:41.785Z',
			birthdayDate: new Date('2024-04-02T06:44:41.785Z'),
			createdAt: new Date('2024-04-02T06:44:41.785Z'),
			role: 'admin',
			roleText: null,
			profession: 'FirstUserProf',
			initials: 'FU',
			isConfirmed: true,
			vector: [1, 2, 3, 4, 5],
			geoXy: {
				x: 20,
				y: 20.3,
			},
			geoTuple: [20, 20.3],
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

afterEach(async () => {
	await ctx.db.execute(sql`DROP TABLE "posts" CASCADE;`);
	await ctx.db.execute(sql`DROP TABLE "customers" CASCADE;`);
	await ctx.db.execute(sql`DROP TABLE "users" CASCADE;`);
});

describe.sequential('Query tests', async () => {
	it(`Select single`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				usersSingle {
					a
					id
					name
					email
					configArray
					configObject
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					vector
					geoXy {
						x
						y
					}
					geoTuple
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
					a: [1, 5, 10, 25, 40],
					id: 1,
					name: 'FirstUser',
					email: 'userOne@notmail.com',
					configArray: ['a', 'b'],
					configObject: {
						darkMode: true,
					},
					birthdayString: '2024-04-02',
					birthdayDate: '2024-04-02T00:00:00.000Z',
					createdAt: '2024-04-02T06:44:41.785Z',
					role: 'admin',
					roleText: null,
					roleText2: 'user',
					profession: 'FirstUserProf',
					initials: 'FU',
					isConfirmed: true,
					vector: [1, 2, 3, 4, 5],
					geoXy: {
						x: 20,
						y: 20.3,
					},
					geoTuple: [20, 20.3],
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
					a
					id
					name
					email
					configArray
					configObject
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					vector
					geoXy {
						x
						y
					}
					geoTuple
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
						a: [1, 5, 10, 25, 40],
						id: 1,
						name: 'FirstUser',
						email: 'userOne@notmail.com',
						configArray: ['a', 'b'],
						configObject: { darkMode: true },
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:41.785Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'FirstUserProf',
						initials: 'FU',
						isConfirmed: true,
						vector: [1, 2, 3, 4, 5],
						geoXy: {
							x: 20,
							y: 20.3,
						},
						geoTuple: [20, 20.3],
					},
					{
						a: null,
						id: 2,
						name: 'SecondUser',
						email: null,
						configArray: null,
						configObject: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:41.785Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						vector: null,
						geoXy: null,
						geoTuple: null,
					},
					{
						a: null,
						id: 5,
						name: 'FifthUser',
						email: null,
						configArray: null,
						configObject: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:41.785Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						vector: null,
						geoXy: null,
						geoTuple: null,
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

	it.skip(`Select single with relations`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				usersSingle {
					a
					id
					name
					email
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					vector
					geoXy {
						x
						y
					}
					geoTuple
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
						a
						id
						name
						email
						birthdayString
						birthdayDate
						createdAt
						role
						roleText
						roleText2
						profession
						initials
						isConfirmed
						vector
						geoXy {
							x
							y
						}
						geoTuple
					}
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				usersSingle: {
					a: [1, 5, 10, 25, 40],
					id: 1,
					name: 'FirstUser',
					email: 'userOne@notmail.com',
					birthdayString: '2024-04-02',
					birthdayDate: '2024-04-02T00:00:00.000Z',
					createdAt: '2024-04-02T06:44:41.785Z',
					role: 'admin',
					roleText: null,
					roleText2: 'user',
					profession: 'FirstUserProf',
					initials: 'FU',
					isConfirmed: true,
					vector: [1, 2, 3, 4, 5],
					geoXy: {
						x: 20,
						y: 20.3,
					},
					geoTuple: [20, 20.3],
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
						a: [1, 5, 10, 25, 40],
						id: 1,
						name: 'FirstUser',
						email: 'userOne@notmail.com',
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:41.785Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'FirstUserProf',
						initials: 'FU',
						isConfirmed: true,
						vector: [1, 2, 3, 4, 5],
						geoXy: {
							x: 20,
							y: 20.3,
						},
						geoTuple: [20, 20.3],
					},
				},
			},
		});
	});

	it.skip(`Select array with relations`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				users {
					a
					id
					name
					email
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					vector
					geoXy {
						x
						y
					}
					geoTuple
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
						a
						id
						name
						email
						birthdayString
						birthdayDate
						createdAt
						role
						roleText
						roleText2
						profession
						initials
						isConfirmed
						vector
						geoXy {
							x
							y
						}
						geoTuple
					}
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				users: [
					{
						a: [1, 5, 10, 25, 40],
						id: 1,
						name: 'FirstUser',
						email: 'userOne@notmail.com',
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:41.785Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'FirstUserProf',
						initials: 'FU',
						isConfirmed: true,
						vector: [1, 2, 3, 4, 5],
						geoXy: {
							x: 20,
							y: 20.3,
						},
						geoTuple: [20, 20.3],
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
						a: null,
						id: 2,
						name: 'SecondUser',
						email: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:41.785Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						posts: [],
						vector: null,
						geoXy: null,
						geoTuple: null,
					},
					{
						a: null,
						id: 5,
						name: 'FifthUser',
						email: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:41.785Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						vector: null,
						geoXy: null,
						geoTuple: null,
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
							a: [1, 5, 10, 25, 40],
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:41.785Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
							vector: [1, 2, 3, 4, 5],
							geoXy: {
								x: 20,
								y: 20.3,
							},
							geoTuple: [20, 20.3],
						},
					},
					{
						id: 2,
						authorId: 1,
						content: '2MESSAGE',
						author: {
							a: [1, 5, 10, 25, 40],
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:41.785Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
							vector: [1, 2, 3, 4, 5],
							geoXy: {
								x: 20,
								y: 20.3,
							},
							geoTuple: [20, 20.3],
						},
					},
					{
						id: 3,
						authorId: 1,
						content: '3MESSAGE',
						author: {
							a: [1, 5, 10, 25, 40],
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:41.785Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
							vector: [1, 2, 3, 4, 5],
							geoXy: {
								x: 20,
								y: 20.3,
							},
							geoTuple: [20, 20.3],
						},
					},
					{
						id: 4,
						authorId: 5,
						content: '1MESSAGE',
						author: {
							a: null,
							id: 5,
							name: 'FifthUser',
							email: null,
							birthdayString: null,
							birthdayDate: null,
							createdAt: '2024-04-02T06:44:41.785Z',
							role: null,
							roleText: null,
							roleText2: 'user',
							profession: null,
							initials: null,
							isConfirmed: null,
							vector: null,
							geoXy: null,
							geoTuple: null,
						},
					},
					{
						id: 5,
						authorId: 5,
						content: '2MESSAGE',
						author: {
							a: null,
							id: 5,
							name: 'FifthUser',
							email: null,
							birthdayString: null,
							birthdayDate: null,
							createdAt: '2024-04-02T06:44:41.785Z',
							role: null,
							roleText: null,
							roleText2: 'user',
							profession: null,
							initials: null,
							isConfirmed: null,
							vector: null,
							geoXy: null,
							geoTuple: null,
						},
					},
					{
						id: 6,
						authorId: 1,
						content: '4MESSAGE',
						author: {
							a: [1, 5, 10, 25, 40],
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:41.785Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
							vector: [1, 2, 3, 4, 5],
							geoXy: {
								x: 20,
								y: 20.3,
							},
							geoTuple: [20, 20.3],
						},
					},
				],
			},
		});
	});
	it(`Select single by fragment`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			query testQuery {
				usersSingle {
					...UsersFrag
				}

				postsSingle {
					...PostsFrag
				}
			}

			fragment UsersFrag on UsersSelectItem {
				a
				id
				name
				email
				birthdayString
				birthdayDate
				createdAt
				role
				roleText
				roleText2
				profession
				initials
				isConfirmed
				vector
				geoXy {
					x
					y
				}
				geoTuple
			}

			fragment PostsFrag on PostsSelectItem {
				id
				authorId
				content
			}
		`);

		expect(res).toStrictEqual({
			data: {
				usersSingle: {
					a: [1, 5, 10, 25, 40],
					id: 1,
					name: 'FirstUser',
					email: 'userOne@notmail.com',
					birthdayString: '2024-04-02',
					birthdayDate: '2024-04-02T00:00:00.000Z',
					createdAt: '2024-04-02T06:44:41.785Z',
					role: 'admin',
					roleText: null,
					roleText2: 'user',
					profession: 'FirstUserProf',
					initials: 'FU',
					isConfirmed: true,
					vector: [1, 2, 3, 4, 5],
					geoXy: {
						x: 20,
						y: 20.3,
					},
					geoTuple: [20, 20.3],
				},
				postsSingle: {
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
				users {
					...UsersFrag
				}

				posts {
					...PostsFrag
				}
			}

			fragment UsersFrag on UsersSelectItem {
				a
				id
				name
				email
				birthdayString
				birthdayDate
				createdAt
				role
				roleText
				roleText2
				profession
				initials
				isConfirmed
				vector
				geoXy {
					x
					y
				}
				geoTuple
			}

			fragment PostsFrag on PostsSelectItem {
				id
				authorId
				content
			}
		`);

		expect(res).toStrictEqual({
			data: {
				users: [
					{
						a: [1, 5, 10, 25, 40],
						id: 1,
						name: 'FirstUser',
						email: 'userOne@notmail.com',
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:41.785Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'FirstUserProf',
						initials: 'FU',
						isConfirmed: true,
						vector: [1, 2, 3, 4, 5],
						geoXy: {
							x: 20,
							y: 20.3,
						},
						geoTuple: [20, 20.3],
					},
					{
						a: null,
						id: 2,
						name: 'SecondUser',
						email: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:41.785Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						vector: null,
						geoXy: null,
						geoTuple: null,
					},
					{
						a: null,
						id: 5,
						name: 'FifthUser',
						email: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:41.785Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						vector: null,
						geoXy: null,
						geoTuple: null,
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

	it.skip(`Select single with relations by fragment`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			query testQuery {
				usersSingle {
					...UsersFrag
				}

				postsSingle {
					...PostsFrag
				}
			}

			fragment UsersFrag on UsersSelectItem {
				a
				id
				name
				email
				birthdayString
				birthdayDate
				createdAt
				role
				roleText
				roleText2
				profession
				initials
				isConfirmed
				vector
				geoXy {
					x
					y
				}
				geoTuple
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
					a
					id
					name
					email
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					vector
					geoXy {
						x
						y
					}
					geoTuple
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				usersSingle: {
					a: [1, 5, 10, 25, 40],
					id: 1,
					name: 'FirstUser',
					email: 'userOne@notmail.com',
					birthdayString: '2024-04-02',
					birthdayDate: '2024-04-02T00:00:00.000Z',
					createdAt: '2024-04-02T06:44:41.785Z',
					role: 'admin',
					roleText: null,
					roleText2: 'user',
					profession: 'FirstUserProf',
					initials: 'FU',
					isConfirmed: true,
					vector: [1, 2, 3, 4, 5],
					geoXy: {
						x: 20,
						y: 20.3,
					},
					geoTuple: [20, 20.3],
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
						a: [1, 5, 10, 25, 40],
						id: 1,
						name: 'FirstUser',
						email: 'userOne@notmail.com',
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:41.785Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'FirstUserProf',
						initials: 'FU',
						isConfirmed: true,
						vector: [1, 2, 3, 4, 5],
						geoXy: {
							x: 20,
							y: 20.3,
						},
						geoTuple: [20, 20.3],
					},
				},
			},
		});
	});

	it.skip(`Select array with relations by fragment`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			query testQuery {
				users {
					...UsersFrag
				}

				posts {
					...PostsFrag
				}
			}

			fragment UsersFrag on UsersSelectItem {
				a
				id
				name
				email
				birthdayString
				birthdayDate
				createdAt
				role
				roleText
				roleText2
				profession
				initials
				isConfirmed
				vector
				geoXy {
					x
					y
				}
				geoTuple
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
					a
					id
					name
					email
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					vector
					geoXy {
						x
						y
					}
					geoTuple
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				users: [
					{
						a: [1, 5, 10, 25, 40],
						id: 1,
						name: 'FirstUser',
						email: 'userOne@notmail.com',
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:41.785Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'FirstUserProf',
						initials: 'FU',
						isConfirmed: true,
						vector: [1, 2, 3, 4, 5],
						geoXy: {
							x: 20,
							y: 20.3,
						},
						geoTuple: [20, 20.3],
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
						a: null,
						id: 2,
						name: 'SecondUser',
						email: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:41.785Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						posts: [],
						vector: null,
						geoXy: null,
						geoTuple: null,
					},
					{
						a: null,
						id: 5,
						name: 'FifthUser',
						email: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:41.785Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						vector: null,
						geoXy: null,
						geoTuple: null,
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
							a: [1, 5, 10, 25, 40],
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:41.785Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
							vector: [1, 2, 3, 4, 5],
							geoXy: {
								x: 20,
								y: 20.3,
							},
							geoTuple: [20, 20.3],
						},
					},
					{
						id: 2,
						authorId: 1,
						content: '2MESSAGE',
						author: {
							a: [1, 5, 10, 25, 40],
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:41.785Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
							vector: [1, 2, 3, 4, 5],
							geoXy: {
								x: 20,
								y: 20.3,
							},
							geoTuple: [20, 20.3],
						},
					},
					{
						id: 3,
						authorId: 1,
						content: '3MESSAGE',
						author: {
							a: [1, 5, 10, 25, 40],
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:41.785Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
							vector: [1, 2, 3, 4, 5],
							geoXy: {
								x: 20,
								y: 20.3,
							},
							geoTuple: [20, 20.3],
						},
					},
					{
						id: 4,
						authorId: 5,
						content: '1MESSAGE',
						author: {
							a: null,
							id: 5,
							name: 'FifthUser',
							email: null,
							birthdayString: null,
							birthdayDate: null,
							createdAt: '2024-04-02T06:44:41.785Z',
							role: null,
							roleText: null,
							roleText2: 'user',
							profession: null,
							initials: null,
							isConfirmed: null,
							vector: null,
							geoXy: null,
							geoTuple: null,
						},
					},
					{
						id: 5,
						authorId: 5,
						content: '2MESSAGE',
						author: {
							a: null,
							id: 5,
							name: 'FifthUser',
							email: null,
							birthdayString: null,
							birthdayDate: null,
							createdAt: '2024-04-02T06:44:41.785Z',
							role: null,
							roleText: null,
							roleText2: 'user',
							profession: null,
							initials: null,
							isConfirmed: null,
							vector: null,
							geoXy: null,
							geoTuple: null,
						},
					},
					{
						id: 6,
						authorId: 1,
						content: '4MESSAGE',
						author: {
							a: [1, 5, 10, 25, 40],
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:41.785Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
							vector: [1, 2, 3, 4, 5],
							geoXy: {
								x: 20,
								y: 20.3,
							},
							geoTuple: [20, 20.3],
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
						a: [1, 5, 10, 25, 40]
						id: 3
						name: "ThirdUser"
						email: "userThree@notmail.com"
						birthdayString: "2024-04-02T06:44:41.785Z"
						birthdayDate: "2024-04-02T06:44:41.785Z"
						createdAt: "2024-04-02T06:44:41.785Z"
						role: admin
						roleText: null
						profession: "ThirdUserProf"
						initials: "FU"
						isConfirmed: true
						vector: [1, 2, 3, 4, 5]
						geoXy: {
							x: 20
							y: 20.3
						}
						geoTuple: [20, 20.3]
					}
				) {
					a
					id
					name
					email
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					vector
					geoXy {
						x
						y
					}
					geoTuple
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				insertIntoUsersSingle: {
					a: [1, 5, 10, 25, 40],
					id: 3,
					name: 'ThirdUser',
					email: 'userThree@notmail.com',
					birthdayString: '2024-04-02',
					birthdayDate: '2024-04-02T00:00:00.000Z',
					createdAt: '2024-04-02T06:44:41.785Z',
					role: 'admin',
					roleText: null,
					roleText2: 'user',
					profession: 'ThirdUserProf',
					initials: 'FU',
					isConfirmed: true,
					vector: [1, 2, 3, 4, 5],
					geoXy: {
						x: 20,
						y: 20.3,
					},
					geoTuple: [20, 20.3],
				},
			},
		});
	});

	it(`Insert array`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				insertIntoUsers(
					values: [
						{
							a: [1, 5, 10, 25, 40]
							id: 3
							name: "ThirdUser"
							email: "userThree@notmail.com"
							birthdayString: "2024-04-02T06:44:41.785Z"
							birthdayDate: "2024-04-02T06:44:41.785Z"
							createdAt: "2024-04-02T06:44:41.785Z"
							role: admin
							roleText: null
							profession: "ThirdUserProf"
							initials: "FU"
							isConfirmed: true
							vector: [1, 2, 3, 4, 5]
							geoXy: {
								x: 20
								y: 20.3
							}
							geoTuple: [20, 20.3]
						}
						{
							a: [1, 5, 10, 25, 40]
							id: 4
							name: "FourthUser"
							email: "userFour@notmail.com"
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
					a
					id
					name
					email
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					vector
					geoXy {
						x
						y
					}
					geoTuple
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				insertIntoUsers: [
					{
						a: [1, 5, 10, 25, 40],
						id: 3,
						name: 'ThirdUser',
						email: 'userThree@notmail.com',
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:41.785Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'ThirdUserProf',
						initials: 'FU',
						isConfirmed: true,
						vector: [1, 2, 3, 4, 5],
						geoXy: {
							x: 20,
							y: 20.3,
						},
						geoTuple: [20, 20.3],
					},
					{
						a: [1, 5, 10, 25, 40],
						id: 4,
						name: 'FourthUser',
						email: 'userFour@notmail.com',
						birthdayString: '2024-04-04',
						birthdayDate: '2024-04-04T00:00:00.000Z',
						createdAt: '2024-04-04T06:44:41.785Z',
						role: 'user',
						roleText: null,
						roleText2: 'user',
						profession: 'FourthUserProf',
						initials: 'SU',
						isConfirmed: false,
						vector: null,
						geoXy: null,
						geoTuple: null,
					},
				],
			},
		});
	});

	it(`Update`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				updateCustomers(set: { isConfirmed: true, address: "Edited" }) {
					id
					address
					isConfirmed
					registrationDate
					userId
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				updateCustomers: [
					{
						id: 1,
						address: 'Edited',
						isConfirmed: true,
						registrationDate: '2024-03-27T03:54:45.235Z',
						userId: 1,
					},
					{
						id: 2,
						address: 'Edited',
						isConfirmed: true,
						registrationDate: '2024-03-27T03:55:42.358Z',
						userId: 2,
					},
				],
			},
		});
	});

	it(`Delete`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				deleteFromCustomers {
					id
					address
					isConfirmed
					registrationDate
					userId
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				deleteFromCustomers: [
					{
						id: 1,
						address: 'AdOne',
						isConfirmed: false,
						registrationDate: '2024-03-27T03:54:45.235Z',
						userId: 1,
					},
					{
						id: 2,
						address: 'AdTwo',
						isConfirmed: false,
						registrationDate: '2024-03-27T03:55:42.358Z',
						userId: 2,
					},
				],
			},
		});
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
					id
					authorId
					content
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				updatePosts: [
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
				],
			},
		});
	});

	it('Delete filters', async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				deleteFromPosts(where: { OR: [{ id: { lte: 3 } }, { authorId: { eq: 5 } }] }) {
					id
					authorId
					content
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				deleteFromPosts: [
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
					posts(where: { content: { ilike: "2%" } }) {
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
								type: z.instanceof(GraphQLNonNull),
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
								type: z.instanceof(GraphQLNonNull),
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
								type: z.instanceof(GraphQLNonNull),
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
								type: z.instanceof(GraphQLNonNull),
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
								type: z.instanceof(GraphQLNonNull),
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
								type: z.instanceof(GraphQLNonNull),
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
								type: z.instanceof(GraphQLNonNull),
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
								type: z.instanceof(GraphQLNonNull),
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
								type: z.instanceof(GraphQLNonNull),
							})
							.strict(),
					})
					.strict(),
				types: z
					.object({
						UsersItem: z.instanceof(GraphQLObjectType),
						UsersSelectItem: z.instanceof(GraphQLObjectType),
						PostsItem: z.instanceof(GraphQLObjectType),
						PostsSelectItem: z.instanceof(GraphQLObjectType),
						CustomersItem: z.instanceof(GraphQLObjectType),
						CustomersSelectItem: z.instanceof(GraphQLObjectType),
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
					type: GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLObjectType>>>;
					args: {
						values: {
							type: GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLInputObjectType>>>;
						};
					};
					resolve: InsertArrResolver<typeof schema.Customers, false>;
				};
				readonly insertIntoPosts: {
					type: GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLObjectType>>>;
					args: {
						values: {
							type: GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLInputObjectType>>>;
						};
					};
					resolve: InsertArrResolver<typeof schema.Posts, false>;
				};
				readonly insertIntoUsers: {
					type: GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLObjectType>>>;
					args: {
						values: {
							type: GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLInputObjectType>>>;
						};
					};
					resolve: InsertArrResolver<typeof schema.Users, false>;
				};
			} & {
				readonly insertIntoCustomersSingle: {
					type: GraphQLObjectType;
					args: {
						values: {
							type: GraphQLNonNull<GraphQLInputObjectType>;
						};
					};
					resolve: InsertResolver<typeof schema.Customers, false>;
				};
				readonly insertIntoPostsSingle: {
					type: GraphQLObjectType;
					args: {
						values: {
							type: GraphQLNonNull<GraphQLInputObjectType>;
						};
					};
					resolve: InsertResolver<typeof schema.Posts, false>;
				};
				readonly insertIntoUsersSingle: {
					type: GraphQLObjectType;
					args: {
						values: {
							type: GraphQLNonNull<GraphQLInputObjectType>;
						};
					};
					resolve: InsertResolver<typeof schema.Users, false>;
				};
			} & {
				readonly updateCustomers: {
					type: GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLObjectType>>>;
					args: {
						set: {
							type: GraphQLNonNull<GraphQLInputObjectType>;
						};
						where: { type: GraphQLInputObjectType };
					};
					resolve: UpdateResolver<typeof schema.Customers, false>;
				};
				readonly updatePosts: {
					type: GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLObjectType>>>;
					args: {
						set: {
							type: GraphQLNonNull<GraphQLInputObjectType>;
						};
						where: { type: GraphQLInputObjectType };
					};
					resolve: UpdateResolver<typeof schema.Posts, false>;
				};
				readonly updateUsers: {
					type: GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLObjectType>>>;
					args: {
						set: {
							type: GraphQLNonNull<GraphQLInputObjectType>;
						};
						where: { type: GraphQLInputObjectType };
					};
					resolve: UpdateResolver<typeof schema.Users, false>;
				};
			} & {
				readonly deleteFromCustomers: {
					type: GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLObjectType>>>;
					args: {
						where: { type: GraphQLInputObjectType };
					};
					resolve: DeleteResolver<typeof schema.Customers, false>;
				};
				readonly deleteFromPosts: {
					type: GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLObjectType>>>;
					args: {
						where: { type: GraphQLInputObjectType };
					};
					resolve: DeleteResolver<typeof schema.Posts, false>;
				};
				readonly deleteFromUsers: {
					type: GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLObjectType>>>;
					args: {
						where: { type: GraphQLInputObjectType };
					};
					resolve: DeleteResolver<typeof schema.Users, false>;
				};
			}
		>();
	});

	it('Types', () => {
		expectTypeOf(ctx.entities.types).toEqualTypeOf<
			{
				readonly CustomersItem: GraphQLObjectType;
				readonly PostsItem: GraphQLObjectType;
				readonly UsersItem: GraphQLObjectType;
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
						a: [1, 5, 10, 25, 40]
						id: 3
						name: "ThirdUser"
						email: "userThree@notmail.com"
						birthdayString: "2024-04-02T06:44:41.785Z"
						birthdayDate: "2024-04-02T06:44:41.785Z"
						createdAt: "2024-04-02T06:44:41.785Z"
						role: admin
						roleText: null
						profession: "ThirdUserProf"
						initials: "FU"
						vector: [1, 2, 3, 4, 5]
						geoXy: {
							x: 20
							y: 20.3
						}
						geoTuple: [20, 20.3]
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
					__typename: 'UsersItem',
				},
			},
		});
	});

	it(`Insert array`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				insertIntoUsers(
					values: [
						{
							a: [1, 5, 10, 25, 40]
							id: 3
							name: "ThirdUser"
							email: "userThree@notmail.com"
							birthdayString: "2024-04-02T06:44:41.785Z"
							birthdayDate: "2024-04-02T06:44:41.785Z"
							createdAt: "2024-04-02T06:44:41.785Z"
							role: admin
							roleText: null
							profession: "ThirdUserProf"
							initials: "FU"
							isConfirmed: true
							vector: [1, 2, 3, 4, 5]
							geoXy: {
								x: 20
								y: 20.3
							}
							geoTuple: [20, 20.3]
						}
						{
							a: [1, 5, 10, 25, 40]
							id: 4
							name: "FourthUser"
							email: "userFour@notmail.com"
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
				insertIntoUsers: [
					{
						__typename: 'UsersItem',
					},
					{
						__typename: 'UsersItem',
					},
				],
			},
		});
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
				updateCustomers: [
					{
						__typename: 'CustomersItem',
					},
					{
						__typename: 'CustomersItem',
					},
				],
			},
		});
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
				deleteFromCustomers: [
					{
						__typename: 'CustomersItem',
					},
					{
						__typename: 'CustomersItem',
					},
				],
			},
		});
	});
});
describe.sequential('__typename with data tests', async () => {
	it(`Select single`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				usersSingle {
					a
					id
					name
					email
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					vector
					geoXy {
						x
						y
					}
					geoTuple
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
					a: [1, 5, 10, 25, 40],
					id: 1,
					name: 'FirstUser',
					email: 'userOne@notmail.com',
					birthdayString: '2024-04-02',
					birthdayDate: '2024-04-02T00:00:00.000Z',
					createdAt: '2024-04-02T06:44:41.785Z',
					role: 'admin',
					roleText: null,
					roleText2: 'user',
					profession: 'FirstUserProf',
					initials: 'FU',
					isConfirmed: true,
					vector: [1, 2, 3, 4, 5],
					geoXy: {
						x: 20,
						y: 20.3,
					},
					geoTuple: [20, 20.3],
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
					a
					id
					name
					email
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					vector
					geoXy {
						x
						y
					}
					geoTuple
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
						a: [1, 5, 10, 25, 40],
						id: 1,
						name: 'FirstUser',
						email: 'userOne@notmail.com',
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:41.785Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'FirstUserProf',
						initials: 'FU',
						isConfirmed: true,
						vector: [1, 2, 3, 4, 5],
						geoXy: {
							x: 20,
							y: 20.3,
						},
						geoTuple: [20, 20.3],
						__typename: 'UsersSelectItem',
					},
					{
						a: null,
						id: 2,
						name: 'SecondUser',
						email: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:41.785Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						vector: null,
						geoXy: null,
						geoTuple: null,
						__typename: 'UsersSelectItem',
					},
					{
						a: null,
						id: 5,
						name: 'FifthUser',
						email: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:41.785Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						vector: null,
						geoXy: null,
						geoTuple: null,
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

	it.skip(`Select single with relations`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				usersSingle {
					a
					id
					name
					email
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					vector
					geoXy {
						x
						y
					}
					geoTuple
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
						a
						id
						name
						email
						birthdayString
						birthdayDate
						createdAt
						role
						roleText
						roleText2
						profession
						initials
						isConfirmed
						vector
						geoXy {
							x
							y
						}
						geoTuple
						__typename
					}
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				usersSingle: {
					a: [1, 5, 10, 25, 40],
					id: 1,
					name: 'FirstUser',
					email: 'userOne@notmail.com',
					birthdayString: '2024-04-02',
					birthdayDate: '2024-04-02T00:00:00.000Z',
					createdAt: '2024-04-02T06:44:41.785Z',
					role: 'admin',
					roleText: null,
					roleText2: 'user',
					profession: 'FirstUserProf',
					initials: 'FU',
					isConfirmed: true,
					vector: [1, 2, 3, 4, 5],
					geoXy: {
						x: 20,
						y: 20.3,
					},
					geoTuple: [20, 20.3],
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
						a: [1, 5, 10, 25, 40],
						id: 1,
						name: 'FirstUser',
						email: 'userOne@notmail.com',
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:41.785Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'FirstUserProf',
						initials: 'FU',
						isConfirmed: true,
						vector: [1, 2, 3, 4, 5],
						geoXy: {
							x: 20,
							y: 20.3,
						},
						geoTuple: [20, 20.3],
						__typename: 'PostsAuthorRelation',
					},
				},
			},
		});
	});

	it.skip(`Select array with relations`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				users {
					a
					id
					name
					email
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					vector
					geoXy {
						x
						y
					}
					geoTuple
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
						a
						id
						name
						email
						birthdayString
						birthdayDate
						createdAt
						role
						roleText
						roleText2
						profession
						initials
						isConfirmed
						vector
						geoXy {
							x
							y
						}
						geoTuple
						__typename
					}
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				users: [
					{
						a: [1, 5, 10, 25, 40],
						id: 1,
						name: 'FirstUser',
						email: 'userOne@notmail.com',
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:41.785Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'FirstUserProf',
						initials: 'FU',
						isConfirmed: true,
						vector: [1, 2, 3, 4, 5],
						geoXy: {
							x: 20,
							y: 20.3,
						},
						geoTuple: [20, 20.3],
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
						a: null,
						id: 2,
						name: 'SecondUser',
						email: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:41.785Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						vector: null,
						geoXy: null,
						geoTuple: null,
						__typename: 'UsersSelectItem',
						posts: [],
					},
					{
						a: null,
						id: 5,
						name: 'FifthUser',
						email: null,
						birthdayString: null,
						birthdayDate: null,
						createdAt: '2024-04-02T06:44:41.785Z',
						role: null,
						roleText: null,
						roleText2: 'user',
						profession: null,
						initials: null,
						isConfirmed: null,
						vector: null,
						geoXy: null,
						geoTuple: null,
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
							a: [1, 5, 10, 25, 40],
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:41.785Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
							vector: [1, 2, 3, 4, 5],
							geoXy: {
								x: 20,
								y: 20.3,
							},
							geoTuple: [20, 20.3],
							__typename: 'PostsAuthorRelation',
						},
					},
					{
						id: 2,
						authorId: 1,
						content: '2MESSAGE',
						__typename: 'PostsSelectItem',
						author: {
							a: [1, 5, 10, 25, 40],
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:41.785Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
							vector: [1, 2, 3, 4, 5],
							geoXy: {
								x: 20,
								y: 20.3,
							},
							geoTuple: [20, 20.3],
							__typename: 'PostsAuthorRelation',
						},
					},
					{
						id: 3,
						authorId: 1,
						content: '3MESSAGE',
						__typename: 'PostsSelectItem',
						author: {
							a: [1, 5, 10, 25, 40],
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:41.785Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
							vector: [1, 2, 3, 4, 5],
							geoXy: {
								x: 20,
								y: 20.3,
							},
							geoTuple: [20, 20.3],
							__typename: 'PostsAuthorRelation',
						},
					},
					{
						id: 4,
						authorId: 5,
						content: '1MESSAGE',
						__typename: 'PostsSelectItem',
						author: {
							a: null,
							id: 5,
							name: 'FifthUser',
							email: null,
							birthdayString: null,
							birthdayDate: null,
							createdAt: '2024-04-02T06:44:41.785Z',
							role: null,
							roleText: null,
							roleText2: 'user',
							profession: null,
							initials: null,
							isConfirmed: null,
							vector: null,
							geoXy: null,
							geoTuple: null,
							__typename: 'PostsAuthorRelation',
						},
					},
					{
						id: 5,
						authorId: 5,
						content: '2MESSAGE',
						__typename: 'PostsSelectItem',
						author: {
							a: null,
							id: 5,
							name: 'FifthUser',
							email: null,
							birthdayString: null,
							birthdayDate: null,
							createdAt: '2024-04-02T06:44:41.785Z',
							role: null,
							roleText: null,
							roleText2: 'user',
							profession: null,
							initials: null,
							isConfirmed: null,
							vector: null,
							geoXy: null,
							geoTuple: null,
							__typename: 'PostsAuthorRelation',
						},
					},
					{
						id: 6,
						authorId: 1,
						content: '4MESSAGE',
						__typename: 'PostsSelectItem',
						author: {
							a: [1, 5, 10, 25, 40],
							id: 1,
							name: 'FirstUser',
							email: 'userOne@notmail.com',
							birthdayString: '2024-04-02',
							birthdayDate: '2024-04-02T00:00:00.000Z',
							createdAt: '2024-04-02T06:44:41.785Z',
							role: 'admin',
							roleText: null,
							roleText2: 'user',
							profession: 'FirstUserProf',
							initials: 'FU',
							isConfirmed: true,
							vector: [1, 2, 3, 4, 5],
							geoXy: {
								x: 20,
								y: 20.3,
							},
							geoTuple: [20, 20.3],
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
						a: [1, 5, 10, 25, 40]
						id: 3
						name: "ThirdUser"
						email: "userThree@notmail.com"
						birthdayString: "2024-04-02T06:44:41.785Z"
						birthdayDate: "2024-04-02T06:44:41.785Z"
						createdAt: "2024-04-02T06:44:41.785Z"
						role: admin
						roleText: null
						profession: "ThirdUserProf"
						initials: "FU"
						isConfirmed: true
						vector: [1, 2, 3, 4, 5]
						geoXy: {
							x: 20
							y: 20.3
						},
						geoTuple: [20, 20.3]
					}
				) {
					a
					id
					name
					email
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					vector
					geoXy {
						x
						y
					}
					geoTuple
					__typename
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				insertIntoUsersSingle: {
					a: [1, 5, 10, 25, 40],
					id: 3,
					name: 'ThirdUser',
					email: 'userThree@notmail.com',
					birthdayString: '2024-04-02',
					birthdayDate: '2024-04-02T00:00:00.000Z',
					createdAt: '2024-04-02T06:44:41.785Z',
					role: 'admin',
					roleText: null,
					roleText2: 'user',
					profession: 'ThirdUserProf',
					initials: 'FU',
					isConfirmed: true,
					vector: [1, 2, 3, 4, 5],
					geoXy: {
						x: 20,
						y: 20.3,
					},
					geoTuple: [20, 20.3],
					__typename: 'UsersItem',
				},
			},
		});
	});

	it(`Insert array`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				insertIntoUsers(
					values: [
						{
							a: [1, 5, 10, 25, 40]
							id: 3
							name: "ThirdUser"
							email: "userThree@notmail.com"
							birthdayString: "2024-04-02T06:44:41.785Z"
							birthdayDate: "2024-04-02T06:44:41.785Z"
							createdAt: "2024-04-02T06:44:41.785Z"
							role: admin
							roleText: null
							profession: "ThirdUserProf"
							initials: "FU"
							isConfirmed: true
							vector: [1, 2, 3, 4, 5]
							geoXy: {
								x: 20
								y: 20.3
							}
							geoTuple: [20, 20.3]
						}
						{
							a: [1, 5, 10, 25, 40]
							id: 4
							name: "FourthUser"
							email: "userFour@notmail.com"
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
					a
					id
					name
					email
					birthdayString
					birthdayDate
					createdAt
					role
					roleText
					roleText2
					profession
					initials
					isConfirmed
					vector
					geoXy {
						x
						y
					}
					geoTuple
					__typename
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				insertIntoUsers: [
					{
						a: [1, 5, 10, 25, 40],
						id: 3,
						name: 'ThirdUser',
						email: 'userThree@notmail.com',
						birthdayString: '2024-04-02',
						birthdayDate: '2024-04-02T00:00:00.000Z',
						createdAt: '2024-04-02T06:44:41.785Z',
						role: 'admin',
						roleText: null,
						roleText2: 'user',
						profession: 'ThirdUserProf',
						initials: 'FU',
						isConfirmed: true,
						vector: [1, 2, 3, 4, 5],
						geoXy: {
							x: 20,
							y: 20.3,
						},
						geoTuple: [20, 20.3],
						__typename: 'UsersItem',
					},
					{
						a: [1, 5, 10, 25, 40],
						id: 4,
						name: 'FourthUser',
						email: 'userFour@notmail.com',
						birthdayString: '2024-04-04',
						birthdayDate: '2024-04-04T00:00:00.000Z',
						createdAt: '2024-04-04T06:44:41.785Z',
						role: 'user',
						roleText: null,
						roleText2: 'user',
						profession: 'FourthUserProf',
						initials: 'SU',
						isConfirmed: false,
						vector: null,
						geoXy: null,
						geoTuple: null,
						__typename: 'UsersItem',
					},
				],
			},
		});
	});

	it(`Update`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				updateCustomers(set: { isConfirmed: true, address: "Edited" }) {
					id
					address
					isConfirmed
					registrationDate
					userId
					__typename
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				updateCustomers: [
					{
						id: 1,
						address: 'Edited',
						isConfirmed: true,
						registrationDate: '2024-03-27T03:54:45.235Z',
						userId: 1,
						__typename: 'CustomersItem',
					},
					{
						id: 2,
						address: 'Edited',
						isConfirmed: true,
						registrationDate: '2024-03-27T03:55:42.358Z',
						userId: 2,
						__typename: 'CustomersItem',
					},
				],
			},
		});
	});

	it(`Delete`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			mutation {
				deleteFromCustomers {
					id
					address
					isConfirmed
					registrationDate
					userId
					__typename
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				deleteFromCustomers: [
					{
						id: 1,
						address: 'AdOne',
						isConfirmed: false,
						registrationDate: '2024-03-27T03:54:45.235Z',
						userId: 1,
						__typename: 'CustomersItem',
					},
					{
						id: 2,
						address: 'AdTwo',
						isConfirmed: false,
						registrationDate: '2024-03-27T03:55:42.358Z',
						userId: 2,
						__typename: 'CustomersItem',
					},
				],
			},
		});
	});
});
