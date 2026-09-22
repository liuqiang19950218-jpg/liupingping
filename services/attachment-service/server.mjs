import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { createAttachmentStorage, AttachmentNotFoundError } from "./storage.mjs";
import { AttachmentValidationError, MAX_IMAGE_BYTES, validateImage } from "./validation.mjs";
import { DEFAULT_STORAGE_THRESHOLDS } from "./metrics.mjs";

const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 64 * 1024;

const json = (response, status, payload) => {
  const body = Buffer.from(JSON.stringify(payload));
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": body.length, "cache-control": "no-store" });
  response.end(body);
};

const errorStatus = (error) => error instanceof AttachmentValidationError ? 400 : 500;

function authorized(request, token) {
  const supplied = request.headers.authorization;
  const expected = `Bearer ${token}`;
  if (!token || !supplied) return false;
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function readBody(request) {
  const declared = Number(request.headers["content-length"] ?? 0);
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw new AttachmentValidationError("图片文件过大，请选择20MB以内的图片。");
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_REQUEST_BYTES) throw new AttachmentValidationError("图片文件过大，请选择20MB以内的图片。");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function uploadedFile(request, body) {
  const contentType = request.headers["content-type"] ?? "";
  const boundary = /multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)?.[1]
    ?? /multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)?.[2];
  if (!boundary) throw new AttachmentValidationError("请求必须使用 multipart/form-data。");
  const start = Buffer.from(`--${boundary}\r\n`);
  if (!body.subarray(0, start.length).equals(start)) throw new AttachmentValidationError("图片上传格式无效。");
  const headersEnd = body.indexOf(Buffer.from("\r\n\r\n"), start.length);
  if (headersEnd < 0) throw new AttachmentValidationError("图片上传格式无效。");
  const headers = body.subarray(start.length, headersEnd).toString("utf8");
  if (!/content-disposition:\s*form-data;[^\r\n]*name="file"/i.test(headers)) throw new AttachmentValidationError("请选择图片文件。");
  const fileContentType = /^content-type:\s*([^\r\n;]+)/im.exec(headers)?.[1]?.trim().toLowerCase() ?? "";
  const fileEnd = body.indexOf(Buffer.from(`\r\n--${boundary}--`), headersEnd + 4);
  if (fileEnd < 0) throw new AttachmentValidationError("图片上传格式无效。");
  return { contentType: fileContentType, bytes: body.subarray(headersEnd + 4, fileEnd) };
}

export function createAttachmentService({ root, token, thresholds = DEFAULT_STORAGE_THRESHOLDS, storage }) {
  const attachmentStorage = storage ?? createAttachmentStorage(root, { thresholds });
  return http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://attachment-service.internal");
    if (request.method === "GET" && requestUrl.pathname === "/health") {
      const storageWritable = await attachmentStorage.health();
      const metrics = storageWritable ? await attachmentStorage.metrics() : null;
      return json(response, storageWritable ? 200 : 503, { ok: storageWritable, storageWritable, ...(metrics ?? {}) });
    }
    if (!requestUrl.pathname.startsWith("/internal/attachments")) return json(response, 404, { error: "未找到接口。" });
    if (!authorized(request, token)) return json(response, 401, { error: "内部服务鉴权失败。" });
    try {
      const key = requestUrl.searchParams.get("key") ?? "";
      if (request.method === "POST" && requestUrl.pathname === "/internal/attachments") {
        const uploaded = uploadedFile(request, await readBody(request));
        const detected = validateImage(uploaded.contentType, uploaded.bytes);
        if ((await attachmentStorage.capacity()).storageLevel === "blocked") throw new AttachmentValidationError("服务器附件存储空间不足，请联系管理员处理。");
        const savedKey = await attachmentStorage.save(uploaded.bytes, detected.extension);
        return json(response, 201, { key: savedKey, contentType: detected.contentType, size: uploaded.bytes.length });
      }
      if (request.method === "GET" && requestUrl.pathname === "/internal/attachments") {
        const image = await attachmentStorage.read(key);
        response.writeHead(200, { "content-type": image.contentType, "content-length": image.bytes.length, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" });
        return response.end(image.bytes);
      }
      if (request.method === "DELETE" && requestUrl.pathname === "/internal/attachments") {
        await attachmentStorage.remove(key);
        response.writeHead(204);
        return response.end();
      }
      return json(response, 405, { error: "不支持的请求方法。" });
    } catch (error) {
      if (error instanceof AttachmentNotFoundError) return json(response, 404, { error: "图片不存在。" });
      return json(response, errorStatus(error), { error: error instanceof Error ? error.message : "附件服务失败。" });
    }
  });
}

export function startAttachmentService(config = {
  root: process.env.ATTACHMENT_STORAGE_ROOT,
  token: process.env.ATTACHMENT_SERVICE_TOKEN,
  host: process.env.ATTACHMENT_SERVICE_HOST || "127.0.0.1",
  port: Number(process.env.ATTACHMENT_SERVICE_PORT || "18081"),
  thresholds: {
    warningPercent: Number(process.env.ATTACHMENT_WARNING_PERCENT || DEFAULT_STORAGE_THRESHOLDS.warningPercent),
    criticalPercent: Number(process.env.ATTACHMENT_CRITICAL_PERCENT || DEFAULT_STORAGE_THRESHOLDS.criticalPercent),
    blockPercent: Number(process.env.ATTACHMENT_BLOCK_PERCENT || DEFAULT_STORAGE_THRESHOLDS.blockPercent),
    minFreeBytes: Number(process.env.ATTACHMENT_MIN_FREE_BYTES || DEFAULT_STORAGE_THRESHOLDS.minFreeBytes),
  },
}) {
  if (!config.root) throw new Error("ATTACHMENT_STORAGE_ROOT 未配置。");
  if (!config.token) throw new Error("ATTACHMENT_SERVICE_TOKEN 未配置。");
  const server = createAttachmentService(config);
  const shutdown = () => server.close(() => process.exit(0));
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return server.listen(config.port, config.host, () => console.log(`attachment-service listening on ${config.host}:${config.port}`));
}

if (import.meta.url === new URL(process.argv[1], "file:").href) startAttachmentService();
