"use client";

import { useEffect, useState, Fragment } from "react";
import { sdk } from "@farcaster/miniapp-sdk";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/components/WagmiProvider";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import {
  Home,
  BarChart3,
  User,
  Trophy,
  Menu,
  X,
  Settings,
  Gift,
} from "lucide-react";
import { useUserRoles } from "@/hooks/useUserRoles";

export function Navbar() {
  const [username, setUsername] = useState<string | null>(null);
  const [pfpUrl, setPfpUrl] = useState<string | null>(null);
  const [pfpError, setPfpError] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const wallet = useWallet();
  const { hasCreatorAccess, hasResolverAccess, isAdmin, isOwner } =
    useUserRoles();
  const pathname = usePathname();

  const navigationItems = [
    { name: "Markets", href: "/", icon: Home },
    // { name: "Free Markets", href: "/free-markets", icon: Gift },
    { name: "Profile", href: "/profile", icon: User },
  ];

  // Add admin link only for authorized users
  const allNavigationItems = [
    ...navigationItems,
    ...(hasCreatorAccess || hasResolverAccess || isAdmin
      ? [{ name: "Admin", href: "/admin", icon: Settings }]
      : []),
  ];

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
        if (inMiniApp && !wallet.isConnected) {
          wallet.connect("miniAppConnector");
        }
      } catch (error) {
        console.error("Error during auto-connect:", error);
      }
    };
    autoConnectInMiniApp();
  }, [wallet.isConnected, wallet.connect]);

  const WalletButton = () => {
    const [isClient, setIsClient] = useState(false);
    const [showWalletOptions, setShowWalletOptions] = useState(false);

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

    const getConnectorName = (connectorId: string) => {
      switch (connectorId) {
        case "miniAppConnector":
          return "Farcaster";
        case "coinbaseWalletSDK":
          return "Coinbase Wallet";
        case "metaMask":
          return "MetaMask";
        case "walletConnect":
          return "WalletConnect";
        default:
          return connectorId;
      }
    };

    const availableConnectors = wallet.connectors.filter(
      (c) => c.id !== "miniAppConnector" // Hide farcaster connector in normal browser
    );

    if (wallet.isConnected && wallet.address) {
      // Connected state - Single button for both desktop and mobile
      return (
        <button
          onClick={() => wallet.disconnect()}
          style={{ backgroundColor: "#7A42B9" }}
          className="hover:bg-opacity-90 text-white px-3 py-1 rounded-full text-sm font-medium transition-colors duration-200 whitespace-nowrap"
        >
          {/* Desktop: Show more characters */}
          <span className="hidden md:inline">
            {`${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`}
          </span>
          {/* Mobile: Show fewer characters */}
          <span className="md:hidden">
            {`${wallet.address.slice(0, 4)}...${wallet.address.slice(-3)}`}
          </span>
        </button>
      );
    } else if (wallet.isConnecting) {
      // Connecting state
      return (
        <div className="px-3 py-1 rounded-full text-sm font-medium text-gray-400 animate-pulse">
          Connecting...
        </div>
      );
    } else {
      return (
        <div className="relative">
          {availableConnectors.length === 1 ? (
            // Single connector - direct connect
            <button
              onClick={() => wallet.connect(availableConnectors[0].id)}
              style={{ backgroundColor: "#7A42B9" }}
              className="hover:bg-opacity-90 text-white px-3 py-1 rounded-full text-sm font-medium transition-colors duration-200 whitespace-nowrap"
            >
              Connect Wallet
            </button>
          ) : availableConnectors.length > 1 ? (
            // Multiple connectors - show dropdown
            <>
              <button
                onClick={() => setShowWalletOptions(!showWalletOptions)}
                style={{ backgroundColor: "#7A42B9" }}
                className="hover:bg-opacity-90 text-white px-3 py-1 rounded-full text-sm font-medium transition-colors duration-200 whitespace-nowrap"
              >
                Connect Wallet
              </button>

              {showWalletOptions && (
                <div className="absolute top-full right-0 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg z-50 min-w-[150px]">
                  {availableConnectors.map((connector) => (
                    <button
                      key={connector.id}
                      onClick={async () => {
                        try {
                          await wallet.connect(connector.id);
                          setShowWalletOptions(false);
                        } catch (error) {
                          console.error("Error connecting to wallet:", error);
                        }
                      }}
                      className="w-full px-4 py-2 text-left hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors duration-200 first:rounded-t-lg last:rounded-b-lg text-sm"
                    >
                      {getConnectorName(connector.id)}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : null}

          {/* Click outside to close dropdown */}
          {showWalletOptions && (
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowWalletOptions(false)}
            />
          )}
        </div>
      );
    }
  };

  return (
    <>
      {/* Desktop View */}
      <div className="hidden md:flex justify-between items-center mb-6 px-4 py-3 bg-gradient-to-r from-[#7A42B9] to-gray-100 dark:from-[#5A2C8A] dark:to-gray-800 rounded-lg shadow-sm">
        <div className="flex items-center gap-6">
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
              POLICAST
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="flex items-center gap-4">
            {allNavigationItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link key={item.name} href={item.href}>
                  <Button
                    variant={isActive ? "default" : "ghost"}
                    size="sm"
                    className="flex items-center gap-2"
                  >
                    <Icon className="h-4 w-4" />
                    {item.name}
                  </Button>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <WalletButton />
        </div>
      </div>

      {/* Mobile View */}
      <div className="md:hidden">
        <div className="flex justify-between items-center mb-4 px-3 py-2 bg-gradient-to-r from-[#7A42B9] to-gray-100 dark:from-[#5A2C8A] dark:to-gray-800 rounded-lg shadow-sm">
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
              POLICAST
            </div>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <X className="h-4 w-4" />
              ) : (
                <Menu className="h-4 w-4" />
              )}
            </Button>
            <WalletButton />
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="mb-4 p-3 bg-white dark:bg-gray-800 rounded-lg shadow-lg border">
            <nav className="flex flex-col gap-2">
              {allNavigationItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <Button
                      variant={isActive ? "default" : "ghost"}
                      size="sm"
                      className="w-full justify-start gap-2"
                    >
                      <Icon className="h-4 w-4" />
                      {item.name}
                    </Button>
                  </Link>
                );
              })}
            </nav>
          </div>
        )}
      </div>
    </>
  );
}
