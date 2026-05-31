import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";

const ADMIN_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

type AdminSessionPayload = {
  adminId: string;
  username: string;
  role: string;
};

const loginFailures = new Map<string, { count: number; lockedUntil: number }>();

function adminSecret() {
  const secret = process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET;
  if (!secret) throw new Error("Missing SESSION_SECRET or ADMIN_SESSION_SECRET.");
  return secret;
}

export function hasAdminSessionSecret() {
  return Boolean(process.env.ADMIN_SESSION_SECRET || process.env.SESSION_SECRET);
}

export function getAdminSessionMaxAgeSeconds() {
  return ADMIN_SESSION_MAX_AGE_SECONDS;
}

export function signAdminSession(payload: AdminSessionPayload) {
  return jwt.sign(payload, adminSecret(), { expiresIn: ADMIN_SESSION_MAX_AGE_SECONDS });
}

export function verifyAdminSession(token: string) {
  return jwt.verify(token, adminSecret()) as AdminSessionPayload;
}

export async function requireAdmin() {
  const token = cookies().get("admin_session")?.value;
  if (!token) return null;

  try {
    const payload = verifyAdminSession(token);
    const admin = await db.adminUser.findUnique({ where: { id: payload.adminId } });
    return admin;
  } catch {
    return null;
  }
}

export function getLoginLock(username: string) {
  const key = username.toLowerCase();
  const record = loginFailures.get(key);
  if (!record || record.lockedUntil <= Date.now()) return null;
  return record;
}

export function recordLoginFailure(username: string) {
  const key = username.toLowerCase();
  const current = loginFailures.get(key);
  const nextCount = (current?.count ?? 0) + 1;
  loginFailures.set(key, {
    count: nextCount,
    lockedUntil: nextCount >= 5 ? Date.now() + 15 * 60_000 : current?.lockedUntil ?? 0,
  });
}

export function clearLoginFailures(username: string) {
  loginFailures.delete(username.toLowerCase());
}

export async function auditLog(adminId: string, action: string, target?: string, payload?: unknown) {
  await db.auditLog.create({
    data: {
      adminId,
      action,
      target,
      payload: payload === undefined ? undefined : JSON.parse(JSON.stringify(payload)),
    },
  });
}

export function requestPath(req: NextRequest) {
  return new URL(req.url).pathname;
}
