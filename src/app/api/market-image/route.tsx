import { NextRequest, NextResponse } from "next/server";
import {
  contract,
  contractAbi,
  publicClient,
  V2contractAddress,
  V2contractAbi,
} from "@/constants/contract";
import satori from "satori";
import sharp from "sharp";
import { promises as fs } from "fs";
import path from "node:path";
import { format } from "date-fns";

interface MarketImageDataV1 {
  question: string;
  optionA: string;
  optionB: string;
  totalOptionAShares: bigint;
  totalOptionBShares: bigint;
  endTime: bigint;
  resolved: boolean;
  outcome: number;
  version: "v1";
}

interface MarketImageDataV2 {
  question: string;
  description: string;
  endTime: bigint;
  category: number;
  optionCount: number;
  resolved: boolean;
  disputed: boolean;
  winningOptionId: number;
  creator: string;
  version: "v2";
}

type MarketImageData = MarketImageDataV1 | MarketImageDataV2;

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

async function fetchMarketData(marketId: string): Promise<MarketImageData> {
  console.log(`Market Image API: Fetching info for marketId ${marketId}...`);
  try {
    if (!process.env.NEXT_PUBLIC_ALCHEMY_RPC_URL) {
      throw new Error("NEXT_PUBLIC_ALCHEMY_RPC_URL is not set");
    }

    const marketIdBigInt = BigInt(marketId);

    // Try V2 first (newer contract)
    try {
      const v2MarketData = (await publicClient.readContract({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "getMarketInfo",
        args: [marketIdBigInt],
      })) as MarketInfoV2ContractReturn;

      // If successful and market exists, return V2 data
      if (v2MarketData[0]) {
        // question exists
        console.log(
          `Market Image API: Found V2 market ${marketId}:`,
          v2MarketData
        );
        return {
          question: v2MarketData[0],
          description: v2MarketData[1],
          endTime: v2MarketData[2],
          category: v2MarketData[3],
          optionCount: Number(v2MarketData[4]),
          resolved: v2MarketData[5],
          disputed: v2MarketData[6],
          winningOptionId: Number(v2MarketData[8]), // Updated index: was [7], now [8] due to invalidated field
          creator: v2MarketData[9], // Updated index: was [8], now [9] due to invalidated field
          version: "v2",
        };
      }
    } catch (error) {
      // V2 market doesn't exist, try V1
      console.log(`Market ${marketId} not found in V2, trying V1...`);
    }

    // Try V1
    try {
      const v1MarketData = (await publicClient.readContract({
        address: contract.address,
        abi: contractAbi,
        functionName: "getMarketInfo",
        args: [marketIdBigInt],
      })) as MarketInfoV1ContractReturn;

      // If successful and market exists, return V1 data
      if (v1MarketData[0]) {
        // question exists
        console.log(
          `Market Image API: Found V1 market ${marketId}:`,
          v1MarketData
        );
        return {
          question: v1MarketData[0],
          optionA: v1MarketData[1],
          optionB: v1MarketData[2],
          endTime: v1MarketData[3],
          outcome: v1MarketData[4],
          totalOptionAShares: v1MarketData[5],
          totalOptionBShares: v1MarketData[6],
          resolved: v1MarketData[7],
          version: "v1",
        };
      }
    } catch (error) {
      console.log(`Market ${marketId} not found in V1 either`);
    }

    throw new Error(
      `Market ${marketId} not found in either V1 or V2 contracts`
    );
  } catch (error) {
    console.error(
      `Market Image API: Failed to fetch or parse market ${marketId}:`,
      error
    );
    throw error;
  }
}

function formatTimeStatus(endTimeSeconds: bigint): {
  text: string;
  isEnded: boolean;
} {
  try {
    const endTimeMs = Number(endTimeSeconds) * 1000;
    const now = Date.now();
    const isEnded = now > endTimeMs;

    if (isEnded) {
      return {
        text: `Ended ${format(new Date(endTimeMs), "MMM d, yyyy")}`,
        isEnded,
      };
    }

    const diffMs = endTimeMs - now;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const diffHours = Math.floor(
      (diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)
    );

    if (diffDays > 0) {
      return {
        text: `${diffDays}d ${diffHours}h remaining`,
        isEnded,
      };
    } else {
      const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      return {
        text: `${diffHours}h ${diffMinutes}m remaining`,
        isEnded,
      };
    }
  } catch (e) {
    console.error("Error calculating time status:", e);
    return { text: "Unknown time", isEnded: false };
  }
}

const regularFontPath = path.join(
  process.cwd(),
  "public",
  "fonts",
  "Inter",
  "static",
  "Inter_18pt-Regular.ttf"
);
const boldFontPath = path.join(
  process.cwd(),
  "public",
  "fonts",
  "Inter",
  "static",
  "Inter_18pt-Bold.ttf"
);
const mediumFontPath = path.join(
  process.cwd(),
  "public",
  "fonts",
  "Inter",
  "static",
  "Inter_18pt-Medium.ttf"
);

