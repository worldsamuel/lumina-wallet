import { requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { getRecentUserActivity } from "@/lib/admin/activity";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  try {
    return jsonResponse(await getRecentUserActivity([], 200));
  } catch (error) {
    console.error("Failed to load admin transactions", error);
    return jsonResponse([]);
  }
}
