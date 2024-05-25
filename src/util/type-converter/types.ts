import type {
	GraphQLEnumType,
	GraphQLFieldConfig,
	GraphQLInputObjectType,
	GraphQLList,
	GraphQLNonNull,
	GraphQLObjectType,
	GraphQLScalarType,
} from 'graphql';

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

export type ConvertedColumnWithArgs = ConvertedColumn & {
	args?: GraphQLFieldConfig<any, any>['args'];
};

export type ConvertedInputColumn = {
	type: GraphQLInputObjectType;
	description?: string;
};

export type ConvertedRelationColumn = {
	type:
		| GraphQLObjectType
		| GraphQLNonNull<GraphQLObjectType>
		| GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLObjectType>>>;
};

export type ConvertedRelationColumnWithArgs = ConvertedRelationColumn & {
	args?: GraphQLFieldConfig<any, any>['args'];
};
