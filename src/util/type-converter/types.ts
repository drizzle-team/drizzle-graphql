import type { GraphQLEnumType, GraphQLInputObjectType, GraphQLList, GraphQLNonNull, GraphQLScalarType } from 'graphql';

export type ConvertedColumn = {
	type:
		| GraphQLScalarType
		| GraphQLEnumType
		| GraphQLNonNull<GraphQLScalarType>
		| GraphQLNonNull<GraphQLEnumType>
		| GraphQLList<GraphQLScalarType>
		| GraphQLList<GraphQLNonNull<GraphQLScalarType>>
		| GraphQLNonNull<GraphQLList<GraphQLScalarType>>
		| GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLScalarType>>>;
	description?: string;
};

export type ConvertedInputColumn = {
	type: GraphQLInputObjectType;
	description?: string;
};
