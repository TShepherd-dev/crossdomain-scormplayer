using System.Text.Json;
using Microsoft.Extensions.FileProviders;
using Yarp.ReverseProxy.Configuration;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers()
    .AddJsonOptions(o =>
    {
        o.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        o.JsonSerializerOptions.DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull;
    });

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

var apiBaseUrl = "https://localhost:5001";
var scormContentPath = "/cdn/asset/scorm/getContentFile/";

builder.Services.AddReverseProxy()
    .LoadFromMemory(
        [
            new RouteConfig
            {
                RouteId = "scorm-disk",
                Match = new RouteMatch { Path = "/assets/scorm/disk/{assetCode}/{**filepath}" },
                Transforms = [new Dictionary<string, string> { { "PathRemovePrefix", "/assets/scorm/disk" } }],
                ClusterId = "scorm-cluster"
            }
        ],
        [
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

app.MapControllers();
app.MapControllerRoute(
    name: "ScormDisk",
    pattern: "cdn/asset/scorm/getContentFile/{assetCode}/{**filepath}",
    defaults: new { controller = "Scorm", action = "GetContentFile" });
app.MapReverseProxy();

app.Run();
