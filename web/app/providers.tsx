// SPDX-License-Identifier: Apache-2.0
"use client";

import { useMemo, type ReactNode } from "react";
import { clusterApiUrl } from "@solana/web3.js";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import type { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { Buffer } from "buffer";
import "@solana/wallet-adapter-react-ui/styles.css";

// @solana/web3.js + spl-token use the Node `Buffer` global, which the browser
// lacks. Polyfill it once, client-side, before any wallet/tx code runs.
if (typeof window !== "undefined") {
  (window as unknown as { Buffer: typeof Buffer }).Buffer ??= Buffer;
}

/**
 * Client-only wallet context. Phantom + Solflare are registered explicitly;
 * Backpack and other Wallet-Standard wallets are auto-detected by WalletProvider,
 * so they appear in the modal without an explicit adapter.
 */
export function Providers({ children }: { children: ReactNode }) {
  const network = (process.env.NEXT_PUBLIC_WALLET_ADAPTER_NETWORK ?? "mainnet-beta") as WalletAdapterNetwork;
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? clusterApiUrl(network),
    [network],
  );
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
