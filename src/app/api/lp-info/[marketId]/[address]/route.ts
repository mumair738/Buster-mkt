import { NextRequest, NextResponse } from "next/server";
import {
  publicClient,
  V2contractAddress,
  V2contractAbi,
} from "@/constants/contract";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ marketId: string; address: string }> }
) {
  try {
    const { marketId, address } = await params;

    if (!marketId || isNaN(Number(marketId))) {
      return NextResponse.json({ error: "Invalid market ID" }, { status: 400 });
    }

    if (!address || !address.startsWith("0x")) {
      return NextResponse.json({ error: "Invalid address" }, { status: 400 });
    }

    // Get LP info from contract
    const readParams: any = {
      address: V2contractAddress,
      abi: V2contractAbi,
      functionName: "getLPInfo",
      args: [BigInt(marketId), address as `0x${string}`],
    };

    const rawLp = (await (publicClient.readContract as any)(
      readParams
    )) as unknown;
    const li = (rawLp as readonly any[]) || [];
    const contribution = BigInt(li[0] ?? 0n);
    const rewardsClaimed = Boolean(li[1]);
    const estimatedRewards = BigInt(li[2] ?? 0n);

    return NextResponse.json({
      marketId: Number(marketId),
      address,
      contribution: contribution.toString(),
      rewardsClaimed,
      estimatedRewards: estimatedRewards.toString(),
      isLP: contribution > 0n,
    });
  } catch (error) {
    console.error("Error fetching LP info:", error);
    return NextResponse.json(
      { error: "Failed to fetch LP info" },
      { status: 500 }
    );
  }
}
