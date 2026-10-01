import { and, desc, eq, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";

// Espelho banco <- eventos da revenda (LicenseListed / LicenseResold / ListingCancelled) e da posse da licença.
// Só mexe no banco (sem RPC), então é testado com dados sintéticos em test/resale.db.test.ts. Quem chama
// (processor.ts / sync.ts) busca o que precisa na cadeia e passa os valores prontos.
//
// Tudo aqui é IDEMPOTENTE e tolera reprocessamento fora de ordem (reindex, nova tentativa): cada linha de `listings`
// guarda a assinatura que a abriu (open_signature) e a que a fechou (close_signature), e um evento já aplicado é
// reconhecido por elas. A conta `Listing` do programa é por ASSET (o mesmo PDA a cada relistagem): por isso há uma linha
// por anúncio e só uma `active` por licença (índice único parcial).

type ListingRow = typeof schema.listings.$inferSelect;

/** Erro de violação de unicidade do Postgres (duas requisições processando o mesmo anúncio ao mesmo tempo). */
function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === "23505" || (e as { cause?: { code?: string } })?.cause?.code === "23505";
}

/** `licenses.listed_for_resale` / `resale_price` seguem o anúncio ativo da licença (ou limpam, se não há). */
export async function mirrorListingFlags(licenseId: string): Promise<void> {
  const [active] = await db
    .select({ price: schema.listings.price })
    .from(schema.listings)
    .where(and(eq(schema.listings.licenseId, licenseId), eq(schema.listings.status, "active")));
  await db
    .update(schema.licenses)
    .set({ listedForResale: !!active, resalePrice: active?.price ?? null })
    .where(eq(schema.licenses.id, licenseId));
}

/**
 * Espelha a licença. Quando o DONO muda, o novo dono recebe `acquired_at`/`signature` da aquisição e os sinais de
 * anúncio são zerados (o anúncio era do dono antigo); sem mudança de dono nada disso é tocado. Anúncios ativos que não
 * são do dono atual viram 'invalid'.
 */
export async function upsertLicenseRow(v: { asset: string; agentId: string; owner: string; acquiredAt: Date; signature: string | null }): Promise<void> {
  const t = schema.licenses;
  const changed = sql`${t.ownerWallet} <> excluded.owner_wallet`;
  await db
    .insert(t)
    .values({ id: v.asset, agentId: v.agentId, ownerWallet: v.owner, acquiredAt: v.acquiredAt, type: "permanent", signature: v.signature })
    .onConflictDoUpdate({
      target: t.id,
      set: {
        ownerWallet: sql`excluded.owner_wallet`,
        acquiredAt: sql`case when ${changed} then excluded.acquired_at else ${t.acquiredAt} end`,
        signature: sql`case when ${changed} then excluded.signature else ${t.signature} end`,
        listedForResale: sql`case when ${changed} then false else ${t.listedForResale} end`,
        resalePrice: sql`case when ${changed} then null else ${t.resalePrice} end`,
      },
    });
  await closeStaleListings(v.asset, v.owner);
}

/** Revalidação de posse (transferência fora da plataforma): mesma regra de `upsertLicenseRow`, sem criar a licença. */
export async function setLicenseOwner(asset: string, owner: string): Promise<void> {
  const t = schema.licenses;
  const [cur] = await db.select({ owner: t.ownerWallet }).from(t).where(eq(t.id, asset));
  if (!cur) return;
  if (cur.owner !== owner) {
    await db.update(t).set({ ownerWallet: owner, acquiredAt: new Date(), signature: null, listedForResale: false, resalePrice: null }).where(eq(t.id, asset));
  }
  await closeStaleListings(asset, owner);
}

/** A licença deixou de existir on-chain (queimada): apaga a linha e fecha os anúncios ativos como 'invalid'. */
export async function removeLicenseRow(asset: string): Promise<void> {
  await db
    .update(schema.listings)
    .set({ status: "invalid", closedAt: new Date() })
    .where(and(eq(schema.listings.licenseId, asset), eq(schema.listings.status, "active")));
  await db.delete(schema.licenses).where(eq(schema.licenses.id, asset));
}

/** Anúncio ativo cujo vendedor não é mais o dono da licença não pode ser executado: fecha como 'invalid'. */
export async function closeStaleListings(licenseId: string, owner: string): Promise<number> {
  const closed = await db
    .update(schema.listings)
    .set({ status: "invalid", closedAt: new Date() })
    .where(and(eq(schema.listings.licenseId, licenseId), eq(schema.listings.status, "active"), ne(schema.listings.sellerWallet, owner)))
    .returning({ id: schema.listings.id });
  if (closed.length > 0) await mirrorListingFlags(licenseId);
  return closed.length;
}

