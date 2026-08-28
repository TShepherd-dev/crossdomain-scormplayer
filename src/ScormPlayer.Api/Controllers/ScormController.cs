using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.FileProviders;
using System.Text.Json;

namespace ScormPlayer.Api.Controllers;

[ApiController]
public class ScormController : ControllerBase
{
    private readonly IWebHostEnvironment _env;

    public ScormController(IWebHostEnvironment env)
    {
        _env = env;
    }

    private static readonly Dictionary<string, ScormSession> Sessions = new();
    private static readonly Dictionary<string, List<ScormDataItem>> SessionData = new();

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

    [HttpGet("api/module/{moduleId}/getLaunchDetails")]
    public IActionResult GetLaunchDetails(string moduleId, [FromQuery] int preview = 0)
    {
        GetOrCreateSession(moduleId);
        return Ok(new
        {
            ModuleId = moduleId,
            ModuleName = "Demo SCORM Course",
            ScormUrl = $"/assets/scorm/disk/demo-course/ap_sco_loader.html",
            ScormVersion = "12",
            IsCompleted = false
        });
    }

    [HttpPost("api/module/{moduleId}/recordAttempt")]
    public IActionResult RecordAttempt(string moduleId)
    {
        return Ok(new { Success = true });
    }

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

    [HttpGet("api/scormModule/getValue/{sessionId}/{*parameter}")]
    public IActionResult GetValue(string sessionId, string parameter)
    {
        var items = SessionData.GetValueOrDefault(sessionId) ?? new();
        var item = items.FirstOrDefault(i => i.Parameter == parameter);
        return Ok(new { value = item?.ParameterValue ?? "" });
    }

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

    [HttpPost("api/module/markComplete")]
    public IActionResult MarkComplete([FromBody] MarkCompleteRequest request)
    {
        return Ok(new { success = true, moduleResult = request?.SuccessStatus ?? "passed" });
    }

    [HttpPost("api/scormModule/terminateUserSession")]
    public IActionResult TerminateUserSession([FromBody] TerminateRequest request)
    {
        var sessionId = request?.SessionId ?? "default";
        if (Sessions.ContainsKey(sessionId))
            Sessions[sessionId].EndTime = DateTime.UtcNow;
        return Ok(new { success = true });
    }

    [HttpGet("cdn/asset/scorm/getContentFile/{assetCode}/{**filePath}")]
    public IActionResult GetContentFile(string assetCode, string filePath)
    {
        var contentRoot = Path.Combine(_env.ContentRootPath, "data", "assets", "scorm");
        var fullPath = Path.Combine(contentRoot, assetCode, filePath);

        _ = Path.GetFullPath(fullPath);
        if (!fullPath.StartsWith(contentRoot, StringComparison.OrdinalIgnoreCase) || !System.IO.File.Exists(fullPath))
            return NotFound();

        var ext = Path.GetExtension(filePath).ToLowerInvariant();
        var mimeType = GetMimeType(ext);
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

    [HttpGet("api/scorm/launchInfo")]
    public IActionResult GetLaunchInfo()
    {
        return Ok(new
        {
            AssetCode = "demo-course",
            LoaderUrl = "/assets/scorm/disk/demo-course/ap_sco_loader.html",
            LaunchUrl = "/assets/scorm/disk/demo-course/index.html",
            ModuleId = "demo-001",
            ModuleName = "Demo SCORM Course",
            ScormVersion = "12"
        });
    }

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
