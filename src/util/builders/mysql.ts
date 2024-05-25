import { createTableRelationsHelpers, is, Relation, Relations, Table } from 'drizzle-orm';
import { MySqlDatabase, MySqlTable } from 'drizzle-orm/mysql-core';
import {
	GraphQLBoolean,
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
	db: MySqlDatabase<any, any, any>,
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
	db: MySqlDatabase<any, any, any>,
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

				const columns = extractSelectedColumnsFromNode(tableSelection, table);

				const query = queryBase.findFirst({
					columns,
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
	db: MySqlDatabase<any, any, any, any>,
	tableName: string,
	table: MySqlTable,
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

				await db.insert(table).values(input);

				return { isSuccess: true };
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
	db: MySqlDatabase<any, any, any, any>,
	tableName: string,
	table: MySqlTable,
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

				await db.insert(table).values(input);

				return { isSuccess: true };
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
	db: MySqlDatabase<any, any, any>,
	tableName: string,
	table: MySqlTable,
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

				const input = remapFromGraphQLSingleInput(set, table);
				if (!Object.keys(input).length) throw new GraphQLError('Unable to update with no values specified!');

				let query = db.update(table).set(input);
				if (where) {
					const filters = extractFilters(table, tableName, where);
					query = query.where(filters) as any;
				}

				await query;

				return { isSuccess: true };
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
	db: MySqlDatabase<any, any, any>,
	tableName: string,
	table: MySqlTable,
	filterArgs: GraphQLInputObjectType,
): CreatedResolver => {
	const queryName = `deleteFrom${tableName}`;

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

				let query = db.delete(table);
				if (where) {
					const filters = extractFilters(table, tableName, where);
					query = query.where(filters) as any;
				}

				await query;

				return { isSuccess: true };
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
	TDrizzleInstance extends MySqlDatabase<any, any, any, any>,
	TSchema extends Record<string, Table | unknown>,
>(
	db: TDrizzleInstance,
	schema: TSchema,
): GeneratedEntities<TDrizzleInstance, TSchema> => {
	const rawSchema = schema;
	const schemaEntries = Object.entries(rawSchema);

	const tableEntries = schemaEntries.filter(([key, value]) => is(value, MySqlTable)) as [string, MySqlTable][];
	const tables = Object.fromEntries(tableEntries);

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
			generateTableTypes(tableName, tables, namedRelations, false),
		]),
	);

	const mutationReturnType = new GraphQLObjectType({
		name: `MutationReturn`,
		fields: {
			isSuccess: {
				type: new GraphQLNonNull(GraphQLBoolean),
			},
		},
	});

	const inputs: Record<string, GraphQLInputObjectType> = {};
	const outputs: Record<string, GraphQLObjectType> = {
		MutationReturn: mutationReturnType,
	};

	for (const [tableName, tableTypes] of Object.entries(gqlSchemaTypes)) {
		const { insertInput, updateInput, tableFilters, tableOrder } = tableTypes.inputs;
		const { selectSingleOutput, selectArrOutput } = tableTypes.outputs;

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
		const insertArrGenerated = generateInsertArray(db, tableName, schema[tableName] as MySqlTable, insertInput);
		const insertSingleGenerated = generateInsertSingle(db, tableName, schema[tableName] as MySqlTable, insertInput);
		const updateGenerated = generateUpdate(
			db,
			tableName,
			schema[tableName] as MySqlTable,
			updateInput,
			tableFilters,
		);
		const deleteGenerated = generateDelete(db, tableName, schema[tableName] as MySqlTable, tableFilters);

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
			type: mutationReturnType,
			args: insertArrGenerated.args,
			resolve: insertArrGenerated.resolver,
		};
		mutations[insertSingleGenerated.name] = {
			type: mutationReturnType,
			args: insertSingleGenerated.args,
			resolve: insertSingleGenerated.resolver,
		};
		mutations[updateGenerated.name] = {
			type: mutationReturnType,
			args: updateGenerated.args,
			resolve: updateGenerated.resolver,
		};
		mutations[deleteGenerated.name] = {
			type: mutationReturnType,
			args: deleteGenerated.args,
			resolve: deleteGenerated.resolver,
		};
		[insertInput, updateInput, tableFilters, tableOrder].forEach((e) => (inputs[e.name] = e));
		outputs[selectSingleOutput.name] = selectSingleOutput;
	}

	return { queries, mutations, inputs, types: outputs } as any;
};
