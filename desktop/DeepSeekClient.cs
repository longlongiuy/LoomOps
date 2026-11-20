using System;
using System.Collections;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

namespace LoomOps.Desktop
{
    internal sealed class DesktopResponse
    {
        internal int Status { get; private set; }
        internal string Json { get; private set; }

        internal DesktopResponse(int status, object body)
        {
            Status = status;
            Json = new JavaScriptSerializer { MaxJsonLength = 4000000 }.Serialize(body);
        }

        internal static DesktopResponse Error(int status, string message)
        {
            return new DesktopResponse(status, new { error = message });
        }
    }

    internal sealed class DeepSeekClient : IDisposable
    {
        private static readonly Uri Endpoint = new Uri("https://api.deepseek.com/chat/completions");
        private readonly HttpClient http = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false })
        {
            Timeout = TimeSpan.FromSeconds(90),
            MaxResponseContentBufferSize = 4000000
        };
        private readonly string auditInstructions;

        internal DeepSeekClient(string auditInstructions)
        {
            this.auditInstructions = auditInstructions;
        }

        private static object Get(IDictionary<string, object> data, string name)
        {
            object value;
            return data != null && data.TryGetValue(name, out value) ? value : null;
        }

        internal static bool ValidKey(string key)
        {
            return !String.IsNullOrWhiteSpace(key) && key.Length <= 512 && !Regex.IsMatch(key, @"[^\x21-\x7e]");
        }

        internal async Task<DesktopResponse> CompleteAsync(string raw, string key, CancellationToken cancellationToken)
        {
            if (!ValidKey(key)) return DesktopResponse.Error(401, "请配置有效的 DeepSeek API Key。");
            var codec = new JavaScriptSerializer { MaxJsonLength = 4000000, RecursionLimit = 48 };
            Dictionary<string, object> payload;
            try { payload = codec.Deserialize<Dictionary<string, object>>(raw); }
            catch (ArgumentException) { return DesktopResponse.Error(400, "请求格式无效。"); }
            catch (InvalidOperationException) { return DesktopResponse.Error(400, "请求格式无效。"); }

            var model = Get(payload, "model") as string;
            if (model != "deepseek-flash" && model != "deepseek-v4-pro") return DesktopResponse.Error(400, "请选择支持的 DeepSeek 模型。");
            bool test = Object.Equals(Get(payload, "test"), true);
            string systemMessage;
            string userMessage;
            if (test)
            {
                systemMessage = "Return JSON only.";
                userMessage = "Output {\"ok\":true} as JSON.";
            }
            else
            {
                string task = Get(payload, "task") as string;
                var agent = Get(payload, "agent") as IDictionary<string, object>;
                var prompt = Get(agent, "prompt") as string;
                if (String.IsNullOrWhiteSpace(task) || task.Length > 2500 || prompt == null || prompt.Length > 2000 || Get(payload, "context") == null)
                    return DesktopResponse.Error(400, "任务上下文缺失或超过长度限制。");
                systemMessage = "你是经营数据审计 Agent。" + auditInstructions + "\n角色职责：" + prompt;
                userMessage = codec.Serialize(new
                {
                    task,
                    context = Get(payload, "context"),
                    feedback = Get(payload, "feedback"),
                    previous = Get(payload, "previous"),
                    attempt = Get(payload, "attempt")
                });
            }

            var messages = new List<object>
            {
                new { role = "system", content = systemMessage },
                new { role = "user", content = userMessage }
            };
            var body = new
            {
                model,
                max_tokens = test ? 64 : 16000,
                temperature = 0.1,
                thinking = new { type = "disabled" },
                response_format = new { type = "json_object" },
                messages
            };

            for (int attempt = 0; attempt < 2; attempt++)
            {
                string responseText;
                using (var request = new HttpRequestMessage(HttpMethod.Post, Endpoint))
                {
                    request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", key);
                    request.Content = new StringContent(codec.Serialize(body), Encoding.UTF8, "application/json");
                    try
                    {
                        using (var response = await http.SendAsync(request, cancellationToken))
                        {
                            if (!response.IsSuccessStatusCode) return UpstreamError((int)response.StatusCode);
                            responseText = await response.Content.ReadAsStringAsync();
                        }
                    }
                    catch (OperationCanceledException) { return DesktopResponse.Error(502, "DeepSeek 请求已取消或超时。"); }
                    catch (HttpRequestException) { return DesktopResponse.Error(502, "无法访问 DeepSeek，请检查本机网络后重试。"); }
                }

                try
                {
                    var reply = codec.Deserialize<Dictionary<string, object>>(responseText);
                    var choices = Get(reply, "choices") as IList;
                    var choice = choices != null && choices.Count > 0 ? choices[0] as IDictionary<string, object> : null;
                    var finish = Get(choice, "finish_reason") as string;
                    if (finish != null && finish != "stop") return DesktopResponse.Error(502, "DeepSeek 未完整结束生成，请检查数据规模或稍后重试。");
                    var message = Get(choice, "message") as IDictionary<string, object>;
                    var content = Get(message, "content") as string;
                    var result = String.IsNullOrWhiteSpace(content) ? null : codec.Deserialize<Dictionary<string, object>>(content);
                    if (result != null && (!test || Object.Equals(Get(result, "ok"), true)))
                        return new DesktopResponse(200, new { result, model = Get(reply, "model"), usage = Get(reply, "usage") });
                }
                catch (ArgumentException) { }
                catch (InvalidOperationException) { }
                if (attempt == 0) messages.Add(new { role = "user", content = "请仅返回非空、可解析的 JSON 对象，严格遵照已指定的输出字段。" });
            }
            return DesktopResponse.Error(502, "DeepSeek 两次返回空或不可解析的 JSON。");
        }

        private static DesktopResponse UpstreamError(int code)
        {
            switch (code)
            {
                case 400: return DesktopResponse.Error(400, "DeepSeek 拒绝了模型参数，请检查模型设置。");
                case 401: return DesktopResponse.Error(401, "DeepSeek 鉴权失败，请核对 API Key。");
                case 402: return DesktopResponse.Error(402, "DeepSeek 余额不足，请检查账户。");
                case 403: return DesktopResponse.Error(403, "DeepSeek 拒绝了当前账户的访问。");
                case 429: return DesktopResponse.Error(429, "DeepSeek 请求受限，请稍后重试或调低并发。");
                default: return DesktopResponse.Error(502, "DeepSeek 返回 HTTP " + code + "。");
            }
        }

        public void Dispose() { http.Dispose(); }
    }
}
