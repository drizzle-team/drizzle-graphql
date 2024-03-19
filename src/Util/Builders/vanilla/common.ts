import {
	SQL,
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	gt,
	gte,
	ilike,
	inArray,
	isNotNull,
	isNull,
	like,
	lt,
	lte,
	ne,
	notIlike,
	notInArray,
	notLike,
	or
} from 'drizzle-orm'
import {
	GraphQLBoolean,
	GraphQLEnumType,
	GraphQLError,
	GraphQLInputObjectType,
	GraphQLInt,
	GraphQLList,
	GraphQLNonNull,
	GraphQLObjectType,
	GraphQLString,
	Kind
} from 'graphql'

import { drizzleColumnToGraphQLType } from '@/Util/TypeConverter/vanilla'
import { pascalize } from '@/Util/caseOps'
import { remapFromGraphQLCore } from '@/Util/dataMappers'

import type { Column, Table } from 'drizzle-orm'
import type { FieldNode, GraphQLResolveInfo } from 'graphql'
import type {
	FilterColumnOperators,
	FilterColumnOperatorsCore,
	Filters,
	FiltersCore,
	OrderByArgs,
	SelectedColumnsRaw,
	SelectedSQLColumns
} from './types'

export const extractSelectedColumns = (info: GraphQLResolveInfo, queryName: string) => {
	const tableSelection = info.operation.selectionSet.selections.find(
		(e) => e.kind === Kind.FIELD && e.name.value === queryName
	) as FieldNode | undefined

	const selectedColumns: SelectedColumnsRaw = []

	if (!tableSelection || !tableSelection.selectionSet) return {}

	for (const columnSelection of tableSelection.selectionSet.selections) {
		if (columnSelection.kind !== Kind.FIELD) continue

		selectedColumns.push([columnSelection.name.value, true])
	}

	return Object.fromEntries(selectedColumns)
}

export const extractSelectedColumnsSQLFormat = <TTable extends Table>(
	info: GraphQLResolveInfo,
	queryName: string,
	table: TTable
): Record<string, Column> => {
	const tableSelection = info.operation.selectionSet.selections.find(
		(e) => e.kind === Kind.FIELD && e.name.value === queryName
	) as FieldNode | undefined

	const selectedColumns: SelectedSQLColumns = []

	if (!tableSelection || !tableSelection.selectionSet) throw new GraphQLError('Received empty column selection!')

	for (const columnSelection of tableSelection.selectionSet.selections) {
		if (columnSelection.kind !== Kind.FIELD) continue

		selectedColumns.push([columnSelection.name.value, table[columnSelection.name.value as keyof Table] as Column])
	}

	return Object.fromEntries(selectedColumns) as any
}

export const innerOrder = new GraphQLInputObjectType({
	name: 'InnerOrder' as const,
	fields: {
		direction: {
			type: new GraphQLNonNull(
				new GraphQLEnumType({
					name: 'OrderDirection',
					description: 'Order by direction',
					values: {
						asc: {
							value: 'asc',
							description: 'Ascending order'
						},
						desc: {
							value: 'desc',
							description: 'Descending order'
						}
					}
				})
			)
		},
		priority: { type: new GraphQLNonNull(GraphQLInt), description: 'Priority of current field' }
	} as const
})

