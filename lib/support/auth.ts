import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const TOKEN_PATTERN = /^[a-zA-Z0-9_-]{32,160}$/;

export type SupportIdentity = {
  address: string;
  accessTokenHash: string | null;
  sessionAuthenticated: boolean;
};

export function supportIdentity(req: NextRequest): SupportIdentity | null {
  const session = getSessionFromRequest(req);
  if (session?.address && ADDRESS_PATTERN.test(session.address)) {
    return {
      address: session.address.toLowerCase(),
      accessTokenHash: null,
      sessionAuthenticated: true,
    };
  }

  const address = String(req.headers.get("x-support-address") || "").trim();
  const token = String(req.headers.get("x-support-token") || "").trim();
  if (!ADDRESS_PATTERN.test(address) || !TOKEN_PATTERN.test(token)) return null;
  return {
    address: address.toLowerCase(),
    accessTokenHash: createHash("sha256").update(token).digest("hex"),
    sessionAuthenticated: false,
  };
}

export function supportConversationWhere(identity: SupportIdentity) {
  return identity.sessionAuthenticated
    ? { address: identity.address }
    : { address: identity.address, accessTokenHash: identity.accessTokenHash };
}
