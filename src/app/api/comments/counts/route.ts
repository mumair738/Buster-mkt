import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketIds = searchParams.get("marketIds")?.split(",") || [];

    if (marketIds.length === 0) {
      return NextResponse.json({ counts: {} });
    }

    // Simple in-memory count (in production, this would query your database)
    const commentCounts: Record<string, number> = {};

    // For demo purposes, add some sample counts
    marketIds.forEach((marketId) => {
      // Simulate different comment counts for different markets
      const randomCount = Math.floor(Math.random() * 10);
      commentCounts[marketId] = marketId === "0" ? 2 : randomCount; // Market 0 has our sample comments
    });

    return NextResponse.json({ counts: commentCounts });
  } catch (error) {
    console.error("Error fetching comment counts:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
