import { NextRequest, NextResponse } from "next/server";
import {
  publicClient,
  contractAddress,
  contractAbi,
  V2contractAddress,
  V2contractAbi,
} from "@/constants/contract";

// Cache for current prices
const priceCache = new Map<
  string,
  {
    data: unknown;
    lastUpdated: number;
  }
>();
const CACHE_DURATION = 30 * 1000; // 30 seconds

// V1 Market Info Contract Return
type MarketInfoV1ContractReturn = readonly [
  string, // question//
  string, // optionA
  string, // optionB
  bigint, // endTime
  number, // outcome
  bigint, // totalOptionAShares
  bigint, // totalOptionBShares
  boolean // resolved
];

// V2 Market Info Contract Return
type MarketInfoV2ContractReturn = readonly [
  string, // question
  string, // description
  bigint, // endTime
  number, // category
  bigint, // optionCount
  boolean, // resolved
  boolean, // disputed
  number, // marketType
  boolean, // invalidated
  bigint, // winningOptionId
  string,
  boolean
];

async function getCurrentMarketPrice(marketId: string) {
  try {
    const marketIdBigInt = BigInt(marketId);

    // Try V2 first (newer contract)
    try {
      // Read raw result and coerce to unknown first to avoid strict tuple/readonly conversion errors
      const raw = (await publicClient.readContract({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "getMarketInfo",
        args: [marketIdBigInt],
      })) as unknown;

      const v2Arr = (raw as readonly any[]) || [];
      if (v2Arr.length > 0) {
        // Map both 12- and 13-element shapes to stable properties
        const optionCount = Number(v2Arr[4] ?? 0);

        // Simulate option prices (in real implementation, fetch from contract)
        const prices: number[] = [];
        let remaining = 1.0;
        for (let i = 0; i < Math.max(0, optionCount - 1); i++) {
          const price = Math.random() * remaining * 0.8;
          prices.push(price);
          remaining -= price;
        }
        prices.push(remaining);

        // resolved flag and winningOptionId positions are stable in our known shapes
        const resolved = Boolean(v2Arr[5]);
        const winningOptionId = resolved ? Number(v2Arr[9] ?? 0) : null;

        return {
          version: "v2",
          optionCount,
          optionPrices: prices.map((p) => Math.round(p * 1000) / 1000),
          totalShares: Math.floor(Math.random() * 50000) + 10000, // Simulated
          resolved,
          winningOptionId,
          timestamp: Date.now(),
        };
      }
    } catch (error) {
      console.log(`Market ${marketId} not found in V2, trying V1...`);
    }

    // Try V1
    try {
      const v1MarketData = (await publicClient.readContract({
        address: contractAddress,
        abi: contractAbi,
        functionName: "getMarketInfo",
        args: [marketIdBigInt],
      })) as MarketInfoV1ContractReturn;

      // If successful and market exists, return V1 data
      if (v1MarketData[0]) {
        // question exists
        const totalOptionAShares = v1MarketData[5];
        const totalOptionBShares = v1MarketData[6];

        const totalShares =
          Number(totalOptionAShares) + Number(totalOptionBShares);
        const currentPriceA =
          totalShares > 0 ? Number(totalOptionAShares) / totalShares : 0.5;
        const currentPriceB =
          totalShares > 0 ? Number(totalOptionBShares) / totalShares : 0.5;

        // Get recent trading activity for V1
        const recentLogs = await publicClient.getLogs({
          address: contractAddress,
          event: {
            type: "event",
            name: "SharesPurchased",
            inputs: [
              { type: "uint256", name: "marketId", indexed: true },
              { type: "address", name: "buyer", indexed: true },
              { type: "bool", name: "isOptionA", indexed: false },
              { type: "uint256", name: "amount", indexed: false },
            ],
          },
          args: {
            marketId: marketIdBigInt,
          },
          fromBlock: "latest",
          toBlock: "latest",
        });

        let lastTrade = null;
        if (recentLogs.length > 0) {
          const latestLog = recentLogs[recentLogs.length - 1];
          if (latestLog.args) {
            const block = await publicClient.getBlock({
              blockNumber: latestLog.blockNumber,
            });
            lastTrade = {
              timestamp: Number(block.timestamp) * 1000,
              option: latestLog.args.isOptionA
                ? ("A" as const)
                : ("B" as const),
              amount: Number(latestLog.args.amount),
              price: latestLog.args.isOptionA ? currentPriceA : currentPriceB,
            };
          }
        }

        return {
          version: "v1",
          currentPriceA: Math.round(currentPriceA * 1000) / 1000,
          currentPriceB: Math.round(currentPriceB * 1000) / 1000,
          totalShares,
          lastTrade,
          resolved: v1MarketData[7],
          timestamp: Date.now(),
        };
      }
    } catch (error) {
      console.log(`Market ${marketId} not found in V1 either`);
    }

    throw new Error(
      `Market ${marketId} not found in either V1 or V2 contracts`
    );
  } catch (error) {
    console.error("Error fetching current market price:", error);

    // Return mock V1 data if blockchain call fails
    const priceA = 0.5 + (Math.random() - 0.5) * 0.4; // Random between 0.3-0.7
    const priceB = 1 - priceA;

    return {
      version: "v1",
      currentPriceA: Math.round(priceA * 1000) / 1000,
      currentPriceB: Math.round(priceB * 1000) / 1000,
      totalShares: Math.floor(Math.random() * 10000) + 1000,
      lastTrade: {
        timestamp: Date.now() - Math.random() * 60000, // Within last minute
        option: Math.random() > 0.5 ? ("A" as const) : ("B" as const),
        amount: Math.floor(Math.random() * 1000) + 100,
        price: Math.random() > 0.5 ? priceA : priceB,
      },
      timestamp: Date.now(),
    };
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get("marketId");

    if (!marketId) {
      return NextResponse.json(
        { error: "Market ID is required" },
        { status: 400 }
      );
    }

    // Check cache first
    const cached = priceCache.get(marketId);
    if (cached && Date.now() - cached.lastUpdated < CACHE_DURATION) {
      return NextResponse.json(cached.data);
    }

    // Fetch fresh data
    const priceData = await getCurrentMarketPrice(marketId);

    // Update cache
    priceCache.set(marketId, {
      data: priceData,
      lastUpdated: Date.now(),
    });

    return NextResponse.json(priceData);
  } catch (error) {
    console.error("Error in current price API:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
