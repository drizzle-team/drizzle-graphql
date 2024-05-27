import { relations } from 'drizzle-orm';
import {
	bigint,
	boolean,
	char,
	date,
	int,
	mysqlEnum,
	mysqlTable,
	text,
	timestamp,
	varchar,
} from 'drizzle-orm/mysql-core';

export const Users = mysqlTable('users', {
	id: int('id').autoincrement().primaryKey(),
	name: text('name').notNull(),
	email: text('email'),
	bigint: bigint('big_int', { mode: 'bigint', unsigned: true }),
	birthdayString: date('birthday_string', { mode: 'string' }),
	birthdayDate: date('birthday_date', { mode: 'date' }),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	role: mysqlEnum('role', ['admin', 'user']),
	roleText: text('role1', { enum: ['admin', 'user'] }),
	roleText2: text('role2', { enum: ['admin', 'user'] }).default('user'),
	profession: varchar('profession', { length: 20 }),
	initials: char('initials', { length: 2 }),
	isConfirmed: boolean('is_confirmed'),
});

export const Customers = mysqlTable('customers', {
	id: int('id').autoincrement().primaryKey(),
	address: text('address').notNull(),
	isConfirmed: boolean('is_confirmed'),
	registrationDate: timestamp('registration_date').notNull().defaultNow(),
	userId: int('user_id')
		.references(() => Users.id)
		.notNull(),
});

export const Posts = mysqlTable('posts', {
	id: int('id').autoincrement().primaryKey(),
	content: text('content'),
	authorId: int('author_id'),
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
