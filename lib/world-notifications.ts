import "server-only";

import { isAddress } from "viem";

const WORLD_NOTIFICATION_ENDPOINT = "https://developer.world.org/api/v2/minikit/send-notification";
const MAX_RECIPIENTS_PER_REQUEST = 1_000;
const REQUEST_TIMEOUT_MS = 50_000;

export type WorldNotificationResult = {
  walletAddress: string;
  sent: boolean;
  reason?: string;
};

type WorldNotificationResponse = {
  success?: boolean;
  status?: number;
  result?: WorldNotificationResult[];
  code?: string;
  detail?: string;
  attribute?: string;
};

export type SendWorldNotificationInput = {
  walletAddresses: string[];
  title: string;
  message: string;
  miniAppPath?: string;
};

function notificationConfig() {
  const appId = process.env.WORLD_APP_ID || process.env.APP_ID || process.env.NEXT_PUBLIC_WORLD_APP_ID;
  const apiKey = process.env.WORLD_DEVELOPER_API_KEY;
  if (!appId) throw new Error("World App ID is not configured.");
  if (!apiKey) throw new Error("WORLD_DEVELOPER_API_KEY is not configured.");
  return { appId, apiKey };
}

function countCharacters(value: string) {
  return Array.from(value).length;
}

export function normalizeNotificationAddresses(addresses: string[]) {
  return Array.from(
    new Set(
      addresses
        .map((address) => String(address || "").trim().toLowerCase())
        .filter((address) => isAddress(address)),
    ),
  );
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function validateInput(input: SendWorldNotificationInput) {
  const title = input.title.trim();
  const message = input.message.trim();
  const walletAddresses = normalizeNotificationAddresses(input.walletAddresses);
  if (!title) throw new Error("Notification title is required.");
  if (countCharacters(title) > 30) throw new Error("Notification title must be 30 characters or fewer.");
  if (!message) throw new Error("Notification message is required.");
  if (countCharacters(message) > 200) throw new Error("Notification message must be 200 characters or fewer.");
  if (!walletAddresses.length) throw new Error("No valid notification recipients were found.");
  return { title, message, walletAddresses };
}

async function sendBatch(
  walletAddresses: string[],
  title: string,
  message: string,
  miniAppPath: string,
  appId: string,
  apiKey: string,
) {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(WORLD_NOTIFICATION_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          app_id: appId,
          wallet_addresses: walletAddresses,
          title,
          message,
          mini_app_path: miniAppPath,
        }),
        cache: "no-store",
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: WorldNotificationResponse = {};
      try {
        payload = text ? (JSON.parse(text) as WorldNotificationResponse) : {};
      } catch {
        payload = { detail: text || `World notification API returned HTTP ${response.status}.` };
      }
      if (response.ok && Array.isArray(payload.result)) return payload.result;
      const detail = payload.detail || payload.code || `World notification API returned HTTP ${response.status}.`;
      lastError = new Error(detail);
      if (response.status !== 429 && response.status < 500) break;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("World notification request failed.");
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
  }
  throw lastError || new Error("World notification request failed.");
}

export async function sendWorldNotification(input: SendWorldNotificationInput) {
  const { appId, apiKey } = notificationConfig();
  const { title, message, walletAddresses } = validateInput(input);
  const miniAppPath = input.miniAppPath?.trim() || `worldapp://mini-app?app_id=${appId}`;
  if (!/^world(?:app|id):\/\/mini-app\?app_id=app_[a-zA-Z0-9]+/.test(miniAppPath)) {
    throw new Error("miniAppPath must be a valid World App Mini App deeplink.");
  }

  const batches = chunks(walletAddresses, MAX_RECIPIENTS_PER_REQUEST);
  const batchResults = await Promise.all(
    batches.map((batch) => sendBatch(batch, title, message, miniAppPath, appId, apiKey)),
  );
  const results = batchResults.flat();
  const sent = results.filter((result) => result.sent).length;
  return {
    requested: walletAddresses.length,
    sent,
    failed: walletAddresses.length - sent,
    results,
  };
}

export function isWorldNotificationConfigured() {
  return Boolean(
    (process.env.WORLD_APP_ID || process.env.APP_ID || process.env.NEXT_PUBLIC_WORLD_APP_ID) &&
      process.env.WORLD_DEVELOPER_API_KEY,
  );
}
