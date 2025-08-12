"use client";

import { UserStats } from "@/components/UserStats";
import { VoteHistory } from "@/components/VoteHistory";
import { useAccount } from "wagmi";
import { useFarcasterUser } from "@/hooks/useFarcasterUser";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  User,
  Wallet,
  BarChart3,
  TrendingUp,
  PieChart,
  Activity,
} from "lucide-react";
import Link from "next/link";

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const farcasterUser = useFarcasterUser();

  const displayName =
    farcasterUser?.username ||
    (address ? `${address.slice(0, 6)}...${address.slice(-4)}` : "Anonymous");

  const profileImage = farcasterUser?.pfpUrl;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="container mx-auto p-4 md:p-6 max-w-6xl">
        {isConnected ? (
          <>
            {/* Profile Header */}
            <Card className="mb-8 overflow-hidden border-0 shadow-lg bg-gradient-to-r from-blue-600 to-purple-600 text-white">
              <CardContent className="p-6 md:p-8">
                <div className="flex flex-col md:flex-row items-center gap-6">
                  <Avatar className="w-24 h-24 md:w-32 md:h-32 border-4 border-white/20 shadow-xl">
                    <AvatarImage
                      src={profileImage}
                      alt={displayName}
                      className="object-cover"
                    />
                    <AvatarFallback className="bg-white/10 text-white text-2xl font-bold">
                      {farcasterUser?.username ? (
                        farcasterUser.username.charAt(0).toUpperCase()
                      ) : (
                        <User className="w-12 h-12" />
                      )}
                    </AvatarFallback>
                  </Avatar>

                  <div className="text-center md:text-left flex-1">
                    <h1 className="text-3xl md:text-4xl font-bold mb-2">
                      {displayName}
                    </h1>

                    {farcasterUser && (
                      <div className="flex flex-wrap gap-2 justify-center md:justify-start mb-3">
                        <Badge
                          variant="secondary"
                          className="bg-white/20 text-white border-white/30"
                        >
                          <User className="w-3 h-3 mr-1" />
                          FID: {farcasterUser.fid}
                        </Badge>
                      </div>
                    )}

                    {address && (
                      <div className="flex items-center gap-2 justify-center md:justify-start text-white/80">
                        <Wallet className="w-4 h-4" />
                        <span className="font-mono text-sm">
                          {address.slice(0, 8)}...{address.slice(-6)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Stats Section */}
              <div className="lg:col-span-1 space-y-6">
                <UserStats />

                {/* V2 Analytics Quick Access */}
                <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-purple-50">
                  <CardContent className="p-6">
                    <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
                      <BarChart3 className="h-5 w-5 text-blue-600" />
                      V2 Analytics
                    </h3>
                    <p className="text-sm text-gray-600 mb-4">
                      Access advanced analytics for V2 prediction markets
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <Link href="/analytics?tab=portfolio">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-start gap-2"
                        >
                          <PieChart className="h-4 w-4" />
                          Portfolio
                        </Button>
                      </Link>
                      <Link href="/analytics?tab=markets">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-start gap-2"
                        >
                          <BarChart3 className="h-4 w-4" />
                          Markets
                        </Button>
                      </Link>
                      <Link href="/analytics?tab=prices">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-start gap-2"
                        >
                          <TrendingUp className="h-4 w-4" />
                          Prices
                        </Button>
                      </Link>
                      <Link href="/analytics?tab=volume">
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-start gap-2"
                        >
                          <Activity className="h-4 w-4" />
                          Volume
                        </Button>
                      </Link>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Activity Feed */}
              <div className="lg:col-span-2">
                <div className="space-y-6">
                  <div className="flex items-center gap-3">
                    <h2 className="text-2xl font-bold text-gray-900">
                      Activity Feed
                    </h2>
                    <Badge variant="outline" className="text-sm">
                      Recent Votes
                    </Badge>
                  </div>
                  <VoteHistory />
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="min-h-[60vh] flex items-center justify-center">
            <Card className="w-full max-w-md">
              <CardContent className="p-8 text-center">
                <div className="w-16 h-16 mx-auto mb-4 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full flex items-center justify-center">
                  <Wallet className="w-8 h-8 text-blue-600" />
                </div>
                <h2 className="text-xl font-semibold mb-2 text-gray-800">
                  Connect Your Wallet
                </h2>
                <p className="text-gray-600">
                  Connect your wallet to view your profile, stats, and trading
                  history.
                </p>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
