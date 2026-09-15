# Dependencies (not vendored)

`lib/` is ignored by git. Restore with:

```
cd contracts
forge install --no-git OpenZeppelin/openzeppelin-contracts@v5.1.0
forge install --no-git Uniswap/v4-periphery   # brings v4-core, forge-std, solmate, permit2 as nested libs
cp -R lib/v4-periphery/lib/v4-core lib/v4-core 2>/dev/null || true
```

Pinned at deployment (15 Sep 2026): openzeppelin-contracts v5.1.0, v4-core 46c6834 (same tree nested in v4-periphery main of that date). The verified sources on Sepolia Etherscan are the reference build; `forge verify-contract` against them confirms a local checkout.
