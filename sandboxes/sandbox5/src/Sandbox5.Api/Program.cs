using System.Text.Encodings.Web;
using System.Text.Json;
using Microsoft.AspNetCore.ResponseCompression;
using Sandbox5.Api;
using Sandbox5.Api.Api;

// Sandbox 5: the cellgen world map as a service. A REST API that delivers map images (PNG)
// and map data (JSON), and a demo site (wwwroot) that pans and zooms the map and inspects
// the data. The map comes from the domain model in Sandbox5.Domain; its default seed and
// parameters are read from sandboxes/sandbox5/defaults.json.

WebApplicationBuilder builder = WebApplication.CreateBuilder(args);

builder.Services.AddSingleton<MapHost>();
builder.Services.ConfigureHttpJsonOptions(o =>
{
    o.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    o.SerializerOptions.DictionaryKeyPolicy = null;
    // names such as "°C" and "gems & pearls" as they are
    o.SerializerOptions.Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping;
});
builder.Services.AddResponseCompression(o =>
{
    o.EnableForHttps = true;
    o.MimeTypes = ResponseCompressionDefaults.MimeTypes;
});

WebApplication app = builder.Build();

// fail at start-up, not at the first request, when the settings file is missing or invalid
app.Services.GetRequiredService<MapHost>();

app.UseResponseCompression();
app.UseDefaultFiles();
app.UseStaticFiles();
app.MapSandbox5Api();

app.Run();

/// <summary>The entry point, visible to the tests.</summary>
public partial class Program;
