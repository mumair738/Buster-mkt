"use client";
//New EIP-5792 batch transactions// the txn is still two step, even tho we're using the batch txn, and shoiwng as if both works at the same time, only approval works, we lost lots of trades due to this bug, many users left thinking they bought shares but only approval works then another txn to buy which is now two txn, many eft after first txn thinking they're done
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useSendCalls,
  type BaseError,
} from "wagmi";
import {
  contractAddress,
  contractAbi,
  tokenAddress,
  tokenAbi,
} from "@/constants/contract";
import { encodeFunctionData } from "viem";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/use-toast";
import { sdk } from "@farcaster/miniapp-sdk";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faShareFromSquare } from "@fortawesome/free-solid-svg-icons";

interface MarketBuyInterfaceProps {
  marketId: number;
  market: {
    question: string;
    optionA: string;
    optionB: string;
    totalOptionAShares: bigint;
    totalOptionBShares: bigint;
  };
}

type BuyingStep =
  | "initial"
  | "amount"
  | "allowance"
  | "confirm"
  | "batchPartialSuccess"
  | "purchaseSuccess";
type Option = "A" | "B" | null;

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

export function MarketBuyInterface({
  marketId,
  market,
}: MarketBuyInterfaceProps) {
  const { address: accountAddress, isConnected } = useAccount();
  // const { data: connectorClient } = useConnectorClient();
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

  const [isBuying, setIsBuying] = useState(false);
  const [isVisible, setIsVisible] = useState(true);
  const [containerHeight, setContainerHeight] = useState("auto");
  const contentRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [selectedOption, setSelectedOption] = useState<Option>(null);
  const [amount, setAmount] = useState<string>("");
  const [buyingStep, setBuyingStep] = useState<BuyingStep>("initial");
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastProcessedHash, setLastProcessedHash] = useState<string | null>(
    null
  );
  // const [batchingFailed, setBatchingFailed] = useState(false);
  const { sendCalls, isPending: isSendingCalls } = useSendCalls();

  // Add a state to track if we're waiting for the second transaction in a batch
  const [, setBatchApprovalCompleted] = useState(false);

  // Wagmi hooks for reading token data
  const { data: tokenSymbolData, error: tokenSymbolError } = useReadContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "symbol",
  });
  const tokenSymbol = (tokenSymbolData as string) || "TOKEN";

  const { data: tokenDecimalsData, error: tokenDecimalsError } =
    useReadContract({
      address: tokenAddress,
      abi: tokenAbi,
      functionName: "decimals",
    });
  const tokenDecimals = (tokenDecimalsData as number | undefined) ?? 18;

  const {
    data: balanceData,
    error: balanceError,
    refetch: refetchBalance,
  } = useReadContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [accountAddress || "0x0000000000000000000000000000000000000000"],
    query: {
      enabled: isConnected && !!accountAddress,
    },
  });
  const balance = (balanceData as bigint | undefined) ?? 0n;

  const {
    data: allowanceData,
    error: allowanceError,
    refetch: refetchAllowance,
  } = useReadContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "allowance",
    args: [
      accountAddress || "0x0000000000000000000000000000000000000000",
      contractAddress,
    ],
    query: {
      enabled: isConnected && !!accountAddress,
    },
  });
  const userAllowance = (allowanceData as bigint | undefined) ?? 0n;

  useEffect(() => {
    if (
      tokenSymbolError ||
      tokenDecimalsError ||
      balanceError ||
      allowanceError
    ) {
      console.error("Failed to fetch token data:", {
        tokenSymbolError,
        tokenDecimalsError,
        balanceError,
        allowanceError,
      });
      toast({
        title: "Error",
        description: "Failed to fetch token information. Please refresh.",
        variant: "destructive",
      });
    }
  }, [
    tokenSymbolError,
    tokenDecimalsError,
    balanceError,
    allowanceError,
    toast,
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

  // Calculate implied odds
  // Calculate implied odds
  const totalShares = market.totalOptionAShares + market.totalOptionBShares;
  const yesProbability =
    totalShares > 0n
      ? Number(market.totalOptionAShares) / Number(totalShares)
      : 0.5; // Default to 50% if no shares
  const noProbability =
    totalShares > 0n
      ? Number(market.totalOptionBShares) / Number(totalShares)
      : 0.5; // Default to 50% if no shares
  const yesOdds = yesProbability > 0 ? 1 / yesProbability : Infinity; // Implied odds as multiplier
  const noOdds = noProbability > 0 ? 1 / noProbability : Infinity; // Implied odds as multiplier

  const handleBuy = (option: "A" | "B") => {
    setIsVisible(false);
    setTimeout(() => {
      setIsBuying(true);
      setSelectedOption(option);
      setBuyingStep("amount");
      setIsVisible(true);
    }, 200);
  };

  const handleCancel = useCallback(() => {
    setIsVisible(false);
    setTimeout(() => {
      setIsBuying(false);
      setBuyingStep("initial");
      setSelectedOption(null);
      setAmount("");
      setError(null);
      setLastProcessedHash(null);
      setIsVisible(true);
    }, 200);
  }, [
    setIsVisible,
    setIsBuying,
    setBuyingStep,
    setSelectedOption,
    setAmount,
    setError,
  ]);

  const checkApproval = async () => {
    const numAmount = Number(amount);
    if (!amount || numAmount <= 0) {
      setError("Amount must be greater than 0");
      return;
    }
    if (numAmount > MAX_BET) {
      toast({
        title: "Maximum Bet Exceeded",
        description: `Maximum shares you can buy is ${MAX_BET} ${tokenSymbol}`,
        variant: "destructive",
      });
      return;
    }

    try {
      if (!isConnected || !accountAddress) {
        toast({
          title: "Wallet Connection Required",
          description: "Please connect your wallet to continue",
          variant: "destructive",
        });
        return;
      }

      const amountInUnits = toUnits(amount, tokenDecimals);
      if (amountInUnits > balance) {
        toast({
          title: "Insufficient Balance",
          description: `You have ${(
            Number(balance) / Math.pow(10, tokenDecimals)
          ).toFixed(2)} ${tokenSymbol}, need ${amount}`,
          variant: "destructive",
        });
        return;
      }

      // Proceed directly to the confirmation step
      setBuyingStep("confirm");
      setError(null);
    } catch (e) {
      console.error("Amount validation error:", e);
      toast({
        title: "Error",
        description: "Failed to validate transaction",
        variant: "destructive",
      });
    }
  };

  const handleSetApproval = async () => {
    if (!isConnected || !accountAddress) {
      toast({
        title: "Wallet Connection Required",
        description: "Please connect your wallet to continue",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      const amountInUnits = toUnits(amount, tokenDecimals);

      // Only approve the exact amount needed (no more unlimited approvals)
      await writeContractAsync({
        address: tokenAddress,
        abi: tokenAbi,
        functionName: "approve",
        args: [contractAddress, amountInUnits], // Exact amount only
      });

      // Don't show toast here - let the useEffect handle it after confirmation
    } catch (error: unknown) {
      console.error("Approval error:", error);
      let errorMessage =
        "Failed to approve token spending. Please check your wallet.";

      if (error instanceof Error) {
        if (error.message.includes("user rejected")) {
          errorMessage = "Transaction was rejected in your wallet";
        } else if (error.message.includes("insufficient funds")) {
          errorMessage =
            (error as BaseError)?.shortMessage || "Insufficient funds for gas";
        }
      }

      toast({
        title: "Approval Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleConfirm = async () => {
    if (!selectedOption || !amount || Number(amount) <= 0) {
      setError("Must select an option and enter an amount greater than 0");
      return;
    }

    if (!isConnected || !accountAddress) {
      toast({
        title: "Wallet Connection Required",
        description: "Please connect your wallet to continue",
        variant: "destructive",
      });
      return;
    }

    const numAmount = Number(amount);
    if (numAmount > MAX_BET) {
      toast({
        title: "Maximum Bet Exceeded",
        description: `Maximum shares you can buy is ${MAX_BET} ${tokenSymbol}`,
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      const amountInUnits = toUnits(amount, tokenDecimals);

      sendCalls(
        {
          calls: [
            {
              to: tokenAddress,
              data: encodeFunctionData({
                abi: tokenAbi,
                functionName: "approve",
                args: [contractAddress, amountInUnits],
              }),
            },
            {
              to: contractAddress,
              data: encodeFunctionData({
                abi: contractAbi,
                functionName: "buyShares",
                args: [BigInt(marketId), selectedOption === "A", amountInUnits],
              }),
            },
          ],
        },
        {
          onSuccess: (id) => {
            console.log("Batch transaction successful with id:", id);
            toast({
              title: "Batch Transaction Submitted",
              description: "Approve + Buy submitted in a single transaction.",
            });

            // Set a flag to wait and verify if the purchase actually went through
            setBatchApprovalCompleted(true);

            // Wait a bit and then check if the purchase actually worked
            setTimeout(async () => {
              const initialBalance = balance;
              await refetchBalance();
              await refetchAllowance();

              // Wait a bit more for the transaction to process
              setTimeout(async () => {
                await refetchBalance();

                // Check if balance actually decreased (indicating successful purchase)
                await refetchBalance();

                // If balance didn't decrease significantly, likely only approval went through
                if (balance === initialBalance) {
                  console.log(
                    "Batch transaction likely only completed approval, not purchase"
                  );
                  toast({
                    title: "⚠️ Batch Partially Completed",
                    description:
                      "Approval succeeded, but purchase may need to be completed manually. Please click 'Complete Purchase' below.",
                    variant: "destructive",
                    duration: 8000,
                  });
                  setBuyingStep("batchPartialSuccess");
                } else {
                  setBuyingStep("purchaseSuccess");
                }

                setIsProcessing(false);
                setBatchApprovalCompleted(false);
              }, 2000);
            }, 3000);
          },
          onError: (err) => {
            console.error("Batch transaction failed, falling back:", err);
            toast({
              title: "Batch Transaction Failed",
              description:
                "Your wallet doesn't support batch transactions. Falling back to separate approval and purchase steps.",
              variant: "destructive",
              duration: 5000,
            });
            // Fallback to sequential transactions
            const needsApproval = amountInUnits > userAllowance;
            if (needsApproval) {
              setBuyingStep("allowance");
            } else {
              writeContractAsync({
                address: contractAddress,
                abi: contractAbi,
                functionName: "buyShares",
                args: [BigInt(marketId), selectedOption === "A", amountInUnits],
              });
            }
            setIsProcessing(false);
          },
        }
      );
    } catch (error: unknown) {
      console.error("Purchase error:", error);
      let errorMessage = "Failed to process purchase. Check your wallet.";
      if (error instanceof Error) {
        errorMessage = (error as BaseError)?.shortMessage || errorMessage;
        if (error.message.includes("user rejected")) {
          errorMessage = "Transaction was rejected in your wallet";
        } else if (error.message.includes("Market trading period has ended")) {
          errorMessage = "Market trading period has ended";
        } else if (error.message.includes("insufficient funds")) {
          errorMessage = "Insufficient funds for gas";
        }
      }
      toast({
        title: "Purchase Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleShareAfterPurchase = async () => {
    try {
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL || "https://buster-mkt.vercel.app";
      const marketPageUrl = `${appUrl}/market/${marketId}/details`;

      await sdk.actions.composeCast({
        text: `I just bought shares in this market on Policast: ${
          market?.question || `Market ${marketId}`
        }`,
        embeds: [marketPageUrl],
      });
    } catch (error) {
      console.error("Failed to compose cast after purchase:", error);
      toast({
        title: "Share Error",
        description: "Could not open share dialog.",
        variant: "destructive",
      });
    }
    handleCancel(); // Close the interface after attempting to share
  };
  // Effect to handle transaction confirmation
  useEffect(() => {
    if (isTxConfirmed && hash && hash !== lastProcessedHash) {
      setLastProcessedHash(hash);

      if (buyingStep === "allowance") {
        toast({
          title: "Approval Confirmed!",
          description: `Approved ${amount} ${tokenSymbol} for spending.`,
          duration: 3000,
        });
        // Refetch allowance and proceed to confirm step
        refetchAllowance().then(() => {
          setBuyingStep("confirm");
          setIsProcessing(false);
        });
      } else if (
        buyingStep === "confirm" ||
        buyingStep === "batchPartialSuccess"
      ) {
        toast({
          title: "Purchase Confirmed!",
          description: "Your shares have been purchased successfully.",
          duration: 3000,
        });
        // Refetch balance and proceed to success step
        refetchBalance().then(() => {
          setBuyingStep("purchaseSuccess");
          setIsProcessing(false);
        });
      }
    }
    if (txError || writeError) {
      const errorToShow = txError || writeError;
      toast({
        title: "Transaction Failed",
        description:
          (errorToShow as BaseError)?.shortMessage ||
          "An unknown error occurred.",
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  }, [
    isTxConfirmed,
    hash,
    lastProcessedHash,
    txError,
    writeError,
    buyingStep,
    toast,
    refetchAllowance,
    refetchBalance,
    amount,
    tokenSymbol,
  ]);

  const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputValue = e.target.value;
    if (inputValue === "") {
      setAmount("");
      setError(null);
      return;
    }
    if (!/^\d*\.?\d*$/.test(inputValue)) return; // Allow only valid numbers
    const parts = inputValue.split(".");
    if (parts[0].length > 15 || parts[1]?.length > tokenDecimals) return; // Limit size
    const numValue = Number(inputValue);
    if (numValue < 0) return; // Prevent negative
    setAmount(inputValue);
    setError(null);
  };

  const handleMaxBet = () => {
    const maxPossibleValue = Math.min(
      MAX_BET,
      Number(balance) / Math.pow(10, tokenDecimals)
    );
    const displayPrecision = Math.min(6, tokenDecimals);
    const formattedMaxAmount = maxPossibleValue.toFixed(displayPrecision);
    let finalAmountString = formattedMaxAmount;
    if (finalAmountString.includes(".")) {
      finalAmountString = finalAmountString.replace(/0+$/, "");
      if (finalAmountString.endsWith(".")) {
        finalAmountString = finalAmountString.slice(0, -1);
      }
    }
    setAmount(finalAmountString);
    setError(null);
  };

  return (
    <div
      className="relative transition-all duration-200 ease-in-out overflow-hidden"
      style={{ maxHeight: containerHeight }}
    >
      <div
        ref={contentRef}
        className={cn(
          "w-full transition-all duration-200 ease-in-out",
          isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
        )}
      >
        {!isBuying ? (
          <div className="flex flex-col gap-4 mb-4">
            {/* <h2 className="text-lg font-bold">{market.question}</h2> */}
            <div className="flex justify-between gap-4">
              <Button
                className="flex-1 min-w-[120px] bg-green-600 hover:bg-green-700"
                onClick={() => handleBuy("A")}
                aria-label={`Buy ${market.optionA} shares for "${market.question}"`}
                disabled={!isConnected}
              >
                {market.optionA} ({yesOdds.toFixed(2)}x)
              </Button>
              <Button
                className="flex-1 min-w-[120px] bg-red-600 hover:bg-red-700"
                onClick={() => handleBuy("B")}
                aria-label={`Buy ${market.optionB} shares for "${market.question}"`}
                disabled={!isConnected}
              >
                {market.optionB} ({noOdds.toFixed(2)}x)
              </Button>
            </div>
            {accountAddress && (
              <div className="text-xs text-gray-500 text-center space-y-1">
                <p>
                  Available:{" "}
                  {(Number(balance) / Math.pow(10, tokenDecimals)).toFixed(2)}{" "}
                  {tokenSymbol}
                </p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col mb-4" aria-live="polite">
            {/* <h2 className="text-lg font-bold mb-2">{market.question}</h2> */}
            <p className="text-sm text-gray-500 mb-4">
              Selected:{" "}
              {selectedOption === "A" ? market.optionA : market.optionB} (
              {(selectedOption === "A" ? yesOdds : noOdds).toFixed(2)}x)
            </p>
            {buyingStep === "amount" ? (
              <div className="flex flex-col">
                <span className="text-xs text-gray-500 mb-1">
                  Enter amount (Max: {MAX_BET} {tokenSymbol}, Available:{" "}
                  {(Number(balance) / Math.pow(10, tokenDecimals)).toFixed(2)}{" "}
                  {tokenSymbol})
                </span>
                <div className="flex flex-col gap-1 mb-4">
                  <div className="flex items-center gap-2">
                    <div className="flex-grow relative">
                      <Input
                        ref={inputRef}
                        type="text"
                        placeholder="Enter amount"
                        value={amount}
                        onChange={handleAmountChange}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") checkApproval();
                          if (e.key === "-" || e.key === "e" || e.key === "+")
                            e.preventDefault();
                        }}
                        className={cn(
                          "w-full",
                          error && "border-red-500 focus-visible:ring-red-500"
                        )}
                        aria-describedby={error ? "amount-error" : undefined}
                      />
                    </div>
                    <Button
                      onClick={handleMaxBet}
                      variant="outline"
                      className="px-3"
                      aria-label="Set maximum bet amount"
                    >
                      Max
                    </Button>
                    <span className="font-bold whitespace-nowrap">
                      {tokenSymbol}
                    </span>
                  </div>
                  <div className="min-h-[20px]">
                    {error && (
                      <span id="amount-error" className="text-sm text-red-500">
                        {error}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex justify-between gap-4">
                  <Button
                    onClick={checkApproval}
                    className="flex-1 min-w-[120px]"
                    disabled={!amount}
                  >
                    Next
                  </Button>
                  <Button
                    onClick={handleCancel}
                    variant="outline"
                    className="flex-1 min-w-[120px]"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : buyingStep === "allowance" ? (
              <div className="flex flex-col border-2 border-gray-200 rounded-lg p-4">
                <h3 className="text-lg font-bold mb-2">Approve Tokens</h3>
                <p className="mb-4 text-sm">
                  Approve {amount} {tokenSymbol} for this purchase only.
                  <span className="block text-xs text-gray-500 mt-1">
                    Your wallet may not support batch transactions. A separate
                    approval is needed.
                  </span>
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={handleSetApproval}
                    className="min-w-[120px]"
                    disabled={isProcessing || isWritePending || isConfirmingTx}
                  >
                    {isProcessing || isWritePending || isConfirmingTx ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Approving...
                      </>
                    ) : (
                      `Approve ${amount} ${tokenSymbol}`
                    )}
                  </Button>
                  <Button
                    onClick={handleCancel}
                    variant="outline"
                    className="min-w-[120px]"
                    disabled={isProcessing || isWritePending || isConfirmingTx}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : buyingStep === "confirm" ? (
              <div className="flex flex-col border-2 border-gray-200 rounded-lg p-4">
                <h3 className="text-lg font-bold mb-2">
                  {"Confirm Batch Purchase"}
                </h3>
                <p className="mb-4 text-sm">
                  <>
                    <span className="inline-block bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-medium mb-2">
                      🚀 EIP-5792 Batch Transaction
                    </span>
                    <br />
                    Approve {amount} {tokenSymbol} + Buy{" "}
                    <span className="font-bold">
                      {amount}{" "}
                      {selectedOption === "A" ? market.optionA : market.optionB}
                    </span>{" "}
                    shares in one atomic transaction.
                  </>
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={handleConfirm}
                    className="min-w-[120px]"
                    disabled={
                      isProcessing ||
                      isWritePending ||
                      isConfirmingTx ||
                      isSendingCalls
                    }
                  >
                    {isProcessing ||
                    isWritePending ||
                    isConfirmingTx ||
                    isSendingCalls ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {"Processing Batch..."}
                      </>
                    ) : (
                      "Execute Batch"
                    )}
                  </Button>
                  <Button
                    onClick={handleCancel}
                    variant="outline"
                    className="min-w-[120px]"
                    disabled={
                      isProcessing ||
                      isWritePending ||
                      isConfirmingTx ||
                      isSendingCalls
                    }
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : buyingStep === "batchPartialSuccess" ? (
              <div className="flex flex-col border-2 border-orange-500 rounded-lg p-4 bg-orange-50">
                <h3 className="text-lg font-bold mb-2 text-orange-700">
                  ⚠️ Complete Your Purchase
                </h3>
                <p className="mb-4 text-sm">
                  <span className="font-semibold text-orange-800">
                    Your approval was successful, but the purchase needs to be
                    completed!
                  </span>
                  <br />
                  <br />
                  The Farcaster wallet batch transaction only completed the
                  approval step. Click &quot;Complete Purchase&quot; below to
                  buy your {amount}{" "}
                  {selectedOption === "A" ? market.optionA : market.optionB}{" "}
                  shares.
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={async () => {
                      setIsProcessing(true);
                      try {
                        const amountInUnits = toUnits(amount, tokenDecimals);
                        await writeContractAsync({
                          address: contractAddress,
                          abi: contractAbi,
                          functionName: "buyShares",
                          args: [
                            BigInt(marketId),
                            selectedOption === "A",
                            amountInUnits,
                          ],
                        });
                      } catch (error) {
                        console.error("Manual purchase error:", error);
                        toast({
                          title: "Purchase Failed",
                          description:
                            "Failed to complete purchase. Please try again.",
                          variant: "destructive",
                        });
                        setIsProcessing(false);
                      }
                    }}
                    className="min-w-[120px] bg-orange-600 hover:bg-orange-700"
                    disabled={isProcessing || isWritePending || isConfirmingTx}
                  >
                    {isProcessing || isWritePending || isConfirmingTx ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Purchasing...
                      </>
                    ) : (
                      "Complete Purchase"
                    )}
                  </Button>
                  <Button
                    onClick={handleCancel}
                    variant="outline"
                    className="min-w-[120px]"
                    disabled={isProcessing || isWritePending || isConfirmingTx}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : buyingStep === "purchaseSuccess" ? (
              <div className="flex flex-col items-center gap-4 p-4 border-2 border-green-500 rounded-lg bg-green-50">
                <h3 className="text-lg font-bold text-green-700">
                  Purchase Successful!
                </h3>
                <p className="text-sm text-center text-gray-600">
                  You successfully bought {amount}{" "}
                  {selectedOption === "A" ? market.optionA : market.optionB}{" "}
                  shares.
                </p>
                <div className="flex gap-2 mt-2">
                  <Button
                    onClick={handleShareAfterPurchase}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <FontAwesomeIcon
                      icon={faShareFromSquare}
                      className="mr-2 h-4 w-4"
                    />
                    Share this Market
                  </Button>
                  <Button onClick={handleCancel} variant="outline">
                    Done
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
