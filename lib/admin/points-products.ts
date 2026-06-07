import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const POINTS_PRODUCTS_KEY = "points_products";
const POINTS_ORDERS_KEY = "points_orders";

export type PointsProductConfig = {
  id: string;
  type: "product" | "blind_box";
  title: string;
  category: string;
  points: number;
  originalPoints?: number | null;
  imageUrl?: string | null;
  imageText?: string | null;
  badge?: string | null;
  stock: number;
  enabled: boolean;
  sortOrder: number;
  description?: string | null;
  rewards?: Array<{
    name: string;
    value?: string | null;
    odds: number;
    stock?: number | null;
  }>;
};

export type PointsOrderConfig = {
  id: string;
  address: string;
  productId: string;
  productTitle: string;
  points: number;
  type: "product" | "blind_box";
  status: "purchased" | "opened";
  reward?: {
    name: string;
    value?: string | null;
  } | null;
  createdAt: string;
  openedAt?: string | null;
};

function defaultProducts(): PointsProductConfig[] {
  return [
    {
      id: "cash-surprise-50",
      type: "blind_box",
      title: "Win up to US$50 cash back",
      category: "cash",
      points: 500,
      originalPoints: 17500,
      imageText: "$50",
      badge: "Hot",
      stock: 99,
      enabled: true,
      sortOrder: 1,
      description: "Surprise cash-back reward.",
      rewards: [
        { name: "US$50 cash back", value: "$50", odds: 1, stock: 10 },
        { name: "US$10 cash back", value: "$10", odds: 9, stock: 40 },
        { name: "US$1 cash back", value: "$1", odds: 90, stock: 999 },
      ],
    },
    {
      id: "umy-silver",
      type: "product",
      title: "Upgrade to Umy Silver membership",
      category: "shop",
      points: 9,
      imageText: "umy",
      badge: null,
      stock: 200,
      enabled: true,
      sortOrder: 2,
      description: "Membership coupon.",
    },
    {
      id: "cashback-50",
      type: "product",
      title: "$50 cash back",
      category: "cash",
      points: 17500,
      imageText: "$50",
      stock: 50,
      enabled: true,
      sortOrder: 3,
      description: "Redeem points for cash back.",
    },
    {
      id: "wine-discount",
      type: "product",
      title: "Vintage Fine Wines order discount",
      category: "dining",
      points: 9,
      imageText: "Vintage Fine Wines",
      stock: 120,
      enabled: true,
      sortOrder: 4,
      description: "Single-order discount coupon.",
    },
  ];
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || `reward-${Date.now()}`;
}

function normalizeProduct(input: Partial<PointsProductConfig>, index: number): PointsProductConfig {
  const title = String(input.title || "Lumina Reward").trim();
  const rewards = Array.isArray(input.rewards)
    ? input.rewards
        .filter((reward) => reward && typeof reward === "object" && String(reward.name || "").trim())
        .map((reward) => ({
          name: String(reward.name || "").trim(),
          value: typeof reward.value === "string" && reward.value.trim() ? reward.value.trim() : null,
          odds: Math.max(0, Number(reward.odds || 0)),
          stock: reward.stock == null ? null : Math.max(0, Math.floor(Number(reward.stock))),
        }))
    : [];
  return {
    id: String(input.id || slugify(title)).trim(),
    type: input.type === "blind_box" ? "blind_box" : "product",
    title,
    category: String(input.category || "shop").trim().toLowerCase(),
    points: Math.max(0, Math.floor(Number(input.points ?? 0))),
    originalPoints: input.originalPoints == null || input.originalPoints === 0 ? null : Math.max(0, Math.floor(Number(input.originalPoints))),
    imageUrl: typeof input.imageUrl === "string" && input.imageUrl.trim() ? input.imageUrl.trim() : null,
    imageText: typeof input.imageText === "string" && input.imageText.trim() ? input.imageText.trim() : null,
    badge: typeof input.badge === "string" && input.badge.trim() ? input.badge.trim() : null,
    stock: Math.max(0, Math.floor(Number(input.stock ?? 0))),
    enabled: input.enabled !== false,
    sortOrder: Number(input.sortOrder ?? index + 1),
    description: typeof input.description === "string" && input.description.trim() ? input.description.trim() : null,
    rewards,
  };
}

function parseProducts(value: unknown): PointsProductConfig[] {
  if (!Array.isArray(value)) return defaultProducts();
  const rows = value
    .filter((item): item is Partial<PointsProductConfig> => !!item && typeof item === "object")
    .map(normalizeProduct)
    .filter((item) => item.id);
  return rows.sort((a, b) => a.sortOrder - b.sortOrder);
}

async function readStoredProducts() {
  const page = await db.contentPage.findUnique({ where: { key: POINTS_PRODUCTS_KEY } });
  return parseProducts(page?.bodyI18n);
}

async function writeStoredProducts(products: PointsProductConfig[]) {
  const sorted = products.sort((a, b) => a.sortOrder - b.sortOrder);
  await db.contentPage.upsert({
    where: { key: POINTS_PRODUCTS_KEY },
    update: { bodyI18n: sorted as unknown as Prisma.InputJsonValue },
    create: { key: POINTS_PRODUCTS_KEY, bodyI18n: sorted as unknown as Prisma.InputJsonValue },
  });
  return sorted;
}

