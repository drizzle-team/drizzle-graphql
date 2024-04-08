import type { Many, One, Relation, Relations, Table, TableRelationalConfig, TablesRelationalConfig } from 'drizzle-orm'
import type { MySqlDatabase } from 'drizzle-orm/mysql-core'
import type { RelationalQueryBuilder as MySqlQuery } from 'drizzle-orm/mysql-core/query-builders/query'
import type { PgDatabase } from 'drizzle-orm/pg-core'
import type { RelationalQueryBuilder as PgQuery } from 'drizzle-orm/pg-core/query-builders/query'
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import type { RelationalQueryBuilder as SQLiteQuery } from 'drizzle-orm/sqlite-core/query-builders/query'
import type {
	GraphQLInputObjectType,
	GraphQLList,
	GraphQLNonNull,
	GraphQLObjectType,
	GraphQLResolveInfo,
	GraphQLScalarType,
	GraphQLSchema
} from 'graphql'

import type {
	Filters,
	GetRemappedTableDataType,
	GetRemappedTableInsertDataType,
	GetRemappedTableUpdateDataType,
	OrderByArgs
} from '@/Util/Builders/vanilla'
import type { Camelize, Pascalize } from '@/Util/caseOps'

export type AnyDrizzleDB =
	| PgDatabase<any, any, any>
	| BaseSQLiteDatabase<any, any, any, any>
	| MySqlDatabase<any, any, any, any>

export type AnyQueryBuiler<TConfig extends TablesRelationalConfig = any, TFields extends TableRelationalConfig = any> =
	| PgQuery<TConfig, TFields>
	| MySqlQuery<any, TConfig, TFields>
	| SQLiteQuery<any, any, TConfig, TFields>

export type ExtractTables<TSchema extends Record<string, Table | unknown>> = {
	[K in keyof TSchema as TSchema[K] extends Table ? K : never]: TSchema[K] extends Table ? TSchema[K] : never
}

export type ExtractRelations<TSchema extends Record<string, Table | unknown>> = {
	[K in keyof TSchema as TSchema[K] extends Relations ? K : never]: TSchema[K] extends Relations ? TSchema[K] : never
}

export type ExtractTableRelations<TTable extends Table, TSchemaRelations extends Record<string, Relations>> = {
	[K in keyof TSchemaRelations as TSchemaRelations[K]['table']['_']['name'] extends TTable['_']['name']
		? K
		: never]: TSchemaRelations[K]['table']['_']['name'] extends TTable['_']['name']
		? TSchemaRelations[K] extends Relations<any, infer RelationConfig>
			? RelationConfig
			: never
		: never
}

export type ExtractTableByName<TTableSchema extends Record<string, Table>, TName extends string> = {
	[K in keyof TTableSchema as TTableSchema[K]['_']['name'] extends TName
		? K
		: never]: TTableSchema[K]['_']['name'] extends TName ? TTableSchema[K] : never
}

export type MutationReturnlessResult = {
	isSuccess: boolean
}

export type QueryArgs<TTable extends Table, isSingle extends boolean> = Partial<
	(isSingle extends true
		? {
				offset: number
		  }
		: {
				offset: number
				limit: number
		  }) & {
		where: Filters<TTable>
		orderBy: OrderByArgs<TTable>
	}
>

export type InsertArgs<TTable extends Table, isSingle extends boolean> = isSingle extends true
	? {
			values: GetRemappedTableInsertDataType<TTable>
	  }
	: {
			values: Array<GetRemappedTableInsertDataType<TTable>>
	  }

export type UpdateArgs<TTable extends Table> = Partial<{
	set: GetRemappedTableUpdateDataType<TTable>
	where?: Filters<TTable>
}>

export type DeleteArgs<TTable extends Table> = {
	where?: Filters<TTable>
}

export type SelectResolver<
	TTable extends Table,
	TTables extends Record<string, Table>,
	TRelations extends Record<string, Relation>
> = (
	source: any,
	args: Partial<QueryArgs<TTable, false>>,
	context: any,
	info: GraphQLResolveInfo
) => Promise<
	keyof TRelations extends infer RelKey
		? RelKey extends string
			? Array<
					GetRemappedTableDataType<TTable> & {
						[K in RelKey]: TRelations[K] extends One<string>
							? GetRemappedTableDataType<
									ExtractTableByName<TTables, TRelations[K]['referencedTableName']> extends infer T
										? T[keyof T]
										: never
							  > | null
							: TRelations[K] extends Many<string>
							? Array<
									GetRemappedTableDataType<
										ExtractTableByName<
											TTables,
											TRelations[K]['referencedTableName']
										> extends infer T
											? T[keyof T]
											: never
									>
							  >
							: never
					}
			  >
			: Array<GetRemappedTableDataType<TTable>>
		: Array<GetRemappedTableDataType<TTable>>
>

export type SelectSingleResolver<
	TTable extends Table,
	TTables extends Record<string, Table>,
	TRelations extends Record<string, Relation>
