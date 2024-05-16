import {
	and,
	asc,
	desc,
	eq,
	getTableColumns,
	gt,
	gte,
	ilike,
	inArray,
	is,
	isNotNull,
	isNull,
	like,
	lt,
	lte,
	ne,
	notIlike,
	notInArray,
	notLike,
	One,
	or,
	SQL,
} from 'drizzle-orm';
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
	Kind,
} from 'graphql';
import { parseResolveInfo } from 'graphql-parse-resolve-info';

import { pascalize } from '@/util/case-ops';
import { remapFromGraphQLCore } from '@/util/data-mappers';
import { ConvertedColumn, ConvertedInputColumn, drizzleColumnToGraphQLType } from '@/util/type-converter';

import type { Column, Relation, Table } from 'drizzle-orm';
import type { FieldNode, GraphQLFieldConfig, GraphQLResolveInfo } from 'graphql';
import type { ResolveTree } from 'graphql-parse-resolve-info';
import type {
	FilterColumnOperators,
	FilterColumnOperatorsCore,
	Filters,
	FiltersCore,
	GeneratedTableTypes,
	GeneratedTableTypesOutputs,
	OrderByArgs,
	ProcessedTableSelectArgs,
	SelectedColumnsRaw,
	SelectedSQLColumns,
	TableSelectArgs,
} from './types';

export const extractSelectedColumnsFromNode = (info: FieldNode, table: Table): Record<string, true> => {
	if (!info.selectionSet) return {};

	const tableColumns = getTableColumns(table);
	const selectedColumns: SelectedColumnsRaw = [];
	for (const columnSelection of info.selectionSet.selections) {
		if (columnSelection.kind !== Kind.FIELD || !tableColumns[columnSelection.name.value]) continue;

		selectedColumns.push([columnSelection.name.value, true]);
	}

	if (!selectedColumns.length) {
		const columnKeys = Object.keys(tableColumns);

		selectedColumns.push([columnKeys[0]!, true]);
	}

	return Object.fromEntries(selectedColumns);
};

export const extractSelectedColumnsSQLFormat = <TTable extends Table>(
	info: GraphQLResolveInfo,
	queryName: string,
	table: TTable,
): Record<string, Column> => {
	const tableSelection = info.operation.selectionSet.selections.find(
		(e) => e.kind === Kind.FIELD && e.name.value === queryName,
	) as FieldNode | undefined;

	const selectedColumns: SelectedSQLColumns = [];

	if (!tableSelection || !tableSelection.selectionSet) throw new GraphQLError('Received empty column selection!');

	for (const columnSelection of tableSelection.selectionSet.selections) {
		if (columnSelection.kind !== Kind.FIELD || columnSelection.name.value === '__typename') continue;

		selectedColumns.push([columnSelection.name.value, table[columnSelection.name.value as keyof Table] as Column]);
	}

	if (!selectedColumns.length) {
		const columnKeys = Object.entries(getTableColumns(table));

		selectedColumns.push([columnKeys[0]![0], columnKeys[0]![1]]);
	}

	return Object.fromEntries(selectedColumns) as any;
};

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
							description: 'Ascending order',
						},
						desc: {
							value: 'desc',
							description: 'Descending order',
						},
					},
				}),
			),
		},
		priority: { type: new GraphQLNonNull(GraphQLInt), description: 'Priority of current field' },
	} as const,
});

const generateColumnFilterValues = (column: Column, tableName: string, columnName: string): GraphQLInputObjectType => {
	const columnGraphQLType = drizzleColumnToGraphQLType(column, columnName, tableName, true);
	const columnArr = new GraphQLList(new GraphQLNonNull(columnGraphQLType.type));

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
		isNotNull: { type: GraphQLBoolean },
	};

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
								...baseFields,
							},
						}),
					),
				),
			},
		},
	});

	return type;
};

const filterMap = new WeakMap<Record<string, ConvertedInputColumn>>();
const generateTableFilterValuesCached = (table: Table, tableName: string) => {
	// @ts-expect-error - mapping to object's address
	if (filterMap.has(table)) return filterMap.get(table);

	const columns = getTableColumns(table);
	const columnEntries = Object.entries(columns);

	const remapped = Object.fromEntries(
		columnEntries.map(([columnName, columnDescription]) => [
			columnName,
			{
				type: generateColumnFilterValues(columnDescription, tableName, columnName),
			},
		]),
	);

	// @ts-expect-error - mapping to object's address
	filterMap.set(table, remapped);

	return remapped;
};

