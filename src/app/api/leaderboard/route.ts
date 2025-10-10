import { NextResponse } from "next/server";
import { NeynarAPIClient } from "@neynar/nodejs-sdk";
import NodeCache from "node-cache";
import {
  publicClient,
  contractAddress,
  contractAbi,
  tokenAddress as defaultTokenAddress,
  tokenAbi as defaultTokenAbi,
  V2contractAddress,
  V2contractAbi,
} from "@/constants/contract";
import { Address } from "viem";

const cache = new NodeCache({ stdTTL: 3600, checkperiod: 120 }); // 1-hour TTL
const CACHE_KEY = "leaderboard_v8"; // Updated version
const NEYNAR_CACHE_KEY = "neynar_users_v8";
const PAGE_SIZE = 100; // Users per V1 contract call
const V2_BATCH_SIZE = 50; // Addresses per V2 multicall batch

interface NeynarRawUser {
  username: string;
  fid: number;
  pfp_url?: string;
}

interface NeynarUser {
  username: string;
  fid: string;
  pfp_url: string | null;
}

interface LeaderboardEntry {
  username: string;
  fid: string;
  pfp_url: string | null;
  winnings: number;
  voteCount: number;
  address: string;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  retries = 3,
  baseDelay = 2000
): Promise<T> {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      if (i === retries - 1) throw error;
      let delay = baseDelay * Math.pow(2, i);
      if (error?.status === 429) {
        delay = Math.max(delay, 10000);
        console.warn(`Rate limit hit, waiting ${delay}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Max retries reached");
}

async function batchFetchNeynarUsers(
  neynar: NeynarAPIClient,
  addresses: string[],
  batchSize = 25
): Promise<Record<string, NeynarUser[]>> {
  const result: Record<string, NeynarUser[]> = {};
  for (let i = 0; i < addresses.length; i += batchSize) {
    const batch = addresses.slice(i, i + batchSize);
    try {
      const usersMap = await withRetry(() =>
        neynar.fetchBulkUsersByEthOrSolAddress({
          addresses: batch,
          addressTypes: ["custody_address", "verified_address"],
        })
      );
      for (const [address, users] of Object.entries(usersMap)) {
        result[address.toLowerCase()] = users.map((user: NeynarRawUser) => ({
          username: user.username,
          fid: user.fid.toString(),
          pfp_url: user.pfp_url || null,
        }));
      }
    } catch (error) {
      console.error(
        `Failed to fetch Neynar batch ${i / batchSize + 1}:`,
        error
      );
    }
  }
  return result;
}

export async function GET() {
  const cachedLeaderboard = cache.get<LeaderboardEntry[]>(CACHE_KEY);
  if (cachedLeaderboard) {
    console.log("✅ Serving from cache");
    const safeLeaderboard = JSON.parse(
      JSON.stringify(cachedLeaderboard, (key, value) =>
        typeof value === "bigint" ? Number(value) : value
      )
    );
    return NextResponse.json(safeLeaderboard);
  }

  try {
    console.log("🚀 Starting leaderboard fetch...");

    const neynarApiKey = process.env.NEYNAR_API_KEY;
    if (!neynarApiKey) {
      console.error("❌ NEYNAR_API_KEY is not set");
      return NextResponse.json(
        { error: "Server configuration error: Missing NEYNAR_API_KEY" },
        { status: 500 }
      );
    }

    const neynar = new NeynarAPIClient({ apiKey: neynarApiKey });
    console.log("✅ Neynar client initialized.");

    const [tokenDecimals] = await withRetry(() =>
      publicClient.multicall({
        contracts: [
          {
            address: defaultTokenAddress,
            abi: defaultTokenAbi,
            functionName: "decimals",
          },
        ],
      })
    ).then((results) => [Number(results[0].result)]);
    console.log(`💸 Token Decimals: ${tokenDecimals}`);

    console.log("📊 Fetching leaderboard from V1 and V2 contracts...");

    // ==================== V1 LEADERBOARD ====================
    const totalParticipantsV1 = (await withRetry(() =>
      publicClient.readContract({
        address: contractAddress,
        abi: contractAbi,
        functionName: "getAllParticipantsCount",
      })
    )) as bigint;

    console.log(`📊 V1 Total Participants: ${totalParticipantsV1}`);

    const entriesV1: {
      user: Address;
      totalWinnings: bigint;
      voteCount: number;
    }[] = [];

    for (
      let start = 0;
      start < Number(totalParticipantsV1);
      start += PAGE_SIZE
    ) {
      const batch = (await withRetry(() =>
        publicClient.readContract({
          address: contractAddress,
          abi: contractAbi,
          functionName: "getLeaderboard",
          args: [BigInt(start), BigInt(PAGE_SIZE)],
        })
      )) as unknown as {
        user: Address;
        totalWinnings: bigint;
        voteCount: number;
      }[];
      entriesV1.push(...batch);
    }

    // Fetch V2 leaderboard using allParticipants array and userPortfolios mapping
    console.log("📊 Fetching V2 participants and portfolios...");
    const entriesV2: {
      user: Address;
      totalWinnings: bigint;
      voteCount: number;
    }[] = [];

    try {
      const MAX_PARTICIPANTS = 500; // Safety limit
      const addresses: Address[] = [];

      // Step 1: Fetch participant addresses using multicall batches
      let currentIndex = 0;
      let hasMoreParticipants = true;

      while (hasMoreParticipants && currentIndex < MAX_PARTICIPANTS) {
        const batchContracts = Array.from(
          { length: Math.min(V2_BATCH_SIZE, MAX_PARTICIPANTS - currentIndex) },
          (_, i) => ({
            address: V2contractAddress as Address,
            abi: V2contractAbi,
            functionName: "allParticipants" as const,
            args: [BigInt(currentIndex + i)],
          })
        );

        const batchResults = await withRetry(() =>
          publicClient.multicall({
            contracts: batchContracts,
            allowFailure: true,
          })
        );

        const validAddresses = batchResults
          .filter((r) => r.status === "success" && r.result)
          .map((r) => r.result as Address);

        if (validAddresses.length === 0) {
          hasMoreParticipants = false;
          break;
        }

        addresses.push(...validAddresses);
        currentIndex += V2_BATCH_SIZE;

        // If we got fewer results than batch size, we've reached the end
        if (validAddresses.length < V2_BATCH_SIZE) {
          hasMoreParticipants = false;
        }
      }

      console.log(`✅ Found ${addresses.length} V2 participant addresses`);

      // Step 2: Fetch portfolios using multicall batches
      for (let i = 0; i < addresses.length; i += V2_BATCH_SIZE) {
        const batchAddresses = addresses.slice(i, i + V2_BATCH_SIZE);

        const portfolioContracts = batchAddresses.map((addr) => ({
          address: V2contractAddress as Address,
          abi: V2contractAbi,
          functionName: "userPortfolios" as const,
          args: [addr],
        }));

        const portfolioResults = await withRetry(() =>
          publicClient.multicall({
            contracts: portfolioContracts,
            allowFailure: true,
          })
        );

        portfolioResults.forEach((result, idx) => {
          if (result.status === "success" && result.result) {
            const portfolio = result.result as [
              bigint,
              bigint,
              bigint,
              bigint,
              bigint
            ];
            const totalWinnings = portfolio[1]; // index 1 = totalWinnings
            const tradeCount = Number(portfolio[4]); // index 4 = tradeCount

            if (totalWinnings > 0n) {
              entriesV2.push({
                user: batchAddresses[idx],
                totalWinnings,
                voteCount: tradeCount,
              });
            }
          }
        });
      }

      console.log(`✅ Fetched ${entriesV2.length} V2 leaderboard entries`);
    } catch (v2Error) {
      console.error("❌ V2 fetch error (continuing with V1 only):", v2Error);
      // Continue with V1 data only
    }

    // ==================== COMBINE V1 + V2 ====================
    const combinedEntries = new Map<
      string,
      { user: Address; totalWinnings: bigint; voteCount: number }
    >();

    // Add V1 entries
    entriesV1.forEach((entry) => {
      combinedEntries.set(entry.user.toLowerCase(), {
        user: entry.user,
        totalWinnings: entry.totalWinnings,
        voteCount: entry.voteCount,
      });
    });

    // Merge V2 entries (add to existing V1 data or create new)
    entriesV2.forEach((entry) => {
      const addr = entry.user.toLowerCase();
      const existing = combinedEntries.get(addr);
      if (existing) {
        // User exists in both V1 and V2 - ADD the values
        combinedEntries.set(addr, {
          user: entry.user,
          totalWinnings:
            BigInt(existing.totalWinnings) + BigInt(entry.totalWinnings),
          voteCount: Number(existing.voteCount) + Number(entry.voteCount),
        });
      } else {
        // User only exists in V2
        combinedEntries.set(addr, {
          user: entry.user,
          totalWinnings: entry.totalWinnings,
          voteCount: entry.voteCount,
        });
      }
    });

    const winners = Array.from(combinedEntries.values())
      .filter((entry) => entry.totalWinnings > 0n)
      .map((entry) => ({
        address: entry.user.toLowerCase(),
        winnings: Number(entry.totalWinnings) / Math.pow(10, tokenDecimals),
        voteCount: Number(entry.voteCount),
      }))
      .sort((a, b) => b.winnings - a.winnings);

    console.log(`📊 Combined ${winners.length} total unique winners`);

    // ==================== FETCH NEYNAR DATA ====================
    console.log("📬 Fetching Farcaster users...");
    const neynarCache =
      cache.get<Record<string, NeynarUser[]>>(NEYNAR_CACHE_KEY) || {};
    const addressesToFetch = winners
      .map((w) => w.address)
      .filter((addr) => !neynarCache[addr]);
    let addressToUsersMap: Record<string, NeynarUser[]> = { ...neynarCache };

    if (addressesToFetch.length > 0) {
      console.log(
        `📬 Requesting Neynar for ${addressesToFetch.length} addresses`
      );
      const newUsersMap = await batchFetchNeynarUsers(neynar, addressesToFetch);
      addressToUsersMap = { ...addressToUsersMap, ...newUsersMap };
      cache.set(NEYNAR_CACHE_KEY, addressToUsersMap, 86400); // 1-day TTL
      console.log(
        `✅ Neynar responded. Found users for ${
          Object.keys(newUsersMap).length
        } addresses.`
      );
    }

    // ==================== BUILD FINAL LEADERBOARD ====================
    console.log("🧠 Building leaderboard...");
    const leaderboard: LeaderboardEntry[] = winners
      .slice(0, 10) // Top 10 only
      .map((winner) => {
        const usersForAddress = addressToUsersMap[winner.address];
        const user =
          usersForAddress && usersForAddress.length > 0
            ? usersForAddress[0]
            : undefined;
        return {
          username:
            user?.username ||
            `${winner.address.slice(0, 6)}...${winner.address.slice(-4)}`,
          fid: user?.fid || "nil",
          pfp_url: user?.pfp_url || null,
          winnings: winner.winnings,
          voteCount: winner.voteCount,
          address: winner.address,
        };
      });

    console.log("🏆 Final Leaderboard:", leaderboard);

    // Ensure no BigInt values before caching and returning
    const safeLeaderboard = JSON.parse(
      JSON.stringify(leaderboard, (key, value) =>
        typeof value === "bigint" ? Number(value) : value
      )
    );

    cache.set(CACHE_KEY, safeLeaderboard);
    console.log("✅ Cached leaderboard");

    return NextResponse.json(safeLeaderboard);
  } catch (error) {
    console.error("❌ Leaderboard fetch error:", error);

    const cachedLeaderboard = cache.get<LeaderboardEntry[]>(CACHE_KEY);
    if (cachedLeaderboard) {
      console.log("✅ Serving stale cache due to error");
      const safeLeaderboard = JSON.parse(
        JSON.stringify(cachedLeaderboard, (key, value) =>
          typeof value === "bigint" ? Number(value) : value
        )
      );
      return NextResponse.json(safeLeaderboard);
    }

    return NextResponse.json(
      {
        error: "Failed to fetch leaderboard",
        details: "Please try again later.",
      },
      { status: 500 }
    );
  }
}
