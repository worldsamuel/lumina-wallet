import { AllowanceTransfer, type PermitSingle } from "@uniswap/permit2-sdk";
import { MiniKit } from "@worldcoin/minikit-js";
import { isAddress, type Address } from "viem";
import { publicClient } from "@/lib/chain";
import { PERMIT2_ADDRESS, UNIVERSAL_ROUTER_ADDRESS, WORLD_CHAIN_ID, permit2Abi } from "./contracts";

export type SignedPermit2 = {
  permit: PermitSingle;
  signature: `0x${string}`;
};

type SignPermit2Params = {
  token: Address;
  amount: bigint;
  spender?: Address;
  userAddress: Address;
  chainId?: number;
  deadline?: number;
};

export async function getPermit2Nonce(token: Address, userAddress: Address, spender = UNIVERSAL_ROUTER_ADDRESS) {
  const [, , nonce] = await publicClient.readContract({
    address: PERMIT2_ADDRESS,
    abi: permit2Abi,
    functionName: "allowance",
    args: [userAddress, token, spender],
  });
  return nonce;
}

export async function signPermit2({
  token,
  amount,
  spender = UNIVERSAL_ROUTER_ADDRESS,
  userAddress,
  chainId = WORLD_CHAIN_ID,
  deadline = Math.floor(Date.now() / 1000) + 30 * 60,
}: SignPermit2Params): Promise<SignedPermit2> {
  if (!isAddress(token) || !isAddress(userAddress) || !isAddress(spender)) {
    throw new Error("Invalid Permit2 address parameter.");
  }
  if (amount <= 0n) throw new Error("Permit2 amount must be greater than 0.");

  const nonce = await getPermit2Nonce(token, userAddress, spender);
  const permit: PermitSingle = {
    details: {
      token,
      amount: amount.toString(),
      expiration: deadline,
      nonce: nonce.toString(),
    },
    spender,
    sigDeadline: deadline,
  };

const { domain, types, values } = AllowanceTransfer.getPermitData(permit, PERMIT2_ADDRESS, chainId);
  const result = (await withTimeout(
    MiniKit.signTypedData({
      domain: domain as never,
      types: types as never,
      primaryType: "PermitSingle",
      message: values as never,
    }),
    60_000,
    "Permit2 signature timed out. Please try again.",
  )) as { data?: { signature?: string; error_code?: string; message?: string } };

  const signature = result.data?.signature;
  if (!signature) {
    throw new Error(result.data?.error_code || result.data?.message || "Permit2 signature was not returned.");
  }

  return { permit, signature: signature as `0x${string}` };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}
