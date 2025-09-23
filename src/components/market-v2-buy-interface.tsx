"use client";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import {
  BaseError,
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
  publicClient,
  PolicastViews,
  PolicastViewsAbi,
} from "@/constants/contract";
import { decodeErrorResult, encodeFunctionData } from "viem";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";
import { MarketV2 } from "@/types/types";
import { ValidationNotice } from "./ValidationNotice";
import { FreeTokenClaimButton } from "./FreeTokenClaimButton";

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
const MAX_SHARES = 1000;

// Convert amount to token units (handles custom decimals)
function toUnits(amount: string, decimals: number): bigint {
  const [integer = "0", fraction = ""] = amount.split(".");
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  return (
    BigInt(integer + paddedFraction) *
    BigInt(10) ** BigInt(decimals - paddedFraction.length)
  );
}

// Helper function to calculate implied probability from price
function calculateProbability(price: bigint): number {
  // Contract stores probabilities (0-1 range scaled by 1e18), convert to percentage
  const probability = Number(price) / 1e18;
  return Math.max(0, Math.min(100, probability * 100));
}

// Helper function to calculate implied odds
function calculateOdds(price: bigint): number {
  // Convert probability to odds
  const probability = Number(price) / 1e18;
  if (probability <= 0) return 0;
  return 1 / probability;
}

