import { useAccount, useReadContract } from "wagmi";
import {
  contractAddress,
  contractAbi,
  V2contractAddress,
  V2contractAbi,
} from "@/constants/contract";

interface MarketResolvedProps {
  marketId: number;
  outcome: number;
  optionA?: string; // Optional for V1 compatibility
  optionB?: string; // Optional for V1 compatibility
  options?: string[]; // For V2 multi-option markets
  version?: "v1" | "v2"; // To determine which contract to use
}

export function MarketResolved({
  marketId,
  outcome,
  optionA,
  optionB,
  options,
  version = "v1", // Default to V1 for backward compatibility
}: MarketResolvedProps) {
  const { address: accountAddress, isConnected } = useAccount();

  // Determine which contract to use
  const contractAddr = version === "v2" ? V2contractAddress : contractAddress;
  const contractAbiToUse = version === "v2" ? V2contractAbi : contractAbi;

  // For V2, use claimWinnings status, for V1 use getUserClaimedStatus
  const functionName = version === "v2" ? "markets" : "getUserClaimedStatus";

  // Only fetch claimed status if account is connected
  const { data: claimedStatus, isLoading } = useReadContract({
    abi: contractAbiToUse,
    address: contractAddr,
    functionName: version === "v1" ? "getUserClaimedStatus" : "markets",
    args:
      version === "v1"
        ? [
            BigInt(marketId),
            accountAddress || "0x0000000000000000000000000000000000000000",
          ]
        : [BigInt(marketId)], // V2 markets mapping
    query: {
      enabled: isConnected && !!accountAddress,
    },
  });

  // Determine the winning option text
  const getWinningOptionText = () => {
    if (version === "v2" && options) {
      // V2: outcome is the winning option ID
      return options[outcome] || `Option ${outcome + 1}`;
    } else if (optionA && optionB) {
      // V1: outcome 1 = optionA, outcome 2 = optionB
      return outcome === 1 ? optionA : optionB;
    } else {
      return `Option ${outcome}`;
    }
  };

  // Determine distribution message
  const distributionMessage = !isConnected
    ? "Connect wallet to view reward status"
    : isLoading
    ? "Checking reward status..."
    : version === "v1"
    ? claimedStatus
      ? "Rewards distributed"
      : "Verifying results"
    : "Rewards available to claim"; // V2 has manual claiming

  return (
    <div className="flex flex-col gap-2">
      <div className="bg-green-200 p-2 rounded-md text-center text-xs">
        Resolved: {getWinningOptionText()}
      </div>

      {/* Show distribution message for all markets */}
      <p className="text-xs text-gray-500 text-center">{distributionMessage}</p>
    </div>
  );
}
