// jsdom does not implement Range geometry, which CodeMirror measures in rAF.
// The unit tests exercise text editing, not browser layout.
if (typeof Range !== "undefined") {
  Range.prototype.getClientRects ??= () =>
    document.createElement("span").getClientRects();
  Range.prototype.getBoundingClientRect ??= () =>
    document.createElement("span").getBoundingClientRect();
}