/** A conta `Listing` não existe mais: anúncios ativos naquele endereço viram 'invalid' (não dá para saber se foi venda ou cancelamento). */
export async function closeListingsAt(listingAddress: string): Promise<number> {
  const closed = await db
    .update(schema.listings)
    .set({ status: "invalid", closedAt: new Date() })
    .where(and(eq(schema.listings.listingAddress, listingAddress), eq(schema.listings.status, "active")))
    .returning({ licenseId: schema.listings.licenseId });
  for (const id of new Set(closed.map((c) => c.licenseId))) await mirrorListingFlags(id);
  return closed.length;
}

/**
 * Dono a gravar quando o evento `LicenseResold` chega. A releitura da conta pode vir atrasada e mostrar ainda o vendedor:
 * numa venda RECENTE o evento manda (o comprador é o novo dono). Em venda antiga (reprocesso/backfill) vale o que a cadeia
 * diz hoje, porque a licença pode ter mudado de mãos depois. Dono lido que não é nem o vendedor nem o comprador também
 * vale (houve transferência posterior).
 */
export function resoldOwner(coreOwner: string, sale: { seller: string; buyer: string }, fresh: boolean): string {
  if (fresh && (coreOwner === sale.seller || coreOwner === sale.buyer)) return sale.buyer;
  return coreOwner;
}

export type ListedInput = {
  licenseId: string;
  agentId: string;
  listingAddress: string;
  seller: string;
  price: bigint;
  feeBps: number;
  royaltyBps: number;
  listedAt: Date;
  /** Assinatura do `list_license`; null quando vem de uma releitura da conta (reconciliação). */
  signature: string | null;
};

/**
 * `LicenseListed`: abre o anúncio ativo. Se já havia outro ativo para a licença (relistagem depois de um fechamento que o
 * indexador não viu) o antigo vira 'invalid'. Reprocessar a mesma assinatura não duplica.
 */
export async function applyListed(i: ListedInput): Promise<"inserted" | "exists"> {
  const l = schema.listings;
  const run = async (): Promise<"inserted" | "exists"> =>
    db.transaction(async (tx) => {
      if (i.signature) {
        const [same] = await tx.select({ id: l.id }).from(l).where(and(eq(l.licenseId, i.licenseId), eq(l.openSignature, i.signature)));
        if (same) return "exists";
      }
      const [active] = await tx.select().from(l).where(and(eq(l.licenseId, i.licenseId), eq(l.status, "active")));
      if (active) {
        // Reconciliação (sem assinatura): o anúncio ativo idêntico já é este.
        const identical =
          active.sellerWallet === i.seller && active.price === i.price && active.feeBps === i.feeBps && active.royaltyBps === i.royaltyBps;
        if (!i.signature && identical) return "exists";
        await tx.update(l).set({ status: "invalid", closedAt: new Date(), closeSignature: i.signature }).where(eq(l.id, active.id));
      }
      await tx.insert(l).values({
        licenseId: i.licenseId,
        agentId: i.agentId,
        listingAddress: i.listingAddress,
        sellerWallet: i.seller,
        price: i.price,
        feeBps: i.feeBps,
        royaltyBps: i.royaltyBps,
        status: "active",
        listedAt: i.listedAt,
        openSignature: i.signature,
      });
      return "inserted";
    });
  let out: "inserted" | "exists";
  try {
    out = await run();
  } catch (e) {
    // Outra requisição abriu o mesmo anúncio entre a leitura e a escrita: o resultado final é o mesmo.
    if (!isUniqueViolation(e)) throw e;
    out = "exists";
  }
  await mirrorListingFlags(i.licenseId);
  return out;
}

export type SoldInput = {
  licenseId: string;
  agentId: string;
  listingAddress: string;
  seller: string;
  buyer: string;
  /** Valores do PRÓPRIO evento `LicenseResold` (nunca recalculados). */
  price: bigint;
  royalty: bigint;
  fee: bigint;
  sellerAmount: bigint;
  signature: string;
  blockTime: Date | null;
};

const BPS = 10_000n;
const bpsOf = (part: bigint, total: bigint) => (total > 0n ? Number((part * BPS) / total) : 0);

