import { type Relation, getTableColumns, type Column, type Table } from 'drizzle-orm'
import { GraphQLError } from 'graphql'

export const remapToGraphQLCore = (key: string, value: any, relations?: Record<string, Relation>): any => {
	if (value instanceof Date) return value.toISOString()

	if (value instanceof Buffer) return Array.from(value)

	if (typeof value === 'bigint') return value.toString()

	if (Array.isArray(value)) {
		if (relations?.[key]) return remapToGraphQLArrayOutput(value)

		return value.map((arrVal) => remapToGraphQLCore(key, arrVal))
	}

	if (typeof value === 'object') {
		if (relations?.[key]) return remapToGraphQLSingleOutput(value)

		return JSON.stringify(value)
	}

	return value
}

export const remapToGraphQLSingleOutput = (queryOutput: Record<string, any>, relations?: Record<string, Relation>) => {
	for (const [key, value] of Object.entries(queryOutput)) {
		if (value === undefined || value === null) {
			delete queryOutput[key]
		} else {
			queryOutput[key] = remapToGraphQLCore(key, value, relations)
		}
	}

	return queryOutput
}

export const remapToGraphQLArrayOutput = (queryOutput: Record<string, any>[], relations?: Record<string, Relation>) => {
	for (const entry of queryOutput) remapToGraphQLSingleOutput(entry, relations)

	return queryOutput
}

export const remapFromGraphQLCore = (value: any, column: Column, columnName: string) => {
	switch (column.dataType) {
		case 'date': {
			const formatted = new Date(value)
			if (Number.isNaN(formatted.getTime())) throw new GraphQLError(`Field '${columnName}' is not a valid date!`)

			return formatted
		}

		case 'buffer': {
			if (!Array.isArray(value)) {
				throw new GraphQLError(`Field '${columnName}' is not an array!`)
			}

			return Buffer.from(value)
		}

		case 'json': {
			try {
				return JSON.parse(value)
			} catch (e) {
				throw new GraphQLError(
					`Invalid JSON in field '${columnName}':\n${e instanceof Error ? e.message : 'Unknown error'}`
				)
			}
		}

		case 'array': {
			if (!Array.isArray(value)) {
				throw new GraphQLError(`Field '${columnName}' is not an array!`)
			}

			return value
		}

		case 'bigint': {
			try {
				return BigInt(value)
			} catch (error) {
				throw new GraphQLError(`Field '${columnName}' is not a BigInt!`)
			}
		}

		default: {
			return value
		}
	}
}

export const remapFromGraphQLSingleInput = (queryInput: Record<string, any>, table: Table) => {
	for (const [key, value] of Object.entries(queryInput)) {
		if (value === undefined) {
			delete queryInput[key]
		} else {
			const column = getTableColumns(table)[key]
			if (!column) throw new GraphQLError(`Unknown column: ${key}`)

			if (value === null && column.notNull) {
				delete queryInput[key]
				continue
			}

			queryInput[key] = remapFromGraphQLCore(value, column, key)
		}
	}

	return queryInput
}

export const remapFromGraphQLArrayInput = (queryInput: Record<string, any>[], table: Table) => {
	for (const entry of queryInput) remapFromGraphQLSingleInput(entry, table)

	return queryInput
}
