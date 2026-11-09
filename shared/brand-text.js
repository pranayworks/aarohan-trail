// Brand spelling on screen: the name is "Aarohan" (some saved data and older strings still say "AArohan").
// Display-only: nothing the server sends or stores is changed.
(function () {
  'use strict';
  var RE = /AArohan/g;
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, NOSCRIPT: 1 };
  function fixText(n) {
    var p = n.parentNode;
    if (!p || SKIP[p.nodeName]) return;
    if (n.nodeValue && n.nodeValue.indexOf('AArohan') !== -1) n.nodeValue = n.nodeValue.replace(RE, 'Aarohan');
  }
  function fixTree(root) {
    if (!root) return;
    if (root.nodeType === 3) { fixText(root); return; }
    if (root.nodeType !== 1) return;
    var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), n;
    while ((n = w.nextNode())) fixText(n);
  }
  function start() {
    fixTree(document.body);
    if (document.title) document.title = document.title.replace(RE, 'Aarohan');
    new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.type === 'characterData') fixText(m.target);
        else m.addedNodes.forEach(fixTree);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
