import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export interface User {
  id: string;
  address: string;
  fid?: string;
  username?: string;
  pfpUrl?: string;
}

export interface Comment {
  id: string;
  marketId: string;
  content: string;
  userId: string;
  parentId?: string;
  likesCount: number;
  createdAt: string;
  user?: User;
  replies?: Comment[];
  hasLiked?: boolean;
}

// Fallback data for when Supabase is not configured
const fallbackComments: Comment[] = [];

// User operations
export const upsertUser = async (userData: {
  address: string;
  fid?: string;
  username?: string;
  pfpUrl?: string;
}): Promise<User | null> => {
  if (!isSupabaseConfigured()) {
    console.warn("Supabase not configured, using fallback user creation");
    return {
      id: `user_${userData.address}`,
      address: userData.address,
      fid: userData.fid,
      username: userData.username,
      pfpUrl: userData.pfpUrl,
    };
  }
  try {
    const { data, error } = await supabase
      .from("users")
      .upsert(
        {
          address: userData.address,
          fid: userData.fid,
          username: userData.username,
          pfp_url: userData.pfpUrl,
        },
        {
          onConflict: "address",
          ignoreDuplicates: false,
        }
      )
      .select()
      .single();

    if (error) {
      console.error("Error upserting user:", error);
      return null;
    }

    return {
      id: data.id,
      address: data.address,
      fid: data.fid,
      username: data.username,
      pfpUrl: data.pfp_url,
    };
  } catch (error) {
    console.error("Error in upsertUser:", error);
    return null;
  }
};

export const getUser = async (address: string): Promise<User | null> => {
  if (!isSupabaseConfigured()) {
    console.warn("Supabase not configured, using fallback user lookup");
    return {
      id: `user_${address}`,
      address: address,
      username: `User ${address.slice(0, 6)}`,
    };
  }

  try {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("address", address)
      .maybeSingle(); // Use maybeSingle() instead of single() to handle 0 or 1 rows

    if (error) {
      console.error("Error getting user:", error);
      return null;
    }

    if (!data) {
      // User doesn't exist, return null
      return null;
    }

    return {
      id: data.id,
      address: data.address,
      fid: data.fid,
      username: data.username,
      pfpUrl: data.pfp_url,
    };
  } catch (error) {
    console.error("Error in getUser:", error);
    return null;
  }
};

// Comment operations
export const getComments = async (
  marketId: string,
  userAddress?: string
): Promise<Comment[]> => {
  if (!isSupabaseConfigured()) {
    console.warn("Supabase not configured, returning empty comments");
    return fallbackComments.filter((c) => c.marketId === marketId);
  }

  try {
    // Get comments with user data
    const { data: commentsData, error } = await supabase
      .from("comments")
      .select(
        `
        *,
        users (
          id,
          address,
          fid,
          username,
          pfp_url
        )
      `
      )
      .eq("market_id", marketId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Error fetching comments:", error);
      return [];
    }

    // Get user's likes if user is provided
    let userLikes: string[] = [];
    if (userAddress) {
      const user = await getUser(userAddress);
      if (user) {
        const { data: likesData } = await supabase
          .from("comment_likes")
          .select("comment_id")
          .eq("user_id", user.id);

        userLikes = likesData?.map((like) => like.comment_id) || [];
      }
    }

    // Transform and organize comments into threads
    // Define proper type for Supabase comment data with joined user
    interface SupabaseComment {
      id: string;
      market_id: string;
      content: string;
      user_id: string;
      parent_id: string | null;
      likes_count: number;
      created_at: string;
      users: {
        id: string;
        address: string;
        fid: string | null;
        username: string | null;
        pfp_url: string | null;
      } | null;
    }

    const comments: Comment[] = (commentsData as SupabaseComment[]).map(
      (comment) => ({
        id: comment.id,
        marketId: comment.market_id,
        content: comment.content,
        userId: comment.user_id,
        parentId: comment.parent_id || undefined, // Convert null to undefined
        likesCount: comment.likes_count,
        createdAt: comment.created_at,
        hasLiked: userLikes.includes(comment.id),
        user: comment.users
          ? {
              id: comment.users.id,
              address: comment.users.address,
              fid: comment.users.fid || undefined, // Convert null to undefined
              username: comment.users.username || undefined, // Convert null to undefined
              pfpUrl: comment.users.pfp_url || undefined, // Convert null to undefined
            }
          : undefined,
      })
    );

    // Organize into threaded structure
    const commentMap = new Map<string, Comment>();
    const rootComments: Comment[] = [];

    // First pass: create map and initialize replies arrays
    comments.forEach((comment) => {
      comment.replies = [];
      commentMap.set(comment.id, comment);
    });

    // Second pass: organize into threads
    comments.forEach((comment) => {
      if (comment.parentId) {
        const parent = commentMap.get(comment.parentId);
        if (parent) {
          parent.replies!.push(comment);
        }
      } else {
        rootComments.push(comment);
      }
    });

    return rootComments;
  } catch (error) {
    console.error("Error in getComments:", error);
    return [];
  }
};

