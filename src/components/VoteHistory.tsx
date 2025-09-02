"use client";

import { useState, useEffect, useCallback } from "react";
import { useAccount, useReadContract } from "wagmi";
import { type Address } from "viem";
import { useToast } from "@/components/ui/use-toast";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { ArrowUpDown } from "lucide-react";
import {
  publicClient,
  contractAddress,
  contractAbi,
  V2contractAddress,
  V2contractAbi,
  tokenAddress as defaultTokenAddress,
  tokenAbi as defaultTokenAbi,
} from "@/constants/contract";

const CACHE_KEY = "vote_history_cache_v6"; // Updated for V2 support
const CACHE_TTL = 60 * 60; // 1 hour in seconds
const PAGE_SIZE = 50; // Votes per contract call

// V1 Vote interface (legacy)
interface Vote {
  marketId: number;
  isOptionA: boolean;
  amount: bigint;
  timestamp: bigint;
}

// V2 Trade interface
interface V2Trade {
  marketId: bigint;
  optionId: bigint;
  buyer: Address;
  seller: Address;
  price: bigint;
  quantity: bigint;
  timestamp: bigint;
}

// Unified transaction interface
type TransactionType = "vote" | "buy" | "sell" | "swap";

interface DisplayVote {
  marketId: number;
  option: string;
  amount: bigint;
  marketName: string;
  timestamp: bigint;
  type: TransactionType;
  version: "v1" | "v2";
}

// Enhanced market info for V1/V2 compatibility
interface MarketInfo {
  marketId: number;
  question: string;
  optionA?: string; // V1
  optionB?: string; // V1
  options?: string[]; // V2
  version: "v1" | "v2";
}

interface CacheData {
  votes: DisplayVote[];
  marketInfo: Record<number, MarketInfo>;
  timestamp: number;
}

type SortKey = "marketId" | "marketName" | "option" | "amount" | "timestamp";
type SortDirection = "asc" | "desc";

