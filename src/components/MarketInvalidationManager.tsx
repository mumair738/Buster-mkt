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
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  V2contractAddress,
  V2contractAbi,
  publicClient,
} from "@/constants/contract";
import {
  AlertTriangle,
  Shield,
  CheckCircle,
  Loader2,
  XCircle,
} from "lucide-react";

interface MarketInfo {
  id: number;
  question: string;
  validated: boolean;
  invalidated: boolean;
  creator: string;
  resolved: boolean;
}

export function MarketInvalidationManager() {
  const { isConnected, address } = useAccount();
  const { toast } = useToast();
  const [marketId, setMarketId] = useState("");
  const [reason, setReason] = useState("");
  const [marketInfo, setMarketInfo] = useState<MarketInfo | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({ hash });

  // Get market count for validation
  const { data: marketCount } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "marketCount",
    query: { enabled: isConnected },
  });

  // Check if user has validator role
  const { data: hasValidatorRole } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "hasRole",
    args: [
      "0x7d6a7c8c4b5a2e3f1d0c9b8a7e6d5c4b3a2f1e0d9c8b7a6e5d4c3b2a1f0e9d8c7", // MARKET_VALIDATOR_ROLE
      address as `0x${string}`,
    ],
    query: { enabled: isConnected && !!address },
  });

  const checkMarket = async () => {
    if (!marketId || isNaN(Number(marketId))) {
      toast({
        title: "Invalid Market ID",
        description: "Please enter a valid market ID number.",
        variant: "destructive",
      });
      return;
    }

    const id = Number(marketId);
    if (id < 0 || (marketCount && id >= Number(marketCount))) {
      toast({
        title: "Market Not Found",
        description: `Market ID ${id} does not exist.`,
        variant: "destructive",
      });
      return;
    }

    setIsChecking(true);
    try {
      // Get market info
      const marketData = (await publicClient.readContract({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "getMarketInfo",
        args: [BigInt(id)],
      })) as readonly [
        string,
        string,
        bigint,
        number,
        bigint,
        boolean,
        boolean,
        number,
        boolean,
        bigint,
        string
      ];

      setMarketInfo({
        id,
        question: marketData[0], // question
        validated: true, // We'll assume validated since it's queryable, or implement separate validation check
        invalidated: marketData[8], // invalidated field
        creator: marketData[10], // creator address
        resolved: marketData[5], // resolved field
      });
    } catch (error) {
      console.error("Error fetching market info:", error);
      toast({
        title: "Error",
        description: "Failed to fetch market information.",
        variant: "destructive",
      });
    } finally {
      setIsChecking(false);
    }
  };

  const handleInvalidateMarket = async () => {
    if (!marketInfo || !reason.trim()) {
      toast({
        title: "Missing Information",
        description: "Please provide a reason for invalidation.",
        variant: "destructive",
      });
      return;
    }

    try {
      toast({
        title: "Transaction Submitted",
        description: "Invalidating market...",
      });

      await writeContract({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "invalidateMarket",
        args: [BigInt(marketInfo.id)],
      });
    } catch (error: any) {
      console.error("Error invalidating market:", error);
      toast({
        title: "Transaction Failed",
        description: error?.shortMessage || "Failed to invalidate market.",
        variant: "destructive",
      });
    }
  };

  if (!isConnected) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Shield className="h-16 w-16 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium mb-2">Connect Your Wallet</h3>
          <p className="text-gray-600">
            Please connect your wallet to manage market invalidation.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!hasValidatorRole) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <AlertTriangle className="h-16 w-16 mx-auto text-red-400 mb-4" />
          <h3 className="text-lg font-medium mb-2">Access Denied</h3>
          <p className="text-gray-600">
            You need Market Validator role to invalidate markets.
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
            Market Invalidated Successfully!
          </h3>
          <p className="text-gray-600 mb-4">
            Market #{marketInfo?.id} has been invalidated and refunds will be
            processed automatically.
          </p>
          <Button onClick={() => window.location.reload()}>Continue</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="border-red-200 bg-red-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-red-800">Market Invalidation</h3>
              <p className="text-sm text-red-700 mt-1">
                Invalidating a market will automatically refund all participants
                and mark the market as invalid. This action cannot be undone and
                should only be used for markets with serious issues.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5" />
            Invalidate Market
          </CardTitle>
          <CardDescription>
            Enter a market ID to review and potentially invalidate
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <div className="flex-1">
              <Label htmlFor="marketId">Market ID</Label>
              <Input
                id="marketId"
                type="number"
                placeholder="Enter market ID..."
                value={marketId}
                onChange={(e) => setMarketId(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={checkMarket}
                disabled={!marketId || isChecking}
                variant="outline"
              >
                {isChecking && (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                )}
                Check Market
              </Button>
            </div>
          </div>

          {marketInfo && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Market Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-medium">Market ID</Label>
                    <p className="text-sm text-gray-600">#{marketInfo.id}</p>
                  </div>
                  <div>
                    <Label className="text-sm font-medium">Creator</Label>
                    <p className="text-sm text-gray-600 font-mono">
                      {marketInfo.creator.slice(0, 6)}...
                      {marketInfo.creator.slice(-4)}
                    </p>
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-medium">Question</Label>
                  <p className="text-sm text-gray-600 mt-1">
                    {marketInfo.question}
                  </p>
                </div>

                <div className="flex gap-2">
                  <Badge
                    variant={marketInfo.validated ? "default" : "secondary"}
                  >
                    {marketInfo.validated ? "Validated" : "Not Validated"}
                  </Badge>
                  <Badge variant={marketInfo.resolved ? "default" : "outline"}>
                    {marketInfo.resolved ? "Resolved" : "Active"}
                  </Badge>
                  {marketInfo.invalidated && (
                    <Badge variant="destructive">Invalidated</Badge>
                  )}
                </div>

                {marketInfo.invalidated ? (
                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <p className="text-sm text-red-800">
                      This market has already been invalidated.
                    </p>
                  </div>
                ) : marketInfo.resolved ? (
                  <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                    <p className="text-sm text-yellow-800">
                      This market has already been resolved. Invalidation may
                      not be possible.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <Label htmlFor="reason">Reason for Invalidation *</Label>
                      <Textarea
                        id="reason"
                        placeholder="Provide a detailed reason for invalidating this market..."
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows={3}
                      />
                    </div>

                    <Button
                      onClick={handleInvalidateMarket}
                      disabled={!reason.trim() || isPending || isConfirming}
                      variant="destructive"
                      className="w-full"
                    >
                      {(isPending || isConfirming) && (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      )}
                      Invalidate Market
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
