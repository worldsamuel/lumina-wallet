import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { calculateRulePoints, getSystemConfig, type PointsRuleKind } from "@/lib/admin/system-config";

const POINTS_PRODUCTS_KEY = "points_products";
const POINTS_PRODUCTS_PUBLIC_KEY = "points_products_public";
const POINTS_ORDERS_KEY = "points_orders";
const POINTS_ADJUSTMENTS_KEY = "points_adjustments";
const PUBLIC_PRODUCTS_CACHE_MS = 30_000;

let publicProductsCache: { expiresAt: number; rows: PointsProductConfig[] } | null = null;

export type PointsProductConfig = {
  id: string;
  type: "product" | "blind_box";
  title: string;
  titleI18n?: Record<string, string>;
  category: string;
  points: number;
  originalPoints?: number | null;
  imageUrl?: string | null;
  detailImageUrl?: string | null;
  iconUrl?: string | null;
  imageText?: string | null;
  badge?: string | null;
  countries?: string[];
  stock: number;
  purchaseLimit?: number | null;
  enabled: boolean;
  sortOrder: number;
  description?: string | null;
  descriptionI18n?: Record<string, string>;
  rewards?: Array<{
    id?: string | null;
    name: string;
    nameI18n?: Record<string, string>;
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
  note?: string | null;
  createdBy?: string | null;
  createdAt: string;
  openedAt?: string | null;
  redeemed?: boolean;
  redeemedAt?: string | null;
  redeemedBy?: string | null;
};

export type PointsAdjustmentConfig = {
  id: string;
  address: string;
  points: number;
  note?: string | null;
  createdAt: string;
  createdBy?: string | null;
};

function defaultProducts(): PointsProductConfig[] {
  return [
    {
      id: "open-your-new-user-mystery-box",
      type: "blind_box",
      title: "WLD Mystery Box",
      titleI18n: { en: "WLD Mystery Box", "zh-CN": "WLD 盲盒", "zh-TW": "WLD 盲盒" },
      category: "shop",
      points: 150,
      originalPoints: 1000,
      iconUrl: "/points/lumina-points-icon.png",
      imageText: null,
      badge: "Hot",
      countries: ["global"],
      stock: 0,
      purchaseLimit: null,
      enabled: true,
      sortOrder: 5,
      description: "Open your Lumina mystery box to reveal a WLD reward.",
      descriptionI18n: { en: "Open your Lumina mystery box to reveal a WLD reward.", "zh-CN": "打开 Lumina 盲盒，领取随机 WLD 奖励。", "zh-TW": "打開 Lumina 盲盒，領取隨機 WLD 獎勵。" },
      rewards: [
        { id: "1", name: "0.01 WLD", value: "0.01 WLD", odds: 9000, stock: null },
        { id: "2", name: "0.1 WLD", value: "0.1 WLD", odds: 900, stock: null },
        { id: "3", name: "1 WLD", value: "1 WLD", odds: 100, stock: null },
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
      countries: ["global"],
      stock: 200,
      purchaseLimit: null,
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
      countries: ["global"],
      stock: 50,
      purchaseLimit: null,
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
      countries: ["global"],
      stock: 120,
      purchaseLimit: null,
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

function cleanI18n(value: unknown, fallback: string) {
  const source = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  const out: Record<string, string> = {};
  Object.entries(source).forEach(([key, text]) => {
    const lang = String(key || "").trim();
    const cleaned = typeof text === "string" ? text.trim() : "";
    if (lang && cleaned) out[lang] = cleaned.slice(0, 240);
  });
  if (!out.en) out.en = fallback;
  return out;
}

function normalizeProduct(input: Partial<PointsProductConfig>, index: number): PointsProductConfig {
  const title = String(input.title || input.titleI18n?.en || "Lumina Reward").trim();
  const description = typeof input.description === "string" && input.description.trim() ? input.description.trim() : null;
  const rewards = Array.isArray(input.rewards)
    ? input.rewards
        .filter((reward) => reward && typeof reward === "object" && String(reward.name || "").trim())
        .map((reward) => ({
          id: typeof reward.id === "string" && reward.id.trim() ? reward.id.trim().slice(0, 32) : null,
          name: String(reward.name || "").trim(),
          nameI18n: cleanI18n(reward.nameI18n, String(reward.name || "Reward").trim()),
          value: typeof reward.value === "string" && reward.value.trim() ? reward.value.trim() : null,
          odds: Math.max(0, Number(reward.odds || 0)),
          stock: reward.stock == null ? null : Math.max(0, Math.floor(Number(reward.stock))),
        }))
    : [];
  return {
    id: String(input.id || slugify(title)).trim(),
    type: input.type === "blind_box" ? "blind_box" : "product",
    title,
    titleI18n: cleanI18n(input.titleI18n, title),
    category: String(input.category || "shop").trim().toLowerCase(),
    points: Math.max(0, Math.floor(Number(input.points ?? 0))),
    originalPoints: input.originalPoints == null || input.originalPoints === 0 ? null : Math.max(0, Math.floor(Number(input.originalPoints))),
    imageUrl: typeof input.imageUrl === "string" && input.imageUrl.trim() ? input.imageUrl.trim() : null,
    detailImageUrl: typeof input.detailImageUrl === "string" && input.detailImageUrl.trim() ? input.detailImageUrl.trim() : null,
    iconUrl: typeof input.iconUrl === "string" && input.iconUrl.trim() ? input.iconUrl.trim() : null,
    imageText: typeof input.imageText === "string" && input.imageText.trim() ? input.imageText.trim() : null,
    badge: typeof input.badge === "string" && input.badge.trim() ? input.badge.trim() : null,
    countries: Array.isArray(input.countries) && input.countries.length
      ? Array.from(new Set(input.countries.map((country) => String(country || "").trim().toLowerCase()).filter(Boolean)))
      : ["global"],
    stock: Math.max(0, Math.floor(Number(input.stock ?? 0))),
    purchaseLimit: input.purchaseLimit == null || Number(input.purchaseLimit) <= 0 ? null : Math.max(1, Math.floor(Number(input.purchaseLimit))),
    enabled: input.enabled !== false,
    sortOrder: Number(input.sortOrder ?? index + 1),
    description,
    descriptionI18n: cleanI18n(input.descriptionI18n, description || ""),
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

function stripProductForPublicStore(product: PointsProductConfig): PointsProductConfig {
  const imageUrl = publicAssetUrl(product.id, "imageUrl", product.imageUrl);
  const detailImageUrl = publicAssetUrl(product.id, "detailImageUrl", product.detailImageUrl);
  const iconUrl = publicAssetUrl(product.id, "iconUrl", product.iconUrl);
  return {
    ...product,
    imageUrl,
    detailImageUrl,
    iconUrl,
  };
}

async function readStoredProducts() {
  const page = await db.contentPage.findUnique({ where: { key: POINTS_PRODUCTS_KEY } });
  return parseProducts(page?.bodyI18n);
}

async function readStoredPublicProducts() {
  const page = await db.contentPage.findUnique({ where: { key: POINTS_PRODUCTS_PUBLIC_KEY } });
  if (Array.isArray(page?.bodyI18n)) return parseProducts(page.bodyI18n);
  const products = await readStoredProducts();
  await writeStoredPublicProducts(products);
  return products.map(stripProductForPublicStore);
}

async function writeStoredPublicProducts(products: PointsProductConfig[]) {
  const sorted = products.sort((a, b) => a.sortOrder - b.sortOrder).map(stripProductForPublicStore);
  publicProductsCache = null;
  await db.contentPage.upsert({
    where: { key: POINTS_PRODUCTS_PUBLIC_KEY },
    update: { bodyI18n: sorted as unknown as Prisma.InputJsonValue },
    create: { key: POINTS_PRODUCTS_PUBLIC_KEY, bodyI18n: sorted as unknown as Prisma.InputJsonValue },
  });
  return sorted;
}

function publicAssetUrl(productId: string, field: "imageUrl" | "detailImageUrl" | "iconUrl", value?: string | null) {
  const text = String(value || "");
  if (!text.startsWith("data:image/") || text.length < 2048) return value || null;
  return `/api/points-products/image/${encodeURIComponent(productId)}?field=${field}`;
}

function toPublicProduct(product: PointsProductConfig): PointsProductConfig {
  return {
    ...product,
    imageUrl: publicAssetUrl(product.id, "imageUrl", product.imageUrl),
    detailImageUrl: publicAssetUrl(product.id, "detailImageUrl", product.detailImageUrl),
    iconUrl: publicAssetUrl(product.id, "iconUrl", product.iconUrl),
  };
}

async function writeStoredProducts(products: PointsProductConfig[]) {
  const sorted = products.sort((a, b) => a.sortOrder - b.sortOrder);
  publicProductsCache = null;
  await Promise.all([
    db.contentPage.upsert({
      where: { key: POINTS_PRODUCTS_KEY },
      update: { bodyI18n: sorted as unknown as Prisma.InputJsonValue },
      create: { key: POINTS_PRODUCTS_KEY, bodyI18n: sorted as unknown as Prisma.InputJsonValue },
    }),
    writeStoredPublicProducts(sorted),
  ]);
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
        note: typeof item.note === "string" && item.note.trim() ? item.note.trim() : null,
        createdBy: typeof item.createdBy === "string" && item.createdBy.trim() ? item.createdBy.trim() : null,
        createdAt: String(item.createdAt || new Date().toISOString()),
        openedAt: item.openedAt ? String(item.openedAt) : null,
        redeemed: item.redeemed === true,
        redeemedAt: item.redeemedAt ? String(item.redeemedAt) : null,
        redeemedBy: typeof item.redeemedBy === "string" && item.redeemedBy.trim() ? item.redeemedBy.trim() : null,
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

function parseAdjustments(value: unknown): PointsAdjustmentConfig[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Partial<PointsAdjustmentConfig> => !!item && typeof item === "object")
    .map((item): PointsAdjustmentConfig => ({
      id: String(item.id || `points-${Date.now()}`),
      address: String(item.address || "").toLowerCase(),
      points: Math.floor(Number(item.points || 0)),
      note: typeof item.note === "string" && item.note.trim() ? item.note.trim() : null,
      createdAt: String(item.createdAt || new Date().toISOString()),
      createdBy: typeof item.createdBy === "string" && item.createdBy.trim() ? item.createdBy.trim() : null,
    }))
    .filter((item) => item.address && item.points !== 0);
}

async function readStoredAdjustments() {
  const page = await db.contentPage.findUnique({ where: { key: POINTS_ADJUSTMENTS_KEY } });
  return parseAdjustments(page?.bodyI18n);
}

async function writeStoredAdjustments(rows: PointsAdjustmentConfig[]) {
  const trimmed = rows.slice(0, 1000);
  await db.contentPage.upsert({
    where: { key: POINTS_ADJUSTMENTS_KEY },
    update: { bodyI18n: trimmed as unknown as Prisma.InputJsonValue },
    create: { key: POINTS_ADJUSTMENTS_KEY, bodyI18n: trimmed as unknown as Prisma.InputJsonValue },
  });
  return trimmed;
}

export async function getPointsProducts() {
  return readStoredProducts();
}

export async function getPublicPointsProducts() {
  const now = Date.now();
  if (publicProductsCache && publicProductsCache.expiresAt > now) {
    return publicProductsCache.rows;
  }
  const rows = (await readStoredPublicProducts()).filter((product) => product.enabled).map(toPublicProduct);
  publicProductsCache = { expiresAt: now + PUBLIC_PRODUCTS_CACHE_MS, rows };
  return rows;
}

export async function getPointsOrders(address: string) {
  const normalized = address.toLowerCase();
  return (await readStoredOrders()).filter((order) => order.address === normalized);
}

export async function getAllPointsOrders() {
  return readStoredOrders();
}

export async function updatePointsOrderRedemption(input: { id: string; redeemed: boolean; redeemedBy?: string | null }) {
  const id = String(input.id || "").trim();
  if (!id) throw new Error("Invalid order id.");
  const orders = await readStoredOrders();
  const index = orders.findIndex((order) => order.id === id);
  if (index < 0) throw new Error("Order not found.");
  const now = new Date().toISOString();
  orders[index] = {
    ...orders[index],
    redeemed: input.redeemed,
    redeemedAt: input.redeemed ? (orders[index].redeemedAt || now) : null,
    redeemedBy: input.redeemed ? (input.redeemedBy || "admin") : null,
  };
  await writeStoredOrders(orders);
  return orders[index];
}

export async function getPointsAdjustments(address?: string) {
  const rows = await readStoredAdjustments();
  if (!address) return rows;
  const normalized = address.toLowerCase();
  return rows.filter((row) => row.address === normalized);
}

export async function getPointsAdjustmentTotal(address: string) {
  return (await getPointsAdjustments(address)).reduce((sum, row) => sum + Math.floor(Number(row.points || 0)), 0);
}

export async function addPointsAdjustment(input: { address: string; points: number; note?: string | null; createdBy?: string | null }) {
  const address = String(input.address || "").toLowerCase();
  const points = Math.floor(Number(input.points || 0));
  if (!/^0x[a-f0-9]{40}$/.test(address)) throw new Error("Invalid wallet address.");
  if (!points) throw new Error("Points must not be 0.");
  const row: PointsAdjustmentConfig = {
    id: `points-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    address,
    points,
    note: input.note || null,
    createdBy: input.createdBy || null,
    createdAt: new Date().toISOString(),
  };
  const rows = await readStoredAdjustments();
  rows.unshift(row);
  await writeStoredAdjustments(rows);
  return row;
}

export async function awardRulePoints(input: { address: string; kind: PointsRuleKind; note?: string | null; createdBy?: string | null; uniqueKey?: string | null }) {
  const address = String(input.address || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) throw new Error("Invalid wallet address.");
  const existing = await getPointsAdjustments(address);
  if (input.uniqueKey && existing.some((row) => row.createdBy === input.uniqueKey)) {
    return { row: null, points: 0, skipped: true };
  }
  const config = await getSystemConfig();
  const award = calculateRulePoints(input.kind, config);
  if (award.points <= 0) return { row: null, points: 0, skipped: true };
  const suffix = award.reasons.length ? ` (${award.reasons.join(", ")})` : "";
  const row = await addPointsAdjustment({
    address,
    points: award.points,
    note: `${input.note || `${input.kind} points`}${suffix}`,
    createdBy: input.uniqueKey || input.createdBy || `points-rule:${input.kind}`,
  });
  return { row, points: award.points, skipped: false, multiplier: award.multiplier, reasons: award.reasons };
}

export async function awardFixedPoints(input: { address: string; points: number; note: string; uniqueKey: string; createdBy?: string | null }) {
  const address = String(input.address || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) throw new Error("Invalid wallet address.");
  const points = Math.max(0, Math.floor(Number(input.points || 0)));
  if (points <= 0) return { row: null, points: 0, skipped: true };
  const existing = await getPointsAdjustments(address);
  if (existing.some((row) => row.createdBy === input.uniqueKey)) {
    return { row: null, points: 0, skipped: true };
  }
  const row = await addPointsAdjustment({
    address,
    points,
    note: input.note,
    createdBy: input.uniqueKey || input.createdBy || "points-task",
  });
  return { row, points, skipped: false };
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

function normalizeClientOrderId(value?: string | null) {
  const id = String(value || "").trim();
  return /^[a-zA-Z0-9:_-]{8,96}$/.test(id) ? id : null;
}

export async function purchasePointsProduct(input: { address: string; productId: string; availablePoints: number; clientOrderId?: string | null }) {
  const address = input.address.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) throw new Error("Invalid wallet address.");
  const products = await readStoredPublicProducts();
  const productIndex = products.findIndex((item) => item.id === input.productId && item.enabled);
  const product = productIndex >= 0 ? products[productIndex] : null;
  if (!product) throw new Error("Product unavailable.");
  const orders = await readStoredOrders();
  const clientOrderId = normalizeClientOrderId(input.clientOrderId);
  if (clientOrderId) {
    const existing = orders.find((order) => order.id === clientOrderId && order.address === address && order.productId === product.id);
    if (existing) return { order: existing, product: toPublicProduct(product) };
  }
  if (product.stock <= 0) throw new Error("Product sold out.");
  if (Math.floor(Number(input.availablePoints || 0)) < product.points) throw new Error("Not enough Lumina Points.");
  const limit = Math.max(0, Math.floor(Number(product.purchaseLimit || 0)));
  if (limit > 0) {
    const purchased = orders.filter((order) => order.address === address && order.productId === product.id).length;
    if (purchased >= limit) throw new Error("Purchase limit reached.");
  }
  const order: PointsOrderConfig = {
    id: clientOrderId || `order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
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
  let latestOrders = orders;
  if (clientOrderId) {
    latestOrders = await readStoredOrders();
    const latestExisting = latestOrders.find((item) => item.id === clientOrderId && item.address === address && item.productId === product.id);
    if (latestExisting) return { order: latestExisting, product: toPublicProduct(product) };
  }
  latestOrders = [order, ...latestOrders.filter((item) => item.id !== order.id)];
  products[productIndex] = { ...product, stock: Math.max(0, product.stock - 1) };
  await writeStoredOrders(latestOrders);
  publicProductsCache = null;
  writeStoredPublicProducts(products).catch((error) => {
    console.error("[points-products] failed to update product stock after purchase", error);
  });
  return { order, product: toPublicProduct(products[productIndex]) };
}

export async function airdropBlindBox(input: { address: string; productId: string; note?: string | null; createdBy?: string | null }) {
  const address = String(input.address || "").toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(address)) throw new Error("Invalid wallet address.");
  const product = (await readStoredPublicProducts()).find((item) => item.id === input.productId && item.type === "blind_box" && item.enabled);
  if (!product) throw new Error("Blind box unavailable.");
  if (product.stock <= 0) throw new Error("Blind box sold out.");
  const order: PointsOrderConfig = {
    id: `airdrop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    address,
    productId: product.id,
    productTitle: product.title,
    points: 0,
    type: "blind_box",
    status: "purchased",
    reward: null,
    note: input.note || "Airdropped mystery box",
    createdBy: input.createdBy || "admin-airdrop",
    createdAt: new Date().toISOString(),
    openedAt: null,
  };
  const orders = await readStoredOrders();
  orders.unshift(order);
  const products = await readStoredPublicProducts();
  const index = products.findIndex((item) => item.id === product.id);
  if (index >= 0) {
    products[index] = { ...products[index], stock: Math.max(0, products[index].stock - 1) };
  }
  await Promise.all([
    index >= 0 ? writeStoredPublicProducts(products) : Promise.resolve(products),
    writeStoredOrders(orders),
  ]);
  return { order, product: toPublicProduct(product) };
}

export async function openBlindBoxOrder(input: { address: string; productId: string; availablePoints?: number; clientOrderId?: string | null; allowPurchase?: boolean }) {
  const address = input.address.toLowerCase();
  const product = (await readStoredPublicProducts()).find((item) => item.id === input.productId && item.enabled);
  if (!product || product.type !== "blind_box") throw new Error("Mystery box unavailable.");
  let orders = await readStoredOrders();
  let index = orders.findIndex((order) => order.address === address && order.productId === product.id && order.status === "purchased");
  if (index < 0 && input.allowPurchase) {
    const purchased = await purchasePointsProduct({
      address,
      productId: product.id,
      availablePoints: Number(input.availablePoints || 0),
      clientOrderId: input.clientOrderId,
    });
    orders = await readStoredOrders();
    index = orders.findIndex((order) => order.id === purchased.order.id && order.address === address && order.productId === product.id && order.status === "purchased");
    if (index < 0) index = orders.findIndex((order) => order.address === address && order.productId === product.id && order.status === "purchased");
  }
  if (index < 0) throw new Error("Please buy this mystery box first.");
  const reward = pickBlindReward(product);
  orders[index] = { ...orders[index], type: "blind_box", status: "opened", reward, openedAt: new Date().toISOString() };
  await writeStoredOrders(orders);
  return { order: orders[index], reward, product: toPublicProduct(product) };
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
