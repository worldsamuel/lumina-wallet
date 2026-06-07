import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { addPointsAdjustment, getPointsAdjustments } from "@/lib/admin/points-products";
import { getSystemConfig, updateSystemConfig } from "@/lib/admin/system-config";

const NO_STORE = { headers: { "Cache-Control": "no-store, max-age=0" } };

export function OPTIONS() {
  return optionsResponse();
}

function validAddress(value: string) {
  return /^0x[a-f0-9]{40}$/.test(value.toLowerCase());
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:welcome-box-read", 120).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429, ...NO_STORE });
  }
  const address = String(req.nextUrl.searchParams.get("address") || "").toLowerCase();
  const config = await getSystemConfig();
  const claimed = validAddress(address)
    ? (await getPointsAdjustments(address)).some((row) => row.note === "Welcome mystery box")
    : false;
  return jsonResponse({ config: config.welcomeBox, claimed }, NO_STORE);
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "public:welcome-box-claim", 30).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429, ...NO_STORE });
  }

  const body = await req.json().catch(() => ({}));
  const address = String(body.address || "").toLowerCase();
  if (!validAddress(address)) return jsonResponse({ error: "Wallet address required." }, { status: 400, ...NO_STORE });

  const config = await getSystemConfig();
  const box = config.welcomeBox;
  if (!box.enabled) return jsonResponse({ error: "Welcome box is closed." }, { status: 400, ...NO_STORE });
  if (box.totalCount <= 0) return jsonResponse({ error: "Welcome boxes are sold out." }, { status: 400, ...NO_STORE });

  const existing = await getPointsAdjustments(address);
  if (existing.some((row) => row.note === "Welcome mystery box")) {
    return jsonResponse({ error: "Already opened.", claimed: true }, { status: 409, ...NO_STORE });
  }

  const min = Math.max(0, Math.floor(Number(box.minPoints || 0)));
  const max = Math.max(min, Math.floor(Number(box.maxPoints || min)));
  const points = min + Math.floor(Math.random() * (max - min + 1));
  const row = await addPointsAdjustment({
    address,
    points,
    note: "Welcome mystery box",
    createdBy: "welcome-box",
  });
  const updated = await updateSystemConfig({
    welcomeBox: { ...box, totalCount: Math.max(0, box.totalCount - 1) },
  });

  return jsonResponse({ ok: true, points, row, config: updated.welcomeBox }, NO_STORE);
}
