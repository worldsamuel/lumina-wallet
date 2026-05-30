import { encodeFunctionData, type Address, type Hex } from "viem";
import { ERC20_APPROVE_ABI, METAMORPHO_ABI } from "./abi";
import type { MorphoVault } from "./vaults";

export type MiniKitTransaction = {
  to: Address;
  data: Hex;
  value: "0x0";
};

function tx(to: Address, data: Hex): MiniKitTransaction {
  return {
    to,
    data,
    value: "0x0",
  };
}

export function buildDepositTx(vault: MorphoVault, amount: bigint, userAddress: Address) {
  const approveTx = tx(
    vault.asset.address,
    encodeFunctionData({
      abi: ERC20_APPROVE_ABI,
      functionName: "approve",
      args: [vault.address, amount],
    }),
  );
  const depositTx = tx(
    vault.address,
    encodeFunctionData({
      abi: METAMORPHO_ABI,
      functionName: "deposit",
      args: [amount, userAddress],
    }),
  );
  return [approveTx, depositTx] as const;
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
