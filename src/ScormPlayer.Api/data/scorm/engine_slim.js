// -----------------------------------------------------------------------------
// SCORM engine orchestrator - loaded by sp_sco_loader.html via <script>.
//
// This file is the "brain" of the cross-domain player. It runs inside the
// loader iframe, a browser context that is cross-origin with BOTH the Vue app
// above it (localhost:8080) and the SCO content below it (localhost:5001):
//   * all communication with the Vue app is via window.postMessage (the
//     token request/response handshake),
//   * all persistence to the LMS goes over plain fetch() to the API with an
//     Authorization: Bearer header (the token obtained by that handshake).
//
// Responsibilities:
//   - expose whichever SCORM API object the content expects, based on version:
//       window.API         -> SCORM 1.2 (engine_12.js)
//       window.API_1484_11 -> SCORM 2004 (engine_2004.js)
//   - keep the cmi.* data model in memory (CurrentDataItems)
//   - compute pass/fail and score, and drive commit / markComplete / terminate
//
// -----------------------------------------------------------------------------

// The two SCORM global slots. Only one is populated, depending on version.
window.API = null;
window.API_1484_11 = null;

// API-session state machine shared by the 1.2 and 2004 wrappers.
//   NOT_INITIALIZED -> RUNNING (after Initialize) -> TERMINATED (after Finish)
window.SCORM_STATE = {
    NOT_INITIALIZED: "notInitialized",
    RUNNING: "running",
    TERMINATED: "terminated"
};

// Per data-item persistence state: where a cmi.* element sits between being
// written by the SCO and persisted to the server.
var ACTIVITY_STATE = {
    PENDING: "pending",
    READYTOSEND: "readyToSend",
    SENDING: "sending",
    SENT: "sent",
    FAILED: "failed"
};

