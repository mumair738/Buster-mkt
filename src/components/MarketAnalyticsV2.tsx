"use client";

import { useState, useEffect } from "react";
import { useReadContract } from "wagmi";
import { useToast } from "@/components/ui/use-toast";
import {
  publicClient,
  V2contractAddress,
  V2contractAbi,
  tokenAddress as defaultTokenAddress,
  tokenAbi as defaultTokenAbi,
} from "@/constants/contract";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  TrendingUp,
  BarChart3,
  PieChart,
  Activity,
  Users,
  DollarSign,
  Clock,
  RefreshCw,
  ArrowUpRight,
} from "lucide-react";

interface MarketAnalytics {
  marketId: number;
  question: string;
  description: string;
  category: number;
  optionCount: number;
  resolved: boolean;
  disputed: boolean;
  winningOptionId?: number;
  endTime: bigint;
  creator: string;

  // Options data
  options: {
    id: number;
    name: string;
    description: string;
    totalShares: bigint;
    totalVolume: bigint;
    currentPrice: bigint;
    isActive: boolean;
  }[];

  // Market stats
  totalVolume: bigint;
  participantCount: number;
  averagePrice: bigint;
  priceVolatility: bigint;
  lastTradePrice: bigint;
  lastTradeTime: bigint;

  // Price history (last 24h/7d data points)
  priceHistory: {
    timestamp: number;
    prices: number[];
    volume: number;
  }[];
}

interface MarketListItem {
  id: number;
  question: string;
  totalVolume: bigint;
  participantCount: number;
  resolved: boolean;
  endTime: bigint;
}

const CACHE_KEY = "market_analytics_v2_cache";
const CACHE_TTL = 300; // 5 minutes

