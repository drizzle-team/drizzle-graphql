import { createTableRelationsHelpers, is, Relation, Relations, Table } from 'drizzle-orm';
import { PgColumn, PgDatabase, PgTable } from 'drizzle-orm/pg-core';
import {
	GraphQLError,
	GraphQLInputObjectType,
	GraphQLInt,
	GraphQLList,
	GraphQLNonNull,
	GraphQLObjectType,
	Kind,
} from 'graphql';

import {
	extractFilters,
	extractOrderBy,
	extractRelationsParams,
	extractSelectedColumnsFromNode,
	extractSelectedColumnsSQLFormat,
	generateTableTypes,
} from '@/util/builders/common';
import { camelize, pascalize } from '@/util/case-ops';
import {
	remapFromGraphQLArrayInput,
	remapFromGraphQLSingleInput,
	remapToGraphQLArrayOutput,
	remapToGraphQLSingleOutput,
} from '@/util/data-mappers';

import type { GeneratedEntities } from '@/types';
import type { RelationalQueryBuilder } from 'drizzle-orm/mysql-core/query-builders/query';
import type { FieldNode, GraphQLFieldConfig, GraphQLFieldConfigArgumentMap, ThunkObjMap } from 'graphql';
import type { CreatedResolver, Filters, TableNamedRelations, TableSelectArgs } from './types';

const generateSelectArray = (
	db: PgDatabase<any, any, any>,
	tableName: string,
	tables: Record<string, Table>,
	relationMap: Record<string, Record<string, TableNamedRelations>>,
	orderArgs: GraphQLInputObjectType,
	filterArgs: GraphQLInputObjectType,
): CreatedResolver => {
	const queryName = `${camelize(tableName)}`;
	const queryBase = db.query[tableName as keyof typeof db.query] as unknown as
		| RelationalQueryBuilder<any, any, any>
		| undefined;
	if (!queryBase) {
		throw new Error(
			`Table ${tableName} not found in drizzle instance. Did you forget to pass schema to drizzle constructor?`,
		);
	}

	const queryArgs = {
		offset: {
			type: GraphQLInt,
		},
		limit: {
			type: GraphQLInt,
		},
		orderBy: {
			type: orderArgs,
		},
		where: {
			type: filterArgs,
		},
	} as GraphQLFieldConfigArgumentMap;

	const typeName = `${pascalize(tableName)}SelectItem`;
	const table = tables[tableName]!;

	return {
		name: queryName,
		resolver: async (source, args: Partial<TableSelectArgs>, context, info) => {
			try {
				const { offset, limit, orderBy, where } = args;
				const tableSelection = info.operation.selectionSet.selections.find(
					(e) => e.kind === Kind.FIELD && e.name.value === info.fieldName,
				) as FieldNode;

				const query = queryBase.findMany({
					columns: extractSelectedColumnsFromNode(tableSelection, table),
					offset,
					limit,
					orderBy: orderBy ? extractOrderBy(table, orderBy) : undefined,
					where: where ? extractFilters(table, tableName, where) : undefined,
					with: relationMap[tableName]
						? extractRelationsParams(relationMap, tables, tableName, info, typeName)
						: undefined,
				});

				const result = await query;

				return remapToGraphQLArrayOutput(result, tableName, relationMap);
			} catch (e) {
				if (typeof e === 'object' && typeof (<any> e).message === 'string') {
					throw new GraphQLError((<any> e).message);
				}

				throw e;
			}
		},
		args: queryArgs,
	};
};

const generateSelectSingle = (
	db: PgDatabase<any, any, any>,
	tableName: string,
	tables: Record<string, Table>,
	relationMap: Record<string, Record<string, TableNamedRelations>>,
	orderArgs: GraphQLInputObjectType,
	filterArgs: GraphQLInputObjectType,
): CreatedResolver => {
	const queryName = `${camelize(tableName)}Single`;
	const queryBase = db.query[tableName as keyof typeof db.query] as unknown as
		| RelationalQueryBuilder<any, any, any>
		| undefined;
	if (!queryBase) {
		throw new Error(
			`Table ${tableName} not found in drizzle instance. Did you forget to pass schema to drizzle constructor?`,
		);
	}

	const queryArgs = {
		offset: {
			type: GraphQLInt,
		},
		orderBy: {
			type: orderArgs,
		},
		where: {
			type: filterArgs,
		},
	} as GraphQLFieldConfigArgumentMap;

	const typeName = `${pascalize(tableName)}SelectItem`;
	const table = tables[tableName]!;

	return {
		name: queryName,
		resolver: async (source, args: Partial<TableSelectArgs>, context, info) => {
			try {
				const { offset, orderBy, where } = args;
				const tableSelection = info.operation.selectionSet.selections.find(
					(e) => e.kind === Kind.FIELD && e.name.value === info.fieldName,
				) as FieldNode;

				const query = queryBase.findFirst({
					columns: extractSelectedColumnsFromNode(tableSelection, table),
					offset,
					orderBy: orderBy ? extractOrderBy(table, orderBy) : undefined,
					where: where ? extractFilters(table, tableName, where) : undefined,
					with: relationMap[tableName]
						? extractRelationsParams(relationMap, tables, tableName, info, typeName)
						: undefined,
				});

				const result = await query;
				if (!result) return undefined;

				return remapToGraphQLSingleOutput(result, tableName, relationMap);
			} catch (e) {
				if (typeof e === 'object' && typeof (<any> e).message === 'string') {
					throw new GraphQLError((<any> e).message);
				}

				throw e;
			}
		},
		args: queryArgs,
	};
};

