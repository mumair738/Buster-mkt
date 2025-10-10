"use client";

import { useAccount } from "wagmi";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Footer } from "./footer";
import { useEffect, useState, useRef } from "react";
import { sdk } from "@farcaster/miniapp-sdk";
import { UserStats } from "./UserStats";
import { useRouter, usePathname } from "next/navigation";
import { Navbar } from "./navbar";
import { UnifiedMarketList } from "./unified-market-list";
import { ValidatedMarketList } from "./ValidatedMarketList";
// import { MarketValidationBanner } from "./ValidationNotice";//
import { BarChart3, TrendingUp, ArrowRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

type LeaderboardEntry = {
  username: string;
  fid: string;
  pfp_url: string | null;
  winnings: number;
  address: string;
  voteCount: number;
};

export function EnhancedPredictionMarketDashboard() {
  const { address } = useAccount();
  const router = useRouter();
  const currentPathname = usePathname();

  // Initialize with a fixed default. Will be updated from URL after client mount.
  const [activeTab, setActiveTab] = useState("active");
  const [isClient, setIsClient] = useState(false);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoadingLeaderboard, setIsLoadingLeaderboard] = useState(true);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);

  useEffect(() => {
    // This effect runs only on the client, after the initial render
    setIsClient(true);
    // Safely get search params on client side
    const urlParams = new URLSearchParams(window.location.search);
    const tabFromUrl = urlParams.get("tab") || "active";
    setActiveTab(tabFromUrl);

    // Listen for custom tab change events from footer
    const handleTabChangeEvent = (event: CustomEvent) => {
      const newTab = event.detail.tab;
      setActiveTab(newTab);
    };

    window.addEventListener("tabChange", handleTabChangeEvent as EventListener);

    return () => {
      window.removeEventListener(
        "tabChange",
        handleTabChangeEvent as EventListener
      );
    };
  }, []); // Only run once on mount

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    // Update URL without full page reload
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set("tab", value);
    window.history.replaceState(null, "", newUrl.toString());
  };

  const hasFetchedInitially = useRef(false);

  const fetchLeaderboardData = async (setLoading = false) => {
    if (setLoading) {
      setIsLoadingLeaderboard(true);
      setLeaderboardError(null);
    }
    try {
      const res = await fetch("/api/leaderboard");

      if (!res.ok) {
        let errorDetails = `HTTP error! status: ${res.status}`;
        try {
          const errorText = await res.text();
          if (
            errorText &&
            !errorText.toLowerCase().includes("<html") &&
            !errorText.toLowerCase().includes("<!doctype html")
          ) {
            errorDetails =
              errorText.length > 150
                ? errorText.substring(0, 147) + "..."
                : errorText;
          }
        } catch {
          // Ignore if reading text fails
        }
        throw new Error(errorDetails);
      }

      const data = await res.json();

      if (Array.isArray(data)) {
        setLeaderboard(data as LeaderboardEntry[]);
      } else {
        throw new Error(
          "Received non-array data for leaderboard. Expected an array."
        );
      }
    } catch (err) {
      console.error("Leaderboard fetch error:", err);
      let displayError =
        (err as Error).message ||
        "Failed to load leaderboard. Please try again later.";

      if (displayError.includes("NEYNAR_API_KEY")) {
        displayError = "Server configuration error. Please try again later.";
      } else if (displayError.includes("eth_getLogs")) {
        displayError =
          "Unable to fetch leaderboard data due to blockchain query limits. Please try again later.";
      } else if (err instanceof SyntaxError) {
        displayError =
          "Received malformed data from the server. Please try again later.";
      }
      setLeaderboardError(displayError);
      setLeaderboard([]);
    } finally {
      if (setLoading) {
        setIsLoadingLeaderboard(false);
      }
    }
  };

  useEffect(() => {
    if (!hasFetchedInitially.current) {
      fetchLeaderboardData(true);
      hasFetchedInitially.current = true;
    }
  }, []);

  useEffect(() => {
    const refreshInterval = 5 * 60 * 1000;
    const intervalId = setInterval(() => {
      fetchLeaderboardData(false);
    }, refreshInterval);
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    sdk.actions.ready();
    (async () => {
      await sdk.actions.addFrame();
    })();
  }, []);

  const emptyState = (title: string, subtitle: string) => (
    <div className="flex flex-col items-center justify-center p-6 text-center">
      <svg
        className="w-12 h-12 text-gray-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      <p className="mt-2 text-sm font-medium text-gray-500">{title}</p>
      <p className="mt-1 text-xs text-gray-400">{subtitle}</p>
    </div>
  );

  // Determine showVoteHistory based on isClient and address
  const actualShowVoteHistory = isClient && !!address;

  return (
    <div className="min-h-screen flex flex-col pb-20 md:pb-0 bg-gradient-to-br from-[#6A5ACD] via-[#E6E6FA] to-[#F0F8FF] dark:from-[#2D1B69] dark:via-[#1a1a2e] dark:to-[#16213e]">
      <Navbar />
      <div className="flex-grow container mx-auto p-4">
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="w-full"
        >
          <TabsList
            className={`grid w-full ${
              actualShowVoteHistory ? "grid-cols-4" : "grid-cols-3"
            } overflow-x-auto whitespace-nowrap hidden md:grid`}
          >
            <TabsTrigger value="active" className="text-xs px-2">
              Active
            </TabsTrigger>
            <TabsTrigger value="ended" className="text-xs px-2">
              Ended
            </TabsTrigger>
            <TabsTrigger value="leaderboard" className="text-xs px-2">
              Leaderboard
            </TabsTrigger>
            {actualShowVoteHistory && (
              <TabsTrigger value="myvotes" className="text-xs px-2">
                My Shares
              </TabsTrigger>
            )}
          </TabsList>

          {/* Market Validation Info Banner */}
          {/* <MarketValidationBanner /> */}

          <TabsContent value="active" className="mt-6">
            <ValidatedMarketList filter="active" showOnlyValidated={true} />
          </TabsContent>

          <TabsContent value="ended" className="mt-6">
            <Tabs defaultValue="pending" className="w-full">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="pending" className="text-xs px-2">
                  Pending
                </TabsTrigger>
                <TabsTrigger value="resolved" className="text-xs px-2">
                  Results
                </TabsTrigger>
              </TabsList>
              <TabsContent value="pending" className="mt-4">
                <ValidatedMarketList
                  filter="pending"
                  showOnlyValidated={true}
                />
              </TabsContent>
              <TabsContent value="resolved" className="mt-4">
                <ValidatedMarketList
                  filter="resolved"
                  showOnlyValidated={true}
                />
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="leaderboard" className="mt-6">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden border border-gray-200 dark:border-gray-700">
              <div className="bg-gray-50 dark:bg-gray-700 px-4 py-3 border-b border-gray-200 dark:border-gray-600">
                <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Top Predictors
                </h3>
              </div>
              {isLoadingLeaderboard ? (
                <div className="flex justify-center items-center p-10">
                  <svg
                    className="animate-spin h-8 w-8 text-blue-500"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                </div>
              ) : leaderboardError ? (
                <div className="p-4 text-center text-red-600">
                  {leaderboardError}
                </div>
              ) : leaderboard.length > 0 ? (
                <div className="divide-y divide-gray-200 dark:divide-gray-600">
                  <div className="grid grid-cols-12 px-4 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-700">
                    <div className="col-span-1 text-center">#</div>
                    <div className="col-span-9">Predictor</div>
                    <div className="col-span-2 text-right">Winnings</div>
                  </div>
                  {leaderboard.map((entry, idx) => (
                    <div
                      key={entry.fid}
                      className={`grid grid-cols-12 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors ${
                        idx < 3
                          ? "bg-gradient-to-r from-transparent to-blue-50 dark:to-blue-900/20"
                          : ""
                      }`}
                    >
                      <div className="col-span-1 flex items-center justify-center">
                        {idx < 3 ? (
                          <div
                            className={`flex items-center justify-center w-6 h-6 rounded-full
                            ${
                              idx === 0
                                ? "bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-100"
                                : idx === 1
                                ? "bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                                : "bg-amber-100 dark:bg-amber-900 text-amber-800 dark:text-amber-100"
                            }
                            text-xs font-bold`}
                          >
                            {idx + 1}
                          </div>
                        ) : (
                          <span className="text-gray-500 dark:text-gray-400 text-sm">
                            {idx + 1}
                          </span>
                        )}
                      </div>
                      <div className="col-span-9">
                        <div className="flex items-center">
                          <div className="bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-100 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm mr-3">
                            {entry.username?.substring(0, 1).toUpperCase() ||
                              "?"}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                              {entry.username || `FID: ${entry.fid}`}
                            </div>
                            <div className="text-xs text-gray-500 dark:text-gray-400">
                              FID: {entry.fid}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="col-span-2 text-right">
                        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {entry.winnings.toLocaleString()} $Buster
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                emptyState(
                  "No leaderboard data available",
                  "Leaderboard will appear once predictions are resolved"
                )
              )}
            </div>
          </TabsContent>

          {actualShowVoteHistory && (
            <TabsContent value="myvotes" className="mt-6">
              <UserStats />
            </TabsContent>
          )}
        </Tabs>
      </div>
      <Footer />
    </div>
  );
}
