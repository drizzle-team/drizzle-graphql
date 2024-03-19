import { Table, is } from 'drizzle-orm'
import { PgColumn, PgDatabase, PgTable } from 'drizzle-orm/pg-core'
import {
	GraphQLError,
	GraphQLInputObjectType,
	GraphQLInt,
	GraphQLList,
	GraphQLNonNull,
	GraphQLObjectType
} from 'graphql'

import {
	extractFilters,
	extractOrderBy,
	extractSelectedColumnsSQLFormat,
	generateTableTypes
} from '@/Util/Builders/vanilla/common'
import { camelize, pascalize } from '@/Util/caseOps'
import {
	remapFromGraphQLArrayInput,
	remapFromGraphQLSingleInput,
	remapToGraphQLArrayOutput,
	remapToGraphQLSingleOutput
} from '@/Util/dataMappers'

import type { GraphQLFieldConfig, GraphQLFieldConfigArgumentMap, ThunkObjMap } from 'graphql'
import type { GeneratedEntities } from '@/types'
import type { CreatedResolver, Filters, OrderByArgs } from './types'

const generateSelectArray = (
	db: PgDatabase<any, any, any>,
	tableName: string,
	table: PgTable,
	orderArgs: GraphQLInputObjectType,
	filterArgs: GraphQLInputObjectType
): CreatedResolver => {
	const queryName = `${camelize(tableName)}`

	const queryArgs = {
		offset: {
			type: GraphQLInt
		},
		limit: {
			type: GraphQLInt
		},
		orderBy: {
			type: orderArgs
		},
		where: {
			type: filterArgs
		}
	} as const satisfies GraphQLFieldConfigArgumentMap

	return {
		name: queryName,
		resolver: async (
			source,
			args: Partial<{ offset: number; limit: number; where: Filters<Table>; orderBy: OrderByArgs<Table> }>,
			context,
			info
		) => {
			const { offset, limit, orderBy, where } = args

			const columns = extractSelectedColumnsSQLFormat(info, queryName, table) as Record<string, PgColumn>

			let query = db.select(columns).from(table)
			if (where) {
				const filters = extractFilters(table, tableName, where)
				query = query.where(filters) as any
			}
			if (orderBy) {
				const order = extractOrderBy(table, orderBy)
				if (order.length) {
					query = query.orderBy(...order) as any
				}
			}
			if (typeof offset === 'number') {
				query = query.offset(offset) as any
			}
			if (typeof limit === 'number') {
				query = query.limit(limit) as any
			}

			const result = await query

			return remapToGraphQLArrayOutput(result)
		},
		args: queryArgs
	}
}

const generateSelectSingle = (
	db: PgDatabase<any, any, any>,
	tableName: string,
	table: PgTable,
	orderArgs: GraphQLInputObjectType,
	filterArgs: GraphQLInputObjectType
): CreatedResolver => {
	const queryName = `${camelize(tableName)}Single`

	const queryArgs = {
		offset: {
			type: GraphQLInt
		},
		orderBy: {
			type: orderArgs
		},
		where: {
			type: filterArgs
		}
	} as const satisfies GraphQLFieldConfigArgumentMap

	return {
		name: queryName,
		resolver: async (
			source,
			args: Partial<{ offset: number; where: Filters<Table>; orderBy: OrderByArgs<Table> }>,
			context,
			info
		) => {
			const { offset, orderBy, where } = args

			const columns = extractSelectedColumnsSQLFormat(info, queryName, table) as Record<string, PgColumn>

			let query = db.select(columns).from(table)
			if (where) {
				const filters = extractFilters(table, tableName, where)
				query = query.where(filters) as any
			}
			if (orderBy) {
				const order = extractOrderBy(table, orderBy)
				if (order.length) {
					query = query.orderBy(...order) as any
				}
			}
			if (typeof offset === 'number') {
				query = query.offset(offset) as any
			}

			query = query.limit(1) as any

			const result = await query

			if (!result.length) return undefined

			return remapToGraphQLSingleOutput(result[0]!)
		},
		args: queryArgs
	}
}

const generateInsertArray = (
	db: PgDatabase<any, any, any>,
	tableName: string,
	table: PgTable,
	baseType: GraphQLInputObjectType
): CreatedResolver => {
	const queryName = `insertInto${pascalize(tableName)}`

	const queryArgs: GraphQLFieldConfigArgumentMap = {
		values: {
			type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(baseType)))
		}
	}

	return {
		name: queryName,
		resolver: async (source, args: { values: Record<string, any>[] }, context, info) => {
			const input = remapFromGraphQLArrayInput(args.values, table)
			if (!input.length) throw new GraphQLError('No values were provided!')

			const columns = extractSelectedColumnsSQLFormat(info, queryName, table) as Record<string, PgColumn>

			const result = await db.insert(table).values(input).returning(columns).onConflictDoNothing()

			return remapToGraphQLArrayOutput(result)
		},
		args: queryArgs
	}
}

const generateInsertSingle = (
	db: PgDatabase<any, any, any>,
	tableName: string,
	table: PgTable,
	baseType: GraphQLInputObjectType
): CreatedResolver => {
	const queryName = `insertInto${pascalize(tableName)}Single`

	const queryArgs: GraphQLFieldConfigArgumentMap = {
		values: {
			type: new GraphQLNonNull(baseType)
		}
	}

	return {
		name: queryName,
		resolver: async (source, args: { values: Record<string, any> }, context, info) => {
			const input = remapFromGraphQLSingleInput(args.values, table)

			const columns = extractSelectedColumnsSQLFormat(info, queryName, table) as Record<string, PgColumn>

			const result = await db.insert(table).values(input).returning(columns).onConflictDoNothing()

			if (!result[0]) return undefined

			return remapToGraphQLSingleOutput(result[0])
		},
		args: queryArgs
	}
}

