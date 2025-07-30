import { NextRequest, NextResponse } from "next/server";
import {
  publicClient,
  contractAddress,
  contractAbi,
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
}

interface MarketInfo {
  question: string;
  optionA: string;
  optionB: string;
  outcome: number;
  resolved: boolean;
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

    // Get total winnings
    const totalWinnings = (await publicClient.readContract({
      address: contractAddress,
      abi: contractAbi,
      functionName: "totalWinnings",
      args: [address],
    })) as bigint;

    // Get vote count
    const voteCount = (await publicClient.readContract({
      address: contractAddress,
      abi: contractAbi,
      functionName: "getVoteHistoryCount",
      args: [address],
    })) as bigint;

    if (voteCount === 0n) {
      return {
        totalVotes: 0,
        wins: 0,
        losses: 0,
        winRate: 0,
        totalInvested: 0n,
        netWinnings: totalWinnings,
      };
    }

    // Fetch all votes
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
        }))
      );
    }

    // Get market info for all voted markets
    const marketIds = [...new Set(allVotes.map((v) => v.marketId))];
    const marketInfosData = await publicClient.readContract({
      address: contractAddress,
      abi: contractAbi,
      functionName: "getMarketInfoBatch",
      args: [marketIds.map(BigInt)],
    });

    const marketInfos: Record<number, MarketInfo> = {};
    marketIds.forEach((id, i) => {
      marketInfos[id] = {
        question: marketInfosData[0][i],
        optionA: marketInfosData[1][i],
        optionB: marketInfosData[2][i],
        outcome: marketInfosData[4][i],
        resolved: marketInfosData[7][i],
      };
    });

    // Calculate wins and losses
    let wins = 0;
    let losses = 0;
    const totalInvested = allVotes.reduce((acc, v) => acc + v.amount, 0n);

    allVotes.forEach((vote) => {
      const market = marketInfos[vote.marketId];
      if (market && market.resolved) {
        const won =
          (vote.isOptionA && market.outcome === 1) ||
          (!vote.isOptionA && market.outcome === 2);
        if (won) {
          wins++;
        } else if (market.outcome !== 0 && market.outcome !== 3) {
          losses++;
        }
      }
    });

    const totalVotes = wins + losses;
    const winRate = totalVotes > 0 ? (wins / totalVotes) * 100 : 0;

    return {
      totalVotes,
      wins,
      losses,
      winRate,
      totalInvested,
      netWinnings: totalWinnings,
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
const mediumFontPath = path.join(
  process.cwd(),
  "public",
  "fonts",
  "Inter",
  "static",
  "Inter_18pt-Medium.ttf"
);

const regularFontDataPromise = fs.readFile(regularFontPath);
const boldFontDataPromise = fs.readFile(boldFontPath);
const mediumFontDataPromise = fs.readFile(mediumFontPath).catch(() => null);

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
    primary: "linear-gradient(135deg, #2563eb 0%, #1e40af 100%)",
    header: "linear-gradient(90deg, #1e40af 0%, #7e22ce 100%)",
    success: "linear-gradient(135deg, #059669 0%, #047857 100%)",
    danger: "linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)",
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
    const [regularFontData, boldFontData, mediumFontData] = await Promise.all([
      regularFontDataPromise,
      boldFontDataPromise,
      mediumFontDataPromise.catch(() => null),
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
          padding: "30px",
          fontFamily: "Inter",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: "25px",
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
              gap: "15px",
            }}
          >
            {pfpUrl && (
              <div
                style={{
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
                  fontSize: "24px",
                  fontWeight: "bold",
                }}
              >
                {displayUsername}
              </div>
              <div
                style={{
                  display: "flex",
                  fontSize: "14px",
                  opacity: 0.8,
                  fontFamily: "monospace",
                }}
              >
                {displayAddress}
              </div>
            </div>
          </div>
          <div
            style={{
              display: "flex",
              fontSize: "18px",
              fontWeight: "bold",
            }}
          >
            🎯 Policast Stats
          </div>
        </div>

        {/* Main Stats Grid */}
        <div
          style={{
            display: "flex",
            flex: 1,
            gap: "20px",
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
              padding: "30px",
              border: `2px solid ${colors.border}`,
              flex: "0 0 280px",
            }}
          >
            <div
              style={{
                position: "relative",
                width: "160px",
                height: "160px",
                marginBottom: "20px",
              }}
            >
              <svg
                style={{
                  width: "100%",
                  height: "100%",
                  transform: "rotate(-90deg)",
                }}
                viewBox="0 0 100 100"
              >
                <circle
                  cx="50"
                  cy="50"
                  r="35"
                  stroke="#e5e7eb"
                  strokeWidth="8"
                  fill="transparent"
                />
                <circle
                  cx="50"
                  cy="50"
                  r="35"
                  stroke="#059669"
                  strokeWidth="8"
                  fill="transparent"
                  strokeDasharray={`${2 * Math.PI * 35}`}
                  strokeDashoffset={`${
                    2 * Math.PI * 35 * (1 - stats.winRate / 100)
                  }`}
                  strokeLinecap="round"
                />
              </svg>
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  transform: "translate(-50%, -50%)",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    fontSize: "36px",
                    fontWeight: "bold",
                    color: colors.success,
                    marginBottom: "5px",
                  }}
                >
                  {stats.winRate.toFixed(1)}%
                </div>
                <div
                  style={{
                    fontSize: "14px",
                    color: colors.text.secondary,
                  }}
                >
                  Win Rate
                </div>
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              flex: 1,
              gap: "15px",
            }}
          >
            {/* Top Row - Wins and Losses */}
            <div style={{ display: "flex", gap: "15px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "15px",
                  backgroundColor: "#dcfce7",
                  borderRadius: "16px",
                  padding: "20px",
                  flex: 1,
                  border: "2px solid #bbf7d0",
                }}
              >
                <span style={{ fontSize: "32px" }}>🎯</span>
                <div>
                  <div
                    style={{
                      display: "flex",
                      fontSize: "14px",
                      color: colors.text.secondary,
                      marginBottom: "5px",
                    }}
                  >
                    Wins
                  </div>
                  <div
                    style={{
                      display: "flex",
                      fontSize: "28px",
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
                  gap: "15px",
                  backgroundColor: "#fecaca",
                  borderRadius: "16px",
                  padding: "20px",
                  flex: 1,
                  border: "2px solid #fca5a5",
                }}
              >
                <span style={{ fontSize: "32px" }}>❌</span>
                <div>
                  <div
                    style={{
                      display: "flex",
                      fontSize: "14px",
                      color: colors.text.secondary,
                      marginBottom: "5px",
                    }}
                  >
                    Losses
                  </div>
                  <div
                    style={{
                      display: "flex",
                      fontSize: "28px",
                      fontWeight: "bold",
                      color: colors.danger,
                    }}
                  >
                    {stats.losses}
                  </div>
                </div>
              </div>
            </div>

            {/* Middle Row - Total Invested */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "15px",
                backgroundColor: "#dbeafe",
                borderRadius: "16px",
                padding: "20px",
                border: "2px solid #93c5fd",
              }}
            >
              <span style={{ fontSize: "32px" }}>💰</span>
              <div>
                <div
                  style={{
                    display: "flex",
                    fontSize: "14px",
                    color: colors.text.secondary,
                    marginBottom: "5px",
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
                  {formatAmount(stats.totalInvested)} BSTR
                </div>
              </div>
            </div>

            {/* Bottom Row - Net Winnings */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "15px",
                backgroundColor:
                  Number(stats.netWinnings) >= 0 ? "#dcfce7" : "#fecaca",
                borderRadius: "16px",
                padding: "20px",
                border: `2px solid ${
                  Number(stats.netWinnings) >= 0 ? "#bbf7d0" : "#fca5a5"
                }`,
              }}
            >
              <span style={{ fontSize: "32px" }}>
                {Number(stats.netWinnings) >= 0 ? "📈" : "📉"}
              </span>
              <div>
                <div
                  style={{
                    display: "flex",
                    fontSize: "14px",
                    color: colors.text.secondary,
                    marginBottom: "5px",
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
                  {formatAmount(stats.netWinnings)} BSTR
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Stats */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-around",
            alignItems: "center",
            marginTop: "20px",
            padding: "20px",
            backgroundColor: "rgba(37, 99, 235, 0.05)",
            borderRadius: "16px",
            border: `1px solid ${colors.border}`,
          }}
        >
          <div
            style={{
              display: "flex",
              textAlign: "center",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: "24px",
                fontWeight: "bold",
                color: colors.primary,
                marginBottom: "5px",
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

          <div
            style={{
              display: "flex",
              textAlign: "center",
              flexDirection: "column",
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: "24px",
                fontWeight: "bold",
                color: colors.secondary,
                marginBottom: "5px",
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

          {fid && (
            <div
              style={{
                display: "flex",
                textAlign: "center",
                flexDirection: "column",
              }}
            >
              <div
                style={{
                  display: "flex",
                  fontSize: "18px",
                  fontWeight: "bold",
                  color: colors.primary,
                  marginBottom: "5px",
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
