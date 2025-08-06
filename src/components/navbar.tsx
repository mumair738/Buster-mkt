"use client";

import { useEffect, useState, Fragment } from "react";
import { sdk } from "@farcaster/miniapp-sdk";
import Image from "next/image";
import { useConnect, useAccount, useDisconnect, Connector } from "wagmi";
import { ThemeToggle } from "@/components/theme-toggle";

export function Navbar() {
  const [username, setUsername] = useState<string | null>(null);
  const [pfpUrl, setPfpUrl] = useState<string | null>(null);
  const [pfpError, setPfpError] = useState(false);
  const { connect, connectors } = useConnect();
  const { isConnected: isAccountConnected } = useAccount();

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const context = await sdk.context;
        setUsername(context.user.username || "player");
        setPfpUrl(context.user.pfpUrl || null);
      } catch {
        setUsername("player");
        setPfpUrl(null);
      }
    };
    fetchUser();
  }, []);

  useEffect(() => {
    const autoConnectInMiniApp = async () => {
      try {
        const inMiniApp = await sdk.isInMiniApp();
        if (inMiniApp && !isAccountConnected) {
          const farcasterConnector = connectors.find(
            (c) => c.id === "miniAppConnector"
          );
          if (farcasterConnector) {
            connect({ connector: farcasterConnector });
          }
        }
      } catch (error) {
        console.error("Error during auto-connect:", error);
      }
    };
    autoConnectInMiniApp();
  }, [isAccountConnected, connect, connectors]);

  const WalletButton = () => {
    const {
      address,
      isConnected: wagmiIsConnected,
      isConnecting: wagmiIsConnecting,
    } = useAccount(); // Use isConnecting from useAccount
    const { connect: wagmiConnect, connectors: wagmiConnectors } = useConnect();
    const { disconnect: wagmiDisconnect } = useDisconnect();

    const [isClient, setIsClient] = useState(false);

    useEffect(() => {
      setIsClient(true);
    }, []);

    if (!isClient) {
      return (
        <div className="px-3 py-1 rounded-full text-sm font-medium text-coolGray-900 animate-pulse">
          Connecting...
        </div>
      );
    }

    const isValidConnector = (c: unknown): c is Connector =>
      !!c && typeof c === "object" && "id" in c && "connect" in c;

    const validConnectors = wagmiConnectors.filter(isValidConnector);

    const primaryConnector =
      validConnectors.find((c) => c.id === "miniAppConnector") ||
      validConnectors.find((c) => c.id === "metaMask") ||
      (validConnectors.length > 0 ? validConnectors[0] : undefined);

    if (wagmiIsConnected && address) {
      // Connected state - Single button for both desktop and mobile
      return (
        <button
          onClick={() => wagmiDisconnect()}
          style={{ backgroundColor: "#7A42B9" }}
          className="hover:bg-opacity-90 text-white px-3 py-1 rounded-full text-sm font-medium transition-colors duration-200 whitespace-nowrap"
        >
          {/* Desktop: Show more characters */}
          <span className="hidden md:inline">
            {`${address.slice(0, 6)}...${address.slice(-4)}`}
          </span>
          {/* Mobile: Show fewer characters */}
          <span className="md:hidden">
            {`${address.slice(0, 4)}...${address.slice(-3)}`}
          </span>
        </button>
      );
    } else if (wagmiIsConnecting) {
      // Connecting state
      return (
        <div className="px-3 py-1 rounded-full text-sm font-medium text-gray-400 animate-pulse">
          Connecting...
        </div>
      );
    } else {
      return (
        <div>
          {primaryConnector && (
            <button
              key={primaryConnector.id}
              onClick={() => wagmiConnect({ connector: primaryConnector })}
              style={{ backgroundColor: "#7A42B9" }}
              className="hover:bg-opacity-90 text-white px-3 py-1 rounded-full text-sm font-medium transition-colors duration-200 whitespace-nowrap"
            >
              Connect Wallet
            </button>
          )}
        </div>
      );
    }
  };

  return (
    <>
      {/* Desktop View */}
      <div className="hidden md:flex justify-between items-center mb-6 px-4 py-3 bg-gradient-to-r from-[#7A42B9] to-gray-100 dark:from-[#5A2C8A] dark:to-gray-800 rounded-lg shadow-sm">
        <div className="flex items-center gap-3">
          {pfpUrl && !pfpError ? (
            <Image
              src={pfpUrl}
              alt="Profile Picture"
              width={40}
              height={40}
              className="rounded-full"
              onError={() => setPfpError(true)}
            />
          ) : (
            <div className="w-10 h-10 bg-gray-300 dark:bg-gray-600 rounded-full flex items-center justify-center text-gray-600 dark:text-gray-300 text-sm font-medium">
              {username?.charAt(0)?.toUpperCase() || "P"}
            </div>
          )}
          <div className="text-xl font-bold text-gray-800 dark:text-gray-200">
            Welcome {username || "Player"}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <WalletButton />
        </div>
      </div>

      {/* Mobile View */}
      <div className="md:hidden flex justify-between items-center mb-4 px-3 py-2 bg-gradient-to-r from-[#7A42B9] to-gray-100 dark:from-[#5A2C8A] dark:to-gray-800 rounded-lg shadow-sm">
        <div className="flex items-center gap-2">
          {pfpUrl && !pfpError ? (
            <Image
              src={pfpUrl}
              alt="Profile Picture"
              width={32}
              height={32}
              className="rounded-full"
              onError={() => setPfpError(true)}
            />
          ) : (
            <div className="w-8 h-8 bg-gray-300 dark:bg-gray-600 rounded-full flex items-center justify-center text-gray-600 dark:text-gray-300 text-xs font-medium">
              {username?.charAt(0)?.toUpperCase() || "P"}
            </div>
          )}
          <div className="text-sm font-medium text-gray-800 dark:text-gray-200">
            Welcome {username || "Player"}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <WalletButton />
        </div>
      </div>
    </>
  );
}
