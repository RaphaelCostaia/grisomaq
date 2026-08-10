import { requireAuth } from "../../lib/session";
import ReportsClient from "./reports-client";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAuth();
  return <ReportsClient />;
}
