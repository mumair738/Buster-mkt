"use client";

import Link from "next/link";
import { Home, Clock, Trophy, User, Info, Settings } from "lucide-react"; // Icons for tabs and About
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { sdk } from "@farcaster/miniapp-sdk"; // Add this import
import { useUserRoles } from "@/hooks/useUserRoles";

export function Footer() {
  //eslint-disable-next-line @typescript-eslint/no-unused-vars
  const pathname = usePathname();
  const [showInfo, setShowInfo] = useState(false);
  const [currentQueryTab, setCurrentQueryTab] = useState<string | null>(null);
  const { hasCreatorAccess, hasResolverAccess, isAdmin } = useUserRoles();

  // Safely get search params on client side only
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      setCurrentQueryTab(params.get("tab"));
    }
  }, []);

  const navItems = [
    { hrefBase: "/", tabValue: "active", icon: Home, label: "Active" },
    { hrefBase: "/", tabValue: "ended", icon: Clock, label: "Ended" },
    {
      hrefBase: "/",
      tabValue: "leaderboard",
      icon: Trophy,
      label: "Leaderboard",
    },
    { hrefBase: "/", tabValue: "myvotes", icon: User, label: "Profile" },
  ];

  // Add admin item only for authorized users
  const allNavItems = [
    ...navItems,
    ...(hasCreatorAccess || hasResolverAccess || isAdmin
      ? [{ hrefBase: "/admin", tabValue: "", icon: Settings, label: "Admin" }]
      : []),
  ];

  // Close info panel when clicking on any navigation item
  const handleNavClick = () => {
    if (showInfo) {
      setShowInfo(false);
    }
  };

  // Add the buy handler and token constants
  const USDC_CAIP19 =
    "eip155:8453/erc20:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
  const CAIP_ETH = "eip155:8453/native";
  const BUSTER_CAIP19 =
    "eip155:8453/erc20:0x53Bd7F868764333de01643ca9102ee4297eFA3cb";

  const handleBuyBuster = async (sellToken: string) => {
    try {
      await sdk.actions.swapToken({
        sellToken,
        buyToken: BUSTER_CAIP19,
      });
    } catch (error) {
      console.error("Failed to open swap:", error);
    }
  };

  return (
    <div className="relative">
      {/* About Panel for Mobile - positioned absolutely above the footer */}
      {showInfo && (
        <div className="md:hidden bg-white shadow-lg rounded-t-lg p-4 border-l-4 border-gray-500 w-full fixed bottom-16 left-0 z-40 animate-slide-up">
          <div className="flex flex-col gap-3">
            <div className="bg-gray-50 p-4 rounded-lg">
              <h3 className="font-bold text-gray-800 text-lg mb-2">
                Welcome to Policast!
              </h3>
              <p className="mb-3 text-gray-700">
                Policast is a prediction game where users can predict public
                sentiments.
              </p>
              <p className="mb-2 font-medium text-gray-800">
                To start playing:
              </p>
              <ol className="list-decimal pl-5 mb-3 space-y-1 text-gray-700">
                <li>Sign in with your wallet</li>
                <li>Browse available predictions</li>
                <li>Place your bets!</li>
              </ol>
              {/* --- Add Buy $Buster Buttons Here --- */}
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => handleBuyBuster(USDC_CAIP19)}
                  className="bg-[#7A42B9] text-white px-3 py-1 rounded-full text-sm font-medium transition-colors duration-200"
                >
                  Buy $Buster with USDC
                </button>
                <button
                  onClick={() => handleBuyBuster(CAIP_ETH)}
                  className="bg-[#7A42B9] text-white px-3 py-1 rounded-full text-sm font-medium transition-colors duration-200"
                >
                  Buy $Buster with ETH
                </button>
              </div>
              {/* --- End Buy $Buster Buttons --- */}
            </div>
          </div>
        </div>
      )}

      <footer className="w-full border-t bg-background fixed bottom-0 left-0 z-50 md:static">
        <div className="container max-w-7xl mx-auto flex flex-col items-center justify-between gap-4 py-4 md:flex-row md:py-8">
          {/* Mobile Navigation with Icons */}
          <div className="flex w-full justify-around md:hidden">
            {allNavItems.map((item) => {
              const href =
                item.hrefBase === "/"
                  ? `${item.hrefBase}?tab=${item.tabValue}`
                  : item.hrefBase;
              // An item is active if its tabValue matches the currentQueryTab.
              // If currentQueryTab is null (no tab in URL), 'active' is the default active tab.
              const isActive =
                (currentQueryTab === null && item.tabValue === "active") ||
                currentQueryTab === item.tabValue ||
                (pathname === item.hrefBase && item.tabValue === "");
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex flex-col items-center",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-primary"
                  )}
                  aria-label={item.label}
                  onClick={handleNavClick}
                >
                  <item.icon className="h-6 w-6" />
                  <span className="text-xs mt-1">{item.label}</span>
                </Link>
              );
            })}
            <button
              onClick={() => setShowInfo(!showInfo)}
              className={cn(
                "flex flex-col items-center",
                showInfo
                  ? "text-primary"
                  : "text-muted-foreground hover:text-primary"
              )}
              aria-label="About"
            >
              <Info className="h-6 w-6" />
              <span className="text-xs mt-1">About</span>
            </button>
          </div>

          {/* Desktop Footer Content */}
          <div className="hidden md:flex flex-col items-center gap-4 px-8 md:flex-row md:gap-2 md:px-0">
            <p className="text-center text-sm leading-loose text-muted-foreground md:text-left">
              Built by{" "}
              <Link
                href="https://farcaster.xyz/~/channel/politics"
                target="_blank"
                rel="noreferrer"
                className="font-medium underline underline-offset-4"
              >
                Politics
              </Link>
              .
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
