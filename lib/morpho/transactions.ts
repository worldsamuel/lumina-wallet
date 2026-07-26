import { encodeFunctionData, type Address, type Hex } from "viem";
import type { MorphoVault } from "./vaults";

export const EARN_WITHDRAW_FEE_BPS = 1_000;
export const EARN_WITHDRAW_FEE_RECIPIENT =
  "0x600a84949f0f0023adf6ed89cccd2b2ceccf1077" as Address;

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

export function calculateEarnWithdrawalFeeAmounts(grossAmount: bigint) {
  const feeAmount = (grossAmount * BigInt(EARN_WITHDRAW_FEE_BPS)) / 10_000n;
  return {
    feeAmount,
    netAmount: grossAmount - feeAmount,
  };
}

export function buildWithdrawTxs(vault: MorphoVault, amount: bigint, userAddress: Address) {
  const { feeAmount, netAmount } = calculateEarnWithdrawalFeeAmounts(amount);
  if (feeAmount <= 0n || netAmount <= 0n) throw new Error("Withdrawal amount is too small.");

  return [
    {
      to: vault.address,
      data: encodeFunctionData({
        abi: withdrawAbi,
        functionName: "withdraw",
        args: [netAmount, userAddress, userAddress],
      }),
    },
    {
      to: vault.address,
      data: encodeFunctionData({
        abi: withdrawAbi,
        functionName: "withdraw",
        args: [feeAmount, EARN_WITHDRAW_FEE_RECIPIENT, userAddress],
      }),
    },
  ];
}

export function buildRedeemTxs(vault: MorphoVault, shares: bigint, userAddress: Address) {
  const { feeAmount: feeShares, netAmount: netShares } = calculateEarnWithdrawalFeeAmounts(shares);
  if (feeShares <= 0n || netShares <= 0n) throw new Error("Redeem share amount is too small.");

  return [
    {
      to: vault.address,
      data: encodeFunctionData({
        abi: redeemAbi,
        functionName: "redeem",
        args: [netShares, userAddress, userAddress],
      }),
    },
    {
      to: vault.address,
      data: encodeFunctionData({
        abi: redeemAbi,
        functionName: "redeem",
        args: [feeShares, EARN_WITHDRAW_FEE_RECIPIENT, userAddress],
      }),
    },
  ];
}
