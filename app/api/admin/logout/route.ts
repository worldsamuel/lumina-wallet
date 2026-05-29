import { jsonResponse, optionsResponse } from "@/lib/api/cors";

export function OPTIONS() {
  return optionsResponse();
}

export async function POST() {
  const res = jsonResponse({ ok: true });
  res.cookies.set("admin_session", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
  return res;
}
