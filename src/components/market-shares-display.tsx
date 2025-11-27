import { Badge } from "./ui/badge";
import { formatEther } from "viem";
import { useEffect, useState, useCallback } from "react";
import { toFixed } from "@/lib/utils";

interface MarketSharesDisplayProps {
  market: {
    optionA: string;
    optionB: string;
    totalOptionAShares: bigint;
    totalOptionBShares: bigint;
  };
  sharesBalance: {
    optionAShares: bigint;
    optionBShares: bigint;
  };
}
// Helper function to format shares amount//
export function MarketSharesDisplay({
  market,
  sharesBalance,
}: MarketSharesDisplayProps) {
  const [winnings, setWinnings] = useState<{ A: bigint; B: bigint }>({
    A: BigInt(0),
    B: BigInt(0),
  });

  const calculateWinnings = useCallback(
    (option: "A" | "B") => {
      if (!sharesBalance || !market) return BigInt(0);

      const userShares =
        option === "A"
          ? sharesBalance.optionAShares
          : sharesBalance.optionBShares;
      const totalSharesForOption =
        option === "A" ? market.totalOptionAShares : market.totalOptionBShares;
      const totalLosingShares =
        option === "A" ? market.totalOptionBShares : market.totalOptionAShares;

      if (totalSharesForOption === BigInt(0)) return BigInt(0);

      const userProportion =
        (userShares * BigInt(1000000)) / totalSharesForOption;
      const winningsFromLosingShares =
        (totalLosingShares * userProportion) / BigInt(1000000);

      return userShares + winningsFromLosingShares;
    },
    [sharesBalance, market]
  );

  useEffect(() => {
    const newWinnings = {
      A: calculateWinnings("A"),
      B: calculateWinnings("B"),
    };

    if (newWinnings.A !== winnings.A || newWinnings.B !== winnings.B) {
      setWinnings(newWinnings);
    }
  }, [calculateWinnings, winnings]);

  const displayWinningsA = toFixed(Number(formatEther(winnings.A)), 2);
  const displayWinningsB = toFixed(Number(formatEther(winnings.B)), 2);

  return (
    <div className="flex flex-col gap-2">
      <div className="w-full text-sm text-gray-300">
        Your shares: {market.optionA} -{" "}
        {Math.floor(parseInt(formatEther(sharesBalance?.optionAShares)))},{" "}
        {market.optionB} -{" "}
        {Math.floor(parseInt(formatEther(sharesBalance?.optionBShares)))}
      </div>
      {(winnings.A > 0 || winnings.B > 0) && (
        <div className="flex flex-col gap-1">
          <div className="text-xs text-gray-400">Winnings:</div>
          <div className="flex gap-2">
            <Badge
              variant="secondary"
              className="bg-[#352c3f]/80 border-[#544863] text-gray-200"
            >
              {market.optionA}: {displayWinningsA} shares
            </Badge>
            <Badge
              variant="secondary"
              className="bg-[#352c3f]/80 border-[#544863] text-gray-200"
            >
              {market.optionB}: {displayWinningsB} shares
            </Badge>
          </div>
        </div>
      )}
    </div>
  );
}
