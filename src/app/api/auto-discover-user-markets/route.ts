import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import {
  V2contractAddress,
  V2contractAbi,
  PolicastViews,
  PolicastViewsAbi,
} from "@/constants/contract";

const alchemyRpc = process.env.NEXT_PUBLIC_ALCHEMY_RPC_URL;
if (!alchemyRpc && process.env.NODE_ENV === "production") {
  throw new Error(
    "Missing NEXT_PUBLIC_ALCHEMY_RPC_URL (required in production). Please set it in your environment."
  );
}

const publicClient = createPublicClient({
  chain: base,
  transport: http(alchemyRpc || "https://mainnet.base.org"),
});

// Typed wrappers to reduce any-casts
async function readCore<TReturn>(
  functionName: string,
  args: readonly any[] = []
): Promise<TReturn> {
  return (await publicClient.readContract({
    address: V2contractAddress,
    abi: V2contractAbi as any,
    functionName: functionName as any,
    args: args as any,
  })) as unknown as TReturn;
}

async function readView<TReturn>(
  functionName: string,
  args: readonly any[] = []
): Promise<TReturn> {
  return (await publicClient.readContract({
    address: PolicastViews,
    abi: PolicastViewsAbi as any,
    functionName: functionName as any,
    args: args as any,
  })) as unknown as TReturn;
}

interface UserWinnings {
  marketId: number;
  amount: bigint;
  hasWinnings: boolean;
  hasClaimed: boolean; // Track if user already claimed
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userAddress } = body;

    if (!userAddress || typeof userAddress !== "string") {
      return NextResponse.json(
        { error: "User address is required" },
        { status: 400 }
      );
    }

    console.log("Auto-discovering markets for user:", userAddress);

    // Step 1: Discover markets where user participated
    const participatedMarkets = await discoverUserMarkets(userAddress);

    console.log(
      `Found ${participatedMarkets.length} markets user participated in:`,
      participatedMarkets
    );

    // Step 2: Check winnings eligibility AND claim status for each market
    const winningsData: UserWinnings[] = [];

    // Process sequentially to avoid RPC rate limits (markets count is usually small)
    for (const marketId of participatedMarkets) {
      try {
        // First, check if user has already claimed from this market
        const claimStatus = (await readCore<[boolean, boolean]>(
          "getUserClaimStatus",
          [BigInt(marketId), userAddress as `0x${string}`]
        )) as [boolean, boolean];
        const hasClaimed = claimStatus[0]; // claimedWinnings is first return value

        // Prefer Views.getUserWinnings(address,uint256)
        const abiHasFn =
          Array.isArray(PolicastViewsAbi) &&
          PolicastViewsAbi.some(
            (f: any) => f.type === "function" && f.name === "getUserWinnings"
          );

        if (!abiHasFn) {
          // Fallback: try core contract if view missing (older deployments)
          try {
            const result = (await readCore<readonly any[]>("getUserWinnings", [
              BigInt(marketId),
              userAddress as `0x${string}`,
            ])) as unknown;
            const r = result as readonly any[];
            const hasWinnings = Boolean(r[0]);
            const amount = BigInt(r[1] ?? 0n);
            if (hasWinnings && amount > 0n) {
              winningsData.push({
                marketId,
                amount,
                hasWinnings: true,
                hasClaimed,
              });
            }
            continue;
          } catch (err) {
            console.debug(
              `Fallback core.getUserWinnings failed for market ${marketId}:`,
              err
            );
          }
        }

        // Call Views.getUserWinnings(address,uint256)
        const raw = (await readView<unknown>("getUserWinnings", [
          userAddress as `0x${string}`,
          BigInt(marketId),
        ])) as unknown;

        // Normalize raw to BigInt safely
        let amount = 0n;
        if (typeof raw === "bigint") {
          amount = raw;
        } else if (typeof raw === "number") {
          amount = BigInt(Math.trunc(raw));
        } else if (typeof raw === "string") {
          try {
            amount = BigInt(raw);
          } catch {
            amount = 0n;
          }
        } else if (raw && typeof (raw as any).toString === "function") {
          const s = (raw as any).toString();
          if (/^\d+$/.test(s)) {
            try {
              amount = BigInt(s);
            } catch {
              amount = 0n;
            }
          }
        }

        if (amount > 0n) {
          winningsData.push({
            marketId,
            amount,
            hasWinnings: true,
            hasClaimed,
          });
        }
      } catch (error) {
        console.error(`Error checking winnings for market ${marketId}:`, error);
        // continue with other markets
      }

      // small delay to reduce bursty RPC calls
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    console.log(
      `Found ${winningsData.length} markets with winnings (claimed + unclaimed)`
    );

    // Separate claimed vs unclaimed for logging
    const unclaimedCount = winningsData.filter((w) => !w.hasClaimed).length;
    const claimedCount = winningsData.filter((w) => w.hasClaimed).length;
    console.log(
      `  - ${unclaimedCount} unclaimed, ${claimedCount} already claimed`
    );

    // Serialize BigInt amounts to strings for JSON
    const winningsDataSerialized = winningsData.map((w) => ({
      marketId: w.marketId,
      amount: w.amount.toString(),
      hasWinnings: w.hasWinnings,
      hasClaimed: w.hasClaimed,
    }));

    return NextResponse.json({
      participatedMarkets,
      winningsData: winningsDataSerialized,
      totalMarkets: participatedMarkets.length,
      claimableMarkets: winningsDataSerialized.filter((w) => !w.hasClaimed)
        .length,
      claimedMarkets: winningsDataSerialized.filter((w) => w.hasClaimed).length,
    });
  } catch (error) {
    console.error("Auto-discover user markets error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to auto-discover user markets: ${errorMessage}` },
      { status: 500 }
    );
  }
}

