"use client";

import React, { useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useMarketAnalytics } from "@/hooks/useMarketAnalytics";
import { format } from "date-fns";

interface MarketChartProps {
  marketId: string;
}

const formatPrice = (value: number) => {
  return `$${value.toFixed(3)}`;
};

const formatVolume = (value: number) => {
  if (value >= 1000000) {
    return `$${(value / 1000000).toFixed(1)}M`;
  } else if (value >= 1000) {
    return `$${(value / 1000).toFixed(1)}K`;
  }
  return `$${value.toFixed(0)}`;
};

const formatDate = (dateStr: string) => {
  return format(new Date(dateStr), "MMM dd");
};

const CHART_COLORS = {
  optionA: "#3b82f6", // blue
  optionB: "#ef4444", // red
  volume: "#10b981", // green
  background: "hsl(var(--background))",
  foreground: "hsl(var(--foreground))",
  muted: "hsl(var(--muted-foreground))",
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-background border border-border rounded-lg p-3 shadow-lg">
        <p className="text-sm font-medium mb-2">{formatDate(label)}</p>
        {payload.map((entry: any, index: number) => (
          <p key={index} className="text-sm" style={{ color: entry.color }}>
            {entry.name}:{" "}
            {entry.dataKey === "volume" || entry.dataKey === "trades"
              ? entry.dataKey === "volume"
                ? formatVolume(entry.value)
                : entry.value.toLocaleString()
              : formatPrice(entry.value)}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

export default function MarketChart({ marketId }: MarketChartProps) {
  const [activeTab, setActiveTab] = useState("price");
  const {
    data: analytics,
    loading,
    error,
    lastUpdated,
  } = useMarketAnalytics({
    marketId,
    timeRange: "7d",
    refreshInterval: 30000, // 30 seconds
  });

  if (loading && !analytics) {
    return (
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-card-foreground">
            Market Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle className="text-card-foreground">
            Market Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <p>Error loading chart data</p>
              <p className="text-sm mt-1">{error}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const priceData = analytics?.priceHistory || [];
  const volumeData = analytics?.volumeHistory || [];

  // Calculate current prices (latest data point)
  const latestPrice = priceData[priceData.length - 1];
  const currentPriceA = latestPrice?.optionA || 0.5;
  const currentPriceB = latestPrice?.optionB || 0.5;

  // Market share data for pie chart
  const shareData = [
    {
      name: "Option A",
      value: currentPriceA * 100,
      color: CHART_COLORS.optionA,
    },
    {
      name: "Option B",
      value: currentPriceB * 100,
      color: CHART_COLORS.optionB,
    },
  ];

  return (
    <Card className="bg-card border-border">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-card-foreground">Market Analytics</CardTitle>
        <div className="flex items-center gap-2">
          {loading && (
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
          )}
          {lastUpdated && (
            <Badge variant="outline" className="text-xs">
              Updated {format(lastUpdated, "HH:mm")}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="price">Price</TabsTrigger>
            <TabsTrigger value="volume">Volume</TabsTrigger>
            <TabsTrigger value="distribution">Share</TabsTrigger>
            <TabsTrigger value="stats">Stats</TabsTrigger>
          </TabsList>

          <TabsContent value="price" className="space-y-4">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={priceData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDate}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                  />
                  <YAxis
                    tickFormatter={formatPrice}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    domain={[0, 1]}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="optionA"
                    stroke={CHART_COLORS.optionA}
                    strokeWidth={2}
                    name="Option A"
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="optionB"
                    stroke={CHART_COLORS.optionB}
                    strokeWidth={2}
                    name="Option B"
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </TabsContent>

          <TabsContent value="volume" className="space-y-4">
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={volumeData}>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                  />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDate}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                  />
                  <YAxis
                    tickFormatter={formatVolume}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar
                    dataKey="volume"
                    fill={CHART_COLORS.volume}
                    name="Volume"
                    radius={[2, 2, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </TabsContent>

          <TabsContent value="distribution" className="space-y-4">
            <div className="h-64 flex items-center justify-center">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={shareData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {shareData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => [
                      `${value.toFixed(1)}%`,
                      "Share",
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex justify-center gap-4">
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: CHART_COLORS.optionA }}
                />
                <span className="text-sm text-muted-foreground">
                  Option A: {(currentPriceA * 100).toFixed(1)}%
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: CHART_COLORS.optionB }}
                />
                <span className="text-sm text-muted-foreground">
                  Option B: {(currentPriceB * 100).toFixed(1)}%
                </span>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="stats" className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-muted/50 p-4 rounded-lg">
                <h4 className="text-sm font-medium text-muted-foreground mb-1">
                  Total Volume
                </h4>
                <p className="text-xl font-bold">
                  {formatVolume(analytics?.totalVolume || 0)}
                </p>
              </div>
              <div className="bg-muted/50 p-4 rounded-lg">
                <h4 className="text-sm font-medium text-muted-foreground mb-1">
                  Total Trades
                </h4>
                <p className="text-xl font-bold">
                  {(analytics?.totalTrades || 0).toLocaleString()}
                </p>
              </div>
              <div className="bg-muted/50 p-4 rounded-lg">
                <h4 className="text-sm font-medium text-muted-foreground mb-1">
                  24h Volume Change
                </h4>
                <p
                  className={`text-xl font-bold ${
                    (analytics?.volumeChange24h || 0) >= 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {(analytics?.volumeChange24h || 0) >= 0 ? "+" : ""}
                  {((analytics?.volumeChange24h || 0) * 100).toFixed(1)}%
                </p>
              </div>
              <div className="bg-muted/50 p-4 rounded-lg">
                <h4 className="text-sm font-medium text-muted-foreground mb-1">
                  24h Price Change
                </h4>
                <p
                  className={`text-xl font-bold ${
                    (analytics?.priceChange24h || 0) >= 0
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {(analytics?.priceChange24h || 0) >= 0 ? "+" : ""}
                  {((analytics?.priceChange24h || 0) * 100).toFixed(1)}%
                </p>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
