import bcrypt from "bcryptjs";
import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import {
  clearLoginFailures,
  getAdminSessionMaxAgeSeconds,
  getLoginLock,
  hasAdminSessionSecret,
  recordLoginFailure,
  signAdminSession,
} from "@/lib/api/admin-auth";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

export async function POST(req: NextRequest) {
  if (!hasAdminSessionSecret()) {
    return jsonResponse(
      { error: "Admin session secret is not configured. Set ADMIN_SESSION_SECRET in Vercel." },
      { status: 500 },
    );
  }

  if (!rateLimit(req, "admin:login", 5).ok) {
    return jsonResponse({ error: "Too many login attempts." }, { status: 429 });
  }

  const body = (await req.json()) as { username?: string; password?: string };
  const username = body.username?.trim();
  const password = body.password ?? "";
  if (!username || !password) {
    return jsonResponse({ error: "Username and password are required." }, { status: 400 });
  }
  if (username.length < 3 || username.length > 40) {
    return jsonResponse({ error: "Username must be 3-40 characters." }, { status: 400 });
  }

  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD;
  const initialPasswordOk = !!initialPassword && password === initialPassword;

  if (getLoginLock(username) && !initialPasswordOk) {
    return jsonResponse({ error: "Account temporarily locked." }, { status: 423 });
  }

  let admin = await db.adminUser.findUnique({ where: { username } });
  let ok = admin ? await bcrypt.compare(password, admin.passwordHash) : false;

  if (!admin) {
    const adminCount = await db.adminUser.count();
    if (adminCount === 0) {
      if (password.length < 10) {
        return jsonResponse({ error: "First admin password must be at least 10 characters." }, { status: 400 });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      admin = await db.adminUser.create({
        data: {
          username,
          passwordHash,
          role: "super_admin",
        },
      });
      ok = true;
    }
  }

  if (!ok && initialPasswordOk) {
    const passwordHash = await bcrypt.hash(password, 12);
    admin = await db.adminUser.upsert({
      where: { username },
      update: { passwordHash, role: "super_admin" },
      create: { username, passwordHash, role: "super_admin" },
    });
    ok = true;
  }

  if (!admin || !ok) {
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
