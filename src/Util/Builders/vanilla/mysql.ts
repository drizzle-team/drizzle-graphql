import { Many, Relation, Relations, Table, createTableRelationsHelpers, is } from 'drizzle-orm'
import { MySqlDatabase, MySqlTable } from 'drizzle-orm/mysql-core'
import {
	GraphQLBoolean,
	GraphQLError,
	GraphQLInputObjectType,
	GraphQLInt,
	GraphQLList,
	GraphQLNonNull,
	GraphQLObjectType,
	Kind
} from 'graphql'

import {
	extractFilters,
	extractOrderBy,
	extractSelectedColumnsFromNode,
	generateTableTypes
} from '@/Util/Builders/vanilla/common'
import { camelize, pascalize } from '@/Util/caseOps'
import {
	remapFromGraphQLArrayInput,
	remapFromGraphQLSingleInput,
	remapToGraphQLArrayOutput,
	remapToGraphQLSingleOutput
} from '@/Util/dataMappers'

import type { GeneratedEntities } from '@/types'
import type { RelationalQueryBuilder } from 'drizzle-orm/mysql-core/query-builders/query'
import type { FieldNode, GraphQLFieldConfig, GraphQLFieldConfigArgumentMap, ThunkObjMap } from 'graphql'
import type { CreatedResolver, Filters, ProcessedTableSelectArgs, TableSelectArgs } from './types'

const generateSelectArray = (
	db: MySqlDatabase<any, any, any>,
	tableName: string,
	table: MySqlTable,
	relations: Record<string, Relation> | undefined,
	orderArgs: GraphQLInputObjectType,
	filterArgs: GraphQLInputObjectType,
	relationsOrderArgs: Record<string, GraphQLInputObjectType>,
	relationsFilterArgs: Record<string, GraphQLInputObjectType>
): CreatedResolver => {
	const queryName = `${camelize(tableName)}`
	const queryBase = db.query[tableName as keyof typeof db.query] as unknown as
		| RelationalQueryBuilder<any, any, any>
		| undefined
	if (!queryBase)
		throw new Error(
			`Table ${tableName} not found in drizzle instance. Did you forget to pass schema to drizzle constructor?`
		)

	const relationEntries = relations ? Object.entries(relations) : undefined
	const relationArgs = relationEntries
		? new GraphQLInputObjectType({
				name: `${queryName}RelationArgs`,
				fields: Object.fromEntries(
					relationEntries.map(([relName, relVal]) => [
						relName,
						{
							type: new GraphQLInputObjectType({
								name: `${queryName}${relName}RelationArgs`,
								fields: is(relVal, Many)
									? {
											where: { type: relationsFilterArgs[relName]! },
											orderBy: { type: relationsOrderArgs[relName]! },
											offset: { type: GraphQLInt },
											limit: { type: GraphQLInt }
									  }
									: {
											where: { type: relationsFilterArgs[relName]! },
											orderBy: { type: relationsOrderArgs[relName]! },
											offset: { type: GraphQLInt }
									  }
							})
						}
					])
				)
		  })
		: undefined

	const queryArgs = relationArgs
		? {
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
				},
				relations: { type: relationArgs }
		  }
		: ({
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
		  } as GraphQLFieldConfigArgumentMap)

	return {
		name: queryName,
		resolver: async (
			source,
			args: Partial<
				TableSelectArgs & {
					relations: Record<string, Partial<TableSelectArgs>>
				}
			>,
			context,
			info
		) => {
			const { offset, limit, orderBy, where } = args
			const tableSelection = info.operation.selectionSet.selections.find(
				(e) => e.kind === Kind.FIELD && e.name.value === queryName
			) as FieldNode

			const columns = extractSelectedColumnsFromNode(tableSelection, table)
			let withFields: Record<string, Partial<ProcessedTableSelectArgs>> = {}

			if (relationEntries) {
				for (const [relName, relValue] of relationEntries) {
					if (!tableSelection.selectionSet) continue

					const node = tableSelection.selectionSet.selections.find(
						(e) => e.kind === Kind.FIELD && e.name.value === relName
					) as FieldNode | undefined
					if (!node) continue

					const refTable = relValue.referencedTable
					const relationArgs = args.relations?.[relName]

					const columns = extractSelectedColumnsFromNode(node, refTable)
					const orderBy = relationArgs?.orderBy ? extractOrderBy(refTable, relationArgs.orderBy!) : undefined
					const where = relationArgs?.where
						? extractFilters(refTable, relName, relationArgs?.where)
						: undefined
					const offset = relationArgs?.offset ?? undefined
					const limit = relationArgs?.limit ?? undefined

					withFields[relName] = {
						columns,
						orderBy,
						where,
						offset,
						limit
					}
				}
			}

			let query = queryBase.findMany({
				columns,
				offset,
				limit,
				orderBy: orderBy ? extractOrderBy(table, orderBy) : undefined,
				where: where ? extractFilters(table, tableName, where) : undefined,
				with: Object.keys(withFields).length ? withFields : undefined
			})

			const result = await query

			return remapToGraphQLArrayOutput(result, relations)
		},
		args: queryArgs
	}
}

