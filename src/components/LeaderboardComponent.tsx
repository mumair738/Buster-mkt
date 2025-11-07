"use client";

import { useState } from "react";
import { ArrowUpCircle, ArrowDownCircle, Info, ArrowLeft } from "lucide-react";

type LeaderboardType = "Accuracy" | "Trading Volume";
type TimeFrame = "All-Time" | "Monthly" | "Weekly";

interface LeaderboardProps {
  onTabChange?: (tab: string) => void;
  isLoading?: boolean;
  error?: string | null;
  data?: {
    users: UserData[];
    currentUser: UserData;
  };
}

interface UserData {
  rank: number;
  name: string;
  predictions?: number;
  accuracy: number;
  avatar: string;
  trend?: "up" | "down";
}

export default function LeaderboardComponent({
  onTabChange,
  isLoading,
  error,
  data,
}: LeaderboardProps) {
  const [leaderboardType, setLeaderboardType] =
    useState<LeaderboardType>("Accuracy");
  const [timeFrame, setTimeFrame] = useState<TimeFrame>("All-Time");

  // State management for filters

  if (isLoading) {
    return (
      <div className="flex justify-center items-center p-10">
        <svg
          className="animate-spin h-8 w-8 text-blue-500"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          ></circle>
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          ></path>
        </svg>
      </div>
    );
  }

  if (error) {
    return <div className="p-4 text-center text-red-600">{error}</div>;
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center p-6 text-center">
        <svg
          className="w-12 h-12 text-gray-400"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          />
        </svg>
        <p className="mt-2 text-sm font-medium text-gray-500">
          No leaderboard data available
        </p>
        <p className="mt-1 text-xs text-gray-400">
          Leaderboard will appear once predictions are resolved
        </p>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen w-full flex-col">
      {/* Top App Bar */}
      <div className="sticky top-0 z-10 flex items-center bg-background-light dark:bg-background-dark px-4 pt-4 pb-2">
        <h1 className="flex-1 text-center text-lg font-bold leading-tight tracking-[-0.015em] text-gray-900 dark:text-white">
          Leaderboard
        </h1>
      </div>

      {/* Segmented Buttons */}
      <div className="px-4 py-3">
        <div className="flex h-10 flex-1 items-center justify-center rounded-lg bg-gray-200 dark:bg-[#352c3f] p-1">
          {(["Accuracy", "Trading Volume"] as const).map((type) => (
            <label
              key={type}
              className="flex h-full grow cursor-pointer items-center justify-center overflow-hidden rounded-lg px-2 text-sm font-medium leading-normal text-gray-600 dark:text-[#ac9fbc] has-[:checked]:bg-white has-[:checked]:text-gray-900 has-[:checked]:shadow-sm dark:has-[:checked]:bg-primary dark:has-[:checked]:text-white"
            >
              <span className="truncate">{type}</span>
              <input
                type="radio"
                name="leaderboard_type"
                value={type}
                checked={leaderboardType === type}
                onChange={(e) =>
                  setLeaderboardType(e.target.value as LeaderboardType)
                }
                className="invisible w-0"
              />
            </label>
          ))}
        </div>
      </div>

      {/* Chips for Timeframe */}
      <div className="flex gap-3 px-4 pb-4 overflow-x-auto">
        {(["All-Time", "Monthly", "Weekly"] as const).map((time) => (
          <div
            key={time}
            onClick={() => setTimeFrame(time)}
            className={`flex h-8 shrink-0 cursor-pointer items-center justify-center gap-x-2 rounded-full ${
              timeFrame === time
                ? "bg-primary"
                : "bg-gray-200 dark:bg-[#352c3f]"
            } pl-4 pr-4`}
          >
            <p
              className={`text-sm font-medium leading-normal ${
                timeFrame === time
                  ? "text-white"
                  : "text-gray-800 dark:text-white"
              }`}
            >
              {time}
            </p>
          </div>
        ))}
      </div>

      {/* Podium Section */}
      <div className="flex items-end justify-center gap-4 px-4 py-6">
        {/* Map through top users in correct order for podium (2nd, 1st, 3rd) */}
        {[...data.users]
          .slice(0, 3)
          .sort((a, b) => {
            const order = [2, 1, 3];
            return order.indexOf(a.rank) - order.indexOf(b.rank);
          })
          .map((user) => (
            <div key={user.rank} className="flex flex-col items-center gap-2">
              <div className="relative">
                <div
                  className={`bg-center bg-no-repeat aspect-square bg-cover rounded-full ${
                    user.rank === 1
                      ? "w-28 h-28 border-4 border-[#FFD700]"
                      : 'w-20 h-20 border-2 border-[${user.rank === 2 ? "#C0C0C0" : "#CD7F32"}]'
                  }`}
                  style={{ backgroundImage: `url("${user.avatar}")` }}
                />
                <div
                  className={`absolute -bottom-2 -right-2 flex ${
                    user.rank === 1 ? "h-10 w-10 text-base" : "h-8 w-8 text-sm"
                  } items-center justify-center rounded-full ${
                    user.rank === 1
                      ? "bg-[#FFD700]"
                      : user.rank === 2
                      ? "bg-[#C0C0C0]"
                      : "bg-[#CD7F32]"
                  } font-bold text-white shadow-md`}
                >
                  {user.rank}
                </div>
              </div>
              <p
                className={`text-gray-900 dark:text-white ${
                  user.rank === 1
                    ? "text-base font-bold"
                    : "text-sm font-semibold"
                }`}
              >
                {user.name}
              </p>
              <p
                className={`${
                  user.rank === 1
                    ? "text-primary text-sm font-semibold"
                    : "text-gray-500 dark:text-[#ac9fbc] text-xs"
                }`}
              >
                {user.accuracy}%
              </p>
            </div>
          ))}
      </div>

      {/* Leaderboard List */}
      <div className="flex flex-col gap-2 px-4 pb-24">
        {data.users.slice(3).map((user) => (
          <div
            key={user.rank}
            className="flex items-center rounded-lg bg-gray-100 dark:bg-[#352c3f]/50 p-3 gap-4"
          >
            <p className="w-6 text-center text-sm font-semibold text-gray-500 dark:text-gray-400">
              {user.rank}
            </p>
            <img
              className="h-10 w-10 rounded-full object-cover"
              src={user.avatar}
              alt={`${user.name}'s avatar`}
            />
            <div className="flex-grow">
              <p className="font-semibold text-gray-900 dark:text-white">
                {user.name}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {user.predictions} predictions
              </p>
            </div>
            <div className="flex items-center gap-2">
              <p className="font-bold text-gray-900 dark:text-white">
                {user.accuracy}%
              </p>
              {user.trend &&
                (user.trend === "up" ? (
                  <ArrowUpCircle className="text-green-500 size-5" />
                ) : (
                  <ArrowDownCircle className="text-red-500 size-5" />
                ))}
            </div>
          </div>
        ))}
      </div>

      {/* Sticky "My Rank" Banner */}
      {data.currentUser && (
        <div className="fixed bottom-0 left-0 right-0 z-10 p-4 bg-background-light/80 dark:bg-background-dark/80 backdrop-blur-sm">
          <div className="flex items-center rounded-lg bg-primary/20 dark:bg-primary/30 p-3 gap-4 border border-primary/50">
            <p className="w-6 text-center text-sm font-bold text-primary">
              {data.currentUser.rank}
            </p>
            <img
              className="h-10 w-10 rounded-full object-cover"
              src={data.currentUser.avatar}
              alt="Your avatar"
            />
            <div className="flex-grow">
              <p className="font-bold text-gray-900 dark:text-white">
                {data.currentUser.name}
              </p>
            </div>
            <p className="font-bold text-gray-900 dark:text-white">
              {data.currentUser.accuracy}% Accuracy
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
