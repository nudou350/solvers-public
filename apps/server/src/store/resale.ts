import { Router } from "express";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { address, type Address } from "@solvers/chain";
import {
  MIN_PERMANENT_PRICE_USDC,
  RESALE_ERROR_CODES,
  RESALE_ERROR_HTTP_STATUS,
  resaleSplit,
  unitsToUsdc,
  type ResaleListing,
  type TxResponse,
} from "@solvers/shared";
import { requireAuth, requireWallet } from "../auth/jwt.js";
import { chain } from "../chain/index.js";
import { db, schema } from "../db/index.js";
import { env } from "../env.js";
import { refreshLicenseOwner, syncListing } from "../indexer/sync.js";
import { badRequest, h, HttpError, parse } from "../lib/http.js";
import { agentIsAvailable } from "../runtime/availability.js";
import { findAgentRow, mapAgents } from "./catalog.js";
import { catalogLangOf } from "./lang-rules.js";
import { toLicense, toReputation } from "./mappers.js";
import { assertEntriesOpen } from "./pause-gate.js";
import { assertResaleCut, decideFreshListing, isOwnListing, isResaleError, listingTrendPct, parseListingPrice, TREND_HISTORY_SIZE, withResaleErrors } from "./resale-rules.js";
import { buildForUserChecked } from "./tx-build.js";

// Revenda de licenças: montagem das transações (anunciar, comprar, cancelar) e a vitrine do mercado.
// Contrato dos corpos, respostas e códigos de erro: packages/shared/src/resale.ts. As regras puras estão em resale-rules.ts.

export const resaleRouter = Router();

/** Com `RESALE_ENABLED` desligada, anunciar e comprar respondem 503. Cancelar NUNCA passa por aqui: o vendedor sempre pode sair. */
function assertResaleEnabled(): void {
  if (!env.RESALE_ENABLED) {
    throw new HttpError(
      RESALE_ERROR_HTTP_STATUS[RESALE_ERROR_CODES.resaleDisabled],
      "License resale is not available yet.",
      RESALE_ERROR_CODES.resaleDisabled,
    );
  }
}

async function assertBalance(wallet: Address, needed: bigint) {
  const balance = await chain().usdcBalance(wallet);
  if (balance < needed) {
    throw new HttpError(RESALE_ERROR_HTTP_STATUS[RESALE_ERROR_CODES.insufficientFunds], "Insufficient USDC balance", RESALE_ERROR_CODES.insufficientFunds, {
      balanceUsdc: unitsToUsdc(balance),
      neededUsdc: unitsToUsdc(needed),
      faucetEnabled: env.FAUCET_ENABLED,
    });
  }
}

/**
 * Relê o anúncio on-chain antes de montar a compra (o espelho pode estar atrasado). Ausente: 404 `listing_not_found`;
 * preço diferente do que o comprador viu: 409 `listing_changed` com o preço atual. Nos dois casos reconcilia o espelho.
 */
async function assertFreshListing(listing: typeof schema.listings.$inferSelect, expectedUnits: bigint): Promise<void> {
  const c = chain();
  const onchain = await c.fetchMaybeListing(address(listing.licenseId));
  const decision = decideFreshListing(onchain, expectedUnits);
  if (decision.kind === "ok") return;
  await syncListing(address(listing.listingAddress)).catch((e) => console.warn("[resale] reconciliação do anúncio falhou:", (e as Error).message));
  if (decision.kind === "gone") {
    throw new HttpError(
      RESALE_ERROR_HTTP_STATUS[RESALE_ERROR_CODES.listingNotFound],
      "This listing no longer exists: the license was sold or the listing was canceled.",
      RESALE_ERROR_CODES.listingNotFound,
    );
  }
  throw new HttpError(
    RESALE_ERROR_HTTP_STATUS[RESALE_ERROR_CODES.listingChanged],
    "The listing price has changed. Check the new amount to continue.",
    RESALE_ERROR_CODES.listingChanged,
    { priceUsdc: unitsToUsdc(decision.priceUnits) },
  );
}

/** Endereço base58 de 32 bytes (o asset da licença): `address()` lançaria e viraria 500 se chegasse sem validar. */
const licenseIdSchema = z
  .string()
  .min(32)
  .max(44)
  .refine((v) => {
    try {
      address(v);
      return true;
    } catch {
      return false;
    }
  }, "not a valid address");

// ---------- Vitrine do mercado ----------

