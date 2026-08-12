import { NextResponse } from "next/server";
import { getSessionUser, readSessionToken } from "../../../db/auth";
import { addNote, deleteNote, listNotes } from "../../../db/notes";

export const dynamic = "force-dynamic";

async function requireUser(request: Request) {
  return getSessionUser(readSessionToken(request));
}

export async function GET(request: Request) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  const commodity = new URL(request.url).searchParams.get("commodity") ?? "";
  const notes = await listNotes(user.username, commodity);
  return NextResponse.json({ notes });
}

export async function POST(request: Request) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  let body: { commodity?: unknown; body?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const commodity = String(body?.commodity ?? "");
  const text = String(body?.body ?? "");
  const note = await addNote(user.username, commodity, text);
  if (!note) return NextResponse.json({ error: "Anotação inválida." }, { status: 400 });
  return NextResponse.json({ note });
}

export async function DELETE(request: Request) {
  const user = await requireUser(request);
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  let body: { id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const id = Number(body?.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  await deleteNote(user.username, id);
  return NextResponse.json({ ok: true });
}
