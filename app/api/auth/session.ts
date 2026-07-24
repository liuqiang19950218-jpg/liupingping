import { env } from "cloudflare:workers";

export type SessionUser = { name: string; role: "admin" | "regional"; region: string | null };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function signature(payload: string) {
  const secret = env.AUTH_SECRET ?? "9b308e8c86544f7bacef962ed92d53a5d35f9ab93b3854bb4ab349aef52df167";
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64Url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))));
}

export async function createSession(user: SessionUser) {
  const payload = base64Url(encoder.encode(JSON.stringify({ ...user, exp: Date.now() + 1000 * 60 * 60 * 12 })));
  return `${payload}.${await signature(payload)}`;
}

export async function readSession(cookieHeader: string | null): Promise<SessionUser | null> {
  const token = cookieHeader?.match(/(?:^|;\s*)recon_session=([^;]+)/)?.[1];
  if (!token) return null;
  const [payload, received] = token.split(".");
  if (!payload || !received || received !== await signature(payload)) return null;
  try {
    const data = JSON.parse(decoder.decode(fromBase64Url(payload))) as SessionUser & { exp: number };
    if (data.exp < Date.now() || (data.role !== "admin" && data.role !== "regional")) return null;
    return { name: data.name, role: data.role, region: data.region ?? null };
  } catch { return null; }
}

export function initialAdmin() {
  return { name: "\u5218\u5e73\u5e73", password: null, fallbackPasswordHash: "bcb15f821479b4d5772bd0ca866c00ad5f926e3580720659cc80d39c9d09802a" };
}

export async function sha256(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)))].map((item) => item.toString(16).padStart(2, "0")).join("");
}
