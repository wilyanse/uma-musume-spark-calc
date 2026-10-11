import subprocess,pathlib,os,json,shlex
r=pathlib.Path('/Users/willjose/Projects/personal/uma-musume-spark-calc.worktrees/T18-agent-sqlite-security')
s=pathlib.Path(__file__).parent;e=s/'gates';e.mkdir(exist_ok=True)
d='/Users/willjose/.hermes/cache/scratch/T16b/dotnet-combo/dotnet'
env=os.environ.copy();env.update(DOTNET_ROOT=str(pathlib.Path(d).parent),DOTNET_BIN=d,TOOLS_DIR='/Users/willjose/.hermes/cache/scratch/IR1/tools')
manifest=[]
def run(label,args,extra=None):
 en=env.copy();en.update(extra or {});p=subprocess.run(args,cwd=r,env=en,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=240,text=True)
 (e/(label+'.log')).write_text(p.stdout);manifest.append({'label':label,'command':shlex.join(args),'environment':extra or {},'exit':p.returncode});(e/'commands.json').write_text(json.dumps(manifest,indent=2));print(label,'exit',p.returncode,flush=True)
 if p.returncode:print(p.stdout[-12000:],flush=True);raise SystemExit(p.returncode)
projects={'core':'agent/src/Uma.Agent.Core/Uma.Agent.Core.csproj','windows':'agent/src/Uma.Agent.Windows/Uma.Agent.Windows.csproj','core-tests':'agent/tests/Uma.Agent.Core.Tests/Uma.Agent.Core.Tests.csproj','portable':'agent/tests/Uma.Agent.Windows.Tests/Portable/Uma.Agent.Windows.Portable.Tests.csproj','native':'agent/tests/Uma.Agent.Windows.Tests/Native/Uma.Agent.Windows.Tests.csproj'}
run('runtime',['bash','.github/scripts/agent-gates.sh','runtime'])
for name,p in projects.items():
 run('restore-'+name,[d,'restore',p,'--force','--no-http-cache','-p:EnableWindowsTargeting=true'])
 run('audit-'+name,[d,'list',p,'package','--vulnerable','--include-transitive','--format','json'])
 run('graph-'+name,[d,'list',p,'package','--include-transitive','--format','json'])
 run('policy-'+name,[d,'msbuild',p,'-p:EnableWindowsTargeting=true','-getProperty:NuGetAudit,NuGetAuditMode,NuGetAuditLevel,TreatWarningsAsErrors'])
run('core-rebuild',[d,'build',projects['core-tests'],'-c','Release','--no-incremental'])
run('core-tests',['bash','.github/scripts/agent-gates.sh','core-tests'])
run('sqlite-tests',[d,'test',projects['core-tests'],'-c','Release','--filter','FullyQualifiedName~SqliteSecurityTests','--logger','console;verbosity=detailed'])
run('windows-rebuild',[d,'build',projects['windows'],'-c','Release','--no-incremental','-p:EnableWindowsTargeting=true'])
run('windows-build',['bash','.github/scripts/agent-gates.sh','windows-build'])
run('portable-rebuild',[d,'build',projects['portable'],'-c','Release','--no-incremental'])
run('portable-tests',[d,'test',projects['portable'],'-c','Release'])
run('native-build',[d,'build',projects['native'],'-c','Release','--no-incremental','-p:EnableWindowsTargeting=true'])
run('solution-build',[d,'build','agent/Uma.Agent.sln','-c','Release','--no-incremental','-p:EnableWindowsTargeting=true'])
run('publish',[d,'publish',projects['windows'],'-c','Release','-r','win-x64','--self-contained','true','-p:PublishSingleFile=true','-p:IncludeNativeLibrariesForSelfExtract=true','-p:EnableWindowsTargeting=true','-o',str(s/'publish')])
run('bundle',['python3','agent/tests/Uma.Agent.Windows.Tests/Tools/bundle_probe.py',str(s/'publish/Uma.Agent.Windows.exe'),str(r)])
run('native-asset',['python3','agent/tests/Uma.Agent.Windows.Tests/Tools/sqlite_native_probe.py',str(s/'publish/Uma.Agent.Windows.exe'),str(s/'sqlitepclraw.lib.e_sqlite3.2.1.12.nupkg')])
run('github-regression',['bash','.github/tests/run.sh'])
run('config',['node','.github/scripts/check-config.mjs','.'])
for name in ['MemoryProbe','EdgeProbe']:
 p='agent/tests/Uma.Agent.Windows.Tests/Tools/'+name
 run(name+'-build',[d,'build',p,'-c','Release','--no-incremental'])
 run(name,[d,p+'/bin/Release/net8.0/'+name+'.dll',str(r)])
run('dyld-native',[d,'test',projects['core-tests'],'-c','Release','--filter','FullyQualifiedName~Loaded_native_engine','--logger','console;verbosity=detailed'],{'DYLD_PRINT_LIBRARIES':'1'})
print('ALL GATES COMPLETED',flush=True)
