import { NextResponse } from "next/server";
import {
  deleteOtherSessions,
  getSessionUser,
  readSessionToken,
  updatePassword,
} from "../../../../db/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = readSessionToken(request);
  const user = await getSessionUser(token);
  if (!user || !token) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  const currentPassword = String(body?.currentPassword ?? "");
  const newPassword = String(body?.newPassword ?? "");
  if (!currentPassword || !newPassword) {
    return NextResponse.json({ error: "Informe a senha atual e a nova senha." }, { status: 400 });
  }

  const result = await updatePassword(user.username, currentPassword, newPassword);
  if (result === "weak") {
    return NextResponse.json({ error: "A nova senha precisa ter ao menos 8 caracteres." }, { status: 400 });
  }
  if (result === "invalid_current") {
    return NextResponse.json({ error: "Senha atual incorreta." }, { status: 400 });
  }

  // Segurança: encerra as demais sessões deste usuário após a troca.
  await deleteOtherSessions(user.username, token);
  return NextResponse.json({ ok: true });
}
