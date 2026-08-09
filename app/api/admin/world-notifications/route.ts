import { NextRequest } from "next/server";
import { isAddress } from "viem";
import { auditLog, requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { db } from "@/lib/db";
import {
  isWorldNotificationConfigured,
  normalizeNotificationAddresses,
  sendWorldNotification,
} from "@/lib/world-notifications";

export const maxDuration = 120;

const globalNotificationState = globalThis as typeof globalThis & {
  luminaWorldNotificationSending?: boolean;
};

export function OPTIONS() {
  return optionsResponse();
}

export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  const [recipientCount, totalUserCount, history] = await Promise.all([
    db.user.count({ where: { notificationsEnabled: true } }),
    db.user.count(),
    db.auditLog.findMany({
      where: { action: "send_world_notification" },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  return jsonResponse({ configured: isWorldNotificationConfigured(), recipientCount, totalUserCount, history });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  if (globalNotificationState.luminaWorldNotificationSending) {
    return jsonResponse({ error: "A World notification campaign is already being sent." }, { status: 409 });
  }

  const body = (await req.json()) as {
    title?: string;
    message?: string;
    recipientMode?: "all" | "address";
    addresses?: string[];
    address?: string;
    miniAppPath?: string;
  };
  const recipientMode = body.recipientMode === "address" ? "address" : "all";
  let addresses: string[];
  if (recipientMode === "address") {
    addresses = normalizeNotificationAddresses([body.address || "", ...(body.addresses || [])]);
    if (!addresses.length || addresses.some((address) => !isAddress(address))) {
      return jsonResponse({ error: "请输入有效的钱包地址。" }, { status: 400 });
    }
  } else {
    const users = await db.user.findMany({
      where: { notificationsEnabled: true },
      select: { address: true },
    });
    addresses = normalizeNotificationAddresses(users.map((user) => user.address));
    if (!addresses.length) {
      return jsonResponse({ error: "暂无已确认开启 World 通知的用户。" }, { status: 400 });
    }
  }

  globalNotificationState.luminaWorldNotificationSending = true;
  try {
    const result = await sendWorldNotification({
      walletAddresses: addresses,
      title: String(body.title || ""),
      message: String(body.message || ""),
      miniAppPath: body.miniAppPath,
    });
    const failedResults = result.results.filter((item) => !item.sent).slice(0, 100);
    const authorizedAddresses = result.results
      .filter((item) => item.sent || /notification limit reached/i.test(item.reason || ""))
      .map((item) => item.walletAddress);
    const disabledAddresses = result.results
      .filter((item) => !item.sent && /disabled notifications|user not found/i.test(item.reason || ""))
      .map((item) => item.walletAddress);
    await Promise.all([
      authorizedAddresses.length
        ? db.user.updateMany({
            where: { address: { in: authorizedAddresses, mode: "insensitive" } },
            data: { notificationsEnabled: true, notificationsUpdatedAt: new Date() },
          })
        : Promise.resolve(),
      disabledAddresses.length
        ? db.user.updateMany({
            where: { address: { in: disabledAddresses, mode: "insensitive" } },
            data: { notificationsEnabled: false, notificationsUpdatedAt: new Date() },
          })
        : Promise.resolve(),
    ]);
    await auditLog(admin.id, "send_world_notification", recipientMode, {
      title: String(body.title || "").trim(),
      message: String(body.message || "").trim(),
      recipientMode,
      requested: result.requested,
      sent: result.sent,
      failed: result.failed,
      failedResults,
    });
    return jsonResponse({ ...result, results: undefined, failedResults });
  } catch (error) {
    const message = error instanceof Error ? error.message : "World notification request failed.";
    return jsonResponse({ error: message }, { status: 502 });
  } finally {
    globalNotificationState.luminaWorldNotificationSending = false;
  }
}
