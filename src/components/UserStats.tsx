"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useReadContract } from "wagmi";
import { type Address } from "viem";
import { useToast } from "@/components/ui/use-toast";
import {
  publicClient,
  contractAddress,
  contractAbi,
  V2contractAddress,
  V2contractAbi,
  tokenAddress as defaultTokenAddress,
  tokenAbi as defaultTokenAbi,
  PolicastViews,
  PolicastViewsAbi,
} from "@/constants/contract";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useFarcasterUser } from "@/hooks/useFarcasterUser";
import { Share2 } from "lucide-react";
import { sdk } from "@farcaster/miniapp-sdk";
import { ClaimWinningsSection } from "@/components/ClaimWinningsButton";

interface Vote {
  marketId: number;
  isOptionA: boolean;
  amount: bigint;
  timestamp: bigint;
  version: "v1" | "v2";
  // V2 specific fields//
  optionId?: number;
}

interface MarketInfo {
  question: string;
  // V1 fields
  optionA?: string;
  optionB?: string;
  // V2 fields
  options?: string[];
  // Common fields
  outcome: number; // 0: Pending, 1+: Option index (V1: 1=A, 2=B; V2: 0-based option index)
  resolved: boolean;
  version: "v1" | "v2";
}

interface UserStatsData {
  totalVotes: number;
  wins: number;
  losses: number;
  winRate: number;
  totalInvested: bigint;
  netWinnings: bigint;
  // V1/V2 breakdown
  v1Markets: number;
  v2Markets: number;
  v1Wins: number;
  v1Losses: number;
  v2Wins: number;
  v2Losses: number;
  v2TradeCount: number;
  // V2 portfolio data
  v2Portfolio?: {
    totalInvested: bigint;
    totalWinnings: bigint;
    unrealizedPnL: bigint;
    realizedPnL: bigint;
    tradeCount: number;
  };
}

const CACHE_KEY_STATS = "user_stats_cache_v2"; // Updated for V2 support
const CACHE_TTL_STATS = 60 * 60; // 1 hour in seconds

