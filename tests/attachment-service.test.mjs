import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { File } from "node:buffer";
import { createAttachmentService } from "../services/attachment-service/server.mjs";

const token = "test-internal-token";
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const webp = Buffer.from("RIFF\x00\x00\x00\x00WEBP", "binary");

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "quarterly-attachments-"));
  const server = createAttachmentService({ root, token });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  const request = (endpoint, init = {}) => fetch(`${baseUrl}${endpoint}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
  });
  return { root, baseUrl, request };
}

async function upload(request, bytes, type) {
  const body = new FormData();
  body.append("file", new File([bytes], "untrusted-name.jpg", { type }));
  return request("/internal/attachments", { method: "POST", body });
}

test("attachment service writes, reads, deletes, and reports health", async (t) => {
  const { baseUrl, request } = await fixture(t);
  const health = await fetch(`${baseUrl}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true, storageWritable: true });

  for (const [bytes, type, extension] of [[jpeg, "image/jpeg", "jpg"], [png, "image/png", "png"], [webp, "image/webp", "webp"]]) {
    const response = await upload(request, bytes, type);
    assert.equal(response.status, 201);
    const result = await response.json();
    assert.match(result.key, new RegExp(`^\\d{4}/\\d{2}/[0-9a-f-]{36}\\.${extension}$`));
    assert.equal(result.contentType, type);
    assert.equal(result.size, bytes.length);
    const read = await request(`/internal/attachments?key=${encodeURIComponent(result.key)}`);
    assert.equal(read.status, 200);
    assert.equal(read.headers.get("content-type"), type);
    assert.deepEqual(Buffer.from(await read.arrayBuffer()), bytes);
    assert.equal((await request(`/internal/attachments?key=${encodeURIComponent(result.key)}`, { method: "DELETE" })).status, 204);
    assert.equal((await request(`/internal/attachments?key=${encodeURIComponent(result.key)}`)).status, 404);
  }
});

test("attachment service rejects unauthenticated, unsafe, oversized, and spoofed requests", async (t) => {
  const { baseUrl, request } = await fixture(t);
  assert.equal((await fetch(`${baseUrl}/internal/attachments`)).status, 401);
  for (const key of ["../secret.jpg", "%2e%2e%2fsecret.jpg", "%252e%252e%252fsecret.jpg", "/etc/passwd", "2026/09/not-a-uuid.jpg"]) {
    assert.equal((await request(`/internal/attachments?key=${key}`)).status, 400);
  }
  assert.equal((await upload(request, Buffer.alloc(0), "image/jpeg")).status, 400);
  assert.equal((await upload(request, Buffer.from("not a jpeg"), "image/jpeg")).status, 400);
  assert.equal((await upload(request, jpeg, "text/plain")).status, 400);
  assert.equal((await upload(request, Buffer.concat([jpeg, Buffer.alloc(10 * 1024 * 1024)]), "image/jpeg")).status, 400);
});
