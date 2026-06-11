import { NextResponse } from "next/server";
import { getPointsProducts } from "@/lib/admin/points-products";

const IMAGE_FIELDS = new Set(["imageUrl", "detailImageUrl", "iconUrl"]);

export async function GET(request: Request, context: { params: { id: string } }) {
  const url = new URL(request.url);
  const field = url.searchParams.get("field") || "imageUrl";
  if (!IMAGE_FIELDS.has(field)) return NextResponse.json({ error: "Invalid image field" }, { status: 400 });

  const product = (await getPointsProducts()).find((item) => item.id === context.params.id);
  const value = product ? String((product as unknown as Record<string, unknown>)[field] || "") : "";
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
  if (!match) return NextResponse.json({ error: "Image not found" }, { status: 404 });

  return new NextResponse(Buffer.from(match[2], "base64"), {
    headers: {
      "content-type": match[1],
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
    },
  });
}
