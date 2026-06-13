import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { DEFAULT_SYSTEM_CONFIG, getSystemConfig } from "@/lib/admin/system-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CONFIG_CACHE = { headers: { "Cache-Control": "private, no-store, max-age=0" } };

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:system-config", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  try {
    return jsonResponse(await getSystemConfig(), CONFIG_CACHE);
  } catch {
    console.warn("[system-config] fallback used");
    return jsonResponse(DEFAULT_SYSTEM_CONFIG, CONFIG_CACHE);
  }
}
