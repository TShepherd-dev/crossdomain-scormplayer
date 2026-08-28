// -----------------------------------------------------------------------------
// SCORM startup (loaded as a module by sp_sco_loader.html)
//
// Binds the loader frame to the app window ABOVE it. The app (ScormViewer.vue)
// posts a single USER_INIT_DATA message once the loader iframe has finished
// loading; that message carries everything the engine needs to get going:
//   - the launch envelope (module data, previous cmi values, settings)
//   - the current user id (reused as our session id)
//   - the URL of the actual course content to put in the inner iframe
//   - the app environment settings, which also give us the API base URL
//
// Engine prerequisites (engine_slim.js defines scormEngineClass) are loaded
// by the loader HTML BEFORE this module script runs.
// -----------------------------------------------------------------------------
window.addEventListener('message', function (event) {
    if (!event.data || event.data.msgtype !== 'USER_INIT_DATA') return;

    // Only ever respond to the window that launched us.
    window.parentOrigin = event.origin;
    var msg = event.data;

    var cmiDataFromApUiWindow = msg.msgdata;
    var userId = msg.msgdata.userId;
    var contentLaunchUrl = msg.msgdata.contentLaunchUrl;
    // Accept either casing (the demo sends PascalCase LaunchDetails).
    var launchDetails = cmiDataFromApUiWindow.LaunchDetails || cmiDataFromApUiWindow.launchDetails;

    // Expose the app's env (API base URL, ...) to engine_slim.js.
    window.__scormplayerSettings = msg.msgdata.envSettings || {};

    // Build the engine + API objects (window.API / window.API_1484_11).
    window.scormEngineMain = new scormEngineClass(cmiDataFromApUiWindow, userId);

    // Kick off the actual course in the inner iframe.
    document.getElementById('sp_sco').src = contentLaunchUrl;
});
