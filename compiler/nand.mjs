// Tiny NAND-netlist builder. Refs: 0/1 reserved, inputs from 2, gates after inputs (TapeOut netlist layout, 7 bytes per NAND).
// Structural hashing merges identical gates. Outputs must be the LAST nOut gates, in order, each its own gate.
export class Net {
  constructor(nIn) { this.nIn = nIn; this.gates = []; this.memo = new Map(); this.inputs = Array.from({length: nIn}, (_, i) => 2 + i); }
  nand(a, b) {
    const k = a < b ? `${a},${b}` : `${b},${a}`;
    if (this.memo.has(k)) return this.memo.get(k);
    this.gates.push({a, b}); const r = 2 + this.nIn + this.gates.length - 1; this.memo.set(k, r); return r;
  }
  not(a) { return this.nand(a, a); }
  and(a, b) { return this.not(this.nand(a, b)); }
  or(a, b) { return this.nand(this.not(a), this.not(b)); }
  andAll(list) { let x = list[0]; for (const y of list.slice(1)) x = this.and(x, y); return x; }
  // Final output gate: a fresh, unshared NAND computing NOT(x) (x = a signal), so each output owns its gate.
  outputNot(x) { this.gates.push({a: x, b: x}); return 2 + this.nIn + this.gates.length - 1; }
}
export const hexOf = gates => "0x" + gates.map(g => "00" + g.a.toString(16).padStart(6, "0") + g.b.toString(16).padStart(6, "0")).join("");
export function evalGates(gates, nIn, nOut) {
  const rows = [];
  for (let m = 0; m < (1 << nIn); m++) {
    const v = {0: 0, 1: 1}; for (let k = 0; k < nIn; k++) v[2 + k] = (m >> k) & 1;
    gates.forEach((g, i) => { v[2 + nIn + i] = 1 - (v[g.a] & v[g.b]); });
    rows.push(Array.from({length: nOut}, (_, o) => v[2 + nIn + gates.length - nOut + o]));
  }
  return rows;
}
