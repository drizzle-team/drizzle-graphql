import type { Camelize, Pascalize } from './types'

export const camelize = <T extends string>(input: T) => input.toLocaleLowerCase() as Camelize<T>

export const pascalize = <T extends string>(input: T) =>
	(input.length
		? `${input[0]!.toLocaleUpperCase()}${input.length > 1 ? input.slice(1, input.length) : ''}`
		: input) as Pascalize<T>

export * from './types'
