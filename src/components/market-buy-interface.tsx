"use client";
//New EIP-5792 batch transactions
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  useAccount,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
  useConnectorClient,
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
import { sdk } from "@farcaster/frame-sdk";
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
  const { data: connectorClient } = useConnectorClient();
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
  const [supportsBatching, setSupportsBatching] = useState<boolean | null>(
    null
  );
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

  // Check EIP-5792 wallet capabilities
  const checkWalletCapabilities = useCallback(async () => {
    if (!connectorClient) return false;

    try {
      // Check if wallet supports EIP-5792 batch calls
      const capabilities = await connectorClient.request({
        method: "wallet_getCapabilities" as any,
      });

      console.log("Wallet capabilities:", capabilities);

      // Check if atomic batching is supported
      // EIP-5792 capabilities are typically returned as an object with chain ID keys
      const chainId = connectorClient.chain?.id;
      if (capabilities && typeof capabilities === "object" && chainId) {
        const chainCapabilities = (capabilities as any)[
          `0x${chainId.toString(16)}`
        ];
        const supportsAtomic =
          chainCapabilities?.atomicBatch?.supported === true;
        setSupportsBatching(supportsAtomic);
        return supportsAtomic;
      }

      setSupportsBatching(false);
      return false;
    } catch (error) {
      console.log(
        "EIP-5792 not supported, falling back to sequential transactions"
      );
      setSupportsBatching(false);
      return false;
    }
  }, [connectorClient]);

  // Check capabilities when connector changes
  useEffect(() => {
    if (connectorClient && supportsBatching === null) {
      checkWalletCapabilities();
    }
  }, [connectorClient, supportsBatching, checkWalletCapabilities]);

  // EIP-5792 batch transaction function
  const sendBatchTransaction = async (amountInUnits: bigint) => {
    if (!connectorClient || !accountAddress) {
      throw new Error("Wallet not connected");
    }

    // Prepare approve call data
    const approveCallData = encodeFunctionData({
      abi: tokenAbi,
      functionName: "approve",
      args: [contractAddress, amountInUnits], // Only approve exact amount needed
    });

    // Prepare buy shares call data
    const buySharesCallData = encodeFunctionData({
      abi: contractAbi,
      functionName: "buyShares",
      args: [BigInt(marketId), selectedOption === "A", amountInUnits],
    });

    // Send batch transaction using EIP-5792
    const calls = [
      {
        to: tokenAddress,
        data: approveCallData,
        value: "0x0",
      },
      {
        to: contractAddress,
        data: buySharesCallData,
        value: "0x0",
      },
    ];

    try {
      const batchId = await connectorClient.request({
        method: "wallet_sendCalls" as any,
        params: [
          {
            version: "1.0",
            chainId: `0x${connectorClient.chain?.id.toString(16)}`,
            from: accountAddress,
            calls,
            capabilities: {
              atomicBatch: {
                supported: true,
              },
            },
          },
        ],
      });

      return batchId;
    } catch (error) {
      console.error("Batch transaction failed:", error);
      throw error;
    }
  };

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

      // Check if we can use batch transactions (EIP-5792)
      if (supportsBatching === true) {
        // Skip approval step, go directly to batch execution
        setBuyingStep("confirm");
      } else {
        // Traditional flow: check if approval is needed
        const needsApproval = amountInUnits > userAllowance;
        setBuyingStep(needsApproval ? "allowance" : "confirm");
      }

      setError(null);
    } catch (error) {
      console.error("Amount validation error:", error);
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

      // Use EIP-5792 batch transaction if supported
      if (supportsBatching === true) {
        try {
          const batchId = await sendBatchTransaction(amountInUnits);
          console.log("Batch transaction submitted:", batchId);

          toast({
            title: "Batch Transaction Submitted",
            description: "Approve + Buy submitted in single transaction",
            duration: 3000,
          });

          // Note: With EIP-5792, we don't get a standard hash immediately
          // The wallet handles the batch atomically
          setBuyingStep("purchaseSuccess");
        } catch (batchError) {
          console.error(
            "Batch transaction failed, falling back to sequential:",
            batchError
          );
          // Fallback to traditional flow
          setSupportsBatching(false);
          throw batchError;
        }
      } else {
        // Traditional single transaction (approval already done or not needed)
        await writeContractAsync({
          address: contractAddress,
          abi: contractAbi,
          functionName: "buyShares",
          args: [BigInt(marketId), selectedOption === "A", amountInUnits],
        });
      }

      // Don't show toast here for traditional flow - let the useEffect handle it after confirmation
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
      } else if (buyingStep === "confirm") {
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
                {supportsBatching === true && (
                  <p className="text-green-600 font-medium">
                    ⚡ Batch transactions supported
                  </p>
                )}
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
                  {supportsBatching === false && (
                    <span className="block text-xs text-gray-500 mt-1">
                      Your wallet doesn't support batch transactions.
                    </span>
                  )}
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
                  {supportsBatching === true
                    ? "Confirm Batch Purchase"
                    : "Confirm Purchase"}
                </h3>
                <p className="mb-4 text-sm">
                  {supportsBatching === true ? (
                    <>
                      <span className="inline-block bg-green-100 text-green-800 px-2 py-1 rounded text-xs font-medium mb-2">
                        🚀 EIP-5792 Batch Transaction
                      </span>
                      <br />
                      Approve {amount} {tokenSymbol} + Buy{" "}
                      <span className="font-bold">
                        {amount}{" "}
                        {selectedOption === "A"
                          ? market.optionA
                          : market.optionB}
                      </span>{" "}
                      shares in one atomic transaction.
                    </>
                  ) : (
                    <>
                      Buy{" "}
                      <span className="font-bold">
                        {amount}{" "}
                        {selectedOption === "A"
                          ? market.optionA
                          : market.optionB}
                      </span>{" "}
                      shares for {amount} {tokenSymbol}.
                    </>
                  )}
                </p>
                <div className="flex justify-end gap-2">
                  <Button
                    onClick={handleConfirm}
                    className="min-w-[120px]"
                    disabled={isProcessing || isWritePending || isConfirmingTx}
                  >
                    {isProcessing || isWritePending || isConfirmingTx ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        {supportsBatching === true
                          ? "Processing Batch..."
                          : "Confirming..."}
                      </>
                    ) : supportsBatching === true ? (
                      "Execute Batch"
                    ) : (
                      "Confirm"
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
