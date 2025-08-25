"use client";

import { useState, useEffect } from "react";
import { useAccount, useReadContract } from "wagmi";
import {
  V2contractAddress,
  V2contractAbi,
  tokenAddress,
  tokenAbi,
} from "@/constants/contract";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { MarketV2SellInterface } from "./MarketV2SellInterface";
import { MarketV2SwapInterface } from "./MarketV2SwapInterface";
import { MarketV2, MarketOption } from "@/types/types";
import {
  TrendingUp,
  TrendingDown,
  ArrowLeftRight,
  Wallet,
  Eye,
  EyeOff,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface MarketV2PositionManagerProps {
  marketId: number;
  market: MarketV2;
  onPositionUpdate?: () => void;
}

interface UserPosition {
  optionId: number;
  optionName: string;
  shares: bigint;
  currentPrice: bigint;
  currentValue: bigint;
  unrealizedPnL: bigint;
  unrealizedPnLPercent: number;
}

// Format price with proper decimals
function formatPrice(price: bigint, decimals: number = 18): string {
  const formatted = Number(price) / Math.pow(10, decimals);
  if (formatted === 0) return "0.0000";
  if (formatted < 0.0001) return formatted.toFixed(6);
  if (formatted < 0.01) return formatted.toFixed(4);
  if (formatted < 1) return formatted.toFixed(3);
  return formatted.toFixed(2);
}

// Format shares amount
function formatShares(shares: bigint): string {
  const formatted = Number(shares) / Math.pow(10, 18);
  if (formatted === 0) return "0.00";
  if (formatted < 0.001) return formatted.toFixed(6);
  if (formatted < 0.01) return formatted.toFixed(4);
  if (formatted < 1) return formatted.toFixed(3);
  return formatted.toFixed(2);
}

// Format percentage
function formatPercent(percent: number): string {
  return `${percent >= 0 ? "+" : ""}${percent.toFixed(2)}%`;
}

export function MarketV2PositionManager({
  marketId,
  market,
  onPositionUpdate,
}: MarketV2PositionManagerProps) {
  const { address: accountAddress } = useAccount();
  const [activeTab, setActiveTab] = useState<"overview" | "sell" | "swap">(
    "overview"
  );
  const [showZeroPositions, setShowZeroPositions] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Token information
  const { data: tokenSymbol } = useReadContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "symbol",
  });

  // Fetch user shares for this market
  const { data: userShares, refetch: refetchShares } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getUserShares",
    args: [BigInt(marketId), accountAddress as `0x${string}`],
    query: { enabled: !!accountAddress },
  });

  // Fetch user portfolio data
  const { data: userPortfolio, refetch: refetchPortfolio } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getUserPortfolio",
    args: [accountAddress as `0x${string}`],
    query: { enabled: !!accountAddress },
  });

  // Convert user shares data to position objects with real cost basis
  const positions: UserPosition[] = market.options.map((option, optionId) => {
    const shares = userShares ? userShares[optionId] || 0n : 0n;
    const currentPrice = option.currentPrice || BigInt(5 * 10 ** 17); // Default to 0.5 if price not available
    const currentValue = (shares * currentPrice) / BigInt(10 ** 18);

    // Use real portfolio data from contract
    const portfolioTotalInvested = userPortfolio
      ? userPortfolio.totalInvested
      : 0n; // totalInvested
    const portfolioUnrealizedPnL = userPortfolio
      ? userPortfolio.unrealizedPnL
      : 0n; // unrealizedPnL

    // Calculate share distribution across all markets for this user
    const userTotalShares = userShares
      ? userShares.reduce((sum: bigint, s: bigint) => sum + s, 0n)
      : 0n;

    // Estimate cost basis for this position based on portfolio data
    let estimatedCostBasis = 0n;
    let unrealizedPnL = 0n;

    if (shares > 0n && userTotalShares > 0n) {
      // Calculate the proportion of this position relative to total shares
      const shareRatio = (shares * 10000n) / userTotalShares;

      // Estimate cost basis as proportion of total invested
      estimatedCostBasis = (portfolioTotalInvested * shareRatio) / 10000n;

      // Calculate P&L: current value minus estimated cost basis
      unrealizedPnL = currentValue - estimatedCostBasis;
    }

    const unrealizedPnLPercent =
      estimatedCostBasis > 0n
        ? Number((unrealizedPnL * 10000n) / estimatedCostBasis) / 100
        : 0;

    return {
      optionId,
      optionName: option.name,
      shares,
      currentPrice,
      currentValue,
      unrealizedPnL,
      unrealizedPnLPercent,
    };
  });

  // Filter positions based on showZeroPositions
  const filteredPositions = showZeroPositions
    ? positions
    : positions.filter((pos) => pos.shares > 0n);

  // Calculate totals using real portfolio data when available
  const totalValue = positions.reduce((sum, pos) => sum + pos.currentValue, 0n);
  const totalUnrealizedPnL = userPortfolio
    ? userPortfolio.unrealizedPnL // Use real unrealized P&L from contract
    : positions.reduce((sum, pos) => sum + pos.unrealizedPnL, 0n); // Fallback to calculated
  const hasPositions = positions.some((pos) => pos.shares > 0n);

  // Convert shares array to object for interfaces
  const userSharesObject = userShares
    ? Object.fromEntries(userShares.map((shares, index) => [index, shares]))
    : {};

  // Handle refresh
  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([refetchShares(), refetchPortfolio()]);
      if (onPositionUpdate) {
        onPositionUpdate();
      }
    } catch (error) {
      console.error("Failed to refresh positions:", error);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Your Positions
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              <RefreshCw
                className={cn("h-4 w-4", isRefreshing && "animate-spin")}
              />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowZeroPositions(!showZeroPositions)}
            >
              {showZeroPositions ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
              {showZeroPositions ? "Hide Zero" : "Show All"}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {!accountAddress ? (
          <div className="text-center py-8 text-gray-500">
            Connect your wallet to view positions
          </div>
        ) : !hasPositions ? (
          <div className="text-center py-8 text-gray-500">
            You don&apos;t have any positions in this market
          </div>
        ) : (
          <Tabs
            value={activeTab}
            onValueChange={(value) => setActiveTab(value as any)}
          >
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="sell">Sell Shares</TabsTrigger>
              <TabsTrigger value="swap">Swap Shares</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-4 space-y-4">
              {/* Portfolio Summary */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="pt-4">
                    <div className="text-sm text-gray-600">Total Value</div>
                    <div className="text-lg font-semibold">
                      {formatPrice(totalValue)} {tokenSymbol || "TOKENS"}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-4">
                    <div className="text-sm text-gray-600">Unrealized P&L</div>
                    <div
                      className={cn(
                        "text-lg font-semibold",
                        totalUnrealizedPnL >= 0n
                          ? "text-green-600"
                          : "text-red-600"
                      )}
                    >
                      {totalUnrealizedPnL >= 0n ? "+" : ""}
                      {formatPrice(totalUnrealizedPnL)}{" "}
                      {tokenSymbol || "TOKENS"}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-4">
                    <div className="text-sm text-gray-600">
                      Active Positions
                    </div>
                    <div className="text-lg font-semibold">
                      {positions.filter((pos) => pos.shares > 0n).length} /{" "}
                      {positions.length}
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Individual Positions */}
              <div className="space-y-3">
                <h3 className="font-medium text-gray-900">Position Details</h3>
                {filteredPositions.map((position) => (
                  <Card
                    key={position.optionId}
                    className="border-l-4 border-l-blue-500"
                  >
                    <CardContent className="pt-4">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <h4 className="font-medium">{position.optionName}</h4>
                          <div className="text-sm text-gray-600">
                            {formatShares(position.shares)} shares
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-medium">
                            {formatPrice(position.currentValue)}{" "}
                            {tokenSymbol || "TOKENS"}
                          </div>
                          <div className="text-sm text-gray-600">
                            @ {formatPrice(position.currentPrice)} per share
                          </div>
                        </div>
                      </div>

                      {position.shares > 0n && (
                        <div className="flex items-center justify-between pt-2 border-t">
                          <div className="flex items-center gap-2">
                            {position.unrealizedPnL >= 0n ? (
                              <TrendingUp className="h-4 w-4 text-green-600" />
                            ) : (
                              <TrendingDown className="h-4 w-4 text-red-600" />
                            )}
                            <span
                              className={cn(
                                "text-sm font-medium",
                                position.unrealizedPnL >= 0n
                                  ? "text-green-600"
                                  : "text-red-600"
                              )}
                            >
                              {formatPercent(position.unrealizedPnLPercent)}
                            </span>
                          </div>
                          <Badge
                            variant={
                              position.unrealizedPnL >= 0n
                                ? "default"
                                : "destructive"
                            }
                          >
                            {position.unrealizedPnL >= 0n ? "Profit" : "Loss"}
                          </Badge>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="sell" className="mt-4">
              <MarketV2SellInterface
                marketId={marketId}
                market={market}
                userShares={userSharesObject}
                onSellComplete={handleRefresh}
              />
            </TabsContent>

            <TabsContent value="swap" className="mt-4">
              <MarketV2SwapInterface
                marketId={marketId}
                market={market}
                userShares={userSharesObject}
                onSwapComplete={handleRefresh}
              />
            </TabsContent>
          </Tabs>
        )}
      </CardContent>
    </Card>
  );
}
