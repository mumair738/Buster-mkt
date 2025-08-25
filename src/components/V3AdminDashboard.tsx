"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useV3PlatformData } from "@/hooks/useV3PlatformData";
import { V2contractAddress, V2contractAbi } from "@/constants/contract";
import {
  Loader2,
  DollarSign,
  Settings,
  Users,
  TrendingUp,
  RefreshCw,
  AlertCircle,
  CheckCircle,
} from "lucide-react";

export function V3AdminDashboard() {
  const { address, isConnected } = useAccount();
  const { toast } = useToast();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [newFeeRate, setNewFeeRate] = useState("200"); // 2%
  const [newFeeCollector, setNewFeeCollector] = useState("");

  // Use the custom hook for platform data
  const {
    globalStats,
    currentFeeRate,
    isOwner,
    isFeeCollector,
    isLoadingStats,
    refreshAllData,
  } = useV3PlatformData();

  // Contract interactions
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash });

  // Handle transaction success
  useEffect(() => {
    if (isConfirmed && hash) {
      handleRefresh();
      toast({
        title: "Transaction Successful",
        description: "Platform settings updated successfully.",
      });
    }
  }, [isConfirmed, hash]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refreshAllData();
      toast({
        title: "Data Refreshed",
        description: "Platform data has been updated.",
      });
    } catch (error) {
      console.error("Failed to refresh data:", error);
      toast({
        title: "Refresh Failed",
        description: "Failed to refresh platform data.",
        variant: "destructive",
      });
    } finally {
      setIsRefreshing(false);
    }
  };

  // Withdraw platform fees
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

  // Set platform fee rate
  const handleSetFeeRate = async () => {
    try {
      const feeRateValue = parseInt(newFeeRate);
      if (feeRateValue < 0 || feeRateValue > 1000) {
        toast({
          title: "Invalid Fee Rate",
          description:
            "Fee rate must be between 0% and 10% (0-1000 basis points).",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Transaction Submitted",
        description: "Updating platform fee rate...",
      });

      await writeContract({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "setPlatformFeeRate",
        args: [BigInt(feeRateValue)],
      });
    } catch (error: any) {
      console.error("Error setting fee rate:", error);
      toast({
        title: "Transaction Failed",
        description: error?.shortMessage || "Failed to set fee rate.",
        variant: "destructive",
      });
    }
  };

  // Set fee collector
  const handleSetFeeCollector = async () => {
    try {
      if (!newFeeCollector || !newFeeCollector.startsWith("0x")) {
        toast({
          title: "Invalid Address",
          description: "Please enter a valid Ethereum address.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Transaction Submitted",
        description: "Updating fee collector address...",
      });

      await writeContract({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "setFeeCollector",
        args: [newFeeCollector as `0x${string}`],
      });
    } catch (error: any) {
      console.error("Error setting fee collector:", error);
      toast({
        title: "Transaction Failed",
        description: error?.shortMessage || "Failed to set fee collector.",
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

  // Format fee rate
  const formatFeeRate = (rate: bigint | undefined) => {
    if (!rate) return "0.00";
    return (Number(rate) / 100).toFixed(2);
  };

  if (!isConnected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Admin Dashboard</CardTitle>
          <CardDescription>
            Connect wallet to access admin functions
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (!isOwner && !isFeeCollector) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            Access Denied
          </CardTitle>
          <CardDescription>
            You need to be the contract owner or fee collector to access this
            dashboard.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6 mb-20">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">V3 Admin Dashboard</h1>
          <p className="text-gray-500">
            Manage platform settings and collect fees
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={isOwner ? "default" : "secondary"}>
            {isOwner
              ? "Owner"
              : isFeeCollector
              ? "Fee Collector"
              : "Unauthorized"}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Platform Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Total Fees Collected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatAmount(globalStats?.totalFeesCollected)} BSTR
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Markets</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {globalStats?.totalMarkets?.toString() || "0"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Trades</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {globalStats?.totalTrades?.toString() || "0"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Current Fee Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatFeeRate(currentFeeRate)}%
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="fees" className="space-y-4">
        <TabsList>
          <TabsTrigger value="fees">Fee Management</TabsTrigger>
          {isOwner && (
            <TabsTrigger value="settings">Platform Settings</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="fees" className="space-y-4">
          {/* Fee Collection */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Platform Fee Collection
              </CardTitle>
              <CardDescription>
                Withdraw accumulated platform fees
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-4 border rounded-lg gap-4">
                <div className="flex-1">
                  <p className="font-medium">Available for Withdrawal</p>
                  <p className="text-2xl font-bold text-green-600">
                    {formatAmount(globalStats?.totalFeesCollected)} BSTR
                  </p>
                  <p className="text-sm text-gray-500">
                    Fee Collector: {globalStats?.feeCollector}
                  </p>
                </div>
                <Button
                  onClick={handleWithdrawPlatformFees}
                  disabled={
                    isPending ||
                    isConfirming ||
                    !globalStats?.totalFeesCollected ||
                    globalStats.totalFeesCollected === 0n
                  }
                  className="flex items-center gap-2 w-full sm:w-auto"
                >
                  {isPending || isConfirming ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <DollarSign className="h-4 w-4" />
                  )}
                  Withdraw Fees
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {isOwner && (
          <TabsContent value="settings" className="space-y-4">
            {/* Platform Settings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="h-5 w-5" />
                    Platform Fee Rate
                  </CardTitle>
                  <CardDescription>
                    Set the platform fee rate (in basis points, 100 = 1%)
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="feeRate">Fee Rate (basis points)</Label>
                    <Input
                      id="feeRate"
                      type="number"
                      min="0"
                      max="1000"
                      value={newFeeRate}
                      onChange={(e) => setNewFeeRate(e.target.value)}
                      placeholder="200 (2%)"
                    />
                    <p className="text-sm text-gray-500">
                      Current: {formatFeeRate(currentFeeRate)}% | New:{" "}
                      {(parseInt(newFeeRate) / 100).toFixed(2)}%
                    </p>
                  </div>
                  <Button
                    onClick={handleSetFeeRate}
                    disabled={isPending || isConfirming}
                    className="w-full"
                  >
                    {isPending || isConfirming ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Settings className="h-4 w-4" />
                    )}
                    Update Fee Rate
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Fee Collector Address
                  </CardTitle>
                  <CardDescription>
                    Set the address that can withdraw platform fees
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="feeCollector">Fee Collector Address</Label>
                    <Input
                      id="feeCollector"
                      type="text"
                      value={newFeeCollector}
                      onChange={(e) => setNewFeeCollector(e.target.value)}
                      placeholder="0x..."
                    />
                    <p className="text-sm text-gray-500">
                      Current: {globalStats?.feeCollector}
                    </p>
                  </div>
                  <Button
                    onClick={handleSetFeeCollector}
                    disabled={isPending || isConfirming || !newFeeCollector}
                    className="w-full"
                  >
                    {isPending || isConfirming ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Users className="h-4 w-4" />
                    )}
                    Update Fee Collector
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