> = (
	source: any,
	args: Partial<QueryArgs<TTable, true>>,
	context: any,
	info: GraphQLResolveInfo
) => Promise<
	| (keyof TRelations extends infer RelKey
			? RelKey extends string
				? GetRemappedTableDataType<TTable> & {
						[K in RelKey]: TRelations[K] extends One<string>
							? GetRemappedTableDataType<
									ExtractTableByName<TTables, TRelations[K]['referencedTableName']> extends infer T
										? T[keyof T]
										: never
							  > | null
							: TRelations[K] extends Many<string>
							? Array<
									GetRemappedTableDataType<
										ExtractTableByName<
											TTables,
											TRelations[K]['referencedTableName']
										> extends infer T
											? T[keyof T]
											: never
									>
							  >
							: never
				  }
				: GetRemappedTableDataType<TTable>
			: GetRemappedTableDataType<TTable>)
	| null
>

export type InsertResolver<TTable extends Table, IsReturnless extends boolean> = (
	source: any,
	args: Partial<InsertArgs<TTable, false>>,
	context: any,
	info: GraphQLResolveInfo
) => Promise<IsReturnless extends false ? Array<GetRemappedTableDataType<TTable>> : MutationReturnlessResult>

export type InsertArrResolver<TTable extends Table, IsReturnless extends boolean> = (
	source: any,
	args: Partial<InsertArgs<TTable, true>>,
	context: any,
	info: GraphQLResolveInfo
) => Promise<IsReturnless extends false ? GetRemappedTableDataType<TTable> | undefined : MutationReturnlessResult>

export type UpdateResolver<TTable extends Table, IsReturnless extends boolean> = (
	source: any,
	args: UpdateArgs<TTable>,
	context: any,
	info: GraphQLResolveInfo
) => Promise<IsReturnless extends false ? GetRemappedTableDataType<TTable> | undefined : MutationReturnlessResult>

export type DeleteResolver<TTable extends Table, IsReturnless extends boolean> = (
	source: any,
	args: DeleteArgs<TTable>,
	context: any,
	info: GraphQLResolveInfo
) => Promise<IsReturnless extends false ? GetRemappedTableDataType<TTable> | undefined : MutationReturnlessResult>

export type QueriesCore<
	TSchemaTables extends Record<string, Table>,
	TSchemaRelations extends Record<string, Relations>,
	TInputs extends Record<string, GraphQLInputObjectType>,
	TOutputs extends Record<string, GraphQLObjectType>
> = {
	[TName in keyof TSchemaTables as TName extends string ? `${Camelize<TName>}` : never]: TName extends string
		? {
				type: GraphQLNonNull<GraphQLList<GraphQLNonNull<TOutputs[`${Pascalize<TName>}SelectItem`]>>>
				args: {
					offset: {
						type: GraphQLScalarType<number, number>
					}
					limit: {
						type: GraphQLScalarType<number, number>
					}
					orderBy: {
						type: TInputs[`${Pascalize<TName>}OrderBy`] extends GraphQLInputObjectType
							? TInputs[`${Pascalize<TName>}OrderBy`]
							: never
					}
					where: {
						type: TInputs[`${Pascalize<TName>}Filters`] extends GraphQLInputObjectType
							? TInputs[`${Pascalize<TName>}Filters`]
							: never
					}
				}
				resolve: SelectResolver<
					TSchemaTables[TName],
					TSchemaTables,
					ExtractTableRelations<TSchemaTables[TName], TSchemaRelations> extends infer R ? R[keyof R] : never
				>
		  }
		: never
} & {
	[TName in keyof TSchemaTables as TName extends string ? `${Camelize<TName>}Single` : never]: TName extends string
		? {
				type: TOutputs[`${Pascalize<TName>}SelectItem`]
				args: {
					offset: {
						type: GraphQLScalarType<number, number>
					}
					orderBy: {
						type: TInputs[`${Pascalize<TName>}OrderBy`] extends GraphQLInputObjectType
							? TInputs[`${Pascalize<TName>}OrderBy`]
							: never
					}
					where: {
						type: TInputs[`${Pascalize<TName>}Filters`] extends GraphQLInputObjectType
							? TInputs[`${Pascalize<TName>}Filters`]
							: never
					}
				}
				resolve: SelectSingleResolver<
					TSchemaTables[TName],
					TSchemaTables,
					ExtractTableRelations<TSchemaTables[TName], TSchemaRelations> extends infer R ? R[keyof R] : never
				>
		  }
		: never
}

export type MutationsCore<
	TSchemaTables extends Record<string, Table>,
	TInputs extends Record<string, GraphQLInputObjectType>,
	TOutputs extends Record<string, GraphQLObjectType>,
	IsReturnless extends boolean
