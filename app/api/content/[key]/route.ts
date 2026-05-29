import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { db } from "@/lib/db";

const allowedKeys = new Set(["help", "about"]);

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

  const page = await db.contentPage.findUnique({ where: { key: params.key } });
  return jsonResponse(page ?? { key: params.key, bodyI18n: {} });
}
