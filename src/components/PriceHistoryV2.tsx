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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  TrendingUp,
  TrendingDown,
  BarChart3,
  LineChart,
  Clock,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";

interface PricePoint {
  timestamp: number;
  prices: number[];
  volume: number;
  trades: number;
}

interface OptionPriceData {
  optionId: number;
  name: string;
  currentPrice: number;
  priceChange24h: number;
  priceChangePct24h: number;
  volume24h: number;
  trades24h: number;
  high24h: number;
  low24h: number;
  history: PricePoint[];
}

interface MarketPriceData {
  marketId: number;
  question: string;
  resolved: boolean;
  winningOption?: number;
  options: OptionPriceData[];
  totalVolume24h: number;
  totalTrades24h: number;
  lastUpdated: number;
}

interface MarketListItem {
  id: number;
  question: string;
  optionCount: number;
  totalVolume: bigint;
  resolved: boolean;
}

const CACHE_KEY = "price_history_v2_cache";
const CACHE_TTL = 180; // 3 minutes for price data

const TIME_RANGES = [
  { label: "1H", value: "1h", hours: 1 },
  { label: "6H", value: "6h", hours: 6 },
  { label: "24H", value: "24h", hours: 24 },
  { label: "7D", value: "7d", hours: 168 },
] as const;

