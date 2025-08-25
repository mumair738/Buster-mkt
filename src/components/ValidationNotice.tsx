"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, CheckCircle, AlertTriangle, Info, Shield } from "lucide-react";
import Link from "next/link";

interface ValidationNoticeProps {
  marketId?: number;
  status: "pending" | "validated" | "info";
  message?: string;
}

export function ValidationNotice({
  marketId,
  status,
  message,
}: ValidationNoticeProps) {
  const getStatusConfig = () => {
    switch (status) {
      case "pending":
        return {
          icon: Clock,
          color: "bg-orange-50 border-orange-200 text-orange-800",
          badgeColor: "bg-orange-100 text-orange-700",
          title: "Market Pending Validation",
          defaultMessage:
            "This market is waiting for admin validation before it can accept predictions.",
        };
      case "validated":
        return {
          icon: CheckCircle,
          color: "bg-green-50 border-green-200 text-green-800",
          badgeColor: "bg-green-100 text-green-700",
          title: "Market Validated",
          defaultMessage:
            "This market has been validated and is ready for predictions.",
        };
      case "info":
        return {
          icon: Info,
          color: "bg-blue-50 border-blue-200 text-blue-800",
          badgeColor: "bg-blue-100 text-blue-700",
          title: "Validation Required",
          defaultMessage:
            "All new markets require validation by an admin before going live.",
        };
      default:
        return {
          icon: AlertTriangle,
          color: "bg-gray-50 border-gray-200 text-gray-800",
          badgeColor: "bg-gray-100 text-gray-700",
          title: "Unknown Status",
          defaultMessage: "Market status unknown.",
        };
    }
  };

  const config = getStatusConfig();
  const IconComponent = config.icon;

  return (
    <Card className={`${config.color} border`}>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <IconComponent className="h-5 w-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-medium">{config.title}</h3>
              <Badge className={config.badgeColor}>
                {status.charAt(0).toUpperCase() + status.slice(1)}
              </Badge>
            </div>
            <p className="text-sm">{message || config.defaultMessage}</p>

            {status === "pending" && (
              <div className="mt-3 pt-3 border-t border-current border-opacity-20">
                <div className="flex items-center justify-between">
                  <p className="text-xs opacity-75">
                    Contact an admin to validate this market
                  </p>
                  <Link href="/admin">
                    <Button size="sm" variant="outline" className="h-7 text-xs">
                      <Shield className="h-3 w-3 mr-1" />
                      Admin Panel
                    </Button>
                  </Link>
                </div>
              </div>
            )}

            {status === "info" && (
              <div className="mt-3 pt-3 border-t border-current border-opacity-20">
                <p className="text-xs opacity-75">
                  Created markets will appear here after validation.
                </p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Component to show at the top of market pages
export function MarketValidationBanner() {
  return (
    <div className="mb-6">
      <ValidationNotice
        status="info"
        message="Markets created by users with creator roles are reviewed by validators before going live. This ensures quality and prevents spam while maintaining decentralized creation."
      />
    </div>
  );
}
