"use client";

import { useState, useEffect } from "react";
import { useAccount, useReadContract } from "wagmi";
import { V2contractAddress, V2contractAbi } from "@/constants/contract";

interface UserRoles {
  isOwner: boolean;
  isQuestionCreator: boolean;
  isQuestionResolver: boolean;
  isMarketValidator: boolean;
  isAdmin: boolean; // Helper: true if any admin role
  hasCreatorAccess: boolean; // Helper: true if can create markets
  hasResolverAccess: boolean; // Helper: true if can resolve markets
  hasValidatorAccess: boolean; // Helper: true if can validate markets
}

const QUESTION_CREATOR_ROLE =
  "0xef485be696bbc0c91ad541bbd553ffb5bd0e18dac30ba76e992dda23cb807a8a";
const QUESTION_RESOLVE_ROLE =
  "0xdcee1d35c83a32b436264a5c9afd68685c124f3f9097e87804c55410e67fc59a";
const MARKET_VALIDATOR_ROLE =
  "0xd486618b282cb35034d59c30c062b5b3822d6cdf87ec459191ce7f5b7b8a4873";
const DEFAULT_ADMIN_ROLE =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export function useUserRoles(): UserRoles {
  const { address, isConnected } = useAccount();
  const [roles, setRoles] = useState<UserRoles>({
    isOwner: false,
    isQuestionCreator: false,
    isQuestionResolver: false,
    isMarketValidator: false,
    isAdmin: false,
    hasCreatorAccess: false,
    hasResolverAccess: false,
    hasValidatorAccess: false,
  });

  // Get contract owner
  const { data: owner } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "owner",
    query: { enabled: isConnected && !!address },
  });

  // Check if user has DEFAULT_ADMIN_ROLE
  const { data: hasAdminRole } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "hasRole",
    args: [DEFAULT_ADMIN_ROLE, address as `0x${string}`],
    query: { enabled: isConnected && !!address },
  });

  // Check if user has QUESTION_CREATOR_ROLE
  const { data: hasCreatorRole } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "hasRole",
    args: [QUESTION_CREATOR_ROLE, address as `0x${string}`],
    query: { enabled: isConnected && !!address },
  });

  // Check if user has QUESTION_RESOLVE_ROLE
  const { data: hasResolveRole } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "hasRole",
    args: [QUESTION_RESOLVE_ROLE, address as `0x${string}`],
    query: { enabled: isConnected && !!address },
  });

  // Check if user has MARKET_VALIDATOR_ROLE
  const { data: hasValidatorRole } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "hasRole",
    args: [MARKET_VALIDATOR_ROLE, address as `0x${string}`],
    query: { enabled: isConnected && !!address },
  });

  useEffect(() => {
    if (!isConnected || !address) {
      setRoles({
        isOwner: false,
        isQuestionCreator: false,
        isQuestionResolver: false,
        isMarketValidator: false,
        isAdmin: false,
        hasCreatorAccess: false,
        hasResolverAccess: false,
        hasValidatorAccess: false,
      });
      return;
    }

    const isOwner =
      owner && address.toLowerCase() === (owner as string).toLowerCase();
    const isQuestionCreator = Boolean(hasCreatorRole);
    const isQuestionResolver = Boolean(hasResolveRole);
    const isMarketValidator = Boolean(hasValidatorRole);
    const isAdminUser = Boolean(hasAdminRole) || isOwner;

    setRoles({
      isOwner: Boolean(isOwner),
      isQuestionCreator: Boolean(isQuestionCreator),
      isQuestionResolver: Boolean(isQuestionResolver),
      isMarketValidator: Boolean(isMarketValidator),
      isAdmin: Boolean(isAdminUser),
      hasCreatorAccess: Boolean(isOwner || isAdminUser || isQuestionCreator),
      hasResolverAccess: Boolean(isOwner || isAdminUser || isQuestionResolver),
      hasValidatorAccess: Boolean(isOwner || isAdminUser || isMarketValidator),
    });
  }, [
    isConnected,
    address,
    owner,
    hasAdminRole,
    hasCreatorRole,
    hasResolveRole,
    hasValidatorRole,
  ]);

  return roles;
}
