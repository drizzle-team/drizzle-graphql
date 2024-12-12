import { relations } from 'drizzle-orm';
import {
	boolean,
	char,
	date,
	geometry,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	serial,
	text,
	timestamp,
	varchar,
	vector,
} from 'drizzle-orm/pg-core';

export const roleEnum = pgEnum('role', ['admin', 'user']);

export const Users = pgTable('users', {
	a: integer('a').array(),
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email'),
	configArray: jsonb('config_array').$type<string[]>(),
	configObject: jsonb('config_object').$type<{ darkMode: boolean }>(),
	birthdayString: date('birthday_string', { mode: 'string' }),
	birthdayDate: date('birthday_date', { mode: 'date' }),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	role: roleEnum('role'),
	roleText: text('role1', { enum: ['admin', 'user'] }),
	roleText2: text('role2', { enum: ['admin', 'user'] }).default('user'),
	profession: varchar('profession', { length: 20 }),
	initials: char('initials', { length: 2 }),
	isConfirmed: boolean('is_confirmed'),
	vector: vector('vector_column', { dimensions: 5 }),
	geoXy: geometry('geometry_xy', {
		mode: 'xy',
	}),
	geoTuple: geometry('geometry_tuple', {
		mode: 'tuple',
	}),
});

export const Customers = pgTable('customers', {
	id: serial('id').primaryKey(),
	address: text('address').notNull(),
	isConfirmed: boolean('is_confirmed'),
	registrationDate: timestamp('registration_date').notNull().defaultNow(),
	userId: integer('user_id')
		.references(() => Users.id)
		.notNull(),
});

export const Posts = pgTable('posts', {
	id: serial('id').primaryKey(),
	content: text('content'),
	authorId: integer('author_id'),
});

export const usersRelations = relations(Users, ({ one, many }) => ({
	posts: many(Posts),
	customer: one(Customers, {
		fields: [Users.id],
		references: [Customers.userId],
	}),
}));

export const customersRelations = relations(Customers, ({ one, many }) => ({
	user: one(Users, {
		fields: [Customers.userId],
		references: [Users.id],
	}),
	posts: many(Posts),
}));

export const postsRelations = relations(Posts, ({ one }) => ({
	author: one(Users, {
		fields: [Posts.authorId],
		references: [Users.id],
	}),
	customer: one(Customers, {
		fields: [Posts.authorId],
		references: [Customers.userId],
	}),
}));
