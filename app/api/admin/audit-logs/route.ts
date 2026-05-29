import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { requireAdmin } from "@/lib/api/admin-auth";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const logs = await db.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  return jsonResponse(logs);
}
