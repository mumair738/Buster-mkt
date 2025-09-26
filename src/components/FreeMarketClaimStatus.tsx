"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { V2contractAddress, V2contractAbi } from "@/constants/contract";
// import { formatPrice } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Gift, Users, Clock, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useMarketData } from "@/hooks/useSubgraphData";

interface FreeMarketClaimStatusProps {
  marketId: number;
  className?: string;
  marketType?: number; // Optional marketType prop to avoid subgraph dependency
}

// Format price with proper decimals
function formatPrice(price: bigint, decimals: number = 18): string {
  const formatted = Number(price) / Math.pow(10, decimals);
  if (formatted < 0.01) return formatted.toFixed(4);
  if (formatted < 1) return formatted.toFixed(3);
  return formatted.toFixed(2);
}

export function FreeMarketClaimStatus({
  marketId,
  className = "",
  marketType,
}: FreeMarketClaimStatusProps) {
  const { address } = useAccount();
  const { toast } = useToast();
  const [hasShownSuccessToast, setHasShownSuccessToast] = useState(false);

  // Claim free tokens transaction
  const {
    writeContract: claimFreeTokens,
    data: claimTxHash,
    error: claimError,
    isPending: isClaimPending,
  } = (useWriteContract as any)();

  // Wait for claim transaction confirmation
  const { isLoading: isClaimConfirming, isSuccess: isClaimConfirmed } =
    useWaitForTransactionReceipt({
      hash: claimTxHash,
    });

  // Check if user has claimed free tokens
  const { data: claimStatus } = (useReadContract as any)({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "hasUserClaimedFreeTokens",
    args: [BigInt(marketId), address as `0x${string}`],
    query: {
      enabled: !!address,
      refetchInterval: 10000,
    },
  });

  // Get market data from subgraph (only if marketType not provided)
  const { market, isLoading: isLoadingMarket } = useMarketData(marketId);

  // Get free market info directly from contract
  const { data: freeMarketInfoContract } = (useReadContract as any)({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getFreeMarketInfo",
    args: [BigInt(marketId)],
    query: {
      enabled: marketType === 1 || (market && market.marketType === "FREE"),
      refetchInterval: 10000,
    },
  });

  // Use contract data if marketType is provided, otherwise use subgraph
  const isFreeMarket =
    marketType !== undefined ? marketType === 1 : market?.marketType === "FREE";

  // Parse free market info from contract: [maxFreeParticipants, tokensPerParticipant, currentFreeParticipants, totalPrizePool, remainingPrizePool, isActive]
  const contractFreeInfo = freeMarketInfoContract as
    | [bigint, bigint, bigint, bigint, bigint, boolean]
    | undefined;

  // Compute free market config values
  const freeMarketConfig = market?.freeMarketConfig;
  const tokensPerParticipant = contractFreeInfo
    ? contractFreeInfo[1]
    : freeMarketConfig && freeMarketConfig.tokensPerParticipant
    ? BigInt(freeMarketConfig.tokensPerParticipant)
    : 0n;

  // Handle claim error
  useEffect(() => {
    if (claimError) {
      toast({
        title: "Claim Failed",
        description: claimError.message || "Failed to claim free tokens",
        variant: "destructive",
      });
    }
  }, [claimError, toast]);

  // Reset success toast flag when starting a new claim
  useEffect(() => {
    if (isClaimPending) {
      setHasShownSuccessToast(false);
    }
  }, [isClaimPending]);

  // Handle claim success
  useEffect(() => {
    if (
      isClaimConfirmed &&
      !hasShownSuccessToast &&
      tokensPerParticipant > 0n
    ) {
      setHasShownSuccessToast(true);
      toast({
        title: "Tokens Claimed Successfully! 🎉",
        description: `You've claimed ${formatPrice(
          tokensPerParticipant,
          18
        )} tokens for this free market.`,
      });
    }
  }, [isClaimConfirmed, hasShownSuccessToast, tokensPerParticipant, toast]);

  // Early returns after all hooks
  if (!address) {
    return null;
  }

  // Check if market is free entry
  if (!isFreeMarket) {
    return null;
  }

  // If using contract data, check if we have the info
  if (marketType === 1 && !contractFreeInfo) {
    return null;
  }

  // If using subgraph data, check if we have the market and config
  if (
    marketType === undefined &&
    (!market || isLoadingMarket || !market.freeMarketConfig)
  ) {
    return null;
  }

  const hasUserClaimed = claimStatus ? claimStatus[0] : false;
  const tokensReceived = claimStatus ? claimStatus[1] : 0n;

  const maxParticipants = contractFreeInfo
    ? contractFreeInfo[0]
    : freeMarketConfig && freeMarketConfig.maxFreeParticipants
    ? BigInt(freeMarketConfig.maxFreeParticipants)
    : 0n;

  const currentParticipants = contractFreeInfo
    ? contractFreeInfo[2]
    : freeMarketConfig && freeMarketConfig.currentFreeParticipants
    ? BigInt(freeMarketConfig.currentFreeParticipants)
    : 0n;

  const slotsRemaining = maxParticipants - currentParticipants;

  // Handle claiming free tokens
  const handleClaimFreeTokens = async () => {
    try {
      console.log("🎁 Claiming free tokens for market:", marketId);
      claimFreeTokens({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "claimFreeTokens",
        args: [BigInt(marketId)],
      });
    } catch (error: any) {
      console.error("❌ Error claiming free tokens:", error);
      toast({
        title: "Claim Failed",
        description: error.message || "Failed to claim free tokens",
        variant: "destructive",
      });
    }
  };

  return (
    <div className={`space-y-2 ${className}`}>
      {/* Main Status Badge */}
      {hasUserClaimed ? (
        <Badge className="bg-green-100 text-green-800 border-green-200">
          <Gift className="h-3 w-3 mr-1" />
          Claimed {formatPrice(tokensReceived, 18)} tokens
        </Badge>
      ) : slotsRemaining > 0n ? (
        <div className="flex items-center gap-2">
          <Badge className="bg-blue-100 text-blue-800 border-blue-200">
            <Clock className="h-3 w-3 mr-1" />
            {formatPrice(tokensPerParticipant, 18)} tokens available
          </Badge>
          <Button
            onClick={handleClaimFreeTokens}
            disabled={isClaimPending || isClaimConfirming || !address}
            size="sm"
            className="h-6 px-2 text-xs bg-blue-600 hover:bg-blue-700"
          >
            {isClaimPending || isClaimConfirming ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                Claiming...
              </>
            ) : (
              <>
                <Gift className="h-3 w-3 mr-1" />
                Claim
              </>
            )}
          </Button>
        </div>
      ) : (
        <Badge className="bg-gray-100 text-gray-800 border-gray-200">
          <Users className="h-3 w-3 mr-1" />
          All slots claimed
        </Badge>
      )}

      {/* Detailed Info */}
      {!hasUserClaimed && (
        <div className="text-xs text-gray-600">
          <div className="flex items-center justify-between">
            <span>Slots remaining:</span>
            <span className="font-medium">
              {slotsRemaining.toString()}/{maxParticipants.toString()}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
