export type WalletAuthPayload = {
  address: string;
  message: string;
  signature: string;
  version?: number;
};