> = {
	[TName in keyof TSchemaTables as TName extends string
		? `insertInto${Pascalize<TName>}`
		: never]: TName extends string
		? {
				type: IsReturnless extends true
					? TOutputs['MutationReturn'] extends GraphQLObjectType
						? TOutputs['MutationReturn']
						: never
					: GraphQLNonNull<GraphQLList<GraphQLNonNull<TOutputs[`${Pascalize<TName>}Item`]>>>
				args: {
					values: {
						type: GraphQLNonNull<GraphQLList<GraphQLNonNull<TInputs[`${Pascalize<TName>}InsertInput`]>>>
					}
				}
				resolve: InsertArrResolver<TSchemaTables[TName], IsReturnless>
		  }
		: never
} & {
	[TName in keyof TSchemaTables as TName extends string
		? `insertInto${Pascalize<TName>}Single`
		: never]: TName extends string
		? {
				type: IsReturnless extends true
					? TOutputs['MutationReturn'] extends GraphQLObjectType
						? TOutputs['MutationReturn']
						: never
					: TOutputs[`${Pascalize<TName>}Item`]

				args: {
					values: {
						type: GraphQLNonNull<TInputs[`${Pascalize<TName>}InsertInput`]>
					}
				}
				resolve: InsertResolver<TSchemaTables[TName], IsReturnless>
		  }
		: never
} & {
	[TName in keyof TSchemaTables as TName extends string ? `update${Pascalize<TName>}` : never]: TName extends string
		? {
				type: IsReturnless extends true
					? TOutputs['MutationReturn'] extends GraphQLObjectType
						? TOutputs['MutationReturn']
						: never
					: GraphQLNonNull<GraphQLList<GraphQLNonNull<TOutputs[`${Pascalize<TName>}Item`]>>>
				args: {
					set: {
						type: GraphQLNonNull<TInputs[`${Pascalize<TName>}UpdateInput`]>
					}
					where: {
						type: TInputs[`${Pascalize<TName>}Filters`] extends GraphQLInputObjectType
							? TInputs[`${Pascalize<TName>}Filters`]
							: never
					}
				}
				resolve: UpdateResolver<TSchemaTables[TName], IsReturnless>
		  }
		: never
} & {
	[TName in keyof TSchemaTables as TName extends string
		? `deleteFrom${Pascalize<TName>}`
		: never]: TName extends string
		? {
				type: IsReturnless extends true
					? TOutputs['MutationReturn'] extends GraphQLObjectType
						? TOutputs['MutationReturn']
						: never
					: GraphQLNonNull<GraphQLList<GraphQLNonNull<TOutputs[`${Pascalize<TName>}Item`]>>>
				args: {
					where: {
						type: TInputs[`${Pascalize<TName>}Filters`] extends GraphQLInputObjectType
							? TInputs[`${Pascalize<TName>}Filters`]
							: never
					}
				}
				resolve: DeleteResolver<TSchemaTables[TName], IsReturnless>
		  }
		: never
}

export type GeneratedInputs<TSchema extends Record<string, Table>> = {
	[TName in keyof TSchema as TName extends string ? `${Pascalize<TName>}InsertInput` : never]: GraphQLInputObjectType
} & {
	[TName in keyof TSchema as TName extends string ? `${Pascalize<TName>}UpdateInput` : never]: GraphQLInputObjectType
} & {
	[TName in keyof TSchema as TName extends string ? `${Pascalize<TName>}OrderBy` : never]: GraphQLInputObjectType
} & {
	[TName in keyof TSchema as TName extends string ? `${Pascalize<TName>}Filters` : never]: GraphQLInputObjectType
}

export type GeneratedOutputs<TSchema extends Record<string, Table>, IsReturnless extends Boolean> = {
	[TName in keyof TSchema as TName extends string ? `${Pascalize<TName>}SelectItem` : never]: GraphQLObjectType
} & (IsReturnless extends true
	? {
			MutationReturn: GraphQLObjectType
	  }
	: {
			[TName in keyof TSchema as TName extends string ? `${Pascalize<TName>}Item` : never]: GraphQLObjectType
	  })

export type GeneratedEntities<
	TDatabase extends AnyDrizzleDB,
	TSchema extends Record<string, Table | unknown>,
	TSchemaTables extends ExtractTables<TSchema> = ExtractTables<TSchema>,
	TSchemaRelations extends ExtractRelations<TSchema> = ExtractRelations<TSchema>,
	TInputs extends GeneratedInputs<TSchemaTables> = GeneratedInputs<TSchemaTables>,
	TOutputs extends GeneratedOutputs<
		TSchemaTables,
		TDatabase extends MySqlDatabase<any, any, any, any> ? true : false
	> = GeneratedOutputs<TSchemaTables, TDatabase extends MySqlDatabase<any, any, any, any> ? true : false>
> = {
	queries: QueriesCore<TSchemaTables, TSchemaRelations, TInputs, TOutputs>
	mutations: MutationsCore<
		TSchemaTables,
		TInputs,
		TOutputs,
		TDatabase extends MySqlDatabase<any, any, any, any> ? true : false
	>
	inputs: TInputs
	types: TOutputs
}

export type GeneratedData<TDatabase extends AnyDrizzleDB, TSchema extends Record<string, Table | unknown>> = {
	schema: GraphQLSchema
	entities: GeneratedEntities<TDatabase, TSchema>
}