const generateColumnFilterValues = (column: Column, tableName: string, columnName: string) => {
	const columnGraphQLType = drizzleColumnToGraphQLType(column, true)
	const columnArr = new GraphQLList(new GraphQLNonNull(columnGraphQLType.type))

	const baseFields = {
		eq: { type: columnGraphQLType.type, description: columnGraphQLType.description },
		ne: { type: columnGraphQLType.type, description: columnGraphQLType.description },
		lt: { type: columnGraphQLType.type, description: columnGraphQLType.description },
		lte: { type: columnGraphQLType.type, description: columnGraphQLType.description },
		gt: { type: columnGraphQLType.type, description: columnGraphQLType.description },
		gte: { type: columnGraphQLType.type, description: columnGraphQLType.description },
		like: { type: GraphQLString },
		notLike: { type: GraphQLString },
		ilike: { type: GraphQLString },
		notIlike: { type: GraphQLString },
		inArray: { type: columnArr, description: `Array<${columnGraphQLType.description}>` },
		notInArray: { type: columnArr, description: `Array<${columnGraphQLType.description}>` },
		isNull: { type: GraphQLBoolean },
		isNotNull: { type: GraphQLBoolean }
	}

	const type: GraphQLInputObjectType = new GraphQLInputObjectType({
		name: `${pascalize(tableName)}${pascalize(columnName)}Filters`,
		fields: {
			...baseFields,
			OR: {
				type: new GraphQLList(
					new GraphQLNonNull(
						new GraphQLInputObjectType({
							name: `${pascalize(tableName)}${pascalize(columnName)}filtersOr`,
							fields: {
								...baseFields
							}
						})
					)
				)
			}
		}
	})

	return type
}

export const generateTableTypes = (tableName: string, table: Table) => {
	const columns = getTableColumns(table)
	const columnEntries = Object.entries(columns)

	const selectFields = Object.fromEntries(
		columnEntries.map(([columnName, columnDescription]) => [
			columnName,
			drizzleColumnToGraphQLType(columnDescription)
		])
	)

	const insertFields = Object.fromEntries(
		columnEntries.map(([columnName, columnDescription]) => [
			columnName,
			drizzleColumnToGraphQLType(columnDescription, false, true)
		])
	)

	const updateFields = Object.fromEntries(
		columnEntries.map(([columnName, columnDescription]) => [
			columnName,
			drizzleColumnToGraphQLType(columnDescription, true)
		])
	)

	const insertInput = new GraphQLInputObjectType({
		name: `${pascalize(tableName)}InsertInput`,
		fields: insertFields
	})

	const selectSingleOutput = new GraphQLObjectType({
		name: `${pascalize(tableName)}Item`,
		fields: selectFields
	})

	const selectArrOutput = new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(selectSingleOutput)))

	const updateInput = new GraphQLInputObjectType({
		name: `${pascalize(tableName)}UpdateInput`,
		fields: updateFields
	})

	const tableOrder = new GraphQLInputObjectType({
		name: `${pascalize(tableName)}OrderBy`,
		fields: Object.fromEntries(
			columnEntries.map(([columnName, columnDescription]) => [columnName, { type: innerOrder }])
		)
	})

	const columnTypes = Object.fromEntries(
		columnEntries.map(([columnName, columnDescription]) => [
			columnName,
			{
				type: generateColumnFilterValues(columnDescription, tableName, columnName)
			}
		])
	)

	const tableFilters: GraphQLInputObjectType = new GraphQLInputObjectType({
		name: `${pascalize(tableName)}Filters`,
		fields: {
			...columnTypes,
			OR: {
				type: new GraphQLList(
					new GraphQLNonNull(
						new GraphQLInputObjectType({
							name: `${pascalize(tableName)}FiltersOr`,
							fields: columnTypes
						})
					)
				)
			}
		}
	})

	return {
		inputs: {
			insertInput,
			updateInput,
			tableOrder,
			tableFilters
		},
		outputs: {
			selectSingleOutput,
			selectArrOutput
		}
	}
}

export const extractOrderBy = <TTable extends Table, TArgs extends OrderByArgs<any> = OrderByArgs<TTable>>(
	table: TTable,
	orderArgs: TArgs
): SQL[] => {
	const res = [] as SQL[]

	for (const [column, config] of Object.entries(orderArgs).sort(
		(a, b) => (b[1]?.priority ?? 0) - (a[1]?.priority ?? 0)
	)) {
		if (!config) continue
		const { direction } = config

		res.push(direction === 'asc' ? asc(getTableColumns(table)[column]!) : desc(getTableColumns(table)[column]!))
	}

	return res
}

