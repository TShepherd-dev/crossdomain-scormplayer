function LMS_CirrusScorm1_2_API(caller) {
    var self = this;
    self.SCORMDataModel = caller.oCirrusSCORM;
    self.SCORMMessageWindow = caller;
    self.state = window.SCORM_STATE.NOT_INITIALIZED;
    self.errorCode = "0";

    self._checkState = function () {
        return self.state === window.SCORM_STATE.RUNNING;
    };

    self._setError = function (code) {
        self.errorCode = code;
    };

    self.LMSInitialize = function (param) {
        self.state = window.SCORM_STATE.RUNNING;
        self.errorCode = "0";
        return "true";
    };

    self.LMSFinish = function (param) {
        self.state = window.SCORM_STATE.TERMINATED;
        self.SCORMMessageWindow.sessionTerminate();
        return "true";
    };

    self.LMSGetValue = function (parameter) {
        if (!self._checkState()) {
            self._setError("301");
            return "";
        }

        var item = self.SCORMMessageWindow.CurrentDataItems.find(function (i) {
            return i.Parameter === parameter;
        });

        if (item) return item.ParameterValue;

        switch (parameter) {
            case "cmi.core.lesson_status": return "not attempted";
            case "cmi.core.lesson_mode": return "";
            case "cmi.core.lesson_location": return "";
            case "cmi.core.student_id": return "";
            case "cmi.core.student_name": return "";
            case "cmi.core.exit": return "";
            case "cmi.suspend_data": return "";
            case "cmi.core._children":
                return "entry,exit,lesson_location,lesson_mode,lesson_status,score,max,min,session_time,student_id,student_name,session_id";
            case "cmi.student_data._children":
                return "mastery_score,crs_completion_status,entry";
            case "cmi.interactions._children":
                return "";
            case "cmi.interactions._count":
                return self.SCORMMessageWindow.CurrentDataItems
                    .filter(function (i) { return i.Parameter.indexOf("cmi.interactions.") === 0; })
                    .length.toString();
            case "cmi.objectives._count":
                return self.SCORMMessageWindow.CurrentDataItems
                    .filter(function (i) { return i.Parameter.indexOf("cmi.objectives.") === 0; })
                    .length.toString();
            default:
                self._setError("201");
                return "";
        }
    };

    self.LMSSetValue = function (parameter, value) {
        if (!self._checkState()) {
            self._setError("301");
            return "false";
        }

        self.SCORMMessageWindow.setDATA(parameter, value);
        return "true";
    };

    self.LMSCommit = function (param) {
        if (!self._checkState()) {
            self._setError("301");
            return "false";
        }

        self.SCORMMessageWindow.computeScore();
        self.SCORMMessageWindow.SendSCORMCommit();
        self.SCORMMessageWindow.SendMarkCompleteRequest();
        return "true";
    };

    self.LMSGetLastError = function () {
        return self.errorCode;
    };

    self.LMSGetErrorString = function (code) {
        switch (code) {
            case "0": return "No error";
            case "101": return "General exception";
            case "201": return "Invalid element name";
            case "202": return "Invalid channel";
            case "301": return "Invalid session";
            default: return "Unknown error";
        }
    };

    self.LMSGetDiagnostic = function (code) {
        return "Diagnostic: " + code;
    };
}
