import { verifySiweMessage } from "@worldcoin/minikit-js/siwe";
import { NextRequest, NextResponse } from "next/server";
import { consumeNonce } from "@/lib/auth/nonce-store";
import { getSessionMaxAgeSeconds, signSession } from "@/lib/auth/session";
import type { WalletAuthPayload } from "@/lib/auth/wallet-auth-types";

type VerifyRequestBody = {
  nonce: string;
  payload: WalletAuthPayload;
};

export async function POST(req: NextRequest) {
  const { nonce, payload } = (await req.json()) as VerifyRequestBody;

  if (!nonce || !payload?.address || !payload?.message || !payload?.signature) {
    return NextResponse.json({ error: "Malformed walletAuth payload." }, { status: 400 });
  }

  if (!consumeNonce(nonce)) {
    return NextResponse.json({ error: "Invalid or expired nonce." }, { status: 401 });
  }

  const verification = await verifySiweMessage(payload, nonce, "Sign in to Lumina");

  if (!verification.isValid) {
    return NextResponse.json({ error: "Invalid wallet signature." }, { status: 401 });
  }

  const token = signSession({
    address: payload.address,
    createdAt: Date.now(),
  });

  const res = NextResponse.json({ address: payload.address });
  res.cookies.set("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: getSessionMaxAgeSeconds(),
    path: "/",
  });
  return res;
}
