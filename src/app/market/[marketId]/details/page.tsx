import { createPublicClient, http } from "viem";
import {
  contract,
  contractAbi,
  V2contractAddress,
  V2contractAbi,
  PolicastViews,
  PolicastViewsAbi,
} from "@/constants/contract";
import { notFound } from "next/navigation";
import { Metadata, ResolvingMetadata } from "next";
import { MarketDetailsClient } from "@/components/MarketDetailsClient";
import { fetchMarketData as fetchMarketDataFromMigration } from "@/lib/market-migration";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { MarketSharesDisplay } from "@/components/market-shares-display";
import { customBase } from "@/constants/chains";

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
  bigint, // winningOptionId
  string, // creator
  boolean // earlyResolutionAllowed
];

interface Props {
  params: Promise<{ marketId: string }>;
}

// Helper function to determine market version and fetch data
async function fetchMarketData(marketId: string, publicClient: any) {
  const marketIdBigInt = BigInt(marketId);

  // Try both V1 and V2 in parallel to handle overlapping IDs
  const [v1Result, v2Result, extendedResult] = await Promise.allSettled([
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
    publicClient
      .readContract({
        address: PolicastViews,
        abi: PolicastViewsAbi,
        functionName: "getMarketInfo",
        args: [marketIdBigInt],
      })
      .catch(() => null) as Promise<any>, // For marketType
  ]);

  const v1Exists = v1Result.status === "fulfilled" && v1Result.value[0]; // Check if question exists
  const v2Exists = v2Result.status === "fulfilled" && v2Result.value[0]; // Check if question exists

  // Extract marketType from extended info if available
  let marketType = 0; // Default to PAID market
  if (
    extendedResult.status === "fulfilled" &&
    extendedResult.value &&
    Array.isArray(extendedResult.value) &&
    extendedResult.value.length > 7
  ) {
    marketType = Number(extendedResult.value[7]) || 0;
  }

  // If only one version exists, return that one
  if (v1Exists && !v2Exists) {
    return {
      version: "v1" as const,
      data: v1Result.value,
      marketType: 0, // V1 markets don't have marketType
    };
  }
  if (v2Exists && !v1Exists) {
    return {
      version: "v2" as const,
      data: v2Result.value,
      marketType: marketType,
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
        marketType: marketType,
      };
    }
    if (v1Active && !v2Active) {
      console.log(`Market ${marketId}: V1 active, V2 ended - choosing V1`);
      return {
        version: "v1" as const,
        data: v1Data,
        marketType: 0,
      };
    }

    // If both have same status, prefer V2 (newer contract)
    console.log(
      `Market ${marketId}: Both versions exist with same status - preferring V2`
    );
    return {
      version: "v2" as const,
      data: v2Data,
      marketType: marketType,
    };
  }

  throw new Error(`Market ${marketId} not found in either V1 or V2 contracts`);
}

