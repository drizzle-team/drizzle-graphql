import type { Table, TableRelationalConfig, TablesRelationalConfig } from 'drizzle-orm'
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

export type AnyDrizzleDB<TConfig extends TablesRelationalConfig = any> =
	| PgDatabase<any, any, TConfig>
	| BaseSQLiteDatabase<any, any, any, TConfig>
	| MySqlDatabase<any, any, any, TConfig>

export type AnyQueryBuiler<TConfig extends TablesRelationalConfig = any, TFields extends TableRelationalConfig = any> =
	| PgQuery<TConfig, TFields>
	| MySqlQuery<any, TConfig, TFields>
	| SQLiteQuery<any, any, TConfig, TFields>

export type ExtractTables<TSchema extends Record<string, Table | unknown>> = {
	[K in keyof TSchema]: TSchema[K] extends Table ? TSchema[K] : never
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

export type SelectResolver<TTable extends Table> = (
	source: any,
	args: QueryArgs<TTable, false>,
	context: any,
	info: GraphQLResolveInfo
) => Promise<Array<GetRemappedTableDataType<TTable>>>

export type SelectSingleResolver<TTable extends Table> = (
	source: any,
	args: QueryArgs<TTable, true>,
	context: any,
	info: GraphQLResolveInfo
) => Promise<GetRemappedTableDataType<TTable> | undefined>

export type InsertResolver<TTable extends Table, IsReturnless extends boolean> = (
	source: any,
	args: InsertArgs<TTable, false>,
	context: any,
	info: GraphQLResolveInfo
) => Promise<IsReturnless extends false ? Array<GetRemappedTableDataType<TTable>> : MutationReturnlessResult>

export type InsertArrResolver<TTable extends Table, IsReturnless extends boolean> = (
	source: any,
	args: InsertArgs<TTable, true>,
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
	TSchema extends Record<string, Table>,
	TInputs extends Record<string, GraphQLInputObjectType>,
	TOutputs extends Record<string, GraphQLObjectType>
> = {
	[TName in keyof TSchema as TName extends string ? `${Camelize<TName>}` : never]: TName extends string
		? {
				type: GraphQLNonNull<GraphQLList<GraphQLNonNull<TOutputs[`${Pascalize<TName>}Item`]>>>
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
				resolve: SelectResolver<TSchema[TName]>
		  }
		: never
} & {
	[TName in keyof TSchema as TName extends string ? `${Camelize<TName>}Single` : never]: TName extends string
		? {
				type: TOutputs[`${Pascalize<TName>}Item`]
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
				resolve: SelectSingleResolver<TSchema[TName]>
		  }
		: never
}

export type MutationsCore<
	TSchema extends Record<string, Table>,
	TInputs extends Record<string, GraphQLInputObjectType>,
	TOutputs extends Record<string, GraphQLObjectType>,
	IsReturnless extends boolean
> = {
	[TName in keyof TSchema as TName extends string ? `insertInto${Pascalize<TName>}` : never]: TName extends string
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
				resolve: InsertArrResolver<TSchema[TName], IsReturnless>
		  }
		: never
} & {
	[TName in keyof TSchema as TName extends string
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
				resolve: InsertResolver<TSchema[TName], IsReturnless>
		  }
		: never
} & {
	[TName in keyof TSchema as TName extends string ? `update${Pascalize<TName>}` : never]: TName extends string
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
				resolve: UpdateResolver<TSchema[TName], IsReturnless>
		  }
		: never
} & {
	[TName in keyof TSchema as TName extends string ? `deleteFrom${Pascalize<TName>}` : never]: TName extends string
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
				resolve: DeleteResolver<TSchema[TName], IsReturnless>
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
	[TName in keyof TSchema as TName extends string ? `${Pascalize<TName>}Item` : never]: GraphQLObjectType
} & (IsReturnless extends true
	? {
			MutationReturn: GraphQLObjectType
	  }
	: {})

export type GeneratedEntities<
	TDatabase extends AnyDrizzleDB,
	TSchema extends Record<string, Table | unknown>,
	TFilteredSchema extends ExtractTables<TSchema> = ExtractTables<TSchema>,
	TInputs extends GeneratedInputs<TFilteredSchema> = GeneratedInputs<TFilteredSchema>,
	TOutputs extends GeneratedOutputs<
		TFilteredSchema,
		TDatabase extends MySqlDatabase<any, any, any, any> ? true : false
	> = GeneratedOutputs<TFilteredSchema, TDatabase extends MySqlDatabase<any, any, any, any> ? true : false>
> = {
	queries: QueriesCore<TFilteredSchema, TInputs, TOutputs>
	mutations: MutationsCore<
		TFilteredSchema,
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
