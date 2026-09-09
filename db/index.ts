import { env } from "cloudflare:workers";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export function getD1() {
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Build the Site and apply its migrations before starting the preview.",
    );
  }
  return env.DB;
}

export function getDb() {
  return drizzle(getD1(), { schema });
}
