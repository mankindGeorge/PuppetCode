﻿# 构建 Windows 桌面版（Electron）
#
# 流程：Vite 构建单文件前端 → 同步到 electron 目录 → 打包到 dist\PuppetCode-win32-x64
# 用法：powershell -ExecutionPolicy Bypass -File build\build-desktop.ps1
#
# 首次构建会自动安装前端依赖、Electron 与打包工具；网络受限时使用 npmmirror 镜像。
# 应用图标：把设计好的 icon.ico 放入 build\electron\ 即可自动使用；没有则用默认图标。

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $PSScriptRoot 'electron'
$mirror = 'https://npmmirror.com/mirrors/electron/'

# 0. 构建前端单文件（源码在 src\，产物为 dist-single\index.html）
Push-Location $root
try {
  if (-not (Test-Path (Join-Path $root 'node_modules\vite'))) {
    & npm.cmd install --registry=https://registry.npmmirror.com --no-audit --no-fund
  }
  & npm.cmd run build
  if ($LASTEXITCODE -ne 0) { throw '前端构建失败，请查看上方 Vite 输出' }
} finally {
  Pop-Location
}

# 1. 同步前端单文件
Copy-Item (Join-Path $root 'dist-single\index.html') (Join-Path $appDir 'index.html') -Force

# 2. 确保 Electron 运行库与打包工具就绪
if (-not (Test-Path (Join-Path $appDir 'node_modules\electron\dist\electron.exe'))) {
  Push-Location $appDir
  try {
    $env:ELECTRON_MIRROR = $mirror
    & npm install
    & (Join-Path $appDir 'node_modules\.bin\install-electron.cmd')
  } finally {
    Pop-Location
  }
}

# 3. 打包
Push-Location $appDir
try {
  $env:ELECTRON_MIRROR = $mirror
  $packagerArgs = @('.', 'PuppetCode',
    '--platform=win32', '--arch=x64',
    "--out=$(Join-Path $root 'dist')", '--overwrite', '--asar', '--ignore=node_modules')
  if (Test-Path (Join-Path $appDir 'icon.ico')) {
    $packagerArgs += '--icon=icon.ico'
  }
  & (Join-Path $appDir 'node_modules\.bin\electron-packager.cmd') @packagerArgs
} finally {
  Pop-Location
}

Write-Output ('已生成：' + (Join-Path $root 'dist\PuppetCode-win32-x64\PuppetCode.exe'))
