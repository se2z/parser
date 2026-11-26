$code = @'
using System;
using System.Runtime.InteropServices;
public static class GiftLockOwners {
 [StructLayout(LayoutKind.Sequential)] public struct UniqueProcess {public int pid;public System.Runtime.InteropServices.ComTypes.FILETIME start;}
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] public struct ProcessInfo {public UniqueProcess process;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=256)]public string app;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=64)]public string service;public int type;public uint status;public uint session;[MarshalAs(UnmanagedType.Bool)] public bool restartable;}
 [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)]static extern int RmStartSession(out uint h,int flags,string key);
 [DllImport("rstrtmgr.dll",CharSet=CharSet.Unicode)]static extern int RmRegisterResources(uint h,uint n,string[] files,uint apps,IntPtr p,uint services,IntPtr s);
 [DllImport("rstrtmgr.dll")]static extern int RmGetList(uint h,out uint needed,ref uint count,[In,Out]ProcessInfo[] info,ref uint reasons);
 [DllImport("rstrtmgr.dll")]static extern int RmEndSession(uint h);
 public static ProcessInfo[] Get(string path){uint h;int e=RmStartSession(out h,0,Guid.NewGuid().ToString("N"));if(e!=0)throw new Exception("Start "+e);try{e=RmRegisterResources(h,1,new[]{path},0,IntPtr.Zero,0,IntPtr.Zero);if(e!=0)throw new Exception("Register "+e);uint needed=0,count=0,reasons=0;e=RmGetList(h,out needed,ref count,null,ref reasons);if(e==0)return new ProcessInfo[0];if(e!=234)throw new Exception("List "+e);var info=new ProcessInfo[needed];count=needed;e=RmGetList(h,out needed,ref count,info,ref reasons);if(e!=0)throw new Exception("List "+e);Array.Resize(ref info,(int)count);return info;}finally{RmEndSession(h);}}
}
'@
Add-Type -TypeDefinition $code

$ErrorActionPreference = 'Stop'
$target = $env:GIFT_TRACKER_LOCK_TARGET
if (-not $target) { throw 'Missing bot lock path.' }
if (-not (Test-Path -LiteralPath $target)) { exit 0 }
$owners = @([GiftLockOwners]::Get($target))
if ($owners.Count -eq 0) { exit 0 }
if ($owners.Count -ne 1) { throw 'Several processes hold the bot lock; close the bot manually.' }
$owner = $owners[0]
$botProcess = [System.Diagnostics.Process]::GetProcessById($owner.process.pid)
if ($botProcess.ProcessName -ne 'node') { throw 'The lock owner is not Node.js; stopping was cancelled.' }
$actual = $botProcess.StartTime.ToUniversalTime().ToFileTimeUtc()
$lo = [BitConverter]::ToUInt32([BitConverter]::GetBytes($owner.process.start.dwLowDateTime), 0)
$hi = [BitConverter]::ToUInt32([BitConverter]::GetBytes($owner.process.start.dwHighDateTime), 0)
$expected = ([uint64]$hi -shl 32) -bor [uint64]$lo
if ([uint64]$actual -ne $expected) { throw 'Process identity changed; stopping was cancelled.' }
$botProcess.Kill()
if (-not $botProcess.WaitForExit(10000)) { throw 'The old bot process has not exited.' }
Write-Host 'Old Gift Tracker process stopped.'
