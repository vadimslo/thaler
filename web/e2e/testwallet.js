// Injects an EIP-6963 test wallet backed by a local private key (Sepolia only).
// Usage in the page: window.__installTestWallet(PRIVATE_KEY). Testnet only, never mainnet.
(async () => {
  const viem = await import('https://esm.sh/viem@2.21.55');
  const accounts = await import('https://esm.sh/viem@2.21.55/accounts');
  const chains = await import('https://esm.sh/viem@2.21.55/chains');
  const RPC = 'https://ethereum-sepolia-rpc.publicnode.com';
  window.__installTestWallet = (pk) => {
    const account = accounts.privateKeyToAccount(pk);
    const pub = viem.createPublicClient({ chain: chains.sepolia, transport: viem.http(RPC) });
    const wallet = viem.createWalletClient({ account, chain: chains.sepolia, transport: viem.http(RPC) });
    const listeners = {};
    const log = [];
    const provider = {
      isTestWallet: true,
      async request({ method, params = [] }) {
        log.push(method);
        switch (method) {
          case 'eth_requestAccounts':
          case 'eth_accounts': return [account.address];
          case 'eth_chainId': return '0xaa36a7';
          case 'net_version': return '11155111';
          case 'wallet_switchEthereumChain':
          case 'wallet_addEthereumChain': return null;
          case 'wallet_getPermissions':
          case 'wallet_requestPermissions': return [{ parentCapability: 'eth_accounts' }];
          case 'eth_sendTransaction': {
            const tx = params[0];
            const hash = await wallet.sendTransaction({
              to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : undefined,
              gas: tx.gas ? BigInt(tx.gas) : undefined,
            });
            window.__lastTx = hash; return hash;
          }
          case 'personal_sign': return account.signMessage({ message: { raw: params[0] } });
          case 'eth_signTypedData_v4': return account.signTypedData(JSON.parse(params[1]));
          default: return pub.request({ method, params });
        }
      },
      on(ev, fn) { (listeners[ev] ||= []).push(fn); return provider; },
      removeListener(ev, fn) { listeners[ev] = (listeners[ev] || []).filter(f => f !== fn); return provider; },
      _log: log,
    };
    const info = { uuid: '11111111-2222-3333-4444-555555555555', name: 'Test Wallet', rdns: 'test.wallet',
      icon: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" fill="#c9a24a"/></svg>') };
    const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
    window.addEventListener('eip6963:requestProvider', announce);
    announce();
    window.ethereum = provider;
    return account.address;
  };
  window.__testWalletReady = true;
})();
