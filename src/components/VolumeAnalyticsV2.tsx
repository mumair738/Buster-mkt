"use client";
//
import { useState, useEffect } from "react";
import { useReadContract } from "wagmi";
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
  BarChart3,
  DollarSign,
  Activity,
  Users,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Droplets,
} from "lucide-react";

interface VolumeDataPoint {
  timestamp: number;
  volume: number;
  trades: number;
  uniqueTraders: number;
  avgTradeSize: number;
}

interface OptionVolumeData {
  optionId: number;
  name: string;
  totalVolume: number;
  volume24h: number;
  volumeChange24h: number;
  volumeChangePct24h: number;
  trades24h: number;
  avgTradeSize24h: number;
  marketShare: number;
  liquidityScore: number;
  history: VolumeDataPoint[];
}

interface MarketVolumeData {
  marketId: number;
  question: string;
  resolved: boolean;
  totalVolume: number;
  volume24h: number;
  volumeChange24h: number;
  volumeChangePct24h: number;
  totalTrades: number;
  trades24h: number;
  uniqueTraders24h: number;
  avgTradeSize24h: number;
  liquidityIndex: number;
  options: OptionVolumeData[];
  volumeHistory: VolumeDataPoint[];
  lastUpdated: number;
}

interface MarketListItem {
  id: number;
  question: string;
  totalVolume: bigint;
  resolved: boolean;
  liquidityScore: number;
}

const CACHE_KEY = "volume_analytics_v2_cache";
const CACHE_TTL = 300; // 5 minutes

const TIME_RANGES = [
  { label: "24H", value: "24h", hours: 24 },
  { label: "7D", value: "7d", hours: 168 },
  { label: "30D", value: "30d", hours: 720 },
] as const;

const SORT_OPTIONS = [
  { label: "Volume (High to Low)", value: "volume_desc" },
  { label: "Volume (Low to High)", value: "volume_asc" },
  { label: "Liquidity Score", value: "liquidity_desc" },
  { label: "Most Active", value: "trades_desc" },
  { label: "Recently Active", value: "recent" },
] as const;

