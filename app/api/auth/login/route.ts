import { NextResponse } from "next/server";
import { createSession, verifyCredentials } from "../../../../db/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const username = String(body?.username ?? "").trim();
  const password = String(body?.password ?? "");
  if (!username || !password) {
    return NextResponse.json({ error: "Informe usuário e senha." }, { status: 400 });
  }

  const user = await verifyCredentials(username, password);
  if (!user) {
    return NextResponse.json({ error: "Usuário ou senha inválidos." }, { status: 401 });
  }

  const { token, expiresAt } = await createSession(user);
  const secure = new URL(request.url).protocol === "https:";
  const cookie = [
    `gq_session=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Expires=${new Date(expiresAt).toUTCString()}`,
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");

  const response = NextResponse.json({ ok: true, username: user.username });
  response.headers.append("Set-Cookie", cookie);
  return response;
}
