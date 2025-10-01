// SPDX-License-Identifier: MIT
pragma solidity ^0.8.;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {PolicastLogic} from "./PolicastLogic.sol";
import {IPolicastMarket} from "./IPolicastMarket.sol";

contract FreeClaimHandler is ReentrancyGuard, Pausable, AccessControl {
    IERC20 public immutable bettingToken;
    uint256 public immutable platformFeeRate; // Inherit from main or pass
    address public immutable mainContract;

    error AutoBuyFailed();
    error NoContractsAllowed();
    error FreeEntryInactive();
    error AlreadyClaimedFree();
    error FreeSlotseFull();
    error InsufficientPrizePool();
    error SlippageExceeded();

    // Struct from main (copy or import if possible)
    struct FreeMarketConfig {
        uint256 maxFreeParticipants;
        uint256 tokensPerParticipant;
        uint256 currentFreeParticipants;
        uint256 totalPrizePool;
        uint256 remainingPrizePool;
        bool isActive;
        mapping(address => bool) hasClaimedFree;
        mapping(address => uint256) tokensReceived;
    }

    // Interface for main contract interaction
    // (interface is now outside contract)

    constructor(address _bettingToken, uint256 _feeRate, address _mainContract) {
    bettingToken = IERC20(_bettingToken);
    platformFeeRate = _feeRate;
    mainContract = _mainContract;  // Set explicitly
    }

    // Main entry: Auto-claim and buy (called by PolicastMarketV3)
    function claimAndAutoBuy(address _user, uint256 _marketId, uint256 _optionId, IPolicastMarket _market)
        external
        nonReentrant
        returns (uint256 sharesBought)
    {
        // Only main contract can call
        if (msg.sender != mainContract) revert NoContractsAllowed();
        // Checks: get config from main contract
        (
            ,
            uint256 tokensPerParticipant,
            ,
            , // totalPrizePool unused
            ,
            bool isActive
        ) = _market.getMarketFreeConfig(_marketId);
        if (!isActive) revert FreeEntryInactive();

        uint256 freeTokens = tokensPerParticipant;

        // Effects: update config in main contract (should expose setters)
        // Interactions: Auto-buy shares
        sharesBought = _autoBuyShares(_user, _marketId, _optionId, freeTokens, _market, type(uint256).max);
        if (sharesBought == 0) revert AutoBuyFailed();
    }

    // Internal auto-buy (simplified from buyShares)
    function _autoBuyShares(
        address _user,
        uint256 _marketId,
        uint256 _optionId,
        uint256 _freeTokens,
        IPolicastMarket _market,
        uint256 _maxTotalCost
    ) internal returns (uint256 sharesBought) {
        // Get current price from main contract
        (,,,, uint256 currentPrice,) = _market.getMarketOption(_marketId, _optionId);
        if (currentPrice == 0) return 0;
        // Calculate quantity of shares to buy
        uint256 quantity = (_freeTokens * 1e18) / currentPrice;
        if (quantity == 0) return 0;

        // Calculate LMSR cost before and after
        uint256 costBefore = _lmsrCostViaMarket(_marketId, _market);
        // Simulate add shares: update option shares in main contract
        _market.updateOptionShares(_marketId, _optionId, quantity);
        uint256 costAfter = _lmsrCostViaMarket(_marketId, _market);
        // Revert simulated shares
        _market.updateOptionShares(_marketId, _optionId, 0);

        uint256 rawCost = costAfter > costBefore ? costAfter - costBefore : 0;
        uint256 fee = (rawCost * platformFeeRate) / 10000;
        uint256 totalCost = rawCost + fee;
        if (totalCost > _maxTotalCost) revert SlippageExceeded();

        // Commit: update user shares in main contract
        _market.updateUserShares(_user, _marketId, _optionId, quantity);
        _market.updateMaxOptionShares(_marketId, _optionId);
        _market.updateLMSRPrices(_marketId);

        sharesBought = quantity;
    }

    // Helper for LMSR cost (delegate to main or compute here)
    function _lmsrCostViaMarket(uint256 _marketId, IPolicastMarket _market) internal view returns (uint256) {
        uint256 optionCount = 0;
        uint256 lmsrB = _market.getMarketLMSRB(_marketId);
        // Get option count from main contract (assume optionId 0 exists)
        (,,,,, bool isActive) = _market.getMarketOption(_marketId, 0);
        while (isActive) {
            optionCount++;
            (,,,,, isActive) = _market.getMarketOption(_marketId, optionCount);
        }
        // Build options array
        PolicastLogic.OptionData[] memory options = new PolicastLogic.OptionData[](optionCount);
        for (uint256 i = 0; i < optionCount; i++) {
            (,, uint256 totalShares,, uint256 currentPrice,) = _market.getMarketOption(_marketId, i);
            options[i] = PolicastLogic.OptionData({totalShares: totalShares, currentPrice: currentPrice});
        }
        PolicastLogic.MarketData memory marketData = PolicastLogic.MarketData({
            optionCount: optionCount,
            lmsrB: lmsrB,
            maxOptionShares: 0,
            userLiquidity: 0,
            adminInitialLiquidity: 0
        });
        return PolicastLogic.calculateLMSRCost(marketData, options);
    }
}