const generateUpdate = (
	db: PgDatabase<any, any, any>,
	tableName: string,
	table: PgTable,
	setArgs: GraphQLInputObjectType,
	filterArgs: GraphQLInputObjectType
): CreatedResolver => {
	const queryName = `update${pascalize(tableName)}`

	const queryArgs = {
		set: {
			type: new GraphQLNonNull(setArgs)
		},
		where: {
			type: filterArgs
		}
	} as const satisfies GraphQLFieldConfigArgumentMap

	return {
		name: queryName,
		resolver: async (source, args: { where?: Filters<Table>; set: Record<string, any> }, context, info) => {
			const { where, set } = args

			const columns = extractSelectedColumnsSQLFormat(info, queryName, table) as Record<string, PgColumn>
			const input = remapFromGraphQLSingleInput(set, table)
			if (!Object.keys(input).length) throw new GraphQLError('Unable to update with no values specified!')

			let query = db.update(table).set(input)
			if (where) {
				const filters = extractFilters(table, tableName, where)
				query = query.where(filters) as any
			}

			query = query.returning(columns) as any

			const result = await query

			return remapToGraphQLArrayOutput(result)
		},
		args: queryArgs
	}
}

const generateDelete = (
	db: PgDatabase<any, any, any>,
	tableName: string,
	table: PgTable,
	filterArgs: GraphQLInputObjectType
): CreatedResolver => {
	const queryName = `deleteFrom${pascalize(tableName)}`

	const queryArgs = {
		where: {
			type: filterArgs
		}
	} as const satisfies GraphQLFieldConfigArgumentMap

	return {
		name: queryName,
		resolver: async (source, args: { where?: Filters<Table> }, context, info) => {
			const { where } = args

			const columns = extractSelectedColumnsSQLFormat(info, queryName, table) as Record<string, PgColumn>

			let query = db.delete(table)
			if (where) {
				const filters = extractFilters(table, tableName, where)
				query = query.where(filters) as any
			}

			query = query.returning(columns) as any

			const result = await query

			return remapToGraphQLArrayOutput(result)
		},
		args: queryArgs
	}
}

export const generateSchemaData = <
	TDrizzleInstance extends PgDatabase<any, any, any>,
	TSchema extends Record<string, Table | unknown>
>(
	db: TDrizzleInstance,
	schema: TSchema
): GeneratedEntities<TDrizzleInstance, TSchema> => {
	const rawTables = schema

	const tables = Object.fromEntries(Object.entries(rawTables).filter(([key, value]) => is(value, PgTable))) as Record<
		string,
		Table
	>
	if (!tables || !Object.keys(tables).length)
		throw new Error(
			`Unable to extract tables from drizzle instance.\nDid you forget to pass tables to graphql schema constructor?`
		)

	const queries: ThunkObjMap<GraphQLFieldConfig<any, any>> = {}
	const mutations: ThunkObjMap<GraphQLFieldConfig<any, any>> = {}
	const gqlSchemaTypes = Object.fromEntries(
		Object.entries(tables).map(([tableName, table]) => [tableName, generateTableTypes(tableName, table)])
	)

	const inputs: Record<string, GraphQLInputObjectType> = {}
	const outputs: Record<string, GraphQLObjectType> = {}

	for (const [tableName, tableTypes] of Object.entries(gqlSchemaTypes)) {
		const { insertInput, updateInput, tableFilters, tableOrder } = tableTypes.inputs
		const { selectSingleOutput, selectArrOutput } = tableTypes.outputs

		const selectArrGenerated = generateSelectArray(
			db,
			tableName,
			schema[tableName] as PgTable,
			tableOrder,
			tableFilters
		)
		const selectSingleGenerated = generateSelectSingle(
			db,
			tableName,
			schema[tableName] as PgTable,
			tableOrder,
			tableFilters
		)
		const insertArrGenerated = generateInsertArray(db, tableName, schema[tableName] as PgTable, insertInput)
		const insertSingleGenerated = generateInsertSingle(db, tableName, schema[tableName] as PgTable, insertInput)
		const updateGenerated = generateUpdate(db, tableName, schema[tableName] as PgTable, updateInput, tableFilters)
		const deleteGenerated = generateDelete(db, tableName, schema[tableName] as PgTable, tableFilters)

		queries[selectArrGenerated.name] = {
			type: selectArrOutput,
			args: selectArrGenerated.args,
			resolve: selectArrGenerated.resolver
		}
		queries[selectSingleGenerated.name] = {
			type: selectSingleOutput,
			args: selectSingleGenerated.args,
			resolve: selectSingleGenerated.resolver
		}
		mutations[insertArrGenerated.name] = {
			type: selectArrOutput,
			args: insertArrGenerated.args,
			resolve: insertArrGenerated.resolver
		}
		mutations[insertSingleGenerated.name] = {
			type: selectSingleOutput,
			args: insertSingleGenerated.args,
			resolve: insertSingleGenerated.resolver
		}
		mutations[updateGenerated.name] = {
			type: selectArrOutput,
			args: updateGenerated.args,
			resolve: updateGenerated.resolver
		}
		mutations[deleteGenerated.name] = {
			type: selectArrOutput,
			args: deleteGenerated.args,
			resolve: deleteGenerated.resolver
		}
		;[insertInput, updateInput, tableFilters, tableOrder].forEach((e) => (inputs[e.name] = e))
		outputs[selectSingleOutput.name] = selectSingleOutput
	}

	return { queries, mutations, inputs, types: outputs } as any
}
