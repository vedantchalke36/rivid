/**
 * Drizzle ORM schema for @rivid/core identifiers on PostgreSQL.
 *
 * Three canonical layouts (mirroring benchmarks/db/init.sql):
 *   users_ulid     CHAR(26)  PK, client-side default = ulid()
 *   users_uuid7    UUID      PK, client-side default = uuidv7()
 *   users_binary   BYTEA(16) PK, client-side default = ulidBytes()
 *
 * All defaults use Rivid (generation mode A). DB-generated variants
 * (`gen_random_uuid()`) are covered in test.mts as mode C.
 */
import { customType, pgTable, text, timestamp, char } from "drizzle-orm/pg-core";
import { ulid, uuidv7, ulidBytes } from "@rivid/core";

/** PostgreSQL CHAR(n) → string. */
export const char26 = char("id", { length: 26 });

/** PostgreSQL BYTEA ↔ Uint8Array. */
export const bytea = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const usersUlid = pgTable("users_ulid", {
  id: char("id", { length: 26 })
    .primaryKey()
    .$defaultFn(() => ulid()),
  email: text("email").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usersUuidV7 = pgTable("users_uuid7_drizzle", {
  id: char("id", { length: 36 })
    .primaryKey()
    .$defaultFn(() => uuidv7()),
  email: text("email").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const usersBinary = pgTable("users_binary_drizzle", {
  id: bytea("id").primaryKey().$defaultFn(() => ulidBytes()),
  email: text("email").notNull(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
