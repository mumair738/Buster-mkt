"use client";

import { useState } from "react";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { parseEther } from "viem";
import { useToast } from "@/components/ui/use-toast";
import { V2contractAddress, V2contractAbi } from "@/constants/contract";
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
  Users,
  Gift,
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
  SPONSORED = 2,
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
  [MarketType.SPONSORED]: "Sponsored Market",
};

export function CreateMarketV2() {
  const { isConnected } = useAccount();
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
  const [maxFreeParticipants, setMaxFreeParticipants] = useState<string>("100");
  const [freeSharesPerUser, setFreeSharesPerUser] = useState<string>("10");

  // Sponsored market specific
  const [minimumParticipants, setMinimumParticipants] = useState<string>("50");
  const [sponsorMessage, setSponsorMessage] = useState("");
  const [sponsorPrize, setSponsorPrize] = useState<string>("0.1"); // ETH

  const [isSubmitting, setIsSubmitting] = useState(false);

  const { writeContract, data: hash, error, isPending } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({
      hash,
    });

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
    return true;
  };

  const handleSubmit = async () => {
    if (!validateForm()) return;
    if (!hasCreatorAccess) {
      toast({
        title: "Error",
        description: "You don't have permission to create markets",
        variant: "destructive",
      });
      return;
    }

    setIsSubmitting(true);

    try {
      const durationInSeconds = Math.floor(parseFloat(duration) * 24 * 60 * 60);
      const liquidityWei = parseEther(initialLiquidity);
      const optionNames = options.map((opt) => opt.name);
      const optionDescriptions = options.map((opt) => opt.description);

      if (marketType === MarketType.FREE_ENTRY) {
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
            BigInt(freeSharesPerUser),
            liquidityWei,
          ],
        });
      } else if (marketType === MarketType.SPONSORED) {
        const prizeWei = parseEther(sponsorPrize);
        await writeContract({
          address: V2contractAddress,
          abi: V2contractAbi,
          functionName: "createSponsoredMarket",
          args: [
            question,
            description,
            optionNames,
            optionDescriptions,
            BigInt(durationInSeconds),
            category,
            BigInt(minimumParticipants),
            sponsorMessage,
            liquidityWei,
          ],
          value: prizeWei,
        });
      } else {
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
    } catch (error) {
      console.error("Error creating market:", error);
      toast({
        title: "Error",
        description: "Failed to create market. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
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
    setMaxFreeParticipants("100");
    setFreeSharesPerUser("10");
    setMinimumParticipants("50");
    setSponsorMessage("");
    setSponsorPrize("0.1");
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

  if (isConfirmed) {
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
            Create V2 Prediction Market
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
                  Initial Liquidity (BSTR) *
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
                  <Gift className="h-5 w-5" />
                  Free Market Settings
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label
                      htmlFor="maxParticipants"
                      className="flex items-center gap-2"
                    >
                      <Users className="h-4 w-4" />
                      Max Free Participants
                    </Label>
                    <Input
                      id="maxParticipants"
                      type="number"
                      min="1"
                      value={maxFreeParticipants}
                      onChange={(e) => setMaxFreeParticipants(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="freeShares">Free Shares Per User</Label>
                    <Input
                      id="freeShares"
                      type="number"
                      min="1"
                      value={freeSharesPerUser}
                      onChange={(e) => setFreeSharesPerUser(e.target.value)}
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {marketType === MarketType.SPONSORED && (
            <>
              <Separator />
              <div className="space-y-4">
                <h3 className="text-lg font-medium flex items-center gap-2">
                  <Gift className="h-5 w-5" />
                  Sponsored Market Settings
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label
                      htmlFor="minParticipants"
                      className="flex items-center gap-2"
                    >
                      <Users className="h-4 w-4" />
                      Minimum Participants
                    </Label>
                    <Input
                      id="minParticipants"
                      type="number"
                      min="1"
                      value={minimumParticipants}
                      onChange={(e) => setMinimumParticipants(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="sponsorPrize">Prize Pool (ETH)</Label>
                    <Input
                      id="sponsorPrize"
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={sponsorPrize}
                      onChange={(e) => setSponsorPrize(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="sponsorMessage">Sponsor Message</Label>
                  <Textarea
                    id="sponsorMessage"
                    placeholder="Message to display with the sponsored market..."
                    value={sponsorMessage}
                    onChange={(e) => setSponsorMessage(e.target.value)}
                    rows={2}
                    maxLength={200}
                  />
                </div>
              </div>
            </>
          )}

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
                disabled={isPending || isConfirming || isSubmitting}
                className="min-w-[120px]"
              >
                {isPending || isConfirming || isSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {isPending
                      ? "Confirming..."
                      : isConfirming
                      ? "Creating..."
                      : "Processing..."}
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Create Market
                  </>
                )}
              </Button>
            </div>
          </div>

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 text-sm">Error: {error.message}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
