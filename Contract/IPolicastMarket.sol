// SPDX-License-Identifier: MIT

pragma solidity ^0.8.24;

interface IPolicastMarket {
    function getMarketFreeConfig(uint256 marketId)
        external
        view
        returns (
            uint256 maxFreeParticipants,
            uint256 tokensPerParticipant,
            uint256 currentFreeParticipants,
            uint256 totalPrizePool,
            uint256 remainingPrizePool,
            bool isActive
        );
    function userShares(address user, uint256 optionId) external view returns (uint256);
    function getMarketOption(uint256 marketId, uint256 optionId)
        external
        view
        returns (
            string memory name,
            string memory description,
            uint256 totalShares,
            uint256 totalVolume,
            uint256 currentPrice,
            bool isActive
        );
    function getMarketLMSRB(uint256 marketId) external view returns (uint256);
    function getMarketOptionUserShares(uint256 marketId, uint256 optionId, address user)
        external
        view
        returns (uint256);
    function updateUserShares(address user, uint256 marketId, uint256 optionId, uint256 quantity) external;
    function updateOptionShares(uint256 marketId, uint256 optionId, uint256 quantity) external;
    function updateMaxOptionShares(uint256 marketId, uint256 optionId) external;
    function updateLMSRPrices(uint256 marketId) external;
}
