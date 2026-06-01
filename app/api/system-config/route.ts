import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { DEFAULT_SYSTEM_CONFIG, getSystemConfig } from "@/lib/admin/system-config";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:system-config", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  try {
    return jsonResponse(await getSystemConfig());
  } catch (error) {
    console.error("Failed to load system config, using fallback", error);
    return jsonResponse(DEFAULT_SYSTEM_CONFIG);
  }
}