const fieldMap = new WeakMap<Record<string, ConvertedColumn>>();
const generateTableSelectTypeFieldsCached = (table: Table, tableName: string): Record<string, ConvertedColumn> => {
	// @ts-expect-error - mapping to object's address
	if (fieldMap.has(table)) return fieldMap.get(table);

	const columns = getTableColumns(table);
	const columnEntries = Object.entries(columns);

	const remapped = Object.fromEntries(
		columnEntries.map(([columnName, columnDescription]) => [
			columnName,
			drizzleColumnToGraphQLType(columnDescription, columnName, tableName),
		]),
	);

	// @ts-expect-error - mapping to object's address
	fieldMap.set(table, remapped);

	return remapped;
};

export const generateTableTypes = <
	TRelations extends Record<string, Relation> | undefined,
	WithReturning extends boolean,
>(
	tableName: string,
	table: Table,
	withReturning: WithReturning,
	relations?: TRelations,
): GeneratedTableTypes<WithReturning> => {
	const relationEntries: [string, Relation][] = relations ? Object.entries(relations) : [];

	const relationFields = Object.fromEntries(
		relationEntries.map<[string, GraphQLFieldConfig<any, any>]>(([relName, relValue]) => {
			const relTableFields = Object.fromEntries(
				Object.entries(getTableColumns(relValue.referencedTable)).map(([columnName, columnDescription]) => [
					columnName,
					drizzleColumnToGraphQLType(
						columnDescription,
						`${pascalize(tableName)}${pascalize(relName)}Relation`,
						columnName,
					),
				]),
			);

			const type = new GraphQLObjectType({
				name: `${pascalize(tableName)}${pascalize(relName)}Relation`,
				fields: relTableFields,
			});

			const relationFilterColumns = generateTableFilterValuesCached(relValue.referencedTable, relName);
			const where = new GraphQLInputObjectType({
				name: `${pascalize(tableName)}${pascalize(relName)}RelationFilters`,
				fields: {
					...relationFilterColumns,
					OR: {
						type: new GraphQLList(
							new GraphQLNonNull(
								new GraphQLInputObjectType({
									name: `${pascalize(tableName)}${pascalize(relName)}RelationFiltersOr`,
									fields: relationFilterColumns,
								}),
							),
						),
					},
				},
			});

			if (is(relValue, One)) {
				return [
					relName,
					{
						type: type,
						args: {
							where: { type: where },
						},
					} as GraphQLFieldConfig<any, any>,
				];
			}

			const orderBy = new GraphQLInputObjectType({
				name: `${pascalize(tableName)}${pascalize(relName)}RelationOrder`,
				fields: Object.fromEntries(
					Object.entries(relValue.referencedTable).map(([columnName, columnDescription]) => [
						columnName,
						{ type: innerOrder },
					]),
				),
			});

			return [
				relName,
				{
					type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(type))),
					args: {
						where: { type: where },
						orderBy: { type: orderBy },
						offset: { type: GraphQLInt },
						limit: { type: GraphQLInt },
					},
				} as GraphQLFieldConfig<any, any>,
			];
		}),
	);

	const tableFields = generateTableSelectTypeFieldsCached(table, tableName);

	const columns = getTableColumns(table);
	const columnEntries = Object.entries(columns);

	const insertFields = Object.fromEntries(
		columnEntries.map(([columnName, columnDescription]) => [
			columnName,
			drizzleColumnToGraphQLType(columnDescription, columnName, tableName, false, true),
		]),
	);

	const updateFields = Object.fromEntries(
		columnEntries.map(([columnName, columnDescription]) => [
			columnName,
			drizzleColumnToGraphQLType(columnDescription, columnName, tableName, true),
		]),
	);

	const insertInput = new GraphQLInputObjectType({
		name: `${pascalize(tableName)}InsertInput`,
		fields: insertFields,
	});

	const selectSingleOutput = new GraphQLObjectType({
		name: `${pascalize(tableName)}SelectItem`,
		fields: { ...tableFields, ...relationFields },
	});

	const selectArrOutput = new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(selectSingleOutput)));

	const singleTableItemOutput = withReturning
		? new GraphQLObjectType({
			name: `${pascalize(tableName)}Item`,
			fields: tableFields,
		})
		: undefined;

	const arrTableItemOutput = withReturning
		? new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(singleTableItemOutput!)))
		: undefined;

	const updateInput = new GraphQLInputObjectType({
		name: `${pascalize(tableName)}UpdateInput`,
		fields: updateFields,
	});

	const tableOrder = new GraphQLInputObjectType({
		name: `${pascalize(tableName)}OrderBy`,
		fields: Object.fromEntries(
			columnEntries.map(([columnName, columnDescription]) => [columnName, { type: innerOrder }]),
		),
	});

	const filterColumns = generateTableFilterValuesCached(table, tableName);

	const tableFilters: GraphQLInputObjectType = new GraphQLInputObjectType({
		name: `${pascalize(tableName)}Filters`,
		fields: {
			...filterColumns,
			OR: {
				type: new GraphQLList(
					new GraphQLNonNull(
						new GraphQLInputObjectType({
							name: `${pascalize(tableName)}FiltersOr`,
							fields: filterColumns,
						}),
					),
				),
			},
		},
	});

	const inputs = {
		insertInput,
		updateInput,
		tableOrder,
		tableFilters,
	};

	const outputs = (
		withReturning
			? {
				selectSingleOutput,
				selectArrOutput,
				singleTableItemOutput: singleTableItemOutput!,
				arrTableItemOutput: arrTableItemOutput!,
			}
			: {
				selectSingleOutput,
				selectArrOutput,
			}
	) as GeneratedTableTypesOutputs<WithReturning>;

	return {
		inputs,
		outputs,
	};
};

