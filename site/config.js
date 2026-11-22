// Addresses on X Layer (chain 196). registry / caseContract stay zero until they are deployed; `published` maps a template key
// to the circuit it was published as, e.g. warranty: {circuitId: 13}. With no circuit id the page computes in the browser and says so.
window.TB_CONFIG = {
  chainId: 196, rpc: "https://rpc.xlayer.tech", explorer: "https://www.oklink.com/xlayer",
  processor: "0x9e2849c04a513fe64db07521cbe52d078d905c0e",
  faucet: "0xBC58802002307fD80048e93A6475335eC65a4f39",          // free NAND, once per wallet
  transistors: "0xd0faafc5b9149cae7bd9af64070fee33c46ed619",      // NAND token (ERC-1155 id 0)
  tapeoutFeeWei: "1300000000000000",                              // 0.0013 OKB per tape-out
  registry: "0x25E87D367316038a2d3B6A4fe3d58AA453D4c219",
  caseContract: "0x0d45f65dC5C14cc4f4EE926e52979D3DcBd246B3",    // TiebreakCaseV2: set by scripts/deploy-case-v2.sh
  caseContractV1: "0x14c9C106d0A785091F77Fc36F5b2152a5d8C9987",  // the first, simpler case contract (no deadlines); still on-chain
  published: {warranty: {circuitId: 13, ruleSetId: 1}}
};
