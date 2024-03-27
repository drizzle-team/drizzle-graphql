import type { GraphQLList, GraphQLNonNull, GraphQLScalarType } from 'graphql'

export type ConvertedColumn = {
	type:
		| GraphQLScalarType
		| GraphQLNonNull<GraphQLScalarType>
		| GraphQLList<GraphQLScalarType>
		| GraphQLList<GraphQLNonNull<GraphQLScalarType>>
		| GraphQLNonNull<GraphQLList<GraphQLScalarType>>
		| GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLScalarType>>>
	description?: string
}
