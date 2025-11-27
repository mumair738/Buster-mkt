export interface LeaderboardEntry {
  rank: number;
  username: string;
  fid: string;
  pfp_url: string | null;
  winnings: number;
  voteCount: number;
  accuracy: number;
  trend: "up" | "down" | "none";
  address: string;
}

export type TimeFrame = "all" | "monthly" | "weekly";
export type LeaderboardType = "accuracy" | "volume";
