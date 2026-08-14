// Firefox background keepalive.
// Firefox MV3 event pages stop after ~30s of inactivity, causing
// chrome.runtime.sendMessage from content.js to fail with
// "Could not establish connection. Receiving end does not exist."
//
// An open port from a content script keeps the background page alive.
// This script runs before content.js in the Firefox manifest so the
// port is established before the first analyzeImage message is sent.
(function () {
  function connect() {
    try {
      const port = chrome.runtime.connect({ name: 'ff-keepalive' });
      port.onDisconnect.addListener(function () {
        // Background restarted or crashed — reconnect after a brief delay
        setTimeout(connect, 1000);
      });
    } catch (e) {
      // Extension context may not be ready yet; retry
      setTimeout(connect, 500);
    }
  }
  connect();
})();
