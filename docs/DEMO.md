# Three-minute demo script

Aim for 2:45 to 3:00. Record the screen with your voice. Nothing here needs a wallet extension except the optional step in the middle, so the safe path is: use the real case that is already on-chain.

Open these tabs before recording:
1. The site home page.
2. `#case/1` (the real case).
3. `#build`.
Have the wallet unlocked on a throwaway account only if you want to do the live step.

## 0:00 to 0:20: the problem

**Show:** the home page hero.
**Say:** "Publishing rules is easy. Applying them when two people disagree about the facts is hard. A customer says the product was bought from an authorised seller, the business says it was not. Today that is argued inside one side's own process. LGtie is the dispute layer: both sides answer the same questions, and only the answers they disagree on go to a person."

## 0:20 to 0:50: the rules are published, and anyone can replay them

**Show:** tap two or three answers in the live circuit on the hero. Point at the result and the reason.
**Say:** "These are the real 39 NAND gates published as circuit 13 on X Layer. The result and the reason change as the answers change. Anyone can re-run this on-chain for free, and the page proves the circuit matches the written rules on all 128 combinations."

## 0:50 to 1:20: build and publish (optional if short on time)

**Show:** `#build`. Click through the four steps quickly: Questions, Rules (click a few grid cells), Test (answer, watch the circuit light up and the rule that fired).
**Say:** "A business writes its policy as questions and rules. Click a cell to say yes, no or any. The Test step lights the rule that fired. Publishing records the circuit permanently with a fingerprint of the rules text."

## 1:20 to 2:20: a real case on X Layer

**Show:** the home page "Not a mock-up" card, then `#case/1`.
**Say, in this order:**
- "We ran a complete case on mainnet. All three roles, the two parties and the reviewer, were wallets we control, so this is a demonstration, not a customer."
- "First an agreement: the rule set, the reviewer and the time limits were fixed before any dispute, and neither side can change them."
- "Then each side answered the same seven questions. Six answers were identical, so they stand. One was different, so only that question went to the reviewer."
- "The reviewer answered just that one. The published rules turn the final answers into a result: Covered."
- Scroll to the black result card and the badge that says the rules were re-run: "The processor re-ran the rules just now and got the same result. Other contracts can read this verdict. Nothing is held in escrow."
- Scroll to Evidence: "Files are never uploaded. A fingerprint is recorded, and a reviewer can drop the file they were sent here to check it is identical."

## Optional, 40 seconds (replace the receipt if short on time): no wallet needed

**Show:** open `embed-demo.html` (the fictional Acme page). Scroll to "File a claim with your fingerprint or face", click **Create my passkey** and approve with the device prompt. Point at the Acme staff view that appears.
**Say:** "A customer with no wallet creates a passkey the same way they unlock their phone. Acme's page gets a public claim code, and staff invite them to an agreement. The customer approves with their fingerprint, and anyone with a wallet submits it. The signature covers the exact answers, so nobody can change them. This is live on X Layer, and it is new and unaudited."
**Do not say** that it recovers lost devices (not built yet) or that it works on every phone (only tested in Chrome).

## Optional, 40 seconds: no copying links, and a reviewer who must explain

Only do this if you have rehearsed it on the live site with two devices; the real case on mainnet has no written reasons, so never claim it does.

**Show:** on the phone, the customer's **My cases** page: tap **Add evidence**, choose a photo, add a short note and sign. Point at "Sent to the other side's inbox". On the laptop, open `#inbox`: the item is waiting. Click **Submit with my wallet**.
**Say:** "The customer signs with a fingerprint and it lands in the business's inbox. Nobody copies a link, and the customer never needs a wallet."
**Then show** the reviewer's decision form: "Before a reviewer can decide, they write their reasons and sign a declaration of no conflict. While deciding they see Side A and Side B instead of names. Only a fingerprint of the statement goes on-chain. This makes a bad decision visible. It does not stop one."
**Do not say** that relays are guaranteed to deliver (they are public and may drop messages) or that this removes reviewer bias.

## 2:20 to 2:40: the receipt

**Show:** click Receipt, then Print or save as PDF.
**Say:** "Every decided case has a one-page receipt with who answered what, who settled each question, and a live re-run of the rules."

## 2:40 to 3:00: honest close

**Say:** "What this does not do: it cannot tell whether an answer is true, a reviewer can be wrong, the contracts are unaudited, and we have no customers yet. What it does do is make the process around published rules explicit and replayable. Others publish rules. LGtie handles what happens when two people disagree."

## Things not to say

- Do not say LGtie is the first or only rules-on-chain project. Other entries also compile rules to circuits.
- Do not say it proves answers are true, or that results are legal advice.
- Do not call the real case a customer or a pilot.
- Do not quote prices or revenue. None are validated.

## If something goes wrong while recording

- The home card or case page says it cannot reach X Layer: wait a few seconds and reload. The RPC is public and occasionally slow.
- A wallet prompt appears in an unexpected place: reject it. Every step shown above works without signing anything.
