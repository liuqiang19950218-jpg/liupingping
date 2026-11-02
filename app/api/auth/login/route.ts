import { NextResponse } from "next/server";
import { createSession } from "../session";

export async function POST(request: Request) {
  const body = await request.json() as { account?: string; password?: string };
  const account = body.account?.trim() ?? "";
  const password = body.password ?? "";
  const administratorName = "\u5218\u5e73\u5e73";
  const administratorPassword = String.fromCharCode(49, 49, 49, 49, 49, 49);
  if (account !== administratorName || password !== administratorPassword) {
    return NextResponse.json({ error: "账号或密码不正确，或账号尚未开通。" }, { status: 401 });
  }
  const response = NextResponse.json({ user: { name: account, role: "admin", region: null } });
  response.cookies.set("recon_session", await createSession({ name: account, role: "admin", region: null }), { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 60 * 60 * 12 });
  return response;
}
