"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { V2contractAddress, V2contractAbi } from "@/constants/contract";
import { Loader2, DollarSign, TrendingUp, Coins } from "lucide-react";

interface V3FinancialManagerProps {
  marketId?: number; // Optional for platform-wide management
  isCreator?: boolean;
  isLP?: boolean;
  isFeeCollector?: boolean;
  isPlatformMode?: boolean; // New prop for platform-wide management
}

export function V3FinancialManager({
  marketId,
  isCreator = false,
  isLP = false,
  isFeeCollector = false,
  isPlatformMode = false,
}: V3FinancialManagerProps) {
  const { address, isConnected } = useAccount();
  const { toast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [actualIsCreator, setActualIsCreator] = useState(isCreator);
  const [actualIsLP, setActualIsLP] = useState(isLP);

  // Contract interactions
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash });

  // Fetch market info to determine creator
  const { data: marketInfo } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getMarketInfo",
    args: marketId !== undefined ? [BigInt(marketId)] : undefined,
    query: { enabled: isConnected && marketId !== undefined },
  });

  // Fetch market financial data
  const { data: marketFinancials, refetch: refetchFinancials } =
    useReadContract({
      address: V2contractAddress,
      abi: V2contractAbi,
      functionName: "getMarketFinancials",
      args: marketId !== undefined ? [BigInt(marketId)] : undefined,
      query: { enabled: isConnected && marketId !== undefined },
    });

  // Fetch LP info if user might be LP
  const { data: lpInfo, refetch: refetchLPInfo } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getLPInfo",
    args:
      marketId !== undefined && address
        ? [BigInt(marketId), address]
        : undefined,
    query: {
      enabled: isConnected && Boolean(address) && marketId !== undefined,
    },
  });

  // Fetch platform stats if fee collector
  const { data: platformStats, refetch: refetchPlatformStats } =
    useReadContract({
      address: V2contractAddress,
      abi: V2contractAbi,
      functionName: "getPlatformStats",
      query: { enabled: isConnected && isFeeCollector },
    });

  // Determine actual roles based on contract data
  useEffect(() => {
    if (marketInfo && address) {
      const [, , , , , , , , creator] = marketInfo as [
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
      setActualIsCreator(creator.toLowerCase() === address.toLowerCase());
    }
  }, [marketInfo, address]);

  useEffect(() => {
    if (lpInfo && address) {
      const [contribution] = lpInfo as [bigint, boolean, bigint];
      setActualIsLP(contribution > 0n);
    }
  }, [lpInfo, address]);

  // Handle transaction success
  useEffect(() => {
    if (isConfirmed && hash) {
      handleRefresh();
      toast({
        title: "Transaction Successful",
        description: "Financial operation completed successfully.",
      });
    }
  }, [isConfirmed, hash]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        refetchFinancials(),
        actualIsLP ? refetchLPInfo() : Promise.resolve(),
        isFeeCollector ? refetchPlatformStats() : Promise.resolve(),
      ]);
      toast({
        title: "Data Refreshed",
        description: "Financial data has been updated.",
      });
    } catch (error) {
      console.error("Failed to refresh data:", error);
      toast({
        title: "Refresh Failed",
        description: "Failed to refresh financial data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  // Withdraw admin liquidity (for market creator)
  const handleWithdrawAdminLiquidity = async () => {
    if (marketId === undefined) {
      toast({
        title: "Error",
        description: "Market ID is required for this operation.",
        variant: "destructive",
      });
      return;
    }

    try {
      toast({
        title: "Transaction Submitted",
        description: "Withdrawing admin liquidity...",
      });

      await writeContract({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "withdrawAdminLiquidity",
        args: [BigInt(marketId)],
      });
    } catch (error: any) {
      console.error("Error withdrawing admin liquidity:", error);
      toast({
        title: "Transaction Failed",
        description:
          error?.shortMessage || "Failed to withdraw admin liquidity.",
        variant: "destructive",
      });
    }
  };

  // Claim LP rewards
  const handleClaimLPRewards = async () => {
    if (marketId === undefined) {
      toast({
        title: "Error",
        description: "Market ID is required for this operation.",
        variant: "destructive",
      });
      return;
    }

    try {
      toast({
        title: "Transaction Submitted",
        description: "Claiming LP rewards...",
      });

      await writeContract({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "claimLPRewards",
        args: [BigInt(marketId)],
      });
    } catch (error: any) {
      console.error("Error claiming LP rewards:", error);
      toast({
        title: "Transaction Failed",
        description: error?.shortMessage || "Failed to claim LP rewards.",
        variant: "destructive",
      });
    }
  };

  // Withdraw platform fees (for fee collector)
  const handleWithdrawPlatformFees = async () => {
    try {
      toast({
        title: "Transaction Submitted",
        description: "Withdrawing platform fees...",
      });

      await writeContract({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "withdrawPlatformFees",
        args: [],
      });
    } catch (error: any) {
      console.error("Error withdrawing platform fees:", error);
      toast({
        title: "Transaction Failed",
        description: error?.shortMessage || "Failed to withdraw platform fees.",
        variant: "destructive",
      });
    }
  };

  // Format amounts
  const formatAmount = (amount: bigint | undefined) => {
    if (!amount) return "0.00";
    const value = Number(amount) / 10 ** 18;
    return value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  if (!isConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Financial Management</CardTitle>
          <CardDescription>
            Connect wallet to view financial options
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  // If no marketId provided, show platform-wide management only
  if (marketId === undefined) {
    if (!isFeeCollector) {
      return (
        <Card>
          <CardHeader>
            <CardTitle>Platform Financial Management</CardTitle>
            <CardDescription>
              You need to be a fee collector to access platform financial
              features
            </CardDescription>
          </CardHeader>
        </Card>
      );
    }

    // Platform-wide fee collection interface
    const [totalFeesCollected, feeCollector, totalMarkets, totalTrades] =
      platformStats || [];

    return (
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Platform Fee Collection
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefresh}
                disabled={isRefreshing}
              >
                {isRefreshing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  "Refresh"
                )}
              </Button>
            </CardTitle>
            <CardDescription>
              Global platform statistics and fee withdrawal
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">Total Fees Collected</p>
                <p className="text-lg font-semibold">
                  {formatAmount(totalFeesCollected)} BSTR
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Markets</p>
                <p className="text-lg font-semibold">
                  {totalMarkets?.toString()}
                </p>
              </div>
            </div>

            {totalFeesCollected && totalFeesCollected > 0n && (
              <Button
                onClick={handleWithdrawPlatformFees}
                disabled={isPending || isConfirming}
                className="w-full flex items-center gap-2"
              >
                {isPending || isConfirming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <DollarSign className="h-4 w-4" />
                )}
                Withdraw Platform Fees
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const [
    adminInitialLiquidity,
    userLiquidity,
    platformFeesCollected,
    ammFeesCollected,
    adminLiquidityClaimed,
  ] = marketFinancials || [];
  const [lpContribution, lpRewardsClaimed, estimatedRewards] = lpInfo || [];
  const [totalFeesCollected, feeCollector, totalMarkets, totalTrades] =
    platformStats || [];

  return (
    <div className="space-y-4">
      {/* Market Financial Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Market Financial Breakdown
            <Button
              variant="ghost"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              {isRefreshing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Refresh"
              )}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-gray-500">Admin Initial Liquidity</p>
              <p className="text-lg font-semibold">
                {formatAmount(adminInitialLiquidity)} BSTR
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">User Liquidity</p>
              <p className="text-lg font-semibold">
                {formatAmount(userLiquidity)} BSTR
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Platform Fees Collected</p>
              <p className="text-lg font-semibold">
                {formatAmount(platformFeesCollected)} BSTR
              </p>
            </div>
            <div>
              <p className="text-sm text-gray-500">AMM Fees for LPs</p>
              <p className="text-lg font-semibold">
                {formatAmount(ammFeesCollected)} BSTR
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Admin Liquidity Recovery */}
      {actualIsCreator &&
        adminInitialLiquidity &&
        adminInitialLiquidity > 0n &&
        !adminLiquidityClaimed && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Coins className="h-5 w-5" />
                Admin Liquidity Recovery
              </CardTitle>
              <CardDescription>
                Recover your initial liquidity investment after market
                resolution
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Recoverable Amount</p>
                  <p className="text-lg font-bold text-green-600">
                    {formatAmount(adminInitialLiquidity)} BSTR
                  </p>
                </div>
                <Button
                  onClick={handleWithdrawAdminLiquidity}
                  disabled={isPending || isConfirming}
                  className="flex items-center gap-2"
                >
                  {isPending || isConfirming ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Coins className="h-4 w-4" />
                  )}
                  Withdraw Liquidity
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

      {/* LP Rewards */}
      {actualIsLP && lpContribution && lpContribution > 0n && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Liquidity Provider Rewards
            </CardTitle>
            <CardDescription>
              Claim your share of AMM trading fees
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">Your LP Contribution</p>
                <p className="text-lg font-semibold">
                  {formatAmount(lpContribution)} BSTR
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Estimated Rewards</p>
                <p className="text-lg font-semibold">
                  {formatAmount(estimatedRewards)} BSTR
                </p>
              </div>
            </div>

            {!lpRewardsClaimed && estimatedRewards && estimatedRewards > 0n && (
              <Button
                onClick={handleClaimLPRewards}
                disabled={isPending || isConfirming}
                className="w-full flex items-center gap-2"
              >
                {isPending || isConfirming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <TrendingUp className="h-4 w-4" />
                )}
                Claim LP Rewards
              </Button>
            )}

            {lpRewardsClaimed && (
              <Badge variant="secondary" className="w-full justify-center">
                Rewards Already Claimed
              </Badge>
            )}
          </CardContent>
        </Card>
      )}

      {/* Platform Fee Collection */}
      {isFeeCollector && platformStats && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Platform Fee Collection
            </CardTitle>
            <CardDescription>
              Global platform statistics and fee withdrawal
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-gray-500">Total Fees Collected</p>
                <p className="text-lg font-semibold">
                  {formatAmount(totalFeesCollected)} BSTR
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Total Markets</p>
                <p className="text-lg font-semibold">
                  {totalMarkets?.toString()}
                </p>
              </div>
            </div>

            {totalFeesCollected && totalFeesCollected > 0n && (
              <Button
                onClick={handleWithdrawPlatformFees}
                disabled={isPending || isConfirming}
                className="w-full flex items-center gap-2"
              >
                {isPending || isConfirming ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <DollarSign className="h-4 w-4" />
                )}
                Withdraw Platform Fees
              </Button>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