export const extractFiltersColumn = <TColumn extends Column>(
	column: TColumn,
	columnName: string,
	operators: FilterColumnOperators<TColumn>
): SQL | undefined => {
	if (!operators.OR?.length) delete operators.OR

	const entries = Object.entries(operators as FilterColumnOperatorsCore<TColumn>)

	if (operators.OR) {
		if (entries.length > 1)
			throw new GraphQLError(`WHERE ${columnName}: Cannot specify both fields and 'OR' in column operators!`)

		const variants = [] as SQL[]

		for (const variant of operators.OR) {
			const extracted = extractFiltersColumn(column, columnName, variant)

			if (extracted) variants.push(extracted)
		}

		return variants.length ? (variants.length > 1 ? or(...variants) : variants[0]) : undefined
	}

	const variants = [] as SQL[]
	for (const [operatorName, operatorValue] of entries) {
		if (operatorValue === null || operatorValue === false) continue

		let operator: ((...args: any[]) => SQL) | undefined
		switch (operatorName as keyof FilterColumnOperatorsCore<TColumn>) {
			//@ts-ignore
			case 'eq':
				operator = operator ?? eq
			//@ts-ignore
			case 'ne':
				operator = operator ?? ne
			//@ts-ignore
			case 'gt':
				operator = operator ?? gt
			//@ts-ignore
			case 'gte':
				operator = operator ?? gte
			//@ts-ignore
			case 'lt':
				operator = operator ?? lt
			case 'lte':
				operator = operator ?? lte

				const singleValue = remapFromGraphQLCore(operatorValue, column, columnName)
				variants.push(operator(column, singleValue))

				break

			//@ts-ignore
			case 'like':
				operator = operator ?? like
			//@ts-ignore
			case 'notLike':
				operator = operator ?? notLike
			//@ts-ignore
			case 'ilike':
				operator = operator ?? ilike
			case 'notIlike':
				operator = operator ?? notIlike

				variants.push(operator(column, operatorValue as string))

				break

			//@ts-ignore
			case 'inArray':
				operator = operator ?? inArray
			case 'notInArray':
				operator = operator ?? notInArray

				if (!(operatorValue as any[]).length)
					throw new GraphQLError(
						`WHERE ${columnName}: Unable to use operator ${operatorName} with an empty array!`
					)
				const arrayValue = (operatorValue as any[]).map((val) =>
					remapFromGraphQLCore(operatorValue, column, columnName)
				)

				variants.push(operator(column, arrayValue))
				break

			//@ts-ignore
			case 'isNull':
				operator = operator ?? isNull
			case 'isNotNull':
				operator = operator ?? isNotNull

				variants.push(operator(column))
		}
	}

	return variants.length ? (variants.length > 1 ? and(...variants) : variants[0]) : undefined
}

export const extractFilters = <TTable extends Table>(
	table: TTable,
	tableName: string,
	filters: Filters<TTable>
): SQL | undefined => {
	if (!filters.OR?.length) delete filters.OR

	const entries = Object.entries(filters as FiltersCore<TTable>)
	if (!entries.length) return

	if (filters.OR) {
		if (entries.length > 1)
			throw new GraphQLError(`WHERE ${tableName}: Cannot specify both fields and 'OR' in table filters!`)

		const variants = [] as SQL[]

		for (const variant of filters.OR) {
			const extracted = extractFilters(table, tableName, variant)
			if (extracted) variants.push(extracted)
		}

		return variants.length ? (variants.length > 1 ? or(...variants) : variants[0]) : undefined
	}

	const variants = [] as SQL[]
	for (const [columnName, operators] of entries) {
		if (operators === null) continue

		const column = getTableColumns(table)[columnName]!
		variants.push(extractFiltersColumn(column, columnName, operators)!)
	}

	return variants.length ? (variants.length > 1 ? and(...variants) : variants[0]) : undefined
}