export function UserStats() {
  const { address: accountAddress, isConnected } = useAccount();
  const { toast } = useToast();
  const farcasterUser = useFarcasterUser();
  const [stats, setStats] = useState<UserStatsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tokenSymbol, setTokenSymbol] = useState<string>("buster");
  const [tokenDecimals, setTokenDecimals] = useState<number>(18);

  const { data: bettingTokenAddr } = useReadContract({
    address: contractAddress,
    abi: contractAbi,
    functionName: "bettingToken",
  });

  const tokenAddress = (bettingTokenAddr as Address) || defaultTokenAddress;

  const { data: symbolData } = useReadContract({
    address: tokenAddress,
    abi: defaultTokenAbi,
    functionName: "symbol",
    query: { enabled: !!tokenAddress },
  });

  const { data: decimalsData } = useReadContract({
    address: tokenAddress,
    abi: defaultTokenAbi,
    functionName: "decimals",
    query: { enabled: !!tokenAddress },
  });

  useEffect(() => {
    if (symbolData) setTokenSymbol(symbolData as string);
    if (decimalsData) setTokenDecimals(Number(decimalsData));
  }, [symbolData, decimalsData]);

  const { data: totalWinningsData } = useReadContract({
    address: contractAddress,
    abi: contractAbi,
    functionName: "totalWinnings",
    args: [accountAddress!],
    query: { enabled: !!accountAddress },
  });
  const totalWinnings = (totalWinningsData as bigint | undefined) ?? 0n;

  // V2 Contract Reads
  // V2 portfolio tuple: [totalInvested, totalWinnings, unrealizedPnL, realizedPnL, tradeCount]
  type V2PortfolioTuple = readonly [bigint, bigint, bigint, bigint, bigint];
  const { data: v2PortfolioTuple } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "userPortfolios",
    args: [accountAddress!],
    query: { enabled: !!accountAddress },
  });

  // Calculate unrealized P&L dynamically (the field in userPortfolios is never updated)
  const { data: calculatedUnrealizedPnL } = useReadContract({
    address: PolicastViews,
    abi: PolicastViewsAbi,
    functionName: "calculateUnrealizedPnL",
    args: [accountAddress!],
    query: {
      enabled: !!accountAddress,
      refetchInterval: 30000, // Refetch every 30 seconds to keep it updated
    },
  });

  const fetchUserStats = useCallback(
    async (address: Address) => {
      setIsLoading(true);
      try {
        const cached = localStorage.getItem(`${CACHE_KEY_STATS}_${address}`);
        if (cached) {
          try {
            const data = JSON.parse(cached);
            if (Date.now() - data.timestamp < CACHE_TTL_STATS * 1000) {
              // Convert string values back to BigInt
              const cachedStats = {
                ...data.stats,
                totalInvested: BigInt(data.stats.totalInvested),
                netWinnings: BigInt(data.stats.netWinnings),
                // Ensure all numeric fields exist with defaults
                v1Wins: data.stats.v1Wins || 0,
                v1Losses: data.stats.v1Losses || 0,
                v2Wins: data.stats.v2Wins || 0,
                v2Losses: data.stats.v2Losses || 0,
                v2TradeCount: data.stats.v2TradeCount || 0,
                v2Portfolio: data.stats.v2Portfolio
                  ? {
                      ...data.stats.v2Portfolio,
                      totalInvested: BigInt(
                        data.stats.v2Portfolio.totalInvested
                      ),
                      totalWinnings: BigInt(
                        data.stats.v2Portfolio.totalWinnings
                      ),
                      unrealizedPnL: BigInt(
                        data.stats.v2Portfolio.unrealizedPnL
                      ),
                      realizedPnL: BigInt(data.stats.v2Portfolio.realizedPnL),
                    }
                  : undefined,
              };
              setStats(cachedStats);
              setIsLoading(false);
              return;
            }
          } catch (parseError) {
            console.warn(
              "Failed to parse cached stats, fetching fresh data:",
              parseError
            );
            // Clear invalid cache
            localStorage.removeItem(`${CACHE_KEY_STATS}_${address}`);
          }
        }

        // Fetch from both V1 and V2 contracts
        const [v1VoteCount] = await Promise.all([
          // V1 contract
          publicClient.readContract({
            address: contractAddress,
            abi: contractAbi,
            functionName: "getVoteHistoryCount",
            args: [address],
          }) as Promise<bigint>,
          // V2 contract support will be added when user history functions are available
        ]);

        // For now, V2 vote count is 0 until the contract has user history functions
        const v2TradeCount = v2PortfolioTuple ? Number(v2PortfolioTuple[4]) : 0;

        if (v1VoteCount === 0n && v2TradeCount === 0) {
          setStats({
            totalVotes: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            totalInvested: 0n,
            netWinnings: 0n,
            v1Markets: 0,
            v2Markets: 0,
            v1Wins: 0,
            v1Losses: 0,
            v2Wins: 0,
            v2Losses: 0,
            v2TradeCount: 0,
            v2Portfolio: v2PortfolioTuple
              ? {
                  totalInvested: v2PortfolioTuple[0],
                  totalWinnings: v2PortfolioTuple[1],
                  unrealizedPnL:
                    (calculatedUnrealizedPnL as bigint | undefined) ?? 0n, // Use calculated value
                  realizedPnL: v2PortfolioTuple[3],
                  tradeCount: Number(v2PortfolioTuple[4]),
                }
              : undefined,
          });
          setIsLoading(false);
          return;
        }

        const allVotes: Vote[] = [];

        // Fetch V1 votes
        for (let i = 0; i < v1VoteCount; i += 50) {
          const votes = (await publicClient.readContract({
            address: contractAddress,
            abi: contractAbi,
            functionName: "getVoteHistory",
            args: [address, BigInt(i), 50n],
          })) as readonly {
            marketId: bigint;
            isOptionA: boolean;
            amount: bigint;
            timestamp: bigint;
          }[];
          allVotes.push(
            ...votes.map((v) => ({
              ...v,
              marketId: Number(v.marketId),
              version: "v1" as const,
            }))
          );
        }

        // Fetch V2 trades using getUserPortfolio to get trade count
        const v2Trades: any[] = [];
        try {
          if (v2PortfolioTuple) {
            const tradeCount = Number(v2PortfolioTuple[4]);

            if (tradeCount > 0) {
              // Fetch all trades by index
              for (let i = 0; i < tradeCount; i++) {
                try {
                  const trade = await publicClient.readContract({
                    address: V2contractAddress,
                    abi: V2contractAbi,
                    functionName: "userTradeHistory",
                    args: [address, BigInt(i)],
                  });

                  if (trade) {
                    v2Trades.push({
                      marketId: Number((trade as any).marketId),
                      optionId: Number((trade as any).optionId),
                      buyer: (trade as any).buyer,
                      seller: (trade as any).seller,
                      price: BigInt((trade as any).price || 0),
                      quantity: BigInt((trade as any).quantity || 0),
                      timestamp: BigInt((trade as any).timestamp || 0),
                    });
                  }
                } catch (innerError) {
                  console.error(`Failed to fetch V2 trade ${i}:`, innerError);
                  // If we get a contract revert, it likely means we've reached the end of available trades
                  if (
                    (innerError as any)?.message?.includes("reverted") ||
                    (innerError as any)?.message?.includes(
                      "ContractFunctionRevertedError"
                    )
                  ) {
                    break;
                  }
                }
              }
            }
          }
        } catch (error) {
          console.warn("V2 trade history error:", error);
        } // Get V2 market IDs from trades
        const v2MarketIds = [...new Set(v2Trades.map((t) => t.marketId))];

        // Fetch V2 market info for win/loss calculation
        const v2MarketInfos: Record<number, any> = {};
        if (v2MarketIds.length > 0) {
          try {
            for (const marketId of v2MarketIds) {
              const marketInfo = await publicClient.readContract({
                address: PolicastViews as `0x${string}`,
                abi: PolicastViewsAbi,
                functionName: "getMarketInfo",
                args: [BigInt(marketId)],
              });

              if (marketInfo) {
                v2MarketInfos[marketId] = {
                  question: (marketInfo as any)[0],
                  description: (marketInfo as any)[1],
                  endTime: (marketInfo as any)[2],
                  category: (marketInfo as any)[3],
                  optionCount: (marketInfo as any)[4],
                  resolved: (marketInfo as any)[5],
                  disputed: (marketInfo as any)[6],
                  winningOptionId: (marketInfo as any)[7],
                };
              }
            }
          } catch (error) {
            console.warn("V2 market info not accessible:", error);
          }
        }

        // Get unique market IDs for V1 only for now
        const v1MarketIds = [
          ...new Set(
            allVotes.filter((v) => v.version === "v1").map((v) => v.marketId)
          ),
        ];

        const marketInfos: Record<number, MarketInfo> = {};

        // Fetch V1 market info
        if (v1MarketIds.length > 0) {
          const v1MarketInfosData = await publicClient.readContract({
            address: contractAddress,
            abi: contractAbi,
            functionName: "getMarketInfoBatch",
            args: [v1MarketIds.map(BigInt)],
          });

          v1MarketIds.forEach((id, i) => {
            marketInfos[id] = {
              question: v1MarketInfosData[0][i],
              optionA: v1MarketInfosData[1][i],
              optionB: v1MarketInfosData[2][i],
              outcome: v1MarketInfosData[4][i],
              resolved: v1MarketInfosData[7][i],
              version: "v1",
            };
          });
        }

        let wins = 0;
        let losses = 0;
        let v1Markets = 0;
        const v2Markets = v2MarketIds.length;
        let v2Wins = 0;
        let v2Losses = 0;
        const totalInvested = allVotes.reduce((acc, v) => acc + v.amount, 0n);

        // Calculate V1 wins/losses
        allVotes.forEach((vote) => {
          const market = marketInfos[vote.marketId];
          if (market && market.resolved) {
            if (market.version === "v1") {
              v1Markets++;
              // V1 binary logic: outcome 1 = optionA, outcome 2 = optionB
              const won =
                (vote.isOptionA && market.outcome === 1) ||
                (!vote.isOptionA && market.outcome === 2);
              if (won) {
                wins++;
              } else if (market.outcome !== 0 && market.outcome !== 3) {
                // Not pending or invalid
                losses++;
              }
            }
          }
        });

        // Calculate V2 wins/losses based on actual trades and market outcomes
        const v2UserPositions: Record<number, Record<number, bigint>> = {};

        // Calculate user positions in each V2 market/option
        v2Trades.forEach((trade) => {
          if (!v2UserPositions[trade.marketId]) {
            v2UserPositions[trade.marketId] = {};
          }
          if (!v2UserPositions[trade.marketId][trade.optionId]) {
            v2UserPositions[trade.marketId][trade.optionId] = 0n;
          }

          // If user was buyer, they gained shares; if seller, they lost shares
          if (
            trade.buyer &&
            address &&
            trade.buyer.toLowerCase() === address.toLowerCase()
          ) {
            v2UserPositions[trade.marketId][trade.optionId] += trade.quantity;
          } else if (
            trade.seller &&
            address &&
            trade.seller.toLowerCase() === address.toLowerCase()
          ) {
            v2UserPositions[trade.marketId][trade.optionId] -= trade.quantity;
          }
        });

        // Check V2 market outcomes for wins/losses
        Object.entries(v2UserPositions).forEach(([marketIdStr, positions]) => {
          const marketId = Number(marketIdStr);
          const marketInfo = v2MarketInfos[marketId];

          if (marketInfo && marketInfo.resolved) {
            const winningOptionId = marketInfo.winningOptionId;
            let userWon = false;

            // Check if user has positive position in winning option
            Object.entries(positions).forEach(([optionIdStr, quantity]) => {
              const optionId = Number(optionIdStr);
              if (optionId === winningOptionId && quantity > 0n) {
                userWon = true;
              }
            });

            if (userWon) {
              v2Wins++;
            } else {
              // Check if user had any position in this market
              const hadPosition = Object.values(positions).some((q) => q > 0n);
              if (hadPosition) {
                v2Losses++;
              }
            }
          }
        });

        const totalVotes = wins + losses + v2Wins + v2Losses;
        const totalWins = wins + v2Wins;
        const totalLosses = losses + v2Losses;
        const winRate = totalVotes > 0 ? (totalWins / totalVotes) * 100 : 0;

        // Combine V1 and V2 investment amounts
        const v2TotalInvested = v2PortfolioTuple ? v2PortfolioTuple[0] : 0n;
        const combinedTotalInvested = totalInvested + v2TotalInvested;

        // Combine V1 and V2 winnings
        const v2TotalWinningsAmount = v2PortfolioTuple
          ? v2PortfolioTuple[1]
          : 0n;
        const combinedNetWinnings = totalWinnings + v2TotalWinningsAmount;

        const newStats = {
          totalVotes,
          wins: totalWins,
          losses: totalLosses,
          winRate,
          totalInvested: combinedTotalInvested,
          netWinnings: combinedNetWinnings,
          v1Markets,
          v2Markets,
          // Additional V2 specific stats
          v1Wins: wins,
          v1Losses: losses,
          v2Wins,
          v2Losses,
          v2TradeCount: v2Trades.length,
          v2Portfolio: v2PortfolioTuple
            ? {
                totalInvested: v2PortfolioTuple[0],
                totalWinnings: v2PortfolioTuple[1],
                unrealizedPnL:
                  (calculatedUnrealizedPnL as bigint | undefined) ?? 0n, // Use calculated value
                realizedPnL: v2PortfolioTuple[3],
                tradeCount: Number(v2PortfolioTuple[4]),
              }
            : undefined,
        };
        setStats(newStats);

        // Convert BigInt values to strings for localStorage
        const statsForCache = {
          ...newStats,
          totalInvested: newStats.totalInvested.toString(),
          netWinnings: newStats.netWinnings.toString(),
          v2Portfolio: newStats.v2Portfolio
            ? {
                ...newStats.v2Portfolio,
                totalInvested: newStats.v2Portfolio.totalInvested.toString(),
                totalWinnings: newStats.v2Portfolio.totalWinnings.toString(),
                unrealizedPnL: newStats.v2Portfolio.unrealizedPnL.toString(),
                realizedPnL: newStats.v2Portfolio.realizedPnL.toString(),
              }
            : undefined,
        };

        try {
          localStorage.setItem(
            `${CACHE_KEY_STATS}_${address}`,
            JSON.stringify({ stats: statsForCache, timestamp: Date.now() })
          );
        } catch (error) {
          console.warn("Failed to cache user stats:", error);
        }
      } catch (error) {
        console.error("Failed to fetch user stats:", error);
        toast({
          title: "Error",
          description: "Could not load your performance statistics.",
          variant: "destructive",
        });
      } finally {
        setIsLoading(false);
      }
    },
    [toast, totalWinnings, v2PortfolioTuple, calculatedUnrealizedPnL]
  );

  useEffect(() => {
    if (isConnected && accountAddress) {
      fetchUserStats(accountAddress);
    } else {
      setIsLoading(false);
    }
  }, [isConnected, accountAddress, fetchUserStats]);

  if (!isConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Your Stats</CardTitle>
        </CardHeader>
        <CardContent>
          <p>Please connect your wallet to view your performance.</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return <StatsSkeleton />;
  }

  if (!stats) {
    return null;
  }

  const formatAmount = (amount: bigint) => {
    return (Number(amount) / 10 ** tokenDecimals).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
  };

  const formatSignedAmount = (amount: bigint) => {
    const num = Number(amount) / 10 ** tokenDecimals;
    return num.toLocaleString(undefined, {
      maximumFractionDigits: 2,
      signDisplay: "always",
    });
  };

  const handleShare = async () => {
    const baseUrl = window.location.origin;
    const params = new URLSearchParams({
      address: accountAddress!,
      ...(farcasterUser?.username && { username: farcasterUser.username }),
      ...(farcasterUser?.pfpUrl && { pfpUrl: farcasterUser.pfpUrl }),
      ...(farcasterUser?.fid && { fid: farcasterUser.fid.toString() }),
    });

    const shareUrl = `${baseUrl}/profile/${accountAddress}?${params.toString()}`;

    try {
      await sdk.actions.composeCast({
        text: `Check out my prediction market stats on Policast! 🎯`,
        embeds: [shareUrl],
      });
    } catch (error) {
      console.error("Failed to compose cast:", error);
      toast({
        title: "Share Failed",
        description: "Could not share your stats. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-3 md:space-y-4">
      {/* Profile Header */}
      <Card className="overflow-hidden border-0 shadow-lg bg-gradient-to-br from-white to-gray-50">
        <CardContent className="p-4 md:p-6">
          <div className="flex items-center gap-3 md:gap-4 mb-4 md:mb-6">
            <Avatar className="w-12 h-12 md:w-16 md:h-16 ring-2 md:ring-4 ring-blue-100">
              <AvatarImage src={farcasterUser?.pfpUrl} alt="Profile" />
              <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-500 text-white text-lg md:text-xl font-bold">
                {farcasterUser?.username
                  ? farcasterUser.username.charAt(0).toUpperCase()
                  : accountAddress
                  ? `${accountAddress.slice(0, 2)}${accountAddress.slice(-2)}`
                  : "?"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h2 className="text-lg md:text-2xl font-bold text-gray-900 truncate">
                {farcasterUser?.username
                  ? `@${farcasterUser.username}`
                  : "Anonymous Trader"}
              </h2>
              <p className="text-xs md:text-sm text-gray-500 font-mono truncate">
                {accountAddress
                  ? `${accountAddress.slice(0, 6)}...${accountAddress.slice(
                      -4
                    )}`
                  : "Not connected"}
              </p>
              {farcasterUser?.fid && (
                <p className="text-xs text-blue-600 font-medium">
                  Farcaster ID: {farcasterUser.fid}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Button
                onClick={handleShare}
                variant="outline"
                size="sm"
                className="flex items-center gap-1 md:gap-2 text-blue-600 border-blue-200 hover:bg-blue-50 h-8 md:h-9 text-xs md:text-sm px-2 md:px-3"
              >
                <Share2 className="w-3 h-3 md:w-4 md:h-4" />
                <span className="hidden sm:inline">Share Stats</span>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Claim Winnings inserted directly after Profile Header */}
      <ClaimWinningsSection />

      {/* V1 vs V2 Performance Breakdown */}
      {(stats.v1Markets > 0 || stats.v2Markets > 0) && (
        <Card className="overflow-hidden border-0 shadow-lg bg-gradient-to-br from-white to-gray-50">
          <CardHeader className="bg-gradient-to-r from-green-600 to-teal-600 text-white pb-3 md:pb-6">
            <CardTitle className="text-lg md:text-xl font-bold">
              Market Performance Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 md:p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
              {/* V1 Binary Markets */}
              <div className="space-y-3">
                <h3 className="text-base md:text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <span className="w-2 h-2 md:w-3 md:h-3 bg-blue-500 rounded-full"></span>
                  Binary Markets
                </h3>
                <div className="grid grid-cols-2 gap-2 md:gap-3">
                  <StatCard
                    label="Markets"
                    value={stats.v1Markets}
                    icon="📊"
                    color="text-blue-600"
                    bgColor="bg-blue-50"
                  />
                  <StatCard
                    label="Win Rate"
                    value={`${
                      stats.v1Markets > 0
                        ? (
                            (stats.v1Wins / (stats.v1Wins + stats.v1Losses)) *
                            100
                          ).toFixed(1)
                        : 0
                    }%`}
                    icon="🎯"
                    color="text-blue-600"
                    bgColor="bg-blue-50"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 md:gap-3">
                  <StatCard
                    label="Wins"
                    value={stats.v1Wins}
                    icon="✅"
                    color="text-green-600"
                    bgColor="bg-green-50"
                  />
                  <StatCard
                    label="Losses"
                    value={stats.v1Losses}
                    icon="❌"
                    color="text-red-600"
                    bgColor="bg-red-50"
                  />
                </div>
                <div className="text-xs md:text-sm text-gray-600">
                  Classic binary prediction markets with Yes/No options
                </div>
              </div>

              {/* V2 Multi-Option Markets */}
              <div className="space-y-3">
                <h3 className="text-base md:text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <span className="w-2 h-2 md:w-3 md:h-3 bg-green-500 rounded-full"></span>
                  Multi-Option Markets
                </h3>
                <div className="grid grid-cols-2 gap-2 md:gap-3">
                  <StatCard
                    label="Markets"
                    value={stats.v2Markets}
                    icon="📈"
                    color="text-green-600"
                    bgColor="bg-green-50"
                  />
                  <StatCard
                    label="Win Rate"
                    value={`${
                      stats.v2Markets > 0
                        ? (
                            (stats.v2Wins / (stats.v2Wins + stats.v2Losses)) *
                            100
                          ).toFixed(1)
                        : 0
                    }%`}
                    icon="🎯"
                    color="text-green-600"
                    bgColor="bg-green-50"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 md:gap-3">
                  <StatCard
                    label="Wins"
                    value={stats.v2Wins}
                    icon="✅"
                    color="text-green-600"
                    bgColor="bg-green-50"
                  />
                  <StatCard
                    label="Losses"
                    value={stats.v2Losses}
                    icon="❌"
                    color="text-red-600"
                    bgColor="bg-red-50"
                  />
                </div>
                <div className="text-xs md:text-sm text-gray-600">
                  Advanced markets with up to 10 different outcome options
                </div>

                {/* V2 Portfolio Details */}
                {stats.v2Portfolio && (
                  <div className="mt-4 p-3 bg-green-25 border border-green-200 rounded-lg">
                    <h4 className="text-sm font-semibold text-green-800 mb-2">
                      Portfolio Details
                    </h4>
                    <div className="grid grid-cols-2 gap-2 text-xs mb-2">
                      <div>
                        <span className="text-gray-600">Total Trades:</span>
                        <span className="ml-1 font-medium">
                          {stats.v2TradeCount}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Contract Trades:</span>
                        <span className="ml-1 font-medium">
                          {stats.v2Portfolio.tradeCount}
                        </span>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-gray-600">Invested:</span>
                        <span className="ml-1 font-medium">
                          {formatAmount(stats.v2Portfolio.totalInvested)}{" "}
                          {tokenSymbol}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Winnings:</span>
                        <span className="ml-1 font-medium">
                          {formatAmount(stats.v2Portfolio.totalWinnings)}{" "}
                          {tokenSymbol}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Realized P&L:</span>
                        <span
                          className={`ml-1 font-medium ${
                            Number(stats.v2Portfolio.realizedPnL) >= 0
                              ? "text-green-600"
                              : "text-red-600"
                          }`}
                        >
                          {formatSignedAmount(stats.v2Portfolio.realizedPnL)}{" "}
                          {tokenSymbol}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-600">Unrealized P&L:</span>
                        <span
                          className={`ml-1 font-medium ${
                            Number(stats.v2Portfolio.unrealizedPnL) >= 0
                              ? "text-green-600"
                              : "text-red-600"
                          }`}
                        >
                          {formatSignedAmount(stats.v2Portfolio.unrealizedPnL)}{" "}
                          {tokenSymbol}
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
  bgColor,
  fullWidth = false,
}: {
  label: string;
  value: string | number;
  icon: string;
  color: string;
  bgColor: string;
  fullWidth?: boolean;
}) {
  return (
    <div
      className={`p-3 md:p-4 rounded-lg border border-gray-100 ${bgColor} ${
        fullWidth ? "col-span-2" : ""
      }`}
    >
      <div className="flex items-center gap-2 md:gap-3">
        <span className="text-lg md:text-2xl">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs md:text-sm font-medium text-gray-600 truncate">
            {label}
          </p>
          <p className={`text-sm md:text-lg font-bold ${color} truncate`}>
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="space-y-4">
      {/* Profile Header Skeleton */}
      <Card className="overflow-hidden border-0 shadow-lg">
        <CardContent className="p-6">
          <div className="flex items-center gap-4 mb-6">
            <Skeleton className="w-16 h-16 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <div className="flex flex-col gap-2">
              <Skeleton className="h-8 w-24" />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-0 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-gray-200 to-gray-300">
          <Skeleton className="h-6 w-1/2 bg-white/20" />
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex items-center justify-center">
              <Skeleton className="w-32 h-32 rounded-full" />
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[...Array(2)].map((_, i) => (
                  <div key={i} className="p-4 bg-gray-50 rounded-lg">
                    <Skeleton className="h-5 w-2/3 mb-2" />
                    <Skeleton className="h-6 w-1/2" />
                  </div>
                ))}
              </div>
              {[...Array(2)].map((_, i) => (
                <div key={i + 2} className="p-4 bg-gray-50 rounded-lg">
                  <Skeleton className="h-5 w-2/3 mb-2" />
                  <Skeleton className="h-6 w-1/2" />
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <Card key={i} className="p-4 text-center border-0 shadow-md">
            <Skeleton className="h-8 w-1/2 mx-auto mb-2" />
            <Skeleton className="h-4 w-2/3 mx-auto" />
          </Card>
        ))}
      </div>
    </div>
  );
}
