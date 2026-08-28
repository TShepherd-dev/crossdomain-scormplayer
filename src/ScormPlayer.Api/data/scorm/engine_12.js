// -----------------------------------------------------------------------------
// SCORM 1.2 API implementation (engine_12.js)
//
// Defines the SCORM 1.2 API surface (window.API) that SCO content written for
// SCORM 1.2 calls: LMSInitialize / LMSGetValue / LMSSetValue / LMSCommit /
// LMSFinish plus the error helpers.
//
// Mirrors the object the content invokes AS IF it were talking to a real LMS.
// Every call is funnelled through the shared scormEngineClass instance (passed
// in as `caller`) which owns the data model + server comms, so this wrapper
// only does SCORM-spec string handling and state checks.
//
// In the real product this is engine_12.js from AP-CoreDlls; here it is a
// trimmed re-implementation for the demo.
// -----------------------------------------------------------------------------
function LMS_PlayerScorm1_2_API(caller) {
    var self = this;
    self.SCORMDataModel = caller.oPlayerSCORM;      // the launch envelope
    self.SCORMMessageWindow = caller;               // the engine (owns comms)
    self.state = window.SCORM_STATE.NOT_INITIALIZED;
    self.errorCode = "0";

    // All the data methods below are only valid after Initialize() has been
    // called - per the API spec we track that via the shared state machine.
    self._checkState = function () {
        return self.state === window.SCORM_STATE.RUNNING;
    };

    self._setError = function (code) {
        self.errorCode = code;
    };

    // Starts the API session. SCORM 1.2 returns the literal strings "true"/
    // "false" (not booleans) per the spec, and content checks against "true".
    self.LMSInitialize = function (param) {
        self.state = window.SCORM_STATE.RUNNING;
        self.errorCode = "0";
        return "true";
    };

    // Ends the session: hand everything to the engine's full teardown flow
    // (compute score -> report completion if changed -> terminate server
    // session). From here on GetValue/SetValue fail their state check.
    self.LMSFinish = function (param) {
        self.state = window.SCORM_STATE.TERMINATED;
        self.SCORMMessageWindow.sessionTerminate();
        return "true";
    };

    // Read a data model element. Order: in-memory first, then spec-prescribed
    // defaults for the standard cmi.core.* elements, otherwise an error.
    self.LMSGetValue = function (parameter) {
        if (!self._checkState()) {
            self._setError("301");
            return "";
        }

        var item = self.SCORMMessageWindow.CurrentDataItems.find(function (i) {
            return i.Parameter === parameter;
        });

        if (item) return item.ParameterValue;

        // Not in memory: return the default "start-of-session" values the spec
        // prescribes for the core elements, or compute interaction/objective
        // collection counts from the current data model.
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

    // Write a data model element. SCORM 1.2 only buffers in-memory here -
    // nothing is sent to the server until Commit(). (The 2004 engine differs:
    // it POSTs each SetValue immediately.)
    self.LMSSetValue = function (parameter, value) {
        if (!self._checkState()) {
            self._setError("301");
            return "false";
        }

        self.SCORMMessageWindow.setDATA(parameter, value);
        return "true";
    };

    // Persist buffered writes. Ordering mirrors the product: recompute scores
    // first, flush dirty items, then (if the outcome changed) mark the module
    // complete.
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

    // SCORM 1.2 error-code strings mandated by the spec. Content typically asks
    // for the string for the code returned by LMSGetLastError.
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
