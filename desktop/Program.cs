using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Net;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace LoomOps.Desktop
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try { Application.Run(new WorkspaceWindow()); }
            catch (Exception error)
            {
                ReportStartupFailure(error);
                MessageBox.Show("无法启动织序。请完整解压应用，并确认电脑已安装 Microsoft Edge WebView2 Runtime。",
                    "织序", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        internal static void ReportStartupFailure(Exception error)
        {
            string file = Environment.GetEnvironmentVariable("LOOMOPS_STARTUP_DIAGNOSTICS");
            if (!String.IsNullOrEmpty(file)) File.WriteAllText(file, error.ToString());
        }
    }

    internal sealed class WorkspaceWindow : Form
    {
        private const string AppOrigin = "https://loomops.invalid";
        private const string SecurityHeaders = "\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer";
        private static readonly string DocumentHeaders = SecurityHeaders + "\r\nContent-Security-Policy: default-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; object-src 'none'; form-action 'self'";
        private static readonly Dictionary<string, string> ContentTypes = new Dictionary<string, string>(StringComparer.Ordinal)
        {
            { "/index.html", "text/html" }, { "/style.css", "text/css" }, { "/app.js", "text/javascript" }, { "/engine.js", "text/javascript" }
        };
        private readonly WebView2 web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(17,19,16) };
        private readonly CancellationTokenSource lifetime = new CancellationTokenSource();
        private readonly DeepSeekClient deepSeek = new DeepSeekClient(ReadResourceText("audit-prompt.txt"));
        private readonly string serverKey = (Environment.GetEnvironmentVariable("DEEPSEEK_API_KEY") ?? "").Trim();
        private CoreWebView2Environment environment;

        internal WorkspaceWindow()
        {
            Text = "织序 · 多 Agent 编排工作台";
            ClientSize = new Size(1380, 870);
            MinimumSize = new Size(800, 590);
            BackColor = Color.FromArgb(17, 19, 16);
            StartPosition = FormStartPosition.CenterScreen;
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            Controls.Add(web);
            Shown += InitializeAsync;
        }

        private async void InitializeAsync(object sender, EventArgs args)
        {
            try
            {
                string userProfile = Environment.GetEnvironmentVariable("LOOMOPS_PROFILE_DIR");
                if (String.IsNullOrWhiteSpace(userProfile)) userProfile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "LoomOps", "WebView2");
                environment = await CoreWebView2Environment.CreateAsync(null, userProfile);
                if (IsDisposed) return;
                await web.EnsureCoreWebView2Async(environment);
                if (IsDisposed) return;
                CoreWebView2 view = web.CoreWebView2;
                view.Settings.AreDevToolsEnabled = false;
                view.Settings.IsPasswordAutosaveEnabled = false;
                view.Settings.IsGeneralAutofillEnabled = false;
                view.Settings.IsWebMessageEnabled = false;
                view.Settings.AreHostObjectsAllowed = false;
                view.NavigationStarting += delegate(object _, CoreWebView2NavigationStartingEventArgs request)
                {
                    if (!request.Uri.StartsWith(AppOrigin + "/", StringComparison.Ordinal)) request.Cancel = true;
                };
                view.NewWindowRequested += delegate(object _, CoreWebView2NewWindowRequestedEventArgs request) { request.Handled = true; };
                view.PermissionRequested += delegate(object _, CoreWebView2PermissionRequestedEventArgs request) { request.State = CoreWebView2PermissionState.Deny; };
                view.AddWebResourceRequestedFilter(AppOrigin + "/*", CoreWebView2WebResourceContext.All, CoreWebView2WebResourceRequestSourceKinds.All);
                view.WebResourceRequested += HandleRequest;
#if DESKTOP_SMOKE
                view.DOMContentLoaded += SmokeTest;
#endif
                view.Navigate(AppOrigin + "/");
            }
            catch (WebView2RuntimeNotFoundException)
            {
                MessageBox.Show("这台电脑缺少 Microsoft Edge WebView2 Runtime。安装微软官方运行时后重新打开织序。",
                    "织序", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
            catch (Exception error)
            {
                if (IsDisposed) return;
                Program.ReportStartupFailure(error);
                MessageBox.Show("本地窗口初始化失败。请重启应用并确认 Windows 用户目录可写。", "织序", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }

#if DESKTOP_SMOKE
        private async void SmokeTest(object sender, CoreWebView2DOMContentLoadedEventArgs args)
        {
            var view = web.CoreWebView2;
            view.DOMContentLoaded -= SmokeTest;
            string file = Environment.GetEnvironmentVariable("LOOMOPS_SMOKE_RESULT");
            var elapsed = System.Diagnostics.Stopwatch.StartNew();
            try
            {
                string input = Environment.GetEnvironmentVariable("LOOMOPS_SMOKE_KEY") ?? "";
                string serializedInput = new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(input);
                await view.ExecuteScriptAsync("document.querySelector('#top-settings').click(); document.querySelector('[name=model]').value='deepseek-v4-pro'; document.querySelector('[name=key]').value=" + serializedInput + "; document.querySelector('[data-action=test-model]').click();");
                while (elapsed.ElapsedMilliseconds < 120000)
                {
                    string text = await view.ExecuteScriptAsync("document.querySelector('#model-test')?.textContent || ''");
                    if (text != "\"\"" && !text.Contains("正在连接"))
                    {
                        File.WriteAllText(file, text);
                        return;
                    }
                    await System.Threading.Tasks.Task.Delay(150);
                }
                File.WriteAllText(file, "Timed out waiting for Test Connection");
            }
            catch (Exception error) { File.WriteAllText(file, error.GetType().Name); }
            finally { Close(); }
        }
#endif

        private async void HandleRequest(object sender, CoreWebView2WebResourceRequestedEventArgs args)
        {
            using (CoreWebView2Deferral deferral = args.GetDeferral())
            {
                try
                {
                    var request = args.Request;
                    var path = new Uri(request.Uri).AbsolutePath;
                    if (path == "/") path = "/index.html";
                    string type;
                    if (request.Method == "GET" && ContentTypes.TryGetValue(path, out type))
                    {
                        args.Response = environment.CreateWebResourceResponse(OpenResource(path.Substring(1)), 200, "OK", "Content-Type: " + type + "; charset=utf-8" + DocumentHeaders);
                    }
                    else if (path == "/api/config" && request.Method == "GET")
                    {
                        args.Response = Json(new DesktopResponse(200, new { serverKey = DeepSeekClient.ValidKey(serverKey) }));
                    }
                    else if (path == "/api/deepseek" && request.Method == "POST")
                    {
                        string origin = request.Headers.Contains("Origin") ? request.Headers.GetHeader("Origin") : AppOrigin;
                        string key = request.Headers.Contains("X-DeepSeek-Key") ? request.Headers.GetHeader("X-DeepSeek-Key").Trim() : serverKey;
                        string contentType = request.Headers.Contains("Content-Type") ? request.Headers.GetHeader("Content-Type") : "";
                        if (origin != AppOrigin) args.Response = Json(DesktopResponse.Error(403, "请求须来自织序应用。"));
                        else if (!contentType.StartsWith("application/json", StringComparison.OrdinalIgnoreCase)) args.Response = Json(DesktopResponse.Error(415, "请提交 JSON。"));
                        else
                        {
                            string body = ReadBody(request.Content);
                            DesktopResponse model = body == null ? DesktopResponse.Error(413, "请求过大或缺失。") : await deepSeek.CompleteAsync(body, key, lifetime.Token);
                            if (!IsDisposed) args.Response = Json(model);
                        }
                    }
                    else if (path == "/favicon.ico")
                    {
                        args.Response = environment.CreateWebResourceResponse(OpenResource("loomops.ico"), 200, "OK", "Content-Type: image/x-icon" + SecurityHeaders);
                    }
                    else args.Response = Json(DesktopResponse.Error(404, "找不到资源。"));
                }
                catch (Exception)
                {
                    if (!IsDisposed) args.Response = Json(DesktopResponse.Error(500, "织序本地服务无法处理请求。"));
                }
            }
        }

        private static string ReadBody(Stream content)
        {
            if (content == null) return null;
            using (var reader = new StreamReader(content, Encoding.UTF8, true, 4096, true))
            {
                var result = new StringBuilder();
                var buffer = new char[4096];
                int size;
                while ((size = reader.Read(buffer, 0, buffer.Length)) != 0)
                {
                    if (result.Length + size > 250000) return null;
                    result.Append(buffer, 0, size);
                }
                return result.ToString();
            }
        }

        private CoreWebView2WebResourceResponse Json(DesktopResponse result)
        {
            return environment.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes(result.Json), false), result.Status,
                result.Status < 400 ? "OK" : "Request failed", "Content-Type: application/json; charset=utf-8" + SecurityHeaders);
        }

        protected override void OnFormClosed(FormClosedEventArgs args)
        {
            lifetime.Cancel();
            deepSeek.Dispose();
            lifetime.Dispose();
            base.OnFormClosed(args);
        }

        private static Stream OpenResource(string name)
        {
            Stream resource = Assembly.GetExecutingAssembly().GetManifestResourceStream("loomops." + name);
            if (resource == null) throw new InvalidOperationException("Missing application resource: " + name);
            return resource;
        }

        private static string ReadResourceText(string name)
        {
            using (var reader = new StreamReader(OpenResource(name), Encoding.UTF8)) return reader.ReadToEnd();
        }
    }
}
