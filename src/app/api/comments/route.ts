import { NextRequest, NextResponse } from "next/server";

// In-memory storage for demo (in production, use a database)
interface Comment {
  id: string;
  marketId: string;
  content: string;
  author: {
    fid: string;
    username: string;
    pfpUrl?: string;
    address: string;
  };
  timestamp: number;
  parentId?: string; // For replies
  likes: number;
  likedBy: string[]; // Array of addresses
}

// Simple in-memory store (replace with database in production)
let comments: Comment[] = [
  // Sample comments for demo
  {
    id: "1",
    marketId: "0",
    content:
      "This market looks interesting! The recent polling data suggests a strong momentum.",
    author: {
      fid: "123",
      username: "cryptotrader",
      address: "0x1234567890123456789012345678901234567890",
    },
    timestamp: Date.now() - 3600000, // 1 hour ago
    likes: 5,
    likedBy: [],
  },
  {
    id: "2",
    marketId: "0",
    content:
      "I disagree. The fundamentals don't support this outcome. Check the latest news: https://example.com/news",
    author: {
      fid: "456",
      username: "analyst_pro",
      address: "0x2345678901234567890123456789012345678901",
    },
    timestamp: Date.now() - 1800000, // 30 min ago
    parentId: "1", // Reply to first comment
    likes: 2,
    likedBy: [],
  },
];

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get("marketId");

    if (!marketId) {
      return NextResponse.json(
        { error: "Market ID is required" },
        { status: 400 }
      );
    }

    // Filter comments for the specific market
    const marketComments = comments
      .filter((comment) => comment.marketId === marketId)
      .sort((a, b) => b.timestamp - a.timestamp); // Newest first

    // Organize comments with replies
    const organizedComments = organizeComments(marketComments);

    return NextResponse.json({
      comments: organizedComments,
      total: marketComments.length,
    });
  } catch (error) {
    console.error("Error fetching comments:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { marketId, content, author, parentId } = body;

    // Validation
    if (!marketId || !content || !author) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    if (content.length > 500) {
      return NextResponse.json(
        { error: "Comment too long (max 500 characters)" },
        { status: 400 }
      );
    }

    // Create new comment
    const newComment: Comment = {
      id: Date.now().toString(),
      marketId,
      content: content.trim(),
      author,
      timestamp: Date.now(),
      parentId,
      likes: 0,
      likedBy: [],
    };

    comments.push(newComment);

    return NextResponse.json(
      {
        comment: newComment,
        message: "Comment posted successfully",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error posting comment:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Helper function to organize comments into threads
function organizeComments(comments: Comment[]) {
  const commentMap = new Map<string, Comment & { replies: Comment[] }>();
  const rootComments: (Comment & { replies: Comment[] })[] = [];

  // First pass: create map and add replies array
  comments.forEach((comment) => {
    commentMap.set(comment.id, { ...comment, replies: [] });
  });

  // Second pass: organize into threads
  comments.forEach((comment) => {
    const commentWithReplies = commentMap.get(comment.id)!;

    if (comment.parentId) {
      const parent = commentMap.get(comment.parentId);
      if (parent) {
        parent.replies.push(commentWithReplies);
        // Sort replies by timestamp (oldest first for replies)
        parent.replies.sort((a, b) => a.timestamp - b.timestamp);
      }
    } else {
      rootComments.push(commentWithReplies);
    }
  });

  return rootComments;
}
