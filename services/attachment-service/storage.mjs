import { access, mkdir, opendir, readFile, stat, statfs, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { contentTypeForKey, resolveSafeAttachmentPath } from "./validation.mjs";
import { DEFAULT_STORAGE_THRESHOLDS, storageMetrics } from "./metrics.mjs";

export class AttachmentNotFoundError extends Error {}

async function attachmentUsage(directory) {
  let attachmentCount = 0;
  let attachmentBytes = 0;
  const entries = await opendir(directory);
  for await (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const child = await attachmentUsage(target);
      attachmentCount += child.attachmentCount;
      attachmentBytes += child.attachmentBytes;
    } else if (entry.isFile()) {
      const file = await stat(target);
      attachmentCount += 1;
      attachmentBytes += file.size;
    }
  }
  return { attachmentCount, attachmentBytes };
}

export function createAttachmentStorage(root, { thresholds = DEFAULT_STORAGE_THRESHOLDS, statfsImpl = statfs } = {}) {
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
    async capacity() {
      const info = await statfsImpl(resolvedRoot);
      const diskTotalBytes = Number(info.blocks) * Number(info.bsize);
      const diskFreeBytes = Number(info.bavail ?? info.bfree) * Number(info.bsize);
      return storageMetrics({ attachmentCount: 0, attachmentBytes: 0, diskTotalBytes, diskFreeBytes }, thresholds);
    },
    async metrics() {
      const [capacity, usage] = await Promise.all([this.capacity(), attachmentUsage(resolvedRoot)]);
      return { ...capacity, ...usage };
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
    async inspect(key) {
      const target = pathFor(key);
      try {
        const file = await stat(target);
        if (!file.isFile()) throw new AttachmentNotFoundError();
        return { size: file.size, contentType: contentTypeForKey(key) };
      } catch (error) {
        if (error instanceof AttachmentNotFoundError || (error && typeof error === "object" && error.code === "ENOENT")) throw new AttachmentNotFoundError();
        throw error;
      }
    },
    createReadStream(key) {
      return createReadStream(pathFor(key));
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
