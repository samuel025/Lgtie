// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {RuleSetRegistry} from "../src/RuleSetRegistry.sol";
import {PasskeyRegistry} from "../src/PasskeyRegistry.sol";
import {AgreementRegistryV2} from "../src/AgreementRegistryV2.sol";
import {TiebreakCaseV5} from "../src/TiebreakCaseV5.sol";
import {LGtieBilling, IERC20Min} from "../src/LGtieBilling.sol";
import {Party} from "../src/Party.sol";
import {MockProcessor} from "./Mock.sol";
import {MockUSD} from "./MockUSD.sol";

/// Billing: the per-case fee, subscriptions, the hard caps, who pays, and that nothing is ever held. Needs no network.
contract BillingTest is Test {
    RuleSetRegistry reg; PasskeyRegistry pk; AgreementRegistryV2 ag; TiebreakCaseV5 tc; MockProcessor proc; MockUSD usd; LGtieBilling bill;
    address treasury = makeAddr("treasury"); address business = makeAddr("business"); address customer = makeAddr("customer");
    address reviewer = makeAddr("reviewer"); address stranger = makeAddr("stranger");
    uint256 constant FEE = 3e6; uint256 constant BIZ_M = 29e6; uint256 constant BIZ_Y = 290e6; uint256 constant PRO_M = 99e6; uint256 constant PRO_Y = 990e6;
    uint256 aid;

    function setUp() public {
        proc = new MockProcessor(); usd = new MockUSD(); reg = new RuleSetRegistry(); pk = new PasskeyRegistry(); ag = new AgreementRegistryV2(reg, pk);
        bill = new LGtieBilling(IERC20Min(address(usd)), treasury, FEE, LGtieBilling.Plan(uint128(BIZ_M), uint128(BIZ_Y), 50), LGtieBilling.Plan(uint128(PRO_M), uint128(PRO_Y), 300));
        tc = new TiebreakCaseV5(reg, ag, pk, address(proc), bill); bill.setCases(address(tc));
        vm.prank(business); reg.publish(address(proc), 1, 7, 2, keccak256("defs"), 0, "Warranty");
        vm.prank(business); aid = ag.propose(Party(customer, 0), 1, keccak256("terms"), reviewer, 3 days, 2 days);
        vm.prank(customer); ag.accept(aid);
        usd.mint(business, 10_000e6); usd.mint(customer, 100e6); usd.mint(stranger, 100e6);
        vm.prank(business); usd.approve(address(bill), type(uint256).max);
        vm.prank(customer); usd.approve(address(bill), type(uint256).max);
    }

    function _open(address who) internal returns (uint256) { vm.prank(who); return tc.openFromAgreement(aid, bytes32(0)); }
    function _held() internal view returns (uint256) { return usd.balanceOf(address(bill)) + usd.balanceOf(address(tc)) + address(bill).balance + address(tc).balance; }

    // ---------- the per-case fee ----------
    function test_without_a_subscription_the_opener_pays_the_case_fee_to_the_treasury() public {
        _open(business);
        assertEq(usd.balanceOf(treasury), FEE); assertEq(usd.balanceOf(business), 10_000e6 - FEE);
        assertEq(tc.count(), 1);
    }
    function test_a_customer_opening_pays_the_fee_when_the_business_has_no_subscription() public {
        _open(customer);
        assertEq(usd.balanceOf(treasury), FEE); assertEq(usd.balanceOf(customer), 100e6 - FEE);
    }
    function test_a_case_cannot_open_if_the_opener_cannot_pay() public {
        vm.prank(customer); usd.approve(address(bill), 0);
        vm.prank(customer); vm.expectRevert(bytes("payment failed (check your balance and approval)"));
        tc.openFromAgreement(aid, bytes32(0));
        assertEq(tc.count(), 0);
    }
    function test_a_business_that_never_pays_cannot_stop_a_customer_opening_a_case() public {
        vm.prank(business); usd.approve(address(bill), 0); usd.mint(business, 0);
        _open(customer);                       // the customer pays the fee themselves
        assertEq(tc.count(), 1); assertEq(usd.balanceOf(treasury), FEE);
    }
    function test_a_fee_of_zero_charges_nothing_and_needs_no_approval() public {
        bill.setCaseFee(0);
        address nobody = makeAddr("nobody"); vm.prank(business); ag.propose(Party(nobody, 0), 1, keccak256("t2"), reviewer, 3 days, 2 days);
        vm.prank(nobody); ag.accept(2);
        vm.prank(nobody); tc.openFromAgreement(2, bytes32(0));
        assertEq(usd.balanceOf(treasury), 0);
    }
    function test_the_plain_open_without_an_agreement_charges_the_filer() public {
        vm.prank(business); tc.open(1, customer, reviewer, bytes32(0), 3 days, 2 days);
        assertEq(usd.balanceOf(treasury), FEE);
    }

    // ---------- subscriptions ----------
    function test_subscribing_pays_the_treasury_directly_and_sets_the_expiry() public {
        vm.prank(business); bill.subscribe(1, false);
        (uint8 plan, uint64 expiry, bool active, uint32 used, uint32 left) = bill.statusOf(business);
        assertEq(plan, 1); assertTrue(active); assertEq(used, 0); assertEq(left, 50); assertEq(expiry, block.timestamp + 30 days);
        assertEq(usd.balanceOf(treasury), BIZ_M); assertEq(_held(), 0);
    }
    function test_a_subscribed_business_opens_cases_for_free_whoever_opens_them() public {
        vm.prank(business); bill.subscribe(1, false);
        uint256 t = usd.balanceOf(treasury);
        _open(business); _open(customer);       // the customer opening is covered by the business's subscription too
        assertEq(usd.balanceOf(treasury), t); assertEq(usd.balanceOf(customer), 100e6);
        (, , , uint32 used, uint32 left) = bill.statusOf(business); assertEq(used, 2); assertEq(left, 48);
    }
    function test_past_the_monthly_allowance_the_case_fee_applies_again() public {
        bill.setPlan(1, LGtieBilling.Plan(uint128(BIZ_M), uint128(BIZ_Y), 2));
        vm.prank(business); bill.subscribe(1, false);
        uint256 t = usd.balanceOf(treasury);
        _open(business); _open(business); assertEq(usd.balanceOf(treasury), t);
        _open(business); assertEq(usd.balanceOf(treasury), t + FEE);
        (, , bool active, , uint32 left) = bill.statusOf(business); assertTrue(active); assertEq(left, 0);
    }
    function test_the_allowance_resets_each_30_days() public {
        bill.setPlan(1, LGtieBilling.Plan(uint128(BIZ_M), uint128(BIZ_Y), 1));
        vm.prank(business); bill.subscribe(1, true);
        _open(business); uint256 t = usd.balanceOf(treasury);
        _open(business); assertEq(usd.balanceOf(treasury), t + FEE);    // second one in the same month is charged
        skip(31 days);
        t = usd.balanceOf(treasury); _open(business); assertEq(usd.balanceOf(treasury), t);   // a new month: covered again
    }
    function test_an_expired_subscription_covers_nothing() public {
        vm.prank(business); bill.subscribe(1, false);
        skip(31 days);
        (, , bool active, , uint32 left) = bill.statusOf(business); assertFalse(active); assertEq(left, 0);
        uint256 t = usd.balanceOf(treasury); _open(business); assertEq(usd.balanceOf(treasury), t + FEE);
    }
    function test_the_same_plan_adds_time_and_a_higher_plan_starts_now_and_a_lower_one_is_refused() public {
        vm.prank(business); bill.subscribe(1, false);
        vm.prank(business); bill.subscribe(1, true);
        (, uint64 e1, , , ) = bill.statusOf(business); assertEq(e1, block.timestamp + 30 days + 365 days);
        vm.prank(business); bill.subscribe(2, false);
        (uint8 plan, uint64 e2, , , uint32 left) = bill.statusOf(business); assertEq(plan, 2); assertEq(e2, block.timestamp + 30 days); assertEq(left, 300);
        vm.prank(business); vm.expectRevert(bytes("finish your current plan first")); bill.subscribe(1, false);
    }
    function test_a_yearly_plan_costs_the_yearly_price() public {
        vm.prank(business); bill.subscribe(2, true);
        assertEq(usd.balanceOf(treasury), PRO_Y);
    }
    function test_an_unknown_plan_or_a_plan_not_for_sale_is_refused() public {
        vm.prank(business); vm.expectRevert(bytes("unknown plan")); bill.subscribe(3, false);
        bill.setPlan(2, LGtieBilling.Plan(0, 0, 0));
        vm.prank(business); vm.expectRevert(bytes("plan not for sale")); bill.subscribe(2, false);
    }
    function test_subscribing_without_enough_balance_or_approval_fails_and_changes_nothing() public {
        vm.prank(stranger); vm.expectRevert(bytes("payment failed (check your balance and approval)")); bill.subscribe(1, false);
        (uint8 plan, , bool active, , ) = bill.statusOf(stranger); assertEq(plan, 0); assertFalse(active);
    }
    function test_tokens_that_return_nothing_work_too() public {
        usd.setReturnsNothing(true);
        vm.prank(business); bill.subscribe(1, false); assertEq(usd.balanceOf(treasury), BIZ_M);
    }
    function test_another_business_is_not_covered_by_someone_elses_subscription() public {
        vm.prank(stranger); usd.approve(address(bill), type(uint256).max);
        vm.prank(customer); bill.subscribe(1, false);              // the customer subscribes: that covers cases where THEY are the business
        uint256 t = usd.balanceOf(treasury); _open(business);       // this agreement's business is `business`, who did not subscribe
        assertEq(usd.balanceOf(treasury), t + FEE);
    }

    // ---------- nothing is held, and nobody else can charge ----------
    function test_the_contracts_never_hold_funds() public {
        vm.prank(business); bill.subscribe(2, true); _open(business); _open(customer);
        assertEq(_held(), 0);
    }
    function test_only_the_case_contract_can_charge() public {
        vm.prank(stranger); vm.expectRevert(bytes("only the case contract")); bill.charge(business, customer);
        vm.expectRevert(bytes("only the case contract")); bill.charge(business, customer);
    }
    function test_the_case_contract_can_be_set_only_once() public {
        vm.expectRevert(bytes("already set")); bill.setCases(stranger);
    }
    function test_charge_before_the_case_contract_is_set_is_refused() public {
        LGtieBilling b2 = new LGtieBilling(IERC20Min(address(usd)), treasury, FEE, LGtieBilling.Plan(1, 1, 1), LGtieBilling.Plan(1, 1, 1));
        vm.expectRevert(bytes("only the case contract")); b2.charge(business, customer);
    }

    // ---------- the owner's controls, and their hard caps ----------
    function test_the_owner_can_change_prices_within_the_caps() public {
        bill.setCaseFee(5e6); assertEq(bill.caseFee(), 5e6);
        bill.setPlan(1, LGtieBilling.Plan(19e6, 190e6, 40)); (uint128 m, uint128 y, uint32 c) = bill.plans(1); assertEq(m, 19e6); assertEq(y, 190e6); assertEq(c, 40);
        address t2 = makeAddr("t2"); bill.setTreasury(t2); assertEq(bill.treasury(), t2);
        _open(business); assertEq(usd.balanceOf(t2), 5e6);
    }
    function test_prices_cannot_go_above_the_hard_caps() public {
        vm.expectRevert(bytes("above the fee cap")); bill.setCaseFee(10e6 + 1);
        vm.expectRevert(bytes("above a cap")); bill.setPlan(1, LGtieBilling.Plan(500e6 + 1, 1, 1));
        vm.expectRevert(bytes("above a cap")); bill.setPlan(1, LGtieBilling.Plan(1, 5000e6 + 1, 1));
        vm.expectRevert(bytes("above a cap")); bill.setPlan(1, LGtieBilling.Plan(1, 1, 10001));
        bill.setCaseFee(10e6); bill.setPlan(2, LGtieBilling.Plan(500e6, 5000e6, 10000));    // exactly the caps are allowed
    }
    function test_constructor_refuses_prices_above_the_caps_and_a_zero_treasury() public {
        vm.expectRevert(bytes("above the fee cap")); new LGtieBilling(IERC20Min(address(usd)), treasury, 11e6, LGtieBilling.Plan(1, 1, 1), LGtieBilling.Plan(1, 1, 1));
        vm.expectRevert(bytes("zero treasury")); new LGtieBilling(IERC20Min(address(usd)), address(0), 1, LGtieBilling.Plan(1, 1, 1), LGtieBilling.Plan(1, 1, 1));
    }
    function test_only_the_owner_can_change_anything() public {
        vm.startPrank(stranger);
        vm.expectRevert(bytes("only the owner")); bill.setCaseFee(0);
        vm.expectRevert(bytes("only the owner")); bill.setPlan(1, LGtieBilling.Plan(1, 1, 1));
        vm.expectRevert(bytes("only the owner")); bill.setTreasury(stranger);
        vm.expectRevert(bytes("only the owner")); bill.transferOwnership(stranger);
        vm.stopPrank();
    }
    function test_ownership_moves_in_two_steps() public {
        address nu = makeAddr("newOwner");
        bill.transferOwnership(nu); assertEq(bill.owner(), address(this));
        vm.prank(stranger); vm.expectRevert(bytes("not the pending owner")); bill.acceptOwnership();
        vm.prank(nu); bill.acceptOwnership(); assertEq(bill.owner(), nu);
        vm.expectRevert(bytes("only the owner")); bill.setCaseFee(0);    // the old owner is out
    }

    // ---------- the same agreement, V5 still behaves like V4 (the full V4 suite is re-run in PasskeyV5.t.sol) ----------
    function test_a_case_opened_with_a_fee_still_works_end_to_end() public {
        uint256 id = _open(business);
        vm.prank(business); tc.submit(id, true, 0x7f);
        vm.prank(customer); tc.submit(id, false, 0x7f);
        assertEq(uint8(tc.get(id).status), uint8(TiebreakCaseV5.Status.Final));
    }
}
