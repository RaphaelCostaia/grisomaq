import { NextResponse } from "next/server";
import { deleteSession, readSessionToken } from "../../../../db/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  await deleteSession(readSessionToken(request));
  const response = NextResponse.json({ ok: true });
  response.headers.append(
    "Set-Cookie",
    "gq_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0",
  );
  return response;
}
