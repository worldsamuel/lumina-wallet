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

  return jsonResponse(await getSystemConfig());
}

export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const body = (await req.json()) as { maintenance?: boolean; morphoDepositEnabled?: boolean };
  const config = await updateSystemConfig({
    maintenance: typeof body.maintenance === "boolean" ? body.maintenance : undefined,
    morphoDepositEnabled:
      typeof body.morphoDepositEnabled === "boolean" ? body.morphoDepositEnabled : undefined,
  });
  await auditLog(admin.id, "update_system_config", "system_config", body);
  return jsonResponse(config);
}
