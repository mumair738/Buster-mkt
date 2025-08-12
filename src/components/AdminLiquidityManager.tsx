"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { parseEther } from "viem";
import { useToast } from "@/components/ui/use-toast";
import {
  V2contractAddress,
  V2contractAbi,
  publicClient,
} from "@/constants/contract";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  DollarSign,
  TrendingUp,
  Droplets,
  AlertTriangle,
  Loader2,
  CheckCircle,
  BarChart3,
} from "lucide-react";
import { useUserRoles } from "@/hooks/useUserRoles";
import Link from "next/link";

interface MarketLiquidity {
  marketId: number;
  question: string;
  totalLiquidity: bigint;
  ammLiquidityPool: bigint;
  totalVolume: bigint;
  optionCount: number;
  resolved: boolean;
  liquidityRatio: number; // liquidity vs volume ratio
}

export function AdminLiquidityManager() {
  const { isConnected } = useAccount();
  const { isOwner, isAdmin } = useUserRoles();
  const { toast } = useToast();

  const [markets, setMarkets] = useState<MarketLiquidity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedMarket, setSelectedMarket] = useState<MarketLiquidity | null>(
    null
  );
  const [liquidityAmount, setLiquidityAmount] = useState<string>("100");

  const { data: marketCount } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getMarketCount",
    query: { enabled: isConnected },
  });

  const { writeContract, data: hash, error, isPending } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({
      hash,
    });

  const fetchMarketLiquidity = async () => {
    if (!marketCount || !isConnected) return;

    setIsLoading(true);
    try {
      const count = Number(marketCount);
      const marketPromises: Promise<MarketLiquidity | null>[] = [];

      for (let i = 0; i < count; i++) {
        marketPromises.push(fetchMarketLiquidityInfo(i));
      }

      const results = await Promise.all(marketPromises);
      const validMarkets = results.filter(
        (market): market is MarketLiquidity => market !== null
      );

      // Sort by liquidity ratio (lower ratio = needs more liquidity)
      validMarkets.sort((a, b) => a.liquidityRatio - b.liquidityRatio);

      setMarkets(validMarkets);
    } catch (error) {
      console.error("Error fetching market liquidity:", error);
      toast({
        title: "Error",
        description: "Failed to load market liquidity data.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const fetchMarketLiquidityInfo = async (
    marketId: number
  ): Promise<MarketLiquidity | null> => {
    try {
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

      const [question, , , , optionCount, resolved] = marketInfo;

      // For now, we'll simulate liquidity data since it's not in the current ABI
      // In a real implementation, you'd fetch this from the contract
      const totalLiquidity =
        BigInt(Math.floor(Math.random() * 10000) + 1000) * BigInt(10 ** 18);
      const ammLiquidityPool =
        BigInt(Math.floor(Math.random() * 5000) + 500) * BigInt(10 ** 18);
      const totalVolume =
        BigInt(Math.floor(Math.random() * 20000) + 100) * BigInt(10 ** 18);

      // Calculate liquidity ratio (liquidity / volume)
      const liquidityRatio =
        Number(totalLiquidity) / Math.max(Number(totalVolume), 1);

      return {
        marketId,
        question,
        totalLiquidity,
        ammLiquidityPool,
        totalVolume,
        optionCount: Number(optionCount),
        resolved,
        liquidityRatio,
      };
    } catch (error) {
      console.error(`Error fetching liquidity for market ${marketId}:`, error);
      return null;
    }
  };

  useEffect(() => {
    if (isConnected && marketCount) {
      fetchMarketLiquidity();
    }
  }, [isConnected, marketCount]);

  const handleAddLiquidity = async () => {
    if (!selectedMarket || !liquidityAmount || !isAdmin) return;

    try {
      const amountWei = parseEther(liquidityAmount);

      await writeContract({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "addAMMLiquidity",
        args: [BigInt(selectedMarket.marketId), amountWei],
      });

      setSelectedMarket(null);
      setLiquidityAmount("100");
    } catch (error) {
      console.error("Error adding liquidity:", error);
      toast({
        title: "Error",
        description: "Failed to add liquidity.",
        variant: "destructive",
      });
    }
  };

  const formatAmount = (amount: bigint) => {
    const value = Number(amount) / 10 ** 18;
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const getLiquidityStatus = (ratio: number) => {
    if (ratio >= 0.5) {
      return { label: "Good", color: "text-green-600", bg: "bg-green-100" };
    } else if (ratio >= 0.2) {
      return { label: "Low", color: "text-yellow-600", bg: "bg-yellow-100" };
    } else {
      return { label: "Critical", color: "text-red-600", bg: "bg-red-100" };
    }
  };

  const totalLiquidity = markets.reduce(
    (sum, market) => sum + Number(market.totalLiquidity),
    0
  );
  const totalVolume = markets.reduce(
    (sum, market) => sum + Number(market.totalVolume),
    0
  );
  const avgLiquidityRatio =
    markets.length > 0
      ? markets.reduce((sum, market) => sum + market.liquidityRatio, 0) /
        markets.length
      : 0;

  if (!isConnected) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <DollarSign className="h-16 w-16 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium mb-2">Connect Your Wallet</h3>
          <p className="text-gray-600">
            Please connect your wallet to manage liquidity.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <AlertTriangle className="h-16 w-16 mx-auto text-red-400 mb-4" />
          <h3 className="text-lg font-medium mb-2">Access Denied</h3>
          <p className="text-gray-600">
            Only admins can manage platform liquidity.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isConfirmed) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <CheckCircle className="h-16 w-16 mx-auto text-green-500 mb-4" />
          <h3 className="text-lg font-medium mb-2">
            Liquidity Added Successfully!
          </h3>
          <p className="text-gray-600 mb-4">
            The market liquidity has been updated.
          </p>
          <Button onClick={() => window.location.reload()}>Refresh Data</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Platform Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Total Platform Liquidity
                </p>
                <p className="text-2xl font-bold">
                  {(totalLiquidity / 10 ** 18).toLocaleString()} BSTR
                </p>
              </div>
              <DollarSign className="h-8 w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Total Volume
                </p>
                <p className="text-2xl font-bold">
                  {(totalVolume / 10 ** 18).toLocaleString()} BSTR
                </p>
              </div>
              <BarChart3 className="h-8 w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Avg Liquidity Ratio
                </p>
                <p className="text-2xl font-bold">
                  {avgLiquidityRatio.toFixed(2)}x
                </p>
              </div>
              <TrendingUp className="h-8 w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Markets Liquidity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Droplets className="h-5 w-5" />
            Market Liquidity Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="border rounded-lg p-4 animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                </div>
              ))}
            </div>
          ) : markets.length === 0 ? (
            <div className="text-center py-8">
              <Droplets className="h-16 w-16 mx-auto text-gray-400 mb-4" />
              <h3 className="text-lg font-medium mb-2">No Markets Found</h3>
              <p className="text-gray-600">
                No markets available for liquidity management.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {markets.map((market) => {
                const status = getLiquidityStatus(market.liquidityRatio);
                return (
                  <Card
                    key={market.marketId}
                    className="border border-gray-200"
                  >
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <Link href={`/market/${market.marketId}`}>
                            <h3 className="font-medium text-lg hover:text-blue-600 transition-colors line-clamp-2">
                              {market.question}
                            </h3>
                          </Link>
                          <div className="flex items-center gap-2 mt-2">
                            <Badge className={`${status.color} ${status.bg}`}>
                              {status.label} Liquidity
                            </Badge>
                            {market.resolved && (
                              <Badge variant="outline">Resolved</Badge>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4 text-sm">
                        <div>
                          <span className="text-gray-500">Market ID:</span>
                          <p className="font-medium">#{market.marketId}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">
                            Total Liquidity:
                          </span>
                          <p className="font-medium">
                            {formatAmount(market.totalLiquidity)} BSTR
                          </p>
                        </div>
                        <div>
                          <span className="text-gray-500">AMM Pool:</span>
                          <p className="font-medium">
                            {formatAmount(market.ammLiquidityPool)} BSTR
                          </p>
                        </div>
                        <div>
                          <span className="text-gray-500">Volume:</span>
                          <p className="font-medium">
                            {formatAmount(market.totalVolume)} BSTR
                          </p>
                        </div>
                      </div>

                      {/* Liquidity Ratio Progress */}
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium">
                            Liquidity Ratio
                          </span>
                          <span className="text-sm text-gray-600">
                            {market.liquidityRatio.toFixed(2)}x
                          </span>
                        </div>
                        <Progress
                          value={Math.min(market.liquidityRatio * 100, 100)}
                          className="h-2"
                        />
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2">
                        {!market.resolved && (
                          <Button
                            size="sm"
                            onClick={() => setSelectedMarket(market)}
                            className="flex items-center gap-2"
                          >
                            <Droplets className="h-4 w-4" />
                            Add Liquidity
                          </Button>
                        )}

                        <Link href={`/market/${market.marketId}`}>
                          <Button variant="ghost" size="sm">
                            View Market
                          </Button>
                        </Link>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Liquidity Modal */}
      {selectedMarket && (
        <Card>
          <CardHeader>
            <CardTitle>
              Add Liquidity to Market #{selectedMarket.marketId}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 bg-gray-50 rounded-lg">
              <h3 className="font-medium mb-2">{selectedMarket.question}</h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-gray-500">Current Liquidity:</span>
                  <p className="font-medium">
                    {formatAmount(selectedMarket.totalLiquidity)} BSTR
                  </p>
                </div>
                <div>
                  <span className="text-gray-500">Current Ratio:</span>
                  <p className="font-medium">
                    {selectedMarket.liquidityRatio.toFixed(2)}x
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="liquidityAmount">Amount to Add (BSTR) *</Label>
              <Input
                id="liquidityAmount"
                type="number"
                min="1"
                step="0.01"
                value={liquidityAmount}
                onChange={(e) => setLiquidityAmount(e.target.value)}
                placeholder="Enter amount..."
              />
              <p className="text-sm text-gray-500">
                New liquidity:{" "}
                {formatAmount(
                  selectedMarket.totalLiquidity +
                    parseEther(liquidityAmount || "0")
                )}{" "}
                BSTR
              </p>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleAddLiquidity}
                disabled={
                  !liquidityAmount ||
                  parseFloat(liquidityAmount) <= 0 ||
                  isPending ||
                  isConfirming
                }
                className="flex items-center gap-2"
              >
                {isPending || isConfirming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Droplets className="h-4 w-4" />
                )}
                Add Liquidity
              </Button>
              <Button variant="outline" onClick={() => setSelectedMarket(null)}>
                Cancel
              </Button>
            </div>

            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-700 text-sm">Error: {error.message}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
