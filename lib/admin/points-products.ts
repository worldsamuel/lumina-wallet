import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

const POINTS_PRODUCTS_KEY = "points_products";

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
  return (rows.length ? rows : defaultProducts()).sort((a, b) => a.sortOrder - b.sortOrder);
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

export async function getPointsProducts() {
  return readStoredProducts();
}

export async function getPublicPointsProducts() {
  return (await readStoredProducts()).filter((product) => product.enabled);
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
