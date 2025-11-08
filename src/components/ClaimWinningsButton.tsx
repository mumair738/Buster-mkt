"use client";

import { useState, useEffect, useCallback } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { V2contractAddress, V2contractAbi } from "@/constants/contract";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trophy, Coins } from "lucide-react";
import { toast } from "sonner";

interface UserWinnings {
  marketId: number;
  amount: bigint;
  hasWinnings: boolean;
  hasClaimed: boolean; // Track if user already claimed
}
// Claim winnings from markets the user has participated in//
export function ClaimWinningsSection() {
  const { address, isConnected } = useAccount();
  const [userMarkets, setUserMarkets] = useState<number[]>([]);
  const [winningsData, setWinningsData] = useState<UserWinnings[]>([]);
  const [loading, setLoading] = useState(false);
  const [showClaimed, setShowClaimed] = useState(false); // Toggle to show claimed markets

  // Contract write for claiming winnings
  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  // Auto-discover markets where user participated
  const fetchUserMarkets = useCallback(async () => {
    if (!address) return;

    setLoading(true);
    try {
      const response = await fetch("/api/auto-discover-user-markets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userAddress: address }),
      });

      if (response.ok) {
        const data = await response.json();
        console.log("Auto-discovered markets:", data);

        // Convert amount strings to BigInt and add hasClaimed status
        const winnings = (data.winningsData || []).map((w: any) => ({
          marketId: w.marketId,
          amount: BigInt(w.amount || 0),
          hasWinnings: w.hasWinnings,
          hasClaimed: w.hasClaimed || false,
        }));

        setWinningsData(winnings);
        setUserMarkets(data.participatedMarkets || []);
      } else {
        console.error("Failed to auto-discover markets:", response.statusText);
        // Fallback to empty state
        setWinningsData([]);
        setUserMarkets([]);
      }
    } catch (error) {
      console.error("Error auto-discovering markets:", error);
      // Fallback to empty state
      setWinningsData([]);
      setUserMarkets([]);
    } finally {
      setLoading(false);
    }
  }, [address]);

  // Auto-discover user's participated markets
  useEffect(() => {
    if (isConnected && address) {
      // Use auto-discovery instead of hardcoded range
      fetchUserMarkets();
    }
  }, [isConnected, address, fetchUserMarkets]);

  // Handle claiming winnings
  const handleClaimWinnings = async (marketId: number) => {
    if (!address) return;

    try {
      writeContract({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "claimWinnings",
        args: [BigInt(marketId)],
      });
    } catch (error) {
      console.error("Error claiming winnings:", error);
      toast.error("Failed to claim winnings");
    }
  };

  // Handle successful transaction
  useEffect(() => {
    if (isSuccess) {
      toast.success("Winnings claimed successfully!");
      // Refresh the entire winnings data after successful claim
      fetchUserMarkets();
    }
  }, [isSuccess, fetchUserMarkets]);

  if (!isConnected) {
    return (
      <Card className="border-orange-200 bg-gradient-to-br from-orange-50 to-yellow-50">
        <CardContent className="p-6 text-center">
          <Trophy className="w-12 h-12 mx-auto mb-4 text-orange-600" />
          <h3 className="font-semibold text-gray-900 mb-2">
            Claim Your Winnings
          </h3>
          <p className="text-sm text-gray-600">
            Connect your wallet to view and claim available winnings
          </p>
        </CardContent>
      </Card>
    );
  }

  // Separate claimed and unclaimed winnings
  const unclaimedWinnings = winningsData.filter((w) => !w.hasClaimed);
  const claimedWinnings = winningsData.filter((w) => w.hasClaimed);

  const totalWinnings = unclaimedWinnings.reduce(
    (sum, w) => sum + w.amount,
    0n
  );
  const totalWinningsEth = Number(totalWinnings) / 1e18;

  const totalClaimed = claimedWinnings.reduce((sum, w) => sum + w.amount, 0n);
  const totalClaimedEth = Number(totalClaimed) / 1e18;

  return (
    <Card className="border border-purple-100 shadow-lg bg-white">
      <CardHeader className="border-b border-purple-100 bg-gradient-to-r from-purple-50 to-[#924db3]/5">
        <CardTitle className="flex items-center gap-3 text-[#924db3]">
          <Trophy className="w-6 h-6" />
          <div>
            <h2 className="text-xl font-semibold">Claim Your Winnings</h2>
            {!loading && unclaimedWinnings.length > 0 && (
              <p className="text-sm text-gray-600 mt-1">
                You have {unclaimedWinnings.length} market
                {unclaimedWinnings.length !== 1 ? "s" : ""} to claim
              </p>
            )}
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-6 space-y-6">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-center">
              <Loader2 className="w-8 h-8 animate-spin text-[#924db3] mx-auto mb-3" />
              <span className="text-sm text-gray-600">
                Checking available winnings...
              </span>
            </div>
          </div>
        ) : unclaimedWinnings.length === 0 && claimedWinnings.length === 0 ? (
          <div className="text-center py-12">
            <div className="bg-gray-50 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
              <Coins className="w-10 h-10 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              No Winnings Available
            </h3>
            <p className="text-sm text-gray-500">
              Check back after markets resolve
            </p>
          </div>
        ) : unclaimedWinnings.length === 0 && claimedWinnings.length > 0 ? (
          <div className="text-center py-8">
            <div className="bg-purple-50 rounded-full w-20 h-20 flex items-center justify-center mx-auto mb-4">
              <Trophy className="w-10 h-10 text-[#924db3]" />
            </div>
            <h3 className="text-xl font-semibold text-gray-900 mb-2">
              All Winnings Claimed!
            </h3>
            <p className="text-sm text-gray-600">
              Total claimed:{" "}
              <span className="font-medium">
                {totalClaimedEth.toFixed(4)} $Buster
              </span>
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowClaimed(!showClaimed)}
              className="mt-4"
            >
              {showClaimed ? "Hide" : "Show"} Claimed Markets
            </Button>
            {showClaimed && (
              <div className="mt-4 space-y-2">
                {claimedWinnings.map((w) => (
                  <div
                    key={w.marketId}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border"
                  >
                    <div>
                      <p className="font-medium text-gray-700">
                        Market #{w.marketId}
                      </p>
                      <p className="text-sm text-gray-500">
                        {(Number(w.amount) / 1e18).toFixed(4)} $Buster
                      </p>
                    </div>
                    <Badge
                      variant="secondary"
                      className="bg-green-100 text-green-800"
                    >
                      Claimed
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Total Winnings Summary */}
            <div className="bg-gradient-to-br from-purple-50 to-[#924db3]/5 p-6 rounded-xl border border-purple-100 mb-8">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-medium text-gray-500 mb-1">
                    Total Available Winnings
                  </h3>
                  <p className="text-3xl font-bold text-[#924db3]">
                    {totalWinningsEth.toFixed(4)}{" "}
                    <span className="text-lg">$Buster</span>
                  </p>
                </div>
                <div className="text-right">
                  <Badge
                    variant="secondary"
                    className="bg-white/80 text-[#924db3] border border-purple-200 px-4 py-1.5"
                  >
                    {unclaimedWinnings.length} Market
                    {unclaimedWinnings.length !== 1 ? "s" : ""}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Individual Market Claims */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h4 className="text-base font-semibold text-gray-900">
                  Unclaimed Markets
                </h4>
                {claimedWinnings.length > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowClaimed(!showClaimed)}
                    className="text-sm text-[#924db3] hover:text-[#824099] hover:bg-purple-50"
                  >
                    {showClaimed ? "Hide" : "View"} History (
                    {claimedWinnings.length})
                  </Button>
                )}
              </div>

              {unclaimedWinnings.map((winnings) => (
                <div
                  key={winnings.marketId}
                  className="flex items-center justify-between p-4 bg-white rounded-xl border border-purple-100 shadow-sm mb-3 hover:border-purple-200 transition-colors"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm bg-purple-50 text-[#924db3] px-2 py-0.5 rounded">
                        #{winnings.marketId}
                      </span>
                      <p className="font-medium text-gray-900">
                        {(Number(winnings.amount) / 1e18).toFixed(4)} $Buster
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={() => handleClaimWinnings(winnings.marketId)}
                    disabled={isPending || isConfirming}
                    size="sm"
                    className="bg-[#924db3] hover:bg-[#824099] text-white shadow-sm hover:shadow transition-all"
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

              {/* Claimed Winnings History */}
              {showClaimed && claimedWinnings.length > 0 && (
                <div className="mt-8 pt-6 border-t border-purple-100">
                  <h4 className="text-base font-semibold text-gray-900 mb-4">
                    Claim History
                  </h4>
                  <div className="space-y-3">
                    {claimedWinnings.map((winnings) => (
                      <div
                        key={winnings.marketId}
                        className="flex items-center justify-between p-4 bg-gray-50 rounded-xl"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm bg-white text-gray-600 px-2 py-0.5 rounded border">
                            #{winnings.marketId}
                          </span>
                          <p className="font-medium text-gray-700">
                            {(Number(winnings.amount) / 1e18).toFixed(4)}{" "}
                            $Buster
                          </p>
                        </div>
                        <Badge
                          variant="secondary"
                          className="bg-white text-[#924db3] border border-purple-100"
                        >
                          ✓ Claimed
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
