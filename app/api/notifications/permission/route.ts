import { NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session?.address) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const user = await db.user.findFirst({
    where: { address: { equals: session.address, mode: "insensitive" } },
    select: { notificationsEnabled: true, notificationsUpdatedAt: true },
  });
  return jsonResponse({
    enabled: user?.notificationsEnabled === true,
    updatedAt: user?.notificationsUpdatedAt || null,
  });
}

export async function POST(req: NextRequest) {
  const session = getSessionFromRequest(req);
  if (!session?.address) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { enabled?: unknown } | null;
  if (typeof body?.enabled !== "boolean") {
    return jsonResponse({ error: "enabled must be a boolean." }, { status: 400 });
  }

  const result = await db.user.updateMany({
    where: { address: { equals: session.address, mode: "insensitive" } },
    data: {
      notificationsEnabled: body.enabled,
      notificationsUpdatedAt: new Date(),
    },
  });
  if (!result.count) return jsonResponse({ error: "User not found." }, { status: 404 });
  return jsonResponse({ enabled: body.enabled });
}
