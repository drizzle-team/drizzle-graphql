import { relations } from 'drizzle-orm';
import { blob, integer, numeric, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const Users = sqliteTable('users', {
	id: integer('id').primaryKey().notNull(),
	name: text('name').notNull(),
	email: text('email'),
	textJson: text('text_json', { mode: 'json' }),
	blobBigInt: blob('blob_bigint', { mode: 'bigint' }),
	numeric: numeric('numeric'),
	createdAt: integer('created_at', { mode: 'timestamp' }),
	createdAtMs: integer('created_at_ms', { mode: 'timestamp_ms' }),
	real: real('real'),
	text: text('text', { length: 255 }),
	role: text('role', { enum: ['admin', 'user'] }).default('user'),
	isConfirmed: integer('is_confirmed', {
		mode: 'boolean',
	}),
});

export const Customers = sqliteTable('customers', {
	id: integer('id').primaryKey(),
	address: text('address').notNull(),
	isConfirmed: integer('is_confirmed', { mode: 'boolean' }),
	registrationDate: integer('registration_date', { mode: 'timestamp_ms' })
		.notNull()
		.$defaultFn(() => new Date()),
	userId: integer('user_id')
		.references(() => Users.id)
		.notNull(),
});

export const Posts = sqliteTable('posts', {
	id: integer('id').primaryKey(),
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
