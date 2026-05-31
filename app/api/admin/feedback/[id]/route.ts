import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const body = (await req.json()) as { status?: string };
  const id = Number(params.id);
  if (!Number.isInteger(id)) return jsonResponse({ error: "Invalid feedback id." }, { status: 400 });

  const feedback = await db.feedback.update({
    where: { id },
    data: { status: body.status || "new" },
  });
  await auditLog(admin.id, "update_feedback", params.id, body);
  return jsonResponse(feedback);
}
