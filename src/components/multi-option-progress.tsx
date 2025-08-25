"use client";

import { MarketOption } from "@/types/types";
import { cn } from "@/lib/utils";

interface MultiOptionProgressProps {
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

// Helper function to calculate percentage
function calculatePercentage(
  optionVolume: bigint,
  totalVolume: bigint
): number {
  if (totalVolume === 0n) return 0;
  return Number((optionVolume * 10000n) / totalVolume) / 100;
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
  options,
  totalVolume,
  className,
}: MultiOptionProgressProps) {
  // Calculate total shares across all options for percentage calculation
  const totalShares = options.reduce(
    (sum, option) => sum + option.totalShares,
    0n
  );

  return (
    <div className={cn("space-y-4", className)}>
      {/* Progress Bar */}
      <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
        <div className="h-full flex">
          {options.map((option, index) => {
            const percentage = calculatePercentage(
              option.totalShares,
              totalShares
            );
            return (
              <div
                key={index}
                className={cn(
                  optionColors[index] || "bg-gray-400",
                  "h-full transition-all duration-300 ease-in-out"
                )}
                style={{ width: `${percentage}%` }}
                title={`${option.name}: ${percentage.toFixed(1)}%`}
              />
            );
          })}
        </div>
      </div>

      {/* Options List */}
      <div className="space-y-2">
        {options.map((option, index) => {
          const percentage = calculatePercentage(
            option.totalShares,
            totalShares
          );
          const priceFormatted = formatPrice(option.currentPrice);
          const volumeFormatted = formatPrice(option.totalVolume);

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
                    {percentage.toFixed(1)}%
                  </span>
                  <span className="text-xs text-gray-500">
                    {priceFormatted} Buster
                  </span>
                </div>
                <div className="text-xs text-gray-400">
                  Vol: {volumeFormatted} Buster
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
