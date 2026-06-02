import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { requireAdmin } from "@/lib/api/admin-auth";
import { ensureFeedbackSchema } from "@/lib/admin/ensure-feedback-schema";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  await ensureFeedbackSchema();
  const feedback = await db.feedback.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return jsonResponse(feedback);
}
