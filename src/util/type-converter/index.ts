import { is } from 'drizzle-orm';
import { MySqlInt, MySqlSerial } from 'drizzle-orm/mysql-core';
import { PgInteger, PgSerial } from 'drizzle-orm/pg-core';
import { SQLiteInteger } from 'drizzle-orm/sqlite-core';
import {
	GraphQLBoolean,
	GraphQLEnumType,
	GraphQLFloat,
	GraphQLInt,
	GraphQLList,
	GraphQLNonNull,
	GraphQLScalarType,
	GraphQLString,
} from 'graphql';

import type { Column } from 'drizzle-orm';
import type { PgArray } from 'drizzle-orm/pg-core';
import { pascalize } from '../case-ops';
import type { ConvertedColumn } from './types';

const enumMap = new WeakMap<Record<string, GraphQLEnumType>>();
const generateEnumCached = (column: Column, columnName: string, tableName: string): GraphQLEnumType => {
	// @ts-expect-error - mapping to object's address
	if (enumMap.has(column)) return enumMap.get(column);

	const gqlEnum = new GraphQLEnumType({
		name: `${pascalize(tableName)}${pascalize(columnName)}Enum`,
		values: Object.fromEntries(column.enumValues!.map((e) => [e, {
			value: e,
		}])),
	});

	// @ts-expect-error - mapping to object's address
	enumMap.set(column, gqlEnum);

	return gqlEnum;
};

const columnToGraphQLCore = (column: Column, columnName: string, tableName: string): ConvertedColumn => {
	switch (column.dataType) {
		case 'boolean':
			return { type: GraphQLBoolean, description: 'Boolean' };
		case 'json':
			return { type: GraphQLString, description: 'JSON' };
		case 'date':
			return { type: GraphQLString, description: 'Date' };
		case 'string':
			if (column.enumValues?.length) return { type: generateEnumCached(column, columnName, tableName) };

			return { type: GraphQLString, description: 'String' };
		case 'bigint':
			return { type: GraphQLString, description: 'BigInt' };
		case 'number':
			return is(column, PgInteger)
					|| is(column, PgSerial)
					|| is(column, MySqlInt)
					|| is(column, MySqlSerial)
					|| is(column, SQLiteInteger)
				? { type: GraphQLInt, description: 'Integer' }
				: { type: GraphQLFloat, description: 'Float' };
		case 'buffer':
			return { type: new GraphQLList(new GraphQLNonNull(GraphQLInt)), description: 'Buffer' };
		case 'array': {
			const innerType = columnToGraphQLCore((column as Column as PgArray<any, any>).baseColumn, columnName, tableName);

			return {
				type: new GraphQLList(new GraphQLNonNull(innerType.type as GraphQLScalarType)),
				description: `Array<${innerType.description}>`,
			};
		}
		case 'custom':
		default:
			throw new Error(`Type ${column.dataType} is not implemented!`);
	}
};

export const drizzleColumnToGraphQLType = <TColumn extends Column>(
	column: TColumn,
	columnName: string,
	tableName: string,
	forceNullable = false,
	defaultIsNullable = false,
): ConvertedColumn => {
	const typeDesc = columnToGraphQLCore(column, columnName, tableName);
	const noDesc = ['string', 'boolean', 'number'];
	if (noDesc.find((e) => e === column.dataType)) delete typeDesc.description;

	if (forceNullable) return typeDesc;
	if (column.notNull && !(defaultIsNullable && (column.hasDefault || column.defaultFn))) {
		return {
			type: new GraphQLNonNull(typeDesc.type),
			description: typeDesc.description,
		} as ConvertedColumn;
	}

	return typeDesc;
};

export * from './types';
