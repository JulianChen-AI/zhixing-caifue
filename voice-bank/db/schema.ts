import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const demoSessions = sqliteTable("demo_sessions", {
  id: text("id").primaryKey(),
  owner: text("owner").notNull(),
  revision: integer("revision").notNull().default(0),
  state: text("state").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
