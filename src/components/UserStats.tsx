"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useReadContract } from "wagmi";
import { type Address } from "viem";
import { useToast } from "@/components/ui/use-toast";
import {
  publicClient,
  contractAddress,
  contractAbi,
  tokenAddress as defaultTokenAddress,
  tokenAbi as defaultTokenAbi,
} from "@/constants/contract";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useFarcasterUser } from "@/hooks/useFarcasterUser";
import { Share2, Copy, ExternalLink } from "lucide-react";

interface Vote {
  marketId: number;
  isOptionA: boolean;
  amount: bigint;
  timestamp: bigint;
}

interface MarketInfo {
  question: string;
  optionA: string;
  optionB: string;
  outcome: number; // 0: Pending, 1: OptionA, 2: OptionB, 3: Invalid
  resolved: boolean;
}

interface UserStatsData {
  totalVotes: number;
  wins: number;
  losses: number;
  winRate: number;
  totalInvested: bigint;
  netWinnings: bigint;
}

const CACHE_KEY_STATS = "user_stats_cache_v1";
const CACHE_TTL_STATS = 60 * 60; // 1 hour in seconds

export function UserStats() {
  const { address: accountAddress, isConnected } = useAccount();
  const { toast } = useToast();
  const farcasterUser = useFarcasterUser();
  const [stats, setStats] = useState<UserStatsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tokenSymbol, setTokenSymbol] = useState<string>("BSTR");
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

  const fetchUserStats = useCallback(
    async (address: Address) => {
      setIsLoading(true);
      try {
        const cached = localStorage.getItem(`${CACHE_KEY_STATS}_${address}`);
        if (cached) {
          const data = JSON.parse(cached);
          if (Date.now() - data.timestamp < CACHE_TTL_STATS * 1000) {
            // Convert string values back to BigInt
            const cachedStats = {
              ...data.stats,
              totalInvested: BigInt(data.stats.totalInvested),
              netWinnings: BigInt(data.stats.netWinnings),
            };
            setStats(cachedStats);
            setIsLoading(false);
            return;
          }
        }

        const voteCount = (await publicClient.readContract({
          address: contractAddress,
          abi: contractAbi,
          functionName: "getVoteHistoryCount",
          args: [address],
        })) as bigint;

        if (voteCount === 0n) {
          setStats({
            totalVotes: 0,
            wins: 0,
            losses: 0,
            winRate: 0,
            totalInvested: 0n,
            netWinnings: 0n,
          });
          setIsLoading(false);
          return;
        }

        const allVotes: Vote[] = [];
        for (let i = 0; i < voteCount; i += 50) {
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
            }))
          );
        }

        const marketIds = [...new Set(allVotes.map((v) => v.marketId))];
        const marketInfosData = await publicClient.readContract({
          address: contractAddress,
          abi: contractAbi,
          functionName: "getMarketInfoBatch",
          args: [marketIds.map(BigInt)],
        });

        const marketInfos: Record<number, MarketInfo> = {};
        marketIds.forEach((id, i) => {
          marketInfos[id] = {
            question: marketInfosData[0][i],
            optionA: marketInfosData[1][i],
            optionB: marketInfosData[2][i],
            outcome: marketInfosData[4][i],
            resolved: marketInfosData[7][i],
          };
        });

        let wins = 0;
        let losses = 0;
        const totalInvested = allVotes.reduce((acc, v) => acc + v.amount, 0n);

        allVotes.forEach((vote) => {
          const market = marketInfos[vote.marketId];
          if (market && market.resolved) {
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
        });

        const totalVotes = wins + losses;
        const winRate = totalVotes > 0 ? (wins / totalVotes) * 100 : 0;

        const newStats = {
          totalVotes,
          wins,
          losses,
          winRate,
          totalInvested,
          netWinnings: totalWinnings,
        };
        setStats(newStats);

        // Convert BigInt values to strings for localStorage
        const statsForCache = {
          ...newStats,
          totalInvested: newStats.totalInvested.toString(),
          netWinnings: newStats.netWinnings.toString(),
        };
        localStorage.setItem(
          `${CACHE_KEY_STATS}_${address}`,
          JSON.stringify({ stats: statsForCache, timestamp: Date.now() })
        );
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
    [toast, totalWinnings]
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

  const handleShare = async () => {
    const baseUrl = window.location.origin;
    const params = new URLSearchParams({
      address: accountAddress!,
      ...(farcasterUser?.username && { username: farcasterUser.username }),
      ...(farcasterUser?.pfpUrl && { pfpUrl: farcasterUser.pfpUrl }),
      ...(farcasterUser?.fid && { fid: farcasterUser.fid.toString() }),
    });

    const shareUrl = `${baseUrl}/profile/${accountAddress}?${params.toString()}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `${
            farcasterUser?.username ? `@${farcasterUser.username}` : "My"
          }'s Stats - Buster Markets`,
          text: `Check out my prediction market performance on Buster Markets!`,
          url: shareUrl,
        });
      } catch (error) {
        console.log("Error sharing:", error);
        // Fallback to copy to clipboard
        copyToClipboard(shareUrl);
      }
    } else {
      copyToClipboard(shareUrl);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Link Copied!",
        description: "Share link has been copied to your clipboard.",
      });
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
      toast({
        title: "Error",
        description: "Failed to copy link to clipboard.",
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
              <Button
                onClick={() => {
                  const baseUrl = window.location.origin;
                  const params = new URLSearchParams({
                    address: accountAddress!,
                    ...(farcasterUser?.username && {
                      username: farcasterUser.username,
                    }),
                    ...(farcasterUser?.pfpUrl && {
                      pfpUrl: farcasterUser.pfpUrl,
                    }),
                    ...(farcasterUser?.fid && {
                      fid: farcasterUser.fid.toString(),
                    }),
                  });
                  const imageUrl = `${baseUrl}/api/user-stats-image?${params.toString()}`;
                  window.open(imageUrl, "_blank");
                }}
                variant="ghost"
                size="sm"
                className="flex items-center gap-2 text-gray-600 hover:text-gray-800"
              >
                <ExternalLink className="w-4 h-4" />
                View Image
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
