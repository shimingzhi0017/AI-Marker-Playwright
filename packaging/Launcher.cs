using System;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;
using System.ComponentModel;
using System.Security.Cryptography;
using System.Windows.Forms;

class Launcher {
    const string PayloadHash = "__PAYLOAD_HASH__";
    [STAThread]
    static int Main(string[] args) {
        bool verify = Array.IndexOf(args, "--verify") >= 0;
        string errorDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AI-Marker-Playwright");
        for(int i=0;i<args.Length-1;i++)if(args[i]=="--verify-dir" && verify)errorDir=Path.GetFullPath(args[i+1]);
        try {
            string baseDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AI-Marker-Playwright");
            string install = Path.Combine(baseDir, "app", PayloadHash.Substring(0,12));
            for(int i=0;i<args.Length-1;i++)if(args[i]=="--verify-dir" && verify)install=Path.GetFullPath(args[i+1]);
            if(!File.Exists(Path.Combine(install,"ready.txt"))) {
                string staging=install+".extract-"+Guid.NewGuid().ToString("N");
                Directory.CreateDirectory(staging);
                try {
                    using(FileStream exe=File.OpenRead(Application.ExecutablePath)) {
                        exe.Seek(-24,SeekOrigin.End);byte[] footer=new byte[24];exe.Read(footer,0,24);
                        if(System.Text.Encoding.ASCII.GetString(footer,16,8)!="MARKER01")throw new Exception("执行文件不完整，请重新下载。");
                        long start=BitConverter.ToInt64(footer,0),length=BitConverter.ToInt64(footer,8);
                        if(start<0||length<0||start+length!=exe.Length-24)throw new Exception("执行文件校验失败。");
                        string zip=Path.Combine(staging,"payload.zip");
                        using(FileStream output=File.Create(zip)) {
                            exe.Position=start;byte[] buffer=new byte[1024*1024];long remaining=length;
                            while(remaining>0){int n=exe.Read(buffer,0,(int)Math.Min(buffer.Length,remaining));if(n==0)throw new EndOfStreamException();output.Write(buffer,0,n);remaining-=n;}
                        }
                        using(var sha=SHA256.Create())using(var stream=File.OpenRead(zip))if(BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant()!=PayloadHash)throw new Exception("执行文件校验失败，请重新下载。");
                        ZipFile.ExtractToDirectory(zip,staging);File.Delete(zip);
                    }
                    File.WriteAllText(Path.Combine(staging,"ready.txt"),PayloadHash);
                    Directory.CreateDirectory(Path.GetDirectoryName(install));
                    if(Directory.Exists(install))Directory.Delete(install,true);
                    Directory.Move(staging,install);
                } catch {if(Directory.Exists(staging))Directory.Delete(staging,true);throw;}
            }
            var info=new ProcessStartInfo();info.WorkingDirectory=install;info.UseShellExecute=false;
            info.EnvironmentVariables["PLAYWRIGHT_BROWSERS_PATH"]=Path.Combine(install,"browsers");
            info.EnvironmentVariables["AI_MARKER_DATA_ROOT"]=Path.Combine(baseDir,"user-data");
            if(verify) {
                info.FileName=Path.Combine(install,"runtime","node.exe");
                info.Arguments="\""+Path.Combine(install,"packaging","verify.mjs")+"\"";
                info.EnvironmentVariables["AI_MARKER_DATA_ROOT"]=Path.Combine(install,"verification-data");
                info.CreateNoWindow=true;
            } else {
                info.FileName=Path.Combine(install,"runtime","node.exe");
                info.Arguments="\""+Path.Combine(install,"src","server.mjs")+"\"";
                info.CreateNoWindow=true;
            }
            info.RedirectStandardOutput=true;
            info.RedirectStandardError=true;
            Process process=null;
            for(int attempt=1;attempt<=4;attempt++) {
                try {process=Process.Start(info);break;}
                catch(Win32Exception error) {
                    // Windows Defender may briefly hold a freshly extracted executable while scanning it.
                    if(error.NativeErrorCode!=5 || attempt==4)throw;
                    System.Threading.Thread.Sleep(750*attempt);
                }
            }
            using(process) {
                var stdoutTask=process.StandardOutput.ReadToEndAsync();
                var stderrTask=process.StandardError.ReadToEndAsync();
                process.WaitForExit();
                string stdout=stdoutTask.Result,stderr=stderrTask.Result;
                if(process.ExitCode!=0&&!verify)throw new Exception("工作台进程已启动，但异常退出（退出代码 "+process.ExitCode+"）。\n\n程序路径："+info.FileName+"\n\n错误输出："+((stderr+"\n"+stdout).Trim()));
                return process.ExitCode;
            }
        } catch(Exception error) {
            string logPath=Path.Combine(errorDir,"launcher-error.txt");
            string diagnostic="时间："+DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss zzz")+"\r\n启动器："+Application.ExecutablePath+"\r\n安装目录："+Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"AI-Marker-Playwright","app",PayloadHash.Substring(0,12))+"\r\n\r\n"+error.ToString();
            try {Directory.CreateDirectory(errorDir);File.WriteAllText(logPath,diagnostic);}catch{}
            if(!verify)MessageBox.Show(error.Message+"\n\n诊断文件："+logPath,"AI阅卷工作台",MessageBoxButtons.OK,MessageBoxIcon.Error);
            return 1;
        }
    }
}
