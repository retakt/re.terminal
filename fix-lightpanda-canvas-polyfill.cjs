const fs = require("fs");

const file = "server/lib/lightpanda-client.js";
let src = fs.readFileSync(file, "utf8");

const helper = [
  "",
  "function pageCompatibilityScript() {",
  "  return [",
  "    '(function(){',",
  "    '  function patchContext(ctx){',",
  "    '    if (!ctx || typeof ctx !== \"object\") ctx = {};',",
  "    '    if (typeof ctx.measureText !== \"function\") {',",
  "    '      ctx.measureText = function(text){',",
  "    '        var value = String(text == null ? \"\" : text);',",
  "    '        var width = Math.max(0, value.length * 7);',",
  "    '        return { width: width, actualBoundingBoxLeft: 0, actualBoundingBoxRight: width, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 3, fontBoundingBoxAscent: 10, fontBoundingBoxDescent: 3 };',",
  "    '      };',",
  "    '    }',",
  "    '    var noopNames = [\"save\",\"restore\",\"scale\",\"rotate\",\"translate\",\"transform\",\"setTransform\",\"resetTransform\",\"clearRect\",\"fillRect\",\"strokeRect\",\"beginPath\",\"closePath\",\"moveTo\",\"lineTo\",\"bezierCurveTo\",\"quadraticCurveTo\",\"arc\",\"arcTo\",\"ellipse\",\"rect\",\"fill\",\"stroke\",\"clip\",\"fillText\",\"strokeText\",\"drawImage\",\"putImageData\",\"createImageData\",\"getImageData\"];',",
  "    '    for (var i=0;i<noopNames.length;i++){ if (typeof ctx[noopNames[i]] !== \"function\") ctx[noopNames[i]] = function(){}; }',",
  "    '    if (typeof ctx.createLinearGradient !== \"function\") ctx.createLinearGradient = function(){ return { addColorStop:function(){} }; };',",
  "    '    if (typeof ctx.createRadialGradient !== \"function\") ctx.createRadialGradient = function(){ return { addColorStop:function(){} }; };',",
  "    '    if (typeof ctx.createPattern !== \"function\") ctx.createPattern = function(){ return {}; };',",
  "    '    return ctx;',",
  "    '  }',",
  "    '  if (typeof HTMLCanvasElement !== \"undefined\") {',",
  "    '    var proto = HTMLCanvasElement.prototype;',",
  "    '    var originalGetContext = proto.getContext;',",
  "    '    proto.getContext = function(type){',",
  "    '      var ctx = null;',",
  "    '      if (typeof originalGetContext === \"function\") {',",
  "    '        try { ctx = originalGetContext.apply(this, arguments); } catch(e) { ctx = null; }',",
  "    '      }',",
  "    '      if (!ctx && String(type || \"\").toLowerCase().indexOf(\"2d\") !== -1) ctx = {};',",
  "    '      return patchContext(ctx);',",
  "    '    };',",
  "    '  }',",
  "    '})();'",
  "  ].join('\\n');",
  "}",
  "",
  "async function installPageCompatibility(session, sid = '') {",
  "  const source = pageCompatibilityScript();",
  "  await session.call('Page.addScriptToEvaluateOnNewDocument', { source }, DEFAULT_TIMEOUT_MS, sid).catch(() => null);",
  "  await session.call('Runtime.evaluate', { expression: source, returnByValue: true, awaitPromise: true }, DEFAULT_TIMEOUT_MS, sid).catch(() => null);",
  "}",
  ""
].join("\n");

if (!src.includes("function pageCompatibilityScript()")) {
  const marker = "class CdpSession";
  if (!src.includes(marker)) throw new Error("Could not find class CdpSession marker");
  src = src.replace(marker, helper + marker);
  console.log("inserted canvas/page compatibility polyfill");
} else {
  console.log("polyfill helper already present");
}

let count = 0;
const runtimeEnableLine = '  await session.call("Runtime.enable", {}, DEFAULT_TIMEOUT_MS, sid);';
const installLine = '  await installPageCompatibility(session, sid);';

src = src.replaceAll(runtimeEnableLine, (match, offset) => {
  const nearby = src.slice(offset, offset + 220);
  if (nearby.includes("installPageCompatibility")) return match;
  count++;
  return match + "\n" + installLine;
});

fs.writeFileSync(file, src, "utf8");
console.log("inserted install calls:", count);
