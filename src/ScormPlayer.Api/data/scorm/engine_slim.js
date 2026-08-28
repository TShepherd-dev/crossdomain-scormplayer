window.API = null;
window.API_1484_11 = null;
window.SCORM_STATE = {
    NOT_INITIALIZED: "notInitialized",
    RUNNING: "running",
    TERMINATED: "terminated"
};

var ACTIVITY_STATE = {
    PENDING: "pending",
    READYTOSEND: "readyToSend",
    SENDING: "sending",
    SENT: "sent",
    FAILED: "failed"
};

function scormEngineClass(cmiData, userId) {
    var self = this;
    self.oCirrusSCORM = cmiData;
    self.userId = userId;
    self.CurrentDataItems = [];
    self.ApiState = "notInitialized";
    self.windowStatus = "running";

    var launchDetails = cmiData.LaunchDetails || cmiData.launchDetails || {};
    if (launchDetails.CurrentDataItems) {
        self.CurrentDataItems = launchDetails.CurrentDataItems;
    }

    self.ScormVersion = launchDetails.ScormVersion || "12";
    self.ApiSettings = launchDetails.ApiSettings || {};
    self.ScormResult = launchDetails.ScormResult || {};

    self.LastSent = {
        SuccessStatus: "",
        CompletionStatus: "",
        Score_Scaled: ""
    };

    self.initDataModel = function () {
        switch (self.ScormVersion) {
            case "12":
                window.API = new LMS_CirrusScorm1_2_API(self);
                break;
            case "2004":
                window.API_1484_11 = new LMS_CirrusScorm2004_API(self);
                break;
        }
        self.ApiState = "ready";
    };

    self.getToken = async function () {
        var data = await requestTokenFromParent(window.parentOrigin);
        return data.token;
    };

    self.GetSCORMValue = async function (sParameter) {
        var token = await self.getToken();
        var settings = window.__scormplayerSettings;
        var baseUrl = settings.VUE_APP_API_URL || settings.apiUrl || "";
        var url = baseUrl + "/api/scormModule/getValue/" + self.userId + "/" + encodeURIComponent(sParameter);
        try {
            var resp = await scormGet(url, token);
            return resp.value || "";
        } catch (e) {
            return "";
        }
    };

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

    self.SendSCORMCommit = async function () {
        var token = await self.getToken();
        var settings = window.__scormplayerSettings;
        var baseUrl = settings.VUE_APP_API_URL || settings.apiUrl || "";
        var url = baseUrl + "/api/scormModule/commitSession";
        var dirtyItems = self.CurrentDataItems.filter(function (i) { return i.IsDirty; });
        if (dirtyItems.length === 0) return;
        await scormPost(url, { sessionId: self.userId }, token);
    };

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

        self.setDATA("cirrus.success_status", successStatus);
        self.setDATA("cirrus.completion_status", completionStatus);
        self.setDATA("cirrus.score_scaled", scoreScaled.toString());

        return { successStatus, completionStatus, scoreScaled };
    };

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
            moduleId: self.oCirrusSCORM.ModuleId || self.oCirrusSCORM.moduleId || "",
            successStatus: result.successStatus,
            completionStatus: result.completionStatus,
            scoreScaled: result.scoreScaled
        }, token);
    };

    self.sessionTerminate = async function () {
        self.computeScore();
        await self.SendMarkCompleteRequest();
        var token = await self.getToken();
        var settings = window.__scormplayerSettings;
        var baseUrl = settings.VUE_APP_API_URL || settings.apiUrl || "";
        var url = baseUrl + "/api/scormModule/terminateUserSession";
        await scormPost(url, { sessionId: self.userId }, token);
    };

    self.unloadHandler = function () {
        self.windowStatus = "closed";
        self.SendSCORMCommit();
    };

    self.initDataModel();
}

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