// Discover all markets where user participated
async function discoverUserMarkets(userAddress: string): Promise<number[]> {
  const participatedMarkets: Set<number> = new Set();

  // Method 1: Prefer Views.getUserMarkets(user) if available (efficient)
  try {
    const abiHasFn =
      Array.isArray(PolicastViewsAbi) &&
      PolicastViewsAbi.some(
        (f: any) => f.type === "function" && f.name === "getUserMarkets"
      );

    if (abiHasFn) {
      console.log("Using PolicastViews.getUserMarkets");
      const markets = (await readView<bigint[]>("getUserMarkets", [
        userAddress as `0x${string}`,
      ])) as unknown;
      if (Array.isArray(markets) && markets.length > 0) {
        markets.forEach((m) => {
          try {
            participatedMarkets.add(Number(m));
          } catch {
            // ignore
          }
        });
        console.log(
          `Extracted ${participatedMarkets.size} unique markets from getUserMarkets`
        );
        return Array.from(participatedMarkets).sort((a, b) => a - b);
      }
    } else {
      console.log("PolicastViews.getUserMarkets not available, falling back");
    }
  } catch (error) {
    console.warn("Method 1 (getUserMarkets) failed, falling back:", error);
  }

  // Method 2: Try reading userTradeHistory on core contract if exists
  try {
    console.log("Trying Method 2: core.userTradeHistory");
    const trades = await readUserTradeHistory(userAddress);
    if (trades && trades.length > 0) {
      trades.forEach((trade: any) => {
        if (trade && typeof trade.marketId !== "undefined") {
          participatedMarkets.add(Number(trade.marketId));
        }
      });
      console.log(
        `Extracted ${participatedMarkets.size} unique markets from trade history`
      );
      return Array.from(participatedMarkets).sort((a, b) => a - b);
    }
  } catch (error) {
    console.warn("Method 2 failed, falling back to Method 3:", error);
  }

  // Method 3: Batch check markets using Views.getUserShares
  console.log("Using Method 3: Batch market checking (getUserShares)");
  const batchSize = 5; // reduced to lower RPC pressure
  const maxMarketId = 200; // configurable upper bound

  const batches: Array<Promise<number[]>> = [];
  for (let startId = 0; startId < maxMarketId; startId += batchSize) {
    const endId = Math.min(startId + batchSize, maxMarketId);
    batches.push(checkMarketBatch(userAddress, startId, endId));
    // small delay between dispatching batches
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  // Process batches sequentially to reduce chance of 429s
  for (const p of batches) {
    try {
      const batchMarkets = await p;
      batchMarkets.forEach((m) => participatedMarkets.add(m));
    } catch (error) {
      console.error("Batch check failed:", error);
    }
    // delay between batches
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  console.log(`Found ${participatedMarkets.size} markets via batch checking`);
  return Array.from(participatedMarkets).sort((a, b) => a - b);
}

// Try to read user's trade history directly from core contract (if available)
async function readUserTradeHistory(userAddress: string): Promise<any[]> {
  try {
    // Some deployments don't expose userTradeHistory; guard the call
    const abiHasFn =
      Array.isArray(V2contractAbi) &&
      V2contractAbi.some(
        (f: any) => f.type === "function" && f.name === "userTradeHistory"
      );

    if (!abiHasFn) {
      console.log("Core contract does not expose userTradeHistory");
      return [];
    }

    const trades: any[] = [];
    let index = 0;
    const maxAttempts = 100; // Prevent infinite loops

    while (index < maxAttempts) {
      try {
        const trade = (await readCore<unknown>("userTradeHistory", [
          userAddress as `0x${string}`,
          BigInt(index),
        ])) as unknown;

        if (trade) {
          trades.push(trade);
          index++;
        } else {
          break;
        }
      } catch (error) {
        console.log(`Reached end of trade history at index ${index}`);
        break;
      }
    }

    console.log(
      `Successfully read ${trades.length} trades from userTradeHistory`
    );
    return trades;
  } catch (error) {
    console.error("Failed to read user trade history:", error);
    return [];
  }
}

// Check a batch of markets for user participation using Views.getUserShares
async function checkMarketBatch(
  userAddress: string,
  startId: number,
  endId: number
): Promise<number[]> {
  const participatedMarkets: number[] = [];

  for (let marketId = startId; marketId < endId; marketId++) {
    try {
      // Use Views.getUserShares(marketId, user)
      const sharesRaw = (await readView<readonly bigint[]>("getUserShares", [
        BigInt(marketId),
        userAddress as `0x${string}`,
      ])) as unknown;

      if (!sharesRaw) {
        continue;
      }

      const sharesArr =
        Array.isArray(sharesRaw) && (sharesRaw as readonly any[]).length > 0
          ? (sharesRaw as readonly any[]).map((s) => {
              try {
                return BigInt(s ?? 0n);
              } catch {
                return 0n;
              }
            })
          : [];

      const hasParticipation = sharesArr.some((share) => share > 0n);

      if (hasParticipation) {
        participatedMarkets.push(marketId);
      }
    } catch (error) {
      // market might not exist or call failed; continue
      console.debug(`Market ${marketId} check failed:`, error);
    }

    // slight delay per market to avoid bursts
    await new Promise((resolve) => setTimeout(resolve, 15));
  }

  return participatedMarkets;
}
