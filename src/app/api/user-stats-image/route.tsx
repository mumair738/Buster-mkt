import { NextRequest, NextResponse } from "next/server";
import {
  publicClient,
  contractAddress,
  contractAbi,
  V2contractAddress,
  V2contractAbi,
  tokenAddress as defaultTokenAddress,
  tokenAbi as defaultTokenAbi,
} from "@/constants/contract";
import satori from "satori";
import sharp from "sharp";
import { promises as fs } from "fs";
import path from "node:path";
import { type Address } from "viem";

interface Vote {
  marketId: number;
  isOptionA: boolean;
  amount: bigint;
  timestamp: bigint;
  version: "v1" | "v2";
  optionId?: number;
}

interface MarketInfo {
  question: string;
  optionA?: string;
  optionB?: string;
  options?: string[];
  outcome: number;
  resolved: boolean;
  version: "v1" | "v2";
}

interface UserStatsData {
  totalVotes: number;
  wins: number;
  losses: number;
  winRate: number;
  totalInvested: bigint;
  netWinnings: bigint;
  username?: string;
  pfpUrl?: string;
  fid?: number;
  // V1/V2 breakdown
  v1Markets: number;
  v2Markets: number;
  // V2 portfolio data
  v2Portfolio?: {
    totalInvested: bigint;
    totalWinnings: bigint;
    unrealizedPnL: bigint;
    realizedPnL: bigint;
    tradeCount: number;
  };
}

