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

  const body = (await req.json()) as {
    maintenance?: boolean;
    morphoDepositEnabled?: boolean;
    adminLogoUrl?: string | null;
    faviconUrl?: string | null;
    swapNetworkFeeLabel?: string | null;
    welcomeBox?: unknown;
    pointsRules?: unknown;
    pointsTasks?: unknown;
    socialLinks?: {
      x?: unknown;
      telegram?: unknown;
      website?: unknown;
      discord?: unknown;
      youtube?: unknown;
    };
  };
  const config = await updateSystemConfig({
    maintenance: typeof body.maintenance === "boolean" ? body.maintenance : undefined,
    morphoDepositEnabled:
      typeof body.morphoDepositEnabled === "boolean" ? body.morphoDepositEnabled : undefined,
    adminLogoUrl:
      typeof body.adminLogoUrl === "string" || body.adminLogoUrl === null ? body.adminLogoUrl : undefined,
    faviconUrl: typeof body.faviconUrl === "string" || body.faviconUrl === null ? body.faviconUrl : undefined,
    swapNetworkFeeLabel:
      typeof body.swapNetworkFeeLabel === "string" || body.swapNetworkFeeLabel === null
        ? body.swapNetworkFeeLabel
        : undefined,
    welcomeBox: typeof body.welcomeBox === "object" && body.welcomeBox !== null ? body.welcomeBox : undefined,
    pointsRules: typeof body.pointsRules === "object" && body.pointsRules !== null ? body.pointsRules : undefined,
    pointsTasks: Array.isArray(body.pointsTasks) ? body.pointsTasks : undefined,
    socialLinks: typeof body.socialLinks === "object" && body.socialLinks !== null ? body.socialLinks : undefined,
  });
  await auditLog(admin.id, "update_system_config", "system_config", body);
  return jsonResponse(config);
}
