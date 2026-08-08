import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { db } from "@/lib/db";
import { cleanSupportText, validSupportImage } from "@/lib/support/validation";

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  const id = Number(params.id);
  if (!Number.isInteger(id)) return jsonResponse({ error: "Invalid conversation id." }, { status: 400 });
  const body = (await req.json().catch(() => null)) as { text?: string; imageUrl?: string } | null;
  const text = cleanSupportText(body?.text, 2000);
  const imageUrl = validSupportImage(body?.imageUrl);
  if (!text && !imageUrl) return jsonResponse({ error: "Message or image is required." }, { status: 400 });
  if (body?.imageUrl && !imageUrl) return jsonResponse({ error: "Invalid image." }, { status: 400 });

  const exists = await db.supportConversation.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return jsonResponse({ error: "Conversation not found." }, { status: 404 });
  await db.$transaction([
    db.supportMessage.create({
      data: { conversationId: id, sender: "admin", senderName: admin.username, text: text || null, imageUrl },
    }),
    db.supportConversation.update({
      where: { id },
      data: { assignedTo: admin.username, status: "pending", lastAdminReadAt: new Date(), updatedAt: new Date() },
    }),
  ]);
  await auditLog(admin.id, "reply_support_conversation", String(id), { hasText: Boolean(text), hasImage: Boolean(imageUrl) });
  return jsonResponse({ ok: true });
}
