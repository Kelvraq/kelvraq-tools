import test from "node:test";
import assert from "node:assert/strict";
import { cardKind, cardFormat } from "../web/cards.js";

test("card types use consistent precedence", () => {
  assert.equal(cardKind({ directory: true, ext: ".exe" }), "folder");
  assert.equal(cardKind({ application: true }), "application");
  assert.equal(cardKind({ ext: ".LNK" }), "application");
  assert.equal(cardKind({ ext: ".url" }), "application");
  assert.equal(cardKind({ ext: ".MP4" }), "video");
  assert.equal(cardKind({ ext: ".webm" }), "video");
  assert.equal(cardKind({ ext: ".PNG" }), "image");
  assert.equal(cardKind({ ext: ".blend" }), "model");
  assert.equal(cardKind({ ext: ".pdf" }), "document");
  assert.equal(cardKind({}), "document");
});

test("format labels are bounded and have a fallback", () => {
  assert.equal(cardFormat({ ext: ".pdf" }), "PDF");
  assert.equal(cardFormat({}), "FILE");
  assert.equal(cardFormat({ ext: ".verylongextension" }).length, 10);
});
