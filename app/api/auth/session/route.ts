import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/auth/session";

export function GET(request: NextRequest) {
  const session = getSessionFromRequest(request);
  if (!session?.address) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json(
    { authenticated: true, address: session.address },
    { headers: { "Cache-Control": "private, no-store, max-age=0" } },
  );
}
