import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { requireAdmin } from "@/lib/api/admin-auth";
import { db } from "@/lib/db";
import { getSystemConfig } from "@/lib/admin/system-config";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const [conversations, agents, config] = await Promise.all([
    db.supportConversation.findMany({
      orderBy: { updatedAt: "desc" },
      take: 300,
      include: { messages: { orderBy: { createdAt: "asc" }, take: 200 } },
    }),
    db.adminUser.findMany({ orderBy: { username: "asc" }, select: { username: true, role: true } }),
    getSystemConfig(),
  ]);
  return jsonResponse({ conversations, agents, settings: config.support });
}
