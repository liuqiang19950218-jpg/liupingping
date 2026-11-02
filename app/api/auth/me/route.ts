import { NextResponse } from "next/server";
import { readSession } from "../session";

export async function GET(request: Request) {
  return NextResponse.json({ user: await readSession(request.headers.get("cookie")) });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("recon_session", "", { httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: 0 });
  return response;
}
