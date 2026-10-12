using System;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Windows.Forms;

class Launcher {
    const string PayloadHash = "__PAYLOAD_HASH__";
    [STAThread]
    static int Main(string[] args) {
        try {
            string baseDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AI-Marker-Playwright");
            bool verify = Array.IndexOf(args, "--verify") >= 0;
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
            using(var process=Process.Start(info)){process.WaitForExit();if(process.ExitCode!=0&&!verify)throw new Exception("程序未能正常启动，请重新启动或检查应用目录。");return process.ExitCode;}
        } catch(Exception error) {MessageBox.Show(error.Message,"AI阅卷工作台",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;}
    }
}
