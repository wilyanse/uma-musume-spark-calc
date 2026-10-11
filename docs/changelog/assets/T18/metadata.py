import urllib.request,json,zipfile,io,hashlib,pathlib,ctypes,concurrent.futures
s=pathlib.Path(__file__).parent;s.mkdir(exist_ok=True)
urls={'advisory':'https://api.github.com/advisories/GHSA-2m69-gcr7-jv3q'}
for name in ['sqlitepclraw.bundle_e_sqlite3','sqlitepclraw.provider.e_sqlite3','sqlitepclraw.core','sqlitepclraw.lib.e_sqlite3']:
 urls[name+'-versions']='https://api.nuget.org/v3-flatcontainer/'+name+'/index.json'
for key,url in urls.items():
 data=urllib.request.urlopen(url).read();(s/(key+'.json')).write_bytes(data)
def package(n,v):
 u=f'https://api.nuget.org/v3-flatcontainer/{n}/{v}/{n}.{v}.nupkg';b=urllib.request.urlopen(u).read();p=s/f'{n}.{v}.nupkg';p.write_bytes(b);z=zipfile.ZipFile(io.BytesIO(b));spec=z.read(next(x for x in z.namelist() if x.endswith('.nuspec'))).decode(); print('\n',u,'SHA256',hashlib.sha256(b).hexdigest(),spec)
 print('assets', [x for x in z.namelist() if x.startswith(('lib/','build/','buildTransitive/','runtimes/'))])
 for rid in ['osx-arm64','win-x64']:
  matches=[x for x in z.namelist() if x.startswith('runtimes/'+rid+'/native/')]
  for x in matches:
   dst=s/(n+'.'+v+'.'+rid+'.'+pathlib.Path(x).name);dst.write_bytes(z.read(x));print(x,'SHA256',hashlib.sha256(dst.read_bytes()).hexdigest())
   if rid=='osx-arm64':
    dll=ctypes.CDLL(str(dst));dll.sqlite3_libversion.restype=ctypes.c_char_p;dll.sqlite3_sourceid.restype=ctypes.c_char_p;print('native',dll.sqlite3_libversion(),dll.sqlite3_sourceid())
for n,v in [('microsoft.data.sqlite','10.0.3'),('microsoft.data.sqlite.core','10.0.3'),('sqlitepclraw.bundle_e_sqlite3','2.1.12'),('sqlitepclraw.bundle_e_sqlite3','2.1.13'),('sqlitepclraw.bundle_e_sqlite3','3.0.5'),('sqlitepclraw.lib.e_sqlite3','2.1.12'),('sqlitepclraw.lib.e_sqlite3','2.1.13'),('sqlitepclraw.provider.e_sqlite3','2.1.12'),('sqlitepclraw.core','2.1.12')]:package(n,v)
