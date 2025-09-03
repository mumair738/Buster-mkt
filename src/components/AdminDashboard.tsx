"use client";

import { useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreateMarketV2 } from "./CreateMarketV2";
import { MarketResolver } from "./MarketResolver";
import { AdminLiquidityManager } from "./AdminLiquidityManager";
import { AdminRoleManager } from "./AdminRoleManager";
import { MarketValidationManager } from "./MarketValidationManager";
import { MarketInvalidationManager } from "./MarketInvalidationManager";
import { BatchDistributionManager } from "./BatchDistributionManager";
import { V3AdminDashboard } from "./V3AdminDashboard";
import { useUserRoles } from "@/hooks/useUserRoles";
import { V2contractAddress, V2contractAbi } from "@/constants/contract";
import {
  Settings,
  Plus,
  Gavel,
  DollarSign,
  Users,
  Shield,
  BarChart3,
  AlertTriangle,
  CheckCircle,
  Wallet,
  Send,
} from "lucide-react";

export function AdminDashboard() {
  const { isConnected } = useAccount();
  const {
    hasCreatorAccess,
    hasResolverAccess,
    hasValidatorAccess,
    isAdmin,
    isOwner,
  } = useUserRoles();
  const [activeTab, setActiveTab] = useState("create");

  // Get some basic stats
  const { data: marketCount } = useReadContract({
    address: V2contractAddress,
    abi: V2contractAbi,
    functionName: "getMarketCount",
    query: { enabled: isConnected },
  });

  const hasAnyAccess =
    hasCreatorAccess || hasResolverAccess || hasValidatorAccess || isAdmin;

  if (!isConnected) {
    return (
      <Card>
        <CardContent className="p-4 md:p-6 text-center">
          <Shield className="h-12 w-12 md:h-16 md:w-16 mx-auto text-gray-400 mb-3 md:mb-4" />
          <h3 className="text-base md:text-lg font-medium mb-2">
            Connect Your Wallet
          </h3>
          <p className="text-sm md:text-base text-gray-600">
            Please connect your wallet to access admin functions.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!hasAnyAccess) {
    return (
      <Card>
        <CardContent className="p-4 md:p-6 text-center">
          <AlertTriangle className="h-12 w-12 md:h-16 md:w-16 mx-auto text-red-400 mb-3 md:mb-4" />
          <h3 className="text-base md:text-lg font-medium mb-2">
            Access Denied
          </h3>
          <p className="text-sm md:text-base text-gray-600">
            You don&apos;t have permission to access admin functions. Contact
            the contract owner to request access.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6 mb-16 md:mb-20">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-0">
        <div>
          <h1 className="text-xl md:text-3xl font-bold text-gray-900 dark:text-white">
            Admin Dashboard
          </h1>
          <p className="text-sm md:text-base text-gray-600 dark:text-gray-300">
            Manage prediction markets and platform settings
          </p>
        </div>
        <div className="flex items-center gap-1 md:gap-2 flex-wrap">
          {isOwner && (
            <Badge
              variant="default"
              className="text-xs md:text-sm px-2 py-0.5 md:px-3 md:py-1"
            >
              Owner
            </Badge>
          )}
          {isAdmin && !isOwner && (
            <Badge
              variant="secondary"
              className="text-xs md:text-sm px-2 py-0.5 md:px-3 md:py-1"
            >
              Admin
            </Badge>
          )}
          {hasCreatorAccess && !isAdmin && (
            <Badge
              variant="outline"
              className="text-xs md:text-sm px-2 py-0.5 md:px-3 md:py-1"
            >
              Creator
            </Badge>
          )}
          {hasResolverAccess && !isAdmin && (
            <Badge
              variant="outline"
              className="text-xs md:text-sm px-2 py-0.5 md:px-3 md:py-1"
            >
              Resolver
            </Badge>
          )}
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-6">
        <Card>
          <CardContent className="p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm font-medium text-muted-foreground">
                  Total Markets
                </p>
                <p className="text-lg md:text-2xl font-bold">
                  {marketCount ? Number(marketCount) : "0"}
                </p>
              </div>
              <BarChart3 className="h-6 w-6 md:h-8 md:w-8 text-blue-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm font-medium text-muted-foreground">
                  Your Role
                </p>
                <p className="text-lg md:text-2xl font-bold">
                  {isOwner ? "Owner" : isAdmin ? "Admin" : "Creator"}
                </p>
              </div>
              <Shield className="h-6 w-6 md:h-8 md:w-8 text-green-600" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 md:p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs md:text-sm font-medium text-muted-foreground">
                  Platform
                </p>
                <p className="text-lg md:text-2xl font-bold">Policast</p>
              </div>
              <Settings className="h-6 w-6 md:h-8 md:w-8 text-purple-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Admin Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="flex flex-wrap justify-start gap-1 h-auto p-1 md:grid md:grid-cols-8 bg-muted">
          {hasCreatorAccess && (
            <TabsTrigger
              value="create"
              className="flex items-center gap-1 md:gap-2 flex-1 min-w-[100px] md:min-w-0 text-xs md:text-sm px-2 md:px-3 py-1.5 md:py-2"
            >
              <Plus className="h-3 w-3 md:h-4 md:w-4" />
              <span className="hidden sm:inline">Create</span>
            </TabsTrigger>
          )}
          {hasValidatorAccess && (
            <TabsTrigger
              value="validate"
              className="flex items-center gap-1 md:gap-2 flex-1 min-w-[100px] md:min-w-0 text-xs md:text-sm px-2 md:px-3 py-1.5 md:py-2"
            >
              <CheckCircle className="h-3 w-3 md:h-4 md:w-4" />
              <span className="hidden sm:inline">Validate</span>
            </TabsTrigger>
          )}
          {hasValidatorAccess && (
            <TabsTrigger
              value="invalidate"
              className="flex items-center gap-1 md:gap-2 flex-1 min-w-[100px] md:min-w-0 text-xs md:text-sm px-2 md:px-3 py-1.5 md:py-2"
            >
              <AlertTriangle className="h-3 w-3 md:h-4 md:w-4" />
              <span className="hidden sm:inline">Invalidate</span>
            </TabsTrigger>
          )}
          {hasResolverAccess && (
            <TabsTrigger
              value="resolve"
              className="flex items-center gap-1 md:gap-2 flex-1 min-w-[100px] md:min-w-0 text-xs md:text-sm px-2 md:px-3 py-1.5 md:py-2"
            >
              <Gavel className="h-3 w-3 md:h-4 md:w-4" />
              <span className="hidden sm:inline">Resolve</span>
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger
              value="distribute"
              className="flex items-center gap-1 md:gap-2 flex-1 min-w-[100px] md:min-w-0 text-xs md:text-sm px-2 md:px-3 py-1.5 md:py-2"
            >
              <Send className="h-3 w-3 md:h-4 md:w-4" />
              <span className="hidden sm:inline">Distribute</span>
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger
              value="liquidity"
              className="flex items-center gap-1 md:gap-2 flex-1 min-w-[100px] md:min-w-0 text-xs md:text-sm px-2 md:px-3 py-1.5 md:py-2"
            >
              <DollarSign className="h-3 w-3 md:h-4 md:w-4" />
              <span className="hidden sm:inline">Liquidity</span>
            </TabsTrigger>
          )}
          {(isOwner || isAdmin) && (
            <TabsTrigger
              value="v3platform"
              className="flex items-center gap-1 md:gap-2 flex-1 min-w-[100px] md:min-w-0 text-xs md:text-sm px-2 md:px-3 py-1.5 md:py-2"
            >
              <Wallet className="h-3 w-3 md:h-4 md:w-4" />
              <span className="hidden sm:inline">V3 Platform</span>
            </TabsTrigger>
          )}
          {isOwner && (
            <TabsTrigger
              value="roles"
              className="flex items-center gap-1 md:gap-2 flex-1 min-w-[100px] md:min-w-0 text-xs md:text-sm px-2 md:px-3 py-1.5 md:py-2"
            >
              <Users className="h-3 w-3 md:h-4 md:w-4" />
              <span className="hidden sm:inline">Roles</span>
            </TabsTrigger>
          )}
        </TabsList>

        {/* Create Markets Tab */}
        {hasCreatorAccess && (
          <TabsContent
            value="create"
            className="space-y-4 md:space-y-6 mt-3 md:mt-6"
          >
            <CreateMarketV2 />
          </TabsContent>
        )}

        {/* Validate Markets Tab */}
        {hasValidatorAccess && (
          <TabsContent
            value="validate"
            className="space-y-4 md:space-y-6 mt-3 md:mt-6"
          >
            <MarketValidationManager />
          </TabsContent>
        )}

        {/* Invalidate Markets Tab */}
        {hasValidatorAccess && (
          <TabsContent
            value="invalidate"
            className="space-y-4 md:space-y-6 mt-3 md:mt-6"
          >
            <MarketInvalidationManager />
          </TabsContent>
        )}

        {/* Resolve Markets Tab */}
        {hasResolverAccess && (
          <TabsContent
            value="resolve"
            className="space-y-4 md:space-y-6 mt-3 md:mt-6"
          >
            <MarketResolver />
          </TabsContent>
        )}

        {/* Batch Distribution Tab */}
        {isAdmin && (
          <TabsContent
            value="distribute"
            className="space-y-4 md:space-y-6 mt-3 md:mt-6"
          >
            <BatchDistributionManager />
          </TabsContent>
        )}

        {/* Liquidity Management Tab */}
        {isAdmin && (
          <TabsContent
            value="liquidity"
            className="space-y-4 md:space-y-6 mt-3 md:mt-6"
          >
            <AdminLiquidityManager />
          </TabsContent>
        )}

        {/* V3 Platform Management Tab */}
        {(isOwner || isAdmin) && (
          <TabsContent
            value="v3platform"
            className="space-y-4 md:space-y-6 mt-3 md:mt-6"
          >
            <V3AdminDashboard />
          </TabsContent>
        )}

        {/* Role Management Tab */}
        {isOwner && (
          <TabsContent
            value="roles"
            className="space-y-4 md:space-y-6 mt-3 md:mt-6"
          >
            <AdminRoleManager />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
