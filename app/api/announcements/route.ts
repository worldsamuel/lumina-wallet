import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { ensureAnnouncementSchema } from "@/lib/admin/ensure-announcement-schema";
import { db } from "@/lib/db";

const CONFIG_CACHE = { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } };

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:announcements", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  try {
    await ensureAnnouncementSchema();
    const announcements = await db.$queryRaw<
      Array<{
        id: number;
        tag: string;
        titleI18n: unknown;
        bodyI18n: unknown;
        publishedAt: Date;
        imageUrl: string | null;
        pinned: boolean;
      }>
    >`
      SELECT "id", "tag", "titleI18n", "bodyI18n", "publishedAt", "imageUrl", "pinned"
      FROM "Announcement"
      ORDER BY "pinned" DESC, "publishedAt" DESC
    `;
    return jsonResponse(announcements, CONFIG_CACHE);
  } catch (error) {
    console.error("Failed to load announcements, using fallback", error);
    return jsonResponse([
      {
        id: 1,
        tag: "notice",
        titleI18n: { en: "Welcome to Lumina", "zh-CN": "欢迎使用 Lumina" },
        bodyI18n: { en: "Lumina is running with local fallback content.", "zh-CN": "Lumina 正在使用本地兜底公告。" },
        publishedAt: new Date(0).toISOString(),
        imageUrl: null,
        pinned: false,
      },
    ], CONFIG_CACHE);
  }
}
