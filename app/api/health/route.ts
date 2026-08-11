import { NextResponse } from "next/server";
import { env } from "../../../lib/server-env";

export const dynamic = "force-dynamic";

// Endpoint leve para monitor de uptime (ex.: UptimeRobot pingando aqui).
// Retorna 200 se o app responde e o banco está acessível; 503 se o banco falhar.
export async function GET() {
  try {
    await env.DB.prepare("SELECT 1 AS ok").first();
    return NextResponse.json(
      { status: "ok", db: "ok", time: new Date().toISOString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { status: "degraded", db: "erro", time: new Date().toISOString() },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
