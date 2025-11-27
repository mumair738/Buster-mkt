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
    { name: "Profile", href: "/profile", icon: User },
  ];

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
        <div className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 animate-pulse">
          Loading...
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
      (c) => c.id !== "miniAppConnector"
    );

    if (wallet.isConnected && wallet.address) {
      return (
        <button
          onClick={() => wallet.disconnect()}
          className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 shadow-md hover:shadow-lg whitespace-nowrap"
        >
          <span className="hidden md:inline">
            {`${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`}
          </span>
          <span className="md:hidden">
            {`${wallet.address.slice(0, 4)}...${wallet.address.slice(-3)}`}
          </span>
        </button>
      );
    } else if (wallet.isConnecting) {
      return (
        <div className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 animate-pulse">
          Connecting...
        </div>
      );
    } else {
      return (
        <div className="relative">
          {availableConnectors.length === 1 ? (
            <button
              onClick={() => wallet.connect(availableConnectors[0].id)}
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 shadow-md hover:shadow-lg whitespace-nowrap"
            >
              Connect
            </button>
          ) : availableConnectors.length > 1 ? (
            <>
              <button
                onClick={() => setShowWalletOptions(!showWalletOptions)}
                className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 shadow-md hover:shadow-lg whitespace-nowrap"
              >
                Connect
              </button>

              {showWalletOptions && (
                <div className="absolute top-full right-0 mt-2 bg-[#352c3f]/95 backdrop-blur-xl border border-[#544863] rounded-xl shadow-xl z-[100] min-w-[160px] overflow-hidden">
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
                      className="w-full px-4 py-2.5 text-left text-gray-200 hover:bg-[#433952]/80 transition-colors duration-200 text-xs font-medium"
                    >
                      {getConnectorName(connector.id)}
                    </button>
                  ))}
                </div>
              )}
            </>
          ) : null}

          {showWalletOptions && (
            <div
              className="fixed inset-0 z-[90]"
              onClick={() => setShowWalletOptions(false)}
            />
          )}
        </div>
      );
    }
  };

  return (
    <>
      {/* Desktop View - Sleek & Compact */}
      <div className="hidden md:flex justify-between items-center mb-4 px-4 py-2.5 bg-[#433952]/50 backdrop-blur-xl border border-[#544863] rounded-xl shadow-lg">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2.5">
            {pfpUrl && !pfpError ? (
              <Image
                src={pfpUrl}
                alt="Profile Picture"
                width={32}
                height={32}
                className="rounded-full ring-2 ring-[#544863]"
                onError={() => setPfpError(true)}
              />
            ) : (
              <div className="w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-md">
                {username?.charAt(0)?.toUpperCase() || "P"}
              </div>
            )}
            <div className="text-lg font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              POLICAST
            </div>
          </div>

          <nav className="flex items-center gap-2">
            {allNavigationItems.map((item) => {
              const Icon = item.icon;
              const isActive = pathname === item.href;
              return (
                <Link key={item.name} href={item.href}>
                  <button
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                      isActive
                        ? "bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-md"
                        : "text-gray-300 hover:bg-[#352c3f]/80"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {item.name}
                  </button>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <ThemeToggle />
          <WalletButton />
        </div>
      </div>

      {/* Mobile View - Ultra Compact */}
      <div className="md:hidden">
        <div className="flex justify-between items-center mb-3 px-3 py-2 bg-[#433952]/50 backdrop-blur-xl border border-[#544863] rounded-xl shadow-lg">
          <div className="flex items-center gap-2">
            {pfpUrl && !pfpError ? (
              <Image
                src={pfpUrl}
                alt="Profile Picture"
                width={28}
                height={28}
                className="rounded-full ring-2 ring-[#544863]"
                onError={() => setPfpError(true)}
              />
            ) : (
              <div className="w-7 h-7 bg-gradient-to-br from-purple-500 to-blue-500 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-md">
                {username?.charAt(0)?.toUpperCase() || "P"}
              </div>
            )}
            <div className="text-sm font-bold bg-gradient-to-r from-purple-400 to-blue-400 bg-clip-text text-transparent">
              POLICAST
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <ThemeToggle />
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-1.5 rounded-lg hover:bg-[#352c3f]/80 transition-colors"
            >
              {mobileMenuOpen ? (
                <X className="h-4 w-4 text-gray-300" />
              ) : (
                <Menu className="h-4 w-4 text-gray-300" />
              )}
            </button>
            <WalletButton />
          </div>
        </div>

        {/* Mobile Menu - Sleek Dropdown */}
        {mobileMenuOpen && (
          <div className="mb-3 p-2 bg-[#433952]/50 backdrop-blur-xl rounded-xl shadow-lg border border-[#544863]">
            <nav className="flex flex-col gap-1">
              {allNavigationItems.map((item) => {
                const Icon = item.icon;
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.name}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <button
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition-all duration-200 ${
                        isActive
                          ? "bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-md"
                          : "text-gray-300 hover:bg-[#352c3f]/80"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.name}
                    </button>
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
