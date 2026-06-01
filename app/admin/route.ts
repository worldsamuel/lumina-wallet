import { NextResponse } from "next/server";

export function GET(request: Request) {
  return NextResponse.redirect(new URL("/final/admin-v8.html", request.url));
}
