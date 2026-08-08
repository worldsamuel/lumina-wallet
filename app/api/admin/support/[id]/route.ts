import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { db } from "@/lib/db";
import { cleanSupportText, supportLanguage, supportStatus } from "@/lib/support/validation";

export function OPTIONS() {
  return optionsResponse();
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  const id = Number(params.id);
  if (!Number.isInteger(id)) return jsonResponse({ error: "Invalid conversation id." }, { status: 400 });
  const body = (await req.json().catch(() => null)) as {
    assignedTo?: string | null;
    status?: string;
    language?: string;
    markRead?: boolean;
  } | null;
  const status = body?.status ? supportStatus(body.status) : undefined;
  if (body?.status && !status) return jsonResponse({ error: "Invalid status." }, { status: 400 });
  const assignedTo = body && "assignedTo" in body ? cleanSupportText(body.assignedTo, 80) || null : undefined;
  if (assignedTo) {
    const agent = await db.adminUser.findUnique({ where: { username: assignedTo } });
    if (!agent) return jsonResponse({ error: "Agent not found." }, { status: 400 });
  }
  const conversation = await db.supportConversation.update({
    where: { id },
    data: {
      assignedTo,
      status: status || undefined,
      language: body?.language ? supportLanguage(body.language) : undefined,
      lastAdminReadAt: body?.markRead ? new Date() : undefined,
    },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 200 } },
  });
  await auditLog(admin.id, "update_support_conversation", String(id), {
    assignedTo,
    status,
    language: body?.language ? supportLanguage(body.language) : undefined,
    markRead: Boolean(body?.markRead),
  });
  return jsonResponse(conversation);
}
