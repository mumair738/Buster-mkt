// V1 Market (Legacy - Binary options)
export interface Market {
  question: string;
  optionA: string;
  optionB: string;
  endTime: string;
  outcome: string;
  totalOptionAShares: number;
  totalOptionBShares: number;
  resolved: boolean;
}

// V2 Market Types
export enum MarketType {
  PAID = 0,
  FREE_ENTRY = 1,
}

// V2 Market Categories
export enum MarketCategory {
  POLITICS = 0,
  SPORTS = 1,
  ENTERTAINMENT = 2,
  TECHNOLOGY = 3,
  ECONOMICS = 4,
  SCIENCE = 5,
  WEATHER = 6,
  OTHER = 7,
}

// V2 Market Option
export interface MarketOption {
  name: string;
  description: string;
  totalShares: bigint;
  totalVolume: bigint;
  currentPrice: bigint;
  isActive: boolean;
  k?: bigint; // AMM liquidity constant for this option
  reserve?: bigint; // AMM reserve for this option
}

// V2 Market (Multi-option)
export interface MarketV2 {
  question: string;
  description: string;
  endTime: bigint;
  category: MarketCategory;
  marketType: MarketType;
  optionCount: number;
  options: MarketOption[];
  resolved: boolean;
  disputed: boolean;
  validated: boolean;
  invalidated: boolean; // Market has been invalidated by admin
  winningOptionId: number;
  creator: string;
  createdAt: bigint;
  // V3 Financial Tracking
  adminInitialLiquidity: bigint;
  userLiquidity: bigint;
  totalVolume: bigint;
  platformFeesCollected: bigint;
  ammFeesCollected: bigint;
  adminLiquidityClaimed: boolean;
  ammLiquidityPool: bigint;
  payoutIndex: bigint;
  // Free Entry Configuration
  freeConfig?: FreeMarketConfig;
  // AMM Configuration
  ammConfig?: {
    tokenReserve: bigint;
    totalLiquidity: bigint;
    feeRate: bigint;
  };
}

// Free Entry Configuration
export interface FreeMarketConfig {
  maxFreeParticipants: bigint;
  tokensPerParticipant: bigint;
  currentFreeParticipants: bigint;
  totalPrizePool: bigint;
  remainingPrizePool: bigint;
  isActive: boolean;
}

// V2 User Portfolio
export interface UserPortfolio {
  totalInvested: bigint;
  totalWinnings: bigint;
  unrealizedPnL: bigint;
  realizedPnL: bigint;
  tradeCount: number;
}

// Trade data structure from contract
export interface Trade {
  marketId: bigint;
  optionId: bigint;
  buyer: string;
  seller: string;
  price: bigint;
  quantity: bigint;
  timestamp: bigint;
}

// Price point for market history
export interface PricePoint {
  price: bigint;
  timestamp: bigint;
  volume: bigint;
}

// V2 Market Stats from Contract
export interface MarketStatsV2 {
  totalVolume: bigint;
  participantCount: number;
  averagePrice: bigint;
  priceVolatility: bigint;
  lastTradePrice: bigint;
  lastTradeTime: bigint;
}

export interface PriceHistoryData {
  date?: string;
  timestamp: number;
  volume: number;
  trades?: number;
  // V1 Binary options
  optionA?: number;
  optionB?: number;
  // V2 Multi-options (dynamic properties)
  [key: string]: any; // Allows option0, option1, etc.
}

// V3 Financial Data Types
export interface MarketFinancials {
  adminInitialLiquidity: bigint;
  userLiquidity: bigint;
  platformFeesCollected: bigint;
  ammFeesCollected: bigint;
  adminLiquidityClaimed: boolean;
}

export interface LPInfo {
  contribution: bigint;
  rewardsClaimed: boolean;
  estimatedRewards: bigint;
}

export interface PlatformStats {
  totalFeesCollected: bigint;
  currentFeeCollector: string;
  totalMarkets: bigint;
  totalTrades: bigint;
}

// Free market claim status
export interface FreeMarketClaimStatus {
  hasClaimed: boolean;
  tokensReceived: bigint;
  canClaim: boolean;
  slotsRemaining: bigint;
}

// Market creation parameters for different types
export interface CreateMarketParams {
  question: string;
  description: string;
  optionNames: string[];
  optionDescriptions: string[];
  duration: bigint;
  category: MarketCategory;
  marketType: MarketType;
  initialLiquidity: bigint;
}

export interface CreateFreeMarketParams extends CreateMarketParams {
  maxFreeParticipants: bigint;
  tokensPerParticipant: bigint;
}

// Batch Distribution Types
export interface BatchDistributionRequest {
  marketId: number;
  recipients: string[];
}

export interface BatchDistributionPreview {
  recipients: string[];
  amounts: string[];
  totalRecipients: number;
  totalAmount: number;
}

export interface BatchDistributionResult {
  success: boolean;
  totalDistributed: bigint;
  recipientCount: number;
  txHash?: string;
  error?: string;
}

// User Winnings Information
export interface UserWinnings {
  hasWinnings: boolean;
  amount: bigint;
  hasClaimed: boolean;
  marketId: number;
  winningOptionId: number;
}

export interface VolumeHistoryData {
  date: string;
  timestamp: number;
  volume: number;
  trades: number;
}

export interface MarketAnalytics {
  priceHistory: PriceHistoryData[];
  volumeHistory: VolumeHistoryData[];
  totalVolume: number;
  totalTrades: number;
  priceChange24h: number;
  volumeChange24h: number;
  lastUpdated: string;
}

export interface MarketStats {
  marketId: string;
  currentPriceA: number;
  currentPriceB: number;
  totalShares: number;
  totalVolume: number;
  confidence: number;
  trend: "up" | "down" | "stable";
}
