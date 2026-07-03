// Firefox background page compatibility shim.
// In a service worker, importScripts() loads scripts synchronously.
// In a Firefox background page (background.scripts), all scripts are already
// loaded in order via the manifest — so importScripts() calls in background.js
// become no-ops here.
if (typeof importScripts === 'undefined') {
  self.importScripts = function() {};
}

// Keep this background page alive in Firefox.
// Open ports from content scripts prevent Firefox from stopping the event page,
// ensuring chrome.runtime.sendMessage from content.js always finds a listener.
chrome.runtime.onConnect.addListener(function(port) {
  // Accepting the port is enough — Firefox keeps the background alive
  // for the lifetime of every open ff-keepalive port.
});
