import { NextRequest, NextResponse } from "next/server";
import { formatUnits, isAddress, type Address } from "viem";
import { publicClient } from "@/lib/chain";
import { TOKENS } from "@/lib/tokens";

const erc20MetadataAbi = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const verifiedAddresses = new Set(
  TOKENS.map((token) => token.contractAddress?.toLowerCase()).filter(Boolean),
);

/**
 * Reads live ERC-20 metadata and the current wallet balance for an imported World Chain token.
 */
export async function GET(request: NextRequest) {
  const address = request.nextUrl.searchParams.get("address");
  const owner = request.nextUrl.searchParams.get("owner");

  if (!address || !isAddress(address)) {
    return NextResponse.json({ error: "Invalid token contract address." }, { status: 400 });
  }
  if (owner && !isAddress(owner)) {
    return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 });
  }

  try {
    const contractAddress = address as Address;
    const [bytecode, symbolResult, nameResult, decimalsResult, balanceResult] = await Promise.all([
      publicClient.getBytecode({ address: contractAddress }),
      publicClient.readContract({
        address: contractAddress,
        abi: erc20MetadataAbi,
        functionName: "symbol",
      }),
      publicClient.readContract({
        address: contractAddress,
        abi: erc20MetadataAbi,
        functionName: "name",
      }),
      publicClient.readContract({
        address: contractAddress,
        abi: erc20MetadataAbi,
        functionName: "decimals",
      }),
      owner
        ? publicClient.readContract({
            address: contractAddress,
            abi: erc20MetadataAbi,
            functionName: "balanceOf",
            args: [owner as Address],
          })
        : Promise.resolve(0n),
    ]);

    const symbol = cleanTokenText(symbolResult, "TOKEN").slice(0, 16);
    const name = cleanTokenText(nameResult, symbol).slice(0, 60);
    const decimals = Number(decimalsResult);
    const balance = typeof balanceResult === "bigint" ? balanceResult : 0n;
    const verified = verifiedAddresses.has(contractAddress.toLowerCase());
    const risk = scoreTokenRisk({
      address: contractAddress,
      bytecode: bytecode ?? "0x",
      name,
      symbol,
      verified,
    });

    return NextResponse.json({
      address: contractAddress,
      balance: balance.toString(),
      decimals,
      formatted: formatUnits(balance, decimals),
      name,
      risk,
      symbol,
      verified,
    });
  } catch (error) {
    console.error("Failed to read imported token metadata", error);
    return NextResponse.json(
      { error: "Unable to read this ERC-20 token on World Chain." },
      { status: 502 },
    );
  }
}

function cleanTokenText(value: unknown, fallback: string) {
  if (typeof value !== "string") return fallback;
  const clean = value.replace(/\0/g, "").trim();
  return clean || fallback;
}

function scoreTokenRisk({
  address,
  bytecode,
  name,
  symbol,
  verified,
}: {
  address: Address;
  bytecode: string;
  name: string;
  symbol: string;
  verified: boolean;
}) {
  if (verified) {
    return {
      score: "low",
      checks: [
        { key: "Token list", value: "Verified by Lumina", level: "pass" },
        { key: "Contract", value: "Code exists", level: "pass" },
      ],
    };
  }

  const lowerName = `${name} ${symbol}`.toLowerCase();
  const checks = [
    {
      key: "Token list",
      value: "Not verified",
      level: "warn",
    },
    {
      key: "Contract",
      value: bytecode === "0x" ? "No contract code" : "Code exists",
      level: bytecode === "0x" ? "danger" : "pass",
    },
    {
      key: "Impersonation",
      value: /(worldcoin|wld|usd coin|usdc|ether|ethereum)/i.test(lowerName)
        ? "Similar to a known token"
        : "No obvious name match",
      level: /(worldcoin|wld|usd coin|usdc|ether|ethereum)/i.test(lowerName) ? "danger" : "pass",
    },
    {
      key: "Manual review",
      value: "Required before swap/send",
      level: "warn",
    },
  ];
  const hasDanger = checks.some((check) => check.level === "danger");

  return {
    score: hasDanger ? "high" : "mid",
    checks,
    address,
  };
}
