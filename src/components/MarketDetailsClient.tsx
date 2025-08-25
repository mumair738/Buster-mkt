"use client";

import { useEffect, useState } from "react";
import { sdk } from "@farcaster/miniapp-sdk";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Toaster } from "@/components/ui/toaster";
import { Clock, Award, Users } from "lucide-react"; //AlertTriangle later for status badge
import { MarketBuyInterface } from "@/components/market-buy-interface";
import { MarketV2BuyInterface } from "@/components/market-v2-buy-interface";
import { MarketV2PositionManager } from "@/components/MarketV2PositionManager";
import { V3FinancialManager } from "@/components/V3FinancialManager";
import { MarketResolved } from "@/components/market-resolved";
import { MarketPending } from "@/components/market-pending";
import MarketTime from "@/components/market-time";
import { MarketProgress } from "@/components/market-progress";
//eslint-disable-next-line @typescript-eslint/no-unused-vars
import { MarketSharesDisplay } from "@/components/market-shares-display";

import { UrlPreview } from "@/components/url-preview";
import { MarketContext } from "@/components/market-context";
import { MarketChart } from "@/components/market-chart";
import { CommentSystem } from "@/components/CommentSystem";
import { MarketV2, MarketOption, MarketCategory } from "@/types/types";
import { useV3UserRoles } from "@/hooks/useV3UserRoles";

interface Market {
  question: string;
  // V1 Binary options
  optionA?: string;
  optionB?: string;
  totalOptionAShares?: bigint;
  totalOptionBShares?: bigint;
  // V2 Multi-options
  options?: string[];
  optionShares?: bigint[];
  description?: string;
  category?: number | MarketCategory;
  disputed?: boolean;
  creator?: string;
  winningOptionId?: number;
  optionCount?: number;
  // Common properties
  endTime: bigint;
  outcome: number;
  resolved: boolean;
  version?: "v1" | "v2";
}

interface MarketDetailsClientProps {
  marketId: string;
  market: Market;
}

const TOKEN_DECIMALS = 18;

// Helper function to convert numeric category to MarketCategory enum
const convertToMarketCategory = (
  category: number | MarketCategory | undefined
): MarketCategory => {
  if (typeof category === "number") {
    // Convert numeric category to enum
    switch (category) {
      case 0:
        return MarketCategory.POLITICS;
      case 1:
        return MarketCategory.SPORTS;
      case 2:
        return MarketCategory.ENTERTAINMENT;
      case 3:
        return MarketCategory.TECHNOLOGY;
      case 4:
        return MarketCategory.ECONOMICS;
      case 5:
        return MarketCategory.SCIENCE;
      case 6:
        return MarketCategory.WEATHER;
      case 7:
        return MarketCategory.OTHER;
      default:
        return MarketCategory.OTHER;
    }
  }
  return category || MarketCategory.OTHER;
};

const LinkifiedText = ({ text }: { text: string }) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  return (
    <div className="space-y-2">
      {parts.map((part, index) =>
        urlRegex.test(part) ? (
          <UrlPreview key={index} url={part} className="block" />
        ) : (
          <span key={index} className="text-gray-900 dark:text-gray-100">
            {part}
          </span>
        )
      )}
    </div>
  );
};

