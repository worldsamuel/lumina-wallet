import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { ensureFeedbackSchema } from "@/lib/admin/ensure-feedback-schema";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const body = (await req.json()) as { status?: string; reply?: string | null };
  const id = Number(params.id);
  if (!Number.isInteger(id)) return jsonResponse({ error: "Invalid feedback id." }, { status: 400 });

  const reply =
    typeof body.reply === "string"
      ? body.reply.trim().slice(0, 2000)
      : body.reply === null
        ? null
        : undefined;
  await ensureFeedbackSchema();
  const feedback = await db.feedback.update({
    where: { id },
    data: {
      status: body.status || (reply ? "replied" : "new"),
      reply,
      repliedAt: reply === undefined ? undefined : reply ? new Date() : null,
      repliedBy: reply === undefined ? undefined : reply ? admin.username : null,
    },
  });
  await auditLog(admin.id, "update_feedback", params.id, body);
  return jsonResponse(feedback);
}
