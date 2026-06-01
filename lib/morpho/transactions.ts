import { encodeFunctionData, type Address, type Hex } from "viem";
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
  to: Address;
  data: Hex;
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
  const token = vault.asset.address as Address;

  return {
    transactions: [
      {
        to: token,
        data: encodeFunctionData({
          abi: approveAbi,
          functionName: "approve",
          args: [vault.address, amount],
        }),
      },
      {
        to: vault.address,
        data: encodeFunctionData({
          abi: depositAbi,
          functionName: "deposit",
          args: [amount, userAddress],
        }),
      },
    ],
    permit2: [],
  };
}

export function buildWithdrawTx(vault: MorphoVault, amount: bigint, userAddress: Address) {
  return {
    to: vault.address,
    data: encodeFunctionData({
      abi: withdrawAbi,
      functionName: "withdraw",
      args: [amount, userAddress, userAddress],
    }),
  };
}

export function buildRedeemTx(vault: MorphoVault, shares: bigint, userAddress: Address) {
  return {
    to: vault.address,
    data: encodeFunctionData({
      abi: redeemAbi,
      functionName: "redeem",
      args: [shares, userAddress, userAddress],
    }),
  };
}
