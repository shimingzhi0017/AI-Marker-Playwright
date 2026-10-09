import { spawn } from 'node:child_process';

// Fixed script: paths travel through the environment rather than shell interpolation.
export const folderDialogScript = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择历史记录导出文件夹'
$dialog.ShowNewFolderButton = $true
$dialog.SelectedPath = $env:AI_MARKER_EXPORT_DIRECTORY
$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
try {
  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Write([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($dialog.SelectedPath)))
  }
} finally {
  $dialog.Dispose()
  $owner.Dispose()
}
`;

let choosing = false;
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
        if (code !== 0 || error.trim()) return reject(Error('无法打开文件夹选择窗口，请重试'));
        const selected = output.trim();
        resolve(selected ? Buffer.from(selected, 'base64').toString('utf8') : null);
      });
    });
  } finally { choosing = false; }
}
