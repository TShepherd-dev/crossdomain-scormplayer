window.addEventListener('message', function (event) {
    if (!event.data || event.data.msgtype !== 'USER_INIT_DATA') return;

    window.parentOrigin = event.origin;
    var msg = event.data;

    var cmiDataFromApUiWindow = msg.msgdata;
    var userId = msg.msgdata.userId;
    var contentLaunchUrl = msg.msgdata.contentLaunchUrl;
    var launchDetails = cmiDataFromApUiWindow.LaunchDetails || cmiDataFromApUiWindow.launchDetails;

    window.__scormplayerSettings = msg.msgdata.envSettings || {};

    window.scormEngineMain = new scormEngineClass(cmiDataFromApUiWindow, userId);

    document.getElementById('sp_sco').src = contentLaunchUrl;
});
