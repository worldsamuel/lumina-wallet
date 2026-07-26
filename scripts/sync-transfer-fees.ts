import { db } from "../lib/db";

const TREASURY = "0x600a84949f0f0023adf6ed89cccd2b2ceccf1077";

async function main() {
  const fees = [
    { businessType: "send", percent: "0.1" },
    { businessType: "swap", percent: "0.005" },
    { businessType: "earn", percent: "0.1" },
  ];

  for (const fee of fees) {
    await db.feeConfig.upsert({
      where: { businessType: fee.businessType },
      update: {
        percent: fee.percent,
        recipient: TREASURY,
      },
      create: {
        businessType: fee.businessType,
        percent: fee.percent,
        recipient: TREASURY,
      },
    });
  }

  const savedFees = await db.feeConfig.findMany({
    where: { businessType: { in: fees.map((fee) => fee.businessType) } },
    orderBy: { businessType: "asc" },
  });
  console.log(JSON.stringify(savedFees));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
