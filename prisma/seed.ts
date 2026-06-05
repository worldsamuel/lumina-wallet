import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { defaultCurrencies } from "../lib/money-data";

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});
const prisma = new PrismaClient({ adapter });

async function main() {
  await Promise.all([
    prisma.token.upsert({
      where: { symbol: "WLD" },
      update: { name: "Worldcoin", status: "verified", onTopRanking: true },
      create: {
        symbol: "WLD",
        name: "Worldcoin",
        decimals: 18,
        status: "verified",
        onTopRanking: true,
      },
    }),
    prisma.token.upsert({
      where: { symbol: "USDC" },
      update: { name: "USD Coin", status: "verified", onTopRanking: false },
      create: {
        symbol: "USDC",
        name: "USD Coin",
        contractAddr: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1",
        decimals: 6,
        status: "verified",
      },
    }),
    prisma.token.upsert({
      where: { symbol: "ETH" },
      update: { name: "Ethereum", status: "verified", onTopRanking: false },
      create: {
        symbol: "ETH",
        name: "Ethereum",
        decimals: 18,
        status: "verified",
      },
    }),
  ]);

  await Promise.all(
    defaultCurrencies.map((currency) =>
      prisma.currencyRate.upsert({
        where: { code: currency.code },
        update: { name: currency.name, symbol: currency.symbol, rate: String(currency.rate) },
        create: {
          code: currency.code,
          name: currency.name,
          symbol: currency.symbol,
          rate: String(currency.rate),
        },
      }),
    ),
  );

  await Promise.all([
    prisma.feeConfig.upsert({
      where: { businessType: "swap" },
      update: { percent: "0.0040" },
      create: { businessType: "swap", percent: "0.0040" },
    }),
    prisma.feeConfig.upsert({
      where: { businessType: "send" },
      update: { percent: "0.0000" },
      create: { businessType: "send", percent: "0.0000" },
    }),
    prisma.feeConfig.upsert({
      where: { businessType: "earn" },
      update: { percent: "0.0040" },
      create: { businessType: "earn", percent: "0.0040" },
    }),
  ]);

  await Promise.all([
    prisma.contentPage.upsert({
      where: { key: "help" },
      update: {
        bodyI18n: {
          en: "Lumina Help Center\n\nUse Lumina inside World App to connect your verified wallet. Token balances and on-chain actions will be connected in later phases.",
          "zh-CN":
            "Lumina 帮助中心\n\n请在 World App 内打开 Lumina 并连接你的验证钱包。代币余额和链上操作会在后续阶段接入。",
        },
      },
      create: {
        key: "help",
        bodyI18n: {
          en: "Lumina Help Center\n\nUse Lumina inside World App to connect your verified wallet. Token balances and on-chain actions will be connected in later phases.",
          "zh-CN":
            "Lumina 帮助中心\n\n请在 World App 内打开 Lumina 并连接你的验证钱包。代币余额和链上操作会在后续阶段接入。",
        },
      },
    }),
    prisma.contentPage.upsert({
      where: { key: "about" },
      update: {
        bodyI18n: {
          en: "About Lumina\n\nLumina is a World Mini App wallet interface for asset viewing, swap discovery, announcements, and admin-managed configuration.",
          "zh-CN":
            "关于 Lumina\n\nLumina 是面向 World Mini App 的钱包界面，支持资产展示、兑换发现、公告和后台配置。",
        },
      },
      create: {
        key: "about",
        bodyI18n: {
          en: "About Lumina\n\nLumina is a World Mini App wallet interface for asset viewing, swap discovery, announcements, and admin-managed configuration.",
          "zh-CN":
            "关于 Lumina\n\nLumina 是面向 World Mini App 的钱包界面，支持资产展示、兑换发现、公告和后台配置。",
        },
      },
    }),
  ]);

  await prisma.announcement.upsert({
    where: { id: 1 },
    update: {
      tag: "notice",
      titleI18n: { en: "Welcome to Lumina", "zh-CN": "欢迎使用 Lumina" },
      bodyI18n: {
        en: "Announcements are now powered by the backend database.",
        "zh-CN": "公告现在已由后端数据库驱动。",
      },
    },
    create: {
      tag: "notice",
      titleI18n: { en: "Welcome to Lumina", "zh-CN": "欢迎使用 Lumina" },
      bodyI18n: {
        en: "Announcements are now powered by the backend database.",
        "zh-CN": "公告现在已由后端数据库驱动。",
      },
    },
  });

  const adminPassword = process.env.ADMIN_INITIAL_PASSWORD;
  if (!adminPassword) {
    console.warn("ADMIN_INITIAL_PASSWORD is not set; skipping default admin creation.");
    return;
  }

  const passwordHash = await bcrypt.hash(adminPassword, 12);
  await prisma.adminUser.upsert({
    where: { username: "admin" },
    update: { passwordHash },
    create: {
      username: "admin",
      passwordHash,
      role: "super_admin",
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
