import {
  contract,
  contractAbi,
  publicClient,
  V2contractAddress,
  V2contractAbi,
} from "@/constants/contract";
import { Metadata, ResolvingMetadata } from "next";
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";

// V1 Market Info Contract Return
type MarketInfoV1ContractReturn = readonly [
  string, // question
  string, // optionA
  string, // optionB
  bigint, // endTime
  number, // outcome
  bigint, // totalOptionAShares
  bigint, // totalOptionBShares
  boolean // resolved
];

// V2 Market Info Contract Return
type MarketInfoV2ContractReturn = readonly [
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

// Helper function to determine market version and fetch data
async function fetchMarketData(marketId: string) {
  if (!process.env.NEXT_PUBLIC_ALCHEMY_RPC_URL) {
    throw new Error("NEXT_PUBLIC_ALCHEMY_RPC_URL is not set");
  }

  const marketIdBigInt = BigInt(marketId);

  // Try both V1 and V2 in parallel to handle overlapping IDs
  const [v1Result, v2Result] = await Promise.allSettled([
    publicClient.readContract({
      address: contract.address,
      abi: contractAbi,
      functionName: "getMarketInfo",
      args: [marketIdBigInt],
    }) as Promise<MarketInfoV1ContractReturn>,
    publicClient.readContract({
      address: V2contractAddress,
      abi: V2contractAbi,
      functionName: "getMarketInfo",
      args: [marketIdBigInt],
    }) as Promise<MarketInfoV2ContractReturn>,
  ]);

  const v1Exists = v1Result.status === "fulfilled" && v1Result.value[0]; // Check if question exists
  const v2Exists = v2Result.status === "fulfilled" && v2Result.value[0]; // Check if question exists

  // If only one version exists, return that one
  if (v1Exists && !v2Exists) {
    return {
      version: "v1" as const,
      data: v1Result.value,
    };
  }
  if (v2Exists && !v1Exists) {
    return {
      version: "v2" as const,
      data: v2Result.value,
    };
  }

  // If both exist, decide which one to prioritize
  if (v1Exists && v2Exists) {
    const v1Data = v1Result.value;
    const v2Data = v2Result.value;

    // Check market status to decide priority
    const v1EndTime = Number(v1Data[3]);
    const v1Resolved = v1Data[7];
    const v2EndTime = Number(v2Data[2]);
    const v2Resolved = v2Data[5];

    const currentTime = Math.floor(Date.now() / 1000);

    const v1Active = !v1Resolved && v1EndTime > currentTime;
    const v2Active = !v2Resolved && v2EndTime > currentTime;

    // Prefer active market over ended market
    if (v2Active && !v1Active) {
      console.log(`Market ${marketId}: V2 active, V1 ended - choosing V2`);
      return {
        version: "v2" as const,
        data: v2Data,
      };
    }
    if (v1Active && !v2Active) {
      console.log(`Market ${marketId}: V1 active, V2 ended - choosing V1`);
      return {
        version: "v1" as const,
        data: v1Data,
      };
    }

    // If both have same status, prefer V2 (newer contract)
    console.log(
      `Market ${marketId}: Both versions exist with same status - preferring V2`
    );
    return {
      version: "v2" as const,
      data: v2Data,
    };
  }

  throw new Error(`Market ${marketId} not found in either V1 or V2 contracts`);
}

export async function generateMetadata(
  { params }: { params: Promise<{ marketId: string }> },
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  parent: ResolvingMetadata
): Promise<Metadata> {
  try {
    const { marketId } = await params;

    if (!marketId || isNaN(Number(marketId))) {
      console.error("generateMetadata: Invalid marketId", marketId);
      throw new Error("Invalid marketId");
    }

    const marketResult = await fetchMarketData(marketId);

    let market: any;
    let yesPercent = "0.0";

    if (marketResult.version === "v1") {
      const marketData = marketResult.data as MarketInfoV1ContractReturn;
      market = {
        question: marketData[0],
        optionA: marketData[1],
        optionB: marketData[2],
        endTime: marketData[3],
        outcome: marketData[4],
        totalOptionAShares: marketData[5],
        totalOptionBShares: marketData[6],
        resolved: marketData[7],
        version: "v1",
      };

      const total = market.totalOptionAShares + market.totalOptionBShares;
      yesPercent =
        total > 0n
          ? (Number((market.totalOptionAShares * 1000n) / total) / 10).toFixed(
              1
            )
          : "0.0";
    } else {
      const marketData = marketResult.data as MarketInfoV2ContractReturn;
      market = {
        question: marketData[0],
        description: marketData[1],
        endTime: marketData[2],
        category: marketData[3],
        optionCount: Number(marketData[4]), // Convert bigint to number
        resolved: marketData[5],
        disputed: marketData[6],
        winningOptionId: Number(marketData[7]), // Convert bigint to number
        creator: marketData[8],
        version: "v2",
      };

      // For V2, use a generic description
      yesPercent = "Multi-option";
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://buster-mkt.vercel.app";
    const imageUrl = `${baseUrl}/api/market-image?marketId=${marketId}`;
    const postUrl = `${baseUrl}/api/frame-action`;
    const marketUrl = `${baseUrl}/market/${marketId}/details`;

    const description =
      market.version === "v1"
        ? `View market: ${market.question} - ${market.optionA}: ${yesPercent}%`
        : `View market: ${market.question} - ${market.optionCount} options available`;

    return {
      title: market.question,
      description,
      other: {
        "fc:miniapp": "vNext",
        "fc:miniapp:image": imageUrl,
        "fc:miniapp:post_url": postUrl,
        "fc:miniapp:button:1": "View",
        "fc:miniapp:button:1:action": "post",
        "fc:miniapp:state": Buffer.from(JSON.stringify({ marketId })).toString(
          "base64"
        ),
      },
      metadataBase: new URL(baseUrl),
      openGraph: {
        title: market.question,
        description,
        images: [
          { url: imageUrl, width: 1200, height: 630, alt: market.question },
        ],
        url: marketUrl,
        type: "website",
      },
      twitter: {
        card: "summary_large_image",
        title: market.question,
        description,
        images: [imageUrl],
      },
    };
  } catch (error) {
    console.error("Error generating metadata:", error);
    return {
      title: "Market Not Found",
      description: "Unable to load market data for metadata",
    };
  }
}

export default async function MarketPage({
  params,
}: {
  params: Promise<{ marketId: string }>;
}) {
  const { marketId } = await params;

  if (!marketId || isNaN(Number(marketId))) {
    notFound();
  }

  redirect(`/market/${marketId}/details`);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen">
      <p className="mb-4">Redirecting to market details...</p>
      <Button asChild variant="outline">
        <Link href="/">Home</Link>
      </Button>
    </div>
  );
}
