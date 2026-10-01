import { randomBytes } from "node:crypto";
import express, { Router } from "express";
import { and, asc, eq } from "drizzle-orm";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { MAX_IMAGE_UPLOAD_BYTES, MAX_REVIEW_IMAGES, type ImageRef } from "@solvers/shared";
import { requireAuth, requireWallet } from "../auth/jwt.js";
import { db, schema } from "../db/index.js";
import { ImageError, processImage } from "../images/process.js";
import { toImageRefs } from "../images/refs.js";
import { imageStore, type ImageStore } from "../images/store.js";
import { forbidden, h, HttpError, notFound } from "../lib/http.js";
import { findAgentRow } from "./catalog.js";
import { firstFreePosition } from "./image-rules.js";

// Fotos de avaliação: até 3 por avaliação, só de quem tem a licença. A foto é anexada depois que a avaliação
// existe (a avaliação é confirmada on-chain primeiro); as imagens ficam FORA do hash da avaliação.

export const imagesRouter = Router();

const uploadLimit = rateLimit({
  windowMs: 60_000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Muitos envios de imagem. Aguarde um pouco e tente de novo.", code: "rate_limited" },
  keyGenerator: (req) => req.wallet ?? ipKeyGenerator(req.ip ?? "0.0.0.0"),
});

const rawImage = express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: MAX_IMAGE_UPLOAD_BYTES });

const LIMIT_MSG = `Cada avaliação aceita até ${MAX_REVIEW_IMAGES} fotos.`;

function requireStore(): ImageStore {
  const store = imageStore();
  if (!store) throw new HttpError(503, "O envio de imagens não está disponível agora.", "image_unavailable");
  return store;
}

/** A minha avaliação confirmada neste especialista, e só se eu ainda tenho a licença. */
async function myReview(wallet: string, idOrSlug: string) {
  const agent = await findAgentRow(idOrSlug);
  const [review] = await db
    .select()
    .from(schema.reviews)
    .where(and(eq(schema.reviews.agentId, agent.id), eq(schema.reviews.authorWallet, wallet), eq(schema.reviews.onchain, true)));
  if (!review) throw new HttpError(409, "Publique a sua avaliação antes de anexar fotos.", "review_required");
  const [license] = await db
    .select({ id: schema.licenses.id })
    .from(schema.licenses)
    .where(and(eq(schema.licenses.ownerWallet, wallet), eq(schema.licenses.agentId, agent.id)));
  if (!license) throw forbidden("Só quem comprou este especialista pode anexar fotos.");
  return review;
}

async function usedPositions(reviewId: string): Promise<number[]> {
  const rows = await db.select({ position: schema.reviewImages.position }).from(schema.reviewImages).where(eq(schema.reviewImages.reviewId, reviewId));
  return rows.map((r) => r.position);
}

async function listMine(reviewId: string): Promise<ImageRef[]> {
  const rows = await db.select().from(schema.reviewImages).where(eq(schema.reviewImages.reviewId, reviewId)).orderBy(asc(schema.reviewImages.position));
  return toImageRefs(rows);
}

/** O drizzle embrulha o erro do pg: o código do Postgres fica em `cause`. */
const isUniqueViolation = (e: unknown) => [e, (e as { cause?: unknown })?.cause].some((x) => (x as { code?: string } | undefined)?.code === "23505");

/**
 * Grava na menor posição livre. O índice único (review_id, position) é quem garante o limite: se duas fotos
 * disputam a mesma posição, a perdedora recalcula (no máximo MAX tentativas: cada rodada perdida é uma vaga ocupada).
 */
async function insertAtFreePosition(reviewId: string, img: { key: string; width: number; height: number }) {
  for (let attempt = 0; attempt <= MAX_REVIEW_IMAGES; attempt++) {
    const position = firstFreePosition(await usedPositions(reviewId), MAX_REVIEW_IMAGES);
    if (position === null) break;
    try {
      await db.insert(schema.reviewImages).values({ id: randomBytes(8).toString("hex"), reviewId, position, ...img });
      return;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
    }
  }
  throw new HttpError(409, LIMIT_MSG, "image_limit");
}

imagesRouter.post(
  "/agents/:idOrSlug/reviews/mine/images",
  requireAuth,
  uploadLimit,
  rawImage,
  h(async (req) => {
    const store = requireStore();
    const review = await myReview(requireWallet(req), String(req.params.idOrSlug));
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new ImageError("Envie uma imagem JPG, PNG ou WebP.");
    if (firstFreePosition(await usedPositions(review.id), MAX_REVIEW_IMAGES) === null) throw new HttpError(409, LIMIT_MSG, "image_limit");

    const img = await processImage(req.body);
    const key = `solvers/reviews/${review.agentId}/${randomBytes(12).toString("hex")}`;
    await store.put(key, img.data);
    try {
      await insertAtFreePosition(review.id, { key, width: img.width, height: img.height });
    } catch (e) {
      await store.delete(key).catch((err) => console.error("[imagens] não removeu órfã", key, err));
      throw e;
    }
    return listMine(review.id);
  }),
);

imagesRouter.delete(
  "/agents/:idOrSlug/reviews/mine/images/:imageId",
  requireAuth,
  h(async (req) => {
    const review = await myReview(requireWallet(req), String(req.params.idOrSlug));
    const [img] = await db
      .delete(schema.reviewImages)
      .where(and(eq(schema.reviewImages.id, String(req.params.imageId)), eq(schema.reviewImages.reviewId, review.id)))
      .returning();
    if (!img) throw notFound("Foto não encontrada");
    const store = imageStore();
    if (store) await store.delete(img.key).catch((err) => console.error("[imagens] não removeu do CDN", img.key, err));
    return listMine(review.id);
  }),
);
