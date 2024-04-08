import { relations } from 'drizzle-orm'
import { boolean, char, date, integer, pgEnum, pgTable, serial, text, timestamp, varchar } from 'drizzle-orm/pg-core'

export const roleEnum = pgEnum('role', ['admin', 'user'])

export const Users = pgTable('users', {
	a: integer('a').array(),
	id: serial('id').primaryKey(),
	name: text('name').notNull(),
	email: text('email'),
	birthdayString: date('birthday_string', { mode: 'string' }),
	birthdayDate: date('birthday_date', { mode: 'date' }),
	createdAt: timestamp('created_at').notNull().defaultNow(),
	role: roleEnum('role'),
	roleText: text('role1', { enum: ['admin', 'user'] }),
	roleText2: text('role2', { enum: ['admin', 'user'] }).default('user'),
	profession: varchar('profession', { length: 20 }),
	initials: char('initials', { length: 2 }),
	isConfirmed: boolean('is_confirmed')
})

export const Customers = pgTable('customers', {
	id: serial('id').primaryKey(),
	address: text('address').notNull(),
	isConfirmed: boolean('is_confirmed'),
	registrationDate: timestamp('registration_date').notNull().defaultNow(),
	userId: integer('user_id')
		.references(() => Users.id)
		.notNull()
})

export const usersRelations = relations(Users, ({ many }) => ({
	posts: many(Posts)
}))

export const Posts = pgTable('posts', {
	id: serial('id').primaryKey(),
	content: text('content'),
	authorId: integer('author_id')
})

export const postsRelations = relations(Posts, ({ one }) => ({
	author: one(Users, {
		fields: [Posts.authorId],
		references: [Users.id]
	})
}))
