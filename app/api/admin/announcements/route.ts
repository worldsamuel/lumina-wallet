import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const body = (await req.json()) as {
    tag: string;
    titleI18n: Record<string, string>;
    bodyI18n: Record<string, string>;
  };
  const announcement = await db.announcement.create({
    data: {
      tag: body.tag,
      titleI18n: body.titleI18n,
      bodyI18n: body.bodyI18n,
    },
  });
  await auditLog(admin.id, "create_announcement", String(announcement.id), body);
  return jsonResponse(announcement);
}
