"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Button } from "./ui/button";
import { useAccount, useReadContract } from "wagmi";
import {
  V2contractAddress,
  V2contractAbi,
  publicClient,
  PolicastViews,
  PolicastViewsAbi,
} from "@/constants/contract";
import { MultiOptionProgress } from "./multi-option-progress";
import MarketTime from "./market-time";
import { MarketResolved } from "./market-resolved";
import { MarketPending } from "./market-pending";
import { MarketV2BuyInterface } from "./market-v2-buy-interface";
import { MarketV2SharesDisplay } from "./market-v2-shares-display";
import { sdk } from "@farcaster/miniapp-sdk";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faShareFromSquare,
  faUpRightAndDownLeftFromCenter,
} from "@fortawesome/free-solid-svg-icons";
import { MessageCircle, Gift } from "lucide-react";
import { MarketV2, MarketOption, MarketCategory } from "@/types/types";
import { FreeMarketClaimStatus } from "./FreeMarketClaimStatus";
import { FreeTokenClaimButton } from "./FreeTokenClaimButton";

// Add LinkifiedText component for URL preview support//
const LinkifiedText = ({ text }: { text: string }) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  const getDomainFromUrl = (url: string) => {
    try {
      return new URL(url).hostname.replace("www.", "");
    } catch {
      return url;
    }
  };

  return (
    <>
      {parts.map((part, index) =>
        urlRegex.test(part) ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 bg-blue-50 border border-blue-200 rounded text-blue-700 hover:bg-blue-100 transition-colors text-xs"
            title={part}
          >
            <svg
              className="w-2.5 h-2.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z"
                clipRule="evenodd"
              />
            </svg>
            {getDomainFromUrl(part)}
          </a>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  );
};

// Category badge component
const CategoryBadge = ({ category }: { category: MarketCategory }) => {
  const categoryNames = {
    [MarketCategory.POLITICS]: "Politics",
    [MarketCategory.SPORTS]: "Sports",
    [MarketCategory.ENTERTAINMENT]: "Entertainment",
    [MarketCategory.TECHNOLOGY]: "Technology",
    [MarketCategory.ECONOMICS]: "Economics",
    [MarketCategory.SCIENCE]: "Science",
    [MarketCategory.WEATHER]: "Weather",
    [MarketCategory.OTHER]: "Other",
  };

  const categoryColors = {
    [MarketCategory.POLITICS]: "bg-red-100 text-red-700",
    [MarketCategory.SPORTS]: "bg-green-100 text-green-700",
    [MarketCategory.ENTERTAINMENT]: "bg-purple-100 text-purple-700",
    [MarketCategory.TECHNOLOGY]: "bg-blue-100 text-blue-700",
    [MarketCategory.ECONOMICS]: "bg-yellow-100 text-yellow-700",
    [MarketCategory.SCIENCE]: "bg-teal-100 text-teal-700",
    [MarketCategory.WEATHER]: "bg-gray-100 text-gray-700",
    [MarketCategory.OTHER]: "bg-gray-100 text-gray-700",
  };

  return (
    <span
      className={`inline-block px-2 py-1 rounded-full text-xs font-medium ${categoryColors[category]}`}
    >
      {categoryNames[category]}
    </span>
  );
};

// Invalidation badge component
const InvalidatedBadge = () => {
  return (
    <span className="inline-block px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-700 border border-red-200">
      Invalidated
    </span>
  );
};

// Free market badge component
const FreeMarketBadge = () => {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gradient-to-r from-green-100 to-emerald-100 text-green-700 border border-green-200 shadow-sm">
      <Gift className="h-3 w-3" />
      Free
    </span>
  );
};

// Event-based market badge component
const EventBasedBadge = () => {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-gradient-to-r from-orange-100 to-amber-100 text-orange-700 border border-orange-200 shadow-sm">
      <svg className="h-3 w-3" fill="currentColor" viewBox="0 0 20 20">
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
          clipRule="evenodd"
        />
      </svg>
      Event-Based
    </span>
  );
};

interface MarketV2CardProps {
  index: number;
  market: MarketV2;
}