// One engine instance is created per SCO launch by sp_sco_startup.js. It is
// handed the launch envelope (cmiData) posted down from the Vue viewer plus
// the current user id, and is retained on window.scormEngineMain so the page
// can call unloadHandler() during window teardown.
function scormEngineClass(cmiData, userId) {
    var self = this;
    self.oPlayerSCORM = cmiData;          // the USER_INIT_DATA payload
    self.userId = userId;                 // also used as the "session id"
    self.CurrentDataItems = [];           // in-memory cmi.* data model
    self.ApiState = "notInitialized";     // engine-level state
    self.windowStatus = "running";        // flips to "closed" on unload

    var launchDetails = cmiData.LaunchDetails || cmiData.launchDetails || {};
    if (launchDetails.CurrentDataItems) {
        // Resume support: carry over any items persisted by an earlier visit.
        self.CurrentDataItems = launchDetails.CurrentDataItems;
    }

    self.ScormVersion = launchDetails.ScormVersion || "12";
    self.ApiSettings = launchDetails.ApiSettings || {};
    self.ScormResult = launchDetails.ScormResult || {};

    // Last outcomes actually reported to the server. markComplete is skipped
    // when a commit produces identical values (dedupe the real LMS would do).
    self.LastSent = {
        SuccessStatus: "",
        CompletionStatus: "",
        Score_Scaled: ""
    };

    // Set up the SCORM API surface on window based on the package version.
    // The SCO's own JS looks for window.API (1.2) / window.API_1484_11 (2004)
    // and, because the engine lives in the loader frame that CONTAINS the SCO
    // iframe, the content finds these globals by climbing its parent chain.
    self.initDataModel = function () {
        switch (self.ScormVersion) {
            case "12":
                window.API = new LMS_PlayerScorm1_2_API(self);
                break;
            case "2004":
                window.API_1484_11 = new LMS_PlayerScorm2004_API(self);
                break;
        }
        self.ApiState = "ready";
    };

    // Every server call needs a fresh bearer token. The token is not stored
    // here (it lives in the Vue app's session store) so it has to be
    // requested on demand over postMessage each time.
    self.getToken = async function () {
        var data = await requestTokenFromParent(window.parentOrigin);
        return data.token;
    };

    // Server-side read: used when GetValue is asked for a cmi.* element we do not
    // hold in memory (e.g. a value persisted by a previous session). Falls back
    // to "" on any failure so content never hard-errors on a read.
    self.GetSCORMValue = async function (sParameter) {
        var token = await self.getToken();
        var settings = window.__scormplayerSettings;   // injected from USER_INIT_DATA
        var baseUrl = settings.VUE_APP_API_URL || settings.apiUrl || "";
        var url = baseUrl + "/api/scormModule/getValue/" + self.userId + "/" + encodeURIComponent(sParameter);
        try {
            var resp = await scormGet(url, token);
            return resp.value || "";
        } catch (e) {
            return "";
        }
    };

    // Persist a single data item right away (SCORM 2004 SetValue sends
    // immediately; the 1.2 path defers everything to Commit).
    self.SendSCORMSetValues = async function (dataItem) {
        var token = await self.getToken();
        var settings = window.__scormplayerSettings;
        var baseUrl = settings.VUE_APP_API_URL || settings.apiUrl || "";
        var url = baseUrl + "/api/scormModule/setValue";
        var body = {
            sessionId: self.userId,
            parameter: dataItem.Parameter,
            parameterValue: dataItem.ParameterValue
        };
        await scormPost(url, body, token);
    };

    // Bulk flush of everything currently dirty (the LMSCommit path). The API
    // is stateless on item detail for the demo - the dirty flag being cleared
    // server-side is enough to consider values persisted.
    self.SendSCORMCommit = async function () {
        var token = await self.getToken();
        var settings = window.__scormplayerSettings;
        var baseUrl = settings.VUE_APP_API_URL || settings.apiUrl || "";
        var url = baseUrl + "/api/scormModule/commitSession";
        var dirtyItems = self.CurrentDataItems.filter(function (i) { return i.IsDirty; });
        if (dirtyItems.length === 0) return;
        await scormPost(url, { sessionId: self.userId }, token);
    };

    // Turn the current cmi data model into the three "Player.*" virtual values
    // that drive completion: success status, completion status and scaled
    // score. Called on every Commit and Terminate.
    //
    // SCORM 1.2 derives everything from cmi.core.lesson_status;
    // SCORM 2004 reads cmi.success_status + cmi.completion_status + score.
    self.computeScore = function () {
        var scoreScaled = 0;
        var successStatus = "unknown";
        var completionStatus = "incomplete";

        if (self.ScormVersion === "12") {
            var lessonStatus = self.getDATA("cmi.core.lesson_status");
            var scoreRaw = parseFloat(self.getDATA("cmi.core.score.raw")) || 0;
            var scoreMax = parseFloat(self.getDATA("cmi.core.score.max")) || 100;
            var masteryScore = parseFloat(self.getDATA("cmi.student_data.mastery_score")) || 80;

            if (lessonStatus === "passed" || lessonStatus === "failed") {
                successStatus = lessonStatus;
                completionStatus = "completed";
            } else if (lessonStatus === "completed") {
                successStatus = "passed";
                completionStatus = "completed";
            }

            if (scoreMax > 0) {
                scoreScaled = Math.min(scoreRaw / scoreMax, 1.0);
            }
            if (successStatus === "passed" && scoreScaled === 0) {
                scoreScaled = 1.0;
            }
        } else {
            var cs = self.getDATA("cmi.completion_status");
            var ss = self.getDATA("cmi.success_status");
            var scaled = parseFloat(self.getDATA("cmi.score.scaled"));
            var raw = parseFloat(self.getDATA("cmi.score.raw"));
            var max = parseFloat(self.getDATA("cmi.score.max"));

            completionStatus = cs || "incomplete";
            successStatus = ss || "unknown";

            if (!isNaN(scaled)) {
                scoreScaled = scaled;
            } else if (!isNaN(raw) && !isNaN(max) && max > 0) {
                scoreScaled = Math.min(raw / max, 1.0);
            }
            if (successStatus === "passed" && scoreScaled === 0) {
                scoreScaled = 1.0;
            }
        }

        self.setDATA("Player.success_status", successStatus);
        self.setDATA("Player.completion_status", completionStatus);
        self.setDATA("Player.score_scaled", scoreScaled.toString());

        return { successStatus, completionStatus, scoreScaled };
    };

    // The two helpers the API wrappers funnel every GetValue/SetValue through.
    // SetValue marks the element dirty + readyToSend so a later Commit picks
    // it up. Unknown reads return "" (callers treat empty as "no value").
    self.getDATA = function (parameter) {
        var item = self.CurrentDataItems.find(function (i) { return i.Parameter === parameter; });
        return item ? item.ParameterValue : "";
    };

    self.setDATA = function (parameter, value) {
        var item = self.CurrentDataItems.find(function (i) { return i.Parameter === parameter; });
        if (item) {
            item.ParameterValue = value;
            item.IsDirty = true;
            item.State = ACTIVITY_STATE.READYTOSEND;
        } else {
            self.CurrentDataItems.push({
                Parameter: parameter,
                ParameterValue: value,
                IsDirty: true,
                State: ACTIVITY_STATE.READYTOSEND
            });
        }
    };

    // Tell the LMS the module has a definitive outcome. Guarded by LastSent: if
    // the current computed outcome is unchanged from the last transmission we
    // skip the call entirely (many SCOs Commit repeatedly with no change, and
    // the real LMS would otherwise create duplicate result records).
    self.SendMarkCompleteRequest = async function () {
        var result = self.computeScore();
        var lastSent = self.LastSent;
        if (lastSent.SuccessStatus === result.successStatus &&
            lastSent.CompletionStatus === result.completionStatus &&
            lastSent.Score_Scaled === result.scoreScaled.toString()) {
            return;
        }
        self.LastSent = {
            SuccessStatus: result.successStatus,
            CompletionStatus: result.completionStatus,
            Score_Scaled: result.scoreScaled.toString()
        };

        var token = await self.getToken();
        var settings = window.__scormplayerSettings;
        var baseUrl = settings.VUE_APP_API_URL || settings.apiUrl || "";
        var url = baseUrl + "/api/module/markComplete";
        await scormPost(url, {
            moduleId: self.oPlayerSCORM.ModuleId || self.oPlayerSCORM.moduleId || "",
            successStatus: result.successStatus,
            completionStatus: result.completionStatus,
            scoreScaled: result.scoreScaled
        }, token);
    };

    // Full session teardown (invoked by LMSFinish): recompute outcome, report
    // completion if it changed, then tell the API the session is over.
    self.sessionTerminate = async function () {
        self.computeScore();
        await self.SendMarkCompleteRequest();
        var token = await self.getToken();
        var settings = window.__scormplayerSettings;
        var baseUrl = settings.VUE_APP_API_URL || settings.apiUrl || "";
        var url = baseUrl + "/api/scormModule/terminateUserSession";
        await scormPost(url, { sessionId: self.userId }, token);
    };

    // Safety net: if the user closes the tab rather than letting the content
    // call LMSFinish, flush anything dirty. keepalive:true on fetch lets this
    // complete even as the page is being torn down.
    self.unloadHandler = function () {
        self.windowStatus = "closed";
        self.SendSCORMCommit();
    };

    self.initDataModel();
}

