// Reduz a foto no navegador antes do envio: o nginx de produção aceita corpo de até 2 MB, e uma foto de celular
// passa disso fácil. Redimensiona (lado maior 1600 px, sem ampliar) e exporta WebP; sem WebP no navegador, JPEG.
// O servidor reencoda de qualquer forma, então aqui o objetivo é só caber no limite e poupar a rede.
import { localText } from "./local-text";

const MAX_SIDE = 1600;
/** Abaixo do limite de 2 MB do nginx, com folga para o cabeçalho. */
const MAX_BYTES = Math.floor(1.8 * 1024 * 1024);
const QUALITIES = [0.85, 0.75, 0.65, 0.55];
const SIDES = [MAX_SIDE, 1280, 1024, 800];

/** Erro com mensagem pronta para mostrar à pessoa (já no idioma da página). */
export class ImageCompressError extends Error {}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function decode(file: Blob): Promise<ImageBitmap> {
  try {
    // "from-image": respeita a rotação gravada pela câmera (o canvas não guarda EXIF).
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try {
      return await createImageBitmap(file);
    } catch {
      throw new ImageCompressError(localText("image.unreadable"));
    }
  }
}

/**
 * Devolve um Blob WebP (ou JPEG) de no máximo ~1,8 MB. `blob.type` é o que vai no Content-Type do envio.
 * Lança ImageCompressError se a imagem não puder ser lida ou não couber mesmo reduzida.
 */
export async function compressImage(file: Blob): Promise<Blob> {
  const bitmap = await decode(file);
  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new ImageCompressError(localText("image.noCanvas"));
    // Navegador sem codificador WebP devolve PNG: nesse caso usa JPEG (com fundo branco no lugar da transparência).
    let type = "image/webp";
    for (const side of SIDES) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      for (const q of QUALITIES) {
        if (type === "image/jpeg") {
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
        } else {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        let blob = await encode(canvas, type, q);
        if (blob && type === "image/webp" && blob.type !== "image/webp") {
          type = "image/jpeg";
          ctx.fillStyle = "#fff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
          blob = await encode(canvas, type, q);
        }
        if (blob && blob.size <= MAX_BYTES) return blob;
      }
    }
    throw new ImageCompressError(localText("image.tooLarge"));
  } finally {
    bitmap.close();
  }
}
