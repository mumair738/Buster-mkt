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
    const rawMarketInfo = (await (publicClient.readContract as any)({
      address: V2contractAddress,
      abi: V2contractAbi,
      functionName: "getMarketInfo",
      args: [BigInt(marketId)],
    })) as unknown;

    const mi = (rawMarketInfo as readonly any[]) || [];

    const question = String(mi[0] ?? "");
    const description = String(mi[1] ?? "");
    const endTime = BigInt(mi[2] ?? 0n);
    const category = Number(mi[3] ?? 0);
    const optionCount = BigInt(mi[4] ?? 0n);

    // ABI shape varies between deployments. Support both 12- and 13-element tuples.
    const resolved = Boolean(mi[5]);
    let disputed = false;
    let marketType = Number(0);
    let invalidated = false;
    let winningOptionId = BigInt(0);
    let creator = String("");
    let earlyResolutionAllowed = false;

    if (mi.length === 13 && typeof mi[6] === "bigint") {
      // Extra numeric field present (e.g. total shares). Map accordingly.
      disputed = Boolean(mi[7]);
      marketType = Number(mi[8] ?? 0);
      invalidated = Boolean(mi[9]);
      winningOptionId = BigInt(mi[10] ?? 0n);
      creator = String(mi[11] ?? "");
      earlyResolutionAllowed = Boolean(mi[12]);
    } else {
      // Expected 12-element shape
      disputed = Boolean(mi[6]);
      marketType = Number(mi[7] ?? 0);
      invalidated = Boolean(mi[8]);
      winningOptionId = BigInt(mi[9] ?? 0n);
      creator = String(mi[10] ?? "");
      earlyResolutionAllowed = Boolean(mi[11]);
    }

    return NextResponse.json({
      marketId: Number(marketId),
      question,
      description,
      endTime: endTime.toString(),
      category,
      optionCount: Number(optionCount),
      resolved,
      disputed,
      marketType,
      invalidated,
      winningOptionId: Number(winningOptionId),
      creator,
      earlyResolutionAllowed,
    });
  } catch (error) {
    console.error("Error fetching market info:", error);
    return NextResponse.json(
      { error: "Failed to fetch market info" },
      { status: 500 }
    );
  }
}