/**
 * `LicenseResold`: fecha o anúncio como 'sold' com royalty/taxa/líquido do evento. Procura, nesta ordem: o anúncio já
 * fechado por esta assinatura (reprocesso: nada a fazer), o ativo do vendedor, e o que uma releitura de posse (refresh)
 * fechou como 'invalid' antes de o evento chegar. Sem nenhum deles (anúncio nunca indexado), grava uma linha 'sold'
 * só com o que o evento diz. Não toca vendas, reputação nem `chain_txs` (isso é do chamador).
 */
export async function applySold(i: SoldInput): Promise<ListingRow> {
  const l = schema.listings;
  const closedAt = i.blockTime ?? new Date();
  const row = await db.transaction(async (tx) => {
    // Chamadas simultâneas do MESMO evento (webhook + polling + /tx/submit) se enfileiram aqui; o índice único parcial
    // (license_id, close_signature) onde status = 'sold' é a rede de segurança se o lock falhar.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`sold:${i.licenseId}:${i.signature}`}))`);
    const [done] = await tx.select().from(l).where(and(eq(l.licenseId, i.licenseId), eq(l.closeSignature, i.signature), eq(l.status, "sold")));
    if (done) return done;
    // Só um anúncio que já existia no momento da venda pode ser o vendido: uma venda antiga processada tarde não fecha
    // o anúncio NOVO que o dono abriu depois dela.
    const [cand] = await tx
      .select()
      .from(l)
      .where(
        and(
          eq(l.licenseId, i.licenseId),
          eq(l.sellerWallet, i.seller),
          lte(l.listedAt, closedAt),
          or(isNull(l.openSignature), ne(l.openSignature, i.signature)),
          or(eq(l.status, "active"), and(eq(l.status, "invalid"), isNull(l.closeSignature))),
        ),
      )
      .orderBy(desc(l.id))
      .limit(1);
    const sold = { status: "sold", buyerWallet: i.buyer, soldPrice: i.price, royalty: i.royalty, fee: i.fee, sellerAmount: i.sellerAmount, closedAt, closeSignature: i.signature };
    const [out] = cand
      ? await tx.update(l).set(sold).where(eq(l.id, cand.id)).returning()
      : await tx
          .insert(l)
          .values({
            licenseId: i.licenseId,
            agentId: i.agentId,
            listingAddress: i.listingAddress,
            sellerWallet: i.seller,
            price: i.price,
            // Anúncio não indexado: os bps congelados não vêm no evento, então saem do que foi pago.
            feeBps: bpsOf(i.fee, i.price),
            royaltyBps: bpsOf(i.royalty, i.price),
            listedAt: closedAt,
            ...sold,
          })
          .returning();
    return out;
  });
  await mirrorListingFlags(i.licenseId);
  if (!row) throw new Error(`venda da licença ${i.licenseId} não gravada`);
  return row;
}

/** O novo dono recebe a data/assinatura da compra (a releitura de posse pode ter chegado antes do evento). */
export async function markLicenseAcquired(licenseId: string, owner: string, acquiredAt: Date | null, signature: string): Promise<void> {
  await db
    .update(schema.licenses)
    .set({ acquiredAt: acquiredAt ?? new Date(), signature })
    .where(and(eq(schema.licenses.id, licenseId), eq(schema.licenses.ownerWallet, owner)));
}

export type CancelledInput = { licenseId: string; seller: string; canceller: string; signature: string; blockTime: Date | null };

/**
 * `ListingCancelled`: 'cancelled' quando quem assinou é o vendedor; 'invalid' quando um terceiro fechou um anúncio velho
 * (dono mudou, delegate revogado, asset queimado). Reprocessar a mesma assinatura não fecha o anúncio NOVO que a mesma
 * transação pode ter aberto em seguida (cancelar o velho + anunciar de novo).
 */
export async function applyCancelled(i: CancelledInput): Promise<"closed" | "none"> {
  const l = schema.listings;
  const [done] = await db.select({ id: l.id }).from(l).where(and(eq(l.licenseId, i.licenseId), eq(l.closeSignature, i.signature)));
  if (done) return "none";
  const closed = await db
    .update(l)
    .set({ status: i.canceller === i.seller ? "cancelled" : "invalid", closedAt: i.blockTime ?? new Date(), closeSignature: i.signature })
    .where(and(eq(l.licenseId, i.licenseId), eq(l.status, "active"), or(isNull(l.openSignature), ne(l.openSignature, i.signature))))
    .returning({ id: l.id });
  await mirrorListingFlags(i.licenseId);
  return closed.length > 0 ? "closed" : "none";
}
