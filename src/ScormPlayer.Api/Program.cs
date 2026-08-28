using System.Text.Json;
using Microsoft.Extensions.FileProviders;
using Yarp.ReverseProxy.Configuration;

// -----------------------------------------------------------------------------
// Cross-Domain SCORM Content Player - API host
//
// This process plays two roles:
//   1. Hosts the SCORM runtime endpoints (startScorm, setValue, commitSession,
//      markComplete, ...) that the in-browser SCORM engine calls to persist
//      cmi.* data, record attempts and finish sessions.
//   2. Acts as a YARP reverse proxy so that SCORM package files under
//      /data/assets/scorm are served to the browser "thru" the API - the
//      content appears to come from this API's own origin (localhost:5001)
//      rather than a separate content host. That is the "content on another
//      domain" half of the cross-domain demo.
//
// Everything is demo/in-memory: no database, no auth, no persistence across
// restarts.
// -----------------------------------------------------------------------------

var builder = WebApplication.CreateBuilder(args);

// API controllers are serialized with camelCase JSON property names so the
// C# DTOs match the lowercase-first property names the Vue frontend and the
// JS SCORM engine expect on the wire.
builder.Services.AddControllers()
    .AddJsonOptions(o =>
    {
        o.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        o.JsonSerializerOptions.DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull;
    });

// CORS policy for the dev origins involved in the demo:
//   - http(s)://localhost:8080: the Vue frontend. It calls the API directly
//     (fetch, viewer boot) and hosts /data engine scripts inside iframes, so
//     it needs Access-Control-Allow-Origin on cross-origin reads.
//   - http(s)://localhost:5001: the API's own origin; included so proxied
//     content that resolves back onto this host is also permitted.
// AllowCredentials mirrors the cookie-driven auth shape of the real product
// (even though this demo does not actually authenticate).
builder.Services.AddCors(options =>
{
    options.AddPolicy("ScormDemoPolicy", policy =>
    {
        policy
            .WithOrigins(
                "http://localhost:8080",
                "https://localhost:8080",
                "http://localhost:5001",
                "https://localhost:5001")
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

// -----------------------------------------------------------------------------
// YARP reverse-proxy configuration (built in-memory rather than in
// appsettings.json so the cluster destination can carry a fully absolute URL
// for this API instance - the same trick the real AcademyPoint product uses).
// -----------------------------------------------------------------------------
var apiBaseUrl = "https://localhost:5001";                 // this API
var scormContentPath = "/cdn/asset/scorm/getContentFile/"; // its file-serving action

builder.Services.AddReverseProxy()
    .LoadFromMemory(
        [
            // Route: intercepts browser requests shaped like
            //   /assets/scorm/disk/{assetCode}/{**filepath}
            // (e.g. .../disk/demo-course/sp_sco_loader.html).
            // The "disk" segment distinguishes this route from a future
            // "azure" storage variant - disk/azure are storage prefixes.
            new RouteConfig
            {
                RouteId = "scorm-disk",
                Match = new RouteMatch { Path = "/assets/scorm/disk/{assetCode}/{**filepath}" },
                // Strip the /assets/scorm/disk prefix before forwarding, so
                // what remains is exactly "the file inside the package".
                Transforms = [new Dictionary<string, string> { { "PathRemovePrefix", "/assets/scorm/disk" } }],
                ClusterId = "scorm-cluster"
            }
        ],
        [
            // Cluster: every matched request is forwarded to THIS API's own
            // file-serving action (see MapControllerRoute "ScormDisk" below).
            // Net effect: the browser sees only /assets/scorm/disk/... while
            // the controller receives
            //   /cdn/asset/scorm/getContentFile/{assetCode}/{file}
            new ClusterConfig
            {
                ClusterId = "scorm-cluster",
                Destinations = new Dictionary<string, DestinationConfig>
                {
                    { "local", new DestinationConfig { Address = $"{apiBaseUrl}{scormContentPath}" } }
                }
            }
        ]);

var app = builder.Build();

app.UseCors("ScormDemoPolicy");

// Serve the SCORM engine assets (sp_sco_loader.html, sp_sco_startup.js,
// engine_slim.js, engine_12.js) straight from /data. These files are loaded
// inside iframes whose page origin is localhost:5001, while code that
// script-injects them may live on 8080, so CORS headers are added manually in
// OnPrepareResponse for the frontend origin. Caching is disabled so restarting
// the API immediately serves edited scripts.
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(Path.Combine(app.Environment.ContentRootPath, "data")),
    RequestPath = new PathString("/data"),
    OnPrepareResponse = ctx =>
    {
        var allowedOrigins = new[] { "http://localhost:8080", "https://localhost:8080" };
        var requestOrigin = ctx.Context.Request.Headers["Origin"].ToString();
        if (allowedOrigins.Contains(requestOrigin, StringComparer.OrdinalIgnoreCase))
        {
            ctx.Context.Response.Headers.Append("Access-Control-Allow-Origin", requestOrigin);
            ctx.Context.Response.Headers.Append("Vary", "Origin");
            ctx.Context.Response.Headers.Append("Access-Control-Allow-Credentials", "true");
        }
        ctx.Context.Response.Headers.Append("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    }
});

// Request pipeline wiring. The RouteEndpoint groups:
//   1. app.MapControllers()           - the API's own controllers
//                                       (api/scorm/launchInfo, setValue, ...).
//   2. app.MapControllerRoute("ScormDisk") - the file-serving route that
//                                       YARP's cluster destination resolves to.
//   3. app.MapReverseProxy()          - registers the YARP proxy endpoint that
//                                       receives the original
//                                       /assets/scorm/disk/... requests.
app.MapControllers();
app.MapControllerRoute(
    name: "ScormDisk",
    pattern: "cdn/asset/scorm/getContentFile/{assetCode}/{**filepath}",
    defaults: new { controller = "Scorm", action = "GetContentFile" });
app.MapReverseProxy();

app.Run();