console.log("Attempting to load fonts from:", regularFontPath, boldFontPath);

const regularFontDataPromise = fs.readFile(regularFontPath);
const boldFontDataPromise = fs.readFile(boldFontPath);
const mediumFontDataPromise = fs.readFile(mediumFontPath).catch(() => null);

const colors = {
  background: "#ffffff",
  cardBg: "#f9fafb",
  primary: "#2563eb",
  secondary: "#7c3aed",
  success: "#059669",
  danger: "#dc2626",
  text: {
    primary: "#111827",
    secondary: "#4b5563",
    light: "#9ca3af",
  },
  border: "#e5e7eb",
  gradient: {
    primary: "linear-gradient(135deg, #2563eb 0%, #1e40af 100%)",
    header: "linear-gradient(90deg, #1e40af 0%, #7e22ce 100%)",
    footer:
      "linear-gradient(90deg, rgba(37, 99, 235, 0.1) 0%, rgba(124, 58, 237, 0.1) 100%)",
  },
  shadow: "0 10px 25px rgba(0, 0, 0, 0.1)",
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const marketId = searchParams.get("marketId");

  console.log(
    `--- Market Image API: Received request for marketId: ${marketId} ---`
  );
  console.log("Market Image API: Full URL:", request.url);
  console.log(
    "Market Image API: All search params:",
    Object.fromEntries(searchParams.entries())
  );

  // More robust validation
  if (!marketId) {
    console.error("Market Image API: No marketId parameter provided");
    return new NextResponse("Missing market ID parameter", { status: 400 });
  }

  // Clean the marketId string and validate
  const cleanMarketId = marketId.trim();
  const marketIdNumber = Number(cleanMarketId);

  if (
    isNaN(marketIdNumber) ||
    marketIdNumber < 0 ||
    !Number.isInteger(marketIdNumber)
  ) {
    console.error(
      `Market Image API: Invalid marketId: "${marketId}" (cleaned: "${cleanMarketId}")`
    );
    return new NextResponse("Invalid market ID format", { status: 400 });
  }

  try {
    const [regularFontData, boldFontData, mediumFontData] = await Promise.all([
      regularFontDataPromise,
      boldFontDataPromise,
      mediumFontDataPromise.catch(() => null),
    ]);

    console.log(
      `Market Image API: Successfully loaded fonts for marketId ${cleanMarketId}`
    );

    const market = await fetchMarketData(cleanMarketId);
    console.log(
      `Market Image API: Market data processed for marketId ${cleanMarketId}:`,
      market
    );

    // Truncate long questions and adjust font sizes
    const truncateText = (text: string, maxLength: number) => {
      return text.length > maxLength
        ? text.substring(0, maxLength) + "..."
        : text;
    };

    let aPercentage = 50;
    let bPercentage = 50;
    let optionAText = "";
    let optionBText = "";

    if (market.version === "v1") {
      const total = market.totalOptionAShares + market.totalOptionBShares;
      aPercentage =
        total > 0n ? Number((market.totalOptionAShares * 100n) / total) : 50;
      bPercentage =
        total > 0n ? Number((market.totalOptionBShares * 100n) / total) : 50;
      optionAText = truncateText(market.optionA, 40);
      optionBText = truncateText(market.optionB, 40);
    } else {
      // For V2, we'll show different information
      optionAText = `${market.optionCount} Options`;
      optionBText = market.resolved ? `Resolved` : `Active`;
      aPercentage = market.resolved ? 100 : 0;
      bPercentage = market.resolved ? 0 : 100;
    }

    const timeStatus = formatTimeStatus(market.endTime);

    const questionText = truncateText(market.question, 120);

    // Dynamic font sizing based on question length
    const questionFontSize =
      market.question.length > 80 ? 28 : market.question.length > 50 ? 32 : 36;
    const optionFontSize = 18;

    const jsx = (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "900px",
          height: "600px",
          backgroundColor: colors.background,
          padding: "30px",
          fontFamily: "Inter",
        }}
      >
        {/* Header with gradient */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "30px",
            padding: "20px 30px",
            background: colors.gradient.header,
            borderRadius: "16px",
            color: "white",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: "24px",
              fontWeight: "bold",
            }}
          >
            🎯 Policast {market.version === "v2" ? "V2" : ""}
          </div>
          <div
            style={{
              display: "flex",
              fontSize: "16px",
              opacity: 0.9,
            }}
          >
            Market #{cleanMarketId}{" "}
            {market.version === "v2" ? "(Multi-Option)" : "(Binary)"}
          </div>
        </div>

        {/* Main content area */}
        <div
          style={{
            display: "flex",
            flex: 1,
            flexDirection: "column",
            backgroundColor: colors.cardBg,
            borderRadius: "20px",
            padding: "35px",
            border: `2px solid ${colors.border}`,
            position: "relative",
          }}
        >
          {/* Question - with dynamic font size */}
          <div
            style={{
              display: "flex",
              fontSize: `${questionFontSize}px`,
              fontWeight: "bold",
              color: colors.text.primary,
              marginBottom: "25px",
              lineHeight: 1.3,
              wordWrap: "break-word",
              hyphens: "auto",
            }}
          >
            {questionText}
          </div>

          {/* Status and time info */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              marginBottom: "30px",
              gap: "20px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: "8px 16px",
                backgroundColor: market.resolved
                  ? "#dcfce7"
                  : timeStatus.isEnded
                  ? "#fef3c7"
                  : "#dbeafe",
                color: market.resolved
                  ? "#166534"
                  : timeStatus.isEnded
                  ? "#92400e"
                  : "#1e40af",
                borderRadius: "12px",
                fontSize: "14px",
                fontWeight: "600",
              }}
            >
              {market.resolved ? "🏆 Resolved" : timeStatus.text}
            </div>
          </div>

          {/* Options with progress bars */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "20px",
              flex: 1,
            }}
          >
            {/* Option A */}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <span
                  style={{
                    fontSize: `${optionFontSize}px`,
                    fontWeight: "600",
                    color: colors.text.primary,
                  }}
                >
                  {optionAText}
                </span>
                <span
                  style={{
                    fontSize: "20px",
                    fontWeight: "bold",
                    color: colors.primary,
                  }}
                >
                  {aPercentage}%
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  width: "100%",
                  height: "12px",
                  backgroundColor: "#e5e7eb",
                  borderRadius: "6px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    width: `${aPercentage}%`,
                    height: "100%",
                    background: colors.gradient.primary,
                    borderRadius: "6px",
                  }}
                />
              </div>
            </div>

            {/* Option B */}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <span
                  style={{
                    fontSize: `${optionFontSize}px`,
                    fontWeight: "600",
                    color: colors.text.primary,
                  }}
                >
                  {optionBText}
                </span>
                <span
                  style={{
                    fontSize: "20px",
                    fontWeight: "bold",
                    color: colors.secondary,
                  }}
                >
                  {bPercentage}%
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  width: "100%",
                  height: "12px",
                  backgroundColor: "#e5e7eb",
                  borderRadius: "6px",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    width: `${bPercentage}%`,
                    height: "100%",
                    backgroundColor: colors.secondary,
                    borderRadius: "6px",
                  }}
                />
              </div>
            </div>
          </div>

          {/* Footer stats */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginTop: "25px",
              padding: "20px",
              background: colors.gradient.footer,
              borderRadius: "12px",
              border: `1px solid ${colors.border}`,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                textAlign: "center",
              }}
            >
              <div
                style={{
                  display: "flex",
                  fontSize: "14px",
                  color: colors.text.secondary,
                  marginBottom: "4px",
                }}
              >
                Total Volume
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: "18px",
                  fontWeight: "bold",
                  color: colors.text.primary,
                }}
              >
                {market.version === "v1"
                  ? `${(
                      Number(
                        market.totalOptionAShares + market.totalOptionBShares
                      ) /
                      10 ** 18
                    ).toLocaleString()} buster`
                  : "Multi-Option Market"}
              </div>
            </div>
            {market.resolved && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    fontSize: "14px",
                    color: colors.text.secondary,
                    marginBottom: "4px",
                  }}
                >
                  Winner
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: "18px",
                    fontWeight: "bold",
                    color: colors.success,
                  }}
                >
                  {market.version === "v1"
                    ? truncateText(
                        market.outcome === 1
                          ? market.optionA!
                          : market.optionB!,
                        30
                      )
                    : `Option ${market.winningOptionId + 1}`}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );

    const svg = await satori(jsx, {
      width: 900,
      height: 600,
      fonts: [
        {
          name: "Inter",
          data: regularFontData,
          weight: 400 as const,
          style: "normal",
        },
        {
          name: "Inter",
          data: boldFontData,
          weight: 700 as const,
          style: "normal",
        },
        ...(mediumFontData
          ? [
              {
                name: "Inter",
                data: mediumFontData,
                weight: 500 as const,
                style: "normal" as const,
              },
            ]
          : []),
      ],
    });

    const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    console.log(
      `Market Image API: Successfully generated image for marketId ${cleanMarketId}`
    );

    return new NextResponse(new Uint8Array(pngBuffer), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    });
  } catch (error) {
    console.error(
      `Market Image API: Error generating image for marketId ${cleanMarketId}:`,
      error
    );
    return new NextResponse("Error generating image", { status: 500 });
  }
}