export function MarketDetailsClient({
  marketId,
  market,
}: MarketDetailsClientProps) {
  const { isCreator, isLP, isFeeCollector, checkCreatorStatus, checkLPStatus } =
    useV3UserRoles();
  const [userRoles, setUserRoles] = useState({
    isCreator: false,
    isLP: false,
    isFeeCollector: false,
  });
  const [rolesChecked, setRolesChecked] = useState(false);

  // Reset roles check when marketId changes
  useEffect(() => {
    setRolesChecked(false);
    setUserRoles({
      isCreator: false,
      isLP: false,
      isFeeCollector: false,
    });
  }, [marketId]);

  // Check user roles for this specific market
  useEffect(() => {
    const checkRoles = async () => {
      if (market.version === "v2" && !rolesChecked) {
        try {
          const [creatorStatus, lpStatus] = await Promise.all([
            checkCreatorStatus(Number(marketId)),
            checkLPStatus(Number(marketId)),
          ]);

          setUserRoles({
            isCreator: creatorStatus,
            isLP: lpStatus,
            isFeeCollector,
          });
          setRolesChecked(true);
        } catch (error) {
          console.error("Error checking user roles:", error);
          setRolesChecked(true); // Still mark as checked to prevent infinite retries
        }
      }
    };

    checkRoles();
  }, [marketId, market.version, rolesChecked]); // Removed function dependencies

  useEffect(() => {
    const signalReady = async () => {
      await sdk.actions.ready();
      (async () => {
        await sdk.actions.addFrame();
      })();
      console.log("MarketDetailsClient: Mini App signaled ready.");
    };
    signalReady();
  }, []);
  const totalSharesInUnits =
    market.version === "v2" && market.optionShares
      ? market.optionShares.reduce((sum, shares) => sum + shares, 0n)
      : (market.totalOptionAShares || 0n) + (market.totalOptionBShares || 0n);

  const totalSharesDisplay = Number(totalSharesInUnits) / 10 ** TOKEN_DECIMALS;

  // Calculate percentages based on market version
  let optionAPercentage = 50;
  let optionBPercentage = 50;

  if (market.version === "v1") {
    optionAPercentage =
      totalSharesInUnits > 0n
        ? Math.round(
            (Number(market.totalOptionAShares || 0n) /
              Number(totalSharesInUnits)) *
              100
          )
        : 50;
    optionBPercentage =
      totalSharesInUnits > 0n
        ? Math.round(
            (Number(market.totalOptionBShares || 0n) /
              Number(totalSharesInUnits)) *
              100
          )
        : 50;
  }

  const now = Date.now();
  const endTimeMs = Number(market.endTime) * 1000;
  const isEnded = now > endTimeMs;

  // let statusBadge;
  // if (market.resolved) {
  //   statusBadge = (
  //     <div className="inline-flex items-center px-3 py-1 rounded-full text-sm text-sm text-gray-600 bg-green-100 text-green-800">
  //       <Award className="w-4 h-4 mr-1" />
  //       Resolved
  //     </div>
  //   );
  // } else if (isEnded) {
  //   statusBadge = (
  //     <div className="inline-flex items-center px-3 py-1 rounded-full text-sm text-sm text-gray-600 bg-yellow-100 text-yellow-800">
  //       <AlertTriangle className="w-4 h-4 mr-1" />
  //       Unresolved
  //     </div>
  //   );
  // } else {
  //   statusBadge = (
  //     <div className="inline-flex items-center px-3 py-1 rounded-full text-sm text-sm text-gray-600 bg-blue-100 text-blue-800">
  //       <Clock className="w-4 h-4 mr-1" />
  //       Active
  //     </div>
  //   );
  // }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
      <Navbar />
      <main className="flex-grow container mx-auto px-4 pt-4 pb-24 md:p-6">
        <div className="flex items-center text-sm text-gray-600 dark:text-gray-400 mb-4">
          <Button asChild variant="outline" size="sm" className="mr-2">
            <Link href="/">Home</Link>
          </Button>
          <Link
            href="/"
            className="hover:text-blue-600 dark:hover:text-blue-400"
          >
            Markets
          </Link>
          <span className="mx-2">/</span>
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Market #{marketId}
          </span>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-4">
            <h1 className="text-lg md:text-xl font-bold text-gray-900 dark:text-gray-100 mb-2 md:mb-0">
              {/* {market.question} */}
              <LinkifiedText text={market.question} />
            </h1>
            {/* {statusBadge} */}
          </div>

          {/* Market Context - show if there are URLs in the question */}
          <MarketContext question={market.question} className="mb-4" />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
            <div className="flex items-center">
              <Clock className="text-gray-500 dark:text-gray-400 w-5 h-5 mr-2" />
              <div>
                <MarketTime endTime={market.endTime} />
              </div>
            </div>

            <div className="flex items-center">
              <Users className="text-gray-500 dark:text-gray-400 w-5 h-5 mr-2" />
              <div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  Reward pool
                </div>
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {totalSharesDisplay.toLocaleString()} Buster
                </div>
              </div>
            </div>

            {market.resolved && (
              <div className="flex items-center">
                <Award className="text-green-600 dark:text-green-400 w-5 h-5 mr-2" />
                <div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Winning Option
                  </div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {market.version === "v2" && market.options
                      ? market.options[market.outcome] ||
                        `Option ${market.outcome + 1}`
                      : market.outcome === 1
                      ? market.optionA
                      : market.optionB}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
          <div className="mb-6">
            {isEnded ? (
              market.resolved ? (
                <MarketResolved
                  marketId={Number(marketId)}
                  outcome={market.outcome}
                  optionA={market.optionA}
                  optionB={market.optionB}
                  options={market.options}
                  version={market.version}
                />
              ) : (
                <MarketPending />
              )
            ) : market.version === "v2" ? (
              <MarketV2BuyInterface
                marketId={Number(marketId)}
                market={
                  {
                    question: market.question,
                    description: market.description || market.question,
                    endTime: market.endTime,
                    optionCount: market.options?.length || 2,
                    disputed: market.disputed || false,
                    validated: true,
                    resolved: market.resolved,
                    category: convertToMarketCategory(market.category),
                    winningOptionId: market.resolved ? market.outcome : 0,
                    creator:
                      market.creator ||
                      "0x0000000000000000000000000000000000000000",
                    totalLiquidity: totalSharesInUnits,
                    totalVolume: totalSharesInUnits,
                    options: (market.options || []).map((option, index) => ({
                      name: option,
                      description: option,
                      totalShares: market.optionShares?.[index] || 0n,
                      totalVolume: 0n,
                      currentPrice: 0n, // Will be fetched by the component
                      isActive: !market.resolved,
                    })) satisfies MarketOption[],
                  } satisfies MarketV2
                }
              />
            ) : (
              <MarketBuyInterface
                marketId={Number(marketId)}
                market={{
                  question: market.question,
                  optionA: market.optionA || "Option A",
                  optionB: market.optionB || "Option B",
                  totalOptionAShares: market.totalOptionAShares || 0n,
                  totalOptionBShares: market.totalOptionBShares || 0n,
                }}
              />
            )}
          </div>

          {/* V2 Position Manager - only show for V2 markets */}
          {market.version === "v2" && (
            <div className="mt-8 border-t border-gray-200 dark:border-gray-700 pt-6">
              <MarketV2PositionManager
                marketId={Number(marketId)}
                market={
                  {
                    question: market.question,
                    description: market.description || market.question,
                    endTime: market.endTime,
                    optionCount: market.options?.length || 2,
                    disputed: market.disputed || false,
                    validated: true,
                    resolved: market.resolved,
                    category: convertToMarketCategory(market.category),
                    winningOptionId: market.resolved ? market.outcome : 0,
                    creator:
                      market.creator ||
                      "0x0000000000000000000000000000000000000000",
                    totalLiquidity: totalSharesInUnits,
                    totalVolume: totalSharesInUnits,
                    options: (market.options || []).map((option, index) => ({
                      name: option,
                      description: option,
                      totalShares: market.optionShares?.[index] || 0n,
                      totalVolume: 0n,
                      currentPrice: 0n, // Will be fetched by the component
                      isActive: !market.resolved,
                    })) satisfies MarketOption[],
                  } satisfies MarketV2
                }
              />
            </div>
          )}

          {/* V3 Financial Manager - only show for resolved V2 markets */}
          {market.version === "v2" && market.resolved && (
            <div className="mt-8 border-t border-gray-200 dark:border-gray-700 pt-6">
              <V3FinancialManager
                marketId={Number(marketId)}
                isCreator={userRoles.isCreator}
                isLP={userRoles.isLP}
                isFeeCollector={userRoles.isFeeCollector}
              />
            </div>
          )}

          <div className="mt-8 border-t border-gray-200 dark:border-gray-700 pt-6">
            <h3 className="text-lg font-semibold mb-4 text-gray-900 dark:text-gray-100">
              Current Market Sentiment
            </h3>
            {market.version === "v2" &&
            market.options &&
            market.optionShares ? (
              <MarketProgress
                options={market.options}
                optionShares={market.optionShares}
                version="v2"
                tokenDecimals={TOKEN_DECIMALS}
              />
            ) : (
              <MarketProgress
                optionA={market.optionA}
                optionB={market.optionB}
                totalOptionAShares={market.totalOptionAShares}
                totalOptionBShares={market.totalOptionBShares}
                version="v1"
                tokenDecimals={TOKEN_DECIMALS}
              />
            )}
          </div>

          {/* Market Analytics Charts */}
          <div className="mt-8 border-t border-gray-200 dark:border-gray-700 pt-6">
            <MarketChart
              marketId={marketId}
              market={{
                optionA: market.optionA,
                optionB: market.optionB,
                options: market.options,
                version: market.version,
              }}
            />
          </div>

          {/* Comment System */}
          <div className="mt-8 border-t border-gray-200 dark:border-gray-700 pt-6">
            <CommentSystem marketId={marketId} />
          </div>
        </div>
      </main>
      <Footer />
      <Toaster />
    </div>
  );
}
