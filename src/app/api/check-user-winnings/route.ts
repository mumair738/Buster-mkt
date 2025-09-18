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

    // Accept marketId = 0 (falsy in JS), so explicitly check for null/undefined.//
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

    // Check if user has winnings for this market
    const params: any = {
      address: V2contractAddress,
      abi: V2contractAbi,
      functionName: "getUserWinnings",
      args: [BigInt(marketIdNum), userAddress as `0x${string}`],
    };

    const result = (await (publicClient.readContract as any)(
      params
    )) as unknown;

    const resArr = result as readonly any[];
    const hasWinnings = Boolean(resArr[0]);
    const amount = BigInt(resArr[1] ?? 0n);

    return NextResponse.json({
      hasWinnings,
      amount: amount.toString(), // Convert BigInt to string for JSON
    });
  } catch (error) {
    console.error("Check user winnings error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Failed to check user winnings: ${errorMessage}` },
      { status: 500 }
    );
  }
}
