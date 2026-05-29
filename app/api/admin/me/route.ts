import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { requireAdmin } from "@/lib/api/admin-auth";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  return jsonResponse({
    id: admin.id,
    username: admin.username,
    role: admin.role,
    lastLoginAt: admin.lastLoginAt,
  });
}