export function VolumeAnalyticsV2() {
  const { toast } = useToast();

  const [selectedMarketId, setSelectedMarketId] = useState<number | null>(null);
  const [selectedTimeRange, setSelectedTimeRange] = useState<string>("24h");
  const [selectedSort, setSelectedSort] = useState<string>("volume_desc");
  const [marketVolumeData, setMarketVolumeData] =
    useState<MarketVolumeData | null>(null);
  const [marketsList, setMarketsList] = useState<MarketListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingVolume, setIsLoadingVolume] = useState(false);
  const [tokenSymbol, setTokenSymbol] = useState<string>("BSTR");
  const [tokenDecimals, setTokenDecimals] = useState<number>(18);

  // Get betting token info
  const { data: bettingTokenAddr } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "bettingToken",
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
    functionName: "marketCount",
  });

  useEffect(() => {
    if (symbolData) setTokenSymbol(symbolData as string);
    if (decimalsData) setTokenDecimals(Number(decimalsData));
  }, [symbolData, decimalsData]);

  // Generate mock volume history data
  const generateVolumeHistory = (
    baseVolume: number,
    hours: number
  ): VolumeDataPoint[] => {
    const points: VolumeDataPoint[] = [];
    const intervalMinutes = hours <= 24 ? 60 : hours <= 168 ? 360 : 1440; // 1h, 6h, 24h intervals
    const totalPoints = Math.floor((hours * 60) / intervalMinutes);

    for (let i = totalPoints; i >= 0; i--) {
      const timestamp = Date.now() - i * intervalMinutes * 60 * 1000;

      // Simulate volume patterns (higher during "market hours")
      const hour = new Date(timestamp).getHours();
      const dayMultiplier = hour >= 9 && hour <= 21 ? 1.5 : 0.7; // Higher during active hours

      const volume = baseVolume * (0.5 + Math.random() * 1.5) * dayMultiplier;
      const trades = Math.floor(volume / (50 + Math.random() * 200)); // Varying trade sizes
      const uniqueTraders = Math.floor(trades * (0.3 + Math.random() * 0.4)); // Some traders make multiple trades
      const avgTradeSize = trades > 0 ? volume / trades : 0;

      points.push({
        timestamp,
        volume,
        trades,
        uniqueTraders,
        avgTradeSize,
      });
    }

    return points;
  };

  // Calculate liquidity score based on volume distribution and consistency
  const calculateLiquidityScore = (
    volumeHistory: VolumeDataPoint[]
  ): number => {
    if (volumeHistory.length === 0) return 0;

    const volumes = volumeHistory.map((h) => h.volume);
    const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;

    // Calculate coefficient of variation (volatility)
    const variance =
      volumes.reduce((sum, v) => sum + Math.pow(v - avgVolume, 2), 0) /
      volumes.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = avgVolume > 0 ? stdDev / avgVolume : 1;

    // Score based on average volume and consistency (lower CV is better)
    const volumeScore = Math.min(avgVolume / 1000, 100); // Normalize to 0-100
    const consistencyScore = Math.max(0, 100 - coefficientOfVariation * 100);

    return Math.round((volumeScore + consistencyScore) / 2);
  };

  // Fetch markets list with volume data
  const fetchMarketsList = async () => {
    if (!marketCount) return;

    setIsLoading(true);
    try {
      const count = Number(marketCount);
      const markets: MarketListItem[] = [];

      for (let i = 0; i < Math.min(count, 30); i++) {
        // Limit for performance
        try {
          const marketInfo = (await publicClient.readContract({
            address: PolicastViews,
            abi: PolicastViewsAbi,
            functionName: "getMarketInfo",
            args: [BigInt(i)],
          })) as unknown as readonly any[];

          const [question, , , , optionCount, resolved] = marketInfo;

          // Calculate total volume from options
          let totalVolumeWei = 0n;
          for (let j = 0; j < Number(optionCount); j++) {
            try {
              const optionInfo = (await publicClient.readContract({
                address: V2contractAddress,
                abi: V2contractAbi,
                functionName: "getMarketOption",
                args: [BigInt(i), BigInt(j)],
              })) as [string, string, bigint, bigint, bigint, boolean];

              totalVolumeWei += optionInfo[3]; // Add option's totalVolume
            } catch (error) {
              console.error(
                `Error fetching option ${j} for market ${i}:`,
                error
              );
            }
          }

          const totalVolume = Number(totalVolumeWei) / 10 ** tokenDecimals;

          // Generate volume history to calculate liquidity score
          const volumeHistory = generateVolumeHistory(totalVolume / 30, 24); // Last 24h
          const liquidityScore = calculateLiquidityScore(volumeHistory);

          markets.push({
            id: i,
            question,
            totalVolume: totalVolumeWei,
            resolved,
            liquidityScore,
          });
        } catch (error) {
          console.error(`Error fetching market ${i}:`, error);
        }
      }

      // Sort markets based on selected criteria
      const sortedMarkets = sortMarkets(markets, selectedSort);
      setMarketsList(sortedMarkets);

      // Auto-select the first market if none selected
      if (sortedMarkets.length > 0 && selectedMarketId === null) {
        setSelectedMarketId(sortedMarkets[0].id);
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

  // Sort markets based on criteria
  const sortMarkets = (
    markets: MarketListItem[],
    sortBy: string
  ): MarketListItem[] => {
    const sorted = [...markets];

    switch (sortBy) {
      case "volume_desc":
        return sorted.sort((a, b) => Number(b.totalVolume - a.totalVolume));
      case "volume_asc":
        return sorted.sort((a, b) => Number(a.totalVolume - b.totalVolume));
      case "liquidity_desc":
        return sorted.sort((a, b) => b.liquidityScore - a.liquidityScore);
      case "trades_desc":
        // Would sort by trade count if available
        return sorted.sort((a, b) => Number(b.totalVolume - a.totalVolume));
      case "recent":
        // Would sort by recent activity if available
        return sorted.sort((a, b) => b.id - a.id); // Newer markets first
      default:
        return sorted;
    }
  };

  // Fetch detailed volume data for selected market
  const fetchVolumeData = async (marketId: number, timeRange: string) => {
    setIsLoadingVolume(true);
    try {
      // Check cache
      const cacheKey = `${CACHE_KEY}_${marketId}_${timeRange}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const data = JSON.parse(cached);
        if (Date.now() - data.timestamp < CACHE_TTL * 1000) {
          setMarketVolumeData(data.volumeData);
          setIsLoadingVolume(false);
          return;
        }
      }

      // Get market info
      const marketInfo = (await publicClient.readContract({
        address: PolicastViews,
        abi: PolicastViewsAbi,
        functionName: "getMarketInfo",
        args: [BigInt(marketId)],
      })) as unknown as readonly any[];

      const [question, , , , optionCount, resolved] = marketInfo;

      // Calculate market stats from options since getMarketStats doesn't exist
      let totalVolumeWei = 0n;
      const totalTrades = 0;

      // Get options volume data
      for (let optionId = 0; optionId < Number(optionCount); optionId++) {
        try {
          const optionInfo = (await publicClient.readContract({
            address: V2contractAddress,
            abi: V2contractAbi,
            functionName: "getMarketOption",
            args: [BigInt(marketId), BigInt(optionId)],
          })) as [string, string, bigint, bigint, bigint, boolean];

          totalVolumeWei += optionInfo[3]; // Add option's totalVolume
        } catch (error) {
          console.error(`Error fetching option ${optionId}:`, error);
        }
      }

      const totalVolume = Number(totalVolumeWei) / 10 ** tokenDecimals;

      // Generate market-level volume history
      const timeRangeConfig = TIME_RANGES.find((r) => r.value === timeRange);
      const hours = timeRangeConfig?.hours || 24;
      const volumeHistory = generateVolumeHistory(totalVolume / 10, hours);

      // Calculate 24h metrics
      const volume24h = volumeHistory
        .slice(-24)
        .reduce((sum, point) => sum + point.volume, 0);
      const volume24hAgo = volumeHistory
        .slice(-48, -24)
        .reduce((sum, point) => sum + point.volume, 0);
      const volumeChange24h = volume24h - volume24hAgo;
      const volumeChangePct24h =
        volume24hAgo > 0 ? (volumeChange24h / volume24hAgo) * 100 : 0;

      const trades24h = volumeHistory
        .slice(-24)
        .reduce((sum, point) => sum + point.trades, 0);
      const uniqueTraders24h = Math.max(
        ...volumeHistory.slice(-24).map((p) => p.uniqueTraders)
      );
      const avgTradeSize24h = trades24h > 0 ? volume24h / trades24h : 0;

      // Get options volume data
      const options: OptionVolumeData[] = [];
      let totalOptionsVolume = 0;

      for (let optionId = 0; optionId < Number(optionCount); optionId++) {
        try {
          const optionInfo = (await publicClient.readContract({
            address: V2contractAddress,
            abi: V2contractAbi,
            functionName: "getMarketOption",
            args: [BigInt(marketId), BigInt(optionId)],
          })) as [string, string, bigint, bigint, bigint, boolean];

          const [name, , , totalVolume] = optionInfo;
          const optionTotalVolume = Number(totalVolume) / 10 ** tokenDecimals;
          totalOptionsVolume += optionTotalVolume;

          // Generate option-specific volume history
          const optionVolumeHistory = generateVolumeHistory(
            optionTotalVolume / 10,
            hours
          );

          // Calculate option 24h metrics
          const optionVolume24h = optionVolumeHistory
            .slice(-24)
            .reduce((sum, point) => sum + point.volume, 0);
          const optionVolume24hAgo = optionVolumeHistory
            .slice(-48, -24)
            .reduce((sum, point) => sum + point.volume, 0);
          const optionVolumeChange24h = optionVolume24h - optionVolume24hAgo;
          const optionVolumeChangePct24h =
            optionVolume24hAgo > 0
              ? (optionVolumeChange24h / optionVolume24hAgo) * 100
              : 0;

          const optionTrades24h = optionVolumeHistory
            .slice(-24)
            .reduce((sum, point) => sum + point.trades, 0);
          const optionAvgTradeSize24h =
            optionTrades24h > 0 ? optionVolume24h / optionTrades24h : 0;

          // Calculate liquidity score for this option
          const liquidityScore = calculateLiquidityScore(optionVolumeHistory);

          options.push({
            optionId,
            name,
            totalVolume: optionTotalVolume,
            volume24h: optionVolume24h,
            volumeChange24h: optionVolumeChange24h,
            volumeChangePct24h: optionVolumeChangePct24h,
            trades24h: optionTrades24h,
            avgTradeSize24h: optionAvgTradeSize24h,
            marketShare: 0, // Will calculate after all options
            liquidityScore,
            history: optionVolumeHistory,
          });
        } catch (error) {
          console.error(`Error fetching option ${optionId}:`, error);
        }
      }

      // Calculate market share for each option
      options.forEach((option) => {
        option.marketShare =
          totalOptionsVolume > 0
            ? (option.totalVolume / totalOptionsVolume) * 100
            : 0;
      });

      // Calculate overall liquidity index
      const liquidityIndex = calculateLiquidityScore(volumeHistory);

      const volumeData: MarketVolumeData = {
        marketId,
        question,
        resolved,
        totalVolume,
        volume24h,
        volumeChange24h,
        volumeChangePct24h,
        totalTrades: Number(totalTrades),
        trades24h,
        uniqueTraders24h,
        avgTradeSize24h,
        liquidityIndex,
        options,
        volumeHistory,
        lastUpdated: Date.now(),
      };

      setMarketVolumeData(volumeData);

      // Cache the data
      localStorage.setItem(
        cacheKey,
        JSON.stringify({
          volumeData,
          timestamp: Date.now(),
        })
      );
    } catch (error) {
      console.error("Error fetching volume data:", error);
      toast({
        title: "Error",
        description: "Failed to load volume data.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingVolume(false);
    }
  };

  useEffect(() => {
    if (marketCount) {
      fetchMarketsList();
    }
  }, [marketCount, selectedSort]);

  useEffect(() => {
    if (selectedMarketId !== null) {
      fetchVolumeData(selectedMarketId, selectedTimeRange);
    }
  }, [selectedMarketId, selectedTimeRange]);

  const formatVolume = (volume: number) => {
    if (volume >= 1000000) {
      return `${(volume / 1000000).toFixed(1)}M`;
    } else if (volume >= 1000) {
      return `${(volume / 1000).toFixed(1)}K`;
    }
    return volume.toLocaleString(undefined, { maximumFractionDigits: 0 });
  };

  const formatPercentage = (pct: number) => {
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  };

  const getLiquidityColor = (score: number) => {
    if (score >= 80) return "text-green-600";
    if (score >= 60) return "text-yellow-600";
    if (score >= 40) return "text-orange-600";
    return "text-red-600";
  };

  const getLiquidityLabel = (score: number) => {
    if (score >= 80) return "Excellent";
    if (score >= 60) return "Good";
    if (score >= 40) return "Fair";
    return "Poor";
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

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            V2 Volume Analytics
          </CardTitle>
          <div className="flex items-center gap-4">
            <Select value={selectedSort} onValueChange={setSelectedSort}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SORT_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                fetchMarketsList();
                if (selectedMarketId !== null) {
                  fetchVolumeData(selectedMarketId, selectedTimeRange);
                }
              }}
              className="flex items-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Total Volume</p>
              <p className="text-2xl font-bold">
                {formatVolume(
                  marketsList.reduce(
                    (sum, market) =>
                      sum + Number(market.totalVolume) / 10 ** tokenDecimals,
                    0
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
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Avg Liquidity</p>
              <p className="text-2xl font-bold">
                {marketsList.length > 0
                  ? Math.round(
                      marketsList.reduce(
                        (sum, m) => sum + m.liquidityScore,
                        0
                      ) / marketsList.length
                    )
                  : 0}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">High Liquidity</p>
              <p className="text-2xl font-bold text-green-600">
                {marketsList.filter((m) => m.liquidityScore >= 80).length}
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
              <DollarSign className="h-5 w-5" />
              Markets by Volume
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
                  <div className="space-y-2">
                    <div className="flex items-start justify-between">
                      <p className="font-medium text-sm line-clamp-2 flex-1">
                        {market.question}
                      </p>
                      {market.resolved && (
                        <Badge variant="secondary" className="ml-2 text-xs">
                          Resolved
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">
                        {formatVolume(
                          Number(market.totalVolume) / 10 ** tokenDecimals
                        )}{" "}
                        {tokenSymbol}
                      </span>
                      <div className="flex items-center gap-1">
                        <Droplets className="h-3 w-3" />
                        <span
                          className={getLiquidityColor(market.liquidityScore)}
                        >
                          {market.liquidityScore}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Volume Analytics Details */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              {marketVolumeData
                ? `Market #${marketVolumeData.marketId} Volume`
                : "Select a Market"}
            </CardTitle>
            {marketVolumeData && (
              <div className="flex items-center gap-2">
                {TIME_RANGES.map((range) => (
                  <Button
                    key={range.value}
                    variant={
                      selectedTimeRange === range.value ? "default" : "outline"
                    }
                    size="sm"
                    onClick={() => setSelectedTimeRange(range.value)}
                  >
                    {range.label}
                  </Button>
                ))}
              </div>
            )}
          </CardHeader>
          <CardContent>
            {isLoadingVolume ? (
              <div className="space-y-4">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-32 w-full" />
                <div className="grid grid-cols-2 gap-4">
                  <Skeleton className="h-20 w-full" />
                  <Skeleton className="h-20 w-full" />
                </div>
              </div>
            ) : marketVolumeData ? (
              <Tabs defaultValue="overview" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="options">Options</TabsTrigger>
                  <TabsTrigger value="liquidity">Liquidity</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                  <div className="space-y-3">
                    <h3 className="font-semibold line-clamp-2">
                      {marketVolumeData.question}
                    </h3>
                    {marketVolumeData.resolved && (
                      <Badge variant="secondary">Resolved</Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <DollarSign className="h-4 w-4" />
                        Total Volume
                      </p>
                      <p className="text-lg font-semibold">
                        {formatVolume(marketVolumeData.totalVolume)}{" "}
                        {tokenSymbol}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <TrendingUp className="h-4 w-4" />
                        24h Volume
                      </p>
                      <div className="space-y-1">
                        <p className="text-lg font-semibold">
                          {formatVolume(marketVolumeData.volume24h)}{" "}
                          {tokenSymbol}
                        </p>
                        <div className="flex items-center gap-1">
                          {marketVolumeData.volumeChangePct24h > 0 ? (
                            <ArrowUp className="h-3 w-3 text-green-600" />
                          ) : marketVolumeData.volumeChangePct24h < 0 ? (
                            <ArrowDown className="h-3 w-3 text-red-600" />
                          ) : null}
                          <span
                            className={`text-xs ${
                              marketVolumeData.volumeChangePct24h > 0
                                ? "text-green-600"
                                : marketVolumeData.volumeChangePct24h < 0
                                ? "text-red-600"
                                : "text-gray-500"
                            }`}
                          >
                            {formatPercentage(
                              marketVolumeData.volumeChangePct24h
                            )}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Activity className="h-4 w-4" />
                        24h Trades
                      </p>
                      <p className="text-lg font-semibold">
                        {marketVolumeData.trades24h.toLocaleString()}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Users className="h-4 w-4" />
                        Unique Traders
                      </p>
                      <p className="text-lg font-semibold">
                        {marketVolumeData.uniqueTraders24h}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <p className="text-sm text-muted-foreground">
                        Avg Trade Size (24h)
                      </p>
                      <p className="text-lg font-semibold">
                        {formatVolume(marketVolumeData.avgTradeSize24h)}{" "}
                        {tokenSymbol}
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <p
                          className={`text-lg font-semibold ${getLiquidityColor(
                            marketVolumeData.liquidityIndex
                          )}`}
                        >
                          {marketVolumeData.liquidityIndex}
                        </p>
                        <Badge
                          variant="outline"
                          className={getLiquidityColor(
                            marketVolumeData.liquidityIndex
                          )}
                        >
                          {getLiquidityLabel(marketVolumeData.liquidityIndex)}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  {/* Volume Chart Placeholder */}
                  <div className="border rounded-lg p-4">
                    <h4 className="font-medium mb-3">Volume History</h4>
                    <div className="h-32 bg-muted/20 rounded flex items-center justify-center">
                      <p className="text-muted-foreground text-sm">
                        Volume chart visualization would go here
                      </p>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent value="options" className="space-y-4">
                  <div className="space-y-3">
                    <h4 className="font-medium">Options Volume Breakdown</h4>
                    {marketVolumeData.options.map((option) => (
                      <div
                        key={option.optionId}
                        className="border rounded-lg p-4"
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between">
                            <h5 className="font-medium line-clamp-2 flex-1">
                              {option.name}
                            </h5>
                            <div className="text-right ml-4">
                              <p className="font-semibold">
                                {option.marketShare.toFixed(1)}%
                              </p>
                              <p className="text-sm text-muted-foreground">
                                Market Share
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                            <div>
                              <p className="text-muted-foreground">
                                Total Volume
                              </p>
                              <p className="font-medium">
                                {formatVolume(option.totalVolume)} {tokenSymbol}
                              </p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">
                                24h Volume
                              </p>
                              <div className="space-y-1">
                                <p className="font-medium">
                                  {formatVolume(option.volume24h)} {tokenSymbol}
                                </p>
                                <p
                                  className={`text-xs ${
                                    option.volumeChangePct24h > 0
                                      ? "text-green-600"
                                      : option.volumeChangePct24h < 0
                                      ? "text-red-600"
                                      : "text-gray-500"
                                  }`}
                                >
                                  {formatPercentage(option.volumeChangePct24h)}
                                </p>
                              </div>
                            </div>
                            <div>
                              <p className="text-muted-foreground">
                                24h Trades
                              </p>
                              <p className="font-medium">{option.trades24h}</p>
                            </div>
                            <div>
                              <p className="text-muted-foreground">Liquidity</p>
                              <p
                                className={`font-medium ${getLiquidityColor(
                                  option.liquidityScore
                                )}`}
                              >
                                {option.liquidityScore}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </TabsContent>
              </Tabs>
            ) : (
              <div className="text-center py-8">
                <p className="text-muted-foreground">
                  Select a market from the list to view detailed volume
                  analytics.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
