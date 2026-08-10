import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSessionUser, type AuthUser } from "../db/auth";

export const SESSION_COOKIE = "gq_session";

// Lê o usuário da sessão atual (ou null) a partir do cookie assinado da requisição.
export async function getCurrentUser(): Promise<AuthUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value ?? null;
  return getSessionUser(token);
}

// Guarda de páginas protegidas: redireciona para /login se não houver sessão.
export async function requireAuth(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
