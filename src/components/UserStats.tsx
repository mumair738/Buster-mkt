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
import { Share2, TrendingUp, TrendingDown } from "lucide-react";
import { sdk } from "@farcaster/miniapp-sdk";
import { ClaimWinningsSection } from "@/components/ClaimWinningsButton";

interface Vote {
  marketId: number;
  isOptionA: boolean;
  amount: bigint;
  timestamp: bigint;
  version: "v1" | "v2";
  optionId?: number;
}

interface MarketInfo {
  question: string;
  optionA?: string;
  optionB?: string;
  options?: string[];
  outcome: number;
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
  v1Markets: number;
  v2Markets: number;
  v1Wins: number;
  v1Losses: number;
  v2Wins: number;
  v2Losses: number;
  v2TradeCount: number;
  v2Portfolio?: {
    totalInvested: bigint;
    totalWinnings: bigint;
    unrealizedPnL: bigint;
    realizedPnL: bigint;
    tradeCount: number;
  };
}

const CACHE_KEY_STATS = "user_stats_cache_v2";
const CACHE_TTL_STATS = 60 * 60;

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

  type V2PortfolioTuple = readonly [bigint, bigint, bigint, bigint, bigint];
  const { data: v2PortfolioTuple } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "userPortfolios",
    args: [accountAddress!],
    query: { enabled: !!accountAddress },
  });

  const { data: calculatedUnrealizedPnL } = useReadContract({
    address: PolicastViews,
    abi: PolicastViewsAbi,
    functionName: "calculateUnrealizedPnL",
    args: [accountAddress!],
    query: {
      enabled: !!accountAddress,
      refetchInterval: 30000,
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
              const cachedStats = {
                ...data.stats,
                totalInvested: BigInt(data.stats.totalInvested),
                netWinnings: BigInt(data.stats.netWinnings),
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
            localStorage.removeItem(`${CACHE_KEY_STATS}_${address}`);
          }
        }

        const [v1VoteCount] = await Promise.all([
          publicClient.readContract({
            address: contractAddress,
            abi: contractAbi,
            functionName: "getVoteHistoryCount",
            args: [address],
          }) as Promise<bigint>,
        ]);

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
                    (calculatedUnrealizedPnL as bigint | undefined) ?? 0n,
                  realizedPnL: v2PortfolioTuple[3],
                  tradeCount: Number(v2PortfolioTuple[4]),
                }
              : undefined,
          });
          setIsLoading(false);
          return;
        }

        const allVotes: Vote[] = [];

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

        const v2Trades: any[] = [];
        try {
          if (v2PortfolioTuple) {
            const tradeCount = Number(v2PortfolioTuple[4]);

            if (tradeCount > 0) {
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
        }
        const v2MarketIds = [...new Set(v2Trades.map((t) => t.marketId))];

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

        const v1MarketIds = [
          ...new Set(
            allVotes.filter((v) => v.version === "v1").map((v) => v.marketId)
          ),
        ];

        const marketInfos: Record<number, MarketInfo> = {};

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

        allVotes.forEach((vote) => {
          const market = marketInfos[vote.marketId];
          if (market && market.resolved) {
            if (market.version === "v1") {
              v1Markets++;
              const won =
                (vote.isOptionA && market.outcome === 1) ||
                (!vote.isOptionA && market.outcome === 2);
              if (won) {
                wins++;
              } else if (market.outcome !== 0 && market.outcome !== 3) {
                losses++;
              }
            }
          }
        });

        const v2UserPositions: Record<number, Record<number, bigint>> = {};

        v2Trades.forEach((trade) => {
          if (!v2UserPositions[trade.marketId]) {
            v2UserPositions[trade.marketId] = {};
          }
          if (!v2UserPositions[trade.marketId][trade.optionId]) {
            v2UserPositions[trade.marketId][trade.optionId] = 0n;
          }

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

        Object.entries(v2UserPositions).forEach(([marketIdStr, positions]) => {
          const marketId = Number(marketIdStr);
          const marketInfo = v2MarketInfos[marketId];

          if (marketInfo && marketInfo.resolved) {
            const winningOptionId = marketInfo.winningOptionId;
            let userWon = false;

            Object.entries(positions).forEach(([optionIdStr, quantity]) => {
              const optionId = Number(optionIdStr);
              if (optionId === winningOptionId && quantity > 0n) {
                userWon = true;
              }
            });

            if (userWon) {
              v2Wins++;
            } else {
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

        const v2TotalInvested = v2PortfolioTuple ? v2PortfolioTuple[0] : 0n;
        const combinedTotalInvested = totalInvested + v2TotalInvested;

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
                  (calculatedUnrealizedPnL as bigint | undefined) ?? 0n,
                realizedPnL: v2PortfolioTuple[3],
                tradeCount: Number(v2PortfolioTuple[4]),
              }
            : undefined,
        };
        setStats(newStats);

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
    <div className="space-y-3">
      {/* Compact Profile Header */}
      <Card className="border-0 shadow-lg bg-gradient-to-br from-slate-900 via-blue-900 to-slate-900 text-white overflow-hidden relative">
        <div className="absolute inset-0 bg-grid-white/[0.05] [mask-image:radial-gradient(white,transparent_85%)]" />
        <CardContent className="p-4 relative">
          <div className="flex items-center gap-3">
            <Avatar className="w-12 h-12 ring-2 ring-white/30">
              <AvatarImage src={farcasterUser?.pfpUrl} alt="Profile" />
              <AvatarFallback className="bg-gradient-to-br from-blue-500 to-purple-500 text-white font-bold">
                {farcasterUser?.username
                  ? farcasterUser.username.charAt(0).toUpperCase()
                  : accountAddress
                  ? `${accountAddress.slice(0, 2)}${accountAddress.slice(-2)}`
                  : "?"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-bold truncate">
                {farcasterUser?.username
                  ? `@${farcasterUser.username}`
                  : "Anonymous Trader"}
              </h2>
              <p className="text-xs text-white/60 font-mono truncate">
                {accountAddress
                  ? `${accountAddress.slice(0, 6)}...${accountAddress.slice(
                      -4
                    )}`
                  : "Not connected"}
              </p>
            </div>
            <Button
              onClick={handleShare}
              size="sm"
              className="h-8 px-3 bg-white/10 hover:bg-white/20 text-white border border-white/20 backdrop-blur-sm"
            >
              <Share2 className="w-3.5 h-3.5" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Claim Winnings */}
      <ClaimWinningsSection />

      {/* Compact Performance Cards */}
      {(stats.v1Markets > 0 || stats.v2Markets > 0) && (
        <div className="grid grid-cols-2 gap-3">
          {/* Binary Markets */}
          <Card className="border-0 shadow-md bg-gradient-to-br from-blue-50 to-cyan-50 overflow-hidden relative">
            <div className="absolute top-0 right-0 w-20 h-20 bg-blue-500/10 rounded-full blur-2xl" />
            <CardContent className="p-4 relative">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-xs font-medium text-blue-600 mb-0.5">
                    Binary Markets v1
                  </p>
                  <p className="text-2xl font-bold text-gray-900">
                    {stats.v1Markets}
                  </p>
                </div>
                <div className="p-2 bg-blue-500/10 rounded-lg">
                  <span className="text-lg">📊</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">Win Rate</span>
                  <span className="font-bold text-blue-600">
                    {stats.v1Markets > 0
                      ? (
                          (stats.v1Wins / (stats.v1Wins + stats.v1Losses)) *
                          100
                        ).toFixed(1)
                      : 0}
                    %
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">W/L</span>
                  <span className="font-medium text-gray-900">
                    {stats.v1Wins}/{stats.v1Losses}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Multi-Option Markets */}
          <Card className="border-0 shadow-md bg-gradient-to-br from-emerald-50 to-teal-50 overflow-hidden relative">
            <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-500/10 rounded-full blur-2xl" />
            <CardContent className="p-4 relative">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-xs font-medium text-emerald-600 mb-0.5">
                    Multi-Option
                  </p>
                  <p className="text-2xl font-bold text-gray-900">
                    {stats.v2Markets}
                  </p>
                </div>
                <div className="p-2 bg-emerald-500/10 rounded-lg">
                  <span className="text-lg">📈</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">Win Rate</span>
                  <span className="font-bold text-emerald-600">
                    {stats.v2Markets > 0
                      ? (
                          (stats.v2Wins / (stats.v2Wins + stats.v2Losses)) *
                          100
                        ).toFixed(1)
                      : 0}
                    %
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-gray-600">W/L</span>
                  <span className="font-medium text-gray-900">
                    {stats.v2Wins}/{stats.v2Losses}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* V2 Portfolio Details */}
      {stats.v2Portfolio && (
        <Card className="border-0 shadow-md bg-white">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-bold text-gray-900">
              Portfolio Overview
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 mb-0.5">Total Trades</p>
                <p className="text-lg font-bold text-gray-900">
                  {stats.v2TradeCount}
                </p>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <p className="text-xs text-gray-500 mb-0.5">Contract Trades</p>
                <p className="text-lg font-bold text-gray-900">
                  {stats.v2Portfolio.tradeCount}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 bg-blue-50 rounded-lg">
                <p className="text-xs text-blue-600 mb-0.5">Invested</p>
                <p className="text-sm font-bold text-gray-900 truncate">
                  {formatAmount(stats.v2Portfolio.totalInvested)}
                </p>
                <p className="text-xs text-gray-500">{tokenSymbol}</p>
              </div>
              <div className="p-3 bg-green-50 rounded-lg">
                <p className="text-xs text-green-600 mb-0.5">Winnings</p>
                <p className="text-sm font-bold text-gray-900 truncate">
                  {formatAmount(stats.v2Portfolio.totalWinnings)}
                </p>
                <p className="text-xs text-gray-500">{tokenSymbol}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div
                className={`p-3 rounded-lg ${
                  Number(stats.v2Portfolio.realizedPnL) >= 0
                    ? "bg-emerald-50"
                    : "bg-red-50"
                }`}
              >
                <div className="flex items-center gap-1 mb-0.5">
                  {Number(stats.v2Portfolio.realizedPnL) >= 0 ? (
                    <TrendingUp className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <TrendingDown className="w-3 h-3 text-red-600" />
                  )}
                  <p
                    className={`text-xs font-medium ${
                      Number(stats.v2Portfolio.realizedPnL) >= 0
                        ? "text-emerald-600"
                        : "text-red-600"
                    }`}
                  >
                    Realized P&L
                  </p>
                </div>
                <p
                  className={`text-sm font-bold ${
                    Number(stats.v2Portfolio.realizedPnL) >= 0
                      ? "text-emerald-700"
                      : "text-red-700"
                  } truncate`}
                >
                  {formatSignedAmount(stats.v2Portfolio.realizedPnL)}
                </p>
                <p className="text-xs text-gray-500">{tokenSymbol}</p>
              </div>
              <div
                className={`p-3 rounded-lg ${
                  Number(stats.v2Portfolio.unrealizedPnL) >= 0
                    ? "bg-emerald-50"
                    : "bg-red-50"
                }`}
              >
                <div className="flex items-center gap-1 mb-0.5">
                  {Number(stats.v2Portfolio.unrealizedPnL) >= 0 ? (
                    <TrendingUp className="w-3 h-3 text-emerald-600" />
                  ) : (
                    <TrendingDown className="w-3 h-3 text-red-600" />
                  )}
                  <p
                    className={`text-xs font-medium ${
                      Number(stats.v2Portfolio.unrealizedPnL) >= 0
                        ? "text-emerald-600"
                        : "text-red-600"
                    }`}
                  >
                    Unrealized P&L
                  </p>
                </div>
                <p
                  className={`text-sm font-bold ${
                    Number(stats.v2Portfolio.unrealizedPnL) >= 0
                      ? "text-emerald-700"
                      : "text-red-700"
                  } truncate`}
                >
                  {formatSignedAmount(stats.v2Portfolio.unrealizedPnL)}
                </p>
                <p className="text-xs text-gray-500">{tokenSymbol}</p>
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
      className={`p-3 rounded-lg border border-gray-100 ${bgColor} ${
        fullWidth ? "col-span-2" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-xl">{icon}</span>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-600 truncate">{label}</p>
          <p className={`text-base font-bold ${color} truncate`}>{value}</p>
        </div>
      </div>
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="space-y-3">
      <Card className="border-0 shadow-lg">
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Skeleton className="w-12 h-12 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-8 w-8" />
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        {[...Array(2)].map((_, i) => (
          <Card key={i} className="border-0 shadow-md">
            <CardContent className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="space-y-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-8 w-12" />
                </div>
                <Skeleton className="w-8 h-8 rounded-lg" />
              </div>
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="border-0 shadow-md">
        <CardHeader className="pb-3">
          <Skeleton className="h-4 w-32" />
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="p-3 bg-gray-50 rounded-lg">
                <Skeleton className="h-3 w-16 mb-2" />
                <Skeleton className="h-6 w-12" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
