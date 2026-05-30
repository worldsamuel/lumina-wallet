import { formatUnits, type Address } from "viem";
import { publicClient } from "./chain";
import { ERC20_TOKENS, TOKENS, type TokenConfig } from "./tokens";

const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export type ChainBalance = {
  symbol: string;
  name: string;
  balance: bigint;
  decimals: number;
  formatted: string;
  logo: string;
  className: string;
  native: boolean;
  contractAddress?: Address;
  usdValue: string;
};

function toBalance(token: TokenConfig, balance: bigint): ChainBalance {
  const formatted = formatUnits(balance, token.decimals);

  return {
    symbol: token.symbol,
    name: token.name,
    balance,
    decimals: token.decimals,
    formatted,
    logo: token.logo,
    className: token.className,
    native: Boolean(token.native),
    contractAddress: token.contractAddress,
    usdValue: "",
  };
}

/**
 * Reads native ETH and configured ERC-20 balances from World Chain.
 */
export async function fetchBalances(userAddress: Address) {
  const ethToken = TOKENS.find((token) => token.native);
  const [nativeBalance, erc20Results] = await Promise.all([
    publicClient.getBalance({ address: userAddress }),
    publicClient.multicall({
      allowFailure: true,
      contracts: ERC20_TOKENS.map((token) => ({
        address: token.contractAddress,
        abi: erc20BalanceAbi,
        functionName: "balanceOf",
        args: [userAddress],
      })),
    }),
  ]);

  const erc20Balances = ERC20_TOKENS.map((token, index) => {
    const result = erc20Results[index];
    return toBalance(token, result?.status === "success" ? result.result : 0n);
  });

  return [
    ...erc20Balances,
    ...(ethToken ? [toBalance(ethToken, nativeBalance)] : []),
  ];
}
