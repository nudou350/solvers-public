import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import sharp from "sharp";
import { ImageError, processImage } from "../src/images/process.js";
import { cloudinarySignature, createCloudinaryStore } from "../src/images/cloudinary.js";
import { firstFreePosition } from "../src/store/image-rules.js";

// Imagens: limite por posição, processamento (reencode, sem EXIF, só jpg/png/webp) e o cliente do CDN. Sem banco nem rede.

describe("firstFreePosition", () => {
  it("usa a menor posição livre", () => {
    assert.equal(firstFreePosition([], 3), 0);
    assert.equal(firstFreePosition([0, 2], 3), 1);
    assert.equal(firstFreePosition([1], 3), 0);
  });

  it("galeria cheia: null", () => {
    assert.equal(firstFreePosition([0, 1, 2], 3), null);
    assert.equal(firstFreePosition([4, 3, 2, 1, 0], 5), null);
  });
});

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: "#336699" } }).png().toBuffer();

describe("processImage", () => {
  it("reduz o maior lado a 1600 px e devolve WebP", async () => {
    const out = await processImage(await png(3200, 1800));
    assert.equal(out.width, 1600);
    assert.equal(out.height, 900);
    assert.equal((await sharp(out.data).metadata()).format, "webp");
  });

  it("não amplia imagem pequena", async () => {
    const out = await processImage(await png(400, 300));
    assert.deepEqual([out.width, out.height], [400, 300]);
  });

  it("descarta EXIF (GPS, câmera) e aplica a orientação", async () => {
    const withExif = await sharp({ create: { width: 200, height: 100, channels: 3, background: "#fff" } })
      .jpeg()
      .withExif({ IFD0: { Copyright: "segredo" } })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    assert.ok((await sharp(withExif).metadata()).exif);
    const out = await processImage(withExif);
    assert.equal((await sharp(out.data).metadata()).exif, undefined);
    assert.deepEqual([out.width, out.height], [100, 200]); // orientação 6 = girada 90°
  });

  it("recusa SVG, GIF e lixo", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    const gif = await sharp({ create: { width: 10, height: 10, channels: 3, background: "#000" } }).gif().toBuffer();
    for (const bad of [svg, gif, Buffer.from("isto não é imagem"), Buffer.alloc(0)]) {
      await assert.rejects(processImage(bad), (e: unknown) => e instanceof ImageError && e.status === 400 && e.code === "image_invalid");
    }
  });

  it("recusa arquivo acima de 5 MB com 413", async () => {
    await assert.rejects(processImage(Buffer.alloc(5 * 1024 * 1024 + 1)), (e: unknown) => e instanceof ImageError && e.status === 413 && e.code === "image_too_large");
  });
});

describe("Cloudinary", () => {
  it("assina como a documentação (parâmetros em ordem alfabética + secret, sha1)", () => {
    // Exemplo oficial: https://cloudinary.com/documentation/authentication_signatures
    const sig = cloudinarySignature({ timestamp: "1315060510", public_id: "sample_image", eager: "w_400,h_300,c_pad|w_260,h_200,c_crop" }, "abcd");
    assert.equal(sig, "bfd09f95f331f558cbd1320e67aa8d488770583e");
  });

  it("monta URLs com a transformação e a chave", () => {
    const store = createCloudinaryStore({ cloudName: "demo", apiKey: "k", apiSecret: "s" });
    assert.equal(store.url("solvers/agents/a/b", "thumb"), "https://res.cloudinary.com/demo/image/upload/c_limit,w_640,f_auto,q_auto/solvers/agents/a/b");
    assert.match(store.url("x/y", "full"), /c_limit,w_1600/);
  });

  it("upload e remoção: endpoint, campos e assinatura", async () => {
    const calls: { url: string; form: FormData }[] = [];
    const fake: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), form: init!.body as FormData });
      return new Response(JSON.stringify({ result: "ok" }), { status: 200 });
    };
    const store = createCloudinaryStore({ cloudName: "demo", apiKey: "KEY", apiSecret: "SECRET" }, fake);
    await store.put("solvers/reviews/ag/abc", Buffer.from("x"));
    await store.delete("solvers/reviews/ag/abc");

    const [up, del] = calls;
    assert.equal(up!.url, "https://api.cloudinary.com/v1_1/demo/image/upload");
    assert.equal(up!.form.get("public_id"), "solvers/reviews/ag/abc");
    assert.equal(up!.form.get("asset_folder"), "solvers/reviews/ag");
    assert.equal(up!.form.get("api_key"), "KEY");
    assert.ok(up!.form.get("file") instanceof Blob);
    const signedUp = Object.fromEntries(["public_id", "asset_folder", "overwrite", "unique_filename", "timestamp"].map((k) => [k, String(up!.form.get(k))]));
    assert.equal(up!.form.get("signature"), cloudinarySignature(signedUp, "SECRET"));
    assert.equal(up!.form.get("api_secret"), null); // o secret nunca vai no corpo

    assert.equal(del!.url, "https://api.cloudinary.com/v1_1/demo/image/destroy");
    assert.equal(del!.form.get("public_id"), "solvers/reviews/ag/abc");
  });

  it("erro do Cloudinary vira exceção com a mensagem", async () => {
    const fake: typeof fetch = async () => new Response(JSON.stringify({ error: { message: "Invalid Signature" } }), { status: 401 });
    const store = createCloudinaryStore({ cloudName: "demo", apiKey: "k", apiSecret: "s" }, fake);
    await assert.rejects(store.put("a/b", Buffer.from("x")), /Invalid Signature/);
  });
});
