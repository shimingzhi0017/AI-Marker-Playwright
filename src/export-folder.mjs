import { spawn } from 'node:child_process';
import path from 'node:path';

// Fixed script: paths travel through the environment rather than shell interpolation.
export const folderDialogScript = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
try {
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = '选择历史记录导出文件夹'
  $dialog.ShowNewFolderButton = $true
  $dialog.SelectedPath = $env:AI_MARKER_EXPORT_DIRECTORY
  $owner = New-Object System.Windows.Forms.Form
  $owner.TopMost = $true
  try {
    if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
      [Console]::Out.Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($dialog.SelectedPath)))
    }
  } finally {
    $dialog.Dispose()
    $owner.Dispose()
  }
} catch {
  $message = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($_.Exception.Message))
  [Console]::Out.Write('AI_MARKER_DIALOG_ERROR:' + $message)
  exit 1
}
`;

let choosing = false;

// PowerShell can emit CLIXML progress records on stderr even when the dialog
// succeeds. Only the explicit stdout protocol and the exit code are relevant.
export function folderDialogResult({ code = 0, stdout = '', stderr = '' } = {}) {
  const output = String(stdout).trim();
  if (output.startsWith('AI_MARKER_DIALOG_ERROR:')) {
    let detail = '';
    try {
      detail = Buffer.from(output.slice('AI_MARKER_DIALOG_ERROR:'.length), 'base64').toString('utf8').trim();
    } catch {}
    throw Error(detail ? `无法打开文件夹选择窗口：${detail}` : '无法打开文件夹选择窗口，请重试');
  }
  if (code !== 0) {
    const diagnostic = String(stderr).replace(/#< CLIXML\s*/g, '').trim();
    throw Error(diagnostic ? `无法打开文件夹选择窗口：${diagnostic.slice(0, 300)}` : '无法打开文件夹选择窗口，请重试');
  }
  if (!output) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(output) || output.length % 4 === 1) throw Error('文件夹选择结果无效，请重试');
  let selected;
  try {
    selected = Buffer.from(output, 'base64').toString('utf8');
  } catch {
    throw Error('文件夹选择结果无效，请重试');
  }
  if (!selected || !path.isAbsolute(selected)) throw Error('文件夹选择结果无效，请重试');
  return selected;
}

export async function chooseExportDirectory(initialDirectory) {
  if (process.platform !== 'win32') throw Error('此系统暂不支持选择导出文件夹');
  if (choosing) throw Error('请先完成已打开的文件夹选择窗口');
  choosing = true;
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', Buffer.from(folderDialogScript, 'utf16le').toString('base64')], {
        windowsHide: true,
        env: { ...process.env, AI_MARKER_EXPORT_DIRECTORY: initialDirectory },
        stdio: ['ignore', 'pipe', 'pipe']
      });
      let output = '', error = '';
      child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
      child.stdout.on('data', value => output += value);
      child.stderr.on('data', value => error += value);
      child.once('error', reject);
      child.once('close', code => {
        try {
          resolve(folderDialogResult({ code, stdout: output, stderr: error }));
        } catch (failure) {
          reject(failure);
        }
      });
    });
  } finally { choosing = false; }
}
