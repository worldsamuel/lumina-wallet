import { NextRequest } from "next/server";
import { isAddress } from "viem";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { db } from "@/lib/db";

export function OPTIONS() {
  return optionsResponse();
}

function clean(value: unknown, max: number) {
  return String(value ?? "").trim().slice(0, max);
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "public:feedback", 20).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as {
    address?: string;
    username?: string;
    contact?: string;
    message?: string;
  } | null;

  const message = clean(body?.message, 1200);
  if (message.length < 3) {
    return jsonResponse({ error: "Feedback message is too short." }, { status: 400 });
  }

  try {
    const rawAddress = clean(body?.address, 64);
    const feedback = await db.feedback.create({
      data: {
        address: isAddress(rawAddress) ? rawAddress : null,
        username: clean(body?.username, 80) || null,
        contact: clean(body?.contact, 120) || null,
        message,
      },
    });

    return jsonResponse({ ok: true, id: feedback.id });
  } catch (error) {
    console.error("Failed to save feedback", error);
    return jsonResponse({ error: "Feedback service is temporarily unavailable." }, { status: 503 });
  }
}
