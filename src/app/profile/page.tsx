"use client";

import { UserStats } from "@/components/UserStats";
import { VoteHistory } from "@/components/VoteHistory";
import { useAccount } from "wagmi";
import { useFarcasterUser } from "@/hooks/useFarcasterUser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BarChart3,
  TrendingUp,
  PieChart,
  Activity,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const farcasterUser = useFarcasterUser();

  return (
    <div className="min-h-screen flex flex-col pb-20 md:pb-0 bg-gradient-to-br from-[#6A5ACD] via-[#E6E6FA] to-[#F0F8FF] dark:from-[#2D1B69] dark:via-[#1a1a2e] dark:to-[#16213e]">
      <Navbar />
      <div className="container mx-auto p-4 md:p-6 max-w-6xl">
        {isConnected ? (
          <>
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
                      Analytics
                    </h3>
                    <p className="text-sm text-gray-600 mb-4">
                      Access advanced analytics for prediction markets
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
      <Footer />
    </div>
  );
}
