"""Build a clean Windows x64 self-extracting executable using installed runtimes."""
from pathlib import Path
import argparse, hashlib, json, shutil, struct, subprocess, zipfile, os
from pathlib import PurePosixPath

parser=argparse.ArgumentParser()
parser.add_argument('--output',required=True)
parser.add_argument('--work',required=True)
args=parser.parse_args()
repo=Path(__file__).resolve().parent.parent
scratch=Path(args.work).resolve();scratch.mkdir(parents=True,exist_ok=True)
output=Path(args.output).resolve();output.parent.mkdir(parents=True,exist_ok=True)
node=Path(shutil.which('node'))
browser_manifest=json.loads((repo/'node_modules/playwright-core/browsers.json').read_text(encoding='utf-8'))
browser_cache=Path(os.environ['LOCALAPPDATA'])/'ms-playwright'
zip_path=scratch/'payload.zip'
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    def add_tree(source,prefix):
        for file in sorted(source.rglob('*')):
            if file.is_file():
                # ZIP entry names must use forward slashes on every host. Using
                # pathlib.Path here emits backslashes on Windows; .NET's ZIP
                # extractor then fails to recreate the expected directory tree.
                entry=PurePosixPath(prefix,*file.relative_to(source).parts).as_posix()
                archive.write(file,entry)
    for directory in ['src','ui','vendor']:add_tree(repo/directory,directory)
    for name in ['config.example.json','package.json','package-lock.json','LICENSE','THIRD-PARTY-NOTICES.md','README.md','测试报告.md','验证与待办.md','接口迁移核查.md']:archive.write(repo/name,name)
    archive.write(repo/'packaging/verify.mjs','packaging/verify.mjs')
    archive.write(repo/'packaging/Launcher.cs','packaging/Launcher.cs')
    archive.write(repo/'packaging/portable-start.cmd','启动工作台.cmd')
    for name in ['playwright','playwright-core','sharp','detect-libc','semver','@img/colour','@img/sharp-win32-x64']:add_tree(repo/'node_modules'/name,'node_modules/'+name)
    archive.write(node,'runtime/node.exe')
    node_license=node.parent/'LICENSE'
    if node_license.exists():
        archive.write(node_license,'runtime/LICENSE')
    # The app launches the regular Chromium binary for both headed and headless
    # checks. Playwright also downloads a headless shell, ffmpeg and winldd by
    # default, but none of them are used by this project and they add hundreds
    # of megabytes to the self-contained release.
    for entry in browser_manifest['browsers']:
        if entry['name'] != 'chromium':
            continue
        name=entry['name'].replace('-','_')+'-'+entry['revision']
        directory=browser_cache/name
        if not directory.exists():raise RuntimeError('Missing browser: '+name)
        add_tree(directory,'browsers/'+name)
payload_hash=hashlib.sha256(zip_path.read_bytes()).hexdigest()
with zipfile.ZipFile(zip_path) as archive:
    names=set(archive.namelist())
    required={'src/server.mjs','packaging/verify.mjs','runtime/node.exe'}
    missing=required-names
    if missing:raise RuntimeError('Release payload is missing required files: '+', '.join(sorted(missing)))
source=scratch/'Launcher.cs';source.write_text((repo/'packaging/Launcher.cs').read_text(encoding='utf-8').replace('__PAYLOAD_HASH__',payload_hash),encoding='utf-8-sig')
stub=scratch/'Launcher.exe'
compiler=Path(os.environ['WINDIR'])/'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
subprocess.run([str(compiler),'/nologo','/target:winexe','/platform:x64','/out:'+str(stub),'/win32icon:'+str(repo/'ui/icon.ico'),'/r:System.Windows.Forms.dll','/r:System.IO.Compression.dll','/r:System.IO.Compression.FileSystem.dll',str(source)],check=True)
with output.open('wb') as target:
    with stub.open('rb') as f:shutil.copyfileobj(f,target)
    offset=target.tell()
    with zip_path.open('rb') as f:shutil.copyfileobj(f,target)
    target.write(struct.pack('<qq8s',offset,zip_path.stat().st_size,b'MARKER01'))
print(json.dumps({'file':str(output),'size':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}))
