import { useReadContract, useAccount } from "wagmi";
import { V2contractAddress, V2contractAbi } from "@/constants/contract";

export function useV3PlatformData() {
  const { isConnected, address } = useAccount();

  // Fetch platform statistics
  const {
    data: platformStats,
    refetch: refetchPlatformStats,
    isLoading: isLoadingStats,
  } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getPlatformStats",
    query: { enabled: isConnected },
  });

  // Fetch current platform fee rate
  const { data: currentFeeRate, refetch: refetchFeeRate } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "platformFeeRate",
    query: { enabled: isConnected },
  });

  // Fetch contract owner
  const { data: owner } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "owner",
    query: { enabled: isConnected },
  });

  // Parse platform stats
  const globalStats = platformStats
    ? {
        totalFeesCollected: platformStats[0] as bigint,
        feeCollector: platformStats[1] as string,
        totalMarkets: platformStats[2] as bigint,
        totalTrades: platformStats[3] as bigint,
      }
    : null;

  // Check user roles
  const isOwner = Boolean(
    address &&
      owner &&
      address.toLowerCase() === (owner as string).toLowerCase()
  );

  const isFeeCollector = Boolean(
    address &&
      globalStats &&
      address.toLowerCase() === globalStats.feeCollector.toLowerCase()
  );

  // Refresh all data
  const refreshAllData = async () => {
    await Promise.all([refetchPlatformStats(), refetchFeeRate()]);
  };

  return {
    globalStats,
    currentFeeRate,
    owner,
    isOwner,
    isFeeCollector,
    isLoadingStats,
    refreshAllData,
  };
}
