import path from "node:path";

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const KEY_PATTERN = /^\d{4}\/\d{2}\/[0-9a-f-]{36}\.(?:jpg|png|webp)$/;

const signatures = [
  { contentType: "image/jpeg", extension: "jpg", valid: (bytes) => bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  { contentType: "image/png", extension: "png", valid: (bytes) => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { contentType: "image/webp", extension: "webp", valid: (bytes) => bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP" },
];

export class AttachmentValidationError extends Error {}

export function validateImage(contentType, bytes) {
  if (!signatures.some((item) => item.contentType === contentType)) throw new AttachmentValidationError("仅支持 JPG、PNG、WEBP 图片。");
  if (!bytes.length) throw new AttachmentValidationError("图片文件不能为空。");
  if (bytes.length > MAX_IMAGE_BYTES) throw new AttachmentValidationError("图片大小不能超过 10MB。");
  const detected = signatures.find((item) => item.valid(bytes));
  if (!detected || detected.contentType !== contentType) throw new AttachmentValidationError("图片内容校验失败，请选择真实 JPG、PNG 或 WEBP 图片。");
  return detected;
}

export function resolveSafeAttachmentPath(root, key) {
  if (typeof key !== "string" || !KEY_PATTERN.test(key) || key.includes("\\") || key.includes("\0")) {
    throw new AttachmentValidationError("附件引用无效。");
  }
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, ...key.split("/"));
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new AttachmentValidationError("附件引用无效。");
  return resolvedPath;
}

export function contentTypeForKey(key) {
  if (key.endsWith(".jpg")) return "image/jpeg";
  if (key.endsWith(".png")) return "image/png";
  if (key.endsWith(".webp")) return "image/webp";
  throw new AttachmentValidationError("附件引用无效。");
}
