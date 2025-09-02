import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";
import { V2contractAddress, V2contractAbi } from "@/constants/contract";

const publicClient = createPublicClient({
  chain: base,
  transport: http(process.env.NEXT_PUBLIC_ALCHEMY_RPC_URL),
});

export async function POST(request: NextRequest) {
  try {
    const { marketId, addresses } = await request.json();

    if (!marketId || !addresses || !Array.isArray(addresses)) {
      return NextResponse.json(
        { error: "Invalid input parameters" },
        { status: 400 }
      );
    }

    // Call the contract function to get eligible winners
    const result = await publicClient.readContract({
      address: V2contractAddress,
      abi: V2contractAbi,
      functionName: "getEligibleWinners",
      args: [BigInt(marketId), addresses],
    });

    const [recipients, amounts] = result as [string[], bigint[]];

    // Convert amounts from wei to readable format
    const formattedAmounts = amounts.map((amount) =>
      (Number(amount) / 1e18).toString()
    );

    return NextResponse.json({
      recipients,
      amounts: formattedAmounts,
    });
  } catch (error) {
    console.error("Preview batch distribution error:", error);
    return NextResponse.json(
      { error: "Failed to preview distribution" },
      { status: 500 }
    );
  }
}