/** Anúncios ativos (mais baratos primeiro), com a licença, o solver, a reputação do vendedor e a tendência do preço. */
resaleRouter.get(
  "/market/listings",
  h(async (req, res): Promise<ResaleListing[]> => {
    if (!env.RESALE_ENABLED) return [];
    const lang = catalogLangOf(req, res);
    const q = parse(z.object({ agent: z.string().max(80).optional(), license: licenseIdSchema.optional() }), req.query);
    const conds = [eq(schema.listings.status, "active")];
    // Um anúncio por licença (o checkout busca direto, sem depender do teto da listagem geral).
    if (q.license) conds.push(eq(schema.listings.licenseId, q.license));
    if (q.agent) {
      const row = await findAgentRow(q.agent).catch(() => null);
      if (!row) return [];
      conds.push(eq(schema.listings.agentId, row.id));
    }
    const rows = await db
      .select({ listing: schema.listings, license: schema.licenses })
      .from(schema.listings)
      .innerJoin(schema.licenses, eq(schema.licenses.id, schema.listings.licenseId))
      .where(and(...conds))
      .orderBy(asc(schema.listings.price), asc(schema.listings.id))
      .limit(200);
    if (rows.length === 0) return [];

    const agentIds = [...new Set(rows.map((r) => r.listing.agentId))];
    const agentRows = await db.select().from(schema.agents).where(inArray(schema.agents.id, agentIds));
    // Solver suspenso ou aposentado não vende (nem revenda): o anúncio some da vitrine até voltar.
    const available = agentRows.filter(agentIsAvailable);
    const agents = new Map((await mapAgents(available, lang)).map((a) => [a.id, a]));

    // Últimas vendas de cada solver (mais recentes primeiro): referência da tendência.
    const sold = await db
      .select({ agentId: schema.listings.agentId, price: schema.listings.soldPrice })
      .from(schema.listings)
      .where(and(inArray(schema.listings.agentId, agentIds), eq(schema.listings.status, "sold")))
      .orderBy(desc(schema.listings.closedAt), desc(schema.listings.id));
    const soldBy = new Map<string, bigint[]>();
    for (const s of sold) {
      if (s.price == null) continue;
      const list = soldBy.get(s.agentId) ?? [];
      if (list.length < TREND_HISTORY_SIZE) list.push(s.price);
      soldBy.set(s.agentId, list);
    }

    const sellers = [...new Set(rows.map((r) => r.listing.sellerWallet))];
    const reps = await db.select().from(schema.userReputation).where(inArray(schema.userReputation.wallet, sellers));
    const repOf = new Map(reps.map((r) => [r.wallet, r]));

    return rows.flatMap(({ listing, license }) => {
      const agent = agents.get(listing.agentId);
      if (!agent) return [];
      const rep = repOf.get(listing.sellerWallet);
      return [
        {
          id: listing.licenseId,
          license: toLicense(license),
          agent,
          priceUsdc: unitsToUsdc(listing.price),
          priceTrendPct: listingTrendPct(listing.price, soldBy.get(listing.agentId) ?? []),
          sellerWallet: listing.sellerWallet,
          sellerReputation: rep ? toReputation(listing.sellerWallet, rep).score : null,
          listedAt: listing.listedAt.toISOString(),
          royaltyBps: listing.royaltyBps,
          feeBps: listing.feeBps,
        },
      ];
    });
  }),
);

// ---------- Transações ----------

/** Anunciar a licença por um preço em USDC. O vendedor assina; a plataforma paga o rent do anúncio. */
resaleRouter.post(
  "/tx/list",
  requireAuth,
  h(async (req): Promise<TxResponse> => {
    const wallet = address(requireWallet(req));
    assertResaleEnabled();
    await assertEntriesOpen("list"); // pausa de emergência: 503 antes de montar a transação
    const body = parse(z.object({ licenseId: licenseIdSchema, priceUsdc: z.number() }), req.body);
    const [lic] = await db.select().from(schema.licenses).where(eq(schema.licenses.id, body.licenseId));
    if (!lic) throw badRequest("License not found.", RESALE_ERROR_CODES.licenseInvalid);
    const row = await findAgentRow(lic.agentId);
    if (!agentIsAvailable(row)) throw badRequest("This specialist is not available right now.", RESALE_ERROR_CODES.agentUnavailable);
    // Dono de verdade (on-chain): transferência por fora não pode virar anúncio de quem já não tem a licença.
    if ((await refreshLicenseOwner(lic.id)) !== wallet) {
      throw new HttpError(RESALE_ERROR_HTTP_STATUS[RESALE_ERROR_CODES.notOwner], "This license is not in your wallet.", RESALE_ERROR_CODES.notOwner);
    }
    const c = chain();
    const config = await c.fetchConfig().catch(() => null);
    const minUnits = config?.data.minPrice ?? BigInt(MIN_PERMANENT_PRICE_USDC) * 1_000_000n;
    const price = parseListingPrice(body.priceUsdc, minUnits);
    if (config) assertResaleCut(row.royaltyBps, config.data.feeBps);
    return withResaleErrors(async () => {
      const r = await c.listLicenseIxs(wallet, address(lic.id), price, { agentIdHex: row.id });
      const split = resaleSplit(price, r.royaltyBps, r.feeBps);
      return buildForUserChecked(r.instructions, {
        kind: "list",
        licenseId: lic.id,
        agentId: row.id,
        priceUsdc: unitsToUsdc(price),
        feeBps: r.feeBps,
        royaltyBps: r.royaltyBps,
        royaltyUsdc: unitsToUsdc(split.royalty),
        feeUsdc: unitsToUsdc(split.fee),
        sellerReceivesUsdc: unitsToUsdc(split.seller),
        replacedStaleListing: r.replacedStaleListing,
      });
    });
  }),
);