export function MarketV2Card({ index, market }: MarketV2CardProps) {
  const { address } = useAccount();
  const [commentCount, setCommentCount] = useState<number>(0);
  const [options, setOptions] = useState<MarketOption[]>([]);
  const [totalVolume, setTotalVolume] = useState<bigint>(0n);
  // Derived displayOptions: prefer detailed `options` (from /api) but fall back
  // to a lightweight representation built from the passed-in `market` so the
  // progress UI and other consumers can render immediately.
  const displayOptions: MarketOption[] = (() => {
    if (options && options.length > 0) return options;
    const count =
      Number(market.optionCount ?? market.options?.length ?? 0) || 0;
    if (count <= 0) return [];
    return Array.from({ length: count }).map((_, i) => {
      const raw = market.options ? market.options[i] : undefined;
      const name =
        typeof raw === "string"
          ? raw
          : raw && typeof raw === "object"
          ? String((raw as any).name ?? `Option ${i + 1}`)
          : `Option ${i + 1}`;
      const description =
        raw && typeof raw === "object"
          ? String((raw as any).description ?? "")
          : "";
      // MarketV2 type may not include on-chain optionShares in this shape.
      // Use a safe access via `any` so TS doesn't error and fall back to 0n.
      const maybeOptionShares = (market as any)?.optionShares;
      const totalShares =
        maybeOptionShares && typeof maybeOptionShares[i] !== "undefined"
          ? BigInt(maybeOptionShares[i])
          : 0n;
      return {
        name,
        description,
        totalShares,
        totalVolume: 0n,
        currentPrice: 0n,
        isActive: !market.resolved,
      } as MarketOption;
    });
  })();

  // Fetch full market info (legacy multi-field tuple)
  const { data: marketInfo } = useReadContract({
    address: PolicastViews,
    abi: PolicastViewsAbi,
    functionName: "getMarketInfo",
    args: [BigInt(index)],
  });

  // Fetch explicit market type (more reliable than positional index)
  const { data: marketTypeData } = useReadContract({
    address: PolicastViews,
    abi: PolicastViewsAbi,
    functionName: "getMarketType",
    args: [BigInt(index)],
  });

  // Normalized marketType (0 = paid, 1 = free) with fallback to positional index if explicit read missing
  const derivedMarketType: number | undefined = (() => {
    if (typeof marketTypeData === "number") return marketTypeData;
    if (marketTypeData && typeof marketTypeData === "bigint")
      return Number(marketTypeData);
    if (
      marketInfo &&
      Array.isArray(marketInfo) &&
      marketInfo.length > 7 &&
      typeof marketInfo[7] === "number" &&
      (marketInfo[7] === 0 || marketInfo[7] === 1)
    ) {
      // Legacy fallback path
      return marketInfo[7] as number;
    }
    return undefined;
  })();

  useEffect(() => {
    if (derivedMarketType !== undefined) {
      console.debug(
        `[MarketV2Card] market ${index} marketType detected: ${derivedMarketType}`
      );
    } else {
      console.debug(
        `[MarketV2Card] market ${index} marketType unresolved yet (waiting for contract reads)`
      );
    }
  }, [derivedMarketType, index]);

  // Fetch user shares for this market
  const { data: userShares } = (useReadContract as any)({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getUserShares",
    args: [BigInt(index), address as `0x${string}`],
    query: { enabled: !!address },
  });

  // Fetch options data with real-time prices
  useEffect(() => {
    const fetchOptions = async () => {
      if (!marketInfo) return;

      const optionCount = Number(marketInfo[4]); // optionCount from getMarketInfo
      const optionsData: MarketOption[] = [];
      let totalVol = 0n;

      for (let i = 0; i < optionCount; i++) {
        try {
          // Get both static option data and real-time calculated price
          const [optionResponse, priceData] = await Promise.all([
            fetch(`/api/market-option?marketId=${index}&optionId=${i}`),
            (publicClient.readContract as any)({
              address: V2contractAddress,
              abi: V2contractAbi,
              functionName: "calculateCurrentPrice",
              args: [BigInt(index), BigInt(i)],
            }).catch(() => null), // Fallback if calculateCurrentPrice fails
          ]);

          if (optionResponse.ok) {
            const option = await optionResponse.json();
            let realTimePrice: bigint;
            if (priceData !== null && priceData !== undefined) {
              realTimePrice =
                typeof priceData === "bigint"
                  ? priceData
                  : BigInt(priceData as string);
            } else {
              realTimePrice = BigInt(option.currentPrice);
            }

            optionsData.push({
              name: option.name,
              description: option.description,
              totalShares: BigInt(option.totalShares),
              totalVolume: BigInt(option.totalVolume),
              currentPrice: realTimePrice, // Use real-time calculated price
              isActive: option.isActive,
            });
            totalVol += BigInt(option.totalVolume);
          }
        } catch (error) {
          console.error(`Error fetching option ${i}:`, error);
        }
      }

      setOptions(optionsData);
      setTotalVolume(totalVol);
    };

    fetchOptions();
  }, [index, marketInfo]);

  // Fetch comment count
  useEffect(() => {
    const fetchCommentCount = async () => {
      try {
        const response = await fetch(
          `/api/comments?marketId=${index}&version=v2`
        );
        if (response.ok) {
          const data = await response.json();
          setCommentCount(data.total || 0);
        }
      } catch (error) {
        console.error("Error fetching comment count:", error);
      }
    };

    fetchCommentCount();
  }, [index]);

  // Detect mobile viewport (used to conditionally hide the event-based badge
  // when category + free + event badges would otherwise all appear).
  const [isMobile, setIsMobile] = useState<boolean>(false);

  useEffect(() => {
    // Use a breakpoint of 767px (matches max-width: 767px -> mobile)
    const mq = window.matchMedia("(max-width: 767px)");
    const handle = (e: MediaQueryListEvent | MediaQueryList) =>
      setIsMobile(e.matches);
    // Initialize
    setIsMobile(mq.matches);
    // Add listener (support both modern and legacy APIs)
    if ((mq as any).addEventListener) {
      (mq as any).addEventListener("change", handle);
    } else {
      mq.addListener(handle);
    }
    return () => {
      if ((mq as any).removeEventListener) {
        (mq as any).removeEventListener("change", handle);
      } else {
        mq.removeListener(handle);
      }
    };
  }, []);

  // Determine market status
  const isExpired = new Date(Number(market.endTime) * 1000) < new Date();
  const isResolved = market.resolved;
  const isInvalidated = market.invalidated;

  // Badge visibility helpers
  const hasCategoryBadge =
    typeof market.category !== "undefined" && market.category !== null;
  // When on mobile and all three badges (category, free, event) would appear,
  // prefer showing only category + type (hide event badge).
  const showEventBadge =
    market.earlyResolutionAllowed &&
    !(isMobile && hasCategoryBadge && derivedMarketType === 1);

  // If market is invalidated, show special message instead of normal UI
  if (isInvalidated) {
    return (
      <Card key={index} className="flex flex-col border-red-200 bg-red-50">
        <CardHeader>
          <div className="flex items-center justify-between mb-2">
            <MarketTime
              endTime={market.endTime}
              earlyResolutionAllowed={market.earlyResolutionAllowed}
            />
            <div className="flex items-center gap-2">
              <CategoryBadge category={market.category} />
              <InvalidatedBadge />
              {/* Show free market badge if marketType === 1 */}
              {derivedMarketType === 1 && <FreeMarketBadge />}
              {/* Show event-based badge if early resolution is allowed (respect mobile cond) */}
              {showEventBadge && <EventBasedBadge />}
            </div>
          </div>
          <CardTitle className="text-base leading-relaxed">
            <LinkifiedText text={market.question} />
          </CardTitle>
          {market.description && (
            <p className="text-sm text-gray-600 mt-1">
              <LinkifiedText text={market.description} />
            </p>
          )}

          {/* Free Market Claim Status */}
          <FreeMarketClaimStatus
            marketId={index}
            className="mt-3"
            marketType={derivedMarketType}
          />
        </CardHeader>
        <CardContent className="pb-4">
          <div className="text-center py-4">
            <div className="inline-flex items-center justify-center w-12 h-12 bg-red-100 rounded-full mb-3">
              <svg
                className="w-6 h-6 text-red-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.728-.833-2.498 0L4.316 15.5c-.77.833.192 2.5 1.732 2.5z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-red-800 mb-2">
              Market Invalidated
            </h3>
            <p className="text-sm text-red-700">
              This market has been invalidated due to issues with the question
              or resolution criteria. All participants have been automatically
              refunded.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Share handling
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL || "https://buster-mkt.vercel.app";
  const marketPageUrl = `${appUrl}/market/${index}/details`;

  const handleShare = async () => {
    try {
      await sdk.actions.composeCast({
        text: `Check out this market on Policast: ${market.question}`,
        embeds: [marketPageUrl],
      });
    } catch (error) {
      console.error("Failed to compose cast:", error);
    }
  };

  // Check if user has shares
  const typedUserShares = (userShares as unknown as readonly bigint[]) || [];
  const hasShares =
    typedUserShares && typedUserShares.some((shares) => shares > 0n);

  return (
    <Card key={index} className="flex flex-col">
      <CardHeader>
        <div className="flex items-center justify-between mb-2">
          <MarketTime
            endTime={market.endTime}
            earlyResolutionAllowed={market.earlyResolutionAllowed}
          />
          <div className="flex items-center gap-2">
            <CategoryBadge category={market.category} />
            {isInvalidated && <InvalidatedBadge />}
            {/* Show free market badge if marketType === 1 */}
            {derivedMarketType === 1 && <FreeMarketBadge />}
            {/* Show event-based badge if early resolution is allowed (respect mobile cond) */}
            {showEventBadge && <EventBasedBadge />}
          </div>
        </div>
        <CardTitle className="text-base leading-relaxed">
          <LinkifiedText text={market.question} />
        </CardTitle>
        {market.description && (
          <p className="text-sm text-gray-600 mt-1">
            <LinkifiedText text={market.description} />
          </p>
        )}

        {/* Free Market Claim Status */}
        <FreeMarketClaimStatus
          marketId={index}
          className="mt-3"
          marketType={derivedMarketType}
        />
      </CardHeader>

      <CardContent className="pb-0">
        {/* Free token claim button (full CTA) shown only for active, non-expired free markets */}
        {derivedMarketType === 1 &&
          !isResolved &&
          !isInvalidated &&
          !isExpired && (
            <div className="mb-4">
              <FreeTokenClaimButton
                marketId={index}
                marketTypeOverride={derivedMarketType}
                showWhenDisconnected={true}
              />
            </div>
          )}
        {displayOptions.length > 0 && (
          <MultiOptionProgress
            marketId={index}
            options={displayOptions}
            totalVolume={totalVolume}
            className="mb-4"
          />
        )}

        {isExpired ? (
          isResolved ? (
            <MarketResolved
              marketId={index}
              outcome={
                typeof market.winningOptionId !== "undefined"
                  ? Number(market.winningOptionId) + 1
                  : 0
              }
              optionA={displayOptions[0]?.name || "Option 1"}
              optionB={displayOptions[1]?.name || "Option 2"}
            />
          ) : (
            <MarketPending />
          )
        ) : (
          <MarketV2BuyInterface marketId={index} market={market} />
        )}
      </CardContent>

      <CardFooter className="flex justify-between items-center pt-4">
        <div className="flex items-center gap-2">
          {hasShares ? (
            <>
              <MarketV2SharesDisplay
                market={market}
                userShares={userShares || []}
                options={displayOptions}
              />
              <Link href={`/market/${index}/details`}>
                <Button variant="outline" size="sm" className="text-xs">
                  Manage Position
                </Button>
              </Link>
            </>
          ) : (
            <div />
          )}
        </div>

        <div className="flex items-center space-x-2">
          {/* Comment count indicator */}
          {commentCount > 0 && (
            <div className="flex items-center text-gray-500 text-xs mr-2">
              <MessageCircle className="w-3 h-3 mr-1" />
              <span>{commentCount}</span>
            </div>
          )}

          {/* Share button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handleShare}
            className="p-1 h-8 w-8"
            title="Share market"
          >
            <FontAwesomeIcon
              icon={faShareFromSquare}
              className="h-3 w-3 text-gray-500"
            />
          </Button>

          {/* Details link */}
          <Link href={`/market/${index}/details`} passHref>
            <Button
              variant="ghost"
              size="sm"
              className="p-1 h-8 w-8"
              title="View details"
            >
              <FontAwesomeIcon
                icon={faUpRightAndDownLeftFromCenter}
                className="h-3 w-3 text-gray-500"
              />
            </Button>
          </Link>
        </div>
      </CardFooter>
    </Card>
  );
}