function parseOrders(value: unknown): PointsOrderConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Partial<PointsOrderConfig> => !!item && typeof item === "object")
    .map((item): PointsOrderConfig => {
      const type: PointsOrderConfig["type"] = item.type === "blind_box" ? "blind_box" : "product";
      const status: PointsOrderConfig["status"] = item.status === "opened" ? "opened" : "purchased";
      return {
        id: String(item.id || `order-${Date.now()}`),
        address: String(item.address || "").toLowerCase(),
        productId: String(item.productId || ""),
        productTitle: String(item.productTitle || "Lumina Reward"),
        points: Math.max(0, Math.floor(Number(item.points || 0))),
        type,
        status,
        reward: item.reward && typeof item.reward === "object" ? {
          name: String(item.reward.name || "Lumina reward"),
          value: typeof item.reward.value === "string" ? item.reward.value : null,
        } : null,
        createdAt: String(item.createdAt || new Date().toISOString()),
        openedAt: item.openedAt ? String(item.openedAt) : null,
      };
    })
    .filter((item) => item.address && item.productId);
}

async function readStoredOrders() {
  const page = await db.contentPage.findUnique({ where: { key: POINTS_ORDERS_KEY } });
  return parseOrders(page?.bodyI18n);
}

async function writeStoredOrders(orders: PointsOrderConfig[]) {
  const trimmed = orders.slice(0, 500);
  await db.contentPage.upsert({
    where: { key: POINTS_ORDERS_KEY },
    update: { bodyI18n: trimmed as unknown as Prisma.InputJsonValue },
    create: { key: POINTS_ORDERS_KEY, bodyI18n: trimmed as unknown as Prisma.InputJsonValue },
  });
  return trimmed;
}

export async function getPointsProducts() {
  return readStoredProducts();
}

export async function getPublicPointsProducts() {
  return (await readStoredProducts()).filter((product) => product.enabled);
}

export async function getPointsOrders(address: string) {
  const normalized = address.toLowerCase();
  return (await readStoredOrders()).filter((order) => order.address === normalized);
}

function pickBlindReward(product: PointsProductConfig) {
  const rewards = Array.isArray(product.rewards) && product.rewards.length ? product.rewards : [{ name: "Lumina reward", value: null, odds: 1 }];
  const total = rewards.reduce((sum, item) => sum + Math.max(0, Number(item.odds || 0)), 0) || rewards.length;
  let pick = Math.random() * total;
  let won = rewards[0];
  for (const reward of rewards) {
    pick -= Math.max(0, Number(reward.odds || 0)) || 1;
    if (pick <= 0) {
      won = reward;
      break;
    }
  }
  return { name: won.name || "Lumina reward", value: won.value ?? null };
}

export async function purchasePointsProduct(input: { address: string; productId: string; availablePoints: number }) {
  const address = input.address.toLowerCase();
  const product = (await getPublicPointsProducts()).find((item) => item.id === input.productId);
  if (!product) throw new Error("Product unavailable.");
  if (product.stock <= 0) throw new Error("Product sold out.");
  if (Math.floor(Number(input.availablePoints || 0)) < product.points) throw new Error("Not enough Lumina Points.");
  const order: PointsOrderConfig = {
    id: `order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    address,
    productId: product.id,
    productTitle: product.title,
    points: product.points,
    type: product.type,
    status: "purchased",
    reward: product.type === "product" ? { name: product.title, value: product.imageText ?? null } : null,
    createdAt: new Date().toISOString(),
    openedAt: null,
  };
  const orders = await readStoredOrders();
  orders.unshift(order);
  await writeStoredOrders(orders);
  return { order, product };
}

export async function openBlindBoxOrder(input: { address: string; productId: string }) {
  const address = input.address.toLowerCase();
  const product = (await getPublicPointsProducts()).find((item) => item.id === input.productId);
  if (!product || product.type !== "blind_box") throw new Error("Mystery box unavailable.");
  const orders = await readStoredOrders();
  const index = orders.findIndex((order) => order.address === address && order.productId === product.id && order.type === "blind_box" && order.status === "purchased");
  if (index < 0) throw new Error("Please buy this mystery box first.");
  const reward = pickBlindReward(product);
  orders[index] = { ...orders[index], status: "opened", reward, openedAt: new Date().toISOString() };
  await writeStoredOrders(orders);
  return { order: orders[index], reward, product };
}

export async function upsertPointsProduct(input: Partial<PointsProductConfig>) {
  const products = await readStoredProducts();
  const id = String(input.id || slugify(input.title || "")).trim();
  const index = products.findIndex((item) => item.id === id);
  const existing = index >= 0 ? products[index] : null;
  const next = normalizeProduct({ ...existing, ...input, id }, products.length);
  if (index >= 0) products[index] = next;
  else products.push(next);
  return writeStoredProducts(products);
}

export async function deletePointsProduct(id: string) {
  const products = await readStoredProducts();
  return writeStoredProducts(products.filter((item) => item.id !== id));
}
