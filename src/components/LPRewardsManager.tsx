"use client";

import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { V2contractAddress, V2contractAbi } from "@/constants/contract";
import { Coins, Loader2, CheckCircle, AlertTriangle } from "lucide-react";

export function LPRewardsManager() {
  const { address, isConnected } = useAccount();
  const { toast } = useToast();
  const [marketId, setMarketId] = useState("");

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

  const handleClaimLPRewards = async () => {
    if (!marketId) {
      toast({
        title: "Missing Market ID",
        description: "Please enter a market ID to claim LP rewards.",
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

  if (isConfirmed) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <CheckCircle className="h-16 w-16 mx-auto text-green-500 mb-4" />
          <h3 className="text-lg font-medium mb-2">LP Rewards Claimed!</h3>
          <p className="text-gray-600 mb-4">
            Your LP rewards have been successfully claimed.
          </p>
          <Button onClick={() => window.location.reload()}>Continue</Button>
        </CardContent>
      </Card>
    );
  }

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
                How LP Rewards Work
              </h3>
              <ul className="text-sm text-blue-700 space-y-1">
                <li>• Earn 0.3% fee from every AMM swap</li>
                <li>• Rewards proportional to liquidity provided</li>
                <li>• Claim rewards per market</li>
                <li>• No time restrictions on claiming</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Claim Rewards Card */}
      <Card>
        <CardHeader>
          <CardTitle>Claim LP Rewards</CardTitle>
          <CardDescription>
            Enter a market ID to claim your accumulated liquidity provider
            rewards
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="marketId">Market ID</Label>
            <Input
              id="marketId"
              type="number"
              placeholder="Enter market ID..."
              value={marketId}
              onChange={(e) => setMarketId(e.target.value)}
            />
            <p className="text-sm text-gray-500">
              Enter the ID of a market where you&apos;ve provided liquidity
            </p>
          </div>

          <Button
            onClick={handleClaimLPRewards}
            disabled={!marketId || isPending || isConfirming}
            className="w-full"
          >
            {(isPending || isConfirming) && (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            )}
            Claim LP Rewards
          </Button>
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
