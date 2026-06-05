import { ethers } from "ethers";
import { Client, Multicall3 } from "@holdstation/worldchain-ethers-v5";
import {
  config,
  HoldSo,
  inmemoryTokenStorage,
  setPartnerCode,
  SwapHelper,
  TokenProvider,
  ZeroX,
  type SwapParams,
} from "@holdstation/worldchain-sdk";
import { getSwapPlatformFeeConfig } from "./platform-fee";

export const HOLDSTATION_TARGET_ADDRESS = "0x43222f934ea5c593a060a6d46772fdbdc2e2cff0";
export const HOLDSTATION_ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

const RPC_URL = "https://worldchain-mainnet.g.alchemy.com/public";

const provider = new ethers.providers.StaticJsonRpcProvider(RPC_URL, {
  chainId: 480,
  name: "worldchain",
});

export const hsClient = new Client(provider);
setPartnerCode("1");
config.client = hsClient;
config.multicall3 = new Multicall3(provider);

export const hsTokenProvider = new TokenProvider({
  client: hsClient,
  multicall3: config.multicall3,
  storage: inmemoryTokenStorage,
});

export const hsSwapHelper = new SwapHelper(hsClient, {
  tokenStorage: inmemoryTokenStorage,
});

let modulesLoaded: Promise<void> | null = null;

export function holdstationFeePercent() {
  const fee = getSwapPlatformFeeConfig();
  return fee ? String(fee.bps / 100) : "0";
}

export function holdstationFeeReceiver() {
  return getSwapPlatformFeeConfig()?.recipient ?? HOLDSTATION_ZERO_ADDRESS;
}

export function slippageBpsToPercent(slippageBps: number) {
  return String(slippageBps / 100);
}

export async function ensureHoldstationModules() {
  if (!modulesLoaded) {
    modulesLoaded = Promise.all([
      hsSwapHelper.load(new HoldSo(hsTokenProvider, inmemoryTokenStorage)),
      hsSwapHelper.load(new ZeroX(hsTokenProvider, inmemoryTokenStorage)),
    ]).then(() => undefined);
  }
  return modulesLoaded;
}

export async function quoteHoldstation(input: SwapParams["quoteInput"]) {
  await ensureHoldstationModules();
  return hsSwapHelper.estimate.quote({
    preferRouters: ["0x", "hold-so"],
    timeout: 12_000,
    ...input,
  });
}
