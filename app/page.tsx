import { requireAuth } from "../lib/session";
import HomeClient from "./home-client";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireAuth();
  return <HomeClient />;
}
