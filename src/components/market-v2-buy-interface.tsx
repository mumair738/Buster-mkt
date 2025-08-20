"use client";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSendCalls,
  useWaitForCallsStatus,
  useConnectorClient,
} from "wagmi";
import {
  V2contractAddress,
  V2contractAbi,
  tokenAddress,
  tokenAbi,
} from "@/constants/contract";
import { encodeFunctionData } from "viem";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";
import { MarketV2 } from "@/types/types";

interface MarketV2BuyInterfaceProps {
  marketId: number;
  market: MarketV2;
}

type BuyingStep =
  | "initial"
  | "amount"
  | "allowance"
  | "confirm"
  | "batchPartialSuccess"
  | "purchaseSuccess";

const MAX_BET = 50000000000000000000000000000000;

// Convert amount to token units (handles custom decimals)
function toUnits(amount: string, decimals: number): bigint {
  const [integer = "0", fraction = ""] = amount.split(".");
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  return (
    BigInt(integer + paddedFraction) *
    BigInt(10) ** BigInt(decimals - paddedFraction.length)
  );
}

// Format price with proper decimals
function formatPrice(price: bigint, decimals: number = 18): string {
  const formatted = Number(price) / Math.pow(10, decimals);
  if (formatted < 0.01) return formatted.toFixed(4);
  if (formatted < 1) return formatted.toFixed(3);
  return formatted.toFixed(2);
}

