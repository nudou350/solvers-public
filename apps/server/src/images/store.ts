import { env } from "../env.js";
import { createCloudinaryStore } from "./cloudinary.js";
import type { ImageStore } from "./cloudinary.js";

// Onde as imagens moram. O banco guarda só a chave (public_id); a URL é montada pelo ImageStore,
// então trocar de CDN (ex.: Cloudflare R2) é implementar a mesma interface e mudar imageStore().

export type { ImageKind, ImageStore } from "./cloudinary.js";

let cached: ImageStore | null | undefined;

/** null quando o CDN não está configurado: as rotas de imagem respondem 503 e o resto do site segue. */
export function imageStore(): ImageStore | null {
  if (cached === undefined) {
    const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = env;
    cached = cloudName && apiKey && apiSecret ? createCloudinaryStore({ cloudName, apiKey, apiSecret }) : null;
  }
  return cached;
}

/** Só para testes. */
export function setImageStoreForTests(store: ImageStore | null | undefined) {
  cached = store;
}