export function MarketAnalyticsV2() {
  const { toast } = useToast();

  const [selectedMarketId, setSelectedMarketId] = useState<number | null>(null);
  const [marketAnalytics, setMarketAnalytics] =
    useState<MarketAnalytics | null>(null);
  const [marketsList, setMarketsList] = useState<MarketListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingAnalytics, setIsLoadingAnalytics] = useState(false);
  const [tokenSymbol, setTokenSymbol] = useState<string>("buster");
  const [tokenDecimals, setTokenDecimals] = useState<number>(18);

  // Get betting token info
  const { data: bettingTokenAddr } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getBettingToken",
  });

  const tokenAddress = (bettingTokenAddr as any) || defaultTokenAddress;

  // Get token metadata
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

  // Get market count
  const { data: marketCount } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getMarketCount",
  });

  useEffect(() => {
    if (symbolData) setTokenSymbol(symbolData as string);
    if (decimalsData) setTokenDecimals(Number(decimalsData));
  }, [symbolData, decimalsData]);

  // Fetch markets list
  const fetchMarketsList = async () => {
    if (!marketCount) return;

    setIsLoading(true);
    try {
      const count = Number(marketCount);
      const markets: MarketListItem[] = [];

      for (let i = 0; i < Math.min(count, 50); i++) {
        // Limit to 50 markets for performance
        try {
          const marketInfo = (await publicClient.readContract({
            address: V2contractAddress,
            abi: V2contractAbi,
            functionName: "getMarketInfo",
            args: [BigInt(i)],
          })) as [
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
            string
          ];

          const [question, , endTime, , optionCount, resolved] = marketInfo;

          // Calculate total volume by summing all option volumes
          let totalVolume = 0n;
          const participantCount = 0;

          try {
            for (let j = 0; j < Number(optionCount); j++) {
              const optionInfo = (await publicClient.readContract({
                address: V2contractAddress,
                abi: V2contractAbi,
                functionName: "getMarketOption",
                args: [BigInt(i), BigInt(j)],
              })) as [string, string, bigint, bigint, bigint, boolean];

              totalVolume += optionInfo[3]; // Add option's totalVolume
            }
          } catch (error) {
            console.error(`Error fetching options for market ${i}:`, error);
          }

          markets.push({
            id: i,
            question,
            totalVolume,
            participantCount,
            resolved,
            endTime,
          });
        } catch (error) {
          console.error(`Error fetching market ${i}:`, error);
        }
      }

      // Sort by total volume (descending)
      markets.sort((a, b) => Number(b.totalVolume - a.totalVolume));
      setMarketsList(markets);

      // Auto-select the market with highest volume
      if (markets.length > 0 && !selectedMarketId) {
        setSelectedMarketId(markets[0].id);
      }
    } catch (error) {
      console.error("Error fetching markets list:", error);
      toast({
        title: "Error",
        description: "Failed to load markets list.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch detailed analytics for selected market
  const fetchMarketAnalytics = async (marketId: number) => {
    setIsLoadingAnalytics(true);
    try {
      // Check cache
      const cacheKey = `${CACHE_KEY}_${marketId}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        if (Date.now() - data.timestamp < CACHE_TTL * 1000) {
          setMarketAnalytics(data.analytics);
          setIsLoadingAnalytics(false);
          return;
        }
      }

      // Get market info
      const marketInfo = (await publicClient.readContract({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "getMarketInfo",
        args: [BigInt(marketId)],
      })) as [
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
        string
      ];

      const [
        question,
        description,
        endTime,
        category,
        optionCount,
        resolved,
        disputed,
        marketType,
        invalidated,
        winningOptionId,
        creator,
      ] = marketInfo;

      // Calculate stats from available market and option data
      let totalVolume = 0n;
      const totalTrades = 0;
      const participantCount = 0;

      // Get all options data
      const options = [];
      for (let optionId = 0; optionId < Number(optionCount); optionId++) {
        try {
          const optionInfo = (await publicClient.readContract({
            address: V2contractAddress,
            abi: V2contractAbi,
            functionName: "getMarketOption",
            args: [BigInt(marketId), BigInt(optionId)],
          })) as [string, string, bigint, bigint, bigint, boolean];

          const [
            name,
            optionDescription,
            totalShares,
            totalVolume,
            currentPrice,
            isActive,
          ] = optionInfo;

          options.push({
            id: optionId,
            name,
            description: optionDescription,
            totalShares,
            totalVolume,
            currentPrice,
            isActive,
          });
        } catch (error) {
          console.error(`Error fetching option ${optionId}:`, error);
        }
      }

      // Get price history (simplified - in real implementation would fetch historical data)
      const priceHistory = [];
      try {
        const currentPrices = options.map(
          (opt) => Number(opt.currentPrice) / 10 ** 18
        );
        const now = Date.now();

        // Simulate 24h price history (in real implementation, fetch from contract events)
        for (let i = 23; i >= 0; i--) {
          const timestamp = now - i * 60 * 60 * 1000; // Hour by hour
          const prices = currentPrices.map(
            (price) => price * (0.8 + Math.random() * 0.4) // Simulate price variation
          );

          priceHistory.push({
            timestamp,
            prices,
            volume: Math.random() * 1000,
          });
        }
      } catch (error) {
        console.error("Error generating price history:", error);
      }

      // Calculate total stats from options
      totalVolume = options.reduce((sum, opt) => sum + opt.totalVolume, 0n);

      const analytics: MarketAnalytics = {
        marketId,
        question,
        description,
        category,
        optionCount: Number(optionCount),
        resolved,
        disputed,
        winningOptionId: resolved ? Number(winningOptionId) : undefined,
        endTime,
        creator,
        options,
        totalVolume,
        participantCount, // Will be 0 for now, could be calculated from trade history
        averagePrice:
          options.length > 0
            ? options.reduce((sum, opt) => sum + opt.currentPrice, 0n) /
              BigInt(options.length)
            : 0n,
        priceVolatility: 0n, // Would need historical data to calculate
        lastTradePrice: options.length > 0 ? options[0].currentPrice : 0n,
        lastTradeTime: 0n, // Would need trade history to calculate
        priceHistory,
      };

      setMarketAnalytics(analytics);

      // Cache the data
      localStorage.setItem(
        cacheKey,
        JSON.stringify({
          analytics,
          timestamp: Date.now(),
        })
      );
    } catch (error) {
      console.error("Error fetching market analytics:", error);
      toast({
        title: "Error",
        description: "Failed to load market analytics.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingAnalytics(false);
    }
  };

  useEffect(() => {
    if (marketCount) {
      fetchMarketsList();
    }
  }, [marketCount]);

  useEffect(() => {
    if (selectedMarketId !== null) {
      fetchMarketAnalytics(selectedMarketId);
    }
  }, [selectedMarketId]);

  const formatAmount = (amount: bigint) => {
    return (Number(amount) / 10 ** tokenDecimals).toLocaleString(undefined, {
      maximumFractionDigits: 2,
    });
  };

  const formatPrice = (price: bigint) => {
    return (Number(price) / 10 ** 18).toFixed(4);
  };

  const getCategoryName = (category: number) => {
    const categories = [
      "Politics",
      "Sports",
      "Entertainment",
      "Crypto",
      "Other",
    ];
    return categories[category] || "Unknown";
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-24 w-full" />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            V2 Market Analytics
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchMarketsList();
              if (selectedMarketId !== null) {
                fetchMarketAnalytics(selectedMarketId);
              }
            }}
            className="flex items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Total Markets</p>
              <p className="text-2xl font-bold">{marketsList.length}</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Total Volume</p>
              <p className="text-2xl font-bold">
                {formatAmount(
                  marketsList.reduce(
                    (sum, market) => sum + market.totalVolume,
                    0n
                  )
                )}{" "}
                {tokenSymbol}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Active Markets</p>
              <p className="text-2xl font-bold">
                {marketsList.filter((m) => !m.resolved).length}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Markets List */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChart className="h-5 w-5" />
              Markets
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {marketsList.map((market) => (
                <div
                  key={market.id}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    selectedMarketId === market.id
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50"
                  }`}
                  onClick={() => setSelectedMarketId(market.id)}
                >
                  <div className="flex items-start justify-between mb-2">
                    <p className="font-medium text-sm line-clamp-2 flex-1">
                      {market.question}
                    </p>
                    {market.resolved && (
                      <Badge variant="secondary" className="ml-2 text-xs">
                        Resolved
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {formatAmount(market.totalVolume)} {tokenSymbol}
                    </span>
                    <span>{market.participantCount} traders</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Market Analytics Details */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              {marketAnalytics
                ? `Market #${marketAnalytics.marketId}`
                : "Select a Market"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoadingAnalytics ? (
              <div className="space-y-4">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-32 w-full" />
                <div className="grid grid-cols-2 gap-4">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              </div>
            ) : marketAnalytics ? (
              <Tabs defaultValue="overview" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="options">Options</TabsTrigger>
                  <TabsTrigger value="activity">Activity</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                  <div className="space-y-3">
                    <h3 className="font-semibold line-clamp-2">
                      {marketAnalytics.question}
                    </h3>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <Badge variant="outline">
                        {getCategoryName(marketAnalytics.category)}
                      </Badge>
                      <span className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {marketAnalytics.resolved
                          ? "Resolved"
                          : new Date(
                              Number(marketAnalytics.endTime) * 1000
                            ).toLocaleDateString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <Users className="h-4 w-4" />
                        {marketAnalytics.participantCount} traders
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <DollarSign className="h-4 w-4" />
                        Total Volume
                      </p>
                      <p className="text-lg font-semibold">
                        {formatAmount(marketAnalytics.totalVolume)}{" "}
                        {tokenSymbol}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <TrendingUp className="h-4 w-4" />
                        Last Price
                      </p>
                      <p className="text-lg font-semibold">
                        {formatPrice(marketAnalytics.lastTradePrice)}{" "}
                        {tokenSymbol}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <BarChart3 className="h-4 w-4" />
                        Volatility
                      </p>
                      <p className="text-lg font-semibold">
                        {formatPrice(marketAnalytics.priceVolatility)}%
                      </p>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">Options</p>
                      <p className="text-lg font-semibold">
                        {marketAnalytics.optionCount}
                      </p>
                    </div>
                  </div>

                  {marketAnalytics.resolved && (
                    <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
                      <p className="text-sm font-medium text-green-800">
                        🎉 Market Resolved - Winner:{" "}
                        {
                          marketAnalytics.options[
                            marketAnalytics.winningOptionId!
                          ]?.name
                        }
                      </p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="options" className="space-y-4">
                  <div className="space-y-3">
                    {marketAnalytics.options.map((option) => (
                      <div key={option.id} className="border rounded-lg p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h4 className="font-medium">{option.name}</h4>
                              {marketAnalytics.resolved &&
                                marketAnalytics.winningOptionId ===
                                  option.id && (
                                  <Badge variant="default" className="text-xs">
                                    Winner
                                  </Badge>
                                )}
                              {!option.isActive && (
                                <Badge variant="secondary" className="text-xs">
                                  Inactive
                                </Badge>
                              )}
                            </div>
                            {option.description && (
                              <p className="text-sm text-muted-foreground">
                                {option.description}
                              </p>
                            )}
                          </div>
                          <div className="text-right ml-4">
                            <p className="font-semibold">
                              {formatPrice(option.currentPrice)} {tokenSymbol}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              Current Price
                            </p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-muted-foreground">
                              Total Shares
                            </p>
                            <p className="font-medium">
                              {formatAmount(option.totalShares)}
                            </p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Volume</p>
                            <p className="font-medium">
                              {formatAmount(option.totalVolume)} {tokenSymbol}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="activity" className="space-y-4">
                  <div className="space-y-3">
                    <h4 className="font-medium">Recent Activity</h4>
                    {marketAnalytics.lastTradeTime > 0n ? (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between p-3 border rounded-lg">
                          <div className="flex items-center gap-2">
                            <ArrowUpRight className="h-4 w-4 text-green-600" />
                            <span className="text-sm">Last Trade</span>
                          </div>
                          <div className="text-right">
                            <p className="font-medium">
                              {formatPrice(marketAnalytics.lastTradePrice)}{" "}
                              {tokenSymbol}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(
                                Number(marketAnalytics.lastTradeTime) * 1000
                              ).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <p className="text-muted-foreground text-center py-8">
                        No trading activity yet.
                      </p>
                    )}

                    {/* Price History Chart Placeholder */}
                    <div className="border rounded-lg p-4">
                      <h5 className="font-medium mb-3">Price History (24h)</h5>
                      <div className="h-32 bg-muted/20 rounded flex items-center justify-center">
                        <p className="text-muted-foreground text-sm">
                          Chart visualization would go here
                        </p>
                      </div>
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">
                  Select a market from the list to view detailed analytics.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
