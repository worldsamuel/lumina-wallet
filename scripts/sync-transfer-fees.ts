import { db } from "../lib/db";

const TREASURY = "0x600a84949f0f0023adf6ed89cccd2b2ceccf1077";

async function main() {
  for (const businessType of ["send", "swap"]) {
    await db.feeConfig.upsert({
      where: { businessType },
      update: {
        percent: "0.1",
        recipient: TREASURY,
      },
      create: {
        businessType,
        percent: "0.1",
        recipient: TREASURY,
      },
    });
  }

  const fees = await db.feeConfig.findMany({
    where: { businessType: { in: ["send", "swap"] } },
    orderBy: { businessType: "asc" },
  });
  console.log(JSON.stringify(fees));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
