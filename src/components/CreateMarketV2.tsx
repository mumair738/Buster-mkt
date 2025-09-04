"use client";

import { useState, useEffect } from "react";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
  useSendCalls,
  useWaitForCallsStatus,
} from "wagmi";
import { parseEther, encodeFunctionData } from "viem";
import { useToast } from "@/components/ui/use-toast";
import {
  V2contractAddress,
  V2contractAbi,
  tokenAddress,
  tokenAbi,
} from "@/constants/contract";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Plus,
  Minus,
  Calendar,
  DollarSign,
  Info,
  Loader2,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import { useUserRoles } from "@/hooks/useUserRoles";

interface MarketOption {
  name: string;
  description: string;
}

enum MarketCategory {
  POLITICS = 0,
  SPORTS = 1,
  ENTERTAINMENT = 2,
  TECHNOLOGY = 3,
  ECONOMICS = 4,
  SCIENCE = 5,
  WEATHER = 6,
  OTHER = 7,
}

enum MarketType {
  PAID = 0,
  FREE_ENTRY = 1,
}

const CATEGORY_LABELS = {
  [MarketCategory.POLITICS]: "Politics",
  [MarketCategory.SPORTS]: "Sports",
  [MarketCategory.ENTERTAINMENT]: "Entertainment",
  [MarketCategory.TECHNOLOGY]: "Technology",
  [MarketCategory.ECONOMICS]: "Economics",
  [MarketCategory.SCIENCE]: "Science",
  [MarketCategory.WEATHER]: "Weather",
  [MarketCategory.OTHER]: "Other",
};

const MARKET_TYPE_LABELS = {
  [MarketType.PAID]: "Paid Market",
  [MarketType.FREE_ENTRY]: "Free Entry Market",
};

