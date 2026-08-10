import { requireAuth } from "../../lib/session";
import NewsClient from "./news-client";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAuth();
  return <NewsClient />;
}
