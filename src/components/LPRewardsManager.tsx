"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
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
import { useToast } from "@/hooks/use-toast";
import { V2contractAddress, V2contractAbi } from "@/constants/contract";
import { Coins, Loader2, CheckCircle, AlertTriangle } from "lucide-react";

interface LPReward {
  marketId: number;
  estimatedRewards: bigint;
  contribution: bigint;
  rewardsClaimed: boolean;
}

export function LPRewardsManager() {
  const { address, isConnected } = useAccount();
  const { toast } = useToast();
  const [lpRewards, setLpRewards] = useState<LPReward[]>([]);
  const [loading, setLoading] = useState(false);

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash });

  // Get user's LP rewards earned globally
  const { data: globalLPRewards } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "lpRewardsEarned",
    args: [address as `0x${string}`],
    query: { enabled: isConnected && !!address },
  });

  // Get user's participated markets and check LP rewards
  useEffect(() => {
    const fetchLPRewards = async () => {
      if (!isConnected || !address) return;

      setLoading(true);
      const rewards: LPReward[] = [];

      // Check markets 0-50 for demo (in production, you'd scan blockchain events)
      for (let marketId = 0; marketId < 50; marketId++) {
        try {
          const result = await fetch("/api/check-lp-rewards", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ marketId, userAddress: address }),
          });

          if (result.ok) {
            const data = await result.json();
            if (data.hasRewards && data.estimatedRewards > 0) {
              rewards.push({
                marketId,
                estimatedRewards: BigInt(data.estimatedRewards),
                contribution: BigInt(data.contribution),
                rewardsClaimed: data.rewardsClaimed,
              });
            }
          }
        } catch (error) {
          console.error(
            `Error checking LP rewards for market ${marketId}:`,
            error
          );
        }
      }

      setLpRewards(rewards);
      setLoading(false);
    };

    fetchLPRewards();
  }, [isConnected, address]);

  const handleClaimLPRewards = async (marketId: number) => {
    if (!address) return;

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

  // Handle successful transaction
  useEffect(() => {
    if (isConfirmed) {
      toast({
        title: "LP Rewards Claimed!",
        description: "Your LP rewards have been successfully claimed.",
      });
      // Refresh LP rewards data
      setLpRewards((prev) =>
        prev.filter(
          (reward) =>
            !prev.some((r) => r.marketId === parseInt(hash?.toString() || "0"))
        )
      );
    }
  }, [isConfirmed, hash, toast]);

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
          <Coins className="h-16 w-16 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium mb-2">Connect Your Wallet</h3>
          <p className="text-gray-600">
            Please connect your wallet to claim LP rewards.
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalClaimableRewards = lpRewards
    .filter((r) => !r.rewardsClaimed)
    .reduce((sum, r) => sum + r.estimatedRewards, 0n);
  const totalClaimableEth = Number(totalClaimableRewards) / 1e18;

  return (
    <div className="space-y-6">
      {/* Overview Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5" />
            LP Rewards Overview
          </CardTitle>
          <CardDescription>
            Earn rewards by providing liquidity to AMM markets
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
              <h3 className="font-medium text-green-800 mb-1">
                Total LP Rewards Earned
              </h3>
              <p className="text-2xl font-bold text-green-600">
                {formatAmount(globalLPRewards)} Buster
              </p>
              <p className="text-sm text-green-700 mt-1">
                Across all markets you&apos;ve provided liquidity to
              </p>
            </div>

            <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h3 className="font-medium text-blue-800 mb-1">
                Available to Claim
              </h3>
              <p className="text-2xl font-bold text-blue-600">
                {totalClaimableEth.toFixed(4)} Buster
              </p>
              <p className="text-sm text-blue-700 mt-1">
                From {lpRewards.filter((r) => !r.rewardsClaimed).length} markets
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Claimable Rewards */}
      <Card>
        <CardHeader>
          <CardTitle>Claimable LP Rewards</CardTitle>
          <CardDescription>
            Claim your accumulated liquidity provider rewards
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
              <span className="ml-2 text-sm text-gray-600">
                Checking available LP rewards...
              </span>
            </div>
          ) : lpRewards.filter((r) => !r.rewardsClaimed).length === 0 ? (
            <div className="text-center py-8">
              <Coins className="w-12 h-12 mx-auto mb-4 text-gray-400" />
              <p className="text-gray-600">No LP rewards available to claim</p>
              <p className="text-sm text-gray-500 mt-1">
                Provide liquidity to markets to earn rewards
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {lpRewards
                .filter((r) => !r.rewardsClaimed)
                .map((reward) => (
                  <div
                    key={reward.marketId}
                    className="flex items-center justify-between p-3 bg-white rounded-lg border"
                  >
                    <div>
                      <p className="font-medium text-gray-900">
                        Market #{reward.marketId}
                      </p>
                      <p className="text-sm text-gray-600">
                        Reward: {formatAmount(reward.estimatedRewards)} Buster
                      </p>
                      <p className="text-xs text-gray-500">
                        Your LP contribution:{" "}
                        {formatAmount(reward.contribution)} Buster
                      </p>
                    </div>
                    <Button
                      onClick={() => handleClaimLPRewards(reward.marketId)}
                      disabled={isPending || isConfirming}
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700"
                    >
                      {isPending || isConfirming ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          Claiming...
                        </>
                      ) : (
                        "Claim"
                      )}
                    </Button>
                  </div>
                ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Info Card */}
      <Card className="border-blue-200 bg-blue-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-blue-800">
                LP Rewards Information
              </h3>
              <div className="text-sm text-blue-700 mt-1 space-y-1">
                <p>
                  • LP rewards are earned automatically when users swap through
                  AMMs you&apos;ve provided liquidity to
                </p>
                <p>• You can claim rewards for each market individually</p>
                <p>
                  • Rewards accumulate over time and can be claimed at any point
                </p>
                <p>
                  • The 0.3% AMM fee is distributed proportionally among all
                  liquidity providers
                </p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
