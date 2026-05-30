"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { getAddress, isAddress } from "viem";

const TRUST_WALLET_CDN = "https://assets-cdn.trustwallet.com";
const LOGO_CACHE_KEY = "lumina_token_logo_cache_v1";
const LOGO_CACHE_TTL_MS = 5 * 24 * 60 * 60 * 1000;

type TokenLogoProps = {
  symbol: string;
  address?: string | null;
  chain?: string;
  size?: number;
};

type CachedLogo = {
  url: string;
  expiresAt: number;
};

function cacheKey(chain: string, address: string) {
  return `${chain}:${address.toLowerCase()}`;
}

function readCache(key: string) {
  if (typeof window === "undefined") return null;
  try {
    const cache = JSON.parse(window.localStorage.getItem(LOGO_CACHE_KEY) || "{}") as Record<string, CachedLogo>;
    const hit = cache[key];
    if (!hit || hit.expiresAt <= Date.now()) return null;
    return hit.url;
  } catch {
    return null;
  }
}

function writeCache(key: string, url: string) {
  if (typeof window === "undefined") return;
  try {
    const cache = JSON.parse(window.localStorage.getItem(LOGO_CACHE_KEY) || "{}") as Record<string, CachedLogo>;
    cache[key] = { url, expiresAt: Date.now() + LOGO_CACHE_TTL_MS };
    window.localStorage.setItem(LOGO_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage can be unavailable in private browsing; the visual fallback still works.
  }
}

function colorFromSymbol(symbol: string) {
  let hash = 0;
  for (const char of symbol) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = hash % 360;
  return {
    background: `hsl(${hue} 64% 22%)`,
    color: `hsl(${(hue + 36) % 360} 86% 78%)`,
  };
}

export function trustWalletLogoUrl(chain: string, address: string) {
  return `${TRUST_WALLET_CDN}/blockchains/${chain}/assets/${address}/logo.png`;
}

export function TokenLogo({ symbol, address, chain = "worldchain", size = 32 }: TokenLogoProps) {
  const normalizedSymbol = symbol.trim().toUpperCase();
  const checksumAddress = useMemo(() => {
    if (!address || !isAddress(address)) return null;
    return getAddress(address);
  }, [address]);
  const [src, setSrc] = useState<string | null>(null);
  const [fallbackIndex, setFallbackIndex] = useState(0);
  const fallbackStyle = colorFromSymbol(normalizedSymbol);

  const candidates = useMemo(() => {
    if (!checksumAddress) return [];
    const chains = chain === "ethereum" ? ["ethereum"] : [chain, "ethereum"];
    return chains.map((item) => trustWalletLogoUrl(item, checksumAddress));
  }, [chain, checksumAddress]);

  useEffect(() => {
    if (!checksumAddress || !candidates.length) {
      setSrc(null);
      setFallbackIndex(0);
      return;
    }
    const key = cacheKey(chain, checksumAddress);
    setSrc(readCache(key) ?? candidates[0]);
    setFallbackIndex(0);
  }, [candidates, chain, checksumAddress]);

  if (!src) {
    return (
      <span className="token-logo-fallback" style={{ ...fallbackStyle, width: size, height: size, fontSize: size * 0.42 }}>
        {normalizedSymbol.slice(0, 1) || "?"}
      </span>
    );
  }

  return (
    <span className="token-logo-frame" style={{ width: size, height: size }}>
      <Image
        alt={`${normalizedSymbol} logo`}
        src={src}
        width={size}
        height={size}
        loading="lazy"
        sizes={`${size}px`}
        onLoad={() => {
          if (checksumAddress) writeCache(cacheKey(chain, checksumAddress), src);
        }}
        onError={() => {
          const next = fallbackIndex + 1;
          if (next < candidates.length) {
            setFallbackIndex(next);
            setSrc(candidates[next]);
            return;
          }
          setSrc(null);
        }}
      />
    </span>
  );
}
