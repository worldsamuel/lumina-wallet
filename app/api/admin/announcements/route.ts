import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { ensureAnnouncementSchema } from "@/lib/admin/ensure-announcement-schema";
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
    imageUrl?: string | null;
    pinned?: boolean;
  };
  await ensureAnnouncementSchema();
  const titleI18n = JSON.stringify(body.titleI18n ?? {});
  const bodyI18n = JSON.stringify(body.bodyI18n ?? {});
  const rows = await db.$queryRaw<Array<{ id: number; tag: string; titleI18n: unknown; bodyI18n: unknown; publishedAt: Date; imageUrl: string | null; pinned: boolean }>>`
    INSERT INTO "Announcement" ("tag", "titleI18n", "bodyI18n", "imageUrl", "pinned")
    VALUES (${body.tag || "notice"}, ${titleI18n}::jsonb, ${bodyI18n}::jsonb, ${body.imageUrl || null}, ${Boolean(body.pinned)})
    RETURNING "id", "tag", "titleI18n", "bodyI18n", "publishedAt", "imageUrl", "pinned"
  `;
  const announcement = rows[0];
  await auditLog(admin.id, "create_announcement", String(announcement.id), body);
  return jsonResponse(announcement);
}
