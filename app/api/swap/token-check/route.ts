import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { checkSwapTokenSafety } from "@/lib/swap/token-safety";

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:swap-token-check", 80).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }

  const address = req.nextUrl.searchParams.get("address") ?? "";
  try {
    const report = await checkSwapTokenSafety(address);
    return jsonResponse(report, {
      status: report.status === "rejected" ? 422 : 200,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Invalid token contract" },
      {
        status: 400,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
