import { NextResponse } from "next/server";
import {
  checkLoginRateLimit,
  clearLoginAttempts,
  createSession,
  readClientIp,
  recordFailedLogin,
  verifyCredentials,
} from "../../../../db/auth";

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

  // Proteção contra força-bruta (por usuário e por IP).
  const ip = readClientIp(request);
  const rate = await checkLoginRateLimit(username, ip);
  if (rate.blocked) {
    return NextResponse.json(
      { error: `Muitas tentativas. Tente novamente em cerca de ${Math.ceil(rate.retryAfterSec / 60)} min.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSec) } },
    );
  }

  const user = await verifyCredentials(username, password);
  if (!user) {
    await recordFailedLogin(username, ip);
    return NextResponse.json({ error: "Usuário ou senha inválidos." }, { status: 401 });
  }

  await clearLoginAttempts(username);
  const { token, expiresAt } = await createSession(user);
  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
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
