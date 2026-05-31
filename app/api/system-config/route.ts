import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getSystemConfig } from "@/lib/admin/system-config";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:system-config", 60).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  return jsonResponse(await getSystemConfig());
}
