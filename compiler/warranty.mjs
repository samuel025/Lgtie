// Warranty rule set (illustrative, see the brief). Inputs Q1..Q7 = bits 0..6; "yes" = 1 = the good answer.
// Result code (2 bits, out0 = LSB): 0 Not covered, 1 Needs review, 2 Partly covered (parts, not labour), 3 Covered.
import {Net, hexOf, evalGates} from "./nand.mjs";
export const QUESTIONS = [
  "Registered, or proof of purchase shown?", "Within the warranty period?", "Bought from an authorised seller?",
  "Is this type of damage or fault covered?", "No excluded cause (water, drop, unauthorised repair)?",
  "Within the usage limit?", "Is the requested repair type covered?"];
export const RESULTS = ["Not covered", "Needs review", "Partly covered (parts, not labour)", "Covered"];
// Reference implementation, written straight from the rule table in the brief.
export function reference(q) {
  const [q1, q2, q3, q4, q5, q6, q7] = q;
  if (!(q1 && q2 && q4 && q5 && q7)) return 0;
  if (!q3) return 1;
  if (!q6) return 2;
  return 3;
}
export function build() {
  const n = new Net(7), [Q1, Q2, Q3, Q4, Q5, Q6, Q7] = n.inputs;
  const pass = n.andAll([Q1, Q2, Q4, Q5, Q7]);
  const x1 = n.nand(pass, Q3);                 // out1 = pass AND Q3
  const t = n.nand(Q3, n.not(Q6));             // NOT(Q3 AND NOT Q6)
  const x0 = n.nand(pass, t);                  // out0 = pass AND NOT(Q3 AND NOT Q6)
  n.outputNot(x0); n.outputNot(x1);            // outputs are the last two gates, in output order: out0 (LSB) then out1
  return n;
}
