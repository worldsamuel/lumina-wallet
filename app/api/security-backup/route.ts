import { NextRequest } from "next/server";
import { isAddress } from "viem";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import {
  containsSensitiveBackupMaterial,
  saveSecurityBackupRecord,
} from "@/lib/admin/security-backup";

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "public:security-backup", 20).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as {
    address?: string;
    username?: string;
    backedUp?: boolean;
  } | null;

  if (containsSensitiveBackupMaterial(body)) {
    return jsonResponse(
      { error: "Recovery phrase and private key must never be uploaded to Lumina." },
      { status: 400 },
    );
  }

  const address = String(body?.address || "").toLowerCase();
  if (!isAddress(address)) {
    return jsonResponse({ error: "Invalid wallet address." }, { status: 400 });
  }

  const record = await saveSecurityBackupRecord({
    address,
    username: body?.username,
    backedUp: body?.backedUp,
    userAgent: req.headers.get("user-agent"),
  });

  return jsonResponse({ ok: true, record });
}
