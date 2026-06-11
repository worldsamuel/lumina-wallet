import { NextResponse } from "next/server";
import { createNonce, WALLET_AUTH_NONCE_COOKIE, WALLET_AUTH_NONCE_MAX_AGE_SECONDS } from "@/lib/auth/nonce-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const nonce = createNonce();
  const response = NextResponse.json(
    { nonce },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    },
  );
  response.cookies.set(WALLET_AUTH_NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: WALLET_AUTH_NONCE_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}
