import sharp from "sharp";
import { MAX_IMAGE_UPLOAD_BYTES } from "@solvers/shared";
import { HttpError } from "../lib/http.js";

// Toda imagem enviada é decodificada e reencodada: só pixels saem daqui (sem EXIF/GPS, sem conteúdo
// extra escondido no arquivo, sem formato que o navegador interprete como código, como SVG).

/** Imagem recusada: vira 400 (ou 413) com mensagem em pt-BR para a tela. */
export class ImageError extends HttpError {
  constructor(message: string, code: "image_invalid" | "image_too_large" = "image_invalid") {
    super(code === "image_too_large" ? 413 : 400, message, code);
  }
}

const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);
/** Maior lado depois do processamento; capturas de tela maiores que isso só gastam banda. */
export const IMAGE_MAX_SIDE = 1600;
const MAX_INPUT_PIXELS = 40_000_000;

export type ProcessedImage = { data: Buffer; width: number; height: number };

export async function processImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length === 0) throw new ImageError("The file is empty.");
  if (input.length > MAX_IMAGE_UPLOAD_BYTES) throw new ImageError("The image is larger than 5 MB.", "image_too_large");
  try {
    const img = sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });
    const meta = await img.metadata();
    if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) throw new ImageError("Use a JPG, PNG or WebP image.");
    const { data, info } = await img
      .rotate() // aplica a orientação do EXIF antes de ele ser descartado
      .resize({ width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height };
  } catch (e) {
    if (e instanceof ImageError) throw e;
    throw new ImageError("We couldn't read this image. Try exporting it again as JPG or PNG.");
  }
}
