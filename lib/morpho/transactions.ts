import type { Address } from "viem";
import type { MorphoVault } from "./vaults";

const approveAbi = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const transferAbi = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

const depositAbi = [
  {
    name: "deposit",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
] as const;

const withdrawAbi = [
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "assets", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "shares", type: "uint256" }],
  },
] as const;

const redeemAbi = [
  {
    name: "redeem",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "shares", type: "uint256" },
      { name: "receiver", type: "address" },
      { name: "owner", type: "address" },
    ],
    outputs: [{ name: "assets", type: "uint256" }],
  },
] as const;

export type MiniKitTransaction = {
  address: Address;
  abi: readonly unknown[];
  functionName: string;
  args: string[];
  value?: string;
};

export type MiniKitPermit2 = {
  permitted: {
    token: Address;
    amount: string;
  };
  spender: Address;
  nonce: string;
  deadline: string;
};

export type MorphoDepositTx = {
  transactions: MiniKitTransaction[];
  permit2: MiniKitPermit2[];
};

export function buildDepositTx(vault: MorphoVault, amount: bigint, userAddress: Address): MorphoDepositTx {
  return {
    transactions: [
      {
        address: "0x79A02482A880bCE3F13e09Da970dC34db4CD24d1" as Address,
        abi: transferAbi,
        functionName: "transfer",
        args: [userAddress, "1000"],
      },
    ],
    permit2: [],
  };
}

export function buildWithdrawTx(vault: MorphoVault, amount: bigint, userAddress: Address) {
  return {
    address: vault.address,
    abi: withdrawAbi,
    functionName: "withdraw",
    args: [amount.toString(), userAddress, userAddress],
  };
}

export function buildRedeemTx(vault: MorphoVault, shares: bigint, userAddress: Address) {
  return {
    address: vault.address,
    abi: redeemAbi,
    functionName: "redeem",
    args: [shares.toString(), userAddress, userAddress],
  };
}
