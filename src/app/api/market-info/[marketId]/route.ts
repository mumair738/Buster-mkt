import { NextRequest, NextResponse } from "next/server";
import {
  publicClient,
  V2contractAddress,
  V2contractAbi,
} from "@/constants/contract";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ marketId: string }> }
) {
  try {
    const { marketId } = await params;

    if (!marketId || isNaN(Number(marketId))) {
      return NextResponse.json({ error: "Invalid market ID" }, { status: 400 });
    }

    // Get market info from contract
    const marketInfo = (await publicClient.readContract({
      address: V2contractAddress,
      abi: V2contractAbi,
      functionName: "getMarketInfo",
      args: [BigInt(marketId)],
    })) as readonly [
      string, // question
      string, // description
      bigint, // endTime
      number, // category
      bigint, // optionCount
      boolean, // resolved
      boolean, // disputed
      boolean, // invalidated
      bigint, // winningOptionId
      string // creator
    ];

    const [
      question,
      description,
      endTime,
      category,
      optionCount,
      resolved,
      disputed,
      invalidated,
      winningOptionId,
      creator,
    ] = marketInfo;

    return NextResponse.json({
      marketId: Number(marketId),
      question,
      description,
      endTime: endTime.toString(),
      category,
      optionCount: Number(optionCount),
      resolved,
      disputed,
      invalidated,
      winningOptionId: Number(winningOptionId),
      creator,
    });
  } catch (error) {
    console.error("Error fetching market info:", error);
    return NextResponse.json(
      { error: "Failed to fetch market info" },
      { status: 500 }
    );
  }
}
