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
import { type Client, createClient } from '@libsql/client';
import { Relations, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/libsql';
import { type BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
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
import path from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import z from 'zod';
import * as schema from './schema/sqlite';
import { GraphQLClient } from './util/query';

interface Context {
	db: BaseSQLiteDatabase<'async', any, typeof schema>;
	client: Client;
	schema: GraphQLSchema;
	entities: GeneratedEntities<BaseSQLiteDatabase<'async', any, typeof schema>>;
	server: Server;
	gql: GraphQLClient;
}

const ctx: Context = {} as any;

beforeAll(async () => {
	const sleep = 250;
	let timeLeft = 5000;
	let connected = false;
	let lastError: unknown | undefined;

	do {
		try {
			ctx.client = createClient({
				url: `file://${path.join(__dirname, '/.temp/db.sqlite')}`,
			});
			connected = true;
			break;
		} catch (e) {
			lastError = e;
			await new Promise((resolve) => setTimeout(resolve, sleep));
			timeLeft -= sleep;
		}
	} while (timeLeft > 0);

	if (!connected) {
		console.error('Cannot connect to libsql');
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

	const port = 4003;
	server.listen(port);
	const gql = new GraphQLClient(`http://localhost:${port}/graphql`);

	ctx.schema = gqlSchema;
	ctx.entities = entities;
	ctx.server = server;
	ctx.gql = gql;
});

afterAll(async (t) => {
	ctx.client.close();
});

beforeEach(async (t) => {
	await ctx.db.run(sql`CREATE TABLE IF NOT EXISTS \`customers\` (
		\`id\` integer PRIMARY KEY NOT NULL,
		\`address\` text NOT NULL,
		\`is_confirmed\` integer,
		\`registration_date\` integer NOT NULL,
		\`user_id\` integer NOT NULL,
		FOREIGN KEY (\`user_id\`) REFERENCES \`users\`(\`id\`) ON UPDATE no action ON DELETE no action
	);`);

	await ctx.db.run(sql`CREATE TABLE IF NOT EXISTS \`posts\` (
		\`id\` integer PRIMARY KEY NOT NULL,
		\`content\` text,
		\`author_id\` integer
	);`);

	await ctx.db.run(sql`CREATE TABLE IF NOT EXISTS \`users\` (
		\`id\` integer PRIMARY KEY NOT NULL,
		\`name\` text NOT NULL,
		\`email\` text,
		\`text_json\` text,
		\`blob_bigint\` blob,
		\`numeric\` numeric,
		\`created_at\` integer,
		\`created_at_ms\` integer,
		\`real\` real,
		\`text\` text(255),
		\`role\` text DEFAULT 'user',
		\`is_confirmed\` integer
	);`);

	await ctx.db.insert(schema.Users).values([
		{
			id: 1,
			name: 'FirstUser',
			email: 'userOne@notmail.com',
			textJson: { field: 'value' },
			blobBigInt: BigInt(10),
			numeric: '250.2',
			createdAt: new Date('2024-04-02T06:44:41.785Z'),
			createdAtMs: new Date('2024-04-02T06:44:41.785Z'),
			real: 13.5,
			text: 'sometext',
			role: 'admin',
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
	await ctx.db.run(sql`PRAGMA foreign_keys = OFF;`);
	await ctx.db.run(sql`DROP TABLE IF EXISTS \`customers\`;`);
	await ctx.db.run(sql`DROP TABLE IF EXISTS \`posts\`;`);
	await ctx.db.run(sql`DROP TABLE IF EXISTS \`users\`;`);
	await ctx.db.run(sql`PRAGMA foreign_keys = ON;`);
});

describe.sequential('Query tests', async () => {
	it(`Select single`, async () => {
		const res = await ctx.gql.queryGql(/* GraphQL */ `
			{
				usersSingle {
					id
					name
					email
					textJson
					blobBigInt
					numeric
					createdAt
					createdAtMs
					real
					text
					role
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
					textJson: '{"field":"value"}',
					blobBigInt: '10',
					numeric: '250.2',
					createdAt: '2024-04-02T06:44:41.000Z',
					createdAtMs: '2024-04-02T06:44:41.785Z',
					real: 13.5,
					text: 'sometext',
					role: 'admin',
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
					textJson
					blobBigInt
					numeric
					createdAt
					createdAtMs
					real
					text
					role
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
						textJson: '{"field":"value"}',
						blobBigInt: '10',
						numeric: '250.2',
						createdAt: '2024-04-02T06:44:41.000Z',
						createdAtMs: '2024-04-02T06:44:41.785Z',
						real: 13.5,
						text: 'sometext',
						role: 'admin',
						isConfirmed: true,
					},
					{
						id: 2,
						name: 'SecondUser',
						email: null,
						blobBigInt: null,
						textJson: null,
						createdAt: '2024-04-02T06:44:41.000Z',
						createdAtMs: null,
						numeric: null,
						real: null,
						text: null,
						role: 'user',
						isConfirmed: null,
					},
					{
						id: 5,
						name: 'FifthUser',
						email: null,
						createdAt: '2024-04-02T06:44:41.000Z',
						role: 'user',
						blobBigInt: null,
						textJson: null,
						createdAtMs: null,
						numeric: null,
						real: null,
						text: null,
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
					textJson
					blobBigInt
					numeric
					createdAt
					createdAtMs
					real
					text
					role
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
						textJson
						numeric
						createdAt
						createdAtMs
						real
						text
						role
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
					textJson: '{"field":"value"}',
					blobBigInt: '10',
					numeric: '250.2',
					createdAt: '2024-04-02T06:44:41.000Z',
					createdAtMs: '2024-04-02T06:44:41.785Z',
					real: 13.5,
					text: 'sometext',
					role: 'admin',
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
						textJson: '{"field":"value"}',
						// RQB can't handle blobs in JSON, for now
						// blobBigInt: '10',
						numeric: '250.2',
						createdAt: '2024-04-02T06:44:41.000Z',
						createdAtMs: '2024-04-02T06:44:41.785Z',
						real: 13.5,
						text: 'sometext',
						role: 'admin',
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
					textJson
					blobBigInt
					numeric
					createdAt
					createdAtMs
					real
					text
					role
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
						textJson
						numeric
						createdAt
						createdAtMs
						real
						text
						role
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
						textJson: '{"field":"value"}',
						blobBigInt: '10',
						numeric: '250.2',
						createdAt: '2024-04-02T06:44:41.000Z',
						createdAtMs: '2024-04-02T06:44:41.785Z',
						real: 13.5,
						text: 'sometext',
						role: 'admin',
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
						textJson: null,
						blobBigInt: null,
						numeric: null,
						createdAt: '2024-04-02T06:44:41.000Z',
						createdAtMs: null,
						real: null,
						text: null,
						role: 'user',
						isConfirmed: null,
						posts: [],
					},
					{
						id: 5,
						name: 'FifthUser',
						email: null,
						textJson: null,
						blobBigInt: null,
						numeric: null,
						createdAt: '2024-04-02T06:44:41.000Z',
						createdAtMs: null,
						real: null,
						text: null,
						role: 'user',
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
							textJson: '{"field":"value"}',
							// RQB can't handle blobs in JSON, for now
							// blobBigInt: '10',
							numeric: '250.2',
							createdAt: '2024-04-02T06:44:41.000Z',
							createdAtMs: '2024-04-02T06:44:41.785Z',
							real: 13.5,
							text: 'sometext',
							role: 'admin',
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
							textJson: '{"field":"value"}',
							// RQB can't handle blobs in JSON, for now
							// blobBigInt: '10',
							numeric: '250.2',
							createdAt: '2024-04-02T06:44:41.000Z',
							createdAtMs: '2024-04-02T06:44:41.785Z',
							real: 13.5,
							text: 'sometext',
							role: 'admin',
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
							textJson: '{"field":"value"}',
							// RQB can't handle blobs in JSON, for now
							// blobBigInt: '10',
							numeric: '250.2',
							createdAt: '2024-04-02T06:44:41.000Z',
							createdAtMs: '2024-04-02T06:44:41.785Z',
							real: 13.5,
							text: 'sometext',
							role: 'admin',
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
							textJson: null,
							// RQB can't handle blobs in JSON, for now
							// blobBigInt: null,
							numeric: null,
							createdAt: '2024-04-02T06:44:41.000Z',
							createdAtMs: null,
							real: null,
							text: null,
							role: 'user',
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
							textJson: null,
							// RQB can't handle blobs in JSON, for now
							// blobBigInt: null,
							numeric: null,
							createdAt: '2024-04-02T06:44:41.000Z',
							createdAtMs: null,
							real: null,
							text: null,
							role: 'user',
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
							textJson: '{"field":"value"}',
							// RQB can't handle blobs in JSON, for now
							// blobBigInt: '10',
							numeric: '250.2',
							createdAt: '2024-04-02T06:44:41.000Z',
							createdAtMs: '2024-04-02T06:44:41.785Z',
							real: 13.5,
							text: 'sometext',
							role: 'admin',
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
						textJson: "{ \\"field\\": \\"value\\" }"
						blobBigInt: "10"
						numeric: "250.2"
						createdAt: "2024-04-02T06:44:41.785Z"
						createdAtMs: "2024-04-02T06:44:41.785Z"
						real: 13.5
						text: "sometext"
						role: admin
						isConfirmed: true
					}
				) {
					id
					name
					email
					textJson
					blobBigInt
					numeric
					createdAt
					createdAtMs
					real
					text
					role
					isConfirmed
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				insertIntoUsersSingle: {
					id: 3,
					name: 'ThirdUser',
					email: 'userThree@notmail.com',
					textJson: '{"field":"value"}',
					blobBigInt: '10',
					numeric: '250.2',
					createdAt: '2024-04-02T06:44:41.000Z',
					createdAtMs: '2024-04-02T06:44:41.785Z',
					real: 13.5,
					text: 'sometext',
					role: 'admin',
					isConfirmed: true,
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
							id: 3
							name: "ThirdUser"
							email: "userThree@notmail.com"
							textJson: "{ \\"field\\": \\"value\\" }"
							blobBigInt: "10"
							numeric: "250.2"
							createdAt: "2024-04-02T06:44:41.785Z"
							createdAtMs: "2024-04-02T06:44:41.785Z"
							real: 13.5
							text: "sometext"
							role: admin
							isConfirmed: true
						}
						{
							id: 4
							name: "FourthUser"
							email: "userFour@notmail.com"
							textJson: "{ \\"field\\": \\"value\\" }"
							blobBigInt: "10"
							numeric: "250.2"
							createdAt: "2024-04-02T06:44:41.785Z"
							createdAtMs: "2024-04-02T06:44:41.785Z"
							real: 13.5
							text: "sometext"
							role: user
							isConfirmed: false
						}
					]
				) {
					id
					name
					email
					textJson
					blobBigInt
					numeric
					createdAt
					createdAtMs
					real
					text
					role
					isConfirmed
				}
			}
		`);

		expect(res).toStrictEqual({
			data: {
				insertIntoUsers: [
					{
						id: 3,
						name: 'ThirdUser',
						email: 'userThree@notmail.com',
						textJson: '{"field":"value"}',
						blobBigInt: '10',
						numeric: '250.2',
						createdAt: '2024-04-02T06:44:41.000Z',
						createdAtMs: '2024-04-02T06:44:41.785Z',
						real: 13.5,
						text: 'sometext',
						role: 'admin',
						isConfirmed: true,
					},
					{
						id: 4,
						name: 'FourthUser',
						email: 'userFour@notmail.com',
						textJson: '{"field":"value"}',
						blobBigInt: '10',
						numeric: '250.2',
						createdAt: '2024-04-02T06:44:41.000Z',
						createdAtMs: '2024-04-02T06:44:41.785Z',
						real: 13.5,
						text: 'sometext',
						role: 'user',
						isConfirmed: false,
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
					resolve: SelectResolver<typeof schema.Customers, ExtractTables<typeof schema>, never>;
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
					resolve: SelectSingleResolver<typeof schema.Customers, ExtractTables<typeof schema>, never>;
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
