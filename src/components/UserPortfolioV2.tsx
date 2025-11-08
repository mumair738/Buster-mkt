"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useAccount, useReadContract } from "wagmi";
import { type Address } from "viem";
import { useToast } from "@/components/ui/use-toast";
import {
  publicClient,
  V2contractAddress,
  V2contractAbi,
  tokenAddress as defaultTokenAddress,
  tokenAbi as defaultTokenAbi,
  PolicastViews,
  PolicastViewsAbi,
} from "@/constants/contract";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  PieChart,
  BarChart3,
  RefreshCw,
} from "lucide-react";
import { useUserPortfolio } from "@/hooks/useSubgraphData";

interface UserPortfolio {
  totalInvested: string;
  totalWinnings: string;
  unrealizedPnL: string;
  realizedPnL: string;
  tradeCount: number;
}

interface MarketPosition {
  marketId: number;
  marketName: string;
  options: string[];
  userShares: bigint[];
  currentPrices: bigint[];
  totalValue: bigint;
  invested: bigint;
  pnl: bigint;
  resolved: boolean;
  winningOption?: number;
}

interface Trade {
  marketId: number;
  optionId: number;
  isBuy: boolean;
  quantity: bigint;
  price: bigint;
  timestamp: bigint;
  marketName?: string;
  optionName?: string;
}

const CACHE_KEY = "user_portfolio_v2_cache";
const CACHE_TTL = 300; // 5 minutes

