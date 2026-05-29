import { NextRequest } from "next/server";

type Bucket = {
  count: number;
  resetAt: number;
};

const buckets = new Map<string, Bucket>();

function clientIp(req: NextRequest) {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "127.0.0.1"
  );
}

export function rateLimit(req: NextRequest, key: string, limit: number, windowMs = 60_000) {
  const bucketKey = `${key}:${clientIp(req)}`;
  const now = Date.now();
  const existing = buckets.get(bucketKey);

  if (!existing || existing.resetAt <= now) {
    buckets.set(bucketKey, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }

  existing.count += 1;
  if (existing.count > limit) {
    return { ok: false, remaining: 0 };
  }

  return { ok: true, remaining: limit - existing.count };
}
