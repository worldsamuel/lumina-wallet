import { NextRequest } from "next/server";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { getSystemConfig, updateSystemConfig } from "@/lib/admin/system-config";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  return jsonResponse((await getSystemConfig()).support);
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return jsonResponse({ error: "Invalid settings." }, { status: 400 });
  const config = await updateSystemConfig({ support: body });
  await auditLog(admin.id, "update_support_settings", "support", body);
  return jsonResponse(config.support);
}
