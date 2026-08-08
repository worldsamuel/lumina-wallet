import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getSessionFromRequest } from "@/lib/auth/session";

const TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  if (!getSessionFromRequest(req)) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  if (!rateLimit(req, "public:support:upload", 10).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return jsonResponse({ error: "Missing file." }, { status: 400 });
  if (!TYPES.has(file.type)) return jsonResponse({ error: "Unsupported image type." }, { status: 400 });
  if (file.size > 1024 * 1024) return jsonResponse({ error: "Image must be smaller than 1MB." }, { status: 400 });
  const bytes = Buffer.from(await file.arrayBuffer());
  return jsonResponse({ url: `data:${file.type};base64,${bytes.toString("base64")}` });
}