export const extractOrderBy = <TTable extends Table, TArgs extends OrderByArgs<any> = OrderByArgs<TTable>>(
	table: TTable,
	orderArgs: TArgs,
): SQL[] => {
	const res = [] as SQL[];

	for (
		const [column, config] of Object.entries(orderArgs).sort(
			(a, b) => (b[1]?.priority ?? 0) - (a[1]?.priority ?? 0),
		)
	) {
		if (!config) continue;
		const { direction } = config;

		res.push(direction === 'asc' ? asc(getTableColumns(table)[column]!) : desc(getTableColumns(table)[column]!));
	}

	return res;
};

export const extractFiltersColumn = <TColumn extends Column>(
	column: TColumn,
	columnName: string,
	operators: FilterColumnOperators<TColumn>,
): SQL | undefined => {
	if (!operators.OR?.length) delete operators.OR;

	const entries = Object.entries(operators as FilterColumnOperatorsCore<TColumn>);

	if (operators.OR) {
		if (entries.length > 1) {
			throw new GraphQLError(`WHERE ${columnName}: Cannot specify both fields and 'OR' in column operators!`);
		}

		const variants = [] as SQL[];

		for (const variant of operators.OR) {
			const extracted = extractFiltersColumn(column, columnName, variant);

			if (extracted) variants.push(extracted);
		}

		return variants.length ? (variants.length > 1 ? or(...variants) : variants[0]) : undefined;
	}

	const variants = [] as SQL[];
	for (const [operatorName, operatorValue] of entries) {
		if (operatorValue === null || operatorValue === false) continue;

		let operator: ((...args: any[]) => SQL) | undefined;
		switch (operatorName as keyof FilterColumnOperatorsCore<TColumn>) {
			// @ts-ignore
			case 'eq':
				operator = operator ?? eq;
			// @ts-ignore
			case 'ne':
				operator = operator ?? ne;
			// @ts-ignore
			case 'gt':
				operator = operator ?? gt;
			// @ts-ignore
			case 'gte':
				operator = operator ?? gte;
			// @ts-ignore
			case 'lt':
				operator = operator ?? lt;
			case 'lte':
				operator = operator ?? lte;

				const singleValue = remapFromGraphQLCore(operatorValue, column, columnName);
				variants.push(operator(column, singleValue));

				break;

			// @ts-ignore
			case 'like':
				operator = operator ?? like;
			// @ts-ignore
			case 'notLike':
				operator = operator ?? notLike;
			// @ts-ignore
			case 'ilike':
				operator = operator ?? ilike;
			case 'notIlike':
				operator = operator ?? notIlike;

				variants.push(operator(column, operatorValue as string));

				break;

			// @ts-ignore
			case 'inArray':
				operator = operator ?? inArray;
			case 'notInArray':
				operator = operator ?? notInArray;

				if (!(operatorValue as any[]).length) {
					throw new GraphQLError(
						`WHERE ${columnName}: Unable to use operator ${operatorName} with an empty array!`,
					);
				}
				const arrayValue = (operatorValue as any[]).map((val) => remapFromGraphQLCore(val, column, columnName));

				variants.push(operator(column, arrayValue));
				break;

			// @ts-ignore
			case 'isNull':
				operator = operator ?? isNull;
			case 'isNotNull':
				operator = operator ?? isNotNull;

				variants.push(operator(column));
		}
	}

	return variants.length ? (variants.length > 1 ? and(...variants) : variants[0]) : undefined;
};

