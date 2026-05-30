import { encodeFunctionData, maxUint256, zeroHash, type Address, type Hex } from "viem";
import {
  BUNDLER3_ABI,
  GENERAL_ADAPTER1_ABI,
  METAMORPHO_ABI,
} from "./abi";
import { MORPHO_BUNDLER3_ADDRESS, MORPHO_GENERAL_ADAPTER1_ADDRESS } from "./contracts";
import type { MorphoVault } from "./vaults";

export type MiniKitTransaction = {
  to: Address;
  data: Hex;
  value: "0x0";
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

function tx(to: Address, data: Hex): MiniKitTransaction {
  return {
    to,
    data,
    value: "0x0",
  };
}

function permit2Nonce() {
  const random = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));
  return ((BigInt(Date.now()) << 64n) + random).toString();
}

function permit2Deadline() {
  return (Math.floor(Date.now() / 1000) + 30 * 60).toString();
}

export function buildDepositTx(vault: MorphoVault, amount: bigint, userAddress: Address): MorphoDepositTx {
  const token = vault.asset.address as Address;
  const pullAssetsCall = {
    to: MORPHO_GENERAL_ADAPTER1_ADDRESS,
    data: encodeFunctionData({
      abi: GENERAL_ADAPTER1_ABI,
      functionName: "permit2TransferFrom",
      args: [token, MORPHO_GENERAL_ADAPTER1_ADDRESS, amount],
    }),
    value: 0n,
    skipRevert: false,
    callbackHash: zeroHash,
  } as const;
  const approveVaultCall = {
    to: MORPHO_GENERAL_ADAPTER1_ADDRESS,
    data: encodeFunctionData({
      abi: GENERAL_ADAPTER1_ABI,
      functionName: "erc20Approve",
      args: [token, vault.address, amount],
    }),
    value: 0n,
    skipRevert: false,
    callbackHash: zeroHash,
  } as const;
  const depositCall = {
    to: MORPHO_GENERAL_ADAPTER1_ADDRESS,
    data: encodeFunctionData({
      abi: GENERAL_ADAPTER1_ABI,
      functionName: "erc4626Deposit",
      args: [vault.address, amount, maxUint256, userAddress],
    }),
    value: 0n,
    skipRevert: false,
    callbackHash: zeroHash,
  } as const;
  const bundlerTx = tx(
    MORPHO_BUNDLER3_ADDRESS,
    encodeFunctionData({
      abi: BUNDLER3_ABI,
      functionName: "multicall",
      args: [[pullAssetsCall, approveVaultCall, depositCall]],
    }),
  );

  return {
    transactions: [bundlerTx],
    permit2: [
      {
        permitted: { token, amount: amount.toString() },
        spender: MORPHO_GENERAL_ADAPTER1_ADDRESS,
        nonce: permit2Nonce(),
        deadline: permit2Deadline(),
      },
    ],
  };
}

export function buildWithdrawTx(vault: MorphoVault, amount: bigint, userAddress: Address) {
  return tx(
    vault.address,
    encodeFunctionData({
      abi: METAMORPHO_ABI,
      functionName: "withdraw",
      args: [amount, userAddress, userAddress],
    }),
  );
}

export function buildRedeemTx(vault: MorphoVault, shares: bigint, userAddress: Address) {
  return tx(
    vault.address,
    encodeFunctionData({
      abi: METAMORPHO_ABI,
      functionName: "redeem",
      args: [shares, userAddress, userAddress],
    }),
  );
}