export function VoteHistory() {
  const { address: accountAddress, isConnected } = useAccount();
  const { toast } = useToast();
  const [votes, setVotes] = useState<DisplayVote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tokenSymbol, setTokenSymbol] = useState<string>("buster");
  const [tokenDecimals, setTokenDecimals] = useState<number>(18);
  const [search, setSearch] = useState<string>("");
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  // Fetch betting token address
  const { data: bettingTokenAddr } = useReadContract({
    address: contractAddress,
    abi: contractAbi,
    functionName: "bettingToken",
  });

  const tokenAddress = (bettingTokenAddr as Address) || defaultTokenAddress;

  // Fetch token metadata
  const { data: symbolData } = useReadContract({
    address: tokenAddress,
    abi: defaultTokenAbi,
    functionName: "symbol",
    query: { enabled: !!tokenAddress },
  });

  const { data: decimalsData } = useReadContract({
    address: tokenAddress,
    abi: defaultTokenAbi,
    functionName: "decimals",
    query: { enabled: !!tokenAddress },
  });

  useEffect(() => {
    if (symbolData) setTokenSymbol(symbolData as string);
    if (decimalsData) setTokenDecimals(Number(decimalsData));
  }, [symbolData, decimalsData]);

  // Load cache
  const loadCache = useCallback((): CacheData => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      return cached
        ? JSON.parse(cached)
        : { votes: [], marketInfo: {}, timestamp: 0 };
    } catch {
      return { votes: [], marketInfo: {}, timestamp: 0 };
    }
  }, []);

  // Save cache
  const saveCache = useCallback((data: CacheData) => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error("Cache save error:", error);
    }
  }, []);

  // Fetch V1 votes
  const fetchV1Votes = async (address: Address): Promise<Vote[]> => {
    const voteCount = (await publicClient.readContract({
      address: contractAddress,
      abi: contractAbi,
      functionName: "getVoteHistoryCount",
      args: [address],
    })) as bigint;

    if (voteCount === 0n) return [];

    const allVotes: Vote[] = [];
    let start = 0;

    while (start < Number(voteCount)) {
      const voteBatch = (await publicClient.readContract({
        address: contractAddress,
        abi: contractAbi,
        functionName: "getVoteHistory",
        args: [address, BigInt(start), BigInt(PAGE_SIZE)],
      })) as unknown as Vote[];

      if (voteBatch.length === 0) break;
      allVotes.push(...voteBatch);
      start += PAGE_SIZE;
    }

    return allVotes;
  };

  // Fetch V2 trades
  const fetchV2Trades = async (address: Address): Promise<V2Trade[]> => {
    try {
      // Get user portfolio to find trade count
      const portfolio = (await publicClient.readContract({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "getUserPortfolio",
        args: [address],
      })) as {
        totalInvested: bigint;
        totalWinnings: bigint;
        unrealizedPnL: bigint;
        realizedPnL: bigint;
        tradeCount: bigint;
      };

      const tradeCount = Number(portfolio.tradeCount);

      if (tradeCount === 0) return [];

      // Fetch all trades by iterating through indices
      const trades: V2Trade[] = [];
      for (let i = 0; i < tradeCount; i++) {
        try {
          const trade = (await publicClient.readContract({
            address: V2contractAddress,
            abi: V2contractAbi,
            functionName: "userTradeHistory",
            args: [address, BigInt(i)],
          })) as [bigint, bigint, string, string, bigint, bigint, bigint];

          trades.push({
            marketId: trade[0],
            optionId: trade[1],
            buyer: trade[2] as Address,
            seller: trade[3] as Address,
            price: trade[4],
            quantity: trade[5],
            timestamp: trade[6],
          });
        } catch (error) {
          console.error(`Failed to fetch trade ${i}:`, error);
        }
      }

      return trades;
    } catch (error) {
      console.error("V2 trade history error:", error);
      return [];
    }
  };

  // Fetch market info for V1 and V2
  const fetchMarketInfo = async (
    v1MarketIds: number[],
    v2MarketIds: number[],
    cache: any
  ) => {
    const marketInfoCache = { ...cache.marketInfo };

    // V1 markets
    const uncachedV1Ids = v1MarketIds.filter(
      (id) => !marketInfoCache[`v1_${id}`]
    );
    if (uncachedV1Ids.length > 0) {
      const marketInfos = (await publicClient.readContract({
        address: contractAddress,
        abi: contractAbi,
        functionName: "getMarketInfoBatch",
        args: [uncachedV1Ids.map(BigInt)],
      })) as [
        string[],
        string[],
        string[],
        bigint[],
        number[],
        bigint[],
        bigint[],
        boolean[]
      ];

      const [questions, optionAs, optionBs] = marketInfos;
      uncachedV1Ids.forEach((id, i) => {
        marketInfoCache[`v1_${id}`] = {
          marketId: id,
          question: questions[i],
          optionA: optionAs[i],
          optionB: optionBs[i],
          version: "v1" as const,
        };
      });
    }

    // V2 markets
    const uncachedV2Ids = v2MarketIds.filter(
      (id) => !marketInfoCache[`v2_${id}`]
    );
    if (uncachedV2Ids.length > 0) {
      for (const marketId of uncachedV2Ids) {
        try {
          const marketInfo = (await publicClient.readContract({
            address: V2contractAddress,
            abi: V2contractAbi,
            functionName: "getMarketInfo",
            args: [BigInt(marketId)],
          })) as unknown as [
            string,
            string,
            bigint,
            number,
            bigint,
            boolean,
            boolean,
            number,
            boolean,
            bigint,
            string
          ];

          const [question] = marketInfo;

          // We need to get the options separately since getMarketInfo doesn't return them
          // Let's get the option count first, then fetch each option
          const optionCount = Number(marketInfo[4]); // optionCount is the 5th element
          const options: string[] = [];

          for (let optionId = 0; optionId < optionCount; optionId++) {
            try {
              const optionInfo = (await publicClient.readContract({
                address: V2contractAddress,
                abi: V2contractAbi,
                functionName: "getMarketOption",
                args: [BigInt(marketId), BigInt(optionId)],
              })) as [string, string, bigint, bigint, bigint, boolean];

              options.push(optionInfo[0]); // option name
            } catch (error) {
              console.error(`Failed to fetch option ${optionId}:`, error);
              options.push(`Option ${optionId + 1}`); // fallback
            }
          }

          marketInfoCache[`v2_${marketId}`] = {
            marketId,
            question,
            options,
            version: "v2" as const,
          };
        } catch (error) {
          console.error(`Failed to fetch V2 market ${marketId}:`, error);
        }
      }
    }

    return marketInfoCache;
  };

  // Main fetch function
  const fetchVotes = useCallback(
    async (address: Address | undefined) => {
      if (!address) {
        setVotes([]);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const cache = loadCache();
        const now = Math.floor(Date.now() / 1000);

        // Use cache if fresh
        if (cache.votes.length > 0 && now - cache.timestamp < CACHE_TTL) {
          setVotes(cache.votes);
          setIsLoading(false);
          return;
        }

        // Fetch both V1 votes and V2 trades in parallel
        const [v1Votes, v2Trades] = await Promise.all([
          fetchV1Votes(address),
          fetchV2Trades(address),
        ]);

        // Extract market IDs
        const v1MarketIds = [
          ...new Set(v1Votes.map((v) => Number(v.marketId))),
        ];
        const v2MarketIds = [
          ...new Set(v2Trades.map((t) => Number(t.marketId))),
        ];

        // Fetch market info
        const marketInfoCache = await fetchMarketInfo(
          v1MarketIds,
          v2MarketIds,
          cache
        );

        // Convert V1 votes to display format
        const displayV1Votes: DisplayVote[] = v1Votes.map((vote) => {
          const marketInfo = marketInfoCache[`v1_${Number(vote.marketId)}`];
          return {
            marketId: Number(vote.marketId),
            option: vote.isOptionA ? marketInfo.optionA : marketInfo.optionB,
            amount: vote.amount,
            marketName: marketInfo.question,
            timestamp: vote.timestamp,
            type: "vote" as const,
            version: "v1" as const,
          };
        });

        // Convert V2 trades to display format
        const displayV2Trades: DisplayVote[] = v2Trades.map((trade) => {
          const marketInfo = marketInfoCache[`v2_${Number(trade.marketId)}`];
          const isBuy = trade.buyer.toLowerCase() === address.toLowerCase();
          return {
            marketId: Number(trade.marketId),
            option: marketInfo.options[Number(trade.optionId)],
            amount: trade.quantity, // Use quantity instead of amount
            marketName: marketInfo.question,
            timestamp: trade.timestamp,
            type: isBuy ? "buy" : "sell",
            version: "v2" as const,
          };
        });

        // Combine and sort by timestamp
        const allTransactions = [...displayV1Votes, ...displayV2Trades].sort(
          (a, b) => Number(b.timestamp - a.timestamp)
        );

        // Update cache
        const newCache = {
          votes: allTransactions,
          marketInfo: marketInfoCache,
          timestamp: now,
        };
        saveCache(newCache);
        setVotes(allTransactions);
      } catch (error) {
        console.error("Transaction history error:", error);
        toast({
          title: "Error",
          description: "Failed to load transaction history.",
          variant: "destructive",
        });
        setVotes([]);
      } finally {
        setIsLoading(false);
      }
    },
    [loadCache, saveCache, toast]
  );

  useEffect(() => {
    fetchVotes(accountAddress);
  }, [accountAddress, fetchVotes]);

  // Handle sorting
  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };

  // Sort and filter votes
  const filteredVotes = votes
    .filter(
      (vote) =>
        vote.marketName.toLowerCase().includes(search.toLowerCase()) ||
        vote.option.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      const multiplier = sortDirection === "asc" ? 1 : -1;
      switch (sortKey) {
        case "marketId":
          return (a.marketId - b.marketId) * multiplier;
        case "marketName":
          return a.marketName.localeCompare(b.marketName) * multiplier;
        case "option":
          return a.option.localeCompare(b.option) * multiplier;
        case "amount":
          return Number(a.amount - b.amount) * multiplier;
        case "timestamp":
          return Number(a.timestamp - b.timestamp) * multiplier;
        default:
          return 0;
      }
    });

  if (!isConnected || !accountAddress) {
    return (
      <div className="flex flex-col items-center justify-center p-6 bg-gray-50 rounded-lg shadow-sm border border-gray-200">
        <div className="text-gray-500 font-medium">
          Your market history will appear here
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm">
        <div className="bg-gray-50 p-3 border-b border-gray-200">
          <div className="h-6 bg-gray-200 rounded w-1/3 animate-pulse"></div>
        </div>
        <div className="divide-y divide-gray-200">
          {[1, 2, 3].map((i) => (
            <div key={i} className="p-4 animate-pulse">
              <div className="flex justify-between">
                <div className="h-5 bg-gray-200 rounded w-2/3"></div>
                <div className="h-5 bg-gray-200 rounded w-1/5"></div>
              </div>
              <div className="mt-2 h-4 bg-gray-100 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search and Sort Controls */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
          <Input
            placeholder="Search by market or option..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-sm"
            aria-label="Search vote history"
          />
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => handleSort("timestamp")}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              Date <ArrowUpDown className="h-3 w-3" />
            </button>
            <button
              onClick={() => handleSort("amount")}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-md bg-gray-100 hover:bg-gray-200 transition-colors"
            >
              Amount <ArrowUpDown className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {filteredVotes.length > 0 ? (
        <div className="space-y-3">
          {filteredVotes.map((vote, idx) => (
            <div
              key={idx}
              className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 hover:shadow-md transition-all duration-200 hover:border-blue-200"
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Link
                      href={`/market/${vote.marketId}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-1 rounded-md"
                    >
                      #{vote.marketId}
                    </Link>
                    <span
                      className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                        vote.type === "vote"
                          ? "bg-green-100 text-green-800 border border-green-200"
                          : vote.type === "buy"
                          ? "bg-blue-100 text-blue-800 border border-blue-200"
                          : "bg-red-100 text-red-800 border border-red-200"
                      }`}
                    >
                      {vote.type === "vote"
                        ? "🗳️ Vote"
                        : vote.type === "buy"
                        ? "📈 Buy"
                        : "📉 Sell"}
                    </span>
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                        vote.version === "v1"
                          ? "bg-gray-100 text-gray-600"
                          : "bg-purple-100 text-purple-600"
                      }`}
                    >
                      {vote.version.toUpperCase()}
                    </span>
                    <span className="text-xs text-gray-500">
                      {new Date(
                        Number(vote.timestamp) * 1000
                      ).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  </div>

                  <Link
                    href={`/market/${vote.marketId}`}
                    className="block group"
                  >
                    <h3 className="text-sm font-medium text-gray-900 group-hover:text-blue-600 transition-colors mb-2 line-clamp-2">
                      {vote.marketName}
                    </h3>
                  </Link>

                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500">
                      {vote.type === "vote" ? "Voted for:" : "Option:"}
                    </span>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gradient-to-r from-blue-100 to-purple-100 text-blue-800 border border-blue-200">
                      {vote.option}
                    </span>
                  </div>
                </div>

                <div className="flex flex-col items-end gap-1">
                  <div className="text-sm font-semibold text-gray-900">
                    {(
                      Number(vote.amount) / Math.pow(10, tokenDecimals)
                    ).toLocaleString(undefined, {
                      maximumFractionDigits: 2,
                    })}{" "}
                    <span className="text-xs font-medium text-gray-600">
                      {tokenSymbol}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">
                    {new Date(Number(vote.timestamp) * 1000).toLocaleTimeString(
                      undefined,
                      {
                        hour: "2-digit",
                        minute: "2-digit",
                      }
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-gray-100 to-gray-200 rounded-full flex items-center justify-center">
              <svg
                className="w-8 h-8 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                xmlns="http://www.w3.org/2000/svg"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {search
                ? "No matching transactions found"
                : "No transactions yet"}
            </h3>
            <p className="text-sm text-gray-500 max-w-sm">
              {search
                ? "Try adjusting your search terms to find different transactions."
                : "Start making predictions and trades on markets to see your transaction history here."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
