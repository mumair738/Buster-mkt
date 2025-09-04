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
import { DollarSign, Loader2, Building2 } from "lucide-react";

interface AdminLiquidity {
  marketId: number;
  amount: bigint;
  canWithdraw: boolean;
}

export function AdminLiquidityManager() {
  const { address, isConnected } = useAccount();
  const { toast } = useToast();
  const [adminLiquidity, setAdminLiquidity] = useState<AdminLiquidity[]>([]);
  const [loading, setLoading] = useState(false);

  // Contract write for withdrawing admin liquidity
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  // Check for markets where user can withdraw admin liquidity
  useEffect(() => {
    const fetchAdminLiquidity = async () => {
      if (!isConnected || !address) return;

      setLoading(true);
      const liquidity: AdminLiquidity[] = [];

      // Check markets 0-50 for demo (in production, scan blockchain events)
      for (let marketId = 0; marketId < 50; marketId++) {
        try {
          const result = await fetch("/api/check-admin-liquidity", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ marketId, userAddress: address }),
          });

          if (result.ok) {
            const data = await result.json();
            if (data.canWithdraw && data.amount > 0) {
              liquidity.push({
                marketId,
                amount: BigInt(data.amount),
                canWithdraw: true,
              });
            }
          }
        } catch (error) {
          console.error(
            `Error checking admin liquidity for market ${marketId}:`,
            error
          );
        }
      }

      setAdminLiquidity(liquidity);
      setLoading(false);
    };

    fetchAdminLiquidity();
  }, [isConnected, address]);

  // Handle withdrawing admin liquidity
  const handleWithdrawAdminLiquidity = async (marketId: number) => {
    if (!address) return;

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

  // Handle successful transaction
  useEffect(() => {
    if (isSuccess) {
      toast({
        title: "Admin Liquidity Withdrawn!",
        description: "Your admin liquidity has been successfully withdrawn.",
      });
      // Refresh admin liquidity data
      setAdminLiquidity((prev) =>
        prev.filter(
          (liq) =>
            !prev.some((l) => l.marketId === parseInt(hash?.toString() || "0"))
        )
      );
    }
  }, [isSuccess, hash, toast]);

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
          <Building2 className="h-16 w-16 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium mb-2">Connect Your Wallet</h3>
          <p className="text-gray-600">
            Please connect your wallet to manage admin liquidity.
          </p>
        </CardContent>
      </Card>
    );
  }

  const totalWithdrawable = adminLiquidity.reduce(
    (sum, liq) => sum + liq.amount,
    0n
  );
  const totalWithdrawableEth = Number(totalWithdrawable) / 1e18;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          Admin Liquidity Manager
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary */}
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="font-medium text-blue-800 mb-1">
            Total Withdrawable Liquidity
          </h3>
          <p className="text-2xl font-bold text-blue-600">
            {totalWithdrawableEth.toFixed(4)} Buster
          </p>
          <p className="text-sm text-blue-700 mt-1">
            From {adminLiquidity.length} markets
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
            <span className="ml-2 text-sm text-gray-600">
              Checking withdrawable liquidity...
            </span>
          </div>
        ) : adminLiquidity.length === 0 ? (
          <div className="text-center py-8">
            <DollarSign className="w-12 h-12 mx-auto mb-4 text-gray-400" />
            <p className="text-gray-600">
              No admin liquidity available to withdraw
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Create markets to provide initial liquidity
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {adminLiquidity.map((liq) => (
              <div
                key={liq.marketId}
                className="flex items-center justify-between p-3 bg-white rounded-lg border"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    Market #{liq.marketId}
                  </p>
                  <p className="text-sm text-gray-600">
                    {formatAmount(liq.amount)} Buster
                  </p>
                </div>
                <Button
                  onClick={() => handleWithdrawAdminLiquidity(liq.marketId)}
                  disabled={isPending || isConfirming}
                  size="sm"
                  className="bg-blue-600 hover:bg-blue-700"
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
