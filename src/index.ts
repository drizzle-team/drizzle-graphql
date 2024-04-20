import { is } from 'drizzle-orm'
import { MySqlDatabase } from 'drizzle-orm/mysql-core'
import { PgDatabase } from 'drizzle-orm/pg-core'
import { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import { GraphQLInputObjectType, GraphQLObjectType, GraphQLSchema } from 'graphql'

import { generateMySQL, generatePG, generateSQLite } from '@/util/builders'
import type { AnyDrizzleDB, GeneratedData } from './types'

export const buildSchema = <TDbClient extends AnyDrizzleDB<any>>(db: TDbClient): GeneratedData<TDbClient> => {
	const schema = db._.fullSchema

	let generatorOutput
	if (is(db, MySqlDatabase)) {
		generatorOutput = generateMySQL(db, schema)
	} else if (is(db, PgDatabase)) {
		generatorOutput = generatePG(db, schema)
	} else if (is(db, BaseSQLiteDatabase)) {
		generatorOutput = generateSQLite(db, schema)
	} else throw new Error('Unknown database instance type')

	const { queries, mutations, inputs, types } = generatorOutput

	const query = new GraphQLObjectType({
		name: 'Query',
		fields: queries
	})

	const mutation = new GraphQLObjectType({
		name: 'Mutation',
		fields: mutations
	})

	const outputSchema = new GraphQLSchema({
		query,
		mutation,
		types: [...Object.values(inputs), ...Object.values(types)] as (GraphQLInputObjectType | GraphQLObjectType)[]
	})

	return { schema: outputSchema, entities: generatorOutput }
}

export * from './types'
