param(
    [int]$Port = 8093,
    [string]$PythonPath = ''
)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskPython = if ($PythonPath) { $PythonPath } else { Join-Path $taskRoot '.venv\Scripts\python.exe' }
if (-not (Test-Path -LiteralPath $taskPython)) { throw 'Python 환경이 필요합니다. .venv를 설치하거나 -PythonPath로 기존 Python 경로를 지정하세요.' }
$env:PYTHONPATH = Join-Path $taskRoot 'src'
$env:OMP_NUM_THREADS = '4'
Set-Location -LiteralPath $taskRoot
& $taskPython -m midterm serve --port $Port
