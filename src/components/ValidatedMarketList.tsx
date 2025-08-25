"use client";

import { useEffect, useState } from "react";
import { MarketCard, Market } from "./marketCard";
import { MarketV2Card } from "./market-v2-card";
import { MarketCardSkeleton } from "./market-card-skeleton";
import { MarketV2, Market as MarketV1Types } from "@/types/types";
import {
  V2contractAddress,
  V2contractAbi,
  publicClient,
} from "@/constants/contract";
import { getTotalMarketCount, fetchMarketData } from "@/lib/market-migration";

interface ValidatedMarketListProps {
  filter: "active" | "pending" | "resolved";
  showOnlyValidated?: boolean;
}

interface MarketWithVersion {
  id: number;
  version: "v1" | "v2";
  market: Market | MarketV2;
  validated: boolean;
}

// Helper function to convert MarketV1Types to Market (for compatibility)
function convertV1Market(market: MarketV1Types): Market {
  return {
    question: market.question,
    optionA: market.optionA,
    optionB: market.optionB,
    endTime: BigInt(market.endTime),
    outcome: parseInt(market.outcome),
    totalOptionAShares: BigInt(market.totalOptionAShares),
    totalOptionBShares: BigInt(market.totalOptionBShares),
    resolved: market.resolved,
  };
}

function getMarketStatus(
  market: Market | MarketV2
): "active" | "pending" | "resolved" {
  const now = Math.floor(Date.now() / 1000);
  // Handle both bigint and string endTime types
  const endTime =
    typeof market.endTime === "string"
      ? parseInt(market.endTime)
      : Number(market.endTime);
  const isExpired = endTime < now;
  const isResolved = market.resolved;

  if (isResolved) {
    return "resolved";
  } else if (isExpired) {
    return "pending";
  } else {
    return "active";
  }
}

// Check if a V2 market is validated by attempting a purchase call
async function checkMarketValidation(marketId: number): Promise<boolean> {
  try {
    // We'll try to simulate a purchase to see if it throws MarketNotValidated
    // This is a workaround since there's no direct validation getter
    // We use estimateContractGas with a dummy call to check if the market is validated
    await publicClient.estimateContractGas({
      address: V2contractAddress,
      abi: V2contractAbi,
      functionName: "buyShares",
      args: [BigInt(marketId), BigInt(0), BigInt(1), BigInt(1000000)], // Try to buy 1 share of option 0 with max price 1000000
      account: "0x0000000000000000000000000000000000000001", // Dummy account
    });
    return true; // If no error, market is validated
  } catch (error: any) {
    // Check if the error is specifically MarketNotValidated
    if (
      error?.message?.includes("MarketNotValidated") ||
      error?.shortMessage?.includes("MarketNotValidated") ||
      error?.details?.includes("MarketNotValidated")
    ) {
      return false;
    }
    // For other errors (like insufficient funds, invalid option, etc.), assume validated
    return true;
  }
}

export function ValidatedMarketList({
  filter,
  showOnlyValidated = true,
}: ValidatedMarketListProps) {
  const [markets, setMarkets] = useState<MarketWithVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMarkets = async () => {
      try {
        setLoading(true);
        setError(null);

        // Get market counts from both contracts
        const counts = await getTotalMarketCount();
        console.log("Market counts:", counts);

        // For now, prioritize V2 markets and show some V1 markets
        const marketPromises: Promise<MarketWithVersion>[] = [];

        // Fetch V2 markets (if any)
        for (let i = 0; i < counts.v2Count; i++) {
          marketPromises.push(
            fetchMarketData(i).then(async ({ version, market }) => {
              let validated = true; // V1 markets are always considered validated

              if (version === "v2") {
                // Check validation status for V2 markets
                validated = await checkMarketValidation(i);
              }

              return {
                id: i,
                version,
                validated,
                market:
                  version === "v2"
                    ? (market as MarketV2)
                    : convertV1Market(market as MarketV1Types),
              };
            })
          );
        }

        // Fetch recent V1 markets (up to 20) - these are always validated
        const v1MarketsToFetch = Math.min(counts.v1Count, 20);
        for (
          let i = Math.max(0, counts.v1Count - v1MarketsToFetch);
          i < counts.v1Count;
          i++
        ) {
          marketPromises.push(
            fetchMarketData(i).then(({ version, market }) => ({
              id: i,
              version,
              validated: true, // V1 markets are always validated
              market:
                version === "v2"
                  ? (market as MarketV2)
                  : convertV1Market(market as MarketV1Types),
            }))
          );
        }

        const allMarkets = await Promise.allSettled(marketPromises);

        const successfulMarkets = allMarkets
          .filter(
            (result): result is PromiseFulfilledResult<MarketWithVersion> =>
              result.status === "fulfilled"
          )
          .map((result) => result.value);

        // Sort by ID descending (newest first)
        successfulMarkets.sort((a, b) => b.id - a.id);

        setMarkets(successfulMarkets);
      } catch (err) {
        console.error("Error fetching markets:", err);
        setError("Failed to load markets");
      } finally {
        setLoading(false);
      }
    };

    fetchMarkets();
  }, []);

  // Filter markets based on status and validation
  const filteredMarkets = markets.filter(({ market, validated }) => {
    const status = getMarketStatus(market);
    const statusMatch = status === filter;
    const validationMatch = showOnlyValidated ? validated : true;
    return statusMatch && validationMatch;
  });

  if (loading) {
    return (
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <MarketCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-red-600">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-2 text-blue-600 hover:underline"
        >
          Retry
        </button>
      </div>
    );
  }

  if (filteredMarkets.length === 0) {
    const statusText = showOnlyValidated ? `validated ${filter}` : filter;
    return (
      <div className="text-center py-8">
        <p className="text-gray-500">No {statusText} markets found.</p>
        {showOnlyValidated && (
          <p className="text-sm text-gray-400 mt-2">
            Markets must be validated by an admin before appearing here.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
      {filteredMarkets.map(({ id, version, market, validated }) => {
        if (version === "v2") {
          return (
            <div key={`v2-${id}`} className="relative">
              <MarketV2Card index={id} market={market as MarketV2} />
              {!validated && (
                <div className="absolute top-2 right-2 bg-orange-100 text-orange-700 text-xs px-2 py-1 rounded">
                  Pending Validation
                </div>
              )}
            </div>
          );
        } else {
          return (
            <div key={`v1-${id}`} className="relative">
              <MarketCard index={id} market={market as Market} />
              {!validated && (
                <div className="absolute top-2 right-2 bg-orange-100 text-orange-700 text-xs px-2 py-1 rounded">
                  Pending Validation
                </div>
              )}
            </div>
          );
        }
      })}
    </div>
  );
}
