import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { requireAdmin } from "@/lib/api/admin-auth";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const [conversations, agents] = await Promise.all([
    db.supportConversation.findMany({
      orderBy: { updatedAt: "desc" },
      take: 300,
      include: { messages: { orderBy: { createdAt: "asc" }, take: 200 } },
    }),
    db.adminUser.findMany({ orderBy: { username: "asc" }, select: { username: true, role: true } }),
  ]);
  return jsonResponse({ conversations, agents });
}
