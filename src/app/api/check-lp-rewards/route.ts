import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { V2contractAddress, V2contractAbi } from "@/constants/contract";

const publicClient = createPublicClient({
  chain: base,
  transport: http(
    process.env.NEXT_PUBLIC_ALCHEMY_RPC_URL || "https://mainnet.base.org"
  ),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { marketId, userAddress } = body;

    if (
      marketId === undefined ||
      marketId === null ||
      typeof userAddress !== "string" ||
      userAddress.trim() === ""
    ) {
      return NextResponse.json(
        { error: "Market ID and user address are required" },
        { status: 400 }
      );
    }

    // Validate marketId is a valid number
    const marketIdNum = parseInt(marketId.toString());
    if (isNaN(marketIdNum) || marketIdNum < 0) {
      return NextResponse.json({ error: "Invalid market ID" }, { status: 400 });
    }

    // Check if user has LP rewards for this market
    const result = await publicClient.readContract({
      address: V2contractAddress,
      abi: V2contractAbi,
      functionName: "getLPInfo",
      args: [BigInt(marketIdNum), userAddress as `0x${string}`],
    });

    const [contribution, rewardsClaimed, estimatedRewards] = result as [
      bigint,
      boolean,
      bigint
    ];

    return NextResponse.json({
      hasRewards: contribution > 0n && !rewardsClaimed && estimatedRewards > 0n,
      contribution: contribution.toString(),
      rewardsClaimed,
      estimatedRewards: estimatedRewards.toString(),
    });
  } catch (error) {
    console.error("Check LP rewards error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to check LP rewards: ${errorMessage}` },
      { status: 500 }
    );
  }
}
