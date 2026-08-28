using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.FileProviders;
using System.Text.Json;

namespace ScormPlayer.Api.Controllers;

// -----------------------------------------------------------------------------
// Simulated LMS backend for the SCORM runtime loop.
//
// This controller is the "other side"/LMS of the SCORM handshake. The in-browser
// engine (engine_slim.js, running inside sp_sco_loader.html) calls these
// endpoints to initialise a session, write/read cmi.* values, commit, mark
// the module complete and terminate.
//
// In the real system, these controllers would be writing data to a database and/or running
// actual business logic to deal with the parts of the SCORM Protocol that are the responsibility of the LMS
// of the LMS; here sessions live in static in-memory dictionaries and there is no
// authentication (the engine's bearer token is a fixed demo value).
// -----------------------------------------------------------------------------
[ApiController]
public class ScormController : ControllerBase
{
    private readonly IWebHostEnvironment _env;

    public ScormController(IWebHostEnvironment env)
    {
        _env = env;
    }

    // Session state, keyed by module/session id and held statically so it
    // survives whatever controller instance the request lands on:
    //   Sessions    -> metadata (when a session started/ended)
    //   SessionData -> the cmi.* data items the SCO has written so far
    private static readonly Dictionary<string, ScormSession> Sessions = new();
    private static readonly Dictionary<string, List<ScormDataItem>> SessionData = new();

    // Lazily create a session the first time a module id is touched, so
    // getLaunchDetails -> startScorm is stable and resumable mid-demo.
    private static string GetOrCreateSession(string moduleId)
    {
        if (!Sessions.TryGetValue(moduleId, out var session))
        {
            session = new ScormSession
            {
                ModuleId = moduleId,
                StartTime = DateTime.UtcNow
            };
            Sessions[moduleId] = session;
            SessionData[moduleId] = new List<ScormDataItem>();
        }
        return moduleId;
    }

    // Caller: the SCORM engine at boot time (via postMessage USER_INIT_DATA ->
    // engine constructing its runtime data model). Returns the launch
    // envelope: which SCORM version to implement, any previously persisted
    // data items (resume state), API state flags and pass/fail copy.
    [HttpGet("api/module/{moduleId}/startScorm")]
    public IActionResult StartScorm(string moduleId, [FromQuery] int preview = 0)
    {
        GetOrCreateSession(moduleId);
        var items = SessionData.GetValueOrDefault(moduleId) ?? new();

        return Ok(new
        {
            LaunchDetails = new
            {
                ScormVersion = "12",
                CurrentDataItems = items,
                ApiSettings = new { ApiState = "ready", Review = preview == 1, ApiMessage = "" },
                ScormPassedText = "Congratulations! You have passed this module.",
                ScormFailedText = "Unfortunately, you have not passed this module."
            }
        });
    }

    // Caller: the Vue ScormViewer component before it embeds the iframe.
    // Supplies display metadata plus ScormUrl - the YARP-proxied loader URL
    // the viewer puts in <iframe src>. The assetCode inside that URL (here
    // "demo-course") is what GetContentFile resolves against
    // /data/assets/scorm/{assetCode}/.
    [HttpGet("api/module/{moduleId}/getLaunchDetails")]
    public IActionResult GetLaunchDetails(string moduleId, [FromQuery] int preview = 0)
    {
        GetOrCreateSession(moduleId);
        return Ok(new
        {
            ModuleId = moduleId,
            ModuleName = "Demo SCORM Course",
            ScormUrl = $"/assets/scorm/disk/demo-course/sp_sco_loader.html",
            ScormVersion = "12",
            IsCompleted = false
        });
    }

    // Called once per launch by the viewer. A real LMS increments an attempt
    // counter / creates an attempt row in the DB here; the demo just acks.
    [HttpPost("api/module/{moduleId}/recordAttempt")]
    public IActionResult RecordAttempt(string moduleId)
    {
        return Ok(new { Success = true });
    }

    // Caller: the SCORM engine when it wants a single cmi.* element persisted
    // immediately (or to recover from a failed batch commit). Upserts the
    // element into SessionData so later GetValue / startScorm calls return it.
    [HttpPost("api/scormModule/setValue")]
    public IActionResult SetValue([FromBody] ScormSetRequest request)
    {
        if (string.IsNullOrEmpty(request?.SessionId))
            request ??= new();
        if (string.IsNullOrEmpty(request.SessionId))
            request.SessionId = "default";

        if (!SessionData.TryGetValue(request.SessionId, out var items))
        {
            items = new List<ScormDataItem>();
            SessionData[request.SessionId] = items;
        }

        var existing = items.FirstOrDefault(i => i.Parameter == request.Parameter);
        if (existing != null)
        {
            existing.ParameterValue = request.ParameterValue;
            existing.IsDirty = true;
        }
        else
        {
            items.Add(new ScormDataItem
            {
                Parameter = request.Parameter,
                ParameterValue = request.ParameterValue,
                IsDirty = true,
                State = "readyToSend"
            });
        }
        return Ok(new { success = true });
    }

    // Caller: the engine when a GetValue target is not already resident in its
    // in-memory CurrentDataItems. Reads the element back from session storage.
    [HttpGet("api/scormModule/getValue/{sessionId}/{*parameter}")]
    public IActionResult GetValue(string sessionId, string parameter)
    {
        var items = SessionData.GetValueOrDefault(sessionId) ?? new();
        var item = items.FirstOrDefault(i => i.Parameter == parameter);
        return Ok(new { value = item?.ParameterValue ?? "" });
    }

