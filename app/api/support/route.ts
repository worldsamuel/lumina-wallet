import { NextRequest } from "next/server";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { rateLimit } from "@/lib/api/rate-limit";
import { getSystemConfig } from "@/lib/admin/system-config";
import { db } from "@/lib/db";
import { supportConversationWhere, supportIdentity } from "@/lib/support/auth";
import { cleanSupportText, supportLanguage, validSupportImage } from "@/lib/support/validation";

export function OPTIONS() {
  return optionsResponse();
}

async function latestConversation(req: NextRequest) {
  const identity = supportIdentity(req);
  if (!identity) return { identity: null, conversation: null };
  const conversation = await db.supportConversation.findFirst({
    where: supportConversationWhere(identity),
    orderBy: { updatedAt: "desc" },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 200 } },
  });
  return { identity, conversation };
}

export async function GET(req: NextRequest) {
  if (!rateLimit(req, "public:support:get", 120).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }
  const [{ identity, conversation }, config] = await Promise.all([latestConversation(req), getSystemConfig()]);
  if (!identity) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  return jsonResponse({ conversation, settings: config.support });
}

export async function POST(req: NextRequest) {
  if (!rateLimit(req, "public:support:post", 30).ok) {
    return jsonResponse({ error: "Too many requests." }, { status: 429 });
  }
  const identity = supportIdentity(req);
  if (!identity) return jsonResponse({ error: "Unauthorized." }, { status: 401 });

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
  const where = supportConversationWhere(identity);
  let conversation = await db.supportConversation.findFirst({
    where: { ...where, status: { not: "resolved" } },
    orderBy: { updatedAt: "desc" },
  });
  let created = false;
  if (!conversation) {
    if (!identity.sessionAuthenticated) {
      const claimed = await db.supportConversation.findFirst({
        where: { address: identity.address, status: { not: "resolved" } },
        select: { id: true },
      });
      if (claimed) return jsonResponse({ error: "Support session is already linked on another device." }, { status: 409 });
    }
    conversation = await db.supportConversation.create({
      data: {
        address: identity.address,
        accessTokenHash: identity.accessTokenHash,
        username,
        language,
      },
    });
    created = true;
  }

  const config = await getSystemConfig();
  const autoReply = config.support.autoReplyEnabled
    ? config.support.autoReplies[language] || config.support.autoReplies.en
    : "";
  const operations = [
    db.supportMessage.create({
      data: { conversationId: conversation.id, sender: "user", senderName: username, text: text || null, imageUrl },
    }),
    db.supportConversation.update({
      where: { id: conversation.id },
      data: { username, language, status: "open", updatedAt: new Date() },
    }),
  ];
  if (created && autoReply) {
    operations.push(db.supportMessage.create({
      data: {
        conversationId: conversation.id,
        sender: "admin",
        senderName: config.support.displayName,
        text: autoReply,
      },
    }) as typeof operations[number]);
  }
  await db.$transaction(operations);
  const current = await db.supportConversation.findUnique({
    where: { id: conversation.id },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 200 } },
  });
  return jsonResponse({ ok: true, conversation: current, settings: config.support });
}

export async function PATCH(req: NextRequest) {
  const identity = supportIdentity(req);
  if (!identity) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { markRead?: boolean; language?: string } | null;
  const conversation = await db.supportConversation.findFirst({
    where: supportConversationWhere(identity),
    orderBy: { updatedAt: "desc" },
  });
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
