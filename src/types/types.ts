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
  SPONSORED = 2,
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
}

// V2 Market (Multi-option)
export interface MarketV2 {
  question: string;
  description: string;
  endTime: bigint;
  category: MarketCategory;
  marketType?: MarketType;
  optionCount: number;
  options: MarketOption[];
  resolved: boolean;
  disputed: boolean;
  validated: boolean;
  winningOptionId: number;
  creator: string;
  totalLiquidity?: bigint;
  totalVolume?: bigint;
  createdAt?: bigint;
  // V3 Financial Tracking
  adminInitialLiquidity?: bigint;
  userLiquidity?: bigint;
  platformFeesCollected?: bigint;
  ammFeesCollected?: bigint;
  adminLiquidityClaimed?: boolean;
  // Free Entry Configuration
  freeEntryConfig?: {
    maxFreeParticipants: bigint;
    freeSharesPerUser: bigint;
    currentFreeParticipants: bigint;
    isActive: boolean;
  };
  // Sponsored Market Configuration
  sponsoredConfig?: {
    sponsor: string;
    sponsorPrize: bigint;
    minimumParticipants: bigint;
    sponsorMessage: string;
  };
  // AMM Configuration
  ammConfig?: {
    tokenReserve: bigint;
    totalLiquidity: bigint;
    feeRate: bigint;
  };
}

// V2 User Portfolio
export interface UserPortfolio {
  totalInvested: bigint;
  totalWinnings: bigint;
  unrealizedPnL: bigint;
  realizedPnL: bigint;
  tradeCount: number;
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
