import { createHash, randomBytes } from "node:crypto";

export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest();
export const sha256Hex = (data: string | Uint8Array) => sha256(data).toString("hex");
export const randomId = (bytes = 16) => randomBytes(bytes).toString("hex");
export const randomToken = (bytes = 32) => randomBytes(bytes).toString("base64url");
export const hexToBytes = (hex: string) => Uint8Array.from(Buffer.from(hex, "hex"));
export const bytesToHexStr = (b: ArrayLike<number>) => Buffer.from(Uint8Array.from(b as ArrayLike<number>)).toString("hex");
