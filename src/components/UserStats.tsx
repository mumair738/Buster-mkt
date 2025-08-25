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
} from "@/constants/contract";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useFarcasterUser } from "@/hooks/useFarcasterUser";
import { Share2 } from "lucide-react";
import { sdk } from "@farcaster/miniapp-sdk";

interface Vote {
  marketId: number;
  isOptionA: boolean;
  amount: bigint;
  timestamp: bigint;
  version: "v1" | "v2";
  // V2 specific fields
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
  const { data: v2Portfolio } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getUserPortfolio",
    args: [accountAddress!],
    query: { enabled: !!accountAddress },
  });

  const { data: v2TotalWinnings } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "totalWinnings",
    args: [accountAddress!],
    query: { enabled: !!accountAddress },
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
        const v2TradeCount = v2Portfolio
          ? Number((v2Portfolio as any).tradeCount || 0)
          : 0;

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
            v2Portfolio: v2Portfolio
              ? {
                  totalInvested: BigInt(
                    (v2Portfolio as any).totalInvested || 0
                  ),
                  totalWinnings: BigInt(
                    (v2Portfolio as any).totalWinnings || 0
                  ),
                  unrealizedPnL: BigInt(
                    (v2Portfolio as any).unrealizedPnL || 0
                  ),
                  realizedPnL: BigInt((v2Portfolio as any).realizedPnL || 0),
                  tradeCount: Number((v2Portfolio as any).tradeCount || 0),
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
          if (v2Portfolio) {
            const tradeCount = Number((v2Portfolio as any).tradeCount || 0);

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
              }
            }
          }
        } catch (error) {
          console.warn("V2 trade history error:", error);
        }

        // Get V2 market IDs from trades
        const v2MarketIds = [...new Set(v2Trades.map((t) => t.marketId))];

        // Fetch V2 market info for win/loss calculation
        const v2MarketInfos: Record<number, any> = {};
        if (v2MarketIds.length > 0) {
          try {
            for (const marketId of v2MarketIds) {
              const marketInfo = await publicClient.readContract({
                address: V2contractAddress,
                abi: V2contractAbi,
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
          if (trade.buyer.toLowerCase() === address.toLowerCase()) {
            v2UserPositions[trade.marketId][trade.optionId] += trade.quantity;
          } else if (trade.seller.toLowerCase() === address.toLowerCase()) {
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
        const v2TotalInvested = v2Portfolio
          ? BigInt((v2Portfolio as any).totalInvested || 0)
          : 0n;
        const combinedTotalInvested = totalInvested + v2TotalInvested;

        // Combine V1 and V2 winnings
        const v2TotalWinningsAmount =
          (v2TotalWinnings as bigint | undefined) ?? 0n;
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
          v2Portfolio: v2Portfolio
            ? {
                totalInvested: BigInt((v2Portfolio as any).totalInvested || 0),
                totalWinnings: BigInt((v2Portfolio as any).totalWinnings || 0),
                unrealizedPnL: BigInt((v2Portfolio as any).unrealizedPnL || 0),
                realizedPnL: BigInt((v2Portfolio as any).realizedPnL || 0),
                tradeCount: Number((v2Portfolio as any).tradeCount || 0),
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
    [toast, totalWinnings, v2Portfolio, v2TotalWinnings]
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
    <div className="space-y-4">
      {/* Profile Header */}
      <Card className="overflow-hidden border-0 shadow-lg bg-gradient-to-br from-white to-gray-50">
        <CardContent className="p-6">
          <div className="flex items-center gap-4 mb-6">
            <Avatar className="w-16 h-16 ring-4 ring-blue-100">
              <AvatarImage src={farcasterUser?.pfpUrl} alt="Profile" />
              <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-500 text-white text-xl font-bold">
                {farcasterUser?.username
                  ? farcasterUser.username.charAt(0).toUpperCase()
                  : accountAddress
                  ? `${accountAddress.slice(0, 2)}${accountAddress.slice(-2)}`
                  : "?"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-gray-900">
                {farcasterUser?.username
                  ? `@${farcasterUser.username}`
                  : "Anonymous Trader"}
              </h2>
              <p className="text-sm text-gray-500 font-mono">
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
                className="flex items-center gap-2 text-blue-600 border-blue-200 hover:bg-blue-50"
              >
                <Share2 className="w-4 h-4" />
                Share Stats
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-0 shadow-lg bg-gradient-to-br from-white to-gray-50">
        <CardHeader className="bg-gradient-to-r from-blue-600 to-purple-600 text-white">
          <CardTitle className="text-xl font-bold">
            Performance Overview
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Win Rate Circle */}
            <div className="flex items-center justify-center">
              <div className="relative w-32 h-32">
                <svg
                  className="w-full h-full transform -rotate-90"
                  viewBox="0 0 100 100"
                >
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="transparent"
                    className="text-gray-200"
                  />
                  <circle
                    cx="50"
                    cy="50"
                    r="40"
                    stroke="currentColor"
                    strokeWidth="8"
                    fill="transparent"
                    strokeDasharray={`${2 * Math.PI * 40}`}
                    strokeDashoffset={`${
                      2 * Math.PI * 40 * (1 - stats.winRate / 100)
                    }`}
                    className="text-green-500 transition-all duration-1000 ease-out"
                    style={{
                      strokeLinecap: "round",
                    }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {stats.winRate.toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-500">Win Rate</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <StatCard
                  label="Wins"
                  value={stats.wins}
                  icon="🎯"
                  color="text-green-600"
                  bgColor="bg-green-50"
                />
                <StatCard
                  label="Losses"
                  value={stats.losses}
                  icon="❌"
                  color="text-red-600"
                  bgColor="bg-red-50"
                />
              </div>

              <StatCard
                label="Total Invested"
                value={`${formatAmount(stats.totalInvested)} ${tokenSymbol}`}
                icon="💰"
                color="text-blue-600"
                bgColor="bg-blue-50"
                fullWidth
              />

              <StatCard
                label="Net Winnings"
                value={`${formatAmount(stats.netWinnings)} ${tokenSymbol}`}
                icon={Number(stats.netWinnings) >= 0 ? "📈" : "📉"}
                color={
                  Number(stats.netWinnings) >= 0
                    ? "text-green-600"
                    : "text-red-600"
                }
                bgColor={
                  Number(stats.netWinnings) >= 0 ? "bg-green-50" : "bg-red-50"
                }
                fullWidth
              />

              {/* Total P&L (V2 Only) */}
              {stats.v2Portfolio && (
                <StatCard
                  label="Total P&L (V2)"
                  value={`${formatSignedAmount(
                    stats.v2Portfolio.realizedPnL +
                      stats.v2Portfolio.unrealizedPnL
                  )} ${tokenSymbol}`}
                  icon={
                    Number(
                      stats.v2Portfolio.realizedPnL +
                        stats.v2Portfolio.unrealizedPnL
                    ) >= 0
                      ? "💰"
                      : "📉"
                  }
                  color={
                    Number(
                      stats.v2Portfolio.realizedPnL +
                        stats.v2Portfolio.unrealizedPnL
                    ) >= 0
                      ? "text-green-600"
                      : "text-red-600"
                  }
                  bgColor={
                    Number(
                      stats.v2Portfolio.realizedPnL +
                        stats.v2Portfolio.unrealizedPnL
                    ) >= 0
                      ? "bg-green-50"
                      : "bg-red-50"
                  }
                  fullWidth
                />
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-4 text-center border-0 shadow-md bg-gradient-to-br from-blue-50 to-blue-100">
          <div className="text-2xl font-bold text-blue-700">
            {stats.totalVotes}
          </div>
          <div className="text-xs font-medium text-blue-600">Total Votes</div>
        </Card>

        <Card className="p-4 text-center border-0 shadow-md bg-gradient-to-br from-purple-50 to-purple-100">
          <div className="text-2xl font-bold text-purple-700">
            {((stats.wins / Math.max(stats.totalVotes, 1)) * 100).toFixed(0)}%
          </div>
          <div className="text-xs font-medium text-purple-600">
            Success Rate
          </div>
        </Card>

        <Card className="p-4 text-center border-0 shadow-md bg-gradient-to-br from-indigo-50 to-indigo-100">
          <div className="text-2xl font-bold text-indigo-700">
            {stats.totalVotes > 0
              ? (
                  Number(stats.totalInvested) /
                  stats.totalVotes /
                  10 ** tokenDecimals
                ).toFixed(0)
              : 0}
          </div>
          <div className="text-xs font-medium text-indigo-600">Avg Bet</div>
        </Card>
      </div>

      {/* V1 vs V2 Performance Breakdown */}
      {(stats.v1Markets > 0 || stats.v2Markets > 0) && (
        <Card className="overflow-hidden border-0 shadow-lg bg-gradient-to-br from-white to-gray-50">
          <CardHeader className="bg-gradient-to-r from-green-600 to-teal-600 text-white">
            <CardTitle className="text-xl font-bold">
              Market Performance Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* V1 Binary Markets */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <span className="w-3 h-3 bg-blue-500 rounded-full"></span>
                  Binary Markets (V1)
                </h3>
                <div className="grid grid-cols-2 gap-3">
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
                <div className="grid grid-cols-2 gap-3">
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
                <div className="text-sm text-gray-600">
                  Classic binary prediction markets with Yes/No options
                </div>
              </div>

              {/* V2 Multi-Option Markets */}
              <div className="space-y-3">
                <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                  Multi-Option Markets (V2)
                </h3>
                <div className="grid grid-cols-2 gap-3">
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
                <div className="grid grid-cols-2 gap-3">
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
                <div className="text-sm text-gray-600">
                  Advanced markets with up to 10 different outcome options
                </div>

                {/* V2 Portfolio Details */}
                {stats.v2Portfolio && (
                  <div className="mt-4 p-3 bg-green-25 border border-green-200 rounded-lg">
                    <h4 className="text-sm font-semibold text-green-800 mb-2">
                      V2 Portfolio Details
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

            {/* Market Distribution */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <h4 className="text-lg font-semibold text-gray-800 mb-4">
                Market Activity Distribution
              </h4>
              <div className="flex h-4 bg-gray-200 rounded-full overflow-hidden">
                {stats.v1Markets > 0 && (
                  <div
                    className="bg-blue-500 flex items-center justify-center text-xs text-white font-medium"
                    style={{
                      width: `${
                        (stats.v1Markets /
                          (stats.v1Markets + stats.v2Markets)) *
                        100
                      }%`,
                      minWidth: stats.v1Markets > 0 ? "20%" : "0%",
                    }}
                  >
                    {stats.v1Markets > 0 &&
                      (
                        (stats.v1Markets /
                          (stats.v1Markets + stats.v2Markets)) *
                        100
                      ).toFixed(0)}
                    %
                  </div>
                )}
                {stats.v2Markets > 0 && (
                  <div
                    className="bg-green-500 flex items-center justify-center text-xs text-white font-medium"
                    style={{
                      width: `${
                        (stats.v2Markets /
                          (stats.v1Markets + stats.v2Markets)) *
                        100
                      }%`,
                      minWidth: stats.v2Markets > 0 ? "20%" : "0%",
                    }}
                  >
                    {stats.v2Markets > 0 &&
                      (
                        (stats.v2Markets /
                          (stats.v1Markets + stats.v2Markets)) *
                        100
                      ).toFixed(0)}
                    %
                  </div>
                )}
              </div>
              <div className="flex justify-between mt-2 text-sm text-gray-600">
                <span>V1 Binary: {stats.v1Markets} markets</span>
                <span>V2 Multi-Option: {stats.v2Markets} markets</span>
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
      className={`p-4 rounded-lg border border-gray-100 ${bgColor} ${
        fullWidth ? "col-span-2" : ""
      }`}
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl">{icon}</span>
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600">{label}</p>
          <p className={`text-lg font-bold ${color}`}>{value}</p>
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
