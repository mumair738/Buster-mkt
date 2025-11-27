import { Progress } from "@/components/ui/progress";

// Utility to format bigint amounts based on token decimals
function formatTokenAmount(amount: bigint, decimals: number = 18): string {
  const divisor = BigInt(10) ** BigInt(decimals);
  const integer = amount / divisor;
  const fractional = (amount % divisor)
    .toString()
    .padStart(decimals, "0")
    .slice(0, 4);
  return `${integer}.${fractional}`.replace(/\.?0+$/, ""); // Remove trailing zeros
}

interface MarketProgressProps {
  // V1 Binary options (backward compatibility)//
  optionA?: string;
  optionB?: string;
  totalOptionAShares?: bigint;
  totalOptionBShares?: bigint;

  // V2 Multi-option support
  options?: string[];
  optionShares?: bigint[];

  // Version detection
  version?: "v1" | "v2";

  tokenDecimals?: number; // Optional, defaults to 18
}

export function MarketProgress({
  optionA,
  optionB,
  totalOptionAShares,
  totalOptionBShares,
  options,
  optionShares,
  version = "v1",
  tokenDecimals = 18,
}: MarketProgressProps) {
  // For V2 markets, use multi-option logic
  if (version === "v2" && options && optionShares) {
    const totalShares = optionShares.reduce((sum, shares) => sum + shares, 0n);

    if (totalShares === 0n) {
      return (
        <div className="mb-3 md:mb-4">
          <div className="text-center text-gray-400 text-xs md:text-sm">
            No bets yet
          </div>
        </div>
      );
    }

    return (
      <div className="mb-3 md:mb-4">
        <div className="space-y-2">
          {options.map((option, index) => {
            const shares = optionShares[index] || 0n;
            const percentage = Number((shares * 1000n) / totalShares) / 10;
            const odds =
              shares > 0n ? Number((totalShares * 100n) / shares) / 100 : 0;
            const formattedShares = formatTokenAmount(shares, tokenDecimals);

            return (
              <div key={index} className="space-y-1">
                <div className="flex justify-between text-xs md:text-sm">
                  <span className="font-medium truncate pr-2 text-gray-200">{option}</span>
                  <span className="text-gray-400 text-xs whitespace-nowrap">
                    {formattedShares} ({percentage.toFixed(1)}% •{" "}
                    {odds.toFixed(2)}x)
                  </span>
                </div>
                <Progress value={percentage} className="h-2" />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // V1 Binary market logic (existing code)
  const totalShares = (totalOptionAShares || 0n) + (totalOptionBShares || 0n);

  // Calculate percentages using bigint for precision
  const yesPercentage =
    totalShares > 0n
      ? Number(((totalOptionAShares || 0n) * 1000n) / totalShares) / 10 // One decimal place
      : 0;
  const noPercentage = totalShares > 0n ? 100 - yesPercentage : 0;

  // Calculate implied odds (total / winningShares)
  const yesOdds =
    totalShares > 0n && (totalOptionAShares || 0n) > 0n
      ? Number((totalShares * 100n) / (totalOptionAShares || 1n)) / 100
      : 0;
  const noOdds =
    totalShares > 0n && (totalOptionBShares || 0n) > 0n
      ? Number((totalShares * 100n) / (totalOptionBShares || 1n)) / 100
      : 0;

  // Format share amounts
  const yesShares = formatTokenAmount(totalOptionAShares || 0n, tokenDecimals);
  const noShares = formatTokenAmount(totalOptionBShares || 0n, tokenDecimals);

  return (
    <div className="mb-3 md:mb-4">
      {totalShares === 0n ? (
        <div className="text-center text-gray-400 text-xs md:text-sm">
          No bets yet
        </div>
      ) : (
        <>
          <div className="flex justify-between mb-2">
            <span className="flex items-center gap-1">
              <span className="font-bold text-xs md:text-sm text-green-400">
                {optionA || "Option A"}: {yesShares}
              </span>
              <span className="text-xs text-gray-400">
                {yesPercentage.toFixed(1)}% ({yesOdds.toFixed(2)}x)
              </span>
            </span>
            <span className="flex items-center gap-1">
              <span className="font-bold text-xs md:text-sm text-red-400">
                {optionB || "Option B"}: {noShares}
              </span>
              <span className="text-xs text-gray-400">
                {noPercentage.toFixed(1)}% ({noOdds.toFixed(2)}x)
              </span>
            </span>
          </div>
          <Progress
            value={yesPercentage}
            className="h-2 bg-red-900/30"
            style={{
              background: `linear-gradient(to right, #4ade80 ${yesPercentage}%, #f87171 ${yesPercentage}%)`,
            }}
          />
        </>
      )}
    </div>
  );
}
