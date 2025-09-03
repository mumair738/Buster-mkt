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
    const { marketId } = await request.json();

    if (!marketId) {
      return NextResponse.json(
        { error: "Market ID is required" },
        { status: 400 }
      );
    }

    // Get all TradeExecuted events for this market to find participants
    const tradeEvents = await publicClient.getLogs({
      address: V2contractAddress,
      event: {
        type: "event",
        name: "TradeExecuted",
        inputs: [
          { type: "uint256", name: "marketId", indexed: true },
          { type: "uint256", name: "optionId", indexed: true },
          { type: "address", name: "buyer", indexed: false },
          { type: "address", name: "seller", indexed: false },
          { type: "uint256", name: "price" },
          { type: "uint256", name: "quantity" },
          { type: "uint256", name: "tradeId", indexed: false },
        ],
      },
      args: {
        marketId: BigInt(marketId),
      },
      fromBlock: 0n,
      toBlock: "latest",
    });

    // Extract unique participant addresses from events
    const participantSet = new Set<string>();

    for (const event of tradeEvents) {
      const buyer = event.args?.buyer;
      const seller = event.args?.seller;

      if (buyer && buyer !== "0x0000000000000000000000000000000000000000") {
        participantSet.add(buyer.toLowerCase());
      }
      if (seller && seller !== "0x0000000000000000000000000000000000000000") {
        participantSet.add(seller.toLowerCase());
      }
    }

    const participants = Array.from(participantSet);

    if (participants.length === 0) {
      return NextResponse.json({
        recipients: [],
        amounts: [],
        totalParticipants: 0,
        message: "No participants found for this market",
      });
    }

    // Now get eligible winners from the contract
    const result = await publicClient.readContract({
      address: V2contractAddress,
      abi: V2contractAbi,
      functionName: "getEligibleWinners",
      args: [BigInt(marketId), participants as `0x${string}`[]],
    });

    const [recipients, amounts] = result as [string[], bigint[]];

    // Convert amounts from wei to readable format
    const formattedAmounts = amounts.map((amount) =>
      (Number(amount) / 1e18).toString()
    );

    return NextResponse.json({
      recipients,
      amounts: formattedAmounts,
      totalParticipants: participants.length,
      eligibleCount: recipients.length,
    });
  } catch (error) {
    console.error("Auto-preview batch distribution error:", error);
    return NextResponse.json(
      { error: "Failed to auto-preview distribution" },
      { status: 500 }
    );
  }
}
