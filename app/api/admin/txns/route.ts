import { isAddress, type Address } from "viem";
import { requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { getRecentUserActivity } from "@/lib/admin/activity";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const users = await db.user.findMany({
    orderBy: { lastLoginAt: "desc" },
    take: 40,
    select: { address: true },
  });
  const addresses = users
    .map((user) => user.address)
    .filter((address): address is Address => isAddress(address));

  try {
    return jsonResponse(await getRecentUserActivity(addresses));
  } catch (error) {
    console.error("Failed to load admin transactions", error);
    return jsonResponse([]);
  }
}