// Cross-origin token handshake:
//   1. post TOKEN_REQUEST up to the parent window (the Vue viewer).
//   2. The viewer answers with TOKEN_RESPONSE { token }.
//   3. We use that token only for the Authorization header of the next API call.
// expectedOrigin is the origin captured from the USER_INIT_DATA message, so we
// only ever talk to the app we were launched by (origin checks on both sides).
//
// Demo shortcut: after 5s without an answer we resolve a fixed demo token so
// the demo still works even if the parent handshake was missed.
async function requestTokenFromParent(expectedOrigin) {
    return new Promise(function (resolve, reject) {
        function handleMessage(event) {
            if (event.origin !== expectedOrigin) return;
            if (event.data && event.data.msgtype === 'TOKEN_RESPONSE') {
                window.removeEventListener('message', handleMessage);
                resolve(event.data.msgdata);
            }
        }
        window.addEventListener('message', handleMessage);
        window.parent.postMessage({ msgtype: 'TOKEN_REQUEST', msgdata: {} }, expectedOrigin);
        setTimeout(function () {
            window.removeEventListener('message', handleMessage);
            resolve({ token: "demo-token" });
        }, 5000);
    });
}

// Thin fetch wrappers for the LMS API. keepalive:true is important - it lets
// commits/terminates finish even if the browser window is closing when the
// request fires (the unload safety-commit path).
async function scormPost(url, data, token) {
    try {
        var resp = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify(data),
            keepalive: true
        });
        return await resp.json();
    } catch (e) {
        return { error: e.message };
    }
}

// GET variant (used by the server-side GetValue fallback read).
async function scormGet(url, token) {
    try {
        var resp = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + token
            },
            keepalive: true
        });
        return await resp.json();
    } catch (e) {
        return { error: e.message };
    }
}
