import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeShareState,
  encodeShareState,
  shareHash,
} from "../src/share.mjs";
test("full share state survives an encode/decode round trip", () => {
  const state = {
    preset: "custom",
    weights: { aa: 40, vals: 35, livebench: 25 },
    minSources: 3,
    includeEstimated: true,
    excludeHistorical: true,
    excludeStale: true,
    costSource: "vals",
    focus: "openOnly",
    query: "claude",
    view: "livebench",
    rankingQuery: "opus",
    creator: "Anthropic",
    openness: "open",
    scoredOnly: true,
    nativeEstimated: true,
    nativeHistorical: true,
    budgetSource: "aa",
    budgetLimit: 1.5,
    selection: ["a", "b"],
  };
  const round = decodeShareState(shareHash("rankings", state));
  assert.equal(round.page, "rankings");
  assert.deepEqual(round.state, {
    ...state,
    weights: { aa: 40, vals: 35, livebench: 25 },
    budgetLimit: 1.5,
  });
});
test("defaults stay out of the link so addresses remain short", () => {
  assert.equal(encodeShareState({}), "");
  assert.equal(
    encodeShareState({
      preset: "capability",
      minSources: 2,
      costSource: "composite",
      budgetSource: "none",
    }),
    "",
  );
  assert.deepEqual(decodeShareState("#overview").state, {});
});
test("invalid values are dropped instead of breaking the page", () => {
  const { state } = decodeShareState(
    "#rankings?p=hack&ms=99&bl=-5&bs=aa&cs=nope&f=sideways&op=weird&w=9-9&sel=a,a,,b,c,d,e,f",
  );
  assert.equal(state.preset, undefined);
  assert.equal(state.minSources, 3);
  assert.equal(state.budgetSource, "none");
  assert.equal(state.budgetLimit, undefined);
  assert.equal(state.costSource, undefined);
  assert.equal(state.focus, undefined);
  assert.equal(state.openness, undefined);
  assert.equal(state.weights, undefined);
  assert.deepEqual(state.selection, ["a", "b", "c", "d"]);
});
test("custom weights require all three sources and at least one positive value", () => {
  assert.equal(decodeShareState("#rankings?w=40-35").state.weights, undefined);
  assert.equal(decodeShareState("#rankings?w=0-0-0").state.weights, undefined);
  const parsed = decodeShareState("#rankings?w=40-35-25");
  assert.deepEqual(parsed.state, {
    preset: "custom",
    weights: { aa: 40, vals: 35, livebench: 25 },
  });
});
test("budget without a usable limit falls back to no budget", () => {
  const parsed = decodeShareState("#rankings?bs=vals");
  assert.deepEqual(parsed.state, { budgetSource: "none" });
  assert.deepEqual(decodeShareState("#rankings?bs=vals&bl=2.5").state, {
    budgetSource: "vals",
    budgetLimit: 2.5,
  });
});
test("long text is truncated and page split tolerates missing query", () => {
  const parsed = decodeShareState("#explore?q=" + "x".repeat(300));
  assert.equal(parsed.state.query.length, 120);
  assert.equal(decodeShareState("#rankings").page, "rankings");
});
test("custom weights keep decimal precision through a round trip", () => {
  const state = {
    preset: "custom",
    weights: { aa: 40, vals: 33.33, livebench: 26.67 },
  };
  const round = decodeShareState(shareHash("explore", state)).state;
  assert.deepEqual(round.weights, { aa: 40, vals: 33.33, livebench: 26.67 });
});
test("budget source without a finite positive limit stays out of the link", () => {
  assert.equal(encodeShareState({ budgetSource: "aa", budgetLimit: null }), "");
  assert.equal(encodeShareState({ budgetSource: "aa", budgetLimit: 0 }), "");
  assert.equal(
    encodeShareState({ budgetSource: "aa", budgetLimit: 2 }),
    "bs=aa&bl=2",
  );
});
test("only the first question mark splits the page, and spaces survive a round trip", () => {
  const parsed = decodeShareState("#rankings?q=a?b&ms=3");
  assert.equal(parsed.page, "rankings");
  assert.equal(parsed.state.query, "a?b");
  assert.equal(parsed.state.minSources, 3);
  assert.equal(
    decodeShareState(shareHash("explore", { query: "a b?c" })).state.query,
    "a b?c",
  );
});
test("explore display state (creator, onlyFront) round trips and defaults stay out", () => {
  assert.equal(encodeShareState({ creator: "", onlyFront: false }), "");
  const round = decodeShareState(
    shareHash("explore", { creator: "Z AI", onlyFront: true }),
  );
  assert.equal(round.page, "explore");
  assert.equal(round.state.creator, "Z AI");
  assert.equal(round.state.onlyFront, true);
});
