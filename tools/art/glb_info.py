import json, struct, sys
for p in sys.argv[1:]:
    d=open(p,'rb').read()
    n=struct.unpack('<I',d[12:16])[0]
    j=json.loads(d[20:20+n])
    names=[x.get('name','') for x in j.get('nodes',[])]
    mins=[];maxs=[]
    for m in j.get('meshes',[]):
        for pr in m['primitives']:
            a=j['accessors'][pr['attributes']['POSITION']]
            if 'min' in a: mins.append(a['min']); maxs.append(a['max'])
    lo=[min(v[i] for v in mins) for i in range(3)] if mins else None
    hi=[max(v[i] for v in maxs) for i in range(3)] if maxs else None
    ext=j.get('extensionsRequired',[])
    print(p.split('/')[-1], 'nodes',len(names),'anims',len(j.get('animations',[])),'skins',len(j.get('skins',[])),'ext',ext)
    print('   names:', [x for x in names][:30])
    print('   mesh-local bounds', [round(x,2) for x in lo] if lo else '', [round(x,2) for x in hi] if hi else '')