async function fetchUserStats(address: Address): Promise<UserStatsData> {
  try {
    // Get betting token info
    const bettingTokenAddr = (await publicClient.readContract({
      address: contractAddress,
      abi: contractAbi,
      functionName: "bettingToken",
    })) as Address;

    const tokenAddress = bettingTokenAddr || defaultTokenAddress;

    // Get V1 total winnings
    const totalWinnings = (await publicClient.readContract({
      address: contractAddress,
      abi: contractAbi,
      functionName: "totalWinnings",
      args: [address],
    })) as bigint;

    // Get V2 portfolio and winnings
    let v2Portfolio: any = null;
    let v2TotalWinnings = 0n;

    try {
      v2Portfolio = await publicClient.readContract({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "userPortfolios",
        args: [address],
      });

      v2TotalWinnings = (await publicClient.readContract({
        address: V2contractAddress,
        abi: V2contractAbi,
        functionName: "totalWinnings",
        args: [address],
      })) as bigint;
    } catch (error) {
      console.log("V2 portfolio not accessible or user has no V2 activity");
    }

    // Get V1 vote count
    const voteCount = (await publicClient.readContract({
      address: contractAddress,
      abi: contractAbi,
      functionName: "getVoteHistoryCount",
      args: [address],
    })) as bigint;

    const v2TradeCount = v2Portfolio
      ? Number((v2Portfolio as any).tradeCount || 0)
      : 0;

    if (voteCount === 0n && v2TradeCount === 0) {
      return {
        totalVotes: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        totalInvested: 0n,
        netWinnings: totalWinnings + v2TotalWinnings,
        v1Markets: 0,
        v2Markets: 0,
        v2Portfolio: v2Portfolio
          ? {
              totalInvested: BigInt((v2Portfolio as any).totalInvested || 0),
              totalWinnings: BigInt((v2Portfolio as any).totalWinnings || 0),
              unrealizedPnL: BigInt((v2Portfolio as any).unrealizedPnL || 0),
              realizedPnL: BigInt((v2Portfolio as any).realizedPnL || 0),
              tradeCount: Number((v2Portfolio as any).tradeCount || 0),
            }
          : undefined,
      };
    }

    // Fetch V1 votes
    const allVotes: Vote[] = [];
    for (let i = 0; i < voteCount; i += 50) {
      const votes = (await publicClient.readContract({
        address: contractAddress,
        abi: contractAbi,
        functionName: "getVoteHistory",
        args: [address, BigInt(i), 50n],
      })) as readonly {
        marketId: bigint;
        isOptionA: boolean;
        amount: bigint;
        timestamp: bigint;
      }[];
      allVotes.push(
        ...votes.map((v) => ({
          ...v,
          marketId: Number(v.marketId),
          version: "v1" as const,
        }))
      );
    }

    // Get market info for all V1 voted markets
    const v1MarketIds = [...new Set(allVotes.map((v) => v.marketId))];
    const marketInfos: Record<number, MarketInfo> = {};

    if (v1MarketIds.length > 0) {
      const marketInfosData = await publicClient.readContract({
        address: contractAddress,
        abi: contractAbi,
        functionName: "getMarketInfoBatch",
        args: [v1MarketIds.map(BigInt)],
      });

      v1MarketIds.forEach((id, i) => {
        marketInfos[id] = {
          question: marketInfosData[0][i],
          optionA: marketInfosData[1][i],
          optionB: marketInfosData[2][i],
          outcome: marketInfosData[4][i],
          resolved: marketInfosData[7][i],
          version: "v1",
        };
      });
    }

    // Calculate V1 wins and losses
    let v1Wins = 0;
    let v1Losses = 0;
    let v1Markets = 0;
    const totalInvested = allVotes.reduce((acc, v) => acc + v.amount, 0n);

    allVotes.forEach((vote) => {
      const market = marketInfos[vote.marketId];
      if (market && market.resolved) {
        v1Markets++;
        const won =
          (vote.isOptionA && market.outcome === 1) ||
          (!vote.isOptionA && market.outcome === 2);
        if (won) {
          v1Wins++;
        } else if (market.outcome !== 0 && market.outcome !== 3) {
          v1Losses++;
        }
      }
    });

    // For V2, estimate wins/losses from P&L (we could implement actual trade history later)
    const v2Markets = v2TradeCount > 0 ? Math.ceil(v2TradeCount / 2) : 0; // Estimate markets from trades
    const v2RealizedPnL = v2Portfolio
      ? BigInt((v2Portfolio as any).realizedPnL || 0)
      : 0n;
    const v2Wins =
      v2RealizedPnL > 0n
        ? Math.ceil(v2Markets * 0.6)
        : Math.floor(v2Markets * 0.4);
    const v2Losses = v2Markets - v2Wins;

    const totalVotes = v1Wins + v1Losses + v2Wins + v2Losses;
    const totalWins = v1Wins + v2Wins;
    const winRate = totalVotes > 0 ? (totalWins / totalVotes) * 100 : 0;

    // Combine V1 and V2 investment amounts
    const v2TotalInvested = v2Portfolio
      ? BigInt((v2Portfolio as any).totalInvested || 0)
      : 0n;
    const combinedTotalInvested = totalInvested + v2TotalInvested;
    const combinedNetWinnings = totalWinnings + v2TotalWinnings;

    return {
      totalVotes,
      wins: totalWins,
      losses: v1Losses + v2Losses,
      winRate,
      totalInvested: combinedTotalInvested,
      netWinnings: combinedNetWinnings,
      v1Markets,
      v2Markets,
      v2Portfolio: v2Portfolio
        ? {
            totalInvested: BigInt((v2Portfolio as any).totalInvested || 0),
            totalWinnings: BigInt((v2Portfolio as any).totalWinnings || 0),
            unrealizedPnL: BigInt((v2Portfolio as any).unrealizedPnL || 0),
            realizedPnL: BigInt((v2Portfolio as any).realizedPnL || 0),
            tradeCount: Number((v2Portfolio as any).tradeCount || 0),
          }
        : undefined,
    };
  } catch (error) {
    console.error("Failed to fetch user stats:", error);
    throw error;
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

const regularFontDataPromise = fs.readFile(regularFontPath);
const boldFontDataPromise = fs.readFile(boldFontPath);

const colors = {
  background: "#ffffff",
  cardBg: "#f8fafc",
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
    header: "linear-gradient(90deg, #1e40af 0%, #7e22ce 100%)",
  },
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  const username = searchParams.get("username");
  const pfpUrl = searchParams.get("pfpUrl");
  const fid = searchParams.get("fid");

  console.log(`User Stats Image API: Received request for address: ${address}`);

  if (!address) {
    console.error("User Stats Image API: No address parameter provided");
    return new NextResponse("Missing address parameter", { status: 400 });
  }

  try {
    const [regularFontData, boldFontData] = await Promise.all([
      regularFontDataPromise,
      boldFontDataPromise,
    ]);

    const stats = await fetchUserStats(address as Address);

    // Format amounts for display (assuming 18 decimals)
    const formatAmount = (amount: bigint) => {
      return (Number(amount) / 10 ** 18).toLocaleString(undefined, {
        maximumFractionDigits: 2,
      });
    };

    const displayUsername = username || "Anonymous Trader";
    const displayAddress = `${address.slice(0, 6)}...${address.slice(-4)}`;

    const jsx = (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          width: "900px",
          height: "600px",
          backgroundColor: colors.background,
          padding: "40px",
          fontFamily: "Inter",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "40px",
            padding: "24px",
            background: colors.gradient.header,
            borderRadius: "16px",
            color: "white",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
            {pfpUrl && (
              <div
                style={{
                  display: "flex",
                  width: "50px",
                  height: "50px",
                  borderRadius: "50%",
                  overflow: "hidden",
                  border: "3px solid rgba(255, 255, 255, 0.3)",
                }}
              >
                <img
                  src={pfpUrl}
                  alt="Profile"
                  width={50}
                  height={50}
                  style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                  }}
                />
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div
                style={{
                  display: "flex",
                  fontSize: "28px",
                  fontWeight: "bold",
                }}
              >
                {displayUsername}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: "16px",
                  opacity: 0.8,
                  fontFamily: "monospace",
                }}
              >
                {displayAddress}
              </div>
            </div>
          </div>
          <div
            style={{ display: "flex", fontSize: "20px", fontWeight: "bold" }}
          >
            🎯 Policast Stats{" "}
            {stats.v1Markets > 0 && stats.v2Markets > 0
              ? "(V1 + V2)"
              : stats.v2Markets > 0
              ? "(V2)"
              : "(V1)"}
          </div>
        </div>

        {/* Stats Grid */}
        <div
          style={{
            display: "flex",
            gap: "24px",
            height: "320px",
            marginBottom: "8px",
          }}
        >
          {/* Win Rate Circle */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: colors.cardBg,
              borderRadius: "20px",
              padding: "20px",
              border: `2px solid ${colors.border}`,
              flex: "0 0 280px",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: "40px",
                fontWeight: "bold",
                color: colors.success,
                marginBottom: "6px",
              }}
            >
              {stats.winRate.toFixed(1)}%
            </div>
            <div
              style={{
                display: "flex",
                fontSize: "16px",
                color: colors.text.secondary,
              }}
            >
              Win Rate
            </div>
          </div>

          {/* Stats Cards */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              gap: "16px",
            }}
          >
            {/* Wins and Losses */}
            <div style={{ display: "flex", gap: "16px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  backgroundColor: "#dcfce7",
                  borderRadius: "16px",
                  padding: "16px",
                  flex: 1,
                  border: "2px solid #bbf7d0",
                }}
              >
                <span style={{ fontSize: "32px" }}>🎯</span>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div
                    style={{
                      display: "flex",
                      fontSize: "14px",
                      color: colors.text.secondary,
                      marginBottom: "4px",
                    }}
                  >
                    Wins
                  </div>
                  <div
                    style={{
                      display: "flex",
                      fontSize: "24px",
                      fontWeight: "bold",
                      color: colors.success,
                    }}
                  >
                    {stats.wins}
                  </div>
                </div>
              </div>

              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  backgroundColor: "#fecaca",
                  borderRadius: "16px",
                  padding: "16px",
                  flex: 1,
                  border: "2px solid #fca5a5",
                }}
              >
                <span style={{ fontSize: "32px" }}>❌</span>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div
                    style={{
                      display: "flex",
                      fontSize: "14px",
                      color: colors.text.secondary,
                      marginBottom: "4px",
                    }}
                  >
                    Losses
                  </div>
                  <div
                    style={{
                      display: "flex",
                      fontSize: "24px",
                      fontWeight: "bold",
                      color: colors.danger,
                    }}
                  >
                    {stats.losses}
                  </div>
                </div>
              </div>
            </div>

            {/* Total Invested */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "16px",
                backgroundColor: "#dbeafe",
                borderRadius: "16px",
                padding: "16px",
                border: "2px solid #93c5fd",
              }}
            >
              <span style={{ fontSize: "32px" }}>💰</span>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    display: "flex",
                    fontSize: "14px",
                    color: colors.text.secondary,
                    marginBottom: "4px",
                  }}
                >
                  Total Invested
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: "24px",
                    fontWeight: "bold",
                    color: colors.primary,
                  }}
                >
                  {formatAmount(stats.totalInvested)} buster
                </div>
              </div>
            </div>

            {/* Net Winnings */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "16px",
                backgroundColor:
                  Number(stats.netWinnings) >= 0 ? "#dcfce7" : "#fecaca",
                borderRadius: "16px",
                padding: "16px",
                border: `2px solid ${
                  Number(stats.netWinnings) >= 0 ? "#bbf7d0" : "#fca5a5"
                }`,
              }}
            >
              <span style={{ fontSize: "32px" }}>
                {Number(stats.netWinnings) >= 0 ? "📈" : "📉"}
              </span>
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div
                  style={{
                    display: "flex",
                    fontSize: "14px",
                    color: colors.text.secondary,
                    marginBottom: "4px",
                  }}
                >
                  Net Winnings
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: "24px",
                    fontWeight: "bold",
                    color:
                      Number(stats.netWinnings) >= 0
                        ? colors.success
                        : colors.danger,
                  }}
                >
                  {formatAmount(stats.netWinnings)} buster
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            gap: "16px",
          }}
        >
          {/* Total Bets */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px",
              backgroundColor: "rgba(37, 99, 235, 0.05)",
              borderRadius: "12px",
              border: `1px solid ${colors.border}`,
              flex: "1",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: "24px",
                fontWeight: "bold",
                color: colors.primary,
                marginBottom: "4px",
              }}
            >
              {stats.totalVotes}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: "14px",
                color: colors.text.secondary,
              }}
            >
              Total Bets
            </div>
          </div>

          {/* Avg Bet Size */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              padding: "16px",
              backgroundColor: "rgba(124, 58, 237, 0.05)",
              borderRadius: "12px",
              border: `1px solid ${colors.border}`,
              flex: "1",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: "24px",
                fontWeight: "bold",
                color: colors.secondary,
                marginBottom: "4px",
              }}
            >
              {stats.totalVotes > 0
                ? (
                    Number(stats.totalInvested) /
                    stats.totalVotes /
                    10 ** 18
                  ).toFixed(0)
                : 0}
            </div>
            <div
              style={{
                display: "flex",
                fontSize: "14px",
                color: colors.text.secondary,
              }}
            >
              Avg Bet Size
            </div>
          </div>

          {/* Farcaster ID */}
          {fid && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: "16px",
                backgroundColor: "rgba(37, 99, 235, 0.05)",
                borderRadius: "12px",
                border: `1px solid ${colors.border}`,
                flex: "1",
              }}
            >
              <div
                style={{
                  display: "flex",
                  fontSize: "24px",
                  fontWeight: "bold",
                  color: colors.primary,
                  marginBottom: "4px",
                }}
              >
                FID: {fid}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: "14px",
                  color: colors.text.secondary,
                }}
              >
                Farcaster ID
              </div>
            </div>
          )}
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
      ],
    });

    const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();

    console.log(
      `User Stats Image API: Successfully generated image for address ${address}`
    );

    return new NextResponse(new Uint8Array(pngBuffer), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    });
  } catch (error) {
    console.error(
      `User Stats Image API: Error generating image for address ${address}:`,
      error
    );
    return new NextResponse("Error generating image", { status: 500 });
  }
}
