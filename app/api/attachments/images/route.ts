import { env } from "cloudflare:workers";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PREFIX = "difference-attachments/";
const KEY_PATTERN = /^difference-attachments\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/;
const signatures = [
  { contentType: "image/jpeg", extension: "jpg", valid: (b: Uint8Array) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { contentType: "image/png", extension: "png", valid: (b: Uint8Array) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a },
  { contentType: "image/webp", extension: "webp", valid: (b: Uint8Array) => b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP" },
] as const;

const bucket = () => {
  if (!env.FILES) throw new Error("附件存储暂不可用，请稍后重试。");
  return env.FILES;
};
const keyFrom = (request: Request) => new URL(request.url).searchParams.get("key") ?? "";
const safeKey = (key: string) => KEY_PATTERN.test(key) && key.startsWith(PREFIX);

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "请选择图片文件。" }, { status: 400 });
    if (!signatures.some((item) => item.contentType === file.type)) return Response.json({ error: "仅支持 JPG、PNG、WEBP 图片。" }, { status: 415 });
    if (!file.size) return Response.json({ error: "图片文件不能为空。" }, { status: 400 });
    if (file.size > MAX_IMAGE_BYTES) return Response.json({ error: "图片大小不能超过 10MB。" }, { status: 413 });
    const bytes = new Uint8Array(await file.arrayBuffer());
    const detected = signatures.find((item) => item.valid(bytes));
    if (!detected || detected.contentType !== file.type) return Response.json({ error: "图片内容校验失败，请选择真实 JPG、PNG 或 WEBP 图片。" }, { status: 415 });
    const now = new Date();
    const key = `${PREFIX}${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${crypto.randomUUID()}.${detected.extension}`;
    await bucket().put(key, bytes.buffer, { httpMetadata: { contentType: detected.contentType } });
    return Response.json({ key, contentType: detected.contentType, size: bytes.byteLength }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "图片上传失败，请重试。" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const key = keyFrom(request);
  if (!safeKey(key)) return Response.json({ error: "附件引用无效。" }, { status: 400 });
  try {
    const object = await bucket().get(key);
    if (!object) return Response.json({ error: "图片不存在。" }, { status: 404 });
    return new Response(object.body, { headers: { "content-type": object.httpMetadata?.contentType || "application/octet-stream", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "图片读取失败。" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const key = keyFrom(request);
  if (!safeKey(key)) return Response.json({ error: "附件引用无效。" }, { status: 400 });
  try { await bucket().delete(key); return Response.json({ ok: true }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "图片删除失败。" }, { status: 500 }); }
}
