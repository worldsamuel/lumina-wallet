import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import {
  clearLoginFailures,
  getAdminSessionMaxAgeSeconds,
  getLoginLock,
  recordLoginFailure,
  signAdminSession,
} from "@/lib/api/admin-auth";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "admin:login", 5).ok) {
    return jsonResponse({ error: "Too many login attempts." }, { status: 429 });
  }

  const { username, password } = (await req.json()) as { username?: string; password?: string };
  if (!username || !password) {
    return jsonResponse({ error: "Username and password are required." }, { status: 400 });
  }

  if (getLoginLock(username)) {
    return jsonResponse({ error: "Account temporarily locked." }, { status: 423 });
  }

  let admin = await db.adminUser.findUnique({ where: { username } });
  const ok = admin ? await bcrypt.compare(password, admin.passwordHash) : false;
  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD;
  const initialPasswordOk = username === "admin" && !!initialPassword && password === initialPassword;

  if (!ok && initialPasswordOk) {
    const passwordHash = await bcrypt.hash(password, 12);
    admin = await db.adminUser.upsert({
      where: { username: "admin" },
      update: { passwordHash, role: "super_admin" },
      create: { username: "admin", passwordHash, role: "super_admin" },
    });
  }

  if (!admin || (!ok && !initialPasswordOk)) {
    recordLoginFailure(username);
    return jsonResponse({ error: "Invalid credentials." }, { status: 401 });
  }

  clearLoginFailures(username);
  await db.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });

  const token = signAdminSession({ adminId: admin.id, username: admin.username, role: admin.role });
  const res = jsonResponse({ id: admin.id, username: admin.username, role: admin.role });
  res.cookies.set("admin_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: getAdminSessionMaxAgeSeconds(),
    path: "/",
  });
  return res;
}
