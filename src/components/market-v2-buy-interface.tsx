"use client";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useState, useRef, useEffect, useCallback } from "react";
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
} from "@/constants/contract";
import { decodeErrorResult, encodeFunctionData } from "viem";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";
import { MarketV2 } from "@/types/types";
import { ValidationNotice } from "./ValidationNotice";

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

  // Check if wallet supports batch transactions (EIP-5792)
  const supportseBatchTransactions =
    isFarcasterConnector &&
    !connector?.name?.includes("MetaMask") &&
    !connector?.id?.includes("metaMask");

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
    id: callsData?.id as `0x${string}`,
    query: {
      enabled: !!callsData?.id,
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

  // Fetch market info for validation
  const { data: marketInfo } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getMarketInfo",
    args: [BigInt(marketId)],
  });

  // Calculate slippage protection (5% slippage tolerance)
  const calculateMaxPrice = useCallback((currentPrice: bigint): bigint => {
    return (currentPrice * 105n) / 100n; // 5% slippage
  }, []);

  // Check if market is validated
  const checkMarketValidation = useCallback(async () => {
    try {
      // We'll try to simulate a purchase to see if it throws MarketNotValidated
      await publicClient.estimateContractGas({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "buyShares",
        args: [BigInt(marketId), BigInt(0), BigInt(1), BigInt(1000000)], // Try to buy 1 share of option 0 with max price 1000000
        account: "0x0000000000000000000000000000000000000001", // Dummy account
      });
      setIsValidated(true); // If no error, market is validated
    } catch (error: any) {
      // Check if the error is specifically MarketNotValidated
      if (
        error?.message?.includes("MarketNotValidated") ||
        error?.shortMessage?.includes("MarketNotValidated") ||
        error?.details?.includes("MarketNotValidated")
      ) {
        setIsValidated(false);
      } else {
        // For other errors (like insufficient funds, invalid option, etc.), assume validated
        setIsValidated(true);
      }
    }
  }, [marketId]);

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

      // Check balance
      if (!userBalance) {
        throw new Error("Unable to fetch balance. Please try again.");
      }

      if (amountInUnits > userBalance) {
        throw new Error(
          `Insufficient balance. You have ${formatPrice(
            userBalance,
            tokenDecimals
          )} ${tokenSymbol || "tokens"}`
        );
      }

      const currentPrice = optionData?.[4] || 0n;
      const maxPricePerShare = calculateMaxPrice(currentPrice);

      console.log("=== V2 DIRECT PURCHASE ===");
      console.log("Market ID:", marketId);
      console.log("Option ID:", selectedOptionId);
      console.log("Amount:", amountInUnits.toString());
      console.log("Max Price:", maxPricePerShare.toString());
      console.log("Option Data:", optionData);
      console.log("Current Price from option data:", currentPrice.toString());
      console.log("Market object:", market);
      console.log("V2 Contract Address:", V2contractAddress);
      console.log("Account Address:", accountAddress);

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

      // Check balance
      if (!userBalance) {
        throw new Error("Unable to fetch balance. Please try again.");
      }

      if (amountInUnits > userBalance) {
        throw new Error(
          `Insufficient balance. You have ${formatPrice(
            userBalance,
            tokenDecimals
          )} ${tokenSymbol || "tokens"}`
        );
      }

      const needsApproval = amountInUnits > (userAllowance || 0n);

      console.log("=== V2 SEQUENTIAL PURCHASE ===");
      console.log("Amount in units:", amountInUnits.toString());
      console.log("Needs approval:", needsApproval);
      console.log("Current allowance:", userAllowance?.toString());

      if (needsApproval) {
        setBuyingStep("allowance");
        console.log("Approving tokens...");
        // First approve
        await writeContractAsync({
          address: tokenAddress,
          abi: tokenAbi,
          functionName: "approve",
          args: [V2contractAddress, amountInUnits],
        });
      } else {
        setBuyingStep("confirm");
        // Direct purchase
        const currentPrice = optionData?.[4] || 0n; // currentPrice from getMarketOption
        const maxPricePerShare = calculateMaxPrice(currentPrice);

        console.log("Making direct purchase...");
        console.log("Current price:", currentPrice.toString());
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

      // Check balance
      if (!userBalance) {
        throw new Error("Unable to fetch balance. Please try again.");
      }

      if (amountInUnits > userBalance) {
        throw new Error(
          `Insufficient balance. You have ${formatPrice(
            userBalance,
            tokenDecimals
          )} ${tokenSymbol || "tokens"}`
        );
      }

      const currentPrice = optionData?.[4] || 0n;
      const maxPricePerShare = calculateMaxPrice(currentPrice);

      console.log("=== V2 BATCH TRANSACTION DEBUG ===");
      console.log("Amount in units:", amountInUnits.toString());
      console.log("Market ID:", marketId);
      console.log("Selected option ID:", selectedOptionId);
      console.log("Balance before batch:", userBalance?.toString());
      console.log("Current allowance:", userAllowance?.toString());
      console.log("Is Farcaster connector:", isFarcasterConnector);
      console.log("Current price:", currentPrice.toString());
      console.log("Max price per share:", maxPricePerShare.toString());

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

    // Check balance before proceeding
    if (!userBalance || !tokenDecimals) {
      setError("Unable to fetch balance. Please try again.");
      return;
    }

    const amountInUnits = toUnits(amount, tokenDecimals);
    if (amountInUnits > userBalance) {
      setError(
        `Insufficient balance. You have ${formatPrice(
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
    userBalance,
    tokenDecimals,
    tokenSymbol,
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
            setSelectedOptionId(null);

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
            setSelectedOptionId(null);
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
            setSelectedOptionId(null);
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
          setSelectedOptionId(null);
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

  // Check market validation on mount
  useEffect(() => {
    checkMarketValidation();
  }, [checkMarketValidation]);

  if (!isVisible) return null;

  // Show validation notice if market is not validated
  if (isValidated === false) {
    return (
      <div className="w-full">
        <ValidationNotice
          marketId={marketId}
          status="pending"
          message="This market is waiting for admin validation before accepting predictions. Please check back later."
        />
      </div>
    );
  }

  // Show loading state while checking validation
  if (isValidated === null) {
    return (
      <div className="w-full p-4 text-center">
        <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2" />
        <p className="text-sm text-gray-600">Checking market status...</p>
      </div>
    );
  }

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