const generateInsertArray = (
	db: PgDatabase<any, any, any>,
	tableName: string,
	table: PgTable,
	baseType: GraphQLInputObjectType,
): CreatedResolver => {
	const queryName = `insertInto${pascalize(tableName)}`;

	const queryArgs: GraphQLFieldConfigArgumentMap = {
		values: {
			type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(baseType))),
		},
	};

	return {
		name: queryName,
		resolver: async (source, args: { values: Record<string, any>[] }, context, info) => {
			try {
				const input = remapFromGraphQLArrayInput(args.values, table);
				if (!input.length) throw new GraphQLError('No values were provided!');

				const columns = extractSelectedColumnsSQLFormat(info, info.fieldName, table) as Record<string, PgColumn>;

				const result = await db.insert(table).values(input).returning(columns).onConflictDoNothing();

				return remapToGraphQLArrayOutput(result, tableName);
			} catch (e) {
				if (typeof e === 'object' && typeof (<any> e).message === 'string') {
					throw new GraphQLError((<any> e).message);
				}

				throw e;
			}
		},
		args: queryArgs,
	};
};

const generateInsertSingle = (
	db: PgDatabase<any, any, any>,
	tableName: string,
	table: PgTable,
	baseType: GraphQLInputObjectType,
): CreatedResolver => {
	const queryName = `insertInto${pascalize(tableName)}Single`;

	const queryArgs: GraphQLFieldConfigArgumentMap = {
		values: {
			type: new GraphQLNonNull(baseType),
		},
	};

	return {
		name: queryName,
		resolver: async (source, args: { values: Record<string, any> }, context, info) => {
			try {
				const input = remapFromGraphQLSingleInput(args.values, table);

				const columns = extractSelectedColumnsSQLFormat(info, info.fieldName, table) as Record<string, PgColumn>;

				const result = await db.insert(table).values(input).returning(columns).onConflictDoNothing();

				if (!result[0]) return undefined;

				return remapToGraphQLSingleOutput(result[0], tableName);
			} catch (e) {
				if (typeof e === 'object' && typeof (<any> e).message === 'string') {
					throw new GraphQLError((<any> e).message);
				}

				throw e;
			}
		},
		args: queryArgs,
	};
};

const generateUpdate = (
	db: PgDatabase<any, any, any>,
	tableName: string,
	table: PgTable,
	setArgs: GraphQLInputObjectType,
	filterArgs: GraphQLInputObjectType,
): CreatedResolver => {
	const queryName = `update${pascalize(tableName)}`;

	const queryArgs = {
		set: {
			type: new GraphQLNonNull(setArgs),
		},
		where: {
			type: filterArgs,
		},
	} as const satisfies GraphQLFieldConfigArgumentMap;

	return {
		name: queryName,
		resolver: async (source, args: { where?: Filters<Table>; set: Record<string, any> }, context, info) => {
			try {
				const { where, set } = args;

				const columns = extractSelectedColumnsSQLFormat(info, info.fieldName, table) as Record<string, PgColumn>;
				const input = remapFromGraphQLSingleInput(set, table);
				if (!Object.keys(input).length) throw new GraphQLError('Unable to update with no values specified!');

				let query = db.update(table).set(input);
				if (where) {
					const filters = extractFilters(table, tableName, where);
					query = query.where(filters) as any;
				}

				query = query.returning(columns) as any;

				const result = await query;

				return remapToGraphQLArrayOutput(result, tableName);
			} catch (e) {
				if (typeof e === 'object' && typeof (<any> e).message === 'string') {
					throw new GraphQLError((<any> e).message);
				}

				throw e;
			}
		},
		args: queryArgs,
	};
};

const generateDelete = (
	db: PgDatabase<any, any, any>,
	tableName: string,
	table: PgTable,
	filterArgs: GraphQLInputObjectType,
): CreatedResolver => {
	const queryName = `deleteFrom${pascalize(tableName)}`;

	const queryArgs = {
		where: {
			type: filterArgs,
		},
	} as const satisfies GraphQLFieldConfigArgumentMap;

	return {
		name: queryName,
		resolver: async (source, args: { where?: Filters<Table> }, context, info) => {
			try {
				const { where } = args;

				const columns = extractSelectedColumnsSQLFormat(info, info.fieldName, table) as Record<string, PgColumn>;

				let query = db.delete(table);
				if (where) {
					const filters = extractFilters(table, tableName, where);
					query = query.where(filters) as any;
				}

				query = query.returning(columns) as any;

				const result = await query;

				return remapToGraphQLArrayOutput(result, tableName);
			} catch (e) {
				if (typeof e === 'object' && typeof (<any> e).message === 'string') {
					throw new GraphQLError((<any> e).message);
				}

				throw e;
			}
		},
		args: queryArgs,
	};
};

