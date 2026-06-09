import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { db } from "@/lib/db";

const allowedKeys = new Set(["help", "about"]);
const CONFIG_CACHE = { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600" } };

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest, { params }: { params: { key: string } }) {
  if (!rateLimit(req, "public:content", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  if (!allowedKeys.has(params.key)) {
    return jsonResponse({ error: "Unknown content page." }, { status: 404 });
  }

  try {
    const page = await db.contentPage.findUnique({ where: { key: params.key } });
    return jsonResponse(page ?? { key: params.key, bodyI18n: {} }, CONFIG_CACHE);
  } catch {
    console.warn("[content] fallback used");
    return jsonResponse({
      key: params.key,
      bodyI18n:
        params.key === "help"
          ? { en: "Lumina Help Center", "zh-CN": "Lumina 帮助中心" }
          : { en: "About Lumina", "zh-CN": "关于 Lumina" },
    }, CONFIG_CACHE);
  }
}
