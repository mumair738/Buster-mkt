"use client";

import { useState } from "react";
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
} from "wagmi";
import { isAddress } from "viem";
import { useToast } from "@/components/ui/use-toast";
import { V2contractAddress, V2contractAbi } from "@/constants/contract";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Users,
  UserPlus,
  UserMinus,
  Shield,
  AlertTriangle,
  Loader2,
  CheckCircle,
  Info,
} from "lucide-react";
import { useUserRoles } from "@/hooks/useUserRoles";

type RoleType = "creator" | "resolver" | "validator" | "admin";

const ROLE_INFO = {
  creator: {
    label: "Question Creator",
    description: "Can create new prediction markets",
    icon: UserPlus,
    color: "bg-blue-100 text-blue-700",
  },
  resolver: {
    label: "Question Resolver",
    description: "Can resolve markets and handle disputes",
    icon: Shield,
    color: "bg-green-100 text-green-700",
  },
  validator: {
    label: "Market Validator",
    description: "Can validate markets before they go live",
    icon: CheckCircle,
    color: "bg-purple-100 text-purple-700",
  },
  admin: {
    label: "Platform Admin",
    description: "Full admin access to all platform functions",
    icon: Shield,
    color: "bg-red-100 text-red-700",
  },
};

export function AdminRoleManager() {
  const { isConnected } = useAccount();
  const { isOwner } = useUserRoles();
  const { toast } = useToast();

  const [selectedRole, setSelectedRole] = useState<RoleType>("creator");
  const [targetAddress, setTargetAddress] = useState("");
  const [action, setAction] = useState<"grant" | "revoke">("grant");

  const { writeContract, data: hash, error, isPending } = useWriteContract();

  const { isLoading: isConfirming, isSuccess: isConfirmed } =
    useWaitForTransactionReceipt({
      hash,
    });

  const getRoleFunctionName = (role: RoleType, action: "grant" | "revoke") => {
    const actionPrefix = action === "grant" ? "grant" : "revoke";

    switch (role) {
      case "creator":
        return action === "grant" ? "grantQuestionCreatorRole" : "revokeRole";
      case "resolver":
        return action === "grant" ? "grantQuestionResolveRole" : "revokeRole";
      case "validator":
        return action === "grant" ? "grantMarketValidatorRole" : "revokeRole";
      case "admin":
        return action === "grant" ? "grantRole" : "revokeRole";
      default:
        return "grantRole";
    }
  };

  const getRoleBytes32 = (role: RoleType) => {
    // These should be the actual keccak256 hashes from the contract
    switch (role) {
      case "creator":
        return "0x1234567890123456789012345678901234567890123456789012345678901234";
      case "resolver":
        return "0x1234567890123456789012345678901234567890123456789012345678901235";
      case "validator":
        return "0x1234567890123456789012345678901234567890123456789012345678901236";
      case "admin":
        return "0x0000000000000000000000000000000000000000000000000000000000000000";
      default:
        return "0x0000000000000000000000000000000000000000000000000000000000000000";
    }
  };

  const handleRoleAction = async () => {
    if (!targetAddress || !isAddress(targetAddress) || !isOwner) {
      toast({
        title: "Error",
        description: "Please enter a valid Ethereum address.",
        variant: "destructive",
      });
      return;
    }

    try {
      const functionName = getRoleFunctionName(selectedRole, action);

      if (selectedRole === "creator" && action === "grant") {
        await writeContract({
          address: V2contractAddress,
          abi: V2contractAbi,
          functionName: "grantQuestionCreatorRole",
          args: [targetAddress as `0x${string}`],
        });
      } else if (selectedRole === "resolver" && action === "grant") {
        await writeContract({
          address: V2contractAddress,
          abi: V2contractAbi,
          functionName: "grantQuestionResolveRole",
          args: [targetAddress as `0x${string}`],
        });
      } else if (selectedRole === "validator" && action === "grant") {
        await writeContract({
          address: V2contractAddress,
          abi: V2contractAbi,
          functionName: "grantMarketValidatorRole",
          args: [targetAddress as `0x${string}`],
        });
      } else if (action === "grant") {
        // Grant admin role
        await writeContract({
          address: V2contractAddress,
          abi: V2contractAbi,
          functionName: "grantRole",
          args: [getRoleBytes32(selectedRole), targetAddress as `0x${string}`],
        });
      } else {
        // Revoke any role
        await writeContract({
          address: V2contractAddress,
          abi: V2contractAbi,
          functionName: "revokeRole",
          args: [getRoleBytes32(selectedRole), targetAddress as `0x${string}`],
        });
      }

      // Clear form on success
      setTargetAddress("");
    } catch (error) {
      console.error("Error managing role:", error);
      toast({
        title: "Error",
        description: `Failed to ${action} role.`,
        variant: "destructive",
      });
    }
  };

  if (!isConnected) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <Users className="h-16 w-16 mx-auto text-gray-400 mb-4" />
          <h3 className="text-lg font-medium mb-2">Connect Your Wallet</h3>
          <p className="text-gray-600">
            Please connect your wallet to manage user roles.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!isOwner) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <AlertTriangle className="h-16 w-16 mx-auto text-red-400 mb-4" />
          <h3 className="text-lg font-medium mb-2">Owner Access Required</h3>
          <p className="text-gray-600">
            Only the contract owner can manage user roles and permissions.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isConfirmed) {
    return (
      <Card>
        <CardContent className="p-6 text-center">
          <CheckCircle className="h-16 w-16 mx-auto text-green-500 mb-4" />
          <h3 className="text-lg font-medium mb-2">
            Role Updated Successfully!
          </h3>
          <p className="text-gray-600 mb-4">
            The user role has been {action === "grant" ? "granted" : "revoked"}.
          </p>
          <Button onClick={() => window.location.reload()}>
            Continue Managing Roles
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Role Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5" />
            Platform Roles Overview
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(ROLE_INFO).map(([key, role]) => {
              const IconComponent = role.icon;
              return (
                <div key={key} className="p-4 border rounded-lg">
                  <div className="flex items-center gap-3 mb-2">
                    <IconComponent className="h-5 w-5" />
                    <h3 className="font-medium">{role.label}</h3>
                    <Badge className={role.color}>{key.toUpperCase()}</Badge>
                  </div>
                  <p className="text-sm text-gray-600">{role.description}</p>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Role Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Manage User Roles
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="action">Action</Label>
              <Select
                value={action}
                onValueChange={(value: "grant" | "revoke") => setAction(value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="grant">Grant Role</SelectItem>
                  <SelectItem value="revoke">Revoke Role</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Role Type</Label>
              <Select
                value={selectedRole}
                onValueChange={(value: RoleType) => setSelectedRole(value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="creator">Question Creator</SelectItem>
                  <SelectItem value="resolver">Question Resolver</SelectItem>
                  <SelectItem value="validator">Market Validator</SelectItem>
                  <SelectItem value="admin">Platform Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="address">User Address *</Label>
            <Input
              id="address"
              placeholder="0x..."
              value={targetAddress}
              onChange={(e) => setTargetAddress(e.target.value)}
              className={
                targetAddress && !isAddress(targetAddress)
                  ? "border-red-500"
                  : ""
              }
            />
            {targetAddress && !isAddress(targetAddress) && (
              <p className="text-sm text-red-600">
                Please enter a valid Ethereum address.
              </p>
            )}
          </div>

          <Separator />

          {/* Action Summary */}
          <div className="p-4 bg-gray-50 rounded-lg">
            <h3 className="font-medium mb-2">Action Summary</h3>
            <div className="space-y-1 text-sm">
              <p>
                <span className="font-medium">Action:</span>{" "}
                {action === "grant" ? "Grant" : "Revoke"}
              </p>
              <p>
                <span className="font-medium">Role:</span>{" "}
                {ROLE_INFO[selectedRole].label}
              </p>
              <p>
                <span className="font-medium">Target Address:</span>{" "}
                {targetAddress || "Not specified"}
              </p>
            </div>

            {selectedRole && (
              <div className="mt-3 p-3 bg-white border rounded">
                <p className="text-sm">
                  <span className="font-medium">Permission:</span>{" "}
                  {ROLE_INFO[selectedRole].description}
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleRoleAction}
              disabled={
                !targetAddress ||
                !isAddress(targetAddress) ||
                isPending ||
                isConfirming
              }
              className="flex items-center gap-2"
            >
              {isPending || isConfirming ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : action === "grant" ? (
                <UserPlus className="h-4 w-4" />
              ) : (
                <UserMinus className="h-4 w-4" />
              )}
              {action === "grant" ? "Grant Role" : "Revoke Role"}
            </Button>

            <Button
              variant="outline"
              onClick={() => {
                setTargetAddress("");
                setSelectedRole("creator");
                setAction("grant");
              }}
            >
              Clear Form
            </Button>
          </div>

          {error && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 text-sm">Error: {error.message}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Security Notice */}
      <Card className="border-yellow-200 bg-yellow-50">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-medium text-yellow-800">Security Notice</h3>
              <p className="text-sm text-yellow-700 mt-1">
                Role management is a sensitive operation. Only grant roles to
                trusted addresses. Admin roles have significant permissions and
                should be used sparingly. Always verify the recipient address
                before granting permissions.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
