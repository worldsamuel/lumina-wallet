import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getSessionFromRequest } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { cleanSupportText, supportLanguage, validSupportImage } from "@/lib/support/validation";

export function OPTIONS() {
  return optionsResponse();
}

function addressFrom(req: NextRequest) {
  return getSessionFromRequest(req)?.address.toLowerCase() || null;
}

async function latestConversation(address: string) {
  return db.supportConversation.findFirst({
    where: { address },
    orderBy: { updatedAt: "desc" },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 200 } },
  });
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:support:get", 120).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }
  const address = addressFrom(req);
  if (!address) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  return jsonResponse({ conversation: await latestConversation(address) });
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "public:support:post", 30).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }
  const address = addressFrom(req);
  if (!address) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as {
    text?: string;
    imageUrl?: string;
    language?: string;
    username?: string;
  } | null;
  const text = cleanSupportText(body?.text, 2000);
  const imageUrl = validSupportImage(body?.imageUrl);
  if (!text && !imageUrl) return jsonResponse({ error: "Message or image is required." }, { status: 400 });
  if (body?.imageUrl && !imageUrl) return jsonResponse({ error: "Invalid image." }, { status: 400 });

  const language = supportLanguage(body?.language);
  const username = cleanSupportText(body?.username, 80) || null;
  let conversation = await db.supportConversation.findFirst({
    where: { address, status: { not: "resolved" } },
    orderBy: { updatedAt: "desc" },
  });
  if (!conversation) {
    conversation = await db.supportConversation.create({ data: { address, username, language } });
  }

  await db.$transaction([
    db.supportMessage.create({
      data: { conversationId: conversation.id, sender: "user", senderName: username, text: text || null, imageUrl },
    }),
    db.supportConversation.update({
      where: { id: conversation.id },
      data: { username, language, status: "open", updatedAt: new Date() },
    }),
  ]);
  return jsonResponse({ ok: true, conversation: await latestConversation(address) });
}

export async function PATCH(req: NextRequest) {
  const address = addressFrom(req);
  if (!address) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { markRead?: boolean; language?: string } | null;
  const conversation = await db.supportConversation.findFirst({ where: { address }, orderBy: { updatedAt: "desc" } });
  if (!conversation) return jsonResponse({ ok: true });
  await db.supportConversation.update({
    where: { id: conversation.id },
    data: {
      lastUserReadAt: body?.markRead ? new Date() : undefined,
      language: body?.language ? supportLanguage(body.language) : undefined,
    },
  });
  return jsonResponse({ ok: true });
}
