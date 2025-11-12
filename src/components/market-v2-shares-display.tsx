"use client";

import { MarketV2, MarketOption } from "@/types/types";

interface MarketV2SharesDisplayProps {
  market: MarketV2;
  userShares: readonly bigint[];
  options: MarketOption[];
}

// Helper function to format shares amount//
function formatShares(shares: bigint, decimals: number = 18): string {
  const formatted = Number(shares) / Math.pow(10, decimals);
  if (formatted < 0.01) return formatted.toFixed(4);
  if (formatted < 1) return formatted.toFixed(3);
  return formatted.toFixed(2);
}

export function MarketV2SharesDisplay({
  userShares,
  options,
}: MarketV2SharesDisplayProps) {
  // Filter out options where user has shares
  const userPositions = userShares
    .map((shares, index) => ({
      optionId: index,
      shares,
      option: options[index],
    }))
    .filter(({ shares }) => shares > 0n);

  if (userPositions.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col space-y-1">
      <p className="text-xs text-gray-400 font-medium">Your positions:</p>
      <div className="space-y-1">
        {userPositions.map(({ optionId, shares, option }) => (
          <div key={optionId} className="flex items-center justify-between">
            <span className="text-xs text-gray-300 truncate max-w-[120px]">
              {option?.name || `Option ${optionId + 1}`}
            </span>
            <span className="text-xs font-medium text-gray-100">
              {formatShares(shares)} shares
            </span>
          </div>
        ))}
      </div>

      {userPositions.length > 3 && (
        <p className="text-xs text-gray-500">
          +{userPositions.length - 3} more positions
        </p>
      )}
    </div>
  );
}
