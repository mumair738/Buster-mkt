// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {LMSRMath} from "./LMSRMath.sol";
import {PolicastLogic} from "./PolicastLogic.sol";

//check
contract PolicastMarketV3 is Ownable, ReentrancyGuard, AccessControl, Pausable {
    // ERRORS
    error InsufficientBalance();
    error InvalidMarket();
    error MarketNotActive();
    error InvalidOption();
    error NotAuthorized();
    error MarketAlreadyResolved();
    error MarketNotResolved();
    error AlreadyClaimed();
    error NoWinningShares();
    error TransferFailed();
    error InvalidInput();
    error OnlyAdminOrOwner();
    error MarketEnded();
    error MarketResolvedAlready();
    error OptionInactive();
    error FeeTooHigh();
    error BadDuration();
    error EmptyQuestion();
    error BadOptionCount();
    error LengthMismatch();
    error MinTokensRequired();
    error SamePrizeRequired();
    error NotFreeMarket();
    error FreeEntryInactive();
    error AlreadyClaimedFree();
    error FreeSlotseFull();
    error ExceedsFreeAllowance();
    error InsufficientPrizePool();
    error AmountMustBePositive();
    error InsufficientShares();
    error MarketNotValidated();
    error PriceTooHigh();
    error PriceTooLow();
    error MarketNotEndedYet();
    error InvalidWinningOption();
    error CannotDisputeIfWon();
    error MarketNotReady();
    error InvalidToken();
    error SameToken();
    error NoFeesToWithdraw();
    error AdminLiquidityAlreadyClaimed();
    error InsufficientParticipants();
    error MarketIsInvalidated();
    error MarketAlreadyInvalidated();
    error BatchDistributionFailed();
    error EmptyBatchList();
    error MarketTooNew(); // NEW: Prevent immediate resolution of event-based markets
    error InsufficientInitialLiquidity(); // NEW: Not enough liquidity to sustain LMSR worst-case loss
    error InconsistentCostInvariant(); // NEW: LMSR cost monotonicity violated
    error InsufficientSolvency(); // NEW: Insufficient backing for worst-case payout
    error SlippageExceeded(); // NEW: Aggregate slippage bound violated
    error ProbabilityInvariant(); // NEW: Sum of probabilities outside tolerance
    error PriceInvariant(); // NEW: Individual price invalid (>1e18 or unexpected zero)
    error NoUnlockedFees(); // NEW: No unlocked fees available for withdrawal
    error NoLiquidityToWithdraw(); // NEW: No admin liquidity available for withdrawal
    error InsufficientContractBalance(); // NEW: Contract doesn't have enough tokens for withdrawal

    bytes32 public constant QUESTION_CREATOR_ROLE = keccak256("QUESTION_CREATOR_ROLE");
    bytes32 public constant QUESTION_RESOLVE_ROLE = keccak256("QUESTION_RESOLVE_ROLE");
    bytes32 public constant MARKET_VALIDATOR_ROLE = keccak256("MARKET_VALIDATOR_ROLE");
    // New standardized role identifiers
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    // Alias for backward compatibility with QUESTION_CREATOR_ROLE (future migrations can consolidate)
    bytes32 public constant MARKET_CREATOR_ROLE = QUESTION_CREATOR_ROLE;

    // Market Categories
    enum MarketCategory {
        POLITICS,
        SPORTS,
        ENTERTAINMENT,
        TECHNOLOGY,
        ECONOMICS,
        SCIENCE,
        WEATHER,
        OTHER
    }

    // Market Types
    enum MarketType {
        PAID, // Regular betting token markets
        FREE_ENTRY // Free markets with limited participation

    }

    struct MarketOption {
        string name;
        string description;
        uint256 totalShares;
        uint256 totalVolume;
        uint256 currentPrice; // Price in wei (scaled by 1e18)
        bool isActive;
    }

    struct FreeMarketConfig {
        uint256 maxFreeParticipants; // Max users who can enter for free
        uint256 tokensPerParticipant; // Buster tokens per user (instead of shares)
        uint256 currentFreeParticipants; // Current count
        uint256 totalPrizePool; // Total tokens allocated for free users
        uint256 remainingPrizePool; // Remaining tokens available
        bool isActive; // Can still accept free entries
        mapping(address => bool) hasClaimedFree; // Track who claimed free tokens
        mapping(address => uint256) tokensReceived; // Amount of free tokens claimed per user
    }

    struct Market {
        string question;
        string description;
        uint256 endTime;
        MarketCategory category;
        MarketType marketType; // Market type (PAID, FREE_ENTRY)
        uint256 winningOptionId;
        bool resolved;
        bool disputed;
        bool validated;
        bool invalidated; // NEW: Market has been invalidated by admin
        address creator;
        uint256 adminInitialLiquidity; // NEW: Admin's initial liquidity (separate tracking)
        uint256 userLiquidity; // NEW: User contributions only
        uint256 totalVolume;
        uint256 createdAt;
        uint256 optionCount;
        uint256 platformFeesCollected; // NEW: Platform fees for this market
        bool adminLiquidityClaimed; // NEW: Track if admin claimed their liquidity back
        bool feesUnlocked; // NEW: Platform fees for this market have been unlocked (post-resolution)
        mapping(uint256 => MarketOption) options;
        mapping(address => mapping(uint256 => uint256)) userShares; // user => optionId => shares
        mapping(address => bool) hasClaimed;
        address[] participants;
        uint256 payoutIndex;
        FreeMarketConfig freeConfig; // Free market configuration
        bool earlyResolutionAllowed; // NEW: Allow resolution before endTime for event-based markets
        uint256 lmsrB; // NEW: LMSR liquidity (b parameter)
        uint256 maxOptionShares; // NEW: track largest single outcome shares for solvency
    }

    struct Trade {
        uint256 marketId;
        uint256 optionId;
        address buyer;
        address seller;
        uint256 price;
        uint256 quantity;
        uint256 timestamp;
    }

    struct PricePoint {
        uint256 price;
        uint256 timestamp;
        uint256 volume;
    }

    struct UserPortfolio {
        uint256 totalInvested;
        uint256 totalWinnings;
        int256 unrealizedPnL;
        int256 realizedPnL;
        uint256 tradeCount;
    }

    //     // State variables
    IERC20 public bettingToken;
    address public previousBettingToken; // Track previous token for migration
    uint256 public tokenUpdatedAt; // When token was last updated
    uint256 public marketCount;
    uint256 public tradeCount;
    uint256 public globalTradeCount; // NEW: Total trades across all markets
    uint256 public platformFeeRate = 200; // 2% (basis points)
    uint256 public constant MAX_OPTIONS = 10;
    uint256 public constant MIN_MARKET_DURATION = 1 hours;
    uint256 public constant MAX_MARKET_DURATION = 1000 days;
    address public feeCollector; // NEW: Address that can withdraw platform fees
    uint256 public totalPlatformFeesCollected; // NEW: Global cumulative platform fees (all time)
    uint256 public totalLockedPlatformFees; // NEW: Portion still locked (unresolved markets)
    uint256 public totalUnlockedPlatformFees; // NEW: Portion unlocked and withdrawable
    uint256 public totalWithdrawnPlatformFees; // NEW: Total withdrawn so far
    uint256 public constant PAYOUT_PER_SHARE = 100 * 1e18; // NEW: Fixed payout per winning share (Polymarket-style)
    // Invariant tolerances
    uint256 private constant PROB_EPS = 5e12; // 0.000005 (5 ppm) tolerance on probability sum
    uint256 private constant COST_EPS = 1e9; // 1e-9 tokens cost tolerance for monotonicity (small slack)

    // Bounds for LMSR b parameter to avoid instability
    uint256 public constant MIN_LMSR_B = 1e16; // 0.01 tokens scaled
    uint256 public constant MAX_LMSR_B = 1e24; // Large upper cap

    // Coverage ratio used to size LMSR b (percentage of initial liquidity allocated to worst-case loss tolerance)
    uint256 internal constant LMSR_COVERAGE_RATIO_NUM = 60; // 60%
    uint256 internal constant LMSR_COVERAGE_RATIO_DEN = 100;

    //     // Mappings
    mapping(uint256 => Market) internal markets;
    mapping(address => UserPortfolio) public userPortfolios;
    mapping(address => Trade[]) public userTradeHistory;
    mapping(uint256 => Trade[]) public marketTrades;
    mapping(uint256 => mapping(uint256 => PricePoint[])) public priceHistory; // marketId => optionId => prices
    mapping(MarketCategory => uint256[]) public categoryMarkets;
    mapping(address => uint256) public totalWinnings; // DEPRECATED: use userPortfolios.totalWinnings instead
    mapping(MarketType => uint256[]) public marketsByType; // Markets by type
    // Cost basis tracking for proper PnL calculation: user => marketId => optionId => total cost basis
    mapping(address => mapping(uint256 => mapping(uint256 => uint256))) public userCostBasis;
    address[] public allParticipants;

    //     // Events
    event MarketCreated(
        uint256 indexed marketId,
        string question,
        string[] options,
        uint256 endTime,
        MarketCategory category,
        MarketType marketType,
        address creator
    );
    event FreeMarketConfigSet(
        uint256 indexed marketId, uint256 maxFreeParticipants, uint256 tokensPerParticipant, uint256 totalPrizePool
    );
    event UserPortfolioUpdated(
        address indexed user,
        uint256 totalInvested,
        uint256 totalWinnings,
        int256 unrealizedPnL,
        int256 realizedPnL,
        uint256 tradeCount
    );
    event FreeTokensClaimed(uint256 indexed marketId, address indexed user, uint256 tokens);
    event BettingTokenUpdated(address indexed oldToken, address indexed newToken, uint256 timestamp);
    event LiquidityAdded(uint256 indexed marketId, address indexed provider, uint256 amount);
    event MarketValidated(uint256 indexed marketId, address validator);
    event MarketInvalidated(uint256 indexed marketId, address validator, uint256 refundedAmount);
    event TradeExecuted(
        uint256 indexed marketId,
        uint256 indexed optionId,
        address indexed buyer,
        address seller,
        uint256 price,
        uint256 quantity,
        uint256 tradeId
    );
    event SharesSold(
        uint256 indexed marketId, uint256 indexed optionId, address indexed seller, uint256 quantity, uint256 price
    );
    event MarketResolved(uint256 indexed marketId, uint256 winningOptionId, address resolver);
    event MarketDisputed(uint256 indexed marketId, address disputer, string reason);
    event Claimed(uint256 indexed marketId, address indexed user, uint256 amount);
    event FeeCollected(uint256 indexed marketId, uint256 amount);
    event MarketPaused(uint256 indexed marketId);
    event PlatformFeesWithdrawn(address indexed collector, uint256 amount);
    event AdminLiquidityWithdrawn(uint256 indexed marketId, address indexed creator, uint256 amount);
    event UnusedPrizePoolWithdrawn(uint256 indexed marketId, address indexed creator, uint256 amount);
    event FeeCollectorUpdated(address indexed oldCollector, address indexed newCollector);
    event BatchWinningsDistributed(uint256 indexed marketId, uint256 totalDistributed, uint256 recipientCount);
    event WinningsDistributedToUser(uint256 indexed marketId, address indexed user, uint256 amount);
    event BComputed(uint256 indexed marketId, uint256 bValue, uint256 coverageRatioNum, uint256 coverageRatioDen);
    event FeesUnlocked(uint256 indexed marketId, uint256 amount);
    event FeeAccrued(uint256 indexed marketId, uint256 indexed optionId, bool isBuy, uint256 rawAmount, uint256 fee);
    // NEW enhanced analytics events
    event PricesUpdated(uint256 indexed marketId, uint256[] prices);
    // New: Emit token-denominated prices (probability * PAYOUT_PER_SHARE)
    event TokenPricesUpdated(uint256 indexed marketId, uint256[] tokenPrices);
    event SlippageProtect(
        uint256 indexed marketId,
        uint256 indexed optionId,
        bool isBuy,
        uint256 quantity,
        uint256 bound,
        uint256 actualTotal
    );

    constructor(address _bettingToken) Ownable(msg.sender) {
        bettingToken = IERC20(_bettingToken);
        tokenUpdatedAt = block.timestamp;
        feeCollector = msg.sender; // Owner is initial fee collector
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    //     // Token Management Functions
    function updateBettingToken(address _newToken) external {
        if (msg.sender != owner() && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert OnlyAdminOrOwner();
        if (_newToken == address(0)) revert InvalidToken();
        if (_newToken == address(bettingToken)) revert SameToken();

        previousBettingToken = address(bettingToken);
        bettingToken = IERC20(_newToken);
        tokenUpdatedAt = block.timestamp;

        emit BettingTokenUpdated(previousBettingToken, _newToken, block.timestamp);
    }

    function setFeeCollector(address _feeCollector) external onlyOwner {
        if (_feeCollector == address(0)) revert InvalidToken();
        address oldCollector = feeCollector;
        feeCollector = _feeCollector;
        emit FeeCollectorUpdated(oldCollector, _feeCollector);
    }

    //     // Modifiers
    modifier validMarket(uint256 _marketId) {
        if (_marketId >= marketCount) revert InvalidMarket();
        _;
    }

    modifier marketActive(uint256 _marketId) {
        if (markets[_marketId].resolved) revert MarketResolvedAlready();
        if (block.timestamp >= markets[_marketId].endTime) revert MarketEnded();
        if (markets[_marketId].invalidated) revert MarketIsInvalidated();
        _;
    }

    modifier validOption(uint256 _marketId, uint256 _optionId) {
        if (_optionId >= markets[_marketId].optionCount) revert InvalidOption();
        if (!markets[_marketId].options[_optionId].isActive) revert OptionInactive();
        _;
    }

    //     // Admin Functions
    function grantQuestionCreatorRole(address _account) external onlyOwner {
        grantRole(QUESTION_CREATOR_ROLE, _account);
    }

    function grantPauserRole(address _account) external onlyOwner {
        grantRole(PAUSER_ROLE, _account);
    }

    function grantQuestionResolveRole(address _account) external onlyOwner {
        grantRole(QUESTION_RESOLVE_ROLE, _account);
    }

    function grantMarketValidatorRole(address _account) external onlyOwner {
        grantRole(MARKET_VALIDATOR_ROLE, _account);
    }

    function setPlatformFeeRate(uint256 _feeRate) external onlyOwner {
        if (_feeRate > 1000) revert FeeTooHigh();
        platformFeeRate = _feeRate;
    }

    function pause() external {
        if (msg.sender != owner() && !hasRole(PAUSER_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotAuthorized();
        }
        _pause();
    }

    function unpause() external {
        if (msg.sender != owner() && !hasRole(PAUSER_ROLE, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotAuthorized();
        }
        _unpause();
    }

    //     // Market Creation
    function createMarket(
        string memory _question,
        string memory _description,
        string[] memory _optionNames,
        string[] memory _optionDescriptions,
        uint256 _duration,
        MarketCategory _category,
        MarketType _marketType,
        uint256 _initialLiquidity,
        bool _earlyResolutionAllowed // NEW parameter
    ) public nonReentrant whenNotPaused returns (uint256) {
        if (msg.sender != owner() && !hasRole(QUESTION_CREATOR_ROLE, msg.sender)) revert NotAuthorized();
        if (_duration < MIN_MARKET_DURATION || _duration > MAX_MARKET_DURATION) revert BadDuration();
        if (bytes(_question).length == 0) revert EmptyQuestion();
        if (_optionNames.length < 2 || _optionNames.length > MAX_OPTIONS) revert BadOptionCount();
        if (_optionNames.length != _optionDescriptions.length) revert LengthMismatch();
        if (_initialLiquidity < 1000 * 1e18) revert MinTokensRequired();

        // Transfer initial liquidity from creator
        if (!bettingToken.transferFrom(msg.sender, address(this), _initialLiquidity)) revert TransferFailed();

        uint256 marketId = marketCount++;
        Market storage market = markets[marketId];
        market.question = _question;
        market.description = _description;
        market.endTime = block.timestamp + _duration;
        market.category = _category;
        market.marketType = _marketType;
        market.creator = msg.sender;
        market.createdAt = block.timestamp;
        market.optionCount = _optionNames.length;
        market.earlyResolutionAllowed = _earlyResolutionAllowed; // NEW: Set the flag
        uint256 b = _computeB(_initialLiquidity, _optionNames.length); // Auto-computed LMSR b
        market.lmsrB = b;

        // Track admin's initial liquidity separately
        market.adminInitialLiquidity = _initialLiquidity;
        market.userLiquidity = 0; // No user liquidity yet

        // Initialize options with equal starting prices (1.0 tokens total, split equally) - createMarket
        uint256 initialPrice = 1e18 / _optionNames.length; // Equal price distribution

        for (uint256 i = 0; i < _optionNames.length; i++) {
            market.options[i] = MarketOption({
                name: _optionNames[i],
                description: _optionDescriptions[i],
                totalShares: 0,
                totalVolume: 0,
                currentPrice: initialPrice,
                isActive: true
            });

            // Initialize price history
            priceHistory[marketId][i].push(PricePoint({price: initialPrice, timestamp: block.timestamp, volume: 0}));
        }

        categoryMarkets[_category].push(marketId);
        marketsByType[_marketType].push(marketId);

        emit MarketCreated(marketId, _question, _optionNames, market.endTime, _category, _marketType, msg.sender);
        emit BComputed(marketId, b, LMSR_COVERAGE_RATIO_NUM, LMSR_COVERAGE_RATIO_DEN);
        return marketId;
    }

    //     // Create Free Entry Market
    function createFreeMarket(
        string memory _question,
        string memory _description,
        string[] memory _optionNames,
        string[] memory _optionDescriptions,
        uint256 _duration,
        MarketCategory _category,
        uint256 _maxFreeParticipants,
        uint256 _tokensPerParticipant,
        uint256 _initialLiquidity,
        bool _earlyResolutionAllowed // NEW parameter
    ) external nonReentrant whenNotPaused returns (uint256) {
        // Calculate total required: liquidity + prize pool
        uint256 totalPrizePool = _maxFreeParticipants * _tokensPerParticipant;
        uint256 totalRequired = _initialLiquidity + totalPrizePool;

        // Transfer both liquidity and prize pool from creator
        if (!bettingToken.transferFrom(msg.sender, address(this), totalRequired)) revert TransferFailed();

        // Create market WITHOUT calling the internal createMarket to avoid double transfer
        if (msg.sender != owner() && !hasRole(QUESTION_CREATOR_ROLE, msg.sender)) revert NotAuthorized();
        if (_duration < MIN_MARKET_DURATION || _duration > MAX_MARKET_DURATION) revert BadDuration();
        if (bytes(_question).length == 0) revert EmptyQuestion();
        if (_optionNames.length < 2 || _optionNames.length > MAX_OPTIONS) revert BadOptionCount();
        if (_optionNames.length != _optionDescriptions.length) revert LengthMismatch();
        if (_initialLiquidity < 100 * 1e18) revert MinTokensRequired();

        uint256 marketId = marketCount++;
        Market storage market = markets[marketId];
        market.question = _question;
        market.description = _description;
        market.endTime = block.timestamp + _duration;
        market.category = _category;
        market.marketType = MarketType.FREE_ENTRY;
        market.creator = msg.sender;
        market.createdAt = block.timestamp;
        market.optionCount = _optionNames.length;
        market.earlyResolutionAllowed = _earlyResolutionAllowed; // NEW: Set the flag
        uint256 b = _computeB(_initialLiquidity, _optionNames.length); // Auto-computed LMSR b
        market.lmsrB = b;

        // Track admin's initial liquidity separately
        market.adminInitialLiquidity = _initialLiquidity;
        market.userLiquidity = 0; // No user liquidity yet

        // Initialize options with equal starting prices (1.0 tokens total, split equally) - createFreeMarket  
        uint256 initialPrice = 1e18 / _optionNames.length; // Equal price distribution

        for (uint256 i = 0; i < _optionNames.length; i++) {
            market.options[i] = MarketOption({
                name: _optionNames[i],
                description: _optionDescriptions[i],
                totalShares: 0,
                totalVolume: 0,
                currentPrice: initialPrice,
                isActive: true
            });

            // Initialize price history
            priceHistory[marketId][i].push(PricePoint({price: initialPrice, timestamp: block.timestamp, volume: 0}));
        }

        categoryMarkets[_category].push(marketId);
        marketsByType[MarketType.FREE_ENTRY].push(marketId);

        // Configure free market settings
        market.freeConfig.maxFreeParticipants = _maxFreeParticipants;
        market.freeConfig.tokensPerParticipant = _tokensPerParticipant;
        market.freeConfig.totalPrizePool = totalPrizePool;
        market.freeConfig.remainingPrizePool = totalPrizePool;
        market.freeConfig.isActive = true;

        emit FreeMarketConfigSet(marketId, _maxFreeParticipants, _tokensPerParticipant, totalPrizePool);

        emit MarketCreated(
            marketId, _question, _optionNames, market.endTime, _category, MarketType.FREE_ENTRY, msg.sender
        );
        emit BComputed(marketId, b, LMSR_COVERAGE_RATIO_NUM, LMSR_COVERAGE_RATIO_DEN);
        return marketId;
    }

    function validateMarket(uint256 _marketId) external validMarket(_marketId) {
        if (!hasRole(MARKET_VALIDATOR_ROLE, msg.sender) && msg.sender != owner()) revert NotAuthorized();
        if (markets[_marketId].validated) revert MarketAlreadyResolved();
        if (markets[_marketId].invalidated) revert MarketIsInvalidated();

        markets[_marketId].validated = true;
        emit MarketValidated(_marketId, msg.sender);
    }

    function invalidateMarket(uint256 _marketId) external nonReentrant validMarket(_marketId) {
        if (!hasRole(MARKET_VALIDATOR_ROLE, msg.sender) && msg.sender != owner()) revert NotAuthorized();
        if (markets[_marketId].validated) revert MarketAlreadyResolved();
        if (markets[_marketId].invalidated) revert MarketAlreadyInvalidated();

        Market storage market = markets[_marketId];
        market.invalidated = true;

        // Automatically refund creator's initial liquidity
        uint256 refundAmount = 0;
        if (!market.adminLiquidityClaimed && market.adminInitialLiquidity > 0) {
            refundAmount = market.adminInitialLiquidity;
            market.adminLiquidityClaimed = true;
        }
        
        // For free markets, also refund remaining prize pool
        if (market.marketType == MarketType.FREE_ENTRY && market.freeConfig.remainingPrizePool > 0) {
            refundAmount += market.freeConfig.remainingPrizePool;
            market.freeConfig.remainingPrizePool = 0;
            market.freeConfig.isActive = false;
        }
        
        // Transfer the total refund amount if any
        if (refundAmount > 0) {
            if (!bettingToken.transfer(market.creator, refundAmount)) revert TransferFailed();
        }

        emit MarketInvalidated(_marketId, msg.sender, refundAmount);
    }

    function disputeMarket(uint256 _marketId, string calldata _reason) external nonReentrant validMarket(_marketId) {
        if (!hasRole(MARKET_VALIDATOR_ROLE, msg.sender) && msg.sender != owner()) revert NotAuthorized();
        
        Market storage market = markets[_marketId];
        if (!market.resolved) revert MarketNotResolved();
        if (market.disputed) revert MarketAlreadyResolved(); // Already disputed
        if (market.invalidated) revert MarketIsInvalidated();
        
        // Set market as disputed
        market.disputed = true;
        
        emit MarketDisputed(_marketId, msg.sender, _reason);
    }

    // Trading Functions
    function claimFreeTokens(uint256 _marketId)
        external
        nonReentrant
        whenNotPaused
        validMarket(_marketId)
        marketActive(_marketId)
    {
        Market storage market = markets[_marketId];
        if (market.marketType != MarketType.FREE_ENTRY) revert NotFreeMarket();
        if (!market.freeConfig.isActive) revert FreeEntryInactive();
        if (market.freeConfig.hasClaimedFree[msg.sender]) revert AlreadyClaimedFree();
        if (market.freeConfig.currentFreeParticipants >= market.freeConfig.maxFreeParticipants) revert FreeSlotseFull();
        if (market.freeConfig.remainingPrizePool < market.freeConfig.tokensPerParticipant) {
            revert InsufficientPrizePool();
        }

        uint256 freeTokens = market.freeConfig.tokensPerParticipant;

        // Effects: Update all state before external call
        market.freeConfig.hasClaimedFree[msg.sender] = true;
        market.freeConfig.tokensReceived[msg.sender] = freeTokens;
        market.freeConfig.currentFreeParticipants++;
        market.freeConfig.remainingPrizePool -= freeTokens;

        // Add user as participant if new
        if (_isNewParticipant(msg.sender, _marketId)) {
            market.participants.push(msg.sender);
            if (userPortfolios[msg.sender].totalInvested == 0) {
                allParticipants.push(msg.sender);
            }
        }

        // Update user portfolio (tokens received count as "investment" for tracking)
        userPortfolios[msg.sender].tradeCount++;

        // Interactions: External call at the very end
        if (!bettingToken.transfer(msg.sender, freeTokens)) revert TransferFailed();

        // Events after successful interaction
        emit FreeTokensClaimed(_marketId, msg.sender, freeTokens);
    }

    // New extended version with aggregate slippage: _maxTotalCost (0 means ignore aggregate bound)
    function buyShares(
        uint256 _marketId,
        uint256 _optionId,
        uint256 _quantity,
        uint256 _maxPricePerShare,
        uint256 _maxTotalCost
    )
        public
        nonReentrant
        whenNotPaused
        validMarket(_marketId)
        marketActive(_marketId)
        validOption(_marketId, _optionId)
    {
        if (_quantity == 0) revert AmountMustBePositive();
        if (!markets[_marketId].validated) revert MarketNotValidated();
        // Add overflow protection
        if (_quantity > type(uint128).max) revert InvalidInput();
        // Note: No artificial cap on _maxPricePerShare - users can set their own risk tolerance

        Market storage market = markets[_marketId];
        MarketOption storage option = market.options[_optionId];
        
    // Use option-specific pricing scaled by payout per share (token base units)
    // 1 share costs probability * PAYOUT_PER_SHARE tokens
    // Units: currentPrice (1e18) * PAYOUT_PER_SHARE (1e18) / 1e18 -> tokens (1e18)
    // Compute (prob * qty) first to keep precision, then scale by payout
    uint256 probTimesQty = (option.currentPrice * _quantity) / 1e18; // still 1e18-scaled
    uint256 rawCost = (probTimesQty * PAYOUT_PER_SHARE) / 1e18; // tokens
        if (rawCost == 0) revert PriceTooLow();

        uint256 fee = (rawCost * platformFeeRate) / 10000;
        uint256 totalCost = rawCost + fee;
        uint256 effectiveAvg = (totalCost * 1e18) / _quantity;
        if (effectiveAvg > _maxPricePerShare) revert PriceTooHigh();
        if (_maxTotalCost != 0) {
            if (totalCost > _maxTotalCost) revert SlippageExceeded();
        }

        // Effects: Update all state before external call
        if (market.userShares[msg.sender][_optionId] == 0 && _isNewParticipant(msg.sender, _marketId)) {
            market.participants.push(msg.sender);
            if (userPortfolios[msg.sender].totalInvested == 0) {
                allParticipants.push(msg.sender);
            }
        }
        market.userShares[msg.sender][_optionId] += _quantity;
        option.totalShares += _quantity;
        _updateMaxOptionShares(_marketId, _optionId);
        option.totalVolume += rawCost;
        market.userLiquidity += rawCost;
        market.totalVolume += rawCost;
        market.platformFeesCollected += fee;
        totalPlatformFeesCollected += fee;
        totalLockedPlatformFees += fee; // lock until resolution

        // Update cost basis for PnL tracking
        userCostBasis[msg.sender][_marketId][_optionId] += totalCost;
        userPortfolios[msg.sender].totalInvested += rawCost; // Only track the actual cost, not including fees
        userPortfolios[msg.sender].tradeCount++;
        emit UserPortfolioUpdated(
            msg.sender,
            userPortfolios[msg.sender].totalInvested,
            userPortfolios[msg.sender].totalWinnings,
            userPortfolios[msg.sender].unrealizedPnL,
            userPortfolios[msg.sender].realizedPnL,
            userPortfolios[msg.sender].tradeCount
        );
        _updateLMSRPrices(_marketId);
        _postBuySolvencyCheck(_marketId);

        priceHistory[_marketId][_optionId].push(
            PricePoint({price: option.currentPrice, timestamp: block.timestamp, volume: rawCost})
        );
        Trade memory trade = Trade({
            marketId: _marketId,
            optionId: _optionId,
            buyer: msg.sender,
            seller: address(0),
            price: option.currentPrice,
            quantity: _quantity,
            timestamp: block.timestamp
        });
        userTradeHistory[msg.sender].push(trade);
        marketTrades[_marketId].push(trade);

        // Interactions: External call at the very end
        if (!bettingToken.transferFrom(msg.sender, address(this), totalCost)) revert TransferFailed();

        // Events after successful interaction
        emit FeeAccrued(_marketId, _optionId, true, rawCost, fee);
        emit TradeExecuted(_marketId, _optionId, msg.sender, address(0), effectiveAvg, _quantity, tradeCount++);
        globalTradeCount++; // Track global trade count
        emit FeeCollected(_marketId, fee);
        if (_maxTotalCost != 0) {
            emit SlippageProtect(_marketId, _optionId, true, _quantity, _maxTotalCost, totalCost);
        }
    }

    // Backward-compatible wrapper (deprecated): aggregate bound ignored
    function sellShares(
        uint256 _marketId,
        uint256 _optionId,
        uint256 _quantity,
        uint256 _minPricePerShare,
        uint256 _minTotalProceeds
    )
        public
        nonReentrant
        whenNotPaused
        validMarket(_marketId)
        marketActive(_marketId)
        validOption(_marketId, _optionId)
    {
        if (_quantity == 0) revert AmountMustBePositive();
        if (markets[_marketId].userShares[msg.sender][_optionId] < _quantity) revert InsufficientShares();
        // Add overflow protection
        if (_quantity > type(uint128).max) revert InvalidInput();
        // Note: No artificial cap on _minPricePerShare - users can set their own risk tolerance

        Market storage market = markets[_marketId];
        MarketOption storage option = market.options[_optionId];
        
    // Use option-specific pricing scaled by payout per share (token base units)
    // 1 share refunds probability * PAYOUT_PER_SHARE tokens
    uint256 probTimesQty = (option.currentPrice * _quantity) / 1e18;
    uint256 rawRefund = (probTimesQty * PAYOUT_PER_SHARE) / 1e18;
        if (rawRefund == 0) revert PriceTooLow();
        uint256 fee = (rawRefund * platformFeeRate) / 10000;
        uint256 netRefund = rawRefund - fee;
        uint256 effectiveAvg = (netRefund * 1e18) / _quantity;
        if (effectiveAvg < _minPricePerShare) revert PriceTooLow();
        if (_minTotalProceeds != 0) {
            if (netRefund < _minTotalProceeds) revert SlippageExceeded();
        }

        // Effects: Update all state before external call
        market.userShares[msg.sender][_optionId] -= _quantity;
        option.totalShares -= _quantity;
        if (option.totalShares + _quantity == market.maxOptionShares) {
            uint256 newMax = 0;
            for (uint256 i = 0; i < market.optionCount; i++) {
                uint256 ts = market.options[i].totalShares;
                if (ts > newMax) newMax = ts;
            }
            market.maxOptionShares = newMax;
        }

        option.totalVolume += rawRefund;
        market.totalVolume += rawRefund;
        market.platformFeesCollected += fee;
        totalPlatformFeesCollected += fee;
        totalLockedPlatformFees += fee; // lock until resolution

        if (market.userLiquidity >= rawRefund) {
            market.userLiquidity -= rawRefund;
        } else {
            market.userLiquidity = 0;
        }

        // Calculate realized PnL based on cost basis
        uint256 totalCostBasis = userCostBasis[msg.sender][_marketId][_optionId];
        uint256 userShares = market.userShares[msg.sender][_optionId] + _quantity; // original shares before sale
        uint256 avgCostBasis = userShares > 0 ? totalCostBasis / userShares : 0; // average cost per share
        uint256 soldCostBasis = avgCostBasis * _quantity; // cost basis for sold shares
        
        // Update cost basis tracking
        userCostBasis[msg.sender][_marketId][_optionId] = totalCostBasis > soldCostBasis ? totalCostBasis - soldCostBasis : 0;
        
        userPortfolios[msg.sender].tradeCount++;
        userPortfolios[msg.sender].realizedPnL += int256(netRefund) - int256(soldCostBasis);
        emit UserPortfolioUpdated(
            msg.sender,
            userPortfolios[msg.sender].totalInvested,
            userPortfolios[msg.sender].totalWinnings,
            userPortfolios[msg.sender].unrealizedPnL,
            userPortfolios[msg.sender].realizedPnL,
            userPortfolios[msg.sender].tradeCount
        );

        _updateLMSRPrices(_marketId);
        priceHistory[_marketId][_optionId].push(
            PricePoint({price: option.currentPrice, timestamp: block.timestamp, volume: rawRefund})
        );
        Trade memory trade = Trade({
            marketId: _marketId,
            optionId: _optionId,
            buyer: address(0),
            seller: msg.sender,
            price: option.currentPrice,
            quantity: _quantity,
            timestamp: block.timestamp
        });
        userTradeHistory[msg.sender].push(trade);
        marketTrades[_marketId].push(trade);

        // Interactions: External call at the very end
        if (!bettingToken.transfer(msg.sender, netRefund)) revert TransferFailed();

        // Events after successful interaction
        emit FeeAccrued(_marketId, _optionId, false, rawRefund, fee);
        emit SharesSold(_marketId, _optionId, msg.sender, _quantity, effectiveAvg);
        emit TradeExecuted(_marketId, _optionId, address(0), msg.sender, effectiveAvg, _quantity, tradeCount++);
        globalTradeCount++; // Track global trade count
        emit FeeCollected(_marketId, fee);
        if (_minTotalProceeds != 0) {
            emit SlippageProtect(_marketId, _optionId, false, _quantity, _minTotalProceeds, netRefund);
        }
    }

    // Backward-compatible wrapper (deprecated): aggregate proceeds bound ignored
    // Market Resolution
    function resolveMarket(uint256 _marketId, uint256 _winningOptionId) external nonReentrant validMarket(_marketId) {
        if (msg.sender != owner() && !hasRole(QUESTION_RESOLVE_ROLE, msg.sender)) revert NotAuthorized();
        Market storage market = markets[_marketId];
        
        // Require market validation before resolution
        if (!market.validated) revert MarketNotValidated();

        // NEW: Allow early resolution for event-based markets
        if (!market.earlyResolutionAllowed && block.timestamp < market.endTime) {
            revert MarketNotEndedYet();
        }

        // NEW: Prevent immediate resolution (require minimum 1 hour)
        if (market.earlyResolutionAllowed && block.timestamp < market.createdAt + 1 hours) {
            revert MarketTooNew();
        }

        if (market.resolved) revert MarketAlreadyResolved();
        if (_winningOptionId >= market.optionCount) revert InvalidWinningOption();

        market.winningOptionId = _winningOptionId;
        market.resolved = true;

        // Note: Admin liquidity remains in contract for winner payouts
        // Creators can manually withdraw remaining liquidity after all claims
        

        // Handle free market unused prize pool
        uint256 unusedPrizePool = 0;
        if (market.marketType == MarketType.FREE_ENTRY) {
            unusedPrizePool = market.freeConfig.remainingPrizePool;
            market.freeConfig.remainingPrizePool = 0;
        }

        // Unlock platform fees for this market (if any)
        if (!market.feesUnlocked && market.platformFeesCollected > 0) {
            uint256 amount = market.platformFeesCollected;
            market.feesUnlocked = true;
            // Adjust global locked/unlocked accounting
            if (totalLockedPlatformFees >= amount) {
                totalLockedPlatformFees -= amount;
            } else {
                totalLockedPlatformFees = 0; // safety clamp
            }
            totalUnlockedPlatformFees += amount;
            emit FeesUnlocked(_marketId, amount);
        }

        // Admin liquidity remains in contract - no transfer needed

        // Transfer unused prize pool back to creator
        if (unusedPrizePool > 0) {
            if (!bettingToken.transfer(market.creator, unusedPrizePool)) revert TransferFailed();
        }

        emit MarketResolved(_marketId, _winningOptionId, msg.sender);
        
        // Admin liquidity remains in contract - no withdrawal event needed
        
        if (unusedPrizePool > 0) {
            emit UnusedPrizePoolWithdrawn(_marketId, market.creator, unusedPrizePool);
        }
    }

    // Payout Functions
    function claimWinnings(uint256 _marketId) external nonReentrant validMarket(_marketId) whenNotPaused {
        Market storage market = markets[_marketId];
        if (!market.resolved || market.disputed) revert MarketNotReady();
        if (market.invalidated) revert MarketIsInvalidated();
        if (market.hasClaimed[msg.sender]) revert AlreadyClaimed();

    uint256 userWinningShares = market.userShares[msg.sender][market.winningOptionId];
    if (userWinningShares == 0) revert NoWinningShares();
    // Fixed payout per winning share (Polymarket-style)
    // Units: userWinningShares (1e18) * PAYOUT_PER_SHARE (1e18) / 1e18 -> tokens (1e18)
    uint256 winnings = (userWinningShares * PAYOUT_PER_SHARE) / 1e18;

        // Effects: Update all state before external call
        market.hasClaimed[msg.sender] = true;
        
        // Calculate realized PnL from winnings vs cost basis
        uint256 costBasis = userCostBasis[msg.sender][_marketId][market.winningOptionId];
        userCostBasis[msg.sender][_marketId][market.winningOptionId] = 0; // Clear cost basis as position is closed
        
        userPortfolios[msg.sender].totalWinnings += winnings;
        userPortfolios[msg.sender].realizedPnL += int256(winnings) - int256(costBasis);
        // NOTE: The standalone totalWinnings[msg.sender] mapping is deprecated.
        // We keep the mapping for backwards compatibility but no longer update it to avoid
        // redundancy and potential desync. Use userPortfolios[user].totalWinnings instead.
        emit UserPortfolioUpdated(
            msg.sender,
            userPortfolios[msg.sender].totalInvested,
            userPortfolios[msg.sender].totalWinnings,
            userPortfolios[msg.sender].unrealizedPnL,
            userPortfolios[msg.sender].realizedPnL,
            userPortfolios[msg.sender].tradeCount
        );

        // Interactions: External call at the very end
        if (!bettingToken.transfer(msg.sender, winnings)) revert TransferFailed();

        // Events after successful interaction
        emit Claimed(_marketId, msg.sender, winnings);
    }

    // Get current market odds for all options
    // Emergency functions
    // NEW: Platform Fee Management
    // Backwards-compatible function now only withdraws unlocked fees
    function withdrawPlatformFees() external nonReentrant {

    if (msg.sender != feeCollector && msg.sender != owner()) revert NotAuthorized();
        _withdrawUnlockedPlatformFees();
    }

    function _withdrawUnlockedPlatformFees() internal {
        
        uint256 amount = totalUnlockedPlatformFees;
        if (amount == 0) revert NoUnlockedFees();
        totalUnlockedPlatformFees = 0;
        totalWithdrawnPlatformFees += amount;
        if (!bettingToken.transfer(feeCollector, amount)) revert TransferFailed();
        emit PlatformFeesWithdrawn(feeCollector, amount);
    }

    // NEW: Admin Initial Liquidity Withdrawal
    function withdrawAdminLiquidity(uint256 _marketId) 
        external 
        nonReentrant 
        validMarket(_marketId) 
    {
        Market storage market = markets[_marketId];
        
        // Only market creator can withdraw their initial liquidity
        if (msg.sender != market.creator) revert NotAuthorized();
        
        // Market must be resolved or invalidated
        if (!market.resolved && !market.invalidated) revert MarketNotReady();
        
        // Check if already claimed
        if (market.adminLiquidityClaimed) revert AdminLiquidityAlreadyClaimed();
        
        // Must have initial liquidity to withdraw
        if (market.adminInitialLiquidity == 0) revert NoLiquidityToWithdraw();
        
        uint256 withdrawAmount = market.adminInitialLiquidity;
        
        // Effects: Update state before interaction
        market.adminLiquidityClaimed = true;
        
        // Interactions: Transfer tokens
        if (!bettingToken.transfer(market.creator, withdrawAmount)) revert TransferFailed();
        
        emit AdminLiquidityWithdrawn(_marketId, market.creator, withdrawAmount);
    }

    // NEW: Emergency token withdrawal (owner only)
    function emergencyWithdraw(uint256 _amount) 
        external 
        onlyOwner 
        nonReentrant 
    {
        if (_amount == 0) revert AmountMustBePositive();
        
        uint256 contractBalance = bettingToken.balanceOf(address(this));
        if (contractBalance < _amount) revert InsufficientContractBalance();
        
        // Transfer tokens to owner
        if (!bettingToken.transfer(owner(), _amount)) revert TransferFailed();
        
        emit AdminLiquidityWithdrawn(0, owner(), _amount); // Use marketId 0 for emergency withdrawals
    }

    // NEW: Get withdrawable admin liquidity for a market
    function getWithdrawableAdminLiquidity(uint256 _marketId) 
        external 
        view 
        validMarket(_marketId) 
        returns (uint256) 
    {
        Market storage market = markets[_marketId];
        
        // Must be resolved or invalidated, and not already claimed
        if ((!market.resolved && !market.invalidated) || market.adminLiquidityClaimed) {
            return 0;
        }
        
        return market.adminInitialLiquidity;
    }

    // Helper Functions

    // NEW: Withdraw unused prize pool from free markets
    // Helper Functions
    function _isNewParticipant(address _user, uint256 _marketId) internal view returns (bool) {
        Market storage market = markets[_marketId];
        for (uint256 i = 0; i < market.optionCount; i++) {
            if (market.userShares[_user][i] > 0) {
                return false;
            }
        }
        return true;
    }

    // View Functions
    // ===================== LMSR HELPERS =====================

    function _lmsrCost(uint256 _marketId) internal view returns (uint256) {
        Market storage market = markets[_marketId];

        PolicastLogic.MarketData memory marketData = PolicastLogic.MarketData({
            optionCount: market.optionCount,
            lmsrB: market.lmsrB,
            maxOptionShares: market.maxOptionShares,
            userLiquidity: market.userLiquidity,
            adminInitialLiquidity: market.adminInitialLiquidity
        });

        // Convert storage mapping to array for library call
        PolicastLogic.OptionData[] memory options = new PolicastLogic.OptionData[](market.optionCount);
        for (uint256 i = 0; i < market.optionCount; i++) {
            options[i] = PolicastLogic.OptionData({
                totalShares: market.options[i].totalShares,
                currentPrice: market.options[i].currentPrice
            });
        }

        return PolicastLogic.calculateLMSRCost(marketData, options);
    }

    function _lmsrCostGivenShares(uint256 _marketId, uint256[] memory shares) internal view returns (uint256) {
        Market storage market = markets[_marketId];

        PolicastLogic.MarketData memory marketData = PolicastLogic.MarketData({
            optionCount: market.optionCount,
            lmsrB: market.lmsrB,
            maxOptionShares: market.maxOptionShares,
            userLiquidity: market.userLiquidity,
            adminInitialLiquidity: market.adminInitialLiquidity
        });

        return PolicastLogic.calculateLMSRCostWithShares(marketData, shares);
    }

    function _updateMaxOptionShares(uint256 _marketId, uint256 _optionId) internal {
        Market storage market = markets[_marketId];
        uint256 shares = market.options[_optionId].totalShares;
        if (shares > market.maxOptionShares) {
            market.maxOptionShares = shares;
        }
    }

    function _postBuySolvencyCheck(uint256 _marketId) internal view {
        Market storage market = markets[_marketId];

        PolicastLogic.MarketData memory marketData = PolicastLogic.MarketData({
            optionCount: market.optionCount,
            lmsrB: market.lmsrB,
            maxOptionShares: market.maxOptionShares,
            userLiquidity: market.userLiquidity,
            adminInitialLiquidity: market.adminInitialLiquidity
        });

        PolicastLogic.validateBuySolvency(marketData);
    }

    function _updateLMSRPrices(uint256 _marketId) internal {
        Market storage market = markets[_marketId];

        PolicastLogic.MarketData memory marketData = PolicastLogic.MarketData({
            optionCount: market.optionCount,
            lmsrB: market.lmsrB,
            maxOptionShares: market.maxOptionShares,
            userLiquidity: market.userLiquidity,
            adminInitialLiquidity: market.adminInitialLiquidity
        });

        // Convert storage mapping to array for library call
        PolicastLogic.OptionData[] memory options = new PolicastLogic.OptionData[](market.optionCount);
        for (uint256 i = 0; i < market.optionCount; i++) {
            options[i] = PolicastLogic.OptionData({
                totalShares: market.options[i].totalShares,
                currentPrice: market.options[i].currentPrice
            });
        }

        // Call library function to update prices
        uint256[] memory prices = PolicastLogic.updateLMSRPrices(marketData, options);

        // Update storage with new prices from returned array, not from options
        for (uint256 i = 0; i < market.optionCount; i++) {
            market.options[i].currentPrice = prices[i]; // Use prices[i] not options[i].currentPrice
        }

        emit PricesUpdated(_marketId, prices);
        // Also emit token-denominated prices for convenience
        uint256[] memory tokenPrices = new uint256[](market.optionCount);
        for (uint256 i = 0; i < market.optionCount; i++) {
            tokenPrices[i] = (prices[i] * PAYOUT_PER_SHARE) / 1e18;
        }
        emit TokenPricesUpdated(_marketId, tokenPrices);
    }

    function _computeB(uint256 _initialLiquidity, uint256 _optionCount) internal pure returns (uint256) {
        return PolicastLogic.computeB(_initialLiquidity, _optionCount);
    }

    // NOTE: Large view functions moved to PolicastViews contract for size optimization

    // Functions needed by PolicastViews contract
    function getMarketOption(uint256 _marketId, uint256 _optionId)
        external
        view
        validMarket(_marketId)
        returns (
            string memory name,
            string memory description,
            uint256 totalShares,
            uint256 totalVolume,
            uint256 currentPrice,
            bool isActive
        )
    {
        MarketOption storage option = markets[_marketId].options[_optionId];
        return (
            option.name,
            option.description,
            option.totalShares,
            option.totalVolume,
            option.currentPrice,
            option.isActive
        );
    }

    function getMarketFeeStatus(uint256 _marketId)
        external
        view
        validMarket(_marketId)
        returns (uint256 collected, bool unlocked, uint256 lockedPortion)
    {
        Market storage market = markets[_marketId];
        collected = market.platformFeesCollected;
        unlocked = market.feesUnlocked;
        lockedPortion = unlocked ? 0 : collected;
        return (collected, unlocked, lockedPortion);
    }

    // Getter function for views contract access
    function getMarketBasicInfo(uint256 _marketId)
        external
        view
        returns (
            string memory question,
            string memory description,
            uint256 endTime,
            MarketCategory category,
            uint256 optionCount,
            bool resolved,
            MarketType marketType,
            bool invalidated,
            uint256 totalVolume
        )
    {
        Market storage market = markets[_marketId];
        return (
            market.question,
            market.description,
            market.endTime,
            market.category,
            market.optionCount,
            market.resolved,
            market.marketType,
            market.invalidated,
            market.totalVolume
        );
    }

    function getMarketInfo(uint256 _marketId)
        external
        view
        returns (
            string memory question,
            string memory description,
            uint256 endTime,
            MarketCategory category,
            uint256 optionCount,
            bool resolved,
            uint256 winningOptionId,
            bool disputed,
            bool validated,
            bool invalidated,
            uint256 totalVolume,
            address creator,
            bool earlyResolutionAllowed
        )
    {
        // Checks
        require(_marketId < marketCount, "Market does not exist");

        // Effects: None (pure view)

        // Interactions: None
        Market storage market = markets[_marketId];
        return (
            market.question,
            market.description,
            market.endTime,
            market.category,
            market.optionCount,
            market.resolved,
            market.winningOptionId,
            market.disputed,
            market.validated,
            market.invalidated,
            market.totalVolume,
            market.creator,
            market.earlyResolutionAllowed
        );
    }

    function getMarketOptionUserShares(uint256 _marketId, uint256 _optionId, address _user)
        external
        view
        returns (uint256)
    {
        Market storage market = markets[_marketId];
        require(_optionId < market.optionCount, "Invalid option ID");
        return market.userShares[_user][_optionId];
    }

    function getMarketLMSRB(uint256 _marketId) external view validMarket(_marketId) returns (uint256) {
        return markets[_marketId].lmsrB;
    }

    function getPlatformFeeBreakdownData()
        external
        view
        returns (
            uint256 cumulativeFees,
            uint256 lockedFees,
            uint256 unlockedFees,
            uint256 withdrawnFees,
            address collector
        )
    {
        return (
            totalPlatformFeesCollected,
            totalLockedPlatformFees,
            totalUnlockedPlatformFees,
            totalWithdrawnPlatformFees,
            feeCollector
        );
    }
}