export function UserPortfolioV2() {
  const { address: accountAddress, isConnected } = useAccount();
  const { toast } = useToast();

  const [portfolio, setPortfolio] = useState<UserPortfolio | null>(null);
  const [positions, setPositions] = useState<MarketPosition[]>([]);
  const [recentTrades, setRecentTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tokenSymbol, setTokenSymbol] = useState<string>("buster");
  const [tokenDecimals, setTokenDecimals] = useState<number>(18);

  // Get betting token info (casted to any to avoid deep ABI typing issues)
  const { data: bettingTokenAddr } = (useReadContract as any)({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getBettingToken",
  });

  const tokenAddress = (bettingTokenAddr as Address) || defaultTokenAddress;

  // Get token metadata
  const { data: symbolData } = (useReadContract as any)({
    address: tokenAddress,
    abi: defaultTokenAbi,
    functionName: "symbol",
    query: { enabled: !!tokenAddress },
  });

  const { data: decimalsData } = (useReadContract as any)({
    address: tokenAddress,
    abi: defaultTokenAbi,
    functionName: "decimals",
    query: { enabled: !!tokenAddress },
  });

  // Get user portfolio from subgraph
  const {
    portfolio: portfolioData,
    isLoading: isLoadingPortfolio,
    refetch: refetchPortfolio,
  } = useUserPortfolio(accountAddress!);

  // Fetch accurate unrealized PnL from PolicastViews
  const { data: calculatedUnrealizedPnL } = (useReadContract as any)({
    address: PolicastViews,
    abi: PolicastViewsAbi,
    functionName: "calculateUnrealizedPnL",
    args: [accountAddress as `0x${string}`],
    query: {
      enabled: !!accountAddress,
      refetchInterval: 10000,
    },
  });

  useEffect(() => {
    if (symbolData) setTokenSymbol(symbolData as string);
    if (decimalsData) setTokenDecimals(Number(decimalsData));
  }, [symbolData, decimalsData]);

  // Fetch detailed portfolio data
  const fetchPortfolioData = async () => {
    if (!accountAddress || !portfolioData) return;

    setIsLoading(true);
    try {
      // Check cache
      const cacheKey = `${CACHE_KEY}_${accountAddress}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        // Custom BigInt deserializer
        const deserializeWithBigInt = (str: string) => {
          return JSON.parse(str, (key, value) => {
            if (
              typeof value === "string" &&
              value.endsWith("n") &&
              /^\d+n$/.test(value)
            ) {
              return BigInt(value.slice(0, -1));
            }
            return value;
          });
        };

        const data = deserializeWithBigInt(cached);
        if (Date.now() - data.timestamp < CACHE_TTL * 1000) {
          setPortfolio(data.portfolio);
          setPositions(data.positions);
          setRecentTrades(data.trades);
          setIsLoading(false);
          return;
        }
      }

      // Set portfolio basic data - convert bigint tradeCount to number
      // Use calculated unrealized PnL from contract instead of stored value
      const portfolioInfo: UserPortfolio = {
        totalInvested: portfolioData.totalInvested,
        totalWinnings: portfolioData.totalWinnings,
        unrealizedPnL: calculatedUnrealizedPnL
          ? (calculatedUnrealizedPnL as bigint).toString()
          : portfolioData.unrealizedPnL,
        realizedPnL: portfolioData.realizedPnL,
        tradeCount: Number(portfolioData.tradeCount), // Convert bigint to number
      };
      setPortfolio(portfolioInfo);

      // Get market count to know how many markets to check
      const marketCount = (await (publicClient.readContract as any)({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "getMarketCount" as any,
      })) as unknown as bigint;

      // Fetch user positions across all markets
      const positions: MarketPosition[] = [];
      for (let marketId = 0; marketId < Number(marketCount); marketId++) {
        try {
          // Get user shares in this market
          const userShares = (await (publicClient.readContract as any)({
            address: V2contractAddress,
            abi: V2contractAbi,
            functionName: "getUserShares" as any,
            args: [BigInt(marketId), accountAddress],
          })) as unknown as bigint[];

          // Skip if user has no shares in this market
          if (!userShares || userShares.every((share) => share === 0n))
            continue;

          // Get market info
          const marketInfo = (await (publicClient.readContract as any)({
            address: V2contractAddress,
            abi: V2contractAbi,
            functionName: "getMarketInfo" as any,
            args: [BigInt(marketId)],
          })) as unknown as [
            string,
            string,
            bigint,
            number,
            bigint,
            boolean,
            boolean,
            number,
            boolean,
            bigint,
            string,
            boolean
          ];

          const [
            question,
            ,
            ,
            ,
            optionCount,
            resolved,
            ,
            ,
            invalidated,
            winningOptionId,
            creator,
          ] = marketInfo;

          // Get option names and current prices
          const options: string[] = [];
          const currentPrices: bigint[] = [];

          for (let optionId = 0; optionId < Number(optionCount); optionId++) {
            // Get option info
            const optionInfo = (await (publicClient.readContract as any)({
              address: V2contractAddress,
              abi: V2contractAbi,
              functionName: "getMarketOption" as any,
              args: [BigInt(marketId), BigInt(optionId)],
            })) as unknown as [string, string, bigint, bigint, bigint, boolean];

            options.push(optionInfo[0]);
            currentPrices.push(optionInfo[4]); // currentPrice
          }

          // Calculate total position value
          let totalValue = 0n;
          for (let i = 0; i < userShares.length; i++) {
            totalValue += (userShares[i] * currentPrices[i]) / 10n ** 18n; // Normalize price
          }

          positions.push({
            marketId,
            marketName: question,
            options,
            userShares,
            currentPrices,
            totalValue,
            invested: 0n, // Will calculate from trades
            pnl: 0n, // Will calculate from trades
            resolved,
            winningOption: resolved ? Number(winningOptionId) : undefined,
          });
        } catch (error) {
          console.error(
            `Error fetching position for market ${marketId}:`,
            error
          );
        }
      }

      // Get recent trades
      const trades: Trade[] = [];
      const tradeCount = Number(portfolioInfo.tradeCount);

      if (tradeCount > 0) {
        const recentTradeCount = Math.min(tradeCount, 10); // Last 10 trades

        for (
          let i = Math.max(0, tradeCount - recentTradeCount);
          i < tradeCount;
          i++
        ) {
          try {
            const trade = (await publicClient.readContract({
              address: V2contractAddress,
              abi: V2contractAbi,
              functionName: "userTradeHistory",
              args: [accountAddress, BigInt(i)],
            })) as unknown as [
              bigint,
              bigint,
              string,
              string,
              bigint,
              bigint,
              bigint
            ];

            const [
              marketId,
              optionId,
              buyer,
              seller,
              price,
              quantity,
              timestamp,
            ] = trade;
            const isBuy =
              buyer && accountAddress
                ? buyer.toLowerCase() === accountAddress.toLowerCase()
                : false;

            // Find market and option names
            const position = positions.find(
              (p) => p.marketId === Number(marketId)
            );

            trades.push({
              marketId: Number(marketId),
              optionId: Number(optionId),
              isBuy,
              quantity,
              price,
              timestamp,
              marketName: position?.marketName || `Market ${marketId}`,
              optionName:
                position?.options[Number(optionId)] || `Option ${optionId}`,
            });
          } catch (error) {
            console.error(`Error fetching trade ${i}:`, error);
            // If we get a contract revert, it likely means we've reached the end of available trades
            // Break the loop to avoid further unnecessary calls
            if (
              (error as any)?.message?.includes("reverted") ||
              (error as any)?.message?.includes("ContractFunctionRevertedError")
            ) {
              break;
            }
          }
        }
      }

      // Sort trades by timestamp (newest first)
      trades.sort((a, b) => Number(b.timestamp - a.timestamp));

      setPositions(positions);
      setRecentTrades(trades);

      // Cache the data with BigInt serialization
      const cacheData = {
        portfolio: portfolioInfo,
        positions,
        trades,
        timestamp: Date.now(),
      };

      // Custom BigInt serializer
      const serializeWithBigInt = (obj: any): string => {
        return JSON.stringify(obj, (key, value) =>
          typeof value === "bigint" ? value.toString() + "n" : value
        );
      };

      localStorage.setItem(cacheKey, serializeWithBigInt(cacheData));
    } catch (error) {
      console.error("Error fetching portfolio data:", error);
      toast({
        title: "Error",
        description: "Failed to load portfolio data.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isConnected && accountAddress && portfolioData) {
      fetchPortfolioData();
    }
  }, [isConnected, accountAddress, portfolioData]);

  const formatAmount = (amount: bigint) => {
    return (Number(amount) / 10 ** tokenDecimals).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
  };

  const formatPnL = (pnl: bigint) => {
    const value = Number(pnl) / 10 ** tokenDecimals;
    const isPositive = value >= 0;
    return {
      value: Math.abs(value).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      }),
      isPositive,
    };
  };

  // Flexible formatters that accept string (from subgraph) or bigint
  const formatAmountFlexible = (amount: string | bigint) => {
    const bi = typeof amount === "string" ? BigInt(amount) : amount;
    return (Number(bi) / 10 ** tokenDecimals).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
  };

  const formatPnLFlexible = (pnl: string | bigint) => {
    const bi = typeof pnl === "string" ? BigInt(pnl) : pnl;
    const value = Number(bi) / 10 ** tokenDecimals;
    const isPositive = value >= 0;
    return {
      value: Math.abs(value).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      }),
      isPositive,
    };
  };

  if (!isConnected || !accountAddress) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChart className="h-5 w-5" />
            V2 Portfolio
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p>Please connect your wallet to view your V2 portfolio.</p>
        </CardContent>
      </Card>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-32" />
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-8 w-full" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-24" />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-16 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-24" />
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (!portfolio) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChart className="h-5 w-5" />
            V2 Portfolio
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p>No V2 portfolio data available.</p>
        </CardContent>
      </Card>
    );
  }

  const totalPnL =
    BigInt(portfolio.realizedPnL) + BigInt(portfolio.unrealizedPnL);
  const totalPnLFormatted = formatPnLFlexible(totalPnL);

  return (
    <div className="relative flex min-h-screen w-full flex-col">
      {/* Sticky Header */}
      <div className="sticky top-0 z-10 flex items-center justify-between bg-background-light dark:bg-background-dark px-4 pt-4 pb-2">
        <h1 className="text-lg font-bold leading-tight tracking-[-0.015em] text-gray-900 dark:text-white flex items-center gap-2">
          <PieChart className="h-5 w-5" />
          Portfolio Overview
        </h1>
        <button
          onClick={() => {
            refetchPortfolio();
            fetchPortfolioData();
          }}
          className="flex items-center gap-2 rounded-lg bg-gray-200 dark:bg-[#352c3f] px-3 py-2 text-sm font-medium text-gray-600 dark:text-[#ac9fbc] hover:bg-gray-300 dark:hover:bg-[#443a4f] transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="p-4 space-y-4">
        {/* Overview Card */}
        <div className="rounded-lg bg-gradient-to-br from-gray-100 to-gray-50 dark:from-[#352c3f] dark:to-[#2a2333] p-6">
          {/* ...existing overview content with updated styles... */}
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* ...existing stats with updated styles... */}
        </div>

        {/* Positions and Trades */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Position Card */}
          <div className="rounded-lg bg-gray-100 dark:bg-[#352c3f]/50 p-4">
            {/* ...existing positions with updated styles... */}
          </div>

          {/* Trades Card */}
          <div className="rounded-lg bg-gray-100 dark:bg-[#352c3f]/50 p-4">
            {/* ...existing trades with updated styles... */}
          </div>
        </div>
      </div>
    </div>
  );
}
