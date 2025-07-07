"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, Heart, Reply, Send, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useFarcasterUser } from "@/hooks/useFarcasterUser";

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
  parentId?: string;
  likes: number;
  likedBy: string[];
  replies?: Comment[];
}

interface CommentSystemProps {
  marketId: string;
  className?: string;
}

// Individual comment component
const CommentItem = ({
  comment,
  onReply,
  onLike,
  currentUserAddress,
  level = 0,
}: {
  comment: Comment;
  onReply: (parentId: string) => void;
  onLike: (commentId: string) => void;
  currentUserAddress?: string;
  level?: number;
}) => {
  const formatTimeAgo = (timestamp: number) => {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "Just now";
  };

  const hasLiked =
    currentUserAddress && comment.likedBy.includes(currentUserAddress);
  const isMaxDepth = level >= 2; // Limit reply depth

  return (
    <div
      className={`${level > 0 ? "ml-6 border-l-2 border-gray-100 pl-4" : ""}`}
    >
      <div className="bg-gray-50 rounded-lg p-4 mb-3">
        <div className="flex items-start justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-sm font-medium text-blue-700">
                {comment.author.username?.charAt(0).toUpperCase() || "?"}
              </span>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-900">
                {comment.author.username || `FID: ${comment.author.fid}`}
              </span>
              <span className="text-xs text-gray-500 ml-2">
                {formatTimeAgo(comment.timestamp)}
              </span>
            </div>
          </div>
        </div>

        <div className="text-sm text-gray-700 mb-3 leading-relaxed">
          <LinkifiedText text={comment.content} />
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onLike(comment.id)}
            className={`text-xs ${
              hasLiked ? "text-red-600" : "text-gray-500"
            } hover:text-red-600`}
          >
            <Heart
              className={`w-3 h-3 mr-1 ${hasLiked ? "fill-current" : ""}`}
            />
            {comment.likes}
          </Button>

          {!isMaxDepth && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onReply(comment.id)}
              className="text-xs text-gray-500 hover:text-blue-600"
            >
              <Reply className="w-3 h-3 mr-1" />
              Reply
            </Button>
          )}
        </div>
      </div>

      {/* Render replies */}
      {comment.replies && comment.replies.length > 0 && (
        <div className="space-y-2">
          {comment.replies.map((reply) => (
            <CommentItem
              key={reply.id}
              comment={reply}
              onReply={onReply}
              onLike={onLike}
              currentUserAddress={currentUserAddress}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// Simple linkified text component (reused from market details)
const LinkifiedText = ({ text }: { text: string }) => {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);

  return (
    <>
      {parts.map((part, index) =>
        urlRegex.test(part) ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:underline"
          >
            {part}
          </a>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  );
};

export function CommentSystem({ marketId, className }: CommentSystemProps) {
  const { address } = useAccount();
  const farcasterUser = useFarcasterUser();
  const { toast } = useToast();

  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [newComment, setNewComment] = useState("");
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState("");

  // Fetch comments
  const fetchComments = async () => {
    try {
      const response = await fetch(`/api/comments?marketId=${marketId}`);
      if (response.ok) {
        const data = await response.json();
        setComments(data.comments);
      }
    } catch (error) {
      console.error("Error fetching comments:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchComments();
  }, [marketId]);

  // Post new comment
  const handlePostComment = async (content: string, parentId?: string) => {
    if (!address || !content.trim()) return;

    setPosting(true);
    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          marketId,
          content: content.trim(),
          parentId,
          author: {
            fid: farcasterUser?.fid || "unknown",
            username: farcasterUser?.username || `User ${address.slice(0, 6)}`,
            pfpUrl: farcasterUser?.pfpUrl,
            address,
          },
        }),
      });

      if (response.ok) {
        const data = await response.json();
        toast({
          title: "Comment posted!",
          description: "Your comment has been added successfully.",
        });

        // Reset forms
        if (parentId) {
          setReplyContent("");
          setReplyingTo(null);
        } else {
          setNewComment("");
        }

        // Refresh comments
        fetchComments();
      } else {
        throw new Error("Failed to post comment");
      }
    } catch (error) {
      console.error("Error posting comment:", error);
      toast({
        title: "Error",
        description: "Failed to post comment. Please try again.",
        variant: "destructive",
      });
    } finally {
      setPosting(false);
    }
  };

  const handleLike = async (commentId: string) => {
    // TODO: Implement like functionality
    console.log("Like comment:", commentId);
  };

  const handleReply = (parentId: string) => {
    setReplyingTo(replyingTo === parentId ? null : parentId);
    setReplyContent("");
  };

  if (loading) {
    return (
      <Card className={className}>
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <MessageCircle className="w-5 h-5" />
          Discussion ({comments.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* New comment form */}
        {address ? (
          <div className="space-y-3">
            <Textarea
              placeholder="Share your thoughts on this market..."
              value={newComment}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                setNewComment(e.target.value)
              }
              maxLength={500}
              className="min-h-[80px]"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-gray-500">
                {newComment.length}/500 characters
              </span>
              <Button
                onClick={() => handlePostComment(newComment)}
                disabled={!newComment.trim() || posting}
                size="sm"
              >
                {posting ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <Send className="w-4 h-4 mr-2" />
                )}
                Post Comment
              </Button>
            </div>
          </div>
        ) : (
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-600">
              Connect your wallet to join the discussion
            </p>
          </div>
        )}

        {/* Comments list */}
        <div className="space-y-4">
          {comments.length === 0 ? (
            <div className="text-center p-8 text-gray-500">
              <MessageCircle className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No comments yet. Be the first to share your thoughts!</p>
            </div>
          ) : (
            comments.map((comment) => (
              <div key={comment.id}>
                <CommentItem
                  comment={comment}
                  onReply={handleReply}
                  onLike={handleLike}
                  currentUserAddress={address}
                />

                {/* Reply form */}
                {replyingTo === comment.id && (
                  <div className="ml-6 mt-3 p-4 bg-blue-50 rounded-lg">
                    <Textarea
                      placeholder={`Reply to ${comment.author.username}...`}
                      value={replyContent}
                      onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                        setReplyContent(e.target.value)
                      }
                      maxLength={500}
                      className="mb-3"
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={() =>
                          handlePostComment(replyContent, comment.id)
                        }
                        disabled={!replyContent.trim() || posting}
                        size="sm"
                      >
                        {posting ? (
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        ) : (
                          <Send className="w-4 h-4 mr-2" />
                        )}
                        Reply
                      </Button>
                      <Button
                        onClick={() => setReplyingTo(null)}
                        variant="outline"
                        size="sm"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}
