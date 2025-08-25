import { useAccount, useReadContract } from "wagmi";
import { V2contractAddress, V2contractAbi } from "@/constants/contract";
import { useState } from "react";

interface UserV3Roles {
  isCreator: (marketId: number) => boolean;
  isLP: (marketId: number) => boolean;
  isFeeCollector: boolean;
  isOwner: boolean;
  checkLPStatus: (marketId: number) => Promise<boolean>;
  checkCreatorStatus: (marketId: number) => Promise<boolean>;
}

export function useV3UserRoles(): UserV3Roles {
  const { address, isConnected } = useAccount();
  const [marketCreators, setMarketCreators] = useState<Map<number, string>>(
    new Map()
  );
  const [lpStatuses, setLPStatuses] = useState<Map<number, boolean>>(new Map());

  // Check if user is owner
  const { data: owner } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "owner",
    query: { enabled: isConnected },
  });

  // Check if user is fee collector
  const { data: platformStats } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getPlatformStats",
    query: { enabled: isConnected },
  });

  // Function to check creator status for a specific market
  const checkCreatorStatus = async (marketId: number): Promise<boolean> => {
    if (!address || !isConnected) return false;

    try {
      // Check cache first
      const cachedCreator = marketCreators.get(marketId);
      if (cachedCreator) {
        return cachedCreator.toLowerCase() === address.toLowerCase();
      }

      // Fetch market info to get creator
      const marketInfo = await fetch(`/api/market-info/${marketId}`).then(
        (res) => res.json()
      );
      if (marketInfo && marketInfo.creator) {
        setMarketCreators((prev) =>
          new Map(prev).set(marketId, marketInfo.creator)
        );
        return marketInfo.creator.toLowerCase() === address.toLowerCase();
      }

      return false;
    } catch (error) {
      console.error("Error checking creator status:", error);
      return false;
    }
  };

  // Function to check LP status for a specific market
  const checkLPStatus = async (marketId: number): Promise<boolean> => {
    if (!address || !isConnected) return false;

    try {
      // Check cache first
      const cachedStatus = lpStatuses.get(marketId);
      if (cachedStatus !== undefined) return cachedStatus;

      // Check LP contribution using contract call
      const lpInfo = await fetch(`/api/lp-info/${marketId}/${address}`).then(
        (res) => res.json()
      );
      const hasContribution =
        lpInfo && lpInfo.contribution && BigInt(lpInfo.contribution) > 0n;

      setLPStatuses((prev) => new Map(prev).set(marketId, hasContribution));
      return hasContribution;
    } catch (error) {
      console.error("Error checking LP status:", error);
      return false;
    }
  };

  // Synchronous versions that use cached data
  const isCreator = (marketId: number): boolean => {
    if (!address) return false;
    const cachedCreator = marketCreators.get(marketId);
    return cachedCreator
      ? cachedCreator.toLowerCase() === address.toLowerCase()
      : false;
  };

  const isLP = (marketId: number): boolean => {
    return lpStatuses.get(marketId) || false;
  };

  const isFeeCollector = Boolean(
    address &&
      platformStats &&
      platformStats[1] && // feeCollector address from getPlatformStats
      address.toLowerCase() === (platformStats[1] as string).toLowerCase()
  );

  const isOwner = Boolean(
    address &&
      owner &&
      address.toLowerCase() === (owner as string).toLowerCase()
  );

  return {
    isCreator,
    isLP,
    isFeeCollector,
    isOwner,
    checkLPStatus,
    checkCreatorStatus,
  };
}
