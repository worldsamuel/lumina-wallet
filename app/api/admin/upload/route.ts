import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonResponse({ error: "Missing file." }, { status: 400 });
  }
  if (!file.type.startsWith("image/")) {
    return jsonResponse({ error: "Only images are supported." }, { status: 400 });
  }
  if (file.size > 2 * 1024 * 1024) {
    return jsonResponse({ error: "Image must be smaller than 2MB. Use an external CDN URL for larger files." }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const url = `data:${file.type};base64,${bytes.toString("base64")}`;
  await auditLog(admin.id, "upload_asset", String(form.get("type") || "image"), {
    name: file.name,
    size: file.size,
    type: file.type,
  });
  return jsonResponse({ url });
}
