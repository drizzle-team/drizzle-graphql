import { type Column, getTableColumns, type Relation, type Table } from 'drizzle-orm';
import { GraphQLError } from 'graphql';
import { TableNamedRelations } from '../builders';

export const remapToGraphQLCore = (
	key: string,
	value: any,
	tableName: string,
	relationMap?: Record<string, Record<string, TableNamedRelations>>,
): any => {
	if (value instanceof Date) return value.toISOString();

	if (value instanceof Buffer) return Array.from(value);

	if (typeof value === 'bigint') return value.toString();

	if (Array.isArray(value)) {
		const relations = relationMap?.[tableName];
		if (relations?.[key]) return remapToGraphQLArrayOutput(value, relations[key]!.targetTableName, relationMap);

		return value.map((arrVal) => remapToGraphQLCore(key, arrVal, tableName, relationMap));
	}

	if (typeof value === 'object') {
		const relations = relationMap?.[tableName];
		if (relations?.[key]) return remapToGraphQLSingleOutput(value, relations[key]!.targetTableName, relationMap);

		return JSON.stringify(value);
	}

	return value;
};

export const remapToGraphQLSingleOutput = (
	queryOutput: Record<string, any>,
	tableName: string,
	relationMap?: Record<string, Record<string, TableNamedRelations>>,
) => {
	for (const [key, value] of Object.entries(queryOutput)) {
		if (value === undefined || value === null) {
			delete queryOutput[key];
		} else {
			queryOutput[key] = remapToGraphQLCore(key, value, tableName, relationMap);
		}
	}

	return queryOutput;
};

export const remapToGraphQLArrayOutput = (
	queryOutput: Record<string, any>[],
	tableName: string,
	relationMap?: Record<string, Record<string, TableNamedRelations>>,
) => {
	for (const entry of queryOutput) remapToGraphQLSingleOutput(entry, tableName, relationMap);

	return queryOutput;
};

export const remapFromGraphQLCore = (value: any, column: Column, columnName: string) => {
	switch (column.dataType) {
		case 'date': {
			const formatted = new Date(value);
			if (Number.isNaN(formatted.getTime())) throw new GraphQLError(`Field '${columnName}' is not a valid date!`);

			return formatted;
		}

		case 'buffer': {
			if (!Array.isArray(value)) {
				throw new GraphQLError(`Field '${columnName}' is not an array!`);
			}

			return Buffer.from(value);
		}

		case 'json': {
			try {
				return JSON.parse(value);
			} catch (e) {
				throw new GraphQLError(
					`Invalid JSON in field '${columnName}':\n${e instanceof Error ? e.message : 'Unknown error'}`,
				);
			}
		}

		case 'array': {
			if (!Array.isArray(value)) {
				throw new GraphQLError(`Field '${columnName}' is not an array!`);
			}

			return value;
		}

		case 'bigint': {
			try {
				return BigInt(value);
			} catch (error) {
				throw new GraphQLError(`Field '${columnName}' is not a BigInt!`);
			}
		}

		default: {
			return value;
		}
	}
};

export const remapFromGraphQLSingleInput = (queryInput: Record<string, any>, table: Table) => {
	for (const [key, value] of Object.entries(queryInput)) {
		if (value === undefined) {
			delete queryInput[key];
		} else {
			const column = getTableColumns(table)[key];
			if (!column) throw new GraphQLError(`Unknown column: ${key}`);

			if (value === null && column.notNull) {
				delete queryInput[key];
				continue;
			}

			queryInput[key] = remapFromGraphQLCore(value, column, key);
		}
	}

	return queryInput;
};

export const remapFromGraphQLArrayInput = (queryInput: Record<string, any>[], table: Table) => {
	for (const entry of queryInput) remapFromGraphQLSingleInput(entry, table);

	return queryInput;
};
