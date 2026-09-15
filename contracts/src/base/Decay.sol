// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @notice Exponential decay toward a floor with a fixed half-life, integer-only.
/// value = floor + gap * 0.5^(elapsed/halfLife), where the fractional part of a halving is linearly interpolated.
library Decay {
    function decay(uint256 start, uint256 floor, uint256 elapsed, uint256 halfLife) internal pure returns (uint256) {
        if (start <= floor) return floor;
        uint256 gap = start - floor;
        uint256 halvings = elapsed / halfLife;
        if (halvings >= 128) return floor;
        gap >>= halvings;
        uint256 rem = elapsed % halfLife;
        // linear interpolation inside the current halving: gap -> gap/2 over halfLife
        gap -= (gap * rem) / (2 * halfLife);
        return floor + gap;
    }
}