export async function generateMetadata(
  { params }: { params: Promise<{ marketId: string }> },
  parent: ResolvingMetadata
): Promise<Metadata> {
  const { marketId } = await params;

  console.log("generateMetadata: Processing marketId:", marketId);

  if (!marketId || isNaN(Number(marketId))) {
    console.error("generateMetadata: Invalid marketId", marketId);
    return {
      title: "Market Not Found",
      description: "Unable to load market data for metadata",
    };
  }

  try {
    const publicClient = createPublicClient({
      chain: customBase,
      transport: http(process.env.NEXT_PUBLIC_ALCHEMY_RPC_URL),
    });

    const marketResult = await fetchMarketData(marketId, publicClient);

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

      // Fetch all options for this V2 market for metadata
      const optionCount = Number(marketData[4]);
      const options: string[] = [];

      for (let i = 0; i < optionCount; i++) {
        try {
          const optionData = await publicClient.readContract({
            address: V2contractAddress,
            abi: V2contractAbi,
            functionName: "getMarketOption",
            args: [BigInt(marketId), BigInt(i)],
          });

          const [name] = optionData as [
            string,
            string,
            bigint,
            bigint,
            bigint,
            boolean
          ];
          options.push(name);
        } catch (error) {
          console.error(`Error fetching option ${i} for metadata:`, error);
          options.push(`Option ${i + 1}`);
        }
      }

      market = {
        question: marketData[0],
        description: marketData[1],
        endTime: marketData[2],
        category: marketData[3],
        optionCount: optionCount,
        resolved: marketData[5],
        disputed: marketData[6],
        winningOptionId: Number(marketData[7]),
        creator: marketData[8],
        version: "v2",
        options,
      };

      // For V2, create a description with options
      yesPercent = `Options: ${options.join(", ")}`;
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://buster-mkt.vercel.app";
    const imageUrl = `${baseUrl}/api/market-image?marketId=${marketId}`;

    const marketUrl = `${baseUrl}/market/${marketId}/details`;

    const description =
      market.version === "v1"
        ? `View market: ${market.question} - ${market.optionA}: ${yesPercent}%`
        : `View market: ${market.question} - ${market.optionCount} options available`;

    const miniAppEmbed = {
      version: "1" as const,
      imageUrl: imageUrl,
      button: {
        title: "View Market Details",
        action: {
          type: "launch_miniapp" as const,
          name: market.question.substring(0, 30),
          url: marketUrl,
          iconUrl: "https://buster-mkt.vercel.app/icon.png",
          splashImageUrl: "https://buster-mkt.vercel.app/icon.jpg",
          splashBackgroundColor: "#131E2A",
        },
      },
    };

    const resolvedParent = await parent;
    const otherParentData = resolvedParent.other || {};

    // Ensure fc:miniapp is explicitly a string key
    const fcFrameKey = "fc:miniapp" as string;
    return {
      title: market.question,
      description,
      other: {
        ...otherParentData, // Spread parent's other metadata first
        [fcFrameKey]: JSON.stringify(miniAppEmbed),
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
    console.error("generateMetadata: Error processing market metadata:", error);
    return {
      title: "Market Not Found",
      description: "Unable to load market data for metadata",
    };
  }
}

export default async function MarketDetailsPage({ params }: Props) {
  const { marketId } = await params;

  console.log(`=== MARKET DETAILS PAGE: Loading market ${marketId} ===`);

  if (!marketId || isNaN(Number(marketId))) {
    notFound();
  }

  try {
    const publicClient = createPublicClient({
      chain: customBase,
      transport: http(process.env.NEXT_PUBLIC_ALCHEMY_RPC_URL),
    });

    const marketResult = await fetchMarketData(marketId, publicClient);
    console.log(
      `Market ${marketId} detected as version:`,
      marketResult.version
    );

    let market: any;

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
        marketType: 0, // V1 markets are always paid markets
      };
      console.log(`Market ${marketId} V1 data:`, market);
    } else {
      const marketData = marketResult.data as MarketInfoV2ContractReturn;

      // Fetch all options for this V2 market
      const optionCount = Number(marketData[4]);
      const options: string[] = [];
      const optionShares: bigint[] = [];

      for (let i = 0; i < optionCount; i++) {
        try {
          const optionData = await publicClient.readContract({
            address: V2contractAddress,
            abi: V2contractAbi,
            functionName: "getMarketOption",
            args: [BigInt(marketId), BigInt(i)],
          });

          const [name, , totalShares] = optionData as [
            string,
            string,
            bigint,
            bigint,
            bigint,
            boolean
          ];
          options.push(name);
          optionShares.push(totalShares);
        } catch (error) {
          console.error(`Error fetching option ${i}:`, error);
          options.push(`Option ${i + 1}`);
          optionShares.push(0n);
        }
      }

      market = {
        question: marketData[0],
        description: marketData[1],
        endTime: marketData[2],
        category: marketData[3],
        optionCount: optionCount,
        resolved: marketData[5],
        disputed: marketData[6],
        winningOptionId: Number(marketData[7]),
        creator: marketData[8],
        version: "v2",
        options,
        optionShares,
        marketType: marketResult.marketType,
      };
      console.log(`Market ${marketId} V2 data:`, market);
    }

    return <MarketDetailsClient marketId={marketId} market={market} />;
  } catch (error) {
    console.error(`Failed to fetch market ${marketId}:`, error);
    notFound();
  }
}
