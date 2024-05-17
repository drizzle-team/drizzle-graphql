import { is } from 'drizzle-orm';
import { MySqlDatabase } from 'drizzle-orm/mysql-core';
import { PgDatabase } from 'drizzle-orm/pg-core';
import { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { GraphQLInputObjectType, GraphQLObjectType, GraphQLSchema, GraphQLSchemaConfig } from 'graphql';

import { generateMySQL, generatePG, generateSQLite } from '@/util/builders';
import type { AnyDrizzleDB, BuildSchemaConfig, GeneratedData } from './types';

export const buildSchema = <TDbClient extends AnyDrizzleDB<any>>(
	db: TDbClient,
	config?: BuildSchemaConfig,
): GeneratedData<TDbClient> => {
	const schema = db._.fullSchema;
	if (!schema) {
		throw new Error(
			"Schema not found in drizzle instance. Make sure you're using drizzle-orm v0.30.9 or above and schema is passed to drizzle constructor!",
		);
	}

	let generatorOutput;
	if (is(db, MySqlDatabase)) {
		generatorOutput = generateMySQL(db, schema);
	} else if (is(db, PgDatabase)) {
		generatorOutput = generatePG(db, schema);
	} else if (is(db, BaseSQLiteDatabase)) {
		generatorOutput = generateSQLite(db, schema);
	} else throw new Error('Unknown database instance type');

	const { queries, mutations, inputs, types } = generatorOutput;

	const graphQLSchemaConfig: GraphQLSchemaConfig = {
		types: [...Object.values(inputs), ...Object.values(types)] as (GraphQLInputObjectType | GraphQLObjectType)[],
		query: new GraphQLObjectType({
			name: 'Query',
			fields: queries,
		}),
	};

	if (config?.mutations !== false) {
		const mutation = new GraphQLObjectType({
			name: 'Mutation',
			fields: mutations,
		});

		graphQLSchemaConfig.mutation = mutation;
	}

	const outputSchema = new GraphQLSchema(graphQLSchemaConfig);

	return { schema: outputSchema, entities: generatorOutput };
};

export * from './types';