export function MarketV2BuyInterface({
  marketId,
  market,
}: MarketV2BuyInterfaceProps) {
  const { address: accountAddress, isConnected, connector } = useAccount();
  const { data: connectorClient } = useConnectorClient();
  const { data: hash, writeContractAsync } = useWriteContract();
  const { isSuccess: isTxConfirmed } = useWaitForTransactionReceipt({
    hash,
  });
  const { toast } = useToast();

  // Check if we're using Farcaster connector
  const isFarcasterConnector =
    connector?.id === "miniAppConnector" ||
    connector?.name?.includes("Farcaster");

  const [isBuying, setIsBuying] = useState(false);
  const [containerHeight, setContainerHeight] = useState("auto");
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [selectedOptionId, setSelectedOptionId] = useState<number | null>(null);
  const [amount, setAmount] = useState<string>("");
  const [buyingStep, setBuyingStep] = useState<BuyingStep>("initial");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastProcessedHash, setLastProcessedHash] = useState<string | null>(
    null
  );
  const [isVisible, setIsVisible] = useState(true);

  // EIP-5792 batch calls
  const { sendCalls, data: callsData } = useSendCalls({
    mutation: {
      onSuccess: (data) => {
        console.log("=== V2 BATCH TRANSACTION CALLBACK ===");
        console.log("Batch transaction submitted with id:", data.id);
        toast({
          title: "Batch Transaction Submitted",
          description:
            "Processing your Approve + Buy transaction. Waiting for completion...",
        });
      },
      onError: (err) => {
        console.error("=== V2 BATCH TRANSACTION SUBMISSION FAILED ===");
        console.error("Error:", err);

        // Check if it's a wallet capability issue
        if (
          err.message?.includes("wallet_sendCalls") ||
          err.message?.includes("not supported") ||
          err.message?.includes("Method not found")
        ) {
          toast({
            title: "Batch Transactions Not Supported",
            description: `Your wallet doesn't support EIP-5792 batch transactions. Using separate approval and purchase steps.`,
            variant: "destructive",
            duration: 5000,
          });
        } else {
          toast({
            title: "Batch Transaction Failed",
            description: `Failed to submit batch transaction. Using fallback method.`,
            variant: "destructive",
            duration: 3000,
          });
        }

        // Fallback to sequential transactions
        handleSequentialPurchase();
      },
    },
  });

  // Monitor batch calls status
  const {
    data: callsStatusData,
    isSuccess: callsStatusSuccess,
    isError: callsStatusError,
    error: callsStatusErrorMsg,
  } = useWaitForCallsStatus({
    id: callsData?.id,
    query: {
      enabled: !!callsData?.id,
      refetchInterval: 2000, // Check every 2 seconds
      refetchIntervalInBackground: false,
    },
  });

  // Token information
  const { data: tokenSymbol } = useReadContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "symbol",
  });

  const { data: tokenDecimals } = useReadContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "decimals",
  });

  const { data: userBalance } = useReadContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [accountAddress as `0x${string}`],
    query: { enabled: !!accountAddress },
  });

  const { data: userAllowance } = useReadContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "allowance",
    args: [accountAddress as `0x${string}`, V2contractAddress],
    query: { enabled: !!accountAddress },
  });

  // Fetch current prices for selected option
  const { data: optionData, refetch: refetchOptionData } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getMarketOption",
    args: [BigInt(marketId), BigInt(selectedOptionId || 0)],
    query: { enabled: selectedOptionId !== null },
  });

  // Calculate slippage protection (5% slippage tolerance)
  const calculateMaxPrice = useCallback((currentPrice: bigint): bigint => {
    return (currentPrice * 105n) / 100n; // 5% slippage
  }, []);

  // Handle sequential purchase (fallback)
  const handleSequentialPurchase = useCallback(async () => {
    if (
      !accountAddress ||
      selectedOptionId === null ||
      !amount ||
      !tokenDecimals
    )
      return;

    try {
      setIsProcessing(true);
      const amountInUnits = toUnits(amount, tokenDecimals);
      const needsApproval = amountInUnits > (userAllowance || 0n);

      if (needsApproval) {
        setBuyingStep("allowance");
        // First approve
        await writeContractAsync({
          address: tokenAddress,
          abi: tokenAbi,
          functionName: "approve",
          args: [V2contractAddress, amountInUnits],
        });
      } else {
        // Direct purchase
        const currentPrice = optionData?.[4] || 0n; // currentPrice from getMarketOption
        const maxPricePerShare = calculateMaxPrice(currentPrice);

        await writeContractAsync({
          address: V2contractAddress,
          abi: V2contractAbi,
          functionName: "buyShares",
          args: [
            BigInt(marketId),
            BigInt(selectedOptionId),
            amountInUnits,
            maxPricePerShare,
          ],
        });
      }
    } catch (err) {
      console.error("Sequential purchase failed:", err);
      setError("Transaction failed. Please try again.");
      setBuyingStep("initial");
    } finally {
      setIsProcessing(false);
    }
  }, [
    accountAddress,
    selectedOptionId,
    amount,
    tokenDecimals,
    userAllowance,
    optionData,
    calculateMaxPrice,
    marketId,
    writeContractAsync,
  ]);

  // Handle batch purchase
  const handleBatchPurchase = useCallback(async () => {
    if (
      !accountAddress ||
      selectedOptionId === null ||
      !amount ||
      !tokenDecimals
    )
      return;

    try {
      setIsProcessing(true);
      const amountInUnits = toUnits(amount, tokenDecimals);
      const currentPrice = optionData?.[4] || 0n;
      const maxPricePerShare = calculateMaxPrice(currentPrice);

      const batchCalls = [
        {
          to: tokenAddress,
          data: encodeFunctionData({
            abi: tokenAbi,
            functionName: "approve",
            args: [V2contractAddress, amountInUnits],
          }),
        },
        {
          to: V2contractAddress,
          data: encodeFunctionData({
            abi: V2contractAbi,
            functionName: "buyShares",
            args: [
              BigInt(marketId),
              BigInt(selectedOptionId),
              amountInUnits,
              maxPricePerShare,
            ],
          }),
        },
      ];

      console.log("V2 Batch calls prepared:", batchCalls);

      if (isFarcasterConnector) {
        sendCalls({
          calls: batchCalls,
          capabilities: {
            atomicity: false, // Farcaster doesn't support atomic transactions
          },
        });
      } else {
        sendCalls({
          calls: batchCalls,
        });
      }
    } catch (err) {
      console.error("Batch purchase preparation failed:", err);
      handleSequentialPurchase();
    } finally {
      setIsProcessing(false);
    }
  }, [
    accountAddress,
    selectedOptionId,
    amount,
    tokenDecimals,
    optionData,
    calculateMaxPrice,
    marketId,
    isFarcasterConnector,
    sendCalls,
    handleSequentialPurchase,
  ]);

  // Handle purchase click
  const handlePurchase = useCallback(() => {
    if (!isConnected || !accountAddress) {
      toast({
        title: "Wallet not connected",
        description: "Please connect your wallet to place a bet.",
        variant: "destructive",
      });
      return;
    }

    if (selectedOptionId === null) {
      toast({
        title: "No option selected",
        description: "Please select an option to bet on.",
        variant: "destructive",
      });
      return;
    }

    setIsBuying(true);
    setBuyingStep("amount");
    setError(null);
  }, [isConnected, accountAddress, selectedOptionId, toast]);

  // Handle amount confirmation
  const handleConfirmPurchase = useCallback(() => {
    if (!amount || parseFloat(amount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    setBuyingStep("confirm");

    // Try batch transaction first, fallback to sequential
    if (isFarcasterConnector || connectorClient?.account) {
      handleBatchPurchase();
    } else {
      handleSequentialPurchase();
    }
  }, [
    amount,
    isFarcasterConnector,
    connectorClient,
    handleBatchPurchase,
    handleSequentialPurchase,
  ]);

  // Monitor batch transaction status
  useEffect(() => {
    if (callsStatusSuccess && callsStatusData) {
      console.log("=== V2 BATCH CALLS STATUS SUCCESS ===");
      console.log("Status:", callsStatusData.status);
      console.log("Receipts:", callsStatusData.receipts);

      if (callsStatusData.status === "success") {
        setBuyingStep("purchaseSuccess");
        toast({
          title: "Purchase Successful!",
          description: `Successfully bought shares in ${
            market.options[selectedOptionId!]?.name
          }`,
        });
        // Reset form
        setAmount("");
        setSelectedOptionId(null);
        setIsBuying(false);
        refetchOptionData();
      } else if (callsStatusData.status === "failure") {
        // Check for partial success (approval worked but purchase failed)
        const receipts = callsStatusData.receipts;
        if (
          receipts &&
          receipts.length > 0 &&
          receipts[0]?.status === "success"
        ) {
          setBuyingStep("batchPartialSuccess");
          toast({
            title: "Partial Success",
            description:
              "Approval completed. Purchase failed. You can try purchasing again without re-approval.",
            variant: "destructive",
          });
        } else {
          setError("Transaction failed. Please try again.");
          setBuyingStep("initial");
        }
      }
    }
  }, [
    callsStatusSuccess,
    callsStatusData,
    market.options,
    selectedOptionId,
    toast,
    refetchOptionData,
  ]);

  // Monitor regular transaction status
  useEffect(() => {
    if (isTxConfirmed && hash && hash !== lastProcessedHash) {
      console.log("=== V2 REGULAR TRANSACTION CONFIRMED ===");
      setLastProcessedHash(hash);

      if (buyingStep === "allowance") {
        // Approval confirmed, now purchase
        setBuyingStep("confirm");
        const currentPrice = optionData?.[4] || 0n;
        const maxPricePerShare = calculateMaxPrice(currentPrice);
        const amountInUnits = toUnits(amount, tokenDecimals || 18);

        writeContractAsync({
          address: V2contractAddress,
          abi: V2contractAbi,
          functionName: "buyShares",
          args: [
            BigInt(marketId),
            BigInt(selectedOptionId!),
            amountInUnits,
            maxPricePerShare,
          ],
        });
      } else {
        // Purchase confirmed
        setBuyingStep("purchaseSuccess");
        toast({
          title: "Purchase Successful!",
          description: `Successfully bought shares in ${
            market.options[selectedOptionId!]?.name
          }`,
        });
        setAmount("");
        setSelectedOptionId(null);
        setIsBuying(false);
        refetchOptionData();
      }
    }
  }, [
    isTxConfirmed,
    hash,
    lastProcessedHash,
    buyingStep,
    optionData,
    calculateMaxPrice,
    amount,
    tokenDecimals,
    selectedOptionId,
    marketId,
    writeContractAsync,
    market.options,
    toast,
    refetchOptionData,
  ]);

  // Update container height
  useEffect(() => {
    if (contentRef.current) {
      setContainerHeight(`${contentRef.current.offsetHeight}px`);
    }
  }, [isBuying, buyingStep, isVisible, error]);

  // Focus input on amount step
  useEffect(() => {
    if (buyingStep === "amount" && inputRef.current) {
      inputRef.current.focus();
    }
  }, [buyingStep]);

  if (!isVisible) return null;

  return (
    <div
      className="w-full transition-all duration-300 ease-in-out overflow-hidden"
      style={{ height: containerHeight }}
    >
      <div ref={contentRef} className="space-y-4">
        {!isBuying ? (
          // Initial state - option selection
          <div className="space-y-3">
            <h4 className="text-sm font-medium text-gray-700">
              Select an option:
            </h4>
            <div className="grid gap-2">
              {market.options.map((option, index) => {
                const currentPrice = formatPrice(option.currentPrice);
                const isSelected = selectedOptionId === index;

                return (
                  <button
                    key={index}
                    onClick={() => setSelectedOptionId(index)}
                    className={cn(
                      "p-3 rounded-lg border-2 text-left transition-all duration-200",
                      isSelected
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                    )}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="font-medium text-gray-900">
                          {option.name}
                        </p>
                        {option.description && (
                          <p className="text-xs text-gray-500 truncate">
                            {option.description}
                          </p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-gray-900">
                          ${currentPrice}
                        </p>
                        <p className="text-xs text-gray-500">
                          {formatPrice(option.totalShares)} shares
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <Button
              onClick={handlePurchase}
              disabled={selectedOptionId === null || !isConnected}
              className="w-full"
            >
              {!isConnected ? "Connect Wallet" : "Buy Shares"}
            </Button>
          </div>
        ) : (
          // Buying flow
          <div className="space-y-4">
            {buyingStep === "amount" && (
              <>
                <div className="text-center">
                  <h4 className="text-sm font-medium text-gray-700">
                    Buying: {market.options[selectedOptionId!]?.name}
                  </h4>
                  <p className="text-xs text-gray-500">
                    Current price: $
                    {formatPrice(
                      market.options[selectedOptionId!]?.currentPrice
                    )}
                  </p>
                </div>
                <div>
                  <Input
                    ref={inputRef}
                    type="number"
                    placeholder={`Amount in ${tokenSymbol || "tokens"}`}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full"
                  />
                  {userBalance && tokenDecimals && (
                    <p className="text-xs text-gray-500 mt-1">
                      Balance: {formatPrice(userBalance, tokenDecimals)}{" "}
                      {tokenSymbol}
                    </p>
                  )}
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex space-x-2">
                  <Button
                    onClick={() => {
                      setIsBuying(false);
                      setBuyingStep("initial");
                      setError(null);
                    }}
                    variant="outline"
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleConfirmPurchase}
                    disabled={!amount || parseFloat(amount) <= 0}
                    className="flex-1"
                  >
                    Confirm
                  </Button>
                </div>
              </>
            )}

            {(buyingStep === "allowance" || buyingStep === "confirm") && (
              <div className="text-center space-y-2">
                <Loader2 className="h-6 w-6 animate-spin mx-auto" />
                <p className="text-sm text-gray-600">
                  {buyingStep === "allowance"
                    ? "Approving tokens..."
                    : "Processing purchase..."}
                </p>
                <p className="text-xs text-gray-500">
                  {market.options[selectedOptionId!]?.name} • {amount}{" "}
                  {tokenSymbol}
                </p>
              </div>
            )}

            {buyingStep === "batchPartialSuccess" && (
              <div className="text-center space-y-2">
                <p className="text-sm text-amber-600">
                  Approval successful, but purchase failed.
                </p>
                <Button
                  onClick={handleSequentialPurchase}
                  className="w-full"
                  disabled={isProcessing}
                >
                  {isProcessing && (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  )}
                  Retry Purchase
                </Button>
              </div>
            )}

            {buyingStep === "purchaseSuccess" && (
              <div className="text-center space-y-2">
                <p className="text-sm text-green-600 font-medium">
                  Purchase successful!
                </p>
                <Button
                  onClick={() => {
                    setIsBuying(false);
                    setBuyingStep("initial");
                  }}
                  className="w-full"
                >
                  Buy More
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
