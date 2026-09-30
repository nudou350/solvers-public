import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";

/** Cria o perfil no primeiro acesso (a data vira o "membro desde") e devolve o registro. */
export async function ensureProfile(wallet: string) {
  await db.insert(schema.userProfiles).values({ wallet }).onConflictDoNothing();
  const [row] = await db.select().from(schema.userProfiles).where(eq(schema.userProfiles.wallet, wallet));
  return row!;
}
