"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { V2contractAddress, V2contractAbi } from "@/constants/contract";
import { Loader2, Send, Users, DollarSign, Eye, EyeOff } from "lucide-react";

export function BatchDistributionManager() {
  const { address, isConnected } = useAccount();
  const { toast } = useToast();

  const [marketId, setMarketId] = useState("");
  const [previewData, setPreviewData] = useState<{
    recipients: string[];
    amounts: string[];
    totalParticipants?: number;
    eligibleCount?: number;
  } | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // Get market info
  const { data: marketInfo, refetch: refetchMarketInfo } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getMarketInfo",
    args: marketId ? [BigInt(marketId)] : undefined,
    query: {
      enabled: isConnected && !!marketId,
    },
  });

  // Write contract hook for batch distribution
  const {
    writeContract,
    data: txHash,
    isPending: isDistributing,
  } = useWriteContract();

  const {
    data: receipt,
    isLoading: isConfirming,
    isSuccess,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Handle successful transaction
  useEffect(() => {
    if (isSuccess) {
      toast({
        title: "Batch Distribution Successful!",
        description: `Winnings have been distributed to ${
          previewData?.recipients.length || 0
        } eligible recipients out of ${
          previewData?.totalParticipants || 0
        } total participants.`,
      });

      // Reset form
      setPreviewData(null);
      setShowPreview(false);
      refetchMarketInfo();
    }
  }, [isSuccess, toast, previewData, refetchMarketInfo]);

  // Check if market is resolved
  const isMarketResolved = marketInfo ? (marketInfo[5] as boolean) : false;
  const isMarketDisputed = marketInfo ? (marketInfo[6] as boolean) : false;
  const isMarketInvalidated = marketInfo ? (marketInfo[8] as boolean) : false;
  const marketQuestion = marketInfo ? (marketInfo[0] as string) : "";

  // Load preview data - now automatic!
  const loadPreview = async () => {
    if (!marketId) {
      toast({
        title: "Missing Information",
        description: "Please enter a market ID.",
        variant: "destructive",
      });
      return;
    }

    setIsLoadingPreview(true);
    try {
      // Use the new automatic endpoint that fetches participants from blockchain
      const result = await fetch("/api/auto-preview-batch-distribution", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          marketId: parseInt(marketId),
        }),
      });

      if (!result.ok) {
        throw new Error("Failed to load preview");
      }

      const data = await result.json();
      setPreviewData(data);
      setShowPreview(true);

      toast({
        title: "Preview Loaded",
        description: `Found ${data.totalParticipants} participants, ${data.eligibleCount} eligible for winnings.`,
      });
    } catch (error) {
      console.error("Preview error:", error);
      toast({
        title: "Preview Failed",
        description: "Failed to load distribution preview. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoadingPreview(false);
    }
  };

  // Execute batch distribution
  const handleBatchDistribution = async () => {
    if (!previewData || previewData.recipients.length === 0) {
      toast({
        title: "No Recipients",
        description: "No eligible recipients found for distribution.",
        variant: "destructive",
      });
      return;
    }

    try {
      await writeContract({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "batchDistributeWinnings",
        args: [BigInt(marketId), previewData.recipients as `0x${string}`[]],
      });
    } catch (error: any) {
      console.error("Distribution error:", error);
      toast({
        title: "Distribution Failed",
        description: error?.shortMessage || "Failed to distribute winnings.",
        variant: "destructive",
      });
    }
  };

  if (!isConnected) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Users className="h-16 w-16 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium mb-2">Connect Your Wallet</h3>
          <p className="text-gray-600">
            Please connect your wallet to manage batch distributions.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="h-5 w-5" />
            Smart Batch Winnings Distribution
          </CardTitle>
          <CardDescription>
            Automatically detect all market participants and distribute winnings
            to eligible recipients
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Market Selection */}
          <div className="space-y-2">
            <Label htmlFor="marketId">Market ID</Label>
            <Input
              id="marketId"
              placeholder="Enter market ID"
              value={marketId}
              onChange={(e) => setMarketId(e.target.value)}
            />
            {marketInfo && (
              <div className="space-y-2">
                <p className="text-sm text-gray-600">
                  <strong>Market:</strong> {marketQuestion}
                </p>
                <div className="flex gap-2">
                  <Badge variant={isMarketResolved ? "default" : "secondary"}>
                    {isMarketResolved ? "Resolved" : "Not Resolved"}
                  </Badge>
                  {isMarketDisputed && (
                    <Badge variant="destructive">Disputed</Badge>
                  )}
                  {isMarketInvalidated && (
                    <Badge variant="destructive">Invalidated</Badge>
                  )}
                </div>
              </div>
            )}
          </div>

          <Separator />

          {/* Recipients Input - Now Automatic */}
          {/* <div className="space-y-2">
            <Label>Automatic Participant Detection</Label>
            <div className="p-4 border rounded-md bg-blue-50">
              <p className="text-sm text-blue-700">
                <strong>How it works:</strong> This tool automatically scans
                blockchain events to find all participants in the market, then
                filters for those eligible to receive winnings.
              </p>
              <p className="text-xs text-blue-600 mt-2">
                No manual address input required - just enter the market ID and
                click &quot;Auto Preview&quot;!
              </p>
            </div>
          </div> */}

          {/* Action Buttons */}
          <div className="flex gap-3">
            <Button
              onClick={loadPreview}
              disabled={!marketId || isLoadingPreview}
              variant="outline"
              className="flex items-center gap-2"
            >
              {isLoadingPreview ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Scanning Blockchain...
                </>
              ) : (
                <>
                  <Eye className="h-4 w-4" />
                  Auto Preview Distribution
                </>
              )}
            </Button>

            {showPreview && (
              <Button
                onClick={() => setShowPreview(!showPreview)}
                variant="ghost"
                size="sm"
              >
                {showPreview ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Preview Results */}
      {showPreview && previewData && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" />
              Smart Distribution Preview
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Total Participants
                </p>
                <p className="text-2xl font-bold">
                  {previewData.totalParticipants || 0}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Eligible Recipients
                </p>
                <p className="text-2xl font-bold text-green-600">
                  {previewData.recipients.length}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-600">
                  Total Amount
                </p>
                <p className="text-2xl font-bold">
                  {previewData.amounts
                    .reduce((sum, amount) => sum + parseFloat(amount), 0)
                    .toFixed(2)}{" "}
                  BUSTER
                </p>
              </div>
            </div>

            <Separator />

            <div className="space-y-2 max-h-60 overflow-y-auto">
              <h4 className="font-medium">Recipients & Amounts:</h4>
              {previewData.recipients.map((recipient, index) => (
                <div
                  key={recipient}
                  className="flex justify-between items-center p-2 bg-gray-50 rounded"
                >
                  <span className="font-mono text-sm">{recipient}</span>
                  <span className="font-medium">
                    {parseFloat(previewData.amounts[index]).toFixed(4)} BUSTER
                  </span>
                </div>
              ))}
            </div>

            <Button
              onClick={handleBatchDistribution}
              disabled={
                !isMarketResolved ||
                isMarketDisputed ||
                isMarketInvalidated ||
                isDistributing ||
                isConfirming ||
                previewData.recipients.length === 0
              }
              className="w-full"
            >
              {isDistributing || isConfirming ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  {isDistributing ? "Distributing..." : "Confirming..."}
                </>
              ) : (
                <>
                  <Send className="h-4 w-4 mr-2" />
                  Execute Batch Distribution
                </>
              )}
            </Button>

            {(!isMarketResolved || isMarketDisputed || isMarketInvalidated) && (
              <p className="text-xs text-red-600 text-center">
                {!isMarketResolved &&
                  "Market must be resolved before distribution."}
                {isMarketDisputed &&
                  "Cannot distribute winnings for disputed markets."}
                {isMarketInvalidated &&
                  "Cannot distribute winnings for invalidated markets."}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
