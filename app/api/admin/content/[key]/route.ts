import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { db } from "@/lib/db";

const allowedKeys = new Set(["help", "about"]);

export function OPTIONS() {
  return optionsResponse();
}

export async function PUT(req: NextRequest, { params }: { params: { key: string } }) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  if (!allowedKeys.has(params.key)) {
    return jsonResponse({ error: "Unknown content page." }, { status: 404 });
  }

  const body = (await req.json()) as { bodyI18n: Record<string, string> };
  const page = await db.contentPage.upsert({
    where: { key: params.key },
    update: { bodyI18n: body.bodyI18n },
    create: { key: params.key, bodyI18n: body.bodyI18n },
  });
  await auditLog(admin.id, "update_content", params.key, body);
  return jsonResponse(page);
}
