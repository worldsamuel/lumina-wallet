import { verifySiweMessage } from "@worldcoin/minikit-js/siwe";
import { NextRequest, NextResponse } from "next/server";
import { consumeNonce, isNonceFormatValid, WALLET_AUTH_NONCE_COOKIE } from "@/lib/auth/nonce-store";
import { getSessionMaxAgeSeconds, signSession } from "@/lib/auth/session";
import type { WalletAuthPayload } from "@/lib/auth/wallet-auth-types";
import { publicClient } from "@/lib/chain";
import { db } from "@/lib/db";

type VerifyRequestBody = {
  nonce: string;
  payload: WalletAuthPayload;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function verifyWalletAuthPayload(payload: WalletAuthPayload, nonce: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await verifySiweMessage(payload, nonce, "Sign in to Lumina", undefined, publicClient);
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(250 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Signature verification failed.");
}

export async function POST(req: NextRequest) {
  const { nonce, payload } = (await req.json()) as VerifyRequestBody;

  if (!nonce || !payload?.address || !payload?.message || !payload?.signature) {
    return NextResponse.json({ error: "Malformed walletAuth payload." }, { status: 400 });
  }

  if (!isNonceFormatValid(nonce)) {
    return NextResponse.json({ error: "Invalid nonce format." }, { status: 400 });
  }

  const nonceCookie = req.cookies.get(WALLET_AUTH_NONCE_COOKIE)?.value;
  const nonceMatchesCookie = nonceCookie === nonce;
  const nonceMatchesMemory = consumeNonce(nonce);

  if (!nonceMatchesCookie && !nonceMatchesMemory) {
    return NextResponse.json({ error: "Invalid or expired nonce." }, { status: 401 });
  }

  let verification: Awaited<ReturnType<typeof verifySiweMessage>>;
  try {
    verification = await verifyWalletAuthPayload(payload, nonce);
  } catch (error) {
    console.error("walletAuth signature verification failed", error);
    const message = "Signature verification failed. Please try again.";
    return NextResponse.json({ error: message }, { status: 401 });
  }

  if (!verification.isValid) {
    return NextResponse.json({ error: "Invalid wallet signature." }, { status: 401 });
  }

  try {
    await db.user.upsert({
      where: { address: payload.address },
      update: { lastLoginAt: new Date() },
      create: { address: payload.address, lastLoginAt: new Date() },
    });
  } catch (error) {
    console.error("Failed to persist walletAuth user", error);
  }

  const token = signSession({
    address: payload.address,
    createdAt: Date.now(),
  });

  const res = NextResponse.json({ address: payload.address });
  res.cookies.delete(WALLET_AUTH_NONCE_COOKIE);
  res.cookies.set("session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: getSessionMaxAgeSeconds(),
    path: "/",
  });
  return res;
}
