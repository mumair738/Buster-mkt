"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { useToast } from "@/components/ui/use-toast";
import { V2contractAddress, V2contractAbi } from "@/constants/contract";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DollarSign, Loader2, Gift } from "lucide-react";

interface UnusedPrizePool {
  marketId: number;
  amount: bigint;
  canWithdraw: boolean;
}

export function PrizePoolManager() {
  const { address, isConnected } = useAccount();
  const { toast } = useToast();
  const [unusedPrizePools, setUnusedPrizePools] = useState<UnusedPrizePool[]>(
    []
  );
  const [loading, setLoading] = useState(false);

  // Contract write for withdrawing unused prize pool
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  // Check for markets where user can withdraw unused prize pools
  useEffect(() => {
    const fetchUnusedPrizePools = async () => {
      if (!isConnected || !address) return;

      setLoading(true);
      const prizePools: UnusedPrizePool[] = [];

      // Check markets 0-50 for demo (in production, scan blockchain events)
      for (let marketId = 0; marketId < 50; marketId++) {
        try {
          const result = await fetch("/api/check-unused-prize-pool", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ marketId, userAddress: address }),
          });

          if (result.ok) {
            const data = await result.json();
            if (data.canWithdraw && data.amount > 0) {
              prizePools.push({
                marketId,
                amount: BigInt(data.amount),
                canWithdraw: true,
              });
            }
          }
        } catch (error) {
          console.error(
            `Error checking unused prize pool for market ${marketId}:`,
            error
          );
        }
      }

      setUnusedPrizePools(prizePools);
      setLoading(false);
    };

    fetchUnusedPrizePools();
  }, [isConnected, address]);

  // Handle withdrawing unused prize pool
  const handleWithdrawUnusedPrizePool = async (marketId: number) => {
    if (!address) return;

    try {
      toast({
        title: "Transaction Submitted",
        description: "Withdrawing unused prize pool...",
      });

      await writeContract({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "withdrawUnusedPrizePool",
        args: [BigInt(marketId)],
      });
    } catch (error: any) {
      console.error("Error withdrawing unused prize pool:", error);
      toast({
        title: "Transaction Failed",
        description:
          error?.shortMessage || "Failed to withdraw unused prize pool.",
        variant: "destructive",
      });
    }
  };

  // Handle successful transaction
  useEffect(() => {
    if (isSuccess) {
      toast({
        title: "Prize Pool Withdrawn!",
        description: "Your unused prize pool has been successfully withdrawn.",
      });
      // Refresh prize pool data
      setUnusedPrizePools((prev) =>
        prev.filter(
          (pool) =>
            !prev.some((p) => p.marketId === parseInt(hash?.toString() || "0"))
        )
      );
    }
  }, [isSuccess, hash]);

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
        <CardContent className="p-6 text-center">
          <Gift className="h-16 w-16 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium mb-2">Connect Your Wallet</h3>
          <p className="text-gray-600">
            Please connect your wallet to manage unused prize pools.
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalWithdrawable = unusedPrizePools.reduce(
    (sum, pool) => sum + pool.amount,
    0n
  );
  const totalWithdrawableEth = Number(totalWithdrawable) / 1e18;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gift className="h-5 w-5" />
          Prize Pool Manager
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <h3 className="font-medium text-green-800 mb-1">
            Total Unused Prize Pools
          </h3>
          <p className="text-2xl font-bold text-green-600">
            {totalWithdrawableEth.toFixed(4)} Buster
          </p>
          <p className="text-sm text-green-700 mt-1">
            From {unusedPrizePools.length} markets
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-green-600" />
            <span className="ml-2 text-sm text-gray-600">
              Checking unused prize pools...
            </span>
          </div>
        ) : unusedPrizePools.length === 0 ? (
          <div className="text-center py-8">
            <Gift className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p className="text-gray-600">No unused prize pools available</p>
            <p className="text-sm text-gray-500 mt-1">
              Prize pools are distributed when markets resolve
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {unusedPrizePools.map((pool) => (
              <div
                key={pool.marketId}
                className="flex items-center justify-between p-3 bg-white rounded-lg border"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    Market #{pool.marketId}
                  </p>
                  <p className="text-sm text-gray-600">
                    {formatAmount(pool.amount)} Buster
                  </p>
                </div>
                <Button
                  onClick={() => handleWithdrawUnusedPrizePool(pool.marketId)}
                  disabled={isPending || isConfirming}
                  size="sm"
                  className="bg-green-600 hover:bg-green-700"
                >
                  {isPending || isConfirming ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Withdrawing...
                    </>
                  ) : (
                    "Withdraw"
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