/** Comprar uma licença anunciada pelo preço que o comprador viu (`expectedPriceUsdc`). */
resaleRouter.post(
  "/tx/buy-listing",
  requireAuth,
  h(async (req): Promise<TxResponse> => {
    const wallet = address(requireWallet(req));
    assertResaleEnabled();
    await assertEntriesOpen("buy-listing");
    const body = parse(z.object({ licenseId: licenseIdSchema, expectedPriceUsdc: z.number() }), req.body);
    const expected = parseListingPrice(body.expectedPriceUsdc);
    const [listing] = await db
      .select()
      .from(schema.listings)
      .where(and(eq(schema.listings.licenseId, body.licenseId), eq(schema.listings.status, "active")));
    if (!listing) {
      throw new HttpError(RESALE_ERROR_HTTP_STATUS[RESALE_ERROR_CODES.listingNotFound], "This listing no longer exists.", RESALE_ERROR_CODES.listingNotFound);
    }
    const row = await findAgentRow(listing.agentId);
    if (!agentIsAvailable(row)) throw badRequest("This specialist is not available for purchase right now.", RESALE_ERROR_CODES.agentUnavailable);
    if (isOwnListing(listing.sellerWallet, wallet)) {
      throw new HttpError(RESALE_ERROR_HTTP_STATUS[RESALE_ERROR_CODES.ownListing], "You can't buy your own listed license.", RESALE_ERROR_CODES.ownListing);
    }
    await assertFreshListing(listing, expected);
    await assertBalance(wallet, expected);
    return withResaleErrors(async () => {
      const r = await chain().buyListingIxs(wallet, address(listing.licenseId), expected);
      return buildForUserChecked(r.instructions, {
        kind: "buy-listing",
        licenseId: listing.licenseId,
        agentId: row.id,
        priceUsdc: unitsToUsdc(r.priceUnits),
        royaltyUsdc: unitsToUsdc(r.royaltyUnits),
        feeUsdc: unitsToUsdc(r.feeUnits),
        sellerReceivesUsdc: unitsToUsdc(r.sellerUnits),
      });
    });
  }),
);

/**
 * Cancelar um anúncio. Sempre permitido, até com a revenda desligada (o vendedor precisa poder sair) e com a pausa de
 * entradas ativa (cancelar nunca pausa, como no programa). O vendedor cancela o seu; outra carteira só fecha anúncio VELHO.
 */
resaleRouter.post(
  "/tx/cancel-listing",
  requireAuth,
  h(async (req): Promise<TxResponse> => {
    const wallet = address(requireWallet(req));
    const body = parse(z.object({ licenseId: licenseIdSchema }), req.body);
    // Põe o espelho em dia (dono atual, anúncios velhos fechados); a autoridade sobre quem pode cancelar é a cadeia, em cancelListingIxs.
    const [lic] = await db.select({ id: schema.licenses.id }).from(schema.licenses).where(eq(schema.licenses.id, body.licenseId));
    if (lic) await refreshLicenseOwner(lic.id);
    return withResaleErrors(async () => {
      const r = await chain()
        .cancelListingIxs(wallet, address(body.licenseId))
        .catch(async (e: unknown) => {
          // A cadeia diz que não há anúncio: o espelho pode ainda mostrá-lo como ativo. Fecha-o ('invalid') antes de responder 404.
          if (isResaleError(e) && e.code === RESALE_ERROR_CODES.listingNotFound) {
            const pda = await chain().listingPda(address(body.licenseId));
            await syncListing(pda).catch((err) => console.warn("[resale] reconciliação do anúncio falhou:", (err as Error).message));
          }
          throw e;
        });
      return buildForUserChecked(r.instructions, { kind: "cancel-listing", licenseId: body.licenseId, stale: r.stale });
    });
  }),
);
