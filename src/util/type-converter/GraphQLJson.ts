import { GraphQLScalarType, Kind } from 'graphql';
export const GraphQLJson = new GraphQLScalarType({
	name: 'JSON',
	description: 'The JSON scalar type represents JSON values as scalars.',
	serialize(value) {
		return value;
	},
	parseValue(value) {
		return value;
	},
	parseLiteral(ast) {
		if (ast.kind === Kind.STRING) {
			return JSON.parse(ast.value);
		}
		return null;
	},
});