export function PriceHistoryV2() {
  const { toast } = useToast();

  const [selectedMarketId, setSelectedMarketId] = useState<number | null>(null);
  const [selectedTimeRange, setSelectedTimeRange] = useState<string>("24h");
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [marketPriceData, setMarketPriceData] =
    useState<MarketPriceData | null>(null);
  const [marketsList, setMarketsList] = useState<MarketListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingPrices, setIsLoadingPrices] = useState(false);
  const [tokenSymbol, setTokenSymbol] = useState<string>("BSTR");
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

  // Generate mock price history data (in real implementation, would fetch from contract events/external API)
  const generatePriceHistory = (
    basePrice: number,
    hours: number
  ): PricePoint[] => {
    const points: PricePoint[] = [];
    const intervalMinutes =
      hours <= 1 ? 5 : hours <= 6 ? 15 : hours <= 24 ? 60 : 360; // 5min, 15min, 1h, 6h intervals
    const totalPoints = Math.floor((hours * 60) / intervalMinutes);

    let currentPrice = basePrice;
    const volatility = 0.02; // 2% volatility per interval

    for (let i = totalPoints; i >= 0; i--) {
      const timestamp = Date.now() - i * intervalMinutes * 60 * 1000;

      // Random walk with mean reversion
      const change = (Math.random() - 0.5) * volatility * 2;
      const meanReversion = (basePrice - currentPrice) * 0.1;
      currentPrice = Math.max(
        0.01,
        currentPrice * (1 + change + meanReversion)
      );

      points.push({
        timestamp,
        prices: [currentPrice],
        volume: Math.random() * 1000 + 100,
        trades: Math.floor(Math.random() * 20) + 1,
      });
    }

    return points;
  };

  // Fetch markets list
  const fetchMarketsList = async () => {
    if (!marketCount) return;

    setIsLoading(true);
    try {
      const count = Number(marketCount);
      const markets: MarketListItem[] = [];

      for (let i = 0; i < Math.min(count, 20); i++) {
        // Limit for performance
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
            bigint,
            string
          ];

          const [question, , , , optionCount, resolved] = marketInfo;

          // Calculate total volume from options since getMarketStats doesn't exist in V2
          let totalVolume = 0n;
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
            console.error(`Error calculating volume for market ${i}:`, error);
          }

          markets.push({
            id: i,
            question,
            optionCount: Number(optionCount),
            totalVolume,
            resolved,
          });
        } catch (error) {
          console.error(`Error fetching market ${i}:`, error);
        }
      }

      // Sort by total volume (descending)
      markets.sort((a, b) => Number(b.totalVolume - a.totalVolume));
      setMarketsList(markets);

      // Auto-select the first market if none selected
      if (markets.length > 0 && selectedMarketId === null) {
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

  // Fetch price data for selected market
  const fetchPriceData = async (marketId: number, timeRange: string) => {
    setIsLoadingPrices(true);
    try {
      // Check cache
      const cacheKey = `${CACHE_KEY}_${marketId}_${timeRange}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        if (Date.now() - data.timestamp < CACHE_TTL * 1000) {
          setMarketPriceData(data.priceData);
          if (selectedOption === null && data.priceData.options.length > 0) {
            setSelectedOption(0);
          }
          setIsLoadingPrices(false);
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
        bigint,
        string
      ];

      const [question, , , , optionCount, resolved, , winningOptionId] =
        marketInfo;

      // Get options data
      const options: OptionPriceData[] = [];
      const timeRangeConfig = TIME_RANGES.find((r) => r.value === timeRange);
      const hours = timeRangeConfig?.hours || 24;

      for (let optionId = 0; optionId < Number(optionCount); optionId++) {
        try {
          const optionInfo = (await publicClient.readContract({
            address: V2contractAddress,
            abi: V2contractAbi,
            functionName: "getMarketOption",
            args: [BigInt(marketId), BigInt(optionId)],
          })) as [string, string, bigint, bigint, bigint, boolean];

          const [name, , , totalVolume, currentPrice] = optionInfo;
          const currentPriceNumber = Number(currentPrice) / 10 ** 18;

          // Generate price history
          const history = generatePriceHistory(currentPriceNumber, hours);

          // Calculate 24h stats
          const price24hAgo =
            history.length > 0 ? history[0].prices[0] : currentPriceNumber;
          const priceChange24h = currentPriceNumber - price24hAgo;
          const priceChangePct24h =
            price24hAgo > 0 ? (priceChange24h / price24hAgo) * 100 : 0;

          const volume24h = history.reduce(
            (sum, point) => sum + point.volume,
            0
          );
          const trades24h = history.reduce(
            (sum, point) => sum + point.trades,
            0
          );

          const prices = history.map((h) => h.prices[0]);
          const high24h = Math.max(...prices);
          const low24h = Math.min(...prices);

          options.push({
            optionId,
            name,
            currentPrice: currentPriceNumber,
            priceChange24h,
            priceChangePct24h,
            volume24h,
            trades24h,
            high24h,
            low24h,
            history,
          });
        } catch (error) {
          console.error(`Error fetching option ${optionId}:`, error);
        }
      }

      const totalVolume24h = options.reduce(
        (sum, opt) => sum + opt.volume24h,
        0
      );
      const totalTrades24h = options.reduce(
        (sum, opt) => sum + opt.trades24h,
        0
      );

      const priceData: MarketPriceData = {
        marketId,
        question,
        resolved,
        winningOption: resolved ? Number(winningOptionId) : undefined,
        options,
        totalVolume24h,
        totalTrades24h,
        lastUpdated: Date.now(),
      };

      setMarketPriceData(priceData);

      // Auto-select first option if none selected
      if (selectedOption === null && options.length > 0) {
        setSelectedOption(0);
      }

      // Cache the data
      localStorage.setItem(
        cacheKey,
        JSON.stringify({
          priceData,
          timestamp: Date.now(),
        })
      );
    } catch (error) {
      console.error("Error fetching price data:", error);
      toast({
        title: "Error",
        description: "Failed to load price data.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingPrices(false);
    }
  };

  useEffect(() => {
    if (marketCount) {
      fetchMarketsList();
    }
  }, [marketCount]);

  useEffect(() => {
    if (selectedMarketId !== null) {
      fetchPriceData(selectedMarketId, selectedTimeRange);
    }
  }, [selectedMarketId, selectedTimeRange]);

  const formatPrice = (price: number) => {
    return price.toFixed(4);
  };

  const formatVolume = (volume: number) => {
    return volume.toLocaleString(undefined, { maximumFractionDigits: 0 });
  };

  const formatPercentage = (pct: number) => {
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-48" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  const selectedOptionData = marketPriceData?.options.find(
    (opt) => opt.optionId === selectedOption
  );

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <LineChart className="h-5 w-5" />
            V2 Price History
          </CardTitle>
          <div className="flex items-center gap-4">
            <Select
              value={selectedMarketId?.toString() || ""}
              onValueChange={(value: string) =>
                setSelectedMarketId(Number(value))
              }
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select market" />
              </SelectTrigger>
              <SelectContent>
                {marketsList.map((market) => (
                  <SelectItem key={market.id} value={market.id.toString()}>
                    <div className="flex items-center justify-between w-full">
                      <span className="truncate">{market.question}</span>
                      {market.resolved && (
                        <Badge variant="secondary" className="ml-2 text-xs">
                          Resolved
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (selectedMarketId !== null) {
                  fetchPriceData(selectedMarketId, selectedTimeRange);
                }
              }}
              className="flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </CardHeader>
      </Card>

      {marketPriceData && (
        <>
          {/* Market Summary */}
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="space-y-2">
                  <h3 className="font-semibold line-clamp-2">
                    {marketPriceData.question}
                  </h3>
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <span>Market #{marketPriceData.marketId}</span>
                    <span>{marketPriceData.options.length} Options</span>
                    {marketPriceData.resolved && (
                      <Badge variant="secondary">
                        Resolved - Winner:{" "}
                        {
                          marketPriceData.options[
                            marketPriceData.winningOption!
                          ]?.name
                        }
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="text-right text-sm">
                  <p className="text-muted-foreground">24h Volume</p>
                  <p className="font-semibold">
                    {formatVolume(marketPriceData.totalVolume24h)} {tokenSymbol}
                  </p>
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Options Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
                Options Overview
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {marketPriceData.options.map((option) => (
                  <div
                    key={option.optionId}
                    className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                      selectedOption === option.optionId
                        ? "border-primary bg-primary/5"
                        : "hover:bg-muted/50"
                    }`}
                    onClick={() => setSelectedOption(option.optionId)}
                  >
                    <div className="space-y-3">
                      <div className="flex items-start justify-between">
                        <h4 className="font-medium line-clamp-2 flex-1">
                          {option.name}
                        </h4>
                        {marketPriceData.resolved &&
                          marketPriceData.winningOption === option.optionId && (
                            <Badge variant="default" className="ml-2 text-xs">
                              Winner
                            </Badge>
                          )}
                      </div>

                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">
                            Current Price
                          </span>
                          <span className="font-semibold">
                            {formatPrice(option.currentPrice)} {tokenSymbol}
                          </span>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">
                            24h Change
                          </span>
                          <div className="flex items-center gap-1">
                            {option.priceChangePct24h > 0 ? (
                              <ArrowUp className="h-3 w-3 text-green-600" />
                            ) : option.priceChangePct24h < 0 ? (
                              <ArrowDown className="h-3 w-3 text-red-600" />
                            ) : (
                              <Minus className="h-3 w-3 text-gray-500" />
                            )}
                            <span
                              className={`text-sm font-medium ${
                                option.priceChangePct24h > 0
                                  ? "text-green-600"
                                  : option.priceChangePct24h < 0
                                  ? "text-red-600"
                                  : "text-gray-500"
                              }`}
                            >
                              {formatPercentage(option.priceChangePct24h)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-sm text-muted-foreground">
                            24h Volume
                          </span>
                          <span className="text-sm">
                            {formatVolume(option.volume24h)} {tokenSymbol}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Price Chart */}
          {selectedOptionData && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <LineChart className="h-5 w-5" />
                  {selectedOptionData.name} - Price Chart
                </CardTitle>
                <div className="flex items-center gap-2">
                  {TIME_RANGES.map((range) => (
                    <Button
                      key={range.value}
                      variant={
                        selectedTimeRange === range.value
                          ? "default"
                          : "outline"
                      }
                      size="sm"
                      onClick={() => setSelectedTimeRange(range.value)}
                    >
                      {range.label}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                {isLoadingPrices ? (
                  <Skeleton className="h-64 w-full" />
                ) : (
                  <Tabs defaultValue="chart" className="w-full">
                    <TabsList>
                      <TabsTrigger value="chart">Chart</TabsTrigger>
                      <TabsTrigger value="stats">Statistics</TabsTrigger>
                    </TabsList>

                    <TabsContent value="chart" className="space-y-4">
                      {/* Chart Placeholder */}
                      <div className="h-64 border rounded-lg flex items-center justify-center bg-muted/20">
                        <div className="text-center space-y-2">
                          <LineChart className="h-8 w-8 mx-auto text-muted-foreground" />
                          <p className="text-muted-foreground">
                            Price chart visualization would go here
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {selectedOptionData.history.length} data points over{" "}
                            {
                              TIME_RANGES.find(
                                (r) => r.value === selectedTimeRange
                              )?.label
                            }
                          </p>
                        </div>
                      </div>

                      {/* Current Stats */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="text-center space-y-1">
                          <p className="text-sm text-muted-foreground">
                            Current
                          </p>
                          <p className="text-lg font-semibold">
                            {formatPrice(selectedOptionData.currentPrice)}{" "}
                            {tokenSymbol}
                          </p>
                        </div>
                        <div className="text-center space-y-1">
                          <p className="text-sm text-muted-foreground">
                            24h High
                          </p>
                          <p className="text-lg font-semibold text-green-600">
                            {formatPrice(selectedOptionData.high24h)}{" "}
                            {tokenSymbol}
                          </p>
                        </div>
                        <div className="text-center space-y-1">
                          <p className="text-sm text-muted-foreground">
                            24h Low
                          </p>
                          <p className="text-lg font-semibold text-red-600">
                            {formatPrice(selectedOptionData.low24h)}{" "}
                            {tokenSymbol}
                          </p>
                        </div>
                        <div className="text-center space-y-1">
                          <p className="text-sm text-muted-foreground">
                            24h Trades
                          </p>
                          <p className="text-lg font-semibold">
                            {selectedOptionData.trades24h}
                          </p>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="stats" className="space-y-4">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-4">
                          <h4 className="font-medium">Price Statistics</h4>
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">
                                Current Price
                              </span>
                              <span className="font-medium">
                                {formatPrice(selectedOptionData.currentPrice)}{" "}
                                {tokenSymbol}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">
                                24h Change
                              </span>
                              <span
                                className={`font-medium ${
                                  selectedOptionData.priceChangePct24h > 0
                                    ? "text-green-600"
                                    : selectedOptionData.priceChangePct24h < 0
                                    ? "text-red-600"
                                    : "text-gray-500"
                                }`}
                              >
                                {formatPercentage(
                                  selectedOptionData.priceChangePct24h
                                )}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">
                                24h High
                              </span>
                              <span className="font-medium">
                                {formatPrice(selectedOptionData.high24h)}{" "}
                                {tokenSymbol}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">
                                24h Low
                              </span>
                              <span className="font-medium">
                                {formatPrice(selectedOptionData.low24h)}{" "}
                                {tokenSymbol}
                              </span>
                            </div>
                          </div>
                        </div>

                        <div className="space-y-4">
                          <h4 className="font-medium">Trading Statistics</h4>
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">
                                24h Volume
                              </span>
                              <span className="font-medium">
                                {formatVolume(selectedOptionData.volume24h)}{" "}
                                {tokenSymbol}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">
                                24h Trades
                              </span>
                              <span className="font-medium">
                                {selectedOptionData.trades24h}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">
                                Avg Trade Size
                              </span>
                              <span className="font-medium">
                                {selectedOptionData.trades24h > 0
                                  ? formatVolume(
                                      selectedOptionData.volume24h /
                                        selectedOptionData.trades24h
                                    )
                                  : "0"}{" "}
                                {tokenSymbol}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