export const generateSchemaData = <
	TDrizzleInstance extends PgDatabase<any, any, any>,
	TSchema extends Record<string, Table | unknown>,
>(
	db: TDrizzleInstance,
	schema: TSchema,
): GeneratedEntities<TDrizzleInstance, TSchema> => {
	const rawSchema = schema;
	const schemaEntries = Object.entries(rawSchema);

	const tableEntries = schemaEntries.filter(([key, value]) => is(value, PgTable)) as [string, PgTable][];
	const tables = Object.fromEntries(tableEntries) as Record<
		string,
		PgTable
	>;

	const rawRelations = schemaEntries
		.filter(([key, value]) => is(value, Relations))
		.map<[string, Relations]>(([key, value]) => [
			tableEntries.find(
				([tableName, tableValue]) => tableValue === (value as Relations).table,
			)![0] as string,
			value as Relations,
		]).map<[string, Record<string, Relation>]>(([tableName, relValue]) => [
			tableName,
			relValue.config(createTableRelationsHelpers(tables[tableName]!)),
		]);

	const relations = Object.fromEntries(rawRelations);

	const namedRelations = Object.fromEntries(
		rawRelations
			.map(([relName, config]) => {
				const namedConfig: Record<string, TableNamedRelations> = Object.fromEntries(
					Object.entries(config).map(([innerRelName, innerRelValue]) => [innerRelName, {
						relation: innerRelValue,
						targetTableName: tableEntries.find(([tableName, tableValue]) =>
							tableValue === innerRelValue.referencedTable
						)![0],
					}]),
				);

				return [
					relName,
					namedConfig,
				];
			}),
	);

	const queries: ThunkObjMap<GraphQLFieldConfig<any, any>> = {};
	const mutations: ThunkObjMap<GraphQLFieldConfig<any, any>> = {};
	const gqlSchemaTypes = Object.fromEntries(
		Object.entries(tables).map(([tableName, table]) => [
			tableName,
			generateTableTypes(tableName, tables, namedRelations, true),
		]),
	);

	const inputs: Record<string, GraphQLInputObjectType> = {};
	const outputs: Record<string, GraphQLObjectType> = {};

	for (const [tableName, tableTypes] of Object.entries(gqlSchemaTypes)) {
		const { insertInput, updateInput, tableFilters, tableOrder } = tableTypes.inputs;
		const { selectSingleOutput, selectArrOutput, singleTableItemOutput, arrTableItemOutput } = tableTypes.outputs;

		const selectArrGenerated = generateSelectArray(
			db,
			tableName,
			tables,
			namedRelations,
			tableOrder,
			tableFilters,
		);
		const selectSingleGenerated = generateSelectSingle(
			db,
			tableName,
			tables,
			namedRelations,
			tableOrder,
			tableFilters,
		);
		const insertArrGenerated = generateInsertArray(db, tableName, schema[tableName] as PgTable, insertInput);
		const insertSingleGenerated = generateInsertSingle(db, tableName, schema[tableName] as PgTable, insertInput);
		const updateGenerated = generateUpdate(db, tableName, schema[tableName] as PgTable, updateInput, tableFilters);
		const deleteGenerated = generateDelete(db, tableName, schema[tableName] as PgTable, tableFilters);

		queries[selectArrGenerated.name] = {
			type: selectArrOutput,
			args: selectArrGenerated.args,
			resolve: selectArrGenerated.resolver,
		};
		queries[selectSingleGenerated.name] = {
			type: selectSingleOutput,
			args: selectSingleGenerated.args,
			resolve: selectSingleGenerated.resolver,
		};
		mutations[insertArrGenerated.name] = {
			type: arrTableItemOutput,
			args: insertArrGenerated.args,
			resolve: insertArrGenerated.resolver,
		};
		mutations[insertSingleGenerated.name] = {
			type: singleTableItemOutput,
			args: insertSingleGenerated.args,
			resolve: insertSingleGenerated.resolver,
		};
		mutations[updateGenerated.name] = {
			type: arrTableItemOutput,
			args: updateGenerated.args,
			resolve: updateGenerated.resolver,
		};
		mutations[deleteGenerated.name] = {
			type: arrTableItemOutput,
			args: deleteGenerated.args,
			resolve: deleteGenerated.resolver,
		};
		[insertInput, updateInput, tableFilters, tableOrder].forEach((e) => (inputs[e.name] = e));
		outputs[selectSingleOutput.name] = selectSingleOutput;
		outputs[singleTableItemOutput.name] = singleTableItemOutput;
	}

	return { queries, mutations, inputs, types: outputs } as any;
};
