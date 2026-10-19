import assert from "node:assert/strict";
import test from "node:test";

import { canConfirmCanonicalProfile } from "../profile-authorization";

test("workspace owner may confirm the canonical startup profile", () => {
  assert.equal(canConfirmCanonicalProfile("owner"), true);
});

test("non-owner workspace members cannot confirm the canonical startup profile", () => {
  assert.equal(canConfirmCanonicalProfile("member"), false);
  assert.equal(canConfirmCanonicalProfile(null), false);
});
