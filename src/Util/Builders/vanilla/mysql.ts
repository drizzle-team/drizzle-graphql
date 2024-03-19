import { Table, is } from 'drizzle-orm'
import { MySqlColumn, MySqlDatabase, MySqlTable } from 'drizzle-orm/mysql-core'
import {
	GraphQLBoolean,
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
	db: MySqlDatabase<any, any, any>,
	tableName: string,
	table: MySqlTable,
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

			const columns = extractSelectedColumnsSQLFormat(info, queryName, table) as Record<string, MySqlColumn>

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
	db: MySqlDatabase<any, any, any>,
	tableName: string,
	table: MySqlTable,
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

			const columns = extractSelectedColumnsSQLFormat(info, queryName, table) as Record<string, MySqlColumn>

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
	db: MySqlDatabase<any, any, any, any>,
	tableName: string,
	table: MySqlTable,
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

			try {
				await db.insert(table).values(input)

				return { isSuccess: true }
			} catch (e) {
				return { isSuccess: false }
			}
		},
		args: queryArgs
	}
}

const generateInsertSingle = (
	db: MySqlDatabase<any, any, any, any>,
	tableName: string,
	table: MySqlTable,
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

			try {
				await db.insert(table).values(input)

				return { isSuccess: true }
			} catch (e) {
				return { isSuccess: false }
			}
		},
		args: queryArgs
	}
}

const generateUpdate = (
	db: MySqlDatabase<any, any, any>,
	tableName: string,
	table: MySqlTable,
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

			const input = remapFromGraphQLSingleInput(set, table)
			if (!Object.keys(input).length) throw new GraphQLError('Unable to update with no values specified!')

			let query = db.update(table).set(input)
			if (where) {
				const filters = extractFilters(table, tableName, where)
				query = query.where(filters) as any
			}

			try {
				await query

				return { isSuccess: true }
			} catch (e) {
				return { isSuccess: false }
			}
		},
		args: queryArgs
	}
}

const generateDelete = (
	db: MySqlDatabase<any, any, any>,
	tableName: string,
	table: MySqlTable,
	filterArgs: GraphQLInputObjectType
): CreatedResolver => {
	const queryName = `deleteFrom${tableName}`

	const queryArgs = {
		where: {
			type: filterArgs
		}
	} as const satisfies GraphQLFieldConfigArgumentMap

	return {
		name: queryName,
		resolver: async (source, args: { where?: Filters<Table> }, context, info) => {
			const { where } = args

			let query = db.delete(table)
			if (where) {
				const filters = extractFilters(table, tableName, where)
				query = query.where(filters) as any
			}

			try {
				await query

				return { isSuccess: true }
			} catch (e) {
				return { isSuccess: false }
			}
		},
		args: queryArgs
	}
}

export const generateSchemaData = <
	TDrizzleInstance extends MySqlDatabase<any, any, any, any>,
	TSchema extends Record<string, Table | unknown>
>(
	db: TDrizzleInstance,
	schema: TSchema
): GeneratedEntities<TDrizzleInstance, TSchema> => {
	const rawTables = schema

	const tables = Object.fromEntries(
		Object.entries(rawTables).filter(([key, value]) => is(value, MySqlTable))
	) as Record<string, Table>
	if (!tables || !Object.keys(tables).length)
		throw new Error(
			`Unable to extract tables from drizzle instance.\nDid you forget to pass tables to graphql schema constructor?`
		)

	const queries: ThunkObjMap<GraphQLFieldConfig<any, any>> = {}
	const mutations: ThunkObjMap<GraphQLFieldConfig<any, any>> = {}
	const gqlSchemaTypes = Object.fromEntries(
		Object.entries(tables).map(([tableName, table]) => [tableName, generateTableTypes(tableName, table)])
	)

	const mutationReturnType = new GraphQLObjectType({
		name: `MutationReturn`,
		fields: {
			isSuccess: {
				type: new GraphQLNonNull(GraphQLBoolean)
			}
		}
	})

	const inputs: Record<string, GraphQLInputObjectType> = {}
	const outputs: Record<string, GraphQLObjectType> = {
		MutationReturn: mutationReturnType
	}

	for (const [tableName, tableTypes] of Object.entries(gqlSchemaTypes)) {
		const { insertInput, updateInput, tableFilters, tableOrder } = tableTypes.inputs
		const { selectSingleOutput, selectArrOutput } = tableTypes.outputs

		const selectArrGenerated = generateSelectArray(
			db,
			tableName,
			schema[tableName] as MySqlTable,
			tableOrder,
			tableFilters
		)
		const selectSingleGenerated = generateSelectSingle(
			db,
			tableName,
			schema[tableName] as MySqlTable,
			tableOrder,
			tableFilters
		)
		const insertArrGenerated = generateInsertArray(db, tableName, schema[tableName] as MySqlTable, insertInput)
		const insertSingleGenerated = generateInsertSingle(db, tableName, schema[tableName] as MySqlTable, insertInput)
		const updateGenerated = generateUpdate(
			db,
			tableName,
			schema[tableName] as MySqlTable,
			updateInput,
			tableFilters
		)
		const deleteGenerated = generateDelete(db, tableName, schema[tableName] as MySqlTable, tableFilters)

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
			type: mutationReturnType,
			args: insertArrGenerated.args,
			resolve: insertArrGenerated.resolver
		}
		mutations[insertSingleGenerated.name] = {
			type: mutationReturnType,
			args: insertSingleGenerated.args,
			resolve: insertSingleGenerated.resolver
		}
		mutations[updateGenerated.name] = {
			type: mutationReturnType,
			args: updateGenerated.args,
			resolve: updateGenerated.resolver
		}
		mutations[deleteGenerated.name] = {
			type: mutationReturnType,
			args: deleteGenerated.args,
			resolve: deleteGenerated.resolver
		}
		;[insertInput, updateInput, tableFilters, tableOrder].forEach((e) => (inputs[e.name] = e))
		outputs[selectSingleOutput.name] = selectSingleOutput
	}

	return { queries, mutations, inputs, types: outputs } as any
}
