import type { Column, Table } from 'drizzle-orm'
import type { PgArray } from 'drizzle-orm/pg-core'
import type { GraphQLFieldConfigArgumentMap, GraphQLFieldResolver, GraphQLScalarType } from 'graphql'

export type SelectedColumnsRaw = [string, true][]

export type SelectedSQLColumns = [string, Column][]

export type SelectedColumns = {
	[columnName in keyof Table['_']['columns']]: true
}

export type CreatedResolver = {
	name: string
	resolver: GraphQLFieldResolver<any, any>
	args: GraphQLFieldConfigArgumentMap
}

export type ArgMapToArgsType<TArgMap extends GraphQLFieldConfigArgumentMap> = {
	[Key in keyof TArgMap]?: TArgMap[Key] extends { type: GraphQLScalarType<infer R, any> } ? R : never
}

export type ColTypeIsNull<TColumn extends Column, TColType> = TColumn['notNull'] extends true
	? TColType
	: TColType | null | undefined

export type ColTypeIsNullOrDefault<TColumn extends Column, TColType> = TColumn['notNull'] extends true
	? TColumn['hasDefault'] extends true
		? TColType | null | undefined
		: TColType
	: TColType | null | undefined

export type GetColumnGqlDataType<TColumn extends Column> = TColumn['dataType'] extends 'boolean'
	? ColTypeIsNull<TColumn, boolean>
	: TColumn['dataType'] extends 'json' | 'date' | 'string' | 'bigint'
	? ColTypeIsNull<TColumn, string>
	: TColumn['dataType'] extends 'number'
	? ColTypeIsNull<TColumn, number>
	: TColumn['dataType'] extends 'buffer'
	? ColTypeIsNull<TColumn, number[]>
	: TColumn extends PgArray<any, any>
	? ColTypeIsNull<
			TColumn,
			Array<
				GetColumnGqlDataType<TColumn['baseColumn']> extends infer InnerColType
					? InnerColType extends null | undefined
						? never
						: InnerColType
					: never
			>
	  >
	: never

export type GetColumnGqlInsertDataType<TColumn extends Column> = TColumn['dataType'] extends 'boolean'
	? ColTypeIsNullOrDefault<TColumn, boolean>
	: TColumn['dataType'] extends 'json' | 'date' | 'string' | 'bigint'
	? ColTypeIsNullOrDefault<TColumn, string>
	: TColumn['dataType'] extends 'number'
	? ColTypeIsNullOrDefault<TColumn, number>
	: TColumn['dataType'] extends 'buffer'
	? ColTypeIsNullOrDefault<TColumn, number[]>
	: TColumn extends PgArray<any, any>
	? ColTypeIsNullOrDefault<
			TColumn,
			Array<
				GetColumnGqlDataType<TColumn['baseColumn']> extends infer InnerColType
					? InnerColType extends null | undefined
						? never
						: InnerColType
					: never
			>
	  >
	: never

export type GetColumnGqlUpdateDataType<TColumn extends Column> = TColumn['dataType'] extends 'boolean'
	? boolean | null | undefined
	: TColumn['dataType'] extends 'json' | 'date' | 'string' | 'bigint'
	? string | null | undefined
	: TColumn['dataType'] extends 'number'
	? number | null | undefined
	: TColumn['dataType'] extends 'buffer'
	? number[] | null | undefined
	: TColumn extends PgArray<any, any>
	?
			| Array<
					GetColumnGqlDataType<TColumn['baseColumn']> extends infer InnerColType
						? InnerColType extends null | undefined
							? never
							: InnerColType
						: never
			  >
			| null
			| undefined
	: never

export type GetRemappedTableDataType<TTable extends Table> = {
	[K in keyof TTable['_']['columns']]: GetColumnGqlDataType<TTable['_']['columns'][K]>
}

export type GetRemappedTableInsertDataType<TTable extends Table> = {
	[K in keyof TTable['_']['columns']]: GetColumnGqlInsertDataType<TTable['_']['columns'][K]>
}

export type GetRemappedTableUpdateDataType<TTable extends Table> = {
	[K in keyof TTable['_']['columns']]: GetColumnGqlUpdateDataType<TTable['_']['columns'][K]>
}

export type FilterColumnOperatorsCore<TColumn extends Column, TColType = GetColumnGqlDataType<TColumn>> = Partial<{
	eq: TColType
	ne: TColType
	lt: TColType
	lte: TColType
	gt: TColType
	gte: TColType
	like: string
	notLike: string
	ilike: string
	notIlike: string
	inArray: Array<TColType>
	notInArray: Array<TColType>
	isNull: boolean
	isNotNull: boolean
}>

export type FilterColumnOperators<
	TColumn extends Column,
	TOperators extends FilterColumnOperatorsCore<TColumn> = FilterColumnOperatorsCore<TColumn>
> = TOperators & {
	OR?: TOperators[]
}

export type FiltersCore<TTable extends Table> = Partial<{
	[Column in keyof TTable['_']['columns']]: FilterColumnOperatorsCore<TTable['_']['columns'][Column]>
}>

export type Filters<TTable extends Table, TFilterType = FiltersCore<TTable>> = TFilterType & {
	OR?: TFilterType[]
}

export type OrderByArgs<TTable extends Table> = {
	[Key in keyof TTable['_']['columns']]?: {
		direction: 'asc' | 'desc'
		priority: number
	}
}
