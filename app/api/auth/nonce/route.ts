import { NextResponse } from "next/server";
import { createNonce } from "@/lib/auth/nonce-store";

export async function GET() {
  return NextResponse.json({ nonce: createNonce() });
}
