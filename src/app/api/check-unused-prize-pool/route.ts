import { NextRequest, NextResponse } from "next/server";
import {
  publicClient,
  V2contractAddress,
  V2contractAbi,
} from "@/constants/contract";

export async function POST(request: NextRequest) {
  try {
    const { marketId, userAddress } = await request.json();

    if (!marketId || marketId < 0 || !userAddress) {
      return NextResponse.json(
        { error: "Valid marketId and userAddress are required" },
        { status: 400 }
      );
    }

    // Get market info
    const marketInfo = (await publicClient.readContract({
      address: V2contractAddress,
      abi: V2contractAbi,
      functionName: "getMarketInfo",
      args: [BigInt(marketId)],
    })) as any;

    if (!marketInfo || !marketInfo[0]) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    // Check if user is the market creator (admin who can withdraw unused prize pool)
    const marketCreator = marketInfo[10]; // creator field (11th element, index 10)
    const isCreator = marketCreator.toLowerCase() === userAddress.toLowerCase();

    if (!isCreator) {
      return NextResponse.json({
        canWithdraw: false,
        amount: 0,
        reason: "Not market creator",
      });
    }

    // Check if market is resolved
    const resolved = marketInfo[5]; // resolved field (6th element, index 5)

    if (!resolved) {
      return NextResponse.json({
        canWithdraw: false,
        amount: 0,
        reason: "Market not resolved yet",
      });
    }

    // Get free market info to check remaining prize pool
    const freeMarketInfo = (await publicClient.readContract({
      address: V2contractAddress,
      abi: V2contractAbi,
      functionName: "getFreeMarketInfo",
      args: [BigInt(marketId)],
    })) as any;

    const remainingPrizePool = freeMarketInfo[4]; // remainingPrizePool (5th element, index 4)

    const canWithdraw = remainingPrizePool > 0n;

    return NextResponse.json({
      canWithdraw,
      amount: remainingPrizePool.toString(),
      marketId,
      resolved,
      isCreator,
    });
  } catch (error: any) {
    console.error("Error checking unused prize pool:", error);

    // Handle contract errors gracefully
    if (error.message?.includes("Market does not exist")) {
      return NextResponse.json({
        canWithdraw: false,
        amount: 0,
        reason: "Market does not exist",
      });
    }

    return NextResponse.json(
      { error: "Failed to check unused prize pool", details: error.message },
      { status: 500 }
    );
  }
}
