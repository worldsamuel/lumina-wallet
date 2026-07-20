import { requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { getSecurityBackupRecords } from "@/lib/admin/security-backup";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  const records = await getSecurityBackupRecords();
  return jsonResponse({
    total: records.length,
    backedUp: records.filter((row) => row.backedUp).length,
    records,
  });
}