const generateSelectSingle = (
	db: MySqlDatabase<any, any, any>,
	tableName: string,
	table: MySqlTable,
	relations: Record<string, Relation> | undefined,
	orderArgs: GraphQLInputObjectType,
	filterArgs: GraphQLInputObjectType,
	relationsOrderArgs: Record<string, GraphQLInputObjectType>,
	relationsFilterArgs: Record<string, GraphQLInputObjectType>
): CreatedResolver => {
	const queryName = `${camelize(tableName)}Single`
	const queryBase = db.query[tableName as keyof typeof db.query] as unknown as
		| RelationalQueryBuilder<any, any, any>
		| undefined
	if (!queryBase)
		throw new Error(
			`Table ${tableName} not found in drizzle instance. Did you forget to pass schema to drizzle constructor?`
		)

	const relationEntries = relations ? Object.entries(relations) : undefined
	const relationArgs = relationEntries
		? new GraphQLInputObjectType({
				name: `${queryName}RelationArgs`,
				fields: Object.fromEntries(
					relationEntries.map(([relName, relVal]) => [
						relName,
						{
							type: new GraphQLInputObjectType({
								name: `${queryName}${relName}RelationArgs`,
								fields: is(relVal, Many)
									? {
											where: { type: relationsFilterArgs[relName]! },
											orderBy: { type: relationsOrderArgs[relName]! },
											offset: { type: GraphQLInt },
											limit: { type: GraphQLInt }
									  }
									: {
											where: { type: relationsFilterArgs[relName]! },
											orderBy: { type: relationsOrderArgs[relName]! },
											offset: { type: GraphQLInt }
									  }
							})
						}
					])
				)
		  })
		: undefined

	const queryArgs = relationArgs
		? {
				offset: {
					type: GraphQLInt
				},
				orderBy: {
					type: orderArgs
				},
				where: {
					type: filterArgs
				},
				relations: { type: relationArgs }
		  }
		: ({
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
		  } as GraphQLFieldConfigArgumentMap)

	return {
		name: queryName,
		resolver: async (
			source,
			args: Partial<
				TableSelectArgs & {
					relations: Record<string, Partial<TableSelectArgs>>
				}
			>,
			context,
			info
		) => {
			const { offset, limit, orderBy, where } = args
			const tableSelection = info.operation.selectionSet.selections.find(
				(e) => e.kind === Kind.FIELD && e.name.value === queryName
			) as FieldNode

			const columns = extractSelectedColumnsFromNode(tableSelection, table)
			let withFields: Record<string, Partial<ProcessedTableSelectArgs>> = {}

			if (relationEntries) {
				for (const [relName, relValue] of relationEntries) {
					if (!tableSelection.selectionSet) continue

					const node = tableSelection.selectionSet.selections.find(
						(e) => e.kind === Kind.FIELD && e.name.value === relName
					) as FieldNode | undefined
					if (!node) continue

					const refTable = relValue.referencedTable
					const relationArgs = args.relations?.[relName]

					const columns = extractSelectedColumnsFromNode(node, refTable)
					const orderBy = relationArgs?.orderBy ? extractOrderBy(refTable, relationArgs.orderBy!) : undefined
					const where = relationArgs?.where
						? extractFilters(refTable, relName, relationArgs?.where)
						: undefined
					const offset = relationArgs?.offset ?? undefined
					const limit = relationArgs?.limit ?? undefined

					withFields[relName] = {
						columns,
						orderBy,
						where,
						offset,
						limit
					}
				}
			}

			let query = queryBase.findFirst({
				columns,
				offset,
				orderBy: orderBy ? extractOrderBy(table, orderBy) : undefined,
				where: where ? extractFilters(table, tableName, where) : undefined,
				with: Object.keys(withFields).length ? withFields : undefined
			})

			const result = await query
			if (!result) return undefined

			return remapToGraphQLSingleOutput(result, relations)
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
	const rawSchema = schema

	const schemaEntries = Object.entries(rawSchema)

	const tables = Object.fromEntries(schemaEntries.filter(([key, value]) => is(value, MySqlTable))) as Record<
		string,
		Table
	>
	if (!tables || !Object.keys(tables).length)
		throw new Error(
			`Unable to extract tables from drizzle instance.\nDid you forget to pass tables to graphql schema constructor?`
		)

	const relations = Object.fromEntries(
		schemaEntries
			.filter(([key, value]) => is(value, Relations))
			.map<[string, Relations]>(([key, value]) => [
				Object.entries(tables).find(
					([tableName, tableValue]) => tableValue === (value as Relations).table
				)![0] as string,
				value as Relations
			])
			.map(([tableName, relValue]) => [
				tableName,
				relValue.config(createTableRelationsHelpers(tables[tableName]!))
			])
	)

	const queries: ThunkObjMap<GraphQLFieldConfig<any, any>> = {}
	const mutations: ThunkObjMap<GraphQLFieldConfig<any, any>> = {}
	const gqlSchemaTypes = Object.fromEntries(
		Object.entries(tables).map(([tableName, table]) => [
			tableName,
			generateTableTypes(tableName, table, false, relations[tableName])
		])
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
		const { insertInput, updateInput, tableFilters, tableOrder, relationFilters, relationOrder } = tableTypes.inputs
		const { selectSingleOutput, selectArrOutput } = tableTypes.outputs

		const selectArrGenerated = generateSelectArray(
			db,
			tableName,
			schema[tableName] as MySqlTable,
			relations[tableName],
			tableOrder,
			tableFilters,
			relationOrder,
			relationFilters
		)
		const selectSingleGenerated = generateSelectSingle(
			db,
			tableName,
			schema[tableName] as MySqlTable,
			relations[tableName],
			tableOrder,
			tableFilters,
			relationOrder,
			relationFilters
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