export function CreateMarketV2() {
  const { isConnected, address } = useAccount();
  const { hasCreatorAccess } = useUserRoles();
  const { toast } = useToast();

  // Form state
  const [question, setQuestion] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<MarketCategory>(
    MarketCategory.OTHER
  );
  const [marketType, setMarketType] = useState<MarketType>(MarketType.PAID);
  const [duration, setDuration] = useState<string>("7"); // days
  const [initialLiquidity, setInitialLiquidity] = useState<string>("1000");
  const [options, setOptions] = useState<MarketOption[]>([
    { name: "", description: "" },
    { name: "", description: "" },
  ]);

  // Free market specific
  const [maxFreeParticipants, setMaxFreeParticipants] = useState<string>("3");
  const [freeSharesPerUser, setFreeSharesPerUser] = useState<string>("100");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [useFallbackTransaction, setUseFallbackTransaction] = useState(false);

  // Batch transaction hooks
  const {
    sendCalls,
    data: callsData,
    error: callsError,
    isPending: callsPending,
  } = useSendCalls();

  // Fallback regular transaction hooks
  const {
    writeContract,
    data: writeData,
    error: writeError,
    isPending: writePending,
  } = useWriteContract();

  const { isLoading: writeLoading, isSuccess: writeSuccess } =
    useWaitForTransactionReceipt({
      hash: writeData,
    });

  const {
    data: callsStatusData,
    error: statusError,
    isLoading: statusLoading,
  } = useWaitForCallsStatus({
    id: callsData?.id as `0x${string}`,
    query: {
      enabled: !!callsData?.id,
      refetchInterval: 1000, // Check every second
    },
  });

  const callsConfirmed = callsStatusData?.status === "success";
  const callsFailed = callsStatusData?.status === "failure";

  // Handle transaction failures
  useEffect(() => {
    if (callsFailed) {
      console.error("❌ Batch transaction failed - status: failure");
      setIsSubmitting(false);
      toast({
        title: "Transaction Failed",
        description: "The batch transaction failed. Please try again.",
        variant: "destructive",
      });
    }
  }, [callsFailed, toast]);

  useEffect(() => {
    if (writeError) {
      console.error("❌ Fallback transaction failed:", writeError);
      setIsSubmitting(false);
      toast({
        title: "Transaction Failed",
        description: `Failed to create market: ${writeError.message}`,
        variant: "destructive",
      });
    }
  }, [writeError, toast]);

  // Track transaction status changes
  useEffect(() => {
    if (callsStatusData) {
      console.log(
        "📊 Batch transaction status update:",
        callsStatusData.status
      );
      if (callsStatusData.status === "success") {
        console.log("🎉 Batch transaction confirmed successfully!");
        setIsSubmitting(false);
      }
    }
  }, [callsStatusData]);

  useEffect(() => {
    if (writeSuccess) {
      console.log("🎉 Fallback transaction confirmed successfully!");
      setIsSubmitting(false);
    }
  }, [writeSuccess]);

  // Check token allowance
  const { data: allowanceData } = useReadContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "allowance",
    args: [
      address || "0x0000000000000000000000000000000000000000",
      V2contractAddress,
    ],
    query: {
      enabled: isConnected && !!address,
    },
  });
  const currentAllowance = (allowanceData as bigint | undefined) ?? 0n;

  // Check user token balance
  const { data: balanceData } = useReadContract({
    address: tokenAddress,
    abi: tokenAbi,
    functionName: "balanceOf",
    args: [address || "0x0000000000000000000000000000000000000000"],
    query: {
      enabled: isConnected && !!address,
    },
  });
  const userBalance = (balanceData as bigint | undefined) ?? 0n;

  // Handle batch transaction completion
  useEffect(() => {
    if (callsConfirmed) {
      setIsSubmitting(false);
      toast({
        title: "Success!",
        description: "Market created successfully!",
      });
    } else if (callsFailed) {
      setIsSubmitting(false);
      toast({
        title: "Error",
        description: "Transaction failed. Please try again.",
        variant: "destructive",
      });
    }
  }, [callsConfirmed, callsFailed, toast]);

  const addOption = () => {
    if (options.length < 10) {
      setOptions([...options, { name: "", description: "" }]);
    }
  };

  const removeOption = (index: number) => {
    if (options.length > 2) {
      setOptions(options.filter((_, i) => i !== index));
    }
  };

  const updateOption = (
    index: number,
    field: keyof MarketOption,
    value: string
  ) => {
    const newOptions = [...options];
    newOptions[index][field] = value;
    setOptions(newOptions);
  };

  const validateForm = () => {
    if (!question.trim()) {
      toast({
        title: "Error",
        description: "Question is required",
        variant: "destructive",
      });
      return false;
    }
    if (!description.trim()) {
      toast({
        title: "Error",
        description: "Description is required",
        variant: "destructive",
      });
      return false;
    }
    if (options.length < 2) {
      toast({
        title: "Error",
        description: "At least 2 options are required",
        variant: "destructive",
      });
      return false;
    }
    if (options.some((opt) => !opt.name.trim())) {
      toast({
        title: "Error",
        description: "All options must have names",
        variant: "destructive",
      });
      return false;
    }
    if (parseFloat(duration) < 1) {
      toast({
        title: "Error",
        description: "Duration must be at least 1 day",
        variant: "destructive",
      });
      return false;
    }
    if (parseFloat(initialLiquidity) < 100) {
      toast({
        title: "Error",
        description: "Initial liquidity must be at least 100 tokens",
        variant: "destructive",
      });
      return false;
    }

    // Additional validation for free markets
    if (marketType === MarketType.FREE_ENTRY) {
      console.log("🔍 Validating free market configuration...");
      console.log("Max Participants:", maxFreeParticipants);
      console.log("Tokens Per User:", freeSharesPerUser);

      // Check for empty inputs first
      if (!maxFreeParticipants.trim() || !freeSharesPerUser.trim()) {
        console.error("❌ Empty free market fields detected");
        toast({
          title: "Error",
          description: "Please fill in all free market fields",
          variant: "destructive",
        });
        return false;
      }

      const maxParticipants = parseInt(maxFreeParticipants);
      const tokensPerUser = parseFloat(freeSharesPerUser);

      console.log(
        "Parsed values - Max Participants:",
        maxParticipants,
        "Tokens Per User:",
        tokensPerUser
      );

      if (isNaN(maxParticipants) || maxParticipants < 1) {
        console.error("❌ Invalid max participants:", maxParticipants);
        toast({
          title: "Error",
          description: "Max free participants must be at least 1",
          variant: "destructive",
        });
        return false;
      }

      if (isNaN(tokensPerUser) || tokensPerUser <= 0) {
        console.error("❌ Invalid tokens per user:", tokensPerUser);
        toast({
          title: "Error",
          description: "Free tokens per user must be greater than 0",
          variant: "destructive",
        });
        return false;
      }

      // Calculate total prize pool and log it
      const totalPrizePool = tokensPerUser * maxParticipants;
      console.log("✅ Free market validation passed");
      console.log("💰 Total Prize Pool:", totalPrizePool, "tokens");
      console.log(
        "📊 Prize Pool Breakdown:",
        `${maxParticipants} participants × ${tokensPerUser} tokens each`
      );
    }

    console.log("✅ Form validation completed successfully");
    return true;
  };

  const handleSubmit = async () => {
    console.log("🚀 Starting market creation process...");
    console.log("📝 Form data:", {
      question,
      description,
      marketType,
      category,
      duration,
      initialLiquidity,
      options,
      maxFreeParticipants:
        marketType === MarketType.FREE_ENTRY ? maxFreeParticipants : "N/A",
      freeSharesPerUser:
        marketType === MarketType.FREE_ENTRY ? freeSharesPerUser : "N/A",
    });

    if (!validateForm()) {
      console.error("❌ Form validation failed");
      return;
    }

    if (!hasCreatorAccess) {
      console.error("❌ User lacks creator access");
      toast({
        title: "Error",
        description: "You don't have permission to create markets",
        variant: "destructive",
      });
      return;
    }

    // Prevent multiple submissions
    if (
      isSubmitting ||
      callsPending ||
      statusLoading ||
      writePending ||
      writeLoading
    ) {
      console.warn(
        "⏳ Transaction already in progress, blocking new submission"
      );
      toast({
        title: "Error",
        description: "Please wait for the current transaction to complete",
        variant: "destructive",
      });
      return;
    }

    console.log("🔄 Setting submission state to true");
    setIsSubmitting(true);

    try {
      console.log("📐 Calculating transaction parameters...");
      const durationInSeconds = Math.floor(parseFloat(duration) * 24 * 60 * 60);
      const liquidityWei = parseEther(initialLiquidity);
      const optionNames = options.map((opt) => opt.name);
      const optionDescriptions = options.map((opt) => opt.description);

      console.log("🔢 Calculated values:", {
        durationInSeconds,
        liquidityWei: liquidityWei.toString(),
        optionNames,
        optionDescriptions,
      });

      // Calculate required approval amount based on market type
      let requiredApproval = liquidityWei;
      console.log(
        "💰 Initial required approval (liquidity):",
        requiredApproval.toString()
      );

      if (marketType === MarketType.FREE_ENTRY) {
        console.log("🎁 Processing free market configuration...");
        // For free markets, we need to calculate total cost: liquidity + prize pool
        // Add safety checks for empty inputs
        if (!freeSharesPerUser.trim() || !maxFreeParticipants.trim()) {
          console.error("❌ Empty free market fields during submission");
          setIsSubmitting(false);
          toast({
            title: "Error",
            description: "Please fill in all free market fields",
            variant: "destructive",
          });
          return;
        }

        try {
          console.log("🧮 Calculating free market costs...");
          const tokensPerUser = parseEther(freeSharesPerUser);
          const maxParticipants = BigInt(maxFreeParticipants);
          console.log("Tokens per user (wei):", tokensPerUser.toString());
          console.log("Max participants:", maxParticipants.toString());

          const totalPrizePool = tokensPerUser * maxParticipants;
          console.log("Total prize pool (wei):", totalPrizePool.toString());

          requiredApproval = liquidityWei + totalPrizePool;
          console.log(
            "💰 Updated required approval (liquidity + prize pool):",
            requiredApproval.toString()
          );
          console.log(
            "💎 Prize pool amount:",
            totalPrizePool.toString(),
            "BUSTER"
          );
        } catch (error) {
          console.error("❌ Error calculating free market costs:", error);
          setIsSubmitting(false);
          toast({
            title: "Error",
            description: "Invalid values in free market configuration",
            variant: "destructive",
          });
          return;
        }
      }

      // Check if user has sufficient balance
      console.log("💳 Checking user balance...");
      console.log("User balance:", userBalance.toString(), "wei");
      console.log("Required approval:", requiredApproval.toString(), "wei");
      console.log(
        "User balance (formatted):",
        (Number(userBalance) / 1e18).toLocaleString(),
        "BUSTER"
      );
      console.log(
        "Required (formatted):",
        (Number(requiredApproval) / 1e18).toLocaleString(),
        "BUSTER"
      );

      if (userBalance < requiredApproval) {
        console.error("❌ Insufficient balance");
        setIsSubmitting(false);
        const requiredTokens = Number(requiredApproval) / 1e18;
        const currentTokens = Number(userBalance) / 1e18;
        const isFreeMarket = marketType === MarketType.FREE_ENTRY;
        const extraMessage = isFreeMarket
          ? " Note: Free markets require tokens for both initial liquidity and the prize pool."
          : "";
        toast({
          title: "Insufficient Balance",
          description: `You need ${requiredTokens.toLocaleString()} BUSTER tokens but only have ${currentTokens.toLocaleString()}. Please get more tokens to create this market.${extraMessage}`,
          variant: "destructive",
        });
        return;
      }

      console.log("✅ Balance check passed");

      // Try batch transaction first, fallback to regular transactions if it fails
      console.log(
        "🔄 Choosing transaction method - Fallback mode:",
        useFallbackTransaction
      );
      if (!useFallbackTransaction) {
        console.log("🔄 Attempting batch transaction...");
        try {
          await handleBatchTransaction(
            requiredApproval,
            liquidityWei,
            durationInSeconds,
            optionNames,
            optionDescriptions
          );
        } catch (error) {
          console.error("❌ Batch transaction failed:", error);
          console.warn(
            "Batch transaction failed, trying fallback method:",
            error
          );
          setUseFallbackTransaction(true);
          console.log("🔄 Switching to fallback transaction method...");
          await handleFallbackTransaction(
            requiredApproval,
            liquidityWei,
            durationInSeconds,
            optionNames,
            optionDescriptions
          );
        }
      } else {
        console.log("🔄 Using fallback transaction method directly...");
        await handleFallbackTransaction(
          requiredApproval,
          liquidityWei,
          durationInSeconds,
          optionNames,
          optionDescriptions
        );
      }
    } catch (error: any) {
      console.error("❌ Fatal error creating market:", error);
      console.error("Error details:", {
        message: error?.message,
        stack: error?.stack,
        cause: error?.cause,
      });
      toast({
        title: "Error",
        description: `Failed to create market: ${
          error?.message || "Unknown error"
        }`,
        variant: "destructive",
      });
      setIsSubmitting(false);
    }
  };

  const handleBatchTransaction = async (
    requiredApproval: bigint,
    liquidityWei: bigint,
    durationInSeconds: number,
    optionNames: string[],
    optionDescriptions: string[]
  ) => {
    console.log("📦 Starting batch transaction preparation...");
    console.log("Batch transaction parameters:", {
      requiredApproval: requiredApproval.toString(),
      liquidityWei: liquidityWei.toString(),
      durationInSeconds,
      optionNames,
      optionDescriptions,
    });

    const calls = [];

    // Add approval if needed
    console.log("🔐 Checking if approval is needed...");
    console.log("Required approval:", requiredApproval.toString());
    console.log("Current allowance:", currentAllowance.toString());

    if (requiredApproval > currentAllowance) {
      console.log("✅ Adding approval call to batch");
      calls.push({
        to: tokenAddress,
        data: encodeFunctionData({
          abi: tokenAbi,
          functionName: "approve",
          args: [V2contractAddress, requiredApproval],
        }),
      });
    } else {
      console.log("ℹ️ Approval not needed - sufficient allowance");
    }

    // Add market creation call
    console.log("🏗️ Preparing market creation call...");
    let marketCreationData;

    if (marketType === MarketType.FREE_ENTRY) {
      console.log("🎁 Creating FREE_ENTRY market with args:", {
        question,
        description,
        optionNames,
        optionDescriptions,
        durationInSeconds: BigInt(durationInSeconds).toString(),
        category,
        maxFreeParticipants: BigInt(maxFreeParticipants).toString(),
        tokensPerParticipant: parseEther(freeSharesPerUser).toString(),
        initialLiquidity: liquidityWei.toString(),
      });

      marketCreationData = encodeFunctionData({
        abi: V2contractAbi,
        functionName: "createFreeMarket",
        args: [
          question,
          description,
          optionNames,
          optionDescriptions,
          BigInt(durationInSeconds),
          category,
          BigInt(maxFreeParticipants), // _maxFreeParticipants
          parseEther(freeSharesPerUser), // _tokensPerParticipant
          liquidityWei, // _initialLiquidity
        ],
      });
    } else {
      console.log("💰 Creating PAID market with args:", {
        question,
        description,
        optionNames,
        optionDescriptions,
        durationInSeconds: BigInt(durationInSeconds).toString(),
        category,
        marketType,
        initialLiquidity: liquidityWei.toString(),
      });

      marketCreationData = encodeFunctionData({
        abi: V2contractAbi,
        functionName: "createMarket",
        args: [
          question,
          description,
          optionNames,
          optionDescriptions,
          BigInt(durationInSeconds),
          category,
          marketType,
          liquidityWei,
        ],
      });
    }

    console.log("✅ Market creation data encoded successfully");

    calls.push({
      to: V2contractAddress,
      data: marketCreationData,
      value: 0n,
    });

    console.log("📦 Final batch calls array:", calls);
    console.log("📊 Batch summary:", {
      totalCalls: calls.length,
      hasApproval: calls.length > 1,
      requiredApproval: requiredApproval.toString(),
      currentAllowance: currentAllowance.toString(),
    });
    console.log("Current allowance:", currentAllowance.toString());

    console.log("🚀 Sending batch calls to wallet...");
    await sendCalls({ calls });
    console.log("✅ Batch calls sent successfully!");

    toast({
      title: "Transaction Sent",
      description:
        requiredApproval > currentAllowance
          ? "Approving tokens and creating market..."
          : "Creating market...",
    });
  };

  const handleFallbackTransaction = async (
    requiredApproval: bigint,
    liquidityWei: bigint,
    durationInSeconds: number,
    optionNames: string[],
    optionDescriptions: string[]
  ) => {
    console.log("🔄 Starting fallback transaction...");
    console.log("Fallback transaction parameters:", {
      requiredApproval: requiredApproval.toString(),
      liquidityWei: liquidityWei.toString(),
      currentAllowance: currentAllowance.toString(),
    });

    // For fallback, we need to handle approval separately if needed
    if (requiredApproval > currentAllowance) {
      console.error(
        "❌ Fallback requires pre-approval - insufficient allowance"
      );
      toast({
        title: "Approval Required",
        description:
          "Please approve the token spending first, then create the market.",
        variant: "destructive",
      });
      setIsSubmitting(false);
      return;
    }

    console.log("✅ Allowance sufficient for fallback transaction");

    // Create market directly
    if (marketType === MarketType.FREE_ENTRY) {
      console.log("🎁 Creating free market via fallback...");
      await writeContract({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "createFreeMarket",
        args: [
          question,
          description,
          optionNames,
          optionDescriptions,
          BigInt(durationInSeconds),
          category,
          BigInt(maxFreeParticipants),
          parseEther(freeSharesPerUser),
          liquidityWei,
        ],
      });
    } else {
      console.log("💰 Creating paid market via fallback...");
      await writeContract({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "createMarket",
        args: [
          question,
          description,
          optionNames,
          optionDescriptions,
          BigInt(durationInSeconds),
          category,
          marketType,
          liquidityWei,
        ],
      });
    }

    console.log("✅ Fallback transaction sent successfully!");
    toast({
      title: "Transaction Sent",
      description: "Creating market...",
    });
  };

  const resetForm = () => {
    setQuestion("");
    setDescription("");
    setCategory(MarketCategory.OTHER);
    setMarketType(MarketType.PAID);
    setDuration("7");
    setInitialLiquidity("1000");
    setOptions([
      { name: "", description: "" },
      { name: "", description: "" },
    ]);
    setMaxFreeParticipants("3");
    setFreeSharesPerUser("100");
    setIsSubmitting(false);
  };

  if (!isConnected) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <AlertTriangle className="h-16 w-16 mx-auto text-yellow-400 mb-4" />
          <h3 className="text-lg font-medium mb-2">Connect Your Wallet</h3>
          <p className="text-gray-600">
            Please connect your wallet to create markets.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!hasCreatorAccess) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <AlertTriangle className="h-16 w-16 mx-auto text-red-400 mb-4" />
          <h3 className="text-lg font-medium mb-2">Access Denied</h3>
          <p className="text-gray-600">
            You don&apos;t have permission to create markets. Only admins and
            users with creator role can create markets.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (callsConfirmed || writeSuccess) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <CheckCircle className="h-16 w-16 mx-auto text-green-500 mb-4" />
          <h3 className="text-lg font-medium mb-2">
            Market Created Successfully!
          </h3>
          <p className="text-gray-600 mb-4">
            Your prediction market has been created and is now live.
          </p>
          <Button onClick={resetForm} className="mr-2">
            Create Another Market
          </Button>
          <Button
            variant="outline"
            onClick={() => (window.location.href = "/")}
          >
            View Markets
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="h-5 w-5" />
            Create Market
            <Badge variant="secondary">Admin</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Basic Information */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Basic Information</h3>

            <div className="space-y-2">
              <Label htmlFor="question">Market Question *</Label>
              <Input
                id="question"
                placeholder="e.g., Will candidate X win the 2024 election?"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                maxLength={200}
              />
              <p className="text-sm text-gray-500">
                {question.length}/200 characters
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description *</Label>
              <Textarea
                id="description"
                placeholder="Provide additional context and resolution criteria..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                maxLength={1000}
              />
              <p className="text-sm text-gray-500">
                {description.length}/1000 characters
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="category">Category</Label>
                <Select
                  value={category.toString()}
                  onValueChange={(value) => setCategory(parseInt(value))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="marketType">Market Type</Label>
                <Select
                  value={marketType.toString()}
                  onValueChange={(value) => setMarketType(parseInt(value))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(MARKET_TYPE_LABELS).map(
                      ([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="duration" className="flex items-center gap-2">
                  <Calendar className="h-4 w-4" />
                  Duration (days) *
                </Label>
                <Input
                  id="duration"
                  type="number"
                  min="1"
                  max="365"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label
                  htmlFor="initialLiquidity"
                  className="flex items-center gap-2"
                >
                  <DollarSign className="h-4 w-4" />
                  Initial Liquidity (buster) *
                </Label>
                <Input
                  id="initialLiquidity"
                  type="number"
                  min="100"
                  value={initialLiquidity}
                  onChange={(e) => setInitialLiquidity(e.target.value)}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Market Options */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-medium">Market Options</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={addOption}
                disabled={options.length >= 10}
              >
                <Plus className="h-4 w-4 mr-2" />
                Add Option
              </Button>
            </div>

            {options.map((option, index) => (
              <Card key={index} className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <h4 className="font-medium">Option {index + 1}</h4>
                  {options.length > 2 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeOption(index)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <Label htmlFor={`option-name-${index}`}>
                      Option Name *
                    </Label>
                    <Input
                      id={`option-name-${index}`}
                      placeholder="e.g., Yes, No, Candidate A"
                      value={option.name}
                      onChange={(e) =>
                        updateOption(index, "name", e.target.value)
                      }
                      maxLength={100}
                    />
                  </div>

                  <div>
                    <Label htmlFor={`option-desc-${index}`}>
                      Option Description
                    </Label>
                    <Textarea
                      id={`option-desc-${index}`}
                      placeholder="Additional details about this option..."
                      value={option.description}
                      onChange={(e) =>
                        updateOption(index, "description", e.target.value)
                      }
                      rows={2}
                      maxLength={500}
                    />
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Market Type Specific Settings */}
          {marketType === MarketType.FREE_ENTRY && (
            <>
              <Separator />
              <div className="space-y-4">
                <h3 className="text-lg font-medium flex items-center gap-2">
                  <Info className="h-5 w-5" />
                  Free Market Settings
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label
                      htmlFor="maxParticipants"
                      className="flex items-center gap-2"
                    >
                      <DollarSign className="h-4 w-4" />
                      Max Free Participants
                    </Label>
                    <Input
                      id="maxParticipants"
                      type="number"
                      min="1"
                      value={maxFreeParticipants}
                      onChange={(e) => {
                        const value = e.target.value;
                        // Allow empty string for clearing, but validate on blur
                        setMaxFreeParticipants(value);
                      }}
                      onBlur={(e) => {
                        const value = e.target.value;
                        if (value === "" || isNaN(parseInt(value))) {
                          setMaxFreeParticipants("3"); // Reset to default
                        }
                      }}
                      placeholder="e.g., 3"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="freeShares">Free Tokens Per User</Label>
                    <Input
                      id="freeShares"
                      type="number"
                      min="1"
                      value={freeSharesPerUser}
                      onChange={(e) => {
                        const value = e.target.value;
                        // Allow empty string for clearing, but validate on blur
                        setFreeSharesPerUser(value);
                      }}
                      onBlur={(e) => {
                        const value = e.target.value;
                        if (value === "" || isNaN(parseFloat(value))) {
                          setFreeSharesPerUser("100"); // Reset to default
                        }
                      }}
                      placeholder="e.g., 100"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          <Separator />

          {/* Fallback Transaction Option */}
          {useFallbackTransaction && (
            <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium text-yellow-800 dark:text-yellow-200">
                    Fallback Mode Enabled
                  </h4>
                  <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
                    Batch transactions failed. You&apos;ll need to approve token
                    spending first, then create the market in separate
                    transactions.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Cost Summary */}
          <div className="p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <h4 className="font-medium mb-2 flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Cost Summary
            </h4>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Initial Liquidity:</span>
                <span>{initialLiquidity} BUSTER</span>
              </div>
              {marketType === MarketType.FREE_ENTRY && (
                <>
                  <div className="flex justify-between">
                    <span>
                      Prize Pool ({maxFreeParticipants || "0"} ×{" "}
                      {freeSharesPerUser || "0"}):
                    </span>
                    <span>
                      {(() => {
                        const participants = parseInt(
                          maxFreeParticipants || "0"
                        );
                        const tokensPerUser = parseFloat(
                          freeSharesPerUser || "0"
                        );
                        return isNaN(participants) || isNaN(tokensPerUser)
                          ? "0"
                          : (participants * tokensPerUser).toLocaleString();
                      })()}{" "}
                      BUSTER
                    </span>
                  </div>
                  <Separator className="my-2" />
                  <div className="flex justify-between font-medium">
                    <span>Total Required:</span>
                    <span>
                      {(() => {
                        const liquidity = parseFloat(initialLiquidity || "0");
                        const participants = parseInt(
                          maxFreeParticipants || "0"
                        );
                        const tokensPerUser = parseFloat(
                          freeSharesPerUser || "0"
                        );
                        const prizePool =
                          isNaN(participants) || isNaN(tokensPerUser)
                            ? 0
                            : participants * tokensPerUser;
                        return isNaN(liquidity)
                          ? "0"
                          : (liquidity + prizePool).toLocaleString();
                      })()}{" "}
                      BUSTER
                    </span>
                  </div>
                </>
              )}
              {marketType === MarketType.PAID && (
                <div className="flex justify-between font-medium">
                  <span>Total Required:</span>
                  <span>{initialLiquidity} BUSTER</span>
                </div>
              )}

              <Separator className="my-2" />
              <div className="flex justify-between">
                <span>Your Balance:</span>
                <span
                  className={
                    userBalance <
                    parseEther(
                      marketType === MarketType.FREE_ENTRY
                        ? (
                            parseFloat(initialLiquidity) +
                            parseFloat(freeSharesPerUser) *
                              parseInt(maxFreeParticipants || "0")
                          ).toString()
                        : initialLiquidity
                    )
                      ? "text-red-500 font-medium"
                      : "text-green-600 font-medium"
                  }
                >
                  {(Number(userBalance) / 1e18).toLocaleString()} BUSTER
                </span>
              </div>

              {userBalance <
                parseEther(
                  marketType === MarketType.FREE_ENTRY
                    ? (
                        parseFloat(initialLiquidity) +
                        parseFloat(freeSharesPerUser) *
                          parseInt(maxFreeParticipants || "0")
                      ).toString()
                    : initialLiquidity
                ) && (
                <div className="flex items-center gap-2 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded mt-2">
                  <AlertTriangle className="h-4 w-4 text-red-500" />
                  <span className="text-red-700 dark:text-red-300 text-xs">
                    Insufficient balance to create this market
                  </span>
                </div>
              )}
            </div>
          </div>

          <Separator />

          {/* Submit Button */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Info className="h-4 w-4" />
              <span>Market creation requires initial liquidity deposit</span>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={resetForm}>
                Reset
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={
                  callsPending ||
                  statusLoading ||
                  isSubmitting ||
                  writePending ||
                  writeLoading ||
                  (() => {
                    try {
                      const liquidity = parseEther(initialLiquidity || "0");
                      if (marketType === MarketType.FREE_ENTRY) {
                        if (
                          !freeSharesPerUser.trim() ||
                          !maxFreeParticipants.trim()
                        )
                          return true;
                        const tokensPerUser = parseEther(freeSharesPerUser);
                        const participants = BigInt(maxFreeParticipants);
                        return (
                          userBalance < liquidity + tokensPerUser * participants
                        );
                      }
                      return userBalance < liquidity;
                    } catch {
                      return true; // Disable if calculation fails
                    }
                  })()
                }
                className="min-w-[120px]"
              >
                {callsPending ||
                statusLoading ||
                isSubmitting ||
                writePending ||
                writeLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {callsPending
                      ? "Sending Transactions..."
                      : statusLoading
                      ? "Processing..."
                      : "Processing..."}
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    {(() => {
                      const requiredApproval =
                        marketType === MarketType.FREE_ENTRY
                          ? parseEther(initialLiquidity) +
                            parseEther(freeSharesPerUser) *
                              BigInt(maxFreeParticipants)
                          : parseEther(initialLiquidity);
                      return requiredApproval > currentAllowance
                        ? "Approve & Create Market"
                        : "Create Market";
                    })()}
                  </>
                )}
              </Button>
            </div>
          </div>

          {(callsError || statusError) && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 text-sm">
                Error: {callsError?.message || statusError?.message}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
