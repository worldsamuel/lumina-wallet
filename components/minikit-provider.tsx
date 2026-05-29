"use client";

import { MiniKitProvider as WorldMiniKitProvider } from "@worldcoin/minikit-js/minikit-provider";
import type { ReactNode } from "react";

export default function MiniKitProvider({ children }: { children: ReactNode }) {
  return (
    <WorldMiniKitProvider props={{ appId: process.env.NEXT_PUBLIC_WORLD_APP_ID }}>
      {children}
    </WorldMiniKitProvider>
  );
}
