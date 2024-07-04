import type {
	GraphQLEnumType,
	GraphQLFieldConfig,
	GraphQLInputObjectType,
	GraphQLList,
	GraphQLNonNull,
	GraphQLObjectType,
	GraphQLScalarType,
} from 'graphql';

export type ConvertedColumn<TIsInput extends boolean = false> = {
	type:
		| GraphQLScalarType
		| GraphQLEnumType
		| GraphQLNonNull<GraphQLScalarType>
		| GraphQLNonNull<GraphQLEnumType>
		| GraphQLList<GraphQLScalarType>
		| GraphQLList<GraphQLNonNull<GraphQLScalarType>>
		| GraphQLNonNull<GraphQLList<GraphQLScalarType>>
		| GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLScalarType>>>
		| (TIsInput extends true ? 
				| GraphQLInputObjectType
				| GraphQLNonNull<GraphQLInputObjectType>
				| GraphQLList<GraphQLInputObjectType>
				| GraphQLNonNull<GraphQLList<GraphQLInputObjectType>>
				| GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLInputObjectType>>>
			: 
				| GraphQLObjectType
				| GraphQLNonNull<GraphQLObjectType>
				| GraphQLList<GraphQLObjectType>
				| GraphQLNonNull<GraphQLList<GraphQLObjectType>>
				| GraphQLNonNull<GraphQLList<GraphQLNonNull<GraphQLObjectType>>>);
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
