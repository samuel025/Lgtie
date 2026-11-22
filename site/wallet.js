// Minimal browser-wallet helper (no server): connect, switch to X Layer, send a transaction, wait for the receipt. Reads use the public RPC.
(function () {
  "use strict";
  const CFG = window.TB_CONFIG; let account = null;
  const eth = () => window.ethereum;
  const rpc = async (method, params) => { const r = await (await fetch(CFG.rpc, {method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify({jsonrpc: "2.0", id: 1, method, params})})).json(); if (r.error) throw new Error(r.error.message || "RPC error"); return r.result; };
  async function connect() {
    if (!eth()) throw new Error("No wallet found. Install a wallet such as OKX Wallet, then reload this page.");
    account = (await eth().request({method: "eth_requestAccounts"}))[0].toLowerCase();
    if (parseInt(await eth().request({method: "eth_chainId"}), 16) !== CFG.chainId) {
      try { await eth().request({method: "wallet_switchEthereumChain", params: [{chainId: "0x" + CFG.chainId.toString(16)}]}); }
      catch (e) { if (e && e.code === 4902) await eth().request({method: "wallet_addEthereumChain", params: [{chainId: "0x" + CFG.chainId.toString(16), chainName: "X Layer", nativeCurrency: {name: "OKB", symbol: "OKB", decimals: 18}, rpcUrls: [CFG.rpc], blockExplorerUrls: [CFG.explorer]}]}); else throw e; }
    }
    return account;
  }
  async function send(to, data, valueWei) {
    if (!account) await connect();
    const tx = {from: account, to, data}; if (valueWei && BigInt(valueWei) > 0n) tx.value = "0x" + BigInt(valueWei).toString(16);
    const hash = await eth().request({method: "eth_sendTransaction", params: [tx]});
    for (let i = 0; i < 120; i++) { const rc = await rpc("eth_getTransactionReceipt", [hash]); if (rc) { if (rc.status !== "0x1") throw new Error("The transaction failed on-chain: " + hash); return rc; } await new Promise(r => setTimeout(r, 1000)); }
    throw new Error("Timed out waiting for a transaction. It may still go through: " + hash);
  }
  window.TB_WALLET = {connect, send, rpc, account: () => account};
})();
