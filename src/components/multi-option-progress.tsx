"use client";

import { MarketOption } from "@/types/types";
import { cn } from "@/lib/utils";
import { useReadContract } from "wagmi";
import { PolicastViews, PolicastViewsAbi } from "@/constants/contract";

interface MultiOptionProgressProps {
  marketId: number;
  options: MarketOption[];
  totalVolume: bigint;
  className?: string;
}

// Helper function to format price (assuming 18 decimals)
function formatPrice(price: bigint): string {
  const formatted = Number(price) / 1e18;
  if (formatted < 0.01) return formatted.toFixed(4);
  if (formatted < 1) return formatted.toFixed(3);
  return formatted.toFixed(2);
}

// Helper function to format odds coming from contract. We no longer display the raw
// on-chain odds value directly (some deployments encode an extra *100 factor); instead
// we derive display odds from the normalized probability for consistent UX.
// (Kept here in case of future debugging needs.)
function formatRawOdds(odds: bigint): number {
  return Number(odds) / 1e18;
}

// Helper function to calculate probability from odds (probability = 1/odds * 100)
function calculateProbabilityFromOdds(odds: bigint): number {
  const oddsNumber = Number(odds) / 1e18;
  if (oddsNumber <= 0) return 0;
  return Math.max(0, Math.min(100, (1 / oddsNumber) * 100));
}

// Fallback: Helper function to calculate percentage from current price (for backwards compatibility)
function calculateProbabilityFromPrice(price: bigint): number {
  const priceAsNumber = Number(price) / 1e18;
  return Math.max(0, Math.min(100, priceAsNumber * 100));
}

// Color palette for options (up to 10 options)
const optionColors = [
  "bg-blue-500",
  "bg-green-500",
  "bg-purple-500",
  "bg-orange-500",
  "bg-red-500",
  "bg-teal-500",
  "bg-pink-500",
  "bg-indigo-500",
  "bg-yellow-500",
  "bg-gray-500",
];

export function MultiOptionProgress({
  marketId,
  options,
  totalVolume,
  className,
}: MultiOptionProgressProps) {
  // Get market odds directly from contract
  const { data: marketOdds } = useReadContract({
    address: PolicastViews,
    abi: PolicastViewsAbi,
    functionName: "getMarketOdds",
    args: [BigInt(marketId)],
  });

  // Convert contract odds to array of bigints
  const odds = (marketOdds as readonly bigint[]) || [];

  // Debug logging
  console.log(`📊 Market ${marketId} odds from contract:`, {
    marketOdds,
    odds: odds.map((odd) => `${Number(odd) / 1e18}x`),
    optionCount: options.length,
  });

  // Calculate probabilities from contract odds, fallback to price-based calculation
  const probabilities =
    odds.length > 0
      ? odds.map((odd) => calculateProbabilityFromOdds(odd))
      : options.map((option) =>
          calculateProbabilityFromPrice(option.currentPrice)
        );

  // Normalize probabilities if they don't sum to 100%
  const totalProbability = probabilities.reduce((sum, prob) => sum + prob, 0);
  const normalizationFactor = totalProbability > 0 ? 100 / totalProbability : 0;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Progress Bar - based on contract odds */}
      <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
        <div className="h-full flex">
          {options.map((option, index) => {
            const probability = probabilities[index] || 0;
            const normalizedProbability = probability * normalizationFactor;

            return (
              <div
                key={index}
                className={cn(
                  optionColors[index] || "bg-gray-400",
                  "h-full transition-all duration-300 ease-in-out"
                )}
                style={{ width: `${normalizedProbability}%` }}
                title={`${option.name}: ${normalizedProbability.toFixed(1)}%`}
              />
            );
          })}
        </div>
      </div>

      {/* Options List */}
      <div className="space-y-2">
        {options.map((option, index) => {
          const probability = probabilities[index] || 0;
          const normalizedProbability = probability * normalizationFactor;
          const optionOdds = odds[index] || 0n;
          const priceFormatted = formatPrice(option.currentPrice * 100n);
          const volumeFormatted = formatPrice(option.totalVolume);
          // Derive display odds from normalized probability to avoid inflated raw odds (e.g. 100x instead of 1x)
          const displayOdds =
            normalizedProbability > 0 ? 100 / normalizedProbability : 0;
          const rawOdds = formatRawOdds(optionOdds); // for potential future comparison/debug

          return (
            <div
              key={index}
              className="flex items-center justify-between p-2 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
            >
              <div className="flex items-center space-x-3">
                <div
                  className={cn(
                    "w-3 h-3 rounded-full",
                    optionColors[index] || "bg-gray-400"
                  )}
                />
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {option.name}
                  </p>
                  {option.description && (
                    <p className="text-xs text-gray-500 truncate max-w-[200px]">
                      {option.description}
                    </p>
                  )}
                </div>
              </div>

              <div className="text-right">
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-bold text-gray-900">
                    {normalizedProbability.toFixed(1)}Buster
                  </span>
                  <span className="text-xs text-gray-500">
                    {displayOdds.toFixed(2)}x
                  </span>
                </div>
                <div className="text-xs text-gray-400">
                  {priceFormatted} Buster • Vol: {volumeFormatted}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Total Volume Display */}
      {totalVolume > 0n && (
        <div className="text-center text-sm text-gray-500 pt-2 border-t border-gray-200">
          Total Volume: {formatPrice(totalVolume)} Buster
        </div>
      )}
    </div>
  );
}
