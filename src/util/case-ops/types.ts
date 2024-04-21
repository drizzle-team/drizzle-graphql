export type Camelize<T extends string> = Lowercase<T>;

export type Pascalize<T extends string> = Capitalize<Lowercase<T>>;
