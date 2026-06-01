import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { DEFAULT_SYSTEM_CONFIG, getSystemConfig } from "@/lib/admin/system-config";

const NO_STORE = { headers: { "Cache-Control": "no-store, max-age=0" } };

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:system-config", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429, ...NO_STORE });
  }

  try {
    return jsonResponse(await getSystemConfig(), NO_STORE);
  } catch (error) {
    console.error("Failed to load system config, using fallback", error);
    return jsonResponse(DEFAULT_SYSTEM_CONFIG, NO_STORE);
  }
}