export const extractFilters = <TTable extends Table>(
	table: TTable,
	tableName: string,
	filters: Filters<TTable>,
): SQL | undefined => {
	if (!filters.OR?.length) delete filters.OR;

	const entries = Object.entries(filters as FiltersCore<TTable>);
	if (!entries.length) return;

	if (filters.OR) {
		if (entries.length > 1) {
			throw new GraphQLError(`WHERE ${tableName}: Cannot specify both fields and 'OR' in table filters!`);
		}

		const variants = [] as SQL[];

		for (const variant of filters.OR) {
			const extracted = extractFilters(table, tableName, variant);
			if (extracted) variants.push(extracted);
		}

		return variants.length ? (variants.length > 1 ? or(...variants) : variants[0]) : undefined;
	}

	const variants = [] as SQL[];
	for (const [columnName, operators] of entries) {
		if (operators === null) continue;

		const column = getTableColumns(table)[columnName]!;
		variants.push(extractFiltersColumn(column, columnName, operators)!);
	}

	return variants.length ? (variants.length > 1 ? and(...variants) : variants[0]) : undefined;
};

export const extractRelationsParams = (
	relations: Record<string, Relation>,
	tableSelection: FieldNode,
	typeName: string,
	info: GraphQLResolveInfo,
): Record<string, Partial<ProcessedTableSelectArgs>> | undefined => {
	const fields: Record<string, Partial<ProcessedTableSelectArgs>> = {};
	const parsedInfo = parseResolveInfo(info, {
		deep: true,
	}) as ResolveTree | undefined;

	const baseField = parsedInfo
		? Object.entries(parsedInfo.fieldsByTypeName).find(([key, value]) => key === typeName)?.[1] ?? {}
		: {};

	for (const [relName, relValue] of Object.entries(relations)) {
		if (!tableSelection.selectionSet) continue;

		const node = tableSelection.selectionSet.selections.find(
			(e) => e.kind === Kind.FIELD && e.name.value === relName,
		) as FieldNode | undefined;
		if (!node) continue;

		const refTable = relValue.referencedTable;
		const extractedColumns = extractSelectedColumnsFromNode(node, refTable);
		const columns = Object.keys(extractedColumns).length ? extractedColumns : undefined;

		const relationArgs: Partial<TableSelectArgs> | undefined = (
			Object.values(baseField).find((e) => (e as any).name === relName) as any
		)?.args;

		if (!relationArgs) {
			fields[relName] = {
				columns,
			};

			continue;
		}

		const orderBy = relationArgs.orderBy ? extractOrderBy(refTable, relationArgs.orderBy!) : undefined;
		const where = relationArgs.where ? extractFilters(refTable, relName, relationArgs?.where) : undefined;
		const offset = relationArgs.offset ?? undefined;
		const limit = relationArgs.limit ?? undefined;

		fields[relName] = {
			columns,
			orderBy,
			where,
			offset,
			limit,
		};
	}

	return Object.keys(fields).length ? fields : undefined;
};
