import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { contentTypeForKey, resolveSafeAttachmentPath } from "./validation.mjs";

export class AttachmentNotFoundError extends Error {}

export function createAttachmentStorage(root) {
  if (!root) throw new Error("ATTACHMENT_STORAGE_ROOT 未配置。");
  const resolvedRoot = path.resolve(root);
  const pathFor = (key) => resolveSafeAttachmentPath(resolvedRoot, key);

  return {
    async health() {
      try {
        await access(resolvedRoot, constants.R_OK | constants.W_OK);
        return true;
      } catch {
        return false;
      }
    },
    async save(bytes, extension) {
      const now = new Date();
      const key = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${randomUUID()}.${extension}`;
      const target = pathFor(key);
      await mkdir(path.dirname(target), { recursive: true });
      try {
        await writeFile(target, bytes, { flag: "wx" });
      } catch (error) {
        await unlink(target).catch(() => undefined);
        throw error;
      }
      return key;
    },
    async read(key) {
      const target = pathFor(key);
      try {
        return { bytes: await readFile(target), contentType: contentTypeForKey(key) };
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") throw new AttachmentNotFoundError();
        throw error;
      }
    },
    async remove(key) {
      const target = pathFor(key);
      try {
        await unlink(target);
        return true;
      } catch (error) {
        if (error && typeof error === "object" && error.code === "ENOENT") return false;
        throw error;
      }
    },
  };
}