// Format price with proper decimals
function formatPrice(price: bigint, decimals: number = 18): string {
  // Format the raw value with proper scaling
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

  // Get market odds directly from contract
  const { data: marketOdds } = useReadContract({
    address: PolicastViews,
    abi: PolicastViewsAbi,
    functionName: "getMarketOdds",
    args: [BigInt(marketId)],
  });

  // Convert contract odds to array of bigints
  const odds = (marketOdds as readonly bigint[]) || [];

  // Check if we're using Farcaster connector
  const isFarcasterConnector =
    connector?.id === "miniAppConnector" ||
    connector?.name?.includes("Farcaster");

  // Check if wallet supports batch transactions (EIP-5792)
  // MetaMask now supports EIP-5792, only exclude wallets with known issues
  const supportseBatchTransactions =
    !!connector &&
    !connector?.name?.includes("Ledger") &&
    !connector?.id?.includes("ledger");

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
  const [isValidated, setIsValidated] = useState<boolean | null>(null); // null = checking, true = validated, false = not validated

  // Reset function to completely reset the buying interface
  const resetBuyingInterface = useCallback(() => {
    setSelectedOptionId(null);
    setAmount("");
    setBuyingStep("initial");
    setIsBuying(false);
    setIsProcessing(false);
    setError(null);
  }, []);

  // EIP-5792 batch calls
  const {
    sendCalls,
    data: callsData,
    isSuccess: callsSuccess,
    isPending: callsPending,
    isError: callsError,
    error: callsErrorMsg,
  } = useSendCalls({
    mutation: {
      onSuccess: (data) => {
        console.log("=== V2 BATCH TRANSACTION CALLBACK ===");
        // Defensive: some connectors may return an unexpected shape
        if (!data || typeof data !== "object" || !("id" in data)) {
          console.warn(
            "Batch transaction response missing .id, response:",
            data
          );
        } else {
          console.log("Batch transaction submitted with id:", data.id);
        }
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
        const amountInUnits = toUnits(amount, tokenDecimals || 18);
        const needsApproval = amountInUnits > (userAllowance || 0n);
        if (needsApproval) {
          setBuyingStep("allowance");
        } else {
          handleDirectPurchase();
        }
        setIsProcessing(false);
      },
    },
  });

  // Monitor batch calls status
  const {
    data: callsStatusData,
    isLoading: callsStatusLoading,
    isSuccess: callsStatusSuccess,
    isError: callsStatusError,
    error: callsStatusErrorMsg,
  } = useWaitForCallsStatus({
    // Defensive extraction to avoid reading .id of undefined
    id:
      callsData && typeof callsData === "object" && "id" in callsData
        ? (callsData.id as `0x${string}`)
        : undefined,
    query: {
      enabled: !!(
        callsData &&
        typeof callsData === "object" &&
        "id" in callsData
      ),
      refetchInterval: 1000, // Check every second
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
    query: {
      enabled: !!accountAddress,
      refetchInterval: 5000, // Refresh balance every 5 seconds
    },
  });

  const { data: userAllowance } = useReadContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "allowance",
    args: [accountAddress as `0x${string}`, V2contractAddress],
    query: {
      enabled: !!accountAddress,
      refetchInterval: 5000, // Refresh allowance every 5 seconds
    },
  });

  // Fetch current prices for selected option with fresher data
  const { data: optionData, refetch: refetchOptionData } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getMarketOption",
    args: [BigInt(marketId), BigInt(selectedOptionId || 0)],
    query: {
      enabled: selectedOptionId !== null,
      refetchInterval: 2000, // Refresh every 2 seconds for fresher price data
    },
  });

  // Fetch real-time cost estimation - contract stores probabilities, convert to cost
  const estimatedCost = useMemo(() => {
    if (!optionData || !amount || parseFloat(amount) <= 0) return 0n;

    const probability = optionData[4] as bigint; // This is probability (0-1 range scaled by 1e18)
    const quantity = BigInt(Math.floor(parseFloat(amount) * Math.pow(10, 18)));

    // Calculate cost: probability * quantity * PAYOUT_PER_SHARE / 1e18
    // PAYOUT_PER_SHARE = 100e18 (100 tokens per share)
    const probTimesQty = (probability * quantity) / BigInt(1e18);
    const rawCost = (probTimesQty * BigInt(100e18)) / BigInt(1e18);

    // Add platform fee (2%)
    const fee = (rawCost * 200n) / 10000n;
    return rawCost + fee;
  }, [optionData, amount]);

  // Fetch market info for validation
  const { data: marketInfo } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getMarketInfo",
    args: [BigInt(marketId)],
  });

  // Calculate slippage protection (10% slippage tolerance)
  const calculateMaxPrice = useCallback((currentPrice: bigint): bigint => {
    return (currentPrice * 110n) / 100n; // 10% slippage
  }, []);

  // Check if market is validated
  const checkMarketValidation = useCallback(() => {
    if (marketInfo && marketInfo.length > 8) {
      // Check the validated field directly from market info (index 8 based on debug output)
      const isValidated = marketInfo[8] as boolean;
      console.log(
        "Market validation check:",
        isValidated,
        "Market info:",
        marketInfo
      );
      setIsValidated(isValidated);
    } else {
      // If marketInfo is not available yet, keep checking
      setIsValidated(null);
    }
  }, [marketInfo]);

  // Handle direct purchase (for cases where approval already exists)
  const handleDirectPurchase = useCallback(async () => {
    if (
      !accountAddress ||
      selectedOptionId === null ||
      !amount ||
      !tokenDecimals
    )
      return;
    try {
      const amountInUnits = toUnits(amount, tokenDecimals);

      // Check balance using estimated cost instead of share amount
      if (!userBalance) {
        throw new Error("Unable to fetch balance. Please try again.");
      }

      // Use estimated cost for balance check, fallback to approximate calculation if not available
      const requiredBalance =
        estimatedCost ||
        (amountInUnits * (optionData?.[4] || 0n)) / BigInt(1e18);

      if ((requiredBalance as bigint) > ((userBalance as bigint) || 0n)) {
        throw new Error(
          `Insufficient balance. Total cost: ${formatPrice(
            requiredBalance,
            tokenDecimals
          )} ${tokenSymbol || "tokens"}, You have: ${formatPrice(
            userBalance,
            tokenDecimals
          )} ${tokenSymbol || "tokens"}`
        );
      }

      // Calculate max price per share from estimated cost with slippage tolerance
      const avgPricePerShare = estimatedCost
        ? (estimatedCost * BigInt(1e18)) / amountInUnits
        : optionData?.[4] || 0n;
      const maxPricePerShare = calculateMaxPrice(avgPricePerShare);

      console.log("=== V2 DIRECT PURCHASE DEBUG ===");
      console.log("Market ID:", marketId);
      console.log("Selected option ID:", selectedOptionId);
      console.log("Amount in units:", amountInUnits.toString());
      console.log("Estimated cost:", estimatedCost?.toString());
      console.log("Required balance:", requiredBalance.toString());
      console.log("User balance:", userBalance?.toString());
      console.log("Avg price per share:", avgPricePerShare.toString());
      console.log("Max price per share:", maxPricePerShare.toString());
      console.log("Market info:", marketInfo);
      console.log("Option data:", optionData);

      console.log("=== V2 BATCH PURCHASE ===");
      console.log("Amount in units:", amountInUnits.toString());
      console.log("Estimated cost:", estimatedCost?.toString());
      console.log("Avg price per share:", avgPricePerShare.toString());
      console.log("Max price per share:", maxPricePerShare.toString());

      await writeContractAsync({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "buyShares",
        args: [
          BigInt(marketId),
          BigInt(selectedOptionId),
          amountInUnits,
          maxPricePerShare,
          requiredBalance, // _maxTotalCost
        ],
      });
    } catch (err: unknown) {
      const causeData =
        err instanceof BaseError ? (err.cause as any)?.data : undefined;

      let errorMessage = "Transaction failed";

      if (causeData && typeof causeData === "string") {
        try {
          const decodedError = decodeErrorResult({
            abi: V2contractAbi,
            data: causeData as `0x${string}`,
          });
          errorMessage = decodedError.errorName || "Contract error";
        } catch {
          // Fallback if error decoding fails
          errorMessage =
            (err as BaseError)?.shortMessage ||
            (err as Error)?.message ||
            "Transaction failed";
        }
      } else {
        errorMessage =
          (err as BaseError)?.shortMessage ||
          (err as Error)?.message ||
          "Transaction failed";

        // Check for specific contract errors
        if (errorMessage.includes("MarketNotValidated")) {
          errorMessage =
            "This market has not been validated yet. Please wait for market validation.";
        } else if (errorMessage.includes("MarketEnded")) {
          errorMessage =
            "This market has ended and is no longer accepting purchases.";
        } else if (errorMessage.includes("MarketResolved")) {
          errorMessage =
            "This market has been resolved and is no longer accepting purchases.";
        } else if (errorMessage.includes("OptionInactive")) {
          errorMessage =
            "The selected option is not active. Please choose a different option.";
        } else if (errorMessage.includes("AmountMustBePositive")) {
          errorMessage = "Purchase amount must be greater than zero.";
        } else if (errorMessage.includes("PriceTooHigh")) {
          errorMessage =
            "Price has increased beyond your maximum. Please try again.";
        } else if (errorMessage.includes("TransferFailed")) {
          errorMessage =
            "Token transfer failed. Please check your balance and allowance.";
        }
      }

      console.error("Direct purchase failed:", err);
      toast({
        title: "Purchase Failed",
        description: errorMessage,
        variant: "destructive",
      });
      setError(errorMessage);
      setBuyingStep("initial");
    }
  }, [
    accountAddress,
    selectedOptionId,
    amount,
    tokenDecimals,
    userBalance,
    tokenSymbol,
    estimatedCost,
    optionData,
    calculateMaxPrice,
    marketId,
    writeContractAsync,
    toast,
  ]);

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

      // Check balance using estimated cost instead of share amount
      if (!userBalance) {
        throw new Error("Unable to fetch balance. Please try again.");
      }

      // Use estimated cost for balance check, fallback to approximate calculation if not available
      const requiredBalance =
        estimatedCost ||
        (amountInUnits * (optionData?.[4] || 0n)) / BigInt(1e18);

      if ((requiredBalance as bigint) > ((userBalance as bigint) || 0n)) {
        throw new Error(
          `Insufficient balance. Total cost: ${formatPrice(
            requiredBalance,
            tokenDecimals
          )} ${tokenSymbol || "tokens"}, You have: ${formatPrice(
            userBalance,
            tokenDecimals
          )} ${tokenSymbol || "tokens"}`
        );
      }

      // Use estimated cost for approval logic, not share amount
      const requiredApproval =
        estimatedCost ||
        (amountInUnits * (optionData?.[4] || 0n)) / BigInt(1e18);
      const needsApproval =
        (requiredApproval as bigint) > ((userAllowance as bigint) || 0n);

      console.log("=== V2 SEQUENTIAL PURCHASE ===");
      console.log("Amount in units:", amountInUnits.toString());
      console.log("Required approval:", requiredApproval.toString());
      console.log("Needs approval:", needsApproval);
      console.log("Current allowance:", userAllowance?.toString());

      if (needsApproval) {
        setBuyingStep("allowance");
        console.log("Approving tokens...");
        // First approve - approve the estimated cost, not the share amount
        await writeContractAsync({
          address: tokenAddress,
          abi: tokenAbi,
          functionName: "approve",
          args: [V2contractAddress, requiredApproval],
        });
      } else {
        setBuyingStep("confirm");
        // Direct purchase using estimated cost
        const avgPricePerShare = estimatedCost
          ? (estimatedCost * BigInt(1e18)) / amountInUnits
          : optionData?.[4] || 0n;
        const maxPricePerShare = calculateMaxPrice(avgPricePerShare);

        console.log("Making direct purchase...");
        console.log("Estimated cost:", estimatedCost?.toString());
        console.log("Avg price per share:", avgPricePerShare.toString());
        console.log("Max price per share:", maxPricePerShare.toString());

        await writeContractAsync({
          address: V2contractAddress,
          abi: V2contractAbi,
          functionName: "buyShares",
          args: [
            BigInt(marketId),
            BigInt(selectedOptionId),
            amountInUnits,
            maxPricePerShare,
            requiredApproval, // _maxTotalCost
          ],
        });
      }
    } catch (error: unknown) {
      console.error("V2 Sequential purchase failed:", error);
      let errorMessage = "Transaction failed. Please try again.";
      if (error instanceof Error) {
        errorMessage = (error as BaseError)?.shortMessage || errorMessage;
        if (error.message.includes("user rejected")) {
          errorMessage = "Transaction was rejected in your wallet";
        } else if (error.message.includes("MarketNotValidated")) {
          errorMessage =
            "This market has not been validated yet. Please wait for market validation.";
        } else if (
          error.message.includes("MarketEnded") ||
          error.message.includes("Market trading period has ended")
        ) {
          errorMessage = "Market trading period has ended";
        } else if (error.message.includes("MarketResolved")) {
          errorMessage =
            "This market has been resolved and is no longer accepting purchases.";
        } else if (error.message.includes("OptionInactive")) {
          errorMessage =
            "The selected option is not active. Please choose a different option.";
        } else if (error.message.includes("AmountMustBePositive")) {
          errorMessage = "Purchase amount must be greater than zero.";
        } else if (error.message.includes("PriceTooHigh")) {
          errorMessage =
            "Price has increased beyond your maximum. Please try again.";
        } else if (error.message.includes("TransferFailed")) {
          errorMessage =
            "Token transfer failed. Please check your balance and allowance.";
        } else if (error.message.includes("insufficient funds")) {
          errorMessage = "Insufficient funds for gas";
        }
      }
      toast({
        title: "Purchase Failed",
        description: errorMessage,
        variant: "destructive",
      });
      setBuyingStep("initial");
    } finally {
      setIsProcessing(false);
    }
  }, [
    accountAddress,
    selectedOptionId,
    amount,
    tokenDecimals,
    userBalance,
    tokenSymbol,
    estimatedCost,
    userAllowance,
    optionData,
    calculateMaxPrice,
    marketId,
    writeContractAsync,
    toast,
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

      // Check balance using estimated cost instead of share amount
      if (!userBalance) {
        throw new Error("Unable to fetch balance. Please try again.");
      }

      // Use estimated cost for balance check, fallback to approximate calculation if not available
      const requiredBalance =
        estimatedCost ||
        (amountInUnits * (optionData?.[4] || 0n)) / BigInt(1e18);

      if (requiredBalance > userBalance) {
        throw new Error(
          `Insufficient balance. Total cost: ${formatPrice(
            requiredBalance,
            tokenDecimals
          )} ${tokenSymbol || "tokens"}, You have: ${formatPrice(
            userBalance,
            tokenDecimals
          )} ${tokenSymbol || "tokens"}`
        );
      }

      const currentPrice = optionData?.[4] || 0n;
      // Calculate max price per share from estimated cost with slippage tolerance
      const avgPricePerShare = estimatedCost
        ? (estimatedCost * BigInt(1e18)) / amountInUnits
        : currentPrice;
      const maxPricePerShare = calculateMaxPrice(avgPricePerShare);

      console.log("=== V2 BATCH TRANSACTION DEBUG ===");
      console.log("Amount in units:", amountInUnits.toString());
      console.log("Market ID:", marketId);
      console.log("Selected option ID:", selectedOptionId);
      console.log("Balance before batch:", userBalance?.toString());
      console.log("Current allowance:", userAllowance?.toString());
      console.log("Is Farcaster connector:", isFarcasterConnector);
      console.log("Current price:", currentPrice.toString());
      console.log("Estimated cost:", estimatedCost?.toString());
      console.log("Avg price per share:", avgPricePerShare.toString());
      console.log("Max price per share:", maxPricePerShare.toString());

      // Use estimated cost for approval, not the share amount
      const approvalAmount =
        estimatedCost || (amountInUnits * avgPricePerShare) / BigInt(1e18);
      console.log("Approval amount:", approvalAmount.toString());

      const batchCalls = [
        {
          to: tokenAddress as `0x${string}`,
          data: encodeFunctionData({
            abi: tokenAbi,
            functionName: "approve",
            args: [V2contractAddress, approvalAmount],
          }),
        },
        {
          to: V2contractAddress as `0x${string}`,
          data: encodeFunctionData({
            abi: V2contractAbi,
            functionName: "buyShares",
            args: [
              BigInt(marketId),
              BigInt(selectedOptionId),
              amountInUnits,
              maxPricePerShare,
              requiredBalance, // _maxTotalCost
            ],
          }),
        },
      ];

      console.log("V2 Batch calls prepared:", batchCalls);

      await sendCalls({ calls: batchCalls });
    } catch (err) {
      console.error("Batch purchase preparation failed:", err);

      let errorMessage = "Batch transaction failed";
      if (err instanceof Error) {
        errorMessage = err.message;
      }

      toast({
        title: "Batch Purchase Failed",
        description: errorMessage + ". Trying sequential purchase...",
        variant: "destructive",
      });

      handleSequentialPurchase();
    } finally {
      setIsProcessing(false);
    }
  }, [
    accountAddress,
    selectedOptionId,
    amount,
    tokenDecimals,
    userBalance,
    tokenSymbol,
    estimatedCost,
    optionData,
    calculateMaxPrice,
    marketId,
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

    // Debug log all required data
    console.log("=== V2 PURCHASE DEBUG ===");
    console.log("Account:", accountAddress);
    console.log("Selected option:", selectedOptionId);
    console.log("Market ID:", marketId);
    console.log("Token address:", tokenAddress);
    console.log("V2 contract address:", V2contractAddress);
    console.log("Token symbol:", tokenSymbol);
    console.log("Token decimals:", tokenDecimals);
    console.log("User balance:", userBalance?.toString());
    console.log("User allowance:", userAllowance?.toString());
    console.log("Option data:", optionData);
    console.log("Market info:", marketInfo);

    setIsBuying(true);
    setBuyingStep("amount");
    setError(null);
  }, [
    isConnected,
    accountAddress,
    selectedOptionId,
    marketId,
    tokenAddress,
    V2contractAddress,
    tokenSymbol,
    tokenDecimals,
    userBalance,
    userAllowance,
    optionData,
    marketInfo,
    toast,
  ]);

  // Handle amount confirmation
  const handleConfirmPurchase = useCallback(() => {
    if (!amount || parseFloat(amount) <= 0) {
      setError("Please enter a valid amount");
      return;
    }

    // Check maximum shares limit per purchase
    if (parseFloat(amount) > MAX_SHARES) {
      setError(`Maximum ${MAX_SHARES} shares allowed per purchase`);
      return;
    }

    // Skip user shares check for now since getUserShares function doesn't exist
    // if (userShares && selectedOptionId !== null) {
    //   const currentShares =
    //     Number(userShares[selectedOptionId] || 0n) / Math.pow(10, 18);
    //   const newTotalShares = currentShares + parseFloat(amount);
    //   if (newTotalShares > MAX_SHARES) {
    //     setError(
    //       `Cannot have more than ${MAX_SHARES} shares per option. You currently have ${currentShares} shares. Maximum additional purchase: ${
    //         MAX_SHARES - currentShares
    //       } shares.`
    //     );
    //     return;
    //   }
    // }

    // Check balance before proceeding
    if (!userBalance || !tokenDecimals) {
      setError("Unable to fetch balance. Please try again.");
      return;
    }

    // Convert amount to token units
    const amountInUnits = toUnits(amount, tokenDecimals);

    // Use estimated cost instead of flat amount for balance check
    if (estimatedCost && estimatedCost > userBalance) {
      setError(
        `Insufficient balance. Total cost: ${formatPrice(
          estimatedCost,
          tokenDecimals
        )} ${tokenSymbol || "tokens"}, You have: ${formatPrice(
          userBalance,
          tokenDecimals
        )} ${tokenSymbol || "tokens"}`
      );
      return;
    }

    // Check if market and option data is available
    if (!optionData || !marketInfo) {
      setError("Market or option data not available. Please try again.");
      return;
    }

    // Check if option is active (index 5 in the optionData array should be boolean)
    if (optionData.length > 5 && !optionData[5]) {
      setError(
        "Selected option is not active. Please choose a different option."
      );
      return;
    }

    console.log("=== V2 PURCHASE CONFIRMATION ===");
    console.log("Amount:", amount);
    console.log("Amount in units:", amountInUnits.toString());
    console.log("User balance:", userBalance.toString());
    console.log("Sufficient balance:", amountInUnits <= userBalance);
    console.log("Connector:", connector?.name, connector?.id);
    console.log("Supports batch transactions:", supportseBatchTransactions);

    setBuyingStep("confirm");

    // Only use batch transactions for wallets that support EIP-5792
    if (supportseBatchTransactions) {
      console.log("Using batch transaction method");
      handleBatchPurchase();
    } else {
      console.log("Using sequential transaction method");
      handleSequentialPurchase();
    }
  }, [
    amount,
    selectedOptionId,
    userBalance,
    tokenDecimals,
    tokenSymbol,
    estimatedCost,
    optionData,
    marketInfo,
    connector,
    supportseBatchTransactions,
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
        const receipts = callsStatusData.receipts;

        console.log("=== V2 BATCH SUCCESS ANALYSIS ===");
        console.log("Number of receipts:", receipts?.length);
        console.log("All receipts:", receipts);

        if (receipts && receipts.length === 2) {
          // Standard case: Two receipts (approval + purchase)
          const approvalReceipt = receipts[0];
          const purchaseReceipt = receipts[1];

          console.log("=== V2 TRANSACTION RECEIPTS (2) ===");
          console.log("Approval receipt:", approvalReceipt);
          console.log("Purchase receipt:", purchaseReceipt);

          if (
            approvalReceipt?.status === "success" &&
            purchaseReceipt?.status === "success"
          ) {
            console.log("✅ V2 Both transactions successful");
            setBuyingStep("purchaseSuccess");
            setAmount("");

            toast({
              title: "Purchase Successful!",
              description: `Successfully bought shares in ${
                market.options[selectedOptionId || 0]?.name
              }`,
            });

            // Refetch option data to update UI
            refetchOptionData();
          } else if (
            approvalReceipt?.status === "success" &&
            purchaseReceipt?.status !== "success"
          ) {
            console.warn("⚠️ V2 Approval successful, but purchase failed");
            toast({
              title: "Purchase Failed",
              description:
                "Approval successful, but purchase failed. Please complete your purchase manually.",
              variant: "destructive",
            });
            setBuyingStep("batchPartialSuccess");
          } else {
            console.error("❌ V2 Approval transaction failed");
            toast({
              title: "Transaction Failed",
              description: "Approval transaction failed. Please try again.",
              variant: "destructive",
            });
            setBuyingStep("initial");
          }
        } else if (receipts && receipts.length === 1) {
          // Some wallets might return only 1 receipt even for successful batch
          const singleReceipt = receipts[0];

          console.log("=== V2 SINGLE RECEIPT SUCCESS CASE ===");
          console.log("Single receipt:", singleReceipt);
          console.log("Receipt status:", singleReceipt?.status);

          if (singleReceipt?.status === "success") {
            // Since batch status is "success" and we have a successful receipt,
            // assume the entire batch was successful
            console.log(
              "✅ V2 Batch success with single receipt - assuming full success"
            );
            setBuyingStep("purchaseSuccess");
            setAmount("");
            toast({
              title: "Purchase Successful!",
              description: `Successfully bought shares in ${
                market.options[selectedOptionId || 0]?.name
              }`,
            });
            refetchOptionData();
          } else {
            console.warn("⚠️ V2 Single receipt but not successful");
            setBuyingStep("batchPartialSuccess");
          }
        } else if (receipts && receipts.length > 2) {
          // More than 2 receipts - check if all are successful
          const allSuccessful = receipts.every(
            (receipt) => receipt?.status === "success"
          );

          console.log("=== V2 MULTIPLE RECEIPTS SUCCESS CASE ===");
          console.log(`Found ${receipts.length} receipts`);
          console.log("All successful:", allSuccessful);

          if (allSuccessful) {
            console.log("✅ V2 All receipts successful!");
            setBuyingStep("purchaseSuccess");
            setAmount("");
            toast({
              title: "Purchase Successful!",
              description: `Successfully bought shares in ${
                market.options[selectedOptionId || 0]?.name
              }`,
            });
            refetchOptionData();
          } else {
            console.warn("⚠️ V2 Some receipts failed");
            setBuyingStep("batchPartialSuccess");
          }
        } else {
          // No receipts or empty array - this shouldn't happen for success status
          console.warn("⚠️ V2 Success status but no receipts");
          console.log("Assuming success since batch status is 'success'");
          setBuyingStep("purchaseSuccess");
          setAmount("");
          toast({
            title: "Purchase Successful!",
            description: `Successfully bought shares in ${
              market.options[selectedOptionId || 0]?.name
            }`,
          });
          refetchOptionData();
        }
        setIsProcessing(false);
      } else if (callsStatusData.status === "failure") {
        const receipts = callsStatusData.receipts;

        console.log(
          "❌ V2 Batch status is 'failure' but checking receipts for partial success"
        );
        console.log("Failure receipts:", receipts);

        if (receipts && receipts.length === 1) {
          // Farcaster case: batch "fails" but approval succeeds
          const singleReceipt = receipts[0];

          console.log("=== V2 FAILURE WITH SINGLE RECEIPT ===");
          console.log("Single receipt (likely approval):", singleReceipt);
          console.log("Receipt status:", singleReceipt?.status);

          if (singleReceipt?.status === "success") {
            console.warn(
              "⚠️ V2 Batch failed overall, but approval transaction succeeded."
            );
            toast({
              title: "Partial Success",
              description:
                "Token approval successful, but purchase was not executed. Please complete your purchase manually.",
            });
            setBuyingStep("batchPartialSuccess");
          } else {
            console.error(
              "❌ V2 Batch failed and single transaction also failed"
            );
            toast({
              title: "Transaction Failed",
              description:
                "Both approval and purchase failed. Please try again.",
              variant: "destructive",
            });
            setBuyingStep("initial");
          }
        } else if (receipts && receipts.length === 2) {
          // Two receipts but overall failure - check individual statuses
          const approvalReceipt = receipts[0];
          const purchaseReceipt = receipts[1];

          console.log("=== V2 FAILURE WITH TWO RECEIPTS ===");
          console.log("Approval receipt:", approvalReceipt);
          console.log("Purchase receipt:", purchaseReceipt);

          if (
            approvalReceipt?.status === "success" &&
            purchaseReceipt?.status !== "success"
          ) {
            console.warn("⚠️ V2 Approval succeeded but purchase failed");
            toast({
              title: "Purchase Failed",
              description:
                "Approval successful, but purchase failed. Please complete your purchase manually.",
              variant: "destructive",
            });
            setBuyingStep("batchPartialSuccess");
          } else {
            console.error("❌ V2 Both transactions failed");
            toast({
              title: "Transaction Failed",
              description:
                "Both approval and purchase failed. Please try again.",
              variant: "destructive",
            });
            setBuyingStep("initial");
          }
        } else if (receipts && receipts.length > 2) {
          // More than 2 receipts - check if any succeeded
          const anySuccessful = receipts.some(
            (receipt) => receipt?.status === "success"
          );

          console.log("=== V2 FAILURE WITH MULTIPLE RECEIPTS ===");
          console.log(`Found ${receipts.length} receipts`);
          console.log("Any successful:", anySuccessful);

          if (anySuccessful) {
            console.warn("⚠️ V2 Partial success in batch failure");
            toast({
              title: "Partial Success",
              description:
                "Some transactions succeeded, but not all. Please complete your purchase manually.",
            });
            setBuyingStep("batchPartialSuccess");
          } else {
            console.error("❌ V2 All transactions failed");
            toast({
              title: "Transaction Failed",
              description: "All transactions failed. Please try again.",
              variant: "destructive",
            });
            setBuyingStep("initial");
          }
        } else {
          console.error(
            "❌ V2 Batch calls failed with no receipts or unexpected receipt count"
          );
          toast({
            title: "Batch Transaction Failed",
            description: "Batch transaction failed. Please try again.",
            variant: "destructive",
          });
          setBuyingStep("initial");
        }
        setIsProcessing(false);
      } else if (callsStatusData.status === "pending") {
        console.log("⏳ V2 Batch calls still pending...");
        // Keep waiting, the hook will refetch
      }
    }

    if (callsStatusError && callsStatusErrorMsg) {
      console.error("=== V2 BATCH CALLS STATUS ERROR ===");
      console.error("Status error:", callsStatusErrorMsg);

      toast({
        title: "Batch Transaction Failed",
        description: `Transaction monitoring failed: ${
          callsStatusErrorMsg.message || "Unknown error"
        }`,
        variant: "destructive",
      });
      setBuyingStep("initial");
      setIsProcessing(false);
    }
  }, [
    callsStatusSuccess,
    callsStatusError,
    callsStatusData,
    callsStatusErrorMsg,
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
        const amountInUnits = toUnits(amount, tokenDecimals || 18);
        const avgPricePerShare = estimatedCost
          ? (estimatedCost * BigInt(1e18)) / amountInUnits
          : optionData?.[4] || 0n;
        const maxPricePerShare = calculateMaxPrice(avgPricePerShare);

        writeContractAsync({
          address: V2contractAddress,
          abi: V2contractAbi,
          functionName: "buyShares",
          args: [
            BigInt(marketId),
            BigInt(selectedOptionId!),
            amountInUnits,
            maxPricePerShare,
            estimatedCost || (amountInUnits * avgPricePerShare) / BigInt(1e18), // _maxTotalCost
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
    estimatedCost,
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

  // Check market validation on mount
  useEffect(() => {
    checkMarketValidation();
  }, [checkMarketValidation]);

  if (!isVisible) return null;

  // Show validation notice if market is not validated
  if (isValidated === false) {
    return (
      <div className="w-full p-4 text-center bg-yellow-50 dark:bg-yellow-900/20 rounded-md border border-yellow-200 dark:border-yellow-700">
        <div className="text-yellow-800 dark:text-yellow-200">
          <h3 className="font-medium text-sm mb-2">
            Market Pending Validation
          </h3>
          <p className="text-xs">
            This market is waiting for admin validation before accepting
            predictions. Please check back later.
          </p>
        </div>
      </div>
    );
  }

  // Show loading state while checking validation
  if (isValidated === null) {
    return (
      <div className="w-full p-3 text-center bg-gray-50 dark:bg-gray-800/50 rounded-md border border-gray-200 dark:border-gray-700">
        <Loader2 className="h-4 w-4 animate-spin mx-auto mb-1 text-blue-500" />
        <p className="text-xs text-gray-600 dark:text-gray-300">
          Checking market status...
        </p>
      </div>
    );
  }

  // Check if this is a free market (marketType = 1)
  const isFreeMarket =
    marketInfo &&
    marketInfo.length > 7 &&
    typeof marketInfo[7] === "number" &&
    marketInfo[7] === 1;

  return (
    <div
      className="w-full transition-all duration-300 ease-in-out overflow-visible"
      style={{ minHeight: containerHeight }}
    >
      <div ref={contentRef} className="space-y-1">
        {/* Free Token Claim Section - Show for free markets */}
        {isFreeMarket && (
          <div className="mb-1">
            <FreeTokenClaimButton
              marketId={marketId}
              onClaimComplete={() => {
                // Refresh market data after claiming
                // Optionally show a success message or update UI
              }}
            />
          </div>
        )}

        {!isBuying ? (
          // Initial state - option selection
          <div className="space-y-1">
            <div className="px-1">
              <h4 className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-0.5">
                Select an option:
              </h4>
            </div>

            <div className="grid gap-1">
              {market.options.map((option, index) => {
                const currentPrice = formatPrice(option.currentPrice);
                const contractOdds = odds[index] || 0n;
                const probability = calculateProbability(option.currentPrice);
                const oddsFormatted = Number(contractOdds) / 1e18;
                const isSelected = selectedOptionId === index;

                return (
                  <button
                    key={index}
                    onClick={() => {
                      setSelectedOptionId(index);
                      // Reset buying state when selecting a new option
                      if (buyingStep !== "initial" || isBuying) {
                        resetBuyingInterface();
                        // Then set the new option after reset
                        setTimeout(() => setSelectedOptionId(index), 0);
                      }
                    }}
                    className={cn(
                      "w-full p-1.5 rounded-md border text-left transition-all duration-200",
                      "focus:outline-none focus:ring-1 focus:ring-blue-500",
                      isSelected
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400"
                        : "border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600"
                    )}
                  >
                    <div className="flex justify-between items-center gap-1">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-gray-900 dark:text-gray-100 text-xs truncate">
                          {option.name}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {probability.toFixed(1)}% •{" "}
                          {odds.length > 0
                            ? (Number(contractOdds) / 1e18).toFixed(2)
                            : calculateOdds(option.currentPrice).toFixed(2)}
                          x odds
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-xs font-semibold text-gray-900 dark:text-gray-100 whitespace-nowrap">
                          {probability.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="pt-1">
              <Button
                onClick={handlePurchase}
                disabled={selectedOptionId === null || !isConnected}
                className="w-full h-8 text-xs font-medium"
                size="sm"
              >
                {!isConnected ? "Connect Wallet" : "Buy Shares"}
              </Button>
            </div>
          </div>
        ) : (
          // Buying flow
          <div className="space-y-2 max-h-[70vh] flex flex-col">
            {buyingStep === "amount" && (
              <>
                <div className="bg-gray-50 dark:bg-gray-800/50 rounded-md p-1.5 text-center border border-gray-200 dark:border-gray-700">
                  <h4 className="text-xs font-medium text-gray-800 dark:text-gray-200">
                    Buying: {market.options[selectedOptionId!]?.name}
                  </h4>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    Current price:{" "}
                    <span className="font-medium">
                      {formatPrice(
                        market.options[selectedOptionId!]?.currentPrice
                      )}{" "}
                      {tokenSymbol}
                    </span>
                  </p>
                </div>

                <div className="flex-grow overflow-y-auto space-y-1.5">
                  <div>
                    <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-0.5">
                      Number of shares
                    </label>
                    <Input
                      ref={inputRef}
                      type="number"
                      placeholder={`Enter amount (max ${MAX_SHARES})`}
                      value={amount}
                      onChange={(e) => {
                        const value = e.target.value;
                        // Allow empty string for clearing the input
                        if (value === "") {
                          setAmount("");
                          setError(null);
                          return;
                        }

                        const numValue = parseFloat(value);

                        // Check for maximum shares limit per purchase
                        if (numValue > MAX_SHARES) {
                          setError(
                            `Maximum ${MAX_SHARES} shares allowed per purchase`
                          );
                          setAmount(value); // Still allow typing to show the error
                          return;
                        }

                        // Check combined shares limit (current + new)
                        // Skip user shares check for now since getUserShares function doesn't exist
                        // if (userShares && selectedOptionId !== null) {
                        //   const currentShares =
                        //     Number(userShares[selectedOptionId] || 0n) /
                        //     Math.pow(10, 18);
                        //   const newTotal = currentShares + numValue;
                        //   if (newTotal > MAX_SHARES) {
                        //     setError(
                        //       `Total shares cannot exceed ${MAX_SHARES}. You have ${currentShares} shares. Max additional: ${
                        //         MAX_SHARES - currentShares
                        //       }`
                        //     );
                        //     setAmount(value);
                        //     return;
                        //   }
                        // }

                        setError(null);
                        setAmount(value);
                      }}
                      max={MAX_SHARES}
                      className="w-full h-8 text-xs bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
                    />
                  </div>

                  {userBalance && tokenDecimals && (
                    <div className="bg-blue-50 dark:bg-blue-900/20 rounded-md p-1.5 space-y-0.5 border border-blue-200 dark:border-blue-800">
                      <div className="text-xs space-y-0.5">
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">
                            Your balance:
                          </span>
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {formatPrice(userBalance, tokenDecimals)}{" "}
                            {tokenSymbol}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600 dark:text-gray-400">
                            Max per purchase:
                          </span>
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {MAX_SHARES} shares
                          </span>
                        </div>
                        {/* Skip user shares display for now since getUserShares function doesn't exist */}
                        {/* {userShares && selectedOptionId !== null && (
                          <div className="flex justify-between">
                            <span className="text-gray-600 dark:text-gray-400">
                              Current shares:
                            </span>
                            <span className="font-medium text-gray-900 dark:text-gray-100">
                              {formatPrice(
                                userShares[selectedOptionId] || 0n,
                                18
                              )}
                            </span>
                          </div>
                        )} */}
                      </div>
                    </div>
                  )}

                  {estimatedCost && amount && parseFloat(amount) > 0 && (
                    <div className="bg-gray-50 dark:bg-gray-800/80 rounded-md p-1.5 border border-gray-200 dark:border-gray-700">
                      <h5 className="text-xs font-medium text-gray-800 dark:text-gray-200 mb-0.5">
                        Purchase Summary
                      </h5>
                      <div className="space-y-0.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-600 dark:text-gray-400">
                            Shares:
                          </span>
                          <span className="font-medium text-gray-900 dark:text-gray-100">
                            {amount}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs font-semibold border-t border-gray-200 dark:border-gray-600 pt-0.5">
                          <span className="text-gray-800 dark:text-gray-200">
                            Total Cost:
                          </span>
                          <span className="text-gray-900 dark:text-gray-100">
                            {formatPrice(estimatedCost)} {tokenSymbol}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-gray-500 dark:text-gray-400">
                            Avg Price/Share:
                          </span>
                          <span className="text-gray-700 dark:text-gray-300">
                            {formatPrice(
                              estimatedCost /
                                BigInt(
                                  Math.floor(
                                    parseFloat(amount) * Math.pow(10, 18)
                                  )
                                )
                            )}{" "}
                            {tokenSymbol}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {error && (
                  <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-1.5">
                    <p className="text-xs text-red-700 dark:text-red-400">
                      {error}
                    </p>
                  </div>
                )}

                <div className="flex gap-2 pt-1 border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 sticky bottom-0">
                  <Button
                    onClick={() => {
                      setIsBuying(false);
                      setBuyingStep("initial");
                      setError(null);
                    }}
                    variant="outline"
                    className="flex-1 h-8 text-xs border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleConfirmPurchase}
                    disabled={
                      !amount ||
                      parseFloat(amount) <= 0 ||
                      parseFloat(amount) > MAX_SHARES ||
                      !!error
                    }
                    className="flex-1 h-8 text-xs font-medium"
                  >
                    Confirm
                  </Button>
                </div>
              </>
            )}

            {(buyingStep === "allowance" || buyingStep === "confirm") && (
              <div className="text-center py-4 space-y-2 bg-gray-50 dark:bg-gray-800/50 rounded-md border border-gray-200 dark:border-gray-700">
                <Loader2 className="h-6 w-6 animate-spin mx-auto text-blue-500" />
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                    {buyingStep === "allowance"
                      ? "Approving tokens..."
                      : "Processing purchase..."}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    {market.options[selectedOptionId!]?.name} • {amount} shares
                  </p>
                </div>
              </div>
            )}

            {buyingStep === "batchPartialSuccess" && (
              <div className="text-center py-3 space-y-2 bg-amber-50 dark:bg-amber-900/20 rounded-md border border-amber-200 dark:border-amber-800">
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                  Approval successful, but purchase failed.
                </p>
                <Button
                  onClick={handleSequentialPurchase}
                  className="w-full h-9 text-xs font-medium"
                  disabled={isProcessing}
                >
                  {isProcessing && (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  )}
                  Retry Purchase
                </Button>
              </div>
            )}

            {buyingStep === "purchaseSuccess" && (
              <div className="text-center py-3 space-y-2 bg-green-50 dark:bg-green-900/20 rounded-md border border-green-200 dark:border-green-800">
                <div className="w-8 h-8 bg-green-100 dark:bg-green-800 rounded-full flex items-center justify-center mx-auto">
                  <svg
                    className="w-4 h-4 text-green-600 dark:text-green-400"
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
                <p className="text-sm font-medium text-green-800 dark:text-green-200">
                  Purchase successful!
                </p>
                <Button
                  onClick={resetBuyingInterface}
                  className="w-full h-9 text-xs font-medium"
                  variant="default"
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
