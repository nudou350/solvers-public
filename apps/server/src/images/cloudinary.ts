import { createHash } from "node:crypto";

// Cliente do Cloudinary (upload/remoção assinados por fetch, sem SDK). Sem env: testável isolado.

export type ImageKind = "full" | "thumb";

export interface ImageStore {
  put(key: string, data: Buffer): Promise<void>;
  delete(key: string): Promise<void>;
  url(key: string, kind: ImageKind): string;
}

type CloudinaryConfig = { cloudName: string; apiKey: string; apiSecret: string };

/** Assinatura de uma chamada assinada da API do Cloudinary: sha1 de "k=v&k=v" em ordem alfabética + secret. */
export function cloudinarySignature(params: Record<string, string>, apiSecret: string): string {
  const toSign = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return createHash("sha1").update(toSign + apiSecret).digest("hex");
}

const TRANSFORM: Record<ImageKind, string> = {
  full: "c_limit,w_1600,f_auto,q_auto",
  thumb: "c_limit,w_640,f_auto,q_auto",
};

export function createCloudinaryStore(cfg: CloudinaryConfig, fetchFn: typeof fetch = fetch): ImageStore {
  const api = `https://api.cloudinary.com/v1_1/${cfg.cloudName}/image`;

  async function call(action: "upload" | "destroy", params: Record<string, string>, file?: Buffer) {
    const signed = { ...params, timestamp: String(Math.floor(Date.now() / 1000)) };
    const form = new FormData();
    for (const [k, v] of Object.entries(signed)) form.set(k, v);
    form.set("api_key", cfg.apiKey);
    form.set("signature", cloudinarySignature(signed, cfg.apiSecret));
    if (file) form.set("file", new Blob([new Uint8Array(file)], { type: "image/webp" }), "image.webp");
    const res = await fetchFn(`${api}/${action}`, { method: "POST", body: form, signal: AbortSignal.timeout(20_000) });
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string }; result?: string };
    if (!res.ok) throw new Error(`Cloudinary ${action}: ${body.error?.message ?? res.status}`);
    return body;
  }

  return {
    async put(key, data) {
      const folder = key.slice(0, key.lastIndexOf("/"));
      await call("upload", { public_id: key, asset_folder: folder, overwrite: "false", unique_filename: "false" }, data);
    },
    async delete(key) {
      await call("destroy", { public_id: key, invalidate: "true" });
    },
    url: (key, kind) => `https://res.cloudinary.com/${cfg.cloudName}/image/upload/${TRANSFORM[kind]}/${key}`,
  };
}

