import { requireAdmin } from "@/lib/api/admin-auth";
import { jsonResponse, optionsResponse } from "@/lib/api/cors";
import { getAllPointsOrders, getPointsAdjustments, getPointsAdjustmentTotal } from "@/lib/admin/points-products";
import { readWorldChainWithFallback } from "@/lib/chain";
import { db } from "@/lib/db";
import { formatUnits, isAddress, type Address } from "viem";

const WLD_ADDRESS = "0x2cFc85d8E48F8EAB294be644d9E25C3030863003" as Address;
const WLD_DECIMALS = 18;
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
  const wldBalances = await mapWithConcurrency(merged, 6, async (user) => getWldBalance(user.address));
  const enriched = await Promise.all(merged.map(async (user, index) => {
    const [adjustments, adjustmentTotal] = await Promise.all([
      getPointsAdjustments(user.address),
      getPointsAdjustmentTotal(user.address),
    ]);
    return {
      ...user,
      createdAt: user.createdAt.toISOString(),
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      luminaNo: index + 1,
      wldBalance: wldBalances[index],
      pointsAdjustmentTotal: adjustmentTotal,
      pointsAdjustments: adjustments.slice(0, 12),
    };
  }));
  return jsonResponse(enriched);
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