    // Caller: the engine's SendSCORMCommit (LMSCommit). Treats everything the
    // client still has marked dirty as persisted. The demo clears the dirty
    // flags; a real backend would flush a transaction here.
    [HttpPost("api/scormModule/commitSession")]
    public IActionResult CommitSession([FromBody] CommitRequest request)
    {
        var sessionId = request?.SessionId ?? "default";
        var items = SessionData.GetValueOrDefault(sessionId) ?? new();
        foreach (var item in items.Where(i => i.IsDirty))
        {
            item.IsDirty = false;
            item.State = "sent";
        }
        return Ok(new { success = true });
    }

    // Caller: the engine when it can determine a definitive pass/fail outcome
    // (client-side deduplicated via LastSent, so this is only hit on change).
    // A real LMS writes the module result / score record and unlocks whatever
    // follows the course here.
    [HttpPost("api/module/markComplete")]
    public IActionResult MarkComplete([FromBody] MarkCompleteRequest request)
    {
        return Ok(new { success = true, moduleResult = request?.SuccessStatus ?? "passed" });
    }

    // Terminal call of the session lifecycle (LMSFinish). We simply stamp the end
    // time; the session row could be archived/analysed here in a real LMS.
    [HttpPost("api/scormModule/terminateUserSession")]
    public IActionResult TerminateUserSession([FromBody] TerminateRequest request)
    {
        var sessionId = request?.SessionId ?? "default";
        if (Sessions.ContainsKey(sessionId))
            Sessions[sessionId].EndTime = DateTime.UtcNow;
        return Ok(new { success = true });
    }

    // THE content endpoint that YARP proxies /assets/scorm/disk/... onto: YARP
    // strips the prefix and forwards to
    //   cdn/asset/scorm/getContentFile/{assetCode}/{filePath}
    // This action then streams the file out of /data/assets/scorm/{assetCode}.
    //
    // For text payloads the ##ApiRootUrl## placeholder seen in the engine
    // files is swapped for THIS API's absolute origin at serve time - the demo
    // equivalent of the upload-time templating the real product does, which is
    // how engine script URLs inside the loader always point back at the API.
    [HttpGet("cdn/asset/scorm/getContentFile/{assetCode}/{**filePath}")]
    public IActionResult GetContentFile(string assetCode, string filePath)
    {
        // Package root for uploaded SCORM courses: /data/assets/scorm/{assetCode}
        var contentRoot = Path.Combine(_env.ContentRootPath, "data", "assets", "scorm");
        var fullPath = Path.Combine(contentRoot, assetCode, filePath);

        // Cheap containment check: never resolve outside the package folder.
        _ = Path.GetFullPath(fullPath);
        if (!fullPath.StartsWith(contentRoot, StringComparison.OrdinalIgnoreCase) || !System.IO.File.Exists(fullPath))
            return NotFound();

        var ext = Path.GetExtension(filePath).ToLowerInvariant();
        var mimeType = GetMimeType(ext);
        // Text content needs the ApiRootUrl templating + is returned as a
        // string; binaries (images, media) are streamed with range support so
        // video/audio seeking inside the SCO works.
        var isText = mimeType.StartsWith("text/") ||
                     mimeType is "application/javascript" or "application/json" or "application/xml";

        Response.Headers.Append("Accept-Ranges", "bytes");
        Response.Headers.Append("Cache-Control", "no-store, no-cache");

        var apiRoot = $"{Request.Scheme}://{Request.Host}";
        if (isText)
        {
            var content = System.IO.File.ReadAllText(fullPath);
            content = content.Replace("##ApiRootUrl##", apiRoot, StringComparison.OrdinalIgnoreCase);
            return Content(content, mimeType);
        }

        return PhysicalFile(fullPath, mimeType, enableRangeProcessing: true);
    }

    // Landing-page metadata for ScormLauncher.vue: which package to load, where
    // the loader lives (thru YARP) and what module it represents.
    [HttpGet("api/scorm/launchInfo")]
    public IActionResult GetLaunchInfo()
    {
        return Ok(new
        {
            AssetCode = "demo-course",
            LoaderUrl = "/assets/scorm/disk/demo-course/sp_sco_loader.html",
            LaunchUrl = "/assets/scorm/disk/demo-course/index.html",
            ModuleId = "demo-001",
            ModuleName = "Demo SCORM Course",
            ScormVersion = "12"
        });
    }

    // Minimal extension -> MIME mapping used when streaming package files.
    private static string GetMimeType(string extension) => extension switch
    {
        ".html" or ".htm" => "text/html",
        ".js" => "application/javascript",
        ".css" => "text/css",
        ".json" => "application/json",
        ".xml" => "application/xml",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".svg" => "image/svg+xml",
        ".ico" => "image/x-icon",
        ".woff" => "font/woff",
        ".woff2" => "font/woff2",
        ".ttf" => "font/ttf",
        ".mp4" => "video/mp4",
        ".mp3" => "audio/mpeg",
        _ => "application/octet-stream"
    };
}

// --- Simple request/state DTOs for the SCORM endpoints -----------------------

public class ScormSession
{
    public string ModuleId { get; set; } = "";
    public DateTime StartTime { get; set; }
    public DateTime? EndTime { get; set; }
}

public class ScormDataItem
{
    public string Parameter { get; set; } = "";
    public string ParameterValue { get; set; } = "";
    public bool IsDirty { get; set; }
    public string State { get; set; } = "pending";
}

public class ScormSetRequest
{
    public string SessionId { get; set; } = "default";
    public string Parameter { get; set; } = "";
    public string ParameterValue { get; set; } = "";
}

public class CommitRequest
{
    public string SessionId { get; set; } = "default";
}

public class MarkCompleteRequest
{
    public string ModuleId { get; set; } = "";
    public string SuccessStatus { get; set; } = "";
    public string CompletionStatus { get; set; } = "";
    public double ScoreScaled { get; set; }
}

public class TerminateRequest
{
    public string SessionId { get; set; } = "default";
}