export const createComment = async (commentData: {
  marketId: string;
  content: string;
  userAddress: string;
  fid?: string;
  username?: string;
  pfpUrl?: string;
  parentId?: string;
}): Promise<Comment | null> => {
  if (!isSupabaseConfigured()) {
    console.warn("Supabase not configured, using fallback comment creation");
    const comment: Comment = {
      id: `comment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      marketId: commentData.marketId,
      content: commentData.content,
      userId: `user_${commentData.userAddress}`,
      parentId: commentData.parentId,
      likesCount: 0,
      createdAt: new Date().toISOString(),
      hasLiked: false,
      user: {
        id: `user_${commentData.userAddress}`,
        address: commentData.userAddress,
        fid: commentData.fid,
        username:
          commentData.username || `User ${commentData.userAddress.slice(0, 6)}`,
        pfpUrl: commentData.pfpUrl,
      },
    };
    fallbackComments.push(comment);
    return comment;
  }

  try {
    // First, ensure user exists
    const user = await upsertUser({
      address: commentData.userAddress,
      fid: commentData.fid,
      username: commentData.username,
      pfpUrl: commentData.pfpUrl,
    });

    if (!user) {
      throw new Error("Failed to create/get user");
    }

    // Create comment
    const { data, error } = await supabase
      .from("comments")
      .insert({
        market_id: commentData.marketId,
        content: commentData.content,
        user_id: user.id,
        parent_id: commentData.parentId || null,
      })
      .select(
        `
        *,
        users (
          id,
          address,
          fid,
          username,
          pfp_url
        )
      `
      )
      .single();

    if (error) {
      console.error("Error creating comment:", error);
      return null;
    }

    return {
      id: data.id,
      marketId: data.market_id,
      content: data.content,
      userId: data.user_id,
      parentId: data.parent_id,
      likesCount: data.likes_count,
      createdAt: data.created_at,
      user: data.users
        ? {
            id: data.users.id,
            address: data.users.address,
            fid: data.users.fid,
            username: data.users.username,
            pfpUrl: data.users.pfp_url,
          }
        : undefined,
    };
  } catch (error) {
    console.error("Error in createComment:", error);
    return null;
  }
};

export const toggleCommentLike = async (
  commentId: string,
  userAddress: string
): Promise<{ liked: boolean; likesCount: number } | null> => {
  if (!isSupabaseConfigured()) {
    console.warn("Supabase not configured, using fallback like toggle");
    // Find comment in fallback data and toggle like
    const comment = fallbackComments.find((c) => c.id === commentId);
    if (comment) {
      const currentlyLiked = comment.hasLiked || false;
      comment.hasLiked = !currentlyLiked;
      comment.likesCount += currentlyLiked ? -1 : 1;
      return {
        liked: comment.hasLiked,
        likesCount: comment.likesCount,
      };
    }
    return { liked: false, likesCount: 0 };
  }

  try {
    const user = await getUser(userAddress);
    if (!user) {
      throw new Error("User not found");
    }

    // Check if user already liked this comment
    const { data: existingLike } = await supabase
      .from("comment_likes")
      .select("id")
      .eq("comment_id", commentId)
      .eq("user_id", user.id)
      .single();

    if (existingLike) {
      // Unlike - remove the like
      const { error } = await supabase
        .from("comment_likes")
        .delete()
        .eq("comment_id", commentId)
        .eq("user_id", user.id);

      if (error) {
        console.error("Error removing like:", error);
        return null;
      }
    } else {
      // Like - add the like
      const { error } = await supabase.from("comment_likes").insert({
        comment_id: commentId,
        user_id: user.id,
      });

      if (error) {
        console.error("Error adding like:", error);
        return null;
      }
    }

    // Get updated likes count
    const { data: comment } = await supabase
      .from("comments")
      .select("likes_count")
      .eq("id", commentId)
      .single();

    return {
      liked: !existingLike,
      likesCount: comment?.likes_count || 0,
    };
  } catch (error) {
    console.error("Error in toggleCommentLike:", error);
    return null;
  }
};

export const getCommentCounts = async (
  marketIds: string[]
): Promise<Record<string, number>> => {
  if (!isSupabaseConfigured()) {
    console.warn("Supabase not configured, using fallback comment counts");
    const counts: Record<string, number> = {};
    marketIds.forEach((id) => {
      counts[id] = fallbackComments.filter((c) => c.marketId === id).length;
    });
    return counts;
  }

  try {
    if (marketIds.length === 0) return {};

    const { data, error } = await supabase
      .from("comments")
      .select("market_id")
      .in("market_id", marketIds);

    if (error) {
      console.error("Error fetching comment counts:", error);
      return {};
    }

    // Count comments per market
    const counts: Record<string, number> = {};
    marketIds.forEach((id) => (counts[id] = 0));

    data.forEach((comment) => {
      counts[comment.market_id] = (counts[comment.market_id] || 0) + 1;
    });

    return counts;
  } catch (error) {
    console.error("Error in getCommentCounts:", error);
    return {};
  }
};
