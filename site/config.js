// Addresses on X Layer (chain 196). registry / caseContract stay zero until they are deployed; `published` maps a template key
// to the circuit it was published as, e.g. warranty: {circuitId: 13}. With no circuit id the page computes in the browser and says so.
window.TB_CONFIG = {
  chainId: 196, rpc: "https://rpc.xlayer.tech", explorer: "https://www.oklink.com/xlayer",
  processor: "0x9e2849c04a513fe64db07521cbe52d078d905c0e",
  registry: "0x0000000000000000000000000000000000000000",
  caseContract: "0x0000000000000000000000000000000000000000",
  published: {}
};
