// SPDX-License-Identifier: MIT
pragma solidity ^0.8;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

contract PolicastMarketV2 is Ownable, ReentrancyGuard, AccessControl, Pausable {
    bytes32 public constant QUESTION_CREATOR_ROLE = keccak256("QUESTION_CREATOR_ROLE");
    bytes32 public constant QUESTION_RESOLVE_ROLE = keccak256("QUESTION_RESOLVE_ROLE");
    bytes32 public constant MARKET_VALIDATOR_ROLE = keccak256("MARKET_VALIDATOR_ROLE");

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
        PAID,           // Regular betting token markets
        FREE_ENTRY,     // Free markets with limited participation
        SPONSORED       // Sponsored by third parties with prize pools
    }

    // Order Types
    enum OrderType {
        MARKET,
        LIMIT
    }

    // Order Side
    enum OrderSide {
        BUY,
        SELL
    }

    struct MarketOption {
        string name;
        string description;
        uint256 totalShares;
        uint256 totalVolume;
        uint256 currentPrice; // Price in wei (scaled by 1e18)
        bool isActive;
        uint256 k; // AMM liquidity constant for this option
        uint256 reserve; // AMM reserve for this option
    }

    struct FreeMarketConfig {
        uint256 maxFreeParticipants;     // Max users who can enter for free
        uint256 freeSharesPerUser;       // Max free shares per user
        uint256 currentFreeParticipants; // Current count
        bool isActive;                   // Can still accept free entries
        mapping(address => bool) hasClaimedFree; // Track who claimed free shares
        mapping(address => uint256) freeSharesClaimed; // Amount claimed per user
    }

    struct SponsoredMarketConfig {
        address sponsor;                 // Sponsor address
        uint256 sponsorPrize;           // Total prize pool from sponsor
        uint256 minimumParticipants;    // Min participants for prize distribution
        bool prizeDistributed;          // Whether prize has been distributed
        string sponsorMessage;          // Sponsor message/branding
    }

    struct Market {
        string question;
        string description;
        uint256 endTime;
        MarketCategory category;
        MarketType marketType;           // NEW: Market type (PAID, FREE_ENTRY, SPONSORED)
        uint256 winningOptionId;
        bool resolved;
        bool disputed;
        bool validated;
        address creator;
        uint256 totalLiquidity;
        uint256 totalVolume;
        uint256 createdAt;
        uint256 optionCount;
        uint256 ammLiquidityPool;        // NEW: Total AMM liquidity
        mapping(uint256 => MarketOption) options;
        mapping(address => mapping(uint256 => uint256)) userShares; // user => optionId => shares
        mapping(address => bool) hasClaimed;
        address[] participants;
        uint256 payoutIndex;
        uint256 feeCollected;
        FreeMarketConfig freeConfig;     // NEW: Free market configuration
        SponsoredMarketConfig sponsorConfig; // NEW: Sponsored market configuration
    }

    struct Order {
        uint256 id;
        uint256 marketId;
        uint256 optionId;
        address maker;
        OrderType orderType;
        OrderSide side;
        uint256 price; // Price per share in wei
        uint256 quantity; // Number of shares
        uint256 filled; // Amount filled
        uint256 timestamp;
        bool isActive;
    }

    struct Trade {
        uint256 marketId;
        uint256 optionId;
        address buyer;
        address seller;
        uint256 price;
        uint256 quantity;
        uint256 timestamp;
        OrderType orderType;
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

    struct MarketStats {
        uint256 totalVolume;
        uint256 participantCount;
        uint256 averagePrice;
        uint256 priceVolatility;
        uint256 lastTradePrice;
        uint256 lastTradeTime;
    }

    struct LeaderboardEntry {
        address user;
        uint256 totalWinnings;
        uint256 totalVolume;
        uint256 winRate;
        uint256 tradeCount;
    }

    // State variables
    IERC20 public bettingToken;
    address public previousBettingToken;     // NEW: Track previous token for migration
    uint256 public tokenUpdatedAt;           // NEW: When token was last updated
    uint256 public marketCount;
    uint256 public orderCount;
    uint256 public tradeCount;
    uint256 public platformFeeRate = 200; // 2% (basis points)
    uint256 public constant MAX_OPTIONS = 10;
    uint256 public constant MIN_MARKET_DURATION = 1 hours;
    uint256 public constant MAX_MARKET_DURATION = 365 days;
    uint256 public constant AMM_FEE_RATE = 30; // 0.3% AMM swap fee
    uint256 public freeMarketAllowance = 1000; // Global free shares allowance

    // Mappings
    mapping(uint256 => Market) public markets;
    mapping(uint256 => Order) public orders;
    mapping(address => UserPortfolio) public userPortfolios;
    mapping(address => Trade[]) public userTradeHistory;
    mapping(uint256 => Trade[]) public marketTrades;
    mapping(uint256 => mapping(uint256 => PricePoint[])) public priceHistory; // marketId => optionId => prices
    mapping(uint256 => uint256[]) public marketOrderBook; // marketId => orderIds
    mapping(address => uint256[]) public userOrders;
    mapping(MarketCategory => uint256[]) public categoryMarkets;
    mapping(address => uint256) public totalWinnings;
    mapping(MarketType => uint256[]) public marketsByType; // NEW: Markets by type
    mapping(address => uint256) public userFreeSharesUsed; // NEW: Track free shares used per user
    address[] public allParticipants;

    // Events
    event MarketCreated(
        uint256 indexed marketId,
        string question,
        string[] options,
        uint256 endTime,
        MarketCategory category,
        MarketType marketType,
        address creator
    );
    event FreeSharesClaimed(uint256 indexed marketId, address indexed user, uint256 optionId, uint256 shares);
    event MarketSponsored(uint256 indexed marketId, address indexed sponsor, uint256 prizeAmount, string message);
    event BettingTokenUpdated(address indexed oldToken, address indexed newToken, uint256 timestamp);
    event AMMSwap(uint256 indexed marketId, uint256 optionIdIn, uint256 optionIdOut, uint256 amountIn, uint256 amountOut, address trader);
    event LiquidityAdded(uint256 indexed marketId, address indexed provider, uint256 amount);
    event MarketValidated(uint256 indexed marketId, address validator);
    event OrderPlaced(
        uint256 indexed orderId,
        uint256 indexed marketId,
        uint256 indexed optionId,
        address maker,
        OrderType orderType,
        OrderSide side,
        uint256 price,
        uint256 quantity
    );
    event OrderCancelled(uint256 indexed orderId, address maker);
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
        uint256 indexed marketId,
        uint256 indexed optionId,
        address indexed seller,
        uint256 quantity,
        uint256 price
    );
    event MarketResolved(uint256 indexed marketId, uint256 winningOptionId, address resolver);
    event MarketDisputed(uint256 indexed marketId, address disputer, string reason);
    event Claimed(uint256 indexed marketId, address indexed user, uint256 amount);
    event FeeCollected(uint256 indexed marketId, uint256 amount);
    event MarketPaused(uint256 indexed marketId);

    constructor(address _bettingToken) Ownable(msg.sender) {
        bettingToken = IERC20(_bettingToken);
        tokenUpdatedAt = block.timestamp;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // Token Management Functions
    function updateBettingToken(address _newToken) external {
        require(
            msg.sender == owner() || hasRole(DEFAULT_ADMIN_ROLE, msg.sender),
            "Only owner or admin can update betting token"
        );
        require(_newToken != address(0), "Invalid token address");
        require(_newToken != address(bettingToken), "Same token already set");
        
        previousBettingToken = address(bettingToken);
        bettingToken = IERC20(_newToken);
        tokenUpdatedAt = block.timestamp;
        
        emit BettingTokenUpdated(previousBettingToken, _newToken, block.timestamp);
    }

    function setFreeMarketAllowance(uint256 _allowance) external onlyOwner {
        freeMarketAllowance = _allowance;
    }

    // Modifiers
    modifier validMarket(uint256 _marketId) {
        require(_marketId < marketCount, "Market does not exist");
        _;
    }

    modifier marketActive(uint256 _marketId) {
        require(block.timestamp < markets[_marketId].endTime, "Market has ended");
        require(!markets[_marketId].resolved, "Market already resolved");
        _;
    }

    modifier validOption(uint256 _marketId, uint256 _optionId) {
        require(_optionId < markets[_marketId].optionCount, "Invalid option");
        require(markets[_marketId].options[_optionId].isActive, "Option not active");
        _;
    }

    // Admin Functions
    function grantQuestionCreatorRole(address _account) external onlyOwner {
        grantRole(QUESTION_CREATOR_ROLE, _account);
    }

    function grantQuestionResolveRole(address _account) external onlyOwner {
        grantRole(QUESTION_RESOLVE_ROLE, _account);
    }

    function grantMarketValidatorRole(address _account) external onlyOwner {
        grantRole(MARKET_VALIDATOR_ROLE, _account);
    }

    function setPlatformFeeRate(uint256 _feeRate) external onlyOwner {
        require(_feeRate <= 1000, "Fee rate too high"); // Max 10%
        platformFeeRate = _feeRate;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // Market Creation
    function createMarket(
        string memory _question,
        string memory _description,
        string[] memory _optionNames,
        string[] memory _optionDescriptions,
        uint256 _duration,
        MarketCategory _category,
        MarketType _marketType,
        uint256 _initialLiquidity
    ) external whenNotPaused returns (uint256) {
        require(
            msg.sender == owner() || hasRole(QUESTION_CREATOR_ROLE, msg.sender),
            "Not authorized to create markets"
        );
        require(_duration >= MIN_MARKET_DURATION && _duration <= MAX_MARKET_DURATION, "Invalid duration");
        require(bytes(_question).length > 0, "Question cannot be empty");
        require(_optionNames.length >= 2 && _optionNames.length <= MAX_OPTIONS, "Invalid number of options");
        require(_optionNames.length == _optionDescriptions.length, "Options and descriptions length mismatch");
        require(_initialLiquidity >= 100 * 1e18, "Minimum 100 tokens initial liquidity required");

        // Transfer initial liquidity from creator
        require(bettingToken.transferFrom(msg.sender, address(this), _initialLiquidity), "Liquidity transfer failed");

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

        // Initialize AMM liquidity pool with provided liquidity
        market.ammLiquidityPool = _initialLiquidity;

        // Initialize options with equal starting prices and AMM constants
        uint256 initialPrice = 1e18 / _optionNames.length; // Equal probability distribution
        uint256 initialK = _initialLiquidity / _optionNames.length; // AMM constant per option
        
        for (uint256 i = 0; i < _optionNames.length; i++) {
            market.options[i] = MarketOption({
                name: _optionNames[i],
                description: _optionDescriptions[i],
                totalShares: 0,
                totalVolume: 0,
                currentPrice: initialPrice,
                isActive: true,
                k: initialK,
                reserve: initialK
            });

            // Initialize price history
            priceHistory[marketId][i].push(PricePoint({
                price: initialPrice,
                timestamp: block.timestamp,
                volume: 0
            }));
        }

        categoryMarkets[_category].push(marketId);
        marketsByType[_marketType].push(marketId);

        emit MarketCreated(marketId, _question, _optionNames, market.endTime, _category, _marketType, msg.sender);
        return marketId;
    }

    // Create Free Entry Market
    function createFreeMarket(
        string memory _question,
        string memory _description,
        string[] memory _optionNames,
        string[] memory _optionDescriptions,
        uint256 _duration,
        MarketCategory _category,
        uint256 _maxFreeParticipants,
        uint256 _freeSharesPerUser,
        uint256 _initialLiquidity
    ) external whenNotPaused returns (uint256) {
        uint256 marketId = createMarket(_question, _description, _optionNames, _optionDescriptions, _duration, _category, MarketType.FREE_ENTRY, _initialLiquidity);
        
        Market storage market = markets[marketId];
        market.freeConfig.maxFreeParticipants = _maxFreeParticipants;
        market.freeConfig.freeSharesPerUser = _freeSharesPerUser;
        market.freeConfig.isActive = true;
        
        return marketId;
    }

    // Create Sponsored Market
    function createSponsoredMarket(
        string memory _question,
        string memory _description,
        string[] memory _optionNames,
        string[] memory _optionDescriptions,
        uint256 _duration,
        MarketCategory _category,
        uint256 _minimumParticipants,
        string memory _sponsorMessage,
        uint256 _initialLiquidity
    ) external payable whenNotPaused returns (uint256) {
        require(msg.value > 0, "Sponsor prize required");
        
        uint256 marketId = createMarket(_question, _description, _optionNames, _optionDescriptions, _duration, _category, MarketType.SPONSORED, _initialLiquidity);
        
        Market storage market = markets[marketId];
        market.sponsorConfig.sponsor = msg.sender;
        market.sponsorConfig.sponsorPrize = msg.value;
        market.sponsorConfig.minimumParticipants = _minimumParticipants;
        market.sponsorConfig.sponsorMessage = _sponsorMessage;
        
        emit MarketSponsored(marketId, msg.sender, msg.value, _sponsorMessage);
        return marketId;
    }

    // Create Market with Default Liquidity (convenience function)
    function createMarketWithDefaultLiquidity(
        string memory _question,
        string memory _description,
        string[] memory _optionNames,
        string[] memory _optionDescriptions,
        uint256 _duration,
        MarketCategory _category,
        MarketType _marketType
    ) external whenNotPaused returns (uint256) {
        uint256 defaultLiquidity = 1000 * 1e18; // 1000 tokens default
        return createMarket(_question, _description, _optionNames, _optionDescriptions, _duration, _category, _marketType, defaultLiquidity);
    }

    function validateMarket(uint256 _marketId) external validMarket(_marketId) {
        require(hasRole(MARKET_VALIDATOR_ROLE, msg.sender) || msg.sender == owner(), "Not authorized");
        require(!markets[_marketId].validated, "Market already validated");
        
        markets[_marketId].validated = true;
        emit MarketValidated(_marketId, msg.sender);
    }

    // Trading Functions
    function claimFreeShares(
        uint256 _marketId,
        uint256 _optionId
    ) external nonReentrant whenNotPaused validMarket(_marketId) marketActive(_marketId) validOption(_marketId, _optionId) {
        Market storage market = markets[_marketId];
        require(market.marketType == MarketType.FREE_ENTRY, "Not a free market");
        require(market.freeConfig.isActive, "Free entry no longer active");
        require(!market.freeConfig.hasClaimedFree[msg.sender], "Already claimed free shares");
        require(market.freeConfig.currentFreeParticipants < market.freeConfig.maxFreeParticipants, "Free slots full");
        require(userFreeSharesUsed[msg.sender] + market.freeConfig.freeSharesPerUser <= freeMarketAllowance, "Exceeds free allowance");

        uint256 freeShares = market.freeConfig.freeSharesPerUser;
        
        // Update tracking
        market.freeConfig.hasClaimedFree[msg.sender] = true;
        market.freeConfig.freeSharesClaimed[msg.sender] = freeShares;
        market.freeConfig.currentFreeParticipants++;
        userFreeSharesUsed[msg.sender] += freeShares;

        // Add user as participant if new
        if (_isNewParticipant(msg.sender, _marketId)) {
            market.participants.push(msg.sender);
            if (userPortfolios[msg.sender].totalInvested == 0) {
                allParticipants.push(msg.sender);
            }
        }

        // Update shares
        market.userShares[msg.sender][_optionId] += freeShares;
        market.options[_optionId].totalShares += freeShares;
        
        // Update user portfolio
        userPortfolios[msg.sender].tradeCount++;

        emit FreeSharesClaimed(_marketId, msg.sender, _optionId, freeShares);
    }

    // AMM Swap Function
    function ammSwap(
        uint256 _marketId,
        uint256 _optionIdIn,
        uint256 _optionIdOut,
        uint256 _amountIn,
        uint256 _minAmountOut
    ) external nonReentrant whenNotPaused validMarket(_marketId) marketActive(_marketId) returns (uint256 amountOut) {
        require(_optionIdIn != _optionIdOut, "Cannot swap same option");
        require(_amountIn > 0, "Amount must be positive");
        require(markets[_marketId].userShares[msg.sender][_optionIdIn] >= _amountIn, "Insufficient shares");

        Market storage market = markets[_marketId];
        MarketOption storage optionIn = market.options[_optionIdIn];
        MarketOption storage optionOut = market.options[_optionIdOut];

        // Calculate AMM swap using constant product formula: x * y = k
        uint256 reserveIn = optionIn.reserve;
        uint256 reserveOut = optionOut.reserve;
        
        // Apply AMM fee
        uint256 amountInWithFee = _amountIn * (10000 - AMM_FEE_RATE) / 10000;
        
        // Calculate output amount: amountOut = (reserveOut * amountInWithFee) / (reserveIn + amountInWithFee)
        amountOut = (reserveOut * amountInWithFee) / (reserveIn + amountInWithFee);
        require(amountOut >= _minAmountOut, "Insufficient output amount");
        require(amountOut < reserveOut, "Insufficient liquidity");

        // Update reserves
        optionIn.reserve += _amountIn;
        optionOut.reserve -= amountOut;

        // Update user shares
        market.userShares[msg.sender][_optionIdIn] -= _amountIn;
        market.userShares[msg.sender][_optionIdOut] += amountOut;

        // Update prices based on new reserves
        optionIn.currentPrice = (optionIn.k * 1e18) / optionIn.reserve;
        optionOut.currentPrice = (optionOut.k * 1e18) / optionOut.reserve;

        // Record price history
        priceHistory[_marketId][_optionIdIn].push(PricePoint({
            price: optionIn.currentPrice,
            timestamp: block.timestamp,
            volume: _amountIn * optionIn.currentPrice / 1e18
        }));

        priceHistory[_marketId][_optionIdOut].push(PricePoint({
            price: optionOut.currentPrice,
            timestamp: block.timestamp,
            volume: amountOut * optionOut.currentPrice / 1e18
        }));

        emit AMMSwap(_marketId, _optionIdIn, _optionIdOut, _amountIn, amountOut, msg.sender);
        return amountOut;
    }

    function buyShares(
        uint256 _marketId,
        uint256 _optionId,
        uint256 _quantity,
        uint256 _maxPricePerShare
    ) external nonReentrant whenNotPaused validMarket(_marketId) marketActive(_marketId) validOption(_marketId, _optionId) {
        require(_quantity > 0, "Quantity must be positive");
        require(markets[_marketId].validated, "Market not validated");

        Market storage market = markets[_marketId];
        MarketOption storage option = market.options[_optionId];

        uint256 currentPrice = calculateCurrentPrice(_marketId, _optionId);
        require(currentPrice <= _maxPricePerShare, "Price too high");

        uint256 totalCost = currentPrice * _quantity / 1e18;
        uint256 fee = totalCost * platformFeeRate / 10000;
        uint256 netCost = totalCost + fee;

        require(bettingToken.transferFrom(msg.sender, address(this), netCost), "Transfer failed");

        // Update user shares
        if (market.userShares[msg.sender][_optionId] == 0 && _isNewParticipant(msg.sender, _marketId)) {
            market.participants.push(msg.sender);
            if (userPortfolios[msg.sender].totalInvested == 0) {
                allParticipants.push(msg.sender);
            }
        }

        market.userShares[msg.sender][_optionId] += _quantity;
        option.totalShares += _quantity;
        option.totalVolume += totalCost;
        market.totalLiquidity += totalCost;
        market.totalVolume += totalCost;
        market.feeCollected += fee;

        // Update user portfolio
        userPortfolios[msg.sender].totalInvested += netCost;
        userPortfolios[msg.sender].tradeCount++;

        // Update price based on demand
        option.currentPrice = calculateNewPrice(_marketId, _optionId, _quantity, true);

        // Record price history
        priceHistory[_marketId][_optionId].push(PricePoint({
            price: option.currentPrice,
            timestamp: block.timestamp,
            volume: totalCost
        }));

        // Record trade
        Trade memory trade = Trade({
            marketId: _marketId,
            optionId: _optionId,
            buyer: msg.sender,
            seller: address(0), // Market maker
            price: currentPrice,
            quantity: _quantity,
            timestamp: block.timestamp,
            orderType: OrderType.MARKET
        });

        userTradeHistory[msg.sender].push(trade);
        marketTrades[_marketId].push(trade);

        emit TradeExecuted(_marketId, _optionId, msg.sender, address(0), currentPrice, _quantity, tradeCount++);
        emit FeeCollected(_marketId, fee);
    }

    function sellShares(
        uint256 _marketId,
        uint256 _optionId,
        uint256 _quantity,
        uint256 _minPricePerShare
    ) external nonReentrant whenNotPaused validMarket(_marketId) marketActive(_marketId) validOption(_marketId, _optionId) {
        require(_quantity > 0, "Quantity must be positive");
        require(markets[_marketId].userShares[msg.sender][_optionId] >= _quantity, "Insufficient shares");

        Market storage market = markets[_marketId];
        MarketOption storage option = market.options[_optionId];

        uint256 currentPrice = calculateCurrentPrice(_marketId, _optionId);
        require(currentPrice >= _minPricePerShare, "Price too low");

        uint256 totalRevenue = currentPrice * _quantity / 1e18;
        uint256 fee = totalRevenue * platformFeeRate / 10000;
        uint256 netRevenue = totalRevenue - fee;

        // Update shares
        market.userShares[msg.sender][_optionId] -= _quantity;
        option.totalShares -= _quantity;
        option.totalVolume += totalRevenue;
        market.totalVolume += totalRevenue;
        market.feeCollected += fee;

        // Update price based on supply
        option.currentPrice = calculateNewPrice(_marketId, _optionId, _quantity, false);

        // Calculate P&L: (sell price - avg cost basis) * quantity
        // For simplicity, we'll use current price as cost basis approximation
        int256 pnl = int256(netRevenue) - int256(currentPrice * _quantity / 1e18);
        userPortfolios[msg.sender].realizedPnL += pnl;
        userPortfolios[msg.sender].tradeCount++;

        // Record price history
        priceHistory[_marketId][_optionId].push(PricePoint({
            price: option.currentPrice,
            timestamp: block.timestamp,
            volume: totalRevenue
        }));

        // Record trade
        Trade memory trade = Trade({
            marketId: _marketId,
            optionId: _optionId,
            buyer: address(0), // Market maker
            seller: msg.sender,
            price: currentPrice,
            quantity: _quantity,
            timestamp: block.timestamp,
            orderType: OrderType.MARKET
        });

        userTradeHistory[msg.sender].push(trade);
        marketTrades[_marketId].push(trade);

        require(bettingToken.transfer(msg.sender, netRevenue), "Transfer failed");

        emit SharesSold(_marketId, _optionId, msg.sender, _quantity, currentPrice);
        emit TradeExecuted(_marketId, _optionId, address(0), msg.sender, currentPrice, _quantity, tradeCount++);
        emit FeeCollected(_marketId, fee);
    }

    // Market Resolution
    function resolveMarket(uint256 _marketId, uint256 _winningOptionId) external validMarket(_marketId) {
        require(
            msg.sender == owner() || hasRole(QUESTION_RESOLVE_ROLE, msg.sender),
            "Not authorized to resolve markets"
        );
        Market storage market = markets[_marketId];
        require(block.timestamp >= market.endTime, "Market has not ended yet");
        require(!market.resolved, "Market already resolved");
        require(_winningOptionId < market.optionCount, "Invalid winning option");

        market.winningOptionId = _winningOptionId;
        market.resolved = true;

        emit MarketResolved(_marketId, _winningOptionId, msg.sender);
    }

    function disputeMarket(uint256 _marketId, string memory _reason) external validMarket(_marketId) {
        require(markets[_marketId].resolved, "Market not resolved yet");
        require(!markets[_marketId].disputed, "Market already disputed");
        require(markets[_marketId].userShares[msg.sender][markets[_marketId].winningOptionId] == 0, "Cannot dispute if you won");

        markets[_marketId].disputed = true;
        emit MarketDisputed(_marketId, msg.sender, _reason);
    }

    // Payout Functions
    function claimWinnings(uint256 _marketId) external nonReentrant validMarket(_marketId) {
        Market storage market = markets[_marketId];
        require(market.resolved && !market.disputed, "Market not ready for claims");
        require(!market.hasClaimed[msg.sender], "Already claimed");

        uint256 userWinningShares = market.userShares[msg.sender][market.winningOptionId];
        require(userWinningShares > 0, "No winning shares");

        uint256 totalWinningShares = market.options[market.winningOptionId].totalShares;
        uint256 totalLosingValue = market.totalLiquidity - (totalWinningShares * market.options[market.winningOptionId].currentPrice / 1e18);
        
        uint256 winnings = (userWinningShares * market.options[market.winningOptionId].currentPrice / 1e18) + 
                          (userWinningShares * totalLosingValue / totalWinningShares);

        market.hasClaimed[msg.sender] = true;
        userPortfolios[msg.sender].totalWinnings += winnings;
        totalWinnings[msg.sender] += winnings;

        require(bettingToken.transfer(msg.sender, winnings), "Transfer failed");
        emit Claimed(_marketId, msg.sender, winnings);
    }

    // Price Calculation Functions
    function calculateCurrentPrice(uint256 _marketId, uint256 _optionId) public view returns (uint256) {
        Market storage market = markets[_marketId];
        return market.options[_optionId].currentPrice;
    }

    function calculateNewPrice(uint256 _marketId, uint256 _optionId, uint256 _quantity, bool _isBuy) internal view returns (uint256) {
        Market storage market = markets[_marketId];
        MarketOption storage option = market.options[_optionId];
        
        // Use AMM pricing model based on reserves
        uint256 reserve = option.reserve;
        uint256 k = option.k;
        
        if (_isBuy) {
            // New reserve after buying shares
            uint256 newReserve = reserve + _quantity;
            return (k * 1e18) / newReserve;
        } else {
            // New reserve after selling shares
            uint256 newReserve = reserve > _quantity ? reserve - _quantity : reserve / 2;
            return (k * 1e18) / newReserve;
        }
    }

    // Add AMM Liquidity
    function addAMMLiquidity(uint256 _marketId, uint256 _amount) external nonReentrant validMarket(_marketId) {
        require(_amount > 0, "Amount must be positive");
        require(bettingToken.transferFrom(msg.sender, address(this), _amount), "Transfer failed");
        
        Market storage market = markets[_marketId];
        market.ammLiquidityPool += _amount;
        
        // Distribute liquidity across options proportionally
        uint256 amountPerOption = _amount / market.optionCount;
        for (uint256 i = 0; i < market.optionCount; i++) {
            market.options[i].k += amountPerOption;
            market.options[i].reserve += amountPerOption;
        }
        
        emit LiquidityAdded(_marketId, msg.sender, _amount);
    }

    // Sell shares with AMM pricing
    function sellShares(uint256 _marketId, uint256 _optionId, uint256 _quantity) external nonReentrant validMarket(_marketId) {
        require(_quantity > 0, "Quantity must be positive");
        require(markets[_marketId].userShares[msg.sender][_optionId] >= _quantity, "Insufficient shares");
        
        Market storage market = markets[_marketId];
        require(!market.resolved, "Market already resolved");
        
        MarketOption storage option = market.options[_optionId];
        uint256 sellPrice = calculateSellPrice(_marketId, _optionId, _quantity);
        
        // Update AMM reserves
        option.reserve = option.reserve > _quantity ? option.reserve - _quantity : option.reserve / 2;
        
        // Update user shares
        market.userShares[msg.sender][_optionId] -= _quantity;
        option.totalShares -= _quantity;
        
        // Transfer tokens to user
        require(bettingToken.transfer(msg.sender, sellPrice), "Transfer failed");
        
        emit SharesSold(msg.sender, _marketId, _optionId, _quantity, sellPrice);
    }

    function calculateSellPrice(uint256 _marketId, uint256 _optionId, uint256 _quantity) public view returns (uint256) {
        Market storage market = markets[_marketId];
        MarketOption storage option = market.options[_optionId];
        
        // Calculate sell price using AMM formula with 0.3% fee
        uint256 newReserve = option.reserve > _quantity ? option.reserve - _quantity : option.reserve / 2;
        uint256 newPrice = (option.k * 1e18) / newReserve;
        uint256 sellPrice = newPrice * _quantity / 1e18;
        
        // Apply 0.3% fee
        return sellPrice * 997 / 1000;
    }

    // Get current market odds for all options
    function getMarketOdds(uint256 _marketId) external view validMarket(_marketId) returns (uint256[] memory) {
        Market storage market = markets[_marketId];
        uint256[] memory odds = new uint256[](market.optionCount);
        
        uint256 totalLiquidity = 0;
        for (uint256 i = 0; i < market.optionCount; i++) {
            totalLiquidity += market.options[i].k;
        }
        
        for (uint256 i = 0; i < market.optionCount; i++) {
            odds[i] = (market.options[i].k * 1e18) / totalLiquidity;
        }
        
        return odds;
    }

    // Emergency functions
    function pauseMarket(uint256 _marketId) external onlyOwner validMarket(_marketId) {
        markets[_marketId].resolved = true;
        emit MarketPaused(_marketId);
    }

    function updateBettingTokenAddress(address _newToken) external onlyOwner {
        require(_newToken != address(0), "Invalid token address");
        previousBettingToken = address(bettingToken);
        bettingToken = IERC20(_newToken);
        tokenUpdatedAt = block.timestamp;
        
        emit BettingTokenUpdated(previousBettingToken, _newToken);
    }

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
    function getMarketInfo(uint256 _marketId) external view validMarket(_marketId) returns (
        string memory question,
        string memory description,
        uint256 endTime,
        MarketCategory category,
        uint256 optionCount,
        bool resolved,
        bool disputed,
        uint256 winningOptionId,
        address creator
    ) {
        Market storage market = markets[_marketId];
        return (
            market.question,
            market.description,
            market.endTime,
            market.category,
            market.optionCount,
            market.resolved,
            market.disputed,
            market.winningOptionId,
            market.creator
        );
    }

    function getMarketOption(uint256 _marketId, uint256 _optionId) external view validMarket(_marketId) returns (
        string memory name,
        string memory description,
        uint256 totalShares,
        uint256 totalVolume,
        uint256 currentPrice,
        bool isActive
    ) {
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

    function getUserShares(uint256 _marketId, address _user) external view validMarket(_marketId) returns (uint256[] memory) {
        Market storage market = markets[_marketId];
        uint256[] memory shares = new uint256[](market.optionCount);
        for (uint256 i = 0; i < market.optionCount; i++) {
            shares[i] = market.userShares[_user][i];
        }
        return shares;
    }

    function getUserPortfolio(address _user) external view returns (UserPortfolio memory) {
        return userPortfolios[_user];
    }

    function getMarketStats(uint256 _marketId) external view validMarket(_marketId) returns (MarketStats memory) {
        Market storage market = markets[_marketId];
        
        // Calculate average price across all options
        uint256 totalPrice = 0;
        for (uint256 i = 0; i < market.optionCount; i++) {
            totalPrice += market.options[i].currentPrice;
        }
        uint256 averagePrice = totalPrice / market.optionCount;

        return MarketStats({
            totalVolume: market.totalVolume,
            participantCount: market.participants.length,
            averagePrice: averagePrice,
            priceVolatility: 0, // Would need historical price analysis
            lastTradePrice: marketTrades[_marketId].length > 0 ? marketTrades[_marketId][marketTrades[_marketId].length - 1].price : 0,
            lastTradeTime: marketTrades[_marketId].length > 0 ? marketTrades[_marketId][marketTrades[_marketId].length - 1].timestamp : 0
        });
    }

    function getPriceHistory(uint256 _marketId, uint256 _optionId, uint256 _limit) external view returns (PricePoint[] memory) {
        PricePoint[] storage history = priceHistory[_marketId][_optionId];
        uint256 length = history.length;
        uint256 returnLength = _limit > length ? length : _limit;
        
        PricePoint[] memory result = new PricePoint[](returnLength);
        uint256 startIndex = length > _limit ? length - _limit : 0;
        
        for (uint256 i = 0; i < returnLength; i++) {
            result[i] = history[startIndex + i];
        }
        
        return result;
    }

    function getMarketsByCategory(MarketCategory _category, uint256 _limit) external view returns (uint256[] memory) {
        uint256[] storage categoryMarketIds = categoryMarkets[_category];
        uint256 length = categoryMarketIds.length;
        uint256 returnLength = _limit > length ? length : _limit;
        
        uint256[] memory result = new uint256[](returnLength);
        uint256 startIndex = length > _limit ? length - _limit : 0;
        
        for (uint256 i = 0; i < returnLength; i++) {
            result[i] = categoryMarketIds[startIndex + i];
        }
        
        return result;
    }

    function getLeaderboard(uint256 _start, uint256 _limit) external view returns (LeaderboardEntry[] memory) {
        require(_start < allParticipants.length, "Start index out of bounds");
        uint256 end = _start + _limit > allParticipants.length ? allParticipants.length : _start + _limit;
        LeaderboardEntry[] memory entries = new LeaderboardEntry[](end - _start);

        for (uint256 i = _start; i < end; i++) {
            address user = allParticipants[i];
            UserPortfolio memory portfolio = userPortfolios[user];
            
            uint256 winRate = portfolio.tradeCount > 0 ? 
                (portfolio.totalWinnings * 100 / portfolio.totalInvested) : 0;

            entries[i - _start] = LeaderboardEntry({
                user: user,
                totalWinnings: portfolio.totalWinnings,
                totalVolume: portfolio.totalInvested,
                winRate: winRate,
                tradeCount: portfolio.tradeCount
            });
        }
        return entries;
    }

    function getMarketCount() external view returns (uint256) {
        return marketCount;
    }

    function getBettingToken() external view returns (address) {
        return address(bettingToken);
    }
}
