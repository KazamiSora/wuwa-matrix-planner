using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using System.Collections.Generic;
using System.Reflection;

[assembly: AssemblyTitle("终焉矩阵血线排布")]
[assembly: AssemblyProduct("Wuwa Matrix Planner")]
[assembly: AssemblyVersion("0.3.0.0")]
[assembly: AssemblyFileVersion("0.3.0.0")]

internal static class Launcher {
    private static readonly string Root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar);
    private static Process ownedServer;
    private static NotifyIcon tray;
    private static string url;
    private static bool headless;

    [STAThread]
    private static int Main(string[] args) {
        headless = Array.IndexOf(args, "--headless") >= 0;
        bool noBrowser = headless || Array.IndexOf(args, "--no-browser") >= 0;
        try {
            Application.EnableVisualStyles();
            int basePort = 4174;
            for (int i = 0; i < args.Length - 1; i++) {
                if (args[i] == "--port") basePort = Int32.Parse(args[i + 1]);
            }
            if (basePort < 1024 || basePort > 65524) throw new Exception("启动端口无效。");
            string node = Path.Combine(Root, "runtime", "node.exe");
            string script = Path.Combine(Root, "server.mjs");
            if (!File.Exists(node) || !File.Exists(script) || !File.Exists(Path.Combine(Root, "index.html")))
                throw new Exception("程序文件不完整。请先完整解压便携包，再启动程序。");

            for (int port = basePort; port < basePort + 10; port++) {
                var status = Status(port);
                if (Matches(status)) { url = "http://127.0.0.1:" + port; break; }
            }
            if (url == null) {
                for (int port = basePort; port < basePort + 10; port++) {
                    if (IsPortBusy(port)) continue;
                    var info = new ProcessStartInfo(node, "\"" + script + "\"");
                    info.WorkingDirectory = Root;
                    info.UseShellExecute = false;
                    info.CreateNoWindow = true;
                    info.EnvironmentVariables["MATRIX_PORT"] = port.ToString();
                    ownedServer = Process.Start(info);
                    for (int attempt = 0; attempt < 45; attempt++) {
                        Thread.Sleep(100);
                        var status = Status(port);
                        if (Matches(status)) { url = "http://127.0.0.1:" + port; break; }
                        if (ownedServer.HasExited) break;
                    }
                    if (url != null) break;
                    StopOwnedServer();
                }
            }
            if (url == null) throw new Exception("本地服务启动失败，请检查程序是否被安全软件阻止或端口被占用。");
            if (!noBrowser) OpenWindow();
            if (ownedServer == null) return 0;
            if (!headless) {
                tray = new NotifyIcon();
                tray.Icon = SystemIcons.Application;
                tray.Text = "终焉矩阵血线排布 V0.3";
                var menu = new ContextMenuStrip();
                menu.Items.Add("打开软件", null, delegate { OpenWindow(); });
                menu.Items.Add("退出软件", null, delegate { Application.Exit(); });
                tray.ContextMenuStrip = menu;
                tray.DoubleClick += delegate { OpenWindow(); };
                tray.Visible = true;
            }
            Application.Run();
            return 0;
        } catch (Exception error) {
            if (!headless) MessageBox.Show(error.Message, "终焉矩阵血线排布 V0.3", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        } finally {
            if (tray != null) { tray.Visible = false; tray.Dispose(); }
            StopOwnedServer();
        }
    }

    private static Dictionary<string, object> Status(int port) {
        try {
            var request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/__matrix_health");
            request.Proxy = null;
            request.Timeout = 250;
            using (var response = request.GetResponse())
            using (var reader = new StreamReader(response.GetResponseStream())) {
                return new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(reader.ReadToEnd());
            }
        } catch { return null; }
    }

    private static bool Matches(Dictionary<string, object> status) {
        return status != null && status.ContainsKey("app") && Convert.ToString(status["app"]) == "wuwa-matrix-hp-planner"
            && status.ContainsKey("root") && String.Equals(Convert.ToString(status["root"]).TrimEnd(Path.DirectorySeparatorChar), Root, StringComparison.OrdinalIgnoreCase)
            && status.ContainsKey("version") && Convert.ToString(status["version"]) == "0.3.0";
    }

    private static bool IsPortBusy(int port) {
        try {
            var listener = new System.Net.Sockets.TcpListener(IPAddress.Loopback, port);
            listener.Start(); listener.Stop(); return false;
        } catch { return true; }
    }

    private static void OpenWindow() {
        string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string programFilesX86 = Environment.GetEnvironmentVariable("ProgramFiles(x86)") ?? programFiles;
        string[] candidates = {
            Path.Combine(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(programFiles, "Google", "Chrome", "Application", "chrome.exe")
        };
        foreach (string browser in candidates) {
            if (!File.Exists(browser)) continue;
            string profile = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WuwaMatrixPlanner", "browser");
            var info = new ProcessStartInfo(browser, "--app=\"" + url + "\" --user-data-dir=\"" + profile + "\" --no-first-run");
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            Process.Start(info); return;
        }
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }

    private static void StopOwnedServer() {
        if (ownedServer == null) return;
        try { if (!ownedServer.HasExited) ownedServer.Kill(); } catch { }
        ownedServer.Dispose(); ownedServer = null;
    }
}
