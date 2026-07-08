import { requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { getAllPointsOrders, getPointsAdjustments } from "@/lib/admin/points-products";
import { readWorldChainWithFallback } from "@/lib/chain";
import { db } from "@/lib/db";
import { formatUnits, isAddress, type Address } from "viem";

const WLD_ADDRESS = "0x2cFc85d8E48F8EAB294be644d9E25C3030863003" as Address;
const WLD_DECIMALS = 18;
const DEFAULT_LIMIT = 300;
const MAX_LIMIT = 800;
const BALANCE_LOOKUP_LIMIT = 12;
const BALANCE_TIMEOUT_MS = 800;
const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export function OPTIONS() {
  return optionsResponse();
}

export async function GET(req: Request) {
  const admin = await requireAdmin();
  if (!admin) return jsonResponse({ error: "Unauthorized." }, { status: 401 });
  const url = new URL(req.url);
  const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
  const requestedLimit = Number(url.searchParams.get("limit") || (q ? MAX_LIMIT : DEFAULT_LIMIT));
  const limit = Math.max(1, Math.min(MAX_LIMIT, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : DEFAULT_LIMIT));

  const users = await db.user.findMany({
    where: q
      ? {
          OR: [
            { address: { contains: q, mode: "insensitive" } },
            { worldId: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    orderBy: { createdAt: "desc" },
  });
  const [allAdjustments, allOrders] = await Promise.all([
    getPointsAdjustments(),
    getAllPointsOrders(),
  ]);
  const byAddress = new Map<string, {
    id: string | number;
    address: string;
    worldId?: string | null;
    createdAt: Date;
    lastLoginAt?: Date | null;
  }>();
  for (const user of users) {
    byAddress.set(user.address.toLowerCase(), {
      id: user.id,
      address: user.address.toLowerCase(),
      worldId: user.worldId,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    });
  }
  const addSynthetic = (address: string, createdAt?: string) => {
    const normalized = String(address || "").toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(normalized) || byAddress.has(normalized)) return;
    byAddress.set(normalized, {
      id: `address-${normalized}`,
      address: normalized,
      worldId: null,
      createdAt: createdAt ? new Date(createdAt) : new Date(0),
      lastLoginAt: null,
    });
  };
  for (const row of allAdjustments) addSynthetic(row.address, row.createdAt);
  for (const row of allOrders) addSynthetic(row.address, row.createdAt);
  const merged = Array.from(byAddress.values())
    .filter((user) => {
      if (!q) return true;
      return [user.address, user.worldId || ""].join(" ").toLowerCase().includes(q);
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const visible = merged.slice(0, limit);
  const adjustmentsByAddress = new Map<string, { rows: typeof allAdjustments; total: number }>();
  for (const row of allAdjustments) {
    const address = String(row.address || "").toLowerCase();
    const bucket = adjustmentsByAddress.get(address) || { rows: [], total: 0 };
    bucket.rows.push(row);
    if (!isAlphaPointsAdjustment(row)) bucket.total += Math.floor(Number(row.points || 0));
    adjustmentsByAddress.set(address, bucket);
  }
  const balanceLookupCount = q ? Math.min(visible.length, BALANCE_LOOKUP_LIMIT * 2) : Math.min(visible.length, BALANCE_LOOKUP_LIMIT);
  const balanceRows = await mapWithConcurrency(visible.slice(0, balanceLookupCount), 8, async (user) =>
    withTimeout(getWldBalance(user.address), BALANCE_TIMEOUT_MS, null),
  );
  const wldBalances = new Map<string, string | null>();
  visible.slice(0, balanceLookupCount).forEach((user, index) => wldBalances.set(user.address, balanceRows[index] ?? null));
  const enriched = visible.map((user, index) => {
    const adjustments = adjustmentsByAddress.get(user.address)?.rows || [];
    const adjustmentTotal = adjustmentsByAddress.get(user.address)?.total || 0;
    return {
      ...user,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      luminaNo: index + 1,
      wldBalance: wldBalances.has(user.address) ? wldBalances.get(user.address) : null,
      pointsAdjustmentTotal: adjustmentTotal,
      pointsAdjustments: adjustments.slice(0, 12),
    };
  });
  return jsonResponse(enriched, { headers: { "X-Lumina-Total-Users": String(merged.length), "X-Lumina-Returned-Users": String(enriched.length) } });
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function getWldBalance(address: string) {
  if (!isAddress(address)) return null;
  try {
    const balance = await readWorldChainWithFallback((client) =>
      client.readContract({
        address: WLD_ADDRESS,
        abi: erc20BalanceAbi,
        functionName: "balanceOf",
        args: [address as Address],
      }),
    );
    return formatUnits(balance, WLD_DECIMALS);
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T) {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

function isAlphaPointsAdjustment(row: { createdBy?: string | null; note?: string | null }) {
  const marker = `${row.createdBy || ""} ${row.note || ""}`.toLowerCase();
  return marker.includes("alpha");
}
