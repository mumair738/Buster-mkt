"use client";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  type BaseError,
} from "wagmi";
import {
  V2contractAddress,
  V2contractAbi,
  tokenAddress,
  tokenAbi,
} from "@/constants/contract";
import { Loader2, ArrowLeftRight, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";
import { MarketV2 } from "@/types/types";

interface MarketV2SwapInterfaceProps {
  marketId: number;
  market: MarketV2;
  userShares: { [optionId: number]: bigint };
  onSwapComplete?: () => void;
}

type SwapStep =
  | "initial"
  | "selectOptions"
  | "amount"
  | "confirm"
  | "processing"
  | "swapSuccess";

// Format price with proper decimals
function formatPrice(price: bigint, decimals: number = 18): string {
  const formatted = Number(price) / Math.pow(10, decimals);
  if (formatted < 0.01) return formatted.toFixed(4);
  if (formatted < 1) return formatted.toFixed(3);
  return formatted.toFixed(2);
}

// Format shares amount
function formatShares(shares: bigint): string {
  const formatted = Number(shares) / Math.pow(10, 18);
  return formatted.toFixed(2);
}

export function MarketV2SwapInterface({
  marketId,
  market,
  userShares,
  onSwapComplete,
}: MarketV2SwapInterfaceProps) {
  const { address: accountAddress, isConnected } = useAccount();
  const {
    data: hash,
    writeContractAsync,
    isPending: isWritePending,
    error: writeError,
  } = useWriteContract();
  const {
    isLoading: isConfirmingTx,
    isSuccess: isTxConfirmed,
    error: txError,
  } = useWaitForTransactionReceipt({
    hash,
  });
  const { toast } = useToast();

  const [isSwapping, setIsSwapping] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [containerHeight, setContainerHeight] = useState("auto");
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [fromOptionId, setFromOptionId] = useState<number | null>(null);
  const [toOptionId, setToOptionId] = useState<number | null>(null);
  const [swapAmount, setSwapAmount] = useState<string>("");
  const [swapStep, setSwapStep] = useState<SwapStep>("initial");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastProcessedHash, setLastProcessedHash] = useState<string | null>(
    null
  );

  // Token information
  const { data: tokenSymbol } = useReadContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "symbol",
  });

  // Fetch option data for from option
  const { data: fromOptionData } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getMarketOption",
    args: [BigInt(marketId), BigInt(fromOptionId || 0)],
    query: { enabled: fromOptionId !== null },
  });

  // Fetch option data for to option
  const { data: toOptionData } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getMarketOption",
    args: [BigInt(marketId), BigInt(toOptionId || 0)],
    query: { enabled: toOptionId !== null },
  });

  // Calculate expected output (simplified AMM calculation)
  const calculateExpectedOutput = useCallback(
    (inputAmount: string): bigint => {
      if (!inputAmount || !fromOptionData || !toOptionData) return 0n;

      const inputAmountBigInt = BigInt(
        Math.floor(parseFloat(inputAmount) * Math.pow(10, 18))
      );
      const fromPrice = fromOptionData[4] || 0n; // currentPrice
      const toPrice = toOptionData[4] || 0n; // currentPrice

      if (toPrice === 0n) return 0n;

      // Simple price ratio calculation (real AMM would be more complex)
      return (inputAmountBigInt * fromPrice) / toPrice;
    },
    [fromOptionData, toOptionData]
  );

  // Calculate minimum output with slippage protection (5%)
  const calculateMinOutput = useCallback((expectedOutput: bigint): bigint => {
    return (expectedOutput * 95n) / 100n; // 5% slippage protection
  }, []);

  // Handle swap transaction
  const handleSwap = useCallback(async () => {
    if (
      !accountAddress ||
      fromOptionId === null ||
      toOptionId === null ||
      !swapAmount
    )
      return;

    try {
      setIsProcessing(true);
      setSwapStep("processing");

      const swapAmountBigInt = BigInt(
        Math.floor(parseFloat(swapAmount) * Math.pow(10, 18))
      );
      const expectedOutput = calculateExpectedOutput(swapAmount);
      const minAmountOut = calculateMinOutput(expectedOutput);

      console.log("=== V2 SWAP TRANSACTION ===");
      console.log("Market ID:", marketId);
      console.log("From Option ID:", fromOptionId);
      console.log("To Option ID:", toOptionId);
      console.log("Swap Amount:", swapAmountBigInt.toString());
      console.log("Expected Output:", expectedOutput.toString());
      console.log("Min Output:", minAmountOut.toString());

      await writeContractAsync({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "ammSwap",
        args: [
          BigInt(marketId),
          BigInt(fromOptionId),
          BigInt(toOptionId),
          swapAmountBigInt,
          minAmountOut,
        ],
      });
    } catch (err) {
      console.error("Swap transaction failed:", err);
      setError("Swap transaction failed. Please try again.");
      setSwapStep("initial");
    } finally {
      setIsProcessing(false);
    }
  }, [
    accountAddress,
    fromOptionId,
    toOptionId,
    swapAmount,
    calculateExpectedOutput,
    calculateMinOutput,
    marketId,
    writeContractAsync,
  ]);

  // Handle transaction confirmation
  useEffect(() => {
    if (isTxConfirmed && hash && hash !== lastProcessedHash) {
      setLastProcessedHash(hash);
      setSwapStep("swapSuccess");
      setSwapAmount("");
      setFromOptionId(null);
      setToOptionId(null);

      toast({
        title: "Swap Completed Successfully!",
        description: `Your shares have been swapped successfully.`,
      });

      // Call completion callback
      if (onSwapComplete) {
        onSwapComplete();
      }

      // Reset after delay
      setTimeout(() => {
        setSwapStep("initial");
        setError(null);
      }, 3000);
    }
  }, [isTxConfirmed, hash, lastProcessedHash, toast, onSwapComplete]);

  // Handle errors
  useEffect(() => {
    if (writeError || txError) {
      const errorMessage =
        (writeError as BaseError)?.shortMessage ||
        (txError as BaseError)?.shortMessage ||
        "Transaction failed";
      setError(errorMessage);
      setSwapStep("initial");
      setIsProcessing(false);
    }
  }, [writeError, txError]);

  // Auto-focus input when step changes
  useEffect(() => {
    if (swapStep === "amount" && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [swapStep]);

  // Update container height smoothly
  useEffect(() => {
    if (contentRef.current) {
      setContainerHeight(`${contentRef.current.scrollHeight}px`);
    }
  }, [swapStep, fromOptionId, toOptionId, error]);

  const userFromShares =
    fromOptionId !== null ? userShares[fromOptionId] || 0n : 0n;
  const maxSwapAmount = Number(userFromShares) / Math.pow(10, 18);
  const expectedOutput = calculateExpectedOutput(swapAmount);
  const expectedOutputFormatted = Number(expectedOutput) / Math.pow(10, 18);

  // Get options with user shares for "from" selection
  const optionsWithShares = market.options
    .map((option, index) => ({
      id: index,
      name: option.name,
      shares: userShares[index] || 0n,
      currentPrice: option.currentPrice,
    }))
    .filter((option) => option.shares > 0n);

  // Get all options for "to" selection (excluding selected from option)
  const availableToOptions = market.options
    .map((option, index) => ({
      id: index,
      name: option.name,
      currentPrice: option.currentPrice,
    }))
    .filter((option) => option.id !== fromOptionId);

  if (!isVisible) return null;

  return (
    <div
      className="transition-all duration-300 ease-in-out overflow-hidden"
      style={{ height: containerHeight }}
    >
      <div ref={contentRef} className="space-y-4">
        {/* Header */}
        <div className="flex items-center gap-2 text-blue-600">
          <ArrowLeftRight className="h-4 w-4" />
          <span className="font-medium">Swap Shares</span>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-red-700 text-sm">{error}</p>
          </div>
        )}

        {/* Step 1: Initial */}
        {swapStep === "initial" && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600">
              Swap your shares from one option to another without leaving the
              market.
            </p>

            {optionsWithShares.length === 0 ? (
              <div className="text-center py-4 text-gray-500">
                You don&apos;t own any shares in this market to swap.
              </div>
            ) : (
              <Button
                onClick={() => setSwapStep("selectOptions")}
                className="w-full"
              >
                Start Swap
              </Button>
            )}
          </div>
        )}

        {/* Step 2: Select Options */}
        {swapStep === "selectOptions" && (
          <div className="space-y-4">
            {/* From Option Selection */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-gray-700">
                From (Your shares):
              </label>
              <div className="space-y-2">
                {optionsWithShares.map((option) => (
                  <button
                    key={option.id}
                    onClick={() => setFromOptionId(option.id)}
                    className={cn(
                      "w-full p-3 text-left border rounded-lg transition-colors",
                      fromOptionId === option.id
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-blue-300 hover:bg-blue-50"
                    )}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-medium">{option.name}</div>
                        <div className="text-sm text-gray-600">
                          Your shares: {formatShares(option.shares)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-gray-600">Price</div>
                        <div className="font-medium">
                          {formatPrice(option.currentPrice)}{" "}
                          {tokenSymbol || "TOKENS"}
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* To Option Selection */}
            {fromOptionId !== null && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  To (Target option):
                </label>
                <div className="space-y-2">
                  {availableToOptions.map((option) => (
                    <button
                      key={option.id}
                      onClick={() => setToOptionId(option.id)}
                      className={cn(
                        "w-full p-3 text-left border rounded-lg transition-colors",
                        toOptionId === option.id
                          ? "border-green-500 bg-green-50"
                          : "border-gray-200 hover:border-green-300 hover:bg-green-50"
                      )}
                    >
                      <div className="flex justify-between items-center">
                        <div>
                          <div className="font-medium">{option.name}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm text-gray-600">Price</div>
                          <div className="font-medium">
                            {formatPrice(option.currentPrice)}{" "}
                            {tokenSymbol || "TOKENS"}
                          </div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={() => {
                  setSwapStep("initial");
                  setFromOptionId(null);
                  setToOptionId(null);
                }}
                variant="outline"
                className="flex-1"
              >
                Back
              </Button>
              <Button
                onClick={() => setSwapStep("amount")}
                disabled={fromOptionId === null || toOptionId === null}
                className="flex-1"
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* Step 3: Amount Input */}
        {swapStep === "amount" &&
          fromOptionId !== null &&
          toOptionId !== null && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <div className="text-sm text-blue-700">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="font-medium">From:</span>
                    <span>{market.options[fromOptionId].name}</span>
                    <ArrowLeftRight className="h-3 w-3" />
                    <span className="font-medium">To:</span>
                    <span>{market.options[toOptionId].name}</span>
                  </div>
                  <div>Available: {formatShares(userFromShares)} shares</div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">
                  Shares to Swap
                </label>
                <div className="relative">
                  <Input
                    ref={inputRef}
                    type="number"
                    placeholder="0.00"
                    value={swapAmount}
                    onChange={(e) => setSwapAmount(e.target.value)}
                    className="pr-16"
                    step="0.01"
                    min="0"
                    max={maxSwapAmount.toString()}
                  />
                  <button
                    onClick={() => setSwapAmount(maxSwapAmount.toString())}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200 transition-colors"
                  >
                    MAX
                  </button>
                </div>
                {swapAmount && expectedOutput > 0n && (
                  <div className="text-sm text-gray-600">
                    Expected to receive: ~{expectedOutputFormatted.toFixed(4)}{" "}
                    shares
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => setSwapStep("selectOptions")}
                  variant="outline"
                  className="flex-1"
                >
                  Back
                </Button>
                <Button
                  onClick={() => setSwapStep("confirm")}
                  disabled={
                    !swapAmount ||
                    parseFloat(swapAmount) <= 0 ||
                    parseFloat(swapAmount) > maxSwapAmount
                  }
                  className="flex-1"
                >
                  Review Swap
                </Button>
              </div>
            </div>
          )}

        {/* Step 4: Confirmation */}
        {swapStep === "confirm" &&
          fromOptionId !== null &&
          toOptionId !== null && (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="font-medium text-blue-800 mb-2">Confirm Swap</h3>
                <div className="space-y-2 text-sm text-blue-700">
                  <div className="flex justify-between">
                    <span>From Option:</span>
                    <span className="font-medium">
                      {market.options[fromOptionId].name}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>To Option:</span>
                    <span className="font-medium">
                      {market.options[toOptionId].name}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Shares to Swap:</span>
                    <span className="font-medium">{swapAmount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Expected to Receive:</span>
                    <span className="font-medium">
                      {expectedOutputFormatted.toFixed(4)} shares
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Min Received (5% slippage):</span>
                    <span className="font-medium">
                      {(expectedOutputFormatted * 0.95).toFixed(4)} shares
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => setSwapStep("amount")}
                  variant="outline"
                  className="flex-1"
                >
                  Back
                </Button>
                <Button
                  onClick={handleSwap}
                  disabled={isProcessing}
                  className="flex-1"
                >
                  {isProcessing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Swapping...
                    </>
                  ) : (
                    "Confirm Swap"
                  )}
                </Button>
              </div>
            </div>
          )}

        {/* Step 5: Processing */}
        {swapStep === "processing" && (
          <div className="text-center py-4">
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
            <p className="mt-2 text-sm text-gray-600">
              Processing your swap transaction...
            </p>
          </div>
        )}

        {/* Step 6: Success */}
        {swapStep === "swapSuccess" && (
          <div className="text-center py-4">
            <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-3">
              <svg
                className="w-6 h-6 text-green-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
            <p className="text-green-700 font-medium">
              Swap Completed Successfully!
            </p>
            <p className="text-sm text-gray-600 mt-1">
              Your shares have been swapped.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
