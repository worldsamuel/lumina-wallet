import { NextResponse } from "next/server";
import { createNonce, WALLET_AUTH_NONCE_COOKIE, WALLET_AUTH_NONCE_MAX_AGE_SECONDS } from "@/lib/auth/nonce-store";

export async function GET() {
  const nonce = createNonce();
  const response = NextResponse.json({ nonce });
  response.cookies.set(WALLET_AUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: WALLET_AUTH_NONCE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
